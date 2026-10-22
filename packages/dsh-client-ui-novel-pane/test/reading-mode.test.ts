// dsh-client-ui-novel-pane 的阅读模式测试。
//
// 加载的是**真正会被下发给浏览器的那份 client.js**，用假的
// __ModuleLoader__ / document / react / fetch 把整条链路跑一遍：
//
//   信封 id == package.json name
//   -> factory(stub) 出 apply / inject
//   -> apply(ctx) 挂到 conversation.input.dock（order 16）
//   -> 点「读书」-> 给 html 加 dshnp-reading + GET /state?shelf=1 -> 书库
//   -> 点一本书 -> POST /move {op:"open-book", name} -> 正文
//   -> 关闭 -> 摘掉 class；卸载 -> 也摘掉
//   -> fetch 失败 -> 面板里有提示，class 摘掉（不白缩 #root）
//
// 跑：node test/reading-mode.test.ts
// （Node 24 原生剥类型，不需要编译。）

import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT_FILE = join(HERE, '..', 'client', 'client.js')
const PACKAGE = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')) as {
  name: string
}

//#region 假的浏览器环境
type ClassOp = { op: 'add' | 'remove'; name: string }

const classSet = new Set<string>()
const classOps: ClassOp[] = []

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

/** documentElement.style 的桩：记下 --dshnp-w 的写入与删除，供拖拽测试断言。 */
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

const browserWindow: any = {
  innerWidth: 1440,
  __ModuleLoader__: {
    load(candidate: Registration) {
      registration = candidate
    },
  },
}

/** localStorage 桩：拖宽度要落盘，双击要清除。 */
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

/** window 上的事件监听桩：拖拽条测试要手动派发 pointermove / pointerup。 */
const windowListeners = new Map<string, Set<(event: any) => void>>()

browserWindow.addEventListener = (type: string, fn: (event: any) => void) => {
  if (!windowListeners.has(type)) windowListeners.set(type, new Set())
  windowListeners.get(type)!.add(fn)
}

browserWindow.removeEventListener = (type: string, fn: (event: any) => void) => {
  windowListeners.get(type)?.delete(fn)
}

const fireWindow = (type: string, event: any) => {
  for (const fn of [...(windowListeners.get(type) ?? [])]) fn(event)
}

;(globalThis as any).window = browserWindow
;(globalThis as any).document = documentStub

// classic script 用 window.__ModuleLoader__.load 自注册；ESM import 只是执行它。
await import(pathToFileURL(CLIENT_FILE).href)

//#endregion

//#region 假 React：够用的 useState / useRef / useEffect（含依赖比较与 cleanup）
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
      const cell: any = {
        kind: 'state',
        value: typeof initial === 'function' ? initial() : initial,
      }

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

/** 渲染并追平 effect 里同步产生的 state 更新（类似 React 的重渲染）。 */
const render = (component: any, props: any) => {
  let element = renderOnce(component, props)
  let guard = 0

  while (dirty && guard++ < 20) element = renderOnce(component, props)

  return element
}

/** 卸载：跑所有 effect 的 cleanup。 */
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

//#region 假的 fetch
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

    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => reply.body,
    }
  }
}

/** 把微任务跑干净，让 fetch 的 .then 链落到 state 里。 */
const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

//#endregion

//#region 假元素树上的查询工具
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

const byTitle = (node: any, title: string): any => {
  if (node === null || typeof node !== 'object') return undefined
  if (node.props && node.props.title === title) return node

  for (const child of childrenOf(node)) {
    const found = byTitle(child, title)

    if (found !== undefined) return found
  }

  return undefined
}

/** 找文本里含某句话的按钮（书库里的书名按钮）。 */
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

// 面板开合/视图是模块级状态（为了切会话不收起），用例之间必须复位，
// 否则上一个用例留下的 open=true 会污染下一个。
beforeEach(() => {
  client.panelState.open = false
  client.panelState.view = 'shelf'
  client.panelState.liteUrl = ''
})

/**
 * 渲染 -> 让 promise 落地 -> 再渲染，直到树稳定。
 * 点击只改 state；请求要等下一次 render 里的 effect 才发出去，所以要转几轮。
 */
