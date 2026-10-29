/**
 * 双向传文件：本地 tar 和远端 tar 对着流，中间是一条 ssh 连接。
 *
 * 不用 scp：tar 能带 `--exclude`，能一次传整棵目录（几千个小文件时 scp 会慢到
 * 让人怀疑人生），而且只建一条连接。Windows 10+ 自带 bsdtar，参数与 GNU tar
 * 在这几个用法上一致。
 *
 * @module dsh-remote-exec/transfer
 */

import { spawn } from 'node:child_process'
import { mkdir, stat } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

import type { ResolvedConfig, ResolvedHost } from './config.js'
import { remotePathExpr, sshArgv } from './ssh.js'

/** 一次传输的结果。 */
export interface TransferResult {
  /** 实际搬运的压缩后字节数。 */
  bytes: number
  durationMs: number
  /** 本地/远端两端的源与目标，方便回显。 */
  source: string
  target: string
  /** 被排除的模式。 */
  excludes: string[]
}

/** 传输失败（不是「命令退出码非零」，是真的没搬成）。 */
export class TransferError extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message)
    this.name = 'TransferError'
  }
}

interface PipelineResult {
  bytes: number
  durationMs: number
  producerCode: number | null
  consumerCode: number | null
  producerErr: string
  consumerErr: string
  /** 只有「真的超过字节上限」才为 true；消费端挂掉不算。 */
  limitExceeded: boolean
}

/**
 * 把一个进程的 stdout 直接灌进另一个进程的 stdin，并负责收尾。
 *
 * @param producer 生产端（tar -czf - 或 ssh）
 * @param consumer 消费端（ssh 或 tar -xzf -）
 * @param maxBytes 超过就中止
 */
function pipeline(
  producer: { file: string; args: string[] },
  consumer: { file: string; args: string[] },
  maxBytes: number,
): Promise<PipelineResult> {
  const started = Date.now()

  return new Promise<PipelineResult>((resolvePromise) => {
    const p = spawn(producer.file, producer.args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const c = spawn(consumer.file, consumer.args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })

    let bytes = 0
    let limitExceeded = false
    let pErr = ''
    let cErr = ''
    let pCode: number | null = null
    let cCode: number | null = null
    let done = false

    const settle = (): void => {
      if (done) return
      if (pCode === null || cCode === null) return

      done = true
      resolvePromise({
        bytes,
        durationMs: Date.now() - started,
        producerCode: pCode,
        consumerCode: cCode,
        producerErr: pErr,
        consumerErr: cErr,
        limitExceeded,
      })
    }

    const killBoth = (): void => {
      p.kill('SIGKILL')
      c.kill('SIGKILL')
    }

    p.stderr?.on('data', (chunk: Buffer) => {
      if (pErr.length < 16_384) pErr += chunk.toString('utf8')
    })
    c.stderr?.on('data', (chunk: Buffer) => {
      if (cErr.length < 16_384) cErr += chunk.toString('utf8')
    })

    p.stdout?.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (!limitExceeded && bytes > maxBytes) {
        limitExceeded = true
        killBoth()
      }
    })

    if (c.stdin) {
      // 消费端提前关闭时管道会 EPIPE；这是「下游失败」的一种表现，交给退出码判断，
      // 不要让它变成一个未被捕获的 'error' 事件把进程炸掉。
      c.stdin.on('error', () => {})
      p.stdout?.pipe(c.stdin)
    } else {
      killBoth()
    }

    p.stdout?.on('error', () => {})

    p.on('error', (error) => {
      pErr += String(error.message ?? error)
      pCode = 127
      settle()
    })
    c.on('error', (error) => {
      cErr += String(error.message ?? error)
      cCode = 127
      settle()
    })

    p.on('close', (code) => {
      pCode = code
      // 生产端先结束：让消费端自然收尾（tar 读到 EOF 就退出）。
      c.stdin?.end()
      settle()
    })
    c.on('close', (code) => {
      cCode = code
      // 消费端非零退出 = 下游失败：生产端继续写只会拿到 EPIPE，收掉它。
      // 注意这里不能记成「超过上限」，否则用户看到的是完全错误的归因。
      if (code !== 0 && pCode === null) p.kill('SIGTERM')
      settle()
    })
  })
}

/**
 * 本机 → 云端。
 *
 * @param config 已解析配置
 * @param host 目标主机
 * @param localPath 本地文件或目录
 * @param remoteDir 远端目标目录（不存在会创建）；传进来的目录会作为容器
 * @param excludes tar 排除模式
 */
