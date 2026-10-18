/**
 * dsh-balance —— DeepSeek 账户余额，作为输入框上方的一行。
 *
 * 这是 Claude Code 版 `deepseek-balance` mod 的 DSH 移植。原版住在 Claude Code
 * 的 hooks 里，靠 `ui.render/AbovePrompt` 画行；DSH 没有那套 hook，所以换成
 * DSH 自己的三个接缝（每个都是可选的，缺了就退化，不报错）：
 *
 * 1. **会话投影**（`balance` key）——每次读数追加一条 `balance/status` 事件，
 *    Web GUI 的客户端插件用 `useProjection('balance')` 读它来画状态条。
 *    投影是回放派生的，所以重启后上一次读数还在。
 * 2. **TUI prompt 槽位** —— TUI 组合存在时注册 `${balance}`，加进
 *    `theme.leftPrompt` 就能在 cwd/model 旁边看到。
 * 3. **`/balance` 命令** —— 立刻重读一次，并把结果作为命令输出吐出来。
 *
 * 与原版的差别（有意为之，写在 README 里）：
 * - 原版用 `ANTHROPIC_BASE_URL` 含不含 "deepseek" 来决定「这条会话该不该显示」。
 *   DSH 里没有这个变量，所以改成「能不能解析到 DeepSeek 的密钥」——解析不到就
 *   显示 no-key 那行，而不是猜。
 * - 密钥走 DSH 自己的 `ctx.credentials`（`$DSH_HOME/.credentials.yaml` + .env），
 *   不是 Claude Code 的 settings.json。
 *
 * 数字、措辞、时长条全在 `./balance.ts` 里，和原版逐字一致（有测试钉着）。
 *
 * @module dsh-balance
 */

import { z } from 'zod'

import {
  BALANCE_URL,
  hourlyOf,
  INITIAL,
  KEY_VARS,
  lineOf,
  readingOf,
  REFRESH_MS,
  samplesOf,
  withSample,
} from './balance.js'
import type { Reading, Sample } from './types.js'

export const name = 'balance'

/** 可调项；都有缺省值，不配也能跑。 */
export interface Config {
  /** 多久重读一次，毫秒。原版是 5 分钟。 */
  refreshMs?: number
  /** 是否注册 TUI 的 `${balance}` 提示槽位。缺省 true。 */
  tuiPrompt?: boolean
}

/**
 * `balance/status` 事件的载荷：一次读数的全部事实，**不含**时长条。
 *
 * 时长条由投影的 `apply` 从保留下来的读数现算——这样日志里只需要记「这一刻
 * 余额是多少」，历史怎么切成小时是纯函数的事，改了也不会让老日志读歪。
 */
type Payload = Omit<Reading, 'hours'>

/** 投影的线上形状：当前读数（含时长条），或 `null` 表示还没有读过。 */
const balanceViewSchema = z
  .object({
    kind: z.enum(['pending', 'ok', 'no-key', 'refused', 'failed']),
    amount: z.string().nullable(),
    total: z.number().nullable(),
    atMs: z.number(),
    note: z.string().nullable(),
    hours: z.array(z.number().nullable()),
  })
  .nullable()

/** 投影内部状态：当前读数 + 用来算时长条的读数历史。 */
type State = { reading: Payload; samples: Sample[] }

/**
 * 把一条 `balance/status` 折进投影。
 *
 * 无关事件必须**原样返回同一个引用**——注册表用 `Object.is` 判定有没有变化，
 * 返回新对象会让下游每一条事件都白跑一遍。
 */
const applyBalance = (state: State | null, event: any): State | null => {
  if (event?.type !== 'balance/status') return state

  const data = event.data as Payload | undefined

  if (data === null || typeof data !== 'object' || typeof data.atMs !== 'number') return state

  // 只有真读到数字的那次读数才进历史：一次失败不该在时长条上留下一个点。
  const samples =
    data.kind === 'ok' && typeof data.total === 'number'
      ? withSample(samplesOf(state?.samples), { atMs: data.atMs, total: data.total })
      : samplesOf(state?.samples)

  return {
    reading: {
      kind: data.kind,
      amount: data.amount ?? null,
      total: data.total ?? null,
      atMs: data.atMs,
      note: data.note ?? null,
    },
    samples,
  }
}

/** 投影 → 线上值：当前读数，时长条按读数时间现算。 */
const viewBalance = (state: State | null): Reading | null =>
  state === null ? null : { ...state.reading, hours: hourlyOf(state.samples, state.reading.atMs) }

/**
 * `credentialRef` 只是给字符串打一个编译期品牌，运行时就是原值。这里不 import
 * `@deepseek-ai/dsh-credentials`，免得凭空多一个运行时依赖。
 */
const credentialRef = (value: string): any => value

/**
 * 装配这个插件。
 * @param ctx - Cordis 上下文。
 * @param config - 插件配置（缺省值见表）。
 */
