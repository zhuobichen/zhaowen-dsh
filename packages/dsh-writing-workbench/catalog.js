/**
 * 写作工作台 · 目录（AI base）
 *
 * 嵌套结构：顶层是「写作工作台」tab，里面按题材分标签页：
 *   小说 / 新闻 / 公众号 / 古诗 / 通用技法
 * 每种题材一个标签页，收录「别人做好的写法」（skill / 规范 / 经验）。
 *
 * 和设计/代码工作台同构——面板给人挑，writing_style 工具给 AI 读同一份。
 */
const NOVEL = [
  {
    id: 'w-novel-awesome', name: 'AI 写小说·网文 Skill 精选（244 个）',
    oneLine: '扫榜拆书/设定大纲/正文连载/长篇记忆/去 AI 味/短剧剧本/翻译出海——按创作阶段整理',
    source: 'UnderleveledBuilder/awesome-novel-skills · ★ 精选清单',
    tags: ['小说', '网文', '清单'], kind: 'text',
    bullets: [
      '收录 244 个 skill + 6 个应用，每个都经人工核对，按类型/阶段/平台整理',
      '起书三件套：oh-story-claudecode（扫榜拆文）→ webnovel-writer（长篇记忆防吃书）→ Humanizer-zh（去 AI 味）',
      '番茄短篇：fanqie-radar 选题 → fanqie-short-story 出结构 → fiction-humanizer-zh 修梗概感',
      '按平台分：起点/番茄/晋江/知乎盐言；按类型分：全流程/记忆/审稿/短剧',
    ],
    howto: '要写网文/小说、不知道从哪个 skill 起步时，先来这份清单按阶段挑。',
    sources: [{ label: 'GitHub 清单（★ 118）', url: 'https://github.com/UnderleveledBuilder/awesome-novel-skills' }],
    origin: 'referenced',
  },
  {
    id: 'w-novel-structure', name: 'Novel Writer 三幕结构法',
    oneLine: '三幕结构（25% setup / 50% challenges / 25% climax）+ 角色卡 + 世界观 + 章节 POV',
    source: 'YangsonHung/awesome-agent-skills · novel-writer',
    tags: ['小说', '结构', '三幕'], kind: 'text',
    bullets: [
      '三幕：Act1 铺垫→激励事件→跨越门槛；Act2 挑战→中点→危机→准备；Act3 高潮→结局→新常态',
      '角色卡：主角核心欲望/核心恐惧/成长弧，反派动机与冲突，配角功能角色',
      '每章先定 POV（视角）、场景地点、情节点、与整体的连接',
      '识别请求类型（新书/续写/角色/世界观/修订）再走对应流程，别一上来就写',
    ],
    howto: '要搭小说骨架、设计人物弧、规划章节 POV 时用。',
    sources: [{ label: 'novel-writer SKILL.md（★ 18）', url: 'https://github.com/YangsonHung/awesome-agent-skills/tree/main/skills/en/novel-writer' }],
    origin: 'referenced',
  },
  {
    id: 'w-novel-long', name: '百万字长篇防漂移工作法',
    oneLine: '六层摘要冻结 + 实体档案 + 正典账本 + POV 知识边界，写后双 agent 校验',
    source: 'long-novel-writer（96 stars）/ chinese-longnovel-skill（75 stars）',
    tags: ['小说', '长篇', '记忆'], kind: 'text',
    bullets: [
      '六层摘要冻结：把已写内容分层固化，后续续写不回改',
      '实体档案 + 正典账本：人物/设定/事实写成唯一真相源，防前后矛盾',
      'POV 知识边界：每个视角角色只能知道他该知道的，防串信息',
      '每 50 章分阶段细纲，伏笔追踪，双审查自动修复',
    ],
    howto: '写长篇连载、怕"吃书"/OOC/设定漂移时用。',
    sources: [{ label: 'long-novel-writer', url: 'https://github.com/search?q=long-novel-writer&type=repositories' }],
    origin: 'referenced',
  },
  {
    id: 'w-novel-deai', name: '小说去 AI 味（Humanizer-zh）',
    oneLine: '专修小说的梗概感与汇报腔，让正文像人写的',
    source: 'Humanizer-zh / fiction-humanizer-zh（awesome-novel-skills 收录）',
    tags: ['小说', '去AI味', '修订'], kind: 'text',
    bullets: [
      '识别并消除"梗概感"：把概述改成具体场景与动作',
      '去掉"汇报腔"：别用总结性语言替读者下结论',
      '中文网文专用，比通用 humanizer 更贴平台语感',
    ],
    howto: '正文写完后过一遍，把 AI 味重的地方改成人味。',
    sources: [{ label: ' awesome-novel-skills（★ 118）', url: 'https://github.com/UnderleveledBuilder/awesome-novel-skills' }],
    origin: 'referenced',
  },
]