export async function uploadToRemote(
  config: ResolvedConfig,
  host: ResolvedHost,
  localPath: string,
  remoteDir: string,
  excludes: string[],
): Promise<TransferResult> {
  const absolute = resolve(localPath)
  const info = await stat(absolute).catch(() => null)

  if (!info) throw new TransferError(`本地路径不存在: ${absolute}`, absolute)

  const parent = dirname(absolute)
  const base = basename(absolute)
  const tarArgs = ['-czf', '-', '-C', parent]

  for (const pattern of excludes) tarArgs.push(`--exclude=${pattern}`)

  tarArgs.push(base)

  const remoteCommand = `mkdir -p ${remotePathExpr(remoteDir)} && tar -xzf - -C ${remotePathExpr(remoteDir)}`
  const started = Date.now()
  const result = await pipeline(
    { file: config.tarBinary, args: tarArgs },
    { file: config.sshBinary, args: sshArgv(config, host, [remoteCommand]) },
    config.maxTransferBytes,
  )

  if (result.limitExceeded) {
    throw new TransferError(
      `传输超过上限（${config.maxTransferBytes} 字节），已中止。调大 maxTransferBytes 或加 exclude。`,
      result.consumerErr || result.producerErr,
    )
  }

  if (result.producerCode !== 0) {
    throw new TransferError(
      `本地打包失败（tar 退出码 ${result.producerCode}）: ${result.producerErr.trim() || '(无 stderr)'}`,
      result.producerErr,
    )
  }

  if (result.consumerCode !== 0) {
    throw new TransferError(
      `远端解包失败（退出码 ${result.consumerCode}）：${result.consumerErr.trim() || '检查目标目录权限与磁盘空间'}`,
      result.consumerErr || result.producerErr,
    )
  }

  return {
    bytes: result.bytes,
    durationMs: Date.now() - started,
    source: absolute,
    target: `${host.name}:${remoteDir}/${base}`,
    excludes,
  }
}

/**
 * 云端 → 本机。
 *
 * @param config 已解析配置
 * @param host 目标主机
 * @param remotePath 远端文件或目录
 * @param localDir 本地目标目录（不存在会创建）
 * @param excludes tar 排除模式（远端生效）
 */
export async function downloadFromRemote(
  config: ResolvedConfig,
  host: ResolvedHost,
  remotePath: string,
  localDir: string,
  excludes: string[],
): Promise<TransferResult> {
  const cleaned = remotePath.trim().replace(/\/+$/, '')
  const slash = cleaned.lastIndexOf('/')
  const parent = slash <= 0 ? '.' : cleaned.slice(0, slash)
  const base = slash <= 0 ? cleaned : cleaned.slice(slash + 1)
  const target = resolve(localDir)

  await mkdir(target, { recursive: true })

  const excludesArg = excludes.length > 0 ? `${excludes.map((e) => `--exclude=${quoteArg(e)}`).join(' ')} ` : ''
  const remoteCommand = `tar -czf - -C ${remotePathExpr(parent)} ${excludesArg}${quoteArg(base)}`

  const started = Date.now()
  const result = await pipeline(
    { file: config.sshBinary, args: sshArgv(config, host, [remoteCommand]) },
    { file: config.tarBinary, args: ['-xzf', '-', '-C', target] },
    config.maxTransferBytes,
  )

  if (result.limitExceeded) {
    throw new TransferError(
      `传输超过上限（${config.maxTransferBytes} 字节），已中止。调大 maxTransferBytes 或加 exclude。`,
      result.producerErr || result.consumerErr,
    )
  }

  if (result.producerCode !== 0) {
    throw new TransferError(
      `远端打包失败（退出码 ${result.producerCode}）：${result.producerErr.trim() || '确认路径存在、可读'}`,
      result.producerErr,
    )
  }

  if (result.consumerCode !== 0) {
    throw new TransferError(
      `本地解包失败（tar 退出码 ${result.consumerCode}）: ${result.consumerErr.trim() || '(无 stderr)'}`,
      result.consumerErr,
    )
  }

  return {
    bytes: result.bytes,
    durationMs: Date.now() - started,
    source: `${host.name}:${cleaned}`,
    target: `${target}/${base}`,
    excludes,
  }
}

/** tar 的参数级转义（远端命令串里的一层 shell 引号由 remotePathExpr 负责）。 */
function quoteArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
