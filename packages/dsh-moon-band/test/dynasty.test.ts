// 朝代表：这是「显示朝代」这件事的地基，钉住它覆盖到谁、以及不知道时老实说不知道。
//
// 跑：node test/dynasty.test.ts

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { dynastyOf, dynastyTableSize, UNKNOWN_DYNASTY } from '../src/dynasty.ts'

describe('朝代表', () => {
  test('认得语料里最高频的那些作者', () => {
    // 这几个是语料里出现次数 top10，覆盖全靠它们
    assert.equal(dynastyOf('白居易'), '唐')
    assert.equal(dynastyOf('杜甫'), '唐')
    assert.equal(dynastyOf('元稹'), '唐')
    assert.equal(dynastyOf('刘禹锡'), '唐')
    assert.equal(dynastyOf('李商隐'), '唐')
  })

  test('也认得宋人，不会把所有人都当唐人', () => {
    assert.equal(dynastyOf('苏轼'), '宋')
    assert.equal(dynastyOf('辛弃疾'), '宋')
    assert.equal(dynastyOf('李清照'), '宋')
    assert.equal(dynastyOf('陆游'), '宋')
  })

  test('其它朝代也有', () => {
    assert.equal(dynastyOf('陶渊明'), '晋')
    assert.equal(dynastyOf('曹操'), '汉')
    assert.equal(dynastyOf('李煜'), '南唐')
    assert.equal(dynastyOf('马致远'), '元')
    assert.equal(dynastyOf('唐寅'), '明')
    assert.equal(dynastyOf('纳兰性德'), '清')
  })

  test('唐代帝王按「…皇帝」认', () => {
    assert.equal(dynastyOf('太宗皇帝'), '唐')
    assert.equal(dynastyOf('玄宗皇帝'), '唐')
  })

  test('不知道就说不知道，不猜', () => {
    assert.equal(dynastyOf('无名氏'), null)
    assert.equal(dynastyOf('不详'), null)
    assert.equal(dynastyOf('某个不存在的诗人'), null)
    assert.equal(dynastyOf(''), null)
    assert.equal(dynastyOf(null), null)
    assert.equal(dynastyOf(undefined), null)
  })

  test('表够大，值得维护', () => {
    assert.ok(dynastyTableSize() >= 100, `table has only ${dynastyTableSize()} names`)
  })

  test('UNKNOWN_DYNASTY 是给 UI 的那句话', () => {
    assert.equal(UNKNOWN_DYNASTY, '朝代不详')
  })
})
