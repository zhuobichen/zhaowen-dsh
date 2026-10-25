/**
 * 交付物目录的**纯逻辑**：会话事件 → 一份可展示的文件清单。
 *
 * 这里不碰 Cordis、不碰 HTTP、不读会话日志——输入永远是「一个会话的元信息 +
 * 它的完整事件数组」，输出是 `{ sessionId, title, files: [...] }`。这样：
 *   - 宿主半身（index.js）只负责取事件、查文件在不在、开路由；
 *   - 测试可以拿假事件把折叠规则钉死，不用起宿主。
 *
 * 「都从事件来」这件事是刻意的：DSH 的 `present` 工具已经把它呈现过的文件写进
 * 会话日志（`deliverables/presented`），所以这里**不扫盘猜**"这个会话大概产出了
 * 什么"，只认日志里记过的那几行。
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, resolve as resolvePath, sep } from 'node:path'

//#region 路由（与 dsh-client-ui-deliverables 的实际实现逐字一致）
//
// 2026-10 版 @deepseek-ai/dsh-client-ui-deliverables/lib/client.js:274-317：
//   const PRESENT_OPEN_PATH = "/api/present.open";
//   const PRESENT_OPEN_ROUTE = PRESENT_OPEN_PATH.slice(1);   // "api/present.open"
//   function presentedFileUrl(sessionId, seq, index) {
//     return `${PRESENT_OPEN_ROUTE}?${new URLSearchParams({sessionId, seq, index})}`;
//   }
// 也就是说它给的是一个**文档相对**（没有开头斜杠）的 URL，打开动作是往这个
// URL 上 **POST**（GET 返回的是「这个文件能用哪些应用打开」的列表），动作靠
// **query 参数** `action=open|reveal` 传（不是 body）。
export const PRESENT_OPEN_ROUTE = 'api/present.open'

/** 浏览器直读文件字节的原生路由（`GET /api/file?path=<绝对路径>`）。宿主没桌面时用它兜底。 */
export const FILE_ROUTE = 'api/file'

/**
 * 一份交付物在「宿主原生打开」路由上的地址。
 *
 * @param {string} sessionId - 所属会话。
 * @param {number} seq - `deliverables/presented` 事件的序号。
 * @param {number} index - 该事件 files 数组里的下标。
 * @returns {string} 文档相对 URL，例如
 *   `api/present.open?sessionId=abc&seq=12&index=0`。
 */
export const presentedFileUrl = (sessionId, seq, index) =>
	`${PRESENT_OPEN_ROUTE}?${new URLSearchParams({
		sessionId: String(sessionId),
		seq: String(seq),
		index: String(index),
	})}`

/**
 * 给浏览器兜底用的直读地址（新标签打开 PDF / 文本 / 图片时用）。
 *
 * @param {string} absolutePath - 已解析成绝对路径的文件。
 * @returns {string} `api/file?path=...`。
 */
export const browserFileUrl = (absolutePath) => `${FILE_ROUTE}?path=${encodeURIComponent(absolutePath)}`
//#endregion

