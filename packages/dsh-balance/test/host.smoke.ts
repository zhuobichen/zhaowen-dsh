// 装配冒烟：拿**编译后的** lib/index.js 在一个假 Cordis 上下文里真跑一遍。
//
// 纯函数测试证明不了「接缝接对了」——`ctx.inject` 的调用形态、路由注册的形状、
// 命令返回的文本、失败时状态怎么走，这些只有在真跑的时候才会炸。真装进 profile
// 之前先把它们按在这里。
//
// 这一版的接缝变了：余额从「会话投影」改成「宿主持有唯一状态 + GET
// /dsh-balance/current」。所以这里断言的是：
//
//   1. 注册了 webServer 的 `/dsh-balance` 前缀路由（`/current` 由它接）；
//      并且**不再**去要 sessionProjections 服务；
//   2. 路由 handler 回 200，body 带 line / amount / hours / ts，且 no-store；
//   3. `/bal` 命令仍注册，仍「立刻重读一次并返回文本」；
//   4. 刷新失败保留上一次好数字（用假 fetch）。
//
// 跑：node test/host.smoke.ts

import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply } from '../lib/index.js'

const ANSWER = JSON.stringify({
  is_available: true,
  balance_infos: [{ currency: 'CNY', total_balance: '16.65' }],
})

/**
 * 每个用例一个自己的 DSH_HOME：落盘状态不许互相串味（也**不许**写进真 home）。
 *
 * 放在包自己的 `.tmp/` 下而不是系统临时目录：有些机器上（本机就是）系统 Temp
 * 对当前用户不可写，`mkdtemp` 直接 EPERM，测试会死在准备阶段而不是断言上。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const TMP = join(HERE, '..', '.tmp')

mkdirSync(TMP, { recursive: true })

const ROOT = mkdtempSync(join(TMP, 'smoke-'))
const SAVED_HOME = process.env.DSH_HOME
const SAVED_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN
const SAVED_KEY = process.env.DEEPSEEK_API_KEY

let homeSeq = 0

const freshHome = (): string => {
  homeSeq += 1

  const home = join(ROOT, `home-${homeSeq}`)

  process.env.DSH_HOME = home

  return home
}

/**
 * 递归删目录。
 *
 * 这台机器上 `fs.rmSync(..., { recursive: true })` 会**静默不删**（不抛错、也不
 * 删掉，目录原地不动），所以这里自己 readdir + unlink + rmdir。删不掉最多留一堆
 * `.tmp/`（已 gitignore），不该让测试变红。
 */
