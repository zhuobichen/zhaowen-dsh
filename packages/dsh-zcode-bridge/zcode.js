/**
 * zcode.js —— ZCode 的 CLI 会话库（`~/.zcode/cli/db/db.sqlite`）读写。
 *
 * 只碰三张表：`session` / `message` / `part`。其它表（tool_usage、model_usage、
 * turn_usage、todo、session_input、session_entry …）一行都不写、也不改。
 *
 * 写入口径是「不硬写」：
 *   ① apply=true ② ZCode 进程未运行 ③ 备份 db.sqlite ④ BEGIN IMMEDIATE 单事务 ⑤ 回执带行数
 * 备份失败就抛 BACKUP_FAILED（此时一行都还没写）；事务失败整体 ROLLBACK。
 *
 * 存储形状全部来自真实库抽样（见 README「抽样证据」），没有猜的部分：
 *   part.data.type ∈ {text, reasoning, tool, step-start, step-finish, timeline}
 *   message.data.role ∈ {user, assistant}
 *   semantics.origin ∈ {real_user, agent_runtime, system}
 *   semantics.kind ∈ {user_prompt, assistant_response, system_reminder, timeline_event,
 *                     todo_reminder, background_notification}
 *   semantics.{ui,provider,transcript}Visibility ∈ {visible, hidden}
 */
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const SESSION_TABLE = 'session'
export const MESSAGE_TABLE = 'message'
export const PART_TABLE = 'part'

/** ZCode 主目录（`~/.zcode`）。 */
export function zcodeHome(override) {
  return override ?? process.env.ZCODE_HOME ?? join(homedir(), '.zcode')
}

/** 默认库路径：`<zcodeHome>/cli/db/db.sqlite`。 */
export function defaultDbPath(overrideHome) {
  return join(zcodeHome(overrideHome), 'cli', 'db', 'db.sqlite')
}

export class ZcodeError extends Error {
  constructor(code, message, detail = {}) {
    super(message)
    this.name = 'ZcodeError'
    this.code = code
    this.detail = detail
  }
}

//#region 进程检测
/**
 * ZCode 是否在运行。任务里点名要认 `zcode.exe` / `ZCode.exe`。
 *
 * 判据只认**镜像名**（大小写无关），不认路径：用 tasklist 全量列举再过滤，
 * 因为 `/FI IMAGENAME eq X` 的过滤语义在不同窗口版本上不完全一致，而误判
 * 「没在跑」的代价是硬写别人正在用的库。
 *
 * @returns {{running: boolean, checked: boolean, processes: string[], error?: string}}
 */
export function detectZCodeRunning(options = {}) {
  const timeout = Number(options.timeout ?? 8000)
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist.exe', ['/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout,
        maxBuffer: 16 * 1024 * 1024,
      })
      const names = []
      for (const line of out.split(/\r?\n/)) {
        const m = /^"((?:[^"]|"")*)"/.exec(line.trim())
        if (m) names.push(m[1].replace(/""/g, '"'))
      }
      const matches = names.filter((name) => /^zcode\.exe$/i.test(name))
      return { running: matches.length > 0, checked: true, processes: [...new Set(matches)] }
    }
    const out = execFileSync('ps', ['-A', '-o', 'comm='], { encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 })
    const matches = out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /(^|\/)zcode$/i.test(line))
    return { running: matches.length > 0, checked: true, processes: matches }
  } catch (error) {
    return { running: false, checked: false, processes: [], error: String(error?.message ?? error) }
  }
}
//#endregion

//#region 打开 / 抽样
/** 打开库。读操作一律 readOnly；写操作由 applyExport 自己开读写连接。 */
export function openDatabase(path, options = {}) {
  if (!existsSync(path)) throw new ZcodeError('DB_NOT_FOUND', `找不到 ZCode 会话库：${path}`, { path })
  const db = new DatabaseSync(path, { readOnly: options.readOnly !== false })
  // 这两条是**实测必需**的，不是抄来的最佳实践：
  //   temp_store=MEMORY —— 本机 SQLite 一旦需要落临时文件就抛 SQLITE_CANTOPEN(14)
  //     "unable to open database file"；写完一整个大会话（259 message / 949 part）必踩。
  //     改成纯内存后 100% 稳定（证据见 README「踩到的坑」）。
  //   busy_timeout —— 别的连接短暂占用时等 5 s，而不是立刻报错。
  for (const pragma of ['PRAGMA temp_store=MEMORY', 'PRAGMA busy_timeout=5000']) {
    try {
      db.exec(pragma)
    } catch {
      // 只读连接上个别 pragma 可能被拒：不影响读
    }
  }
  return db
}

