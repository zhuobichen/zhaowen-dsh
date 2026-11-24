/**
 * 代码资料库 —— 五层：架构范式 / 工程实践 / 代码风格 / Agent 技能 / 工具链。
 *
 * 和设计工作台同构：每条都指到一个**能打开的东西**（本机路径或外部仓库 URL），
 * 面板给人挑，`code_style` 工具给 AI 读同一份数据。
 *
 * 字段约定：
 *   kind    —— image（有封面）/ text（色卡或纯文字）
 *   cover   —— 绝对路径，由 /code-workbench/cover/<id> 提供（白名单，只认本文件写的）
 *   swatch  —— kind=text 时的配色（a/b 底、fg 字、accent 强调、pattern 图案）
 *   origin  —— mine（自己做的）/ referenced（别人的，只作参照）
 */

/* ══════ 一、架构范式 ══════ */
const ARCH = [
  {
    id: 'arch-layered',
    layer: 'arch',
    name: '分层架构（Layered）',
    oneLine: 'Controller → Service → Repository 三层切开，每层只依赖下一层',
    source: '通用工程实践（Martin Fowler · PoEAA）',
    tags: ['架构', '范式', '分层'],
    kind: 'text',
    swatch: { a: '#0f1b2d', b: '#1a2f4a', fg: '#dbe7f5', accent: '#4a9eff', pattern: 'grid' },
    bullets: [
      'Controller 只做参数校验与响应转换，业务判断一行不写',
      'Service 是唯一允许跨 Repository 编排的地方',
      '依赖方向单向：上层依赖下层，下层不知道上层存在',
      '单文件超过 300 行、或一个 Service 依赖 5 个以上 Repository，就该拆',
    ],
    howto: 'CRUD 为主、团队 3–8 人时最稳；跨层调用一旦出现，先补一层而不是直接调。',
    origin: 'referenced',
  },
  {
    id: 'arch-clean',
    layer: 'arch',
    name: 'Clean Architecture / 六边形',
    oneLine: '业务逻辑在中心，框架、数据库、UI 都只是外围适配器，靠接口反向依赖',
    source: 'Robert C. Martin · Clean Architecture；Alistair Cockburn · Hexagonal',
    tags: ['架构', '范式', '依赖倒置'],
    kind: 'text',
    swatch: { a: '#1a1030', b: '#2f1f52', fg: '#ece4ff', accent: '#b48cff', pattern: 'dots' },
    bullets: [
      '核心域的 import 里不出现 express / prisma / react',
      '端口（interface）定义在核心，适配器实现放在外层',
      '一个用例一个文件，名字是动词短语（PlaceOrder / SyncInbox）',
      '换数据库、换框架时，只改适配器层',
    ],
    howto: '业务规则复杂、要活 3 年以上、或预计换框架时值得；纯 CRUD 会显得过度设计。',
    origin: 'referenced',
  },
  {
    id: 'arch-cqrs',
    layer: 'arch',
    name: 'CQRS + 事件溯源',
    oneLine: '写走 Command、读走 Query，状态变化记成事件流而不是覆盖字段',
    source: 'Greg Young · CQRS / Event Sourcing',
    tags: ['架构', '范式', '事件'],
    kind: 'text',
    swatch: { a: '#2b1216', b: '#4a1f26', fg: '#ffe6ea', accent: '#ff6b81', pattern: 'stripes' },
    bullets: [
      'Command 返回 id 或 void，不返回查询结果',
      '事件不可变、只追加，重放能还原任意时刻状态',
      '读写库可以不同步（最终一致），但要能回答「现在读到旧数据会怎样」',
      '没有审计、回放、复杂并发需求时，别上',
    ],
    howto: '金融账务、审计留痕、需要时间旅行查询时用；普通业务会付出双倍复杂度。',
    origin: 'referenced',
  },
  {
    id: 'arch-event-driven',
    layer: 'arch',
    name: '事件驱动 / 消息队列',
    oneLine: '服务之间不直接调用，发事件、订阅事件，靠消息中间件解耦',
    source: '通用分布式实践（Kafka / RabbitMQ / NATS）',
    tags: ['架构', '范式', '异步'],
    kind: 'text',
    swatch: { a: '#0d1f1a', b: '#173a30', fg: '#dcf5ec', accent: '#3ddc97', pattern: 'rays' },
    bullets: [
      '事件命名用过去式（OrderPlaced），命令用祈使式（PlaceOrder）',
      '必须幂等：同一事件重复投递不能产生副作用',
      '要有死信队列与重放手段，否则出事只能干等',
      '事件 schema 向后兼容，加字段可以、改语义不行',
    ],
    howto: '多服务、长流程、要削峰时用；单体内部用事件总线容易变成隐形 goto。',
    origin: 'referenced',
  },
  {
    id: 'arch-modular-monolith',
    layer: 'arch',
    name: '模块化单体',
    oneLine: '一个部署单元，但内部按业务域切成互不越界的模块——微服务的前一步',
    source: 'Shopify / DHH 一派的实践；Sam Newman · Monolith to Microservices',
    tags: ['架构', '范式', '模块化'],
    kind: 'text',
    swatch: { a: '#1c1a10', b: '#37321d', fg: '#f7f1dc', accent: '#e8c547', pattern: 'grid' },
    bullets: [
      '模块之间只通过公开接口通信，禁止跨模块直接读对方表',
      '每个模块自带迁移脚本、测试、路由前缀',
      '用 lint 规则守住边界（eslint-plugin-boundaries / ArchUnit）',
      '拆微服务时按模块边界拆，别按技术层拆',
    ],
    howto: '团队 10–30 人、想保留单体部署优势又要防腐化时最合适；这也是拆微服务的正确前置。',
    origin: 'referenced',
  },
  {
    id: 'arch-microservices',
    layer: 'arch',
    name: '微服务',
    oneLine: '按业务能力独立部署、独立数据库，代价是分布式的一切麻烦',
    source: 'Sam Newman · Building Microservices',
    tags: ['架构', '范式', '分布式'],
    kind: 'text',
    swatch: { a: '#101820', b: '#1f3344', fg: '#e0eef7', accent: '#ffa94d', pattern: 'dots' },
    bullets: [
      '一个服务一个数据库，禁止跨库 join',
      '服务边界 = 业务能力，不是一个表一个服务',
      '必须先有：链路追踪、集中日志、健康检查、灰度发布',
      '团队少于 15 人时，先做模块化单体',
    ],
    howto: '组织规模大到「沟通成本 > 分布式成本」时才上；否则是给自己造运维债。',
    origin: 'referenced',
  },
]

