/**
 * dsh-agent-supervisor —— 宿主半身：「管理Bot」Agent 管别的会话。
 *
 * 注册 6 个工具（全部 dsh_ 前缀）：列会话、发消息、新建会话、查状态、改名、记记忆。
 *
 * 这里**故意没有** delete / cancel / archive / remove 一类工具。这不是漏写：
 * 管理Bot能派活、能查、能改名，但不能让别人的活消失。README 里有专门一节写这件事。
 *
 * 实现走的是宿主服务，不走 HTTP：
 *   ctx.sessionController  —— 列会话 / 新建 / 发 prompt / 改名（dsh-api-session-controller）
 *   ctx.sessions           —— 活会话对象（dsh-session 的 SessionStore）
 *   ctx.sessionTitle       —— 标题折叠（dsh-session-title）
 *   ctx.sessionQuery       —— 冷会话的兜底读（dsh-session-query，可选）
 * 都是 `ctx.get(name)` 拿的：拿不到就如实报「这个能力在当前部署里不可用」，
 * 不假装成功、不去猜「最后活跃的会话」。
 */
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'agent-supervisor'

/** 宿主半身只依赖工具注册表；其余服务在调用时用 ctx.get 现取，缺了要能报错而不是崩。 */
export const inject = ['tools']

/** 只有标题是这个的会话才算「管理Bot」——客户端的悬浮球也认同一个字面量。 */
const SUPERVISOR_TITLE = '管理Bot'

/** 落盘目录名（$DSH_HOME/plugins/dsh-agent-supervisor/memory）。 */
const PLUGIN_DIRNAME = 'dsh-agent-supervisor'

/** 客户端那半（右下角面板）取数据的路由前缀；两边写死同一个串。 */
const ROUTE = '/dsh-agent-supervisor'

/** 一次最多回多少条聊天消息（面板只要最近的那些）。 */
const CHAT_MESSAGE_LIMIT = 200

/** POST body 上限：一条聊天消息，1 MB 够到离谱了。 */
const CHAT_BODY_LIMIT = 1024 * 1024

const FACTS_FILENAME = 'facts.jsonl'
const NOTES_FILENAME = 'notes.md'

//#region 输出契约
//
// 6 个工具共用一个输出形状：永远有 ok，其余字段按需出现。
// 好处是模型每次看到的都是同一套字段名；失败也走同一个通道（ok:false + code + error），
// 所以「传了个不存在的 session_id」是可读结果，不是抛异常。
const SESSION_ROW = {
	type: 'object',
	additionalProperties: false,
	properties: {
		id: { type: 'string', required: true },
		title: { type: 'string' },
		updated_at: { type: 'string' },
		running: { type: 'boolean' },
		agent_available: { type: 'boolean' },
		current: { type: 'boolean' },
		blank: { type: 'boolean' },
	},
}

const EVENT_ROW = {
	type: 'object',
	additionalProperties: false,
	properties: {
		seq: { type: 'number' },
		type: { type: 'string', required: true },
		time: { type: 'string' },
	},
}

const OUTPUT = {
	schema: {
		type: 'object',
		additionalProperties: false,
		properties: {
			ok: { type: 'boolean', required: true },
			code: { type: 'string' },
			error: { type: 'string' },
			source: { type: 'string' },
			session_id: { type: 'string' },
			title: { type: 'string' },
			previous_title: { type: 'string' },
			current_session_id: { type: 'string' },
			live: { type: 'boolean' },
			running: { type: 'boolean' },
			agent_available: { type: 'boolean' },
			blank: { type: 'boolean' },
			updated_at: { type: 'string' },
			count: { type: 'number' },
			sessions: { type: 'array', items: SESSION_ROW },
			events: { type: 'array', items: EVENT_ROW },
			last_text: { type: 'string' },
			op: { type: 'string' },
			key: { type: 'string' },
			value: { type: 'string' },
			keys: { type: 'array', items: { type: 'string' } },
			scope: { type: 'string' },
		},
	},
	render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}
//#endregion

//#region 小工具
/** 取一个可选服务；服务没装、还没就绪、或者抛错都当作「没有」。 */
const serviceOf = (ctx, serviceName) => {
	if (ctx === undefined || ctx === null) return undefined

	try {
		if (typeof ctx.get === 'function') {
			const found = ctx.get(serviceName)

			if (found !== undefined && found !== null) return found
		}
	} catch {
		// ctx.get 在服务未就绪时会抛：退到属性访问，两条都没有就算了
	}

	const direct = ctx[serviceName]

	return direct === undefined ? undefined : direct
}

/** 毫秒时间戳 → ISO 字符串；值不像时间就原样丢掉。 */
const isoOf = (value) => {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined

	try {
		return new Date(value).toISOString()
	} catch {
		return undefined
	}
}

const messageOf = (failure) => {
	if (failure === undefined || failure === null) return 'unknown error'
	if (typeof failure === 'string') return failure
	if (typeof failure.message === 'string' && failure.message !== '') return failure.message

	return String(failure)
}

/** 截断到 n 个字符，别把整段对话塞进工具结果。 */
const clip = (text, max) => {
	if (typeof text !== 'string') return undefined

	const flat = text.replace(/\s+/g, ' ').trim()

	if (flat === '') return undefined
	if (flat.length <= max) return flat

	return flat.slice(0, max) + '…'
}
//#endregion

//#region 标题：活的读服务，冷/兜底读日志
/**
 * 从一个 projection values 袋子里取标题。
 *
 * 线上形态是 `{ title: string | null }`（wire view）；但某些调用点给的是
 * 投影的原始状态（`{ title: { title, messageSeqs, source, eventSeq } }`），
 * 两种都认，免得因为形态差异把标题丢了。
 */
const titleOfValues = (values) => {
	if (values === undefined || values === null || typeof values !== 'object') return undefined

	const raw = values.title

	if (typeof raw === 'string') return raw.trim() === '' ? undefined : raw
	if (raw !== null && typeof raw === 'object' && typeof raw.title === 'string') {
		return raw.title.trim() === '' ? undefined : raw.title
	}

	return undefined
}

/** 倒着扫日志找最后一条 session/title —— 不依赖 dsh-session-title 也能拿到标题。 */
const foldTitleFromEvents = (events) => {
	if (!Array.isArray(events)) return undefined

	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index]

		if (event === null || typeof event !== 'object') continue
		if (event.type !== 'session/title') continue

		const data = event.data

		if (data !== null && typeof data === 'object' && typeof data.title === 'string') {
			return data.title.trim() === '' ? undefined : data.title
		}
	}

	return undefined
}