const NEWS = [
  {
    id: 'w-news-inverted', name: '倒金字塔 + AP 新闻写法',
    oneLine: '新闻敏感度→5W1H≤35词导语→nut graf→倒金字塔排序→标题最后写',
    source: 'jeffreytse/grimoire-core · write-news-article（据 AP Stylebook / SPJ 伦理）',
    tags: ['新闻', '倒金字塔', 'AP'], kind: 'text',
    bullets: [
      '先定 news peg（时效/接近/重要/冲突/人情/显著），没有就别硬写',
      '导语一句话≤35词抓最重要事实，避免埋没式/提问式/引语式导语',
      'nut graf（2-3 段）告诉读者这事为什么重要、需要知道什么',
      '倒金字塔：关键事实→支撑背景→细节；标题最后写，主动语态 5-8 词',
      '每个事实声明都要归属到具名来源或数据集；引语用 said，不改一字',
    ],
    howto: '写新闻稿、突发报道、结构化新闻故事时用。',
    sources: [{ label: 'write-news-article（★ 8）', url: 'https://github.com/jeffreytse/grimoire-core' }],
    origin: 'referenced',
  },
  {
    id: 'w-news-tech', name: '科技新闻聚合写法（article-tech-write）',
    oneLine: '多条新闻→提炼主题线索→各条 5W1H 独立成段→客观冷静→一句话互动',
    source: 'hocgin/agent-skills · article-tech-write',
    tags: ['新闻', '科技', '聚合'], kind: 'text',
    bullets: [
      '每条新闻独立单元：H3 标题（20-50字陈述句）+ 1-3 段（各 50-200 字）',
      '第1步素材收集→第2步提炼贯穿全文的主题线索→第3步标题导语→第4步逐条扩写→第5步审校',
      '报道体客观冷静，信息密度高，术语自然融入不做过多解释',
      '禁止："据悉/据了解"模糊来源、感叹号（结尾除外）、emoji、主观评价',
    ],
    howto: '把多条科技新闻写成一篇聚合文章时用。',
    sources: [{ label: 'article-tech-write（★ 0）', url: 'https://github.com/hocgin/agent-skills' }],
    origin: 'referenced',
  },
  {
    id: 'w-news-investigative', name: '深度调查报道蓝图',
    oneLine: '选题角度→3 个标题变体→倒金字塔提纲→专家引语占位→多媒体→SEO',
    source: '99xprompts · Investigative News Article Architect',
    tags: ['新闻', '调查', '深度'], kind: 'text',
    bullets: [
      '先找"未被讲出的故事"与必须回应的反方论点，避免泛泛报道',
      '标题给 3 版（SEO/钩子/分析）+ deck 副题；提纲用现代倒金字塔 Lede/Nut/Graf/Tail',
      '引语用 [PLACEHOLDER QUOTE] 标注占位，绝不编造事实或引语',
      '段落短（1-3 句）便于数字阅读；事实与观点严格分开',
    ],
    howto: '做深度/调查报道、要 publication-ready 蓝图时用。',
    sources: [{ label: '提示词原文', url: 'https://www.99xprompts.com/prompt/0bg2Igs7HRHlFkZViNb3' }],
    origin: 'referenced',
  },
]

