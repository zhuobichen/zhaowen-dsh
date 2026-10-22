// PDF：交给本机的 python + PyMuPDF 抽文字，不引 npm 依赖，也不做 pdf.js 兜底。
//
// 为什么不用 pdf.js：实测抽中文 PDF 会丢几乎全部汉字（《大语言模型》第 2 页：
// pdf.js 207 字符且无中文，PyMuPDF 1063 字符、内容完整）。所以这里只认 PyMuPDF。
//
// 抽取本身是**异步**的：一本 130 MB 的漫画 PDF 可能要跑很久，超时要能杀掉子进程，
// 而且不能把宿主的 web 服务卡住。抽出来的正文按 `路径 + mtime + size` 缓存到
// `$DSH_HOME/plugins/dsh-novel-pane/text/<hash>.txt`（和 EPUB 同一套缓存目录）。

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 默认给 120 秒：大 PDF / 漫画可能很慢，但也不能无限等。 */
export const DEFAULT_PDF_TIMEOUT_MS = 120_000

/** 去空白后少于这么多字符，就当「没有文字层」。 */
export const MIN_PDF_TEXT_CHARS = 200

/** 一行 python：路径走 argv[1]，正文按 UTF-8 字节写 stdout。 */
export const PYTHON_SCRIPT = `import sys
path = sys.argv[1]
try:
    import pymupdf as fitz
except Exception:
    try:
        import fitz
    except Exception:
        sys.stderr.write('PYMUPDF_MISSING')
        sys.exit(3)
try:
    doc = fitz.open(path)
except Exception as exc:
    sys.stderr.write('OPEN_FAILED: ' + str(exc))
    sys.exit(4)
try:
    parts = []
    for index, page in enumerate(doc):
        parts.append('\\n\\n[第 %d 页]\\n' % (index + 1))
        parts.append(page.get_text('text') or '')
    sys.stdout.buffer.write(''.join(parts).encode('utf-8'))
finally:
    try:
        doc.close()
    except Exception:
        pass
`

export class PdfNoTextError extends Error {}

export class PdfToolMissingError extends Error {}

/** 抽 PDF 正文的函数；测试里可以整条换掉，不真跑 python。 */
export type PdfExtractor = (file: string, options: PdfOptions) => Promise<string>

export interface PdfOptions {
  /** python 可执行文件；缺省 `python`，找不到再试 `py -3`。 */
  python?: string
  /** 子进程上限（毫秒）；超时会杀进程。缺省 120000。 */
  timeoutMs?: number
  /** 缓存目录；缺省 `$DSH_HOME/plugins/dsh-novel-pane/text`。 */
  cacheDir?: string
  /** 关掉缓存（测试 / 排错用）。 */
  useCache?: boolean
  /** 正文短于这个长度就当没有文字层。缺省 200。 */
  minTextChars?: number
}

export interface PdfText {
  text: string
  cached: boolean
  cacheFile: string
  key: string
}

let injected: PdfExtractor | null = null

/** 测试用：换掉真正的 python 抽取；传 null 还原。 */
export const setPdfExtractorForTests = (extractor: PdfExtractor | null): void => {
  injected = extractor
}

/** `$DSH_HOME/plugins/dsh-novel-pane/text/`（与 EPUB 共用）。 */
export const defaultPdfCacheDir = (): string =>
  join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'plugins', 'dsh-novel-pane', 'text')

/** 缓存键：路径 + mtime + size。文件一改，键就变。 */
export const pdfCacheKey = (file: string): string => {
  const stat = statSync(file)

  return createHash('sha1')
    .update(`${file}|${String(stat.mtimeMs)}|${String(stat.size)}`)
    .digest('hex')
}

interface SpawnOutcome {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

const runOnce = (
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<SpawnOutcome & { missing: boolean; failure?: NodeJS.ErrnoException }> =>
  new Promise((resolve) => {
    let child: ReturnType<typeof spawn>

    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({
        code: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        missing: true,
        failure: error as NodeJS.ErrnoException,
      })

      return
    }

    const out: Buffer[] = []
    const err: Buffer[] = []
    let timedOut = false
    let settled = false
    const finish = (outcome: SpawnOutcome, failure?: NodeJS.ErrnoException): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ...outcome, missing: failure?.code === 'ENOENT', failure })
    }
    const timer = setTimeout(() => {
      timedOut = true
      // 超时必须真杀：130 MB 的漫画能把 PyMuPDF 拖很久
      try {
        child.kill('SIGKILL')
      } catch {
        // 进程可能已经自己退了
      }
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => err.push(chunk))
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({ code: null, stdout: '', stderr: '', timedOut: false }, error)
    })
    child.on('close', (code) => {
      finish({
        code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        timedOut,
      })
    })
  })

