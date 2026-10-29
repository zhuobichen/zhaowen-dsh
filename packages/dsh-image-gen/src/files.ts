// 输出路径、文件命名、参数校验。纯函数，方便测试。

import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'

export type ImageMode = 'generate' | 'edit'

export type ImageFormat = 'png' | 'jpg'

export const MAX_PROMPT_CHARS = 8000
export const MAX_INPUT_IMAGES = 4
export const MAX_INPUT_IMAGE_BYTES = 20 * 1024 * 1024

const INPUT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const OUTPUT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

export const mediaTypeOf = (format: ImageFormat): 'image/png' | 'image/jpeg' =>
  format === 'jpg' ? 'image/jpeg' : 'image/png'

/** DSH 的 home：和别的插件保持一致。 */
export const dshHome = (): string => process.env.DSH_HOME ?? join(homedir(), '.dsh')

/** 图片默认落盘目录。 */
export const defaultOutputDir = (home = dshHome()): string =>
  join(home, 'plugins', 'dsh-image-gen', 'output')

const pad = (n: number): string => String(n).padStart(2, '0')

/** `gen_20261019-201530_a1b2c3` / `edit_...`。 */
export const makeStem = (
  mode: ImageMode,
  now: Date = new Date(),
  random: string = randomBytes(3).toString('hex'),
): string => {
  const stamp =
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    '-' +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())

  return `${mode === 'generate' ? 'gen' : 'edit'}_${stamp}_${random}`
}

/** Windows 非法字符 + 路径分隔符全部换掉；空串表示不可用。 */
export const sanitizeStem = (value: string): string => {
  const cleaned = String(value ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, 80)

  return cleaned.trim()
}

const expandHome = (raw: string): string => {
  if (raw === '~') return homedir()
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return join(homedir(), raw.slice(2))

  return raw
}

const isDirectoryPath = (path: string): boolean => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

export interface ResolveOutputInput {
  mode: ImageMode
  outputDir: string
  /** 可选：目录、文件主干，或带支持扩展名的完整路径。相对路径按 outputDir 解析。 */
  requestedPath?: string
  /** 可选：文件名主干（只在没有 requestedPath，或 requestedPath 是目录时使用）。 */
  name?: string
  now?: Date
  random?: string
  exists?: (path: string) => boolean
}

export interface ResolvedOutput {
  /** 绝对路径，**不带扩展名**。 */
  base: string
  directory: string
  /** 用户原样给的 output_path（仅用于回执）。 */
  requestedPath?: string
}

/**
 * 决定这次写哪个文件。
 *
 * - 默认：`<outputDir>/<mode>_<时间戳>_<随机>.<实际扩展名>`
 * - `output_path` 是目录（以分隔符结尾，或已存在的目录）→ 目录 + name/默认名
 * - `output_path` 带 `.png/.jpg/.jpeg/.webp` → 去掉扩展名当主干
 * - 不带扩展名 → 当主干
 * - 同名文件已存在就加 `-1`、`-2`……**绝不覆盖**
 */
export const resolveOutputBase = (input: ResolveOutputInput): ResolvedOutput => {
  const exists = input.exists ?? existsSync
  const fallbackStem = makeStem(input.mode, input.now, input.random)
  const safeName = sanitizeStem(input.name ?? '')
  let base: string
  let directory: string

  if (input.requestedPath === undefined || input.requestedPath.trim() === '') {
    directory = input.outputDir
    base = join(directory, safeName || fallbackStem)
  } else {
    const raw = expandHome(input.requestedPath.trim())
    const target = isAbsolute(raw) ? raw : resolve(input.outputDir, raw)
    const directorySpec = /[\\/]$/.test(raw) || (exists(target) && isDirectoryPath(target))

    if (directorySpec) {
      directory = target
      base = join(directory, safeName || fallbackStem)
    } else {
      const ext = extname(target).toLowerCase()

      if (ext === '') {
        directory = dirname(target)
        base = target
      } else if (OUTPUT_EXTENSIONS.has(ext)) {
        base = target.slice(0, -ext.length)
        directory = dirname(base)
      } else {
        throw new Error(
          `output_path 的扩展名 ${ext} 不支持；只接受 .png/.jpg/.jpeg/.webp，或省略扩展名。`,
        )
      }
    }
  }

  // 唯一化：不动用户已经存在的文件。
  let candidate = base

  for (let i = 1; i <= 100; i += 1) {
    const taken = [...OUTPUT_EXTENSIONS].some((ext) => exists(candidate + ext))

    if (!taken) break
    if (i === 100) throw new Error(`同名文件太多，100 个候选都被占用了: ${base}`)

    candidate = `${base}-${i}`
  }

  return { base: candidate, directory, requestedPath: input.requestedPath }
}

