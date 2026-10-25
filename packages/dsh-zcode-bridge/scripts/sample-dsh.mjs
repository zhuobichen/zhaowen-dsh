/**
 * 证据脚本（只读）：解一个真实 DSH v4 会话文件，打 header + 事件类型 + 每种事件的第一条。
 *
 *   node scripts/sample-dsh.mjs [file]
 *
 * 不给 file 就用本机 sessions 根下第一个 >=20 条事件、且含 tool/call 的会话。
 */
import { existsSync } from 'node:fs'

import { eventsToIR, readSessionFile, scanSessionFiles, sessionsRoot } from '../dsh.js'

function pick() {
  const files = scanSessionFiles(sessionsRoot()).map((e) => e.file).filter((f) => existsSync(f))
  for (const file of files) {
    try {
      const log = readSessionFile(file)
      if (log.events.length >= 20 && log.events.some((e) => e.type === 'tool/call')) return log
    } catch {
      // 坏文件跳过
    }
  }
  return files.length > 0 ? readSessionFile(files[0]) : undefined
}

const file = process.argv[2]
const log = file === undefined ? pick() : readSessionFile(file)
if (log === undefined) {
  console.error('本机找不到 DSH 会话文件')
  process.exit(1)
}

console.log('# file:', log.file)
console.log('  bytes:', log.bytes, 'frames:', log.frames, 'events:', log.events.length)
console.log('\n## header')
console.log(JSON.stringify(log.header, null, 1))

const types = new Map()
for (const event of log.events) types.set(event.type, (types.get(event.type) ?? 0) + 1)
console.log('\n## 事件类型分布')
console.log(Object.fromEntries([...types].sort((a, b) => b[1] - a[1])))

console.log('\n## 关键事件的第一条')
for (const type of ['turn/start', 'step/start', 'system/message', 'user/message', 'assistant/message', 'tool/call', 'tool/result', 'step/end', 'turn/end', 'session/title']) {
  const event = log.events.find((e) => e.type === type)
  if (event === undefined) continue
  console.log(`\n### ${type} (seq ${event.seq}, surfaceOp=${event.surfaceOp ?? '-'})`)
  console.log(JSON.stringify(event).slice(0, 600))
}

const { ir } = eventsToIR(log.header, log.events)
console.log('\n## 事件 → IR')
console.log('  counts:', JSON.stringify(ir.counts))
console.log('  ignored:', JSON.stringify(ir.ignored))
for (const message of ir.messages.slice(0, 4)) {
  console.log(`  ${message.role} turn=${message.turnId} parts=[${message.parts.map((p) => p.kind).join(',')}]`)
}