const tableExists = (db, name) =>
  db.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table' AND name=?").get(name).c > 0

/**
 * 抽样证据：把 schema、枚举、形状从库里现取一遍。
 * 这是"写入正确性"的根基，也是 GET /dsh-zcode/schema 的返回值。
 */
export function sampleSchema(db) {
  const q = (sql, ...args) => db.prepare(sql).all(...args)
  const parse = (raw) => {
    try {
      return JSON.parse(raw)
    } catch {
      return undefined
    }
  }

  const tables = q("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map((r) => r.name)
  const counts = {}
  for (const name of tables) {
    try {
      counts[name] = q(`SELECT count(*) c FROM "${name}"`)[0].c
    } catch (error) {
      counts[name] = `error: ${error.message}`
    }
  }

  const columns = {}
  for (const name of [SESSION_TABLE, MESSAGE_TABLE, PART_TABLE]) {
    if (!tables.includes(name)) continue
    columns[name] = q(`pragma table_info("${name}")`).map((c) => ({
      name: c.name,
      type: c.type,
      notnull: c.notnull === 1,
      pk: c.pk > 0,
    }))
  }

  const partTypes = new Map()
  const partShapes = {}
  const statuses = new Map()
  const roles = new Map()
  const origins = new Map()
  const kinds = new Map()
  const uiVis = new Map()
  const providerVis = new Map()
  const transcriptVis = new Map()
  const semanticsCombos = new Map()

  if (tables.includes(PART_TABLE)) {
    for (const row of q('SELECT data FROM part')) {
      const data = parse(row.data)
      if (data === undefined) {
        partTypes.set('<unparsable>', (partTypes.get('<unparsable>') ?? 0) + 1)
        continue
      }
      const type = typeof data.type === 'string' ? data.type : '<none>'
      partTypes.set(type, (partTypes.get(type) ?? 0) + 1)
      const shapeKey = `${type}|${data.state?.status ?? ''}`
      if (partShapes[shapeKey] === undefined) partShapes[shapeKey] = trimShape(data)
      if (type === 'tool') {
        const status = String(data.state?.status)
        statuses.set(status, (statuses.get(status) ?? 0) + 1)
      }
    }
  }

  if (tables.includes(MESSAGE_TABLE)) {
    for (const row of q('SELECT data FROM message')) {
      const data = parse(row.data)
      if (data === undefined) continue
      roles.set(String(data.role), (roles.get(String(data.role)) ?? 0) + 1)
      const semantic = data.semantics ?? {}
      origins.set(String(semantic.origin), (origins.get(String(semantic.origin)) ?? 0) + 1)
      kinds.set(String(semantic.kind), (kinds.get(String(semantic.kind)) ?? 0) + 1)
      uiVis.set(String(semantic.uiVisibility), (uiVis.get(String(semantic.uiVisibility)) ?? 0) + 1)
      providerVis.set(String(semantic.providerVisibility), (providerVis.get(String(semantic.providerVisibility)) ?? 0) + 1)
      transcriptVis.set(String(semantic.transcriptVisibility), (transcriptVis.get(String(semantic.transcriptVisibility)) ?? 0) + 1)
      const combo = [
        semantic.origin,
        semantic.kind,
        semantic.uiVisibility,
        semantic.providerVisibility,
        semantic.transcriptVisibility,
      ].join('/')
      semanticsCombos.set(combo, (semanticsCombos.get(combo) ?? 0) + 1)
    }
  }

  const projects = tables.includes(SESSION_TABLE)
    ? q('SELECT DISTINCT project_id, directory FROM session').map((row) => ({
        project_id: row.project_id,
        directory: row.directory,
        derived: projectIdForDirectory(row.directory),
        matches: projectIdForDirectory(row.directory) === row.project_id,
      }))
    : []

  const descending = new Map([...partTypes].sort((a, b) => b[1] - a[1]))
  return {
    db: { tables: tables.length, counts },
    columns,
    part: {
      types: Object.fromEntries(descending),
      toolStatuses: Object.fromEntries([...statuses].sort((a, b) => b[1] - a[1])),
      shapes: partShapes,
    },
    message: {
      roles: Object.fromEntries([...roles].sort((a, b) => b[1] - a[1])),
      semantics: {
        origin: Object.fromEntries([...origins].sort((a, b) => b[1] - a[1])),
        kind: Object.fromEntries([...kinds].sort((a, b) => b[1] - a[1])),
        uiVisibility: Object.fromEntries([...uiVis]),
        providerVisibility: Object.fromEntries([...providerVis]),
        transcriptVisibility: Object.fromEntries([...transcriptVis]),
        combos: Object.fromEntries([...semanticsCombos].sort((a, b) => b[1] - a[1])),
      },
    },
    projects,
  }
}

function trimShape(data) {
  const clone = JSON.parse(JSON.stringify(data))
  if (typeof clone.text === 'string') clone.text = clone.text.slice(0, 120) + (clone.text.length > 120 ? '…' : '')
  if (clone.state && typeof clone.state.output === 'string') {
    clone.state.output = clone.state.output.slice(0, 120) + (clone.state.output.length > 120 ? '…' : '')
  }
  return clone
}

/**
 * project_id 派生规则（从真实库反推，5/5 命中）：
 *
 *   project_id = ("proj_" + lower(directory).replace(/[\\/:]+/g, "-")).slice(0, 85)
 *
 * 证据见 README：`C:\Users\Administrator\.zcode\workspace\draft-6fd524b3-…
 * -61ee47be7b4c` → `proj_c-users-administrator-.zcode-workspace-draft-6fd524b3-
 * …-60ee47be7b4`（**第 85 个字符之后被截掉**，连目录名的最后一个字符都不留）。
 * 也就是说：`proj_` + 原样小写路径（分隔符合并成一个 `-`），总长硬性截到 85。
 */
export const PROJECT_ID_MAX = 85

export function projectIdForDirectory(directory) {
  if (typeof directory !== 'string' || directory.trim() === '') return undefined
  const normalized = 'proj_' + directory.toLowerCase().replace(/[\\/:]+/g, '-')
  return normalized.slice(0, PROJECT_ID_MAX)
}

/**
 * 解析目标 project_id：
 *   1. 派生值已经存在（有会话或输入历史用它）→ 直接用，source='derived-existing'
 *   2. 派生值不存在 → 默认就用派生值（新建一个 project 桶），source='derived-new'
 *   3. 调用方给了 override → 用它，source='override'
 * 另附 `collision`：派生值与已存在 project 撞名但**目录不同**（85 字符截断撞名），
 * 这时直接写会污染别人的 project，调用方要自己决定。
 */
export function resolveProjectId(db, directory, override) {
  const derived = projectIdForDirectory(directory)
  if (override) {
    return { projectId: override, derived, source: 'override', existing: existsProject(db, override), collision: undefined }
  }
  if (derived === undefined) return { projectId: undefined, derived, source: 'none', existing: false, collision: undefined }

  const rows = db
    .prepare('SELECT DISTINCT project_id, directory FROM session')
    .all()
    .filter((row) => row.project_id === derived)
  const histories = db
    .prepare('SELECT DISTINCT project_id FROM input_history WHERE project_id = ?')
    .all(derived)
  const existing = rows.length > 0 || histories.length > 0
  const otherDirectories = rows.map((row) => row.directory).filter((dir) => dir !== directory)
  const collision =
    otherDirectories.length > 0
      ? { existingDirectories: otherDirectories, reason: `project_id 长度被截到 ${PROJECT_ID_MAX} 字符，长路径会撞名` }
      : undefined
  return { projectId: derived, derived, source: existing ? 'derived-existing' : 'derived-new', existing, collision }
}

function existsProject(db, projectId) {
  if (!projectId) return false
  return (
    db.prepare('SELECT count(*) c FROM session WHERE project_id = ?').get(projectId).c > 0 ||
    db.prepare('SELECT count(*) c FROM input_history WHERE project_id = ?').get(projectId).c > 0
  )
}
//#endregion

//#region 读：ZCode → IR
/** 会话列表（按 time_updated 倒序，带消息条数）。 */
export function listSessions(db, options = {}) {
  const limit = Math.max(1, Number(options.limit ?? 100))
  const rows = db
    .prepare(
      `SELECT s.id, s.title, s.directory, s.project_id, s.parent_id, s.slug, s.task_type,
              s.title_source, s.version, s.time_created, s.time_updated,
              (SELECT count(*) FROM message m WHERE m.session_id = s.id) AS messages,
              (SELECT count(*) FROM part p WHERE p.session_id = s.id) AS parts
         FROM session s
        WHERE s.time_deleted IS NULL
        ORDER BY s.time_updated DESC
        LIMIT ?`,
    )
    .all(limit)
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    directory: row.directory,
    projectId: row.project_id,
    parentId: row.parent_id ?? null,
    taskType: row.task_type,
    titleSource: row.title_source,
    version: row.version,
    createdAt: row.time_created,
    updatedAt: row.time_updated,
    messages: row.messages,
    parts: row.parts,
  }))
}