/** 一个活会话的标题：先问 sessionTitle 服务，再自己折日志。 */
const titleOfSession = (ctx, session) => {
	if (session === undefined || session === null) return undefined

	const titles = serviceOf(ctx, 'sessionTitle')

	if (titles !== undefined && typeof titles.get === 'function') {
		try {
			const snapshot = titles.get(session)

			if (snapshot !== null && typeof snapshot === 'object' && typeof snapshot.title === 'string') {
				return snapshot.title.trim() === '' ? undefined : snapshot.title
			}
		} catch {
			// 服务在位但这次读失败：退到折日志
		}
	}

	try {
		const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : undefined

		return foldTitleFromEvents(events)
	} catch {
		return undefined
	}
}
//#endregion

//#region 会话定位：存在的判据
/** 活会话（store 里有对象）。 */
const liveSessionOf = (ctx, sessionId) => {
	const sessions = serviceOf(ctx, 'sessions')

	if (sessions === undefined || typeof sessions.get !== 'function') return undefined

	try {
		return sessions.get(sessionId)
	} catch {
		return undefined
	}
}

/** 调用方自己的会话（就是「管理Bot」那一个）。 */
const callerSessionOf = (exec) => {
	const agent = exec === undefined || exec === null ? undefined : exec.agent

	if (agent === undefined || agent === null) return undefined

	const session = agent.session

	return session === undefined || session === null ? undefined : session
}

/**
 * 列一次全量会话行（宿主 SessionController）。
 *
 * 这是「存在」与「标题 / 最后活动 / 是否在跑」的主要来源：它同时覆盖活会话与
 * 持久化过的冷会话，而且**不会**顺手把 agent 拉起来。
 */
const listRowsOf = async (ctx, signal) => {
	const controller = serviceOf(ctx, 'sessionController')

	if (controller === undefined || typeof controller.list !== 'function') return undefined

	const value = await controller.list({}, signal)

	if (value === null || typeof value !== 'object' || !Array.isArray(value.items)) return []

	return value.items
}

/**
 * 找出一个会话。三级判据，任何一级命中就算存在：
 *   1. 活会话对象（ctx.sessions.get）
 *   2. 宿主会话列表里的一行（ctx.sessionController.list）
 *   3. 冷读标题快照（ctx.sessionQuery.readTitleSnapshot）
 *
 * @returns `{ found: true, ... }` / `{ found: false, checked: true }`（确认不存在）
 *   / `{ found: false, checked: false }`（当前部署没有任何可用的查询通道）。
 */
const findSession = async (ctx, sessionId, signal) => {
	const live = liveSessionOf(ctx, sessionId)

	if (live !== undefined) {
		return {
			found: true,
			id: sessionId,
			live: true,
			session: live,
			title: titleOfSession(ctx, live),
			row: undefined,
		}
	}

	let checked = false

	try {
		const items = await listRowsOf(ctx, signal)

		if (items !== undefined) {
			checked = true

			const row = items.find((item) => item !== null && typeof item === 'object' && item.sessionId === sessionId)

			if (row !== undefined) {
				return {
					found: true,
					id: sessionId,
					live: false,
					session: undefined,
					title: titleOfValues(row.projections === undefined ? undefined : row.projections.values),
					row,
				}
			}
		}
	} catch {
		// 列表通道这次不可用：继续往下试冷读
	}

	const query = serviceOf(ctx, 'sessionQuery')

	if (query !== undefined && typeof query.readTitleSnapshot === 'function') {
		try {
			const observation = await query.readTitleSnapshot(sessionId, signal)

			if (observation !== null && typeof observation === 'object' && observation.header !== undefined) {
				checked = true

				const snapshot = observation.title

				return {
					found: true,
					id: sessionId,
					live: false,
					session: undefined,
					title:
						snapshot !== null && typeof snapshot === 'object' && typeof snapshot.title === 'string'
							? snapshot.title
							: undefined,
					row: undefined,
				}
			}

			checked = true
		} catch {
			// 冷读失败：可能真的不存在，也可能只是通道挂了；checked 的判定交给上面
		}
	}

	return { found: false, checked }
}

/** 「找不到这个会话」的统一话术：给 id，给下一步怎么做，绝不猜一个替代目标。 */
const notFoundPayload = (sessionId) => ({
	ok: false,
	code: 'SESSION_NOT_FOUND',
	error:
		'找不到 session_id = "' +
		String(sessionId) +
		'" 的会话。先用 dsh_sessions_list 查真实 id；本插件不会替你猜一个「最近活跃的会话」。',
	session_id: String(sessionId),
})

const lookupUnavailablePayload = (sessionId) => ({
	ok: false,
	code: 'SESSION_LOOKUP_UNAVAILABLE',
	error:
		'当前部署没有可用的会话查询通道（ctx.sessionController / ctx.sessions / ctx.sessionQuery 都取不到），' +
		'所以无法确认 session_id = "' +
		String(sessionId) +
		'" 是否存在。',
	session_id: String(sessionId),
})
//#endregion

//#region 事件摘要（状态用）
const textOfMessage = (message) => {
	if (message === null || typeof message !== 'object') return undefined

	const content = message.content

	if (!Array.isArray(content)) return undefined

	const parts = []

	for (const block of content) {
		if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
			parts.push(block.text)
		}
	}

	return parts.length === 0 ? undefined : parts.join(' ')
}

/** 一条事件里能读给人看的那点文字（只认 user / assistant 的消息事件）。 */
const textOfEvent = (event) => {
	if (event === null || typeof event !== 'object') return undefined

	const data = event.data

	if (data === null || typeof data !== 'object') return undefined

	if (event.type === 'user/message') return textOfMessage(data)
	if (event.type === 'assistant/message') return textOfMessage(data.message)

	return undefined
}

/**
 * 把一段事件尾巴压成 `{ events, last_text }`。
 * 只保留最后几条的类型与时间：状态查询要的是「最近在干什么」，不是全量回放。
 */
const summarizeEvents = (events, tail = 8) => {
	if (!Array.isArray(events) || events.length === 0) return { events: [], last_text: undefined }

	const rows = []

	for (const event of events.slice(-tail)) {
		if (event === null || typeof event !== 'object') continue

		const row = { type: typeof event.type === 'string' ? event.type : 'unknown' }

		if (typeof event.seq === 'number') row.seq = event.seq

		const time = isoOf(event.time)

		if (time !== undefined) row.time = time

		rows.push(row)
	}

	let lastText

	for (let index = events.length - 1; index >= 0; index -= 1) {
		lastText = clip(textOfEvent(events[index]), 240)

		if (lastText !== undefined) break
	}

	return { events: rows, last_text: lastText }
}

/**
 * 拿一段会话的事件数组：活会话直接读内存；冷会话先 inspect（带正文），
 * 真不行才退到 sessionQuery.listEvents（只有元数据，没有正文）。
 *
 * 顺序是刻意的：listEvents 便宜但**不带 data**，先走它会把「最后一句说了什么」
 * 永远弄丢——状态查询要的恰恰是那句话。
 */
