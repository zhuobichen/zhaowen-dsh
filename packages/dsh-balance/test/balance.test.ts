// 从 Claude Code 版 `deepseek-balance/tests/balance.test.tsx` 搬来的纯函数断言。
//
// 原版还用 `claude-code/testing` 起了整套 UI 会话（mount/redraw 那种）；DSH 这边
// 没有对应的 mock 引擎，所以这里只钉**能钉的**：数字、措辞、时长条。
// 直接跑：node --test test/

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ageOf,
  amountOf,
  hourlyOf,
  hourlyTextOf,
  INITIAL,
  lineOf,
  readingOf,
  samplesOf,
  withSample,
} from '../src/balance.ts'

const ANSWER = JSON.stringify({
  is_available: true,
  balance_infos: [{ currency: 'CNY', total_balance: '16.65', granted_balance: '0.00', topped_up_balance: '16.65' }],
})

const answerWith = (total: string) =>
  JSON.stringify({
    is_available: true,
    balance_infos: [{ currency: 'CNY', total_balance: total, granted_balance: '0.00', topped_up_balance: total }],
  })

const AT = 1_700_000_000_000
const MINUTE = 60_000
const HOUR = 3_600_000

/** The start of the hour that holds AT: the strip is built on these edges. */
const EDGE = Math.floor(AT / HOUR) * HOUR

describe('what one answer comes to', () => {
  test('a balance with its currency, and the number behind it', () => {
    const reading = readingOf(ANSWER, AT)

    assert.equal(reading.kind, 'ok')
    assert.equal(reading.amount, '¥16.65')
    assert.equal(reading.total, 16.65)
    assert.equal(reading.atMs, AT)
  })

  test('an account that reports nothing available is a reason, not a number', () => {
    const reading = readingOf(JSON.stringify({ is_available: false }), AT)

    assert.equal(reading.kind, 'refused')
    assert.equal(reading.amount, null)
    assert.match(reading.note ?? '', /no available balance/)
  })

  test('body that is not JSON is said to be that, never read as zero', () => {
    const reading = readingOf('<html>502 Bad Gateway</html>', AT)

    assert.equal(reading.kind, 'failed')
    assert.equal(reading.amount, null)
    assert.match(reading.note ?? '', /not JSON/)
  })

  test('a balance that is not a number is a reason too', () => {
    const reading = readingOf(answerWith('not-a-number'), AT)

    assert.equal(reading.kind, 'failed')
    assert.equal(reading.total, null)
    assert.match(reading.note ?? '', /no balance/)
  })

  test('an unknown currency keeps its code rather than guessing a symbol', () => {
    assert.equal(amountOf('JPY', '1200'), '1200 JPY')
    assert.equal(amountOf(undefined, '5'), '5')
    assert.equal(amountOf('USD', '3.00'), '$3.00')
  })
})

describe('the readings behind the strip', () => {
  test('junk in the store is dropped rather than summed', () => {
    assert.deepEqual(samplesOf('nonsense'), [])
    assert.deepEqual(samplesOf([{ atMs: 1, total: 2 }, { atMs: 'x' }, null, { atMs: 3 }]), [{ atMs: 1, total: 2 }])
  })

  test('a reading replaces one at the same moment, and old ones fall away', () => {
    const kept = withSample(
      [
        { atMs: AT - 30 * HOUR, total: 1 },
        { atMs: AT - MINUTE, total: 2 },
      ],
      { atMs: AT - MINUTE, total: 9 },
    )

    assert.deepEqual(kept, [{ atMs: AT - MINUTE, total: 9 }])
  })
})

describe('the hourly strip', () => {
  const now = EDGE + 5 * MINUTE

  test('an hour is the balance at its start less the balance at its end', () => {
    const samples = [
      { atMs: EDGE - 70 * MINUTE, total: 25 },
      { atMs: EDGE - 10 * MINUTE, total: 20 },
      { atMs: EDGE + 5 * MINUTE, total: 17.5 },
    ]

    // the last whole hour spent 5.00; the four before it were never watched
    assert.deepEqual(hourlyOf(samples, now), [null, null, null, null, 5])
  })

  test('an unwatched hour is unknown, not zero', () => {
    const samples = [
      { atMs: EDGE - 5 * MINUTE, total: 30 },
      { atMs: EDGE + 5 * MINUTE, total: 28 },
    ]

    assert.equal(hourlyOf(samples, now).at(-1), null)
  })

  test('a reading too far from an edge does not stand for it', () => {
    const samples = [
      { atMs: EDGE - 80 * MINUTE, total: 30 },
      { atMs: EDGE - 5 * MINUTE, total: 28 },
    ]

    assert.equal(hourlyOf(samples, now).at(-1), null)
  })

  test('a top-up reads as the balance rising, not as negative spending', () => {
    const samples = [
      { atMs: EDGE - 70 * MINUTE, total: 5 },
      { atMs: EDGE - 10 * MINUTE, total: 20 },
    ]

    assert.equal(hourlyOf(samples, now).at(-1), -15)
    assert.match(hourlyTextOf(hourlyOf(samples, now)), /\+15\.00/)
  })

  test('the strip spells out what it does not know', () => {
    assert.equal(hourlyTextOf([null, 0, 0.34, -15, 5]), '· 5h ? 0.00 0.34 +15.00 5.00')
    assert.equal(hourlyTextOf([]), '')
  })
})

describe('the line above the prompt', () => {
  test('carries the amount and how old the reading is', () => {
    assert.equal(lineOf(readingOf(ANSWER, AT), AT + 3 * MINUTE), 'DeepSeek ¥16.65 · 3m ago')
  })

  test('says a reading is too fresh to age', () => {
    assert.equal(ageOf(AT, AT + 20_000), 'just now')
  })

  test('carries the strip when there are hours to show', () => {
    const reading = { ...readingOf(ANSWER, AT), hours: [null, 0.34, 0, null, 5] }

    assert.equal(lineOf(reading, AT + 3 * MINUTE), 'DeepSeek ¥16.65 · 3m ago · 5h ? 0.34 0.00 ? 5.00')
  })

  test('keeps the last good number and its hours when a refresh fails', () => {
    const kept = { ...readingOf(ANSWER, AT), kind: 'failed' as const, note: 'HTTP 500', hours: [null, null, 1, 2, 3] }
    const line = lineOf(kept, AT + 12 * MINUTE)

    assert.match(line, /¥16\.65/)
    assert.match(line, /12m ago/)
    assert.match(line, /HTTP 500/)
    assert.match(line, /· 5h \? \? 1\.00 2\.00 3\.00/)
  })

  test('with no key it names the variables it looked in', () => {
    const note = 'no key in ANTHROPIC_AUTH_TOKEN or DEEPSEEK_API_KEY'
    const line = lineOf({ ...INITIAL, kind: 'no-key', atMs: AT, note }, AT)

    assert.match(line, /DEEPSEEK_API_KEY/)
    assert.match(line, /ANTHROPIC_AUTH_TOKEN/)
  })

  test('before the first answer it says it is reading', () => {
    assert.equal(lineOf(INITIAL, AT), 'DeepSeek balance: reading…')
  })
})
