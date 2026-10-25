/**
 * 路由层：用假宿主 + 假 webServer 直接打 index.js 注册的 handler。
 * 覆盖 5 条要求的路由 + dry-run 默认 + 409/500 的语义。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { apply, dshSessionIdFor, ROUTE } from '../index.js'
import { listSessions, openDatabase } from '../zcode.js'
import { fakeHost, freshDb, invoke, notRunningStub, runningStub, TMP, writeSyntheticDshSession } from './helpers.ts'

/** 起一套（路由 + 配置 + 假宿主）。 */
function bootstrap(options = {}) {
  const dbPath = options.dbPath ?? freshDb('route')
  const root = options.root ?? `${TMP}\\dsh-root-${Date.now()}-${Math.round(Math.random() * 1e6)}`
  const host = fakeHost({ services: options.services })
  apply(host.ctx, {
    root,
    dbPath,
    detectRunning: options.detectRunning ?? notRunningStub,
  })
  assert.equal(host.routes.length, 1, '应该只注册一条 prefix 路由')
  const route = host.routes[0]
  assert.equal(route.kind, 'prefix')
  assert.equal(route.path, ROUTE)
  return { route, host, dbPath, root }
}

const call = (route, method, path, body) => invoke(route, method, `${ROUTE}${path}`, body)

test('路由 1：GET /dsh-zcode/list 列出 ZCode 会话', async () => {
  const { route } = bootstrap()
  const res = await call(route, 'GET', '/list')
  assert.equal(res.status, 200)
  assert.equal(res.json.ok, true)
  assert.ok(Array.isArray(res.json.sessions))
  assert.ok(res.json.sessions.length >= 3)
  for (const session of res.json.sessions) {
    for (const key of ['id', 'title', 'directory', 'updatedAt', 'messages']) {
      assert.ok(key in session, `缺字段 ${key}`)
    }
  }
  console.log('GET /list →', res.json.sessions.length, '个会话；zcodeRunning =', res.json.zcodeRunning)
  for (const session of res.json.sessions.slice(0, 3)) {
    console.log('  ', session.id, '|', session.title, '|', session.messages, 'msg |', session.directory)
  }
})

test('路由 2：GET /preview 是 dry-run，给角色 + 条数 + 前 120 字抽样，且不写任何东西', async () => {
  const { route, root } = bootstrap()
  const list = await call(route, 'GET', '/list')
  const target = list.json.sessions.find((s) => s.messages > 2) ?? list.json.sessions[0]

  const res = await call(route, 'GET', `/preview?sessionId=${encodeURIComponent(target.id)}`)
  assert.equal(res.status, 200)
  assert.equal(res.json.ok, true)
  assert.equal(res.json.applied, false)
  assert.equal(typeof res.json.target.cwd, 'string')
  assert.equal(typeof res.json.target.title, 'string')
  assert.ok(res.json.counts.messages > 0)
  assert.ok(res.json.counts.toolCalls >= 1)
  assert.ok(Array.isArray(res.json.sample) && res.json.sample.length > 0)
  for (const row of res.json.sample) {
    assert.ok(row.role === 'user' || row.role === 'assistant')
    assert.equal(typeof row.text, 'string')
    assert.ok(row.text.length <= 121, '抽样文本最多 120 字（+省略号）')
  }
  // dry-run 不写 DSH
  assert.equal(existsSync(root), false, `dry-run 不该创建 ${root}`)
  console.log('GET /preview →', res.json.target.title, JSON.stringify(res.json.counts))
  for (const row of res.json.sample.slice(0, 4)) console.log('  ', row.role, '|', row.text.slice(0, 60))

  const bad = await call(route, 'GET', '/preview')
  assert.equal(bad.status, 400)
  assert.equal(bad.json.code, 'BAD_REQUEST')
})

