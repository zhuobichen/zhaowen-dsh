/**
 * dsh.js —— DSH v4 会话日志的读写与事件 ↔ IR。
 *
 * 物理格式（本机实测 + `@zhuobicen/dsh-import` 的 dsh_format.ts 同源约定）：
 *   `<DSH_HOME>/sessions/--<projectKey(cwd)>--/<session-id>/session.v4.jsonl.zstd`
 *   一串**独立的 zstd 帧**：第 1 帧只有 header 行，之后每帧若干事件行（按 magic 28 B5 2F FD 切）。
 *
 * 这里的写入严格度是按 DSH 自己的还原器反推的，不是"能解析就行"：
 *   - tool/call 必须被前一条 assistant 消息里的 tool-call 块"公示"，name/arguments 逐字相同
 *   - step/end 不能留下未回款的调用
 *   - tool/result 必须在本 step 内有对应 call
 *   - turn/step 从 1 连续；时间戳单调不减、非负安全整数
 *   - system/message 必须是 surface 的**第一个**节点（否则续聊追加会写进中间、日志被判损坏）
 *
 * 模块自身不 import 任何 DSH 包：纯 JS + node: 内置模块，可独立跑测试。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'

export const FORMAT_VERSION = 4
export const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const SAFE = /[A-Za-z0-9_.-]/

const escapeUnit = (ch) => '~' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')

/** 任意字符串 → 安全的单段路径名（与 DSH format.ts 的 encodeSegment 等价）。 */
export function encodeSegment(raw) {
  if (!raw) throw new Error('empty segment')
  let out = ''
  for (const ch of raw) out += SAFE.test(ch) ? ch : escapeUnit(ch)
  if (out === '.' || out === '..') out = out.replace(/\./g, '~002E')
  return out
}

/** cwd → 可读项目目录名（分隔符并成 `-`，非安全码元转 ~XXXX）。 */
export function projectKey(cwd) {
  return String(cwd)
    .replace(/[\\/:]+/g, '-')
    .replace(/[^A-Za-z0-9_.-]/g, (ch) => escapeUnit(ch))
}

export function sessionsRoot(root) {
  if (root) return root
  const home = process.env.DSH_HOME
  if (home) return join(home, 'sessions')
  return join(homedir(), '.dsh', 'sessions')
}

export function projectDir(root, cwd) {
  return join(root, cwd === undefined ? '_no-cwd' : `--${projectKey(cwd)}--`)
}

export function sessionDir(root, cwd, id) {
  return join(projectDir(root, cwd), encodeSegment(id))
}

export function logPath(root, cwd, id, version = FORMAT_VERSION) {
  return join(sessionDir(root, cwd, id), `session.v${version}.jsonl.zstd`)
}

//#region zstd 多帧
/** 把 buffer 按 zstd magic 切成帧区间。 */
export function splitFrames(buf) {
  const offsets = []
  for (let i = buf.indexOf(ZSTD_MAGIC); i >= 0; i = buf.indexOf(ZSTD_MAGIC, i + 4)) offsets.push(i)
  if (offsets.length === 0) throw new Error('no zstd frame found')
  return offsets.map((offset, k) => ({
    offset,
    end: k + 1 < offsets.length ? offsets[k + 1] : buf.length,
  }))
}

/** 解一串 zstd 帧里的所有 JSONL 行。 */
export function decodeFrames(buf) {
  const frames = splitFrames(buf)
  const rows = []
  for (const frame of frames) {
    const text = zstdDecompressSync(buf.subarray(frame.offset, frame.end)).toString('utf8')
    for (const line of text.split('\n')) if (line.trim() !== '') rows.push(JSON.parse(line))
  }
  return { frames: frames.length, rows }
}

/** 行 → {header, events}（首行是 header）。 */
export function splitRows(rows) {
  if (rows.length === 0) throw new Error('session log is empty')
  const [header, ...events] = rows
  if (header === null || typeof header !== 'object' || header.type !== 'session') {
    throw new Error('first row is not a session header')
  }
  return { header, events }
}

