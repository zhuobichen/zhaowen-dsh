// EPUB 的最小实现：自己读 ZIP、自己走 OPF + spine、自己去标签。
//
// 不引依赖：ZIP 只需要「读中央目录 → 定位本地头 → inflateRaw」三步，Node 的
// `zlib` 已经给了后半步；EPUB 的包装（container.xml → OPF → spine）也就是两份
// 正则能读的 XML。抽出来的正文按 `路径 + mtime + size` 缓存到磁盘，第二次打开
// 直接读缓存。

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, posix } from 'node:path'
import { inflateRawSync } from 'node:zlib'

/** ZIP 条目（只留我们真用得到的字段）。 */
export interface ZipEntry {
  name: string
  /** 0 = stored，8 = deflate。 */
  method: number
  /** 通用标志位；bit 0 = 加密，bit 11 = 文件名是 UTF-8。 */
  flags: number
  compressedSize: number
  uncompressedSize: number
  /** 本地文件头在 buf 里的偏移。 */
  offset: number
}

/** 单条解压上限：一章 XHTML 不会有 24 MB。 */
const MAX_ENTRY_BYTES = 24 * 1024 * 1024

/** 正文总长上限（字符），防止恶意 epub 撑爆内存。 */
const MAX_TEXT_CHARS = 12 * 1024 * 1024

class EpubError extends Error {}

const fail = (message: string): never => {
  throw new EpubError(message)
}

/** 把一段文件名 bytes 解码：UTF-8 优先，不行再按 GBK 试。 */
export const decodeEntryName = (bytes: Buffer): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // 老式中文 ZIP 用的是 GBK；ICU 全量构建支持，没有就退到 latin1
  }

  try {
    return new TextDecoder('gbk').decode(bytes)
  } catch {
    return bytes.toString('latin1')
  }
}

const findEocd = (buf: Buffer): number => {
  const lowest = Math.max(0, buf.length - 22 - 0xffff)

  for (let at = buf.length - 22; at >= lowest; at -= 1) {
    if (buf.readUInt32LE(at) === 0x06054b50) return at
  }

  return -1
}

/** 读中央目录。返回按出现顺序排的条目。 */
export const readZipEntries = (buf: Buffer): ZipEntry[] => {
  if (buf.length < 22) fail('EPUB 打不开：文件太小，不是有效的 ZIP')

  const eocd = findEocd(buf)

  if (eocd < 0) fail('EPUB 打不开：不是有效的 ZIP（找不到中央目录）')

  const count = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)

  if (count === 0xffff || cdOffset === 0xffffffff) fail('EPUB 打不开：暂不支持 ZIP64')

  if (cdOffset >= buf.length) fail('EPUB 打不开：中央目录越界（文件被截断了？）')

  const entries: ZipEntry[] = []
  let at = cdOffset

  for (let index = 0; index < count; index += 1) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) {
      fail('EPUB 打不开：中央目录损坏')
    }

    const flags = buf.readUInt16LE(at + 8)
    const method = buf.readUInt16LE(at + 10)
    const compressedSize = buf.readUInt32LE(at + 20)
    const uncompressedSize = buf.readUInt32LE(at + 24)
    const nameLength = buf.readUInt16LE(at + 28)
    const extraLength = buf.readUInt16LE(at + 30)
    const commentLength = buf.readUInt16LE(at + 32)
    const offset = buf.readUInt32LE(at + 42)
    const name = decodeEntryName(buf.subarray(at + 46, at + 46 + nameLength))

    entries.push({ name, method, flags, compressedSize, uncompressedSize, offset })
    at += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

/** 把一条条目解出来；加密的条目直接报错。 */
export const readZipEntry = (buf: Buffer, entry: ZipEntry): Buffer => {
  if ((entry.flags & 0x0001) !== 0) fail(`EPUB 已加密（DRM），读不了：${entry.name}`)
  if (entry.offset + 30 > buf.length || buf.readUInt32LE(entry.offset) !== 0x04034b50) {
    fail(`EPUB 打不开：本地文件头损坏（${entry.name}）`)
  }

  const nameLength = buf.readUInt16LE(entry.offset + 26)
  const extraLength = buf.readUInt16LE(entry.offset + 28)
  const start = entry.offset + 30 + nameLength + extraLength
  const end = start + entry.compressedSize

  if (end > buf.length) fail(`EPUB 打不开：数据被截断（${entry.name}）`)
  if (entry.uncompressedSize > MAX_ENTRY_BYTES) fail(`EPUB 打不开：条目太大（${entry.name}）`)

  const raw = buf.subarray(start, end)

  if (entry.method === 0) return raw
  if (entry.method === 8) return inflateRawSync(raw)

  return fail(`EPUB 打不开：不认识的压缩方式 ${String(entry.method)}（${entry.name}）`)
}

