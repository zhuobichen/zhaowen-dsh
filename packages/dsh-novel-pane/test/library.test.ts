// 书库索引测试：扫描范围、PDF 说明、同名去重、标题清洗、缓存与上限。
//
// 跑：node test/library.test.ts
// 所有临时文件都落在包内 `.tmp/`（本机 OS Temp 不可写）。

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createLibraryIndex,
  DEFAULT_EXCLUDE,
  isExcluded,
  kindOf,
  scanLibrary,
  titleOf,
  trailingGroupStart,
} from '../src/library.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const TMP = join(HERE, '..', '.tmp')

mkdirSync(TMP, { recursive: true })

const WORK = mkdtempSync(join(TMP, 'library-'))
const ROOT_A = join(WORK, 'root-a')
const ROOT_B = join(WORK, 'root-b')

const put = (path: string, content = 'x'): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

// 能读的四种 + 一个真不支持的格式 + 一个同名副本
put(join(ROOT_A, 'a.txt'), '甲')
put(join(ROOT_A, 'b.md'), '# 乙')
put(join(ROOT_A, 'c.epub'), 'not really an epub，扫描只看后缀')
put(join(ROOT_A, 'd.pdf'), '%PDF-1.7')
put(join(ROOT_A, 'e.mobi'), 'mobi')
// 缺省排除规则挡掉的东西：简历、_raw 目录
put(join(ROOT_A, '简历_张三.pdf'), '%PDF-1.7')
put(join(ROOT_A, '_raw', '笔记.txt'), '原始素材')
put(join(ROOT_A, 'same.txt'), 'root-a 的那份')
put(join(ROOT_B, 'same.txt'), 'root-b 的副本')
put(
  join(ROOT_A, '白夜行 (东野圭吾) (z-library.sk, 1lib.sk, z-lib.sk).epub'),
  'x',
)
put(
  join(ROOT_A, '《科幻世界·译文版》2020年全年合集 (科幻世界) (Z-Library).epub'),
  'x',
)
put(
  join(ROOT_A, '彩虹尽头 ((美)弗诺·文奇(Vernor Vinge)著) (z-library.sk, 1lib.sk, z-lib.sk).epub'),
  'x',
)
// 深度：root/nested(1)/l2(2)/l3(3) 能到；l4(4) 不能
put(join(ROOT_A, 'nested', 'l2', 'l3', 'deep.txt'), '深处')
put(join(ROOT_A, 'nested', 'l2', 'l3', 'l4', 'too-deep.txt'), '太深')
// 隐藏目录不进
put(join(ROOT_A, '.hidden', 'secret.txt'), '隐藏')

describe('扫描范围', () => {
  const index = scanLibrary([ROOT_A, ROOT_B])
  const names = index.books.map((book) => book.name)

  test('只收 txt / md / epub / pdf', () => {
    assert.ok(names.includes('a.txt'))
    assert.ok(names.includes('b.md'))
    assert.ok(names.includes('c.epub'))
    assert.ok(names.includes('d.pdf'), 'PDF 现在应该进书库')
    assert.ok(!names.includes('e.mobi'), 'MOBI 不该进书库')
  })

  test('真不支持的格式（MOBI）记一条说明，PDF 不再进 skipped', () => {
    assert.equal(index.skipped.length, 1)
    assert.equal(index.skipped[0].name, 'e.mobi')
    assert.equal(index.skipped[0].kind, 'mobi')
    assert.match(index.skipped[0].reason, /MOBI.*不支持|不支持.*MOBI/)
  })

  test('递归到第 3 层，第 4 层和隐藏目录不扫', () => {
    assert.ok(names.includes('deep.txt'), '第 3 层没扫到')
    assert.ok(!names.includes('too-deep.txt'), '超过了深度上限还扫')
    assert.ok(!names.includes('secret.txt'), '隐藏目录被扫了')
  })

  test('类型字段对得上', () => {
    const byName = new Map(index.books.map((book) => [book.name, book]))

    assert.equal(byName.get('a.txt')!.kind, 'txt')
    assert.equal(byName.get('b.md')!.kind, 'md')
    assert.equal(byName.get('c.epub')!.kind, 'epub')
    assert.equal(byName.get('d.pdf')!.kind, 'pdf')
    assert.equal(kindOf('x.PDF'), 'pdf')
    assert.equal(kindOf('x.mobi'), null)
  })

  test('同名副本只留一条，记下折叠了几条', () => {
    const same = index.books.filter((book) => book.name === 'same.txt')

    assert.equal(same.length, 1, '两个目录里的同名文件被收了两次')
    assert.equal(same[0].dir, ROOT_A, '留下的不是第一个根目录里那份')
    assert.equal(index.duplicates, 1)
  })

  test('缺省排除：简历 / _raw 不进索引，但记了数', () => {
    assert.ok(!names.includes('简历_张三.pdf'), '简历没有被排除')
    assert.ok(!names.includes('笔记.txt'), '_raw 目录没有被排除')
    assert.ok(index.excluded >= 2)

    // 规则可覆盖：显式 exclude: [] 时它们就该出现
    const everything = scanLibrary([ROOT_A], { exclude: [] })

    assert.ok(everything.books.some((book) => book.name === '简历_张三.pdf'))
    assert.ok(everything.books.some((book) => book.name === '笔记.txt'))
    assert.equal(everything.excluded, 0)
  })

  test('排除规则：子串和正则都认，写坏的正则只按子串', () => {
    assert.equal(isExcluded('简历_张三.pdf', DEFAULT_EXCLUDE), true)
    assert.equal(isExcluded('~$草稿.docx', DEFAULT_EXCLUDE), true)
    assert.ok(isExcluded('book_raw_v2.epub', ['^book_raw']), '正则没生效')
    assert.equal(isExcluded('正常书.epub', DEFAULT_EXCLUDE), false)
    assert.equal(isExcluded('正常书.txt', ['[']), false, '坏正则不该让扫描炸掉')
  })

  test('缺根目录不炸，记进 missing', () => {
    const missing = scanLibrary([join(WORK, '没有这个目录')])

    assert.equal(missing.books.length, 0)
    assert.deepEqual(missing.missing, [join(WORK, '没有这个目录')])
  })
})

