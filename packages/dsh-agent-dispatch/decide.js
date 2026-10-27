/**
 * DSH 任务派发决策引擎（纯函数，无依赖）
 *
 * 判据来自 Anthropic Applied AI 团队的企业级复盘（2026）：
 *   - **默认**是「单 Agent 循环 + Skills/工具搜索（渐进式披露）」；
 *   - 子 Agent 只在**三个门槛之一**成立时才保留：
 *       ① 上下文膨胀导致**可测量**的性能衰退
 *       ② 高并发且各任务上下文独立（需要用完即弃的新窗口）
 *       ③ 工具过载或指令冲突
 *   - 按"业务/部门/问题类型"拆子 Agent 是反模式（康威定律照搬组织架构）；
 *   - 每次交接都是有损的：细节在来回传递中丢失；
 *   - 单循环约是多 Agent 架构的 **2 倍快**。
 *
 * 所以本引擎的默认答案不是"要不要拆"，而是"除非门槛成立，否则别拆"。
 */

export const MODES = Object.freeze({
  SINGLE: 'single',
  PROGRESSIVE: 'single+progressive',
  SUBAGENTS: 'subagents',
})

/** 保留子 Agent 的三个门槛（任一成立才考虑拆）。 */
export const GATES = Object.freeze([
  {
    id: 'context-bloat',
    label: '上下文膨胀导致可测量的性能衰退',
    test: (s) => s.measuredDegradation === true,
    note: '要的是**证据**（跑过、变差过），不是"材料看起来多"。材料多但没有劣化证据 → 用渐进式披露。',
  },
  {
    id: 'independent-concurrency',
    label: '高并发且各任务上下文独立',
    test: (s) =>
      (s.independentTargets ?? 1) >= 3 &&
      (s.wallClockPressure === true || s.concurrency === true) &&
      s.sharedContext !== true,
    note: '独立 = 各看各的材料、不需要看别人结果；有共享状态就不算。',
  },
  {
    id: 'tool-overload',
    label: '工具过载或指令冲突',
    test: (s) => (s.toolCount ?? 0) >= 30 || s.instructionConflict === true,
    note: '工具定义超过 30–50 个时模型容易选错；指令互相打架也是。',
  },
])

export const DEFAULT_COST = Object.freeze({
  parentOverhead: 4000,
  childOverhead: 6000,
  summaryRatio: 0.12,
  latencyPenalty: 2, // 多 Agent 相对单循环的延迟倍数（文章：单循环约 2× 快）
})

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const num = (value) => (Number.isFinite(value) ? Number(value) : undefined)

export function inferSignals(task = '') {
  const text = String(task)
  const has = (re) => re.test(text)

  const parallelWords = /(每个|逐个|分别|逐一|批量|并行|同时|多处|各(个|自)|across|each|every|parallel|batch|all of)/i
  const summaryWords = /(总结|汇总|综述|调研|对比|盘点|梳理|insight|summar|survey|compare|review the)/i
  const detailWords = /(逐字|原文|精确|一字不差|配置值|版本号|引用|行号|粘贴|verbatim|exact|quote|line number|copy)/i
  const sequentialWords = /(然后|接着|基于上一步|再|之后|先.*再|then|after that|based on the previous|step by step)/i
  const sharedWords = /(同一个|这份|该文件|这个模块|上下文|沿用|保持风格|same file|this module|keep the style)/i
  const interactiveWords = /(问用户|确认|你选|等你|如果.*则|视情况|confirm with|ask the user|wait for)/i
  const breadthWords = /(整个仓库|全库|所有文件|所有模块|一堆|扫描|排查|find all|whole repo|across the codebase)/i
  const degradationWords = /(上下文(太长|爆|溢出|超限)|变慢|性能(下降|退化)|质量(下降|变差)|context (window )?(full|overflow|bloat))/i
  const toolOverloadWords = /(工具太多|选错工具|工具过载|指令冲突|规则打架|tool overload)/i

  const explicitNumber = text.match(/(\d+)\s*(个|处|文件|模块|服务|files?|modules?|services?)/i)

  return {
    independentTargets: has(parallelWords) ? clamp((text.match(/[、,，\s]/g) ?? []).length, 2, 8) : 1,
    breadth: explicitNumber ? clamp(Number(explicitNumber[1]), 1, 500) : has(breadthWords) ? 12 : 1,
    summaryOnly: has(summaryWords),
    detailSensitive: has(detailWords) ? 'high' : 'medium',
    sequential: has(sequentialWords),
    sharedContext: has(sharedWords),
    interactive: has(interactiveWords),
    wallClockPressure: false,
    concurrency: false,
    measuredDegradation: has(degradationWords),
    instructionConflict: has(toolOverloadWords),
    toolCount: undefined,
    contextLoad: undefined,
    inferred: true,
  }
}

function pruneUndefined(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v
  return out
}