const flush = async (props: any = {}) => {
  let tree = render(client.NovelPane, props)

  for (let round = 0; round < 3; round++) {
    await settle()
    tree = render(client.NovelPane, props)
  }

  return tree
}

//#region 1. 信封与注入
test('信封 id 等于 package.json 的 name', () => {
  assert.notEqual(registration, undefined, 'client.js 没有调用 window.__ModuleLoader__.load')
  assert.equal(registration!.id, PACKAGE.name)
  assert.equal(registration!.id, '@zhuobichen/dsh-client-ui-novel-pane')
})

test('factory 交出 apply / inject，inject 仍只要 slots', () => {
  assert.ok(Array.isArray(client.inject), 'inject 必须是数组（Classic Script 的注入声明）')
  assert.deepEqual(client.inject, ['slots'])
  assert.equal(typeof client.apply, 'function')
  assert.equal(typeof client.NovelPane, 'function')
})

test('注入的 CSS 里有 html.dshnp-reading #root 的让位规则', () => {
  assert.equal(styleTags.length, 1, '应该只注入一个 <style>')
  assert.equal(styleTags[0].dataset.pluginCss, '@zhuobichen/dsh-client-ui-novel-pane/pane.css')
  assert.match(
    styleTags[0].textContent,
    /html\.dshnp-reading #root\s*\{[^}]*width: calc\(100vw - var\(--dshnp-w, 440px\)\)/,
  )
})

test('挂到 conversation.input.dock，order 16，组件是函数', () => {
  const waits: string[] = []
  const registered: Array<{ definition: any; component: any }> = []
  const ctx = {
    slots: {
      inject(name: string, callback: () => unknown) {
        waits.push(name)

        return callback()
      },
      register(definition: any, component: any) {
        registered.push({ definition, component })

        return () => {}
      },
    },
  }

  client.apply(ctx)

  assert.deepEqual(waits, ['conversation.input.dock'])
  assert.equal(registered.length, 1)

  const { definition, component } = registered[0]

  assert.equal(definition.name, 'conversation.input.dock')
  assert.equal(definition.id, 'novel-pane')
  assert.equal(definition.order, 16)
  assert.equal(component, client.NovelPane)
})
//#endregion

//#region 2. 阅读模式：书库 -> 正文 -> 关闭
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
  shelf: ['a.txt', 'b.txt'],
}

const BOOK = {
  open: true,
  title: 'a.txt',
  file: 'D:\\books\\a.txt',
  dir: 'D:\\books',
  mode: 'scroll',
  line: 0,
  total: 2,
  rows: 20,
  progress: '第 1/1 页 · 100%',
  position: '1/2',
  text: ['第一行', '第二行'],
  shelf: null,
}

const bookHandler = (url: string, init: any) => {
  if (url.includes('/state')) return { body: url.includes('shelf=1') ? SHELF : BOOK }

  if (init && init.body) {
    const body = JSON.parse(init.body)

    if (body.op === 'open-book') return { body: BOOK }
    if (body.op === 'browse') return { body: SHELF }
  }

  return { body: BOOK }
}