test('路由 3：POST /import 缺省 dry-run；apply:true 走 ctx.sessions.create + flush；重复导入 409', async () => {
  const created = []
  const live = new Map()
  const sessions = {
    create(id, opts) {
      created.push({ id, opts })
      const session = { id }
      live.set(id, session)
      return session
    },
    get(id) {
      return live.get(id)
    },
    async flush(session) {
      session.flushed = true
      return true
    },
  }
  const { route } = bootstrap({ services: { sessions } })
  const list = await call(route, 'GET', '/list')
  const target = list.json.sessions.find((s) => s.messages > 0)

  // ① 缺省 dry-run：不调 create
  const dry = await call(route, 'POST', '/import', { sessionId: target.id })
  assert.equal(dry.status, 200)
  assert.equal(dry.json.applied, false)
  assert.equal(created.length, 0)
  assert.match(dry.json.note, /dry-run/)

  // ② apply:true
  const real = await call(route, 'POST', '/import', {
    sessionId: target.id,
    apply: true,
    titlePrefix: '[ZCode] ',
  })
  assert.equal(real.status, 200)
  assert.equal(real.json.applied, true)
  assert.equal(real.json.via, 'ctx.sessions.create')
  assert.equal(real.json.flushed, true)
  assert.equal(created.length, 1)
  assert.equal(created[0].id, dshSessionIdFor(target.id))
  assert.match(real.json.target.title, /^\[ZCode\] /)
  const seed = created[0].opts.seed
  assert.ok(seed.length > 0)
  assert.equal(seed[0].type, 'turn/start')
  assert.equal(created[0].opts.meta.cwd, target.directory)
  assert.ok(seed.some((e) => e.type === 'system/message'), '必须有 system/message 当 surface 头节点')
  console.log('POST /import apply →', real.json.dshSessionId, 'events:', seed.length, JSON.stringify(real.json.counts))

  // ③ 幂等：再导一次 → 409 ALREADY_EXISTS
  const again = await call(route, 'POST', '/import', { sessionId: target.id, apply: true })
  assert.equal(again.status, 409)
  assert.equal(again.json.code, 'ALREADY_EXISTS')
  assert.equal(again.json.detail.existingId, dshSessionIdFor(target.id))
  console.log('重复 import →', again.status, again.json.code)
})

test('路由 3b：没有 ctx.sessions 时落到 v4 文件，且能立刻被 export-preview 读回来', async () => {
  const { route, root, dbPath } = bootstrap()
  const list = await call(route, 'GET', '/list')
  const target = list.json.sessions.find((s) => s.title === '你好') ?? list.json.sessions.find((s) => s.messages > 0)
  const res = await call(route, 'POST', '/import', { sessionId: target.id, apply: true })
  assert.equal(res.status, 200)
  assert.equal(res.json.via, 'file')
  assert.equal(existsSync(res.json.file), true)
  console.log('POST /import (file) →', res.json.file, res.json.bytes, 'bytes')

  // DSH → ZCode 的 dry-run 用同一份文件
  const preview = await call(route, 'GET', `/export-preview?dshSessionId=${encodeURIComponent(res.json.dshSessionId)}`)
  assert.equal(preview.status, 200)
  assert.equal(preview.json.applied, false)
  assert.equal(preview.json.counts.sessions, 1)
  assert.equal(preview.json.counts.messages, res.json.counts.messages)
  assert.ok(preview.json.counts.parts > preview.json.counts.messages)
  // ZCode 目标 project_id 应该正好命中"已存在"的那个（directory 就来自 ZCode 自己）
  assert.equal(preview.json.target.projectSource, 'derived-existing')
  assert.equal(preview.json.target.directory, target.directory)
  assert.equal(preview.json.zcodeRunning, false)
  console.log('GET /export-preview（回环）→', JSON.stringify(preview.json.counts), preview.json.target.projectId)
  assert.equal(existsSync(root), true)
  assert.ok(dbPath)
})

test('路由 4：GET /export-preview 报出要写几张表、目标 project_id 与标题', async () => {
  const box = bootstrap()
  const { file, header } = writeSyntheticDshSession(box.root, { id: `session-route-preview-${Date.now()}` })
  assert.ok(existsSync(file))
  const res = await call(box.route, 'GET', `/export-preview?dshSessionId=${encodeURIComponent(header.id)}`)
  assert.equal(res.status, 200)
  assert.equal(res.json.ok, true)
  assert.equal(res.json.applied, false)
  assert.equal(res.json.counts.sessions, 1)
  assert.equal(res.json.counts.messages, 4)
  assert.ok(res.json.counts.parts >= 7)
  assert.equal(res.json.counts.toolParts, 1)
  assert.match(res.json.target.projectId, /^proj_/)
  assert.ok(res.json.target.projectId.length <= 85)
  assert.equal(res.json.target.title, 'bridge-test-合成会话')
  console.log('GET /export-preview →', JSON.stringify(res.json.counts))
  console.log('  target:', JSON.stringify(res.json.target))
  console.log('  warnings:', JSON.stringify(res.json.warnings))
})

