/**
 * dsh-deliverables-index —— 宿主半身：把「每个会话各自产出过哪些文档」摊成一张表。
 *
 * 数据来源只有一个：会话日志里 `deliverables/presented` 事件（`present` 工具写
 * 的那条）。**不扫盘、不猜**——用户现在的问题是「找文件得先想起来是哪个对话」，
 * 而 DSH 本来就把「哪个对话呈现过哪个文件」记下来了，这里只是把它读出来。
 *
 * 两条路由（前缀 `/dsh-deliverables`，客户端那半写死同一个串）：
 *   GET  /list   最近 N 个会话 → 展开成文件清单（含 `exists` 真实探测）
 *   POST /open   `{sessionId, seq, index, action}` → 调宿主原生打开 / 在文件夹里显示
 *
 * 「打开」有两条路，README 里写清了区别：
 *   1. 客户端直接用文件条目里的 `url`（= `api/present.open?sessionId&seq&index`，
 *      和 @deepseek-ai/dsh-client-ui-deliverables 的 `presentedFileUrl()` 同一个
 *      路由），POST 上去就是宿主原生打开。**这是首选**，不用经过本插件。
 *   2. 本插件的 `POST /open`：走 `ctx.sessionController.openWorkspacePath()`，
 *      好处是路由在本插件自己的前缀下（不依赖 /api 的鉴权围栏）。
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import {
	buildSessionEntry,
	createCache,
	displayPathOf,
	extOf,
	foldTitle,
	isPresentedData,
	PRESENT_OPEN_ROUTE,
	presentedEventOf,
	resolveHostPath,
} from './catalog.js'

export const name = 'deliverables-index'

/**
 * 真正用到的服务：HTTP 路由载体。
 *
 * 会话读取通道（`sessionController` / `sessionQuery` / `sessions`）**故意不写进
 * inject**：不同部署里可能缺其中一两个，缺了要如实回「读不到」，而不是让整个
 * 插件加载不起来。所以那几个用 `ctx.get()` 在调用时现取（和 dsh-agent-supervisor
 * 一个路子）。
 */
export const inject = ['webServer']

/** 路由前缀；客户端那半写死同一个串。 */
const ROUTE = '/dsh-deliverables'

/** 一次最多列多少个会话（最近的那些）。 */
const DEFAULT_LIMIT = 50

/** `?limit=` 的上限：再大就不是「总览」而是全量导出了。 */
const MAX_LIMIT = 500

/** 列表缓存默认 20 秒：点面板不必每次全量重读日志，但刚产出的文档也等不了多久。 */
const DEFAULT_TTL_MS = 20000

/** POST body 上限：三个坐标，16 KB 够到离谱了。 */
const BODY_LIMIT = 16 * 1024

/** 动作只有两档，和 `PresentedAction` 一致。 */
const ACTIONS = ['open', 'reveal']

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
		// ctx.get 在服务未就绪时会抛：退到属性访问
	}

	const direct = ctx[serviceName]

	return direct === undefined ? undefined : direct
}

const messageOf = (failure) => {
	if (failure === undefined || failure === null) return 'unknown error'
	if (typeof failure === 'string') return failure
	if (typeof failure.message === 'string' && failure.message !== '') return failure.message

	return String(failure)
}

const isoOf = (value) => {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined

	try {
		return new Date(value).toISOString()
	} catch {
		return undefined
	}
}

/** 标题：宿主的投影值（`{title: string|null}`）优先，读不到就折日志。 */
const titleOfValues = (values) => {
	if (values === undefined || values === null || typeof values !== 'object') return undefined

	const raw = values.title

	if (typeof raw === 'string') return raw.trim() === '' ? undefined : raw
	if (raw !== null && typeof raw === 'object' && typeof raw.title === 'string') {
		return raw.title.trim() === '' ? undefined : raw.title
	}

	return undefined
}

/** 坐标（seq / index）只接受非负安全整数；字符串数字也认，别的算非法。 */
const coordinateOf = (value) => {
	const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value

	if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0) return undefined

	return number
}
//#endregion

//#region 会话列举
/**
 * 列一次会话行。
 *
 * 主通道是 `ctx.sessionController.list()`：它同时覆盖活会话与持久化过的冷会话，
 * 而且**不会**顺手把 agent 拉起来。它不在时才退到 `ctx.sessions.list()`（只有活
 * 会话），并把来源如实标出来。
 *
 * @returns `{ rows, source }`；两条通道都没有时抛错（调用方回 500，别编空列表）。
 */
