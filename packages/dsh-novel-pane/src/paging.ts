// 读书本身：折行、分页、位置、书单——纯函数，不碰宿主 API，测试可以直接按住。
//
// 和 Claude Code 版一样按「行」记账：位置是**窗口顶行**的序号，不是像素。
// 浏览器里滚动的像素会随字号、窗口宽度变，行不会。

/** 一页至少一行。 */
const rowsOf = (rows: number): number => Math.max(1, Math.floor(rows))

/** 宽字符区间：终端里一个汉字占两格，按码点折行会让每两行溢出一次。 */
const WIDE = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
]

/** 一个字符占几格。 */
export const cellsOf = (character: string): number => {
  const point = character.codePointAt(0) ?? 0

  return WIDE.some(([from, to]) => point >= from && point <= to) ? 2 : 1
}

/** 一个字符串占几格。 */
export const widthOf = (text: string): number =>
  [...text].reduce((cells, character) => cells + cellsOf(character), 0)

/**
 * 把正文折成每行不超过 `columns` 格。段落保留，空行保留（小说的分段是节奏的
 * 一半），不为了让行对齐而凭空补字。
 */
export const wrapText = (text: string, columns: number): string[] => {
  // 用给它的宽度，不偷偷换成「舒服的宽度」：给窄了就该溢出，而不是被静默修好
  const width = Math.max(1, Math.floor(columns))
  const lines: string[] = []

  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (paragraph.trim() === '') {
      lines.push('')

      continue
    }

    let line = ''
    let used = 0

    for (const character of paragraph) {
      const cells = cellsOf(character)

      if (used + cells > width && line !== '') {
        lines.push(line)
        line = ''
        used = 0
      }

      line += character
      used += cells
    }

    lines.push(line)
  }

  return lines
}

/** 从 `line` 起的一页，`rows` 行。 */
export const pageOf = (lines: string[], line: number, rows: number): string[] =>
  lines.slice(line, line + Math.max(1, Math.floor(rows)))

/** 最后一页的顶行：再往下就滚进空白了。 */
export const lastLineOf = (total: number, rows: number): number =>
  Math.max(0, total - Math.max(1, Math.floor(rows)))

/** 位置：第几页、百分之几。 */
export const progressOf = (line: number, rows: number, total: number): string => {
  const perPage = Math.max(1, Math.floor(rows))
  const pages = Math.max(1, Math.ceil(total / perPage))
  const page = Math.min(pages, Math.floor(line / perPage) + 1)
  const percent = total === 0 ? 100 : Math.min(100, Math.round(((line + perPage) / total) * 100))

  return `第 ${page}/${pages} 页 · ${percent}%`
}

/** 窗格里那行控件占的行数。 */
export const HEADER_ROWS = 1

/** 窗格 `rows` 行里正文能占的行数。 */
export const textRowsOf = (rows: number): number => Math.max(1, rowsOf(rows) - HEADER_ROWS)

/** 从 `line` 起的一屏正文。 */
export const windowOf = (lines: string[], line: number, rows: number): string[] =>
  pageOf(lines, line, textRowsOf(rows))

/** 读到了哪里，用行说。 */
export const readoutOf = (seen: number, total: number): string => {
  if (total <= 0) return '读到 100%'

  const line = Math.min(Math.max(0, seen) + 1, total)
  const percent = Math.min(100, Math.round((line / total) * 100))

  return `读到 ${percent}%　第 ${line}/${total} 行`
}

/** 怎么读：卷轴（一格一格走）还是整屏（一次一屏）。 */
export type Mode = 'scroll' | 'page'

export const MODES: readonly Mode[] = ['scroll', 'page']

export const modeOf = (raw: unknown): Mode => (raw === 'page' ? 'page' : 'scroll')

export const modeNameOf = (mode: Mode): string => (mode === 'scroll' ? '卷轴' : '整屏')

/** 窗格第一行那排按钮。 */
export const BUTTONS = [
  { key: 'mode', label: '⇄ 卷轴' },
  { key: 'up', label: '↑' },
  { key: 'down', label: '↓' },
  { key: 'top', label: '⌂' },
  { key: 'close', label: '✕' },
] as const