describe('标题清洗', () => {
  test('白夜行去掉作者括注和 z-library 尾巴', () => {
    assert.equal(
      titleOf('白夜行 (东野圭吾) (z-library.sk, 1lib.sk, z-lib.sk).epub'),
      '白夜行',
    )
  })

  test('嵌套括注整段剥掉', () => {
    assert.equal(
      titleOf('彩虹尽头 ((美)弗诺·文奇(Vernor Vinge)著) (z-library.sk, 1lib.sk, z-lib.sk).epub'),
      '彩虹尽头',
    )
  })

  test('副标题只留中文名', () => {
    assert.equal(
      titleOf('当尼采哭泣 = When Nietzsche Wept ([美] 欧文 · 亚隆 著) (z-library.sk, 1lib.sk, z-lib.sk).epub'),
      '当尼采哭泣',
    )
  })

  test('卷册 / 版本括注是标题的一部分，不能删', () => {
    assert.equal(
      titleOf('当下的力量 (白金版) = The Power of Now ([德] 埃克哈特 · 托利 著) (Z-Library).epub'),
      '当下的力量 (白金版)',
    )
  })

  test('普通文件名只去后缀', () => {
    assert.equal(titleOf('a.txt'), 'a')
    assert.equal(titleOf('读书笔记.md'), '读书笔记')
    assert.equal(titleOf('伊藤润二短篇精选集.pdf'), '伊藤润二短篇精选集')
  })

  test('末尾括号的起点认得嵌套', () => {
    const text = '彩虹尽头 ((美)弗诺·文奇(Vernor Vinge)著)'

    assert.equal(text.slice(trailingGroupStart(text)), '((美)弗诺·文奇(Vernor Vinge)著)')
  })
})

describe('索引里的书', () => {
  test('标题字段是洗过的，name 保留原名', () => {
    const index = scanLibrary([ROOT_A])
    const book = index.books.find((entry) => entry.name.startsWith('白夜行'))

    assert.notEqual(book, undefined)
    assert.equal(book!.title, '白夜行')
    assert.match(book!.name, /z-library/)
    assert.equal(book!.kind, 'epub')
    assert.ok(book!.path.endsWith(book!.name))
    assert.equal(book!.id.length, 16)
  })
})

describe('缓存与上限', () => {
  test('第二次取索引命中缓存；refresh 才重扫', () => {
    const cache = createLibraryIndex([ROOT_A])
    const first = cache.get()
    const second = cache.get()

    assert.equal(first, second, '第二次没有命中进程内缓存')

    const refreshed = cache.get(true)

    assert.notEqual(refreshed, first, 'refresh 没有重扫')
    assert.equal(refreshed.books.length, first.books.length)

    writeFileSync(join(ROOT_A, '新的.txt'), '新书', 'utf8')

    const after = cache.get(true)

    assert.ok(after.books.some((book) => book.name === '新的.txt'), '重扫没有看到新文件')
  })

  test('数量上限：收够了就停，并标 truncated', () => {
    const index = scanLibrary([ROOT_A], { maxBooks: 2 })

    assert.equal(index.books.length, 2)
    assert.equal(index.truncated, true)
  })

  test('时间上限：预算为 0 时不扫，直接标 truncated', () => {
    const index = scanLibrary([ROOT_A], { budgetMs: 0 })

    assert.equal(index.truncated, true)
  })

  test('id 只由路径决定，扫两次一样', () => {
    const pick = (index: ReturnType<typeof scanLibrary>) =>
      index.books.find((book) => book.name === 'a.txt')!.id

    assert.equal(pick(scanLibrary([ROOT_A])), pick(scanLibrary([ROOT_A])))
  })
})