test('点「读书」进书库，点一本书进正文，关闭后摘掉 dshnp-reading', async () => {
  resetHooks()
  classSet.clear()
  classOps.length = 0
  installFetch(bookHandler)

  const props = {}
  let tree = render(client.NovelPane, props)

  const launch = findByClass(tree, 'dshnp_launch')

  assert.notEqual(launch, undefined, '关着时没有渲染「读书」入口')
  assert.match(textOf(launch), /读书/)
  assert.ok(!classSet.has('dshnp-reading'), '还没打开就缩了布局')

  launch.props.onClick()
  tree = await flush(props)

  // 布局让位
  assert.ok(classSet.has('dshnp-reading'), '进入阅读模式没有给 html 加 dshnp-reading')
  assert.ok(
    classOps.some((entry) => entry.op === 'add' && entry.name === 'dshnp-reading'),
    'dshnp-reading 不是通过 classList.add 加上去的',
  )

  // 书库：GET /state?shelf=1，两本书
  const shelfCall = calls.find((call) => call.url.includes('/state') && call.url.includes('shelf=1'))

  assert.notEqual(shelfCall, undefined, '没有取书库（缺 shelf=1）')

  const books = allByClass(tree, 'dshnp_book')

  assert.equal(books.length, 2, '书库应该渲染出两本')
  assert.match(textOf(books[0]), /a\.txt/)
  assert.match(textOf(books[1]), /b\.txt/)

  // 点第一本 -> POST open-book 带 name
  books[0].props.onClick()
  tree = await flush(props)

  const post = calls.filter((call) => call.url.includes('/move')).at(-1) as any
  const payload = JSON.parse(post.init.body)

  assert.equal(payload.op, 'open-book', '打开一本书用的 op 不是 open-book')
  assert.equal(payload.name, 'a.txt', 'open-book 的 name 参数不对')

  // 正文
  const pre = findByClass(tree, 'dshnp_text')

  assert.notEqual(pre, undefined, '正文没有渲染')
  assert.match(textOf(pre), /第一行/)
  assert.match(textOf(pre), /第二行/)

  // dock 那行能看出正在读哪本
  assert.match(textOf(findByClass(tree, 'dshnp_launch')), /a\.txt/)

  // 翻页仍然走 /move 的现成 op
  byTitle(tree, '下一页').props.onClick()
  tree = await flush(props)

  const pagePost = calls.filter((call) => call.url.includes('/move')).at(-1) as any

  assert.equal(JSON.parse(pagePost.init.body).op, 'down', '下一页没有发 op:down')

  // 关闭 -> class 摘掉
  const closeButton = byTitle(tree, '关闭阅读区')

  assert.notEqual(closeButton, undefined, '没有关闭按钮')
  closeButton.props.onClick()
  tree = await flush(props)

  assert.ok(!classSet.has('dshnp-reading'), '关闭后 dshnp-reading 还挂着')
  assert.ok(
    classOps.some((entry) => entry.op === 'remove' && entry.name === 'dshnp-reading'),
    '关闭时没有调用 classList.remove',
  )
  assert.equal(findByClass(tree, 'dshnp_panel'), undefined, '关闭后阅读区还在')
})

test('组件卸载时也会摘掉 dshnp-reading', async () => {
  resetHooks()
  classSet.clear()
  classOps.length = 0
  installFetch(() => ({ body: SHELF }))

  let tree = render(client.NovelPane, {})

  findByClass(tree, 'dshnp_launch').props.onClick()
  tree = await flush({})

  assert.ok(classSet.has('dshnp-reading'), '打开时没有缩布局')

  unmount()

  assert.ok(!classSet.has('dshnp-reading'), '卸载后还留着 dshnp-reading')
})
//#endregion

//#region 3. 出错与空书库
test('宿主路由没起来：面板里有可读提示，且不把 #root 一直缩着', async () => {
  resetHooks()
  classSet.clear()
  classOps.length = 0
  installFetch(() => 'reject')

  let tree = render(client.NovelPane, {})

  findByClass(tree, 'dshnp_launch').props.onClick()
  tree = await flush({})

  const hint = findByClass(tree, 'dshnp_hint')

  assert.notEqual(hint, undefined, '失败时没有渲染提示')
  assert.match(textOf(hint), /连不上|没有响应/)

  assert.ok(!classSet.has('dshnp-reading'), 'fetch 失败还把 #root 永久缩着')

  // 仍然能关掉
  const closeButton = byTitle(tree, '关闭阅读区')

  assert.notEqual(closeButton, undefined)
  closeButton.props.onClick()
  tree = await flush({})

  assert.ok(!classSet.has('dshnp-reading'))
  assert.equal(findByClass(tree, 'dshnp_panel'), undefined)
})

test('空书库：说「这个目录里没有书」并给「换个目录」入口', async () => {
  resetHooks()
  classSet.clear()
  installFetch(() => ({ body: { ...SHELF, shelf: [] } }))

  let tree = render(client.NovelPane, {})

  findByClass(tree, 'dshnp_launch').props.onClick()
  tree = await flush({})

  assert.match(textOf(tree), /这个目录里没有书/)

  const change = buttonWithText(tree, '换个目录')

  assert.notEqual(change, undefined, '空书库没有「换个目录」入口')

  // 点开换目录输入框
  change.props.onClick()
  tree = render(client.NovelPane, {})

  assert.notEqual(findByClass(tree, 'dshnp_input'), undefined, '没有换目录输入框')
})

