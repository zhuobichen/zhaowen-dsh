/**
 * dsh-remote-exec —— 把指定的任务直接推到云端服务器上跑。
 *
 * 动机很具体：家里这台机器要关机，腾讯云那台一直开着。所以「重活、长活」应该
 * 挪到那台机器上，本地只留模型循环和会话。这个插件补的就是这一步：不改变 DSH
 * 自己的执行面（本地 bash / 文件工具照旧），而是多给模型 5 个工具，让它**按任务**
 * 选择推过去跑——这正是「某些任务」和「整个 profile 都在远端」的区别。
 *
 * 设计取舍：
 * - 传输层用系统自带 OpenSSH，不引依赖。认证、known_hosts、agent、ProxyJump、
 *   `~/.ssh/config` 全部沿用 ssh 自己的那套，插件不碰凭据。
 * - 长任务一律 `setsid nohup` 落到远端磁盘上，作业**活过 DSH 重启和断网**；
 *   宿主只负责 start / poll / kill。不挂 `ctx.jobs` 就是为了这一点。
 * - 脚本从 stdin 喂给远端登录 shell，不做 `ssh host '<字符串>'` 拼接。
 * - 主机没配好时只注册 `remote_doctor`，不把 4 个必然失败的工具塞进 prompt。
 *
 * @module dsh-remote-exec
 */

import { resolve as resolvePath } from 'node:path'

import {
  DEFAULT_REMOTE_WORKDIR,
  pickHost,
  resolveConfig,
  type Config,
  type ResolvedConfig,
  type ResolvedHost,
} from './config.js'
import { remotePathExpr, quotePosix, runRemote, clampTimeout } from './ssh.js'
import {
  assertJobId,
  buildKillScript,
  buildListScript,
  buildLogsScript,
  buildStartScript,
  buildStatusScript,
  newJobId,
  parseList,
  parseLogs,
  parseStatus,
  parseKv,
  runsDirExpr,
  workdirExpr,
  type JobStatus,
} from './jobs.js'
import { downloadFromRemote, uploadToRemote } from './transfer.js'
import { clipTail, commandPreview, humanBytes, humanDuration } from './text.js'

export type { Config } from './config.js'

export const name = 'dsh-remote-exec'
/** 只依赖工具注册表；别的服务都是可选的。 */
export const inject: string[] = ['tools']

/** 渲染时 stdout / stderr 各自最多给模型看多少字节。 */
const RENDER_BUDGET = 24_000

interface ExecValue {
  host: string
  cwd: string
  exit_code?: number
  signal?: string
  stdout: string
  stderr: string
  duration_ms: number
  timed_out: boolean
  stdout_truncated: boolean
  stderr_truncated: boolean
  job_id?: string
}

interface JobValue {
  host: string
  jobs?: JobStatus[]
  job?: JobStatus
  stdout?: string
  stderr?: string
  next_offset?: number
  killed?: boolean
  waited_ms?: number
  missing?: boolean
}

const EXEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['host', 'cwd', 'stdout', 'stderr', 'duration_ms', 'timed_out'],
  properties: {
    host: { type: 'string' },
    cwd: { type: 'string' },
    exit_code: { type: 'integer' },
    signal: { type: 'string' },
    stdout: { type: 'string' },
    stderr: { type: 'string' },
    duration_ms: { type: 'integer' },
    timed_out: { type: 'boolean' },
    stdout_truncated: { type: 'boolean' },
    stderr_truncated: { type: 'boolean' },
    job_id: { type: 'string' },
  },
}

const JOB_STATUS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'status'],
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: ['running', 'done', 'unknown'] },
    exit_code: { type: 'integer' },
    pid: { type: 'string' },
    alive: { type: 'boolean' },
    started: { type: 'integer' },
    stdout_bytes: { type: 'integer' },
    stderr_bytes: { type: 'integer' },
    cwd: { type: 'string' },
    name: { type: 'string' },
  },
}

