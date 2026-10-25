// 宿主半身（dsh-deliverables-index）的测试。
//
// 拿**真正的** index.js 在假 Cordis 上下文里跑：
//   - 假会话日志里放两条 `deliverables/presented`（2 个 + 1 个文件）→ 列表拼出 3 个；
//   - 相对路径按**会话 cwd** 解析成绝对路径（不是按进程 cwd）；
//   - `exists` 走真实文件系统（包内 `.tmp/` 里造一个真文件、一个不存在的）；
//   - 某个会话读取抛错 → 其它会话照常返回，那一行带 error；
//   - `POST /open` 的 action 透传（open / reveal），未知 action 回 400 且不碰宿主。
//
// 跑：node test/host.test.ts

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// 本机 OS Temp 不可写，临时目录一律落在包内 `.tmp/`（.gitignore 已忽略）。
const TMP = join(HERE, '..', '.tmp')

mkdirSync(TMP, { recursive: true })

const ROOT = mkdtempSync(join(TMP, 'host-test-'))

/** 会话 A 的工作目录：相对路径按它解析。 */
const CWD = join(ROOT, 'work')

mkdirSync(CWD, { recursive: true })

/** 真文件：绝对路径 present 的那一个。 */
const REAL_MD = join(ROOT, '报告.md')
writeFileSync(REAL_MD, '# 报告\n\n正文\n', 'utf8')

/** 真文件：日志里写的是相对路径，按 CWD 解析后应该指向它。 */
const REAL_DOCX = join(CWD, '产出.docx')
writeFileSync(REAL_DOCX, 'docx placeholder', 'utf8')

/** 不存在的那一个（present 过，后来被删了 / 移走了）。 */
const GONE_PDF = join(ROOT, '已经删了.pdf')

/** 不合规的 present 事件里那个「文件」：不该出现在列表里。 */
const GHOST_TXT = join(ROOT, '不该出现.txt')
writeFileSync(GHOST_TXT, 'ghost', 'utf8')

const { apply } = await import('../index.js')
const { buildSessionEntry, extOf, presentedFileUrl } = await import('../catalog.js')

const T_A = 1792700000000
const T_B = 1792600000000
const T_C = 1792500000000

/** 会话行（sessionController.list 的形态）。 */
const rowA = {
	sessionId: 'sess-A',
	updatedAt: T_A,
	cwd: CWD,
	blank: false,
	projections: { kind: 'sequenced', asOfSeq: 20, values: { title: '写报告' } },
}

const rowB = {
	sessionId: 'sess-B',
	updatedAt: T_B,
	cwd: ROOT,
	blank: false,
	projections: { kind: 'sequenced', asOfSeq: 40, values: { title: '做表' } },
}

const rowC = {
	sessionId: 'sess-C',
	updatedAt: T_C,
	cwd: ROOT,
	blank: false,
	projections: { kind: 'sequenced', asOfSeq: 8, values: { title: '坏会话' } },
}

/** 空白会话：seq 0，不可能有 turn，应该被跳过（连读都不读）。 */
const rowD = {
	sessionId: 'sess-D',
	updatedAt: T_A + 1000,
	cwd: ROOT,
	blank: true,
	projections: { kind: 'sequenced', asOfSeq: 0, values: {} },
}

/** A 的日志：一条 present 带 2 个文件，另一条是**不合规**的（turn=0）。 */
const eventsA = [
	{ seq: 5, type: 'session/title', time: T_A - 5000, data: { title: '写报告', messageSeqs: [], source: 'user' } },
	{
		seq: 12,
		type: 'deliverables/presented',
		time: T_A - 1000,
		data: {
			turn: 2,
			callId: 'call-A-2',
			files: [{ path: REAL_MD, description: '最终报告' }, { path: '产出.docx', description: '给客户那版' }],
		},
	},
	{
		seq: 13,
		type: 'deliverables/presented',
		time: T_A - 900,
		data: { turn: 0, callId: 'call-broken', files: [{ path: GHOST_TXT }] },
	},
]

/** B 的日志：一条 present 带 1 个文件，而且那个文件已经不在磁盘上了。 */
const eventsB = [
	{
		seq: 30,
		type: 'deliverables/presented',
		time: T_B - 1000,
		data: { turn: 4, callId: 'call-B-1', files: [{ path: GONE_PDF, description: '导出的 PDF' }] },
	},
]

/** 每个假 ctx 记录：路由、openWorkspacePath 的调用、readSession 的调用次数。 */
type Capture = {
	route?: any
	opened: any[]
	sessionsRead: string[]
	inspected: string[]
}