/* ══════ 二、工程实践 ══════ */
const PRACTICE = [
  {
    id: 'prac-tdd',
    layer: 'practice',
    name: 'TDD（测试先行）',
    oneLine: '红 → 绿 → 重构：先写一个失败的测试，再写刚好通过的代码',
    source: 'Kent Beck · Test-Driven Development',
    tags: ['实践', '测试', 'TDD'],
    kind: 'text',
    swatch: { a: '#1a1015', b: '#331f29', fg: '#ffe9f0', accent: '#ff5d8f', pattern: 'stripes' },
    bullets: [
      '一次只让一个测试失败，失败原因要能一句话说清',
      '绿了立刻重构，不留「等下再整理」',
      '测试名写行为不写实现（should_reject_expired_token，不是 test_validate_3）',
      '外部依赖（时间、网络、随机）必须可注入',
    ],
    howto: '逻辑分支多、回归成本高的模块最值得；纯 UI 布局、一次性脚本不必强求。',
    origin: 'referenced',
  },
  {
    id: 'prac-review',
    layer: 'practice',
    name: '代码评审',
    oneLine: '评审看的是「三个月后别人能不能改」，不是「我喜不喜欢这种写法」',
    source: 'Google Engineering Practices · Code Review',
    tags: ['实践', '评审', '协作'],
    kind: 'text',
    swatch: { a: '#101a24', b: '#1c3040', fg: '#e3f0f8', accent: '#5bc0eb', pattern: 'grid' },
    bullets: [
      '单次 PR 控制在 400 行以内，超过就拆',
      '分三类意见：必须改（bug/安全）、建议改（可读性）、随便聊聊',
      '不说「这样不好」，说「这样在 X 情况下会 Y，建议 Z」',
      '作者改完要回一条「已改 / 不改的理由」，别静默',
    ],
    howto: '团队协作必备；一个人写代码时，用它做自审清单。',
    origin: 'referenced',
  },
  {
    id: 'prac-refactor',
    layer: 'practice',
    name: '重构',
    oneLine: '不改变外部行为的前提下改结构——每次一小步，随时可停',
    source: 'Martin Fowler · Refactoring',
    tags: ['实践', '重构', '代码质量'],
    kind: 'text',
    swatch: { a: '#151515', b: '#2a2a2a', fg: '#eeeeee', accent: '#ffd166', pattern: 'dots' },
    bullets: [
      '重构前必须有测试；没有就先补特征测试（characterization test）',
      '一次只做一种手法（提取函数 / 内联 / 搬移），做完跑测试',
      '重构与功能改动分成两个 commit，别混在一起',
      '闻到坏味道先记录，别顺手大改',
    ],
    howto: '接手老代码、加功能前先清理局部时用；重构和新功能同时做最容易出事。',
    origin: 'referenced',
  },
  {
    id: 'prac-adr',
    layer: 'practice',
    name: 'ADR（架构决策记录）',
    oneLine: '每个重要决定写一页：背景、选项、选了什么、代价是什么',
    source: 'Michael Nygard · Documenting Architecture Decisions',
    tags: ['实践', '文档', '决策'],
    kind: 'text',
    swatch: { a: '#1b1b12', b: '#33331f', fg: '#f5f3e0', accent: '#c9b458', pattern: 'stripes' },
    bullets: [
      '一条 ADR 只记一个决定，200–500 字',
      '必须写「放弃了哪些选项、为什么」——这是三个月后最值钱的部分',
      '状态只有三种：提议 / 已采纳 / 已废弃（废弃不删，标注被谁替代）',
      '放仓库里（docs/adr/），跟着代码走',
    ],
    howto: '任何「以后会有人问为什么这么干」的决定；技术选型、边界划分、数据模型变更。',
    origin: 'referenced',
  },
  {
    id: 'prac-observability',
    layer: 'practice',
    name: '可观测性',
    oneLine: '日志、指标、链路追踪三件套——出问题时能回答「哪里慢了、谁调了谁」',
    source: 'Google SRE Book；OpenTelemetry 规范',
    tags: ['实践', '运维', '监控'],
    kind: 'text',
    swatch: { a: '#0c1620', b: '#16293a', fg: '#dff0fa', accent: '#4dd0e1', pattern: 'grid' },
    bullets: [
      '日志结构化（JSON），带 trace_id / user_id / 耗时',
      '指标只埋四类：请求量、错误率、延迟分位（p50/p95/p99）、饱和度',
      '链路追踪要跨服务透传 trace_id，否则等于没有',
      '告警按「用户可感知」设，不按 CPU 设',
    ],
    howto: '上线前就该有；等出事再补，通常已经找不到原因了。',
    origin: 'referenced',
  },
  {
    id: 'prac-cicd',
    layer: 'practice',
    name: 'CI/CD',
    oneLine: '每次提交都自动跑测试、构建、部署——把「能不能发」变成机器判断',
    source: 'GitHub Actions / GitLab CI 通用实践',
    tags: ['实践', '自动化', '发布'],
    kind: 'text',
    swatch: { a: '#131a13', b: '#243424', fg: '#e6f5e6', accent: '#7ed957', pattern: 'rays' },
    bullets: [
      '流水线分三段：检查（秒级）→ 测试（分钟级）→ 部署（人工确认）',
      '主干保护：CI 不过不能合并',
      '部署要可回滚，回滚步骤写进 runbook',
      '密钥走 secret 管理，不进仓库、不进日志',
    ],
    howto: '任何有第二个人的项目；一个人的项目也值得，因为能防自己手滑。',
    origin: 'referenced',
  },
]