const JOB_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['host'],
  properties: {
    host: { type: 'string' },
    jobs: { type: 'array', items: JOB_STATUS_SCHEMA },
    job: JOB_STATUS_SCHEMA,
    stdout: { type: 'string' },
    stderr: { type: 'string' },
    next_offset: { type: 'integer' },
    killed: { type: 'boolean' },
    waited_ms: { type: 'integer' },
    missing: { type: 'boolean' },
  },
}

const TRANSFER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['host', 'source', 'target', 'bytes', 'duration_ms'],
  properties: {
    host: { type: 'string' },
    source: { type: 'string' },
    target: { type: 'string' },
    bytes: { type: 'integer' },
    duration_ms: { type: 'integer' },
    excludes: { type: 'array', items: { type: 'string' } },
  },
}

const DOCTOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['configured', 'reachable'],
  properties: {
    configured: { type: 'boolean' },
    reachable: { type: 'boolean' },
    host: { type: 'string' },
    target: { type: 'string' },
    latency_ms: { type: 'integer' },
    report: { type: 'string' },
    error: { type: 'string' },
    hint: { type: 'string' },
  },
}

const statusToValue = (status: JobStatus): Record<string, unknown> => ({
  id: status.id,
  status: status.status,
  ...(status.exitCode === null ? {} : { exit_code: status.exitCode }),
  ...(status.pid === '' ? {} : { pid: status.pid }),
  alive: status.alive,
  ...(status.started === null ? {} : { started: status.started }),
  stdout_bytes: status.stdoutBytes,
  stderr_bytes: status.stderrBytes,
  ...(status.cwd === '' ? {} : { cwd: status.cwd }),
  ...(status.name === '' ? {} : { name: status.name }),
})

const textOf = (blocks: string[]): Array<{ type: 'text'; text: string }> => [{ type: 'text', text: blocks.join('\n') }]

/** 把一段输出拼进模型可见文本，太长就留尾部。 */
const section = (label: string, text: string, totalBytes: number): string => {
  const body = text === '' ? '（空）' : clipTail(text, totalBytes, RENDER_BUDGET)

  return `--- ${label} ---\n${body}`
}

const execRender = (_args: unknown, value: ExecValue): Array<{ type: 'text'; text: string }> => {
  const head = [
    `[${value.host}] 退出码 ${value.exit_code === undefined ? `无（被 ${value.signal ?? '信号'} 终止）` : value.exit_code}` +
      ` · ${humanDuration(value.duration_ms)} · cwd=${value.cwd}` +
      (value.timed_out ? ' · 超时' : ''),
  ]

  if (value.job_id) {
    head.push(`后台作业 ${value.job_id} 已启动（用 remote_job op=logs/wait 看进度）`)
  }

  return textOf([
    ...head,
    // 输出在采集阶段就已经裁成尾部，这里只需要按渲染预算再收一次；
    // 不要拿总字节数去算「丢了多少」，否则会写出 8192 TiB 这种谎话。
    section('stdout', value.stdout, Buffer.byteLength(value.stdout)),
    section('stderr', value.stderr, Buffer.byteLength(value.stderr)),
  ])
}