const eventsOfSession = async (ctx, sessionId, signal) => {
	const live = liveSessionOf(ctx, sessionId)

	if (live !== undefined && typeof live.snapshotEvents === 'function') {
		try {
			return live.snapshotEvents()
		} catch {
			// 读不到就往下走冷读
		}
	}

	const controller = serviceOf(ctx, 'sessionController')

	if (controller !== undefined && typeof controller.inspect === 'function') {
		try {
			const inspection = await controller.inspect(sessionId, signal)

			if (inspection !== null && typeof inspection === 'object' && Array.isArray(inspection.events)) {
				return inspection.events
			}
		} catch {
			// 冷读失败：退到轻量事件列表（至少还有类型和时间）
		}
	}

	const query = serviceOf(ctx, 'sessionQuery')

	if (query !== undefined && typeof query.listEvents === 'function') {
		try {
			return await query.listEvents(sessionId)
		} catch {
			// 两条都失败：状态只能报元数据
		}
	}

	return undefined
}
//#endregion

//#region 记忆：$DSH_HOME/plugins/dsh-agent-supervisor/memory
/** 默认落盘目录。测试用 config.memoryDir 覆盖到包内 .tmp/。 */
const defaultMemoryDir = () => {
	const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')

	return join(home, 'plugins', PLUGIN_DIRNAME, 'memory')
}

const factsPathOf = (memoryDir) => join(memoryDir, FACTS_FILENAME)
const notesPathOf = (memoryDir) => join(memoryDir, NOTES_FILENAME)

/** 读回全部事实条目；文件不在、坏了、读不动都当空。 */
const readFacts = (memoryDir) => {
	let raw

	try {
		raw = readFileSync(factsPathOf(memoryDir), 'utf8')
	} catch {
		return []
	}

	const facts = []

	for (const line of raw.split('\n')) {
		const trimmed = line.trim()

		if (trimmed === '') continue

		try {
			const parsed = JSON.parse(trimmed)

			if (parsed !== null && typeof parsed === 'object' && typeof parsed.key === 'string') facts.push(parsed)
		} catch {
			// 半行 / 手改坏的跳过：记忆丢一行不影响工具可用
		}
	}

	return facts
}

/**
 * 追加一条事实，并在 notes.md 里留一行人话。
 * 写失败只影响「记不记得」，**绝不抛**：记忆是附赠能力，不能拖垮会话管理。
 */
const appendFact = (memoryDir, fact) => {
	let ok = false

	try {
		mkdirSync(memoryDir, { recursive: true })
		appendFileSync(factsPathOf(memoryDir), JSON.stringify(fact) + '\n', 'utf8')
		ok = true
	} catch {
		ok = false
	}

	try {
		mkdirSync(memoryDir, { recursive: true })
		appendFileSync(
			notesPathOf(memoryDir),
			'- ' + fact.at + (fact.scope === undefined ? '' : ' [' + fact.scope + ']') + ' ' + fact.key + ' = ' + fact.value + '\n',
			'utf8',
		)
	} catch {
		// notes.md 只是给人看的镜像，写不进去不影响 facts.jsonl
	}

	return ok
}

/** 同 key 取值：后写的赢；给了 scope 就只在那一个 scope 里找。 */
const latestFact = (facts, key, scope) => {
	for (let index = facts.length - 1; index >= 0; index -= 1) {
		const fact = facts[index]

		if (fact.key !== key) continue
		if (scope !== undefined && fact.scope !== scope) continue

		return fact
	}

	return undefined
}
//#endregion

//#region 管理Bot会话 + 聊天转录（客户端面板的数据源）
/**
 * 标题等于「管理Bot」的那个会话。
 *
 * 先看活会话（内存里就有，最省），再看宿主列表（覆盖冷会话）。找不到就是找不到，
 * 不拿「最后活跃的那个」顶替。
 */
const findSupervisorSession = async (ctx, signal) => {
	const sessions = serviceOf(ctx, 'sessions')

	if (sessions !== undefined && typeof sessions.list === 'function') {
		let live

		try {
			live = sessions.list()
		} catch {
			live = undefined
		}

		if (Array.isArray(live)) {
			for (const session of live) {
				if (session === null || typeof session !== 'object') continue

				const title = titleOfSession(ctx, session)

				if (typeof title === 'string' && title.trim() === SUPERVISOR_TITLE) {
					return { id: session.id, title, live: true, session }
				}
			}
		}
	}

	let rows

	try {
		rows = await listRowsOf(ctx, signal)
	} catch {
		rows = undefined
	}

	if (rows !== undefined) {
		for (const row of rows) {
			if (row === null || typeof row !== 'object') continue

			const title = titleOfValues(row.projections === undefined ? undefined : row.projections.values)

			if (typeof title === 'string' && title.trim() === SUPERVISOR_TITLE) {
				return { id: row.sessionId, title, live: false, row }
			}
		}
	}

	return undefined
}

/**
 * 聊天面板要的事件流：真正带 message 的那种。
 *
 * 注意**不能**用 sessionQuery.listEvents —— 它只回轻量元数据（seq/type/time），
 * 没有正文。所以：活会话读内存快照 → 冷会话 readSession（完整日志）→ 最后 inspect。
 * 三条都不通就返回 undefined，让路由如实回「读不到」，而不是编一个空对话。
 */
const chatEventsOf = async (ctx, sessionId, signal) => {
	const live = liveSessionOf(ctx, sessionId)

	if (live !== undefined && typeof live.snapshotEvents === 'function') {
		try {
			return live.snapshotEvents()
		} catch {
			// 往下走冷读
		}
	}

	const query = serviceOf(ctx, 'sessionQuery')

	if (query !== undefined && typeof query.readSession === 'function') {
		try {
			const snapshot = await query.readSession(sessionId)

			if (snapshot !== null && typeof snapshot === 'object' && Array.isArray(snapshot.events)) return snapshot.events
		} catch {
			// 冷读失败：退到 inspect
		}
	}

	const controller = serviceOf(ctx, 'sessionController')

	if (controller !== undefined && typeof controller.inspect === 'function') {
		try {
			const inspection = await controller.inspect(sessionId, signal)

			if (inspection !== null && typeof inspection === 'object' && Array.isArray(inspection.events)) return inspection.events
		} catch {
			// 三条都不通
		}
	}

	return undefined
}

/**
 * 事件 → 面板气泡。
 *
 * 两个刻意的过滤：
 *   - user/message 只认 `source.kind === 'user'` 的（真人打的字）；system 注入的
 *     上下文、文件变更通知之类不该冒充成「你说的话」。
 *   - 落过 replacement 的 assistant 消息跳过（`surfaceOp !== 'append'`）：那份是给
 *     模型看的历史，不是用户已经看见过的对话。
 *
 * @returns 最近 `limit` 条 `{ id, role, text, atMs }`。
 */
