// dsh-agent-supervisor 的契约测试。
//
// 它加载的是**真正会被 DSH 装载的那两份源码**（宿主 index.js + 客户端 client.js），
// 用假的 ctx / react / window / fetch 把整条链路跑一遍：
//
//   宿主：apply(fakeCtx) -> ctx.tools.register 捕获 6 个工具
//        -> 每个工具的 execute 真跑，返回值再按 output.schema 校验一遍
//   客户端：window.__ModuleLoader__.load -> factory(stub) -> apply(fakeCtx)
//        -> shell.overlay 注册 -> 渲染头像 -> 点开面板 -> GET/POST /chat -> 拖动
//
// 跑：node test/contract.test.ts
// （Node 24 原生剥类型，不需要编译。）
//
// 一个前提：宿主半身在运行时才 import `@deepseek-ai/dsh-tools`（peerDependency，
// 由 DSH 自己的 node_modules 提供）。这个仓库里它躺在 dsh/toolchain 下，所以测试
// 用 registerHooks 把这个裸模块名接到那份真实实现上——测的就是真的 defineTool
// （schema 编译 + 参数校验），不是替身。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, '..')
const PACKAGE = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { name: string }
const HOST_FILE = join(PACKAGE_ROOT, 'index.js')
const CLIENT_FILE = join(PACKAGE_ROOT, 'client', 'client.js')