/** header + events → 多帧 buffer（第 1 帧只有 header，与真实日志一致）。 */
export function encodeFrames(header, events, options = {}) {
  const batch = Math.max(1, Number(options.batch ?? 500))
  const frames = [
    zstdCompressSync(Buffer.from(JSON.stringify(header) + '\n', 'utf8')),
  ]
  for (let i = 0; i < events.length; i += batch) {
    const text = events.slice(i, i + batch).map((e) => JSON.stringify(e) + '\n').join('')
    frames.push(zstdCompressSync(Buffer.from(text, 'utf8')))
  }
  return Buffer.concat(frames)
}

/** 读一个会话文件（不解校验，只解编码）。 */
export function readSessionFile(file) {
  const buf = readFileSync(file)
  const { frames, rows } = decodeFrames(buf)
  const { header, events } = splitRows(rows)
  return { file, bytes: buf.length, frames, header, events, rows }
}

/** 写一个会话文件（先建目录；默认不覆盖）。 */
export function writeSessionFile(file, header, events, options = {}) {
  if (existsSync(file) && options.overwrite !== true) throw new Error(`refusing to overwrite ${file}`)
  mkdirSync(dirname(file), { recursive: true })
  const buf = encodeFrames(header, events, options)
  writeFileSync(file, buf)
  return { file, bytes: buf.length, frames: splitFrames(buf).length }
}

/**
 * 列表用：逐帧往下解，拿到 header + 标题就停，不解整份日志。
 * 真实 DSH 日志的帧切得很碎（71 条事件能有 41 帧），标题事件不一定在前几帧，
 * 所以这里"按需继续解"，而不是傻解固定帧数。
 */
export function peekSession(file, options = {}) {
  const maxFrames = Math.max(1, Number(options.maxFrames ?? 12))
  const buf = readFileSync(file)
  const frames = splitFrames(buf)
  const rows = []
  let title
  let userText
  let used = 0
  for (const frame of frames.slice(0, maxFrames)) {
    used += 1
    const text = zstdDecompressSync(buf.subarray(frame.offset, frame.end)).toString('utf8')
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      const row = JSON.parse(line)
      rows.push(row)
      if (title === undefined && row.type === 'session/title' && typeof row.data?.title === 'string') {
        title = row.data.title
      }
      if (userText === undefined && row.type === 'user/message') {
        const text = (Array.isArray(row.data?.content) ? row.data.content : [])
          .filter((b) => b?.type === 'text')
          .map((b) => b.text)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
        if (text !== '') userText = text.slice(0, 60)
      }
    }
    // 有标题就够了；没有标题但有首条用户消息时再往下看两帧，够不着就用它兜底。
    if (title !== undefined || used >= maxFrames) break
  }
  const { header } = splitRows(rows)
  return { file, header, title: title ?? userText, partial: frames.length > used }
}

/** 列出本机所有 DSH 会话（只 peek，不解全日志）。 */
export function listDshSessions(root, options = {}) {
  const out = []
  for (const entry of scanSessionFiles(root)) {
    try {
      const peeked = peekSession(entry.file, options)
      out.push({
        id: peeked.header.id,
        title: peeked.title,
        cwd: peeked.header.cwd,
        createdAt: peeked.header.createdAt,
        file: entry.file,
        bytes: existsSync(entry.file) ? readFileSync(entry.file).length : undefined,
      })
    } catch (error) {
      out.push({ id: entry.dirName, error: String(error?.message ?? error), file: entry.file })
    }
  }
  out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  return out
}

