/**
 * 远端后台作业：一个作业就是远端工作目录下的一个文件夹。
 *
 * ```
 * <workdir>/runs/<id>/
 *   run.sh        真正跑的脚本（用户命令前后加退出码捕获）
 *   meta          键值行：id / started / cwd / name
 *   pid           setsid 之后的进程组号
 *   status        running | done
 *   exit_code     跑完才写
 *   stdout.log    stdout
 *   stderr.log    stderr
 * ```
 *
 * 为什么不挂到 DSH 自己的 `ctx.jobs`：本地作业的生命周期跟着宿主进程走，而
 * 「一直开着的服务器」价值就在于此——作业必须活过 DSH 重启、活过断网。所以
 * 作业状态落在远端磁盘，宿主只负责 start/poll/kill。
 *
 * 脚本全部由本文件生成，纯字符串拼接，方便单测。
 *
 * @module dsh-remote-exec/jobs
 */

import { randomBytes } from 'node:crypto'

import type { ResolvedHost } from './config.js'
import { quotePosix, remotePathExpr } from './ssh.js'

/** 作业状态。 */
export interface JobStatus {
  id: string
  status: 'running' | 'done' | 'unknown'
  exitCode: number | null
  pid: string
  alive: boolean
  started: number | null
  stdoutBytes: number
  stderrBytes: number
  cwd: string
  name: string
}

/** 生成一个按时间可排序、又不会撞的作业 id。 */
export function newJobId(now: number = Date.now()): string {
  const stamp = new Date(now).toISOString().replace(/[-:T]/g, '').slice(0, 14)

  return `r${stamp}-${randomBytes(3).toString('hex')}`
}

/** 作业目录的 shell 表达式。 */
export function jobDirExpr(host: ResolvedHost, id: string): string {
  assertJobId(id)

  return remotePathExpr(`${trimSlash(host.workdir)}/runs/${id}`)
}

/** runs 目录的 shell 表达式。 */
export function runsDirExpr(host: ResolvedHost): string {
  return remotePathExpr(`${trimSlash(host.workdir)}/runs`)
}

/** 工作目录的 shell 表达式。 */
export function workdirExpr(host: ResolvedHost): string {
  return remotePathExpr(trimSlash(host.workdir))
}

function trimSlash(path: string): string {
  return path.trim().replace(/\/+$/, '')
}

/** 作业 id 只允许自己的格式，避免被当成路径片段。 */
export function assertJobId(id: string): void {
  if (!/^r\d{14}-[0-9a-f]{6}$/.test(id)) throw new Error(`作业 id 不合法: ${id}`)
}

/** meta 文件里不能有换行。 */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

export interface StartScriptOptions {
  id: string
  /** 用户给的原始命令（POSIX shell 脚本）。 */
  command: string
  /** 远端工作目录（可能是 `~/...`）。 */
  cwd: string
  /** 显示用的名字。 */
  name?: string
}

/**
 * 生成「把作业丢到后台」的启动脚本。
 *
 * 用户命令原样嵌进 run.sh，所以它里面的 `$`、引号、反引号都不会被提前展开——
 * 这是脚本走 stdin、且 heredoc 用带引号分隔符的直接好处。
 */
export function buildStartScript(host: ResolvedHost, options: StartScriptOptions): string {
  const sentinel = `DSH_REMOTE_EOF_${randomBytes(8).toString('hex')}`
  const runsExpr = runsDirExpr(host)
  const name = oneLine(options.name ?? '')

  return [
    `R=${runsExpr}/${options.id}`,
    'CWD=' + remotePathExpr(options.cwd),
    'export R CWD',
    'mkdir -p "$R"',
    `cat > "$R/run.sh" <<'${sentinel}'`,
    '#!/usr/bin/env bash',
    'set -o pipefail',
    // 退出码必须由 EXIT trap 落盘：用户命令里可能有 `exit 3`，写在末尾的语句根本不执行。
    'trap \'__dsh_rc=$?; echo "$__dsh_rc" > "$R/exit_code"; echo done > "$R/status"\' EXIT',
    'trap \'exit 143\' TERM INT HUP',
    'cd "$CWD" || exit 97',
    options.command,
    sentinel,
    `printf 'id=%s\\n' ${quotePosix(options.id)} > "$R/meta"`,
    `printf 'cwd=%s\\n' "$CWD" >> "$R/meta"`,
    `printf 'name=%s\\n' ${quotePosix(name)} >> "$R/meta"`,
    'date +%s > "$R/started"',
    'date +%s > "$R/meta.started"',
    'echo running > "$R/status"',
    // setsid 让作业成为新会话的进程组组长，kill 的时候能整组带走。
    'if command -v setsid >/dev/null 2>&1; then',
    '  nohup setsid bash -l "$R/run.sh" > "$R/stdout.log" 2> "$R/stderr.log" < /dev/null &',
    'else',
    '  nohup bash -l "$R/run.sh" > "$R/stdout.log" 2> "$R/stderr.log" < /dev/null &',
    'fi',
    'echo $! > "$R/pid"',
    // 等一拍，确认它没有立刻就死（比如 cwd 不存在），好当场报错而不是事后才发现。
    'sleep 0.3',
    'if ! kill -0 "$(cat "$R/pid")" 2>/dev/null && [ ! -f "$R/exit_code" ]; then',
    '  echo "launch-failed" > "$R/status"',
    '  echo 126 > "$R/exit_code"',
    'fi',
    'echo "STARTED=$R"',
  ].join('\n')
}