/**
 * 读一个 ZCode 会话 → IR。
 *
 * 可见性口径：`semantics.transcriptVisibility === 'visible'` 才是"人看到的对话"。
 * 默认只导这些；`includeHidden:true` 时把 model-only 的注入消息也带上
 * （标 synthetic，`semantics` 原样保留在 `source` 里）。
 */
export function readSessionIR(db, sessionId) {
  const session = db.prepare('SELECT * FROM session WHERE id = ?').get(sessionId)
  if (session === undefined) throw new ZcodeError('SESSION_NOT_FOUND', `ZCode 里没有这个会话：${sessionId}`, { sessionId })

  const messages = []
  const ignoredParts = new Map()
  let hidden = 0
  let toolCalls = 0

  const messageRows = db
    .prepare('SELECT id, sequence, time_created, data FROM message WHERE session_id = ? ORDER BY sequence, time_created')
    .all(sessionId)
  for (const row of messageRows) {
    const data = parseJson(row.data) ?? {}
    const semantics = data.semantics ?? {}
    const visible = semantics.transcriptVisibility !== 'hidden'
    if (!visible) hidden += 1
    const partRows = db
      .prepare('SELECT id, sequence, time_created, data FROM part WHERE message_id = ? ORDER BY sequence, time_created')
      .all(row.id)
    const parts = []
    for (const partRow of partRows) {
      const part = parseJson(partRow.data) ?? {}
      const type = part.type
      if (type === 'text' && typeof part.text === 'string') {
        if (part.text !== '') parts.push({ kind: 'text', text: part.text })
      } else if (type === 'reasoning' && typeof part.text === 'string') {
        if (part.text !== '') parts.push({ kind: 'reasoning', text: part.text })
      } else if (type === 'tool') {
        toolCalls += 1
        const state = part.state ?? {}
        const input = state.input
        parts.push({
          kind: 'tool',
          callId: part.callID ?? `${row.id}-tool-${parts.length}`,
          name: part.tool ?? 'unknown',
          arguments: JSON.stringify(input ?? {}),
          input,
          output: typeof state.output === 'string' ? state.output : state.error !== undefined ? String(state.error) : '',
          status: state.status ?? 'completed',
          isError: state.status === 'error',
        })
      } else if (type === 'step-start' || type === 'step-finish' || type === 'timeline') {
        ignoredParts.set(type, (ignoredParts.get(type) ?? 0) + 1)
      } else {
        ignoredParts.set(String(type), (ignoredParts.get(String(type)) ?? 0) + 1)
      }
    }
    if (parts.length === 0 && visible === false) continue
    messages.push({
      role: data.role === 'assistant' ? 'assistant' : 'user',
      id: row.id,
      at: data.time?.created ?? row.time_created,
      completedAt: data.time?.completed,
      turnId: data.anchor?.turnId ?? `seq-${row.sequence}`,
      parts,
      provider: data.providerId,
      model: data.modelId,
      tokens: data.tokens,
      finish: data.finish,
      synthetic: visible === false,
      semantics: data.semantics,
      parentId: data.parentID,
    })
  }

  const ir = {
    version: 1,
    title: session.title,
    cwd: session.directory,
    createdAt: session.time_created,
    sourceId: session.id,
    messages,
    counts: {
      messages: messages.length,
      userMessages: messages.filter((m) => m.role === 'user').length,
      assistantMessages: messages.filter((m) => m.role === 'assistant').length,
      toolCalls,
      hiddenMessages: hidden,
      ignoredParts: [...ignoredParts.values()].reduce((a, b) => a + b, 0),
    },
    ignored: Object.fromEntries([...ignoredParts].sort((a, b) => b[1] - a[1])),
  }
  return { ir, session }
}

