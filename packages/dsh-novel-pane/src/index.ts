// novel-pane 的宿主半身：读文件、分页、记位置，并且把它开成一个只读路由，
// 让浏览器那半把窗格画出来。
//
// 和 Claude Code 版的差别只在一处：那边按终端格子折行（一个汉字两格），这里
// **按源文件的行分页**——浏览器自己会折行，再套一层格子宽度只会把长段落切碎。

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import {
  bookFilesOf,
  isStepOf,
  lastLineOf,
  modeNameOf,
  modeOf,
  printedOf,
  progressOf,
  positionOf,
  shelfPrintOf,
  steppedBy,
  windowOf,
} from './paging.js'
import type { Mode } from './paging.js'

/** 路由前缀；客户端那半写死同一个串。 */
const ROUTE = '/dsh-novel-pane'

/** `/novel n` 打印一页用多少行——窗格自己会报它的行数，命令这条路只能取个常数。 */
const PAGE_ROWS = 24

export const name = 'novel-pane'

export interface Config {
  /** `/novel n` 打印一页几行。缺省 24。 */
  pageRows?: number
  /** 关掉 web 路由。缺省 true。 */
  web?: boolean
}

type State = {
  /** 窗格开着吗。 */
  open: boolean
  /** 当前这本书的绝对路径。 */
  file: string | null
  /** 书单所在的目录（打开的书所在目录，或 `/novel shelf` 指定的）。 */
  dir: string | null
  /** 窗口顶行（0 起）。 */
  line: number
  mode: Mode
}

const EMPTY: State = { open: false, file: null, dir: null, line: 0, mode: 'scroll' }

const stateFileOf = (): string =>
  join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'plugins', 'dsh-novel-pane', 'state.json')

const readState = (): State => {
  try {
    const parsed = JSON.parse(readFileSync(stateFileOf(), 'utf8')) as Partial<State>

    return {
      open: parsed.open === true,
      file: typeof parsed.file === 'string' ? parsed.file : null,
      dir: typeof parsed.dir === 'string' ? parsed.dir : null,
      line: typeof parsed.line === 'number' && Number.isFinite(parsed.line) ? Math.max(0, Math.floor(parsed.line)) : 0,
      mode: modeOf(parsed.mode),
    }
  } catch {
    return { ...EMPTY }
  }
}

const writeState = (state: State): void => {
  try {
    const file = stateFileOf()

    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(state), 'utf8')
  } catch {
    // 写不进去只影响「下次启动记不记得」，这一轮照样能读
  }
}

/** 一本书：路径、标题、按行切开的正文。 */
type Book = { file: string; title: string; lines: string[] }

const linesOfFile = (file: string): string[] =>
  readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').split('\n')

/** 把用户给的路径按会话目录解析。 */
const resolvePath = (raw: string, cwd: string): string =>
  isAbsolute(raw) ? raw : resolve(cwd, raw)