/* ══════ 三、代码风格 ══════ */
const STYLE = [
  {
    id: 'style-solid',
    layer: 'style',
    name: 'SOLID',
    oneLine: '五个原则：单一职责、开闭、里氏替换、接口隔离、依赖倒置',
    source: 'Robert C. Martin',
    tags: ['风格', '范式', '面向对象'],
    kind: 'text',
    swatch: { a: '#101828', b: '#1e3050', fg: '#e4eeff', accent: '#7aa2f7', pattern: 'grid' },
    bullets: [
      '单一职责：一个类只有一个「因为什么而改」的理由',
      '开闭：加功能靠加代码，不靠改既有分支',
      '里氏替换：子类不能改变父类的契约（抛新异常、收紧前置条件）',
      '接口隔离：宁可多个小接口，不要一个胖接口',
      '依赖倒置：依赖抽象，不依赖具体实现',
    ],
    howto: 'OOP 项目的地基；但别为了「符合 SOLID」硬拆类——拆到没人看得懂就是过度。',
    origin: 'referenced',
  },
  {
    id: 'style-functional',
    layer: 'style',
    name: '函数式风格',
    oneLine: '纯函数 + 不可变数据 + 组合，把副作用推到边界',
    source: '通用函数式实践（Haskell / Elixir / FP-TS）',
    tags: ['风格', '范式', '函数式'],
    kind: 'text',
    swatch: { a: '#141018', b: '#2a1f33', fg: '#f0e6ff', accent: '#c792ea', pattern: 'dots' },
    bullets: [
      '核心逻辑写成纯函数：同样输入必得同样输出，不碰外部状态',
      '副作用（IO、时间、随机）集中在最外层',
      '用 map/filter/reduce 代替手写循环与临时变量',
      '不可变优先；必须要改时，明确标注边界',
    ],
    howto: '数据处理、规则引擎、并发场景最合适；UI 状态管理也能受益。',
    origin: 'referenced',
  },
  {
    id: 'style-errors',
    layer: 'style',
    name: '错误处理',
    oneLine: '把「业务上可预期的失败」当返回值，把「程序写错了」当异常',
    source: '通用实践（Rust Result / Go error / TS neverthrow）',
    tags: ['风格', '健壮性', '错误'],
    kind: 'text',
    swatch: { a: '#22100f', b: '#42201d', fg: '#ffe8e4', accent: '#ff7043', pattern: 'stripes' },
    bullets: [
      '可预期失败（校验不过、余额不足）用返回值 / Result，不用 throw',
      '不可恢复（空指针、越界）才 throw，并且别 catch 了什么都不做',
      '错误要带上下文：做了什么、输入是什么、期望什么',
      '不要用错误码做流程控制',
    ],
    howto: '任何跨边界的调用（API、DB、文件）；错误处理设计不好，排查成本会翻十倍。',
    origin: 'referenced',
  },
  {
    id: 'style-naming',
    layer: 'style',
    name: '命名与结构',
    oneLine: '名字是唯一的文档：看到调用处就知道它干什么、返回什么',
    source: 'Clean Code / 《编写可读代码的艺术》',
    tags: ['风格', '可读性', '命名'],
    kind: 'text',
    swatch: { a: '#161616', b: '#2c2c2c', fg: '#f2f2f2', accent: '#9ccc65', pattern: 'dots' },
    bullets: [
      '布尔值用 is/has/can 开头，函数用动词开头',
      '别用 data、info、manager、util 这种万能词',
      '名字长度与作用域成正比：循环变量 i 可以，全局配置不行',
      '一个函数做一件事；超过 40 行就要问「能不能拆」',
    ],
    howto: '评审时最常提的一类意见；也是接手代码时最先感受到的差异。',
    origin: 'referenced',
  },
  {
    id: 'style-data-oriented',
    layer: 'style',
    name: '数据导向设计',
    oneLine: '先想清楚数据的形状，再想代码——结构对了，逻辑自然短',
    source: 'Data-Oriented Design / Mike Acton',
    tags: ['风格', '范式', '数据'],
    kind: 'text',
    swatch: { a: '#0f1a1a', b: '#1c2f2f', fg: '#e0f5f5', accent: '#4db6ac', pattern: 'grid' },
    bullets: [
      '先画数据流：谁产生、谁转换、谁消费',
      '同一份数据只存一份，其他都是派生',
      '用「表 + 变换」代替「一堆对象互相调用」',
      '状态机优于布尔标志堆叠',
    ],
    howto: '复杂业务状态、报表、游戏逻辑；比先写类再想数据要少绕很多弯。',
    origin: 'referenced',
  },
]