const WECHAT = [
  {
    id: 'w-wx-jdy', name: '从日志到公众号+X 双语（jdy-writer）',
    oneLine: '风格档案驱动、像人写不像 AI、一轮对齐快速出稿、作者有最终决定权',
    source: 'ken-zy/jdy_writer · jdy-writer',
    tags: ['公众号', '自媒体', '风格'], kind: 'text',
    bullets: [
      '核心：像人写的，不像 AI 写的——参照作者真实风格，不是"优质文章模板"',
      '风格档案驱动：每次写作前校准风格，持续吸收新文章',
      '一轮对齐快速出稿：不反复确认、不生成设计文档、不做任务追踪',
      '英文单词/人名/产品名不可断行；AI 出初稿，作者改方向',
    ],
    howto: '要从日常素材写公众号文章、且要有本人风格时用。',
    sources: [{ label: 'jdy_writer（★ 0）', url: 'https://github.com/ken-zy/jdy_writer' }],
    origin: 'referenced',
  },
  {
    id: 'w-wx-kazik', name: '公众号长文写作（数字生命卡兹克风格）',
    oneLine: '本机 skill：卡兹克风格公众号长文——写稿/续写/扩写/按素材产出长文',
    source: '本机 skill · 数字生命卡兹克风格（论文工作台写作区同款）',
    tags: ['公众号', '长文', '本机'], kind: 'text',
    bullets: [
      '本机已装，直接可用；风格取自真实创作者而非泛化模板',
      '适合长文：先定叙事骨架，再按素材扩写',
      '和去 AI 味 skill 搭配：先写后改',
    ],
    howto: '要写有个人风格的公众号长文时用本机这个 skill。',
    sources: [{ label: '本机 skill', path: 'D:/github_project/ZhaoWen_GitHub维护/dsh/home/skills' }],
    origin: 'mine',
  },
  {
    id: 'w-wx-business', name: '微信商业/技术文章写法',
    oneLine: '专业又平易近人，基于个人观察与经验，避企业黑话与 AI 腔',
    source: 'openlark/skills · wechat-business-article-writer',
    tags: ['公众号', '商业', '技术'], kind: 'text',
    bullets: [
      '语气专业又平易近人；写基于个人观察与经验的东西',
      '避免企业黑话（corporate jargon）和 AI 生成的机械腔',
      '配 WRITINGGUIDELINES.md 详细写作原则与范例',
    ],
    howto: '写微信公众号的商业或技术文章时用。',
    sources: [{ label: 'wechat-business-article-writer（★ 5）', url: 'https://github.com/openlark/skills' }],
    origin: 'referenced',
  },
]

const POETRY = [
  {
    id: 'w-poem-classic', name: '中华古典诗词 Skill（生成+查询）',
    oneLine: '格律规范的诗词生成 + 全唐诗/宋词/诗经/楚辞/元曲检索，291MB 本地数据集',
    source: 'Wscats/poetry-skills（MIT）',
    tags: ['古诗', '格律', '检索'], kind: 'text',
    bullets: [
      '生成：指定主题/风格/体裁，写五绝/七律/填词，遵守平仄格律',
      '查询：按作者/标题/关键词/朝代检索（李白静夜思、苏轼词、含"明月"唐诗…）',
      '数据集：唐诗 57607 + 宋诗 254248 + 宋词 21053 + 诗经305 + 楚辞65 + 元曲11057',
      '进阶：对比李白杜甫"月"意象、分析离骚修辞、找纳兰性德思念句',
    ],
    howto: '写古典诗词、查诗词出处、做意象对比时用。',
    sources: [{ label: 'poetry-skills（★ 14）', url: 'https://github.com/Wscats/poetry-skills' }],
    origin: 'referenced',
  },
  {
    id: 'w-poem-data', name: 'chinese-poetry 数据结构',
    oneLine: '诗词结构化格式：author/paragraphs/title/rhythmic/chapter/section——可自建检索',
    source: 'Wscats/poetry-skills · 数据格式说明',
    tags: ['古诗', '数据', '结构'], kind: 'text',
    bullets: [
      '唐诗/宋诗：{author, paragraphs[], title, id}',
      '宋词：{author, paragraphs[], rhythmic（词牌）}',
      '诗经：{title, chapter, section, content[]}；楚辞：{title, section, author, content[]}',
      '元曲带 dynasty，emon 曲牌名；平仄格律数据单独放 strains/',
    ],
    howto: '要做自己的诗词检索/生成系统时参考数据结构。',
    sources: [{ label: 'poetry-skills README（★ 14）', url: 'https://github.com/Wscats/poetry-skills' }],
    origin: 'referenced',
  },
]

