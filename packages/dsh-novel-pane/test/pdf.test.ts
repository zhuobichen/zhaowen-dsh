// PDF 抽取测试：可注入的 extractor（不真跑 python）+ 一条真跑 PyMuPDF 的用例。
//
// 跑：node test/pdf.test.ts
// 临时文件落在包内 `.tmp/`（本机 OS Temp 不可写）。

import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  PdfNoTextError,
  pdfCacheKey,
  pythonCandidates,
  readPdfText,
  setPdfExtractorForTests,
} from '../src/pdf.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const TMP = join(HERE, '..', '.tmp')

mkdirSync(TMP, { recursive: true })

const WORK = mkdtempSync(join(TMP, 'pdf-'))
const CACHE = join(WORK, 'cache')

/** 每个用例用不同的文件：缓存键按路径算，避免互相命中。 */
const fileOf = (name: string): string => {
  const path = join(WORK, name)

  writeFileSync(path, '%PDF-1.7\n假的，只用来说明路径存在', 'utf8')

  return path
}

const BOOK = fileOf('一本漫画.pdf')
const BROKEN = fileOf('坏掉的.pdf')
const SHORT = fileOf('没有文字层.pdf')

const cacheFileOf = (file: string): string => join(CACHE, pdfCacheKey(file) + '.txt')

const LONG = '第一段：抽出来的正文。\n'.repeat(30) // > 200 字符，过得了「有文字层」的门槛

describe('可注入的抽取链', () => {
  afterEach(() => setPdfExtractorForTests(null))

  test('成功 → 写缓存；第二次不再调 extractor', async () => {
    let calls = 0

    setPdfExtractorForTests(async () => {
      calls += 1

      return LONG
    })

    const first = await readPdfText(BOOK, { cacheDir: CACHE })

    assert.equal(first.cached, false)
    assert.equal(calls, 1, '第一次没有调用 extractor')
    assert.equal(first.text, LONG)
    assert.ok(existsSync(first.cacheFile), '成功抽取后没有写缓存')

    // 把缓存换成长哨兵：第二次还能读到它，就证明读的是缓存、没再 spawn python
    const sentinel = '缓'.repeat(250)

    writeFileSync(first.cacheFile, sentinel, 'utf8')

    const second = await readPdfText(BOOK, { cacheDir: CACHE })

    assert.equal(second.cached, true, '第二次没有命中缓存')
    assert.equal(second.text, sentinel, '第二次不是从缓存读的')
    assert.equal(calls, 1, '第二次仍然调用了 extractor')

    const fresh = await readPdfText(BOOK, { cacheDir: CACHE, useCache: false })

    assert.equal(fresh.cached, false)
    assert.equal(calls, 2, 'useCache:false 时应该重新抽')
  })

  test('抽取失败 → 可读错误，且不写缓存', async () => {
    setPdfExtractorForTests(async () => {
      throw new Error('PyMuPDF 说这个文件坏了')
    })

    await assert.rejects(
      () => readPdfText(BROKEN, { cacheDir: CACHE }),
      /PyMuPDF 说这个文件坏了/,
    )
    assert.equal(existsSync(cacheFileOf(BROKEN)), false, '失败不该留下缓存')
  })

  test('正文太短 → 判为没有文字层（PdfNoTextError），且不写缓存', async () => {
    setPdfExtractorForTests(async () => '[第 1 页]\n图')

    await assert.rejects(
      () => readPdfText(SHORT, { cacheDir: CACHE }),
      (error: unknown) => error instanceof PdfNoTextError && /没有文字层/.test((error as Error).message),
    )
    assert.equal(existsSync(cacheFileOf(SHORT)), false, '没有文字层不该写缓存')
  })

  test('候选解释器：配置优先，其次 python，再 py -3', () => {
    assert.deepEqual(pythonCandidates(), [['python'], ['py', '-3']])
    assert.deepEqual(pythonCandidates('C:\\Python311\\python.exe'), [
      ['C:\\Python311\\python.exe'],
      ['python'],
      ['py', '-3'],
    ])
  })
})

// ---- 真跑一遍 PyMuPDF（机器上没装就 skip） ------------------------------

const PY_MAKE_PDF = `import sys
import pymupdf
path, sentence = sys.argv[1], sys.argv[2]
doc = pymupdf.open()
page = doc.new_page()
page.insert_textbox(pymupdf.Rect(50, 50, 545, 700), sentence, fontsize=11)
doc.save(path)
doc.close()
`

const probe = (): string[] | null => {
  for (const argv of [['python'], ['py', '-3']]) {
    const result = spawnSync(argv[0], [...argv.slice(1), '-c', 'import pymupdf'], {
      encoding: 'utf8',
      timeout: 20_000,
    })

    if (result.status === 0) return argv
  }

  return null
}

const python = probe()

const SENTENCE = 'The quick brown fox jumps over the lazy dog.'
const PARAGRAPH = `${SENTENCE} ${'PDF extraction with PyMuPDF works. '.repeat(12)}`

test(
  '真跑：用 PyMuPDF 现造一页 PDF，能抽出写进去的话',
  { skip: python === null ? '本机没有 python + PyMuPDF' : false },
  async () => {
    const made = join(WORK, '真·一页.pdf')
    const result = spawnSync(
      python![0],
      [...python!.slice(1), '-c', PY_MAKE_PDF, made, PARAGRAPH],
      { encoding: 'utf8', timeout: 60_000 },
    )

    assert.equal(result.status, 0, `造 PDF 失败：${result.stderr}`)
    assert.ok(existsSync(made))

    const text = await readPdfText(made, { cacheDir: CACHE })

    assert.ok(text.text.includes(SENTENCE), '没有抽出写进去的句子')
    assert.ok(text.text.includes('[第 1 页]'), '没有按页加标记')
    assert.equal(text.cached, false)
    assert.ok(existsSync(text.cacheFile), '真跑也没有写缓存')
  },
)