/* ══════ 四、Agent 技能（GitHub 上的开源 skill 包） ══════ */
const SKILL = [
  {
    id: 'skill-superpowers',
    layer: 'skill',
    name: 'superpowers（obra）',
    oneLine: '一整套 agentic 软件开发方法论：从需求澄清、计划、实现到评审的 skill 集合',
    source: 'https://github.com/obra/superpowers',
    tags: ['skill', '方法论', '工作流'],
    kind: 'text',
    swatch: { a: '#1a0f2e', b: '#2f1a4f', fg: '#f0e6ff', accent: '#a78bfa', pattern: 'rays' },
    bullets: [
      '把「想清楚再动手」拆成可执行的步骤：头脑风暴 → 计划 → 分步实现',
      '强调小步提交、每步可验证',
      '适合当主工作流框架，再挂别的专用 skill',
    ],
    howto: '想要一套完整开发流程时用；它给的是骨架，具体技术栈还得配别的 skill。',
    origin: 'referenced',
  },
  {
    id: 'skill-addyosmani',
    layer: 'skill',
    name: 'agent-skills（Addy Osmani）',
    oneLine: '面向 AI coding agent 的生产级工程技能：性能、可访问性、代码质量',
    source: 'https://github.com/addyosmani/agent-skills',
    tags: ['skill', '工程', '质量'],
    kind: 'text',
    swatch: { a: '#0f1f1a', b: '#1c352c', fg: '#e4f7ee', accent: '#34d399', pattern: 'grid' },
    bullets: [
      '每份 skill 带明确的触发条件与检查项',
      '偏 Web 前端与性能方向',
      '适合挂在评审、优化类的任务上',
    ],
    howto: '做前端/Web 项目时补充工程规范；不是通用后端 skill。',
    origin: 'referenced',
  },
  {
    id: 'skill-karpathy',
    layer: 'skill',
    name: 'karpathy-skills',
    oneLine: '从 Karpathy 的工程习惯提炼的 CLAUDE.md 规则：先写最小可跑版本，再迭代',
    source: 'https://github.com/multica-ai/andrej-karpathy-skills',
    tags: ['skill', '习惯', '方法论'],
    kind: 'text',
    swatch: { a: '#161616', b: '#2b2b2b', fg: '#f0f0f0', accent: '#ffd166', pattern: 'dots' },
    bullets: [
      '强调「先让它跑起来」，别一上来就抽象',
      '小步验证、频繁运行而不是憋大招',
      '读完能明显改变 agent 的行为倾向',
    ],
    howto: '给 agent 加「工程直觉」时用；单文件 CLAUDE.md，接入成本最低。',
    origin: 'referenced',
  },
  {
    id: 'skill-agent-rules-books',
    layer: 'skill',
    name: 'agent-rules-books',
    oneLine: '把经典编程书的规则提炼成 AGENTS.md：Clean Code、DDD、重构……',
    source: 'https://github.com/ciembor/agent-rules-books',
    tags: ['skill', '规则', '书籍'],
    kind: 'text',
    swatch: { a: '#1b1510', b: '#33271c', fg: '#f7ece0', accent: '#d99b4a', pattern: 'stripes' },
    bullets: [
      '按书分文件，可以只挑需要的挂',
      '规则写成祈使句，agent 容易遵守',
      '适合当评审清单用',
    ],
    howto: '想给 agent 装「读过书」的判断力；按需挑书，别全挂（会互相冲突）。',
    origin: 'referenced',
  },
  {
    id: 'skill-solid',
    layer: 'skill',
    name: 'solid-skills',
    oneLine: '把 SOLID 写成 agent 可执行的规则，目标是产出「资深工程师水准」的代码',
    source: 'https://github.com/ramziddin/solid-skills',
    tags: ['skill', 'SOLID', '面向对象'],
    kind: 'text',
    swatch: { a: '#101828', b: '#1d3050', fg: '#e4eeff', accent: '#7aa2f7', pattern: 'grid' },
    bullets: [
      '每条原则配「反例 → 正例」',
      '适合 OOP 项目接入',
      '和 TDD skill 一起用效果更好',
    ],
    howto: 'OOP 项目的代码评审与重构；纯函数式项目不适用。',
    origin: 'referenced',
  },
  {
    id: 'skill-ecc',
    layer: 'skill',
    name: 'ECC（agent harness 优化）',
    oneLine: '优化 agent 运行时本身：上下文管理、工具调用策略、性能',
    source: 'https://github.com/affaan-m/ECC',
    tags: ['skill', 'harness', '性能'],
    kind: 'text',
    swatch: { a: '#0d0d14', b: '#1c1c2e', fg: '#e8e8f5', accent: '#8b8bff', pattern: 'rays' },
    bullets: [
      '关注的是 agent 怎么跑，不是代码怎么写',
      '包含 instinct / memory 之类的机制',
      '偏底层，普通业务开发用不太上',
    ],
    howto: '调优 agent 行为本身时看；和「写业务代码」不是一类。',
    origin: 'referenced',
  },
  {
    id: 'skill-taste',
    layer: 'skill',
    name: 'taste-skill',
    oneLine: '给 coding agent 装「品味」：美术方向、参考图、视觉判断',
    source: 'https://github.com/Leonxlnx/taste-skill',
    tags: ['skill', '品味', '视觉'],
    kind: 'text',
    swatch: { a: '#1a1018', b: '#331f30', fg: '#ffe8f5', accent: '#f472b6', pattern: 'dots' },
    bullets: [
      '解决「代码能跑但很难看」的问题',
      '带参考图与视觉判断标准',
      '偏前端/UI 场景',
    ],
    howto: '做界面时补审美；纯后端用不上。',
    origin: 'referenced',
  },
  {
    id: 'skill-caveman',
    layer: 'skill',
    name: 'caveman（省 token）',
    oneLine: '用「少用词」的方式说话，省 token 又保持表达清楚',
    source: 'https://github.com/JuliusBrussee/caveman',
    tags: ['skill', 'token', '效率'],
    kind: 'text',
    swatch: { a: '#141410', b: '#28281f', fg: '#f2f2e0', accent: '#a3e635', pattern: 'stripes' },
    bullets: [
      '压缩 agent 的输出风格，减少冗余',
      '适合长会话、上下文紧张的场景',
      '可读性会降，正式文档别用',
    ],
    howto: '上下文快满、或大量机械性输出时开；写给人看的代码注释别用这套。',
    origin: 'referenced',
  },
]

