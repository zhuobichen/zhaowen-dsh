// 文档总览客户端（dsh-client-ui-deliverables-index）的测试。
//
// 加载的是**真正下发给浏览器的** client/client.js，用假的 __ModuleLoader__ /
// document / react / fetch 把整条链跑一遍：
//
//   点悬浮球 → GET /dsh-deliverables/list → 按会话分组画出来
//   搜索框过滤 / 类型筛选
//   点一行 → POST api/present.open?sessionId&seq&index（和 presentedFileUrl 同一个路由）
//   exists:false 的行灰掉、点不动、不发请求
//   原生打开失败（409 没桌面）→ 退到 api/file?path=… 新标签打开
//   再点一次悬浮球 → 面板收起（悬浮球还在）
//
// 跑：node test/panel.test.ts

import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT_FILE = join(HERE, '..', 'client', 'client.js')
const PACKAGE = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')) as { name: string }

//#region 假的浏览器环境
const styleTags: any[] = []

const documentStub: any = {
	documentElement: { classList: { add() {}, remove() {}, contains() { return false } }, style: { setProperty() {}, removeProperty() {} } },
	head: {
		appendChild(node: any) {
			styleTags.push(node)
		},
	},
	querySelector() {
		return null
	},
	createElement(tag: string) {
		return { tagName: tag, dataset: {}, textContent: '' }
	},
}

type Registration = { id: string; factory: (require: (name: string) => unknown) => any }

let registration: Registration | undefined
let requireCalls: string[] = []

/** window.open 的记账。 */
let openCalls: Array<{ url: string; target: string; features: string | undefined; handle: any }> = []

const browserWindow: any = {
	innerWidth: 1440,
	innerHeight: 900,
	location: { href: '' },
	__ModuleLoader__: {
		load(candidate: Registration) {
			registration = candidate
		},
	},
}

const storageMap = new Map<string, string>()

browserWindow.localStorage = {
	getItem(key: string) {
		return storageMap.has(key) ? (storageMap.get(key) as string) : null
	},
	setItem(key: string, value: string) {
		storageMap.set(key, value)
	},
	removeItem(key: string) {
		storageMap.delete(key)
	},
}

const windowListeners = new Map<string, Set<(event: any) => void>>()

browserWindow.addEventListener = (type: string, fn: (event: any) => void) => {
	if (!windowListeners.has(type)) windowListeners.set(type, new Set())
	windowListeners.get(type)!.add(fn)
}

browserWindow.removeEventListener = (type: string, fn: (event: any) => void) => {
	windowListeners.get(type)?.delete(fn)
}

;(globalThis as any).window = browserWindow
;(globalThis as any).document = documentStub

await import(pathToFileURL(CLIENT_FILE).href)

//#endregion

//#region 假 React（与 dsh-client-ui-novel-pane/test/lingtai.test.ts 同一套最小实现）
type Cell =
	| { kind: 'state'; value: any; set: (next: any) => void }
	| { kind: 'ref'; ref: { current: any } }
	| { kind: 'effect'; deps: any[] | undefined; run: () => void | (() => void); cleanup?: () => void; dirty: boolean }
	| { kind: 'memo'; value: any; deps: any[] | undefined }

const hooks: { cells: Array<Cell | undefined>; index: number } = { cells: [], index: 0 }
let dirty = false

const depsEqual = (left: any[] | undefined, right: any[] | undefined) =>
	left !== undefined &&
	right !== undefined &&
	left.length === right.length &&
	left.every((value, index) => Object.is(value, right[index]))

