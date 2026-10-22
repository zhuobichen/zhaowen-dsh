// dsh-client-ui-voice 的契约测试。
//
// 它加载的是**真正会被下发给浏览器的那份 client.js**（不是另抄一份），
// 用假的 __ModuleLoader__ / react / slots / conversation / SpeechRecognition
// 把整条链路跑一遍：
//
//   信封 id == package.json name
//   -> factory(stub) 出 apply / inject
//   -> apply(ctx) 挂到 conversation.input.left
//   -> inject(sessionId) 拿到会话作用域的 setDraft
//   -> 渲染按钮、点一下、喂一条 final 识别结果
//   -> 断言 ctx.conversation.input.for(...) 返回的门面收到那句文本
//
// 跑：node test/contract.test.ts
// （Node 24 原生剥类型，不需要编译。）

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT_FILE = join(HERE, '..', 'client', 'client.js')
const PACKAGE = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')) as {
  name: string
}

//#region 假的浏览器环境 + 假 React（只实现组件用到的那几个 hook）
type Registration = {
  id: string
  factory: (require: (name: string) => unknown) => any
}

let registration: Registration | undefined

const browserWindow: any = {
  __ModuleLoader__: {
    load(candidate: Registration) {
      registration = candidate
    },
  },
}

;(globalThis as any).window = browserWindow

// classic script 用 window.__ModuleLoader__.load 自注册；ESM import 只是执行它。
await import(pathToFileURL(CLIENT_FILE).href)

type HookCell =
  | { kind: 'state'; value: any }
  | { kind: 'ref'; ref: { current: any } }
  | { kind: 'effect'; run: () => void | (() => void) }
  | { kind: 'callback'; value: any }
  | { kind: 'memo'; value: any }

const hooks: { cells: HookCell[]; index: number; cleanups: Array<() => void> } = {
  cells: [],
  index: 0,
  cleanups: [],
}

const reactStub = {
  useState(initial: any) {
    const index = hooks.index++

    if (hooks.cells[index] === undefined) {
      hooks.cells[index] = {
        kind: 'state',
        value: typeof initial === 'function' ? initial() : initial,
      }
    }

    const cell = hooks.cells[index] as { kind: 'state'; value: any }
    const set = (next: any) => {
      cell.value = typeof next === 'function' ? next(cell.value) : next
    }

    return [cell.value, set]
  },
  useRef(initial: any) {
    const index = hooks.index++

    if (hooks.cells[index] === undefined) {
      hooks.cells[index] = { kind: 'ref', ref: { current: initial } }
    }

    return (hooks.cells[index] as { kind: 'ref'; ref: { current: any } }).ref
  },
  useEffect(run: () => void | (() => void)) {
    const index = hooks.index++

    if (hooks.cells[index] === undefined) hooks.cells[index] = { kind: 'effect', run }
  },
  useCallback(fn: any) {
    const index = hooks.index++

    if (hooks.cells[index] === undefined) hooks.cells[index] = { kind: 'callback', value: fn }

    return (hooks.cells[index] as { kind: 'callback'; value: any }).value
  },
  useMemo(fn: any) {
    const index = hooks.index++

    if (hooks.cells[index] === undefined) hooks.cells[index] = { kind: 'memo', value: fn() }

    return (hooks.cells[index] as { kind: 'memo'; value: any }).value
  },
}

const jsx = (type: any, props: any) => ({ type, props })
const runtimeStub = { jsx, jsxs: jsx }

const requireStub = (name: string) => {
  if (name === 'react') return reactStub
  if (name === 'react/jsx-runtime') return runtimeStub

  throw new Error('client.js require 了静态表以外的模块：' + name)
}

/** 渲染一版组件；`reset` 为 false 时沿用上一版 hook 单元（模拟 re-render）。 */
const renderComponent = (component: any, props: any, reset = true) => {
  if (reset) {
    hooks.cells = []
    hooks.cleanups = []
  }

  hooks.index = 0

  const element = component(props)

  if (reset) {
    for (const cell of hooks.cells) {
      if (cell !== undefined && cell.kind === 'effect') {
        const cleanup = cell.run()

        if (typeof cleanup === 'function') hooks.cleanups.push(cleanup)
      }
    }
  }

  return element
}

