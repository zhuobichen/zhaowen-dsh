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
    sources: [{ label: 'GitHub 清单', url: 'https://github.com/UnderleveledBuilder/awesome-novel-skills' }],
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
    sources: [{ label: 'novel-writer SKILL.md', url: 'https://github.com/YangsonHung/awesome-agent-skills/tree/main/skills/en/novel-writer' }],
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
    sources: [{ label: ' awesome-novel-skills', url: 'https://github.com/UnderleveledBuilder/awesome-novel-skills' }],
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
    sources: [{ label: 'write-news-article', url: 'https://github.com/jeffreytse/grimoire-core' }],
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
    sources: [{ label: 'article-tech-write', url: 'https://github.com/hocgin/agent-skills' }],
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
    sources: [{ label: 'jdy_writer', url: 'https://github.com/ken-zy/jdy_writer' }],
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
    sources: [{ label: 'wechat-business-article-writer', url: 'https://github.com/openlark/skills' }],
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
    sources: [{ label: 'poetry-skills', url: 'https://github.com/Wscats/poetry-skills' }],
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
    sources: [{ label: 'poetry-skills README', url: 'https://github.com/Wscats/poetry-skills' }],
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