test('换目录：先试 open-path，宿主说 not a file 再 browse（带 shelf:true）', async () => {
  resetHooks()
  classSet.clear()
  installFetch((url, init) => {
    if (url.includes('/state')) return { body: { ...SHELF, shelf: [] } }

    const body = JSON.parse(init.body)

    if (body.op === 'open-path') return { status: 400, body: { error: 'not a file' } }
    if (body.op === 'browse') return { body: { ...SHELF, dir: 'D:\\books2', shelf: ['c.txt'] } }

    return { body: { ...SHELF, shelf: [] } }
  })

  let tree = render(client.NovelPane, {})

  findByClass(tree, 'dshnp_launch').props.onClick()
  tree = await flush({})

  buttonWithText(tree, '换个目录').props.onClick()
  tree = render(client.NovelPane, {})

  findByClass(tree, 'dshnp_input').props.onChange({ target: { value: 'D:\\books2' } })
  tree = render(client.NovelPane, {})

  buttonWithText(tree, '打开').props.onClick()
  tree = await flush({})

  const posts = calls
    .filter((call) => call.url.includes('/move'))
    .map((call) => JSON.parse(call.init.body))

  assert.deepEqual(
    posts.map((body) => body.op),
    ['open-path', 'browse'],
    '换目录没有先试文件再试目录',
  )

  const browse = posts.find((body) => body.op === 'browse')

  assert.equal(browse.dir, 'D:\\books2')
  assert.equal(browse.shelf, true, 'browse 没要书单，就拿不到新目录的 shelf')
  assert.match(textOf(tree), /c\.txt/, '换目录后书库没更新')
})

//#region 阅读区宽度可拖拽
test('宽度夹取：太窄抬到 320，太宽封到 min(900, 80% 视口)，非数字回默认', () => {
  const clamp = client.clampWidth

  assert.equal(clamp(200, 1440), 320, '太窄没有抬到 320')
  assert.equal(clamp(5000, 1440), 900, '宽屏没有封在 900')
  assert.equal(clamp(5000, 900), 720, '窄视口没有按 80% 封顶')
  assert.equal(clamp(640, 1440), 640, '合法值被改了')
  assert.equal(clamp('abc', 1440), null, '非数字应当回 null（用默认宽度）')
  assert.equal(clamp(undefined, 1440), null, 'undefined 应当回 null')
})

test('拖拽条：按下后跟指针走，松手才落盘，宽度写进 --dshnp-w', async () => {
  resetHooks()
  classSet.clear()
  cssVars.clear()
  storageMap.clear()
  windowListeners.clear()

  installFetch((url) => (url.includes('/state') ? { body: SHELF } : { body: SHELF }))

  let tree = render(client.NovelPane, {})

  findByClass(tree, 'dshnp_launch').props.onClick()
  tree = await flush({})

  const grip = findByClass(tree, 'dshnp_grip')

  assert.notEqual(grip, undefined, '面板里没有拖拽条')
  assert.equal(grip.props.role, 'separator')

  grip.props.onPointerDown({ preventDefault() {} })

  // 视口 1440，指针在 x=1000 → 宽度 440
  fireWindow('pointermove', { clientX: 1000 })
  tree = render(client.NovelPane, {})

  assert.equal(cssVars.get('--dshnp-w'), '440px', '拖动没有写进 CSS 变量')
  assert.equal(storageMap.get('dshnp-width'), undefined, '拖动过程中不该落盘')

  // 继续拖到越界位置（x=100 → 想给 1340）会被夹到 900；这必须发生松手之前
  fireWindow('pointermove', { clientX: 100 })
  tree = render(client.NovelPane, {})

  assert.equal(cssVars.get('--dshnp-w'), '900px', '右边界没有夹到 900')

  fireWindow('pointerup', {})
  assert.equal(storageMap.get('dshnp-width'), '900', '松手没有记住夹过之后的宽度')
})

