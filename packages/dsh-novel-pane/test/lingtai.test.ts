// 灵台阅读器（lingtai-reader）宿主胶水的测试。
//
// 三条主线：
//   1. ensureLingTai：探测 → spawn → 轮询 → 超时 / 配置错误，**不抛**
//   2. 两条新路由：GET 只查状态（不 spawn）、POST 确保在跑
//   3. 注入：probe 与 spawn 全部换掉 —— **测试里绝不真起 python**
//
// 跑（先 npm run build，host 测试吃的是 lib/）：
//   node test/lingtai.test.ts

import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const TMP = join(HERE, '..', '.tmp')

mkdirSync(TMP, { recursive: true })

// 状态写临时目录；LINGTAI_DIR 清空，「没配 dir」那条才测得准
process.env.DSH_HOME = mkdtempSync(join(TMP, 'lingtai-home-'))
delete process.env.LINGTAI_DIR

const lingtai: any = await import('../lib/lingtai.js')
const { apply } = await import('../lib/index.js')

const spawns: Array<{ command: string; args: string[]; options: any }> = []
const probeCalls: Array<{ host: string; port: number; timeoutMs: number }> = []

/** 换掉 spawn：只记账，返回一个假的 ChildProcess。 */
const installSpawn = (): void => {
  spawns.length = 0
  lingtai.setLingTaiSpawnForTests((command: string, args: string[], options: any) => {
    spawns.push({ command, args, options })

    return { on() {}, unref() {}, kill() {} }
  })
}

/** 换掉探测：按 `answers` 依次返回，用完之后一直是 false。 */
const installProbe = (answers: boolean[]): void => {
  probeCalls.length = 0
  const queue = [...answers]

  lingtai.setLingTaiProbeForTests(async (host: string, port: number, timeoutMs: number) => {
    probeCalls.push({ host, port, timeoutMs })

    return queue.length === 0 ? false : queue.shift() === true
  })
}

afterEach(() => {
  lingtai.setLingTaiProbeForTests(null)
  lingtai.setLingTaiSpawnForTests(null)
})

/** 一个真的存在、有 server.py 的目录（内容不会被执行）。 */
const DIR = mkdtempSync(join(TMP, 'lingtai-dir-'))

writeFileSync(join(DIR, 'server.py'), '# 假的启动入口；测试里不会执行\n', 'utf8')

const EMPTY_DIR = mkdtempSync(join(TMP, 'lingtai-empty-'))