//#region 把 @deepseek-ai/dsh-tools 接到仓库里那份真实实现
const TOOLS_ENTRY = join(PACKAGE_ROOT, '..', '..', '..', 'dsh', 'toolchain', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js')

registerHooks({
  resolve(specifier: string, context: any, nextResolve: any) {
    if (specifier === '@deepseek-ai/dsh-tools') {
      return { url: pathToFileURL(TOOLS_ENTRY).href, shortCircuit: true }
    }

    return nextResolve(specifier, context)
  },
})

assert.ok(existsSync(TOOLS_ENTRY), '找不到 @deepseek-ai/dsh-tools（期望在 dsh/toolchain/node_modules 下）')

const toolsModule: any = await import('@deepseek-ai/dsh-tools')

/** 跑一个工具，并按它自己声明的 output.schema 校验返回值。 */
const runTool = async (definition: any, args: any, exec: any) => {
  const value = await definition.execute(args, exec)
  const violations = toolsModule.validateJsonSchemaValue(definition.output.schema, value, '')

  assert.deepEqual(violations, [], '工具 ' + definition.name + ' 的返回不符合自己的 output.schema')

  return value
}
//#endregion

//#region 假的浏览器（在 import client.js 之前就得就位）
type Registration = {
  id: string
  factory: (require: (name: string) => unknown) => any
}

let registration: Registration | undefined
const styleTags: any[] = []
const listeners = new Map<string, Set<(event: any) => void>>()

const makeStorage = () => {
  const data = new Map<string, string>()

  return {
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => {
      data.set(key, String(value))
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
    data,
  }
}

const storage = makeStorage()

const browserWindow: any = {
  innerWidth: 1280,
  innerHeight: 800,
  localStorage: storage,
  fetch: undefined,
  setInterval: (_fn: any, _ms: number) => 1,
  clearInterval: (_id: any) => undefined,
  addEventListener(type: string, fn: any) {
    if (!listeners.has(type)) listeners.set(type, new Set())
    listeners.get(type)!.add(fn)
  },
  removeEventListener(type: string, fn: any) {
    listeners.get(type)?.delete(fn)
  },
  __ModuleLoader__: {
    load(candidate: Registration) {
      registration = candidate
    },
  },
}

;(globalThis as any).window = browserWindow

const fakeDocument = {
  querySelector: (_selector: string) => null,
  createElement: (_tag: string) => ({ dataset: {} as Record<string, string>, textContent: '' }),
  head: {
    appendChild(node: any) {
      styleTags.push(node)
    },
  },
}

;(globalThis as any).document = fakeDocument

const fire = (type: string, event: any) => {
  for (const fn of [...(listeners.get(type) ?? [])]) fn(event)
}

/** 客户端对 fetch 的调用记录 + 可切换的应答。 */
const fetchCalls: Array<{ url: string; init: any }> = []
let fetchHandler: (url: string, init: any) => any = () => ({ ok: true, json: async () => ({ ok: true, messages: [] }) })

browserWindow.fetch = async (url: string, init: any) => {
  fetchCalls.push({ url, init })

  return fetchHandler(url, init)
}

//#region 假 React（只实现组件用到的那几个 hook）
type HookCell =
  | { kind: 'state'; value: any }
  | { kind: 'ref'; ref: { current: any } }
  | { kind: 'effect'; run: () => void | (() => void) }
  | { kind: 'memo'; value: any }

const hooks: { cells: HookCell[]; index: number; cleanups: Array<() => void> } = { cells: [], index: 0, cleanups: [] }

const reactStub = {
  useState(initial: any) {
    const index = hooks.index++

    if (hooks.cells[index] === undefined) hooks.cells[index] = { kind: 'state', value: typeof initial === 'function' ? initial() : initial }

    const cell = hooks.cells[index] as { kind: 'state'; value: any }
    const set = (next: any) => {
      cell.value = typeof next === 'function' ? next(cell.value) : next
    }

    return [cell.value, set]
  },
  useRef(initial: any) {
    const index = hooks.index++

    if (hooks.cells[index] === undefined) hooks.cells[index] = { kind: 'ref', ref: { current: initial } }

    return (hooks.cells[index] as { kind: 'ref'; ref: { current: any } }).ref
  },
  useEffect(run: () => void | (() => void)) {
    const index = hooks.index++

    if (hooks.cells[index] === undefined) hooks.cells[index] = { kind: 'effect', run }
  },
  useMemo(fn: () => any) {
    const index = hooks.index++

    if (hooks.cells[index] === undefined) hooks.cells[index] = { kind: 'memo', value: fn() }

    return (hooks.cells[index] as { kind: 'memo'; value: any }).value
  },
}

const jsxStub = (type: any, props: any) => ({ type, props })
const runtimeStub = { jsx: jsxStub, jsxs: jsxStub }

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
//#endregion

//#region 遍历渲染结果的小工具
const textOf = (node: any): string => {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object' && node.props) return textOf(node.props.children)

  return ''
}

const findAll = (node: any, predicate: (node: any) => boolean): any[] => {
  const found: any[] = []

  const visit = (candidate: any) => {
    if (candidate === null || candidate === undefined) return
    if (Array.isArray(candidate)) {
      for (const child of candidate) visit(child)

      return
    }
    if (typeof candidate !== 'object') return

    if (predicate(candidate)) found.push(candidate)
    if (candidate.props) visit(candidate.props.children)
  }

  visit(node)

  return found
}

const classOf = (node: any): string => {
  const value = node?.props?.className

  return typeof value === 'string' ? value : ''
}

const findByClass = (node: any, className: string) => {
  const hit = findAll(node, (candidate) => classOf(candidate).split(/\s+/).includes(className))[0]

  assert.notEqual(hit, undefined, '没有渲染出 .' + className)

  return hit
}

const findMaybeClass = (node: any, className: string) =>
  findAll(node, (candidate) => classOf(candidate).split(/\s+/).includes(className))[0]

const findButtonByText = (node: any, text: string) => {
  const hit = findAll(node, (candidate) => candidate.type === 'button' && textOf(candidate).includes(text))[0]

  assert.notEqual(hit, undefined, '没有渲染出按钮「' + text + '」')

  return hit
}

const findInput = (node: any) => {
  const hit = findAll(node, (candidate) => candidate.type === 'textarea' || candidate.type === 'input')[0]

  assert.notEqual(hit, undefined, '没有渲染出输入框')

  return hit
}
//#endregion

// 执行 client.js（它会调用 window.__ModuleLoader__.load 自注册）
await import(pathToFileURL(CLIENT_FILE).href)

assert.notEqual(registration, undefined, 'client.js 没有调用 window.__ModuleLoader__.load')

const client = registration!.factory(requireStub)

//#region 1. 信封
test('信封：id == package.json name，factory 交出 apply / inject', () => {
  assert.equal(registration!.id, PACKAGE.name)
  assert.equal(registration!.id, '@zhuobichen/dsh-agent-supervisor')
  assert.ok(Array.isArray(client.inject), 'inject 必须是数组')
  assert.deepEqual(client.inject.slice().sort(), ['sessions', 'slots', 'uiWorkspace'])
  assert.equal(typeof client.apply, 'function')
})

test('客户端信封：顶层没有 import/export，require 只碰 react', () => {
  const source = readFileSync(CLIENT_FILE, 'utf8')

  // 只看顶层（缩进前的行首），factory 内部是允许 import(...) 的字面量的
  assert.ok(!/^\s*import\s/m.test(source), 'client.js 顶层出现了 import')
  assert.ok(!/^\s*export\s/m.test(source), 'client.js 顶层出现了 export')

  const required = [...source.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1])

  assert.deepEqual([...new Set(required)].sort(), ['react', 'react/jsx-runtime'])
})

test('样式注入带 data-plugin 标记', () => {
  assert.ok(styleTags.length >= 1, '没有注入 <style>')
  assert.equal(styleTags[0].dataset.plugin, '@zhuobichen/dsh-agent-supervisor')
  assert.equal(styleTags[0].dataset.pluginCss, '@zhuobichen/dsh-agent-supervisor/supervisor.css')
})
//#endregion

//#region 2. 宿主：6 个工具，且没有删除类
const makeHost = () => {
  const registered: any[] = []
  const routes: any[] = []

  const eventsOf = (title: string, lines: Array<{ role: 'user' | 'agent'; text: string }>) => {
    const events: any[] = [
      { type: 'session/title', seq: 1, time: 1_700_000_000_000, data: { title, messageSeqs: [], source: { kind: 'user' } } },
    ]

    let seq = 2

    for (const line of lines) {
      if (line.role === 'user') {
        events.push({ type: 'user/message', seq, time: 1_700_000_000_000 + seq * 1000, data: { role: 'user', content: [{ type: 'text', text: line.text }], source: { kind: 'user' } } })
      } else {
        events.push({
          type: 'assistant/message',
          seq,
          time: 1_700_000_000_000 + seq * 1000,
          data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: line.text }] }, stream: [] },
          surfaceOp: 'append',
        })
      }

      seq += 1
    }

    return events
  }

  const world = {
    sessions: [
      { id: 'session-sup', title: '管理Bot', live: true, cwd: 'D:\\work', events: eventsOf('管理Bot', [{ role: 'user', text: '你好' }, { role: 'agent', text: '收到' }]) },
      { id: 'session-report', title: '写周报', live: true, cwd: 'D:\\work', events: eventsOf('写周报', [{ role: 'user', text: '帮我写周报' }]) },
      { id: 'session-cold', title: '冷会话', live: false, cwd: 'D:\\work', events: eventsOf('冷会话', [{ role: 'user', text: '很早以前' }]) },
    ],
    sent: [] as Array<{ sessionId: string; text: string }>,
    created: [] as string[],
    renamed: [] as Array<{ sessionId: string; title: string }>,
  }

  const liveSessionOf = (id: string) => {
    const row = world.sessions.find((item) => item.id === id && item.live)

    if (row === undefined) return undefined

    return {
      id: row.id,
      header: { id: row.id, cwd: row.cwd, createdAt: 1_700_000_000_000 },
      seq: row.events.length,
      snapshotEvents: () => row.events,
    }
  }

  const rowOf = (session: any) => ({
    sessionId: session.id,
    updatedAt: 1_700_000_000_000,
    running: false,
    agentAvailable: session.live,
    blank: false,
    projections: { kind: 'sequenced', asOfSeq: session.events.length, values: { title: session.title } },
  })

  const sessionController = {
    async list(_request: any, _signal: any) {
      return { items: world.sessions.map(rowOf) }
    },
    async create(request: any) {
      const id = 'session-new-' + String(world.created.length + 1)

      world.created.push(id)

      return { sessionId: id, ...(request === undefined ? {} : {}) }
    },
    async prompt(request: any, _signal: any) {
      world.sent.push({ sessionId: request.sessionId, text: request.content[0].text })

      return { accepted: true }
    },
    async rename(request: any) {
      world.renamed.push({ sessionId: request.sessionId, title: request.title })

      const row = world.sessions.find((item) => item.id === request.sessionId)

      if (row !== undefined) row.title = request.title

      return { title: request.title, seq: 99 }
    },
    async inspect(sessionId: string, _signal: any) {
      const row = world.sessions.find((item) => item.id === sessionId)

      if (row === undefined) throw new Error('no such session')

      return { meta: { id: sessionId }, events: row.events }
    },
  }

  const ctx: any = {
    tools: {
      register(definition: any) {
        registered.push(definition)

        return () => undefined
      },
    },
    sessions: {
      get(id: string) {
        return liveSessionOf(id)
      },
      list() {
        return world.sessions.filter((item) => item.live).map((item) => liveSessionOf(item.id))
      },
    },
    sessionController,
    agents: {
      get(_id: string) {
        return undefined
      },
    },
    webServer: {
      register(route: any) {
        routes.push(route)

        return () => undefined
      },
    },
    inject(names: string[], callback: (ctx: any) => void) {
      assert.ok(Array.isArray(names))
      callback(ctx)
    },
    effect(factory: () => any) {
      return factory()
    },
  }

  return { ctx, registered, routes, world, eventsOf }
}

