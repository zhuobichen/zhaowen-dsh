// 书库索引：把本机散在几个目录里的书扫成一张表。
//
// 三件事必须一直成立：
//   1. **有上限**——Downloads 里有上千个文件，扫描不能把宿主进程卡住；
//   2. **有缓存**——一次请求不值得再扫一遍全盘；
//   3. **标题能读**——z-library 的文件名带一长串尾巴，标题要洗干净。

import { createHash } from 'node:crypto'
import { readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

/** 能直接读的几种。 */
export type BookKind = 'txt' | 'md' | 'epub' | 'pdf'

export interface LibraryBook {
  /** 稳定的短 id；客户端拿它当 key，换路径就会换 id。 */
  id: string
  /** 原文件名（含后缀），搜索要按它匹配。 */
  name: string
  /** 洗干净、给人看的短标题。 */
  title: string
  kind: BookKind
  /** 所在目录。 */
  dir: string
  /** 绝对路径；客户端用它发 `open-path`。 */
  path: string
  /** 字节数。 */
  size: number
}

export interface SkippedBook {
  name: string
  path: string
  kind: string
  /** 为什么不在书库里——直接给用户看。 */
  reason: string
}

export interface LibraryIndex {
  books: LibraryBook[]
  skipped: SkippedBook[]
  /** 扫了哪些根目录。 */
  roots: string[]
  /** 不存在的根目录：配置文件写错了能一眼看出来。 */
  missing: string[]
  /** 同名副本被折叠了几条。 */
  duplicates: number
  /** 被 exclude 规则挡掉的文件 / 目录数。 */
  excluded: number
  /** 撞到数量 / 深度 / 时间上限了吗。 */
  truncated: boolean
  /** 扫完的时刻（毫秒）。 */
  scannedAt: number
  /** 扫描耗时（毫秒）。 */
  tookMs: number
}

export interface ScanOptions {
  /** 根目录下最多再进几层目录。缺省 3。 */
  maxDepth?: number
  /** 最多收几本书。缺省 500。 */
  maxBooks?: number
  /** 最多看几个目录项（目录 + 文件都算）。缺省 20000。 */
  maxVisits?: number
  /** 扫描时间预算（毫秒）。缺省 2000。 */
  budgetMs?: number
  /**
   * 排除规则：正则或子串都行，匹配文件 / 目录名。缺省是一小串明显的垃圾
   * （简历、_raw、副本、~$）；不要指望靠它把论文和书分干净。
   */
  exclude?: string[]
}

export const LIMITS = {
  maxDepth: 3,
  maxBooks: 500,
  maxVisits: 20_000,
  budgetMs: 2_000,
} as const

/** 缺省排除：够用就好，故意保持很短。 */
export const DEFAULT_EXCLUDE = ['简历', '_raw', '副本', '~$'] as const

/** 一个名字命中排除规则吗：先按子串，再按正则（正则写坏了就当没有）。 */
export const isExcluded = (name: string, patterns: readonly string[]): boolean => {
  for (const pattern of patterns) {
    if (pattern === '') continue
    if (name.includes(pattern)) return true

    try {
      if (new RegExp(pattern, 'i').test(name)) return true
    } catch {
      // 不是合法正则，只按子串算
    }
  }

  return false
}

/** 索引缓存活多久：60 秒。 */
export const INDEX_TTL_MS = 60_000

/**
 * 缺省书库：本机现有的四个目录。
 *
 * 可以在 `cordis.patch.yml` 的插件条目里用 `config.library: [...]` 整份覆盖。
 */
export const defaultLibraryRoots = (): string[] => [
  'C:\\Users\\Administrator\\Downloads',
  'D:\\github_project\\ZhaoWen_GitHub维护\\ebook-library\\files',
  'D:\\github_project\\ZhaoWen_GitHub维护\\lingtai-reader\\books',
  'D:\\github_project\\ZhaoWen_GitHub维护\\lingtai-reader\\data\\text_cache',
]

/** 文件后缀 → 类型；不认识的返回 null。 */
export const kindOf = (name: string): BookKind | null => {
  const lower = name.toLowerCase()

  if (lower.endsWith('.txt')) return 'txt'
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'md'
  if (lower.endsWith('.epub')) return 'epub'
  if (lower.endsWith('.pdf')) return 'pdf'

  return null
}

/** 还是不支持的格式：记一条说明，让用户知道为什么不在列表里。 */
const UNSUPPORTED: { suffix: string; reason: string }[] = [
  { suffix: '.mobi', reason: 'MOBI 暂不支持：先转成 .epub 或 .txt 再放进书库' },
  { suffix: '.azw3', reason: 'AZW3 暂不支持：先转成 .epub 或 .txt 再放进书库' },
]

const unsupportedReason = (name: string): string | null => {
  const lower = name.toLowerCase()
  const found = UNSUPPORTED.find((entry) => lower.endsWith(entry.suffix))

  return found === undefined ? null : found.reason
}

// ---- 标题清洗 -----------------------------------------------------------

/** z-library 的尾巴：`(z-library.sk, 1lib.sk, z-lib.sk)`、`(Z-Library)` 之类。 */
const ZLIB_GROUP = /\s*[\(（\[【][^()（）\[\]【】]*z[\s_-]?lib(?:rary)?[^()（）\[\]【】]*[\)）\]】]/gi

/** 卷册标记：这类括注是标题的一部分，不能当作者删掉。 */
const VOLUME = /^(?:[上中下]|全.{0,4}[册卷]|第.{0,4}[卷部册集篇版]|卷.{0,3}|.{0,6}[册卷部集篇]|.{1,6}版)$/

/** 把全角括号换成半角，长度不变，方便按位置切片。 */
const evenBrackets = (text: string): string =>
  text.replace(/（/g, '(').replace(/）/g, ')').replace(/【/g, '[').replace(/】/g, ']')

/**
 * 末尾那一对括号从哪儿开始。
 *
 * 要认得出嵌套：`彩虹尽头 ((美)弗诺·文奇(Vernor Vinge)著)` 的末尾整段是一对
 * 外层括号，从最后一个字符往回数括号深度，第一次回到 0 的位置就是开头。
 */
export const trailingGroupStart = (text: string): number => {
  const even = evenBrackets(text)
  const last = even[even.length - 1]

  if (last !== ')' && last !== ']') return -1

  const close = last
  const open = close === ')' ? '(' : '['
  let depth = 0

  for (let index = even.length - 1; index >= 0; index -= 1) {
    if (even[index] === close) depth += 1
    else if (even[index] === open) {
      depth -= 1
      if (depth === 0) return index
    }
  }

  return -1
}

/**
 * 文件名 → 短标题。
 *
 * `白夜行 (东野圭吾) (z-library.sk, 1lib.sk, z-lib.sk).epub` → `白夜行`
 *
 * 顺序很重要：先摘 z-library 尾巴（它一定在最外层），再去掉 `= 英文名` 的副标题，
 * 最后才把末尾的（作者）括注一层层剥掉；卷册标记（`(上)`、`(第二部)`、`(白金版)`）
 * 保留，不然会把书名删掉一半。
 */
export const titleOf = (name: string): string => {
  let title = basename(name).replace(/\.(?:txt|md|markdown|epub|pdf)$/i, '')

  title = title.replace(ZLIB_GROUP, '').trim()

  // `当尼采哭泣 = When Nietzsche Wept`：中文名在前，副标题只是英文原名
  const equals = title.search(/\s+[=＝]\s+/)

  if (equals > 0) title = title.slice(0, equals).trim()

  for (let round = 0; round < 4; round += 1) {
    const start = trailingGroupStart(title)

    if (start < 0) break

    const inner = title.slice(start + 1, -1).trim()

    // 空括号、卷册标记：留着
    if (inner === '' || VOLUME.test(inner)) break

    title = title.slice(0, start).trim()
  }

  return title === '' ? basename(name) : title
}

// ---- 扫描 ---------------------------------------------------------------

/** 这些目录不进：隐藏目录、依赖、回收站之类的噪音。 */
const SKIP_DIRS = new Set(['node_modules', '$recycle.bin', 'system volume information'])

interface Walk {
  books: LibraryBook[]
  skipped: SkippedBook[]
  truncated: boolean
  visits: number
  seen: Set<string>
  duplicates: number
  excluded: number
  deadline: number
  options: Required<ScanOptions>
}

const idOf = (path: string): string => createHash('sha1').update(path).digest('hex').slice(0, 16)

const addBook = (walk: Walk, root: string, dir: string, name: string, kind: BookKind): void => {
  // 同名副本只留一条：ebook-library/files 与 lingtai-reader/books 是两份拷贝
  const key = name.toLowerCase()

  if (walk.seen.has(key)) {
    walk.duplicates += 1

    return
  }

  if (walk.books.length >= walk.options.maxBooks) {
    walk.truncated = true
    walk.seen.add(key)

    return
  }

  const path = join(dir, name)
  let size = 0

  try {
    size = statSync(path).size
  } catch {
    // 读不到大小不影响能不能打开；先按 0 记
  }

  walk.seen.add(key)
  walk.books.push({
    id: idOf(path),
    name,
    title: titleOf(name),
    kind,
    dir,
    path,
    size,
  })
}

const walkDir = (walk: Walk, root: string, dir: string, depth: number): void => {
  if (Date.now() >= walk.deadline || walk.truncated) {
    walk.truncated = true

    return
  }

  let entries: any[]

  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    walk.visits += 1

    if (walk.visits > walk.options.maxVisits || Date.now() >= walk.deadline) {
      walk.truncated = true

      return
    }

    const name = String(entry.name)

    if (entry.isDirectory()) {
      // 深度上限是设计好的边界，不算「被截断」
      if (depth >= walk.options.maxDepth) continue

      if (name.startsWith('.') || SKIP_DIRS.has(name.toLowerCase())) continue

      if (isExcluded(name, walk.options.exclude)) {
        walk.excluded += 1

        continue
      }

      walkDir(walk, root, join(dir, name), depth + 1)

      continue
    }

    if (!entry.isFile()) continue

    if (isExcluded(name, walk.options.exclude)) {
      walk.excluded += 1

      continue
    }

    const kind = kindOf(name)

    if (kind !== null) {
      addBook(walk, root, dir, name, kind)

      continue
    }

    // 有解析器的都收；真不支持的（mobi/azw3）记一条说明
    const reason = unsupportedReason(name)

    if (reason !== null) {
      walk.skipped.push({
        name,
        path: join(dir, name),
        kind: name.slice(name.lastIndexOf('.') + 1).toLowerCase(),
        reason,
      })
    }
  }
}