/** 按钮上写什么；模式键写它当前所在的模式。 */
export const labelOf = (button: (typeof BUTTONS)[number], mode: Mode): string =>
  button.key === 'mode' ? `⇄ ${modeNameOf(mode)}` : button.label

/** 读到哪了，尽量短。 */
export const positionOf = (seen: number, rows: number, total: number, mode: Mode): string => {
  const lines = Math.max(1, total)

  return mode === 'scroll'
    ? `${String(Math.min(Math.max(0, seen) + 1, lines))}/${String(lines)}`
    : progressOf(seen, rows, total)
}

/** 一屏是几行。 */
export const screenOf = (rows: number): number => Math.max(1, Math.floor(rows))

/** 这个词是不是在说位置，而不是文件名。 */
export const isStepOf = (word: string): boolean => /^(n|next|p|prev|read|\d+)$/i.test(word.trim())

/**
 * `/novel` 后面那个词把位置挪到哪：下一页、上一页、第 N 页，或者 `read` 原地。
 * 不是位置的词（比如路径）返回 null。
 */
export const steppedBy = (word: string, line: number, rows: number, total: number): number | null => {
  const asked = word.trim().toLowerCase()
  const land = (next: number): number => Math.min(lastLineOf(total, rows), Math.max(0, next))

  if (asked === 'read') return line
  if (/^\d+$/.test(asked)) return land((Number(asked) - 1) * rowsOf(rows))
  if (asked === 'n' || asked === 'next') return land(line + rowsOf(rows))
  if (asked === 'p' || asked === 'prev') return land(line - rowsOf(rows))

  return null
}

/** `/novel n` 打印出来的那一页，末尾附上怎么翻页。 */
export const PRINT_HINT =
  '↑ 回车 = 下一页 · `/novel n` 下一页 · `/novel p` 上一页 · `/novel 12` 跳到第 12 页'

export const printedOf = (lines: string[], line: number, rows: number): string => {
  const page = pageOf(lines, line, rows)

  return [...page, '', `${progressOf(line, rows, lines.length)}　${PRINT_HINT}`].join('\n')
}

// ---- 书单 ---------------------------------------------------------------

/** 这个读者能显示的书：这些后缀。 */
const BOOK_SUFFIXES = ['.txt', '.md', '.markdown', '.text', '.log']

export const bookFilesOf = (entries: readonly { name: string; kind: string }[]): string[] =>
  entries
    .filter(
      (entry) =>
        entry.kind === 'file' &&
        BOOK_SUFFIXES.some((suffix) => entry.name.toLowerCase().endsWith(suffix)),
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))

/** 书单从哪开始，最后一页才不空。 */
export const shelfTopOf = (count: number, rows: number): number =>
  Math.max(0, count - Math.max(1, Math.floor(rows)))

/** 书单某一页。 */
export const shelfWindowOf = (names: readonly string[], at: number, rows: number): string[] =>
  names.slice(Math.max(0, at), Math.max(0, at) + Math.max(1, Math.floor(rows)))

/** 一本书在书单里的一行：有读到的位置就带个点。 */
export const shelfLabelOf = (name: string, hasPlace: boolean): string => (hasPlace ? `• ${name}` : name)

/** 按格子预算截断，截了加省略号。 */
export const clipTo = (text: string, budget: number): string => {
  if (widthOf(text) <= budget) return text

  const room = Math.max(0, Math.floor(budget) - 1)
  let kept = ''
  let used = 0

  for (const character of text) {
    const gap = cellsOf(character)

    if (used + gap > room) break

    kept += character
    used += gap
  }

  return `${kept}…`
}

/** `/novel list` 打的一行：书单里有什么。 */
export const shelfPrintOf = (dir: string, names: readonly string[], most = 20): string => {
  if (names.length === 0) return `书单 ${dir}：没有能读的文件`

  const shown = names.slice(0, Math.max(1, most))
  const rest = names.length - shown.length
  const tail = rest > 0 ? ` …（还有 ${String(rest)} 本）` : ''

  return `书单 ${dir}（${String(names.length)} 本）：${shown.join('、')}${tail}`
}