/* ══════ 五、工具链 ══════ */
const TOOL = [
  {
    id: 'tool-eslint-prettier',
    layer: 'tool',
    name: 'ESLint + Prettier',
    oneLine: '一个管「对不对」，一个管「齐不齐」——别让它们互相打架',
    source: 'https://eslint.org / https://prettier.io',
    tags: ['工具', '前端', '规范'],
    kind: 'text',
    swatch: { a: '#141a2e', b: '#243358', fg: '#e6edff', accent: '#7c9eff', pattern: 'grid' },
    bullets: [
      'Prettier 管格式，ESLint 关掉所有格式类规则（用 eslint-config-prettier）',
      '提交前跑 lint-staged，只检查改动的文件',
      '规则集从 recommended 起步，别一次开 200 条',
    ],
    howto: 'JS/TS 项目标配；团队统一比规则多寡重要。',
    origin: 'referenced',
  },
  {
    id: 'tool-typescript',
    layer: 'tool',
    name: 'TypeScript 严格模式',
    oneLine: 'strict: true 是底线；再往上开 noUncheckedIndexedAccess 能挡掉一批运行时错',
    source: 'https://www.typescriptlang.org/tsconfig',
    tags: ['工具', '类型', '前端'],
    kind: 'text',
    swatch: { a: '#0f1a2e', b: '#1c3155', fg: '#e0ecff', accent: '#3b82f6', pattern: 'dots' },
    bullets: [
      'strict: true 必开，别用 any 兜底',
      'noUncheckedIndexedAccess：数组取值可能是 undefined，逼你处理',
      'exactOptionalPropertyTypes：可选字段不给 undefined',
      '类型定义放 types.ts，别散落在业务文件里',
    ],
    howto: '任何 TS 项目；老项目开启 strict 可以按目录渐进。',
    origin: 'referenced',
  },
  {
    id: 'tool-biome',
    layer: 'tool',
    name: 'Biome',
    oneLine: 'Rust 写的 lint + format 二合一，比 ESLint + Prettier 快一个数量级',
    source: 'https://biomejs.dev',
    tags: ['工具', '前端', '性能'],
    kind: 'text',
    swatch: { a: '#1a1a0f', b: '#33331f', fg: '#f5f5e0', accent: '#eab308', pattern: 'rays' },
    bullets: [
      '一个命令同时做格式化和 lint',
      '冷启动快，适合大仓库与 pre-commit',
      '规则集比 ESLint 生态少，复杂项目可能要混用',
    ],
    howto: '新项目、或嫌 ESLint 慢时换；老项目迁移先跑一遍 diff 看噪音量。',
    origin: 'referenced',
  },
  {
    id: 'tool-ruff-uv',
    layer: 'tool',
    name: 'ruff + uv（Python）',
    oneLine: 'Python 的 Biome 时刻：uv 管依赖与虚拟环境，ruff 管 lint 与格式',
    source: 'https://docs.astral.sh/ruff / https://docs.astral.sh/uv',
    tags: ['工具', 'Python', '性能'],
    kind: 'text',
    swatch: { a: '#0f1a1a', b: '#1c3333', fg: '#e0f5f5', accent: '#2dd4bf', pattern: 'grid' },
    bullets: [
      'uv 装包比 pip 快 10–100 倍，且自带锁文件',
      'ruff 一个工具替代 flake8 + isort + black',
      '配置集中在 pyproject.toml，别散落 setup.cfg / .flake8',
    ],
    howto: '任何 Python 项目；迁移成本低，收益立刻可见。',
    origin: 'referenced',
  },
  {
    id: 'tool-act',
    layer: 'tool',
    name: 'act（本地跑 GitHub Actions）',
    oneLine: '在本地用 Docker 跑 CI 流程，不用推上去等结果',
    source: 'https://github.com/nektos/act',
    tags: ['工具', 'CI', '效率'],
    kind: 'text',
    swatch: { a: '#141414', b: '#282828', fg: '#f0f0f0', accent: '#22d3ee', pattern: 'stripes' },
    bullets: [
      '调试 workflow 时省掉反复 push',
      '需要 Docker；Windows 上跑 Linux runner 会有兼容问题',
      '只适合调试，不要用它替代真实 CI',
    ],
    howto: '经常改 CI 配置时用；偶尔改一次不值得装。',
    origin: 'referenced',
  },
]

