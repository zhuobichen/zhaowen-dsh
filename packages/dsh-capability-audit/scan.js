/**
 * 扫描 DSH 会话日志，抽成紧凑结构（只读；不改任何文件）。
 *
 * 会话文件是 zstd 多帧：先按 magic 切帧再逐帧解。
 * 抽三样东西：
 *   msgs      用户消息（带时间）→ 用来算"触发机会"
 *   calls     工具调用（name/time/callId/args）
 *   results   工具结果（callId/time/ok）
 * 另外从 <available_skills> 里记每个 skill **首次出现的时间**，
 * 这才是"它在这台机器上开始可用"的真实基线（比仓库提交时间更准）。
 */

import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const ERROR_HINT = /^(\s*\[exit code: [1-9]|Exit code [1-9]|Error:|error:|ERROR|Traceback|tool failed|TOOL_OUTCOME_UNKNOWN)/

export function decodeSessionFile(file) {
  const buf = readFileSync(file)
  const offsets = []
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf.compare(MAGIC, 0, 4, i, i + 4) === 0) offsets.push(i)
  }
  let out = ''
  for (let k = 0; k < offsets.length; k++) {
    const start = offsets[k]
    const end = offsets[k + 1] ?? buf.length
    try {
      out += zstdDecompressSync(buf.subarray(start, end)).toString('utf8')
    } catch {
      // 单帧坏掉不拖垮整条会话
    }
  }
  return out
}

/** 列出 <root>/<project>/<session>/session.v4.jsonl.zstd */
export function listSessionFiles(root) {
  const files = []
  let projects
  try {
    projects = readdirSync(root)
  } catch {
    return files
  }
  for (const project of projects) {
    const projectDir = join(root, project)
    let st
    try {
      st = statSync(projectDir)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    let sessions
    try {
      sessions = readdirSync(projectDir)
    } catch {
      continue
    }
    for (const sid of sessions) {
      const file = join(projectDir, sid, 'session.v4.jsonl.zstd')
      try {
        const fst = statSync(file)
        files.push({ file, sessionId: sid, project, mtime: fst.mtimeMs, size: fst.size })
      } catch {
        // 没有这个会话文件就跳过
      }
    }
  }
  return files.sort((a, b) => a.mtime - b.mtime)
}

function parseArgs(raw) {
  if (raw === undefined || raw === null) return {}
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(String(raw))
  } catch {
    return {}
  }
}

/** 解析一条会话文本 → 紧凑结构 */
export function parseSession(text) {
  const msgs = []
  const calls = []
  const results = []
  const usages = [] // 每步 token 用量：{time,turn,step,total}
  const availableSkills = new Map() // name -> first seen ms
  const skillChars = new Map() // name -> { sum, n }（清单里那一行的字符数）

  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    const type = row.type
    const time = Number.isFinite(row.time) ? row.time : 0

    if (type === 'user/message') {
      const body = Array.isArray(row.data?.content)
        ? row.data.content.map((c) => c?.text ?? '').join('')
        : ''
      if (body) msgs.push({ time, text: body })
      const block = body.match(/<available_skills>([\s\S]*?)<\/available_skills>/)
      if (block) {
        for (const line of block[1].split('\n')) {
          const m = line.match(/^\s*-\s*`([^`]+)`/)
          if (!m) continue
          const name = m[1]
          const prev = availableSkills.get(name)
          if (prev === undefined || time < prev) availableSkills.set(name, time)
          // 这一行就是每轮要重复出现的成本（描述越长越贵）
          const rec = skillChars.get(name) ?? { sum: 0, n: 0 }
          rec.sum += line.trim().length
          rec.n += 1
          skillChars.set(name, rec)
        }
      }
    } else if (type === 'assistant/message') {
      const u = row.data?.usage
      if (u && Number.isFinite(u.totalTokens)) {
        usages.push({ time, turn: row.data?.turn, step: row.data?.step, input: u.inputTokens ?? 0, output: u.outputTokens ?? 0, cacheRead: u.cacheReadTokens ?? 0, total: u.totalTokens })
      }
    } else if (type === 'tool/call') {
      const name = row.data?.name
      if (!name) continue
      calls.push({ time, name, callId: row.data?.callId, args: parseArgs(row.data?.arguments), turn: row.data?.turn, step: row.data?.step })
    } else if (type === 'tool/result') {
      const callId = row.data?.toolCallId ?? row.data?.message?.source?.callId
      const body = Array.isArray(row.data?.message?.content)
        ? row.data.message.content.map((c) => c?.text ?? '').join('')
        : ''
      const ok = row.data?.isError === true ? false : !ERROR_HINT.test(body)
      results.push({ time, callId, ok, text: body.slice(0, 400) })
    }
  }

  return { msgs, calls, results, usages, availableSkills, skillChars }
}

/** 扫全部会话 */
export function scanSessions(root) {
  const files = listSessionFiles(root)
  const sessions = []
  let failed = 0
  for (const entry of files) {
    let text
    try {
      text = decodeSessionFile(entry.file)
    } catch {
      failed++
      continue
    }
    const parsed = parseSession(text)
    sessions.push({ ...entry, ...parsed })
  }
  return { sessions, failed, totalFiles: files.length }
}
