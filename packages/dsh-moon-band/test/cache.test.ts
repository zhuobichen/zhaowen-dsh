// 详解缓存：这是「同一首诗第二次不再问 AI」的实现，也是这次改动里最该钉的一块。
//
// 跑：node test/cache.test.ts

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { aboutParse, aboutPromptOf, PoemCache } from '../src/cache.ts'

const GOOD = JSON.stringify({
  dynasty: '唐',
  year: '约 725 年（开元十三年）',
  meaning: '游子抬头看见月亮，低头就想起了故乡。',
  background: '李白二十六岁客居扬州，秋夜独处，思乡而作。',
})

describe('解析模型输出', () => {
  test('正常 JSON', () => {
    const about = aboutParse(GOOD, 123)

    assert.notEqual(about, null)
    assert.equal(about!.dynasty, '唐')
    assert.equal(about!.year, '约 725 年（开元十三年）')
    assert.match(about!.meaning, /故乡/)
    assert.match(about!.background, /扬州/)
    assert.equal(about!.atMs, 123)
  })

  test('套了 ```json 围栏也能解', () => {
    const about = aboutParse('```json\n' + GOOD + '\n```', 1)

    assert.equal(about?.dynasty, '唐')
  })

  test('前后有多余的话也能解', () => {
    const about = aboutParse(`好的，这是解读：\n${GOOD}\n希望有帮助。`, 1)

    assert.equal(about?.dynasty, '唐')
  })

  test('模型没给朝代/年份时留 null，不编', () => {
    const about = aboutParse(JSON.stringify({ meaning: '甲', background: '乙' }), 1)

    assert.equal(about?.dynasty, null)
    assert.equal(about?.year, null)
  })

  test('完全不是 JSON 就返回 null（这次不写缓存）', () => {
    assert.equal(aboutParse('抱歉我无法回答', 1), null)
    assert.equal(aboutParse('', 1), null)
  })

  test('连正文都没有的 JSON 也算失败', () => {
    assert.equal(aboutParse('{"dynasty":"唐"}', 1), null)
  })
})

describe('prompt', () => {
  test('把诗句和出处都带进去，并要求纯 JSON', () => {
    const { system, user } = aboutPromptOf('举头望明月', '李白《静夜思》')

    assert.match(user, /举头望明月/)
    assert.match(user, /李白《静夜思》/)
    assert.match(system, /JSON/)
  })
})

describe('缓存落盘', () => {
  test('存了之后，换个实例（模拟重启）还读得到', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-moon-cache-'))

    try {
      const path = join(dir, 'poems-cache.json')
      const first = new PoemCache(path)

      await first.load()
      assert.equal(first.get('举头望明月，低头思故乡。'), undefined)

      await first.put('举头望明月，低头思故乡。', {
        dynasty: '唐',
        year: null,
        meaning: '抬头看月，低头想家。',
        background: '客居扬州时作。',
        atMs: 42,
      })

      const second = new PoemCache(path)

      await second.load()

      const hit = second.get('举头望明月，低头思故乡。')

      assert.equal(hit?.dynasty, '唐')
      assert.equal(hit?.meaning, '抬头看月，低头想家。')
      assert.equal(second.size, 1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('文件不存在或坏掉时当空缓存，不炸', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-moon-cache-'))

    try {
      const missing = new PoemCache(join(dir, 'nope', 'x.json'))

      await missing.load()
      assert.equal(missing.size, 0)

      const broken = new PoemCache(join(dir, 'broken.json'))

      await broken.load()
      assert.equal(broken.size, 0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