const reactStub = {
	useState(initial: any) {
		const index = hooks.index++

		if (hooks.cells[index] === undefined) {
			const cell: any = { kind: 'state', value: typeof initial === 'function' ? initial() : initial }

			cell.set = (next: any) => {
				const value = typeof next === 'function' ? next(cell.value) : next

				if (!Object.is(value, cell.value)) {
					cell.value = value
					dirty = true
				}
			}
			hooks.cells[index] = cell
		}

		const cell = hooks.cells[index] as { kind: 'state'; value: any; set: (next: any) => void }

		return [cell.value, cell.set]
	},
	useRef(initial: any) {
		const index = hooks.index++

		if (hooks.cells[index] === undefined) hooks.cells[index] = { kind: 'ref', ref: { current: initial } }

		return (hooks.cells[index] as { kind: 'ref'; ref: { current: any } }).ref
	},
	useEffect(run: () => void | (() => void), deps?: any[]) {
		const index = hooks.index++
		const existing = hooks.cells[index] as
			| { kind: 'effect'; deps: any[] | undefined; run: any; cleanup?: () => void; dirty: boolean }
			| undefined

		if (existing === undefined) {
			hooks.cells[index] = { kind: 'effect', deps, run, dirty: true }

			return
		}

		if (!depsEqual(existing.deps, deps)) {
			existing.deps = deps
			existing.run = run
			existing.dirty = true
		}
	},
	useMemo(fn: () => any, deps?: any[]) {
		const index = hooks.index++
		const existing = hooks.cells[index] as { kind: 'memo'; value: any; deps: any[] | undefined } | undefined

		if (existing === undefined || !depsEqual(existing.deps, deps)) {
			hooks.cells[index] = { kind: 'memo', value: fn(), deps }
		}

		return (hooks.cells[index] as { kind: 'memo'; value: any }).value
	},
}

const runEffects = () => {
	for (const cell of hooks.cells) {
		if (cell === undefined || cell.kind !== 'effect' || !cell.dirty) continue

		cell.dirty = false

		if (typeof cell.cleanup === 'function') cell.cleanup()

		const cleanup = cell.run()

		cell.cleanup = typeof cleanup === 'function' ? cleanup : undefined
	}
}

const renderOnce = (component: any, props: any) => {
	hooks.index = 0
	dirty = false

	const element = component(props)

	runEffects()

	return element
}

const render = (component: any, props: any) => {
	let element = renderOnce(component, props)
	let guard = 0

	while (dirty && guard++ < 20) element = renderOnce(component, props)

	return element
}

const unmount = () => {
	for (const cell of hooks.cells) {
		if (cell !== undefined && cell.kind === 'effect' && typeof cell.cleanup === 'function') {
			cell.cleanup()
			cell.cleanup = undefined
		}
	}
}

const resetHooks = () => {
	unmount()
	hooks.cells = []
	hooks.index = 0
	dirty = false
}

const jsx = (type: any, props: any) => ({ type, props })
const runtimeStub = { jsx, jsxs: jsx }
const requireStub = (name: string) => {
	requireCalls.push(name)

	if (name === 'react') return reactStub
	if (name === 'react/jsx-runtime') return runtimeStub

	throw new Error('client.js require 了静态表以外的模块：' + name)
}

//#endregion

//#region 假 fetch
type Reply = { status?: number; ok?: boolean; body?: any } | 'reject'

let handler: (url: string, init: any) => Reply | Promise<Reply> = () => ({ body: {} })
const calls: Array<{ url: string; init: any }> = []

const installFetch = (next: (url: string, init: any) => Reply | Promise<Reply>) => {
	handler = next
	calls.length = 0
	;(globalThis as any).fetch = async (url: string, init: any = {}) => {
		calls.push({ url: String(url), init })

		const reply = await handler(String(url), init)

		if (reply === 'reject') throw new Error('offline')

		const status = reply.status ?? 200

		return {
			ok: reply.ok ?? (status >= 200 && status < 300),
			status,
			json: async () => reply.body ?? {},
			text: async () => JSON.stringify(reply.body ?? {}),
		}
	}
}

