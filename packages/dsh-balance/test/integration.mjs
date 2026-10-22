// 落盘 roundtrip：**重启之后时长条还在**吗？
//
// 这个文件原来是「真 SessionProjectionRegistry 集成测试」——它存在的理由是投影
// 那套东西（zod 实例对不对、真驱动怎么折事件）。投影删掉之后那两个理由一起没了，
// 所以整个测试换成钉**新设计里唯一有状态的那块**：宿主内存状态 → state.json →
// 下一个进程读回来。
//
// 为什么不是直接删掉：
//
//   1. 落盘是新加的，而且只有它能保证「重启后时长条还在」（内存里那份谁都会写）；
//   2. 它能在**不装 DSH、不开端口**的情况下真跑：起两个宿主实例、共用一个
//      DSH_HOME，中间只隔着一次 apply，就是「重启」的最短复现；
//   3. 顺手钉住那个 bug 本身：余额是账户级的，**同一份状态**，所以「不同对话」
//      发来的请求拿到的金额和读取时刻必须一模一样（以前每个会话各存一份，
//      显示的金额自然不一样）。
//
// 跑：node test/integration.mjs

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = join(HERE, '..', 'lib', 'index.js')

if (!existsSync(PLUGIN)) {
  console.log('SKIP：还没构建（先 npm run build，lib/index.js 不存在）')
  process.exit(0)
}

const plugin = await import(pathToFileURL(PLUGIN).href)

// 系统临时目录在有些机器上不可写（本机就是这样，mkdtemp 直接 EPERM），所以用包
// 自己的 .tmp/；跑完删掉。
const TMP_ROOT = join(HERE, '..', '.tmp')

mkdirSync(TMP_ROOT, { recursive: true })

const DSH_HOME = mkdtempSync(join(TMP_ROOT, 'roundtrip-'))
const STATE_FILE = join(DSH_HOME, 'plugins', 'dsh-balance', 'state.json')

process.env.DSH_HOME = DSH_HOME

const failures = []
const ok = (message) => console.log(`  OK   ${message}`)
const bad = (message) => {
  failures.push(message)
  console.log(`  FAIL ${message}`)
}

/**
 * 递归删目录。
 *
 * 这台机器上 `fs.rmSync(..., { recursive: true })` 会**静默不删**（不抛错、也不
 * 删掉，目录原地不动），所以自己 readdir + unlink + rmdir。删不掉最多留一堆
 * `.tmp/`（已 gitignore），不该让测试变红。
 */
