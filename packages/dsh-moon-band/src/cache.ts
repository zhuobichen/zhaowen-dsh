/**
 * 诗的「详解」缓存。
 *
 * 用户点开一首诗的详解时要问 AI：朝代、年份、诗意、创作背景。同一首诗第二次
 * 出现**不该再问一次**——所以结果按「诗句」为键落到磁盘上，下次直接读。
 *
 * 落盘位置：`<dataDir>/poems-cache.json`，默认 `<包>/data/`。
 * 也可以配置 `cachePath` 指到别处（例如 `DSH_HOME` 下），避免写进只读的安装目录。
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** 一首诗的详解。 */
export type PoemAbout = {
  /** 朝代，如 `唐`。AI 拿不准时可为 null。 */
  dynasty: string | null
  /** 年份或生卒/创作年代，如 `约唐玄宗开元十三年（725）`。 */
  year: string | null
  /** 这一句（这几句）的意思。 */
  meaning: string
  /** 作者写这首诗时的处境与缘由。 */
  background: string
  /** 写入时间（毫秒），用于排查与将来过期。 */
  atMs: number
}

/** 缓存文件形状：版本 + 按诗句为键的条目。 */
type CacheFile = {
  version: 1
  poems: Record<string, PoemAbout>
}

const keyOf = (line: string): string => line.trim()

/**
 * 一个纯内存 + 落盘的缓存。
 *
 * 读失败（文件不存在、坏 JSON）都当作空缓存——缓存坏掉不该让插件起不来。
 */
export class PoemCache {
  private readonly path: string
  private readonly entries = new Map<string, PoemAbout>()
  private loaded = false
  private writeChain: Promise<void> = Promise.resolve()

  /**
   * @param path - 缓存 JSON 的路径。
   */
  constructor(path: string) {
    this.path = path
  }

  /** 把文件读进来（只读一次）。 */
  async load(): Promise<void> {
    if (this.loaded) return

    this.loaded = true

    try {
      const text = await readFile(this.path, 'utf8')
      const parsed = JSON.parse(text) as CacheFile

      if (parsed?.version === 1 && parsed.poems !== null && typeof parsed.poems === 'object') {
        for (const [line, about] of Object.entries(parsed.poems)) {
          if (about !== null && typeof about === 'object' && typeof about.meaning === 'string') {
            this.entries.set(keyOf(line), about)
          }
        }
      }
    } catch {
      // 文件不存在或坏了：空缓存
    }
  }

  /** 命中就返回，未命中返回 undefined。 */
  get(line: string): PoemAbout | undefined {
    return this.entries.get(keyOf(line))
  }

  /** 缓存里有多少条。 */
  get size(): number {
    return this.entries.size
  }

  /**
   * 存一条并落盘。
   *
   * 写盘串行化：两次点击可能同时写，后写的不能把先写的覆盖掉（所以每次写整个
   * 快照，而不是增量）。先写临时文件再 rename，避免写到一半断电留下坏 JSON。
   * @param line - 诗句（键）。
   * @param about - 详解内容。
   */
  async put(line: string, about: PoemAbout): Promise<void> {
    this.entries.set(keyOf(line), about)

    const snapshot: CacheFile = { version: 1, poems: Object.fromEntries(this.entries) }
    const body = JSON.stringify(snapshot, null, 0)

    this.writeChain = this.writeChain.then(async () => {
      try {
        await mkdir(dirname(this.path), { recursive: true })

        const tmp = `${this.path}.tmp`

        await writeFile(tmp, body, 'utf8')
        await rename(tmp, this.path)
      } catch {
        // 落盘失败不该毁掉这次请求：内存里已经有了，下次重启就丢
      }
    })

    await this.writeChain
  }
}