const settle = async () => {
	for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

//#endregion

//#region 查询工具
const childrenOf = (node: any): any[] => {
	if (node === null || node === undefined || typeof node !== 'object') return []

	const children = node.props ? node.props.children : null

	if (children === null || children === undefined) return []

	return Array.isArray(children) ? children.flat(4) : [children]
}

const textOf = (node: any): string => {
	if (node === null || node === undefined) return ''
	if (typeof node === 'string' || typeof node === 'number') return String(node)
	if (Array.isArray(node)) return node.map(textOf).join('')
	if (typeof node === 'object' && node.props) return textOf(node.props.children)

	return ''
}

const allByClass = (node: any, className: string): any[] => {
	const found: any[] = []

	if (node === null || typeof node !== 'object') return found

	const actual = node.props ? node.props.className : null

	if (typeof actual === 'string' && actual.split(/\s+/).includes(className)) found.push(node)

	if (Array.isArray(node)) {
		for (const child of node) found.push(...allByClass(child, className))

		return found
	}

	for (const child of childrenOf(node)) found.push(...allByClass(child, className))

	return found
}

const findByClass = (node: any, className: string) => allByClass(node, className)[0]

const buttonWithText = (node: any, text: string): any => {
	const buttons: any[] = []

	const walk = (current: any) => {
		if (current === null || typeof current !== 'object') return
		if (current.type === 'button' && textOf(current).includes(text)) buttons.push(current)

		for (const child of childrenOf(current)) walk(child)
	}

	walk(node)

	return buttons[0]
}

const rowNamed = (tree: any, name: string): any => {
	const row = allByClass(tree, 'dshdi_row').find((candidate) => {
		const nameNode = findByClass(candidate, 'dshdi_name')

		return textOf(nameNode) === name
	})

	return row
}

//#endregion

assert.notEqual(registration, undefined, 'client.js 没有调用 window.__ModuleLoader__.load')

const client = registration!.factory(requireStub)

/** factory 执行时真正 require 过的模块名（beforeEach 会清 requireCalls，这里先钉住）。 */
const FACTORY_REQUIRES = [...new Set(requireCalls)]

//#region 测试数据
const T = 1792700000000

/** 宿主 `/list` 的典型回包：2 个会话，3 个文件，其中 1 个已经不在了。 */
const PAYLOAD = {
	ok: true,
	totalSessions: 2,
	totalFiles: 3,
	totalMissing: 1,
	desktop: { name: 'Windows', available: true, fileManager: 'explorer', canOpen: true },
	sessions: [
		{
			sessionId: 'sess-A',
			title: '写报告',
			updatedAt: '2026-10-20T10:00:00.000Z',
			cwd: 'D:\\work',
			presentedCount: 3,
			files: [
				{
					name: '报告.md',
					path: 'D:\\work\\报告.md',
					displayPath: '报告.md',
					ext: 'md',
					description: '最终报告',
					turn: 2,
					seq: 12,
					index: 0,
					time: T,
					url: 'api/present.open?sessionId=sess-A&seq=12&index=0',
					fileUrl: 'api/file?path=D%3A%5Cwork%5C%E6%8A%A5%E5%91%8A.md',
					exists: true,
				},
				{
					name: '旧稿.pdf',
					path: 'D:\\work\\旧稿.pdf',
					displayPath: '旧稿.pdf',
					ext: 'pdf',
					description: '被替代的那版',
					turn: 2,
					seq: 12,
					index: 1,
					time: T - 60000,
					url: 'api/present.open?sessionId=sess-A&seq=12&index=1',
					fileUrl: 'api/file?path=D%3A%5Cwork%5C%E6%97%A7%E7%A8%BF.pdf',
					exists: false,
				},
			],
		},
		{
			sessionId: 'sess-B',
			title: '做表',
			updatedAt: '2026-10-19T09:00:00.000Z',
			cwd: 'D:\\work',
			presentedCount: 1,
			files: [
				{
					name: '数据.docx',
					path: 'D:\\work\\数据.docx',
					displayPath: '数据.docx',
					ext: 'docx',
					description: '',
					turn: 4,
					seq: 30,
					index: 0,
					time: T - 120000,
					url: 'api/present.open?sessionId=sess-B&seq=30&index=0',
					fileUrl: 'api/file?path=D%3A%5Cwork%5C%E6%95%B0%E6%8D%AE.docx',
					exists: true,
				},
			],
		},
	],
}

const EMPTY = { ok: true, totalSessions: 0, totalFiles: 0, totalMissing: 0, desktop: null, sessions: [] }

/** 一次「打开面板 + 等数据回来」的渲染。 */
const openPanel = async (payload: any = PAYLOAD) => {
	installFetch((url: string) => (url.includes('/dsh-deliverables/list') ? { body: payload } : { body: {} }))

	let tree = render(client.DeliverablesIndex, {})

	const fab = findByClass(tree, 'dshdi_fab')

	assert.notEqual(fab, undefined, '没有悬浮球')
	fab.props.onClick()
	tree = render(client.DeliverablesIndex, {})

	for (let round = 0; round < 4; round++) {
		await settle()
		tree = render(client.DeliverablesIndex, {})
	}

	return tree
}

beforeEach(() => {
	resetHooks()
	client.panelState.open = false
	client.panelState.pos = null
	client.panelState.query = ''
	client.panelState.kind = 'all'
	storageMap.clear()
	windowListeners.clear()
	openCalls = []
	requireCalls = []
	browserWindow.open = undefined
	browserWindow.location = { href: '' }
})

afterEach(() => unmount())
//#endregion

test('信封：id == package.json name，require 只有 react / react/jsx-runtime，槽位是 shell.overlay', () => {
	assert.equal(registration!.id, PACKAGE.name)
	assert.equal(registration!.id, '@zhuobichen/dsh-client-ui-deliverables-index')

	// factory 已经跑过一次（上面 client = ...），它只该 require 这两个
	assert.deepEqual(FACTORY_REQUIRES, ['react', 'react/jsx-runtime'])

	assert.deepEqual(client.inject, ['slots'])
	assert.equal(typeof client.apply, 'function')
	assert.equal(typeof client.DeliverablesIndex, 'function')

	const registered: any[] = []
	const injected: string[] = []

	client.apply({
		slots: {
			inject(name: string, callback: () => void) {
				injected.push(name)
				callback()
			},
			register(options: any, component: any) {
				registered.push({ options, component })

				return () => {}
			},
		},
	})

	assert.deepEqual(injected, ['shell.overlay'])
	assert.equal(registered.length, 1)
	assert.equal(registered[0].options.name, 'shell.overlay')
	assert.equal(registered[0].options.id, 'deliverables-index')
	assert.equal(registered[0].component, client.DeliverablesIndex)
})

test('样式与根节点带 data-plugin 标记（不污染全局）', () => {
	const style = styleTags.find((tag) => tag?.dataset?.plugin === 'dsh-deliverables-index')

	assert.notEqual(style, undefined, '没有注入带 data-plugin 的 style 标签')
	assert.match(style.textContent, /\.dshdi_panel/)
	assert.ok(style.dataset.pluginCss.includes('dsh-deliverables-index'))
})

test('点悬浮球开面板：出现会话标题分组与文件名；再点一次收起', async () => {
	await openPanel()
	let tree = render(client.DeliverablesIndex, {})

	assert.equal(findByClass(tree, 'dshdi_panel') !== undefined, true, '面板没打开')
	assert.equal(findByClass(tree, 'dshdi_root').props['data-plugin'], 'dsh-deliverables-index')

	// 分组头 = 会话标题
	const titles = allByClass(tree, 'dshdi_gtitle').map((node) => textOf(node))

	assert.deepEqual(titles, ['写报告', '做表'], '会话标题分组不对')

	// 每组下面是对应的文件
	const groups = allByClass(tree, 'dshdi_group')
	const namesOf = (index: number) => allByClass(groups[index], 'dshdi_name').map((node) => textOf(node))

	assert.deepEqual(namesOf(0), ['报告.md', '旧稿.pdf'])
	assert.deepEqual(namesOf(1), ['数据.docx'])

	// 分组头上的数量
	const counts = allByClass(tree, 'dshdi_gcount').map((node) => textOf(node))

	assert.deepEqual(counts, ['2', '1'])

	// 描述是灰字那一行；时间在行尾
	assert.equal(textOf(findByClass(rowNamed(tree, '报告.md'), 'dshdi_desc')), '最终报告')
	assert.match(textOf(findByClass(rowNamed(tree, '报告.md'), 'dshdi_time')), /^\d{2}-\d{2} \d{2}:\d{2}$/)
	assert.match(textOf(findByClass(tree, 'dshdi_foot')), /3 个文件/)

	// 再点一次：收起，只剩悬浮球
	findByClass(tree, 'dshdi_fab').props.onClick()
	tree = render(client.DeliverablesIndex, {})

	assert.equal(findByClass(tree, 'dshdi_panel'), undefined, '再点一次没有收起')
	assert.notEqual(findByClass(tree, 'dshdi_fab'), undefined, '收起后悬浮球不该消失')
})

test('搜索框按文件名 / 描述 / 会话标题过滤', async () => {
	const tree = await openPanel()

	// 按会话标题过滤
	findByClass(tree, 'dshdi_search').props.onChange({ target: { value: '做表' } })
	let next = render(client.DeliverablesIndex, {})

	assert.deepEqual(allByClass(next, 'dshdi_gtitle').map((node) => textOf(node)), ['做表'])
	assert.deepEqual(allByClass(next, 'dshdi_name').map((node) => textOf(node)), ['数据.docx'])
	assert.match(textOf(findByClass(next, 'dshdi_foot')), /1 \/ 3 个文件/)

	// 按描述过滤（描述只在灰字里）
	findByClass(next, 'dshdi_search').props.onChange({ target: { value: '被替代' } })
	next = render(client.DeliverablesIndex, {})

	assert.deepEqual(allByClass(next, 'dshdi_name').map((node) => textOf(node)), ['旧稿.pdf'])

	// 什么都匹配不到 → 明确说「没有匹配」
	findByClass(next, 'dshdi_search').props.onChange({ target: { value: '不存在的关键词' } })
	next = render(client.DeliverablesIndex, {})

	assert.equal(allByClass(next, 'dshdi_group').length, 0)
	assert.match(textOf(findByClass(next, 'dshdi_empty')), /没有匹配/)
})

test('类型筛选：pdf 只剩 pdf 行，全部恢复', async () => {
	const tree = await openPanel()

	const pdfTab = allByClass(tree, 'dshdi_tab').find((tab) => textOf(tab) === 'pdf')

	assert.notEqual(pdfTab, undefined, '没有 pdf 这个筛选页')
	pdfTab.props.onClick()

	let next = render(client.DeliverablesIndex, {})

	assert.deepEqual(allByClass(next, 'dshdi_name').map((node) => textOf(node)), ['旧稿.pdf'])
	assert.equal(allByClass(next, 'dshdi_tab').filter((tab) => tab.props['aria-pressed'] === true)[0].props['data-kind'], 'pdf')

	const allTab = allByClass(next, 'dshdi_tab').find((tab) => textOf(tab) === '全部')

	allTab.props.onClick()
	next = render(client.DeliverablesIndex, {})

	assert.equal(allByClass(next, 'dshdi_name').length, 3, '切回全部应该 3 行')
})

test('点一行 → POST 到 presentedFileUrl 那条路由（不带 action 参数）', async () => {
	const tree = await openPanel()

	calls.length = 0

	rowNamed(tree, '报告.md').props.onClick()

	for (let round = 0; round < 3; round++) {
		await settle()
		render(client.DeliverablesIndex, {})
	}

	const posts = calls.filter((call) => call.url.includes('present.open'))

	assert.equal(posts.length, 1, '应该只发一次原生打开请求')
	assert.equal(posts[0].url, 'api/present.open?sessionId=sess-A&seq=12&index=0')
	assert.equal(posts[0].init.method, 'POST')

	const after = render(client.DeliverablesIndex, {})

	assert.match(textOf(findByClass(after, 'dshdi_notice')), /已用系统默认应用打开：报告\.md/)
	assert.equal(openCalls.length, 0, '原生打开成功时不该再开浏览器标签')
})

test('「在文件夹里显示」→ 同一个路由 + &action=reveal', async () => {
	const tree = await openPanel()

	calls.length = 0

	const reveal = findByClass(allByClass(tree, 'dshdi_item')[0], 'dshdi_reveal')

	assert.notEqual(reveal, undefined, '没有「在文件夹里显示」按钮')
	reveal.props.onClick({ stopPropagation() {} })

	for (let round = 0; round < 3; round++) {
		await settle()
		render(client.DeliverablesIndex, {})
	}

	assert.equal(calls.length, 1)
	assert.equal(calls[0].url, 'api/present.open?sessionId=sess-A&seq=12&index=0&action=reveal')
	assert.equal(calls[0].init.method, 'POST')
})

test('exists:false 的行点不动：没有 onClick、不出「在文件夹里显示」、不发请求', async () => {
	const tree = await openPanel()
	const missing = rowNamed(tree, '旧稿.pdf')

	assert.notEqual(missing, undefined)
	assert.equal(missing.props.onClick, undefined, '灰掉的行不该有 onClick')
	assert.equal(missing.props['aria-disabled'], true)
	assert.match(missing.props.className, /dshdi_row--missing/)
	assert.equal(textOf(findByClass(missing, 'dshdi_state')), '文件不在了')

	// 右键也不该发请求
	missing.props.onContextMenu({ preventDefault() {} })

	calls.length = 0

	const missingItem = allByClass(tree, 'dshdi_item').find((item) => findByClass(item, 'dshdi_name') !== undefined && textOf(findByClass(item, 'dshdi_name')) === '旧稿.pdf')

	assert.equal(findByClass(missingItem, 'dshdi_reveal'), undefined, '灰掉的行不该有 reveal 按钮')

	for (let round = 0; round < 3; round++) {
		await settle()
		render(client.DeliverablesIndex, {})
	}

	assert.equal(calls.length, 0, '点/右键灰掉的行都不该发请求')
	assert.match(textOf(findByClass(tree, 'dshdi_foot')), /1 个不在了/)
})

test('宿主没有桌面（409）→ 退到 api/file?path=… 新标签打开，并说清原因', async () => {
	installFetch((url: string) => {
		if (url.includes('/dsh-deliverables/list')) return { body: PAYLOAD }
		if (url.includes('present.open')) return { status: 409, body: 'Host desktop unavailable.' }

		return { body: {} }
	})

	let tree = render(client.DeliverablesIndex, {})

	findByClass(tree, 'dshdi_fab').props.onClick()

	for (let round = 0; round < 4; round++) {
		await settle()
		tree = render(client.DeliverablesIndex, {})
	}

	browserWindow.open = (url: string, target: string, features: string) => {
		const handle: any = { opener: 'linked' }

		openCalls.push({ url, target, features, handle })

		return handle
	}

	rowNamed(tree, '报告.md').props.onClick()

	for (let round = 0; round < 4; round++) {
		await settle()
		tree = render(client.DeliverablesIndex, {})
	}

	assert.equal(openCalls.length, 1, '应该退到浏览器打开一次')
	assert.equal(openCalls[0].url, PAYLOAD.sessions[0].files[0].fileUrl)
	assert.equal(openCalls[0].target, '_blank')
	assert.equal(openCalls[0].handle.opener, null, 'opener 没有被断开')

	const notice = textOf(findByClass(tree, 'dshdi_notice'))

	assert.match(notice, /没有桌面/)
	assert.match(notice, /报告\.md/)
})

test('window.open 被拦截（返回 null）→ 只留可读失败提示，不假装打开了', async () => {
	installFetch((url: string) => {
		if (url.includes('/dsh-deliverables/list')) return { body: PAYLOAD }

		return { status: 409, body: '' }
	})

	let tree = render(client.DeliverablesIndex, {})

	findByClass(tree, 'dshdi_fab').props.onClick()

	for (let round = 0; round < 4; round++) {
		await settle()
		tree = render(client.DeliverablesIndex, {})
	}

	browserWindow.open = () => null

	rowNamed(tree, '报告.md').props.onClick()

	for (let round = 0; round < 4; round++) {
		await settle()
		tree = render(client.DeliverablesIndex, {})
	}

	assert.equal(openCalls.length, 0)
	assert.match(textOf(findByClass(tree, 'dshdi_notice')), /打开失败：这个宿主没有桌面/)
})

test('空态：还没有任何会话产出过文档（并点名 present）', async () => {
	const tree = await openPanel(EMPTY)

	assert.equal(allByClass(tree, 'dshdi_group').length, 0)

	const empty = textOf(findByClass(tree, 'dshdi_empty'))

	assert.match(empty, /还没有任何会话产出过文档/)
	assert.match(empty, /present/)
})

test('读不到的会话在列表里单独说明（不是假装它没有文件）', async () => {
	const payload = {
		ok: true,
		totalFiles: 0,
		totalMissing: 0,
		sessions: [{ sessionId: 'sess-C', title: '坏会话', presentedCount: 0, files: [], error: '日志损坏' }],
	}

	const tree = await openPanel(payload)

	assert.match(textOf(findByClass(tree, 'dshdi_gerr')), /这个会话读不到：日志损坏/)
})

test('宿主连不上 → 可读错误 + 重试按钮，不渲染半截列表', async () => {
	installFetch(() => 'reject')

	let tree = render(client.DeliverablesIndex, {})

	findByClass(tree, 'dshdi_fab').props.onClick()

	for (let round = 0; round < 4; round++) {
		await settle()
		tree = render(client.DeliverablesIndex, {})
	}

	assert.match(textOf(findByClass(tree, 'dshdi_err')), /连不上文档索引服务/)
	assert.notEqual(buttonWithText(tree, '重试'), undefined, '没有「重试」')
	assert.equal(allByClass(tree, 'dshdi_group').length, 0)
})

test('纯函数：kindOf / presentUrl / clampPos', () => {
	assert.equal(client.kindOf('md'), 'md')
	assert.equal(client.kindOf('PDF'), 'pdf')
	assert.equal(client.kindOf('xlsx'), 'other')
	assert.equal(client.kindOf(''), 'other')

	const file = { url: 'api/present.open?sessionId=a&seq=1&index=0' }

	assert.equal(client.presentUrl(file, 'open'), 'api/present.open?sessionId=a&seq=1&index=0')
	assert.equal(client.presentUrl(file, 'reveal'), 'api/present.open?sessionId=a&seq=1&index=0&action=reveal')
	assert.equal(client.presentUrl({}, 'open'), '')

	assert.deepEqual(client.clampPos({ x: -50, y: 99999 }, { width: 1000, height: 800 }), { x: 0, y: 756 })
	assert.deepEqual(client.clampPos(null, { width: 1000, height: 800 }), { x: 16, y: 16 })
})

test('面板位置从 localStorage 恢复（跨刷新记得上次拖到哪）', () => {
	storageMap.set('dshdi-pos', JSON.stringify({ x: 200, y: 120 }))

	// 模拟「插件模块重新加载」：重新按信封工厂造一份模块
	const reloaded = registration!.factory(requireStub)

	const tree = render(reloaded.DeliverablesIndex, {})

	// 收起状态只有一个悬浮球，没有面板；位置在打开后才用得上
	assert.notEqual(findByClass(tree, 'dshdi_fab'), undefined)

	findByClass(tree, 'dshdi_fab').props.onClick()

	const opened = render(reloaded.DeliverablesIndex, {})

	assert.equal(findByClass(opened, 'dshdi_panel').props.style.left, '200px')
	assert.equal(findByClass(opened, 'dshdi_panel').props.style.top, '120px')
})
