// 真集成：把插件挂进**真的** dsh-session-projection 注册表，喂真事件，读回折出来的值。
//
// 为什么还要这一层（`host.smoke.ts` 已经用假注册表验过逻辑了）：
//
//   1. **zod 实例**。我的 schema 是包自己 node_modules 里那份 zod 造的，注册表用的是
//      它自己那份。如果注册表对 schema 做 instanceof 检查，两份 zod 就会打架——表现是
//      插件装上去了、不报错、但投影永远不更新。这是最难查的一类故障，值得专门钉一下。
//   2. **真驱动**。注册表靠 `session/event` 驱动折叠；假注册表是我自己调的 apply。
//      这个测试发的是真事件，走的是真注册表的 drive。
//
// 它需要本机有一份 DSH 安装（用来解析 @deepseek-ai/*）。没有就跳过，不算失败。
// 跑：node test/integration.mjs

import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = join(HERE, '..', 'lib', 'index.js')

/** DSH 的 home；profile 的依赖从这里解析。 */
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const PROFILES = join(DSH_HOME, 'profiles')

if (!existsSync(PLUGIN)) {
  console.log('SKIP：还没构建（先 npm run build，lib/index.js 不存在）')
  process.exit(0)
}

if (!existsSync(join(DSH_HOME, 'profiles'))) {
  console.log(`SKIP：本机没有 DSH profile 目录（${PROFILES}），这个测试需要一个已安装的 DSH`)
  process.exit(0)
}

// createRequire 只需要一个「基准路径」，那个文件本身不必存在。
const requireFromProfile = createRequire(join(PROFILES, 'package.json'))

const load = async (specifier) => {
  const resolved = requireFromProfile.resolve(specifier)

  return import(pathToFileURL(resolved).href)
}

let cordis
let projectionModule

try {
  cordis = await load('@deepseek-ai/cordis')
  projectionModule = await load('@deepseek-ai/dsh-session-projection')
} catch (error) {
  console.log(`SKIP：解析不到 DSH 的依赖包（${error.message}）`)
  process.exit(0)
}

const failures = []
const ok = (message) => console.log(`  OK   ${message}`)
const bad = (message) => {
  failures.push(message)
  console.log(`  FAIL ${message}`)
}

const { Context } = cordis
const Registry = projectionModule.SessionProjectionRegistry ?? projectionModule.default
const plugin = await import(pathToFileURL(PLUGIN).href)

// ---- 真注册表 + 我的插件 -------------------------------------------------
console.log('== 真注册表 ==')

const app = new Context()

app.plugin(Registry)
await new Promise((resolve) => setTimeout(resolve, 100))

const registry = app.get('sessionProjections')

if (registry === undefined) bad('sessionProjections 服务没起来')
else ok('真 SessionProjectionRegistry 起来了')

/** 把插件要的服务都转发到真 app，让它的 register 落进真注册表。 */
const forwardingCtx = {
  inject(names, callback) {
    const scope = { get: (name, fallback) => app.get(name) ?? fallback }

    for (const name of names) {
      const service = app.get(name)

      if (service === undefined) return
      scope[name] = service
    }

    callback(scope)
  },
  get: (name, fallback) => app.get(name) ?? fallback,
  on: (...args) => app.on(...args),
  effect: (fn) => {
    fn()

    return () => {}
  },
}

try {
  plugin.apply(forwardingCtx, { refreshMs: 24 * 60 * 60 * 1000 })
  ok('apply() 在真注册表前跑通（schema 被接受）')
} catch (error) {
  bad(`apply() 抛错：${error.message}`)
}

// ---- 喂真事件，读回投影 --------------------------------------------------
console.log('== 折叠 ==')

const HOUR = 3_600_000
const EDGE = Math.floor(1_700_000_000_000 / HOUR) * HOUR

// 注册表读 session.events（按 seq 下标），不是 session.log。
const session = {
  events: [],
  append(type, data) {
    const event = { type, seq: this.events.length, time: Date.now(), data }

    this.events.push(event)

    return event
  },
}

const emit = (type, data) => app.emit('session/event', session, session.append(type, data))
const fold = (atMs, total) =>
  emit('balance/status', { kind: 'ok', amount: `¥${total.toFixed(2)}`, total, atMs, note: null })

try {
  // 上一整小时：开头 25、结尾 20 → 花掉 5.00；第三条落在本小时里
  fold(EDGE - 70 * 60_000, 25)
  fold(EDGE - 10 * 60_000, 20)
  fold(EDGE + 5 * 60_000, 17.5)

  const value = registry.snapshot(session)?.values?.balance

  if (value === undefined || value === null) {
    bad('真注册表里读不到 balance 投影（schema 可能没被接受）')
  } else {
    ok('真注册表读到了 balance 投影')

    if (value.amount === '¥17.50') ok('金额正确')
    else bad(`金额不对：${value.amount}`)

    if (Array.isArray(value.hours) && value.hours.at(-1) === 5) ok('时长条正确（上一小时 5.00）')
    else bad(`时长条不对：${JSON.stringify(value.hours)}`)

    // 无关事件必须不改状态引用，否则真注册表每来一条事件都白跑一次
    const before = registry.snapshot(session)?.values?.balance

    emit('turn/start', {})
    const after = registry.snapshot(session)?.values?.balance

    if (JSON.stringify(before) === JSON.stringify(after)) ok('无关事件不改投影')
    else bad('无关事件改变了投影')
  }
} catch (error) {
  bad(`喂事件/读快照时抛错：${error.message}`)
}

console.log('')
console.log(failures.length === 0 ? 'VERDICT: 真注册表集成通过' : `VERDICT: ${failures.length} 项失败`)
await app.stop?.()
process.exit(failures.length === 0 ? 0 : 1)
