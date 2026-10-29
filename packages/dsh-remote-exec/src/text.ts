/**
 * 模型可见文本的裁剪与格式化。纯函数，方便单测。
 *
 * @module dsh-remote-exec/text
 */

/** 人读的字节数。 */
export function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`

  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes / 1024
  let index = 0

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

/** 毫秒 → `1.2s` / `350ms` / `2m01s`。 */
export function humanDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0ms'
  if (ms < 1000) return `${Math.round(ms)}ms`

  const seconds = ms / 1000

  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`

  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds - minutes * 60)

  return `${minutes}m${String(rest).padStart(2, '0')}s`
}

/**
 * 把模型给的超时（毫秒）换算成远端 `timeout` 要的秒数，至少 1 秒。
 *
 * @param ms 毫秒
 * @returns 秒
 */
export function toSeconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000))
}

/**
 * 输出太长时保留尾部（报错和结论都在末尾），并在前面留一行说明。
 *
 * @param text 原文本
 * @param totalBytes 原始字节数（用于说明丢了多少）
 * @param maxBytes 保留上限
 * @returns 截断后的文本
 */
export function clipTail(text: string, totalBytes: number, maxBytes: number): string {
  const bytes = Buffer.byteLength(text, 'utf8')

  if (bytes <= maxBytes && totalBytes <= maxBytes) return text

  const keep = Math.max(0, maxBytes)
  const buffer = Buffer.from(text, 'utf8')
  const sliced = buffer.subarray(Math.max(0, buffer.length - keep)).toString('utf8')
  const dropped = Math.max(totalBytes, buffer.length) - Buffer.byteLength(sliced, 'utf8')

  return `…（前面还有 ${humanBytes(dropped)} 未显示）\n${sliced}`
}

/** 命令预览：压成一行，超长截断。 */
export function commandPreview(command: string, limit = 120): string {
  const flat = command.replace(/\s+/g, ' ').trim()

  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`
}