/**
 * 每层的筛选芯片。
 * 要求：语义不重叠、每个至少命中 2 条、覆盖本层主要群体。
 */
export const LAYERS = [
  { id: 'arch', name: '架构范式', hint: '分层 / Clean / CQRS / 事件 / 模块化 / 微服务', filters: ['分层', '依赖倒置', '事件', '分布式', '模块化'], entries: ARCH },
  { id: 'practice', name: '工程实践', hint: '测试、评审、重构、文档、可观测、发布', filters: ['测试', '评审', '重构', '文档', '运维'], entries: PRACTICE },
  { id: 'style', name: '代码风格', hint: 'SOLID / 函数式 / 错误处理 / 命名 / 数据导向', filters: ['面向对象', '函数式', '健壮性', '可读性', '数据'], entries: STYLE },
  { id: 'skill', name: 'Agent 技能', hint: 'GitHub 上开源的 coding skill：方法论、规则、品味、省 token', filters: ['方法论', '规则', '工程', '视觉', '效率'], entries: SKILL },
  { id: 'tool', name: '工具链', hint: 'lint / format / 类型 / 依赖 / CI', filters: ['前端', 'Python', '类型', 'CI', '性能'], entries: TOOL },
]

export const ALL_ENTRIES = LAYERS.flatMap((l) => l.entries)