/** 拼一条给模型看的 prompt（纯函数，方便测试）。 */
export const aboutPromptOf = (line: string, from: string): { system: string; user: string } => ({
  system: [
    '你是一位中国古典诗词学者。针对用户给出的一句诗（可能出自长篇），写简明的解读。',
    '只输出一个 JSON 对象，不要 Markdown、不要代码围栏、不要多余解释。',
    '字段：',
    '  "dynasty": 朝代名，如 "唐"、"宋"；确定不了就给 null。',
    '  "year": 创作年份或年代，尽量具体（如 "约 725 年（开元十三年）"）；确定不了就给 null。',
    '  "meaning": 这一句（这几句）在说什么，2–3 句白话。',
    '  "background": 作者在什么处境下写的这首诗、想表达什么，2–4 句白话。',
    '不要编造精确年份：宁可给 null 或"约"，也不要瞎猜。',
  ].join('\n'),
  user: `诗句：${line}\n出处：${from}`,
})

/** 剥掉模型爱加的那些壳：代码围栏、思考段、前后废话。 */
const stripShell = (text: string): string => {
  let out = text

  // 推理模型会把思考过程放进 <think>…</think>
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, '')
  out = out.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')

  return out.trim()
}

/**
 * 取出第一个**配对完整**的 JSON 对象。
 *
 * 不能用 `indexOf('{')` + `lastIndexOf('}')`：正文里带一个花括号，或者对象被
 * max_tokens 截断在中间，那一刀就会切出非法 JSON。这里逐字符扫，跳过字符串里
 * 的括号，深度归零时才算一个完整对象。
 */
const balancedObject = (text: string): string | null => {
  const start = text.indexOf('{')

  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]

    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false

      continue
    }

    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1

      if (depth === 0) return text.slice(start, i + 1)
    }
  }

  return null
}

/** 字段名和中文别名都认。 */
const ALIASES: Record<string, string[]> = {
  dynasty: ['dynasty', '朝代', 'dynastyName', 'era'],
  year: ['year', '年份', '年代', 'date', 'createdYear'],
  meaning: ['meaning', '诗意', '释义', 'interpretation', 'translation', 'explanation'],
  background: ['background', '背景', '创作背景', 'context', 'origin', 'note'],
}

/**
 * 模型被 max_tokens 截断时，对象往往缺了尾巴。逐字段抢救还能用的那几项——
 * 半个答案也比「详解失败」强。
 */
const salvage = (raw: string): Record<string, unknown> | null => {
  const out: Record<string, unknown> = {}
  let found = false

  for (const [field, names] of Object.entries(ALIASES)) {
    for (const name of names) {
      const pattern = new RegExp(`"${name}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`)

      const hit = pattern.exec(raw)

      if (hit === null) continue

      try {
        out[field] = JSON.parse(`"${hit[1]}"`) as unknown
      } catch {
        out[field] = hit[1]
      }

      found = true
      break
    }
  }

  return found ? out : null
}

/** 把模型输出解析成 `PoemAbout`；解析不了返回 null。 */
export const aboutParse = (text: string, atMs: number): PoemAbout | null => {
  const trimmed = stripShell(text)

  if (trimmed === '') return null

  let raw: any = null

  const balanced = balancedObject(trimmed)

  if (balanced !== null) {
    try {
      raw = JSON.parse(balanced)
    } catch {
      raw = null
    }
  }

  // 完整对象解析不了（多半是被截断了）：退一步逐字段抢救
  if (raw === null || typeof raw !== 'object') raw = salvage(trimmed)

  if (raw === null || typeof raw !== 'object') return null

  const str = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() !== '' && value.trim() !== 'null' ? value.trim() : null

  const pick = (field: string): string | null => {
    for (const name of ALIASES[field] ?? [field]) {
      const hit = str(raw?.[name])

      if (hit !== null) return hit
    }

    return null
  }

  const meaning = pick('meaning')
  const background = pick('background')

  // 两个正文都没有，就当这次生成失败（不要把空壳写进缓存）
  if (meaning === null && background === null) return null

  return {
    dynasty: pick('dynasty'),
    year: pick('year'),
    meaning: meaning ?? '（模型没有给出释义）',
    background: background ?? '（模型没有给出背景）',
    atMs,
  }
}
