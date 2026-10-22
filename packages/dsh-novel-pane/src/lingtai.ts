// 灵台阅读器（lingtai-reader）的宿主侧胶水：探测、拉起、等它起来。
//
// 它是另一个独立 web app（python 标准库 http.server，零第三方依赖），端口默认
// 8769（`server/app.py` 里 `port = 8769`，可被 `sys.argv[1]` 覆盖）。这里只负责
// 「确保它在跑」，**不碰它自己的代码**。
//
// 目录没有缺省值：不在代码里写死别人机器上的绝对路径。取 `lingtai.dir`，没有就取
// `process.env.LINGTAI_DIR`；两者都没有时给一条能照着做的错误。示例（本机实际
// 位置，仅注释、不作为缺省）：
//   lingtai.dir: 'D:\\github_project\\ZhaoWen_GitHub维护\\lingtai-reader'
//
// 测试不真起进程：`setLingTaiProbeForTests` / `setLingTaiSpawnForTests` 两个注入口
// 把探测与 spawn 换掉，路由那条链照样能整条跑。

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'

/** 灵台阅读器的配置（`config.lingtai`）。 */
export interface LingtaiConfig {
  /** lingtai-reader 的目录（里面有 server.py）。缺省取 `process.env.LINGTAI_DIR`。 */
  dir?: string
  /** 端口。缺省 8769（与 lingtai-reader/server/app.py 一致）。 */
  port?: number
  /** python 可执行文件。缺省 `python`。 */
  python?: string
  /** 【测试 / 排错用】等它起来的总时长（毫秒）。缺省 12000。 */
  timeoutMs?: number
  /** 【测试 / 排错用】轮询探测的间隔（毫秒）。缺省 250。 */
  pollMs?: number
  /** 【测试 / 排错用】单次 TCP 探测超时（毫秒）。缺省 800。 */
  probeTimeoutMs?: number
}

export const DEFAULT_LINGTAI_PORT = 8769
export const DEFAULT_LINGTAI_PYTHON = 'python'
export const DEFAULT_LINGTAI_TIMEOUT_MS = 12_000
export const DEFAULT_LINGTAI_POLL_MS = 250
export const DEFAULT_LINGTAI_PROBE_TIMEOUT_MS = 800

/** 启动入口；lingtai-reader 的 README 也写的是 `python server.py`。 */
export const LINGTAI_SERVER_FILE = 'server.py'

/** 探测函数：哪怕监听地址是 0.0.0.0，这里也连回环地址。 */
export type LingTaiProbe = (host: string, port: number, timeoutMs: number) => Promise<boolean>

/** spawn 函数：与 `node:child_process.spawn` 同形，测试里整条换掉。 */
export type LingTaiSpawn = (command: string, args: string[], options: Record<string, unknown>) => any

let injectedProbe: LingTaiProbe | null = null
let injectedSpawn: LingTaiSpawn | null = null

/** 测试用：换掉 TCP 探测；传 null 还原。 */
export const setLingTaiProbeForTests = (probe: LingTaiProbe | null): void => {
  injectedProbe = probe
}

/** 测试用：换掉 spawn（**测试里绝不真起 python**）；传 null 还原。 */
export const setLingTaiSpawnForTests = (spawner: LingTaiSpawn | null): void => {
  injectedSpawn = spawner
}

/** 缺省探测：TCP 连一下 127.0.0.1:port，连上就算在跑。 */
export const probeTcp = (host: string, port: number, timeoutMs: number): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (running: boolean): void => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch {
        // 已经关了
      }
      resolve(running)
    }
    let socket: ReturnType<typeof connect>

    try {
      socket = connect({ host, port })
    } catch {
      resolve(false)

      return
    }

    socket.setTimeout(Math.max(1, timeoutMs))
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })

const probeOf = (): LingTaiProbe => injectedProbe ?? probeTcp

const spawnOf = (): LingTaiSpawn => injectedSpawn ?? (spawn as unknown as LingTaiSpawn)

/** 端点的解析结果：只跟端口 / python 有关，不需要 dir（GET 状态只要它）。 */
export interface LingTaiEndpoint {
  port: number
  python: string
  /** 给浏览器打开的地址（与 lingtai-reader 自己的提示一致：localhost）。 */
  url: string
  timeoutMs: number
  pollMs: number
  probeTimeoutMs: number
}

/** 失败回执；`ok:false` 一律不抛，交给路由变成 JSON。 */
export interface LingTaiFailure {
  ok: false
  launched: boolean
  code: string
  message: string
  /** 起来失败时也可能已经知道地址（比如超时），客户端可以拿它当「新标签打开」的退路。 */
  url?: string
}

export type LingTaiResult = { ok: true; launched: boolean; url: string } | LingTaiFailure

export type LingTaiStatus = { ok: true; running: boolean; url: string } | (LingTaiFailure & { running: false })

const positive = (value: unknown, fallback: number): number => {
  const number = Number(value)

  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}

const portOf = (value: unknown): number => {
  const number = Number(value)

  if (!Number.isInteger(number) || number < 1 || number > 65_535) return DEFAULT_LINGTAI_PORT

  return number
}

export const lingTaiEndpointOf = (config: LingtaiConfig = {}): LingTaiEndpoint => {
  const port = portOf(config.port)

  return {
    port,
    python: typeof config.python === 'string' && config.python.trim() !== '' ? config.python : DEFAULT_LINGTAI_PYTHON,
    url: `http://localhost:${String(port)}`,
    timeoutMs: positive(config.timeoutMs, DEFAULT_LINGTAI_TIMEOUT_MS),
    pollMs: positive(config.pollMs, DEFAULT_LINGTAI_POLL_MS),
    probeTimeoutMs: positive(config.probeTimeoutMs, DEFAULT_LINGTAI_PROBE_TIMEOUT_MS),
  }
}