export function findEntry(id) {
  return ALL_ENTRIES.find((e) => e.id === id) || null
}

export function layerOf(id) {
  return LAYERS.find((l) => l.entries.some((e) => e.id === id)) || null
}

/** 索引式引用：只给「用哪一条」，细节让 AI 自己 code_style op=get。 */
export function refOf(entry) {
  const layer = layerOf(entry.id)
  const src = Array.isArray(entry.sources) ? entry.sources : []
  const cloud = src.find((s) => typeof s.url === 'string' && s.url !== '')
  const local = src.find((s) => typeof s.path === 'string' && s.path !== '')
  const lines = [
    `按代码工作台里的「${entry.name}」（${layer === null ? '' : layer.name} · ${entry.id}）来做。`,
  ]
  if (cloud !== undefined) {
    lines.push(`原始材料：${cloud.url}`)
    if (local !== undefined) lines.push(`本地副本：${local.path}`)
  } else if (local !== undefined) {
    lines.push(`原始材料：${local.path}`)
  } else if (entry.source) {
    lines.push(`出处：${entry.source}`)
  }
  lines.push(`要看完整规格：code_style op=get ${entry.id}`)
  return lines.join('\n')
}

/** 内页单项：本库暂时没有 members，直接退回整条索引。 */
export function memberRef(entry, index) {
  return refOf(entry)
}

export function specOf(entry) {
  const layer = layerOf(entry.id)
  const lines = [
    `【代码参考】${entry.name}（${layer === null ? '代码' : layer.name}）`,
    `一句话：${entry.oneLine}`,
    `出处：${entry.source}`,
  ]
  if (Array.isArray(entry.bullets) && entry.bullets.length > 0) {
    lines.push('', '要点：', ...entry.bullets.map((b) => `  - ${b}`))
  }
  if (Array.isArray(entry.sources) && entry.sources.length > 0) {
    lines.push('', '原始材料：', ...entry.sources.map((x) => `  - ${x.label}：${x.url ?? x.path}`))
  }
  lines.push('', `怎么用：${entry.howto}`)
  return lines.join('\n')
}

for (const e of ALL_ENTRIES) {
  e.prompt = refOf(e)
  e.spec = specOf(e)
}

export const TAGS = [...new Set(ALL_ENTRIES.flatMap((e) => e.tags ?? []))]
