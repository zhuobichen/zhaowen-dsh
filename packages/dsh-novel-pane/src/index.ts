// novel-pane 的宿主半身：读文件、分页、记位置，并且把它开成一个只读路由，
// 让浏览器那半把窗格画出来。
//
// 和 Claude Code 版的差别只在一处：那边按终端格子折行（一个汉字两格），这里
// **按源文件的行分页**——浏览器自己会折行，再套一层格子宽度只会把长段落切碎。

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { readEpubText } from './epub.js'
import { ensureLingTai, lingTaiStatus } from './lingtai.js'
import type { LingtaiConfig } from './lingtai.js'
import { createLibraryIndex, defaultLibraryRoots, kindOf, titleOf } from './library.js'
import type { LibraryIndexCache } from './library.js'
import { readPdfText } from './pdf.js'
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
  /**
   * 书库索引扫哪些根目录。缺省是本机现有的四个（Downloads、ebook-library/files、
   * lingtai-reader/books、lingtai-reader/data/text_cache），可在 cordis.patch.yml
   * 里用 `config.library` 整份覆盖。
   */
  library?: string[]
  /**
   * 索引排除规则（正则或子串，匹配文件 / 目录名）。缺省是一小串明显的垃圾：
   * `简历` / `_raw` / `副本` / `~$`。刻意不给大表——论文和书靠文件名分不干净。
   */
  exclude?: string[]
  /** 抽 PDF 用的 python 可执行文件。缺省 `python`，失败再试 `py -3`。 */
  python?: string
  /** PDF 抽取超时（毫秒），超时会杀子进程。缺省 120000。 */
  pdfTimeoutMs?: number
  /**
   * 灵台阅读器（另一个独立 web app，`python server.py`，默认 8769）。
   * `dir` 没有缺省值：不写就把 `process.env.LINGTAI_DIR` 当目录，再没有就报可读错误。
   * 示例（仅注释）：`dir: 'D:\github_project\ZhaoWen_GitHub维护\lingtai-reader'`。
   */
  lingtai?: LingtaiConfig
}

/** 测试口：换掉灵台阅读器的探测 / spawn（测试里绝不真起 python）。 */
export { setLingTaiProbeForTests, setLingTaiSpawnForTests } from './lingtai.js'

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

/**
 * 读一本书的正文。`.epub` 走 EPUB 那条链（抽正文 + 磁盘缓存），`.pdf` 走
 * python + PyMuPDF（同样是缓存），其余按纯文本读。
 * 标题对 epub/pdf 会洗掉 z-library 尾巴，纯文本保持文件名（与旧行为一致）。
 */
const readBook = async (
  file: string,
  pdf: { python?: string; timeoutMs?: number } = {},
): Promise<{ title: string; lines: string[] }> => {
  const name = file.split(/[\\/]/).pop() ?? file
  const kind = kindOf(name)

  if (kind === 'epub') {
    const extracted = readEpubText(file)

    return {
      title: titleOf(name),
      lines: extracted.text.replace(/\r\n?/g, '\n').split('\n'),
    }
  }

  if (kind === 'pdf') {
    const extracted = await readPdfText(file, { python: pdf.python, timeoutMs: pdf.timeoutMs })

    return {
      title: titleOf(name),
      lines: extracted.text.replace(/\r\n?/g, '\n').split('\n'),
    }
  }

  return { title: name, lines: linesOfFile(file) }
}

/** 把 `~` 展开成家目录；其余原样返回。 */
const expandHome = (raw: string): string => {
  if (raw === '~') return homedir()
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return join(homedir(), raw.slice(2))

  return raw
}

/** 把用户给的路径按会话目录解析。 */
const resolvePath = (raw: string, cwd: string): string => {
  const path = expandHome(raw)

  return isAbsolute(path) ? path : resolve(cwd, path)
}