const listRowsOf = async (ctx, signal) => {
	const controller = serviceOf(ctx, 'sessionController')

	if (controller !== undefined && typeof controller.list === 'function') {
		const value = await controller.list({}, signal)

		if (value !== null && typeof value === 'object' && Array.isArray(value.items)) {
			return { rows: value.items, source: 'sessionController' }
		}
	}

	const sessions = serviceOf(ctx, 'sessions')
	const agents = serviceOf(ctx, 'agents')
	const live = sessions !== undefined && typeof sessions.list === 'function' ? sessions.list() : undefined

	if (!Array.isArray(live)) return undefined

	return {
		source: 'sessions',
		rows: live.map((session) => {
			const agent = agents !== undefined && typeof agents.get === 'function' ? agents.get(session.id) : undefined
			const header = session?.header

			return {
				sessionId: session.id,
				updatedAt: header === undefined ? undefined : header.createdAt,
				cwd: header === undefined ? undefined : header.cwd,
				running: agent !== undefined && agent.status === 'running',
				agentAvailable: agent !== undefined,
				blank: session.seq === 0,
			}
		}),
	}
}

/**
 * 一个会话的完整事件。
 *
 * 顺序是刻意的：活会话先读内存快照（免费），冷会话走 `sessionQuery.readSession`
 * （完整日志 + 重放校验），最后才 `sessionController.inspect`。
 *
 * 三条都不通时**把原因带回来**（不是一句「读不到」）：用户看到的是"这个会话坏了"
 * 还是"这个部署没有读取通道"，处理方式完全不同。
 *
 * @returns `{ events, cwd? }` 或 `{ error }`。
 */
const eventsOfSession = async (ctx, sessionId, signal) => {
	const failures = []

	const sessions = serviceOf(ctx, 'sessions')

	if (sessions !== undefined && typeof sessions.get === 'function') {
		const live = sessions.get(sessionId)

		if (live !== undefined && live !== null && typeof live.snapshotEvents === 'function') {
			try {
				return {
					events: live.snapshotEvents(),
					cwd: live.header === undefined ? undefined : live.header.cwd,
				}
			} catch (failure) {
				failures.push('内存快照：' + messageOf(failure))
			}
		}
	}

	const query = serviceOf(ctx, 'sessionQuery')

	if (query !== undefined && typeof query.readSession === 'function') {
		try {
			const snapshot = await query.readSession(sessionId)

			if (snapshot !== null && typeof snapshot === 'object' && Array.isArray(snapshot.events)) {
				return {
					events: snapshot.events,
					cwd: snapshot.session === undefined ? undefined : snapshot.session.cwd,
				}
			}

			failures.push('readSession：返回里没有 events')
		} catch (failure) {
			failures.push('readSession：' + messageOf(failure))
		}
	}

	const controller = serviceOf(ctx, 'sessionController')

	if (controller !== undefined && typeof controller.inspect === 'function') {
		try {
			const inspection = await controller.inspect(sessionId, signal)

			if (inspection !== null && typeof inspection === 'object' && Array.isArray(inspection.events)) {
				const header = inspection.session !== undefined ? inspection.session : inspection.header

				return {
					events: inspection.events,
					cwd: header === undefined ? undefined : header.cwd,
				}
			}

			failures.push('inspect：返回里没有 events')
		} catch (failure) {
			failures.push('inspect：' + messageOf(failure))
		}
	}

	return {
		error:
			failures.length === 0
				? '宿主没有可用的会话读取通道（ctx.sessions / ctx.sessionQuery / ctx.sessionController 都取不到）'
				: failures.join('；'),
	}
}
//#endregion

//#region 桌面能力
/** 宿主桌面能不能原生打开文件；取不到就 `null`（不假装知道）。 */
const desktopOf = (ctx) => {
	const controller = serviceOf(ctx, 'sessionController')

	if (controller === undefined || typeof controller.workspaceDesktop !== 'function') return null

	try {
		const desktop = controller.workspaceDesktop()

		if (desktop === null || typeof desktop !== 'object') return null

		return {
			name: typeof desktop.name === 'string' ? desktop.name : undefined,
			available: desktop.available === true,
			fileManager: desktop.fileManager ?? null,
			canOpen: typeof controller.openWorkspacePath === 'function',
		}
	} catch {
		return null
	}
}
//#endregion