function parseJson(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}
//#endregion

//#region 写：IR → ZCode 行
const randHex = (n) => randomBytes(n).toString('hex')
const stamp = (ms) => Math.max(0, Math.trunc(ms)).toString(36)

export function newSessionId() {
  return `session_${randHex(16)}`
}
export function newMessageId(ms) {
  return `msg_${stamp(ms)}_${randomUUID()}`
}
export function newPartId(ms) {
  return `part_${stamp(ms)}_${randomUUID()}`
}

/** 从库里现成的行推断新行该用哪些"环境字段"，比自己瞎编安全。 */
export function inferDefaults(db) {
  const latest = db
    .prepare('SELECT version, permission, task_type, title_source FROM session ORDER BY time_updated DESC LIMIT 1')
    .get()
  return {
    version: latest?.version ?? '0.17.0',
    permission: latest?.permission ?? '{"mode":"yolo"}',
    taskType: latest?.task_type ?? 'interactive',
    titleSource: 'custom',
  }
}

/**
 * IR → 待写入的行（纯函数，不碰库）。
 *
 * @returns {{session: object, messages: object[], parts: object[], counts: object, warnings: string[]}}
 */
/**
 * 把 DSH IR 归一化成 planExport 期望的 parts 形状。
 *
 * DSH 侧（dsh-kimi-bridge/dsh.js）给的是：
 *   { role:'assistant', text, reasoning?, toolCalls:[{id,name,arguments}] }
 *   { role:'tool', text, toolCallId }        ← 工具结果单独一条
 * 而 planExport 按 ZCode 的 part 模型消费：parts[{kind:'tool', callId, name, input, output}]。
 * 这里把两者接上：工具结果按 callId 折回调用里，role:'tool' 消息不再单独成 message。
 */
