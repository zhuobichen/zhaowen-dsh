/**
 * dsh-balance —— DeepSeek 账户余额，作为输入框上方的一行。
 *
 * 这是 Claude Code 版 `deepseek-balance` mod 的 DSH 移植。原版住在 Claude Code
 * 的 hooks 里，靠 `ui.render/AbovePrompt` 画行；DSH 没有那套 hook，所以换成
 * DSH 自己的三个接缝（每个都是可选的，缺了就退化，不报错）：
 *
 * 1. **宿主状态 + 只读路由** —— 余额是**账户级**的：一个账号一个数。所以宿主
 *    持有唯一的那一份读数（外加算时长条用的采样历史），客户端每 15 秒拉一次
 *    `GET /dsh-balance/current`。状态落盘到 `$DSH_HOME/plugins/dsh-balance/state.json`，
 *    重启后时长条还在。
 *
 *    这里原来用的是**会话投影**（每次读数往当前会话追加一条 `balance/status`
 *    事件，客户端 `useProjection('balance')` 各自读）。账户级的数字放进会话级
 *    的投影，就变成每个对话各存一份「最后一次采样时的快照」——不同对话显示的
 *    金额不一样（本质是读数时间不同）。现在只有一个宿主状态，所有对话同一个数，
 *    新对话也不用等下一拍。
 * 2. **TUI prompt 槽位** —— TUI 组合存在时注册 `${balance}`，加进
 *    `theme.leftPrompt` 就能在 cwd/model 旁边看到。
 * 3. **`/bal` 命令** —— 立刻重读一次，并把结果作为命令输出吐出来。
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

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

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

/** 路由前缀；客户端那半（`dsh-client-ui-balance/client/client.js`）写死了同一个串。 */
const ROUTE = '/dsh-balance'

export const name = 'balance'

/** 可调项；都有缺省值，不配也能跑。 */
export interface Config {
  /** 多久重读一次，毫秒。原版是 5 分钟。 */
  refreshMs?: number
  /** 是否注册 TUI 的 `${balance}` 提示槽位。缺省 true。 */
  tuiPrompt?: boolean
}

/**
 * 落盘的那份读数：一次读数的全部事实，**不含**时长条。
 *
 * 时长条由保留下来的采样现算（`hourlyOf`），这样文件里只需要记「这一刻余额是
 * 多少」，历史怎么切成小时是纯函数的事，改了也不会让老状态读歪。
 */
type StoredReading = Omit<Reading, 'hours'>

/** 宿主内存里（以及 state.json 里）的那份状态：当前读数 + 采样历史。 */
type State = { reading: StoredReading; samples: Sample[] }

/** 插件自己的落盘目录。 */
const stateDirOf = (): string =>
  join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'plugins', 'dsh-balance')

const stateFileOf = (): string => join(stateDirOf(), 'state.json')

/**
 * 落盘状态的校验器：文件是上一个进程写的（也可能是人手改的），形状不对就丢掉
 * 重来，而不是把半个对象带进来——半个对象会一路漏到浏览器里。
 */
const stateSchema = z
  .object({
    reading: z.object({
      kind: z.enum(['pending', 'ok', 'no-key', 'refused', 'failed']),
      amount: z.string().nullable(),
      total: z.number().nullable(),
      atMs: z.number(),
      note: z.string().nullable(),
    }),
    samples: z.array(z.object({ atMs: z.number(), total: z.number() })),
  })
  .nullable()

/** 读上次落盘的状态；读不到、不是 JSON、形状不对都当作「还没读过」。 */
const readState = (): State | null => {
  try {
    const parsed = stateSchema.safeParse(JSON.parse(readFileSync(stateFileOf(), 'utf8')))

    return parsed.success ? (parsed.data as State | null) : null
  } catch {
    return null
  }
}

/**
 * 把状态落盘。
 *
 * 写不进去（只读 home、磁盘满、目录建不出来）只影响「下次启动记不记得」，
 * 这一轮照样有效——所以这里绝不抛：一个余额显示不该把宿主带下来。
 */