const supervisorExec = (host: any) => {
  const session = host.ctx.sessions.get('session-sup')

  return { agent: { session }, signal: new AbortController().signal }
}

const byName = (host: any) => {
  const map = new Map<string, any>()

  for (const definition of host.registered) map.set(definition.name, definition)

  return map
}

const bootHost = async (config: any = {}) => {
  const host = makeHost()

  const { apply } = await import(pathToFileURL(HOST_FILE).href)

  apply(host.ctx, config)

  return { host, tools: byName(host) }
}

test('宿主：注册了 6 个工具，且没有任何 delete / cancel / archive / remove', async () => {
  const { host, tools } = await bootHost({ memoryDir: join(PACKAGE_ROOT, '.tmp', 'memory-boot') })

  assert.equal(host.registered.length, 6, '应该正好注册 6 个工具')
  assert.deepEqual(
    [...tools.keys()].sort(),
    ['dsh_memory', 'dsh_session_rename', 'dsh_session_send', 'dsh_session_start', 'dsh_session_status', 'dsh_sessions_list'],
  )

  for (const definition of host.registered) {
    assert.match(definition.name, /^dsh_/, '工具名要带 dsh_ 前缀')

    for (const forbidden of ['delete', 'cancel', 'archive', 'remove', 'drop', 'purge', 'kill']) {
      assert.ok(!definition.name.toLowerCase().includes(forbidden), '不该注册 ' + definition.name)
      assert.ok(!definition.description.toLowerCase().includes(forbidden), definition.name + ' 的描述里出现了 ' + forbidden)
    }
  }
})

test('宿主：dsh_sessions_list 列会话、标出调用方、可按 query 过滤', async () => {
  const { host, tools } = await bootHost({ memoryDir: join(PACKAGE_ROOT, '.tmp', 'memory-list') })
  const value = await runTool(tools.get('dsh_sessions_list'), { limit: 10 }, supervisorExec(host))

  assert.equal(value.ok, true)
  assert.equal(value.count, 3)
  assert.equal(value.current_session_id, 'session-sup')

  const self = value.sessions.find((row: any) => row.id === 'session-sup')

  assert.equal(self.current, true)
  assert.equal(self.title, '管理Bot')

  const filtered = await runTool(tools.get('dsh_sessions_list'), { query: '周报' }, supervisorExec(host))

  assert.equal(filtered.count, 1)
  assert.equal(filtered.sessions[0].id, 'session-report')
})