function normalizeIrMessages(messages) {
  const results = new Map()
  for (const m of messages ?? []) {
    if (m.role !== 'tool') continue
    const key = m.toolCallId ?? m.callId ?? m.id
    if (key !== undefined) results.set(key, m)
  }

  const out = []
  for (const m of messages ?? []) {
    if (m.role === 'tool') continue
    if (m.role !== 'assistant' && m.role !== 'user') {
      out.push(m)
      continue
    }
    if (Array.isArray(m.parts) && m.parts.length > 0) {
      out.push(m)
      continue
    }
    const parts = []
    if (typeof m.reasoning === 'string' && m.reasoning !== '') {
      parts.push({ kind: 'reasoning', text: m.reasoning })
    }
    if (typeof m.text === 'string' && m.text !== '') {
      parts.push({ kind: 'text', text: m.text })
    }
    for (const call of m.toolCalls ?? []) {
      const result = results.get(call.id) ?? results.get(call.callId)
      let input = {}
      try {
        input = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : (call.arguments ?? {})
      } catch {
        input = { _raw: String(call.arguments ?? '') }
      }
      parts.push({
        kind: 'tool',
        callId: call.id ?? call.callId,
        name: call.name ?? 'tool',
        input,
        output: result?.text ?? '',
        isError: result?.isError === true,
      })
    }
    out.push({ ...m, parts })
  }
  return out
}