export function apply(ctx: any, config: Config = {}): void {
  const refreshMs = config.refreshMs ?? REFRESH_MS
  const wantsTui = config.tuiPrompt ?? true

  /** 最近见过事件的会话：定时器得有个地方追加读数。 */
  let activeSession: any
  /** 一次只跑一个采样：定时器和 `/balance` 可能同时问。 */
  let isSampling = false

  // ---- 接缝 1：会话投影 -------------------------------------------------
  ctx.inject(['sessionProjections'], (projectionCtx: any) => {
    projectionCtx.sessionProjections.register({
      key: 'balance',
      schema: balanceViewSchema,
      init: () => null,
      apply: applyBalance,
      view: viewBalance,
      stateVersion: 1,
    })
  })

  // ---- 接缝 2：TUI 提示槽位（没有 TUI 就静默跳过）----------------------
  const promptHandle = wantsTui
    ? (ctx.get?.('tuiPrompt', false)?.register?.('balance', undefined) ?? undefined)
    : undefined

  /** 当前会话的读数，读投影；投影还没注册好时按「还没读」算。 */
  const readingOfSession = (session: any): Reading => {
    if (session === undefined) return INITIAL

    try {
      const snapshot = ctx.get?.('sessionProjections', false)?.snapshot?.(session)

      return (snapshot?.values?.balance as Reading | null | undefined) ?? INITIAL
    } catch {
      return INITIAL
    }
  }

  /** 这条会话的密钥：先问 DSH 的凭据服务，再退回进程环境变量。 */
  const keyOf = async (): Promise<string | null> => {
    const credentials = ctx.get?.('credentials', false)

    if (credentials !== undefined) {
      for (const variable of KEY_VARS) {
        try {
          const resolved = await credentials.resolve(credentialRef(variable))

          if (typeof resolved?.value === 'string' && resolved.value !== '') return resolved.value
        } catch {
          // 这一层没有就试下一个名字
        }
      }
    }

    for (const variable of KEY_VARS) {
      const value = process.env[variable]

      if (typeof value === 'string' && value !== '') return value
    }

    return null
  }

  /**
   * 追加一次读数，等它真的落进日志之后才 resolve。
   *
   * 为什么要等：`session.append` 只能在会话的追加守卫放下之后调用（原来那套
   * 守卫在 session/event 回调期间是按着的），所以真正 append 排在微任务里。而
   * 投影注册表是在 append 内部**同步**驱动的，所以这个 Promise 一 resolve，
   * `snapshot()` 拿到的就已经是折进这条读数之后的值了。`/balance` 的输出靠这个
   * 顺序才拿得到时长条。
   */
  const append = (session: any, payload: Payload): Promise<void> =>
    new Promise<void>((resolve) => {
      if (session === undefined) {
        resolve()

        return
      }

      queueMicrotask(() => {
        try {
          session.append('balance/status', payload)
        } catch {
          // 会话已关或守卫还按着：这次读数丢了，下一拍重来
        }

        // 只在 TUI 槽位在场时更新它；Web 那边走投影，不需要这一手。
        promptHandle?.set?.(lineOf({ ...payload, hours: readingOfSession(session).hours }, Date.now()))
        resolve()
      })
    })

  /** 读一次余额，把结论追加到会话，并回答**折进去之后**的读数。 */
  const sample = async (session: any): Promise<Reading> => {
    if (session === undefined) return INITIAL
    // 已经有一次采样在跑：这次就用手上有的，不排队。
    if (isSampling) return readingOfSession(session)

    isSampling = true

    try {
      const nowMs = Date.now()
      const previous = readingOfSession(session)
      const key = await keyOf()

      if (key === null) {
        await append(session, {
          ...INITIAL,
          kind: 'no-key',
          atMs: nowMs,
          note: `no key in ${KEY_VARS.join(' or ')}`,
        } as Payload)

        return readingOfSession(session)
      }

      let next: Reading

      try {
        const response = await fetch(BALANCE_URL, { headers: { Authorization: `Bearer ${key}` } })
        const body = await response.text()

        next = response.ok ? readingOf(body, nowMs) : { ...INITIAL, kind: 'failed', atMs: nowMs, note: `HTTP ${response.status}` }
      } catch {
        next = { ...INITIAL, kind: 'failed', atMs: nowMs, note: 'the request failed' }
      }

      // 一次失败的刷新绝不擦掉一个好看的数字：保留金额、**它自己的读取时间**
      // 和从那几次读数算出来的时长条，让旁边的 age 自己说明这个数字有多旧，
      // 而不是假装它是刚读的。
      if (next.kind === 'failed' && previous.kind === 'ok') {
        await append(session, {
          kind: 'failed',
          amount: previous.amount,
          total: previous.total,
          atMs: previous.atMs,
          note: next.note,
        })

        return readingOfSession(session)
      }

      const payload = { ...next } as Payload

      delete (payload as any).hours

      await append(session, payload)

      return readingOfSession(session)
    } finally {
      isSampling = false
    }
  }

  // ---- 接缝 3：/balance 命令 --------------------------------------------
  ctx.inject(['commands'], (commandCtx: any) => {
    commandCtx.commands.register({
      name: 'balance',
      description:
        'DeepSeek balance: read it again now and show what the last answer said (dsh-balance)',
      handler: async (invocation: any) => {
        const session = invocation?.agent?.session ?? activeSession
        // sample 回答的是「折进去之后」的读数（含时长条），直接拿去排版。
        const reading = await sample(session)

        return { kind: 'success' as const, text: lineOf(reading, Date.now()) }
      },
    })
  })

  // ---- 会话跟踪 + 定时器 ------------------------------------------------
  ctx.on('session/event', (session: any) => {
    activeSession = session
  })

  ctx.on('session/disposed', (session: any) => {
    if (activeSession === session) activeSession = undefined
  })

  // 会话一开始就先读一次，之后按 refreshMs 重读。手动 setInterval 而不是
  // @cordisjs/plugin-timer：少一个依赖，卸载时 effect 自己清掉。
  ctx.on('agent/session-start', ({ agent }: any) => {
    const session = agent?.session ?? agent

    activeSession = session
    void sample(session)
  })

  const tick = setInterval(() => {
    void sample(activeSession)
  }, refreshMs)

  // 别让这个计时器成为「进程还不退」的唯一理由：unref 只影响进程能不能自然退出，
  // 不影响它按点触发。测试和 `dsh -p` 这类一次性运行都靠这一手。
  ;(tick as any).unref?.()

  ctx.effect(() => () => clearInterval(tick), 'balance refresh timer')
}
