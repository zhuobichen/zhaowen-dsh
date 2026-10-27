/**
 * dsh-agent-dispatch —— 决定一个任务该单 Agent 做，还是派子 Agent。
 *
 * 判据来自 Anthropic Applied AI 团队的企业级复盘：**默认是单 Agent 循环 + Skills**，
 * 子 Agent 只在三个门槛之一成立时才保留：
 *   ① 上下文膨胀导致**可测量**的性能衰退
 *   ② 高并发且各任务上下文独立
 *   ③ 工具过载（>30–50 个）或指令冲突
 *
 * 反方向的代价同样真实：把本该并行的塞进单窗口，上下文越拖越大、质量下降；
 * 而误拆的代价是 token 翻几倍 + 每次交接都有损（回传只有摘要）。
 *
 * 两个工具：
 *   dsh_dispatch_decide  给任务 → 结论 + 门槛判定 + 计划 + 成本/延迟量级
 *   dsh_dispatch_rubric  判定表（含五大失败模式与四步迁移）
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { decide, rubric, MODES } from './decide.js'

export const name = 'agent-dispatch'

export const inject = ['tools']

const OUTPUT = {
	schema: {
		type: 'object',
		additionalProperties: true,
		properties: {
			ok: { type: 'boolean', required: true },
			mode: { type: 'string', description: 'single | single+progressive | subagents' },
			confidence: { type: 'number' },
			summary: { type: 'string' },
			gates: { type: 'array', description: '三个门槛各自的判定与原因' },
			reasons: { type: 'array' },
			risks: { type: 'array' },
			plan: { type: 'object' },
			estimates: { type: 'object' },
			signals: { type: 'object' },
			error: { type: 'string' },
		},
	},
}

const MODE_TEXT = {
	[MODES.SINGLE]: '单 Agent 直接做',
	[MODES.PROGRESSIVE]: '单 Agent + 渐进式披露（按需检索，别一次灌全文）',
	[MODES.SUBAGENTS]: '拆给多个子 Agent（门槛成立，注意交接有损）',
}

function toAnswerBody(result) {
	const lines = []
	lines.push(`结论：${MODE_TEXT[result.mode] ?? result.mode}（置信度 ${result.confidence}）`)
	lines.push('')
	lines.push('三个门槛（默认不拆，任一成立才考虑拆）：')
	for (const g of result.gates ?? []) {
		lines.push(`  ${g.passed ? '✅' : '—'} ${g.label}${g.passed ? '' : '（未成立）'}`)
	}
	lines.push('')
	lines.push('依据（按权重）：')
	for (const r of result.reasons.slice(0, 6)) lines.push(`  [+${r.weight}] ${r.detail}`)
	if (result.risks.length > 0) {
		lines.push('')
		lines.push('风险：')
		for (const r of result.risks) lines.push(`  ! ${r.detail}`)
	}
	lines.push('')
	lines.push('怎么做：')
	if (result.mode === MODES.SUBAGENTS) {
		lines.push(`  拆 ${result.plan.agents} 路；${result.plan.splitBy}`)
		for (const b of result.plan.boundaries ?? []) lines.push(`  - ${b}`)
		lines.push(`  回传格式：${(result.plan.returnFormat ?? []).join(' / ')}`)
	} else if (result.mode === MODES.PROGRESSIVE) {
		for (const d of result.plan.disclosure ?? []) lines.push(`  - ${d}`)
	} else {
		lines.push(`  ${result.plan.note ?? '直接做。'}`)
	}
	const e = result.estimates
	lines.push('')
	lines.push(
		`量级：单循环 ≈ ${e.single.tokens} tokens；${e.subagents.agents} 路子 Agent ≈ ${e.subagents.tokens} tokens（${e.ratio}×，延迟约 ${e.latencyPenalty}×）`,
	)
	return lines.join('\n')
}

export function apply(ctx) {
	ctx.tools.register(
		defineTool({
			name: 'dsh_dispatch_decide',
			description:
				'判断一件事该由当前 Agent 直接做，还是拆给子 Agent。**动手前调用一次**，尤其在你犹豫要不要开子 Agent 时。' +
				'默认答案是"不拆"：只有当①上下文膨胀导致可测量的性能衰退、②高并发且上下文独立、③工具过载或指令冲突之一成立时才拆。' +
				'误拆的代价是 token 翻几倍、每次交接丢细节；不拆的代价是上下文膨胀。这个工具把两者都算给你看。' +
				'任务描述写清"要改什么/要查什么/要交付什么"，比只写一句动词准得多。',
			parameters: {
				task: { type: 'string', required: true, description: '任务原话或你的复述：做什么、涉及多少处材料、要交付什么。' },
				signals: {
					type: 'object',
					description:
						'可选：显式覆盖推断信号。' +
						'measuredDegradation(布尔,门槛①的证据) / independentTargets(数) / concurrency(布尔) / wallClockPressure(布尔) / ' +
						'toolCount(数,门槛③) / instructionConflict(布尔,门槛③) / ' +
						"detailSensitive('low'|'medium'|'high') / sequential(布尔) / sharedContext(布尔) / interactive(布尔) / " +
						'breadth(数) / contextLoad(预估 tokens) / summaryOnly(布尔)。',
				},
				cost: { type: 'object', description: '可选：parentOverhead / childOverhead / summaryRatio / latencyPenalty。' },
			},
			output: OUTPUT,
			execute: async (args) => {
				const task = typeof args?.task === 'string' ? args.task.trim() : ''
				if (task === '') return { ok: false, mode: MODES.SINGLE, error: '缺少 task：把要做的事写一句再问。' }
				let result
				try {
					result = decide({ task, signals: args?.signals, cost: args?.cost })
				} catch (failure) {
					return { ok: false, mode: MODES.SINGLE, error: `决策失败：${failure?.message ?? failure}` }
				}
				const top = result.reasons.slice(0, 2).map((r) => r.detail).join('；')
				return {
					ok: true,
					...result,
					summary: top === '' ? MODE_TEXT[result.mode] : `${MODE_TEXT[result.mode]} —— ${top}`,
					answer: toAnswerBody(result),
				}
			},
		}),
	)

	ctx.tools.register(
		defineTool({
			name: 'dsh_dispatch_rubric',
			description:
				'返回派发判定表：保留子 Agent 的三个门槛、单 Agent/渐进式披露的适用面、五大失败模式、反模式、四步迁移路径。' +
				'不想调用决策工具时照这张表判断。',
			parameters: {},
			output: { schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean', required: true } } } },
			execute: async () => ({ ok: true, ...rubric() }),
		}),
	)
}
