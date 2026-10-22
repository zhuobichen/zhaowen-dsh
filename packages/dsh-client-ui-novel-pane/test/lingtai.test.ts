// 灵台阅读器客户端链路的测试。
//
// 加载的是**真正下发给浏览器的** client/client.js，用假的 __ModuleLoader__ /
// document / react / fetch 把整条链跑一遍：
//
//   点「读书」-> POST /dsh-novel-pane/lingtai -> 面板里渲染 <iframe src=url>
//   失败（超时 / 没配目录）-> 面板里可读错误 + 重试 + 新标签打开
//   「新标签打开」-> window.open(url, '_blank') 一次，然后把 opener 置空
//   window.open 返回 null -> 行内出现可点的手动打开提示
//   「内置」-> 切回原来的书库面板（书库 / 索引 / 翻页不删）
//
// 跑：node test/lingtai.test.ts

import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT_FILE = join(HERE, '..', 'client', 'client.js')
const PACKAGE = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')) as { name: string }

//#region 假的浏览器环境
const classSet = new Set<string>()
const classOps: Array<{ op: 'add' | 'remove'; name: string }> = []
const classList = {
  add(name: string) {
    classSet.add(name)
    classOps.push({ op: 'add', name })
  },
  remove(name: string) {
    classSet.delete(name)
    classOps.push({ op: 'remove', name })
  },
  contains(name: string) {
    return classSet.has(name)
  },
  toggle(name: string, force?: boolean) {
    const want = force === undefined ? !classSet.has(name) : force

    if (want) this.add(name)
    else this.remove(name)

    return want
  },
}

const styleTags: any[] = []
const cssVars = new Map<string, string>()
const styleStub = {
  setProperty(name: string, value: string) {
    cssVars.set(name, value)
  },
  removeProperty(name: string) {
    cssVars.delete(name)
  },
  getPropertyValue(name: string) {
    return cssVars.get(name) ?? ''
  },
}

const documentStub: any = {
  documentElement: { classList, style: styleStub },
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

/** window.open 的记账；每个用例自己决定返回什么。 */
let openCalls: Array<{ url: string; target: string; features: string | undefined }> = []

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

//#region 假 React（与 reading-mode.test.ts 同一套最小实现）
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
  if (name === 'react') return reactStub
  if (name === 'react/jsx-runtime') return runtimeStub

  throw new Error('client.js require 了静态表以外的模块：' + name)
}

//#endregion

//#region 假 fetch
type Reply = { status?: number; body: any } | 'reject'

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

    return { ok: status >= 200 && status < 300, status, json: async () => reply.body }
  }
}

const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0))
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

const findByType = (node: any, type: string): any => {
  if (node === null || typeof node !== 'object') return undefined
  if (node.type === type) return node

  for (const child of childrenOf(node)) {
    const found = findByType(child, type)

    if (found !== undefined) return found
  }

  return undefined
}

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

//#endregion

assert.notEqual(registration, undefined, 'client.js 没有调用 window.__ModuleLoader__.load')

const client = registration!.factory(requireStub)

// 面板开合/视图是模块级状态（切会话不收起），用例之间必须复位
beforeEach(() => {
  client.panelState.open = false
  client.panelState.view = 'shelf'
  client.panelState.liteUrl = ''
  client.panelState.snap = null
  client.panelState.zoom = 1
  client.panelState.liteZoom = 1
})

const flush = async (props: any = {}) => {
  let tree = render(client.NovelPane, props)

  for (let round = 0; round < 4; round++) {
    await settle()
    tree = render(client.NovelPane, props)
  }

  return tree
}

/** 每个用例的公共夹层：清状态、清 window.open、清 location。 */
const reset = () => {
  resetHooks()
  classSet.clear()
  classOps.length = 0
  storageMap.clear()
  windowListeners.clear()
  cssVars.clear()
  openCalls = []
  browserWindow.open = undefined
  browserWindow.location = { href: '' }
}

afterEach(() => unmount())

const LINGTAI_URL = 'http://127.0.0.1:8769'

/** 假宿主：/lingtai 按参数回，别的路由回空对象。 */
const lingtaiHandler = (reply: any) => (url: string) =>
  url.includes('/lingtai') ? { body: reply } : { body: {} }

test('点「读书」→ POST /lingtai 一次 → 面板里渲染 iframe（src = 返回的 url）', async () => {
  reset()
  installFetch(lingtaiHandler({ ok: true, launched: true, url: LINGTAI_URL }))

  let tree = render(client.NovelPane, {})

  findByClass(tree, 'dshnp_launch').props.onClick()
  tree = await flush({})

  const posts = calls.filter((call) => call.url.includes('/lingtai'))

  assert.equal(posts.length, 1, '应该只 POST 一次 /lingtai')
  assert.equal(posts[0].init.method, 'POST')

  const frame = findByType(tree, 'iframe')

  assert.notEqual(frame, undefined, '面板里没有渲染 iframe')
  assert.equal(frame.props.src, LINGTAI_URL, 'iframe 的 src 不是宿主返回的 url')
  assert.equal(frame.props.title, '灵台阅读器')
  assert.equal(openCalls.length, 0, '主路径是 iframe，不该顺手开新标签')
  assert.ok(classSet.has('dshnp-reading'), '灵台面板打开后没给 #root 让位')
  assert.match(textOf(findByClass(tree, 'dshnp_ptitle')), /灵台阅读器/)
})