const jobRender = (_args: unknown, value: JobValue): Array<{ type: 'text'; text: string }> => {
  const lines: string[] = []

  if (value.jobs) {
    lines.push(`[${value.host}] 作业 ${value.jobs.length} 个（最新在后）`)

    for (const job of value.jobs) {
      lines.push(
        `  ${job.id}  ${job.status}${job.exitCode == null ? '' : ` 退出码 ${job.exitCode}`}` +
          `${job.name ? `  ${job.name}` : ''}`,
      )
    }
    if (value.jobs.length === 0) lines.push('  （还没有作业）')
  }

  if (value.job) {
    const job = value.job

    lines.push(
      `[${value.host}] ${job.id} ${job.status}` +
        (job.exitCode == null ? '' : ` 退出码 ${job.exitCode}`) +
        (job.alive ? ' · 进程还活着' : '') +
        (job.cwd ? ` · cwd=${job.cwd}` : ''),
    )
    lines.push(`  stdout ${humanBytes(job.stdoutBytes)} · stderr ${humanBytes(job.stderrBytes)}`)
  }

  if (value.missing) lines.push('作业不存在（检查 job_id，或用 op=list）')
  if (value.killed) lines.push('已发送 TERM（1 秒后还在就 KILL）')
  if (value.waited_ms !== undefined) lines.push(`等待 ${humanDuration(value.waited_ms)}`)
  if (value.stdout !== undefined) lines.push(section('stdout', value.stdout, Buffer.byteLength(value.stdout)))
  if (value.stderr !== undefined) lines.push(section('stderr', value.stderr, Buffer.byteLength(value.stderr)))

  return textOf(lines)
}

const transferRender = (_args: unknown, value: Record<string, unknown>): Array<{ type: 'text'; text: string }> =>
  textOf([
    `[${String(value.host)}] ${humanBytes(Number(value.bytes))} · ${humanDuration(Number(value.duration_ms))}`,
    `${String(value.source)} → ${String(value.target)}`,
    ...(Array.isArray(value.excludes) && value.excludes.length > 0
      ? [`排除: ${value.excludes.join(' ')}`]
      : []),
  ])

const doctorRender = (_args: unknown, value: Record<string, unknown>): Array<{ type: 'text'; text: string }> => {
  if (value.configured === false) {
    return textOf([
      '远端执行还没配置。',
      ...(value.error ? [`配置错误: ${String(value.error)}`] : []),
      ...(value.hint ? [String(value.hint)] : []),
    ])
  }

  if (value.reachable === false) {
    return textOf([
      `连不上 ${String(value.host)}（${String(value.target)}）`,
      ...(value.error ? [String(value.error)] : []),
      ...(value.hint ? [String(value.hint)] : []),
    ])
  }

  return textOf([`[${String(value.host)}] 连通 · 首字节 ${humanDuration(Number(value.latency_ms ?? 0))}`, String(value.report ?? '')])
}