const messagesOfEvents = (events, limit) => {
	const rows = []

	for (const event of events) {
		if (event === null || typeof event !== 'object') continue

		if (event.type === 'user/message') {
			const data = event.data

			if (data === null || typeof data !== 'object') continue
			if (data.source !== undefined && data.source !== null && typeof data.source === 'object' && data.source.kind !== 'user') continue

			const text = textOfMessage(data)

			if (text === undefined) continue

			rows.push({ id: 'seq-' + String(event.seq), role: 'user', text, atMs: event.time })
		} else if (event.type === 'assistant/message') {
			if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') continue

			const data = event.data

			if (data === null || typeof data !== 'object') continue

			const text = textOfMessage(data.message)

			if (text === undefined) continue

			rows.push({ id: 'seq-' + String(event.seq), role: 'agent', text, atMs: event.time })
		}
	}

	const bounded = rows.length > limit ? rows.slice(rows.length - limit) : rows

	return bounded.map((row) => {
		const item = { id: row.id, role: row.role, text: row.text }

		if (typeof row.atMs === 'number') item.atMs = row.atMs

		return item
	})
}

/** GET /chat 的载荷。读不到就如实说，不编。 */
const chatPayload = async (ctx, signal) => {
	let supervisor

	try {
		supervisor = await findSupervisorSession(ctx, signal)
	} catch (failure) {
		return {
			ok: false,
			code: 'SUPERVISOR_LOOKUP_FAILED',
			message: '查管理Bot会话时出错：' + messageOf(failure),
			sessionId: null,
			title: null,
			messages: [],
		}
	}

	if (supervisor === undefined) {
		return {
			ok: false,
			code: 'NO_SUPERVISOR',
			message: '还没有「管理Bot」会话：请在侧栏新建一个会话，并把它命名为 管理Bot。',
			sessionId: null,
			title: null,
			messages: [],
		}
	}

	const events = await chatEventsOf(ctx, supervisor.id, signal)

	if (events === undefined) {
		return {
			ok: false,
			code: 'TRANSCRIPT_UNAVAILABLE',
			message: '暂时读不到管理Bot会话的内容（宿主这边没有可用的会话读取通道）。',
			sessionId: supervisor.id,
			title: supervisor.title,
			messages: [],
		}
	}

	return {
		ok: true,
		sessionId: supervisor.id,
		title: supervisor.title,
		messages: messagesOfEvents(events, CHAT_MESSAGE_LIMIT),
	}
}

/** POST /chat：把一句话发进管理Bot会话的队列。 */
const chatPost = async (ctx, text, signal) => {
	const supervisor = await findSupervisorSession(ctx, signal)

	if (supervisor === undefined) {
		return { ok: false, code: 'NO_SUPERVISOR', message: '还没有「管理Bot」会话，这句没发出去。', sessionId: null }
	}

	const controller = serviceOf(ctx, 'sessionController')

	if (controller === undefined || typeof controller.prompt !== 'function') {
		return { ok: false, code: 'SEND_UNAVAILABLE', message: '当前部署没有 ctx.sessionController.prompt，发不出去。', sessionId: supervisor.id }
	}

	try {
		await controller.prompt(
			{
				requestId: randomUUID(),
				sessionId: supervisor.id,
				mode: 'queue',
				content: [{ type: 'text', text }],
			},
			signal,
		)
	} catch (failure) {
		return { ok: false, code: 'PROMPT_FAILED', message: '消息没能进入管理Bot会话：' + messageOf(failure), sessionId: supervisor.id }
	}

	return { ok: true, sessionId: supervisor.id, title: supervisor.title }
}

/** 读完请求体（带上限）；读失败给空串，让调用方回 BAD_JSON。 */
const readRequestBody = (req) =>
	new Promise((resolve) => {
		let raw = ''
		let settled = false

		const finish = (value) => {
			if (settled) return

			settled = true
			resolve(value)
		}

		try {
			if (typeof req.on !== 'function') {
				finish('')

				return
			}

			req.on('data', (chunk) => {
				if (settled) return

				raw += String(chunk)

				if (raw.length > CHAT_BODY_LIMIT) finish(raw.slice(0, CHAT_BODY_LIMIT))
			})
			req.on('end', () => finish(raw))
			req.on('error', () => finish(''))
		} catch {
			finish('')
		}
	})
//#endregion

/**
 * 装配插件。
 *
 * @param ctx - 宿主 Cordis 上下文。
 * @param config - `{ onlySupervisor?: boolean, memoryDir?: string }`。
 *   `onlySupervisor` 默认 **true**：只有标题是「管理Bot」的会话能执行这些工具。
 */
