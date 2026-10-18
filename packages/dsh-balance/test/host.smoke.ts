// 装配冒烟：拿**编译后的** lib/index.js 在一个假 Cordis 上下文里真跑一遍。
//
// 纯函数测试证明不了「接缝接对了」——`ctx.inject` 的调用形态、`session.append`
// 的时机、`/balance` 返回的形状，这些只有在真跑的时候才会炸。真装进 profile 之前
// 先把它们按在这里。
//
// 跑：node test/host.smoke.ts

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { apply } from '../lib/index.js'
import { INITIAL, readingOf } from '../src/balance.ts'

const ANSWER = JSON.stringify({
  is_available: true,
  balance_infos: [{ currency: 'CNY', total_balance: '16.65' }],
})

const AT = 1_700_000_000_000

/**
 * 一个够用的假会话：记下被追加了什么，并且**像真注册表那样**把每条事件立刻折进
 * 投影——真实现里 `session.append` 是同步驱动 `session/event` 的，注册表当场折叠，
 * 所以 `/balance` 才能在同一拍里读到刚折进去的值。
 */
const makeSession = (captured: { projection?: any }) => {
  const session: any = {
    appended: [] as { type: string; data: any }[],
    /** 投影里当前的值（模拟注册表的水位缓存）。 */
    projected: null as any,
    __state: null as any,
    append(type: string, data: any) {
      session.appended.push({ type, data })

      if (captured.projection !== undefined) {
        session.__state = captured.projection.apply(session.__state, { type, data })
        session.projected = captured.projection.view(session.__state)
      }
    },
  }

  return session
}

/** 一个够用的假上下文：只实现这个插件真正用到的几个成员。 */
const makeCtx = () => {
  const captured: { projection?: any; command?: any } = {}
  let credential: string | undefined

  const services: any = {
    sessionProjections: {
      register(definition: any) {
        captured.projection = definition

        return () => {}
      },
      snapshot(session: any) {
        return { values: { balance: session.projected ?? null } }
      },
    },
    commands: {
      register(definition: any) {
        captured.command = definition

        return () => {}
      },
    },
    credentials: {
      async resolve() {
        return credential === undefined ? undefined : { value: credential, source: 'test' }
      },
    },
  }

  const ctx: any = {
    inject(names: string[], callback: (scope: any) => void) {
      const scope: any = { get: ctx.get }

      for (const name of names) {
        if (services[name] === undefined) return
        scope[name] = services[name]
      }

      callback(scope)
    },
    get(name: string, fallback?: unknown) {
      return services[name] ?? fallback
    },
    on() {
      return () => {}
    },
    effect(fn: () => () => void) {
      fn()
    },
  }

  return {
    ctx,
    captured,
    makeSession: () => makeSession(captured),
    setCredential: (value: string | undefined) => {
      credential = value
    },
  }
}

