// moon-band 的宿主半身：月相 + 一句古诗，算好之后由客户端插件画在输入框上方。
//
// 为什么算在宿主：语料 3.18 MB（46167 句），塞不进客户端的模块包；而且「这一分钟
// 取哪一句」必须只有一个说法，不能每个标签页各算各的。
//
// 对外两个只读路由，外加 `/moon` 开关：
//   GET /dsh-moon-band/line    当前这一行的全部事实（诗句/作者/朝代/月相）
//   GET /dsh-moon-band/about   点开详解：命中缓存直接返回，否则问一次 AI 并落盘

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { aboutParse, aboutPromptOf, PoemCache } from './cache.js'
import type { PoemAbout } from './cache.js'
import { dynastyOf } from './dynasty.js'
import { lineOf, moonAt, poemAt, poemsOf, POEMS, sourceParts } from './moon.js'
import type { Poem } from './moon.js'

/** 路由前缀；客户端那半写死了同一个串。 */
const ROUTE = '/dsh-moon-band'

/** 语料相对包根的位置（lib/index.js → ../data/poems.txt）。 */
const CORPUS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'poems.txt')

export const name = 'moon-band'

export interface Config {
  /** 关掉 web 路由（只有 TUI 的 profile 用不到）。缺省 true。 */
  web?: boolean
  /** 详解用哪个 provider 路由。缺省 deepseek-official。 */
  provider?: string
  /** 详解用哪个模型。缺省 deepseek-flash。 */
  model?: string
  /** 一次详解的超时，毫秒。缺省 60 秒。 */
  aboutTimeoutMs?: number
  /**
   * 推理档位。缺省 `off`。
   *
   * 必须显式关掉：deepseek-flash 是**推理模型**，不传档位时默认 `high`，它会
   * 把整个 token 预算烧在 `reasoning_content` 上，正文 `content` 是空字符串，
   * 于是「模型没答出东西」→ 502。这个坑踩过一次。
   */
  reasoningEffort?: 'off' | 'low' | 'high' | 'max'
  /** 单次请求的 token 预算。缺省 2000（700 太小，正文常常被推理挤掉）。 */
  maxTokens?: number
  /** 失败重试次数。缺省 2。 */
  retries?: number
}

type Snapshot = {
  /** 那一行字（TUI 也是这个）。 */
  text: string
  /** 拆开的字段，客户端用来排版和显示朝代。 */
  line: string
  from: string
  author: string
  title: string | null
  /** 朝代；表里没有就是 null（不猜）。命中缓存后由 AI 补上。 */
  dynasty: string | null
  /** 年份/年代；只有问过 AI 才有。 */
  year: string | null
  /** `/moon` 收起来了。 */
  hidden: boolean
  /** 语料是不是真读到了（false = 只有内置 8 句）。 */
  corpus: boolean
  /** 这一行的详解是否已在缓存里（客户端据此决定按钮文案）。 */
  aboutCached: boolean
  /** 这一行对应的时间戳，客户端据此判断新旧。 */
  ts: number
}

/** 插件自己的落盘目录：开关与详解缓存都在这儿。 */
const stateDirOf = (): string =>
  join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'plugins', 'dsh-moon-band')

const stateFileOf = (): string => join(stateDirOf(), 'state.json')
const cacheFileOf = (): string => join(stateDirOf(), 'poems-cache.json')

const readHidden = (): boolean => {
  try {
    const parsed = JSON.parse(readFileSync(stateFileOf(), 'utf8')) as { hidden?: unknown }

    return parsed.hidden === true
  } catch {
    return false
  }
}

const writeHidden = (hidden: boolean): void => {
  try {
    const file = stateFileOf()

    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ hidden }), 'utf8')
  } catch {
    // 写不进去只影响「下次启动记不记得」，这一轮照样有效
  }
}

/**
 * 装配这个插件。
 * @param ctx - Cordis 上下文。
 * @param config - 插件配置。
 */