test('宿主：dsh_session_send 不存在的 id → 可读错误、不抛、不猜目标', async () => {
  const { host, tools } = await bootHost({ memoryDir: join(PACKAGE_ROOT, '.tmp', 'memory-send-missing') })

  const value = await runTool(tools.get('dsh_session_send'), { session_id: 'session-does-not-exist', text: '在吗' }, supervisorExec(host))

  assert.equal(value.ok, false)
  assert.equal(value.code, 'SESSION_NOT_FOUND')
  assert.match(value.error, /dsh_sessions_list/)
  // 关键：一条都没发出去
  assert.deepEqual(host.world.sent, [])
})

test('宿主：dsh_session_send 发对目标，返回里带标题', async () => {
  const { host, tools } = await bootHost({ memoryDir: join(PACKAGE_ROOT, '.tmp', 'memory-send-ok') })
  const value = await runTool(tools.get('dsh_session_send'), { session_id: 'session-report', text: '周报改一下' }, supervisorExec(host))

  assert.equal(value.ok, true)
  assert.equal(value.session_id, 'session-report')
  assert.equal(value.title, '写周报')
  assert.deepEqual(host.world.sent, [{ sessionId: 'session-report', text: '周报改一下' }])
})

test('宿主：dsh_session_start 新建会话并改名', async () => {
  const { host, tools } = await bootHost({ memoryDir: join(PACKAGE_ROOT, '.tmp', 'memory-start') })
  const value = await runTool(tools.get('dsh_session_start'), { title: '整理日志', text: '把昨天的日志整理一下' }, supervisorExec(host))

  assert.equal(value.ok, true)
  assert.equal(value.session_id, 'session-new-1')
  assert.equal(value.title, '整理日志')
  assert.deepEqual(host.world.renamed, [{ sessionId: 'session-new-1', title: '整理日志' }])
  assert.deepEqual(host.world.sent, [{ sessionId: 'session-new-1', text: '把昨天的日志整理一下' }])
})

test('宿主：dsh_session_status 报活会话的最后几条事件', async () => {
  const { host, tools } = await bootHost({ memoryDir: join(PACKAGE_ROOT, '.tmp', 'memory-status') })
  const value = await runTool(tools.get('dsh_session_status'), { session_id: 'session-sup' }, supervisorExec(host))

  assert.equal(value.ok, true)
  assert.equal(value.live, true)
  assert.equal(value.title, '管理Bot')
  assert.equal(value.last_text, '收到')
  assert.deepEqual(
    value.events.map((event: any) => event.type),
    ['session/title', 'user/message', 'assistant/message'],
  )
})

test('宿主：dsh_session_rename 只改标题，返回旧标题给核对', async () => {
  const { host, tools } = await bootHost({ memoryDir: join(PACKAGE_ROOT, '.tmp', 'memory-rename') })
  const value = await runTool(tools.get('dsh_session_rename'), { session_id: 'session-report', title: '周报（周三）' }, supervisorExec(host))

  assert.equal(value.ok, true)
  assert.equal(value.title, '周报（周三）')
  assert.equal(value.previous_title, '写周报')
})

test('宿主：dsh_memory put → get 回同一个值，并且真的落盘在包的 .tmp/ 里', async () => {
  // 每次跑用一个新的子目录：本机删目录不一定删得掉（rm 成功但文件还在），
  // 所以测试不靠「先清空」，靠「自己独占一个目录」。
  const memoryDir = join(PACKAGE_ROOT, '.tmp', 'memory-memory-' + String(process.pid) + '-' + String(Date.now()))

  rmSync(memoryDir, { recursive: true, force: true })
  mkdirSync(memoryDir, { recursive: true })

  const { host, tools } = await bootHost({ memoryDir })
  const memory = tools.get('dsh_memory')
  const exec = supervisorExec(host)

  const put = await runTool(memory, { op: 'put', key: '称呼', value: '文哥', scope: 'user' }, exec)

  assert.equal(put.ok, true)
  assert.equal(put.key, '称呼')

  const got = await runTool(memory, { op: 'get', key: '称呼', scope: 'user' }, exec)

  assert.equal(got.ok, true)
  assert.equal(got.value, '文哥')

  const listed = await runTool(memory, { op: 'list' }, exec)

  assert.equal(listed.ok, true)
  assert.deepEqual(listed.keys, ['称呼'])

  // 落盘是真的：facts.jsonl 有这一行，notes.md 有可读的一行
  const facts = join(memoryDir, 'facts.jsonl')
  const notes = join(memoryDir, 'notes.md')

  assert.ok(existsSync(facts), 'facts.jsonl 没写出来')
  assert.ok(existsSync(notes), 'notes.md 没写出来')

  const parsed = readFileSync(facts, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))

  assert.deepEqual(parsed, [{ key: '称呼', value: '文哥', at: parsed[0].at, scope: 'user' }])
  assert.match(readFileSync(notes, 'utf8'), /称呼 = 文哥/)
})

test('宿主：dsh_memory 在不可写目录下也不抛（只影响记不记得）', async () => {
  const { host, tools } = await bootHost({ memoryDir: join(PACKAGE_ROOT, '.tmp', 'memory-nope', 'deep', '\u0000bad') })
  const value = await runTool(tools.get('dsh_memory'), { op: 'put', key: 'k', value: 'v' }, supervisorExec(host))

  assert.equal(value.ok, true, '写失败也不该让调用失败')
  assert.equal(value.code, 'MEMORY_WRITE_FAILED')
})