/**
 * 造一个假 Cordis 上下文。
 *
 * @param options.rows - `sessionController.list` 回的行。
 * @param options.events - 每个会话的事件；抛错用 `'throw'`。
 * @param options.without - 去掉哪些服务（测「通道缺失时如实报错」）。
 */
const makeCtx = (
	options: {
		rows?: any[]
		events?: Record<string, any[] | 'throw'>
		without?: string[]
		desktopAvailable?: boolean
	} = {},
) => {
	const captured: Capture = { opened: [], sessionsRead: [], inspected: [] }
	const rows = options.rows ?? [rowA, rowB, rowC, rowD]
	const events = options.events ?? { 'sess-A': eventsA, 'sess-B': eventsB, 'sess-C': 'throw' }
	const without = new Set(options.without ?? [])

	const readEventsOf = (sessionId: string) => {
		captured.sessionsRead.push(sessionId)

		const value = events[sessionId]

		if (value === 'throw') throw new Error('日志损坏（测试里故意造的）')

		return value ?? []
	}

	const services: any = {
		webServer: {
			register(route: any) {
				captured.route = route

				return () => {}
			},
		},
		sessionController: {
			async list() {
				return { items: rows }
			},
			async inspect(sessionId: string) {
				captured.inspected.push(sessionId)

				return { session: { id: sessionId, cwd: CWD }, events: readEventsOf(sessionId) }
			},
			workspaceDesktop() {
				return {
					name: 'Windows',
					available: options.desktopAvailable !== false,
					fileManager: 'explorer',
				}
			},
			async openWorkspacePath(request: any) {
				captured.opened.push(request)

				return { opened: true }
			},
		},
		sessionQuery: {
			async readSession(sessionId: string) {
				return { session: { id: sessionId, cwd: sessionId === 'sess-A' ? CWD : ROOT }, events: readEventsOf(sessionId) }
			},
			async readEvent(request: any) {
				const list = events[request.sessionId]

				if (list === 'throw' || list === undefined) throw new Error('读取失败')

				const target = list.find((event: any) => event.seq === request.seq)

				if (target === undefined) throw new Error('没有这个 seq')

				return { session: { id: request.sessionId, cwd: CWD }, target, events: [target], startSeq: request.seq, endSeq: request.seq }
			},
		},
		sessions: {
			get() {
				return undefined
			},
			list() {
				return []
			},
		},
	}

	for (const name of without) delete services[name]

	const ctx: any = {
		inject(names: string[], callback: (scope: any) => void) {
			const scope: any = {
				effect(fn: () => unknown) {
					fn()

					return () => {}
				},
				on() {},
			}

			for (const name of names) scope[name] = services[name]
			callback(scope)
		},
		get: (name: string) => services[name],
		on() {},
		effect(fn: () => unknown) {
			fn()

			return () => {}
		},
	}

	return { ctx, captured }
}

/** 一次假的 HTTP 往返：GET 或带 JSON 体的 POST。 */
const call = async (route: any, url: string, body?: unknown) => {
	const req: any =
		body === undefined
			? { url, method: 'GET' }
			: {
					url,
					method: 'POST',
					async *[Symbol.asyncIterator]() {
						yield Buffer.from(JSON.stringify(body))
					},
				}

	const res: any = {
		code: 0,
		body: '',
		writeHead(code: number) {
			res.code = code
		},
		end(text: string) {
			res.body = text
		},
	}

	await route.handler(req, res)

	return { code: res.code, json: res.body === '' ? null : JSON.parse(res.body) }
}

const assemble = (options: any = {}, config: any = {}) => {
	const built = makeCtx(options)

	apply(built.ctx, config)

	assert.notEqual(built.captured.route, undefined, '没有注册 webServer 路由')

	return built
}