/** 装配这个插件。 */
export function apply(ctx: any, config: Config = {}): void {
  const pageRows = Math.max(1, Math.floor(config.pageRows ?? PAGE_ROWS))
  const wantsWeb = config.web ?? true

  let state = readState()
  /** 当前这本书，读一次缓存住；换书或文件变了才重读。 */
  let book: Book | null = null

  const openBook = (file: string): Book => {
    if (book !== null && book.file === file) return book

    const lines = linesOfFile(file)

    book = { file, title: file.split(/[\\/]/).pop() ?? file, lines }
    state.file = file
    state.dir = dirname(file)
    state.line = Math.min(state.line, lastLineOf(lines.length, pageRows))
    state.open = true
    writeState(state)

    return book
  }

  /** 位置挪动统一走这里：夹在 [0, 最后一页顶行]。 */
  const land = (line: number, rows: number, total: number): void => {
    state.line = Math.min(lastLineOf(total, rows), Math.max(0, Math.floor(line)))
    writeState(state)
  }

  /**
   * 当前这本书的正文。**只读**：GET 快照不该顺手把窗格重新打开，也不该写盘。
   */
  const currentLines = (): string[] => {
    if (state.file === null) return []
    if (book !== null && book.file === state.file) return book.lines
    if (!existsSync(state.file)) return []

    try {
      const lines = linesOfFile(state.file)

      book = { file: state.file, title: state.file.split(/[\\/]/).pop() ?? state.file, lines }

      return lines
    } catch {
      return []
    }
  }

  const shelfOf = (rows: number): string[] => {
    if (state.dir === null) return []

    try {
      return bookFilesOf(
        readdirSync(state.dir, { withFileTypes: true }).map((entry: any) => ({
          name: entry.name,
          kind: entry.isFile() ? 'file' : entry.isDirectory() ? 'dir' : 'other',
        })),
      )
    } catch {
      return []
    }
  }

  /** 给客户端的一份快照。`shelf` 非空时窗格画书单，而不是正文。 */
  const snapshot = (rows: number, wantShelf = false) => {
    const lines = currentLines()
    const total = lines.length
    const safeRows = Math.max(1, Math.floor(rows))
    const shelf = wantShelf ? shelfOf(safeRows) : null

    return {
      open: state.open,
      title: state.file === null ? null : (state.file.split(/[\\/]/).pop() ?? state.file),
      file: state.file,
      dir: state.dir,
      mode: state.mode,
      line: state.line,
      total,
      rows: safeRows,
      progress: progressOf(state.line, safeRows, total),
      position: positionOf(state.line, safeRows, total, state.mode),
      text: shelf === null ? windowOf(lines, state.line, safeRows) : [],
      shelf,
    }
  }

  // ---- 接缝 1：给浏览器的路由 -------------------------------------------
  if (wantsWeb) {
    ctx.inject(['webServer'], (webCtx: any) => {
      webCtx.effect(
        () =>
          webCtx.webServer.register({
            kind: 'prefix',
            path: ROUTE,
            handler: async (req: any, res: any) => {
              const url = new URL(String(req.url ?? '/'), 'http://localhost')
              const path = url.pathname.replace(ROUTE, '') || '/'
              const json = (code: number, body: unknown) => {
                res.writeHead(code, {
                  'content-type': 'application/json; charset=utf-8',
                  'cache-control': 'no-store',
                })
                res.end(JSON.stringify(body))
              }

              if (path === '/state' || path === '/') {
                const rows = Number(url.searchParams.get('rows') ?? pageRows)
                const shelf = url.searchParams.get('shelf') === '1'

                json(200, snapshot(Number.isFinite(rows) ? rows : pageRows, shelf))

                return
              }

              if (path !== '/move' || req.method !== 'POST') {
                json(404, { error: 'not found' })

                return
              }

              // 读请求体：这里不接受大文件，给个上限免得被灌
              let raw = ''

              for await (const chunk of req) {
                raw += String(chunk)
                if (raw.length > 64 * 1024) break
              }

              let body: any = {}

              try {
                body = raw === '' ? {} : JSON.parse(raw)
              } catch {
                json(400, { error: 'bad json' })

                return
              }

              const rows = Math.max(1, Math.floor(Number(body.rows ?? pageRows)))
              const lines = currentLines()

              switch (body.op) {
                case 'close':
                  state.open = false
                  break
                case 'open':
                  state.open = true
                  break
                case 'mode':
                  state.mode = state.mode === 'scroll' ? 'page' : 'scroll'
                  break
                case 'top':
                  state.line = 0
                  break
                case 'down':
                  land(state.line + (state.mode === 'page' ? rows : 1), rows, lines.length)
                  break
                case 'up':
                  land(state.line - (state.mode === 'page' ? rows : 1), rows, lines.length)
                  break
                case 'wheel': {
                  const delta = Math.floor(Number(body.delta ?? 0))
                  const step = state.mode === 'page' ? rows : 1

                  if (delta !== 0) land(state.line + (delta > 0 ? step : -step), rows, lines.length)
                  break
                }
                case 'goto':
                  land(Number(body.line ?? 0), rows, lines.length)
                  break
                case 'open-book': {
                  const name = String(body.name ?? '')
                  const file = state.dir === null ? null : join(state.dir, name)

                  if (file !== null && existsSync(file) && statSync(file).isFile()) {
                    try {
                      openBook(file)
                    } catch {
                      // 读不了就保持原样
                    }
                  }
                  break
                }
                default:
                  json(400, { error: 'unknown op' })

                  return
              }

              writeState(state)
              json(200, snapshot(rows, body.shelf === true))
            },
          }),
        'novel-pane: /dsh-novel-pane route',
      )
    })
  }

  // ---- 接缝 2：/novel 命令 ------------------------------------------------
  ctx.inject(['commands'], (commandCtx: any) => {
    commandCtx.commands.register({
      name: 'novel',
      description: 'Read a book in a pane (/novel <file> · n · p · <page> · shelf)',
      handler: (invocation: any) => {
        const session = invocation?.agent?.session
        const cwd = String(session?.header?.cwd ?? process.cwd())
        // 宿主给的是 `rawInput`：命令名之后的原文（含分隔空白），不是参数数组
        const word = String(invocation?.rawInput ?? '').trim()

        const reply = (text: string) => ({ kind: 'success' as const, text })

        // 无参数：开着就收起，没开就把上次那本打开
        if (word === '') {
          if (state.open) {
            state.open = false
            writeState(state)

            return reply('novel: 窗格已收起')
          }

          if (state.file === null) return reply('novel: 还没有书。用 `/novel <文件>` 打开一本')

          state.open = true
          writeState(state)

          return reply(`novel: ${state.file.split(/[\\/]/).pop() ?? state.file}`)
        }

        if (word === 'shelf' || word === 'list') {
          if (state.dir === null) state.dir = cwd

          const names = shelfOf(pageRows)

          return reply(shelfPrintOf(state.dir, names))
        }

        // 位置词汇：先于「当成路径」判断，否则 `/novel n` 会被当成一个叫 n 的文件
        if (isStepOf(word)) {
          if (state.file === null) return reply('novel: 还没有书。用 `/novel <文件>` 打开一本')

          const lines = currentLines()
          const next = steppedBy(word, state.line, pageRows, lines.length)

          if (next === null) return reply('novel: 看不懂这个指令')

          state.line = next
          state.open = true
          writeState(state)

          return reply(printedOf(lines, state.line, pageRows))
        }

        // 其余当作文件路径
        const file = resolvePath(word, cwd)

        if (!existsSync(file)) return reply(`novel: 找不到 ${file}`)

        try {
          const opened = openBook(file)

          state.line = Math.min(state.line, lastLineOf(opened.lines.length, pageRows))
          state.open = true
          writeState(state)

          return reply(`novel: 打开 ${opened.title}（${String(opened.lines.length)} 行）`)
        } catch (error) {
          return reply(`novel: 读不了 ${file}：${error instanceof Error ? error.message : String(error)}`)
        }
      },
    })
  })
}