/** 一个打开着的 EPUB：按小写名字查条目。 */
export const openEpub = (buf: Buffer) => {
  const entries = readZipEntries(buf)
  const byName = new Map<string, ZipEntry>()

  for (const entry of entries) byName.set(entry.name.toLowerCase(), entry)

  const find = (name: string): ZipEntry | undefined => byName.get(name.toLowerCase())

  const has = (name: string): boolean => find(name) !== undefined

  const text = (name: string): string => {
    const entry = find(name)

    if (entry === undefined) fail(`EPUB 打不开：缺 ${name}`)

    const raw = readZipEntry(buf, entry)

    return raw.toString('utf8').replace(/^\uFEFF/, '')
  }

  return { entries, has, find, text }
}

// ---- XHTML → 纯文本 -----------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  times: '×',
  divide: '÷',
  laquo: '«',
  raquo: '»',
}

/** `&amp;` / `&#20013;` / `&#x4e2d;` → 字符；认不得的原样留着。 */
export const decodeEntities = (text: string): string =>
  text.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10)

      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole

      try {
        return String.fromCodePoint(code)
      } catch {
        return whole
      }
    }

    const named = NAMED_ENTITIES[body.toLowerCase()]

    return named === undefined ? whole : named
  })

/** 一段 XHTML → 每段一行的纯文本。 */
export const htmlToText = (html: string): string => {
  let text = html

  // head 里全是标题 / 样式，不算正文
  text = text.replace(/<head\b[\s\S]*?<\/head>/gi, '')
  text = text.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
  text = text.replace(/<!--[\s\S]*?-->/g, '')
  // <br> 是换行，块级标签结束也算换行
  text = text.replace(/<\s*br\s*\/?>/gi, '\n')
  text = text.replace(/<\s*hr\b[^>]*>/gi, '\n')
  text = text.replace(
    /<\/\s*(?:p|div|h[1-6]|li|tr|section|article|blockquote|pre|dd|dt|figcaption|table|ul|ol|header|footer)\s*>/gi,
    '\n',
  )
  text = text.replace(/<[^>]+>/g, '')
  text = decodeEntities(text)

  // 每行去首尾空白、行内多余空白压成一个空格；空行不留（段落本身就是一行）
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n')
}

// ---- OPF / spine --------------------------------------------------------

/** 从标签串里取一个属性值（单双引号都认）。 */
export const attrOf = (tag: string, name: string): string | null => {
  const matched = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))

  if (matched === null) return null

  return matched[1] !== undefined ? matched[1] : matched[2]
}