test('双击拖拽条恢复默认宽度，并清掉记忆', async () => {
  resetHooks()
  classSet.clear()
  cssVars.clear()
  storageMap.clear()
  windowListeners.clear()
  storageMap.set('dshnp-width', '600')

  installFetch((url) => (url.includes('/state') ? { body: SHELF } : { body: SHELF }))

  let tree = render(client.NovelPane, {})

  findByClass(tree, 'dshnp_launch').props.onClick()
  tree = await flush({})

  assert.equal(cssVars.get('--dshnp-w'), '600px', '没有用上次记住的宽度')

  findByClass(tree, 'dshnp_grip').props.onDoubleClick()
  tree = render(client.NovelPane, {})

  assert.equal(cssVars.has('--dshnp-w'), false, '双击后没有回到默认宽度')
  assert.equal(storageMap.get('dshnp-width'), undefined, '双击后没有清掉记忆')
})
//#region 4. 书库索引（GET /library）
// 任何一条失败也不能把 3 秒轮询留在进程里（否则测试跑完不退出）
afterEach(() => unmount())

const LIBRARY = {
  books: [
    {
      id: 'id-epub',
      name: '白夜行 (东野圭吾) (z-library.sk, 1lib.sk, z-lib.sk).epub',
      title: '白夜行',
      kind: 'epub',
      dir: 'C:\\Users\\Administrator\\Downloads',
      path: 'C:\\Users\\Administrator\\Downloads\\白夜行 (东野圭吾) (z-library.sk, 1lib.sk, z-lib.sk).epub',
      size: 619555,
    },
    { id: 'id-txt', name: '三体.txt', title: '三体', kind: 'txt', dir: 'D:\\books', path: 'D:\\books\\三体.txt', size: 100 },
    { id: 'id-md', name: '笔记.md', title: '笔记', kind: 'md', dir: 'D:\\books', path: 'D:\\books\\笔记.md', size: 10 },
    {
      id: 'id-pdf',
      name: '伊藤润二短篇精选集.pdf',
      title: '伊藤润二短篇精选集',
      kind: 'pdf',
      dir: 'C:\\Users\\Administrator\\Downloads',
      path: 'C:\\Users\\Administrator\\Downloads\\伊藤润二短篇精选集.pdf',
      size: 130000000,
    },
  ],
  skipped: [
    { name: '某书.mobi', path: 'D:\\books\\某书.mobi', kind: 'mobi', reason: 'MOBI 暂不支持：先转成 .epub 或 .txt' },
  ],
  total: 4,
}

/** 书库页：/library 给索引，/state?shelf=1 给空书单（不列目录），/move 回正文。 */
const libraryHandler = (url: string, init: any) => {
  if (url.includes('/library')) return { body: LIBRARY }
  if (url.includes('/state')) return { body: url.includes('shelf=1') ? { ...SHELF, shelf: [] } : BOOK }

  if (init && init.body) {
    const body = JSON.parse(init.body)

    if (body.op === 'open-path') return { body: BOOK }
  }

  return { body: BOOK }
}

test('书库页渲染索引：短标题 + 类型徽标 + 目录，PDF 有说明', async () => {
  resetHooks()
  classSet.clear()
  installFetch(libraryHandler)

  let tree = render(client.NovelPane, {})

  findByClass(tree, 'dshnp_launch').props.onClick()
  tree = await flush({})

  assert.notEqual(
    calls.find((call) => call.url.includes('/library')),
    undefined,
    '书库页没有请求 /library',
  )

  const books = allByClass(tree, 'dshnp_book')

  assert.equal(books.length, 4, '索引里的四本书没有都渲染出来')
  assert.match(textOf(books[0]), /白夜行/)
  assert.match(textOf(books[0]), /EPUB/, 'EPUB 没有类型徽标')
  assert.match(textOf(books[1]), /三体/)
  assert.match(textOf(books[1]), /TXT/, 'TXT 没有类型徽标')
  assert.match(textOf(tree), /笔记/)
  assert.match(textOf(tree), /MD/)
  assert.match(textOf(books[3]), /PDF/, 'PDF 没有类型徽标（PDF 现在是能读的）')
  assert.match(textOf(tree), /Downloads/, '没有显示所在目录')
  assert.match(textOf(tree), /MOBI/, '没有说明 MOBI 为什么不在列表里')
  assert.match(textOf(tree), /暂不支持/)
})