export function gateVerdicts(signals) {
  return GATES.map((gate) => {
    let passed = false
    try {
      passed = gate.test(signals) === true
    } catch {
      passed = false
    }
    return { id: gate.id, label: gate.label, passed, note: gate.note }
  })
}

export function score(input = {}) {
  const task = String(input.task ?? '')
  const signals = { ...inferSignals(task), ...pruneUndefined(input.signals ?? {}) }
  const cost = { ...DEFAULT_COST, ...(input.cost ?? {}) }
  const verdicts = gateVerdicts(signals)
  const gatesPassed = verdicts.filter((v) => v.passed)

  const reasons = []
  const add = (code, weight, detail) => reasons.push({ code, weight, detail })

  for (const g of gatesPassed) add(`gate:${g.id}`, 4, `门槛成立：${g.label}`)

  if (signals.detailSensitive === 'high') add('detail-fidelity', 3, '需要逐字/精确细节，任何交接都会丢东西')
  if (signals.sequential === true) add('sequential', 3, '步骤前后依赖，拆开就是来回传话')
  if (signals.sharedContext === true) add('shared-context', 3, '所有步骤共用同一份上下文，拆开要重复灌')
  if (signals.interactive === true) add('interactive', 3, '中途要等人拍板，子 Agent 等不了')
  if ((num(signals.contextLoad) ?? 0) > 40000) add('large-context', 2, '材料量大：优先用按需检索压住，而不是外包')
  if ((num(signals.independentTargets) ?? 1) <= 1) add('no-parallelism', 2, '只有一个目标，派子 Agent 是纯开销')
  if (signals.summaryOnly === true) add('summary-only', 1, '只要结论，摘要式回传不亏（但原文仍会丢）')

  const gateWeight = gatesPassed.length * 4
  return { signals, verdicts, gatesPassed, reasons, gateWeight, cost }
}

export function estimate(decision, cost) {
  const s = decision.signals
  const material = num(s.contextLoad) ?? (num(s.breadth) ?? 1) * 1200
  const parent = num(cost.parentOverhead) ?? DEFAULT_COST.parentOverhead
  const child = num(cost.childOverhead) ?? DEFAULT_COST.childOverhead
  const ratio = num(cost.summaryRatio) ?? DEFAULT_COST.summaryRatio
  const latency = num(cost.latencyPenalty) ?? DEFAULT_COST.latencyPenalty
  const agents = decision.plan.agents ?? 1

  const single = parent + material + Math.round(material * 0.2)
  const subagents =
    agents * (child + Math.round(material / Math.max(1, agents))) +
    parent +
    Math.round(material * ratio)

  return {
    single: { tokens: single, agents: 1, wallClock: '单循环：串行但无交接' },
    subagents: { tokens: subagents, agents, wallClock: `并行 ${agents} 路，但每次交接要往返（延迟约 ${latency}×）` },
    ratio: single > 0 ? Number((subagents / single).toFixed(2)) : undefined,
    latencyPenalty: latency,
    assumptions: { parentOverhead: parent, childOverhead: child, summaryRatio: ratio, materialTokens: material },
  }
}

/**
 * 主入口。默认答案是"别拆"；只有门槛成立才拆，且要先过细节保真这一关。
 */
export function decide(input = {}) {
  const { signals, verdicts, gatesPassed, reasons, cost } = score(input)
  const risks = []

  let mode
  if (gatesPassed.length > 0) mode = MODES.SUBAGENTS
  else if ((num(signals.contextLoad) ?? 0) > 40000 || (num(signals.breadth) ?? 1) >= 8) mode = MODES.PROGRESSIVE
  else mode = MODES.SINGLE

  // 细节保真是硬约束：要原文就别让摘要替你做决定
  if (mode === MODES.SUBAGENTS && signals.detailSensitive === 'high') {
    mode = MODES.PROGRESSIVE
    risks.push({
      code: 'detail-loss',
      detail: '门槛成立，但需要精确细节；交接是有损的（摘要里没有原文）→ 降级为渐进式披露，自己按需检索',
    })
  }

  // 拆了但目标只有一个：说明门槛来自"工具过载/上下文膨胀"，那就别按目标数拆
  const targets = num(signals.independentTargets) ?? 1
  if (mode === MODES.SUBAGENTS && targets <= 1) {
    risks.push({
      code: 'single-target',
      detail: '只有一个目标，拆出去大概率是"一个子 Agent 绕一圈回来"；若不是为了隔离上下文，建议并回主循环',
    })
  }

  if (mode === MODES.SUBAGENTS) {
    risks.push({
      code: 'lossy-handoff',
      detail: '每次交接都是摘要式的：交接越多，信息保真度越低。回传只收结论 + 证据位置',
    })
  }

  const agents = mode === MODES.SUBAGENTS ? clamp(targets >= 2 ? targets : 2, 2, 6) : 1

  const plan =
    mode === MODES.SUBAGENTS
      ? {
          agents,
          splitBy: '按**上下文边界**切（不是按业务/步骤切）：每个子 Agent 只拿自己那份材料，几乎不依赖系统其余部分',
          boundaries: [
            '每路子 Agent 写清：只看这一块、返回什么格式、不要展开别人那块',
            '回传只收结论 + 证据位置（文件:行 或 URL），禁止整段复制原文',
            '超过 6 路分批：先 6 路，拿摘要再决定补不补',
            '主 Agent 保留对话；只有子 Agent 必须直接面对用户时才做完整交接',
          ],
          returnFormat: ['结论（一句话）', '依据（文件:行 或 URL）', '没查到什么'],
        }
      : mode === MODES.PROGRESSIVE
        ? {
            agents: 1,
            disclosure: [
              '先列索引（文件名 / 标题 / 符号名），不要一次读全文',
              '按关键词或引用定位，只读命中的那几处',
              '读到的原文就地留在上下文里，别急着总结——总结留到最后一步',
              '把执行顺序与领域规则写进 Skill，把硬性约束（审批、权限、存在性检查）放进工具',
              '跨 10 个以上文件仍无劣化证据时，也不要拆子 Agent；先量（建评测集）再决定',
            ],
          }
        : {
            agents: 1,
            note: '直接做。材料不多、步骤强耦合、或需要逐字精确时，单循环最省也最准。',
          }

  const out = { mode, confidence: confidenceOf(gatesPassed, signals), gates: verdicts, reasons, risks, plan, signals }
  out.estimates = estimate({ signals, plan }, cost)
  return out
}