const removeTree = (target: string): void => {
  let entries: any[] = []

  try {
    entries = readdirSync(target, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const full = join(target, entry.name)

    if (entry.isDirectory()) {
      removeTree(full)

      continue
    }

    try {
      unlinkSync(full)
    } catch {
      // 删不掉就算了
    }
  }

  try {
    rmdirSync(target)
  } catch {
    // 同上
  }
}

after(() => {
  removeTree(ROOT)

  if (SAVED_HOME === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = SAVED_HOME

  if (SAVED_TOKEN !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = SAVED_TOKEN
  if (SAVED_KEY !== undefined) process.env.DEEPSEEK_API_KEY = SAVED_KEY
})

/** 一个够用的假上下文：只实现这个插件真正用到的几个成员。 */
const makeCtx = (options: { webServer?: boolean } = {}) => {
  const captured: { route?: any; command?: any; injected: string[][] } = { injected: [] }
  let credential: string | undefined

  const services: any = {
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

  // 只有装了 web 的 profile 才有这个服务：TUI/无头 profile 里整段接缝必须消失
  if (options.webServer !== false) {
    services.webServer = {
      register(route: any) {
        captured.route = route

        return () => {}
      },
    }
  }

  const ctx: any = {
    inject(names: string[], callback: (scope: any) => void) {
      captured.injected.push([...names])

      // 真 Cordis 的 inject 作用域是个子上下文：`get` / `effect` 都在上面
      const scope: any = { get: ctx.get, effect: ctx.effect }

      for (const name of names) {
        // 没有这个服务的接缝就整段跳过——和真 Cordis 一样
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
    setCredential: (value: string | undefined) => {
      credential = value
    },
  }
}

/** 假响应：把状态码 / 头 / body 记下来，供断言。 */
const makeRes = () => {
  const state = { status: 0, headers: {} as Record<string, string>, body: '', ended: false }

  const res: any = {
    writeHead(status: number, headers?: Record<string, string>) {
      state.status = status
      if (headers !== undefined) Object.assign(state.headers, headers)

      return res
    },
    end(text?: string) {
      state.body = typeof text === 'string' ? text : ''
      state.ended = true
    },
  }

  return { res, state }
}

/**
 * 真的走一遍路由 handler：`webServer` 的 prefix 匹配已经保证只有前缀下的请求会进来。
 *
 * `req` 可以让调用方自己给一个完整对象（例如一个读 `url` 就抛的请求）——这里不用
 * 对象展开，否则 getter 在**测试**里就先炸了，测不到 handler 自己的兜底。
 */
const callRoute = async (route: any, request: any = {}) => {
  const { res, state } = makeRes()
  const req = request.req ?? { method: request.method ?? 'GET', url: request.url ?? '/dsh-balance/current' }

  await route.handler(req, res)

  return state
}

/** 等到条件成立（初始采样是后台跑的，不能假设它已经落地）。 */
const until = async (ready: () => boolean, label: string): Promise<void> => {
  for (let i = 0; i < 200; i += 1) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }

  assert.fail(`等不到：${label}`)
}

/** 换掉全局 fetch，跑完恢复。 */
const withFetch = async <T>(impl: any, run: () => Promise<T>): Promise<T> => {
  const original = globalThis.fetch

  globalThis.fetch = impl

  try {
    return await run()
  } finally {
    globalThis.fetch = original
  }
}

const answering = (body: string, status = 200) =>
  (async () => ({ ok: status >= 200 && status < 300, status, text: async () => body })) as any

const bodyOf = (state: any): any => JSON.parse(state.body)

/** 一直问路由，直到 body 满足条件（初始采样是后台跑的）。 */
const bodyUntil = async (route: any, ready: (body: any) => boolean): Promise<any> => {
  for (let i = 0; i < 200; i += 1) {
    const state = await callRoute(route)
    const body = state.status === 200 ? bodyOf(state) : null

    if (body !== null && ready(body)) return body

    await new Promise((resolve) => setTimeout(resolve, 2))
  }

  assert.fail('等不到路由 body 就绪')
}

/**
 * 等启动时那一拍采样落地。
 *
 * `/bal` 的并发语义是**不排队**：已经有一次采样在跑时，它回答当前持有的读数
 * （旧版本就是这么合并并发的，这里不变）。所以测试要先等启动那一拍收好，再去
 * 敲命令——否则读到的是 `pending`（reading…），而不是命令自己的那次读数。
 */
const awaitFirstReading = async (route: any): Promise<void> => {
  await bodyUntil(route, (one) => one.kind !== 'pending')
}

/** 抹掉「3m ago / just now」这一段：两次读数只差几微秒，跨分钟边界时会抖。 */
const withoutAge = (line: string): string => line.replace(/ · (?:just now|\d+[mhd] ago)/, ' · <age>')

describe('装配起来之后', () => {
  test('注册了 webServer 的 /dsh-balance 前缀路由，`/current` 由它接', async () => {
    freshHome()

    const { ctx, captured, setCredential } = makeCtx()

    setCredential('sk-test')

    await withFetch(answering(ANSWER), async () => {
      apply(ctx, { refreshMs: 3_600_000 })

      assert.notEqual(captured.route, undefined, '没有注册 webServer 路由')
      assert.equal(captured.route.kind, 'prefix')
      // 真 webServer 的 prefix 匹配是「等于前缀」或「前缀 + /」，所以
      // `/dsh-balance/current` 落进这个 handler 里。
      assert.equal(captured.route.path, '/dsh-balance')
      assert.equal(typeof captured.route.handler, 'function')

      const current = await callRoute(captured.route, { url: '/dsh-balance/current' })

      assert.equal(current.status, 200)

      const elsewhere = await callRoute(captured.route, { url: '/dsh-balance/other' })

      assert.equal(elsewhere.status, 404)
    })
  })

  test('不再去要 sessionProjections 服务', async () => {
    freshHome()

    const { ctx, captured, setCredential } = makeCtx()

    setCredential('sk-test')

    await withFetch(answering(ANSWER), async () => {
      apply(ctx, { refreshMs: 3_600_000 })
      await until(() => captured.route !== undefined, '路由注册')

      const asked = captured.injected.flat()

      assert.equal(asked.includes('sessionProjections'), false, '不该再注册会话投影')
      assert.ok(asked.includes('webServer'), '应该要 webServer')
      assert.ok(asked.includes('commands'), '应该要 commands')
    })
  })

  test('没有 webServer（TUI / 无头 profile）也照常跑：路由消失，命令还能用', async () => {
    freshHome()

    const { ctx, captured, setCredential } = makeCtx({ webServer: false })

    setCredential('sk-test')

    await withFetch(answering(ANSWER), async () => {
      apply(ctx, { refreshMs: 3_600_000 })
      await until(() => captured.command !== undefined, '命令注册')

      // 没有路由可读，就用命令把第一拍采样等出来（并发期间它会回答 reading…）
      let text = ''

      for (let i = 0; i < 100; i += 1) {
        text = (await captured.command.handler({})).text

        if (!/reading/.test(text)) break

        await new Promise((resolve) => setTimeout(resolve, 2))
      }

      assert.match(text, /¥16\.65/)
    })

    assert.equal(captured.route, undefined, '没有 webServer 就不该注册路由')
  })

  test('refreshMs 配置决定自动重读的间隔（缺省 5 分钟）', async () => {
    freshHome()

    delete process.env.ANTHROPIC_AUTH_TOKEN
    delete process.env.DEEPSEEK_API_KEY

    const original = globalThis.setInterval
    const delays: number[] = []

    globalThis.setInterval = ((fn: any, ms?: number) => {
      delays.push(Number(ms))

      return original(fn, ms)
    }) as any

    try {
      const configured = makeCtx()

      apply(configured.ctx, { refreshMs: 1234 })

      const byDefault = makeCtx()

      apply(byDefault.ctx)
    } finally {
      globalThis.setInterval = original
    }

    assert.equal(delays[0], 1234, '配置值没被用上')
    assert.equal(delays[1], 5 * 60 * 1000, '缺省应该是 5 分钟')
  })

  test('/bal 命令仍注册，描述还在', async () => {
    freshHome()

    const { ctx, captured } = makeCtx()

    delete process.env.ANTHROPIC_AUTH_TOKEN
    delete process.env.DEEPSEEK_API_KEY

    apply(ctx, { refreshMs: 3_600_000 })

    assert.notEqual(captured.command, undefined, '没有注册 /bal 命令')
    assert.equal(captured.command.name, 'bal')
    assert.ok(captured.command.description.length > 0)
  })
})

describe('/dsh-balance/current', () => {
  test('返回 200，body 带 line / amount，且 no-store', async () => {
    freshHome()

    const { ctx, captured, setCredential } = makeCtx()

    setCredential('sk-test')

    await withFetch(answering(ANSWER), async () => {
      apply(ctx, { refreshMs: 3_600_000 })

      // 初始采样是后台的：等它把数字收进宿主状态，再从路由读回来
      const body = await bodyUntil(captured.route, (one) => typeof one.amount === 'string')
      const state = await callRoute(captured.route)

      assert.equal(state.status, 200)
      assert.equal(body.amount, '¥16.65')
      assert.equal(body.total, 16.65)
      assert.equal(body.kind, 'ok')
      assert.equal(typeof body.line, 'string')
      assert.match(body.line, /¥16\.65/)
      assert.equal(Array.isArray(body.hours), true)
      assert.equal(typeof body.ts, 'number')
      assert.equal(state.headers['cache-control'], 'no-store')
      assert.match(state.headers['content-type'] ?? '', /application\/json/)
    })
  })

  test('命令和路由读的是同一份宿主状态', async () => {
    freshHome()

    const { ctx, captured, setCredential } = makeCtx()

    setCredential('sk-test')

    await withFetch(answering(ANSWER), async () => {
      apply(ctx, { refreshMs: 3_600_000 })
      await until(() => captured.command !== undefined, '命令注册')
      await awaitFirstReading(captured.route)

      // `/bal` 是「立刻重读一次」的同步等待入口：它回来了，状态就一定收好了
      const result = await captured.command.handler({})

      assert.equal(result.kind, 'success')
      assert.match(result.text, /¥16\.65/)

      const body = bodyOf(await callRoute(captured.route))

      assert.equal(body.kind, 'ok')
      assert.match(body.amount, /¥16\.65/)
      // 命令和路由说的是同一件事（只把 age 抹平：两次读数隔着几个微秒，
      // 正好跨过一分钟边界时「3m ago / 4m ago」会抖一下，那是时钟不是状态）
      assert.equal(withoutAge(body.line), withoutAge(result.text))
    })
  })

  test('方法不是 GET/HEAD → 405，没有 body', async () => {
    freshHome()

    const { ctx, captured } = makeCtx()

    delete process.env.ANTHROPIC_AUTH_TOKEN
    delete process.env.DEEPSEEK_API_KEY

    apply(ctx, { refreshMs: 3_600_000 })
    await until(() => captured.route !== undefined, '路由注册')

    const state = await callRoute(captured.route, { method: 'POST' })

    assert.equal(state.status, 405)
    assert.equal(state.body, '')
  })

  test('HEAD 也放行（客户端只想知道有没有、以及缓存头）', async () => {
    freshHome()

    const { ctx, captured } = makeCtx()

    delete process.env.ANTHROPIC_AUTH_TOKEN
    delete process.env.DEEPSEEK_API_KEY

    apply(ctx, { refreshMs: 3_600_000 })
    await until(() => captured.route !== undefined, '路由注册')

    const state = await callRoute(captured.route, { method: 'HEAD' })

    assert.equal(state.status, 200)
    assert.equal(state.headers['cache-control'], 'no-store')
  })

  test('handler 里出异常 → 500，body 带 error', async () => {
    freshHome()

    const { ctx, captured } = makeCtx()

    delete process.env.ANTHROPIC_AUTH_TOKEN
    delete process.env.DEEPSEEK_API_KEY

    apply(ctx, { refreshMs: 3_600_000 })
    await until(() => captured.route !== undefined, '路由注册')

    // `req.url` 一读就炸：异常必须变成 500 + error，而不是一个挂住的连接
    const state = await callRoute(captured.route, {
      req: {
        method: 'GET',
        get url(): string {
          throw new Error('boom')
        },
      },
    })

    assert.equal(state.status, 500)
    assert.equal(bodyOf(state).error, 'boom')
    assert.equal(state.headers['cache-control'], 'no-store')
  })
})

describe('/bal 命令', () => {
  test('拿到密钥就把金额说出来，并且写进宿主状态', async () => {
    freshHome()

    const { ctx, captured, setCredential } = makeCtx()

    setCredential('sk-test')

    await withFetch(answering(ANSWER), async () => {
      apply(ctx, { refreshMs: 3_600_000 })
      await until(() => captured.command !== undefined, '命令注册')
      await awaitFirstReading(captured.route)

      const result = await captured.command.handler({ agent: { session: {} } })

      assert.equal(result.kind, 'success')
      assert.match(result.text, /¥16\.65/)

      const body = bodyOf(await callRoute(captured.route))

      assert.equal(body.kind, 'ok')
      assert.equal(body.total, 16.65)
    })
  })

  test('没有密钥时点名它找过的变量', async () => {
    freshHome()

    const { ctx, captured, setCredential } = makeCtx()

    delete process.env.ANTHROPIC_AUTH_TOKEN
    delete process.env.DEEPSEEK_API_KEY
    setCredential(undefined)

    apply(ctx, { refreshMs: 3_600_000 })
    await until(() => captured.command !== undefined, '命令注册')
    await awaitFirstReading(captured.route)

    const result = await captured.command.handler({})

    assert.match(result.text, /DEEPSEEK_API_KEY/)
    assert.match(result.text, /ANTHROPIC_AUTH_TOKEN/)

    const body = bodyOf(await callRoute(captured.route))

    assert.equal(body.kind, 'no-key')
    assert.equal(body.amount, null)
  })

  test('HTTP 失败时说状态码，不编一个数字', async () => {
    freshHome()

    const { ctx, captured, setCredential } = makeCtx()

    setCredential('sk-test')

    await withFetch(answering('', 402), async () => {
      apply(ctx, { refreshMs: 3_600_000 })
      await until(() => captured.command !== undefined, '命令注册')
      await awaitFirstReading(captured.route)

      const result = await captured.command.handler({})

      assert.match(result.text, /HTTP 402/)

      const body = bodyOf(await callRoute(captured.route))

      assert.equal(body.kind, 'failed')
      assert.equal(body.amount, null)
    })
  })

  test('一次失败不擦掉上一次的好数字（假 fetch）', async () => {
    freshHome()

    const { ctx, captured, setCredential } = makeCtx()

    setCredential('sk-test')

    // 第一次读成功
    await withFetch(answering(ANSWER), async () => {
      apply(ctx, { refreshMs: 3_600_000 })
      await until(() => captured.command !== undefined, '命令注册')
      await awaitFirstReading(captured.route)

      const first = await captured.command.handler({})

      assert.match(first.text, /¥16\.65/)
    })

    const firstBody = bodyOf(await callRoute(captured.route))

    assert.equal(firstBody.kind, 'ok')

    // 第二次读失败
    await withFetch(answering('', 500), async () => {
      const result = await captured.command.handler({})

      // 金额还在，age 用的是**上一次读取的时间**，并说明这次刷新失败了
      assert.match(result.text, /¥16\.65/)
      assert.match(result.text, /refresh failed: HTTP 500/)

      const body = bodyOf(await callRoute(captured.route))

      assert.equal(body.kind, 'failed')
      assert.equal(body.amount, '¥16.65')
      assert.equal(body.atMs, firstBody.atMs, '失败不该把读数的时刻往前推')
      assert.equal(body.note, 'HTTP 500')
    })
  })
})
