// 纯函数测试：折行、分页、位置、书单——都不碰宿主，所以能直接按住。
//
// 跑：node test/paging.test.ts

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  bookFilesOf,
  cellsOf,
  clipTo,
  isStepOf,
  labelOf,
  lastLineOf,
  modeNameOf,
  modeOf,
  pageOf,
  positionOf,
  printedOf,
  progressOf,
  shelfLabelOf,
  shelfPrintOf,
  shelfTopOf,
  shelfWindowOf,
  steppedBy,
  widthOf,
  windowOf,
  wrapText,
} from '../src/paging.ts'

describe('折行', () => {
  test('汉字两格，拉丁字母一格', () => {
    assert.equal(cellsOf('中'), 2)
    assert.equal(cellsOf('a'), 1)
    assert.equal(widthOf('中a中'), 5)
  })

  test('行宽永远不超', () => {
    const lines = wrapText('一二三四五六七八九十', 6)

    for (const line of lines) assert.ok(widthOf(line) <= 6, `「${line}」宽 ${widthOf(line)}`)
  })

  test('保留段落与空行', () => {
    const lines = wrapText('第一段\n\n第二段', 40)

    assert.deepEqual(lines, ['第一段', '', '第二段'])
  })

  test('回车按换行算，不算一个字符', () => {
    assert.deepEqual(wrapText('甲\r\n乙', 40), ['甲', '乙'])
  })
})

describe('分页', () => {
  test('一页就是从位置起的 rows 行', () => {
    assert.deepEqual(pageOf(['a', 'b', 'c', 'd'], 1, 2), ['b', 'c'])
  })

  test('最后一页的顶行能放满一整页', () => {
    assert.equal(lastLineOf(100, 10), 90)
  })

  test('书比一页短时不滚进空白', () => {
    assert.equal(lastLineOf(3, 10), 0)
  })

  test('进度报页数和百分比', () => {
    assert.equal(progressOf(0, 10, 100), '第 1/10 页 · 10%')
    assert.equal(progressOf(90, 10, 100), '第 10/10 页 · 100%')
  })

  test('空书报 100% 而不是除零', () => {
    assert.equal(progressOf(0, 10, 0), '第 1/1 页 · 100%')
  })

  test('窗格正文比窗格少一行（表头占一行）', () => {
    assert.equal(windowOf(['a', 'b', 'c', 'd'], 0, 3).length, 2)
  })

  test('窗格矮到放不下一行时仍然画一行', () => {
    assert.equal(windowOf(['a', 'b'], 0, 1).length, 1)
  })
})

describe('位置词汇', () => {
  test('n/p/数字/read 是位置，文件名不是', () => {
    for (const word of ['n', 'N', 'next', 'p', 'prev', 'read', '12', ' 7 ']) {
      assert.equal(isStepOf(word), true, word)
    }

    for (const word of ['书.txt', 'a b', 'shelf']) assert.equal(isStepOf(word), false, word)
  })

  test('n 前进一屏，p 后退一屏，数字跳到那一页', () => {
    assert.equal(steppedBy('n', 0, 10, 100), 10)
    assert.equal(steppedBy('p', 50, 10, 100), 40)
    assert.equal(steppedBy('3', 0, 10, 100), 20)
    assert.equal(steppedBy('read', 42, 10, 100), 42)
  })

  test('不会走到第一行之前，也不会越过最后一页', () => {
    assert.equal(steppedBy('p', 0, 10, 100), 0)
    assert.equal(steppedBy('n', 90, 10, 100), 90)
    assert.equal(steppedBy('99', 0, 10, 100), 90)
  })

  test('不是位置词返回 null', () => {
    assert.equal(steppedBy('书.txt', 0, 10, 100), null)
  })
})

describe('模式与按钮', () => {
  test('认不得的模式退回卷轴', () => {
    assert.equal(modeOf('page'), 'page')
    assert.equal(modeOf('scroll'), 'scroll')
    assert.equal(modeOf('???'), 'scroll')
    assert.equal(modeNameOf('page'), '整屏')
  })

  test('模式键写它当前所在的模式，其余按钮不变', () => {
    const modeButton = { key: 'mode', label: '⇄ 卷轴' } as const

    assert.equal(labelOf(modeButton, 'page'), '⇄ 整屏')
    assert.equal(labelOf({ key: 'up', label: '↑' } as const, 'page'), '↑')
  })

  test('位置：卷轴说行，整屏说页', () => {
    assert.equal(positionOf(4, 10, 100, 'scroll'), '5/100')
    assert.equal(positionOf(4, 10, 100, 'page'), '第 1/10 页 · 14%')
  })
})

describe('书单', () => {
  test('只列能读的后缀，按名字排', () => {
    const names = bookFilesOf([
      { name: 'b.txt', kind: 'file' },
      { name: 'a.md', kind: 'file' },
      { name: 'c.exe', kind: 'file' },
      { name: 'dir.txt', kind: 'dir' },
    ])

    assert.deepEqual(names, ['a.md', 'b.txt'])
  })

  test('书单最后一页能放满', () => {
    assert.equal(shelfTopOf(25, 10), 15)
    assert.equal(shelfTopOf(3, 10), 0)
  })

  test('一页书单是按位置切的一段', () => {
    assert.deepEqual(shelfWindowOf(['a', 'b', 'c'], 1, 2), ['b', 'c'])
  })

  test('有读过位置的书带个点', () => {
    assert.equal(shelfLabelOf('书.txt', true), '• 书.txt')
    assert.equal(shelfLabelOf('书.txt', false), '书.txt')
  })

  test('一行书单说得清有多少本，多出来的折起来', () => {
    assert.equal(shelfPrintOf('D:/books', []), '书单 D:/books：没有能读的文件')
    assert.match(shelfPrintOf('D:/books', ['a', 'b', 'c'], 2), /还有 1 本/)
  })
})

describe('打印', () => {
  test('截断带省略号，不超预算', () => {
    assert.equal(clipTo('abcdef', 10), 'abcdef')
    assert.equal(clipTo('abcdef', 4), 'abc…')
    assert.ok(widthOf(clipTo('中文中文中文', 6)) <= 6)
  })

  test('打印一页时带上进度和翻页提示', () => {
    const text = printedOf(['a', 'b', 'c'], 0, 2)

    assert.match(text, /^a\nb\n\n第 1\/2 页 · 67%.*下一页/s)
  })
})
