/**
 * SSH 传输层：所有远端调用都从这里出去。
 *
 * 走系统自带的 OpenSSH（Windows 10+ 的 `C:\Windows\System32\OpenSSH\ssh.exe`），
 * 不引第三方依赖 —— 认证、known_hosts、ssh-agent、ProxyJump、`~/.ssh/config`
 * 全部交给 ssh 自己处理，本插件只负责拼参数、喂脚本、收输出。
 *
 * 脚本一律**从 stdin** 喂给远端登录 shell（`bash -l`），不走 `ssh host '...'`
 * 那种字符串拼接：省掉两层引号，也就不存在转义漏洞。代价是被调用的脚本不能
 * 再从 stdin 读数据（要用数据就 upload，或者脚本里自己写 heredoc）。
 *
 * @module dsh-remote-exec/ssh
 */

import { spawn } from 'node:child_process'

import type { ResolvedConfig, ResolvedHost } from './config.js'

/** 一次进程调用的结果；`code === null` 表示被信号杀掉或超时。 */
export interface ProcessResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  /** stdout 的原始字节数（截断前）。 */
  stdoutBytes: number
  /** stderr 的原始字节数（截断前）。 */
  stderrBytes: number
  durationMs: number
  timedOut: boolean
  /** spawn 失败时的错误（例如找不到 ssh.exe）；此时 code 为 null。 */
  spawnError?: NodeJS.ErrnoException
}

export interface RunOptions {
  stdin?: string | Buffer
  timeoutMs?: number
  /** 每条流各自保留的尾部字节上限。 */
  maxBytes?: number
  signal?: AbortSignal
  cwd?: string
  env?: NodeJS.ProcessEnv
}

/** 只保留尾部 `limit` 字节的缓冲区，同时记住原始总字节数。 */
class TailCapture {
  private chunks: Buffer[] = []
  private kept = 0
  total = 0

  constructor(private readonly limit: number) {}

  push(chunk: Buffer): void {
    this.total += chunk.length
    this.chunks.push(chunk)
    this.kept += chunk.length

    while (this.kept > this.limit && this.chunks.length > 1) {
      const dropped = this.chunks.shift()!

      this.kept -= dropped.length
    }

    const first = this.chunks[0]

    if (this.chunks.length === 1 && first !== undefined && first.length > this.limit) {
      this.chunks[0] = first.subarray(first.length - this.limit)
      this.kept = this.limit
    }
  }

  text(): string {
    return Buffer.concat(this.chunks).toString('utf8')
  }

  get truncated(): boolean {
    return this.total > this.kept
  }
}

/**
 * 跑一个本地进程并收集输出。
 *
 * @param file 可执行文件
 * @param args 参数数组（不经过 shell，无需转义）
 * @param options 见 {@link RunOptions}
 * @returns 进程结果；超时会先 SIGTERM 再 SIGKILL，并标记 `timedOut`
 */
