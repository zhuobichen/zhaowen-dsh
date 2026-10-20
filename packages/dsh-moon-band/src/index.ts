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
  const inFlight = new Map<string, Promise<PoemAbout | null>>()

  const aboutOf = async (poem: Poem): Promise<PoemAbout | null> => {
    const hit = cache.get(poem.line)

    if (hit !== undefined) return hit

    const running = inFlight.get(poem.line)

    if (running !== undefined) return running

    const job = (async (): Promise<PoemAbout | null> => {
      const llm = ctx.get?.('llm', false)

      if (llm === undefined) return null

      const { system, user } = aboutPromptOf(poem.line, poem.from)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), aboutTimeoutMs)

      try {
        // 只累加 text-delta：一次性纯文本生成不需要完整的块装配器，
        // 也就不必为它多引一个 @deepseek-ai/dsh-llm 依赖。
        let text = ''
        const stream = llm.stream({
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
          maxTokens: 700,
          signal: controller.signal,
        })

        for await (const chunk of stream) {
          if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
        }

        const about = aboutParse(text, Date.now())

        if (about === null) return null

        await cache.put(poem.line, about)

        return about
      } catch {
        return null
      } finally {
        clearTimeout(timer)
      }
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

                const about = await aboutOf(poem)

                if (about === null) {
                  send(res, 502, { error: 'the model did not answer with a usable explanation' })

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
