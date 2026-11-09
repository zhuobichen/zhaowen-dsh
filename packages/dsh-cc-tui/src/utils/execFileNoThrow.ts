import { spawn } from 'node:child_process'

/** The settled outcome of a no-throw command run. */
export interface ExecFileNoThrowResult {
  code: number | null
  stdout: string
  stderr: string
}

/**
 * Options for {@link execFileNoThrow}: stdin payload, timeout, and child
 * working directory.
 */
export interface ExecFileNoThrowOptions {
  /** Stdin payload (OSC 52 clipboard helpers and tmux load-buffer). */
  input?: string
  /** Kill the child after this many milliseconds. */
  timeout?: number
  /**
   * Accepted for call-site compatibility with the original execa-based
   * implementation; `false` (the only value the Ink core passes) matches this
   * shim's behavior of running in the current working directory.
   */
  useCwd?: boolean
  /** Working directory for the child; defaults to the parent's cwd. */
  cwd?: string
}

/**
 * Run a command without throwing: resolves with `{ code, stdout, stderr }`
 * even when the process exits non-zero or cannot spawn.
 * @param file - The executable path to spawn.
 * @param args - Command-line arguments; defaults to none.
 * @param options - Spawn options (input, timeout, cwd).
 * @returns The process outcome: exit code, captured stdout, and captured stderr.
 */
export function execFileNoThrow(
  file: string,
  args?: readonly string[],
  options?: ExecFileNoThrowOptions,
): Promise<ExecFileNoThrowResult> {
  // 门禁（docs/门禁-等待与取消.md）：不允许「只有 close 一条 settle 路径」。
  // 调用方不传 timeout 时给默认上限；到点必须**自己 settle**，
  // 而不是 kill 完继续等 close（那曾在 Windows 上把整个会话挂死）。
  const timeoutMs = options?.timeout ?? 5 * 60_000
  return new Promise(resolve => {
    let settled = false
    let stdout = ''
    let stderr = ''
    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    }

    const child = spawn(file, args ?? [], { cwd: options?.cwd })
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* 可能已经退了 */
      }
      try {
        child.stdout?.destroy()
      } catch {
        /* ignore */
      }
      try {
        child.stderr?.destroy()
      } catch {
        /* ignore */
      }
      // 超时按「跑完了但失败」处理：code 为 null，调用方看得出来不是正常退出
      finish(null)
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', () => {
      finish(1)
    })
    child.on('close', code => {
      finish(code)
    })
    if (options?.input !== undefined) child.stdin.write(options.input)
    child.stdin.end()
  })
}