/** 秒数去掉没意义的小数尾巴：12000 → `12`，120 → `0.1`。 */
export const secondsOf = (timeoutMs: number): string => {
  const seconds = Math.round(timeoutMs / 100) / 10

  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1)
}

const dirHint =
  '把 lingtai.dir 指向 lingtai-reader 的目录（里面有 server.py），或者设置环境变量 LINGTAI_DIR，然后重启 DSH。'

export const lingTaiTimeoutMessage = (endpoint: LingTaiEndpoint, dir: string): string =>
  `灵台阅读器没能在 ${secondsOf(endpoint.timeoutMs)} 秒内起来：${join(dir, LINGTAI_SERVER_FILE)} 没有开始监听 ${String(endpoint.port)}。` +
  `可以手动试一下：cd ${dir} && ${endpoint.python} ${LINGTAI_SERVER_FILE}`

/** 目录：显式配置 > 环境变量；都没有就是可读错误，绝不猜路径。 */
export const lingTaiDirOf = (config: LingtaiConfig = {}): string => {
  const configured = typeof config.dir === 'string' ? config.dir.trim() : ''

  if (configured !== '') return configured

  const fromEnv = String(process.env.LINGTAI_DIR ?? '').trim()

  return fromEnv
}

/** 只查状态：不 spawn、不写盘。探测失败也算一次成功的查询（`running:false`）。 */
export const lingTaiStatus = async (config: LingtaiConfig = {}): Promise<LingTaiStatus> => {
  const endpoint = lingTaiEndpointOf(config)
  const running = await probeOf()('127.0.0.1', endpoint.port, endpoint.probeTimeoutMs)

  return { ok: true, running, url: endpoint.url }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 确保灵台阅读器在跑。
 *
 * 1. 先探测；在跑就直接返回（`launched:false`，不 spawn）
 * 2. 没在跑 → `spawn(python, ['server.py'], {cwd: dir, detached, stdio:'ignore', windowsHide})` + unref
 * 3. 每 `pollMs` 探一次，最多等 `timeoutMs`
 * 4. 超时 / spawn 失败 / 没配目录 → `{ok:false, code, message}`，**不抛**
 */
export const ensureLingTai = async (config: LingtaiConfig = {}): Promise<LingTaiResult> => {
  const endpoint = lingTaiEndpointOf(config)
  const dir = lingTaiDirOf(config)

  if (dir === '') {
    return {
      ok: false,
      launched: false,
      code: 'LINGTAI_NO_DIR',
      message: `灵台阅读器没有配置目录。${dirHint}`,
    }
  }

  if (!existsSync(dir)) {
    return {
      ok: false,
      launched: false,
      code: 'LINGTAI_BAD_DIR',
      message: `灵台阅读器目录不存在：${dir}。${dirHint}`,
    }
  }

  if (!existsSync(join(dir, LINGTAI_SERVER_FILE))) {
    return {
      ok: false,
      launched: false,
      code: 'LINGTAI_NO_SERVER',
      message: `灵台阅读器目录里没有 ${LINGTAI_SERVER_FILE}：${dir}。${dirHint}`,
    }
  }

  const probe = probeOf()

  if (await probe('127.0.0.1', endpoint.port, endpoint.probeTimeoutMs)) {
    return { ok: true, launched: false, url: endpoint.url }
  }

  // 端口被覆盖过（不是 8769）时把它交给 server.py 的 sys.argv[1]；缺省仍是干净的一条。
  const args = endpoint.port === DEFAULT_LINGTAI_PORT ? [LINGTAI_SERVER_FILE] : [LINGTAI_SERVER_FILE, String(endpoint.port)]

  let spawnFailure: Error | null = null

  try {
    const child = spawnOf()(endpoint.python, args, {
      cwd: dir,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })

    child?.on?.('error', (error: Error) => {
      // ENOENT（没装 python）走的是异步 error 事件，不接住会变成未捕获异常
      spawnFailure = error
    })
    child?.unref?.()
  } catch (error) {
    return {
      ok: false,
      launched: false,
      code: 'LINGTAI_SPAWN_FAILED',
      message: `灵台阅读器启动失败（${endpoint.python} ${args.join(' ')}）：${
        error instanceof Error ? error.message : String(error)
      }`,
      url: endpoint.url,
    }
  }

  const deadline = Date.now() + endpoint.timeoutMs

  while (Date.now() < deadline) {
    await sleep(endpoint.pollMs)

    if (spawnFailure !== null) {
      return {
        ok: false,
        launched: false,
        code: 'LINGTAI_SPAWN_FAILED',
        message: `灵台阅读器启动失败（${endpoint.python} ${args.join(' ')}）：${spawnFailure.message}。${
          spawnFailure.message.includes('ENOENT') ? '检查 python 是否在 PATH 上（或配置 lingtai.python）。' : dirHint
        }`,
        url: endpoint.url,
      }
    }

    if (await probe('127.0.0.1', endpoint.port, endpoint.probeTimeoutMs)) {
      return { ok: true, launched: true, url: endpoint.url }
    }
  }

  return {
    ok: false,
    launched: true,
    code: 'LINGTAI_TIMEOUT',
    message: lingTaiTimeoutMessage(endpoint, dir),
    url: endpoint.url,
  }
}