export function planExport(ir, options = {}) {
  const directory = options.directory ?? ir.cwd
  if (typeof directory !== 'string' || directory.trim() === '') {
    throw new ZcodeError('NO_DIRECTORY', 'DSH 会话没有 cwd，导不出去：请显式传 directory。')
  }
  const defaults = options.defaults ?? { version: '0.17.0', permission: '{"mode":"yolo"}', taskType: 'interactive' }
  const now = Date.now()
  const title = normalizeTitle(options.title ?? ir.title ?? firstUserText(ir) ?? 'DSH 导入会话')
  const createdAt = Number.isFinite(options.createdAt) ? Math.trunc(options.createdAt) : ir.createdAt ?? now
  const sessionId = options.sessionId ?? newSessionId()
  const project = options.project ?? { projectId: projectIdForDirectory(directory), source: 'derived-new' }
  const agent = options.agent ?? 'zcode-agent'
  const providerId = options.providerId ?? firstAssistant(ir)?.provider ?? 'dsh'
  const modelId = options.modelId ?? firstAssistant(ir)?.model ?? 'dsh-import'
  const warnings = []
  const irMessages = normalizeIrMessages(ir.messages)

  let sequence = 0
  const messages = []
  const parts = []

  // 会话级 orderedMessageIds：真实样本里 assistant 消息的 anchor 会带它。
  const orderedIds = []
  for (const message of irMessages) {
    const id = newMessageId(Number.isFinite(message.at) ? message.at : createdAt)
    orderedIds.push(id)
  }

  let lastUserId
  let turnIndex = 0
  const turnIndices = new Map()
  for (const message of irMessages) {
    const key = message.turnId ?? 'turn-1'
    if (!turnIndices.has(key)) turnIndices.set(key, ++turnIndex)
  }
  for (let messageIndex = 0; messageIndex < irMessages.length; messageIndex += 1) {
    const message = irMessages[messageIndex]
    const id = orderedIds[messageIndex]
    const at = Number.isFinite(message.at) ? Math.trunc(message.at) : createdAt
    const completed = Number.isFinite(message.completedAt) ? Math.trunc(message.completedAt) : at
    const turnId = message.turnId ?? `turn-${sequence}`
    if (message.role === 'user') {
      const model = { providerId, modelId }
      messages.push({
        id,
        session_id: sessionId,
        sequence: sequence++,
        time_created: at,
        time_updated: completed,
        data: {
          role: 'user',
          time: { created: at },
          agent,
          modelSelection: model,
          model: { providerID: providerId, modelID: modelId },
          semantics: {
            origin: 'real_user',
            kind: 'user_prompt',
            uiVisibility: 'visible',
            providerVisibility: 'visible',
            transcriptVisibility: 'visible',
          },
          anchor: { turnId },
          ...(message.synthetic === true ? { synthetic: true } : {}),
        },
      })
      lastUserId = id
      let partSequence = 0
      for (const part of message.parts ?? []) {
        if (part.kind !== 'text') continue
        parts.push({
          id: newPartId(at),
          message_id: id,
          session_id: sessionId,
          sequence: partSequence++,
          time_created: at,
          time_updated: completed,
          data: { type: 'text', text: part.text, time: { start: at, end: completed } },
        })
      }
      continue
    }
    if (message.role !== 'assistant') continue

    const tokens = toZcodeTokens(message.tokens)
    const ordered = orderedIds.slice(0, orderedIds.indexOf(id) + 1)
    messages.push({
      id,
      session_id: sessionId,
      sequence: sequence++,
      time_created: at,
      time_updated: completed,
      data: {
        role: 'assistant',
        time: { created: at, completed },
        parentID: lastUserId,
        modelId,
        providerId,
        mode: options.mode ?? 'yolo',
        planEnabled: false,
        agent,
        path: { cwd: directory, root: directory },
        cost: 0,
        tokens,
        finish: message.finish ?? 'stop',
        semantics: {
          origin: 'agent_runtime',
          kind: 'assistant_response',
          uiVisibility: 'visible',
          providerVisibility: 'visible',
          transcriptVisibility: 'visible',
        },
        anchor: {
          turnId,
          historyRoundCount: turnIndices.get(turnId) ?? 1,
          orderedMessageIds: ordered,
          boundaryMessageId: id,
          goalBoundary: { kind: 'none' },
        },
        model: { providerID: providerId, modelID: modelId },
      },
    })

    let partSequence = 0
    const push = (data) => {
      parts.push({
        id: newPartId(at),
        message_id: id,
        session_id: sessionId,
        sequence: partSequence++,
        time_created: at,
        time_updated: completed,
        data,
      })
    }
    push({ type: 'step-start' })
    let declarationIndex = 0
    let hasText = false
    for (const part of message.parts ?? []) {
      if (part.kind === 'reasoning' && part.text !== '') {
        push({ type: 'reasoning', text: part.text, metadata: {}, time: { start: at, end: completed } })
      } else if (part.kind === 'text') {
        hasText = true
        push({ type: 'text', text: part.text ?? '', time: { start: at, end: completed } })
      } else if (part.kind === 'tool') {
        const status = part.isError === true || part.status === 'error' ? 'error' : 'completed'
        const state = {
          status,
          input: part.input ?? {},
          ...(status === 'error'
            ? { error: part.output ?? 'tool failed' }
            : { output: part.output ?? '' }),
          title: part.name ?? 'tool',
          metadata: {},
          time: { start: at, end: completed },
        }
        push({
          type: 'tool',
          callID: part.callId,
          declarationIndex: declarationIndex++,
          tool: part.name,
          metadata: {},
          state,
        })
      }
    }
    if (!hasText && declarationIndex === 0) {
      push({ type: 'text', text: '', time: { start: at, end: completed } })
    }
    push({
      type: 'step-finish',
      reason: message.finish ?? 'stop',
      cost: 0,
      tokens,
    })
  }

  if (messages.length === 0) warnings.push('IR 里没有任何 user/assistant 消息，导出去会是一个空会话。')
  const firstUser = messages.find((m) => m.data.role === 'user')
  const timeCreated = Math.min(createdAt, ...messages.map((m) => m.time_created))
  const timeUpdated = Math.max(timeCreated, ...messages.map((m) => m.time_updated), createdAt)

  const session = {
    id: sessionId,
    project_id: project.projectId,
    workspace_id: null,
    parent_id: null,
    slug: sessionId,
    directory,
    path: directory,
    title,
    version: defaults.version,
    share_url: null,
    summary_additions: null,
    summary_deletions: null,
    summary_files: null,
    summary_diffs: null,
    revert: null,
    permission: defaults.permission,
    time_created: timeCreated,
    time_updated: timeUpdated,
    time_compacting: null,
    time_archived: null,
    task_type: defaults.taskType ?? 'interactive',
    title_source: 'custom',
    title_message_id: firstUser?.id ?? null,
    time_title_updated: firstUser === undefined ? null : timeUpdated,
    trace_id: null,
    time_deleted: null,
    last_outcome: null,
  }

  return {
    session,
    messages,
    parts,
    counts: {
      sessions: 1,
      messages: messages.length,
      parts: parts.length,
      userMessages: messages.filter((m) => m.data.role === 'user').length,
      assistantMessages: messages.filter((m) => m.data.role === 'assistant').length,
      toolParts: parts.filter((p) => p.data.type === 'tool').length,
    },
    warnings,
    target: {
      projectId: project.projectId,
      projectSource: project.source,
      projectCollision: project.collision,
      directory,
      title,
      slug: sessionId,
      version: defaults.version,
    },
  }
}