//#region 列表
/**
 * GET /list 的载荷。
 *
 * 读某个会话失败不会让整个请求挂掉：那一行带 `error` 继续下一个（用户至少能看到
 * 别的会话产出了什么），这是这个面板存在的意义。
 */
const listPayload = async (ctx, settings, cache, options) => {
	const { limit, refresh, signal } = options
	const cacheKey = `list:${limit}`

	if (!refresh && cache !== undefined) {
		const hit = cache.get(cacheKey)

		if (hit !== undefined) return { ...hit, cached: true }
	}

	// `?refresh=1` 要连每会话的折叠结果一起丢掉，否则"刷新"看起来什么都没变。
	if (refresh) cache?.clear()

	const listed = await listRowsOf(ctx, signal)

	if (listed === undefined) {
		throw new Error('当前部署没有可用的会话列表通道（ctx.sessionController / ctx.sessions 都取不到）')
	}

	// 空白会话（seq 为 0）不可能有 turn，也就不可能有 present：先剔掉再切片，免得
	// 刚建的空会话把 `?limit=` 的额度吃掉。
	const rows = listed.rows
		.filter((row) => row !== null && typeof row === 'object' && typeof row.sessionId === 'string' && row.sessionId !== '')
		.filter((row) => !(settings.skipBlank !== false && row.blank === true))
		.sort((left, right) => (Number(right.updatedAt) || 0) - (Number(left.updatedAt) || 0))
		.slice(0, limit)

	const sessions = []
	let totalFiles = 0
	let totalMissing = 0

	for (const row of rows) {
		const title = titleOfValues(row.projections === undefined ? undefined : row.projections.values)
		const updatedAt = isoOf(row.updatedAt)
		const sessionKey = `session:${row.sessionId}@${String(row.updatedAt ?? '?')}`

		let entry = cache === undefined ? undefined : cache.get(sessionKey)

		if (entry === undefined) {
			try {
				const read = await eventsOfSession(ctx, row.sessionId, signal)

				if (read.error !== undefined) {
					entry = {
						sessionId: row.sessionId,
						title,
						updatedAt,
						cwd: row.cwd,
						presentedCount: 0,
						files: [],
						error: read.error,
					}
				} else {
					entry = buildSessionEntry(
						{
							sessionId: row.sessionId,
							title: title === undefined ? foldTitle(read.events) : title,
							updatedAt,
							cwd: typeof row.cwd === 'string' && row.cwd !== '' ? row.cwd : read.cwd,
							origin: row.origin,
						},
						read.events,
						{ exists: settings.exists, home: settings.home },
					)
				}
			} catch (failure) {
				entry = {
					sessionId: row.sessionId,
					title,
					updatedAt,
					cwd: row.cwd,
					presentedCount: 0,
					files: [],
					error: messageOf(failure),
				}
			}

			if (cache !== undefined) cache.set(sessionKey, entry)
		}

		sessions.push(entry)
		totalFiles += entry.files.length
		totalMissing += entry.files.filter((file) => file.exists === false).length
	}

	const payload = {
		ok: true,
		generatedAt: new Date().toISOString(),
		cached: false,
		ttlMs: cache === undefined ? 0 : cache.ttlMs,
		limit,
		source: listed.source,
		desktop: desktopOf(ctx),
		totalSessions: sessions.length,
		totalFiles,
		totalMissing,
		sessions,
	}

	if (cache !== undefined) cache.set(cacheKey, payload)

	return payload
}
//#endregion

//#region 单文件定位（POST /open 用）
/**
 * 按「会话 + 事件序号 + 文件下标」定位一个交付物。
 *
 * 先试 `sessionQuery.readEvent`（精确读一条事件，不用重放整份日志），读不到才退
 * 到整份日志里找。**只认日志里真的记过的那一条**，不会拿"像这个"的文件顶替。
 *
 * @returns `{ sessionId, seq, index, rawPath, path, displayPath, name, ext, description }`
 *   或 `undefined`（该事件里没有这个下标）。
 */