/** 模型给的值必须是字符串，且不能是空串。 */
const requireString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} 必须是非空字符串`)

  return value
}

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

/** 环境变量名必须是合法的 shell 标识符。 */
const envLines = (env: unknown): string[] => {
  if (env === undefined || env === null) return []
  if (typeof env !== 'object' || Array.isArray(env)) throw new Error('env 必须是对象（键值都是字符串）')

  return Object.entries(env as Record<string, unknown>).map(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`env 的键不是合法变量名: ${key}`)
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`env.${key} 必须是字符串`)

    return `export ${key}=${quotePosix(String(value))}`
  })
}

export function apply(ctx: any, config: Config = {}): void {
  let resolved: ResolvedConfig | undefined
  let configError: string | undefined

  try {
    resolved = resolveConfig(config)
  } catch (error: any) {
    configError = String(error?.message ?? error)
  }

  const configured = resolved !== undefined && resolved.hosts.length > 0

  if (!configured) {
    ctx.logger?.warn?.(
      `[remote-exec] 没有可用的远端主机${configError ? `：${configError}` : ''}；只注册 remote_doctor。`,
    )
  }

  const hostOf = (args: Record<string, unknown>): ResolvedHost => {
    if (!resolved) throw new Error(`远端执行配置有误: ${configError ?? '未解析'}`)

    return pickHost(resolved, optionalString(args.host))
  }

  const configHint =
    '在 cordis.yml 的 remote-exec 条目里写 hosts: { default: { host: <IP>, user: root, identityFile: ~/.ssh/id_xxx } }，' +
    '或在 $DSH_HOME/.env 里设 DSH_REMOTE_HOST / DSH_REMOTE_USER / DSH_REMOTE_KEY。'

  const localDirOf = (exec: any): string =>
    String(exec?.agent?.session?.header?.cwd ?? process.cwd())

  // ---- remote_doctor：永远注册，配置有问题时它就是唯一入口 ----
  ctx.tools.register({
    name: 'remote_doctor',
    description:
      '远端执行体检：主机连通性、延迟、系统/CPU/内存/磁盘、常用工具链（node / python / docker / git …）、' +
      '远端工作目录状态。第一次用远程执行、或 remote_* 报连不上时先跑它。不修改任何东西。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { host: { type: 'string', description: '主机名（配置了多台时用），省略用默认主机。' } },
    },
    output: {
      schema: DOCTOR_SCHEMA,
      render: doctorRender,
    },
    isConcurrencySafe: () => true,
    async execute(args: Record<string, unknown>) {
      if (!resolved || !configured) {
        return {
          configured: false,
          reachable: false,
          ...(configError ? { error: configError } : {}),
          hint: configHint,
        }
      }

      const host = hostOf(args)
      const started = Date.now()

      try {
        const result = await runRemote(resolved, host, buildDoctorScript(host), {
          timeoutMs: 30_000,
          maxBytes: 32_000,
        })

        if (result.code !== 0) {
          return {
            configured: true,
            reachable: false,
            host: host.name,
            target: host.target,
            error: `远端体检脚本退出码 ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`,
            hint: configHint,
          }
        }

        return {
          configured: true,
          reachable: true,
          host: host.name,
          target: host.target,
          latency_ms: Date.now() - started,
          report: result.stdout.trim(),
        }
      } catch (error: any) {
        return {
          configured: true,
          reachable: false,
          host: host.name,
          target: host.target,
          error: String(error?.message ?? error),
          hint: '先手工确认 ssh 能连：ssh -v <target>；认证/安全组/端口见报错里的提示。',
        }
      }
    },
  })

  if (!configured || !resolved) return

  const cfg = resolved

  // ---- remote_exec ----
  ctx.tools.register({
    name: 'remote_exec',
    description:
      '在云端服务器上执行一段 shell 脚本（远端登录 shell，工作目录默认是远端工作目录）。' +
      'command 是脚本正文，从 stdin 传入，所以它**不能**再读 stdin（要喂数据请用 remote_upload 或脚本内 heredoc）。' +
      '几十秒能跑完的用前台；分钟级以上、或者要活过本次会话的，用 background=true 起后台作业，' +
      '再用 remote_job 看日志/等待/终止。' +
      '退出码、stdout、stderr 都会原样回来；返回非零退出码不是工具错误。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['command'],
      properties: {
        command: { type: 'string', description: '要跑的 shell 脚本正文（POSIX sh/bash）。多行直接写。' },
        cwd: {
          type: 'string',
          description: '远端工作目录（POSIX 路径，支持 ~）。省略时用配置里的工作目录（会自动创建）。',
        },
        host: { type: 'string', description: '主机名，省略用默认主机。' },
        timeout_ms: { type: 'integer', description: '前台超时毫秒，省略用 execTimeoutMs（默认 120000）。' },
        env: {
          type: 'object',
          additionalProperties: true,
          description: '要注入的环境变量对象，值会被转成字符串（键必须是合法 shell 变量名）。',
        },
        background: {
          type: 'boolean',
          description: 'true = 立刻返回作业 id，进程在远端后台继续跑（断网、关 DSH 都不影响）。',
        },
        name: { type: 'string', description: 'background=true 时给作业起个名字，方便 remote_job list 里认。' },
      },
    },
    output: {
      schema: EXEC_SCHEMA,
      render: execRender as any,
    },
    isConcurrencySafe: () => true,
    async execute(args: Record<string, unknown>, exec: any) {
      const host = hostOf(args)
      const command = requireString(args.command, 'command')
      const cwd = optionalString(args.cwd) ?? host.workdir
      const cwdProvided = optionalString(args.cwd) !== undefined

      if (args.background === true) {
        const id = newJobId()
        const script = buildStartScript(host, {
          id,
          command,
          cwd,
          ...(optionalString(args.name) ? { name: optionalString(args.name)! } : {}),
        })
        const started = Date.now()
        const result = await runRemote(cfg, host, script, { timeoutMs: 60_000, maxBytes: 8_000 })

        if (result.code !== 0) {
          throw new Error(`启动后台作业失败（退出码 ${result.code}）：${result.stderr.trim() || result.stdout.trim()}`)
        }

        return {
          host: host.name,
          cwd,
          exit_code: 0,
          stdout: result.stdout.trim(),
          stderr: result.stderr,
          duration_ms: Date.now() - started,
          timed_out: false,
          stdout_truncated: false,
          stderr_truncated: false,
          job_id: id,
        }
      }

      const timeoutMs = clampTimeout(args.timeout_ms, cfg.execTimeoutMs)
      const script = [
        'set -o pipefail',
        cwdProvided
          ? `cd ${remotePathExpr(cwd)} || { echo "dsh-remote: 远端目录不存在: ${cwd.replace(/"/g, '')}" >&2; exit 97; }`
          : `mkdir -p ${remotePathExpr(cwd)} 2>/dev/null; cd ${remotePathExpr(cwd)} || exit 97`,
        ...envLines(args.env),
        command,
      ].join('\n')

      const result = await runRemote(cfg, host, script, {
        timeoutMs,
        maxBytes: cfg.maxOutputBytes,
        ...(exec?.signal ? { signal: exec.signal } : {}),
      })

      return {
        host: host.name,
        cwd,
        ...(result.code === null ? {} : { exit_code: result.code }),
        ...(result.signal === null ? {} : { signal: result.signal }),
        stdout: result.stdout,
        stderr: result.stderr,
        duration_ms: result.durationMs,
        timed_out: result.timedOut,
        stdout_truncated: result.stdoutBytes > Buffer.byteLength(result.stdout),
        stderr_truncated: result.stderrBytes > Buffer.byteLength(result.stderr),
      }
    },
  })

  // ---- remote_job ----
  ctx.tools.register({
    name: 'remote_job',
    description:
      '管理 remote_exec(background=true) 起的远端后台作业。' +
      'op=list 列出作业；op=status 看某个作业状态；op=logs 读日志（默认读尾部，可用 offset 增量读）；' +
      'op=wait 等到作业结束（有上限，超时不代表失败）；op=kill 终止作业（整组 TERM→KILL）。' +
      '作业状态存在远端磁盘上，所以关了 DSH、断了网，回来还能查。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['op'],
      properties: {
        op: { type: 'string', enum: ['list', 'status', 'logs', 'wait', 'kill'] },
        job_id: { type: 'string', description: '作业 id（op 不是 list 时必填）。' },
        host: { type: 'string', description: '主机名，省略用默认主机。' },
        offset: { type: 'integer', description: 'op=logs 时的字节偏移（0 表示从头）；省略则读尾部。' },
        max_bytes: { type: 'integer', description: 'op=logs 时每条流最多返回多少字节，默认 16000。' },
        timeout_ms: { type: 'integer', description: 'op=wait 的等待上限毫秒，默认 60000，最大 600000。' },
        limit: { type: 'integer', description: 'op=list 返回条数，默认 20。' },
      },
    },
    output: {
      schema: JOB_SCHEMA,
      render: jobRender as any,
    },
    isConcurrencySafe: () => true,
    async execute(args: Record<string, unknown>, exec: any) {
      const host = hostOf(args)
      const op = requireString(args.op, 'op')

      if (op === 'list') {
        const limit = Math.max(1, Math.min(200, Number(args.limit ?? 20) || 20))
        const result = await runRemote(cfg, host, buildListScript(host, limit), { timeoutMs: 30_000, maxBytes: 32_000 })

        return { host: host.name, jobs: parseList(result.stdout) }
      }

      const id = requireString(args.job_id, 'job_id')

      assertJobId(id)

      if (op === 'status') {
        const result = await runRemote(cfg, host, buildStatusScript(host, id), { timeoutMs: 30_000, maxBytes: 8_000 })
        const kv = parseKv(result.stdout)

        if (kv.MISSING === '1') return { host: host.name, missing: true }

        return { host: host.name, job: statusToValue(parseStatus(id, result.stdout)) }
      }

      if (op === 'logs') {
        const maxBytes = Math.max(1, Math.min(cfg.maxOutputBytes, Number(args.max_bytes ?? 16_000) || 16_000))
        const offset = args.offset === undefined ? null : Math.max(0, Number(args.offset) || 0)
        const result = await runRemote(cfg, host, buildLogsScript(host, id, offset, maxBytes), {
          timeoutMs: 30_000,
          maxBytes: maxBytes * 2 + 4_000,
        })
        const header = result.stdout.split(/\n?__DSH_REMOTE_SEG_[0-9a-f]+__\n?/)[0] ?? ''
        const kv = parseKv(header)

        if (kv.MISSING === '1') return { host: host.name, missing: true }

        const logs = parseLogs(result.stdout)

        return {
          host: host.name,
          job: statusToValue(parseStatus(id, header)),
          stdout: logs.stdout,
          stderr: logs.stderr,
          next_offset: (offset ?? 0) + Buffer.byteLength(logs.stdout, 'utf8'),
        }
      }

      if (op === 'kill') {
        const result = await runRemote(cfg, host, buildKillScript(host, id), { timeoutMs: 60_000, maxBytes: 8_000 })
        const kv = parseKv(result.stdout)

        if (kv.MISSING === '1') return { host: host.name, missing: true }

        return { host: host.name, killed: kv.KILLED === 'yes' }
      }

      // op === 'wait'：轮询远端状态文件，直到 done 或超时
      const budget = clampTimeout(args.timeout_ms, 60_000, 600_000)
      const deadline = Date.now() + budget
      const waitStarted = Date.now()

      for (;;) {
        if (exec?.signal?.aborted) throw new Error('等待被取消（作业仍在远端运行，可用 remote_job op=status 继续查）')

        const result = await runRemote(cfg, host, buildStatusScript(host, id), { timeoutMs: 30_000, maxBytes: 8_000 })
        const kv = parseKv(result.stdout)

        if (kv.MISSING === '1') return { host: host.name, missing: true }

        const status = parseStatus(id, result.stdout)

        if (status.status === 'done') {
          const logs = await runRemote(cfg, host, buildLogsScript(host, id, null, 8_000), {
            timeoutMs: 30_000,
            maxBytes: 24_000,
          })
          const parsed = parseLogs(logs.stdout)

          return {
            host: host.name,
            job: statusToValue(status),
            stdout: parsed.stdout,
            stderr: parsed.stderr,
            next_offset: status.stdoutBytes,
            waited_ms: Date.now() - waitStarted,
          }
        }

        if (Date.now() >= deadline) {
          return {
            host: host.name,
            job: statusToValue(status),
            waited_ms: Date.now() - waitStarted,
          }
        }

        await new Promise((r) => setTimeout(r, cfg.backgroundPollMs))
      }
    },
  })

  // ---- remote_upload ----
  ctx.tools.register({
    name: 'remote_upload',
    description:
      '把本机的文件或整个目录传到云端（tar over ssh，一条连接；可用 exclude 排掉 node_modules / .git 之类）。' +
      '目标目录不存在会自动创建，传过去的目录会成为目标目录下的同名子目录（和 scp -r 一致）。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['local_path'],
      properties: {
        local_path: { type: 'string', description: '本机文件或目录（绝对路径，或相对会话 cwd）。' },
        remote_dir: {
          type: 'string',
          description: '远端目标目录（POSIX 路径，支持 ~）。省略时用远端工作目录。',
        },
        exclude: {
          type: 'array',
          items: { type: 'string' },
          description: 'tar 排除模式，例如 ["node_modules", ".git", "*.log"]。',
        },
        host: { type: 'string', description: '主机名，省略用默认主机。' },
      },
    },
    output: { schema: TRANSFER_SCHEMA, render: transferRender as any },
    isConcurrencySafe: () => false,
    async execute(args: Record<string, unknown>, exec: any) {
      const host = hostOf(args)
      const localPath = resolvePath(localDirOf(exec), requireString(args.local_path, 'local_path'))
      const remoteDir = optionalString(args.remote_dir) ?? host.workdir

      const result = await uploadToRemote(cfg, host, localPath, remoteDir, stringList(args.exclude))

      return { host: host.name, ...result }
    },
  })

  // ---- remote_download ----
  ctx.tools.register({
    name: 'remote_download',
    description:
      '把云端的文件或整个目录拉回本机（tar over ssh）。本机目标目录不存在会自动创建；' +
      '拉下来的目录会成为目标目录下的同名子目录。大产物优先只拉需要的文件。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['remote_path'],
      properties: {
        remote_path: { type: 'string', description: '远端文件或目录（POSIX 路径，支持 ~）。' },
        local_dir: {
          type: 'string',
          description: '本机目标目录。省略时是会话 cwd 下的 .dsh-remote-downloads/。',
        },
        exclude: { type: 'array', items: { type: 'string' }, description: 'tar 排除模式。' },
        host: { type: 'string', description: '主机名，省略用默认主机。' },
      },
    },
    output: { schema: TRANSFER_SCHEMA, render: transferRender as any },
    isConcurrencySafe: () => false,
    async execute(args: Record<string, unknown>, exec: any) {
      const host = hostOf(args)
      const remotePath = requireString(args.remote_path, 'remote_path')
      const localDir = args.local_dir
        ? resolvePath(localDirOf(exec), String(args.local_dir))
        : resolvePath(localDirOf(exec), '.dsh-remote-downloads', basenameOf(remotePath))

      const result = await downloadFromRemote(cfg, host, remotePath, localDir, stringList(args.exclude))

      return { host: host.name, ...result }
    },
  })
}