const removeTree = (target) => {
  let entries = []

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

// ---- 假 fetch：余额接口的回答由这里给 ------------------------------------
const answerFor = (total) =>
  JSON.stringify({
    is_available: true,
    balance_infos: [{ currency: 'CNY', total_balance: total, granted_balance: '0.00', topped_up_balance: total }],
  })

const answering = (body, status = 200) =>
  async () => ({ ok: status >= 200 && status < 300, status, text: async () => body })

/** 永远不回：用来证明「这个数字来自落盘，不是刚读的」。 */
const never = () => new Promise(() => {})

// ---- 一个够用的假宿主 ----------------------------------------------------
const makeHost = (credential) => {
  const captured = {}

  const services = {
    webServer: {
      register(route) {
        captured.route = route

        return () => {}
      },
    },
    commands: {
      register(definition) {
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

  const ctx = {
    inject(names, callback) {
      const scope = { get: ctx.get, effect: ctx.effect }

      for (const name of names) {
        if (services[name] === undefined) return
        scope[name] = services[name]
      }

      callback(scope)
    },
    get: (name, fallback) => services[name] ?? fallback,
    on: () => () => {},
    effect: (fn) => {
      fn()
    },
  }

  return { ctx, captured }
}

const makeRes = () => {
  const state = { status: 0, headers: {}, body: '' }
  const res = {
    writeHead(status, headers) {
      state.status = status
      if (headers !== undefined) Object.assign(state.headers, headers)

      return res
    },
    end(text) {
      state.body = typeof text === 'string' ? text : ''
    },
  }

  return { res, state }
}

/** 走一遍真路由 handler；`session` 只是请求里的一个查询串（宿主根本不看它）。 */
const get = async (route, session = 'alpha') => {
  const { res, state } = makeRes()

  await route.handler({ method: 'GET', url: `/dsh-balance/current?session=${session}` }, res)

  return { ...state, json: state.status === 200 ? JSON.parse(state.body) : null }
}

const until = async (ready, label) => {
  for (let i = 0; i < 250; i += 1) {
    const state = await ready()

    if (state !== null) return state

    await new Promise((resolve) => setTimeout(resolve, 4))
  }

  throw new Error(`等不到：${label}`)
}

const originalFetch = globalThis.fetch

try {
  // ---- 宿主 A：读两次，落盘 ----------------------------------------------
  console.log('== 宿主 A：采两次 ==')

  globalThis.fetch = answering(answerFor('16.65'))

  const hostA = makeHost('sk-test')

  plugin.apply(hostA.ctx, { refreshMs: 24 * 60 * 60 * 1000 })

  const first = await until(async () => {
    const one = await get(hostA.captured.route)

    return one.json !== null && one.json.kind === 'ok' ? one.json : null
  }, '宿主 A 的第一次读数')

  if (first.amount === '¥16.65') ok('第一次读数是 ¥16.65')
  else bad(`第一次读数不对：${first.amount}`)

  // 第二次读：换一个数字，用 `/bal` 强制立刻重读
  globalThis.fetch = answering(answerFor('12.00'))

  const text = (await hostA.captured.command.handler({})).text

  if (/¥12\.00/.test(text)) ok('/bal 立刻重读到 ¥12.00')
  else bad(`/bal 的文本不对：${text}`)

  const second = await until(async () => {
    const one = await get(hostA.captured.route)

    return one.json !== null && one.json.amount === '¥12.00' ? one.json : null
  }, '宿主 A 的第二次读数')

  // ---- state.json 本身 ---------------------------------------------------
  console.log('== 落盘 ==')

  if (existsSync(STATE_FILE)) ok(`state.json 落在 $DSH_HOME/plugins/dsh-balance/（${STATE_FILE}）`)
  else bad(`没有落盘：${STATE_FILE} 不存在`)

  let saved = null

  try {
    saved = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  } catch (error) {
    bad(`state.json 读不出来：${error.message}`)
  }

  if (saved !== null) {
    if (saved.reading?.amount === '¥12.00' && saved.reading?.kind === 'ok') ok('文件里的当前读数是最后一次读数')
    else bad(`文件里的当前读数不对：${JSON.stringify(saved.reading)}`)

    if (saved.reading !== undefined && !('hours' in saved.reading)) ok('文件里不存 hours（时长条是纯函数现算的）')
    else bad('文件里不该有 hours：它是派生值')

    if (Array.isArray(saved.samples) && saved.samples.length === 2) ok('两次读数都在采样历史里')
    else bad(`采样历史不对：${JSON.stringify(saved.samples)}`)

    if (saved.samples?.at(-1)?.total === 12) ok('采样点带着金额（算时长条要用）')
    else bad(`最后一个采样点不对：${JSON.stringify(saved.samples?.at(-1))}`)

    if (saved.reading?.atMs === second.atMs) ok('文件里的读取时刻和路由给的一致')
    else bad(`读取时刻不一致：${saved.reading?.atMs} vs ${second.atMs}`)
  }

  // ---- 宿主 B：「重启」之后靠落盘就有数 ----------------------------------
  console.log('== 宿主 B：重启（同一个 DSH_HOME，全新实例）==')

  // fetch 永远不回：所以下面看到的任何数字都只可能来自 state.json
  globalThis.fetch = never

  const hostB = makeHost('sk-test')

  plugin.apply(hostB.ctx, { refreshMs: 24 * 60 * 60 * 1000 })

  const restored = (await get(hostB.captured.route, 'brand-new-conversation')).json

  if (restored === null) {
    bad('宿主 B 的路由没有回 200')
  } else {
    if (restored.amount === '¥12.00') ok('重启后立刻就是 ¥12.00，不用等下一次采样')
    else bad(`重启后的金额不对：${restored.amount}`)

    if (restored.atMs === second.atMs) ok('重启后的「读取时刻」还是原来那一次（age 说的是实话）')
    else bad(`重启后的读取时刻不对：${restored.atMs} vs ${second.atMs}`)

    if (Array.isArray(restored.hours) && restored.hours.length === 5) ok('时长条还是 5 格（历史从文件里回来了）')
    else bad(`重启后的时长条不对：${JSON.stringify(restored.hours)}`)

    if (typeof restored.line === 'string' && /¥12\.00/.test(restored.line)) ok('line 由宿主算好，带上了金额')
    else bad(`重启后的 line 不对：${restored.line}`)
  }

  // ---- 那个 bug 的回归：不同会话看到同一个数 -----------------------------
  console.log('== 不同对话 ==')

  const alpha = (await get(hostB.captured.route, 'alpha')).json
  const beta = (await get(hostB.captured.route, 'beta')).json
  const gamma = (await get(hostB.captured.route, 'gamma')).json

  if (alpha !== null && beta !== null && gamma !== null) {
    const same = [alpha, beta, gamma].every(
      (one) => one.amount === alpha.amount && one.atMs === alpha.atMs && one.total === alpha.total,
    )

    if (same) ok('三个「对话」拿到的金额 / 读取时刻 / 数值完全一样')
    else bad(`不同对话不一致：${JSON.stringify([alpha, beta, gamma].map((one) => [one.amount, one.atMs, one.total]))}`)

    if (new Set([alpha.line, beta.line, gamma.line]).size === 1) ok('连那一行字都一样')
    else bad(`不同对话的 line 不一致：${JSON.stringify([alpha.line, beta.line, gamma.line])}`)
  } else {
    bad('有请求没拿到 200')
  }
} catch (error) {
  // 未捕获的异常要算成失败，而不是让 VERDICT 误报通过
  bad(`测试自己炸了：${error instanceof Error ? error.stack : String(error)}`)
} finally {
  globalThis.fetch = originalFetch
  removeTree(DSH_HOME)
}

console.log('')
console.log(failures.length === 0 ? 'VERDICT: 落盘 roundtrip 通过' : `VERDICT: ${failures.length} 项失败`)
process.exit(failures.length === 0 ? 0 : 1)