describe('deliverables-index 宿主', () => {
	test('注册的是 /dsh-deliverables 前缀路由', () => {
		const { captured } = assemble()

		assert.equal(captured.route.kind, 'prefix')
		assert.equal(captured.route.path, '/dsh-deliverables')
		assert.equal(typeof captured.route.handler, 'function')
	})

	test('两份日志（2 个 + 1 个文件）→ 列表拼出 3 个文件，按会话分组', async () => {
		const { captured } = assemble()

		const { code, json } = await call(captured.route, '/dsh-deliverables/list')

		assert.equal(code, 200)
		assert.equal(json.ok, true)
		assert.equal(json.totalFiles, 3, '文件总数不对')
		assert.equal(json.totalMissing, 1, '应该正好有一个文件不在了')

		// 会话按 updatedAt 倒序：A 比 B 新
		const ids = json.sessions.map((session: any) => session.sessionId)

		assert.deepEqual(ids, ['sess-A', 'sess-B', 'sess-C'], '会话分组顺序 / 条数不对')

		const a = json.sessions[0]

		assert.equal(a.title, '写报告')
		assert.equal(a.files.length, 2, 'A 应该正好 2 个文件')
		assert.equal(a.presentedCount, 2, 'presentedCount 应该只算合规的那两条')

		const names = a.files.map((file: any) => file.name)

		assert.deepEqual(names, ['报告.md', '产出.docx'])
		assert.equal(a.files[0].ext, 'md')
		assert.equal(a.files[0].description, '最终报告')
		assert.equal(a.files[0].turn, 2)
		assert.equal(a.files[0].seq, 12)
		assert.equal(a.files[0].index, 0)

		const b = json.sessions[1]

		assert.equal(b.title, '做表')
		assert.equal(b.files.length, 1)
		assert.equal(b.files[0].name, '已经删了.pdf')
		assert.equal(b.files[0].ext, 'pdf')
	})

	test('相对路径按会话 cwd 解析成绝对路径（不是按进程 cwd）', async () => {
		const { captured } = assemble()

		const { json } = await call(captured.route, '/dsh-deliverables/list')
		const docx = json.sessions[0].files[1]

		assert.equal(docx.path, REAL_DOCX, '相对路径没按会话 cwd 解析')
		assert.equal(docx.displayPath, '产出.docx', '展示路径应该是相对 cwd 的那一段')
		assert.equal(docx.exists, true)
	})

	test('exists 反映真实文件系统：在的 true、不在的 false', async () => {
		const { captured } = assemble()

		const { json } = await call(captured.route, '/dsh-deliverables/list')
		const files = json.sessions.flatMap((session: any) => session.files)
		const byName = (name: string) => files.find((file: any) => file.name === name)

		assert.equal(byName('报告.md').exists, true)
		assert.equal(byName('产出.docx').exists, true)
		assert.equal(byName('已经删了.pdf').exists, false)
	})

	test('每个文件都带 url（presentedFileUrl 那条路由）与浏览器直读兜底', async () => {
		const { captured } = assemble()

		const { json } = await call(captured.route, '/dsh-deliverables/list')
		const file = json.sessions[0].files[0]

		assert.equal(file.url, presentedFileUrl('sess-A', 12, 0))
		assert.equal(file.url, 'api/present.open?sessionId=sess-A&seq=12&index=0')
		assert.match(file.fileUrl, /^api\/file\?path=/)
		assert.equal(file.fileUrl, 'api/file?path=' + encodeURIComponent(REAL_MD))
	})

	test('某个会话读取抛错 → 其它会话照常返回，该行带 error', async () => {
		const { captured } = assemble()

		const { code, json } = await call(captured.route, '/dsh-deliverables/list')

		assert.equal(code, 200, '一个会话坏了不该让整个请求挂掉')
		assert.equal(json.ok, true)
		assert.equal(json.sessions.length, 3, 'A / B / C 三行都在')

		const broken = json.sessions.find((session: any) => session.sessionId === 'sess-C')

		assert.notEqual(broken, undefined, '坏掉的那个会话整行消失了（应该保留并带 error）')
		assert.match(broken.error, /日志损坏/)
		assert.deepEqual(broken.files, [])

		// 别的会话不受影响
		assert.equal(json.sessions[0].files.length, 2)
	})

	test('空白会话（seq 0）直接跳过，连日志都不读', async () => {
		const { captured } = assemble()

		const { json } = await call(captured.route, '/dsh-deliverables/list')

		assert.equal(
			json.sessions.some((session: any) => session.sessionId === 'sess-D'),
			false,
			'空白会话不该出现在列表里',
		)
		assert.equal(captured.sessionsRead.includes('sess-D'), false, '空白会话不该被读日志')
	})

	test('不合规的 present 事件（turn=0）被忽略，不编出文件', async () => {
		const { captured } = assemble()

		const { json } = await call(captured.route, '/dsh-deliverables/list')
		const names = json.sessions.flatMap((session: any) => session.files.map((file: any) => file.name))

		assert.equal(names.includes('不该出现.txt'), false, 'turn=0 的事件不该被当成交付物')
	})

	test('缓存：第二次点不重读日志（cached:true），refresh=1 强制重读', async () => {
		const { ctx, captured } = makeCtx()

		apply(ctx, {})

		const first = await call(captured.route, '/dsh-deliverables/list')

		assert.equal(first.json.cached, false)
		assert.equal(first.json.ttlMs, 20000)

		const readsAfterFirst = captured.sessionsRead.length

		assert.ok(readsAfterFirst >= 3, '第一次应该把所有非空会话都读一遍')

		const second = await call(captured.route, '/dsh-deliverables/list')

		assert.equal(second.json.cached, true, '第二次应该命中缓存')
		assert.equal(captured.sessionsRead.length, readsAfterFirst, '命中缓存时不该再读日志')
		assert.deepEqual(second.json.sessions, first.json.sessions)

		const refreshed = await call(captured.route, '/dsh-deliverables/list?refresh=1')

		assert.equal(refreshed.json.cached, false)
		assert.equal(captured.sessionsRead.length, readsAfterFirst * 2, '?refresh=1 应该重读')
	})

	test('?limit=1 只返回最近的 1 个会话', async () => {
		const { captured } = assemble()

		const { json } = await call(captured.route, '/dsh-deliverables/list?limit=1')

		assert.equal(json.limit, 1)
		assert.deepEqual(
			json.sessions.map((session: any) => session.sessionId),
			['sess-A'],
		)
	})

	test('宿主桌面可用性如实带出来（客户端据此提前提示）', async () => {
		const ready = assemble()
		const notReady = assemble({ desktopAvailable: false })

		const on = await call(ready.captured.route, '/dsh-deliverables/list')
		const off = await call(notReady.captured.route, '/dsh-deliverables/list')

		assert.deepEqual(on.json.desktop, { name: 'Windows', available: true, fileManager: 'explorer', canOpen: true })
		assert.equal(off.json.desktop.available, false)
	})

	test('POST /open：action=open 透传成 {path}（不带 action 字段）', async () => {
		const { captured } = assemble()

		const { code, json } = await call(captured.route, '/dsh-deliverables/open', {
			sessionId: 'sess-A',
			seq: 12,
			index: 0,
			action: 'open',
		})

		assert.equal(code, 200)
		assert.equal(json.ok, true)
		assert.equal(json.action, 'open')
		assert.equal(json.path, REAL_MD)
		assert.deepEqual(captured.opened, [{ path: REAL_MD }])
	})

	test('POST /open：action=reveal 透传成 {path, action:"reveal"}', async () => {
		const { captured } = assemble()

		const { code, json } = await call(captured.route, '/dsh-deliverables/open', {
			sessionId: 'sess-A',
			seq: 12,
			index: 1,
			action: 'reveal',
		})

		assert.equal(code, 200)
		assert.equal(json.action, 'reveal')
		assert.equal(json.path, REAL_DOCX)
		assert.deepEqual(captured.opened, [{ path: REAL_DOCX, action: 'reveal' }])
	})

	test('POST /open：省略 action 默认 open', async () => {
		const { captured } = assemble()

		const { code, json } = await call(captured.route, '/dsh-deliverables/open', {
			sessionId: 'sess-A',
			seq: 12,
			index: 0,
		})

		assert.equal(code, 200)
		assert.equal(json.action, 'open')
		assert.deepEqual(captured.opened, [{ path: REAL_MD }])
	})

	test('POST /open：未知 action 回 400，且绝不碰宿主原生打开', async () => {
		const { captured } = assemble()

		const { code, json } = await call(captured.route, '/dsh-deliverables/open', {
			sessionId: 'sess-A',
			seq: 12,
			index: 0,
			action: 'explode',
		})

		assert.equal(code, 400)
		assert.equal(json.ok, false)
		assert.equal(json.code, 'BAD_ACTION')
		assert.deepEqual(captured.opened, [], 'action 不合法时不该调 openWorkspacePath')
	})

	test('POST /open：坐标不合法回 400', async () => {
		const { captured } = assemble()

		for (const body of [
			{ sessionId: 'sess-A', seq: -1, index: 0 },
			{ sessionId: 'sess-A', seq: 12, index: 1.5 },
			{ sessionId: '', seq: 12, index: 0 },
			{ sessionId: 'sess-A', seq: 12 },
		]) {
			const { code, json } = await call(captured.route, '/dsh-deliverables/open', body)

			assert.equal(code, 400, '应该回 400：' + JSON.stringify(body))
			assert.equal(json.ok, false)
		}

		assert.deepEqual(captured.opened, [])
	})

	test('POST /open：文件不在了回 404 FILE_MISSING，不假装能打开', async () => {
		const { captured } = assemble()

		const { code, json } = await call(captured.route, '/dsh-deliverables/open', {
			sessionId: 'sess-B',
			seq: 30,
			index: 0,
		})

		assert.equal(code, 404)
		assert.equal(json.code, 'FILE_MISSING')
		assert.equal(json.path, GONE_PDF)
		assert.deepEqual(captured.opened, [])
	})

	test('POST /open：事件里没有这个下标 → 404 NOT_IN_EVENT', async () => {
		const { captured } = assemble()

		const { code, json } = await call(captured.route, '/dsh-deliverables/open', {
			sessionId: 'sess-A',
			seq: 12,
			index: 9,
		})

		assert.equal(code, 404)
		assert.equal(json.code, 'NOT_IN_EVENT')
	})

	test('没有 openWorkspacePath 的宿主 → 501 NO_NATIVE_OPEN（说清怎么兜底）', async () => {
		const { ctx, captured } = makeCtx()

		delete (ctx.get('sessionController') as any).openWorkspacePath
		apply(ctx, {})

		const { code, json } = await call(captured.route, '/dsh-deliverables/open', {
			sessionId: 'sess-A',
			seq: 12,
			index: 0,
		})

		assert.equal(code, 501)
		assert.equal(json.code, 'NO_NATIVE_OPEN')
		assert.match(json.message, /present\.open/)
	})

	test('没有 sessionQuery 时退回 sessionController.inspect', async () => {
		const { ctx, captured } = makeCtx({ without: ['sessionQuery'] })

		apply(ctx, {})

		const { code, json } = await call(captured.route, '/dsh-deliverables/list')

		assert.equal(code, 200)
		assert.equal(json.totalFiles, 3)
		assert.ok(captured.inspected.includes('sess-A'), '应该走 inspect')
	})

	test('连会话列表通道都没有 → 500，别编一个空列表', async () => {
		const { ctx, captured } = makeCtx({ without: ['sessionController', 'sessions'] })

		apply(ctx, {})

		const { code, json } = await call(captured.route, '/dsh-deliverables/list')

		assert.equal(code, 500)
		assert.equal(json.ok, false)
		assert.equal(json.code, 'LIST_FAILED')
	})

	test('未知路由 404；/list 用 POST 405', async () => {
		const { captured } = assemble()

		const missing = await call(captured.route, '/dsh-deliverables/nope')

		assert.equal(missing.code, 404)

		const wrong = await call(captured.route, '/dsh-deliverables/list', {})

		assert.equal(wrong.code, 405)
	})

	test('config.limit / config.ttlMs 生效', async () => {
		const { captured } = assemble({}, { limit: 1, ttlMs: 0 })

		const { json } = await call(captured.route, '/dsh-deliverables/list')

		assert.equal(json.limit, 1)
		assert.equal(json.ttlMs, 0)
		assert.equal(json.sessions.length, 1)
	})
})