const CRAFT = [
  {
    id: 'w-craft-deai', name: 'Skill Deslop 去 AI 味',
    oneLine: '去除学术/通用写作里的常见 AI 腔调',
    source: '论文工作台写作区收录（ext-skill-deslop）',
    tags: ['通用', '去AI味', '修订'], kind: 'text',
    bullets: [
      '识别并去除模板化的 AI 表达',
      '和具体题材的 humanizer 搭配用：先写题材专用，再通用去味',
    ],
    howto: '任何题材写完后觉得"一股 AI 味"就过一遍。',
    sources: [{ label: ' 论文工作台写作区', path: 'design_style op=layer id=write（论文工作台）' }],
    origin: 'referenced',
  },
  {
    id: 'w-craft-standford', name: '斯坦福科学写作法',
    oneLine: '基于 Stanford Writing in the Sciences 的写作流程',
    source: '论文工作台写作区收录（ext-writing-sciences）',
    tags: ['通用', '科学写作', '流程'], kind: 'text',
    bullets: [
      '科学写作的通用流程：从观点到论证的组织方式',
      '适合非虚构、说明文、技术文档的底层结构训练',
    ],
    howto: '写非虚构/说明/技术内容时参考其论证组织。',
    sources: [{ label: '论文工作台写作区', path: 'paper_style op=get ext-writing-sciences' }],
    origin: 'referenced',
  },
  {
    id: 'w-craft-narrative', name: 'ABT 科学叙事框架',
    oneLine: 'And-But-Therefore：诊断并修复叙事结构',
    source: '论文工作台评审区收录（ext-abt-narrative）',
    tags: ['通用', '叙事', '框架'], kind: 'text',
    bullets: [
      'And（铺垫）→ But（转折/冲突）→ Therefore（结论/行动）',
      '可诊断任何叙事是否缺转折或结论，不局限于论文',
    ],
    howto: '检查一段叙事是否有张力、是否缺转折时用。',
    sources: [{ label: '论文工作台评审区', path: 'paper_style op=get ext-abt-narrative' }],
    origin: 'referenced',
  },
  // ── 写代码技术文的写作 skill ──
  {
    id: 'w-tech-technical-writer', page: 'craft',
    name: 'technical-writer（问题优先的技术写作）',
    oneLine: '给写代码的人看：问题先行、故事线+可扫读、精确简短、诚实说边界——API文档/教程/复盘/代码评审都适用',
    source: 'widnyana/eyay-toolkits · plugins/prose-engineers/skills/technical-writer',
    tags: ['技术写作', '问题优先', '博客'], kind: 'text',
    swatch: { a: '#0b1220', b: '#172554', fg: '#dbeafe', accent: '#fbbf24', pattern: 'grid' },
    bullets: [
      '核心哲学：写给"会交付东西的人"——不要理论和营销腔，要"什么重要、为什么坏、怎么修"',
      '问题先行：不是"这里是怎么配置X"，而是"X配错导致我们6小时停机，这是教训"',
      '叙事+结构兼得：用故事引导，同时用清晰段落和表格让人能扫读',
      '具体压倒抽象：真实数字（$0.02/请求，不是"便宜"）、真实代码、真实取舍（快40%但3倍内存）',
      '结构模板：问题/发现 → 背景 → 拆解(如何工作/如何坏) → 推理(为什么) → 实践 → 坑与教训',
      '适度幽默 + 共情：承认"这块确实烦"，不说教、不让读者觉得自己蠢',
    ],
    howto: '写技术博客、产品说明、事故复盘、代码评审、API 文档时用。',
    sources: [{ label: 'GitHub/Skill 原文(★ 9）', url: 'https://github.com/widnyana/eyay-toolkits/blob/main/plugins/prose-engineers/skills/technical-writer/SKILL.md' }],
    origin: 'referenced',
  },
  {
    id: 'w-tech-richtabor', page: 'craft',
    name: 'technical-writing（先分析代码库再写）',
    oneLine: '先加载反 AI 腔规则 + 写作风格指南，再分析代码库实现方式，平衡技术细节与可读性',
    source: 'richtabor/agent-skills · technical-writing',
    tags: ['技术写作', '反AI腔', '代码库'], kind: 'text',
    swatch: { a: '#0b1220', b: '#172554', fg: '#dbeafe', accent: '#fbbf24', pattern: 'grid' },
    bullets: [
      '阶段1必须：先加载 WRITING_ANTI_PATTERNS（要避免的AI词/短语/模式）+ 写作风格指南（个人声音/语气/结构）',
      '冲突时以反模式指南优先——避免 AI 腔高于任何风格选择',
      '分析代码库了解实现方式后再组织内容，不是凭空写',
      '若配置了 WordPress 环境变量先取现有分类/标签供 frontmatter 用',
      '触发：用户要求写开发进度、实现细节、项目更新',
    ],
    howto: '要给正在做的功能写技术博客、且要有自己声音不像 AI 时用。',
    sources: [{ label: 'GitHub/Skill 原文(★ 74）', url: 'https://github.com/richtabor/agent-skills/tree/main/skills/technical-writing' }],
    origin: 'referenced',
  },
  {
    id: 'w-tech-blog-writer', page: 'craft',
    name: 'blog-writer（ Tutorial/观点/分析三种骨架）',
    oneLine: '写人能读完的长文：先定角度、检索证据、列骨架，再写3句钩子和小标题',
    source: 'navinspire-ia/navin · skills/blog-writer',
    tags: ['技术写作', '长文', '结构'], kind: 'text',
    swatch: { a: '#0b1220', b: '#172554', fg: '#dbeafe', accent: '#fbbf24', pattern: 'grid' },
    bullets: [
      '文章类型骨架：教程=问题→前置→编号步骤→坑→结果；观点=主张→最强反论→证据→影响；分析=问题→数据→发现→So-what',
      '角度先行：这篇文章相对现有10篇能说出什么新东西？',
      '用 web_search/web_fetch 收集引语、数字、来源 URL；长文先和用户确认骨架',
      '3句钩子开篇；小标题单独看就能讲清故事；每节都有具体例子或数字',
      '编辑：删掉开篇清嗓子、逐条Fact-check、段落≤4行、每~300词一个视觉停顿',
      '来源内联链接；结论说下一步做什么，绝不"综上所述我们看到"',
    ],
    howto: '写技术长文、教程、行业分析时用。',
    sources: [{ label: 'GitHub/Skill 原文(★ 37）', url: 'https://github.com/navinspire-ia/navin/blob/main/navin/skills/blog-writer/SKILL.md' }],
    origin: 'referenced',
  },
  {
    id: 'w-tech-qe-writing', page: 'craft',
    name: 'technical-writing（领导价值+展示而非告诉）',
    oneLine: '写给开发者的技术内容：lead with value、show don\'t tell、为扫读而结构、 ruthless 删减',
    source: 'proffesor-for-testing/agentic-qe · technical-writing（407 stars）',
    tags: ['技术写作', 'show-dont-tell', '开发者'], kind: 'text',
    swatch: { a: '#0b1220', b: '#172554', fg: '#dbeafe', accent: '#fbbf24', pattern: 'grid' },
    bullets: [
      '核心：LEAD with value（读者能学到什么）→ SHOW don\'t tell（具体例子/代码/数字）→ 为扫读结构化 →  ruthless 删减 → 诚实说取舍',
      'Before/After 对照：❌"我们实施了全面的测试策略" ✅"我们把探索性测试挪进sprint计划，QE在需求细化时结对"',
      '要删的词：basically/actually/probably、leverage/synergy/paradigm、very/really/quite、"it should be noted that"',
      '发布前清单：标题承诺具体、30秒钩住、主张有例子支撑、代码示例跑过、结论清晰',
      '按读者分层：开发者先给代码、QA先给测试挑战、管理层先给业务影响',
    ],
    howto: '写工程博客/开发者文档、要把"我们做了什么"改成具体收益时用。',
    sources: [{ label: 'GitHub/Skill 原文(★ 537）', url: 'https://github.com/proffesor-for-testing/agentic-qe/blob/main/.claude/skills/technical-writing/SKILL.md' }],
    origin: 'referenced',
  },
  {
    id: 'w-tech-github-article', page: 'craft',
    name: 'github-article-writer（GitHub 仓库中文技术文）',
    oneLine: '输入任意 GitHub 仓库链接/owner-repo，产出架构分析、benchmark 解读的中文技术文章',
    source: 'A1pha3/text-matrix · skills/github-article-writer',
    tags: ['技术写作', 'GitHub', '中文', '架构分析'], kind: 'text',
    swatch: { a: '#0b1220', b: '#172554', fg: '#dbeafe', accent: '#fbbf24', pattern: 'grid' },
    bullets: [
      '触发即激活：用户输入任意 GitHub 仓库链接、仓库内页面链接、github.com URL 或 owner/repo',
      '面向 GitHub 开源仓库的中文技术文章工作流',
      '覆盖架构分析、benchmark 解读等文章类型',
      'SKILL.md 18KB，带 references/（CHANGELOG/README/skill.json）',
      '适合"把这个仓库讲清楚"类文章',
    ],
    howto: '要写某个 GitHub 项目的中文深度解析文章时用。',
    sources: [{ label: 'GitHub/Skill 原文(★ 2）', url: 'https://github.com/A1pha3/text-matrix/tree/main/skills/github-article-writer' }],
    origin: 'referenced',
  },
  {
    id: 'w-tech-majestic', page: 'craft',
    name: 'technical-writer（教学型技术教程）',
    oneLine: '有教学目标/前置条件/渐进课时/代码示例/常见坑/练习自测——面向初学者到专家',
    source: 'majesticlabs-dev/majestic-marketplace · technical-writer',
    tags: ['技术写作', '教程', '教学'], kind: 'text',
    swatch: { a: '#0b1220', b: '#172554', fg: '#dbeafe', accent: '#fbbf24', pattern: 'grid' },
    bullets: [
      '内容类型：概念解释(它解决什么问题→核心想法→如何工作→实践→常见误解→何时不用)',
      'How-To：时间/难度/要构建什么/前置条件/每步都有预期结果/验证/故障排除',
      'Tutorial：通过构建真实项目教概念，每节一个概念、展示错误与修正、有检查点',
      'Deep Dive：面向中高级读者，TL;DR + 阅读时间 + 受众标注',
      '语气："这之所以有效是因为…"而非"如你所见"；绝不用 simply/just 这种轻视难度的词',
      '开篇对照：❌"依赖注入是一种设计模式…" ✅"你的类需要数据库连接，是在类内创建还是从外面传进来？"',
    ],
    howto: '写教学型教程、开发者指南、概念解释时用。',
    sources: [{ label: 'GitHub/Skill 原文', url: 'https://lobehub.com/skills/majesticlabs-dev-majestic-marketplace-technical-writer' }],
    origin: 'referenced',
  },

]