test('搜索框按标题 / 原名过滤，纯前端不发请求', async () => {
  resetHooks()
  classSet.clear()
  installFetch(libraryHandler)

  let tree = render(client.NovelPane, {})

  findByClass(tree, 'dshnp_launch').props.onClick()
  tree = await flush({})

  const search = findByClass(tree, 'dshnp_search')

  assert.notEqual(search, undefined, '书库页没有搜索框')

  search.props.onChange({ target: { value: '白夜' } })
  tree = render(client.NovelPane, {})

  let books = allByClass(tree, 'dshnp_book')

  assert.equal(books.length, 1, '按标题过滤没生效')
  assert.match(textOf(books[0]), /白夜行/)

  // 也能按原文件名（z-library 尾巴）搜
  search.props.onChange({ target: { value: 'z-library' } })
  tree = render(client.NovelPane, {})

  books = allByClass(tree, 'dshnp_book')
  assert.equal(books.length, 1)
  assert.match(textOf(books[0]), /白夜行/)

  search.props.onChange({ target: { value: '没有这本书' } })
  tree = render(client.NovelPane, {})

  assert.equal(allByClass(tree, 'dshnp_book').length, 0)
  assert.match(textOf(tree), /没有匹配的书/)

  // 过滤不该把请求打到宿主
  assert.equal(calls.filter((call) => call.url.includes('/move')).length, 0)
})

test('分组切换：全部 / 电子书 / PDF', async () => {
  resetHooks()
  classSet.clear()
  installFetch(libraryHandler)

  let tree = render(client.NovelPane, {})

  findByClass(tree, 'dshnp_launch').props.onClick()
  tree = await flush({})

  const tabs = allByClass(tree, 'dshnp_tab')

  assert.equal(tabs.length, 3, '分组切换应该有 三个标签')

  const tabOf = (key: string) => {
    const found = tabs.find((tab) => tab.props['data-group'] === key)

    assert.notEqual(found, undefined, `没有 ${key} 分组`)

    return found!
  }

  tabOf('pdf').props.onClick()
  tree = render(client.NovelPane, {})

  let books = allByClass(tree, 'dshnp_book')

  assert.equal(books.length, 1, 'PDF 分组里应该只有那本 pdf')
  assert.match(textOf(books[0]), /伊藤润二/)

  tabOf('ebook').props.onClick()
  tree = render(client.NovelPane, {})

  books = allByClass(tree, 'dshnp_book')
  assert.equal(books.length, 3, '电子书分组 = epub + txt + md')
  assert.ok(
    books.every((book) => !textOf(book).includes('伊藤润二')),
    '电子书分组里混进了 PDF',
  )

  tabOf('all').props.onClick()
  tree = render(client.NovelPane, {})

  assert.equal(allByClass(tree, 'dshnp_book').length, 4)
})

test('列表分页：默认 50 条，点「显示更多」一次加 50', async () => {
  resetHooks()
  classSet.clear()

  const big = {
    books: Array.from({ length: 120 }, (_, index) => ({
      id: 'big-' + index,
      name: '书' + index + '.txt',
      title: '书' + index,
      kind: 'txt',
      dir: 'D:\\books',
      path: 'D:\\books\\书' + index + '.txt',
      size: 10,
    })),
    skipped: [],
    total: 120,
  }

  installFetch((url, init) => {
    if (url.includes('/library')) return { body: big }
    if (url.includes('/state')) return { body: { ...SHELF, shelf: [] } }
    if (init && init.body) {
      const body = JSON.parse(init.body)

      if (body.op === 'open-path') return { body: BOOK }
    }

    return { body: BOOK }
  })

  let tree = render(client.NovelPane, {})

  findByClass(tree, 'dshnp_launch').props.onClick()
  tree = await flush({})

  assert.equal(allByClass(tree, 'dshnp_book').length, 50, '默认没有只渲染 50 条')

  let more = findByClass(tree, 'dshnp_more')

  assert.notEqual(more, undefined, '没有「显示更多」')
  assert.match(textOf(more), /还有 70 本/)

  more.props.onClick()
  tree = render(client.NovelPane, {})

  assert.equal(allByClass(tree, 'dshnp_book').length, 100)

  more = findByClass(tree, 'dshnp_more')
  assert.match(textOf(more), /还有 20 本/)

  more.props.onClick()
  tree = render(client.NovelPane, {})

  assert.equal(allByClass(tree, 'dshnp_book').length, 120)
  assert.equal(findByClass(tree, 'dshnp_more'), undefined, '全部显示后还有「显示更多」')
})

