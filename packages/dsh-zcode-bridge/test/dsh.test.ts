/**
 * DSH 侧：zstd 多帧解码 / 编码 / 事件 → IR / IR → seed 事件，
 * 并用 **DSH 自己的还原器**（@deepseek-ai/dsh-session-format-catalog）验收。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  decodeFrames,
  encodeFrames,
  encodeSegment,
  eventsToIR,
  findSessionFile,
  irToSeedEvents,
  listDshSessions,
  peekSession,
  readSessionFile,
  scanSessionFiles,
  sessionsRoot,
  splitFrames,
  splitRows,
  writeSessionFile,
} from '../dsh.js'
import { TMP, ensureTmp, freshDb } from './helpers.ts'
import { listSessions, openDatabase, readSessionIR } from '../zcode.js'

/** 找 DSH 的 format catalog（没有就跳过"官方验收"那一段，并明确说出来）。 */
function catalogEntry() {
  const candidates = [
    process.env.DSH_TOOLCHAIN,
    process.env.DSH_HOME === undefined ? undefined : join(process.env.DSH_HOME, '..', 'toolchain'),
    join(homedir(), 'dsh', 'toolchain'),
    'D:\\github_project\\ZhaoWen_GitHub维护\\dsh\\toolchain',
  ].filter(Boolean)
  for (const base of candidates) {
    const file = join(base, 'node_modules', '@deepseek-ai', 'dsh-session-format-catalog', 'lib', 'index.js')
    if (existsSync(file)) return file
  }
  return undefined
}

/** 用 DSH 自己的还原器校验一份 {header, events}；抛错就是 DSH 会拒收的理由。 */
async function validateWithDsh(header, events) {
  const entry = catalogEntry()
  if (entry === undefined) return { skipped: true }
  const catalog = await import(pathToFileURL(entry).href)
  const restore = catalog.sessionFormatCatalog.createRestore(header, { recovery: 'strict', validation: 'current' })
  for (const event of events) restore.decodeRow(event)
  const artifact = restore.finish()
  return { skipped: false, events: artifact.events.length, header: artifact.header }
}

/** 找本机一个真实的 DSH 会话文件（优先带工具调用的）。 */
function pickRealSession() {
  const root = sessionsRoot()
  const files = scanSessionFiles(root).map((entry) => entry.file).filter((file) => existsSync(file))
  assert.ok(files.length > 0, `本机 DSH 会话目录里没有会话文件：${root}`)
  for (const file of files) {
    try {
      const log = readSessionFile(file)
      if (log.events.length >= 20 && log.events.some((e) => e.type === 'tool/call')) return log
    } catch {
      // 坏文件跳过
    }
  }
  return readSessionFile(files[0])
}

test('DSH 1/4：解一个真实会话文件 → header + 至少 20 条事件', () => {
  const log = pickRealSession()
  console.log('real session:', log.file)
  console.log('  bytes:', log.bytes, 'frames:', log.frames, 'events:', log.events.length)
  assert.equal(log.header.type, 'session')
  assert.equal(log.header.version, 4)
  assert.equal(typeof log.header.id, 'string')
  assert.ok(log.header.id.startsWith('session-'))
  assert.equal(typeof log.header.createdAt, 'number')
  assert.ok(log.events.length >= 20, `至少 20 条事件，实际 ${log.events.length}`)
  assert.ok(log.frames >= 2, 'header 与事件分帧')
  // seq 连续
  log.events.forEach((event, index) => {
    assert.equal(event.seq, index, `第 ${index} 条事件的 seq 不连续`)
    assert.ok(Number.isSafeInteger(event.time))
  })
  // 首帧只有 header → 第一帧解出来正好一行
  const buf = readFileSync(log.file)
  const frames = splitFrames(buf)
  const firstFrameText = decodeFrames(buf.subarray(frames[0].offset, frames[0].end)).rows.length
  assert.equal(firstFrameText, 1, '第 1 帧只有 header 行')
})

test('DSH 2/4：编码回去 → 再解 → 结构一致（header + 事件逐字相同）', () => {
  const log = pickRealSession()
  const buffer = encodeFrames(log.header, log.events, { batch: 500 })
  ensureTmp()
  const out = join(TMP, 'roundtrip.v4.jsonl.zstd')
  writeFileSync(out, buffer)
  const again = readSessionFile(out)
  assert.equal(again.header.id, log.header.id)
  assert.equal(again.header.cwd, log.header.cwd)
  assert.equal(again.header.createdAt, log.header.createdAt)
  assert.equal(again.events.length, log.events.length)
  assert.deepEqual(again.events, log.events)
  assert.deepEqual(again.header, log.header)
  // 小批量分帧也能解回同样的行
  const smallBatch = encodeFrames(log.header, log.events, { batch: 7 })
  const smallRows = decodeFrames(smallBatch).rows
  assert.deepEqual(smallRows, [log.header, ...log.events])
  console.log('roundtrip ok:', again.frames, 'frames,', again.events.length, 'events; batch=7 →', splitFrames(smallBatch).length, 'frames')
})

