/**
 * 聚合与建议的纯逻辑单测（不碰文件系统）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { aggregate, advise, DEFAULT_ALIAS, attributeSkillTurns, profileOf, percentile, classifyError } from '../aggregate.js'

const HOUR = 3600 * 1000
const t0 = Date.UTC(2026, 9, 20, 0, 0, 0)

function session(id, extra = {}) {
  return {
    sessionId: id,
    mtime: t0,
    msgs: [],
    calls: [],
    results: [],
    availableSkills: new Map(),
    ...extra,
  }
}

test('1 skill 机会只统计"首次可用之后"的消息', () => {
  const s = session('s1', {
    availableSkills: new Map([['watch', t0 + 10 * HOUR]]),
    msgs: [
      { time: t0, text: '帮我看视频里的这段' }, // 诞生前 → 不算机会
      { time: t0 + 20 * HOUR, text: '帮我看视频里的这段' }, // 诞生后 → 算
    ],
  })
  const r = aggregate([s], { installedSkills: ['watch'] })
  const watch = r.skills.find((x) => x.name === 'watch')
  assert.equal(watch.opportunities, 1, '诞生前那次不该计入')
  assert.equal(watch.triggeredSessions, 0)
  assert.equal(watch.missed, 1)
  assert.equal(watch.inferred, true)
})

test('2 触发按会话去重，触发率 = 触发会话 / 机会会话', () => {
  const s1 = session('s1', {
    availableSkills: new Map([['zhihu', t0]]),
    msgs: [{ time: t0 + HOUR, text: '去知乎搜一下这个' }],
    calls: [
      { time: t0 + 2 * HOUR, name: 'skill', callId: 'c1', args: { name: 'zhihu' } },
      { time: t0 + 3 * HOUR, name: 'skill', callId: 'c2', args: { name: 'zhihu' } }, // 同会话第二次
    ],
    results: [
      { time: t0 + 2 * HOUR + 5, callId: 'c1', ok: true },
      { time: t0 + 3 * HOUR + 5, callId: 'c2', ok: true },
    ],
  })
  const s2 = session('s2', {
    availableSkills: new Map([['zhihu', t0]]),
    msgs: [{ time: t0 + HOUR, text: '知乎上怎么说' }],
  })
  const r = aggregate([s1, s2], { installedSkills: ['zhihu'] })
  const zhihu = r.skills.find((x) => x.name === 'zhihu')
  assert.equal(zhihu.opportunities, 2)
  assert.equal(zhihu.triggeredSessions, 1)
  assert.equal(zhihu.calls, 2, '调用次数按次数算')
  assert.equal(zhihu.triggerRate, 0.5)
})

test('3 MCP 按 server 聚合 + 成功率 + 均耗时', () => {
  const s = session('s1', {
    calls: [
      { time: t0, name: 'mcp__amap-maps__maps_geo', callId: 'm1', args: {} },
      { time: t0 + 1000, name: 'mcp__amap-maps__maps_search_detail', callId: 'm2', args: {} },
      { time: t0 + 2000, name: 'mcp__rea__open_binary', callId: 'm3', args: {} },
    ],
    results: [
      { time: t0 + 300, callId: 'm1', ok: true },
      { time: t0 + 1300, callId: 'm2', ok: false },
      { time: t0 + 2500, callId: 'm3', ok: true },
    ],
  })
  const r = aggregate([s])
  const amap = r.mcp.find((x) => x.key === 'amap-maps')
  assert.equal(amap.calls, 2)
  assert.equal(amap.ok, 1)
  assert.equal(amap.failed, 1)
  assert.equal(amap.successRate, 0.5)
  assert.equal(amap.avgMs, 300)
  assert.equal(r.totals.mcpCalls, 3)
  assert.equal(r.totals.mcpSessions, 1)
  assert.equal(r.totals.mcpShare, 1, '全是 MCP 时占比为 1')
})

test('4 原生工具统计与时间范围', () => {
  const s = session('s1', {
    calls: [
      { time: t0, name: 'pwsh', callId: 'a1', args: {} },
      { time: t0 + 50, name: 'pwsh', callId: 'a2', args: {} },
    ],
    results: [
      { time: t0 + 100, callId: 'a1', ok: true },
      { time: t0 + 150, callId: 'a2', ok: true },
    ],
  })
  const r = aggregate([s])
  const pwsh = r.tools.find((x) => x.key === 'pwsh')
  assert.equal(pwsh.calls, 2)
  assert.equal(pwsh.successRate, 1)
  assert.equal(pwsh.avgMs, 100)
})

test('5 建议：装了从未用 + 机会多触发少', () => {
  // 机会按"会话"计，所以造 5 个会话来跨过阈值
  const sessions = [0, 1, 2, 3, 4].map((i) =>
    session(`s${i}`, {
      availableSkills: new Map([
        ['tencent-docs', t0],
        ['browser-skill', t0],
      ]),
      msgs: [{ time: t0 + (i + 1) * HOUR, text: '用浏览器打开这个页面' }],
      // 只在一个会话里真调用过 → 触发率 1/5 = 20%
      calls:
        i === 0
          ? [{ time: t0 + HOUR + 60, name: 'skill', callId: 'b1', args: { name: 'browser-skill' } }]
          : [],
      results: i === 0 ? [{ time: t0 + HOUR + 120, callId: 'b1', ok: true }] : [],
    }),
  )
  const r = aggregate(sessions, { installedSkills: ['tencent-docs', 'browser-skill'] })
  const list = advise(r, { now: t0 + 10 * 86400000 })
  assert.ok(list.some((a) => a.kind === 'skill-never-used' && a.target === 'tencent-docs'))
  const mismatch = list.find((a) => a.kind === 'skill-trigger-mismatch')
  assert.ok(mismatch, '机会 >=5 且触发率 <=20% 时应提示')
  assert.equal(mismatch.evidence.inferred, true)
})

test('6 建议：MCP 慢 / 一次性 / 不稳', () => {
  const s = session('s1', {
    calls: [
      { time: t0, name: 'mcp__rea__analyze_function', callId: 'x1', args: {} },
      { time: t0, name: 'mcp__bad__thing', callId: 'x2', args: {} },
      { time: t0, name: 'mcp__bad__thing2', callId: 'x3', args: {} },
      { time: t0, name: 'mcp__bad__thing3', callId: 'x4', args: {} },
    ],
    results: [
      { time: t0 + 120000, callId: 'x1', ok: true },
      { time: t0 + 10, callId: 'x2', ok: false },
      { time: t0 + 20, callId: 'x3', ok: false },
      { time: t0 + 30, callId: 'x4', ok: true },
    ],
  })
  const r = aggregate([s])
  const list = advise(r, { now: t0 + 30 * 86400000 })
  assert.ok(list.some((a) => a.kind === 'mcp-slow' && a.target === 'rea'))
  assert.ok(list.some((a) => a.kind === 'mcp-one-off'))
  assert.ok(list.some((a) => a.kind === 'mcp-flaky' && a.target === 'bad'))
})

test('7 别名表覆盖常见中文触发词', () => {
  assert.ok(DEFAULT_ALIAS['zhihu'].includes('知乎'))
  assert.ok(DEFAULT_ALIAS['browser-skill'].includes('浏览器'))
  assert.ok((DEFAULT_ALIAS['reverse-engineer-anything'] ?? []).includes('逆向'))
})

test('8 空输入不崩', () => {
  const r = aggregate([], { installedSkills: [] })
  assert.equal(r.totals.sessions, 0)
  assert.deepEqual(r.tools, [])
  assert.deepEqual(r.mcp, [])
  assert.equal(advise(r).length, 0)
})

test('9 归因：skill 加载后同 turn 的后续调用与 token', () => {
  const s = session('s1', {
    calls: [
      { time: t0, name: 'skill', callId: 'k1', args: { name: 'browser-skill' }, turn: 1, step: 1 },
      { time: t0 + 10, name: 'pwsh', callId: 'p1', args: {}, turn: 1, step: 2 },
      { time: t0 + 20, name: 'pwsh', callId: 'p2', args: {}, turn: 1, step: 3 },
      { time: t0 + 30, name: 'read', callId: 'r1', args: {}, turn: 1, step: 1 }, // 加载之前的 step，不算
    ],
    usages: [
      { time: t0, turn: 1, step: 1, total: 1000 },
      { time: t0 + 10, turn: 1, step: 2, total: 2000 },
    ],
    results: [],
  })
  const attributed = attributeSkillTurns(s)
  const rec = attributed.get('browser-skill')
  assert.equal(rec.loadedTurns, 1)
  assert.equal(rec.callsAfterLoad, 2, '只算 step 大于加载 step 的调用')
  assert.equal(rec.tokensAfterLoad, 3000, '只算 step >= 加载 step 的 token')
})

test('10 会话画像：按工具族取主导，无明显主导算 mixed', () => {
  assert.equal(profileOf([{ name: 'pwsh' }, { name: 'edit' }, { name: 'read' }]), 'code')
  assert.equal(profileOf([{ name: 'web_fetch' }, { name: 'web_search' }]), 'research')
  assert.equal(profileOf([{ name: 'pwsh' }, { name: 'web_fetch' }]), 'mixed')
  assert.equal(profileOf([{ name: 'mcp__rea__open_binary' }]), 'rea', 'MCP 的家族按 server 名取')
})

test('11 分位数抗异常值；错误分类可读', () => {
  assert.equal(percentile([1, 2, 3, 4, 1000], 0.5), 3)
  assert.equal(percentile([1, 2, 3, 4, 1000], 0.95), 1000)
  assert.equal(percentile([], 0.5), null)
  assert.equal(classifyError('Exit code 1\nbsk: not found'), 'not-found')
  assert.equal(classifyError('sandbox: denied'), 'permission')
  assert.equal(classifyError('request timed out'), 'timeout')
})

test('12 skill 的成本与 token 进入报告；按画像拆分', () => {
  const s1 = session('s1', {
    availableSkills: new Map([['watch', t0]]),
    skillChars: new Map([['watch', { sum: 250, n: 1 }]]),
    msgs: [{ time: t0 + 1000, text: '看视频里这段' }],
    calls: [
      { time: t0 + 2000, name: 'skill', callId: 'w1', args: { name: 'watch' }, turn: 1, step: 1 },
      { time: t0 + 2100, name: 'pwsh', callId: 'w2', args: {}, turn: 1, step: 2 },
    ],
    usages: [{ time: t0 + 2000, turn: 1, step: 1, total: 5000 }],
    results: [],
  })
  const r = aggregate([s1], { installedSkills: ['watch'] })
  const watch = r.skills.find((x) => x.name === 'watch')
  assert.equal(watch.contextCost.charsPerTurn, 250)
  assert.equal(watch.contextCost.tokensPerTurn, 100)
  assert.equal(watch.attribution.tokensAfterLoad, 5000)
  assert.ok(watch.byProfile.code, '该会话画像应为 code')
  assert.equal(watch.byProfile.code.opportunities, 1)
  assert.equal(r.totals.tokens, 5000)
})

test('13 上下文成本在"最后一次出现在清单"处停止累加', () => {
  const s = session('s1', {
    availableSkills: new Map([['watch', t0]]),
    lastSeenSkills: new Map([['watch', t0 + 10 * HOUR]]),
    skillChars: new Map([['watch', { sum: 250, n: 1 }]]),
    msgs: [
      { time: t0 + HOUR, text: '随便聊聊' }, // 窗口内
      { time: t0 + 20 * HOUR, text: '卸载之后的消息' }, // 窗口外，不计成本
    ],
  })
  const r = aggregate([s], { installedSkills: [] })
  const watch = r.skills.find((x) => x.name === 'watch')
  assert.equal(watch.contextCost.turns, 1, '卸载后不应继续计费')
  assert.equal(watch.lastAvailableAt, t0 + 10 * HOUR)
})

test('14 失败样本随工具一起返回', () => {
  const s = session('s1', {
    calls: [{ time: t0, name: 'web_fetch', callId: 'f1', args: {}, turn: 1, step: 1 }],
    results: [{ time: t0 + 100, callId: 'f1', ok: false, text: 'Unable to verify if domain example.com is safe to fetch' }],
  })
  const r = aggregate([s])
  const web = r.tools.find((x) => x.key === 'web_fetch')
  assert.equal(web.failed, 1)
  assert.equal(web.failureSamples.length, 1)
  assert.ok(web.failureSamples[0].excerpt.includes('Unable to verify'))
})

test('15 examples 只按需返回，且只给"没触发"的会话', () => {
  const s1 = session('s1', {
    availableSkills: new Map([['zhihu', t0]]),
    msgs: [{ time: t0 + HOUR, text: '去知乎看看这个问题怎么答' }],
  })
  const s2 = session('s2', {
    availableSkills: new Map([['zhihu', t0]]),
    msgs: [{ time: t0 + HOUR, text: '知乎那个回答不错' }],
    calls: [{ time: t0 + 2 * HOUR, name: 'skill', callId: 'z1', args: { name: 'zhihu' }, turn: 1, step: 1 }],
    results: [{ time: t0 + 2 * HOUR + 10, callId: 'z1', ok: true, text: '' }],
  })
  const without = aggregate([s1, s2], { installedSkills: ['zhihu'] })
  assert.equal(without.skills.find((x) => x.name === 'zhihu').examples, undefined, '默认不返回例句')

  const withEx = aggregate([s1, s2], { installedSkills: ['zhihu'], examples: true })
  const zhihu = withEx.skills.find((x) => x.name === 'zhihu')
  assert.equal(zhihu.examples.length, 1)
  assert.equal(zhihu.examples[0].sessionId, 's1')
  assert.ok(zhihu.examples[0].text.includes('知乎'))
})