test('点索引里的一本书发 open-path（绝对路径），然后切到正文', async () => {
  resetHooks()
  classSet.clear()
  installFetch(libraryHandler)

  let tree = render(client.NovelPane, {})

  findByClass(tree, 'dshnp_launch').props.onClick()
  tree = await flush({})

  const book = buttonWithText(tree, '白夜行')

  assert.notEqual(book, undefined, '索引里没有白夜行')

  book.props.onClick()
  tree = await flush({})

  const post = calls.filter((call) => call.url.includes('/move')).at(-1) as any

  assert.notEqual(post, undefined, '点书没有发 /move')
  assert.equal(JSON.parse(post.init.body).op, 'open-path', '打开索引里的书没用 open-path')
  assert.equal(JSON.parse(post.init.body).path, LIBRARY.books[0].path, 'open-path 没带绝对路径')

  assert.match(textOf(findByClass(tree, 'dshnp_text')), /第一行/, '打开后没切到正文')

  // 正文页有 3 秒轮询；不卸载的话进程会被 interval 拖住不退出
  unmount()
})
//#endregion

//#region 阅读区缩放（只缩正文，不动整页）
test('clampZoom：夹在 0.7–2.2，非数字回 1', () => {
  const clamp = client.clampZoom

  assert.equal(clamp(0.2), 0.7, '太小没有抬到 0.7')
  assert.equal(clamp(9), 2.2, '太大没有压到 2.2')
  assert.equal(clamp('abc'), 1, '非数字没有回默认 1')
  assert.equal(clamp(1.5), 1.5, '合法值被改了')
})

test('字号按钮：A+ 放大、A− 缩小、百分比恢复默认', async () => {
  resetHooks()
  classSet.clear()
  cssVars.clear()
  storageMap.clear()
  installFetch(bookHandler)

  const props = {}
  let tree = render(client.NovelPane, props)

  findByClass(tree, 'dshnp_launch').props.onClick()
  tree = await flush(props)

  allByClass(tree, 'dshnp_book')[0].props.onClick()
  tree = await flush(props)

  assert.equal(findByClass(tree, 'dshnp_text').props.style.fontSize, '15px', '默认字号应当是 15px')

  buttonWithText(tree, 'A+').props.onClick()
  tree = render(client.NovelPane, props)

  assert.equal(findByClass(tree, 'dshnp_text').props.style.fontSize, '16.5px', 'A+ 没有放大正文')

  buttonWithText(tree, 'A−').props.onClick()
  tree = render(client.NovelPane, props)

  assert.equal(findByClass(tree, 'dshnp_text').props.style.fontSize, '15px', 'A− 没有缩回去')

  buttonWithText(tree, 'A+').props.onClick()
  tree = render(client.NovelPane, props)

  const percent = buttonWithText(tree, '110%')

  assert.notEqual(percent, undefined, '放大之后没有出现百分比按钮')
  percent.props.onClick()
  tree = render(client.NovelPane, props)

  assert.equal(findByClass(tree, 'dshnp_text').props.style.fontSize, '15px', '百分比按钮没有恢复默认')

  // 只改正文元素的 inline style，整页不该被缩
  assert.equal(cssVars.has('--dshnp-zoom'), false, '缩放不该写进全局 CSS 变量')

  unmount()
})

test('Ctrl+滚轮：阅读器开着就拦下整页缩放，只改正文字号', async () => {
  resetHooks()
  classSet.clear()
  cssVars.clear()
  storageMap.clear()
  windowListeners.clear()
  installFetch(bookHandler)

  const props = {}
  let tree = render(client.NovelPane, props)

  findByClass(tree, 'dshnp_launch').props.onClick()
  tree = await flush(props)

  allByClass(tree, 'dshnp_book')[0].props.onClick()
  tree = await flush(props)

  assert.equal(findByClass(tree, 'dshnp_text').props.style.fontSize, '15px')

  let prevented = false

  fireWindow('wheel', {
    ctrlKey: true,
    deltaY: -100,
    preventDefault() {
      prevented = true
    },
    stopPropagation() {},
  })

  tree = render(client.NovelPane, props)

  assert.equal(prevented, true, 'Ctrl+滚轮没有被拦下，浏览器会缩整页')
  assert.equal(findByClass(tree, 'dshnp_text').props.style.fontSize, '16.5px', '没有放大正文')

  unmount()
})