const writeState = (state: State): void => {
  try {
    const file = stateFileOf()

    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(state), 'utf8')
  } catch {
    // 见上：丢的只是「重启记不记得」
  }
}

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

  /** 宿主持有的唯一状态：所有对话、所有标签页读的都是它。 */
  let state: State | null = readState()
  /** 一次只跑一个采样：定时器和 `/bal` 可能同时问。 */
  let isSampling = false

  /** 状态 → 线上值：当前读数，时长条按读数时间现算。 */
  const currentReading = (): Reading =>
    state === null ? INITIAL : { ...state.reading, hours: hourlyOf(state.samples, state.reading.atMs) }

  // ---- 接缝 2：TUI 提示槽位（没有 TUI 就静默跳过）----------------------
  const promptHandle = wantsTui
    ? (ctx.get?.('tuiPrompt', false)?.register?.('balance', undefined) ?? undefined)
    : undefined

  /** 上游的 `set` 是别人家的代码：它抛了也不该让一次采样失败。 */
  const showInTui = (reading: Reading): void => {
    try {
      promptHandle?.set?.(lineOf(reading, Date.now()))
    } catch {
      // TUI 槽位坏了就只是那一行不更新
    }
  }

  // 重启之后先把落盘的读数摆到 TUI 那一行上（Web 那边自己拉，不用管）。
  if (state !== null) showInTui(currentReading())

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
   * 把一次读数收进宿主状态：替换当前读数、必要时追加一个采样点、落盘、
   * 顺手刷新 TUI 那一行，然后回答**收进去之后**的读数（含时长条）。
   *
   * 现在没有会话要等：状态在内存里，收是同步的，不用再排微任务去 append。
   */
  const adopt = (next: Reading): Reading => {
    const samples =
      next.kind === 'ok' && typeof next.total === 'number'
        ? withSample(samplesOf(state?.samples), { atMs: next.atMs, total: next.total })
        : samplesOf(state?.samples)

    const { hours, ...reading } = next

    state = { reading, samples }
    writeState(state)

    const current = { ...reading, hours: hourlyOf(samples, reading.atMs) }

    showInTui(current)

    return current
  }

  /** 读一次余额，收进宿主状态，并回答收进去之后的读数。 */
  const sample = async (): Promise<Reading> => {
    // 已经有一次采样在跑：这次就用手上有的，不排队。
    if (isSampling) return currentReading()

    isSampling = true

    try {
      const nowMs = Date.now()
      const previous = currentReading()
      const key = await keyOf()

      if (key === null) {
        return adopt({
          ...INITIAL,
          kind: 'no-key',
          atMs: nowMs,
          note: `no key in ${KEY_VARS.join(' or ')}`,
        })
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
        return adopt({
          kind: 'failed',
          amount: previous.amount,
          total: previous.total,
          atMs: previous.atMs,
          note: next.note,
          hours: [],
        })
      }

      return adopt(next)
    } finally {
      isSampling = false
    }
  }

  /** 后台采样：一次意外不该把进程带走（Node 会为 unhandled rejection 退出）。 */
  const kick = (): void => {
    void sample().catch(() => {
      // 下一拍重来
    })
  }

  // ---- 接缝 1：给客户端的只读路由 ---------------------------------------
  const send = (res: any, status: number, body: unknown): void => {
    const text = JSON.stringify(body)

    try {
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(text),
        'cache-control': 'no-store',
      })
      res.end(text)
    } catch {
      // 连接已经被对端掐了：除了收尾没别的可做，别把异常漏给路由层
      try {
        res.end()
      } catch {
        // 同上
      }
    }
  }

  ctx.inject(['webServer'], (webCtx: any) => {
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'prefix',
          path: ROUTE,
          handler: async (req: any, res: any) => {
            try {
              // `HEAD` 也放行：node:http 自己会把 body 吞掉，客户端只想知道
              // 这一行现在有没有（以及缓存头）。
              if (req.method !== 'GET' && req.method !== 'HEAD') {
                res.writeHead(405)
                res.end()

                return
              }

              const rawPath = String(req.url ?? '/').split('?')[0]
              const path = rawPath.replace(ROUTE, '') || '/'

              if (path !== '/current' && path !== '/') {
                send(res, 404, { error: 'not found' })

                return
              }

              const nowMs = Date.now()
              const reading = currentReading()

              // `line` 由宿主算好：措辞只有一份（`./balance.ts`），客户端照着画。
              // `ts` 是这次回答的时刻，`atMs` 是读数本身的时刻（失败时会更旧）。
              send(res, 200, { ...reading, line: lineOf(reading, nowMs), ts: nowMs })
            } catch (error) {
              send(res, 500, { error: error instanceof Error ? error.message : String(error) })
            }
          },
        }),
      'balance: /dsh-balance route',
    )
  })

  // ---- 接缝 3：/bal 命令 --------------------------------------------
  ctx.inject(['commands'], (commandCtx: any) => {
    commandCtx.commands.register({
      name: 'bal',
      description:
        'DeepSeek balance: read it again now and show what the last answer said (dsh-balance)',
      handler: async () => {
        // sample 回答的是「收进状态之后」的读数（含时长条），直接拿去排版。
        const reading = await sample()

        return { kind: 'success' as const, text: lineOf(reading, Date.now()) }
      },
    })
  })

  // ---- 定时器 ----------------------------------------------------------
  // 启动就先读一次：新对话／新标签页一打开就有数，不用等满一个 refreshMs。
  kick()

  // 之后按 refreshMs 重读。手动 setInterval 而不是 @cordisjs/plugin-timer：
  // 少一个依赖，卸载时 effect 自己清掉。
  const tick = setInterval(kick, refreshMs)

  // 别让这个计时器成为「进程还不退」的唯一理由：unref 只影响进程能不能自然退出，
  // 不影响它按点触发。测试和 `dsh -p` 这类一次性运行都靠这一手。
  ;(tick as any).unref?.()

  ctx.effect(() => () => clearInterval(tick), 'balance refresh timer')
}
