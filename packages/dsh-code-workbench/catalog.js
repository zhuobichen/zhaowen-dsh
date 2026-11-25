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

/* ══════ 四大类：新增条目 ══════
 *
 * 2026-11-25 重组：原来按「架构/实践/风格/技能/工具」分，那是按**主题**分的；
 * 用户要的是按**活儿**分：软件开发 / 网页开发 / 数据分析 / CLI。
 * 老的五组不删，作为「软件开发」里的子块继续存在。
 */

/* ── 软件开发（补） ── */
const DEV_EXTRA = [
  {
    id: 'dev-rea',
    name: '逆向工程（REA / reverse-engineer-anything）',
    oneLine: '拿到成品而不是源码时，用「证据 → 假设 → 验证」还原它怎么做的',
    source: '本机 skill: reverse-engineer-anything + rea-video',
    tags: ['技能', '逆向', '证据链'],
    kind: 'text',
    swatch: { a: '#111827', b: '#1f2937', fg: '#e5e7eb', accent: '#f59e0b', pattern: 'grid' },
    bullets: [
      '先要「成品证据」：二进制/安装包/线上产物，而不是 README 的自述',
      '每个结论挂一条证据（地址、字符串、抓包、截图），没有证据的写进 unknowns',
      '静态优先（反编译/字符串/导入表），动态只在静态说不清时上（断点/抓包）',
      '交付的是「能复刻的解释」，不是一堆函数清单',
    ],
    howto: '遇到 Electron/打包产物/固件/线上混淆代码，先走这条；源码在手的普通分析别用。',
    sources: [{ label: 'skill 说明', path: 'C:/Users/Administrator/.dsh/skills' }, { label: 'rea-video', path: 'D:/github_project/ZhaoWen_GitHub维护/rea-video' }],
  },
  {
    id: 'dev-ig5',
    name: 'IG5 逆向工具链（静态 / 调试 / diff / patch）',
    oneLine: 'Ghidra 内核常驻：函数清单、伪代码、字符串、bindiff、补丁与签名，一套工具打通',
    source: '本机 IG5 插件（ig5_* 工具）+ skills ig5-triage / deep-dive / diff / patch-and-sign',
    tags: ['工具', '逆向', '二进制'],
    kind: 'text',
    swatch: { a: '#0b1220', b: '#16233a', fg: '#dbeafe', accent: '#38bdf8', pattern: 'dots' },
    bullets: [
      '先 ig5_open 建库（后台分析），再 ig5_funcs 按名字过滤，别一上来全量 dump',
      '伪代码看三处：参数校验、字符串引用、错误分支——恶意与否八成在这',
      '比较版本用 diff（多特征启发式），补丁必须 expected 字节核验再写',
      '一条结论配一条证据 id，别把推断写成事实',
    ],
    howto: '分析 Windows PE/驱动、找 license 校验、比对两个版本行为差异时用。',
    sources: [{ label: 'skill: ig5-triage', path: 'C:/Users/Administrator/.dsh/skills' }],
  },
  {
    id: 'dev-blender',
    name: 'Blender 建模流水线',
    oneLine: '先按决策树选形，再走「冻结规格 → Blockout → 粗形精修 → 修改器栈 → 清理 → 交接」',
    source: '本机 skill: blender-modeling + blender 插件（blender_* 工具）',
    tags: ['技能', '3D', '建模'],
    kind: 'text',
    swatch: { a: '#1c1917', b: '#292524', fg: '#f5f5f4', accent: '#fb923c', pattern: 'grid' },
    bullets: [
      '六条必踩的坑：长轴/宽轴/薄轴语义、收尖压中线、headless 慎用 bpy.ops、法线方向、预览光照、板缝',
      '改形之前先留事务点（blender_rt_txn snapshot），改坏了能回',
      '验收用固定机位对照图，不靠「看起来差不多」',
    ],
    howto: '要出 3D 资产/道具/场景时用；只在需要「看得见形状」的活上花时间。',
    sources: [{ label: 'skill 目录', path: 'C:/Users/Administrator/.dsh/skills' }],
  },
  {
    id: 'dev-subagent',
    name: '子 Agent 编排（dispatch / fork）',
    oneLine: '该不该拆、拆给谁、怎么收回结果：三个判据比「并行更快」靠谱',
    source: '本机 skill: agent-dispatch + 工具 subagent / subagent_fork / team_task_*',
    tags: ['方法论', 'Agent', '协作'],
    kind: 'text',
    swatch: { a: '#0f172a', b: '#1e293b', fg: '#e2e8f0', accent: '#a78bfa', pattern: 'rays' },
    bullets: [
      '默认不拆：只有「上下文膨胀有证据 / 高并发且上下文独立 / 工具过载或指令冲突」才拆',
      '材料多但要保真 → 渐进式披露，而不是开一堆子 Agent 各读一半',
      '子 Agent 必须有可验证的交付物（文件/结论/失败原因），否则等于没拆',
      'fork 用于「接着我这段上下文干」，subagent 用于「另起一个干净的活」',
    ],
    howto: '活干到一半发现要读十几个文件、或要同时试三种方案时，再考虑拆。',
    sources: [{ label: 'skill: agent-dispatch', path: 'C:/Users/Administrator/.dsh/skills' }],
  },
  {
    id: 'dev-zcode-bridge',
    name: '给别的 AI 编程工具接自己的模型',
    oneLine: '把 DSH 的 provider 配置反推给 ZCode / Kimi Code，并把会话记录读出来',
    source: '本机 skill: zcode-kimi-integration + dsh-zcode-bridge / dsh-kimi-bridge 插件',
    tags: ['工具', '集成', '会话迁移'],
    kind: 'text',
    swatch: { a: '#111827', b: '#1f2937', fg: '#f3f4f6', accent: '#22d3ee', pattern: 'stripes' },
    bullets: [
      '先看它是 Electron 还是裸 CLI：Electron 就去 userData 找 settings.json / LevelDB',
      '模型配置要写全：baseURL、model id、key 环境变量名、header 变体（有的要 api-key 有的要 Authorization）',
      '会话迁移读 JSONL 时保留 tool 调用，否则还原出来是一堆「孤儿」文本',
    ],
    howto: '换工具/换机器要带走对话，或想让 Kimi 用 DeepSeek 的 key 时用。',
    sources: [{ label: 'skill: zcode-kimi-integration', path: 'C:/Users/Administrator/.dsh/skills' }],
  },
  {
    id: 'dev-dsh-plugin',
    name: 'DSH 插件与工具开发',
    oneLine: 'defineTool + ctx.tools.register + client 半边 __ModuleLoader__：三个门禁别踩',
    source: '本机 skill: dsh-doc + 仓库 packages/* 27 个包',
    tags: ['工具', '插件', 'DSH'],
    kind: 'text',
    swatch: { a: '#0b1020', b: '#15213d', fg: '#dbeafe', accent: '#60a5fa', pattern: 'grid' },
    bullets: [
      'client 半边的模块 id 必须等于包名，否则面板静默不挂（报 loaded without registering）',
      'exports 要有 "./client"、files 要带上、cordis.patch.yml 的 id 不能与别的插件重名',
      '跑 node scripts/check-plugins.mjs 与 check-await-safety.mjs：await 必须有截止时间',
      '改了 client.js 让用户刷新；改了 index.js 用 plugin_manager 禁用再启用，不用重启',
    ],
    howto: '要给 DSH 加面板/工具/MCP 时先读这个，能省掉两小时「为什么 tab 不出现」。',
    sources: [{ label: 'skill: dsh-doc', path: 'C:/Users/Administrator/.dsh/skills' }, { label: '仓库', path: 'D:/github_project/ZhaoWen_GitHub维护/zhaowen-dsh' }],
  },
  {
    id: 'dev-git-flow',
    name: 'Git 工作流（trunk-based + worktree）',
    oneLine: '小步提交、一个改动一个分支、并行任务用 worktree 隔离，别 stash 当存档',
    source: '通用实践 + 本仓库 27 个包的实际用法',
    tags: ['实践', 'Git', '协作'],
    kind: 'text',
    swatch: { a: '#1f2937', b: '#374151', fg: '#e5e7eb', accent: '#f97316', pattern: 'stripes' },
    bullets: [
      '一个提交一件事，message 写「为什么」而不是「改了哪行」',
      '并行改两个包用 git worktree，省得切分支切丢上下文',
      '推送前先 git pull --rebase --autostash，避免把别人的提交顶掉',
      '冲突只在本地解决，不要在远端 force push 覆盖别人的提交',
    ],
    howto: '多人/多会话同时改一个仓库时按这个来；单机小项目可以简化。',
    sources: [{ label: 'git 文档', url: 'https://git-scm.com/docs' }],
  },
  {
    id: 'dev-debugging',
    name: '系统化调试（二分 / 最小复现 / 观测）',
    oneLine: '先缩小范围再猜原因：能复现、能二分、能看见中间值，三件事缺一不可',
    source: '通用实践（Julia Evans 的调试笔记 + 本机实战）',
    tags: ['实践', '调试', '故障'],
    kind: 'text',
    swatch: { a: '#1e1b4b', b: '#312e81', fg: '#e0e7ff', accent: '#f472b6', pattern: 'dots' },
    bullets: [
      '先把「能稳定复现」拿下：一条命令/一个 URL/一次点击',
      '二分：注释掉一半、关掉一半中间件、换一半数据，比读代码快',
      '观测先于假设：加日志/打印中间值，别在脑子里跑',
      '修完补一条能拦住它的测试，否则下周还会回来',
    ],
    howto: '「本地好好的线上坏」「偶发」「改了一行全崩」这三类问题先用这套。',
    sources: [{ label: 'debugging 笔记', url: 'https://jvns.ca/categories/debugging/' }],
  },
]