test('灵台面板：Ctrl+滚轮缩放 iframe，按住 Ctrl 时遮罩把事件截下来', async () => {
  resetHooks()
  classSet.clear()
  cssVars.clear()
  storageMap.clear()
  windowListeners.clear()

  installFetch((url) => {
    if (url.includes('/lingtai')) {
      return { body: { ok: true, launched: true, url: 'http://127.0.0.1:8769' } }
    }

    if (url.includes('/state')) return { body: url.includes('shelf=1') ? SHELF : BOOK }

    return { body: BOOK }
  })

  const props = {}
  let tree = render(client.NovelPane, props)

  findByClass(tree, 'dshnp_launch').props.onClick()
  tree = await flush(props)

  const frame = findByClass(tree, 'dshnp_frame')

  assert.notEqual(frame, undefined, '灵台面板里没有 iframe')
  assert.equal(frame.props.src, 'http://127.0.0.1:8769')
  assert.equal(frame.props.style.zoom, 1)

  // 按住 Ctrl：遮罩变成可吃事件，否则滚轮会被 iframe 吃掉
  fireWindow('keydown', { key: 'Control' })
  tree = render(client.NovelPane, props)

  assert.notEqual(findByClass(tree, 'dshnp_frameveil_on'), undefined, '按住 Ctrl 时遮罩没有生效')

  let prevented = false

  fireWindow('wheel', {
    ctrlKey: true,
    deltaY: -100,
    preventDefault() {
      prevented = true
    },
    stopPropagation() {},
  })

  tree = render(client.NovelPane, props)

  assert.equal(prevented, true, '灵台里的 Ctrl+滚轮没有被拦下')
  // 用 CSS zoom（重排版）而不是 transform: scale（位图放大，文字会糊）
  assert.equal(findByClass(tree, 'dshnp_frame').props.style.zoom, 1.1, 'Ctrl+滚轮没有缩放灵台 iframe')
  assert.equal(
    findByClass(tree, 'dshnp_frame').props.style.transform,
    undefined,
    '不该再用 transform 缩放（会把文字放大成糊的位图）',
  )

  // 松开 Ctrl：遮罩还回去，灵台自己恢复正常交互
  fireWindow('keyup', { key: 'Control' })
  tree = render(client.NovelPane, props)

  assert.equal(findByClass(tree, 'dshnp_frameveil_on'), undefined, '松开 Ctrl 后遮罩没有撤掉')

  unmount()
})

test('切换会话（组件重挂）后面板保持展开，灵台地址还在', async () => {
  resetHooks()
  classSet.clear()
  cssVars.clear()
  storageMap.clear()
  windowListeners.clear()

  installFetch((url) => {
    if (url.includes('/lingtai')) {
      return { body: { ok: true, launched: true, url: 'http://127.0.0.1:8769' } }
    }

    if (url.includes('/state')) return { body: url.includes('shelf=1') ? SHELF : BOOK }

    return { body: BOOK }
  })

  const props = {}
  let tree = render(client.NovelPane, props)

  findByClass(tree, 'dshnp_launch').props.onClick()
  tree = await flush(props)

  assert.notEqual(findByClass(tree, 'dshnp_frame'), undefined, '没进灵台面板')

  // 模拟切会话：卸载 + 用全新的 hook 单元重挂
  unmount()
  resetHooks()

  tree = render(client.NovelPane, props)

  const frame = findByClass(tree, 'dshnp_frame')

  assert.notEqual(frame, undefined, '重挂之后面板被收起了（应该保持展开）')
  assert.equal(frame.props.src, 'http://127.0.0.1:8769', '重挂后灵台地址丢了')

  unmount()
})
//#endregion
//#endregion