function firstUserText(ir) {
  const message = (ir.messages ?? []).find((m) => m.role === 'user')
  return message?.parts?.find((p) => p.kind === 'text')?.text
}

function firstAssistant(ir) {
  return (ir.messages ?? []).find((m) => m.role === 'assistant')
}

function normalizeTitle(raw) {
  const text = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return (text === '' ? 'DSH 导入会话' : text).slice(0, 200)
}

function toZcodeTokens(tokens) {
  const n = (value) => (Number.isFinite(value) && value >= 0 ? Math.round(value) : 0)
  const input = n(tokens?.input ?? tokens?.inputTokens)
  const output = n(tokens?.output ?? tokens?.outputTokens)
  const reasoning = n(tokens?.reasoning ?? tokens?.reasoningTokens)
  const cacheRead = n(tokens?.cache?.read ?? tokens?.cacheReadTokens)
  const cacheWrite = n(tokens?.cache?.write ?? tokens?.cacheWriteTokens)
  const total = n(tokens?.total ?? tokens?.totalTokens) || input + output
  return { total, input, output, reasoning, cache: { read: cacheRead, write: cacheWrite } }
}
//#endregion

//#region 幂等 + 备份 + 事务
/** 同名 slug/title 已存在 → ALREADY_EXISTS（附已有 id）。 */
export function findExistingSession(db, plan) {
  const hit = db
    .prepare('SELECT id, title, slug FROM session WHERE slug = ? OR title = ? ORDER BY time_updated DESC LIMIT 1')
    .get(plan.session.slug, plan.session.title)
  return hit ?? undefined
}

