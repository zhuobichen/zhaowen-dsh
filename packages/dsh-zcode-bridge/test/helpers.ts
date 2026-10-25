/**
 * 测试公共件：真库副本、合成 DSH 会话、假宿主。
 *
 * 铁律：**绝不碰真实 `~/.zcode/cli/db/db.sqlite`**。这里只 copyFile 出来，
 * 所有写入都发生在 `.tmp/` 里的副本上。
 */
import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { irToSeedEvents, writeSessionFile } from '../dsh.js'

export const HERE = dirname(fileURLToPath(import.meta.url))
export const PKG = join(HERE, '..')
export const TMP = join(PKG, '.tmp')

export function realDbPath() {
  return process.env.ZCODE_DB ?? join(homedir(), '.zcode', 'cli', 'db', 'db.sqlite')
}

export function ensureTmp() {
  mkdirSync(TMP, { recursive: true })
  return TMP
}

/**
 * 准备一个**自包含**的真库快照：真库可能开着 WAL，直接 copy 主文件会漏掉
 * 还在 WAL 里的事务；所以连 `-wal`/`-shm` 一起 copy，再把 WAL checkpoint 进主文件，
 * 最后删掉 `-wal`/`-shm`，得到一个独立、大小稳定的 `base.sqlite`。
 */
export function prepareBase(force = false) {
  ensureTmp()
  const base = join(TMP, 'base.sqlite')
  if (existsSync(base) && !force) return base
  const src = realDbPath()
  if (!existsSync(src)) throw new Error(`找不到 ZCode 库：${src}`)
  copyFileSync(src, base)
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(src + suffix)) copyFileSync(src + suffix, base + suffix)
  }
  const db = new DatabaseSync(base)
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } finally {
    db.close()
  }
  for (const suffix of ['-wal', '-shm']) rmSync(base + suffix, { force: true })
  return base
}

let counter = 0

/** 每个测试一份独立副本（绝不共享，绝不写 base）。 */
export function freshDb(label = 'case') {
  prepareBase()
  counter += 1
  const file = join(TMP, `work-${label}-${process.pid}-${counter}.sqlite`)
  copyFileSync(join(TMP, 'base.sqlite'), file)
  return file
}

export function listBackups(file) {
  const dir = dirname(file)
  const prefix = file.slice(dir.length + 1) + '.bak-'
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .map((name) => join(dir, name))
}

export function counts(db) {
  const one = (sql) => db.prepare(sql).get().c
  return {
    session: one('SELECT count(*) c FROM session'),
    message: one('SELECT count(*) c FROM message'),
    part: one('SELECT count(*) c FROM part'),
  }
}

/** 一个合成的"两轮、含一次工具调用"的 IR（模拟从 DSH 侧读出来的形状）。 */
export function syntheticIR(options = {}) {
  const cwd = options.cwd ?? 'D:\\github_project\\ZhaoWen_GitHub维护'
  const t0 = options.at ?? 1_792_700_000_000
  const turn1 = 'turn-synthetic-1'
  const turn2 = 'turn-synthetic-2'
  return {
    version: 1,
    title: options.title ?? 'bridge-test-合成会话',
    cwd,
    createdAt: t0,
    messages: [
      {
        role: 'user',
        id: 'user-1',
        at: t0,
        turnId: turn1,
        parts: [{ kind: 'text', text: '第一轮问题：帮我看看仓库结构。' }],
      },
      {
        role: 'assistant',
        id: 'assistant-1',
        at: t0 + 1000,
        completedAt: t0 + 2000,
        turnId: turn1,
        provider: 'deepseek-official',
        model: 'deepseek-flash',
        tokens: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 },
        parts: [
          { kind: 'reasoning', text: '先列目录。' },
          { kind: 'text', text: '我先列一下目录。' },
          {
            kind: 'tool',
            callId: 'call-1',
            name: 'bash',
            arguments: '{"command":"ls"}',
            input: { command: 'ls' },
            output: 'a.txt\nb.txt',
            status: 'completed',
            isError: false,
          },
        ],
      },
      {
        role: 'user',
        id: 'user-2',
        at: t0 + 3000,
        turnId: turn2,
        parts: [{ kind: 'text', text: '第二轮问题：那两个文件是干什么的？' }],
      },
      {
        role: 'assistant',
        id: 'assistant-2',
        at: t0 + 4000,
        completedAt: t0 + 5000,
        turnId: turn2,
        provider: 'deepseek-official',
        model: 'deepseek-flash',
        parts: [{ kind: 'text', text: '第二个问题的回答：它们是测试用的占位文件。' }],
      },
    ],
    counts: { messages: 4, userMessages: 2, assistantMessages: 2, toolCalls: 1 },
  }
}

/** 把合成 IR 落成一份**真的** DSH v4 日志（多帧 zstd），返回文件路径。 */
export function writeSyntheticDshSession(root, options = {}) {
  ensureTmp()
  mkdirSync(root, { recursive: true })
  const ir = syntheticIR(options)
  const plan = irToSeedEvents(ir, {
    cwd: ir.cwd,
    createdAt: ir.createdAt,
    id: options.id ?? 'session-bridge-test-0001',
  })
  const dir = join(root, `--${plan.header.cwd.replace(/[\\/:]+/g, '-').replace(/[^A-Za-z0-9_.-]/g, '')}--`, plan.header.id)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'session.v4.jsonl.zstd')
  writeSessionFile(file, plan.header, plan.events, { overwrite: true })
  return { file, header: plan.header, events: plan.events, ir }
}

/**
 * 假 DSH 宿主：ctx.inject / ctx.get / webServer.register，外加可选的 sessions 服务。
 * 只实现插件真正用到的那几个方法。
 */
export function fakeHost(options = {}) {
  const services = { ...(options.services ?? {}) }
  const routes = []
  const disposers = []
  const ctx = {
    get(name) {
      return services[name]
    },
    inject(deps, callback) {
      if (!deps.includes('webServer')) throw new Error(`unexpected inject: ${deps}`)
      const webCtx = {
        webServer: {
          register(route) {
            routes.push(route)
            return () => routes.splice(routes.indexOf(route), 1)
          },
        },
        effect(fn) {
          const disposer = fn()
          disposers.push(disposer)
          return disposer
        },
      }
      callback(webCtx)
    },
  }
  return { ctx, routes, services, dispose: () => disposers.forEach((d) => typeof d === 'function' && d()) }
}

/** 调一次注册进来的路由，返回 {status, json}。 */
export async function invoke(route, method, path, body) {
  const chunks = []
  let status = 0
  let headers = {}
  const req = {
    method,
    url: path,
    on(event, handler) {
      if (event === 'data') {
        if (body !== undefined) handler(Buffer.from(JSON.stringify(body), 'utf8'))
        return this
      }
      if (event === 'end') {
        handler()
        return this
      }
      return this
    },
  }
  const res = {
    writeHead(code, hdrs) {
      status = code
      headers = hdrs ?? {}
      return res
    },
    end(payload) {
      if (payload !== undefined) chunks.push(String(payload))
      return res
    },
  }
  await route.handler(req, res)
  const raw = chunks.join('')
  let json
  try {
    json = raw === '' ? undefined : JSON.parse(raw)
  } catch {
    json = undefined
  }
  return { status, headers, body: raw, json }
}

/** 注入一个"检测到 ZCode 在跑"的桩。 */
export const runningStub = () => ({ running: true, checked: true, processes: ['ZCode.exe'] })
export const notRunningStub = () => ({ running: false, checked: true, processes: [] })