test('宿主：onlySupervisor 生效——非管理Bot会话调用 → FORBIDDEN', async () => {
  const { host, tools } = await bootHost({ memoryDir: join(PACKAGE_ROOT, '.tmp', 'memory-gate') })
  const otherSession = host.ctx.sessions.get('session-report')
  const exec = { agent: { session: otherSession }, signal: new AbortController().signal }

  // 每个工具给一份能过 schema 的最小参数：要证明的是「门拦住了」，不是「参数不合法」
  const minimalArgs: Record<string, any> = {
    dsh_sessions_list: {},
    dsh_session_send: { session_id: 'session-report', text: '在吗' },
    dsh_session_start: { text: '干点活' },
    dsh_session_status: { session_id: 'session-report' },
    dsh_session_rename: { session_id: 'session-report', title: '换个名字' },
    dsh_memory: { op: 'list' },
  }

  for (const name of Object.keys(minimalArgs)) {
    const value = await runTool(tools.get(name), minimalArgs[name], exec)

    assert.equal(value.ok, false, name + ' 不该让非管理Bot调用成功')
    assert.equal(value.code, 'FORBIDDEN', name + ' 没有返回 FORBIDDEN')
  }

  // 被拦住的一次都没生效
  assert.deepEqual(host.world.sent, [])
  assert.deepEqual(host.world.created, [])
  assert.deepEqual(host.world.renamed, [])

  // 关掉开关就都通了
  const open = await bootHost({ memoryDir: join(PACKAGE_ROOT, '.tmp', 'memory-gate-off'), onlySupervisor: false })
  const other = open.host.ctx.sessions.get('session-report')
  const openExec = { agent: { session: other }, signal: new AbortController().signal }
  const allowed = await runTool(open.tools.get('dsh_sessions_list'), {}, openExec)

  assert.equal(allowed.ok, true)
})

test('宿主：标题走日志折叠也能认出管理Bot（会话上没有 sessionTitle 服务时）', async () => {
  const { host, tools } = await bootHost({ memoryDir: join(PACKAGE_ROOT, '.tmp', 'memory-fold') })

  // 这个假 ctx 本来就没给 sessionTitle：判定只能靠 fold 日志里的 session/title
  assert.equal(host.ctx.sessionTitle, undefined)

  const value = await runTool(tools.get('dsh_sessions_list'), {}, supervisorExec(host))

  assert.equal(value.ok, true)
})
//#endregion

//#region 3. 宿主路由：GET / POST /chat
const makeRes = () => {
  const out: any = { code: 0, headers: {}, body: undefined }

  return {
    out,
    writeHead(code: number, headers: any) {
      out.code = code
      out.headers = headers
    },
    end(payload: string) {
      out.body = JSON.parse(payload)
    },
  }
}

const makeReq = (method: string, url: string, body?: string) => {
  const handlers = new Map<string, (chunk?: any) => void>()

  const req: any = {
    method,
    url,
    on(type: string, callback: (chunk?: any) => void) {
      handlers.set(type, callback)

      if (type === 'data' && body !== undefined) queueMicrotask(() => callback(body))
      if (type === 'end') queueMicrotask(() => callback())
    },
  }

  return req
}

const callRoute = async (host: any, req: any) => {
  const res = makeRes()
  const route = host.routes[0]

  assert.notEqual(route, undefined, '没有注册 /dsh-agent-supervisor 路由')
  await route.handler(req, res)

  return res.out
}

test('路由：GET /dsh-agent-supervisor/chat 回管理Bot会话的消息', async () => {
  const { host } = await bootHost({ memoryDir: join(PACKAGE_ROOT, '.tmp', 'memory-route-get') })
  const out = await callRoute(host, makeReq('GET', '/dsh-agent-supervisor/chat'))

  assert.equal(out.code, 200)
  assert.equal(out.body.ok, true)
  assert.equal(out.body.sessionId, 'session-sup')
  assert.equal(out.body.title, '管理Bot')
  assert.deepEqual(out.body.messages, [
    { id: 'seq-2', role: 'user', text: '你好', atMs: 1_700_000_002_000 },
    { id: 'seq-3', role: 'agent', text: '收到', atMs: 1_700_000_003_000 },
  ])
})

test('路由：POST /dsh-agent-supervisor/chat 把 text 发进管理Bot会话', async () => {
  const { host } = await bootHost({ memoryDir: join(PACKAGE_ROOT, '.tmp', 'memory-route-post') })
  const out = await callRoute(host, makeReq('POST', '/dsh-agent-supervisor/chat', JSON.stringify({ text: '下午三点开个会' })))

  assert.equal(out.code, 200)
  assert.equal(out.body.ok, true)
  assert.equal(out.body.sessionId, 'session-sup')
  assert.deepEqual(host.world.sent, [{ sessionId: 'session-sup', text: '下午三点开个会' }])
})