const childrenOf = (node: any): any[] => {
  const children = node && node.props ? node.props.children : null

  if (children === null || children === undefined) return []

  return Array.isArray(children) ? children : [children]
}

const findByType = (node: any, type: string): any => {
  if (node === null || typeof node !== 'object') return undefined
  if (node.type === type) return node

  for (const child of childrenOf(node)) {
    const found = findByType(child, type)

    if (found !== undefined) return found
  }

  return undefined
}

const findHint = (node: any): any => {
  if (node === null || typeof node !== 'object') return undefined

  const className = node.props && node.props.className

  if (typeof className === 'string' && className.includes('dshv_hint')) return node

  for (const child of childrenOf(node)) {
    const found = findHint(child)

    if (found !== undefined) return found
  }

  return undefined
}
//#endregion

//#region 假的 SpeechRecognition
class FakeRecognition {
  static instances: FakeRecognition[] = []

  lang = ''
  interimResults = false
  continuous = false
  started = false
  stopped = false

  onresult: any = null
  onerror: any = null
  onend: any = null
  onstart: any = null

  constructor() {
    FakeRecognition.instances.push(this)
  }

  start() {
    this.started = true
  }

  stop() {
    this.stopped = true
  }

  abort() {}
}
//#endregion

//#region 假的 ctx：slots + sessions + conversation.input.for
const makeHarness = () => {
  const captured: string[] = []
  const notices: Array<{ level: string; text: string }> = []
  const registered: Array<{ definition: any; component: any }> = []
  const waits: string[] = []

  const conversation = {
    input: {
      for(_actx: any) {
        return {
          setDraft(text: string) {
            captured.push(text)
          },
          notify(level: string, text: string) {
            notices.push({ level, text })
          },
        }
      },
    },
  }

  const session = {
    get(name: string) {
      return name === 'conversation' ? conversation : undefined
    },
  }

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
    sessions: {
      scope(id: string) {
        assert.equal(id, 'session-1', 'inject 拿到的 sessionId 应该原样交给 sessions.scope')

        return session
      },
    },
    conversation,
    get(name: string) {
      return name === 'conversation' ? conversation : undefined
    },
  }

  return { ctx, captured, notices, registered, waits }
}

//#endregion

assert.notEqual(registration, undefined, 'client.js 没有调用 window.__ModuleLoader__.load')

const client = registration!.factory(requireStub)

//#region 1. 信封
test('信封 id 等于 package.json 的 name', () => {
  assert.notEqual(registration, undefined, 'client.js 没有调用 window.__ModuleLoader__.load')
  assert.equal(registration!.id, PACKAGE.name)
  assert.equal(registration!.id, '@zhuobichen/dsh-client-ui-voice')
})

test('factory 交出 apply / inject', () => {
  assert.ok(Array.isArray(client.inject), 'inject 必须是数组（Classic Script 的注入声明）')
  assert.ok(client.inject.includes('slots'), 'inject 必须包含 slots')
  assert.equal(typeof client.apply, 'function')
})
//#endregion

//#region 2. 挂载契约
test('挂到 conversation.input.left，注册的组件是函数', () => {
  const harness = makeHarness()

  client.apply(harness.ctx)

  assert.deepEqual(harness.waits, ['conversation.input.left'], '等待的槽位名不对')
  assert.equal(harness.registered.length, 1, '应该只注册一个条目')

  const { definition, component } = harness.registered[0]

  assert.equal(definition.name, 'conversation.input.left', '注册的槽位名不对')
  assert.equal(definition.id, 'voice-input')
  assert.equal(typeof definition.inject, 'function', '会话作用域的注入面没挂上')
  assert.equal(typeof component, 'function', '注册的组件不是函数')
})
//#endregion