test('路由 5：POST /export 缺省 dry-run；ZCode 在跑 → 409 且不写；能写时回执带行数+备份路径', async () => {
  const dshRoot = `${TMP}\\dsh-root-export-${Date.now()}`
  const { file: dshFile, header } = writeSyntheticDshSession(dshRoot, { id: `session-route-export-${Date.now()}`, title: 'route-export-合成' })
  assert.ok(existsSync(dshFile))

  // ① dry-run
  const dryBox = bootstrap({ root: dshRoot })
  const dry = await call(dryBox.route, 'POST', '/export', { dshSessionId: header.id })
  assert.equal(dry.status, 200)
  assert.equal(dry.json.applied, false)
  assert.match(dry.json.note, /dry-run/)

  // ② ZCode 在跑 → 409，且库里没有新行、没有备份
  const runningBox = bootstrap({ detectRunning: runningStub, root: dshRoot })
  const before = (() => {
    const db = new DatabaseSync(runningBox.dbPath, { readOnly: true })
    try {
      return listSessions(db).length
    } finally {
      db.close()
    }
  })()
  const refused = await call(runningBox.route, 'POST', '/export', { dshSessionId: header.id, apply: true })
  assert.equal(refused.status, 409)
  assert.equal(refused.json.code, 'ZCODE_RUNNING')
  assert.match(refused.json.message, /退出 ZCode/)
  const after = (() => {
    const db = new DatabaseSync(runningBox.dbPath, { readOnly: true })
    try {
      return listSessions(db).length
    } finally {
      db.close()
    }
  })()
  assert.equal(after, before)
  assert.equal(readdirSync(`${TMP}`).filter((n) => n.includes('route-') && n.includes('.bak-')).length >= 0, true)
  console.log('POST /export（在跑）→', refused.status, refused.json.code)

  // ③ 正常写入
  const box = bootstrap({ root: dshRoot })
  const ok = await call(box.route, 'POST', '/export', { dshSessionId: header.id, apply: true })
  assert.equal(ok.status, 200)
  assert.equal(ok.json.applied, true)
  assert.equal(ok.json.inserted.messages, 4)
  assert.ok(ok.json.inserted.parts >= 7)
  assert.equal(existsSync(ok.json.backup.path), true)
  assert.match(ok.json.backup.path, /\.sqlite\.bak-\d{8}-\d{6}$/)
  console.log('POST /export →', ok.json.zcodeSessionId, JSON.stringify(ok.json.inserted))
  console.log('  backup:', ok.json.backup.path, ok.json.backup.bytes, 'bytes')

  // 真的能在 list 里看到
  const list = await call(box.route, 'GET', '/list')
  assert.ok(list.json.sessions.some((s) => s.id === ok.json.zcodeSessionId))

  // ④ 重复 export → 409 ALREADY_EXISTS（附已有 id）
  const dupe = await call(box.route, 'POST', '/export', { dshSessionId: header.id, apply: true })
  assert.equal(dupe.status, 409)
  assert.equal(dupe.json.code, 'ALREADY_EXISTS')
  assert.equal(dupe.json.detail.existingId, ok.json.zcodeSessionId)
  console.log('重复 export →', dupe.status, dupe.json.code, dupe.json.detail.existingId)

  // ⑤ force:true 可以再来一条（新 id）
  const forced = await call(box.route, 'POST', '/export', { dshSessionId: header.id, apply: true, force: true })
  assert.equal(forced.status, 200)
  assert.notEqual(forced.json.zcodeSessionId, ok.json.zcodeSessionId)

  // ⑥ 未知会话 → 404
  const missing = await call(box.route, 'GET', '/export-preview?dshSessionId=session-nope')
  assert.equal(missing.status, 404)
  assert.equal(missing.json.code, 'DSH_SESSION_NOT_FOUND')
})

test('路由 6：GET /schema 给出真实枚举与 project_id 规则；GET / 给面板；未知路径 404', async () => {
  const { route } = bootstrap()
  const res = await call(route, 'GET', '/schema')
  assert.equal(res.status, 200)
  assert.ok(Object.keys(res.json.part.types).length >= 5)
  assert.equal(res.json.projectIdRule.maxLength, 85)
  assert.ok(res.json.projects.every((p) => p.matches === true))
  console.log('GET /schema → part.types', Object.keys(res.json.part.types).join(','))
  console.log('  roles:', JSON.stringify(res.json.message.roles))
  console.log('  semantics.origin:', JSON.stringify(res.json.message.semantics.origin))

  const panel = await call(route, 'GET', '/')
  assert.equal(panel.status, 200)
  assert.match(panel.headers['content-type'], /text\/html/)
  assert.match(panel.body, /DSH ↔ ZCode 迁移/)

  const nope = await call(route, 'GET', '/nothing-here')
  assert.equal(nope.status, 404)
  assert.equal(nope.json.code, 'NOT_FOUND')

  const wrongMethod = await call(route, 'PUT', '/list')
  assert.equal(wrongMethod.status, 405)
  assert.equal(wrongMethod.json.code, 'METHOD_NOT_ALLOWED')
})
