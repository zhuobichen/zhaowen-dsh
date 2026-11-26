/**
 * AI 工作台 · 目录（AI base）
 *
 * 嵌套结构：顶层是 AI 工作台（一个 tab），里面细分小工作台。
 * 目前引入第一个：Agent 设计工作台。
 *
 *   小工作台 → 分类 → 条目
 *
 * 每条都指到「别人做好的东西」：官方规范 / skill / MCP / 工具 / 技巧，
 * 和设计/代码工作台同构——面板给人挑，ai_style 工具给 AI 读同一份。
 *
 * 字段：id / section / layer / name / oneLine / source / tags / kind / bullets / howto / sources / origin
 */
const AGENT = [
  // ── 架构模式（Anthropic Building Effective Agents）──
  {
    id: 'ag-prompt-chaining', section: 'agent', layer: '架构模式',
    name: '提示词链（Prompt Chaining）',
    oneLine: '把任务拆成固定顺序的步骤，每步输出喂给下一步，中间可插校验门',
    source: 'Anthropic · Building Effective Agents',
    tags: ['模式', '顺序', '校验'], kind: 'text',
    swatch: { a: '#0f172a', b: '#1e293b', fg: '#e2e8f0', accent: '#38bdf8', pattern: 'grid' },
    bullets: [
      '适合「能明确拆成固定子任务」的活，比如：生成文案 → 翻译 → 审校',
      '用延迟换准确率：每步只做一件事，输出短、易验证',
      '在步骤之间加 programmatic check（如格式校验），不合格就回退',
    ],
    howto: '任务能列成清单、且后一步依赖前一步时用；不要用链去干需要临场判断的活。',
    sources: [{ label: 'Building Effective Agents', url: 'https://www.anthropic.com/engineering/building-effective-agents' }],
    origin: 'referenced',
  },
  {
    id: 'ag-routing', section: 'agent', layer: '架构模式',
    name: '路由（Routing）',
    oneLine: '先分类输入，再分派到专门的处理流程或不同大小的模型',
    source: 'Anthropic · Building Effective Agents',
    tags: ['模式', '分类', '省成本'], kind: 'text',
    swatch: { a: '#0b1220', b: '#172554', fg: '#dbeafe', accent: '#a78bfa', pattern: 'dots' },
    bullets: [
      '把简单问题路由到小模型（便宜快），复杂问题交给大模型',
      '分类边界要清楚、分类本身要准（LLM 或传统分类器都行）',
      '客服场景：普通咨询 / 退款 / 技术支持各走各的流程',
    ],
    howto: '输入有明显类别、且不同类别处理方式不同时用。',
    sources: [{ label: 'Building Effective Agents', url: 'https://www.anthropic.com/engineering/building-effective-agents' }],
    origin: 'referenced',
  },
  {
    id: 'ag-parallelization', section: 'agent', layer: '架构模式',
    name: '并行化（Parallelization）',
    oneLine: '把任务切成独立子任务并行跑，或同一任务跑多遍投票——分块与投票两种',
    source: 'Anthropic · Building Effective Agents',
    tags: ['模式', '并行', '投票'], kind: 'text',
    swatch: { a: '#0f172a', b: '#1e293b', fg: '#e2e8f0', accent: '#34d399', pattern: 'grid' },
    bullets: [
      '分块（Sectioning）：一个模型回答用户，另一个同时做安全检查',
      '投票（Voting）：多组 prompt 审同一份代码，取共识降低漏检',
      '多个视角各自独立时，模型比单次调用表现更好',
    ],
    howto: '子任务能独立、且速度或多视角有价值时用。',
    sources: [{ label: 'Building Effective Agents', url: 'https://www.anthropic.com/engineering/building-effective-agents' }],
    origin: 'referenced',
  },
  {
    id: 'ag-orchestrator', section: 'agent', layer: '架构模式',
    name: '编排者-工人（Orchestrator-Workers）',
    oneLine: '中心 LLM 动态拆任务、分给工人、再汇总——子任务不是预先定义的',
    source: 'Anthropic · Building Effective Agents',
    tags: ['模式', '动态', '多 Agent'], kind: 'text',
    swatch: { a: '#111827', b: '#1f2937', fg: '#f3f4f6', accent: '#f59e0b', pattern: 'rays' },
    bullets: [
      '和并行化的关键区别：子任务由编排者按输入现场决定，不是固定清单',
      '适合无法预知要改几个文件、每个文件改什么的编码任务',
      '编排者要能综合工人结果，否则就是一堆碎片',
    ],
    howto: '任务复杂度随输入变化、无法预先列清单时用。',
    sources: [{ label: 'Building Effective Agents', url: 'https://www.anthropic.com/engineering/building-effective-agents' }],
    origin: 'referenced',
  },
  {
    id: 'ag-evaluator', section: 'agent', layer: '架构模式',
    name: '评估者-优化者（Evaluator-Optimizer）',
    oneLine: '一个 LLM 生成、另一个评估并给反馈，循环改进直到达标',
    source: 'Anthropic · Building Effective Agents',
    tags: ['模式', '循环', '评审'], kind: 'text',
    swatch: { a: '#1e1b4b', b: '#312e81', fg: '#e0e7ff', accent: '#c084fc', pattern: 'dots' },
    bullets: [
      '两个前提：评估标准明确、迭代确实能带来可衡量的改进',
      '人类反馈能显著改善输出时，这套最有效',
      '文学翻译、复杂搜索这类「好一点」能被识别的活适合',
    ],
    howto: '有明确 rubric、且值得多轮打磨时用；一次性任务别套。',
    sources: [{ label: 'Building Effective Agents', url: 'https://www.anthropic.com/engineering/building-effective-agents' }],
    origin: 'referenced',
  },
  {
    id: 'ag-agents-vs-workflows', section: 'agent', layer: '架构模式',
    name: 'Agent vs Workflow 的判断',
    oneLine: '结构化任务用工作流（固定路径），开放式问题才用 Agent（自主决策）',
    source: 'Anthropic · Building Effective Agents',
    tags: ['判断', 'Agent', '成本'], kind: 'text',
    swatch: { a: '#0c0a09', b: '#1c1917', fg: '#fafaf9', accent: '#f97316', pattern: 'stripes' },
    bullets: [
      '工作流：步骤预定义，胜在确定性和可预测性',
      'Agent：动态决策工具使用，适合开放-ended 问题',
      '自主性越高，成本和累积错误风险越大——别滥用了 Agent',
      '先用最简单的方案，eval 驱动再逐步加复杂度',
    ],
    howto: '设计前先问：这个任务路径固定吗？固定就工作流，不固定再 Agent。',
    sources: [{ label: 'Building Effective Agents', url: 'https://www.anthropic.com/engineering/building-effective-agents' }],
    origin: 'referenced',
  },

  // ── Skill 设计 ──
  {
    id: 'ag-skill-spec', section: 'agent', layer: 'Skill 设计',
    name: 'Agent Skills 规范与渐进式披露',
    oneLine: 'SKILL.md 的 frontmatter 决定「何时触发」，正文才写「怎么做」——三级披露',
    source: 'Anthropic · Equipping agents with Agent Skills（开放标准）',
    tags: ['Skill', '规范', '上下文'], kind: 'text',
    swatch: { a: '#0b1020', b: '#15213d', fg: '#dbeafe', accent: '#60a5fa', pattern: 'grid' },
    bullets: [
      '一级：name + description 预加载进 system prompt，只够判断「该不该用」',
      '二级：触发后读完整 SKILL.md 进上下文',
      '三级：长资料放 references/ / scripts/，按需读取（上下文近乎无上限）',
      '写 skill 像给新员工写 onboarding：可组合、可移植、只在需要时加载',
    ],
    howto: '写任何 skill 前先对一遍三级披露；别把 500 行塞进 SKILL.md。',
    sources: [
      { label: 'Agent Skills 文章', url: 'https://www.anthropic.com/research/equipping-agents-for-the-real-world-with-agent-skills' },
      { label: '官方 skills 仓', url: 'https://github.com/anthropics/skills' },
    ],
    origin: 'referenced',
  },
  {
    id: 'ag-skill-description', section: 'agent', layer: 'Skill 设计',
    name: 'description 触发工程',
    oneLine: '弱描述「handle code」不触发，强描述写清触发短语才稳定命中',
    source: 'Claude Code Skills 指南（2026）',
    tags: ['Skill', '提示词', '触发'], kind: 'text',
    swatch: { a: '#111827', b: '#1f2937', fg: '#f3f4f6', accent: '#fbbf24', pattern: 'dots' },
    bullets: [
      'description 写「Use when …」+ 具体触发词（review staged changes / pre-merge checklist）',
      '含糊的描述让 skill 静默不触发——模型不知道何时该用',
      '重复做三次以上的流程就该做成 skill，而不是 slash command',
    ],
    howto: '写完 description 自问：用户说哪句话会触发它？说不出就重写。',
    sources: [{ label: 'Claude Code Skills 完全指南', url: 'https://www.claudemap.org/en/guides/claude-code-skills-guide' }],
    origin: 'referenced',
  },
  {
    id: 'ag-skill-vs-others', section: 'agent', layer: 'Skill 设计',
    name: 'Skill / Slash / Subagent / Plugin 四者抉择',
    oneLine: '模型触发→Skill；用户触发→Slash；隔离并行→Subagent；跨项目分发→Plugin',
    source: 'Claude Code Skills 指南（2026）',
    tags: ['Skill', '判断', '形态'], kind: 'text',
    swatch: { a: '#1c1917', b: '#292524', fg: '#fafaf9', accent: '#a8a29e', pattern: 'stripes' },
    bullets: [
      '四个原语看着像，决策就一句话：谁触发、要不要独立上下文、要不要分发',
      'Skill 加载在主会话；Subagent 独立上下文窗口',
      '子 Agent 的 skills 字段会在启动时注入完整 SKILL.md（不是只有描述）',
    ],
    howto: '一个需求进来，先按「谁触发 / 要不要隔离 / 要不要分发」三问定形态。',
    sources: [{ label: '四者对比', url: 'https://www.claudemap.org/en/guides/claude-code-skills-guide' }],
    origin: 'referenced',
  },
  {
    id: 'ag-skill-hooks', section: 'agent', layer: 'Skill 设计',
    name: 'Hooks 链式编排（2025 模式）',
    oneLine: '子 Agent 之间用 hook 串联，比在 prompt 里写「完成后建议调用 X」可靠',
    source: 'Creating Subagents · hooks-based chaining',
    tags: ['Skill', 'Hooks', '编排'], kind: 'text',
    swatch: { a: '#0f172a', b: '#1e293b', fg: '#e2e8f0', accent: '#2dd4bf', pattern: 'grid' },
    bullets: [
      'SubagentStop / Stop / PreToolUse hook 在各种节点触发',
      '基于输出里的状态字段（如 READY_FOR_ARCH）决定下一步',
      '推荐打印建议命令让人确认（HITL），别全自动连跑',
    ],
    howto: '多个 Agent 要按顺序接力时用 hook；别指望模型自己记得调下一个。',
    sources: [{ label: 'Creating Subagents', url: 'https://www.skillmd.ai/skills/creating-subagents-3' }],
    origin: 'referenced',
  },

  // ── 上下文工程 ──
  {
    id: 'ag-context-stack', section: 'agent', layer: '上下文工程',
    name: '上下文栈五层（Context Engineering）',
    oneLine: '系统指令 / 长期记忆 / 检索文档 / 工具定义 / 对话历史——agent 出错多半是某层乱了',
    source: 'Context Engineering for AI Agents（2025 指南）',
    tags: ['上下文', '五层', '诊断'], kind: 'text',
    swatch: { a: '#0b1020', b: '#16233a', fg: '#dbeafe', accent: '#38bdf8', pattern: 'grid' },
    bullets: [
      '别只调 prompt：模型读到的是一整包输入，不只系统指令',
      '每层有不同的职责与变化速度：指令稳定、历史频繁、检索动态',
      'agent 表现差时按层排查，而不是笼统说「prompt 不够好」',
      '只塞系统指令、忽略其他四层，像「调了发动机但轮胎没气」',
    ],
    howto: 'agent 异常时，按顺序检查这五层哪层脏了。',
    sources: [{ label: 'Context Engineering 指南', url: 'https://promptbuilder.cc/blog/context-engineering-agents-guide-2025' }],
    origin: 'referenced',
  },
  {
    id: 'ag-tool-docs', section: 'agent', layer: '上下文工程',
    name: 'ACI：工具文档比 prompt 更值得打磨',
    oneLine: 'SWE-bench 实践：优化工具描述的时间超过优化 prompt——把 tool doc 当 API 文档写',
    source: 'Anthropic · Building Effective Agents',
    tags: ['工具', 'ACI', 'prompt'], kind: 'text',
    swatch: { a: '#111827', b: '#1f2937', fg: '#f3f4f6', accent: '#22d3ee', pattern: 'dots' },
    bullets: [
      '工具名用动词（search_kb，不是 kb）；description 写清「什么时候用」',
      '参数 schema 给例子和约束，别只写类型',
      '工具太多且职责重叠会让 agent 在选择上浪费时间',
      'HCI 花了多少心思，ACI 就该花多少',
    ],
    howto: '工具调不准时，先改 description 和参数说明，再改系统 prompt。',
    sources: [{ label: 'ACI 原则', url: 'https://www.besthub.dev/articles/how-anthropic-builds-effective-ai-agents-practical-patterns-and-principles' }],
    origin: 'referenced',
  },
  {
    id: 'ag-context-overload', section: 'agent', layer: '上下文工程',
    name: '上下文过载与优先级',
    oneLine: '给太多上下文会让模型「分析瘫痪」——按相关度与新近度分层，渐进披露',
    source: 'Context Engineering 完整指南（2026）',
    tags: ['上下文', '过载', '优先级'], kind: 'text',
    swatch: { a: '#1f2937', b: '#374151', fg: '#f9fafb', accent: '#fb923c', pattern: 'stripes' },
    bullets: [
      '高优先级：当前意图 / 任务要求 / 安全约束',
      '中优先级：用户偏好 / 历史模式 / 领域知识',
      '低优先级：泛背景 / 无关信息 / 过时上下文',
      '任务越简单，越只用高优先级层',
    ],
    howto: '别把「可能有用」全塞进去：先分层，再决定每层放不放。',
    sources: [{ label: 'Context Engineering 2026', url: 'https://promptbestie.com/en/context-engineering-for-ai-agents-2025-complete-guide' }],
    origin: 'referenced',
  },
  {
    id: 'ag-transparency', section: 'agent', layer: '上下文工程',
    name: '透明性：暴露 Agent 的规划步骤',
    oneLine: '黑盒系统难维护——让 agent 把「它打算怎么做」说出来',
    source: 'Anthropic 三条核心原则',
    tags: ['透明', '可观测', '原则'], kind: 'text',
    swatch: { a: '#0c0a09', b: '#1c1917', fg: '#fafaf9', accent: '#84cc16', pattern: 'grid' },
    bullets: [
      '把规划步骤暴露给用户，出错时能定位是哪一步偏了',
      '结合审计日志（谁、对什么、改了什么）形成可追溯链',
      '简单优先 + 透明 + ACI，是 Anthropic 总结的三条',
    ],
    howto: 'agent 类项目都该有「计划展示 + 审计日志」，别只给最终答案。',
    sources: [{ label: '三条核心原则', url: 'https://www.besthub.dev/articles/how-anthropic-builds-effective-ai-agents-practical-patterns-and-principles' }],
    origin: 'referenced',
  },

  // ── 评估与安全 ──
  {
    id: 'ag-evals', section: 'agent', layer: '评估与安全',
    name: 'Evals 驱动开发',
    oneLine: '先定义 rubric 再优化——用评测集和指标代替「感觉变好了」',
    source: 'OpenAI · AI app development: concept to production',
    tags: ['评估', 'rubric', '迭代'], kind: 'text',
    swatch: { a: '#0b1020', b: '#1e3a8a', fg: '#dbeafe', accent: '#38bdf8', pattern: 'grid' },
    bullets: [
      '设计评分标准（rubric），把输出对照业务目标量化',
      'Evals API / dashboard 可跨模型、跨 prompt 对比',
      '优化的三个杠杆：prompt / context（RAG）/ 模型本身',
    ],
    howto: '没有 eval 就别声称「优化有效」——先建最小评测集。',
    sources: [{ label: 'OpenAI Academy', url: 'https://academy.openai.com/en/public/clubs/builders-etkn1/externals/ai-app-development-concept-to-production-2025-08-18' }],
    origin: 'referenced',
  },
  {
    id: 'ag-guardrails', section: 'agent', layer: '评估与安全',
    name: '输入 / 输出双向 Guardrails',
    oneLine: '入口拦不该处理的请求，出口挡不该返回的内容——prompt 和代码检查结合',
    source: 'OpenAI · Building guardrails for agents',
    tags: ['安全', '护栏', '生产'], kind: 'text',
    swatch: { a: '#1c1917', b: '#292524', fg: '#fafaf9', accent: '#f87171', pattern: 'dots' },
    bullets: [
      '输入护栏：Moderation API / 策略分类，阻止违规请求被处理',
      '输出护栏：拦截幻觉、越权、格式错误',
      '生产环境理想是两者都有，按风险决定严格程度',
    ],
    howto: '面向真实用户的 agent，上线前至少挂一层输入 + 一层输出检查。',
    sources: [{ label: 'OpenAI 护栏指南', url: 'https://developers.openai.com/tracks/ai-application-development' }],
    origin: 'referenced',
  },
  {
    id: 'ag-caching', section: 'agent', layer: '评估与安全',
    name: '提示词缓存与成本/延迟优化',
    oneLine: '生产系统要平衡准确性和成本：缓存重复前缀、小模型蒸馏、按需分配',
    source: 'OpenAI · Cost & latency optimization',
    tags: ['成本', '缓存', '生产'], kind: 'text',
    swatch: { a: '#0f172a', b: '#1e293b', fg: '#e2e8f0', accent: '#fbbf24', pattern: 'grid' },
    bullets: [
      'Prompt caching：把稳定前缀缓存，降低延迟和成本',
      '小模型/蒸馏：把大模型能力压到便宜模型上',
      '路由简单问题到小模型本身就是最大的省钱手段',
    ],
    howto: 'agent 跑得起但账单吓人时，按这三条依次看。',
    sources: [{ label: '成本与延迟', url: 'https://developers.openai.com/tracks/ai-application-development' }],
    origin: 'referenced',
  },

  // ── 本机经验 ──
  {
    id: 'ag-local-dispatch', section: 'agent', layer: '本机经验',
    name: 'agent-dispatch（本机 skill）',
    oneLine: '该不该拆子 Agent 的三个判据：上下文膨胀有证据 / 高并发且独立 / 工具过载',
    source: '本机 skill: agent-dispatch',
    tags: ['本机', '子Agent', '判断'], kind: 'text',
    swatch: { a: '#0b1220', b: '#172554', fg: '#dbeafe', accent: '#a78bfa', pattern: 'rays' },
    bullets: [
      '默认不拆——「看起来可以并行」不是理由',
      '材料多但要保真 → 渐进式披露，而不是开一堆子 Agent 各读一半',
      '子 Agent 必须有可验证交付物（文件/结论/失败原因）',
    ],
    howto: '拆之前先问：上下文真的膨胀了吗？任务真的独立吗？',
    sources: [{ label: '本机 skill', path: 'D:/github_project/ZhaoWen_GitHub维护/dsh/home/skills/agent-dispatch/SKILL.md' }],
    origin: 'mine',
  },
  {
    id: 'ag-local-zcode', section: 'agent', layer: '本机经验',
    name: 'zcode-kimi-integration（本机 skill）',
    oneLine: '把 DSH provider 配置反推给别的 AI 编程工具，并迁移会话记录',
    source: '本机 skill: zcode-kimi-integration',
    tags: ['本机', '集成', '迁移'], kind: 'text',
    swatch: { a: '#111827', b: '#1f2937', fg: '#f3f4f6', accent: '#22d3ee', pattern: 'stripes' },
    bullets: [
      'Electron 类工具去 userData 找 settings.json / LevelDB',
      '模型配置写全 baseURL / model id / key 环境变量名 / header 变体',
      '会话迁移要保留 tool 调用，否则还原出来是孤儿文本',
      '加密会话库读不了就走 CDP：--remote-debugging-port=9222 + 从 DOM 的 data-role/data-message-id 抓',
      '导出对话四个坑：sqlite 复制副本、别复用游标、role 在 data JSON 里、同 sid 多文件要加唯一后缀',
      '卸载三件套：导出→脱敏→正规卸载器→手清 %APPDATA%/~/.xx 与更新器缓存',
    ],
    howto: '换工具要带走对话，或给别的工具配同一个模型时用。',
    sources: [
      { label: '本机 skill', path: 'D:/github_project/ZhaoWen_GitHub维护/dsh/home/skills/zcode-kimi-integration/SKILL.md' },
      { label: '可复用脚本', path: 'D:/github_project/ZhaoWen_GitHub维护/dsh/home/skills/zcode-kimi-integration/scripts/' },
    ],
    origin: 'mine',
  },

  // ── 开源框架（GitHub 上核实存在的项目）──
  {
    id: 'gh-langgraph', section: 'agent', layer: '开源框架',
    name: 'LangGraph（LangChain）',
    oneLine: '图状工作流引擎：节点 + 条件边 + TypedDict 状态 + checkpoint，控制力最强',
    source: 'GitHub · langchain-ai/langgraph（~44k stars, MIT）',
    tags: ['开源', '图编排', '可控'], kind: 'text',
    swatch: { a: '#0b1220', b: '#172554', fg: '#dbeafe', accent: '#38bdf8', pattern: 'grid' },
    bullets: [
      '有状态有向图：节点做事、边决定走向，条件边支持分支与循环',
      '内建 checkpoint 与 human-in-the-loop 中断，长任务能暂停续跑',
      '适合复杂、有明确分支的工作流；简单问答用它反而啰嗦',
      '调试复杂流程建议配 LangSmith',
    ],
    howto: '要精细控制每一步、需要状态持久化和断点续跑时选它。',
    sources: [{ label: 'GitHub 仓库', url: 'https://github.com/langchain-ai/langgraph' }],
    origin: 'referenced',
  },
  {
    id: 'gh-crewai', section: 'agent', layer: '开源框架',
    name: 'CrewAI（角色化团队）',
    oneLine: '把 Agent 当团队成员：role/goal/backstory + Task + Crew，sequential 或 hierarchical',
    source: 'GitHub · crewAIInc/crewAI（~60k stars, MIT）',
    tags: ['开源', '多Agent', '角色'], kind: 'text',
    swatch: { a: '#111827', b: '#1f2937', fg: '#f3f4f6', accent: '#a78bfa', pattern: 'dots' },
    bullets: [
      '人味隐喻：先组一支队伍（研究员/写手/审稿），再派任务',
      'Crew + Flow 两层：Crew 管协作，Flow 管跨 Crew 的事件流',
      '业务流自动化、内容团队这类「天然分工」的场景最贴合',
      '适合原型与中小规模协作，超复杂控制流不如 LangGraph',
    ],
    howto: '任务天然能拆成几个专业角色时用，别为了用多 Agent 而拆。',
    sources: [{ label: 'GitHub 仓库', url: 'https://github.com/crewAIInc/crewAI' }],
    origin: 'referenced',
  },
  {
    id: 'gh-autogen', section: 'agent', layer: '开源框架',
    name: 'AutoGen（微软，已归档）',
    oneLine: '对话驱动的多 Agent 协作框架；微软已归档，新项目转向 Microsoft Agent Framework',
    source: 'GitHub · microsoft/autogen（~61k stars, MIT；README 标注 archived）',
    tags: ['开源', '多Agent', '归档提醒'], kind: 'text',
    swatch: { a: '#0c0a09', b: '#1c1917', fg: '#fafaf9', accent: '#34d399', pattern: 'rays' },
    bullets: [
      '以对话/消息传递为核心，Agent 之间自然语言交流',
      '支持 group chat、代码执行 Agent、人机协作',
      '⚠ 官方 README 已写「Project archived and no longer maintained」',
      '新项目请用 microsoft/agent-framework，老项目有迁移指南',
    ],
    howto: '研究/复现旧论文可用；新项目别再起步于 AutoGen。',
    sources: [{ label: 'GitHub 仓库', url: 'https://github.com/microsoft/autogen' }],
    origin: 'referenced',
  },
  {
    id: 'gh-openai-agents', section: 'agent', layer: '开源框架',
    name: 'OpenAI Agents SDK',
    oneLine: '小而精的编排原语：Agent + Tools + Handoffs + Guardrails + Sessions + Tracing',
    source: 'GitHub · openai/openai-agents-python（~30k stars, MIT）',
    tags: ['开源', '官方SDK', 'handoff'], kind: 'text',
    swatch: { a: '#0f172a', b: '#1e293b', fg: '#e2e8f0', accent: '#fbbf24', pattern: 'grid' },
    bullets: [
      '五个原语够用：Agent 持有指令/模型/工具/handoff，Runner 驱动循环',
      'handoff 是暴露给模型的工具（transfer_to_x），也可 agent.asTool() 当子工具',
      '输入输出双层 guardrails，Sessions 管多轮记忆，内建 tracing',
      '对 OpenAI 生态最顺，但模型接口可替换（非完全 lock-in）',
    ],
    howto: '要快速上生产、又要可观测和护栏时选；适合 planner→specialist→reviewer。',
    sources: [{ label: 'GitHub 仓库', url: 'https://github.com/openai/openai-agents-python' }],
    origin: 'referenced',
  },
  {
    id: 'gh-claude-agent-sdk', section: 'agent', layer: '开源框架',
    name: 'Claude Agent SDK',
    oneLine: '把 Claude Code 引擎开放成 SDK：query() + 内置工具 + subagent（AgentDefinition）',
    source: 'GitHub · anthropics/claude-agent-sdk-python（官方）',
    tags: ['官方SDK', 'subagent', '编码Agent'], kind: 'text',
    swatch: { a: '#0b1220', b: '#172554', fg: '#dbeafe', accent: '#38bdf8', pattern: 'grid' },
    bullets: [
      '主接口是 query()：描述任务 + 声明允许的工具，循环自己跑',
      '自带 Read/Write/Edit/Bash/Glob/Grep/WebSearch 等工具，MCP 形态',
      'subagent 用 AgentDefinition 定义，父 agent 保留控制权（更像函数调用）',
      '子 agent 消息带 parent_tool_use_id，便于追踪',
    ],
    howto: '编码/文件密集型任务、想要「给 Agent 一台电脑」时用。',
    sources: [{ label: 'GitHub 仓库', url: 'https://github.com/anthropics/claude-agent-sdk-python' }],
    origin: 'referenced',
  },
  {
    id: 'gh-pydantic-ai', section: 'agent', layer: '开源框架',
    name: 'PydanticAI',
    oneLine: '类型优先：Pydantic 校验输出 + 依赖注入 + provider 无关 + Logfire 可观测',
    source: 'GitHub · pydantic/pydantic-ai（~21k stars, MIT）',
    tags: ['开源', '类型安全', '结构化输出'], kind: 'text',
    swatch: { a: '#111827', b: '#1f2937', fg: '#f3f4f6', accent: '#a78bfa', pattern: 'dots' },
    bullets: [
      '把 Pydantic model 当契约：先定输出 schema，再写 prompt 和工具',
      '类型校验减少运行时惊喜，工具可 mock、可单测',
      '多 provider 混用（OpenAI/Anthropic/Gemini/Ollama…）',
      '可选 graph 模式，但核心保持简单',
    ],
    howto: '后端系统要严格结构化输出、可审计、可测试时首选。',
    sources: [{ label: 'GitHub 仓库', url: 'https://github.com/pydantic/pydantic-ai' }],
    origin: 'referenced',
  },
  {
    id: 'gh-mastra', section: 'agent', layer: '开源框架',
    name: 'Mastra',
    oneLine: 'TypeScript 原生：typed agents + workflow（suspend/resume）+ RAG + evals + playground',
    source: 'GitHub · mastra-ai/mastra（~29k stars, Apache-2.0，ee/ 除外）',
    tags: ['开源', 'TypeScript', 'workflow'], kind: 'text',
    swatch: { a: '#0c0a09', b: '#1c1917', fg: '#fafaf9', accent: '#34d399', pattern: 'rays' },
    bullets: [
      'TS 生态旗舰框架，和 Vercel AI SDK 集成好',
      'workflow 支持挂起/恢复，适合长时任务',
      '自带 RAG、evals、本地 playground',
      '有企业版目录 ee/（Apache-2.0 不含）',
    ],
    howto: '前端/Node 团队要 TS 原生、要内置 eval 和 playground 时用。',
    sources: [{ label: 'GitHub 仓库', url: 'https://github.com/mastra-ai/mastra' }],
    origin: 'referenced',
  },
  {
    id: 'gh-letta', section: 'agent', layer: '开源框架',
    name: 'Letta（原 MemGPT）',
    oneLine: '记忆优先：memory blocks + archival memory + sleep-time agents，状态跨越单个上下文窗口',
    source: 'GitHub · letta-ai/letta（~25k stars, Apache-2.0）',
    tags: ['开源', '记忆', '长程Agent'], kind: 'text',
    swatch: { a: '#0f172a', b: '#1e293b', fg: '#e2e8f0', accent: '#fbbf24', pattern: 'grid' },
    bullets: [
      '把记忆分层：核心记忆块、归档记忆，像操作系统管理内存',
      'sleep-time agent 在「休息」时整理记忆',
      '为需要长期状态、跨会话连续的 Agent 设计',
    ],
    howto: 'Agent 要记住很多、活得很久时用；一次性任务别上。',
    sources: [{ label: 'GitHub 仓库', url: 'https://github.com/letta-ai/letta' }],
    origin: 'referenced',
  },
  {
    id: 'gh-agno', section: 'agent', layer: '开源框架',
    name: 'Agno（原 Phidata）',
    oneLine: '全栈 Agent 框架：模型/工具/记忆/知识/推理/护栏模块化，速度快',
    source: 'GitHub · agno-agi/agno（~43k stars, Apache-2.0）',
    tags: ['开源', '全栈', '模块化'], kind: 'text',
    swatch: { a: '#0b1220', b: '#172554', fg: '#dbeafe', accent: '#38bdf8', pattern: 'grid' },
    bullets: [
      '把 Agent 拆成 model / tools / memory / knowledge / reasoning / guardrails 模块',
      '强调性能与低开销，适合大量 Agent 并行',
      '内置监控与多模态支持',
      'Phidata 已更名为 Agno',
    ],
    howto: '要一套覆盖全链路、又要速度和模块自由度时用。',
    sources: [{ label: 'GitHub 仓库', url: 'https://github.com/agno-agi/agno' }],
    origin: 'referenced',
  },
  {
    id: 'gh-smolagents', section: 'agent', layer: '开源框架',
    name: 'smolagents（Hugging Face）',
    oneLine: '极简 agents 库：代码即行动（CodeAgent），几十行核心，易读易改',
    source: 'GitHub · huggingface/smolagents（~30k stars, Apache-2.0）',
    tags: ['开源', '极简', 'CodeAgent'], kind: 'text',
    swatch: { a: '#111827', b: '#1f2937', fg: '#f3f4f6', accent: '#a78bfa', pattern: 'dots' },
    bullets: [
      '核心思路：让模型写 Python 代码当 action，而不是 JSON tool call',
      '库很小，源码可读，适合教学和定制',
      '和 HF 生态（transformers / hub）结合紧',
    ],
    howto: '想理解 Agent 循环本质、或要一个能随手改的极简实现时看它。',
    sources: [{ label: 'GitHub 仓库', url: 'https://github.com/huggingface/smolagents' }],
    origin: 'referenced',
  },
  {
    id: 'gh-semantic-kernel', section: 'agent', layer: '开源框架',
    name: 'Semantic Kernel（微软）',
    oneLine: '企业级 SDK：C#/Python/Java，plugin 模型 + planner + 企业集成',
    source: 'GitHub · microsoft/semantic-kernel（~28k stars, MIT）',
    tags: ['开源', '企业级', 'C#'], kind: 'text',
    swatch: { a: '#0c0a09', b: '#1c1917', fg: '#fafaf9', accent: '#34d399', pattern: 'rays' },
    bullets: [
      '微软企业向 Agent SDK，多语言（C#/Python/Java）',
      'plugin/skill 抽象把函数与 prompt 统一封装',
      'planner 自动组合步骤，适合 .NET 企业栈',
    ],
    howto: '.NET/Java 企业环境、要稳健集成现有系统时选。',
    sources: [{ label: 'GitHub 仓库', url: 'https://github.com/microsoft/semantic-kernel' }],
    origin: 'referenced',
  },
  {
    id: 'gh-google-adk', section: 'agent', layer: '开源框架',
    name: 'Google ADK',
    oneLine: 'Google Agent Development Kit：多 Agent 组合 + 部署友好 + A2A 协议',
    source: 'GitHub · google/adk-python（Apache-2.0）',
    tags: ['开源', '官方SDK', 'A2A'], kind: 'text',
    swatch: { a: '#0f172a', b: '#1e293b', fg: '#e2e8f0', accent: '#fbbf24', pattern: 'grid' },
    bullets: [
      'Google 的 Agent 开发套件，支持层级化多 Agent 组合',
      '与 Gemini / Vertex AI 集成深，也支持其他模型',
      '配套 A2A（Agent-to-Agent）协议做 Agent 间通信',
    ],
    howto: 'GCP/Vertex 栈、或关注 Agent 间互操作协议时看它。',
    sources: [{ label: 'GitHub 仓库', url: 'https://github.com/google/adk-python' }],
    origin: 'referenced',
  },
  {
    id: 'gh-awesome-frameworks', section: 'agent', layer: '开源框架',
    name: 'Awesome AI Agent Frameworks（精选清单）',
    oneLine: '按「生产可用性」排名的框架清单，附真实取舍与适用场景',
    source: 'GitHub · EijiAC24/awesome-ai-agent-frameworks',
    tags: ['清单', '选型', '生产经验'], kind: 'text',
    swatch: { a: '#0b1220', b: '#172554', fg: '#dbeafe', accent: '#38bdf8', pattern: 'grid' },
    bullets: [
      '排序基于「为 40+ 客户做生产系统时的实战偏好」，不是 star 数',
      'PydanticAI / OpenAI Agents SDK / CrewAI / LlamaIndex / LangGraph / AutoGen / Haystack',
      '每条写清「为什么喜欢、适合什么、踩过的坑」',
    ],
    howto: '要选型、想知道「别人生产里到底用哪个」时先读这份。',
    sources: [{ label: 'GitHub 仓库', url: 'https://github.com/EijiAC24/awesome-ai-agent-frameworks' }],
    origin: 'referenced',
  },
  {
    id: 'gh-five-frameworks', section: 'agent', layer: '开源框架',
    name: '五大框架深度横评（中文）',
    oneLine: 'LangGraph/LlamaIndex/PydanticAI/AutoGen/CrewAI 多维对比：控制力、状态、可观测、成本',
    source: 'GitHub · eulerai-au/blog（agent_framework_report_zh.md）',
    tags: ['横评', '中文', '选型'], kind: 'text',
    swatch: { a: '#111827', b: '#1f2937', fg: '#f3f4f6', accent: '#a78bfa', pattern: 'dots' },
    bullets: [
      '从技术特性/控制能力/状态持久/可观测/部署便利多维打分',
      '结论示例：PydanticAI 重类型安全、CrewAI 重角色协作、LangGraph 重可控',
      '中文材料，适合快速建立选型直觉',
    ],
    howto: '要给团队做框架选型汇报、或快速横向了解时读。',
    sources: [{ label: 'GitHub 仓库', url: 'https://github.com/eulerai-au/blob/main/agent_framework/agent_framework_report_zh.md' }],
    origin: 'referenced',
  },
  {
    id: 'gh-cline', section: 'agent', layer: '开源框架',
    name: 'Cline（编码 Agent）',
    oneLine: 'VS Code 编码 Agent：每步都给人确认，diff 先行，能用终端和浏览器',
    source: 'GitHub · cline/cline（人气 VS Code Agent 插件）',
    tags: ['开源', '编码Agent', '人机确认'], kind: 'text',
    swatch: { a: '#0c0a09', b: '#1c1917', fg: '#fafaf9', accent: '#34d399', pattern: 'rays' },
    bullets: [
      '改文件先显示 diff，跑终端命令先问人——透明度高',
      '@file/@folder/@url/@problems 上下文原语，不整仓塞入',
      '监听 lint/编译错误自行修复循环',
      '多 provider（Anthropic/OpenAI/OpenRouter/Ollama…）',
    ],
    howto: '想看清 Agent 思考轨迹、从编码 Agent 入门时看它的实现。',
    sources: [{ label: 'GitHub 仓库', url: 'https://github.com/cline/cline' }],
    origin: 'referenced',
  },
  {
    id: 'gh-roocode', section: 'agent', layer: '开源框架',
    name: 'Roo Code（多模式编码 Agent）',
    oneLine: 'Cline 的独立分支：Code/Architect/Ask/Debug/Custom 多模式，按阶段切角色',
    source: 'GitHub · RooCodeInc/Roo-Code',
    tags: ['开源', '编码Agent', '多模式'], kind: 'text',
    swatch: { a: '#0f172a', b: '#1e293b', fg: '#e2e8f0', accent: '#fbbf24', pattern: 'grid' },
    bullets: [
      '五种模式各带独立的工具权限和 prompt：写码/规划/问答/调试/自定义',
      'Architect 出方案、Code 落实现，适合评审后开工',
      '支持 MCP 接额外工具',
    ],
    howto: '要精细化控制 Agent 工作流、区分规划与执行阶段时用。',
    sources: [{ label: 'GitHub 仓库', url: 'https://github.com/RooCodeInc/Roo-Code' }],
    origin: 'referenced',
  },
  {
    id: 'gh-aider', section: 'agent', layer: '开源框架',
    name: 'Aider（终端结对编程）',
    oneLine: '终端里的结对 Agent：改完自动 git commit，undo 就是 git revert',
    source: 'GitHub · Aider-AI/aider',
    tags: ['开源', '编码Agent', 'git工作流'], kind: 'text',
    swatch: { a: '#0b1220', b: '#172554', fg: '#dbeafe', accent: '#38bdf8', pattern: 'grid' },
    bullets: [
      '先建代码库地图，再对话驱动修改',
      '每次改动自动生成描述性 commit，回滚简单',
      '支持几乎所有主流模型，配置文件简单',
    ],
    howto: '喜欢命令行 + Git 工作流、做跨文件小重构时很好用。',
    sources: [{ label: 'GitHub 仓库', url: 'https://github.com/Aider-AI/aider' }],
    origin: 'referenced',
  },
]