test('路由：没有管理Bot会话时 GET 如实说读不到，不编消息', async () => {
  const host = makeHost()

  host.world.sessions = host.world.sessions.filter((row) => row.id !== 'session-sup')

  const { apply } = await import(pathToFileURL(HOST_FILE).href)

  apply(host.ctx, { memoryDir: join(PACKAGE_ROOT, '.tmp', 'memory-route-none') })

  const out = await callRoute(host, makeReq('GET', '/dsh-agent-supervisor/chat'))

  assert.equal(out.body.ok, false)
  assert.equal(out.body.code, 'NO_SUPERVISOR')
  assert.deepEqual(out.body.messages, [])
})

test('路由：读不到转录时回 TRANSCRIPT_UNAVAILABLE（不是空对话）', async () => {
  const host = makeHost()

  // 管理Bot会话既不在活会话里、也没有任何冷读通道 → 读不到
  host.world.sessions = host.world.sessions.map((row) => (row.id === 'session-sup' ? { ...row, live: false } : row))
  host.ctx.sessionController = undefined
  host.ctx.sessionQuery = undefined

  const { apply } = await import(pathToFileURL(HOST_FILE).href)

  apply(host.ctx, { memoryDir: join(PACKAGE_ROOT, '.tmp', 'memory-route-cold') })

  const out = await callRoute(host, makeReq('GET', '/dsh-agent-supervisor/chat'))

  // 连列表都没有：连管理Bot都找不到 → NO_SUPERVISOR 也是「如实」；重点是别编消息
  assert.equal(out.body.ok, false)
  assert.deepEqual(out.body.messages, [])
})
//#endregion

//#region 4. 客户端：槽位 + 头像
const makeClientHarness = (options: any = {}) => {
  const opened: string[] = []
  const created: string[] = []
  const registered: Array<{ definition: any; component: any }> = []
  const waits: string[] = []

  const snapshot = options.snapshot ?? {
    ids: ['session-sup'],
    byId: {
      'session-sup': { id: 'session-sup', title: '管理Bot', displayTitle: '管理Bot' },
    },
  }

  const sessions: any = {
    list: { getSnapshot: () => snapshot },
    create: async () => {
      const id = 'session-created'

      created.push(id)

      return id
    },
    refresh: async () => undefined,
    retain: () => ({
      ready: Promise.resolve(),
      binding: { session: { rename: async (title: string) => ({ title, seq: 1 }) } },
      release: () => undefined,
    }),
  }

  const ctx: any = {
    slots: {
      inject(name: string, callback: () => unknown) {
        waits.push(name)

        return callback()
      },
      register(definition: any, component: any) {
        registered.push({ definition, component })

        return () => undefined
      },
    },
    sessions,
    uiWorkspace: {
      openSession(id: string) {
        opened.push(id)
      },
    },
  }

  return { ctx, opened, created, registered, waits }
}

/** 走一遍 apply，拿到「已经带好 bridge 的内层组件 + props」。 */
const mountClient = (harness: any) => {
  client.apply(harness.ctx)

  const entry = harness.registered[0]
  const outer = entry.component({}) // apply 里那层包：jsx(AgentBubble, {...props, bridge})

  assert.equal(typeof outer.type, 'function', '注册的组件不是函数')

  return { entry, component: outer.type, props: outer.props }
}

const openPanel = async (harness: any) => {
  const mounted = mountClient(harness)
  const first = renderComponent(mounted.component, mounted.props)
  const avatar = findButtonByText(first, '')

  return { ...mounted, first, avatar }
}

test('客户端：挂在 shell.overlay，组件是函数', () => {
  const harness = makeClientHarness()

  client.apply(harness.ctx)

  assert.deepEqual(harness.waits, ['shell.overlay'])
  assert.equal(harness.registered.length, 1)
  assert.equal(harness.registered[0].definition.name, 'shell.overlay')
  assert.equal(harness.registered[0].definition.id, 'agent-supervisor')
  assert.equal(typeof harness.registered[0].component, 'function')
})

test('客户端：头像是 <img>，src 以 data:image/png;base64, 开头（图标内联成功）', () => {
  const harness = makeClientHarness()
  const mounted = mountClient(harness)
  const element = renderComponent(mounted.component, mounted.props)
  const img = findAll(element, (node) => node.type === 'img')[0]

  assert.notEqual(img, undefined, '没有渲染出头像 <img>')
  assert.equal(typeof img.props.src, 'string')
  assert.ok(img.props.src.startsWith('data:image/png;base64,'), '头像没有内联成 data URL')
  assert.ok(img.props.src.length > 1000, '头像的 base64 太短了，可能没拼进去')
  assert.equal(img.props.alt, '管理Bot Agent')
  assert.equal(classOf(img).includes('dshas_img'), true)

  // 内联的不是随手一段 base64：解出来得是 assets/agent-128.png 那张 PNG
  const bytes = Buffer.from(img.props.src.slice('data:image/png;base64,'.length), 'base64')

  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'base64 解出来不是 PNG')
  assert.equal(bytes.length, readFileSync(join(PACKAGE_ROOT, 'assets', 'agent-128.png')).length, '内联的图和 assets/agent-128.png 不一样大')
})

