// 一致性地表：客户端**不许自己算**，宿主给什么就画什么。
//
// 这一版之前两边各有一份措辞（宿主 `src/balance.ts` 的 lineOf / ageOf /
// hourlyTextOf，客户端 client.js 抄了一份），这个测试把两份逐字对表。现在余额改成
// 「宿主持有唯一状态 + 客户端拉 `/dsh-balance/current`」，一行字由宿主算好放进
// `line`，客户端那份副本删掉了——所以这里钉的东西跟着变了：
//
//   1. 客户端挂上去之后画出来的文本，**逐字等于**宿主 `lineOf` 的输出；
//   2. 客户端不再按 kind/amount/hours 重算——喂一条和字段互相矛盾的 `line`，它照画；
//   3. 挂载契约（槽位名 / id / order / 信封 id）不变。
//
// 加载的是**真正会被下发给浏览器的那个文件**，不是另抄一份。
//
// 跑：node test/parity.test.ts

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { INITIAL, lineOf as hostLineOf, readingOf } from '../src/balance.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT_FILE = join(HERE, '..', 'client', 'client.js')

/** 客户端信封要求的那层窗口对象；这一句必须在 import 之前挂上。 */
type Registration = { id: string; factory: (require: (name: string) => unknown) => any }

/** 模块只会执行一次（ESM 缓存），所以这里也得只加载一次。 */
let registration: Registration | undefined

const loadEnvelope = async (): Promise<Registration> => {
  if (registration !== undefined) return registration

  ;(globalThis as any).window = {
    __ModuleLoader__: {
      load: (candidate: Registration) => {
        registration = candidate
      },
    },
  }

  await import(pathToFileURL(CLIENT_FILE).href)

  assert.notEqual(registration, undefined, '客户端的 client.js 没有调用 window.__ModuleLoader__.load')

  // 信封的 id 必须等于包名，否则宿主那边的模块图对不上。
  assert.equal(registration!.id, '@zhuobichen/dsh-balance', '客户端信封的 id 要等于包名')

  return registration!
}

/**
 * 用一对最小的 react 桩把组件真跑一遍。
 *
 * `useState` 直接回测试给的这份快照（组件只有这一个 state），`useEffect` 不执行
 * （否则它会去 fetch 真路由），`jsx` 记成一个普通对象——于是「真正画出来的字」
 * 可以逐字检查，而不是只检查导出了什么函数。
 */
const mount = async (snapshot: unknown): Promise<{ client: any; node: any }> => {
  const envelope = await loadEnvelope()
  const react = {
    useState: () => [snapshot, () => {}],
    useEffect: () => {},
  }
  const jsx = (type: string, props: any) => ({ type, props })
  const client = envelope.factory((name: string) => (name === 'react' ? react : { jsx }))

  assert.equal(typeof client.BalanceLine, 'function', '客户端没有导出 BalanceLine 组件')

  return { client, node: client.BalanceLine() }
}

/** 把 jsx 节点摊平成文本。 */
const textOf = (node: any): string => {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')

  return textOf(node?.props?.children)
}

const ANSWER = JSON.stringify({
  is_available: true,
  balance_infos: [{ currency: 'CNY', total_balance: '16.65' }],
})

const AT = 1_700_000_000_000
const MINUTE = 60_000

/** 宿主会放进 `line` 的那批读数（措辞本身由 test/balance.test.ts 钉着）。 */
const readings = () => {
  const ok = readingOf(ANSWER, AT)

  return [
    ['刚装上还没读过', INITIAL],
    ['普通读数', ok],
    ['带时长条', { ...ok, hours: [null, 0.34, 0, null, 5] }],
    ['充值了', { ...ok, hours: [null, 0, 0.34, -15, 5] }],
    ['全是未知', { ...ok, hours: [null, null, null, null, null] }],
    ['刷新失败但留着数字', { ...ok, kind: 'failed' as const, note: 'HTTP 500', hours: [null, null, 1, 2, 3] }],
    ['失败且没数字', { ...INITIAL, kind: 'failed' as const, atMs: AT, note: 'the answer was not JSON' }],
    ['没有密钥', { ...INITIAL, kind: 'no-key' as const, atMs: AT, note: 'no key in ANTHROPIC_AUTH_TOKEN or DEEPSEEK_API_KEY' }],
    ['账户不肯给', { ...INITIAL, kind: 'refused' as const, atMs: AT, note: 'the account reports no available balance' }],
  ] as const
}