const findPresentedFile = async (ctx, settings, coordinates, signal) => {
	const { sessionId, seq, index } = coordinates
	const query = serviceOf(ctx, 'sessionQuery')
	let cwd
	let rawPath
	let description

	if (query !== undefined && typeof query.readEvent === 'function') {
		try {
			const read = await query.readEvent({ sessionId, seq, before: 0, after: 0 }, signal)
			const target = read === undefined || read === null ? undefined : read.target

			if (target !== undefined && target !== null && isPresentedData(target.data)) {
				const file = target.data.files[index]

				if (file !== undefined && typeof file.path === 'string' && file.path.trim() !== '') {
					rawPath = file.path
					description = typeof file.description === 'string' ? file.description : undefined
					cwd = read.session === undefined ? undefined : read.session.cwd
				}
			}
		} catch {
			// 读不到这一条：退到整份日志
		}
	}

	if (rawPath === undefined) {
		const read = await eventsOfSession(ctx, sessionId, signal)

		if (read.error !== undefined) throw new Error(read.error)

		cwd = read.cwd

		const event = read.events.find((item) => item !== null && typeof item === 'object' && item.seq === seq)
		const presented = presentedEventOf(event)

		if (presented === undefined) return undefined

		const file = presented.files[index]

		if (file === undefined) return undefined

		rawPath = file.path
		description = typeof file.description === 'string' ? file.description : undefined
	}

	const home = typeof settings.home === 'string' ? settings.home : homedir()
	const absolutePath = resolveHostPath(rawPath, cwd, home)

	return {
		sessionId,
		seq,
		index,
		rawPath,
		path: absolutePath,
		displayPath: displayPathOf(absolutePath, cwd, home),
		name: absolutePath.split(/[\\/]/).pop() ?? absolutePath,
		ext: extOf(absolutePath),
		description,
	}
}
//#endregion

/**
 * 读请求体（带字节上限）；读不到给空串，让调用方回 BAD_JSON。
 *
 * 用异步迭代而不是 `req.on('data')`：真正的 `IncomingMessage` 两种都支持，而测试
 * 里的假请求只实现了异步迭代（和 dsh-novel-pane 的下发方式一致）。
 */
const readRequestBody = async (req) => {
	let raw = ''

	try {
		if (req !== null && typeof req === 'object' && typeof req[Symbol.asyncIterator] === 'function') {
			for await (const chunk of req) {
				raw += String(chunk)

				if (raw.length > BODY_LIMIT) return raw.slice(0, BODY_LIMIT)
			}

			return raw
		}
	} catch {
		return raw
	}

	return raw
}

/**
 * 装配插件。
 *
 * @param {object} ctx - 宿主 Cordis 上下文。
 * @param {object} [config] - `{ limit?, ttlMs?, skipBlank?, web?, exists?, home? }`。
 *   `exists` / `home` 只给测试注入用（默认 `fs.existsSync` / `os.homedir()`）。
 */
