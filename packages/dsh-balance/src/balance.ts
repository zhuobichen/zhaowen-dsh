// The numbers and the wording, with no engine calls in them, so a test can
// hold them to account without a session.
//
// Nothing here invents a figure: a reading the meter could not take comes back
// as the reason it could not, and an hour the meter did not watch is `?` —
// never a zero it cannot prove.
//
// 这一段是从 Claude Code 版 `deepseek-balance/hooks/balance.ts` **原样搬过来的**：
// 纯函数、不碰任何宿主 API，所以两边跑出来的字符串逐字一致。

import type { Reading, Sample } from './types.js'

/** DeepSeek's own balance endpoint, the one its console reads. */
export const BALANCE_URL = 'https://api.deepseek.com/user/balance'

/**
 * Where the key is looked for, in order. The session's own key is the one this
 * bills, so it comes first: a session pointed at DeepSeek keeps it in
 * `ANTHROPIC_AUTH_TOKEN` (Claude Code's variable, set in settings `env`), and
 * `DEEPSEEK_API_KEY` is the fallback for when only that one is set.
 */
export const KEY_VARS = ['ANTHROPIC_AUTH_TOKEN', 'DEEPSEEK_API_KEY'] as const

/** How long between refreshes: the balance moves slowly, and each one is a request. */
export const REFRESH_MS = 5 * 60 * 1000

/** How many hours the strip shows, and how long the readings behind it are kept. */
export const HOURS_SHOWN = 5
export const HOUR_MS = 60 * 60 * 1000
const KEEP_MS = 26 * HOUR_MS
const KEEP_COUNT = 400

/**
 * How far a reading may sit from an hour's edge and still stand for the balance
 * there. Five-minute readings land inside this; a reading from the far side of
 * an unwatched stretch does not, which leaves that hour unknown rather than
 * charging it with someone else's spending.
 */
export const BOUNDARY_MS = 15 * 60 * 1000

export const INITIAL: Reading = { kind: 'pending', amount: null, total: null, atMs: 0, note: null, hours: [] }

/** What DeepSeek answers, to the extent this meter reads it. */
type Payload = {
  is_available?: boolean
  balance_infos?: { currency?: string; total_balance?: string }[]
}

/** The amount with its currency, as DeepSeek spells it; an unknown code keeps the code. */
export const amountOf = (currency: string | undefined, total: string): string => {
  if (currency === 'CNY') return `¥${total}`
  if (currency === 'USD') return `$${total}`

  return currency === undefined || currency === '' ? total : `${total} ${currency}`
}

/** What one answer comes to, or why it is not a balance. */
export const readingOf = (body: string, atMs: number): Reading => {
  let payload: Payload

  try {
    payload = JSON.parse(body) as Payload
  } catch {
    return { ...INITIAL, kind: 'failed', atMs, note: 'the answer was not JSON' }
  }

  if (payload.is_available === false) {
    return { ...INITIAL, kind: 'refused', atMs, note: 'the account reports no available balance' }
  }

  const info = payload.balance_infos?.[0]
  const total = Number(info?.total_balance)

  if (info?.total_balance === undefined || !Number.isFinite(total)) {
    return { ...INITIAL, kind: 'failed', atMs, note: 'the answer named no balance' }
  }

  return {
    kind: 'ok',
    amount: amountOf(info.currency, info.total_balance),
    total,
    atMs,
    note: null,
    hours: [],
  }
}

/** The readings a store holds, as far as they are readings. */
export const samplesOf = (raw: unknown): Sample[] => {
  if (!Array.isArray(raw)) return []

  return raw
    .filter(
      (one): one is Sample =>
        typeof one === 'object' &&
        one !== null &&
        Number.isFinite((one as Sample).atMs) &&
        Number.isFinite((one as Sample).total),
    )
    .sort((a, b) => a.atMs - b.atMs)
}

/** The readings with this one added, oldest dropped once they are a day old. */
export const withSample = (samples: Sample[], sample: Sample): Sample[] => {
  const list = [...samples.filter(one => one.atMs !== sample.atMs), sample].sort((a, b) => a.atMs - b.atMs)
  const since = sample.atMs - KEEP_MS

  return list.filter(one => one.atMs >= since).slice(-KEEP_COUNT)
}

/**
 * The spending of each of the last `count` whole hours, oldest first: the
 * balance at an hour's start less the balance at its end. `null` where a
 * reading was too far from an edge to speak for it, and a negative number when
 * the balance rose (a top-up).
 *
 * The hour in progress is left out: a part of an hour would read as a cheap hour.
 */
export const hourlyOf = (samples: Sample[], nowMs: number, count = HOURS_SHOWN): (number | null)[] => {
  const edge = Math.floor(nowMs / HOUR_MS) * HOUR_MS
  const at = (ms: number): Sample | null => {
    for (let i = samples.length - 1; i >= 0; i -= 1) {
      const one = samples[i]

      if (one.atMs <= ms) return ms - one.atMs <= BOUNDARY_MS ? one : null
    }

    return null
  }

  const hours: (number | null)[] = []

  for (let back = count; back >= 1; back -= 1) {
    const start = at(edge - back * HOUR_MS)
    const end = at(edge - (back - 1) * HOUR_MS)

    hours.push(start === null || end === null ? null : Math.round((start.total - end.total) * 100) / 100)
  }

  return hours
}

/** The strip: `0.34` spent, `?` unwatched, `+3.00` when the balance rose. */
export const hourlyTextOf = (hours: (number | null)[]): string => {
  if (hours.length === 0) return ''

  const cells = hours.map(one => {
    if (one === null) return '?'
    if (one < 0) return `+${Math.abs(one).toFixed(2)}`

    return one.toFixed(2)
  })

  return `· ${hours.length}h ${cells.join(' ')}`
}

/** How long ago a reading was taken, in the shortest form that still reads as English. */
export const ageOf = (atMs: number, nowMs: number): string => {
  const minutes = Math.round((nowMs - atMs) / 60_000)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.round(minutes / 60)

  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}

/** The one line above the prompt. */
export const lineOf = (reading: Reading, nowMs: number): string => {
  const strip = hourlyTextOf(reading.hours)
  const tail = strip === '' ? '' : ` ${strip}`

  switch (reading.kind) {
    case 'pending':
      return 'DeepSeek balance: reading…'
    case 'no-key':
    case 'refused':
      return `DeepSeek balance: ${reading.note ?? 'not available'}`
    case 'failed':
      return reading.amount === null
        ? `DeepSeek balance: ${reading.note ?? 'the request failed'}`
        : `DeepSeek ${reading.amount} · ${ageOf(reading.atMs, nowMs)} · refresh failed: ${reading.note ?? 'unknown'}${tail}`
    case 'ok':
      return `DeepSeek ${reading.amount} · ${ageOf(reading.atMs, nowMs)}${tail}`
  }
}