const stringList = (value: unknown): string[] => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('exclude 必须是字符串数组')

  return value.map((item) => {
    if (typeof item !== 'string' || item.trim() === '') throw new Error('exclude 里每项都必须是非空字符串')

    return item.trim()
  })
}

const basenameOf = (path: string): string => {
  const cleaned = path.trim().replace(/\/+$/, '')
  const at = cleaned.lastIndexOf('/')

  return at < 0 ? cleaned : cleaned.slice(at + 1) || cleaned
}

/** 体检脚本：只读，不动任何东西。 */
function buildDoctorScript(host: ResolvedHost): string {
  const workdir = workdirExpr(host)
  const runs = runsDirExpr(host)

  return [
    'echo "== system =="',
    'uname -srm 2>/dev/null || uname -a',
    "sed -n 's/^PRETTY_NAME=//p' /etc/os-release 2>/dev/null | head -n 1",
    'echo "== cpu / memory / disk =="',
    'printf "cpus=%s\\n" "$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo ?)"',
    'free -h 2>/dev/null | sed -n "1,2p"',
    `df -h "$HOME" 2>/dev/null | tail -n 1`,
    'echo "== tools =="',
    'for t in bash git node npm python3 pip3 docker curl wget tmux screen setsid nohup tar timeout gcc make ffmpeg; do',
    '  p=$(command -v "$t" 2>/dev/null) || p=-',
    '  printf "%s=%s\\n" "$t" "$p"',
    'done',
    'echo "== workdir =="',
    `W=${workdir}`,
    'if [ -d "$W" ]; then printf "exists=yes\\n"; du -sh "$W" 2>/dev/null | cut -f1; else echo "exists=no"; fi',
    `printf "jobs=%s\\n" "$(ls ${runs} 2>/dev/null | wc -l)"`,
  ].join('\n')
}