/* ── 网页开发 ── */
const WEB = [
  {
    id: 'web-react-vite',
    name: 'React + Vite + TypeScript 严格模式',
    oneLine: 'Vite 起步、TS strict、路径别名、ESLint/Biome 一条命令，别从 CRA 开始',
    source: '通用实践（本机 AIL / personal-page 都是这套）',
    tags: ['前端', 'React', '脚手架'],
    kind: 'text',
    swatch: { a: '#0b1220', b: '#1b2a4a', fg: '#e6f0ff', accent: '#61dafb', pattern: 'grid' },
    bullets: [
      'tsconfig 开 strict + noUncheckedIndexedAccess，报错多但省下运行时调试',
      'vite.config 里配 alias 与 proxy，前后端同域调试最省事',
      '构建产物用 rollup manualChunks 拆 vendor，首屏别超过 200KB gz',
    ],
    howto: '新开一个后台/工具类 Web 应用时用这套起步。',
    sources: [{ label: 'Vite', url: 'https://vite.dev/guide/' }],
  },
  {
    id: 'web-next-rsc',
    name: 'Next.js App Router / RSC',
    oneLine: '服务端组件取数据、客户端组件只负责交互，边界画错就是「全站都变 client」',
    source: 'Next.js 官方文档（App Router）',
    tags: ['前端', 'Next', 'SSR'],
    kind: 'text',
    swatch: { a: '#000000', b: '#111111', fg: '#fafafa', accent: '#a3e635', pattern: 'stripes' },
    bullets: [
      '"use client" 只加在真正要 hooks 的那个文件上，别加在 layout',
      '数据获取放 server component，别在 useEffect 里再取一遍',
      '缓存三件套：revalidate / cache / dynamic，写清楚哪个页面是动态的',
    ],
    howto: '要做 SEO 友好的站或需要服务端渲染首屏时用；纯内部面板用 Vite 更轻。',
    sources: [{ label: 'Next.js 文档', url: 'https://nextjs.org/docs' }],
  },
  {
    id: 'web-api-contract',
    name: 'API 契约（REST / tRPC / 错误码）',
    oneLine: '先定错误码与响应形状，再写实现；前端和后端永远从同一份 schema 出发',
    source: '通用实践 + 本仓库 dsh 的 web 插件接口',
    tags: ['后端', '接口', '契约'],
    kind: 'text',
    swatch: { a: '#0f172a', b: '#1e3a5f', fg: '#e2e8f0', accent: '#34d399', pattern: 'grid' },
    bullets: [
      '响应统一 { ok, code, error, note }，前端只认这四样，少猜一层',
      '错误码用大写下划线（UNAUTHORIZED / NOT_FOUND），别用数字堆',
      '幂等接口带 Idempotency-Key；写操作返回资源本身而不是 "success"',
    ],
    howto: '自己前后端一起写时尤其要这么干，能省掉一半联调时间。',
    sources: [{ label: 'HTTP 语义', url: 'https://developer.mozilla.org/docs/Web/HTTP' }],
  },
  {
    id: 'web-auth-session',
    name: '鉴权与会话（Cookie / OAuth / 权限）',
    oneLine: '会话用 HttpOnly Cookie，权限判断放服务端且逐接口写，别只在前端藏按钮',
    source: 'OWASP Cheat Sheet 系列',
    tags: ['后端', '安全', '会话'],
    kind: 'text',
    swatch: { a: '#111827', b: '#1f2937', fg: '#f9fafb', accent: '#fbbf24', pattern: 'dots' },
    bullets: [
      'Cookie: HttpOnly + Secure + SameSite=Lax，写操作再叠 CSRF token',
      'OAuth 回调只校验 state，别把 token 放 URL 里传来传去',
      '权限检查写在服务端每个端点入口，前端隐藏只是体验',
    ],
    howto: '任何带登录的站/后台，先把这三条过一遍再谈功能。',
    sources: [{ label: 'OWASP', url: 'https://cheatsheetseries.owasp.org/' }],
  },
  {
    id: 'web-browser-skill',
    name: '真实浏览器操控（bsk）',
    oneLine: '用你已登录的浏览器做点击/填表/抓取/回归，而不是新开一个无头壳',
    source: '本机 skill: browser-skill（bsk CLI + 扩展）',
    tags: ['工具', '浏览器', '自动化'],
    kind: 'text',
    swatch: { a: '#0b1220', b: '#172554', fg: '#dbeafe', accent: '#38bdf8', pattern: 'rays' },
    bullets: [
      '复用登录态是关键：不用重新过验证码/cookie 同意页',
      '动作要可回放：每步截图或快照，失败时知道停在哪',
      '涉及「发布/发送/支付」的动作先让用户确认，别自动点',
    ],
    howto: '要验证线上页面行为、抓登录后数据、走一遍流程时用。',
    sources: [{ label: 'bsk', url: 'https://github.com/zhuobichen' }],
  },
  {
    id: 'web-playwright',
    name: 'E2E 测试（Playwright）',
    oneLine: '按用户路径写、用 data-testid 定位、失败留 trace，别用 sleep 等加载',
    source: 'Playwright 官方最佳实践',
    tags: ['测试', '前端', 'E2E'],
    kind: 'text',
    swatch: { a: '#0f172a', b: '#1e293b', fg: '#e2e8f0', accent: '#2dd4bf', pattern: 'grid' },
    bullets: [
      '定位优先 getByRole / getByTestId，CSS 层级一改就全红',
      '等事件（expect(locator).toBeVisible()）而不是 waitForTimeout',
      'CI 里 --trace on-first-retry，失败能回放而不是猜',
      '只测关键路径：登录、下单、保存；细节交给单测',
    ],
    howto: '上线前想睡得着，就手上有 3–5 条核心路径的 E2E。',
    sources: [{ label: 'Playwright', url: 'https://playwright.dev/docs/best-practices' }],
  },
  {
    id: 'web-perf-cwv',
    name: '性能（Core Web Vitals）',
    oneLine: 'LCP 看首图、INP 看交互、CLS 看布局跳动：先量再改，别凭感觉压缩',
    source: 'web.dev / Core Web Vitals',
    tags: ['性能', '前端', '指标'],
    kind: 'text',
    swatch: { a: '#0c0a09', b: '#1c1917', fg: '#fafaf9', accent: '#f97316', pattern: 'stripes' },
    bullets: [
      'LCP 元素先找出来（DevTools Performance），多半是首图没 preload 或字体阻塞',
      'INP 差通常是主线程长任务：拆 useEffect、把大列表虚拟化',
      'CLS 就是没写宽高：img/video/iframe 都加 aspect-ratio',
    ],
    howto: '页面「感觉慢」时先用 Lighthouse 定位到具体指标，再改对应那一项。',
    sources: [{ label: 'web.dev', url: 'https://web.dev/vitals/' }],
  },
  {
    id: 'web-cloudflare',
    name: 'Cloudflare Workers / Pages / D1 / R2',
    oneLine: '边缘跑逻辑：Workers 处理请求、D1 存关系、R2 放文件、KV 缓存，wrangler 一把梭',
    source: 'Cloudflare 文档（本机装了 cloudflare MCP）',
    tags: ['部署', '边缘', 'Serverless'],
    kind: 'text',
    swatch: { a: '#1e1b16', b: '#2d2a22', fg: '#fef3c7', accent: '#f38020', pattern: 'rays' },
    bullets: [
      'Workers 没有 node 全量 API，用 nodejs_compat 之前先看依赖',
      'D1 是 SQLite 语义：迁移用 wrangler d1 migrations，别手改线上库',
      'R2 走 S3 兼容 API，签名上传比 Worker 转发省流量',
    ],
    howto: '要「一个域名 + 一个数据库 + 无服务器」的轻量站时首选。',
    sources: [{ label: 'Workers 文档', url: 'https://developers.cloudflare.com/workers/' }],
  },
  {
    id: 'web-deploy-reverse-proxy',
    name: '部署与反代（Caddy / Nginx / TLS）',
    oneLine: 'Caddy 两行拿到自动 HTTPS，Nginx 才手写；静态与 API 分开、日志落盘',
    source: '通用实践（本机 dsh web 跑在 3080 后面）',
    tags: ['部署', '运维', 'TLS'],
    kind: 'text',
    swatch: { a: '#0b1220', b: '#1e293b', fg: '#e2e8f0', accent: '#22c55e', pattern: 'grid' },
    bullets: [
      'Caddyfile: `example.com { reverse_proxy 127.0.0.1:3080 }` 就完事',
      'WebSocket 要显式转发 Upgrade 头，否则面板一直「连接中」',
      '日志按天切 + 保留 7 天，出问题第一件事是看 502/504 的时间分布',
    ],
    howto: '把本机服务暴露到域名时用；内部局域网直接用 IP 就行。',
    sources: [{ label: 'Caddy', url: 'https://caddyserver.com/docs/' }],
  },
]