export function apply(ctx, config = {}) {
	const settings = config === null || typeof config !== 'object' ? {} : config

	const limitOf = (raw) => {
		const fallback = Number.isSafeInteger(settings.limit) && settings.limit > 0 ? settings.limit : DEFAULT_LIMIT
		const value = Number(raw)

		if (!Number.isFinite(value) || value <= 0) return fallback

		return Math.min(Math.max(Math.trunc(value), 1), MAX_LIMIT)
	}

	const ttlMs = Number.isFinite(settings.ttlMs) && settings.ttlMs >= 0 ? settings.ttlMs : DEFAULT_TTL_MS
	const cache = createCache({ ttlMs })

	// 一个 handler 里没有调用方的 signal：给一个永不过期的，别让 list()/readSession
	// 的 throwIfAborted 拿到 undefined。
	const lifetime = new AbortController().signal

	const openPayload = async (body) => {
		const action = body.action === undefined || body.action === null ? 'open' : body.action

		if (typeof action !== 'string' || !ACTIONS.includes(action)) {
			return {
				code: 400,
				body: { ok: false, code: 'BAD_ACTION', message: 'action 只能是 open / reveal，收到：' + String(action) },
			}
		}

		const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''

		if (sessionId === '') {
			return { code: 400, body: { ok: false, code: 'BAD_SESSION', message: 'sessionId 不能是空的。' } }
		}

		const seq = coordinateOf(body.seq)
		const index = coordinateOf(body.index)

		if (seq === undefined || index === undefined) {
			return {
				code: 400,
				body: { ok: false, code: 'BAD_COORDINATES', message: 'seq / index 必须是非负整数。' },
			}
		}

		let target

		try {
			target = await findPresentedFile(ctx, settings, { sessionId, seq, index }, lifetime)
		} catch (failure) {
			return { code: 500, body: { ok: false, code: 'LOOKUP_FAILED', message: messageOf(failure) } }
		}

		if (target === undefined) {
			return {
				code: 404,
				body: {
					ok: false,
					code: 'NOT_IN_EVENT',
					message: '这个会话的第 ' + String(seq) + ' 号事件里没有第 ' + String(index) + ' 个文件（不是一条 deliverables/presented）。',
					sessionId,
					seq,
					index,
				},
			}
		}

		const exists = typeof settings.exists === 'function' ? settings.exists : existsSync

		if (!exists(target.path)) {
			return {
				code: 404,
				body: {
					ok: false,
					code: 'FILE_MISSING',
					message: '文件不在了：' + target.path,
					sessionId,
					seq,
					index,
					path: target.path,
					displayPath: target.displayPath,
				},
			}
		}

		const controller = serviceOf(ctx, 'sessionController')

		if (controller === undefined || typeof controller.openWorkspacePath !== 'function') {
			return {
				code: 501,
				body: {
					ok: false,
					code: 'NO_NATIVE_OPEN',
					message: '当前宿主没有 ctx.sessionController.openWorkspacePath，没法原生打开；用文件条目里的 url（' + PRESENT_OPEN_ROUTE + '）或 fileUrl（浏览器直读）兜底。',
					sessionId,
					seq,
					index,
					path: target.path,
				},
			}
		}

		try {
			await controller.openWorkspacePath(
				action === 'reveal' ? { path: target.path, action: 'reveal' } : { path: target.path },
				lifetime,
			)
		} catch (failure) {
			return {
				code: 502,
				body: {
					ok: false,
					code: 'OPEN_FAILED',
					message: '宿主原生打开失败：' + messageOf(failure),
					sessionId,
					seq,
					index,
					path: target.path,
				},
			}
		}

		return {
			code: 200,
			body: {
				ok: true,
				action,
				sessionId,
				seq,
				index,
				path: target.path,
				displayPath: target.displayPath,
				name: target.name,
				ext: target.ext,
			},
		}
	}

	if (settings.web === false || typeof ctx.inject !== 'function') return

	ctx.inject(['webServer'], (webCtx) => {
		webCtx.effect(
			() =>
				webCtx.webServer.register({
					kind: 'prefix',
					path: ROUTE,
					handler: async (req, res) => {
						const json = (code, body) => {
							// 连接可能在长读之后已经断了：写不进去就算了，别把路由 handler 打挂
							try {
								res.writeHead(code, {
									'content-type': 'application/json; charset=utf-8',
									'cache-control': 'no-store',
								})
								res.end(JSON.stringify(body))
							} catch {
								// 浏览器关掉面板 / 刷新：这份响应没人要了
							}
						}

						let url

						try {
							url = new URL(String(req.url === undefined || req.url === null ? '/' : req.url), 'http://localhost')
						} catch {
							json(400, { ok: false, code: 'BAD_URL', message: '看不懂这个请求地址。' })

							return
						}

						const path = url.pathname.replace(ROUTE, '') || '/'
						const method = String(req.method === undefined || req.method === null ? 'GET' : req.method).toUpperCase()

						if (path === '/list') {
							if (method !== 'GET') {
								json(405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'GET /list 只支持 GET。' })

								return
							}

							try {
								json(
									200,
									await listPayload(ctx, settings, cache, {
										limit: limitOf(url.searchParams.get('limit')),
										refresh: url.searchParams.get('refresh') === '1',
										signal: lifetime,
									}),
								)
							} catch (failure) {
								json(500, { ok: false, code: 'LIST_FAILED', message: messageOf(failure), sessions: [] })
							}

							return
						}

						if (path === '/open') {
							if (method !== 'POST') {
								json(405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'POST /open 只支持 POST。' })

								return
							}

							const raw = await readRequestBody(req)
							let body

							try {
								body = raw === '' ? {} : JSON.parse(raw)
							} catch {
								json(400, { ok: false, code: 'BAD_JSON', message: 'body 必须是 JSON。' })

								return
							}

							if (body === null || typeof body !== 'object') body = {}

							try {
								const result = await openPayload(body)

								json(result.code, result.body)
							} catch (failure) {
								json(500, { ok: false, code: 'INTERNAL_ERROR', message: messageOf(failure) })
							}

							return
						}

						json(404, { ok: false, code: 'NOT_FOUND', message: '没有这个路由：' + path })
					},
				}),
			'deliverables-index: /dsh-deliverables route',
		)
	})
}