/** 提示词：非空、上限。 */
export const validatePrompt = (prompt: unknown, max = MAX_PROMPT_CHARS): string => {
  if (typeof prompt !== 'string') throw new Error('prompt 必须是字符串')

  const value = prompt.trim()

  if (value === '') throw new Error('prompt 不能为空')
  if (value.length > max) throw new Error(`prompt 太长（${value.length} 字符，上限 ${max}）`)

  return value
}

/** 读文件头判断真实格式；认不出返回 null。 */
export const sniffImageKind = (head: Buffer): 'png' | 'jpg' | 'webp' | null => {
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return 'png'
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpg'
  if (
    head.length >= 12 &&
    head.toString('latin1', 0, 4) === 'RIFF' &&
    head.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'webp'
  }

  return null
}

const declaredKind = (ext: string): 'png' | 'jpg' | 'webp' | null => {
  if (ext === '.png') return 'png'
  if (ext === '.jpg' || ext === '.jpeg') return 'jpg'
  if (ext === '.webp') return 'webp'

  return null
}

const headOf = (path: string, bytes = 16): Buffer => {
  const fd = openSync(path, 'r')

  try {
    const buf = Buffer.alloc(bytes)
    const read = readSync(fd, buf, 0, bytes, 0)

    return buf.subarray(0, read)
  } finally {
    closeSync(fd)
  }
}

/**
 * 输入图片：1–4 张、存在、是文件、大小合理、扩展名受支持、**内容与扩展名一致**。
 * 相对路径按会话 cwd 解析；重复路径按原顺序去重。
 */
export const validateImages = (
  images: unknown,
  cwd: string,
  max = MAX_INPUT_IMAGES,
  maxBytes = MAX_INPUT_IMAGE_BYTES,
): string[] => {
  const list = typeof images === 'string' ? [images] : images

  if (!Array.isArray(list)) throw new Error('images 必须是本地图片路径数组')
  if (list.length < 1 || list.length > max) {
    throw new Error(`images 必须是 1–${max} 张（收到 ${list.length} 张）`)
  }

  const out: string[] = []

  for (const item of list) {
    if (typeof item !== 'string' || item.trim() === '') throw new Error('images 里有空路径')

    const raw = expandHome(item.trim())
    const path = isAbsolute(raw) ? raw : resolve(cwd, raw)

    if (!existsSync(path)) throw new Error(`找不到输入图片: ${path}`)
    if (!statSync(path).isFile()) throw new Error(`输入图片不是文件: ${path}`)

    const size = statSync(path).size

    if (size === 0) throw new Error(`输入图片是空文件: ${path}`)
    if (size > maxBytes) throw new Error(`输入图片太大（${size} 字节，上限 ${maxBytes}）: ${path}`)

    const ext = extname(path).toLowerCase()

    if (!INPUT_EXTENSIONS.has(ext)) {
      throw new Error(`输入图片扩展名 ${ext || '(无)'} 不支持；只接受 .png/.jpg/.jpeg/.webp: ${path}`)
    }

    const declared = declaredKind(ext)
    const actual = sniffImageKind(headOf(path))

    if (actual === null) throw new Error(`认不出输入图片的格式（不是 PNG/JPEG/WebP）: ${path}`)
    if (declared !== actual) {
      throw new Error(`输入图片内容与扩展名不一致（扩展名 ${ext}，实际 ${actual}）: ${path}`)
    }

    if (!out.includes(path)) out.push(path)
  }

  return out
}

/** 供回执使用：显示文件名。 */
export const displayName = (path: string): string => basename(path)
