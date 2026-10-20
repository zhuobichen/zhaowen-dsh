// 月相与古诗，纯函数，不碰任何宿主 API——测试可以直接拿它算账。
//
// 相名不是用「平均朔望月」糊出来的：拿 2026 年 10 月的四个相时刻去对，经典
// 平均公式最大差到 −0.72 天（近 17 小时），两参数拟合也压不到 0.75 天以下，
// 因为月亮走得本来就不匀。所以这里用**相时刻表 + 相邻两点线性插值**。
//
// 月龄也不是「相位占比 × 平均月长」，而是**距上一次新月的真实天数**——这个数
// 任何人都能拿农历日期自己核，必须对得上。

/**
 * 相时刻，北京时间（UTC+8），来源：StarWalk 月相日历 + 香港天文學會 2026 年月相表
 * （两处一致，差 ±1 分钟）。
 *
 * **严格四相轮转**：相邻两项相差一个四分相，间隔 6.7–8.2 天（有测试盯着）。
 * 不能只加一项、不能乱序：插值把它们当成均匀的四分相，新月靠「从第一项起每第四项」定位。
 */
const INSTANTS = [
  1791033900000, // 2026-10-03 21:25 下弦
  1791647400000, // 2026-10-10 23:50 新月（农历九月初一）
  1792339920000, // 2026-10-19 00:12 上弦
  1792987860000, // 2026-10-26 12:11 满月（猎人月）
  1793564880000, // 2026-11-02 04:28 下弦
  1794207720000, // 2026-11-09 15:02 新月
  1794916080000, // 2026-11-17 19:48 上弦
  1795531980000, // 2026-11-24 22:53 满月（超级海狸月）
  1796134080000, // 2026-12-01 22:08 下弦
  1796777520000, // 2026-12-09 08:52 新月
  1797486180000, // 2026-12-17 13:43 上弦
  1798075680000, // 2026-12-24 09:28 满月（2026 最后一次超级月亮）
  1798657140000, // 2026-12-31 02:59 下弦
]

/** 表从哪一相开始：下弦，也就是一个周期的 0.75。 */
const FIRST_PHASE = 0.75

/** 平均四分相长度：表外用它的步长。 */
const QUARTER_MS = (29.530588853 / 4) * 86_400_000

const MEAN_MONTH_DAYS = 29.530588853
const DAY_MS = 86_400_000

/** 一句诗占多久：一分钟（同一分钟内不换，画面之间跳句没法读）。 */
export const POEM_SLOT_MS = 60_000

export type Moon = {
  /** 处在周期的哪一段：0 新月、0.5 满月、1 下一个新月。 */
  fraction: number
  /** 距上一次新月的天数——农历会给出的那个数。 */
  ageDays: number
  /** 相名。 */
  name: string
  /** 一个 emoji；八个正好走完一轮。 */
  glyph: string
  /** 表外估计时 true。 */
  isEstimated: boolean
}

const NAMES = ['新月', '娥眉月', '上弦月', '盈凸月', '满月', '亏凸月', '下弦月', '残月']
const GLYPHS = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘']

/** 这个时刻之前最近的一次新月（表里有的），没有就 null。 */
const newMoonBefore = (nowMs: number): number | null => {
  let found: number | null = null

  // 新月是每第四项，且表从下弦开头
  for (let i = 1; i < INSTANTS.length; i += 4) {
    if (INSTANTS[i] <= nowMs) found = INSTANTS[i]
  }

  return found
}

/** 表内按插值算，表外承认自己在估。 */
export const moonAt = (nowMs: number): Moon => {
  const first = INSTANTS[0]
  const last = INSTANTS[INSTANTS.length - 1]

  let fraction: number
  let isEstimated = false

  if (nowMs < first) {
    fraction = FIRST_PHASE - (first - nowMs) / QUARTER_MS / 4
    isEstimated = true
  } else if (nowMs > last) {
    fraction = FIRST_PHASE + (INSTANTS.length - 1) / 4 + (nowMs - last) / QUARTER_MS / 4
    isEstimated = true
  } else {
    let i = 0

    // 停在倒数第二项之前：最后一段的终点是表的末尾，再问就越界了
    while (i < INSTANTS.length - 2 && INSTANTS[i + 1] <= nowMs) i += 1

    const span = INSTANTS[i + 1] - INSTANTS[i]
    const through = (nowMs - INSTANTS[i]) / span

    fraction = FIRST_PHASE + (i + through) / 4
  }

  const wrapped = ((fraction % 1) + 1) % 1
  // 取最近的那个相名；`min` 挡住「残月」向上取整越界成新月
  const octant = Math.min(7, Math.floor(wrapped * 8 + 0.5))

  // 距上次新月的天数。用经过的时间，不用平均月长的占比：这个朔望月偏长，
  // 占比算法会少报三分之一天。过了表里最后一个新月，表就不知道下一次了，
  // 超过 30 天的那段改回占比估计。
  const newMoon = newMoonBefore(nowMs)
  const sinceNewMoon = newMoon === null ? null : (nowMs - newMoon) / DAY_MS
  const isAgeTrue = sinceNewMoon !== null && sinceNewMoon < 30

  return {
    fraction: wrapped,
    ageDays: isAgeTrue ? (sinceNewMoon as number) : wrapped * MEAN_MONTH_DAYS,
    name: NAMES[octant],
    glyph: GLYPHS[octant],
    isEstimated,
  }
}

