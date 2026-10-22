// 装配冒烟：拿**编译后的** lib/index.js 在假 Cordis 上下文里真跑一遍。
//
// 纯函数测试证明不了接缝接对了——`ctx.inject(['webServer'])` 的形态、
// `commands.register` 的参数、路由怎么读请求体，只有真跑才会炸。
//
// 跑：node test/host.smoke.ts

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { minimalEpub } from './epub-fixture.ts'

// 状态写到临时目录：别碰真的 DSH home。
// 本机 OS Temp 不可写，临时目录一律落在包内 `.tmp/`（.gitignore 已忽略）。
const HERE = dirname(fileURLToPath(import.meta.url))
const TMP = join(HERE, '..', '.tmp')

mkdirSync(TMP, { recursive: true })

const HOME = mkdtempSync(join(TMP, 'host-smoke-'))
process.env.DSH_HOME = HOME

const { apply } = await import('../lib/index.js')
// 注入真正的 lib/pdf.js（和 lib/index.js 是同一个模块实例），不真跑 python
const { setPdfExtractorForTests } = await import('../lib/pdf.js')

const BOOK = join(HOME, '书.txt')

writeFileSync(
  BOOK,
  Array.from({ length: 60 }, (_, i) => `第 ${String(i + 1)} 行：船在雾里走。`).join('\n'),
  'utf8',
)

/** 一本真的能打开的 epub（现造的极小包）。 */
const EPUB = join(HOME, '白夜行 (东野圭吾) (z-library.sk, 1lib.sk, z-lib.sk).epub')

writeFileSync(EPUB, minimalEpub())

/** 打不开的 epub：用来验证 400 上有可读原因。 */
const BROKEN = join(HOME, '坏掉的书.epub')

writeFileSync(BROKEN, '这不是一个 ZIP', 'utf8')

/** 扫书库时应该被跳过的 MOBI。 */
writeFileSync(join(HOME, '旧格式.mobi'), 'mobi', 'utf8')

/** PDF 的正文由注入的 extractor 提供，测试里不跑 python。 */
const PDF = join(HOME, '伊藤润二短篇精选集.pdf')

writeFileSync(PDF, '%PDF-1.7\n扫描件占位', 'utf8')

/** 没有文字层的 PDF（扫描件 / 图片漫画）。 */
const SCAN = join(HOME, '漫画.pdf')

writeFileSync(SCAN, '%PDF-1.7\n图片占位', 'utf8')

/** 注入的 PDF 正文：够长（> 200 字符），带页标记。 */
const PDF_TEXT = '[第 1 页]\n' + '伊藤润二短篇精选集：这一页有文字层。\n'.repeat(20)

/** 另一个目录，用来验证 browse 换书单。 */
const OTHER = mkdtempSync(join(TMP, 'host-smoke-b-'))