test('客户端：点头像开面板（标题「管理Bot」+ 输入框），再点收起', async () => {
  const harness = makeClientHarness()

  fetchHandler = () => ({ ok: true, json: async () => ({ ok: true, sessionId: 'session-sup', title: '管理Bot', messages: [] }) })

  const mounted = mountClient(harness)
  const closed = renderComponent(mounted.component, mounted.props)
  const avatar = findAll(closed, (node) => node.type === 'button')[0]

  assert.equal(findMaybeClass(closed, 'dshas_panel'), undefined, '一开始不该有面板')

  await avatar.props.onClick()

  const open = renderComponent(mounted.component, mounted.props, false)

  assert.notEqual(findMaybeClass(open, 'dshas_panel'), undefined, '点了头像没打开面板')
  assert.match(textOf(open), /管理Bot/)
  assert.equal(typeof findInput(open).props.onInput, 'function')

  const closeButton = findButtonByText(open, '')
  const header = findByClass(open, 'dshas_head')

  assert.ok(textOf(header).includes('管理Bot'), '面板头部没有「管理Bot」')

  // 收起：头部那个按钮（标题为空匹配不上，直接按 className 找）
  const closeIcon = findAll(header, (node) => node.type === 'button')[0]

  assert.notEqual(closeIcon, undefined)

  await closeIcon.props.onClick()

  const closedAgain = renderComponent(mounted.component, mounted.props, false)

  assert.equal(findMaybeClass(closedAgain, 'dshas_panel'), undefined, '点了关闭面板还在')

  void closeButton
})

test('客户端：点avatar 再点一次（同一按钮）也收起', async () => {
  const harness = makeClientHarness()

  fetchHandler = () => ({ ok: true, json: async () => ({ ok: true, sessionId: 'session-sup', title: '管理Bot', messages: [] }) })

  const mounted = mountClient(harness)
  const closed = renderComponent(mounted.component, mounted.props)
  const avatar = findAll(closed, (node) => node.type === 'button')[0]

  await avatar.props.onClick()

  const open = renderComponent(mounted.component, mounted.props, false)

  assert.notEqual(findMaybeClass(open, 'dshas_panel'), undefined)

  // 面板开着时头像仍在树上（同一个元素），再点一次应关闭
  const avatarAgain = findButtonByText(open, '')

  await avatarAgain.props.onClick()

  const closedAgain = renderComponent(mounted.component, mounted.props, false)

  assert.equal(findMaybeClass(closedAgain, 'dshas_panel'), undefined)
})

test('客户端：GET /chat 的两条消息渲染成气泡（左 Agent / 右用户）', async () => {
  const harness = makeClientHarness()

  fetchHandler = () => ({
    ok: true,
    json: async () => ({
      ok: true,
      sessionId: 'session-sup',
      title: '管理Bot',
      messages: [
        { id: 'seq-2', role: 'user', text: '你好管理Bot', atMs: 1 },
        { id: 'seq-3', role: 'agent', text: '在，说吧', atMs: 2 },
      ],
    }),
  })

  const mounted = mountClient(harness)
  const closed = renderComponent(mounted.component, mounted.props)

  await findAll(closed, (node) => node.type === 'button')[0].props.onClick()

  const open = renderComponent(mounted.component, mounted.props, false)
  const bubbles = findAll(open, (node) => classOf(node).includes('dshas_bubble'))

  assert.equal(bubbles.length, 2)
  assert.equal(textOf(bubbles[0]), '你好管理Bot')
  assert.equal(classOf(bubbles[0]).includes('dshas_bubble_user'), true)
  assert.equal(textOf(bubbles[1]), '在，说吧')
  assert.equal(classOf(bubbles[1]).includes('dshas_bubble_agent'), true)
  assert.ok(fetchCalls.some((call) => call.url === '/dsh-agent-supervisor/chat' && call.init.method === 'GET'))
})

test('客户端：发消息 → POST /chat 的 body 里带 text', async () => {
  const harness = makeClientHarness()

  fetchCalls.length = 0
  fetchHandler = () => ({ ok: true, json: async () => ({ ok: true, sessionId: 'session-sup', title: '管理Bot', messages: [] }) })

  const mounted = mountClient(harness)
  const closed = renderComponent(mounted.component, mounted.props)

  await findAll(closed, (node) => node.type === 'button')[0].props.onClick()

  let open = renderComponent(mounted.component, mounted.props, false)
  const input = findInput(open)

  input.props.onInput({ target: { value: '把明天的会推到后天' } })

  open = renderComponent(mounted.component, mounted.props, false)

  const send = findButtonByText(open, '发送')

  await send.props.onClick()

  const post = fetchCalls.find((call) => call.init.method === 'POST')

  assert.notEqual(post, undefined, '没有发 POST')
  assert.equal(post!.url, '/dsh-agent-supervisor/chat')
  assert.deepEqual(JSON.parse(post!.init.body), { text: '把明天的会推到后天' })
})

test('客户端：读消息失败 → 可读提示 + 「打开管理Bot会话」退路按钮', async () => {
  const harness = makeClientHarness()

  fetchHandler = () => ({
    ok: true,
    json: async () => ({
      ok: false,
      code: 'TRANSCRIPT_UNAVAILABLE',
      message: '暂时读不到管理Bot会话的内容（宿主这边没有可用的会话读取通道）。',
      sessionId: 'session-sup',
      title: '管理Bot',
      messages: [],
    }),
  })

  const mounted = mountClient(harness)
  const closed = renderComponent(mounted.component, mounted.props)

  await findAll(closed, (node) => node.type === 'button')[0].props.onClick()

  const open = renderComponent(mounted.component, mounted.props, false)

  assert.match(textOf(open), /暂时读不到管理Bot会话的内容/)

  const fallback = findButtonByText(open, '打开管理Bot会话')

  await fallback.props.onClick()

  assert.deepEqual(harness.opened, ['session-sup'])
})