export const SECTIONS = [
  {
    id: 'agent',
    name: 'Agent 设计工作台',
    hint: '怎么设计一个好 Agent：架构模式 / Skill 设计 / 上下文工程 / 评估安全 / 本机经验',
    layers: [
      { id: 'pattern', name: '架构模式', hint: '提示词链 / 路由 / 并行 / 编排者 / 评估者', entries: AGENT.filter((e) => e.layer === '架构模式') },
      { id: 'skill', name: 'Skill 设计', hint: '规范 / 触发描述 / 形态抉择 / Hooks 编排', entries: AGENT.filter((e) => e.layer === 'Skill 设计') },
      { id: 'context', name: '上下文工程', hint: '五层栈 / ACI / 过载 / 透明性', entries: AGENT.filter((e) => e.layer === '上下文工程') },
      { id: 'eval', name: '评估与安全', hint: 'Evals / Guardrails / 成本', entries: AGENT.filter((e) => e.layer === '评估与安全') },
      { id: 'local', name: '本机经验', hint: '本会话里沉淀的 agent 工程做法', entries: AGENT.filter((e) => e.layer === '本机经验') },
      { id: 'framework', name: '开源框架', hint: 'GitHub 上真实存在的 Agent 架构项目（已核实仓库）', entries: AGENT.filter((e) => e.layer === '开源框架') },
    ],
  },
]