/** 扫一遍（不读正文，只 stat）。返回值里的 `scannedAt` 是这次扫描的时刻。 */
export const scanLibrary = (roots: readonly string[], options: ScanOptions = {}): LibraryIndex => {
  const started = Date.now()
  const resolved: Required<ScanOptions> = {
    maxDepth: Math.max(0, Math.floor(options.maxDepth ?? LIMITS.maxDepth)),
    maxBooks: Math.max(1, Math.floor(options.maxBooks ?? LIMITS.maxBooks)),
    maxVisits: Math.max(1, Math.floor(options.maxVisits ?? LIMITS.maxVisits)),
    budgetMs: Math.max(0, Math.floor(options.budgetMs ?? LIMITS.budgetMs)),
    exclude:
      options.exclude === undefined
        ? [...DEFAULT_EXCLUDE]
        : options.exclude.filter((pattern) => typeof pattern === 'string'),
  }
  const walk: Walk = {
    books: [],
    skipped: [],
    truncated: false,
    visits: 0,
    seen: new Set<string>(),
    duplicates: 0,
    excluded: 0,
    deadline: started + resolved.budgetMs,
    options: resolved,
  }
  const missing: string[] = []

  for (const root of roots) {
    let isDir = false

    try {
      isDir = statSync(root).isDirectory()
    } catch {
      missing.push(root)

      continue
    }

    if (!isDir) {
      missing.push(root)

      continue
    }

    walkDir(walk, root, root, 0)
  }

  walk.books.sort((left, right) => left.title.localeCompare(right.title, 'zh-Hans-CN'))
  walk.skipped.sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'))

  return {
    books: walk.books,
    skipped: walk.skipped,
    roots: [...roots],
    missing,
    duplicates: walk.duplicates,
    excluded: walk.excluded,
    truncated: walk.truncated,
    scannedAt: started,
    tookMs: Date.now() - started,
  }
}

/**
 * 带进程内缓存的书库索引。
 *
 * 每次 `get()` 只 stat 四个根目录（很便宜）：根目录的 mtime / 大小变了，或距上次
 * 扫描超过 60 秒，才重新扫。根目录**里面**新增文件不一定改根目录 mtime，所以还
 * 留了 `get(true)` 强制重建（`/library?refresh=1` 走这条）。
 */
export const createLibraryIndex = (roots: readonly string[], options: ScanOptions = {}) => {
  let cached: { stamp: string; at: number; index: LibraryIndex } | null = null

  const stampOf = (): string =>
    roots
      .map((root) => {
        try {
          const stat = statSync(root)

          return `${String(stat.mtimeMs)}:${String(stat.size)}`
        } catch {
          return 'missing'
        }
      })
      .join('|')

  const get = (force = false): LibraryIndex => {
    const stamp = stampOf()
    const now = Date.now()

    if (!force && cached !== null && cached.stamp === stamp && now - cached.at < INDEX_TTL_MS) {
      return cached.index
    }

    const index = scanLibrary(roots, options)

    cached = { stamp, at: now, index }

    return index
  }

  return { get, roots: [...roots] }
}

export type LibraryIndexCache = ReturnType<typeof createLibraryIndex>