/** OPF 里的 href 是相对 OPF 自己的；解 %XX，再规范化。 */
export const resolveHref = (opfPath: string, href: string): string => {
  const bare = href.split('#')[0].split('?')[0]
  let decoded = bare

  try {
    decoded = decodeURIComponent(bare)
  } catch {
    // 不是合法转义就按原样
  }

  return posix.normalize(posix.join(posix.dirname(opfPath), decoded)).replace(/^\.\//, '')
}

interface ManifestItem {
  id: string
  href: string
  mediaType: string
  path: string
}

const spineOf = (opf: string, opfPath: string): { items: ManifestItem[]; spine: string[] } => {
  const items: ManifestItem[] = []

  for (const matched of opf.matchAll(/<item\b[^>]*>/gi)) {
    const tag = matched[0]
    const id = attrOf(tag, 'id')
    const href = attrOf(tag, 'href')

    if (id === null || href === null) continue

    items.push({
      id,
      href,
      mediaType: attrOf(tag, 'media-type') ?? '',
      path: resolveHref(opfPath, href),
    })
  }

  const spine: string[] = []

  for (const matched of opf.matchAll(/<itemref\b[^>]*>/gi)) {
    const idref = attrOf(matched[0], 'idref')

    if (idref !== null) spine.push(idref)
  }

  return { items, spine }
}

const looksLikeDocument = (item: ManifestItem): boolean =>
  /xhtml|html/i.test(item.mediaType) || /\.x?html?$/i.test(item.path)

/** 从 container.xml 找 OPF 的路径。 */
const opfPathOf = (epub: ReturnType<typeof openEpub>): string => {
  if (!epub.has('META-INF/container.xml')) {
    // 有些老包没有 container.xml，退一步按惯例找
    const guessed = epub.entries.find((entry) => entry.name.toLowerCase().endsWith('.opf'))

    if (guessed !== undefined) return guessed.name

    return fail('EPUB 打不开：缺 META-INF/container.xml，也找不到 .opf')
  }

  const xml = epub.text('META-INF/container.xml')
  const matched = xml.match(/<rootfile\b[^>]*>/i)
  const fullPath = matched === null ? null : attrOf(matched[0], 'full-path')

  if (fullPath === null || fullPath.trim() === '') {
    return fail('EPUB 打不开：container.xml 里没有 rootfile')
  }

  return decodeEntities(fullPath).replace(/\\/g, '/')
}

/** 有加密清单、而且加密的正是正文：DRM。只加密字体（常见混淆）不算。 */
const assertReadable = (epub: ReturnType<typeof openEpub>): void => {
  if (!epub.has('META-INF/encryption.xml')) return

  const xml = epub.text('META-INF/encryption.xml')

  if (/\.(?:x?html?)\b/i.test(xml)) fail('EPUB 已加密（DRM），读不了')
}

/** 抽正文：spine 顺序 → 每章 XHTML → 纯文本。 */
export const extractEpubText = (buf: Buffer): string => {
  const epub = openEpub(buf)

  assertReadable(epub)

  const opfPath = opfPathOf(epub)
  const opf = epub.text(opfPath)
  const { items, spine } = spineOf(opf, opfPath)
  const byId = new Map(items.map((item) => [item.id, item]))

  // spine 说了算；spine 空的包退到 manifest 里文档的出现顺序
  const ordered: ManifestItem[] =
    spine.length > 0
      ? spine.map((idref) => byId.get(idref)).filter((item): item is ManifestItem => item !== undefined)
      : items.filter(looksLikeDocument)

  // spine 里的 idref 全对不上：也退到 manifest，别静默给一本空书
  const documents =
    ordered.length > 0 ? ordered.filter(looksLikeDocument) : items.filter(looksLikeDocument)

  if (documents.length === 0) fail('EPUB 里没有可读的 XHTML（spine 是空的）')

  const chapters: string[] = []
  let budget = MAX_TEXT_CHARS

  for (const document of documents) {
    if (!epub.has(document.path)) continue

    const chapter = htmlToText(epub.text(document.path))

    if (chapter === '') continue

    chapters.push(chapter)
    budget -= chapter.length

    if (budget <= 0) break
  }

  if (chapters.length === 0) fail('EPUB 里没有任何正文（XHTML 都是空的？）')

  return chapters.join('\n\n')
}

// ---- 磁盘缓存 -----------------------------------------------------------

/** `$DSH_HOME/plugins/dsh-novel-pane/text/`。 */
export const defaultTextCacheDir = (): string =>
  join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'plugins', 'dsh-novel-pane', 'text')

/** 缓存键：路径 + mtime + size。文件一改，键就变。 */
export const epubCacheKey = (file: string): string => {
  const stat = statSync(file)

  return createHash('sha1')
    .update(`${file}|${String(stat.mtimeMs)}|${String(stat.size)}`)
    .digest('hex')
}

export interface EpubText {
  text: string
  /** 这次是从磁盘缓存读的吗。 */
  cached: boolean
  cacheFile: string
  key: string
}

export interface EpubTextOptions {
  /** 缓存目录；缺省 `$DSH_HOME/plugins/dsh-novel-pane/text`。 */
  cacheDir?: string
  /** 关掉缓存（测试 / 排错用）。 */
  useCache?: boolean
}

/** 打开一本 EPUB，拿到纯文本；第二次走磁盘缓存。 */
export const readEpubText = (file: string, options: EpubTextOptions = {}): EpubText => {
  const cacheDir = options.cacheDir ?? defaultTextCacheDir()
  const useCache = options.useCache !== false
  const key = epubCacheKey(file)
  const cacheFile = join(cacheDir, `${key}.txt`)

  if (useCache && existsSync(cacheFile)) {
    try {
      const text = readFileSync(cacheFile, 'utf8')

      if (text !== '') return { text, cached: true, cacheFile, key }
    } catch {
      // 缓存坏了就重抽
    }
  }

  let buffer: Buffer

  try {
    buffer = readFileSync(file)
  } catch (error) {
    return fail(`EPUB 打不开：${(error as Error).message}`)
  }

  const text = extractEpubText(buffer)

  try {
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(cacheFile, text, 'utf8')
  } catch {
    // 缓存写不进去只影响下次快不快，这一轮照样能读
  }

  return { text, cached: false, cacheFile, key }
}

export { EpubError }