export function runProcess(file: string, args: string[], options: RunOptions = {}): Promise<ProcessResult> {
  const maxBytes = options.maxBytes ?? 1_000_000
  const started = Date.now()

  return new Promise<ProcessResult>((resolve) => {
    let child

    try {
      child = spawn(file, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolve({
        code: null,
        signal: null,
        stdout: '',
        stderr: '',
        stdoutBytes: 0,
        stderrBytes: 0,
        durationMs: Date.now() - started,
        timedOut: false,
        spawnError: error as NodeJS.ErrnoException,
      })

      return
    }

    const out = new TailCapture(maxBytes)
    const err = new TailCapture(maxBytes)

    let settled = false
    let timedOut = false
    let timer: NodeJS.Timeout | undefined
    let killTimer: NodeJS.Timeout | undefined

    const finish = (code: number | null, signal: NodeJS.Signals | null, spawnError?: NodeJS.ErrnoException): void => {
      if (settled) return

      settled = true
      if (timer) clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)

      resolve({
        code,
        signal,
        stdout: out.text(),
        stderr: err.text(),
        stdoutBytes: out.total,
        stderrBytes: err.total,
        durationMs: Date.now() - started,
        timedOut,
        ...(spawnError ? { spawnError } : {}),
      })
    }

    child.on('error', (error) => {
      finish(null, null, error as NodeJS.ErrnoException)
    })

    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => err.push(chunk))

    child.on('close', (code, signal) => {
      finish(code, signal)
    })

    // stdin：写完就关，远端 `bash -l` 靠 EOF 结束读脚本。
    if (child.stdin) {
      child.stdin.on('error', () => {
        // 远端提前退出时写 stdin 会 EPIPE，这不是失败，忽略。
      })

      if (options.stdin !== undefined) child.stdin.end(options.stdin)
      else child.stdin.end()
    }

    if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        // 有些平台/进程不理会 SIGTERM，留 3 秒再强杀。
        killTimer = setTimeout(() => child.kill('SIGKILL'), 3_000)
      }, options.timeoutMs)
    }

    if (options.signal) {
      const onAbort = (): void => {
        child.kill('SIGTERM')
      }

      if (options.signal.aborted) onAbort()
      else options.signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

/** POSIX 单引号转义：把任意字符串变成一个安全的 shell 词。 */
export function quotePosix(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * 把远端路径变成 shell 表达式：`~` 交给远端 `$HOME` 展开，其余按字面量单引号包住。
 *
 * @param path 远端 POSIX 路径
 * @returns 可直接拼进远端脚本的表达式
 */
export function remotePathExpr(path: string): string {
  const trimmed = path.trim()

  if (trimmed === '') throw new Error('远端路径不能为空')
  if (trimmed === '~') return '"$HOME"'
  if (trimmed.startsWith('~/')) return `"$HOME"/${quotePosix(trimmed.slice(2))}`

  return quotePosix(trimmed)
}

/** 参数校验：模型给的超时不能是负数或天文数字。 */
export function clampTimeout(value: unknown, fallback: number, ceiling = 24 * 60 * 60 * 1000): number {
  if (value === undefined || value === null) return fallback
  const n = Number(value)

  if (!Number.isFinite(n) || n <= 0) throw new Error(`timeout_ms 必须是正整数，收到: ${String(value)}`)

  return Math.min(Math.floor(n), ceiling)
}

/**
 * 拼出完整的 ssh argv。
 *
 * @param config 已解析配置
 * @param host 目标主机
 * @param remoteCommand 远端命令词数组（不做 shell 拼接，由 ssh 自己 join）
 * @param options.tty 是否申请伪终端（默认不要，避免把日志搅成一坨）
 */
export function sshArgv(
  config: ResolvedConfig,
  host: ResolvedHost,
  remoteCommand: string[],
  options: { tty?: boolean; connectTimeoutMs?: number } = {},
): string[] {
  const connectTimeoutSec = Math.max(1, Math.ceil((options.connectTimeoutMs ?? config.connectTimeoutMs) / 1000))
  const args = [options.tty ? '-tt' : '-T']

  const push = (option: string, value: string): void => {
    args.push('-o', `${option}=${value}`)
  }

  push('BatchMode', 'yes') // 不弹任何交互式提问，凭据不对就立刻失败
  push('StrictHostKeyChecking', config.strictHostKeyChecking)
  push('ConnectTimeout', String(connectTimeoutSec))
  push('ServerAliveInterval', '15')
  push('ServerAliveCountMax', '4')
  push('LogLevel', 'ERROR') // 本地告警别混进远端 stderr

  if (host.port !== undefined) args.push('-p', String(host.port))
  if (host.identityFile !== undefined) args.push('-i', host.identityFile)
  if (host.proxyJump !== undefined) push('ProxyJump', host.proxyJump)

  for (const [key, value] of Object.entries(host.options)) push(key, value)

  args.push(host.target, ...remoteCommand)

  return args
}

/** 远端登录 shell 的词数组，例如 `bash -l` → `['bash','-l']`。 */
export function shellWords(config: ResolvedConfig): string[] {
  const words = config.remoteShell.split(/\s+/).filter(Boolean)

  if (words.length === 0) throw new Error('remoteShell 不能为空')

  return words
}

/** 把一段脚本包成「登录 shell + 可选的远端 timeout」。 */
export function remoteCommandFor(
  config: ResolvedConfig,
  options: { timeoutSec?: number; useTimeout?: boolean } = {},
): string[] {
  // 脚本先落到远端临时文件，再由登录 shell 执行它。
  //
  // 为什么不直接把脚本从 stdin 喂给 bash：任何会读 stdin 的命令（ffmpeg 不加
  // -nostdin、`head`、`read`、ssh…）都会从**正在被执行的脚本**里抢字节，脚本
  // 会在随机位置少一个字符（`echo` 变 `cho`），失败得莫名其妙。落盘之后 stdin
  // 变成了"已经被 cat 读完"的空流，这个坑从根上消失。
  const runner = `${shellWords(config).join(' ')} "$f"`
  const wrapper = `'f=$(mktemp) || exit 98; cat > "$f" || exit 98; ${runner}; rc=$?; rm -f "$f"; exit $rc'`
  const command = ['bash', '-c', wrapper]

  if (options.useTimeout === false || options.timeoutSec === undefined) return command

  // GNU coreutils 的 timeout：超时先 TERM，再留 10 秒 KILL，避免远端留下孤儿编译进程。
  return ['timeout', '-s', 'TERM', '-k', '10', `${Math.ceil(options.timeoutSec)}s`, ...command]
}

/** 连接级失败（ssh 自己没连上），和「命令跑了但退出码非零」要分开。 */
export class RemoteConnectionError extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message)
    this.name = 'RemoteConnectionError'
  }
}

