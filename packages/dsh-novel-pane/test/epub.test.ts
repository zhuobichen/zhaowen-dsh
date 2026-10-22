// EPUB 抽取测试：ZIP 中央目录、spine 顺序、去标签、磁盘缓存。
//
// 跑：node test/epub.test.ts
// 所有临时文件都落在包内 `.tmp/`（本机 OS Temp 不可写）。

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  epubCacheKey,
  extractEpubText,
  htmlToText,
  readEpubText,
  readZipEntries,
} from '../src/epub.ts'
import { encryptedEpub, fontObfuscatedEpub, minimalEpub } from './epub-fixture.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const TMP = join(HERE, '..', '.tmp')

mkdirSync(TMP, { recursive: true })

const WORK = mkdtempSync(join(TMP, 'epub-'))
const CACHE = join(WORK, 'cache')
const BOOK = join(WORK, '测试书.epub')

writeFileSync(BOOK, minimalEpub())

describe('ZIP', () => {
  test('读得出中央目录里的条目名（含 UTF-8 中文名）', () => {
    const entries = readZipEntries(minimalEpub())
    const names = entries.map((entry) => entry.name)

    assert.ok(names.includes('mimetype'), '缺 mimetype')
    assert.ok(names.includes('META-INF/container.xml'), '缺 container.xml')
    assert.ok(names.includes('OEBPS/第一章.xhtml'), '中文文件名没有按 UTF-8 解出来')
    assert.ok(names.includes('OEBPS/chapter2.xhtml'))
  })

  test('不是 ZIP 的文件给出可读错误，而不是静默返回空', () => {
    assert.throws(() => readZipEntries(Buffer.from('这不是一个 zip 文件，但是长度够')), /不是有效的 ZIP/)
  })
})

describe('正文抽取', () => {
  test('按 spine 顺序合并，去标签，head 里的东西不算正文', () => {
    const text = extractEpubText(minimalEpub())

    assert.ok(text.includes('第一章 夜航'), '缺第一章')
    assert.ok(text.includes('船在雾里走 & 灯是唯一的方向。'), '实体没有解码成 &')
    assert.ok(text.includes('第二段：没有标签。'))
    assert.ok(text.includes('第二章 灯塔'), '缺第二章')
    assert.ok(!/<[a-z/][^>]*>/i.test(text), '标签没有去干净')
    assert.ok(!text.includes('不该出现的标题'), 'head 里的 <title> 被当成正文了')

    // spine 说 c1 → c2；manifest 里 c2 写在前面，不能被 manifest 顺序带跑
    const order = ['第一章 夜航', '船在雾里走', '第二段', '第二章 灯塔'].map((word) => text.indexOf(word))

    for (let index = 1; index < order.length; index += 1) {
      assert.ok(order[index] > order[index - 1], '正文顺序不是 spine 顺序')
    }
  })

  test('htmlToText：块级标签换行、行内标签直接去掉、空行不占位', () => {
    const text = htmlToText('<p>甲 <b>乙</b></p><p>丙<br/>丁</p>')

    assert.equal(text, '甲 乙\n丙\n丁')
  })
})

describe('磁盘缓存', () => {
  test('第一次抽取写缓存，第二次直接读缓存', () => {
    const first = readEpubText(BOOK, { cacheDir: CACHE })

    assert.equal(first.cached, false, '第一次不该报缓存命中')
    assert.ok(existsSync(first.cacheFile), '没有写缓存文件')
    assert.equal(readFileSync(first.cacheFile, 'utf8'), first.text)
    assert.equal(first.cacheFile, join(CACHE, epubCacheKey(BOOK) + '.txt'))

    // 把缓存改成一个哨兵：第二次还能读到哨兵，就证明它读的是缓存而不是又抽了一遍
    writeFileSync(first.cacheFile, 'CACHED-SENTINEL', 'utf8')

    const second = readEpubText(BOOK, { cacheDir: CACHE })

    assert.equal(second.cached, true, '第二次没有命中缓存')
    assert.equal(second.text, 'CACHED-SENTINEL', '第二次不是从缓存读的')

    // 关掉缓存就得重新抽，并且把缓存覆盖回真正文
    const fresh = readEpubText(BOOK, { cacheDir: CACHE, useCache: false })

    assert.equal(fresh.cached, false)
    assert.ok(fresh.text.includes('第一章 夜航'))
    assert.equal(readFileSync(first.cacheFile, 'utf8'), fresh.text)
  })
})

describe('坏包与 DRM', () => {
  test('加密的正文报「已加密」，不返回半本书', () => {
    assert.throws(() => extractEpubText(encryptedEpub()), /加密|DRM/)
  })

  test('只混淆字体的 EPUB 仍然能读', () => {
    const text = extractEpubText(fontObfuscatedEpub())

    assert.ok(text.includes('第一章 夜航'))
  })

  test('打不开的 epub 抛错而不是空字符串', () => {
    const broken = join(WORK, 'broken.epub')

    writeFileSync(broken, Buffer.from('PK 但不是 zip'))

    assert.throws(() => readEpubText(broken, { cacheDir: CACHE }), /EPUB 打不开|不是有效的 ZIP/)
  })
})