/** 在 sessions 根下按 id 找文件（O(项目数)，不读内容）。 */
export function findSessionFile(root, id) {
  const base = sessionsRoot(root)
  if (!existsSync(base)) return undefined
  const wanted = encodeSegment(id)
  for (const dir of readdirSync(base, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    const candidate = join(base, dir.name, wanted, `session.v${FORMAT_VERSION}.jsonl.zstd`)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/** 列出会话文件（不解析内容，只给路径 + 目录名）。 */
export function scanSessionFiles(root) {
  const base = sessionsRoot(root)
  if (!existsSync(base)) return []
  const out = []
  for (const dir of readdirSync(base, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    const projectPath = join(base, dir.name)
    for (const sub of readdirSync(projectPath, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue
      const file = join(projectPath, sub.name, `session.v${FORMAT_VERSION}.jsonl.zstd`)
      if (existsSync(file)) out.push({ projectDir: dir.name, dirName: sub.name, file })
    }
  }
  return out
}
//#endregion

//#region IR（两个方向的公共中间表示）
/**
 * IR：
 * {
 *   title?, cwd?, createdAt?,
 *   messages: [{
 *     role: 'user' | 'assistant',
 *     id, at, turnId,
 *     parts: [{kind:'text',text} | {kind:'reasoning',text} |
 *             {kind:'tool',callId,name,input,output,isError,status}],
 *     provider?, model?, tokens?, completedAt?, finish?
 *   }],
 *   counts: {...}
 * }
 */
export const IR_VERSION = 1

const textOf = (blocks, type) =>
  (Array.isArray(blocks) ? blocks : [])
    .filter((b) => b && b.type === type && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')

/** 一条 DSH 消息的 content → IR parts（tool-call 块单独成 tool part）。 */
function contentToParts(content, calls) {
  const parts = []
  for (const block of Array.isArray(content) ? content : []) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push({ kind: 'text', text: block.text })
    else if (block.type === 'reasoning' && typeof block.text === 'string') parts.push({ kind: 'reasoning', text: block.text })
    else if (block.type === 'tool-call') {
      const raw = typeof block.arguments === 'string' ? block.arguments : JSON.stringify(block.arguments ?? {})
      calls.set(block.id, { name: block.name, arguments: raw })
      parts.push({
        kind: 'tool',
        callId: block.id,
        name: block.name,
        arguments: raw,
        input: safeJson(raw),
        status: 'running',
        output: undefined,
        isError: false,
      })
    }
  }
  return parts
}

function safeJson(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/** 工具结果：优先取 content 里的 text 块，退到 JSON。 */
function resultText(message) {
  if (!message || typeof message !== 'object') return ''
  const text = textOf(message.content, 'text')
  if (text !== '') return text
  return JSON.stringify(message.content ?? null)
}

/**
 * DSH 事件流 → IR。
 * @param header 会话 header
 * @param events 事件数组
 * @returns {{ir: object, ignored: Map<string, number>}}
 */
export function eventsToIR(header, events) {
  const messages = []
  const calls = new Map()
  const byCallId = new Map()
  const ignored = new Map()
  let title
  let turn = 0
  let turnId = 'turn-1'
  let systemMessages = 0
  let orphanResults = 0
  let toolCalls = 0

  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    const type = event.type
    const data = event.data ?? {}
    switch (type) {
      case 'turn/start': {
        turn = Number(data.turn ?? turn + 1)
        turnId = `turn-${turn}`
        break
      }
      case 'session/title': {
        if (typeof data.title === 'string' && data.title.trim() !== '') title = data.title
        break
      }
      case 'system/message': {
        systemMessages += 1
        break
      }
      case 'user/message': {
        const parts = []
        const text = textOf(data.content, 'text')
        if (text !== '') parts.push({ kind: 'text', text })
        for (const block of Array.isArray(data.content) ? data.content : []) {
          if (block && block.type === 'image') parts.push({ kind: 'text', text: '[image omitted]' })
        }
        if (parts.length === 0) parts.push({ kind: 'text', text: '' })
        messages.push({
          role: 'user',
          id: data.id ?? `user-${event.seq}`,
          at: event.time,
          turnId,
          parts,
          synthetic: data.source?.kind !== undefined && data.source.kind !== 'user',
        })
        break
      }
      case 'assistant/message': {
        const message = data.message ?? {}
        const parts = contentToParts(message.content, calls)
        for (const part of parts) if (part.kind === 'tool') byCallId.set(part.callId, part)
        messages.push({
          role: 'assistant',
          id: message.id ?? `assistant-${event.seq}`,
          at: event.time,
          turnId,
          parts,
          provider: message.source?.provider,
          model: message.source?.model,
          tokens: data.usage,
          completedAt: data.time?.completed,
        })
        break
      }
      case 'tool/call': {
        toolCalls += 1
        if (typeof data.callId === 'string' && !calls.has(data.callId)) {
          calls.set(data.callId, { name: data.name, arguments: String(data.arguments ?? '{}') })
        }
        break
      }
      case 'tool/result': {
        const callId = data.message?.toolCallId ?? data.message?.source?.callId ?? data.toolCallId
        const target = byCallId.get(callId)
        if (target === undefined) {
          orphanResults += 1
          break
        }
        target.output = resultText(data.message)
        target.status = data.message?.isError === true ? 'error' : 'completed'
        target.isError = data.message?.isError === true
        break
      }
      default: {
        ignored.set(type, (ignored.get(type) ?? 0) + 1)
      }
    }
  }

  // 没有结果的调用：显式标成 error，不静默丢弃。
  for (const part of byCallId.values()) {
    if (part.status === 'running') {
      part.status = 'error'
      part.isError = true
      part.output = part.output ?? '(no tool result recorded in the source log)'
    }
  }

  const counts = {
    messages: messages.length,
    userMessages: messages.filter((m) => m.role === 'user').length,
    assistantMessages: messages.filter((m) => m.role === 'assistant').length,
    toolCalls: [...byCallId.keys()].length,
    toolResultEvents: toolCalls,
    systemMessages,
    orphanToolResults: orphanResults,
    ignoredEvents: [...ignored.values()].reduce((a, b) => a + b, 0),
  }

  const ir = {
    version: IR_VERSION,
    title,
    cwd: header?.cwd,
    createdAt: header?.createdAt,
    sourceId: header?.id,
    messages,
    counts,
    ignored: Object.fromEntries([...ignored].sort((a, b) => b[1] - a[1])),
  }
  return { ir, ignored }
}
//#endregion

//#region 事件构造（IR → 可写入 DSH 的 seed 事件）
/**
 * 事件构造器：与 dsh-import 的 SessionBuilder 同契约（那里已用 DSH 自己的
 * 还原器验过），这里独立实现，避免跨包相对导入。
 */
export class SessionBuilder {
  constructor(meta) {
    this.meta = meta
    this.events = []
    this.seq = 0
    this.turn = 0
    this.step = 0
    this.openTurn = false
    this.openStep = false
    this.lastTime = Number.isFinite(meta.createdAt) ? meta.createdAt : Date.now()
    this.pending = new Map()
  }

  emit(type, time, data, extra = {}) {
    const stamped = Number.isFinite(time) ? Math.max(time, this.lastTime) : this.lastTime
    this.lastTime = stamped
    const event = { type, seq: this.seq++, time: stamped, data, ...extra }
    this.events.push(event)
    return event
  }

  startTurn(time) {
    this.turn += 1
    this.emit('turn/start', time, { turn: this.turn })
    this.openTurn = true
    this.step = 0
  }

  startStep(time) {
    this.step += 1
    this.emit('step/start', time, { turn: this.turn, step: this.step })
    this.openStep = true
  }

  /** 系统提示：必须是 surface 的第一个节点。 */
  systemMessage(time, text) {
    this.requireOpen()
    this.emit(
      'system/message',
      time,
      {
        turn: this.turn,
        step: this.step,
        message: {
          role: 'system',
          id: `system-${this.turn}`,
          content: [{ type: 'text', text }],
          source: { kind: 'system-prompt' },
        },
      },
      { surfaceOp: 'append' },
    )
  }

  userMessage(time, message) {
    this.requireOpen()
    this.emit(
      'user/message',
      time,
      {
        role: 'user',
        id: message.id,
        content: message.content,
        source: message.source ?? { kind: 'user' },
      },
      { surfaceOp: 'append' },
    )
  }

  assistantMessage(time, message) {
    this.requireOpen()
    this.emit(
      'assistant/message',
      time,
      {
        turn: this.turn,
        step: this.step,
        message: {
          role: 'assistant',
          id: message.id,
          content: message.content,
          source: {
            kind: 'model',
            provider: message.provider ?? 'unknown',
            model: message.model ?? 'unknown',
          },
        },
        ...(message.tokens === undefined ? {} : { usage: message.tokens }),
        stream: [],
      },
      { surfaceOp: 'append' },
    )
  }

  toolCall(time, call) {
    this.requireOpen()
    const event = this.emit('tool/call', time, {
      turn: this.turn,
      step: this.step,
      callId: call.callId,
      name: call.name,
      arguments: call.arguments,
    })
    this.pending.set(call.callId, event.seq)
    return event
  }

  toolResult(time, result) {
    if (!this.pending.has(result.callId)) return undefined
    this.requireOpen()
    const callSeq = this.pending.get(result.callId)
    this.pending.delete(result.callId)
    return this.emit(
      'tool/result',
      time,
      {
        turn: this.turn,
        step: this.step,
        message: {
          role: 'tool',
          id: result.id ?? `tool-${result.callId}`,
          content: [{ type: 'text', text: result.text ?? '' }],
          source: { kind: 'tool', callId: result.callId },
          toolCallId: result.callId,
          ...(result.isError === true ? { isError: true } : {}),
        },
      },
      { surfaceOp: 'append', sourceEventSeqs: [callSeq] },
    )
  }

  endStep(time) {
    if (!this.openStep) return
    // 未回款的调用：补一条"结果未知"，绝不留悬空 call。
    for (const callId of [...this.pending.keys()]) {
      this.toolResult(time, {
        callId,
        text: 'No tool result was recorded for this call in the source transcript (TOOL_OUTCOME_UNKNOWN).',
        isError: true,
      })
    }
    this.emit('step/end', time, { turn: this.turn, step: this.step })
    this.openStep = false
  }

  endTurn(time, reason = { kind: 'completed' }) {
    if (!this.openTurn) return
    this.endStep(time)
    this.emit('turn/end', time, { turn: this.turn, reason })
    this.openTurn = false
    this.pending.clear()
  }

  title(time, text, messageSeqs) {
    const title = String(text).replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!title) return undefined
    this.emit('session/title', time, { title, messageSeqs, source: { kind: 'fallback' } })
    return title
  }

  requireOpen() {
    if (!this.openTurn) throw new Error('no open turn')
    if (!this.openStep) throw new Error('no open step')
    return { turn: this.turn, step: this.step }
  }
}

export const DEFAULT_SYSTEM_TEXT =
  'You are an AI agent powered by DeepSeek Harness. ' +
  'This session was imported from ZCode: the original agent system prompt is not part of the transcript, ' +
  'so this line stands in for it. The conversation below is the imported history, verbatim except for ' +
  'tool-call formatting and truncations recorded by the importer.'

/** 一条 IR 消息的可见正文块（空的话给一个空 text 块，别写空 content 数组）。 */
function userContent(message) {
  const content = (message.parts ?? [])
    .filter((part) => part.kind === 'text')
    .map((part) => ({ type: 'text', text: part.text }))
  return content.length > 0 ? content : [{ type: 'text', text: '' }]
}

/**
 * IR → DSH {header, events}。
 * 结构：每个 turn → turn/start；每轮第一个 step 带 system/message（整会话一次）+ 用户消息；
 * 每个 assistant 消息各自一个 step（一次模型调用 = 一个 step），工具调用与结果都在该 step 内。
 */
export function irToSeedEvents(ir, options = {}) {
  const cwd = options.cwd ?? ir.cwd
  const createdAt = options.createdAt ?? ir.createdAt ?? Date.now()
  const id = options.id ?? `session-${createHash('sha1').update(String(createdAt)).digest('hex').slice(0, 32)}`
  const provider = options.provider ?? 'zcode'
  const model = options.model ?? 'zcode'
  const builder = new SessionBuilder({ id, cwd, createdAt })
  let systemEmitted = false
  let titleEmitted = false
  let droppedOrphans = 0

  // 按 turnId 分组，保持原始顺序。
  const groups = []
  for (const message of ir.messages ?? []) {
    const key = message.turnId ?? 'turn-1'
    const last = groups[groups.length - 1]
    if (last !== undefined && last.key === key) last.messages.push(message)
    else groups.push({ key, messages: [message] })
  }

  for (const group of groups) {
    const at = group.messages[0]?.at ?? createdAt
    builder.startTurn(at)
    let pendingUsers = []
    let turnSeqs = []
    for (const message of group.messages) {
      if (message.role === 'user') {
        pendingUsers.push(message)
        continue
      }
      if (message.role !== 'assistant') continue
      builder.startStep(message.at)
      if (!systemEmitted) {
        builder.systemMessage(message.at, options.systemText ?? DEFAULT_SYSTEM_TEXT)
        systemEmitted = true
      }
      for (const user of pendingUsers) {
        builder.userMessage(user.at, { id: user.id, content: userContent(user) })
        turnSeqs.push(builder.events[builder.events.length - 1].seq)
        if (!titleEmitted && options.title !== false) {
          const title = ir.title ?? user.parts.find((p) => p.kind === 'text')?.text
          if (title) {
            builder.title(user.at, title, [builder.events[builder.events.length - 1].seq])
            titleEmitted = true
          }
        }
      }
      pendingUsers = []

      // assistant 消息：content = 原文块；tool part 同时公示 + 发 call。
      const content = []
      for (const part of message.parts ?? []) {
        if (part.kind === 'text' && part.text !== '') content.push({ type: 'text', text: part.text })
        else if (part.kind === 'reasoning' && part.text !== '') content.push({ type: 'reasoning', text: part.text })
        else if (part.kind === 'tool') {
          content.push({ type: 'tool-call', id: part.callId, name: part.name, arguments: part.arguments ?? '{}' })
        }
      }
      if (content.length === 0) content.push({ type: 'text', text: '' })
      builder.assistantMessage(message.at, {
        id: message.id ?? `assistant-${message.at}`,
        content,
        provider: message.provider ?? provider,
        model: message.model ?? model,
        tokens: normalizeUsage(message.tokens),
      })
      const assistantSeq = builder.events[builder.events.length - 1].seq
      turnSeqs.push(assistantSeq)

      for (const part of (message.parts ?? []).filter((p) => p.kind === 'tool')) {
        builder.toolCall(message.at, {
          callId: part.callId,
          name: part.name,
          arguments: part.arguments ?? (typeof part.input === 'string' ? part.input : JSON.stringify(part.input ?? {})),
        })
        builder.toolResult(message.completedAt ?? message.at, {
          callId: part.callId,
          text: part.output ?? '',
          isError: part.isError === true || part.status === 'error',
        })
      }
      builder.endStep(message.completedAt ?? message.at)
    }

    if (pendingUsers.length > 0) {
      builder.startStep(pendingUsers[0].at)
      if (!systemEmitted) {
        builder.systemMessage(pendingUsers[0].at, options.systemText ?? DEFAULT_SYSTEM_TEXT)
        systemEmitted = true
      }
      for (const user of pendingUsers) {
        builder.userMessage(user.at, { id: user.id, content: userContent(user) })
        if (!titleEmitted && options.title !== false) {
          const title = ir.title ?? user.parts.find((p) => p.kind === 'text')?.text
          if (title) {
            builder.title(user.at, title, [builder.events[builder.events.length - 1].seq])
            titleEmitted = true
          }
        }
      }
      builder.endStep(pendingUsers[pendingUsers.length - 1].at)
    }

    const lastAt = group.messages[group.messages.length - 1]?.completedAt ?? group.messages[group.messages.length - 1]?.at ?? createdAt
    builder.endTurn(lastAt)
  }

  const header = {
    type: 'session',
    version: FORMAT_VERSION,
    id,
    createdAt,
    ...(cwd === undefined ? {} : { cwd }),
    isSeeded: false,
    delegationDepth: 0,
    ...(options.agentPreset === undefined ? {} : { agentPreset: options.agentPreset }),
  }
  return { header, events: builder.events, droppedOrphans }
}

/** ZCode tokens → DSH TokenUsage（只保留 DSH 认识的字段）。 */
export function normalizeUsage(tokens) {
  if (tokens === null || typeof tokens !== 'object') return undefined
  const int = (value) => (Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined)
  const usage = {
    inputTokens: int(tokens.input ?? tokens.inputTokens) ?? 0,
    outputTokens: int(tokens.output ?? tokens.outputTokens) ?? 0,
  }
  const total = int(tokens.total ?? tokens.totalTokens)
  const cacheRead = int(tokens.cache?.read ?? tokens.cacheReadTokens)
  const cacheWrite = int(tokens.cache?.write ?? tokens.cacheWriteTokens)
  const reasoning = int(tokens.reasoning ?? tokens.reasoningTokens)
  if (total !== undefined) usage.totalTokens = total
  if (cacheRead !== undefined) usage.cacheReadTokens = cacheRead
  if (cacheWrite !== undefined) usage.cacheWriteTokens = cacheWrite
  if (reasoning !== undefined) usage.reasoningTokens = reasoning
  return usage
}
//#endregion

//#region 宿主通道（活会话优先）
/**
 * 通过宿主服务读一个会话（活会话优先，冷会话由 sessionQuery 从持久化读）。
 * 服务取不到就返回 undefined，由调用方退到文件读。
 */
export async function readDshViaHost(host, sessionId) {
  if (!host) return undefined
  const query = host.sessionQuery
  if (query && typeof query.readSession === 'function') {
    const snapshot = await query.readSession(sessionId)
    if (snapshot && snapshot.header) return { header: snapshot.header, events: snapshot.events ?? [], via: 'sessionQuery.readSession' }
  }
  return undefined
}

/**
 * 把 seed 事件交付给宿主：`ctx.sessions.create(id, {seed, meta})` → `flush()`。
 * 没有 sessions 服务时返回 undefined（调用方退到文件写）。
 */
export async function createDshSessionViaHost(host, plan) {
  const sessions = host?.sessions
  if (!sessions || typeof sessions.create !== 'function') return undefined
  if (typeof sessions.get === 'function' && sessions.get(plan.header.id) !== undefined) {
    throw Object.assign(new Error(`session ${plan.header.id} already exists`), { code: 'ALREADY_EXISTS' })
  }
  const session = sessions.create(plan.header.id, {
    seed: plan.events,
    meta: {
      cwd: plan.header.cwd,
      createdAt: plan.header.createdAt,
    },
  })
  let flushed = false
  if (typeof sessions.flush === 'function') {
    flushed = await sessions.flush(session)
  }
  return { sessionId: plan.header.id, flushed: flushed === true, live: true }
}

/** 宿主 sessionController.list() → 归一化行（用于幂等检查）。 */
export async function listDshSessionsViaHost(host) {
  const controller = host?.sessionController
  if (!controller || typeof controller.list !== 'function') return undefined
  try {
    const rows = await controller.list(new AbortController().signal)
    if (!Array.isArray(rows)) return undefined
    return rows.map((row) => ({
      id: row.id ?? row.sessionId,
      cwd: row.cwd,
      title: row.title,
      updatedAt: row.updatedAt ?? row.timeUpdated ?? row.createdAt,
    }))
  } catch {
    return undefined
  }
}
//#endregion