export const PAGES = [
  { id: 'novel', name: '小说', hint: '网文/长篇/结构/去 AI 味', entries: NOVEL },
  { id: 'news', name: '新闻', hint: '倒金字塔/聚合/深度调查', entries: NEWS },
  { id: 'wechat', name: '公众号', hint: '个人风格/长文/商业技术', entries: WECHAT },
  { id: 'poetry', name: '古诗', hint: '古典诗词格律与检索', entries: POETRY },
  { id: 'craft', name: '通用技法', hint: '去 AI 味/科学写作/ABT 叙事', entries: CRAFT },
]

export const ALL_ENTRIES = PAGES.flatMap((p) => p.entries)

export function findEntry(id) { return ALL_ENTRIES.find((e) => e.id === id) || null }
export function pageOf(id) { return PAGES.find((p) => p.entries.some((e) => e.id === id)) || null }

/** 引用给 AI 的索引：一行说清用哪条 + 完整规格入口 */
export function refOf(entry) {
  const page = pageOf(entry.id)
  const lines = [`用写作工作台里的「${entry.name}」（${page ? page.name : ''} · ${entry.id}），按这个写法来。`]
  const src = Array.isArray(entry.sources) ? entry.sources : []
  const cloud = src.find((s) => typeof s.url === 'string' && s.url !== '')
  const local = src.find((s) => typeof s.path === 'string' && s.path !== '')
  if (cloud) lines.push(`原始材料：${cloud.url}`)
  else if (local) lines.push(`本地材料：${local.path}`)
  lines.push(`要看完整规格：writing_style op=get ${entry.id}`)
  return lines.join('\n')
}

/** 完整规格 */
export function specOf(entry) {
  const page = pageOf(entry.id)
  const lines = [
    `【写作参考】${entry.name}（${page ? page.name : ''}）`,
    `一句话：${entry.oneLine}`,
    `出处：${entry.source}`,
    '', '要点：', ...(entry.bullets || []).map((b) => `  - ${b}`),
    '', `怎么用：${entry.howto}`,
  ]
  const src = Array.isArray(entry.sources) ? entry.sources : []
  if (src.length > 0) {
    lines.push('', '原始材料：', ...src.map((s) => `  - ${s.label}：${s.url || s.path}`))
  }
  return lines.join('\n')
}

export const TAGS = [...new Set(ALL_ENTRIES.flatMap((e) => e.tags || []))].sort()
