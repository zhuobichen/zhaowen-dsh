// fork 收尾事件（forkedTailClosers）的回归测试。
//
// 钉住两件事：
//   1. 默认边界（最后一个完整 turn）→ 不补任何收尾事件（与旧行为一致）
//   2. atSeq 落在 turn 中间 → 按 DSH 的语义补齐
//        · 未回款的 tool/call  → tool/result（error，TOOL_OUTCOME_UNKNOWN）
//        · 只公示未开始的调用  → tool/result（error，TOOL_NOT_STARTED）
//        · 未闭合 step        → step/end
//        · 未闭合 turn        → turn/end（reason.kind = 'forked'）
//      且 seq 连续、title 排在最后
//
// 跑：node --test test/fork-closers.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdCompressSync } from 'node:zlib'

import { planFork, TOOL_NOT_STARTED, TOOL_OUTCOME_UNKNOWN } from '../src/dsh_format.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const WORK = join(HERE, '..', '.tmp', 'fork-closers')

/** 写一份 v4 会话日志：header 单独一帧 + 其余事件一帧。 */
const writeLog = (name, header, events) => {
  const dir = join(WORK, name)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'session.v4.jsonl.zstd')

  writeFileSync(file, Buffer.concat([
    zstdCompressSync(Buffer.from(JSON.stringify(header) + '\n', 'utf8')),
    zstdCompressSync(Buffer.from(events.map((e) => JSON.stringify(e) + '\n').join(''), 'utf8')),
  ]))

  return file
}

const header = { type: 'session', version: 4, id: 'session-src-0000', createdAt: 1, cwd: 'D:\\work' }

/** 一个完整的 turn（turn/start → … → turn/end），末尾闭合。 */
const closedTurn = () => ([
  { type: 'turn/start', seq: 0, time: 10, data: { turn: 1 } },
  { type: 'step/start', seq: 1, time: 10, data: { turn: 1, step: 1 } },
  { type: 'user/message', seq: 2, time: 10, data: { content: [{ type: 'text', text: 'hi' }] }, surfaceOp: 'append' },
  { type: 'assistant/message', seq: 3, time: 11, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'ok' }] } } },
  { type: 'step/end', seq: 4, time: 12, data: { turn: 1, step: 1 } },
  { type: 'turn/end', seq: 5, time: 12, data: { turn: 1, reason: { kind: 'complete' } } },
])

test.before(() => {
  rmSync(WORK, { recursive: true, force: true })
  mkdirSync(WORK, { recursive: true })
})

test.after(() => {
  rmSync(WORK, { recursive: true, force: true })
})

test('默认边界（完整 turn）：不补收尾事件', () => {
  const file = writeLog('closed', header, closedTurn())
  const plan = planFork(file, { title: 't' })

  const types = plan.events.map((e) => e.type)
  assert.equal(plan.boundary, 5)
  assert.deepEqual(types.slice(-2), ['session/end-seed', 'session/title'])
  assert.equal(plan.events.at(-1).seq, 7, 'title 应紧跟 end-seed（seq 6 → 7）')
  assert.equal(plan.events.some((e) => e.type === 'turn/end' && e.data?.reason?.kind === 'forked'), false)
})

test('atSeq 落在 turn 中间：补 error result + step/end + turn/end(forked)', () => {
  // turn 没结束，且 call_a 已经开始（有 tool/call）但没结果
  const events = [
    { type: 'turn/start', seq: 0, time: 10, data: { turn: 1 } },
    { type: 'step/start', seq: 1, time: 10, data: { turn: 1, step: 1 } },
    { type: 'assistant/message', seq: 2, time: 11, data: { turn: 1, step: 1, message: { content: [{ type: 'tool-call', id: 'call_a', name: 'x', arguments: '{}' }] } } },
    { type: 'tool/call', seq: 3, time: 11, data: { turn: 1, step: 1, callId: 'call_a' } },
  ]
  const file = writeLog('open', header, events)
  const plan = planFork(file, { title: 't', atSeq: 3 })

  const tail = plan.events.slice(-5)
  assert.equal(plan.boundary, 3)
  assert.deepEqual(tail.map((e) => e.type), [
    'session/end-seed',
    'tool/result',
    'step/end',
    'turn/end',
    'session/title',
  ])

  // 逐条断言
  const endSeed = plan.events.find((e) => e.type === 'session/end-seed')
  const result = plan.events.find((e) => e.type === 'tool/result')
  const stepEnd = plan.events.find((e) => e.type === 'step/end')
  const turnEnd = plan.events.find((e) => e.type === 'turn/end')

  assert.ok(endSeed && result && stepEnd && turnEnd, '缺少某个收尾事件')
  assert.equal(result.data.message.isError, true)
  assert.equal(result.data.error.code, TOOL_OUTCOME_UNKNOWN, '已开始的调用应标 OUTCOME_UNKNOWN')
  assert.deepEqual(result.sourceEventSeqs, [3], '应指回 tool/call 的 seq')
  assert.equal(result.data.message.toolCallId, 'call_a')
  assert.equal(turnEnd.data.reason.kind, 'forked')

  // seq 必须连续：后缀从 end-seed 开始一路 +1
  const from = plan.events.findIndex((e) => e.type === 'session/end-seed')
  const tailSeqs = plan.events.slice(from).map((e) => e.seq)
  assert.deepEqual(tailSeqs, tailSeqs.map((_, i) => tailSeqs[0] + i), 'seq 不连续：' + tailSeqs.join(','))
})

test('只公示、没开始的调用：标 TOOL_NOT_STARTED，且不带 sourceEventSeqs', () => {
  const events = [
    { type: 'turn/start', seq: 0, time: 10, data: { turn: 1 } },
    { type: 'step/start', seq: 1, time: 10, data: { turn: 1, step: 1 } },
    { type: 'assistant/message', seq: 2, time: 11, data: { turn: 1, step: 1, message: { content: [{ type: 'tool-call', id: 'call_b', name: 'y', arguments: '{}' }] } } },
  ]
  const file = writeLog('notstarted', header, events)
  const plan = planFork(file, { title: 't', atSeq: 2 })

  const result = plan.events.find((e) => e.type === 'tool/result')
  assert.ok(result, '缺少 tool/result')
  assert.equal(result.data.error.code, TOOL_NOT_STARTED)
  assert.equal(result.sourceEventSeqs, undefined, '没开始过就不该指回 call 事件')
})

test('已回款的调用不会被补', () => {
  const events = [
    { type: 'turn/start', seq: 0, time: 10, data: { turn: 1 } },
    { type: 'step/start', seq: 1, time: 10, data: { turn: 1, step: 1 } },
    { type: 'assistant/message', seq: 2, time: 11, data: { turn: 1, step: 1, message: { content: [{ type: 'tool-call', id: 'call_c', name: 'z', arguments: '{}' }] } } },
    { type: 'tool/call', seq: 3, time: 11, data: { turn: 1, step: 1, callId: 'call_c' } },
    { type: 'tool/result', seq: 4, time: 12, data: { turn: 1, step: 1, message: { source: { callId: 'call_c' }, content: [] } }, surfaceOp: 'append' },
  ]
  const file = writeLog('answered', header, events)
  const plan = planFork(file, { title: 't', atSeq: 4 })

  assert.equal(plan.events.some((e) => e.type === 'tool/result' && e.data?.message?.isError === true), false, '已回款不该再补')
  // step/turn 仍然要关
  assert.ok(plan.events.some((e) => e.type === 'step/end'))
  assert.ok(plan.events.some((e) => e.type === 'turn/end' && e.data?.reason?.kind === 'forked'))
})