/* ── 数据分析 ── */
const DATA = [
  {
    id: 'data-pandas-polars',
    name: 'DataFrame 选型（pandas / polars / DuckDB）',
    oneLine: '几万行 pandas 够用；百万行上 polars 或 DuckDB，别硬扛',
    source: '通用实践 + 本机 PM25 / MODIS 项目',
    tags: ['数据', '工具', 'DataFrame'],
    kind: 'text',
    swatch: { a: '#0b1020', b: '#16233a', fg: '#dbeafe', accent: '#38bdf8', pattern: 'grid' },
    bullets: [
      'pandas：生态最全，适合交互式探索与中小数据',
      'polars：惰性求值 + 多线程，同样的 groupby 快 3–10 倍',
      'DuckDB：直接 SQL 查 parquet/csv，不占内存，适合「先看数再建库」',
      '内存不够先 downcast（float64→float32、category），别急着上集群',
    ],
    howto: '拿到一份新数据先问：多大、要反复查还是一把算、要不要和 SQL 对齐。',
    sources: [{ label: 'polars', url: 'https://docs.pola.rs/' }, { label: 'DuckDB', url: 'https://duckdb.org/docs/' }],
  },
  {
    id: 'data-sql-local',
    name: '本地 SQL（SQLite / DuckDB）',
    oneLine: '分析型问题先用 SQL 想清楚，再决定要不要写 Python',
    source: '通用实践（DSH 自己也用 SQLite 存会话索引）',
    tags: ['数据', 'SQL', '查询'],
    kind: 'text',
    swatch: { a: '#111827', b: '#1f2937', fg: '#e5e7eb', accent: '#a3e635', pattern: 'dots' },
    bullets: [
      'SQLite 适合单文件、就地查；DuckDB 适合读 parquet/csv 直接分析',
      '窗口函数能解决 80% 的「每组取第一」，别写 Python 循环',
      '先 EXPLAIN 再优化：全表扫 + 排序通常就是没建索引',
    ],
    howto: '数据在文件里、要反复问不同问题时，先建个本地库比每次写脚本快。',
    sources: [{ label: 'SQLite', url: 'https://sqlite.org/docs.html' }],
  },
  {
    id: 'data-office-xlsx',
    name: 'Excel 读写与公式（openpyxl / 原生公式）',
    oneLine: '能写公式就别写死值；能留透视表就别手动汇总',
    source: '本机 skill: office-xlsx（office_* 工具链）',
    tags: ['数据', 'Excel', '报表'],
    kind: 'text',
    swatch: { a: '#14532d', b: '#166534', fg: '#dcfce7', accent: '#22c55e', pattern: 'grid' },
    bullets: [
      '公式而不是值：别人打开还要能改（=SUM(B2:B99) 而不是 1234）',
      '数字格式与列宽一起设，否则交付物打开是 ####',
      '多 sheet 时首页放目录与口径说明，别让人猜',
    ],
    howto: '要交报表/台账/测算表时用；纯数据交换用 csv 更安全。',
    sources: [{ label: 'skill: office-xlsx', path: 'C:/Users/Administrator/.dsh/skills' }],
  },
  {
    id: 'data-viz-matplotlib',
    name: '科研级图表（matplotlib 规范）',
    oneLine: '字号按最终尺寸定、线宽统一、色板过灰度检查，图例别压数据',
    source: '本机 skill: academic-plotting / nature-figure',
    tags: ['数据', '可视化', '论文'],
    kind: 'text',
    swatch: { a: '#f8fafc', b: '#e2e8f0', fg: '#0f172a', accent: '#2563eb', pattern: 'dots' },
    bullets: [
      'figsize 用英寸 + dpi 300，字号 ≥7pt，否则缩到论文栏宽就看不清',
      '同图内字号只留三档：标题 / 轴标 / 刻度',
      '色板先转灰度看一眼，红绿对比在黑白打印里会糊成一片',
      '一张图只讲一个结论，子图是论据',
    ],
    howto: '写论文/报告配图时按这套；内部看趋势用默认样式就行。',
    sources: [{ label: 'nature-figure', path: 'D:/github_project/ZhaoWen_GitHub维护/zhaowen-skill/nature-figure' }],
  },
  {
    id: 'data-pm25',
    name: 'PM2.5 数据融合（本机平台）',
    oneLine: '多源站点 + 卫星 + 模式，按时空权重融合成网格，带可复现的实验记录',
    source: '本机 DataFusion_* / PM25-Fusion-AutoResearch / FusionMethods',
    tags: ['数据', '环境', '融合'],
    kind: 'text',
    swatch: { a: '#0c4a6e', b: '#075985', fg: '#e0f2fe', accent: '#38bdf8', pattern: 'grid' },
    bullets: [
      '先统一坐标系与时间粒度，再谈融合；否则误差全来自对齐',
      '交叉验证按「留一站点」而不是随机切，空间泄漏最致命',
      '每次实验落一份 config + 指标 jsonl，别靠记忆复现',
    ],
    howto: '做空气质量/遥感融合类研究时，直接复用这套数据结构与验证口径。',
    sources: [{ label: 'PM25 平台', path: 'D:/github_project/ZhaoWen_GitHub维护/github-repositories/PM25-Fusion-AutoResearch' }],
  },
  {
    id: 'data-wechat',
    name: '微信数据导出与分析',
    oneLine: '从本地库导出会话/联系人/朋友圈，转成 CSV 或 HTML 再做统计',
    source: '本机 weflow MCP + WeChatDataAnalysis 仓库',
    tags: ['数据', '采集', '隐私'],
    kind: 'text',
    swatch: { a: '#052e16', b: '#14532d', fg: '#dcfce7', accent: '#4ade80', pattern: 'stripes' },
    bullets: [
      '导出前先明确用途与保留期，涉及他人对话的自用也要打码',
      '按会话导出 HTML / CSV 两种：HTML 给人看，CSV 给分析',
      '统计口径写在报告开头（时间范围、去重规则、机器人消息是否计入）',
    ],
    howto: '要分析自己的聊天/群/朋友圈时用；别拿别人的私聊当公开数据。',
    sources: [{ label: 'WeChatDataAnalysis', path: 'D:/github_project/ZhaoWen_GitHub维护/github-repositories/WeChatDataAnalysis' }],
  },
  {
    id: 'data-tencent-docs',
    name: '腾讯文档读写（MCP）',
    oneLine: '把分析结果直接写进在线表格/文档，省掉「导出再上传」这一步',
    source: '本机 MCP: tencent-docs',
    tags: ['工具', '协作', '文档'],
    kind: 'text',
    swatch: { a: '#0b1020', b: '#1e3a8a', fg: '#dbeafe', accent: '#60a5fa', pattern: 'grid' },
    bullets: [
      '先 list_tables / get_sheet_info 拿到 sheet_id，再批量写，别一格格 set',
      '写入前先读回表头，列顺序错了整表就废',
      '大表用 batch 接口 + 分段，单次太多会被限流',
    ],
    howto: '产出要交付给同事看时，直接写进在线文档比发本地文件省事。',
    sources: [{ label: 'MCP 工具', path: 'C:/Users/Administrator/.dsh' }],
  },
  {
    id: 'data-repro',
    name: '可复现分析（环境锁 / 种子 / 数据版本）',
    oneLine: '三个月后还能跑出同一个数：锁依赖、固定种子、数据带哈希',
    source: '通用实践（Cookiecutter Data Science 的思路）',
    tags: ['数据', '工程', '复现'],
    kind: 'text',
    swatch: { a: '#1f2937', b: '#374151', fg: '#f3f4f6', accent: '#fbbf24', pattern: 'dots' },
    bullets: [
      '依赖锁到具体版本（requirements.txt / uv.lock），别写 ≥',
      '随机过程固定 seed，并在报告里写出 seed 值',
      '原始数据只读、加工产物带 manifest（输入哈希 + 脚本 + 时间）',
    ],
    howto: '凡是「结论要给别人复核」的分析，都按这套落盘。',
    sources: [{ label: 'Cookiecutter DS', url: 'https://drivendata.github.io/cookiecutter-data-science/' }],
  },
]