test('POST 失败（超时）→ 面板里可读错误 + 重试 + 新标签打开', async () => {
  reset()
  installFetch(
    lingtaiHandler({
      ok: false,
      launched: true,
      code: 'LINGTAI_TIMEOUT',
      message: '灵台阅读器没能在 12 秒内起来：D:\\lingtai-reader\\server.py 没有开始监听 8769。',
      url: LINGTAI_URL,
    }),
  )

  let tree = render(client.NovelPane, {})

  findByClass(tree, 'dshnp_launch').props.onClick()
  tree = await flush({})

  assert.equal(findByType(tree, 'iframe'), undefined, '失败了还渲染 iframe')
  assert.match(textOf(tree), /没能在 12 秒内起来/, '面板里没有可读错误')
  assert.notEqual(buttonWithText(tree, '重试'), undefined, '没有「重试」')
  assert.notEqual(buttonWithText(tree, '新标签打开'), undefined, '没有「新标签打开」')
  assert.ok(classSet.has('dshnp-reading'), '错误面板也要占住右边那块（#root 让位）')
})

test('「新标签打开」→ window.open 恰好调用一次，参数带 url 与 _blank', async () => {
  reset()
  installFetch(
    lingtaiHandler({
      ok: false,
      launched: true,
      code: 'LINGTAI_TIMEOUT',
      message: '灵台阅读器没能在 12 秒内起来',
      url: LINGTAI_URL,
    }),
  )

  let tree = render(client.NovelPane, {})

  findByClass(tree, 'dshnp_launch').props.onClick()
  tree = await flush({})

  browserWindow.open = (url: string, target: string, features: string) => {
    // 返回一个真的对象，才能验证"打开成功后 opener 被断开"
    const handle: any = { opener: 'linked' }

    openCalls.push({ url, target, features, handle })

    return handle
  }

  buttonWithText(tree, '新标签打开').props.onClick()
  tree = await flush({})

  assert.equal(openCalls.length, 1, 'window.open 应该只调用一次')
  assert.equal(openCalls[0].url, LINGTAI_URL)
  assert.equal(openCalls[0].target, '_blank')
  // 传 'noopener' 时 window.open 按规范返回 null（Chromium 如此），会误报「被拦截」；
  // 所以改成两参调用 + 手动把 opener 断成 null。
  assert.equal(openCalls[0].features, undefined, '不该再传 noopener 参数')
  assert.equal(openCalls[0].handle.opener, null, 'opener 没有被断开')
})

test('window.open 返回 null → 行内出现可点的手动打开提示，点了走 location.href', async () => {
  reset()
  installFetch(lingtaiHandler({ ok: true, launched: false, url: LINGTAI_URL }))

  let tree = render(client.NovelPane, {})

  findByClass(tree, 'dshnp_launch').props.onClick()
  tree = await flush({})

  // 头部「新标签」是 iframe 的退路；这里模拟被浏览器拦截
  browserWindow.open = () => null
  buttonWithText(tree, '新标签').props.onClick()
  tree = await flush({})

  const manual = findByClass(tree, 'dshnp_manual')

  assert.notEqual(manual, undefined, '被拦截后没有出现手动打开提示')
  assert.match(textOf(manual), /手动打开/)

  manual.props.onClick()
  assert.equal(browserWindow.location.href, LINGTAI_URL, '手动打开没有跳转')
})

test('「内置」→ 切回原来的书库面板（iframe 收掉，书库还在）', async () => {
  reset()

  const SHELF = {
    open: true,
    title: null,
    file: null,
    dir: 'D:\\books',
    mode: 'scroll',
    line: 0,
    total: 0,
    rows: 20,
    progress: '',
    position: '',
    text: [],
    shelf: ['a.txt'],
  }

  installFetch((url: string) => {
    if (url.includes('/lingtai')) return { body: { ok: true, launched: true, url: LINGTAI_URL } }
    if (url.includes('/library')) return { body: { books: [], skipped: [], total: 0 } }
    if (url.includes('/state')) return { body: SHELF }

    return { body: SHELF }
  })

  let tree = render(client.NovelPane, {})

  findByClass(tree, 'dshnp_launch').props.onClick()
  tree = await flush({})

  assert.notEqual(findByType(tree, 'iframe'), undefined)

  // dock 那行的次要入口
  buttonWithText(tree, '内置').props.onClick()
  tree = await flush({})

  assert.equal(findByType(tree, 'iframe'), undefined, '切回内置后 iframe 还挂着')
  assert.notEqual(findByClass(tree, 'dshnp_shelfbody'), undefined, '没有回到书库面板')
  assert.match(textOf(tree), /a\.txt/, '书库内容没渲染出来')
})

test('宿主连不上（fetch 全 reject）→ 退回内置面板，不白缩 #root 也不丢功能', async () => {
  reset()
  installFetch(() => 'reject')

  let tree = render(client.NovelPane, {})

  findByClass(tree, 'dshnp_launch').props.onClick()
  tree = await flush({})

  assert.equal(findByType(tree, 'iframe'), undefined)
  assert.notEqual(findByClass(tree, 'dshnp_note'), undefined, '连不上时 dock 那行没有提示')
  assert.match(textOf(findByClass(tree, 'dshnp_hint')), /连不上|没有响应/)
  assert.ok(!classSet.has('dshnp-reading'), '拿不到内容还把 #root 缩着')
})