export const ALL_ENTRIES = SECTIONS.flatMap((s) => s.layers.flatMap((l) => l.entries))

export function findEntry(id) {
  return ALL_ENTRIES.find((e) => e.id === id) || null
}

export function sectionOf(id) {
  return SECTIONS.find((s) => s.layers.some((l) => l.entries.some((e) => e.id === id))) || null
}

export function layerOf(id) {
  for (const s of SECTIONS) {
    const layer = s.layers.find((l) => l.entries.some((e) => e.id === id))
    if (layer) return layer
  }
  return null
}

/** 索引式引用：面板复制这句给 AI，完整规格让 AI 用 ai_style op=get 展开 */
export function refOf(entry) {
  const section = sectionOf(entry.id)
  const layer = layerOf(entry.id)
  const src = Array.isArray(entry.sources) ? entry.sources : []
  const cloud = src.find((s) => typeof s.url === 'string' && s.url !== '')
  const local = src.find((s) => typeof s.path === 'string' && s.path !== '')
  const lines = [
    `用 AI 工作台里的「${entry.name}」（${section ? section.name : ''} · ${layer ? layer.name : ''} · ${entry.id}），按这个来做。`,
  ]
  if (cloud) lines.push(`原始材料：${cloud.url}`)
  else if (local) lines.push(`原始材料：${local.path}`)
  else if (entry.source) lines.push(`出处：${entry.source}`)
  lines.push(`要看完整规格：ai_style op=get ${entry.id}`)
  return lines.join('\n')
}

export function specOf(entry) {
  const section = sectionOf(entry.id)
  const layer = layerOf(entry.id)
  const lines = [
    `【Agent 设计参考】${entry.name}（${section ? section.name : ''} · ${layer ? layer.name : ''}）`,
    `一句话：${entry.oneLine}`,
    `出处：${entry.source}`,
    '',
    '要点：',
    ...(entry.bullets || []).map((b) => `  - ${b}`),
    '',
    `怎么用：${entry.howto}`,
  ]
  if (Array.isArray(entry.sources) && entry.sources.length > 0) {
    lines.push('', '原始材料：', ...entry.sources.map((s) => `  - ${s.label}：${s.url || s.path}`))
  }
  return lines.join('\n')
}

export const TAGS = [...new Set(ALL_ENTRIES.flatMap((e) => e.tags || []))].sort()
