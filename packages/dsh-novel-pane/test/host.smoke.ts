// 装配冒烟：拿**编译后的** lib/index.js 在假 Cordis 上下文里真跑一遍。
//
// 纯函数测试证明不了接缝接对了——`ctx.inject(['webServer'])` 的形态、
// `commands.register` 的参数、路由怎么读请求体，只有真跑才会炸。
//
// 跑：node test/host.smoke.ts

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 状态写到临时目录：别碰真的 DSH home
const HOME = mkdtempSync(join(tmpdir(), 'dsh-novel-smoke-'))
process.env.DSH_HOME = HOME

const { apply } = await import('../lib/index.js')

const BOOK = join(HOME, '书.txt')

writeFileSync(
  BOOK,
  Array.from({ length: 60 }, (_, i) => `第 ${String(i + 1)} 行：船在雾里走。`).join('\n'),
  'utf8',
)

type Capture = { route?: any; command?: any }

const makeCtx = () => {
  const captured: Capture = {}
  const services: any = {
    webServer: {
      register(route: any) {
        captured.route = route

        return () => {}
      },
    },
    commands: {
      register(definition: any) {
        captured.command = definition

        return () => {}
      },
    },
  }

  const ctx = {
    inject(names: string[], callback: (scope: any) => void) {
      const scope: any = {
        // 真 Cordis 的注入作用域带着 effect/on；这里给最小实现
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

/** 一次假的 HTTP 往返：GET 或带 JSON 体的 POST。 */
const call = async (route: any, url: string, body?: unknown) => {
  const req: any =
    body === undefined
      ? { url, method: 'GET' }
      : {
          url,
          method: 'POST',
          async *[Symbol.asyncIterator]() {
            yield Buffer.from(JSON.stringify(body))
          },
        }

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

describe('novel-pane 宿主', () => {
  test('注册了路由和 /novel 命令', () => {
    const { ctx, captured } = makeCtx()

    apply(ctx, {})

    assert.notEqual(captured.route, undefined, '没有注册 webServer 路由')
    assert.equal(captured.route.kind, 'prefix')
    assert.equal(captured.route.path, '/dsh-novel-pane')
    assert.notEqual(captured.command, undefined, '没有注册 /novel')
    assert.equal(captured.command.name, 'novel')
  })

  test('/novel <文件> 打开，状态里能读到正文和进度', async () => {
    const { ctx, captured } = makeCtx()

    apply(ctx, {})

    const result = captured.command.handler({ rawInput: ` ${BOOK}`, agent: { session: { header: { cwd: HOME } } } })

    assert.equal(result.kind, 'success')
    assert.match(result.text, /打开 书\.txt（60 行）/)

    const { json } = await call(captured.route, '/dsh-novel-pane/state?rows=10')

    assert.equal(json.open, true)
    assert.equal(json.total, 60)
    assert.equal(json.title, '书.txt')
    assert.equal(json.text.length, 9, '正文比窗格少一行（表头占一行）')
    assert.match(json.text[0], /第 1 行/)
  })

  test('按钮走 /move：down/up/top/mode/close', async () => {
    const { ctx, captured } = makeCtx()

    apply(ctx, {})
    captured.command.handler({ rawInput: ` ${BOOK}`, agent: { session: { header: { cwd: HOME } } } })

    const down = await call(captured.route, '/dsh-novel-pane/move', { op: 'down', rows: 10 })

    assert.equal(down.json.line, 1)

    const top = await call(captured.route, '/dsh-novel-pane/move', { op: 'top', rows: 10 })

    assert.equal(top.json.line, 0)

    const mode = await call(captured.route, '/dsh-novel-pane/move', { op: 'mode', rows: 10 })

    assert.equal(mode.json.mode, 'page')

    const pageDown = await call(captured.route, '/dsh-novel-pane/move', { op: 'down', rows: 10 })

    assert.equal(pageDown.json.line, 10, '整屏模式下一步是一屏')

    const close = await call(captured.route, '/dsh-novel-pane/move', { op: 'close', rows: 10 })

    assert.equal(close.json.open, false)
  })

  test('翻页不会越界：n 到底停住，p 到头停住', async () => {
    const { ctx, captured } = makeCtx()

    apply(ctx, { pageRows: 10 })
    captured.command.handler({ rawInput: ` ${BOOK}`, agent: { session: { header: { cwd: HOME } } } })

    for (let i = 0; i < 20; i += 1) {
      captured.command.handler({ rawInput: 'n', agent: { session: { header: { cwd: HOME } } } })
    }

    const end = await call(captured.route, '/dsh-novel-pane/state?rows=10')

    assert.equal(end.json.line, 50, '最后一页的顶行 = 总行数 − 一页行数')

    for (let i = 0; i < 20; i += 1) {
      captured.command.handler({ rawInput: 'p', agent: { session: { header: { cwd: HOME } } } })
    }

    const start = await call(captured.route, '/dsh-novel-pane/state?rows=10')

    assert.equal(start.json.line, 0)
  })

  test('书单列出目录里能读的文件', async () => {
    const { ctx, captured } = makeCtx()

    apply(ctx, {})

    const result = captured.command.handler({ rawInput: ' shelf', agent: { session: { header: { cwd: HOME } } } })

    assert.match(result.text, /书单/)
    assert.match(result.text, /书\.txt/)
  })

  test('找不到的文件报错，不把窗格打开', async () => {
    const { ctx, captured } = makeCtx()

    apply(ctx, {})

    // 状态是跨测试共用的（写盘的那份）；先明确收起，才谈得上「没被打开」
    await call(captured.route, '/dsh-novel-pane/move', { op: 'close', rows: 10 })

    const result = captured.command.handler({ rawInput: ' 没有这本.txt', agent: { session: { header: { cwd: HOME } } } })

    assert.match(result.text, /找不到/)

    const { json } = await call(captured.route, '/dsh-novel-pane/state?rows=10')

    assert.equal(json.open, false)
  })
})