//#region 路径
/** `C:\x`、`\\server\share`、`/x` 都算绝对路径——不依赖运行平台。 */
export const isAbsolutePath = (value) =>
	typeof value === 'string' &&
	(/^[a-zA-Z]:[\\/]/.test(value) || /^[\\/]{2}[^\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\'))

/** 家目录展开：`~` / `~/x` / `~\x`。 */
export const expandHome = (value, home = homedir()) => {
	if (typeof value !== 'string') return ''
	if (value === '~') return home
	if (value.startsWith('~/') || value.startsWith('~\\')) return `${home}${value.slice(1)}`
	return value
}

/**
 * 把日志里那条路径解析成绝对路径。
 *
 * `present` 记的可能是绝对路径，也可能是相对会话 cwd 的路径（模型写
 * `./out/report.md` 时就是这样）。按会话 cwd 解析——**不是**按宿主进程的 cwd，
 * 否则会解析到完全不相干的地方。
 *
 * @param {string} raw - 日志里的原始路径。
 * @param {string} cwd - 该会话的工作目录。
 * @param {string} [home] - 家目录（测试可注入）。
 * @returns {string} 绝对路径。
 */
export const resolveHostPath = (raw, cwd, home = homedir()) => {
	const expanded = expandHome(String(raw ?? ''), home)
	if (isAbsolutePath(expanded)) return resolvePath(expanded)
	return resolvePath(typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd(), expanded)
}

/** 展示用路径：在 cwd 里面就给相对路径，在家目录里面就给 `~/…`，否则原样。 */
export const displayPathOf = (absolutePath, cwd, home = homedir()) => {
	if (typeof absolutePath !== 'string' || absolutePath === '') return ''

	const flat = (value) => value.split(sep).join('/')
	const lower = (value) => value.toLowerCase()

	if (typeof cwd === 'string' && cwd !== '') {
		const prefix = cwd.endsWith(sep) ? cwd : cwd + sep
		if (lower(absolutePath).startsWith(lower(prefix))) return flat(absolutePath.slice(prefix.length))
	}

	if (typeof home === 'string' && home !== '') {
		const prefix = home.endsWith(sep) ? home : home + sep
		if (lower(absolutePath).startsWith(lower(prefix))) return `~/${flat(absolutePath.slice(prefix.length))}`
	}

	return absolutePath
}

/** 尾段文件名。 */
export const nameOf = (value) => {
	const text = String(value ?? '')
	const at = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))

	return at === -1 ? text : text.slice(at + 1)
}

/**
 * 小写扩展名（不带点）。没有扩展名 / 只有前导点的隐藏文件返回空串。
 *
 * @param {string} value - 路径或文件名。
 * @returns {string} `md` / `pdf` / `docx` / … 或 `''`。
 */
export const extOf = (value) => {
	const name = nameOf(value)
	const at = name.lastIndexOf('.')

	if (at <= 0 || at === name.length - 1) return ''

	return name.slice(at + 1).toLowerCase()
}
//#endregion

//#region 事件折叠
/**
 * 校验一条 `deliverables/presented` 的 payload。
 * 规则照抄 `dsh-client-ui-deliverables/lib/index.js:35-39`：turn 是正整数、
 * callId 是非空串、files 是数组。**不合规就当没这条**，不猜。
 */
export const isPresentedData = (value) => {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
	const { turn, callId, files } = value

	return (
		typeof turn === 'number' &&
		Number.isSafeInteger(turn) &&
		turn >= 1 &&
		typeof callId === 'string' &&
		callId.length > 0 &&
		Array.isArray(files)
	)
}

/** 单个文件声明：path 必须是非空串，description 可选但必须是串。 */
export const isPresentedFile = (value) => {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
	const { path, description } = value

	return (
		typeof path === 'string' &&
		path.trim().length > 0 &&
		(description === undefined || typeof description === 'string')
	)
}

/**
 * 从一条事件里取「呈现事件」的规范化形态。
 *
 * @returns `{ turn, seq, time, callId, files: [{ path, description }] }` 或 `undefined`。
 */
export const presentedEventOf = (event) => {
	if (event === null || typeof event !== 'object') return undefined
	if (event.type !== 'deliverables/presented') return undefined
	if (!isPresentedData(event.data)) return undefined

	return {
		turn: event.data.turn,
		callId: event.data.callId,
		seq: typeof event.seq === 'number' && Number.isFinite(event.seq) ? event.seq : -1,
		time: typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : undefined,
		files: event.data.files.filter(isPresentedFile),
	}
}

/**
 * 把一个会话的完整事件数组折成「呈现过哪些文件」。
 *
 * 顺序是**日志顺序**（后面的覆盖前面的同名文件，见 `buildSessionEntry`）。
 *
 * @param {string} sessionId - 会话 id。
 * @param {readonly any[]} events - 该会话的事件（升序）。
 * @returns {Array<{ sessionId: string, seq: number, index: number, turn: number, path: string, description?: string, time?: number }>}
 */