/** 一句诗和它的出处。 */
export type Poem = { line: string; from: string }

/**
 * 语料读不到时的兜底：八句名句，各带出处。有几首只是一句，出处是那一首诗的。
 */
export const POEMS: Poem[] = [
  { line: '今人不见古时月，今月曾经照古人。', from: '李白《把酒问月》' },
  { line: '举杯邀明月，对影成三人。', from: '李白《月下独酌》' },
  { line: '海上生明月，天涯共此时。', from: '张九龄《望月怀远》' },
  { line: '江畔何人初见月？江月何年初照人？', from: '张若虚《春江花月夜》' },
  { line: '举头望明月，低头思故乡。', from: '李白《静夜思》' },
  { line: '深林人不知，明月来相照。', from: '王维《竹里馆》' },
  { line: '人有悲欢离合，月有阴晴圆缺，此事古难全。', from: '苏轼《水调歌头》' },
  { line: '嫦娥应悔偷灵药，碧海青天夜夜心。', from: '李商隐《嫦娥》' },
]

/**
 * 随包分发的语料：每行 `诗句<TAB>出处`。空行、只给一半的行直接丢掉——不画成
 * 谜语。重复的句子也丢：一轮承诺不重复，同一句出现两次就破了这个承诺。
 */
export const poemsOf = (text: string): Poem[] => {
  const seen = new Set<string>()
  const poems: Poem[] = []

  for (const raw of text.split('\n')) {
    const [line, from] = raw.trim().split('\t')

    if (!line || !from) continue
    if (seen.has(line)) continue

    seen.add(line)
    poems.push({ line, from })
  }

  return poems
}

/** 一个小的非负整型哈希，用来给一轮播种。 */
const hashOf = (value: number): number => {
  let x = Math.imul(value, 2654435761) >>> 0

  x ^= x >>> 15
  x = Math.imul(x, 2246822519) >>> 0
  x ^= x >>> 13

  // 回到无符号：`^` 给的是有符号 32 位，负数会索引到列表前面去
  return x >>> 0
}

const greatestCommonDivisor = (a: number, b: number): number => {
  let x = a
  let y = b

  while (y !== 0) [x, y] = [y, x % y]

  return x
}

/**
 * 一个与语料长度互质的步长，走遍整个语料才会回头。跳过 1：步长 1 就是文件
 * 原顺序，那不算打乱。
 */
const stepFor = (seed: number, count: number): number => {
  let step = 1 + 2 * (hashOf(seed) % Math.floor(count / 2))

  while (greatestCommonDivisor(step, count) !== 1 || step % count === 1) step += 2

  return step
}

/**
 * 某个格子取第几句：**整个语料走一轮**，走完之前不重复——线性同余，只记步长和起点。
 *
 * `step` 与 `count` 互质，所以 `(step * i + offset) mod count` 是个双射：前
 * `count` 格恰好把每一句取一次、顺序看着像打乱的。每轮重新播种，所以下一轮是
 * 另一种顺序，不是同一轮重播。
 */
export const poemIndexAt = (slot: number, count: number): number => {
  if (count <= 1) return 0

  const cycle = Math.floor(slot / count)
  const step = stepFor(cycle + 1, count)
  const offset = hashOf(cycle) % count

  return (step * ((slot % count) + offset)) % count
}

/**
 * 这一分钟的那句：同一格内不变，一轮之内不与上一格相同，一轮之后换一种顺序。
 */
export const poemAt = (nowMs: number, corpus: Poem[] = POEMS): Poem => {
  const poems = corpus.length > 0 ? corpus : POEMS
  const slot = Math.floor(nowMs / POEM_SLOT_MS)

  return poems[poemIndexAt(slot, poems.length)]
}

/** 提示框上方那一行。 */
export const lineOf = (nowMs: number, corpus: Poem[] = POEMS): string => {
  const moon = moonAt(nowMs)
  const poem = poemAt(nowMs, corpus)

  return `${moon.isEstimated ? '≈' : ''}${moon.glyph} ${moon.name} ${moon.ageDays.toFixed(1)}天 · 「${poem.line}」${poem.from}`
}

/** 表本身，给「是不是严格四相轮转」那条测试用。 */
export const instantsOf = (): readonly number[] => INSTANTS

/**
 * `李白《把酒问月》` → `{ author: '李白', title: '把酒问月' }`；没有篇名时 title 为 null。
 *
 * 语料里出处一律是这个形状（作者 + 《篇名》），但「出处不详」这类没有书名号，
 * 那就整串当作者。
 */
export const sourceParts = (from: string): { author: string; title: string | null } => {
  const open = from.indexOf('《')
  const close = from.lastIndexOf('》')

  if (open <= 0 || close <= open) return { author: from.trim(), title: null }

  return { author: from.slice(0, open).trim(), title: from.slice(open + 1, close).trim() }
}

