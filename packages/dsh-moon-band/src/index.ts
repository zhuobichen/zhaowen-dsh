// moon-band 的宿主半身：月相 + 一句古诗，算好之后由客户端插件画在输入框上方。
//
// 为什么算在宿主：语料 3.18 MB（46167 句），塞不进客户端的模块包；而且「这一分钟
// 取哪一句」必须只有一个说法，不能每个标签页各算各的。
//
// 对外只有一个只读路由 `GET /dsh-moon-band/line`，外加 `/moon` 开关。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { lineOf, poemsOf, POEMS } from './moon.js'
import type { Poem } from './moon.js'

/** 路由前缀；客户端那半写死了同一个串。 */
const ROUTE = '/dsh-moon-band'

/** 语料相对包根的位置（lib/index.js → ../data/poems.txt）。 */
const CORPUS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'poems.txt')

export const name = 'moon-band'

export interface Config {
  /** 关掉 web 路由（只有 TUI 的 profile 用不到）。缺省 true。 */
  web?: boolean
}

type Snapshot = {
  /** 那一行字。 */
  text: string
  /** `/moon` 收起来了。 */
  hidden: boolean
  /** 语料是不是真读到了（false = 只有内置 8 句）。 */
  corpus: boolean
  /** 这一行对应的时间戳，客户端据此判断新旧。 */
  ts: number
}

/** 开关状态落在 DSH_HOME 下，跨会话保留。读不到就当「显示」。 */
const stateFileOf = (): string =>
  join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'plugins', 'dsh-moon-band', 'state.json')

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

    return { text: lineOf(nowMs, poems), hidden, corpus: poems !== POEMS, ts: nowMs }
  }

  // ---- 接缝 1：给客户端的只读路由 ---------------------------------------
  if (wantsWeb) {
    ctx.inject(['webServer'], (webCtx: any) => {
      webCtx.effect(
        () =>
          webCtx.webServer.register({
            kind: 'prefix',
            path: ROUTE,
            handler: (req: any, res: any) => {
              const url = String(req.url ?? '/')
              const path = url.split('?')[0].replace(ROUTE, '') || '/'

              if (path !== '/line' && path !== '/') {
                res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
                res.end(JSON.stringify({ error: 'not found' }))

                return
              }

              res.writeHead(200, {
                'content-type': 'application/json; charset=utf-8',
                // 一分钟换一句：让浏览器最多缓存一分钟，别的交给 no-cache 语义
                'cache-control': 'no-cache',
              })
              res.end(JSON.stringify(snapshot()))
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