describe('catalog 纯函数', () => {
	test('同一份文件 present 两次 → 去重（后面的覆盖），presentedCount 保留原始条数', () => {
		const events = [
			{
				seq: 3,
				type: 'deliverables/presented',
				time: 100,
				data: { turn: 1, callId: 'call-1', files: [{ path: REAL_MD, description: '第一版' }] },
			},
			{
				seq: 9,
				type: 'deliverables/presented',
				time: 200,
				data: { turn: 2, callId: 'call-2', files: [{ path: REAL_MD, description: '改完的' }] },
			},
		]

		const entry = buildSessionEntry({ sessionId: 'sess-X', title: 'x', cwd: ROOT }, events)

		assert.equal(entry.presentedCount, 2)
		assert.equal(entry.files.length, 1, '同一个绝对路径应该只留一行')
		assert.equal(entry.files[0].description, '改完的', '应该留最新那次')
		assert.equal(entry.files[0].seq, 9)
		assert.equal(entry.files[0].url, presentedFileUrl('sess-X', 9, 0))
	})

	test('extOf：小写扩展名，隐藏文件 / 无扩展名给空串', () => {
		assert.equal(extOf('C:\\a\\B.MD'), 'md')
		assert.equal(extOf('/x/y/report.PDF'), 'pdf')
		assert.equal(extOf('no-ext'), '')
		assert.equal(extOf('.gitignore'), '')
		assert.equal(extOf('trailing.'), '')
	})
})