writeFileSync(join(OTHER, '另一本.md'), '# 另一本\n', 'utf8')

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

    const result = await captured.command.handler({ rawInput: ` ${BOOK}`, agent: { session: { header: { cwd: HOME } } } })

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
    await captured.command.handler({ rawInput: ` ${BOOK}`, agent: { session: { header: { cwd: HOME } } } })

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
    await captured.command.handler({ rawInput: ` ${BOOK}`, agent: { session: { header: { cwd: HOME } } } })

    for (let i = 0; i < 20; i += 1) {
      await captured.command.handler({ rawInput: 'n', agent: { session: { header: { cwd: HOME } } } })
    }

    const end = await call(captured.route, '/dsh-novel-pane/state?rows=10')

    assert.equal(end.json.line, 50, '最后一页的顶行 = 总行数 − 一页行数')

    for (let i = 0; i < 20; i += 1) {
      await captured.command.handler({ rawInput: 'p', agent: { session: { header: { cwd: HOME } } } })
    }

    const start = await call(captured.route, '/dsh-novel-pane/state?rows=10')

    assert.equal(start.json.line, 0)
  })

  test('书单列出目录里能读的文件', async () => {
    const { ctx, captured } = makeCtx()

    apply(ctx, {})

    const result = await captured.command.handler({ rawInput: ' shelf', agent: { session: { header: { cwd: HOME } } } })

    assert.match(result.text, /书单/)
    assert.match(result.text, /书\.txt/)
  })

  test('浏览器「打开」走 open-path：绝对路径和相对路径都能开', async () => {
    const { ctx, captured } = makeCtx()

    apply(ctx, {})

    const abs = await call(captured.route, '/dsh-novel-pane/move', { op: 'open-path', path: BOOK, rows: 10 })

    assert.equal(abs.code, 200)
    assert.equal(abs.json.open, true)
    assert.equal(abs.json.title, '书.txt')

    await call(captured.route, '/dsh-novel-pane/move', { op: 'close', rows: 10 })

    const rel = await call(captured.route, '/dsh-novel-pane/move', { op: 'open-path', path: '书.txt', rows: 10 })

    assert.equal(rel.json.open, true, '相对路径按上一本书的目录解析')
  })

  test('open-path 打不开时报 400，内容不动', async () => {
    const { ctx, captured } = makeCtx()

    apply(ctx, {})
    await captured.command.handler({ rawInput: ` ${BOOK}`, agent: { session: { header: { cwd: HOME } } } })

    const before = await call(captured.route, '/dsh-novel-pane/state?rows=10')
    const bad = await call(captured.route, '/dsh-novel-pane/move', { op: 'open-path', path: '没有这本.txt', rows: 10 })

    assert.equal(bad.code, 400)
    assert.equal(bad.json.error, 'not a file')

    const after = await call(captured.route, '/dsh-novel-pane/state?rows=10')

    assert.equal(after.json.file, before.json.file, '失败时仍然读原来那本')
  })

  test('browse 只换书单目录，不动当前这本书', async () => {
    const { ctx, captured } = makeCtx()

    apply(ctx, {})
    await captured.command.handler({ rawInput: ` ${BOOK}`, agent: { session: { header: { cwd: HOME } } } })

    const browsed = await call(captured.route, '/dsh-novel-pane/move', {
      op: 'browse',
      dir: OTHER,
      rows: 10,
      shelf: true,
    })

    assert.equal(browsed.json.file, BOOK)
    assert.deepEqual(browsed.json.shelf, ['另一本.md'])
  })

  test('找不到的文件报错，不把窗格打开', async () => {
    const { ctx, captured } = makeCtx()

    apply(ctx, {})

    // 状态是跨测试共用的（写盘的那份）；先明确收起，才谈得上「没被打开」
    await call(captured.route, '/dsh-novel-pane/move', { op: 'close', rows: 10 })

    const result = await captured.command.handler({ rawInput: ' 没有这本.txt', agent: { session: { header: { cwd: HOME } } } })

    assert.match(result.text, /找不到/)

    const { json } = await call(captured.route, '/dsh-novel-pane/state?rows=10')

    assert.equal(json.open, false)
  })

  test('GET /library 返回书库索引：epub / pdf 都在列表里，只有 mobi 记成跳过', async () => {
    const { ctx, captured } = makeCtx()

    apply(ctx, { library: [HOME] })

    const { code, json } = await call(captured.route, '/dsh-novel-pane/library')

    assert.equal(code, 200)
    assert.ok(Array.isArray(json.books))

    const names = json.books.map((book: any) => book.name)

    assert.ok(names.includes('书.txt'), 'txt 没进索引')
    assert.ok(names.includes('坏掉的书.epub'), 'epub 没进索引')
    assert.ok(names.includes('伊藤润二短篇精选集.pdf'), 'PDF 没进索引')

    const epub = json.books.find((book: any) => book.kind === 'epub')
    const pdf = json.books.find((book: any) => book.name === '伊藤润二短篇精选集.pdf')

    assert.notEqual(epub, undefined)
    assert.equal(epub.title, '白夜行', '书库里的标题没有洗过')
    assert.match(epub.name, /z-library/)
    assert.notEqual(pdf, undefined)
    assert.equal(pdf.title, '伊藤润二短篇精选集')

    assert.equal(json.skipped.length, 1)
    assert.equal(json.skipped[0].kind, 'mobi')
    assert.match(json.skipped[0].reason, /MOBI/)

    // 没有 /state 那样的书单字段，但契约字段都在
    assert.equal(typeof json.total, 'number')
  })

  test('open-path 打开 epub：正文按行给，标题洗干净，坏包给可读错误', async () => {
    const { ctx, captured } = makeCtx()

    apply(ctx, { library: [HOME] })

    const opened = await call(captured.route, '/dsh-novel-pane/move', {
      op: 'open-path',
      path: EPUB,
      rows: 10,
    })

    assert.equal(opened.code, 200)
    assert.equal(opened.json.title, '白夜行')
    assert.ok(opened.json.total > 0, 'epub 没抽出正文')
    assert.match(opened.json.text.join('\n'), /第一章 夜航/)
    assert.match(opened.json.text.join('\n'), /第二章 灯塔/)

    const bad = await call(captured.route, '/dsh-novel-pane/move', {
      op: 'open-path',
      path: BROKEN,
      rows: 10,
    })

    assert.equal(bad.code, 400)
    assert.equal(bad.json.error, 'unreadable')
    assert.match(String(bad.json.message), /EPUB|ZIP/)

    // 失败不换书：还在原来那本
    const state = await call(captured.route, '/dsh-novel-pane/state?rows=10')

    assert.equal(state.json.file, EPUB)
  })

  test('open-book（目录 + 名字）也能开 epub', async () => {
    const { ctx, captured } = makeCtx()

    apply(ctx, { library: [HOME] })

    await call(captured.route, '/dsh-novel-pane/move', {
      op: 'browse',
      dir: HOME,
      rows: 10,
      shelf: true,
    })

    const opened = await call(captured.route, '/dsh-novel-pane/move', {
      op: 'open-book',
      name: '白夜行 (东野圭吾) (z-library.sk, 1lib.sk, z-lib.sk).epub',
      rows: 10,
    })

    assert.equal(opened.code, 200)
    assert.equal(opened.json.title, '白夜行')
    assert.equal(opened.json.file, EPUB)
    assert.match(opened.json.text.join('\n'), /船在雾里走 & 灯是唯一的方向/)
  })

  test('open-path 打开 pdf：走 python/PyMuPDF 那链（测试里注入），并用磁盘缓存', async () => {
    const { ctx, captured } = makeCtx()

    apply(ctx, { library: [HOME] })

    let calls = 0

    setPdfExtractorForTests(async () => {
      calls += 1

      return PDF_TEXT
    })

    try {
      const opened = await call(captured.route, '/dsh-novel-pane/move', {
        op: 'open-path',
        path: PDF,
        rows: 10,
      })

      assert.equal(opened.code, 200)
      assert.equal(opened.json.title, '伊藤润二短篇精选集')
      assert.ok(opened.json.total > 0, 'pdf 没抽出正文')
      assert.match(opened.json.text.join('\n'), /有文字层/)
      assert.equal(calls, 1, '没有调用 PDF 抽取器')

      // 再开同一本：宿主内存里那本还在
      const again = await call(captured.route, '/dsh-novel-pane/move', {
        op: 'open-path',
        path: PDF,
        rows: 10,
      })

      assert.equal(again.code, 200)
      assert.equal(calls, 1)

      // 换一个宿主实例（模拟重启，内存缓存空了）→ 应该读磁盘缓存，不再抽
      const second = makeCtx()

      apply(second.ctx, { library: [HOME] })

      const reopened = await call(second.captured.route, '/dsh-novel-pane/move', {
        op: 'open-path',
        path: PDF,
        rows: 10,
      })

      assert.equal(reopened.code, 200)
      assert.match(reopened.json.text.join('\n'), /有文字层/)
      assert.equal(calls, 1, '第二次不是从磁盘缓存读的')
    } finally {
      setPdfExtractorForTests(null)
    }
  })

  test('没有文字层的 pdf：可读错误，不换书', async () => {
    const { ctx, captured } = makeCtx()

    apply(ctx, { library: [HOME] })

    await call(captured.route, '/dsh-novel-pane/move', { op: 'open-path', path: EPUB, rows: 10 })

    setPdfExtractorForTests(async () => '[第 1 页]\n图')

    try {
      const bad = await call(captured.route, '/dsh-novel-pane/move', {
        op: 'open-path',
        path: SCAN,
        rows: 10,
      })

      assert.equal(bad.code, 400)
      assert.equal(bad.json.error, 'unreadable')
      assert.match(String(bad.json.message), /没有文字层/)

      const state = await call(captured.route, '/dsh-novel-pane/state?rows=10')

      assert.equal(state.json.file, EPUB, '失败时把书换掉了')
    } finally {
      setPdfExtractorForTests(null)
    }
  })
})