/** 生成查询单个作业状态的脚本。 */
export function buildStatusScript(host: ResolvedHost, id: string): string {
  const dir = jobDirExpr(host, id)

  return [
    `R=${dir}`,
    'if [ ! -d "$R" ]; then echo "MISSING=1"; exit 0; fi',
    'st=$(cat "$R/status" 2>/dev/null || echo running)',
    'ec=$(cat "$R/exit_code" 2>/dev/null || true)',
    'pid=$(cat "$R/pid" 2>/dev/null || true)',
    'alive=no',
    'if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then alive=yes; fi',
    'so=$(wc -c < "$R/stdout.log" 2>/dev/null || echo 0)',
    'se=$(wc -c < "$R/stderr.log" 2>/dev/null || echo 0)',
    'started=$(cat "$R/started" 2>/dev/null || true)',
    'name=$(sed -n "s/^name=//p" "$R/meta" 2>/dev/null | head -n 1)',
    'cwd=$(sed -n "s/^cwd=//p" "$R/meta" 2>/dev/null | head -n 1)',
    // 一行写完：换行会把 printf 的参数拆成下一条命令。
    'printf \'MISSING=0\\nSTATUS=%s\\nEXIT=%s\\nPID=%s\\nALIVE=%s\\nSTARTED=%s\\nSTDOUT_BYTES=%s\\nSTDERR_BYTES=%s\\nNAME=%s\\nCWD=%s\\n\' "$st" "$ec" "$pid" "$alive" "$started" "$so" "$se" "$name" "$cwd"',
  ].join('\n')
}

/**
 * 生成读取日志的脚本：头一行是字节数，两段内容用随机分隔符切开。
 *
 * @param offset `null` 表示「只看最后 maxBytes 字节」（默认），数字表示从该字节偏移往后读
 */
export function buildLogsScript(
  host: ResolvedHost,
  id: string,
  offset: number | null,
  maxBytes: number,
): string {
  const dir = jobDirExpr(host, id)
  const sentinel = `__DSH_REMOTE_SEG_${randomBytes(6).toString('hex')}__`
  const limit = Math.max(1, Math.floor(maxBytes))
  const slice = (file: string): string =>
    offset === null
      ? `tail -c ${limit} "$${file}" 2>/dev/null`
      : `tail -c +${Math.max(0, Math.floor(offset)) + 1} "$${file}" 2>/dev/null | head -c ${limit}`

  return [
    `R=${dir}`,
    'if [ ! -d "$R" ]; then echo "MISSING=1"; exit 0; fi',
    'so=$(wc -c < "$R/stdout.log" 2>/dev/null || echo 0)',
    'se=$(wc -c < "$R/stderr.log" 2>/dev/null || echo 0)',
    'st=$(cat "$R/status" 2>/dev/null || echo running)',
    'ec=$(cat "$R/exit_code" 2>/dev/null || true)',
    'printf \'MISSING=0\\nSTATUS=%s\\nEXIT=%s\\nSTDOUT_BYTES=%s\\nSTDERR_BYTES=%s\\n\' "$st" "$ec" "$so" "$se"',
    `echo '${sentinel}'`,
    slice('R/stdout.log'),
    `echo '${sentinel}'`,
    slice('R/stderr.log'),
    'true',
  ].join('\n')
}