test('客户端：没有管理Bot会话 → 自动建一个（不再让用户手动建）', async () => {
  const harness = makeClientHarness({ snapshot: { ids: [], byId: {} } })

  fetchHandler = () => ({
    ok: true,
    json: async () => ({ ok: false, code: 'NO_SUPERVISOR', message: '还没有「管理Bot」会话：请在侧栏新建一个，并把它命名为 管理Bot。', sessionId: null, title: null, messages: [] }),
  })

  const mounted = mountClient(harness)
  const closed = renderComponent(mounted.component, mounted.props)

  await findAll(closed, (node) => node.type === 'button')[0].props.onClick()

  // 自动新建是 fire-and-forget：把微任务跑干净
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(harness.created, ['session-created'], '打开面板时应当自动新建管理Bot会话')
  assert.deepEqual(harness.opened, [], '自动新建不该把用户弹到别的会话去')
})

test('客户端：拖动 20px → 不打开面板，位置写进 localStorage', async () => {
  const harness = makeClientHarness()

  storage.removeItem('dsh-agent-pos')
  storage.setItem('dsh-agent-pos', JSON.stringify({ x: 600, y: 400 }))
  fetchCalls.length = 0

  const mounted = mountClient(harness)
  const closed = renderComponent(mounted.component, mounted.props)
  const avatar = findAll(closed, (node) => node.type === 'button')[0]

  avatar.props.onPointerDown({ clientX: 1000, clientY: 500 })
  fire('pointermove', { clientX: 1020, clientY: 500 })
  fire('pointerup', {})

  // 浏览器在 pointerup 之后还会派发 click —— 这次必须被吞掉
  avatar.props.onClick()

  const after = renderComponent(mounted.component, mounted.props, false)

  assert.equal(findMaybeClass(after, 'dshas_panel'), undefined, '拖动之后不该打开面板')
  assert.ok(fetchCalls.length === 0, '拖动不该触发任何网络请求')
  assert.deepEqual(JSON.parse(storage.getItem('dsh-agent-pos')!), { x: 620, y: 400 })
})

test('客户端：位移 2px → 当点击处理，面板打开', async () => {
  const harness = makeClientHarness()

  storage.setItem('dsh-agent-pos', JSON.stringify({ x: 600, y: 400 }))
  fetchHandler = () => ({ ok: true, json: async () => ({ ok: true, sessionId: 'session-sup', title: '管理Bot', messages: [] }) })

  const mounted = mountClient(harness)
  const closed = renderComponent(mounted.component, mounted.props)
  const avatar = findAll(closed, (node) => node.type === 'button')[0]

  avatar.props.onPointerDown({ clientX: 1000, clientY: 500 })
  fire('pointermove', { clientX: 1002, clientY: 500 })
  fire('pointerup', {})
  await avatar.props.onClick()

  const after = renderComponent(mounted.component, mounted.props, false)

  assert.notEqual(findMaybeClass(after, 'dshas_panel'), undefined, '2px 的位移不该被当成拖动')
})

test('客户端：位置越界被夹回视口（恢复存储值 / 计算面板盒子）', () => {
  browserWindow.innerWidth = 1280
  browserWindow.innerHeight = 800
  storage.setItem('dsh-agent-pos', JSON.stringify({ x: 99_999, y: -500 }))

  const pos = client.readPos(browserWindow)

  assert.deepEqual(pos, { x: 1280 - 56 - 8, y: 8 })

  const clamped = client.clampPos(-100, 20, { width: 1280, height: 800 })

  assert.deepEqual(clamped, { x: 8, y: 20 })

  // 面板：右下角的头像，面板要落在视口里
  const box = client.panelBoxOf({ x: 1206, y: 726 }, { width: 1280, height: 800 })

  assert.ok(box.x >= 8 && box.x + box.width <= 1272, '面板 x 越界了')
  assert.ok(box.y >= 8 && box.y + box.height <= 792, '面板 y 越界了')

  // 窄屏：宽高跟着视口缩，但仍留在视口内
  const small = client.panelBoxOf({ x: 200, y: 300 }, { width: 360, height: 480 })

  assert.ok(small.width <= 360 - 16)
  assert.ok(small.height <= 480 - 16)
  assert.ok(small.x >= 8 && small.x + small.width <= 352)
  assert.ok(small.y >= 8 && small.y + small.height <= 472)
})

test('客户端：resize 把头克拉回视口', () => {
  storage.setItem('dsh-agent-pos', JSON.stringify({ x: 1000, y: 600 }))

  const harness = makeClientHarness()
  const mounted = mountClient(harness)

  renderComponent(mounted.component, mounted.props)

  browserWindow.innerWidth = 500
  browserWindow.innerHeight = 400
  fire('resize', {})

  const after = renderComponent(mounted.component, mounted.props, false)
  const avatar = findAll(after, (node) => node.type === 'button')[0]

  assert.equal(avatar.props.style.left, '436px') // 500 - 56 - 8
  assert.equal(avatar.props.style.top, '336px') // 400 - 56 - 8

  browserWindow.innerWidth = 1280
  browserWindow.innerHeight = 800
})
//#endregion