/** 候选解释器：配置的优先，缺省 `python`，再退 `py -3`。 */
export const pythonCandidates = (configured?: string): string[][] => {
  const seen = new Set<string>()
  const list: string[][] = []

  for (const command of [configured, 'python', 'py']) {
    if (command === undefined || command === null || command === '') continue

    const argv = command === 'py' ? ['py', '-3'] : [command]
    const key = argv.join('\u0000')

    if (seen.has(key)) continue

    seen.add(key)
    list.push(argv)
  }

  return list
}

const installHint =
  '抽 PDF 需要 python + PyMuPDF。装一下：python -m pip install pymupdf（没装 Python 的话先装 Python 3）'

/** 用 python + PyMuPDF 抽正文；失败给出能照着做的错误。 */
export const extractPdfText = async (file: string, options: PdfOptions = {}): Promise<string> => {
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? DEFAULT_PDF_TIMEOUT_MS))
  const candidates = pythonCandidates(options.python)
  let missingPython = true
  let moduleMissing = false

  for (const argv of candidates) {
    const outcome = await runOnce(argv[0], [...argv.slice(1), '-c', PYTHON_SCRIPT, file], timeoutMs)

    if (outcome.missing) continue

    missingPython = false

    if (outcome.timedOut) {
      throw new Error(
        `PDF 抽取超时（${String(Math.round(timeoutMs / 1000))} 秒）：文件可能太大，或 PyMuPDF 卡住了`,
      )
    }

    if (outcome.code === 0) return outcome.stdout

    if (outcome.code === 3) {
      moduleMissing = true

      continue
    }

    const detail = outcome.stderr.trim().replace(/^OPEN_FAILED:\s*/, '')

    throw new Error(`PDF 打不开：${detail === '' ? `python 退出码 ${String(outcome.code)}` : detail}`)
  }

  if (missingPython) throw new PdfToolMissingError(`没找到可用的 python。${installHint}`)
  if (moduleMissing) throw new PdfToolMissingError(`python 里没有 PyMuPDF。${installHint}`)

  throw new PdfToolMissingError(`PDF 抽取失败。${installHint}`)
}

const bodyOf = (text: string): string => text.replace(/\[第 \d+ 页\]/g, '').replace(/\s+/g, '')

/**
 * 打开一本 PDF，拿到纯文本。
 *
 * - 有缓存（路径 + mtime + size 没变）就直接读，不再 spawn python；
 * - 抽出来太短 → 当作没有文字层（扫描件 / 图片漫画），**不写缓存**，报可读错误。
 */
export const readPdfText = async (file: string, options: PdfOptions = {}): Promise<PdfText> => {
  const cacheDir = options.cacheDir ?? defaultPdfCacheDir()
  const useCache = options.useCache !== false
  const minChars = Math.max(0, Math.floor(options.minTextChars ?? MIN_PDF_TEXT_CHARS))
  const key = pdfCacheKey(file)
  const cacheFile = join(cacheDir, `${key}.txt`)

  if (useCache && existsSync(cacheFile)) {
    try {
      const text = readFileSync(cacheFile, 'utf8')

      if (bodyOf(text).length >= minChars) return { text, cached: true, cacheFile, key }
    } catch {
      // 缓存坏了就重抽
    }
  }

  const extractor = injected ?? extractPdfText
  const text = await extractor(file, { ...options, minTextChars: minChars })

  if (bodyOf(text).length < minChars) {
    // 扫描件 / 图片漫画：没有文字层。别把空缓存写进去。
    throw new PdfNoTextError('这本没有文字层（可能是扫描件或图片漫画），没法按文字读')
  }

  try {
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(cacheFile, text, 'utf8')
  } catch {
    // 缓存写不进去只影响下次快不快，这一轮照样能读
  }

  return { text, cached: false, cacheFile, key }
}