/** 备份库文件；返回路径。失败抛 BACKUP_FAILED（调用方此时还没写任何一行）。 */
function normalizePath(p) {
  return String(p).replace(/[\\\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function backupDatabase(dbPath, options = {}) {
  const stat = statSync(dbPath)
  const ts = options.timestamp ?? timestampText(new Date())
  const target = options.target ?? `${dbPath}.bak-${ts}`
  try {
    copyFileSync(dbPath, target)
  } catch (error) {
    throw new ZcodeError('BACKUP_FAILED', `备份失败，已中止写入：${target}`, { target, error: String(error?.message ?? error) })
  }
  const copied = statSync(target)
  if (copied.size !== stat.size) {
    throw new ZcodeError('BACKUP_FAILED', `备份大小不符（${copied.size} != ${stat.size}），已中止写入：${target}`, {
      target,
      expected: stat.size,
      actual: copied.size,
    })
  }
  return { path: target, bytes: copied.size, sourceBytes: stat.size, timestamp: ts }
}

export function timestampText(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

const SESSION_COLUMNS = [
  'id', 'project_id', 'workspace_id', 'parent_id', 'slug', 'directory', 'path', 'title', 'version',
  'share_url', 'summary_additions', 'summary_deletions', 'summary_files', 'summary_diffs', 'revert',
  'permission', 'time_created', 'time_updated', 'time_compacting', 'time_archived', 'task_type',
  'title_source', 'title_message_id', 'time_title_updated', 'trace_id', 'time_deleted', 'last_outcome',
]
const MESSAGE_COLUMNS = ['id', 'session_id', 'time_created', 'time_updated', 'data', 'sequence']
const PART_COLUMNS = ['id', 'message_id', 'session_id', 'time_created', 'time_updated', 'data', 'sequence']

const insertSql = (table, columns) =>
  `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`

/**
 * 真正写库。调用顺序就是安全顺序：
 *   ① 运行检测 ② 备份 ③ 打开读写连接 ④ BEGIN IMMEDIATE ⑤ 插入 ⑥ COMMIT（失败 ROLLBACK）
 *
 * @param {string} dbPath
 * @param {object} plan planExport 的结果
 * @param {object} options {force, detectRunning, backup, now}
 */
export function applyExport(dbPath, plan, options = {}) {
  const force = options.force === true
  const detect = options.detectRunning ?? detectZCodeRunning
  // 默认一律检查（真库和副本都拦）；只有显式 allowWhileRunning 才放开。
  // 测试/离线演练请传 allowWhileRunning:true —— 那意味着"我确认没在用这个库"。
  if (options.allowWhileRunning !== true) {
    const status = detect()
    if (status.running === true) {
      throw new ZcodeError('ZCODE_RUNNING', 'ZCode 正在运行，请先退出 ZCode 再导入（不硬写别人的库）。', {
        processes: status.processes,
      })
    }
    if (status.checked === false && options.allowUnchecked !== true) {
      throw new ZcodeError('ZCODE_STATE_UNKNOWN', '检测不到 ZCode 进程状态，为安全起见不写库。', { error: status.error })
    }
  }

  const backup = backupDatabase(dbPath, options.backup ?? {})

  let db
  try {
    db = openDatabase(dbPath, { readOnly: false })
  } catch (error) {
    if (error instanceof ZcodeError) throw error
    throw new ZcodeError('DB_BUSY', `打不开 ZCode 库（是否还有别的连接占着？）：${error?.message ?? error}`, {
      dbPath,
      backup,
      cause: String(error?.message ?? error),
    })
  }
  let inTransaction = false
  try {
    if (!tableExists(db, SESSION_TABLE) || !tableExists(db, MESSAGE_TABLE) || !tableExists(db, PART_TABLE)) {
      throw new ZcodeError('SCHEMA_MISMATCH', '这个库缺 session/message/part 表，不像 ZCode 的会话库。', { dbPath })
    }
    // 备份之后再查一次幂等：备份与事务之间别人可能刚写了一条。
    const existing = findExistingSession(db, plan)
    if (existing !== undefined && !force) {
      throw new ZcodeError('ALREADY_EXISTS', `同名会话已存在：${existing.title}`, {
        existingId: existing.id,
        slug: existing.slug,
        title: existing.title,
      })
    }

    db.exec('BEGIN IMMEDIATE')
    inTransaction = true
    const insertSession = db.prepare(insertSql(SESSION_TABLE, SESSION_COLUMNS))
    insertSession.run(...SESSION_COLUMNS.map((key) => plan.session[key] ?? null))
    const insertMessage = db.prepare(insertSql(MESSAGE_TABLE, MESSAGE_COLUMNS))
    for (const message of plan.messages) {
      insertMessage.run(...MESSAGE_COLUMNS.map((key) => (key === 'data' ? JSON.stringify(message.data) : message[key] ?? null)))
    }
    const insertPart = db.prepare(insertSql(PART_TABLE, PART_COLUMNS))
    for (const part of plan.parts) {
      insertPart.run(...PART_COLUMNS.map((key) => (key === 'data' ? JSON.stringify(part.data) : part[key] ?? null)))
    }
    db.exec('COMMIT')
    inTransaction = false
    return {
      sessionId: plan.session.id,
      inserted: plan.counts,
      backup,
      projectId: plan.session.project_id,
      title: plan.session.title,
      directory: plan.session.directory,
    }
  } catch (error) {
    if (inTransaction) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // 回滚本身失败：把两个错误都带上，别让调用方以为写成功了。
      }
    }
    if (error instanceof ZcodeError) throw error
    throw new ZcodeError('WRITE_FAILED', `事务失败，已回滚：${error?.message ?? error}`, {
      backup,
      cause: String(error?.message ?? error),
    })
  } finally {
    db.close()
  }
}
//#endregion

/** 写入后按 session 读回来（测试与回执用）。 */
export function readSessionRows(db, sessionId) {
  const session = db.prepare('SELECT * FROM session WHERE id = ?').get(sessionId)
  if (session === undefined) return undefined
  const messages = db
    .prepare('SELECT id, sequence, time_created, data FROM message WHERE session_id = ? ORDER BY sequence')
    .all(sessionId)
  const parts = db
    .prepare('SELECT id, message_id, sequence, data FROM part WHERE session_id = ? ORDER BY message_id, sequence')
    .all(sessionId)
  return { session, messages, parts }
}

export function databaseFingerprint(dbPath) {
  const stat = statSync(dbPath)
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    sha1: createHash('sha1').update(`${stat.size}:${stat.mtimeMs}`).digest('hex').slice(0, 12),
  }
}