//#region 3. 说话 -> 写草稿
test('识别出一条 final 结果后，conversation.input.for(...).setDraft 收到那句话', () => {
  const harness = makeHarness()

  client.apply(harness.ctx)

  const entry = harness.registered[0]
  const injected = entry.definition.inject('session-1')

  assert.equal(typeof injected.setDraft, 'function', '注入面没有 setDraft 退路')

  browserWindow.SpeechRecognition = FakeRecognition
  delete browserWindow.webkitSpeechRecognition
  FakeRecognition.instances.length = 0

  const element = renderComponent(entry.component, {
    input: { draft: '' },
    sessionId: 'session-1',
    ...injected,
  })
  const button = findByType(element, 'button')

  assert.notEqual(button, undefined, '没渲染出按钮')

  // 点击开始
  button.props.onClick()

  assert.equal(FakeRecognition.instances.length, 1, '没有 new SpeechRecognition')
  const rec = FakeRecognition.instances[0]

  assert.equal(rec.lang, 'zh-CN')
  assert.equal(rec.interimResults, true)
  assert.equal(rec.continuous, false)
  assert.equal(rec.started, true, '没有调用 start()')

  // interim 只是"听到了"，不该写草稿
  rec.onresult({
    resultIndex: 0,
    results: [{ isFinal: false, 0: { transcript: '你好' } }],
  })
  assert.deepEqual(harness.captured, [], 'interim 结果不该写进草稿')

  // final 才写
  rec.onresult({
    resultIndex: 0,
    results: [{ isFinal: true, 0: { transcript: '你好，世界' } }],
  })
  assert.deepEqual(harness.captured, ['你好，世界'], 'setDraft 没收到识别文本')

  rec.onend()
  assert.equal(harness.notices.length, 0, '成功路径不该弹错误')
})

test('已有草稿时追加，不覆盖', () => {
  const harness = makeHarness()

  client.apply(harness.ctx)

  const entry = harness.registered[0]
  const injected = entry.definition.inject('session-1')

  browserWindow.SpeechRecognition = FakeRecognition
  FakeRecognition.instances.length = 0

  const element = renderComponent(entry.component, {
    input: { draft: '已有内容' },
    sessionId: 'session-1',
    ...injected,
  })

  findByType(element, 'button').props.onClick()

  FakeRecognition.instances[0].onresult({
    resultIndex: 0,
    results: [{ isFinal: true, 0: { transcript: '新来的' } }],
  })

  assert.deepEqual(harness.captured, ['已有内容 新来的'])
})

test('优先走槽位标准件 inputActions.setDraft（真实 Web 里的首选路径）', () => {
  const harness = makeHarness()

  client.apply(harness.ctx)

  const entry = harness.registered[0]
  const injected = entry.definition.inject('session-1')
  const actions: string[] = []

  browserWindow.SpeechRecognition = FakeRecognition
  FakeRecognition.instances.length = 0

  const element = renderComponent(entry.component, {
    input: { draft: '' },
    inputActions: {
      setDraft(text: string) {
        actions.push(text)
      },
    },
    sessionId: 'session-1',
    ...injected,
  })

  findByType(element, 'button').props.onClick()
  FakeRecognition.instances[0].onresult({
    resultIndex: 0,
    results: [{ isFinal: true, 0: { transcript: '用标准件写' } }],
  })

  assert.deepEqual(actions, ['用标准件写'], 'inputActions.setDraft 没被调用')
  assert.deepEqual(harness.captured, [], '有 inputActions 时不该再走注入退路')
})

test('说话一个字都没听到时给可读提示，不静默', () => {
  const harness = makeHarness()

  client.apply(harness.ctx)

  const entry = harness.registered[0]
  const injected = entry.definition.inject('session-1')

  browserWindow.SpeechRecognition = FakeRecognition
  FakeRecognition.instances.length = 0

  const element = renderComponent(entry.component, {
    input: { draft: '' },
    sessionId: 'session-1',
    ...injected,
  })

  findByType(element, 'button').props.onClick()
  FakeRecognition.instances[0].onend()

  // 状态变了 -> re-render 后才看得到那行提示
  const rerendered = renderComponent(entry.component, {
    input: { draft: '' },
    sessionId: 'session-1',
    ...injected,
  }, false)
  const hint = findHint(rerendered)

  assert.notEqual(hint, undefined, '没有渲染提示行')
  assert.match(hint.props.children, /没有听清/)
})
//#endregion