describe('ensureLingTai：探测 / 拉起 / 等待', () => {
  test('探测失败 → spawn 一次 → 第二次探测成功：launched:true，只 spawn 一次', async () => {
    installSpawn()
    installProbe([false, true])

    const result = await lingtai.ensureLingTai({ dir: DIR, timeoutMs: 2000, pollMs: 5 })

    assert.deepEqual(result, { ok: true, launched: true, url: 'http://localhost:8769' })
    assert.equal(spawns.length, 1, 'spawn 应该只调用一次')
    assert.deepEqual(probeCalls.map((call) => call.port), [8769, 8769], '应该探测两次')

    const [spawned] = spawns

    assert.equal(spawned.command, 'python')
    assert.deepEqual(spawned.args, ['server.py'], '缺省端口下命令行应该是 python server.py')
    assert.equal(spawned.options.cwd, DIR)
    assert.equal(spawned.options.detached, true)
    assert.equal(spawned.options.stdio, 'ignore')
    assert.equal(spawned.options.windowsHide, true)
  })

  test('已经在跑（第一次探测就成功）→ 不 spawn，launched:false', async () => {
    installSpawn()
    installProbe([true])

    const result = await lingtai.ensureLingTai({ dir: DIR })

    assert.deepEqual(result, { ok: true, launched: false, url: 'http://localhost:8769' })
    assert.equal(spawns.length, 0, '已经在跑就不该 spawn')
    assert.equal(probeCalls.length, 1, '已经在跑只探测一次')
  })

  test('超时（timeout 配得很小）→ LINGTAI_TIMEOUT，不抛', async () => {
    installSpawn()
    installProbe([])

    const result = await lingtai.ensureLingTai({ dir: DIR, timeoutMs: 120, pollMs: 20 })

    assert.equal(result.ok, false)
    assert.equal(result.launched, true)
    assert.equal(result.code, 'LINGTAI_TIMEOUT')
    assert.match(result.message, /灵台阅读器没能在 .*秒内起来/)
    assert.equal(result.url, 'http://localhost:8769', '超时也要把 url 带回去，好给「新标签打开」兜底')
    assert.equal(spawns.length, 1)
    assert.ok(probeCalls.length >= 2, '超时前应该反复探测')
  })

  test('没配 dir → 可读错误（LINGTAI_NO_DIR），不 spawn', async () => {
    installSpawn()
    installProbe([false, true])

    const result = await lingtai.ensureLingTai({})

    assert.equal(result.ok, false)
    assert.equal(result.launched, false)
    assert.equal(result.code, 'LINGTAI_NO_DIR')
    assert.match(result.message, /灵台阅读器没有配置目录/)
    assert.match(result.message, /LINGTAI_DIR/)
    assert.match(result.message, /lingtai\.dir/)
    assert.equal(spawns.length, 0, '连目录都没有，不该试探着 spawn')
    assert.equal(probeCalls.length, 0)
  })

  test('dir 指向空目录（没有 server.py）→ LINGTAI_NO_SERVER，不 spawn', async () => {
    installSpawn()

    const result = await lingtai.ensureLingTai({ dir: EMPTY_DIR })

    assert.equal(result.ok, false)
    assert.equal(result.code, 'LINGTAI_NO_SERVER')
    assert.match(result.message, /没有 server\.py/)
    assert.equal(spawns.length, 0)
  })

  test('spawn 同步抛错 → LINGTAI_SPAWN_FAILED，不抛到调用方', async () => {
    spawns.length = 0
    lingtai.setLingTaiSpawnForTests(() => {
      throw new Error('spawn python ENOENT')
    })
    installProbe([false])

    const result = await lingtai.ensureLingTai({ dir: DIR })

    assert.equal(result.ok, false)
    assert.equal(result.code, 'LINGTAI_SPAWN_FAILED')
    assert.match(result.message, /ENOENT/)
  })

  test('端口覆盖：把端口交给 server.py 的 sys.argv[1]', async () => {
    installSpawn()
    installProbe([false, true])

    const result = await lingtai.ensureLingTai({ dir: DIR, port: 9000, timeoutMs: 2000, pollMs: 5 })

    assert.equal(result.url, 'http://localhost:9000')
    assert.deepEqual(spawns[0].args, ['server.py', '9000'], '自定义端口要透传给 server.py')
  })

  test('LINGTAI_DIR 环境变量可以当 dir（配置优先）', async () => {
    installSpawn()
    installProbe([false, true])
    process.env.LINGTAI_DIR = DIR

    try {
      const result = await lingtai.ensureLingTai({ timeoutMs: 2000, pollMs: 5 })

      assert.equal(result.ok, true)
      assert.equal(spawns[0].options.cwd, DIR)
    } finally {
      delete process.env.LINGTAI_DIR
    }
  })
})

describe('lingTaiStatus：只查，不动', () => {
  test('在跑 → {ok:true, running:true, url}，不 spawn', async () => {
    installSpawn()
    installProbe([true])

    const result = await lingtai.lingTaiStatus({ port: 8769 })

    assert.deepEqual(result, { ok: true, running: true, url: 'http://localhost:8769' })
    assert.equal(spawns.length, 0)
  })

  test('没在跑 → running:false，也不 spawn', async () => {
    installSpawn()
    installProbe([false])

    const result = await lingtai.lingTaiStatus({})

    assert.deepEqual(result, { ok: true, running: false, url: 'http://localhost:8769' })
    assert.equal(spawns.length, 0)
  })
})