export function apply(ctx, config = {}) {
	const settings = config === null || typeof config !== 'object' ? {} : config
	const onlySupervisor = settings.onlySupervisor !== false
	const memoryDir =
		typeof settings.memoryDir === 'string' && settings.memoryDir !== '' ? settings.memoryDir : defaultMemoryDir()

	/**
	 * 调用方是不是「管理Bot」。
	 *
	 * 判据只有一个：**调用方自己的会话标题**（exec.agent.session）规范化后等于「管理Bot」。
	 * 不是 id 白名单、不是 cwd、不是「最后一个会话」——标题是用户唯一改得动、
	 * 也唯一看得见的那个标签。
	 */
	const supervisorDenial = (exec) => {
		if (!onlySupervisor) return undefined

		const session = callerSessionOf(exec)

		if (session === undefined) {
			return {
				ok: false,
				code: 'FORBIDDEN',
				error:
					'无法确认调用方会话（这次工具调用没有绑定 agent/session）。' +
					'本插件只允许标题为「管理Bot」的会话执行；把 config.onlySupervisor 设为 false 可关闭这条限制。',
			}
		}

		const title = titleOfSession(ctx, session)

		if (typeof title === 'string' && title.trim() === SUPERVISOR_TITLE) return undefined

		const denial = {
			ok: false,
			code: 'FORBIDDEN',
			error:
				'只有标题为「管理Bot」的会话可以执行 dsh_* 工具。当前调用方会话标题是 ' +
				(typeof title === 'string' ? '「' + title + '」' : '（还没有标题）') +
				'。把这个会话改名成 管理Bot 后重试，或者把插件配置的 onlySupervisor 设为 false。',
		}

		if (typeof session.id === 'string' && session.id !== '') denial.session_id = session.id

		return denial
	}

	/** 统一的执行壳：先过门，再跑具体逻辑；任何异常都变成可读结果。 */
	const guard = (handler) => async (args, exec) => {
		const denial = supervisorDenial(exec)

		if (denial !== undefined) return denial

		try {
			return await handler(args === null || typeof args !== 'object' ? {} : args, exec)
		} catch (failure) {
			return {
				ok: false,
				code: 'INTERNAL_ERROR',
				error: messageOf(failure),
			}
		}
	}

	//#region 1. dsh_sessions_list
	ctx.tools.register(
		defineTool({
			name: 'dsh_sessions_list',
			description:
				'列出当前 DSH 里的会话（id、标题、最后活动时间、是否在跑、是否调用方自己）。' +
				'这是拿到真实 session_id 的唯一入口：不要凭印象编 id。',
			parameters: {
				query: { type: 'string', description: '可选：按标题或 id 做包含匹配过滤。' },
				limit: { type: 'number', description: '可选：最多返回多少条（1-200，默认 50）。' },
			},
			output: OUTPUT,
			execute: guard(async (args, exec) => {
				const signal = exec === undefined || exec === null ? undefined : exec.signal
				const caller = callerSessionOf(exec)
				const callerId = caller === undefined ? undefined : caller.id

				let rows
				let source

				try {
					rows = await listRowsOf(ctx, signal)
					source = rows === undefined ? undefined : 'sessionController'
				} catch (failure) {
					rows = undefined
				}

				if (rows === undefined) {
					// 兜底：只有活会话可列，但至少能用；如实标出来源。
					const sessions = serviceOf(ctx, 'sessions')
					const agents = serviceOf(ctx, 'agents')
					const live = sessions !== undefined && typeof sessions.list === 'function' ? sessions.list() : undefined

					if (!Array.isArray(live)) {
						return {
							ok: false,
							code: 'LIST_UNAVAILABLE',
							error: '当前部署既没有 ctx.sessionController 也没有 ctx.sessions，列不出会话。',
						}
					}

					source = 'sessions'
					rows = live.map((session) => {
						const agent = agents !== undefined && typeof agents.get === 'function' ? agents.get(session.id) : undefined

						return {
							sessionId: session.id,
							updatedAt: session.header === undefined ? undefined : session.header.createdAt,
							running: agent !== undefined && agent.status === 'running',
							agentAvailable: agent !== undefined,
							blank: session.seq === 0,
							title: titleOfSession(ctx, session),
						}
					})
				}

				const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
				const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.min(Math.max(Math.trunc(args.limit), 1), 200) : 50

				const sessions = []

				for (const row of rows) {
					if (row === null || typeof row !== 'object') continue

					const id = row.sessionId

					if (typeof id !== 'string' || id === '') continue

					const title =
						row.title !== undefined && typeof row.title === 'string' ? row.title : titleOfValues(row.projections === undefined ? undefined : row.projections.values)

					if (query !== '' && !String(id).toLowerCase().includes(query) && !(typeof title === 'string' && title.toLowerCase().includes(query))) {
						continue
					}

					const item = { id }

					if (typeof title === 'string' && title !== '') item.title = title

					const updatedAt = isoOf(row.updatedAt)

					if (updatedAt !== undefined) item.updated_at = updatedAt

					item.running = row.running === true
					item.agent_available = row.agentAvailable === true
					item.current = callerId !== undefined && id === callerId
					item.blank = row.blank === true

					sessions.push(item)
				}

				const limited = sessions.slice(0, limit)

				const payload = {
					ok: true,
					count: limited.length,
					sessions: limited,
					source,
				}

				if (callerId !== undefined) payload.current_session_id = callerId

				return payload
			}),
		}),
	)
	//#endregion

	//#region 2. dsh_session_send
	ctx.tools.register(
		defineTool({
			name: 'dsh_session_send',
			description:
				'往**指定的**会话发一条消息（队列模式，不打断它手上正在做的事）。' +
				'返回里带目标会话标题，用来核对「发对人了」。session_id 不存在时返回 SESSION_NOT_FOUND，绝不猜目标。',
			parameters: {
				session_id: { type: 'string', required: true, description: '目标会话的精确 id（来自 dsh_sessions_list）。' },
				text: { type: 'string', required: true, description: '要发过去的自然语言内容。' },
			},
			output: OUTPUT,
			execute: guard(async (args, exec) => {
				const sessionId = args.session_id
				const text = typeof args.text === 'string' ? args.text : ''

				if (text.trim() === '') {
					return { ok: false, code: 'EMPTY_TEXT', error: 'text 不能是空字符串。', session_id: String(sessionId) }
				}

				const signal = exec === undefined || exec === null ? undefined : exec.signal
				const target = await findSession(ctx, sessionId, signal)

				if (!target.found) {
					return target.checked ? notFoundPayload(sessionId) : lookupUnavailablePayload(sessionId)
				}

				const controller = serviceOf(ctx, 'sessionController')

				if (controller === undefined || typeof controller.prompt !== 'function') {
					return {
						ok: false,
						code: 'SEND_UNAVAILABLE',
						error: '当前部署没有 ctx.sessionController.prompt，发不了消息。',
						session_id: sessionId,
					}
				}

				try {
					await controller.prompt(
						{
							requestId: randomUUID(),
							sessionId,
							mode: 'queue',
							content: [{ type: 'text', text }],
						},
						signal === undefined ? new AbortController().signal : signal,
					)
				} catch (failure) {
					return {
						ok: false,
						code: 'PROMPT_FAILED',
						error: '消息没能进入目标会话：' + messageOf(failure),
						session_id: sessionId,
						...(typeof target.title === 'string' ? { title: target.title } : {}),
					}
				}

				const payload = { ok: true, session_id: sessionId }

				if (typeof target.title === 'string' && target.title !== '') payload.title = target.title

				return payload
			}),
		}),
	)
	//#endregion

	//#region 3. dsh_session_start
	ctx.tools.register(
		defineTool({
			name: 'dsh_session_start',
			description:
				'新建一个会话并让它跑一个任务。给 title 就顺手把会话改名（语音/标题匹配用）。返回新会话的 session_id。',
			parameters: {
				title: { type: 'string', description: '可选：新会话的标题。' },
				text: { type: 'string', required: true, description: '交给新会话的第一条任务。' },
			},
			output: OUTPUT,
			execute: guard(async (args, exec) => {
				const text = typeof args.text === 'string' ? args.text : ''
				const title = typeof args.title === 'string' ? args.title.trim() : ''

				if (text.trim() === '') {
					return { ok: false, code: 'EMPTY_TEXT', error: 'text 不能是空字符串。' }
				}

				const controller = serviceOf(ctx, 'sessionController')

				if (controller === undefined || typeof controller.create !== 'function') {
					return { ok: false, code: 'CREATE_UNAVAILABLE', error: '当前部署没有 ctx.sessionController.create，新建不了会话。' }
				}

				const signal = exec === undefined || exec === null ? undefined : exec.signal
				const caller = callerSessionOf(exec)
				const cwd = caller !== undefined && caller.header !== undefined && typeof caller.header.cwd === 'string' ? caller.header.cwd : undefined

				let sessionId

				try {
					const created = await controller.create(cwd === undefined ? {} : { cwd })

					sessionId = created === null || typeof created !== 'object' ? undefined : created.sessionId
				} catch (failure) {
					return { ok: false, code: 'CREATE_FAILED', error: '新建会话失败：' + messageOf(failure) }
				}

				if (typeof sessionId !== 'string' || sessionId === '') {
					return { ok: false, code: 'CREATE_FAILED', error: '新建会话没有返回 sessionId。' }
				}

				let acceptedTitle

				if (title !== '' && typeof controller.rename === 'function') {
					try {
						const renamed = await controller.rename({ sessionId, title })

						acceptedTitle = renamed !== null && typeof renamed === 'object' && typeof renamed.title === 'string' ? renamed.title : title
					} catch {
						// 改名失败不影响任务：新会话照样跑，返回里带 session_id
					}
				}

				if (typeof controller.prompt !== 'function') {
					return {
						ok: false,
						session_id: sessionId,
						...(acceptedTitle === undefined ? {} : { title: acceptedTitle }),
						code: 'PROMPT_UNAVAILABLE',
						error: '会话建好了（' + sessionId + '），但当前部署没有 prompt 能力，任务没有发出去。',
					}
				}

				try {
					await controller.prompt(
						{
							requestId: randomUUID(),
							sessionId,
							mode: 'queue',
							content: [{ type: 'text', text }],
						},
						signal === undefined ? new AbortController().signal : signal,
					)
				} catch (failure) {
					return {
						ok: false,
						code: 'PROMPT_FAILED',
						session_id: sessionId,
						error: '会话建好了（' + sessionId + '），但第一条任务没发出去：' + messageOf(failure),
						...(acceptedTitle === undefined ? {} : { title: acceptedTitle }),
					}
				}

				const payload = { ok: true, session_id: sessionId }

				if (acceptedTitle !== undefined) payload.title = acceptedTitle

				return payload
			}),
		}),
	)
	//#endregion

	//#region 4. dsh_session_status
	ctx.tools.register(
		defineTool({
			name: 'dsh_session_status',
			description:
				'查某个会话最近在干什么：是否在跑、最后活动时间、最后几条事件类型，以及最后一句用户/助手文本。只读。',
			parameters: {
				session_id: { type: 'string', required: true, description: '目标会话的精确 id。' },
			},
			output: OUTPUT,
			execute: guard(async (args, exec) => {
				const sessionId = args.session_id
				const signal = exec === undefined || exec === null ? undefined : exec.signal
				const target = await findSession(ctx, sessionId, signal)

				if (!target.found) {
					return target.checked ? notFoundPayload(sessionId) : lookupUnavailablePayload(sessionId)
				}

				const row = target.row
				const summary = summarizeEvents(await eventsOfSession(ctx, sessionId, signal))

				const payload = {
					ok: true,
					session_id: sessionId,
					live: target.live === true,
				}

				const title = typeof target.title === 'string' && target.title !== '' ? target.title : undefined

				if (title !== undefined) payload.title = title

				if (row !== undefined) {
					payload.running = row.running === true
					payload.agent_available = row.agentAvailable === true
					payload.blank = row.blank === true

					const updatedAt = isoOf(row.updatedAt)

					if (updatedAt !== undefined) payload.updated_at = updatedAt
				} else if (target.live === true && target.session !== undefined) {
					const agent = serviceOf(ctx, 'agents')
					const liveAgent = agent !== undefined && typeof agent.get === 'function' ? agent.get(sessionId) : undefined

					payload.running = liveAgent !== undefined && liveAgent.status === 'running'
					payload.agent_available = liveAgent !== undefined
				}

				payload.events = summary.events

				if (summary.last_text !== undefined) payload.last_text = summary.last_text

				return payload
			}),
		}),
	)
	//#endregion

	//#region 5. dsh_session_rename
	ctx.tools.register(
		defineTool({
			name: 'dsh_session_rename',
			description:
				'给会话改一个短名（语音匹配、侧栏辨识用）。只改标题这一个字段，不动会话内容。',
			parameters: {
				session_id: { type: 'string', required: true, description: '目标会话的精确 id。' },
				title: { type: 'string', required: true, description: '新标题（不能全是空白）。' },
			},
			output: OUTPUT,
			execute: guard(async (args, exec) => {
				const sessionId = args.session_id
				const title = typeof args.title === 'string' ? args.title : ''

				if (title.trim() === '') {
					return { ok: false, code: 'EMPTY_TITLE', error: 'title 不能全是空白。', session_id: String(sessionId) }
				}

				const signal = exec === undefined || exec === null ? undefined : exec.signal
				const target = await findSession(ctx, sessionId, signal)

				if (!target.found) {
					return target.checked ? notFoundPayload(sessionId) : lookupUnavailablePayload(sessionId)
				}

				const controller = serviceOf(ctx, 'sessionController')

				if (controller === undefined || typeof controller.rename !== 'function') {
					return {
						ok: false,
						code: 'RENAME_UNAVAILABLE',
						error: '当前部署没有 ctx.sessionController.rename，改不了标题。',
						session_id: sessionId,
					}
				}

				let accepted

				try {
					const value = await controller.rename({ sessionId, title: title.trim() })

					accepted = value !== null && typeof value === 'object' && typeof value.title === 'string' ? value.title : title.trim()
				} catch (failure) {
					return {
						ok: false,
						code: 'RENAME_FAILED',
						error: '改名失败：' + messageOf(failure),
						session_id: sessionId,
					}
				}

				const payload = { ok: true, session_id: sessionId, title: accepted }

				if (typeof target.title === 'string' && target.title !== '') payload.previous_title = target.title

				return payload
			}),
		}),
	)
	//#endregion

	//#region 6. dsh_memory
	ctx.tools.register(
		defineTool({
			name: 'dsh_memory',
			description:
				'管理Bot的长期记忆：put 写一条、get 读一条、list 列全部 key。' +
				'落在 $DSH_HOME/plugins/dsh-agent-supervisor/memory/（facts.jsonl + notes.md）。写失败只影响「记不记得」，不会让调用失败。',
			parameters: {
				op: { type: 'string', required: true, enum: ['put', 'get', 'list'], description: 'put | get | list。' },
				key: { type: 'string', description: 'put / get 的键（短横线或下划线都行，自己保持一致）。' },
				value: { type: 'string', description: 'put 的值（字符串；结构化内容自己 JSON.stringify）。' },
				scope: { type: 'string', description: '可选：命名空间，用来隔离不同项目 / 不同主题的记忆。' },
			},
			output: OUTPUT,
			execute: guard(async (args) => {
				const op = args.op
				const key = typeof args.key === 'string' ? args.key.trim() : ''
				const scope = typeof args.scope === 'string' && args.scope.trim() !== '' ? args.scope.trim() : undefined

				if (op === 'put') {
					if (key === '') return { ok: false, code: 'MISSING_KEY', error: 'put 需要 key。' }

					const value = typeof args.value === 'string' ? args.value : ''
					const fact = { key, value, at: new Date().toISOString() }

					if (scope !== undefined) fact.scope = scope

					const written = appendFact(memoryDir, fact)

					const payload = { ok: true, op: 'put', key, value }

					if (scope !== undefined) payload.scope = scope

					if (!written) {
						// 记不住不是调用失败：如实说一句，工具照样 ok
						payload.code = 'MEMORY_WRITE_FAILED'
						payload.error = '这条记忆没落盘（目录不可写）：' + factsPathOf(memoryDir)
					}

					return payload
				}

				if (op === 'get') {
					if (key === '') return { ok: false, code: 'MISSING_KEY', error: 'get 需要 key。' }

					const facts = readFacts(memoryDir)
					const fact = latestFact(facts, key, scope)

					if (fact === undefined) {
						const payload = { ok: false, code: 'MEMORY_NOT_FOUND', error: '没有记过 key = "' + key + '"。', key }

						if (scope !== undefined) payload.scope = scope

						return payload
					}

					const payload = { ok: true, op: 'get', key, value: String(fact.value) }

					if (typeof fact.scope === 'string') payload.scope = fact.scope

					return payload
				}

				if (op === 'list') {
					const facts = readFacts(memoryDir)
					const seen = []
					const byKey = new Map()

					for (const fact of facts) {
						if (scope !== undefined && fact.scope !== scope) continue

						if (!byKey.has(fact.key)) seen.push(fact.key)
						byKey.set(fact.key, fact)
					}

					const payload = { ok: true, op: 'list', count: seen.length, keys: seen }

					if (scope !== undefined) payload.scope = scope

					return payload
				}

				return { ok: false, code: 'BAD_OP', error: 'op 只能是 put / get / list，收到：' + String(op) }
			}),
		}),
	)
	//#endregion

	//#region 7. HTTP 路由：客户端右下角面板的数据源
	//
	// 为什么是路由而不是工具：面板是浏览器里的东西，它没法「调用工具」——
	// 要走 HTTP。这两条路由都只碰管理Bot会话本身：GET 读转录、POST 往队列里塞一句话，
	// 都不删、不取消、不改会话内容以外的状态。
	/**
	 * `POST /command` 的实现：绕过模型，直接调 sessionController。
	 *
	 * 给桥接用，让手机端能列会话 / 新建会话 / 往指定会话投递任务，
	 * 不经过「管理Bot」那层自然语言理解。op 只支持 list / start / send。
	 *
	 * @returns `{ status, body }`，由调用方写回 HTTP。
	 */
	const runCommand = async (ctx, body, signal) => {
		const op = typeof body.op === 'string' ? body.op.trim() : ''
		const controller = serviceOf(ctx, 'sessionController')

		if (controller === undefined) {
			return { status: 503, body: { ok: false, code: 'SESSION_CONTROLLER_UNAVAILABLE', message: '当前部署没有 sessionController。' } }
		}

		if (op === 'list') {
			let rows

			try {
				rows = await listRowsOf(ctx, signal)
			} catch (failure) {
				return { status: 502, body: { ok: false, code: 'LIST_FAILED', message: messageOf(failure) } }
			}

			const sessions = []

			for (const row of rows === undefined ? [] : rows) {
				if (row === null || typeof row !== 'object' || typeof row.sessionId !== 'string') continue

				const title =
					row.title !== undefined && typeof row.title === 'string'
						? row.title
						: titleOfValues(row.projections === undefined ? undefined : row.projections.values)
				const updatedAt = isoOf(row.updatedAt)

				sessions.push({
					sessionId: row.sessionId,
					...(typeof title === 'string' && title !== '' ? { title } : {}),
					...(updatedAt === undefined ? {} : { updatedAt }),
					running: row.running === true,
				})
			}

			return { status: 200, body: { ok: true, count: sessions.length, sessions } }
		}

		if (op === 'start') {
			const text = typeof body.text === 'string' ? body.text : ''

			if (text.trim() === '') {
				return { status: 400, body: { ok: false, code: 'EMPTY_TEXT', message: 'text 不能是空的。' } }
			}

			if (typeof controller.create !== 'function') {
				return { status: 503, body: { ok: false, code: 'CREATE_UNAVAILABLE', message: '当前部署没有 sessionController.create。' } }
			}

			let sessionId

			try {
				const created = await controller.create(typeof body.cwd === 'string' && body.cwd !== '' ? { cwd: body.cwd } : {})

				sessionId = created === null || typeof created !== 'object' ? undefined : created.sessionId
			} catch (failure) {
				return { status: 502, body: { ok: false, code: 'CREATE_FAILED', message: messageOf(failure) } }
			}

			if (typeof sessionId !== 'string' || sessionId === '') {
				return { status: 502, body: { ok: false, code: 'CREATE_FAILED', message: 'create 没有返回 sessionId。' } }
			}

			let title
			const wanted = typeof body.title === 'string' ? body.title.trim() : ''

			if (wanted !== '' && typeof controller.rename === 'function') {
				try {
					const renamed = await controller.rename({ sessionId, title: wanted })

					title = renamed !== null && typeof renamed === 'object' && typeof renamed.title === 'string' ? renamed.title : wanted
				} catch {
					// 改名失败不影响任务投递
				}
			}

			try {
				await controller.prompt({ requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text }] }, signal)
			} catch (failure) {
				return { status: 502, body: { ok: false, code: 'PROMPT_FAILED', sessionId, message: messageOf(failure) } }
			}

			return { status: 200, body: { ok: true, sessionId, ...(title === undefined ? {} : { title }) } }
		}

		if (op === 'send') {
			const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
			const text = typeof body.text === 'string' ? body.text : ''

			if (sessionId === '') {
				return { status: 400, body: { ok: false, code: 'MISSING_SESSION_ID', message: 'sessionId 必填。' } }
			}

			if (text.trim() === '') {
				return { status: 400, body: { ok: false, code: 'EMPTY_TEXT', message: 'text 不能是空的。' } }
			}

			const target = await findSession(ctx, sessionId, signal)

			if (!target.found) {
				return {
					status: 404,
					body: { ok: false, code: target.checked ? 'SESSION_NOT_FOUND' : 'SESSION_LOOKUP_UNAVAILABLE', sessionId },
				}
			}

			try {
				await controller.prompt({ requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text }] }, signal)
			} catch (failure) {
				return { status: 502, body: { ok: false, code: 'PROMPT_FAILED', sessionId, message: messageOf(failure) } }
			}

			return { status: 200, body: { ok: true, sessionId, ...(typeof target.title === 'string' ? { title: target.title } : {}) } }
		}

		if (op === 'createSession') {
		if (typeof controller.create !== 'function') {
			return { status: 503, body: { ok: false, code: 'CREATE_UNAVAILABLE', message: '当前部署没有 sessionController.create。' } }
		}

		const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : ''
		const cwd = typeof body.cwd === 'string' ? body.cwd.trim() : ''
		const agentPreset = typeof body.agentPreset === 'string' ? body.agentPreset.trim() : ''
		const request = {}

		if (workspaceId !== '') request.workspaceId = workspaceId
		else if (cwd !== '') request.cwd = cwd
		if (agentPreset !== '') request.agentPreset = agentPreset

		let created

		try {
			created = await controller.create(request)
		} catch (failure) {
			return { status: 502, body: { ok: false, code: 'CREATE_FAILED', message: messageOf(failure) } }
		}

		const sessionId = created === null || typeof created !== 'object' ? undefined : created.sessionId

		if (typeof sessionId !== 'string' || sessionId === '') {
			return { status: 502, body: { ok: false, code: 'CREATE_FAILED', message: 'create 没有返回 sessionId。' } }
		}

		let title
		const wantedTitle = typeof body.title === 'string' ? body.title.trim() : ''

		if (wantedTitle !== '' && typeof controller.rename === 'function') {
			try {
				const renamed = await controller.rename({ sessionId, title: wantedTitle })

				title = renamed !== null && typeof renamed === 'object' && typeof renamed.title === 'string' ? renamed.title : wantedTitle
			} catch {
				// 改名失败不影响会话本身
			}
		}

		return { status: 200, body: { ok: true, sessionId, ...(title === undefined ? {} : { title }) } }
	}

	if (op === 'createWorkspace') {
		const targetPath = typeof body.path === 'string' ? body.path.trim() : ''

		if (targetPath === '') {
			return { status: 400, body: { ok: false, code: 'MISSING_PATH', message: 'path 必填。' } }
		}

		const workspaceController = serviceOf(ctx, 'workspaceController')

		if (workspaceController === undefined || typeof workspaceController.create !== 'function') {
			return { status: 503, body: { ok: false, code: 'WORKSPACE_UNAVAILABLE', message: '当前部署没有 workspaceController.create。' } }
		}

		let created

		try {
			created = await workspaceController.create({ path: targetPath })
		} catch (failure) {
			return { status: 502, body: { ok: false, code: 'WORKSPACE_CREATE_FAILED', message: messageOf(failure) } }
		}

		const workspaceId =
			created !== null && typeof created === 'object'
				? created.workspaceId ?? created.id ?? (typeof created.workspace === 'object' ? created.workspace?.id : undefined)
				: undefined

		if (typeof workspaceId !== 'string' || workspaceId === '') {
			return { status: 502, body: { ok: false, code: 'WORKSPACE_CREATE_FAILED', message: 'create 没有返回 workspaceId。' } }
		}

		let title
		const wanted = typeof body.title === 'string' ? body.title.trim() : ''

		if (wanted !== '' && typeof workspaceController.rename === 'function') {
			try {
				await workspaceController.rename({ workspaceId, title: wanted })
				title = wanted
			} catch {
				// 改名失败不影响工作区创建
			}
		}

		return { status: 200, body: { ok: true, workspaceId, ...(title === undefined ? {} : { title }) } }
	}

	return { status: 400, body: { ok: false, code: 'UNKNOWN_OP', message: 'op 只支持 list / start / send / createSession / createWorkspace。', op } }
	}

	/** `/command` 的可选共享密钥：设了环境变量才校验，没设就只靠「仅回环可访问」。 */
	const commandKeyOf = () => (typeof process.env.DSH_SUPERVISOR_KEY === 'string' ? process.env.DSH_SUPERVISOR_KEY.trim() : '')

	if (settings.web !== false && typeof ctx.inject === 'function') {
		ctx.inject(['webServer'], (webCtx) => {
			webCtx.effect(() =>
				webCtx.webServer.register({
					kind: 'prefix',
					path: ROUTE,
					handler: async (req, res) => {
						const json = (code, body) => {
							res.writeHead(code, {
								'content-type': 'application/json; charset=utf-8',
								'cache-control': 'no-store',
							})
							res.end(JSON.stringify(body))
						}

						let path = '/'

						try {
							path = new URL(String(req.url === undefined || req.url === null ? '/' : req.url), 'http://localhost').pathname.replace(ROUTE, '') || '/'
						} catch {
							path = '/'
						}

						if (path === '/command') {
							const cmdMethod = String(req.method === undefined || req.method === null ? 'GET' : req.method).toUpperCase()

							if (cmdMethod !== 'POST') {
								json(405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: '/command 只支持 POST。' })

								return
							}

							const required = commandKeyOf()

							if (required !== '' && String(req.headers['x-supervisor-key'] === undefined ? '' : req.headers['x-supervisor-key']) !== required) {
								json(401, { ok: false, code: 'UNAUTHORIZED', message: '缺少或错误的 x-supervisor-key。' })

								return
							}

							let payload

							try {
								const raw = await readRequestBody(req)

								payload = raw === '' ? {} : JSON.parse(raw)
							} catch {
								json(400, { ok: false, code: 'BAD_JSON', message: 'body 必须是 JSON。' })

								return
							}

							let outcome

							try {
								outcome = await runCommand(ctx, payload === null || typeof payload !== 'object' ? {} : payload, new AbortController().signal)
							} catch (failure) {
								outcome = { status: 500, body: { ok: false, code: 'COMMAND_FAILED', message: messageOf(failure) } }
							}

							json(outcome.status === undefined ? 200 : outcome.status, outcome.body)

							return
						}

						if (path !== '/chat') {
							json(404, { ok: false, code: 'NOT_FOUND', message: '没有这个路由：' + path })

							return
						}

						const method = String(req.method === undefined || req.method === null ? 'GET' : req.method).toUpperCase()
						// 这个 handler 没有调用方的 signal：给一个永不过期的，别让 list() 的 throwIfAborted 拿到 undefined
						const signal = new AbortController().signal

						try {
							if (method === 'GET') {
								json(200, await chatPayload(ctx, signal))

								return
							}

							if (method === 'POST') {
								const raw = await readRequestBody(req)
								let body

								try {
									body = raw === '' ? {} : JSON.parse(raw)
								} catch {
									json(400, { ok: false, code: 'BAD_JSON', message: 'body 必须是 JSON。' })

									return
								}

								const text = body !== null && typeof body === 'object' && typeof body.text === 'string' ? body.text : ''

								if (text.trim() === '') {
									json(400, { ok: false, code: 'EMPTY_TEXT', message: 'text 不能是空的。' })

									return
								}

								json(200, await chatPost(ctx, text, signal))

								return
							}

							json(405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: '只支持 GET / POST。' })
						} catch (failure) {
							json(500, { ok: false, code: 'INTERNAL_ERROR', message: messageOf(failure) })
						}
					},
				}),
			)
		})
	}
	//#endregion
}
