/**
 * ZCode 侧的读 / 写 / 幂等 / 备份 / 事务 / 进程检测。
 * 全部对 `.tmp/` 里的 db.sqlite **副本**操作，真库只被 copyFile 读。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { eventsToIR, readSessionFile } from '../dsh.js'
import {
  ZcodeError,
  applyExport,
  detectZCodeRunning,
  findExistingSession,
  inferDefaults,
  listSessions,
  openDatabase,
  planExport,
  readSessionIR,
  readSessionRows,
  resolveProjectId,
  sampleSchema,
} from '../zcode.js'
import { counts, freshDb, listBackups, notRunningStub, TMP, writeSyntheticDshSession } from './helpers.ts'

test('读 1/3：list 能列出真库副本里的会话', () => {
  const file = freshDb('list')
  const db = openDatabase(file, { readOnly: true })
  try {
    const sessions = listSessions(db)
    assert.ok(sessions.length >= 3, `至少要 3 个会话，实际 ${sessions.length}`)
    for (const session of sessions) {
      assert.equal(typeof session.id, 'string')
      assert.ok(session.id.startsWith('session_') || session.id.startsWith('sess_'))
      assert.equal(typeof session.title, 'string')
      assert.equal(typeof session.directory, 'string')
      assert.ok(session.messages >= 0)
    }
    // 按 time_updated 倒序
    for (let i = 1; i < sessions.length; i++) {
      assert.ok(sessions[i - 1].updatedAt >= sessions[i].updatedAt)
    }
    console.log('list →', sessions.length, '个会话：')
    for (const session of sessions) console.log('  ', session.id, '|', session.title, '|', session.messages, 'msg')
  } finally {
    db.close()
  }
})

test('读 2/3：preview（IR）给出角色、条数、工具调用与抽样文本', () => {
  const file = freshDb('preview')
  const db = openDatabase(file, { readOnly: true })
  try {
    const sessions = listSessions(db)
    const target = sessions.find((s) => s.messages > 0)
    assert.ok(target !== undefined, '需要一个有消息的会话')
    const { ir, session } = readSessionIR(db, target.id)
    assert.equal(ir.cwd, session.directory)
    assert.ok(ir.counts.messages > 0)
    assert.ok(ir.counts.userMessages > 0)
    assert.ok(ir.counts.toolCalls > 0, '真库里应该有工具调用')
    const roles = new Set(ir.messages.map((m) => m.role))
    assert.ok(roles.has('user'))
    assert.ok(roles.has('assistant'))
    const sample = ir.messages
      .filter((m) => m.synthetic !== true)
      .slice(0, 6)
      .map((m) => ({ role: m.role, text: (m.parts.find((p) => p.kind === 'text')?.text ?? '').slice(0, 120) }))
    console.log('preview →', session.title, JSON.stringify(ir.counts))
    for (const row of sample) console.log('  ', row.role, '|', row.text.replace(/\s+/g, ' ').slice(0, 80))
    assert.ok(sample.length > 0)
    // 只读打开 → 没有写权限
    assert.throws(() => db.exec('CREATE TABLE should_fail (x)'), /readonly|read-only|attempt to write/i)
  } finally {
    db.close()
  }
})

test('读 3/3：schema 抽样给出真实枚举（part.type / role / semantics）', () => {
  const file = freshDb('schema')
  const db = openDatabase(file, { readOnly: true })
  try {
    const schema = sampleSchema(db)
    const types = Object.keys(schema.part.types)
    console.log('part.data.type =', types, '→', schema.part.types)
    console.log('message.role =', schema.message.roles)
    console.log('semantics.origin =', schema.message.semantics.origin)
    console.log('semantics.kind =', schema.message.semantics.kind)
    console.log('tool.state.status =', schema.part.toolStatuses)
    for (const type of ['text', 'reasoning', 'tool', 'step-start', 'step-finish']) {
      assert.ok(types.includes(type), `真库里应该出现 part.type=${type}，实际 ${types}`)
    }
    assert.deepEqual(Object.keys(schema.message.roles).sort(), ['assistant', 'user'])
    for (const bucket of ['uiVisibility', 'providerVisibility', 'transcriptVisibility']) {
      for (const value of Object.keys(schema.message.semantics[bucket])) assert.match(value, /^(visible|hidden)$/)
    }
    assert.ok(schema.projects.length > 0)
    for (const project of schema.projects) assert.equal(project.matches, true, `${project.directory} 的 project_id 应可由规则派生`)
  } finally {
    db.close()
  }
})

test('写 1/6：export 一个合成的 DSH 会话（2 轮 + 1 次工具调用），写完读回来对得上', () => {
  const file = freshDb('export')
  const root = `${TMP}\\dsh-root`
  const { file: dshFile } = writeSyntheticDshSession(root, { id: 'session-bridge-test-0001' })

  // 走真实的 DSH 读路径：解 zstd → 事件 → IR
  const log = readSessionFile(dshFile)
  const { ir } = eventsToIR(log.header, log.events)
  assert.equal(ir.counts.userMessages, 2)
  assert.equal(ir.counts.assistantMessages, 2)
  assert.equal(ir.counts.toolCalls, 1)

  const sizeBefore = statSync(file).size
  const db = openDatabase(file, { readOnly: true })
  let plan
  let project
  try {
    plan = planExport(ir, { defaults: inferDefaults(db), project: resolveProjectId(db, ir.cwd) })
    project = plan.target
  } finally {
    db.close()
  }
  assert.equal(project.projectSource, 'derived-new')
  assert.equal(plan.counts.messages, 4)
  assert.ok(plan.counts.parts >= 7, `parts 至少 7（2 user text + step-start/reasoning/text/tool/step-finish + step-start/text/step-finish），实际 ${plan.counts.parts}`)
  assert.equal(plan.counts.toolParts, 1)

  const result = applyExport(file, plan, { detectRunning: notRunningStub })
  assert.equal(result.inserted.messages, 4)
  assert.equal(result.inserted.parts, plan.counts.parts)
  assert.equal(result.sessionId, plan.session.id)

  // 备份存在且等于写前大小
  assert.equal(existsSync(result.backup.path), true)
  assert.equal(statSync(result.backup.path).size, sizeBefore, '备份大小必须等于写前大小')
  assert.match(result.backup.path, /\.sqlite\.bak-\d{8}-\d{6}$/)

  // 读回来：数量、顺序、文本
  const check = new DatabaseSync(file, { readOnly: true })
  try {
    const rows = readSessionRows(check, plan.session.id)
    assert.ok(rows !== undefined)
    assert.equal(rows.session.title, plan.session.title)
    assert.equal(rows.session.project_id, plan.session.project_id)
    assert.equal(rows.messages.length, 4)
    assert.deepEqual(
      rows.messages.map((m) => m.sequence),
      [0, 1, 2, 3],
    )
    const roleSequence = rows.messages.map((m) => JSON.parse(m.data).role)
    assert.deepEqual(roleSequence, ['user', 'assistant', 'user', 'assistant'])

    const first = JSON.parse(rows.messages[0].data)
    assert.equal(first.semantics.origin, 'real_user')
    assert.equal(first.semantics.kind, 'user_prompt')
    assert.equal(first.semantics.transcriptVisibility, 'visible')
    assert.ok(typeof first.anchor.turnId === 'string')

    const partsOf = (messageId) => rows.parts.filter((p) => p.message_id === messageId).map((p) => JSON.parse(p.data))
    const userParts = partsOf(rows.messages[0].id)
    assert.equal(userParts[0].type, 'text')
    assert.equal(userParts[0].text, '第一轮问题：帮我看看仓库结构。')

    const assistantParts = partsOf(rows.messages[1].id)
    assert.deepEqual(
      assistantParts.map((p) => p.type),
      ['step-start', 'reasoning', 'text', 'tool', 'step-finish'],
    )
    assert.equal(assistantParts[1].text, '先列目录。')
    assert.equal(assistantParts[2].text, '我先列一下目录。')
    const tool = assistantParts[3]
    assert.equal(tool.tool, 'bash')
    assert.equal(tool.callID, 'call-1')
    assert.equal(tool.state.status, 'completed')
    assert.equal(tool.state.output, 'a.txt\nb.txt')
    assert.deepEqual(tool.state.input, { command: 'ls' })
    assert.equal(assistantParts[4].tokens.input, 120)

    // part.sequence 在每条消息内从 0 连续
    for (const message of rows.messages) {
      const seqs = partsOf(message.id).length
      const stored = rows.parts.filter((p) => p.message_id === message.id).map((p) => p.sequence)
      assert.deepEqual(stored, [...Array(seqs).keys()])
    }

    // list 之后能看到它
    const sessions = listSessions(check)
    assert.ok(sessions.some((s) => s.id === plan.session.id && s.title === plan.session.title))
    console.log('export →', result.sessionId, JSON.stringify(result.inserted), 'backup:', result.backup.path)
  } finally {
    check.close()
  }
})

test('写 2/6：重复 export 同标题 → ALREADY_EXISTS（附已有 id）', () => {
  const file = freshDb('idem')
  const root = `${TMP}\\dsh-root`
  const { file: dshFile } = writeSyntheticDshSession(root, { id: 'session-bridge-test-0002' })
  const log = readSessionFile(dshFile)
  const { ir } = eventsToIR(log.header, log.events)

  const db = openDatabase(file, { readOnly: true })
  let plan
  try {
    plan = planExport(ir, { defaults: inferDefaults(db), project: resolveProjectId(db, ir.cwd) })
  } finally {
    db.close()
  }
  const first = applyExport(file, plan, { detectRunning: notRunningStub })
  assert.ok(first.sessionId)

  const second = planExport(ir, {
    defaults: { version: '0.17.0', permission: '{"mode":"yolo"}', taskType: 'interactive' },
    project: { projectId: plan.session.project_id, source: 'derived-existing' },
  })
  assert.throws(
    () => applyExport(file, second, { detectRunning: notRunningStub }),
    (error) => {
      assert.ok(error instanceof ZcodeError)
      assert.equal(error.code, 'ALREADY_EXISTS')
      assert.equal(error.detail.existingId, first.sessionId)
      console.log('ALREADY_EXISTS →', error.message, 'existingId:', error.detail.existingId)
      return true
    },
  )

  // force:true 允许再写一条同名（新 id）
  const forced = applyExport(file, second, { detectRunning: notRunningStub, force: true })
  assert.notEqual(forced.sessionId, first.sessionId)
  const check = new DatabaseSync(file, { readOnly: true })
  try {
    assert.equal(check.prepare('SELECT count(*) c FROM session WHERE title = ?').get(plan.session.title).c, 2)
  } finally {
    check.close()
  }
})

test('写 3/6：备份失败就不写（BACKUP_FAILED，一行都没进去）', () => {
  const file = freshDb('backupfail')
  const root = `${TMP}\\dsh-root`
  const { file: dshFile } = writeSyntheticDshSession(root, { id: 'session-bridge-test-0003' })
  const log = readSessionFile(dshFile)
  const { ir } = eventsToIR(log.header, log.events)

  const db = openDatabase(file, { readOnly: true })
  let plan
  try {
    plan = planExport(ir, { defaults: inferDefaults(db), project: resolveProjectId(db, ir.cwd) })
  } finally {
    db.close()
  }
  const before = (() => {
    const check = new DatabaseSync(file, { readOnly: true })
    try {
      return counts(check)
    } finally {
      check.close()
    }
  })()

  assert.throws(
    () =>
      applyExport(file, plan, {
        detectRunning: notRunningStub,
        // 指向一个不存在的目录 → copyFileSync 必然失败
        backup: { target: `${file}.no-such-dir/db.sqlite.bak-19700101-000000` },
      }),
    (error) => {
      assert.equal(error.code, 'BACKUP_FAILED')
      console.log('BACKUP_FAILED →', error.message)
      return true
    },
  )

  const check = new DatabaseSync(file, { readOnly: true })
  try {
    assert.deepEqual(counts(check), before, '备份失败后不许有任何行变化')
    assert.equal(check.prepare('SELECT count(*) c FROM session WHERE id = ?').get(plan.session.id).c, 0)
  } finally {
    check.close()
  }
})

test('写 4/6：事务失败整体回滚（NOT NULL 置空），表里没有半个会话', () => {
  const file = freshDb('txn')
  const root = `${TMP}\\dsh-root`
  const { file: dshFile } = writeSyntheticDshSession(root, { id: 'session-bridge-test-0004' })
  const log = readSessionFile(dshFile)
  const { ir } = eventsToIR(log.header, log.events)

  const db = openDatabase(file, { readOnly: true })
  let plan
  try {
    plan = planExport(ir, { defaults: inferDefaults(db), project: resolveProjectId(db, ir.cwd) })
  } finally {
    db.close()
  }
  const before = (() => {
    const check = new DatabaseSync(file, { readOnly: true })
    try {
      return counts(check)
    } finally {
      check.close()
    }
  })()

  // 构造一条插入必然失败的数据：part.session_id NOT NULL 被置空。
  const broken = { ...plan, parts: plan.parts.map((p, i) => (i === plan.parts.length - 1 ? { ...p, session_id: null } : p)) }
  assert.throws(
    () => applyExport(file, broken, { detectRunning: notRunningStub }),
    (error) => {
      assert.equal(error.code, 'WRITE_FAILED')
      console.log('WRITE_FAILED（事务回滚）→', error.message)
      return true
    },
  )

  const check = new DatabaseSync(file, { readOnly: true })
  try {
    assert.deepEqual(counts(check), before, '失败的导出不许留下任何行')
    assert.equal(check.prepare('SELECT count(*) c FROM session WHERE id = ?').get(plan.session.id).c, 0)
    assert.equal(check.prepare('SELECT count(*) c FROM message WHERE session_id = ?').get(plan.session.id).c, 0)
    assert.equal(check.prepare('SELECT count(*) c FROM part WHERE session_id = ?').get(plan.session.id).c, 0)
    assert.equal(check.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  } finally {
    check.close()
  }

  // 回滚之后库还能正常写（证明没留事务悬挂）。
  // 注意：node:sqlite 的另一个连接**正开着**时再开读写连接会 SQLITE_CANTOPEN，
  // 所以这里先把 check 关掉——插件自己的读连接也都是关掉之后才进入写阶段。
  const recovered = applyExport(file, plan, { detectRunning: notRunningStub })
  assert.ok(recovered.sessionId)
  const after = new DatabaseSync(file, { readOnly: true })
  try {
    assert.equal(after.prepare('SELECT count(*) c FROM session WHERE id = ?').get(plan.session.id).c, 1)
  } finally {
    after.close()
  }
})

test('写 5/6：检测到 ZCode 在跑 → 409 语义（ZCODE_RUNNING）且没有任何写入、连备份都没做', () => {
  const file = freshDb('running')
  const root = `${TMP}\\dsh-root`
  const { file: dshFile } = writeSyntheticDshSession(root, { id: 'session-bridge-test-0005' })
  const log = readSessionFile(dshFile)
  const { ir } = eventsToIR(log.header, log.events)

  const db = openDatabase(file, { readOnly: true })
  let plan
  try {
    plan = planExport(ir, { defaults: inferDefaults(db), project: resolveProjectId(db, ir.cwd) })
  } finally {
    db.close()
  }
  const backupsBefore = listBackups(file)
  assert.equal(backupsBefore.length, 0)

  assert.throws(
    () => applyExport(file, plan, { detectRunning: () => ({ running: true, checked: true, processes: ['ZCode.exe'] }) }),
    (error) => {
      assert.equal(error.code, 'ZCODE_RUNNING')
      assert.match(error.message, /退出 ZCode/)
      console.log('ZCODE_RUNNING →', error.message, JSON.stringify(error.detail))
      return true
    },
  )
  assert.deepEqual(listBackups(file), backupsBefore, '拒绝写在备份之前，不许留下备份')
  const check = new DatabaseSync(file, { readOnly: true })
  try {
    assert.equal(check.prepare('SELECT count(*) c FROM session WHERE id = ?').get(plan.session.id).c, 0)
  } finally {
    check.close()
  }

  // 检测不到进程状态时也不许硬写
  assert.throws(
    () => applyExport(file, plan, { detectRunning: () => ({ running: false, checked: false, processes: [], error: 'tasklist 不可用' }) }),
    (error) => {
      assert.equal(error.code, 'ZCODE_STATE_UNKNOWN')
      return true
    },
  )
})

test('写 6/6：进程检测读的是真机（这里只断言它返回了确定的布尔，不写库）', () => {
  const status = detectZCodeRunning()
  console.log('detectZCodeRunning() →', JSON.stringify(status))
  assert.equal(typeof status.running, 'boolean')
  assert.equal(typeof status.checked, 'boolean')
  if (status.checked) assert.ok(Array.isArray(status.processes))
})

test('写 7/7（回归）：把真库里最大的会话整份写回去（259 message / 949 part），一个事务写完', () => {
  const file = freshDb('volume')
  const db = openDatabase(file, { readOnly: true })
  let plan
  let sessionId
  try {
    const target = db
      .prepare(
        'SELECT id FROM session ORDER BY (SELECT count(*) FROM message m WHERE m.session_id = session.id) DESC LIMIT 1',
      )
      .get()
    sessionId = target.id
    const { ir } = readSessionIR(db, sessionId)
    plan = planExport(ir, { defaults: inferDefaults(db), project: resolveProjectId(db, ir.cwd) })
    console.log('volume plan:', JSON.stringify(plan.counts))
  } finally {
    db.close()
  }
  // 这条是回归守卫：不加 PRAGMA temp_store=MEMORY 时，本机 SQLite 会在写到
  // 第 8 个 WAL 帧左右抛 SQLITE_CANTOPEN(14) "unable to open database file"。
  // force:true 因为副本里本来就有同名会话（这里要的就是"整份重写一遍"）。
  const result = applyExport(file, plan, { detectRunning: notRunningStub, force: true })
  assert.equal(result.inserted.messages, plan.counts.messages)
  assert.equal(result.inserted.parts, plan.counts.parts)
  const check = new DatabaseSync(file, { readOnly: true })
  try {
    const rows = readSessionRows(check, result.sessionId)
    assert.equal(rows.messages.length, plan.counts.messages)
    assert.equal(rows.parts.length, plan.counts.parts)
    assert.equal(check.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
    console.log('volume write ok:', rows.messages.length, 'messages /', rows.parts.length, 'parts')
  } finally {
    check.close()
  }
})

test('project_id 派生：真实库 5/5 命中，且总长 85', () => {
  const file = freshDb('project')
  const db = openDatabase(file, { readOnly: true })
  try {
    const rows = db.prepare('SELECT DISTINCT project_id, directory FROM session').all()
    assert.ok(rows.length > 0)
    for (const row of rows) {
      const derived = resolveProjectId(db, row.directory)
      assert.equal(derived.projectId, row.project_id, `派生失败：${row.directory}`)
      assert.ok(row.project_id.length <= 85)
      console.log('  ', row.project_id.length, row.project_id)
    }
  } finally {
    db.close()
  }
})