export const foldPresented = (sessionId, events) => {
	const rows = []
	if (!Array.isArray(events)) return rows

	for (const event of events) {
		const presented = presentedEventOf(event)
		if (presented === undefined) continue

		presented.files.forEach((file, index) => {
			const row = {
				sessionId,
				seq: presented.seq,
				index,
				turn: presented.turn,
				path: file.path,
			}

			if (typeof file.description === 'string' && file.description !== '') row.description = file.description
			if (presented.time !== undefined) row.time = presented.time

			rows.push(row)
		})
	}

	return rows
}

/** 倒着找最后一条 `session/title`；没有就 `undefined`。 */
export const foldTitle = (events) => {
	if (!Array.isArray(events)) return undefined

	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index]

		if (event === null || typeof event !== 'object') continue
		if (event.type !== 'session/title') continue

		const data = event.data

		if (data !== null && typeof data === 'object' && typeof data.title === 'string' && data.title.trim() !== '') {
			return data.title.trim()
		}
	}

	return undefined
}

/**
 * 一个会话的交付物条目。
 *
 * 同一份文件在日志里可能出现多次（同一个报告改了两版、两轮各 present 一次）。
 * **按绝对路径去重，后面的赢**：用户要的是「这个会话产出了哪些文档」，
 * 不是每一次 present 的流水。`presentedCount` 保留原始条数。
 *
 * @param {object} session - `{ sessionId, title?, updatedAt?, cwd?, origin? }`。
 * @param {readonly any[]} events - 该会话的完整事件。
 * @param {object} [options] - `{ exists?, home?, cwd? }`（测试注入真/假的存在判定）。
 * @returns {object} 一行会话条目。
 */
export const buildSessionEntry = (session, events, options = {}) => {
	const exists = typeof options.exists === 'function' ? options.exists : existsSync
	const home = typeof options.home === 'string' ? options.home : homedir()
	const cwd = typeof session.cwd === 'string' && session.cwd !== '' ? session.cwd : options.cwd

	const rows = foldPresented(session.sessionId, events)
	const byPath = new Map()

	for (const row of rows) {
		const absolutePath = resolveHostPath(row.path, cwd, home)
		const present = exists(absolutePath)

		// 后出现的覆盖先出现的：保留最新一次的 turn/seq/时间（打开时按它定位事件）
		byPath.set(absolutePath, {
			name: nameOf(absolutePath),
			path: absolutePath,
			displayPath: displayPathOf(absolutePath, cwd, home),
			ext: extOf(absolutePath),
			description: row.description,
			turn: row.turn,
			seq: row.seq,
			index: row.index,
			time: row.time,
			url: presentedFileUrl(session.sessionId, row.seq, row.index),
			fileUrl: browserFileUrl(absolutePath),
			exists: present,
		})
	}

	const files = [...byPath.values()]

	const entry = {
		sessionId: session.sessionId,
		title: typeof session.title === 'string' && session.title !== '' ? session.title : undefined,
		updatedAt: session.updatedAt,
		cwd,
		origin: session.origin,
		presentedCount: rows.length,
		files,
	}

	return entry
}
//#endregion

//#region 进程内缓存
/**
 * 极小的 TTL 缓存。列表是「最近 50 个会话的日志折叠」，不缓存的话每点一次
 * 面板都要把几十份日志重读一遍；但缓存也不能太长，否则刚产出的文档不出现。
 *
 * @param {object} [options] - `{ ttlMs?, now? }`。
 * @returns `{ get, set, delete, clear, size, ttlMs }`。
 */
export const createCache = (options = {}) => {
	const ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs >= 0 ? options.ttlMs : 20000
	const now = typeof options.now === 'function' ? options.now : () => Date.now()
	const store = new Map()

	return {
		ttlMs,
		get(key) {
			const hit = store.get(key)

			if (hit === undefined) return undefined
			if (now() - hit.at > ttlMs) {
				store.delete(key)
				return undefined
			}

			return hit.value
		},
		set(key, value) {
			store.set(key, { at: now(), value })

			return value
		},
		delete(key) {
			store.delete(key)
		},
		clear() {
			store.clear()
		},
		size() {
			return store.size
		},
	}
}
//#endregion