export function apply(ctx: any, config: Config = {}): void {
  const wantsWeb = config.web ?? true
  const provider = config.provider ?? 'deepseek-official'
  const model = config.model ?? 'deepseek-flash'
  const aboutTimeoutMs = config.aboutTimeoutMs ?? 60_000
  const reasoningEffort = config.reasoningEffort ?? 'off'
  const maxTokens = config.maxTokens ?? 2000
  const retries = config.retries ?? 2

  const cache = new PoemCache(cacheFileOf())
  void cache.load()

  /** 语料只读一次；读不到就退回内置 8 句（并如实告诉客户端）。 */
  let corpus: Poem[] | null = null
  let corpusLoaded = false

  const loadCorpus = (): Poem[] => {
    if (corpusLoaded && corpus !== null) return corpus

    corpusLoaded = true

    try {
      if (!existsSync(CORPUS_PATH)) throw new Error(`no corpus at ${CORPUS_PATH}`)

      const read = poemsOf(readFileSync(CORPUS_PATH, 'utf8'))

      // 比内置还少就当作没读到：一个悄悄变小、却看着正常的语料比报错更糟
      if (read.length > POEMS.length) {
        corpus = read

        return corpus
      }

      throw new Error(`corpus too small (${String(read.length)} lines)`)
    } catch (error) {
      console.warn(`moon-band: ${error instanceof Error ? error.message : String(error)}; using the built-in 8 lines`)
      corpus = POEMS

      return corpus
    }
  }

  let hidden = readHidden()

  const snapshot = (): Snapshot => {
    const poems = loadCorpus()
    const nowMs = Date.now()
    const moon = moonAt(nowMs)
    const poem = poemAt(nowMs, poems)
    const { author, title } = sourceParts(poem.from)
    const cached = cache.get(poem.line)

    return {
      text: lineOf(nowMs, poems),
      line: poem.line,
      from: poem.from,
      author,
      title,
      // 缓存里的朝代优先：表里没有的作者，问过一次之后就知道了
      dynasty: cached?.dynasty ?? dynastyOf(author),
      year: cached?.year ?? null,
      hidden,
      corpus: poems !== POEMS,
      aboutCached: cached !== undefined,
      ts: nowMs,
    }
  }

  /** 一次进行中的生成：同一句诗并发点两次只问一次 AI。 */
  const inFlight = new Map<string, Promise<{ about: PoemAbout | null; reason: string }>>()

  /**
   * 问一次模型：返回 `{ about, reason }`。
   * - about 不为 null 表示成功；null 表示失败。
   * - reason 给调用方拼 502 错误信息用。
   */
  const askOnce = async (
    poem: Poem,
    effort: string | undefined,
    tokens: number,
    signal: AbortSignal,
  ): Promise<{ about: PoemAbout | null; reason: string }> => {
    const llm = ctx.get?.('llm', false)

    if (llm === undefined || llm === null) {
      return { about: null, reason: 'LLM 服务不可用（插件未加载或尚未初始化）' }
    }

    const { system, user } = aboutPromptOf(poem.line, poem.from)
    let text = ''
    let reasoningText = ''

    try {
      const options: any = {
        provider,
        model,
        system,
        messages: [
          {
            id: `moon-band-${Date.now()}`,
            role: 'user',
            content: [{ type: 'text', text: user }],
            source: { kind: 'user' },
          },
        ],
        maxTokens: tokens,
        signal,
      }

      if (effort !== undefined) options.reasoningEffort = effort

      const stream = llm.stream(options)

      for await (const chunk of stream) {
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
        if (chunk?.type === 'reasoning-delta' && typeof chunk.text === 'string') reasoningText += chunk.text
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)

      return { about: null, reason: `流式请求失败：${msg}` }
    }

    // 典型失败：推理模型把 token 全用在 reasoning_content 上，正文是空字符串
    if (text === '') {
      const hint =
        reasoningText !== ''
          ? `正文空（reasoning ${reasoningText.length} 字符），可能 maxTokens 不够或 reasoningEffort 过高`
          : '正文空，模型未返回任何内容'

      return { about: null, reason: hint }
    }

    const about = aboutParse(text, Date.now())

    if (about === null) {
      const preview = text.length > 120 ? `${text.slice(0, 120)}…` : text

      return { about: null, reason: `解析 JSON 失败，原文：${preview}` }
    }

    return { about, reason: '' }
  }

  const aboutOf = async (poem: Poem): Promise<{ about: PoemAbout | null; reason: string }> => {
    const hit = cache.get(poem.line)

    if (hit !== undefined) return { about: hit, reason: '' }

    const running = inFlight.get(poem.line)

    if (running !== undefined) return running

    const job: Promise<{ about: PoemAbout | null; reason: string }> = (async () => {
      // 重试策略：
      //   第 1 次：用户配置的档位（缺省 off）+ 配置的 maxTokens
      //   第 2 次及以后：始终用 off + 4x maxTokens（确保推理不会挤掉正文）
      const attempts = retries < 1 ? 1 : retries
      let lastReason = '未知错误'

      for (let i = 0; i < attempts; i += 1) {
        const isFirst = i === 0
        const effort = isFirst ? reasoningEffort : 'off'
        const tokens = isFirst ? maxTokens : maxTokens * 4
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), aboutTimeoutMs)

        try {
          const { about, reason } = await askOnce(poem, effort, tokens, controller.signal)

          if (about !== null) {
            await cache.put(poem.line, about)

            return { about, reason: '' }
          }

          lastReason = reason
          console.warn(`moon-band: 详解第 ${i + 1} 次失败（${reason}）；还剩 ${attempts - 1 - i} 次`)
        } finally {
          clearTimeout(timer)
        }
      }

      console.warn(`moon-band: 所有 ${attempts} 次尝试都失败，最后原因：${lastReason}`)

      return { about: null, reason: lastReason }
    })()

    inFlight.set(poem.line, job)

    try {
      return await job
    } finally {
      inFlight.delete(poem.line)
    }
  }

  const send = (res: any, status: number, body: unknown): void => {
    const text = JSON.stringify(body)

    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(text),
      'cache-control': 'no-store',
    })
    res.end(text)
  }

  // ---- 接缝 1：给客户端的只读路由 ---------------------------------------
  if (wantsWeb) {
    ctx.inject(['webServer'], (webCtx: any) => {
      webCtx.effect(
        () =>
          webCtx.webServer.register({
            kind: 'prefix',
            path: ROUTE,
            handler: async (req: any, res: any) => {
              const url = String(req.url ?? '/')
              const [rawPath, query = ''] = url.split('?')
              const path = rawPath.replace(ROUTE, '') || '/'

              if (req.method !== 'GET' && req.method !== 'HEAD') {
                res.writeHead(405)
                res.end()

                return
              }

              if (path === '/line' || path === '/') {
                send(res, 200, snapshot())

                return
              }

              if (path === '/about') {
                const asked = new URLSearchParams(query).get('line') ?? ''
                const poems = loadCorpus()
                // 只接受语料里真有的句子：否则这就成了一个「随便问 AI」的入口
                const poem = poems.find((one) => one.line === asked)

                if (poem === undefined) {
                  send(res, 404, { error: 'not in the corpus' })

                  return
                }

                const hit = cache.get(poem.line)

                if (hit !== undefined) {
                  send(res, 200, { cached: true, ...hit })

                  return
                }

                const { about, reason } = await aboutOf(poem)

                if (about === null) {
                  send(res, 502, { error: 'the model did not answer with a usable explanation', reason })

                  return
                }

                send(res, 200, { cached: false, ...about })

                return
              }

              send(res, 404, { error: 'not found' })
            },
          }),
        'moon-band: /dsh-moon-band route',
      )
    })
  }

  // ---- 接缝 2：/moon 开关 ------------------------------------------------
  ctx.inject(['commands'], (commandCtx: any) => {
    commandCtx.commands.register({
      name: 'moon',
      description: 'Hide or show the moon line (moon-band)',
      handler: () => {
        hidden = !hidden
        writeHidden(hidden)

        return { kind: 'success' as const, text: hidden ? 'moon line hidden' : 'moon line shown' }
      },
    })
  })
}
