// 一致性地表：宿主侧 src/balance.ts 的 lineOf 与客户端真实产物
// dsh-client-ui-balance/client/client.js 的 lineOf，必须逐字相同。
//
// 客户端信封只能 require 静态表里的包，拿不到宿主源码，所以那份措辞是**抄过去的**。
// 抄的东西会漂移——这个测试就是防漂移的那颗钉子：它加载的是**真正会被下发给浏览器
// 的那个文件**（不是另抄一份），任何一边改了措辞都会当场变红。
//
// 跑：node test/parity.test.ts

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { INITIAL, lineOf as hostLineOf, readingOf } from '../src/balance.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT_FILE = join(HERE, '..', '..', 'dsh-client-ui-balance', 'client', 'client.js')

/** 客户端信封要求的那层窗口对象；这一句必须在 import 之前挂上。 */
type Registration = { id: string; factory: (require: (name: string) => unknown) => any }

/** 模块只会执行一次（ESM 缓存），所以这里也得只加载一次。 */
let loaded: any

const loadClient = async (): Promise<any> => {
  if (loaded !== undefined) return loaded

  let registration: Registration | undefined

  ;(globalThis as any).window = {
    __ModuleLoader__: {
      load: (candidate: Registration) => {
        registration = candidate
      },
    },
  }

  await import(pathToFileURL(CLIENT_FILE).href)

  assert.notEqual(registration, undefined, '客户端的 client.js 没有调用 window.__ModuleLoader__.load')

  // factory 里的 require 只在这个测试里被调用到 react / react/jsx-runtime 两行
  // import；lineOf 用不上它们，给个空壳就够了。
  const stub = (name: string): unknown =>
    name === 'react' ? { useState: () => [0, () => {}], useEffect: () => {} } : { jsx: () => null }

  const mod = registration!.factory(stub)

  // 信封的 id 必须等于包名，否则宿主那边的模块图对不上。
  assert.equal(registration!.id, '@zhuobichen/dsh-client-ui-balance', '客户端信封的 id 要等于包名')

  loaded = mod

  return mod
}

const ANSWER = JSON.stringify({
  is_available: true,
  balance_infos: [{ currency: 'CNY', total_balance: '16.65' }],
})

const AT = 1_700_000_000_000
const MINUTE = 60_000

/** 两边都要能算出来的同一批读数。 */
const readings = () => {
  const ok = readingOf(ANSWER, AT)

  return [
    ['还没读过', INITIAL],
    ['普通读数', ok],
    ['带时长条', { ...ok, hours: [null, 0.34, 0, null, 5] }],
    ['充值了', { ...ok, hours: [null, 0, 0.34, -15, 5] }],
    ['全是未知', { ...ok, hours: [null, null, null, null, null] }],
    ['刷新失败但留着数字', { ...ok, kind: 'failed' as const, note: 'HTTP 500', hours: [null, null, 1, 2, 3] }],
    ['失败且没数字', { ...INITIAL, kind: 'failed' as const, atMs: AT, note: 'the answer was not JSON' }],
    ['没有密钥', { ...INITIAL, kind: 'no-key' as const, atMs: AT, note: 'no key in ANTHROPIC_AUTH_TOKEN or DEEPSEEK_API_KEY' }],
    ['账户不肯给', { ...INITIAL, kind: 'refused' as const, atMs: AT, note: 'the account reports no available balance' }],
  ] as const
}

describe('客户端与宿主的措辞一致', () => {
  test('同一条读数、同一个时刻，两边算出的行完全相同', async () => {
    const client = await loadClient()

    for (const [label, reading] of readings()) {
      for (const drift of [0, 20_000, 3 * MINUTE, 42 * MINUTE, 5 * 60 * MINUTE, 30 * 60 * MINUTE]) {
        const now = AT + drift

        assert.equal(
          client.lineOf(reading, now),
          hostLineOf(reading as any, now),
          `${label}（+${drift}ms）两边不一致`,
        )
      }
    }
  })

  test('客户端把 null 读成空行，不报错', async () => {
    const client = await loadClient()

    assert.equal(client.lineOf(null, AT), '')
    assert.equal(client.lineOf(undefined, AT), '')
  })

  test('客户端自己也会算时长条和 age', async () => {
    const client = await loadClient()

    assert.equal(client.hourlyTextOf([null, 0, 0.34, -15, 5]), '· 5h ? 0.00 0.34 +15.00 5.00')
    assert.equal(client.hourlyTextOf([]), '')
    assert.equal(client.ageOf(AT, AT + 20_000), 'just now')
    assert.equal(client.ageOf(AT, AT + 3 * MINUTE), '3m ago')
  })
})