//#region 4. 失败要说话
test('浏览器不支持 webkitSpeechRecognition 时，点击给可读提示', () => {
  delete browserWindow.SpeechRecognition
  delete browserWindow.webkitSpeechRecognition

  const harness = makeHarness()

  client.apply(harness.ctx)

  const entry = harness.registered[0]
  const injected = entry.definition.inject('session-1')
  const props = { input: { draft: '' }, sessionId: 'session-1', ...injected }
  const element = renderComponent(entry.component, props)

  findByType(element, 'button').props.onClick()

  assert.equal(harness.notices.length, 1, '不该静默失败')
  assert.equal(harness.notices[0].level, 'error')
  assert.match(harness.notices[0].text, /不支持/)

  // 提示同时也写进按钮旁边那行小字（re-render 后可见）
  const rerendered = renderComponent(entry.component, props, false)
  const hint = findHint(rerendered)

  assert.notEqual(hint, undefined, '本地提示行没渲染')
  assert.match(hint.props.children, /不支持/)
})

test('麦克风没权限（not-allowed）映射成人话', () => {
  const harness = makeHarness()

  client.apply(harness.ctx)

  const entry = harness.registered[0]
  const injected = entry.definition.inject('session-1')

  browserWindow.SpeechRecognition = FakeRecognition
  FakeRecognition.instances.length = 0

  const element = renderComponent(entry.component, {
    input: { draft: '' },
    sessionId: 'session-1',
    ...injected,
  })

  findByType(element, 'button').props.onClick()
  FakeRecognition.instances[0].onerror({ error: 'not-allowed' })

  assert.equal(harness.notices.length, 1)
  assert.equal(harness.notices[0].level, 'error')
  assert.match(harness.notices[0].text, /麦克风权限/)
})

test('再点一下停：listen 状态下按钮变成停止并调 stop()', () => {
  const harness = makeHarness()

  client.apply(harness.ctx)

  const entry = harness.registered[0]
  const injected = entry.definition.inject('session-1')
  const props = { input: { draft: '' }, sessionId: 'session-1', ...injected }

  browserWindow.SpeechRecognition = FakeRecognition
  FakeRecognition.instances.length = 0

  const first = renderComponent(entry.component, props)

  findByType(first, 'button').props.onClick()

  const rec = FakeRecognition.instances[0]

  assert.equal(rec.started, true)

  // 状态变了 -> re-render（hook 单元沿用），按钮应该已经切到 listening
  const second = renderComponent(entry.component, props, false)
  const button = findByType(second, 'button')

  assert.equal(button.props['aria-pressed'], true, '按钮没有 listening 态')
  assert.equal(button.props.children, '⏹', '按钮图标没从 🎙 变 ⏹')

  button.props.onClick()

  assert.equal(rec.stopped, true, '第二次点击没有 stop()')
})
//#endregion

//#region 5. 纯函数护栏
test('appendToDraft：空草稿直接用原文，非空追加', () => {
  assert.equal(client.appendToDraft('', '你好'), '你好')
  assert.equal(client.appendToDraft('已有', '新来的'), '已有 新来的')
  assert.equal(client.appendToDraft('已有 ', '新来的'), '已有 新来的')
  assert.equal(client.appendToDraft('已有', ''), '已有')
  assert.equal(client.appendToDraft(null, '你好'), '你好')
})

test('errorTextOf 覆盖权限 / 没声音 / 未知', () => {
  assert.match(client.errorTextOf('not-allowed'), /麦克风权限/)
  assert.match(client.errorTextOf('no-speech'), /没有听到声音/)
  assert.match(client.errorTextOf('mystery'), /mystery/)
})
//#endregion