/* ── CLI ── */
const CLI = [
  {
    id: 'cli-why',
    name: '为什么 CLI 最适合 AI 操作',
    oneLine: '文本进出、幂等重试、可组合、可脚本化——GUI 要截图，CLI 只要一行',
    source: '通用实践 + 本机 dsh / rea-video / weflow 都是 CLI 优先',
    tags: ['方法论', 'CLI', 'Agent'],
    kind: 'text',
    swatch: { a: '#0a0a0a', b: '#171717', fg: '#e5e5e5', accent: '#22c55e', pattern: 'grid' },
    bullets: [
      '输入输出都是文本：AI 不用「看屏幕」，直接读 stdout',
      '失败有退出码、可重试、可加 --dry-run，比点按钮可控',
      '能管道：`cmd --json | jq` 一步出结构，GUI 得截图再 OCR',
      '可版本化：命令写进脚本/Makefile，团队能复现',
    ],
    howto: '做任何「要让 AI 反复操作」的工具时，先做 CLI，再考虑 GUI。',
    sources: [{ label: '参考', url: 'https://clig.dev/' }],
  },
  {
    id: 'cli-json-output',
    name: '--json 输出与 jq 管道',
    oneLine: '默认给人看，加 --json 给程序看；字段稳定、不夹杂进度条',
    source: 'CLI 设计规范（clig.dev）+ 本机多个 CLI 的实际约定',
    tags: ['CLI', '设计', '输出'],
    kind: 'text',
    swatch: { a: '#111827', b: '#1f2937', fg: '#e5e7eb', accent: '#38bdf8', pattern: 'stripes' },
    bullets: [
      '人类输出：一行一个结果 + 颜色；--json：一个对象，字段名不变',
      '进度/日志走 stderr，结果走 stdout——这样管道才不被污染',
      '错误也给 JSON：{ ok:false, code, error }，方便调用方判断',
    ],
    howto: '写任何要被别的程序/Agent 调用的命令时，先把 --json 定下来。',
    sources: [{ label: 'clig.dev', url: 'https://clig.dev/' }],
  },
  {
    id: 'cli-help-first',
    name: '先 --help，再动手',
    oneLine: '不知道参数就别猜：--help 一遍，比读十页文档快',
    source: '通用实践（AI 用 CLI 的第一条纪律）',
    tags: ['CLI', '习惯', '效率'],
    kind: 'text',
    swatch: { a: '#0f172a', b: '#1e293b', fg: '#e2e8f0', accent: '#facc15', pattern: 'dots' },
    bullets: [
      '`<cmd> --help` 先看子命令清单，再 `sub --help` 看参数',
      '帮助里没写的参数，多半不是给你用的（内部/遗留）',
      '把常用命令记进脚本或 notes，别每次重新探索',
    ],
    howto: '第一次用一个 CLI（包括我自己写的）都先跑一遍 --help。',
    sources: [{ label: 'clig.dev', url: 'https://clig.dev/' }],
  },
  {
    id: 'cli-exit-codes',
    name: '退出码语义（0 / 1 / 2 / 126 / 130）',
    oneLine: '0 成功、1 一般错误、2 用法错误、130 被 Ctrl+C——脚本靠这个分支',
    source: 'BSD sysexits + 通用实践',
    tags: ['CLI', '约定', '脚本'],
    kind: 'text',
    swatch: { a: '#1c1917', b: '#292524', fg: '#f5f5f4', accent: '#f87171', pattern: 'grid' },
    bullets: [
      '别都用 1：用法错误用 2，能区分的错误给不同码',
      '「没找到」和「出错了」要分开，否则调用方无法判断该重试还是该改参数',
      'Ctrl+C 要返回 130 且清理临时文件（trap EXIT）',
    ],
    howto: '写会被脚本/Agent 调用的命令时，退出码就是你的 API。',
    sources: [{ label: 'sysexits', url: 'https://man.freebsd.org/cgi/man.cgi?query=sysexits' }],
  },
  {
    id: 'cli-idempotent',
    name: '幂等与 --dry-run',
    oneLine: '同一个命令跑两遍不该出事；要出事之前先让人看一眼计划',
    source: '通用实践（运维与 Agent 自动化都靠它）',
    tags: ['CLI', '安全', '约定'],
    kind: 'text',
    swatch: { a: '#052e16', b: '#14532d', fg: '#dcfce7', accent: '#34d399', pattern: 'grid' },
    bullets: [
      '「已存在就跳过」而不是「报错」；要覆盖必须显式 --force',
      '--dry-run 打印将要做的每一步（含路径/命令），确认再跑',
      '删除/移动之前打印解析后的绝对路径，别对计算出来的路径直接 rm',
    ],
    howto: '凡是改动文件/远端状态的命令，都要有 dry-run 与幂等语义。',
    sources: [{ label: 'clig.dev', url: 'https://clig.dev/' }],
  },
  {
    id: 'cli-long-running',
    name: '长任务（后台 / nohup / job）',
    oneLine: '超过几十秒的活别占着终端：后台跑、落日志、给个 id 回来收',
    source: '本机 dsh jobs + remote_job 的设计',
    tags: ['CLI', '工程', '长任务'],
    kind: 'text',
    swatch: { a: '#0b1020', b: '#172554', fg: '#dbeafe', accent: '#a78bfa', pattern: 'rays' },
    bullets: [
      '立刻返回 id，日志写文件，另开命令查进度',
      '超时 ≠ 失败：先看日志尾与进程是否还在，别急着重跑',
      '长任务要有「取消」入口，并且取消要能杀掉子进程树',
    ],
    howto: '渲染、爬取、训练、批量转换这类活，一律按后台作业写。',
    sources: [{ label: '本机 jobs 工具', path: 'C:/Users/Administrator/.dsh' }],
  },
  {
    id: 'cli-qchat',
    name: 'qchat-cli（QQ 频道）',
    oneLine: '命令行收发 QQ 频道消息、查频道与成员，不用点客户端',
    source: '本机仓库 qchat-cli / github-repositories/qchat-cli',
    tags: ['CLI', 'IM', '本机'],
    kind: 'text',
    swatch: { a: '#0b1220', b: '#172554', fg: '#dbeafe', accent: '#60a5fa', pattern: 'grid' },
    bullets: [
      '先看配置文件里的 token/频道 id，再 send；别把 token 贴进聊天记录',
      '发消息类命令要带 --dry-run 或先 echo 一遍文本',
      '频道的 message id 不可复用，撤回要用原 id',
    ],
    howto: '要在 QQ 频道里自动化推送/收集消息时用。',
    sources: [{ label: 'qchat-cli', path: 'D:/github_project/ZhaoWen_GitHub维护/github-repositories/qchat-cli' }],
  },
  {
    id: 'cli-winnote-onenote',
    name: 'winnote-cli / OneNote-cli（笔记）',
    oneLine: '把笔记当数据读写：列出、搜索、追加、导出，而不是靠 GUI 一条条点',
    source: '本机仓库 winnote-cli / OneNote-cli',
    tags: ['CLI', '笔记', '本机'],
    kind: 'text',
    swatch: { a: '#111827', b: '#312e81', fg: '#e0e7ff', accent: '#c084fc', pattern: 'dots' },
    bullets: [
      '先 list notebooks/sections 拿到 id，再按 id 追加内容',
      '追加用 markdown 片段，比逐段 insert 稳',
      '同步有延迟：写完立刻读可能读不到，等一次同步或重试',
    ],
    howto: '要把分析/日志沉淀到笔记里，或把笔记读出来喂给 AI 时用。',
    sources: [{ label: 'winnote-cli', path: 'D:/github_project/ZhaoWen_GitHub维护/github-repositories/winnote-cli' }],
  },
  {
    id: 'cli-rea-video',
    name: 'rea-video（视频逆向拆解 CLI）',
    oneLine: '一条命令把视频拆成镜头表 + 报告：实拍/AI/3D/代码渲染逐镜判定',
    source: '本机仓库 rea-video + skill rea-video',
    tags: ['CLI', '视频', '本机'],
    kind: 'text',
    swatch: { a: '#0f0f14', b: '#1f1b2e', fg: '#f2f2f7', accent: '#f472b6', pattern: 'stripes' },
    bullets: [
      '`rea-video decompose <视频>` 产出 report.html + breakdown，先看 summary',
      '首次跑要下载人脸/分离模型（约 70MB），之后秒开',
      '1 分钟片子几分钟跑完；更长的走后台作业，别占终端',
    ],
    howto: '要复刻一条参考片、或判断「这镜头是不是 AI」时用。',
    sources: [{ label: 'rea-video', path: 'D:/github_project/ZhaoWen_GitHub维护/rea-video' }],
  },
  {
    id: 'cli-weflow',
    name: 'weflow-cli（微信数据）',
    oneLine: '命令行导出会话、搜知识库、跑日报，比在客户端翻半天快',
    source: '本机仓库 weflow-cli + weflow MCP',
    tags: ['CLI', '数据', '本机'],
    kind: 'text',
    swatch: { a: '#052e16', b: '#14532d', fg: '#dcfce7', accent: '#4ade80', pattern: 'grid' },
    bullets: [
      '导出按会话：给联系人名，落到 output/exports/，不覆盖旧目录',
      '搜索分「字面词」与「语义」，问「上次说的那个方案」用语义',
      '涉及云端判断的工具（search_chats 等）默认只给预览，确认才外发',
    ],
    howto: '要翻自己的聊天记录、做日报/知识库时用。',
    sources: [{ label: 'weflow-cli', path: 'D:/github_project/ZhaoWen_GitHub维护/weflow-cli' }],
  },
  {
    id: 'cli-agently-mail',
    name: 'agently-cli（邮件）',
    oneLine: '发/回/转发/搜/读附件全在命令行，适合批量与自动化',
    source: '本机 skill: agently-mail（agently-cli）',
    tags: ['CLI', '邮件', '自动化'],
    kind: 'text',
    swatch: { a: '#0b1020', b: '#1e3a8a', fg: '#dbeafe', accent: '#38bdf8', pattern: 'dots' },
    bullets: [
      '发送前先把正文与收件人打印出来确认，邮件发出去收不回',
      '搜索用 --from/--subject/--since 组合，比全文扫快',
      '附件下载到固定目录，别散落在临时文件里',
    ],
    howto: '要批量处理邮件/自动回复/下载附件时用。',
    sources: [{ label: 'skill: agently-mail', path: 'C:/Users/Administrator/.dsh/skills' }],
  },
  {
    id: 'cli-mcp-vs-cli',
    name: 'MCP 与 CLI 的取舍',
    oneLine: '工具少而稳定 → MCP；工具多/要组合/要人也能用 → CLI',
    source: '通用实践 + 本机 12 个 MCP 与 8 个 CLI 的实际体感',
    tags: ['方法论', 'MCP', 'CLI'],
    kind: 'text',
    swatch: { a: '#111827', b: '#1f2937', fg: '#f9fafb', accent: '#f59e0b', pattern: 'grid' },
    bullets: [
      'MCP 的好处：schema 明确、工具可直接被模型选中；坏处：工具一多就吃 token（每个都要描述）',
      'CLI 的好处：一个入口覆盖几十个子命令、人能直接用；坏处：需要模型知道怎么调（--help）',
      '本机经验：MCP 控制在 10 个以内；长尾能力做成 CLI，让 Agent 按需 --help',
    ],
    howto: '新接一个外部系统时先想：它的能力是「少数几个固定动作」还是「一堆可组合子命令」。',
    sources: [{ label: 'MCP 规范', url: 'https://modelcontextprotocol.io/' }],
  },
  {
    id: 'cli-dsh',
    name: 'dsh CLI 本身',
    oneLine: '起服务、跑会话、看作业：DSH 自己的命令行也是这套约定',
    source: '本机 dsh toolchain（dsh web / dsh run 等）',
    tags: ['CLI', 'DSH', '本机'],
    kind: 'text',
    swatch: { a: '#0b1020', b: '#15213d', fg: '#dbeafe', accent: '#60a5fa', pattern: 'grid' },
    bullets: [
      'dsh web 起 GUI（默认 127.0.0.1:3080），dsh --help 看子命令',
      '插件改动：client.js 刷新页面即可；index.js 用 plugin_manager 禁用再启用',
      '重启宿主会杀掉正在跑的会话——需要长活时用后台作业或远程执行',
    ],
    howto: '调 DSH 自身行为（端口/模型/插件/预设）时，先看 dsh --help 再查文档。',
    sources: [{ label: 'DSH 仓库', path: 'D:/github_project/ZhaoWen_GitHub维护/dsh/toolchain' }],
  },
]

export const LAYERS = [
  {
    id: 'dev',
    name: '软件开发',
    hint: '架构 / 工程实践 / 代码风格 / Agent 技能 / 工具链（老的五组都在这层）',
    filters: ['架构', '测试', '评审', '重构', '技能'],
    entries: [...ARCH, ...PRACTICE, ...STYLE, ...SKILL, ...TOOL, ...DEV_EXTRA],
  },
  {
    id: 'web',
    name: '网页开发',
    hint: 'React/Vite、Next、接口契约、鉴权、E2E、浏览器操控、部署',
    filters: ['前端', '后端', '测试', '部署', '自动化'],
    entries: WEB,
  },
  {
    id: 'data',
    name: '数据分析',
    hint: 'DataFrame / 本地 SQL / Excel / 图表 / 采集 / 可复现',
    filters: ['DataFrame', 'SQL', '图表', '采集', '复现'],
    entries: DATA,
  },
  {
    id: 'cli',
    name: 'CLI',
    hint: '最适合 AI 操纵的形态：--json、退出码、幂等、长任务，以及本机那些 CLI',
    filters: ['方法论', '约定', '本机 CLI', '长任务', 'MCP'],
    entries: CLI,
  },
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