/** 等一拍微任务：append 是在 queueMicrotask 里做的。 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

describe('装配起来之后', () => {
  test('注册了 balance 投影、/balance 命令', () => {
    const { ctx, captured } = makeCtx()

    apply(ctx, { refreshMs: 3_600_000 })

    assert.notEqual(captured.projection, undefined, '没有注册会话投影')
    assert.equal(captured.projection.key, 'balance')
    assert.equal(typeof captured.projection.apply, 'function')
    assert.equal(typeof captured.projection.view, 'function')
    assert.notEqual(captured.command, undefined, '没有注册 /balance 命令')
    assert.equal(captured.command.name, 'balance')
    assert.ok(captured.command.description.length > 0)
  })
})

describe('/balance 命令', () => {
  test('拿到密钥就把金额说出来', async () => {
    const { ctx, captured, setCredential, makeSession } = makeCtx()
    const session = makeSession()

    setCredential('sk-test')

    const originalFetch = globalThis.fetch

    globalThis.fetch = (async () => ({ ok: true, status: 200, text: async () => ANSWER })) as any

    try {
      apply(ctx, { refreshMs: 3_600_000 })

      const result = await captured.command.handler({ agent: { session } })

      assert.equal(result.kind, 'success')
      assert.match(result.text, /¥16\.65/)

      // 读数要落成一条事件，Web 那边的投影才有东西可折
      await settle()
      assert.equal(session.appended.length, 1)
      assert.equal(session.appended[0].type, 'balance/status')
      assert.equal(session.appended[0].data.kind, 'ok')
      assert.equal(session.appended[0].data.total, 16.65)
      // 载荷里不该带 hours：那是投影现算的
      assert.equal('hours' in session.appended[0].data, false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('没有密钥时点名它找过的变量', async () => {
    const { ctx, captured, setCredential, makeSession } = makeCtx()
    const session = makeSession()
    const savedToken = process.env.ANTHROPIC_AUTH_TOKEN
    const savedKey = process.env.DEEPSEEK_API_KEY

    delete process.env.ANTHROPIC_AUTH_TOKEN
    delete process.env.DEEPSEEK_API_KEY
    setCredential(undefined)

    try {
      apply(ctx, { refreshMs: 3_600_000 })

      const result = await captured.command.handler({ agent: { session } })

      assert.match(result.text, /DEEPSEEK_API_KEY/)
      await settle()
      assert.equal(session.appended[0].data.kind, 'no-key')
    } finally {
      if (savedToken !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = savedToken
      if (savedKey !== undefined) process.env.DEEPSEEK_API_KEY = savedKey
    }
  })

  test('HTTP 失败时说状态码，不编一个数字', async () => {
    const { ctx, captured, setCredential, makeSession } = makeCtx()
    const session = makeSession()

    setCredential('sk-test')

    const originalFetch = globalThis.fetch

    globalThis.fetch = (async () => ({ ok: false, status: 402, text: async () => '' })) as any

    try {
      apply(ctx, { refreshMs: 3_600_000 })

      const result = await captured.command.handler({ agent: { session } })

      assert.match(result.text, /HTTP 402/)
      await settle()
      assert.equal(session.appended[0].data.kind, 'failed')
      assert.equal(session.appended[0].data.amount, null)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('一次失败不擦掉上一次的好数字', async () => {
    const { ctx, captured, setCredential, makeSession } = makeCtx()
    const session = makeSession()

    setCredential('sk-test')
    // 会话已经有一次好读数（投影里存着）
    session.projected = readingOf(ANSWER, AT)

    const originalFetch = globalThis.fetch

    globalThis.fetch = (async () => ({ ok: false, status: 500, text: async () => '' })) as any

    try {
      apply(ctx, { refreshMs: 3_600_000 })

      const result = await captured.command.handler({ agent: { session } })

      // 金额还在，age 用的是**上一次读取的时间**，并说明这次刷新失败了
      assert.match(result.text, /¥16\.65/)
      assert.match(result.text, /refresh failed: HTTP 500/)
      await settle()
      assert.equal(session.appended[0].data.amount, '¥16.65')
      assert.equal(session.appended[0].data.atMs, AT)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('投影的折叠', () => {
  test('无关事件原样返回，同一个引用', () => {
    const { ctx, captured } = makeCtx()

    apply(ctx, { refreshMs: 3_600_000 })

    const state = { reading: INITIAL, samples: [] }

    assert.equal(captured.projection.apply(state, { type: 'turn/start', data: {} }), state)
  })

  test('读数落进去之后，view 给出带时长条的读数', () => {
    const { ctx, captured } = makeCtx()

    apply(ctx, { refreshMs: 3_600_000 })

    let state = captured.projection.init()

    assert.equal(state, null)

    // 时长条是按**整点**切的，而且「现在」是**最后一条读数的时间**。所以样本
    // 要贴着整点摆：最新一条落在本小时里（EDGE+5m），上一条落在上一小时末尾
    // （EDGE-10m），再上一条落在上一小时的开头（EDGE-70m）。原版测试就是这个摆法。
    const EDGE = Math.floor(AT / (60 * 60_000)) * (60 * 60_000)

    const fold = (atMs: number, total: number) => {
      state = captured.projection.apply(state, {
        type: 'balance/status',
        data: { kind: 'ok', amount: `¥${total.toFixed(2)}`, total, atMs, note: null },
      })
    }

    fold(EDGE - 70 * 60_000, 25)
    fold(EDGE - 10 * 60_000, 20)
    fold(EDGE + 5 * 60_000, 17.5)

    const view = captured.projection.view(state)

    assert.equal(view.kind, 'ok')
    assert.equal(view.amount, '¥17.50')
    assert.equal(view.hours.length, 5)
    // 上一整小时：开头 25，结尾 20 → 花了 5.00
    assert.equal(view.hours.at(-1), 5)

    // schema 也得认这个形状
    assert.equal(captured.projection.schema.safeParse(view).success, true)
  })

  test('再读一次就多一个点，时长条跟着走', () => {
    const { ctx, captured } = makeCtx()

    apply(ctx, { refreshMs: 3_600_000 })

    const EDGE = Math.floor(AT / (60 * 60_000)) * (60 * 60_000)
    let state = captured.projection.init()

    const fold = (atMs: number, total: number) => {
      state = captured.projection.apply(state, {
        type: 'balance/status',
        data: { kind: 'ok', amount: `¥${total.toFixed(2)}`, total, atMs, note: null },
      })
    }

    fold(EDGE - 70 * 60_000, 25)
    fold(EDGE - 10 * 60_000, 20)
    fold(EDGE, 17.5)

    const view = captured.projection.view(state)

    // 现在 EDGE 这个时刻有读数了，它替掉了「上一小时的结尾」→ 25 − 17.5
    assert.equal(view.amount, '¥17.50')
    assert.equal(view.hours.at(-1), 7.5)
  })

  test('失败的读数不进时长条的历史', () => {
    const { ctx, captured } = makeCtx()

    apply(ctx, { refreshMs: 3_600_000 })

    let state = captured.projection.init()

    state = captured.projection.apply(state, {
      type: 'balance/status',
      data: { kind: 'failed', amount: null, total: null, atMs: AT, note: 'the request failed' },
    })

    assert.equal(state.samples.length, 0)
    assert.equal(captured.projection.view(state).kind, 'failed')
  })
})