const connectHints = (stderr: string, host: ResolvedHost): string => {
  const text = stderr.toLowerCase()

  if (text.includes('permission denied')) {
    return '认证被拒绝：确认公钥已装到服务器（~/.ssh/authorized_keys 或 ssh-copy-id），或 identityFile 指对了。'
  }
  if (text.includes('no such file or directory') && text.includes('identity file')) {
    return '私钥文件不存在：检查 hosts.<name>.identityFile 的路径。'
  }
  if (text.includes('connection refused')) {
    return '端口拒绝连接：确认 sshd 在跑、端口（腾讯云默认 22）没被安全组挡住。'
  }
  if (text.includes('timed out') || text.includes('timeout')) {
    return '连接超时：确认公网 IP、安全组放行、以及本机网络能到该端口。'
  }
  if (text.includes('host key verification failed')) {
    return `主机密钥与 known_hosts 不符：确认这台机器没被换过，然后用 ssh-keygen -R ${host.host} 清掉旧记录。`
  }
  if (text.includes('could not resolve hostname')) {
    return '主机名解析失败：检查 hosts.<name>.host，或 ~/.ssh/config 里的别名。'
  }

  return '建连失败：先跑 remote_doctor 看细节。'
}

/**
 * 在远端执行一段脚本。
 *
 * @param config 已解析配置
 * @param host 目标主机
 * @param script POSIX shell 脚本（经 stdin 落到远端临时文件后执行）
 * @param options 超时、输出上限、取消信号
 * @returns 进程结果；`code` 是远端命令真实的退出码
 * @throws {RemoteConnectionError} ssh 自己没连上（而不是命令执行失败）
 */
export async function runRemote(
  config: ResolvedConfig,
  host: ResolvedHost,
  script: string,
  options: RunOptions & { timeoutSec?: number } = {},
): Promise<ProcessResult> {
  const timeoutMs = options.timeoutMs ?? config.execTimeoutMs
  const runPass = async (useTimeout: boolean): Promise<ProcessResult> =>
    runProcess(
      config.sshBinary,
      sshArgv(config, host, remoteCommandFor(config, { timeoutSec: Math.ceil(timeoutMs / 1000), useTimeout })),
      {
        ...options,
        // 脚本必须真的喂给远端 shell：少了这一行，远端 `bash -l` 立刻读到 EOF，
        // 脚本一行都不执行却返回 0（最难查的那类「静默成功」）。
        stdin: script,
        timeoutMs: timeoutMs + 5_000,
        maxBytes: options.maxBytes ?? config.maxOutputBytes,
      },
    )

  let result = await runPass(true)

  // 远端没有 coreutils 的 timeout 时，第一趟会以 127 失败；退回不带 timeout 的版本。
  if (result.code === 127 && /timeout: (not found|command not found)/i.test(result.stderr)) {
    result = await runPass(false)
  }

  if (result.spawnError) {
    throw new RemoteConnectionError(
      `找不到 ssh 可执行文件（${config.sshBinary}）：${result.spawnError.message}`,
      result.spawnError.message,
    )
  }

  if (result.code === 255) {
    const hint = connectHints(result.stderr, host)

    throw new RemoteConnectionError(`连不上 ${host.name}（${host.target}）：${hint}`, result.stderr.trim())
  }

  if (result.code === 127 && /bash: (command )?not found/i.test(result.stderr)) {
    throw new Error(
      `远端没有 bash（${config.remoteShell}）。把插件配置里的 remoteShell 改成 "sh -l"，或在服务器上装 bash。`,
    )
  }

  return result
}