test('DSH 3/4：真实会话 → IR → seed 事件 → 用 DSH 自己的还原器验收', async () => {
  const log = pickRealSession()
  const { ir } = eventsToIR(log.header, log.events)
  console.log('IR counts:', JSON.stringify(ir.counts))
  console.log('IR ignored:', JSON.stringify(ir.ignored))
  assert.ok(ir.messages.length > 0)
  assert.ok(ir.counts.toolCalls > 0, '真实会话里应该有工具调用')
  const sample = ir.messages.slice(0, 4).map((m) => ({ role: m.role, kinds: m.parts.map((p) => p.kind) }))
  console.log('IR sample:', JSON.stringify(sample))

  const plan = irToSeedEvents(ir, {
    cwd: ir.cwd,
    createdAt: ir.createdAt,
    id: 'session-bridge-roundtrip-0001',
    title: ir.title,
  })
  assert.ok(plan.events.length > 0)
  // 第一个 surface 节点必须是 system/message
  const firstSurface = plan.events.find((e) => e.surfaceOp !== undefined)
  assert.equal(firstSurface.type, 'system/message')
  // 每个 tool/call 都被 assistant 消息公示过
  const declared = new Set()
  for (const event of plan.events) {
    if (event.type === 'assistant/message') {
      for (const block of event.data.message.content) if (block.type === 'tool-call') declared.add(block.id)
    }
    if (event.type === 'tool/call') assert.ok(declared.has(event.data.callId), `call ${event.data.callId} 没被公示`)
  }
  // 同一 step 内的 tool/result 都有对应 call
  const openCalls = new Set()
  for (const event of plan.events) {
    if (event.type === 'tool/call') openCalls.add(event.data.callId)
    if (event.type === 'tool/result') assert.ok(openCalls.delete(event.data.message.toolCallId))
  }
  assert.equal(openCalls.size, 0, 'step 结束时不该有悬空调用')

  const verdict = await validateWithDsh(plan.header, plan.events)
  console.log('DSH catalog 验收 →', JSON.stringify(verdict))
  if (verdict.skipped) {
    console.log('SKIP: 本机找不到 dsh-session-format-catalog，跳过官方还原器验收（结构断言仍然跑过）')
  } else {
    assert.equal(verdict.events, plan.events.length)
  }
})

test('DSH 4/4：ZCode 真实会话 → IR → seed 事件 → 也用 DSH 的还原器验收', async () => {
  const file = freshDb('dsh-from-zcode')
  const db = openDatabase(file, { readOnly: true })
  let ir
  let session
  try {
    const target = listSessions(db).find((s) => s.messages > 0)
    const read = readSessionIR(db, target.id)
    ir = read.ir
    session = read.session
  } finally {
    db.close()
  }
  const plan = irToSeedEvents(ir, {
    cwd: ir.cwd,
    createdAt: ir.createdAt,
    id: 'session-bridge-from-zcode-0001',
    title: ir.title,
  })
  const counts = {
    events: plan.events.length,
    turns: plan.events.filter((e) => e.type === 'turn/start').length,
    steps: plan.events.filter((e) => e.type === 'step/start').length,
    userMessages: plan.events.filter((e) => e.type === 'user/message').length,
    assistantMessages: plan.events.filter((e) => e.type === 'assistant/message').length,
    toolCalls: plan.events.filter((e) => e.type === 'tool/call').length,
    toolResults: plan.events.filter((e) => e.type === 'tool/result').length,
  }
  console.log('ZCode → DSH：', session.title, JSON.stringify(counts))
  assert.ok(counts.toolCalls > 0)
  assert.equal(counts.toolCalls, counts.toolResults, '每个调用都要有结果')

  const verdict = await validateWithDsh(plan.header, plan.events)
  console.log('DSH catalog 验收 →', JSON.stringify(verdict))
  if (verdict.skipped) {
    console.log('SKIP: 本机找不到 dsh-session-format-catalog，跳过官方还原器验收')
  } else {
    assert.equal(verdict.events, plan.events.length)
  }

  // 也能真的落成文件，再解回来
  const written = writeSessionFile(join(TMP, 'from-zcode', 'session.v4.jsonl.zstd'), plan.header, plan.events, {
    overwrite: true,
  })
  const back = readSessionFile(written.file)
  assert.equal(back.header.cwd, ir.cwd)
  assert.equal(back.events.length, plan.events.length)
  console.log('file ok:', written.bytes, 'bytes')
})

test('DSH 辅助：encodeSegment / logPath / peek / find / list 都对得上', () => {
  const log = pickRealSession()
  const root = sessionsRoot()
  const dir = join(root, '..', 'sessions') // 同一个根
  // 目录编码可逆且与真实目录名一致
  const entries = scanSessionFiles(root)
  assert.ok(entries.length > 0)
  const entry = entries.find((e) => e.file === log.file) ?? entries[0]
  assert.equal(encodeSegment(log.header.id), entry.dirName)
  assert.ok(entry.projectDir.startsWith('--') && entry.projectDir.endsWith('--'))

  // findSessionFile 能按 id 找到
  const found = findSessionFile(root, log.header.id)
  assert.equal(found, log.file)

  // peek 不解全日志也能拿到 header + 标题
  const peeked = peekSession(log.file, { maxFrames: 3 })
  assert.equal(peeked.header.id, log.header.id)
  console.log('peek:', peeked.header.id, '|', peeked.title, '| partial:', peeked.partial)

  // list 能列出全部会话
  const listed = listDshSessions(root, { maxFrames: 3 })
  assert.ok(listed.length >= entries.length)
  assert.ok(listed.some((s) => s.id === log.header.id))
  console.log('listDshSessions →', listed.length, '个；前 3：')
  for (const session of listed.slice(0, 3)) console.log('  ', session.id, '|', session.title, '|', session.cwd)
})