describe('客户端只负责显示宿主给的那一行', () => {
  test('画出来的文本逐字等于宿主 lineOf 的输出', async () => {
    for (const [label, reading] of readings()) {
      for (const drift of [0, 20_000, 3 * MINUTE, 42 * MINUTE, 5 * 60 * MINUTE, 30 * 60 * MINUTE]) {
        const now = AT + drift
        const line = hostLineOf(reading as any, now)
        // 这就是 `GET /dsh-balance/current` 的 body：读数字段 + 宿主算好的 line。
        const { node } = await mount({ ...reading, line, ts: now })

        assert.equal(textOf(node), line, `${label}（+${drift}ms）客户端画的和宿主给的不一样`)
      }
    }
  })

  test('不再按 kind/amount/hours 重算：line 和字段矛盾也照画', async () => {
    const line = 'DeepSeek ¥99.99 · 5h ago · 5h 1.00 2.00 3.00 4.00 5.00'
    const { node } = await mount({
      line,
      kind: 'no-key',
      amount: null,
      total: null,
      atMs: 0,
      note: 'no key in ANTHROPIC_AUTH_TOKEN or DEEPSEEK_API_KEY',
      hours: [1, 2, 3, 4, 5],
      ts: AT,
    })

    // 若还在本地重算，这里会变成「DeepSeek balance: no key in …」
    assert.equal(textOf(node), line)
  })

  test('没有可用的一行就不画，不占布局', async () => {
    for (const snapshot of [
      null,
      undefined,
      {},
      { line: null },
      { line: '' },
      { line: 42 },
    ]) {
      const { node } = await mount(snapshot)

      assert.equal(node, null, `快照 ${JSON.stringify(snapshot)} 不该画出东西`)
    }
  })

  test('画出来的那一行还是原来那个节点：dshbl_dock / dshbl_line / role=status', async () => {
    const { node } = await mount({ line: 'DeepSeek ¥16.65 · 3m ago', kind: 'ok', amount: '¥16.65', atMs: AT, hours: [], ts: AT })

    assert.equal(node.type, 'div')
    assert.equal(node.props.className, 'dshbl_dock')

    const inner = node.props.children

    assert.equal(inner.type, 'div')
    assert.equal(inner.props.className, 'dshbl_line')
    assert.equal(inner.props.role, 'status')
  })

  test('客户端里不再有措辞副本（lineOf / ageOf / hourlyTextOf）', async () => {
    const { client } = await mount(null)

    for (const name of ['lineOf', 'ageOf', 'hourlyTextOf']) {
      assert.equal(client[name], undefined, `客户端不该再自带 ${name}：措辞只有宿主那份`)
    }
  })
})

/**
 * 客户端挂载契约。
 *
 * 这一组钉的是「它挂到哪儿、以什么身份挂」——槽位名写错、order 撞号、组件不是函数，
 * 都会表现为「插件明明 active，界面上什么都没有」。浏览器里看不出来，只能在这里钉住。
 */
describe('客户端挂载契约', () => {
  /** 用假的 slots 服务跑一遍 apply，把注册动作抓下来。 */
  const registrationOf = async () => {
    const { client } = await mount(null)

    const registered: { name?: string; id?: string; order?: number; component?: unknown } = {}
    let waitedSlot: string | undefined

    const ctx = {
      slots: {
        inject(name: string, callback: () => void) {
          waitedSlot = name
          callback()
        },
        register(definition: any, component: unknown) {
          registered.name = definition?.name
          registered.id = definition?.id
          registered.order = definition?.order
          registered.component = component

          return () => {}
        },
      },
    }

    client.apply(ctx)

    return { client, registered, waitedSlot }
  }

  test('声明只依赖 slots 服务', async () => {
    const { client } = await mount(null)

    assert.deepEqual(client.inject, ['slots'])
  })

  test('挂在 conversation.input.dock（输入框上沿）', async () => {
    const { registered, waitedSlot } = await registrationOf()

    assert.equal(waitedSlot, 'conversation.input.dock', '等待的槽位名不对')
    assert.equal(registered.name, 'conversation.input.dock', '注册的槽位名不对')
    assert.equal(registered.id, 'balance')
    assert.equal(typeof registered.component, 'function', '注册的组件不是函数')
  })

  test('order 是 15：夹在 goal(10) 和 queue(20) 之间，不撞号', async () => {
    const { registered } = await registrationOf()

    assert.equal(registered.order, 15)
    assert.ok((registered.order as number) > 10, '不该盖在 goal 上面')
    assert.ok((registered.order as number) < 20, '不该和 queue 撞号')
  })
})
