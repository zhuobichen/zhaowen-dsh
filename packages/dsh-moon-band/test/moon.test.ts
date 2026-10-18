// 纯函数测试：月和诗都不碰引擎，所以这里能直接把它们按住。
//
// 盯的四件事：表是不是严格四相轮转、插值在发布时刻上是否**正好**落相、
// 月龄是不是「距新月的真实天数」、一轮语料是否走遍且不重。
//
// 跑：node test/moon.test.ts

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  instantsOf,
  lineOf,
  moonAt,
  poemAt,
  poemIndexAt,
  poemsOf,
  POEMS,
  POEM_SLOT_MS,
} from '../src/moon.ts'

const DAY = 86_400_000
const HOUR = 3_600_000

describe('相时刻表', () => {
  test('严格四相轮转，四分相间隔 6.5–8.3 天', () => {
    const table = instantsOf()

    assert.ok(table.length >= 8, '表太短')
    assert.equal(table.length % 4, 1, '表必须以一个四分相收尾（首项下弦 + 4 的倍数）')

    // 界的来历：这一版表里实测 6.68–8.02 天。README 里写的「6.7–8.2」是取的
    // 整，按它卡会误伤 10-26 那一段（6.68）。所以界放到真实数据外面一点，
    // 同时用「连续四个四分相 ≈ 一个朔望月」这条物理约束盯住整体。
    for (let i = 1; i < table.length; i += 1) {
      const gap = (table[i] - table[i - 1]) / DAY

      assert.ok(gap > 6.5 && gap < 8.3, `第 ${i} 段间隔 ${gap.toFixed(2)} 天，超出 6.5–8.3`)
    }

    for (let i = 4; i < table.length; i += 4) {
      const month = (table[i] - table[i - 4]) / DAY

      assert.ok(Math.abs(month - 29.53) < 0.6, `第 ${i} 个朔望月 ${month.toFixed(2)} 天，偏离 29.53 太多`)
    }
  })

  test('单调递增', () => {
    const table = instantsOf()

    for (let i = 1; i < table.length; i += 1) assert.ok(table[i] > table[i - 1])
  })
})

describe('月相与月龄', () => {
  test('发布时刻上正好落在对应的相', () => {
    const table = instantsOf()
    const names = ['下弦月', '新月', '上弦月', '满月']

    // 表从下弦开头，第 i 项的相名是 names[i % 4]
    for (let i = 0; i < table.length; i += 1) {
      const moon = moonAt(table[i])

      assert.equal(moon.name, names[i % 4], `第 ${i} 项应该是 ${names[i % 4]}`)
      assert.equal(moon.isEstimated, false)
    }
  })

  test('新月的月龄是 0', () => {
    const table = instantsOf()

    for (let i = 1; i < table.length; i += 4) {
      assert.ok(moonAt(table[i]).ageDays < 0.01, `第 ${i} 项（新月）月龄应为 0`)
    }
  })

  test('月龄是距新月的真实天数，不是相位占比', () => {
    const table = instantsOf()
    // 2026-10-15 正午：10-10 新月之后 4.5 天左右
    const at = Date.UTC(2026, 9, 15, 4, 0, 0)
    const moon = moonAt(at)
    const since = (at - table[1]) / DAY

    assert.ok(Math.abs(moon.ageDays - since) < 0.001, `月龄 ${moon.ageDays} 应等于 ${since}`)
  })

  test('表外承认自己在估', () => {
    const table = instantsOf()
    const before = moonAt(table[0] - HOUR)
    const after = moonAt(table[table.length - 1] + HOUR)

    assert.equal(before.isEstimated, true)
    assert.equal(after.isEstimated, true)
    assert.ok(lineOf(table[0] - HOUR).startsWith('≈'))
    assert.ok(lineOf(table[table.length - 1] + HOUR).startsWith('≈'))
  })

  test('相名不越界（永远不会给出第 9 个名字）', () => {
    const table = instantsOf()
    const names = new Set(['新月', '娥眉月', '上弦月', '盈凸月', '满月', '亏凸月', '下弦月', '残月'])

    for (let t = table[0]; t < table[table.length - 1]; t += 6 * HOUR) {
      assert.ok(names.has(moonAt(t).name), `未知名相 @${t}`)
    }
  })
})

describe('语料解析', () => {
  test('缺一半的行、空行、重复行都丢掉', () => {
    const parsed = poemsOf('甲\t出处A\n\n只有诗没有出处\n乙\t出处B\n甲\t出处C\n丙\t\n')

    assert.deepEqual(parsed, [
      { line: '甲', from: '出处A' },
      { line: '乙', from: '出处B' },
    ])
  })

  test('空语料退回内置 8 句', () => {
    assert.equal(poemAt(0, []).line, POEMS[poemIndexAt(0, POEMS.length)].line)
  })
})

describe('选句', () => {
  const N = 97
  const corpus = Array.from({ length: N }, (_, i) => ({ line: `句${String(i)}`, from: `出处${String(i)}` }))

  test('一轮走遍每一句且不重复', () => {
    const seen = new Set<number>()

    for (let slot = 0; slot < N; slot += 1) {
      const index = poemIndexAt(slot, N)

      assert.ok(!seen.has(index), `第 ${slot} 格重复取了 ${index}`)
      seen.add(index)
    }

    assert.equal(seen.size, N)
  })

  test('一轮之内相邻两格不会是同一句', () => {
    for (let slot = 1; slot < N; slot += 1) {
      assert.notEqual(poemIndexAt(slot, N), poemIndexAt(slot - 1, N))
    }
  })

  test('下一轮换一种顺序', () => {
    const first = Array.from({ length: 10 }, (_, i) => poemIndexAt(i, N))
    const second = Array.from({ length: 10 }, (_, i) => poemIndexAt(N + i, N))

    assert.notDeepEqual(first, second)
  })

  test('同一分钟内不变，跨分钟才换', () => {
    const t = 1_700_000_040_000

    assert.equal(poemAt(t, corpus).line, poemAt(t + POEM_SLOT_MS - 1, corpus).line)
    assert.notEqual(poemAt(t, corpus).line, poemAt(t + POEM_SLOT_MS, corpus).line)
  })
})

describe('那一行', () => {
  test('形状：glyph 相名 月龄天 · 「句」出处', () => {
    const table = instantsOf()
    const line = lineOf(table[3] + 2 * DAY, POEMS)

    // 必须带 `u`：emoji 是代理对，字符类不开 u 时只匹配半个码元
    assert.match(line, /^[🌑🌒🌓🌔🌕🌖🌗🌘] \S+ \d+\.\d天 · 「.+」.+$/u)
  })

  test('用给的语料，不是内置的', () => {
    const line = lineOf(1_700_000_000_000, [{ line: '测试句', from: '测试出处' }])

    assert.ok(line.includes('「测试句」测试出处'))
  })
})