/** 生成终止作业的脚本：先整组 TERM，1 秒后还在就 KILL。 */
export function buildKillScript(host: ResolvedHost, id: string): string {
  const dir = jobDirExpr(host, id)

  return [
    `R=${dir}`,
    'if [ ! -d "$R" ]; then echo "MISSING=1"; exit 0; fi',
    'pid=$(cat "$R/pid" 2>/dev/null || true)',
    'if [ -z "$pid" ]; then echo "KILLED=no"; exit 0; fi',
    'kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true',
    'sleep 1',
    'if kill -0 "$pid" 2>/dev/null; then kill -KILL -- "-$pid" 2>/dev/null || true; sleep 1; fi',
    'echo 143 > "$R/exit_code"',
    'echo done > "$R/status"',
    'echo "KILLED=yes"',
  ].join('\n')
}

/** 生成列出作业的脚本（最新的在前）。 */
export function buildListScript(host: ResolvedHost, limit: number): string {
  const runs = runsDirExpr(host)
  const max = Math.max(1, Math.floor(limit))

  return [
    `for d in ${runs}/*; do`,
    '  [ -d "$d" ] || continue',
    '  id=$(basename "$d")',
    '  st=$(cat "$d/status" 2>/dev/null || echo running)',
    '  ec=$(cat "$d/exit_code" 2>/dev/null || true)',
    '  started=$(cat "$d/started" 2>/dev/null || true)',
    '  name=$(sed -n "s/^name=//p" "$d/meta" 2>/dev/null | head -n 1)',
    '  printf \'%s\\t%s\\t%s\\t%s\\t%s\\n\' "$id" "$st" "$ec" "$started" "$name"',
    'done | tail -n ' + max,
  ].join('\n')
}

/** `KEY=VALUE` 行 → 对象（只认第一处 `=`，值里允许有 `=`）。 */
export function parseKv(text: string): Record<string, string> {
  const out: Record<string, string> = {}

  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf('=')

    if (at <= 0) continue

    const key = line.slice(0, at).trim()

    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue

    out[key] = line.slice(at + 1)
  }

  return out
}

const intOf = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === '') return null
  const n = Number(value)

  return Number.isFinite(n) ? Math.trunc(n) : null
}

/** 解析 buildStatusScript 的输出。 */
export function parseStatus(id: string, text: string): JobStatus {
  const kv = parseKv(text)
  const status = kv.STATUS === 'done' ? 'done' : kv.STATUS === undefined ? 'unknown' : 'running'

  return {
    id,
    status,
    exitCode: intOf(kv.EXIT),
    pid: kv.PID ?? '',
    alive: kv.ALIVE === 'yes',
    started: intOf(kv.STARTED),
    stdoutBytes: intOf(kv.STDOUT_BYTES) ?? 0,
    stderrBytes: intOf(kv.STDERR_BYTES) ?? 0,
    cwd: kv.CWD ?? '',
    name: kv.NAME ?? '',
  }
}

/** 解析 buildListScript 的输出。 */
export function parseList(text: string): JobStatus[] {
  const jobs: JobStatus[] = []

  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue

    const fields = line.split('\t')

    if (fields.length < 2) continue

    const [id, status, exitCode, started, name] = fields

    if (!/^r\d{14}-[0-9a-f]{6}$/.test(id)) continue

    jobs.push({
      id,
      status: status === 'done' ? 'done' : 'running',
      exitCode: intOf(exitCode),
      pid: '',
      alive: status !== 'done',
      started: intOf(started),
      stdoutBytes: 0,
      stderrBytes: 0,
      cwd: '',
      name: name ?? '',
    })
  }

  return jobs
}

/** 解析 buildLogsScript 的输出。 */
export function parseLogs(text: string): {
  stdout: string
  stderr: string
  stdoutBytes: number
  stderrBytes: number
  status: string
  exitCode: number | null
} {
  const parts = text.split(/\n?(__DSH_REMOTE_SEG_[0-9a-f]+)__\n?/)

  // split 带捕获组：header, sentinel, stdout, sentinel, stderr
  const header = parts[0] ?? ''
  const stdout = parts[2] ?? ''
  const stderr = parts[4] ?? ''
  const kv = parseKv(header)

  return {
    stdout,
    stderr,
    stdoutBytes: intOf(kv.STDOUT_BYTES) ?? Buffer.byteLength(stdout, 'utf8'),
    stderrBytes: intOf(kv.STDERR_BYTES) ?? Buffer.byteLength(stderr, 'utf8'),
    status: kv.STATUS ?? 'running',
    exitCode: intOf(kv.EXIT),
  }
}