/** 装配这个插件。 */
export function apply(ctx: any, config: Config = {}): void {
  const pageRows = Math.max(1, Math.floor(config.pageRows ?? PAGE_ROWS))
  const wantsWeb = config.web ?? true

  let state = readState()
  /** 当前这本书，读一次缓存住；换书或文件变了才重读。 */
  let book: Book | null = null
  /** 书库索引：进程内缓存，按需重建。 */
  const libraryRoots = (config.library ?? defaultLibraryRoots()).map((root) => expandHome(String(root)))
  const library: LibraryIndexCache = createLibraryIndex(libraryRoots, { exclude: config.exclude })
  const pdfOptions = { python: config.python, timeoutMs: config.pdfTimeoutMs }

  const openBook = async (file: string): Promise<Book> => {
    // 缓存命中也要把窗格打开：`open-path` 重开同一本书时走的就是这条路。
    if (book !== null && book.file === file) {
      state.open = true
      writeState(state)

      return book
    }

    const read = await readBook(file, pdfOptions)
    const lines = read.lines

    book = { file, title: read.title, lines }
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
   * 异步：PDF 第一次打开要等 python 抽完（之后走缓存）。
   */
  const currentLines = async (): Promise<string[]> => {
    if (state.file === null) return []
    if (book !== null && book.file === state.file) return book.lines
    if (!existsSync(state.file)) return []

    try {
      const read = await readBook(state.file, pdfOptions)

      book = { file: state.file, title: read.title, lines: read.lines }

      return read.lines
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
  const snapshot = async (rows: number, wantShelf = false) => {
    const lines = await currentLines()
    const total = lines.length
    const safeRows = Math.max(1, Math.floor(rows))
    const shelf = wantShelf ? shelfOf(safeRows) : null
    const name = state.file === null ? null : (state.file.split(/[\\/]/).pop() ?? state.file)
    const title =
      state.file === null
        ? null
        : book !== null && book.file === state.file
          ? book.title
          : name !== null && (kindOf(name) === 'epub' || kindOf(name) === 'pdf')
            ? titleOf(name)
            : name

    return {
      open: state.open,
      title,
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

                json(200, await snapshot(Number.isFinite(rows) ? rows : pageRows, shelf))

                return
              }

              // 书库索引：扫本机几个目录里的书。`?refresh=1` 绕过 60 秒缓存。
              if (path === '/library' && req.method === 'GET') {
                try {
                  const index = library.get(url.searchParams.get('refresh') === '1')

                  json(200, { ...index, total: index.books.length })
                } catch (error) {
                  json(500, {
                    error: 'library failed',
                    message: String((error as Error)?.message ?? error),
                    books: [],
                    skipped: [],
                  })
                }

                return
              }

              // 灵台阅读器（lingtai-reader，独立 web app）。
              //   GET  /lingtai → 只查状态：{ok, running, url}，不启动任何东西
              //   POST /lingtai → 确保在跑：{ok, launched, url}；超时 / 没配目录给可读错误，不抛
              if (path === '/lingtai') {
                if (req.method === 'GET') {
                  try {
                    json(200, await lingTaiStatus(config.lingtai))
                  } catch (error) {
                    json(500, {
                      ok: false,
                      running: false,
                      url: '',
                      code: 'LINGTAI_PROBE_FAILED',
                      message: String((error as Error)?.message ?? error),
                    })
                  }

                  return
                }

                if (req.method === 'POST') {
                  let result

                  try {
                    result = await ensureLingTai(config.lingtai)
                  } catch (error) {
                    // ensureLingTai 自己不该抛；兜底成 JSON，别把宿主 web 服务打挂
                    result = {
                      ok: false,
                      launched: false,
                      code: 'LINGTAI_FAILED',
                      message: String((error as Error)?.message ?? error),
                    }
                  }

                  // 配置类错误用 400（照着改配置就能好）；启动超时是正常的业务结果，仍给 200
                  const configError = [
                    'LINGTAI_NO_DIR',
                    'LINGTAI_BAD_DIR',
                    'LINGTAI_NO_SERVER',
                  ].includes(String((result as { code?: string }).code ?? ''))

                  json(configError ? 400 : 200, result)

                  return
                }

                json(405, { error: 'method not allowed' })

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
              const lines = await currentLines()

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

                  if (file === null || !existsSync(file) || !statSync(file).isFile()) {
                    json(400, { error: 'not a file', path: file })

                    return
                  }

                  try {
                    await openBook(file)
                  } catch (error) {
                    // 坏包 / 加密的 epub：说清楚为什么，别静默留在原来那本
                    json(400, {
                      error: 'unreadable',
                      path: file,
                      message: String((error as Error)?.message ?? error),
                    })

                    return
                  }
                  break
                }
                case 'open-path': {
                  // 浏览器那半的「打开」输入框：绝对路径、相对上一本书的目录，
                  // 或者 `~/...`。
                  const raw = String(body.path ?? '').trim()

                  if (raw === '') {
                    json(400, { error: 'empty path' })

                    return
                  }

                  const file = resolvePath(raw, state.dir ?? process.cwd())

                  if (!existsSync(file) || !statSync(file).isFile()) {
                    json(400, { error: 'not a file', path: file })

                    return
                  }

                  try {
                    await openBook(file)
                  } catch (error) {
                    json(400, { error: 'unreadable', path: file, message: String((error as Error)?.message ?? error) })

                    return
                  }
                  break
                }
                case 'browse': {
                  // 换一个目录看书单，但不动当前这本书。
                  const raw = String(body.dir ?? '').trim()

                  if (raw !== '') {
                    const dir = resolvePath(raw, state.dir ?? process.cwd())

                    if (existsSync(dir) && statSync(dir).isDirectory()) state.dir = dir
                  }
                  state.open = true
                  break
                }
                default:
                  json(400, { error: 'unknown op' })

                  return
              }

              writeState(state)
              json(200, await snapshot(rows, body.shelf === true))
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
      handler: async (invocation: any) => {
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

          const lines = await currentLines()
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
          const opened = await openBook(file)

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
