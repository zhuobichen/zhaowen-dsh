/**
 * 决策引擎单测：核心断言是「默认不拆；只有三个门槛之一成立才拆」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { decide, rubric, inferSignals, migrationPlan, gateVerdicts, MODES, GATES, DEFAULT_COST } from '../decide.js'

test('1 五服务并行搜引用（独立 + 等不起）→ 门槛② 成立，派子 Agent', () => {
	const r = decide({
		task: '找出这个函数在 users、orders、payments、inventory、shipping 五个服务里分别被谁调用',
		signals: { independentTargets: 5, summaryOnly: true, wallClockPressure: true, breadth: 5 },
	})
	assert.equal(r.mode, MODES.SUBAGENTS)
	assert.ok(r.gates.find((g) => g.id === 'independent-concurrency')?.passed, '门槛② 应成立')
	assert.ok(r.plan.agents >= 3)
})

test('2 改一个配置值（逐字精确、单目标）→ 单 Agent', () => {
	const r = decide({
		task: '把 package.json 里的 version 从 0.1.0 改成 0.2.0，只改这一行',
		signals: { detailSensitive: 'high', independentTargets: 1 },
	})
	assert.equal(r.mode, MODES.SINGLE)
	assert.ok(r.gates.every((g) => !g.passed), '不该有任何门槛成立')
	assert.ok(r.reasons.some((x) => x.code === 'detail-fidelity'))
})

test('3 读→改→跑测试（顺序依赖）→ 单 Agent', () => {
	const r = decide({
		task: '先读 src/auth.ts 搞清登录流程，然后改掉 token 刷新逻辑，接着跑测试确认没有回归',
		signals: { sequential: true, sharedContext: true, detailSensitive: 'high' },
	})
	assert.equal(r.mode, MODES.SINGLE)
})

test('4 20 篇调研只要综述（并发 + 独立）→ 门槛② 成立', () => {
	const r = decide({
		task: '把这 20 篇竞品发布说明读一遍，汇总它们的定价策略差异',
		signals: { breadth: 20, summaryOnly: true, independentTargets: 4, concurrency: true },
	})
	assert.equal(r.mode, MODES.SUBAGENTS)
})

test('5 大仓库取完整实现：材料多但无劣化证据 → 渐进式披露（不是子 Agent）', () => {
	const r = decide({
		task: '在这个大仓库里找到 buildPipeline 的实现，把它的完整实现和行号给我',
		signals: { breadth: 40, contextLoad: 120000, detailSensitive: 'high', independentTargets: 1 },
	})
	assert.equal(r.mode, MODES.PROGRESSIVE)
	assert.ok((r.plan.disclosure ?? []).length >= 3)
	assert.ok(r.gates.every((g) => !g.passed), '没有证据就不该拆')
})

test('6 有劣化证据（门槛①）→ 派子 Agent，但单目标要报风险', () => {
	const r = decide({
		task: '继续在这个会话里改代码，上下文已经爆了、质量明显下降',
		signals: { measuredDegradation: true, contextLoad: 200000, detailSensitive: 'medium' },
	})
	assert.equal(r.mode, MODES.SUBAGENTS)
	assert.ok(r.gates.find((g) => g.id === 'context-bloat')?.passed)
	assert.ok(r.risks.some((x) => x.code === 'single-target'), '单目标拆出去要提醒')
})

test('7 工具过载（门槛③）→ 派子 Agent', () => {
	const r = decide({
		task: '现在挂了 40 个工具，老是选错，帮我理一遍',
		signals: { toolCount: 40 },
	})
	assert.equal(r.mode, MODES.SUBAGENTS)
	assert.ok(r.gates.find((g) => g.id === 'tool-overload')?.passed)
})

test('8 门槛成立但要求逐字 → 降级为渐进式并明确报 detail-loss', () => {
	const r = decide({
		task: '四个文件分别改成同一模式，但每个文件都要逐字保留原有注释',
		signals: { independentTargets: 4, concurrency: true, detailSensitive: 'high' },
	})
	assert.equal(r.mode, MODES.PROGRESSIVE)
	assert.ok(r.risks.some((x) => x.code === 'detail-loss'))
})

test('9 成本：拆开更贵、更慢；单循环和多 Agent 的延迟差写在估算里', () => {
	const single = decide({ task: '改一行配置', signals: { detailSensitive: 'high' } })
	const multi = decide({
		task: '五个服务分别查一遍调用点',
		signals: { independentTargets: 5, summaryOnly: true, concurrency: true },
	})
	assert.equal(single.mode, MODES.SINGLE)
	assert.equal(single.estimates.subagents.agents, 1)
	assert.ok(multi.estimates.subagents.tokens > multi.estimates.single.tokens)
	assert.ok(multi.estimates.ratio > 1)
	assert.equal(multi.estimates.latencyPenalty, DEFAULT_COST.latencyPenalty)
})

test('10 信号推断：从话里认出并行/劣化/工具过载', () => {
	const s = inferSignals('分别检查 users、orders、payments 三个模块，但上下文太长质量下降了')
	assert.ok(s.independentTargets >= 2)
	assert.equal(s.measuredDegradation, true)
	assert.equal(inferSignals('现在有 40 个工具，老是选错').instructionConflict || false, false)
})

test('11 空任务不崩；rubric 带上五大失败模式与四步迁移', () => {
	const r = decide({})
	assert.ok(Object.values(MODES).includes(r.mode))
	const table = rubric()
	assert.equal(table.fiveFailureModes.length, 5)
	assert.ok(table.keepSubagentOnlyIf.length === 3)
	assert.equal(migrationPlan().length, 4)
	assert.ok(table.defaultIs.includes('单 Agent'))
})

test('12 门槛清单本身可读（三个）', () => {
	assert.equal(GATES.length, 3)
	const verdicts = gateVerdicts({ independentTargets: 4, concurrency: true })
	assert.equal(verdicts.filter((v) => v.passed).length, 1)
	assert.equal(verdicts[0].passed, false)
})
