/**
 * 证据脚本（只读）：把 ZCode 库的 schema、枚举、真实形状、project_id 推导一次性打出来。
 *
 *   node scripts/sample-zcode.mjs [dbPath]
 *
 * 缺省读 `.tmp/base.sqlite`（测试准备的副本）；给 `--real` 才读真库（仍然只读）。
 * README 里所有"抽样证据"都出自这个脚本。
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defaultDbPath, projectIdForDirectory, PROJECT_ID_MAX } from '../zcode.js'

const here = dirname(fileURLToPath(import.meta.url))
const arg = process.argv[2]
const dbPath = arg === '--real' ? defaultDbPath() : (arg ?? join(here, '..', '.tmp', 'base.sqlite'))

if (!existsSync(dbPath)) {
  console.error(`没有可读的库：${dbPath}`)
  console.error('先跑一次 `node --test test/zcode.test.ts` 让 .tmp/base.sqlite 生成，或用 --real 读真库（只读）。')
  process.exit(1)
}

const db = new DatabaseSync(dbPath, { readOnly: true })
const q = (sql, ...args) => db.prepare(sql).all(...args)
const parse = (raw) => {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}
const count = (map) => Object.fromEntries([...map].sort((a, b) => b[1] - a[1]))

console.log(`# db: ${dbPath}  (readOnly)`)

console.log('\n## 表与行数')
const tables = q("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map((r) => r.name)
for (const name of tables) {
  const n = q(`SELECT count(*) c FROM "${name}"`)[0].c
  if (name === 'session' || name === 'message' || name === 'part' || n > 0) console.log(`  ${name.padEnd(24)} ${n}`)
}
console.log('  triggers:', q("SELECT name FROM sqlite_master WHERE type='trigger'").map((r) => r.name).join(', ') || '(none)')

console.log('\n## part.data.type')
const partTypes = new Map()
const toolStatus = new Map()
const shapes = new Map()
for (const row of q('SELECT data FROM part')) {
  const data = parse(row.data)
  if (data === undefined) {
    partTypes.set('<unparsable>', (partTypes.get('<unparsable>') ?? 0) + 1)
    continue
  }
  const type = String(data.type)
  partTypes.set(type, (partTypes.get(type) ?? 0) + 1)
  if (type === 'tool') toolStatus.set(String(data.state?.status), (toolStatus.get(String(data.state?.status)) ?? 0) + 1)
  const key = `${type}|${data.state?.status ?? ''}`
  if (!shapes.has(key)) {
    const clone = JSON.parse(JSON.stringify(data))
    for (const field of ['text']) if (typeof clone[field] === 'string') clone[field] = clone[field].slice(0, 90) + '…'
    if (typeof clone.state?.output === 'string') clone.state.output = clone.state.output.slice(0, 90) + '…'
    shapes.set(key, clone)
  }
}
console.log(count(partTypes))
console.log('  tool.state.status:', count(toolStatus))
console.log('\n## part 形状（每种一条）')
for (const [key, shape] of shapes) console.log(' ', key, '→', JSON.stringify(shape))

console.log('\n## message.data.role / semantics.*')
const roles = new Map()
const origin = new Map()
const kind = new Map()
const ui = new Map()
const provider = new Map()
const transcript = new Map()
for (const row of q('SELECT data FROM message')) {
  const data = parse(row.data)
  if (data === undefined) continue
  roles.set(String(data.role), (roles.get(String(data.role)) ?? 0) + 1)
  const s = data.semantics ?? {}
  origin.set(String(s.origin), (origin.get(String(s.origin)) ?? 0) + 1)
  kind.set(String(s.kind), (kind.get(String(s.kind)) ?? 0) + 1)
  ui.set(String(s.uiVisibility), (ui.get(String(s.uiVisibility)) ?? 0) + 1)
  provider.set(String(s.providerVisibility), (provider.get(String(s.providerVisibility)) ?? 0) + 1)
  transcript.set(String(s.transcriptVisibility), (transcript.get(String(s.transcriptVisibility)) ?? 0) + 1)
}
console.log('  role:', count(roles))
console.log('  semantics.origin:', count(origin))
console.log('  semantics.kind:', count(kind))
console.log('  uiVisibility:', count(ui))
console.log('  providerVisibility:', count(provider))
console.log('  transcriptVisibility:', count(transcript))

console.log('\n## project_id 推导（规则与命中）')
console.log(`  project_id = ("proj_" + lower(directory).replace(/[\\\\/:]+/g, "-")).slice(0, ${PROJECT_ID_MAX})`)
const pairs = q('SELECT DISTINCT project_id, directory FROM session')
let hits = 0
for (const pair of pairs) {
  const derived = projectIdForDirectory(pair.directory)
  const ok = derived === pair.project_id
  if (ok) hits += 1
  console.log(`  ${ok ? 'HIT ' : 'MISS'} len=${String(pair.project_id).length}  ${pair.project_id}`)
  if (!ok) console.log(`         derived: ${derived}\n         dir    : ${pair.directory}`)
}
console.log(`  → ${hits}/${pairs.length} 命中`)

console.log('\n## session 行的环境字段（新行就照这些值写）')
const latest = q('SELECT id, version, permission, task_type, title_source FROM session ORDER BY time_updated DESC LIMIT 1')[0]
console.log(' ', JSON.stringify(latest))

console.log('\n## 样例会话（前 3）')
for (const row of q('SELECT s.id, s.title, s.directory, s.version, s.task_type, s.title_source, count(m.id) c FROM session s LEFT JOIN message m ON m.session_id = s.id GROUP BY s.id ORDER BY s.time_updated DESC LIMIT 3')) {
  console.log(' ', JSON.stringify(row))
  for (const message of q('SELECT id, sequence, data FROM message WHERE session_id = ? ORDER BY sequence LIMIT 2', row.id)) {
    const data = parse(message.data)
    console.log(`    msg#${message.sequence} ${message.id} role=${data.role} kind=${data.semantics?.kind} turn=${data.anchor?.turnId}`)
    for (const part of q('SELECT sequence, data FROM part WHERE message_id = ? ORDER BY sequence LIMIT 6', message.id)) {
      const p = parse(part.data)
      console.log(`      part#${part.sequence} ${p.type}${p.type === 'tool' ? ' ' + p.tool + ' ' + p.state?.status : ''}`)
    }
  }
}
db.close()

console.log('\n## .tmp 里的副本（绝不写真库）')
if (existsSync(join(here, '..', '.tmp'))) {
  for (const name of readdirSync(join(here, '..', '.tmp')).slice(0, 8)) console.log(' ', name)
}