function confidenceOf(gatesPassed, signals) {
  // 门槛越"硬"（有证据）越自信；纯推断信号则打折
  const hard = gatesPassed.some((g) => g.id === 'context-bloat' || g.id === 'tool-overload')
  const clear = gatesPassed.length > 0
  if (clear) return hard ? 0.85 : 0.7
  if ((num(signals.contextLoad) ?? 0) > 40000) return 0.75
  return signals.inferred === true ? 0.6 : 0.7
}

/** 迁移旧架构时的四步法（文章给出，适用于已经有编排器+专家子 Agent 的情况）。 */
export function migrationPlan() {
  return [
    { step: 1, title: '建端到端评测集，判断去留', detail: '10 个黄金样例就能起步；打分看"任务是否完成"，保留编排器时另看路由准确率' },
    { step: 2, title: '先合并紧密耦合的领域 Agent', detail: '输出串联、访问同一份数据、常被连着调用 → 合成一个领域 Agent；先动最常用的那个' },
    { step: 3, title: '过渡期把保留的子 Agent 降级为工具', detail: '主 Agent 继续对话，子 Agent 作为工具调用；统一回传结构，主 Agent 核对真实数据' },
    { step: 4, title: '逐一转成 Skills + 工具', detail: '提示词→Skills，API→MCP 工具；每次只改一个，比得分与"翻转的任务"，别只看总分' },
  ]
}

/** 判定表：给不看代码的人。 */
export function rubric() {
  return {
    defaultIs: '单 Agent 循环 + Skills/工具（渐进式披露）',
    keepSubagentOnlyIf: [
      '上下文膨胀导致**可测量**的性能衰退（有证据，不是感觉）',
      '高并发且各任务上下文独立（用完即弃的新窗口）',
      '工具过载（>30–50 个）或系统提示词里指令互相冲突',
    ],
    useSingle: [
      '步骤前后依赖（读→改→验）',
      '共用同一份上下文（同一个文件/模块改很多处）',
      '需要逐字精确（配置值、版本号、引文、行号）',
      '中途要人拍板',
      '目标只有一个',
    ],
    useProgressiveDisclosure: [
      '材料很多但**没有劣化证据** ← 过去的头号误判：这种该检索，不该外包',
      '材料在磁盘/网上，可以按关键词定位',
      '需要反复回看同一段原文',
      '把领域步骤写进 Skill、把硬约束放进工具',
    ],
    fiveFailureModes: [
      '上下文丢失：交接越多，保真度越低',
      '子 Agent 泛滥：每个团队各交一个，最后上百个互相重叠',
      '拼接提示词冲突：各团队各加一句，口吻割裂、规则打架',
      '评测局部化：各团队只优化自己的子任务，端到端分数失真',
      '高延迟：多 Agent 跳转耗时，单循环约 2× 快',
    ],
    antiPatterns: [
      '按部门/问题类型拆子 Agent —— 那是把组织架构图照搬进技术架构',
      '为了"更专业"而派子 Agent —— 它只是另一个上下文窗口，不是更强的模型',
      '把 20 个文件原文丢给子 Agent 总结，再拿摘要去改代码（细节必丢）',
      '单 Agent 已经做完 80%，又派子 Agent 复核',
      '链式子 Agent（A 里再派 B）—— 开销叠乘',
    ],
    migration: migrationPlan(),
  }
}