describe('路由：GET /lingtai 与 POST /lingtai', () => {
  const makeCtx = () => {
    const captured: { route?: any } = {}
    const services: any = {
      webServer: {
        register(route: any) {
          captured.route = route

          return () => {}
        },
      },
      commands: {
        register() {
          return () => {}
        },
      },
    }
    const ctx = {
      inject(names: string[], callback: (scope: any) => void) {
        const scope: any = {
          effect(fn: () => unknown) {
            fn()

            return () => {}
          },
          on() {},
        }

        for (const name of names) scope[name] = services[name]
        callback(scope)
      },
      get: (name: string) => services[name],
      on() {},
      effect(fn: () => unknown) {
        fn()

        return () => {}
      },
    }

    return { ctx, captured }
  }

  const call = async (route: any, url: string, method: 'GET' | 'POST') => {
    const req: any = { url, method }
    const res: any = {
      code: 0,
      body: '',
      writeHead(code: number) {
        res.code = code
      },
      end(text: string) {
        res.body = text
      },
    }

    await route.handler(req, res)

    return { code: res.code, json: JSON.parse(res.body) }
  }

  test('GET 已经在跑：running:true，不 spawn', async () => {
    installSpawn()
    installProbe([true])

    const { ctx, captured } = makeCtx()

    apply(ctx, { lingtai: { dir: DIR } })

    const { code, json } = await call(captured.route, '/dsh-novel-pane/lingtai', 'GET')

    assert.equal(code, 200)
    assert.deepEqual(json, { ok: true, running: true, url: 'http://localhost:8769' })
    assert.equal(spawns.length, 0, 'GET 只查状态，不许启动任何东西')
  })

  test('GET 没在跑：running:false，仍然不 spawn', async () => {
    installSpawn()
    installProbe([false, true])

    const { ctx, captured } = makeCtx()

    apply(ctx, { lingtai: { dir: DIR } })

    const { json } = await call(captured.route, '/dsh-novel-pane/lingtai', 'GET')

    assert.equal(json.running, false)
    assert.equal(spawns.length, 0, 'GET 不许顺手拉起服务')
    assert.equal(probeCalls.length, 1, 'GET 只探测一次')
  })

  test('POST 没在跑：拉起并等到起来，返回 launched:true', async () => {
    installSpawn()
    installProbe([false, true])

    const { ctx, captured } = makeCtx()

    apply(ctx, { lingtai: { dir: DIR, timeoutMs: 2000, pollMs: 5 } })

    const { code, json } = await call(captured.route, '/dsh-novel-pane/lingtai', 'POST')

    assert.equal(code, 200)
    assert.deepEqual(json, { ok: true, launched: true, url: 'http://localhost:8769' })
    assert.equal(spawns.length, 1)
  })

  test('POST 没配 dir：400 + 可读 message', async () => {
    installSpawn()

    const { ctx, captured } = makeCtx()

    apply(ctx, { lingtai: {} })

    const { code, json } = await call(captured.route, '/dsh-novel-pane/lingtai', 'POST')

    assert.equal(code, 400)
    assert.equal(json.ok, false)
    assert.equal(json.code, 'LINGTAI_NO_DIR')
    assert.match(json.message, /灵台阅读器没有配置目录/)
    assert.equal(spawns.length, 0)
  })

  test('POST 超时：200 + LINGTAI_TIMEOUT（业务结果，不 500）', async () => {
    installSpawn()
    installProbe([])

    const { ctx, captured } = makeCtx()

    apply(ctx, { lingtai: { dir: DIR, timeoutMs: 120, pollMs: 20 } })

    const { code, json } = await call(captured.route, '/dsh-novel-pane/lingtai', 'POST')

    assert.equal(code, 200)
    assert.equal(json.ok, false)
    assert.equal(json.code, 'LINGTAI_TIMEOUT')
    assert.equal(json.launched, true)
  })
})
