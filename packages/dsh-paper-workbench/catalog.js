/**
 * 论文工作台资料库 —— 六层，把本机的论文 skill / MCP / 插件收成可引用的条目。
 *
 * 结构和设计工作台同构（字段 / LAYERS / refOf / specOf），
 * 面板给人挑，paper_style 工具给 AI 读同一份数据。引用是索引式的：
 * 面板「复制引用」给一行，AI 需要细节时自己 paper_style op=get。
 *
 * 每条：{ id, layer, name, oneLine, source, tags, kind, bullets, howto, origin }
 *   kind    —— text（工具/方法，无封面）
 *   origin  —— mine（本机自建）/ referenced（社区或内置）
 */
import { homedir } from 'node:os'
import { MARKET_GROUPS, MARKET_URL } from './market.js'

// 注意：扫描本机后确认这些 skill 全部在 ~/.agents/skills（不在 ~/.dsh/skills），
// 所以来源统一写「本机 skill（~/.agents/skills）」，不再误称「内置 skill（~/.dsh 技能目录）」。
const BUILTIN = '本机 skill（~/.agents/skills）'
const LOCAL = '本机自建（~/.agents/skills）'

/* ══════ 一、写作与润色 ══════ */
const WRITING = [
  {
    id: 'w-anti-defensive',
    layer: 'writing',
    name: '反防御性写作',
    oneLine: '把论文当学术发布会，围绕最值得发表的价值建立叙事，不平均展示、不自我审查',
    source: 'anti-defensive-writing · ' + LOCAL,
    tags: ['写作', '润色', '叙事', '投稿'],
    kind: 'text',
    bullets: [
      '识别这项工作最值得发表的价值，围绕它建立最有利、最完整的叙事',
      '把论文当发布会而不是项目总结：不写实验流水账，不替审稿人攻击自己',
      '不平均展示：主线突出，次要结果压缩，避免通篇"我们做了 A、B、C"',
      '用于写摘要、引言、结论、压缩论文、rebuttal、组织实验',
    ],
    howto: '正文初稿成型后跑一遍，或写摘要/引言前先加载；和 latex-paper-writing 配合（先定叙事再落 LaTeX）。',
    origin: 'referenced',
  },
  {
    id: 'w-latex',
    layer: 'writing',
    name: 'LaTeX 论文写作与编译',
    oneLine: '写学术 LaTeX 论文并编译 PDF，内含 ICLR/arXiv 模板、bibtex 管理与 MiKTeX/xelatex 编译',
    source: 'latex-paper-writing · ' + LOCAL,
    tags: ['写作', 'LaTeX', '模板', '编译'],
    kind: 'text',
    bullets: [
      '按用户要求写 paper、生成 LaTeX、编译 PDF、建论文模板',
      '覆盖环境科学类论文（PM2.5 / CMAQ 数据融合），含 ICLR/arxiv 风格模板',
      '管理 bibtex 引用，处理 MiKTeX / xelatex 编译报错',
    ],
    howto: '定稿叙事后（先用 anti-defensive）用它落 LaTeX 与编译；出 PDF 后交 docx/pdf skill 做最终检查。',
    origin: 'referenced',
  },
  {
    id: 'w-prompt-auditor',
    layer: 'writing',
    name: 'PPT 提示词审计',
    oneLine: '逐条对照源码验证 PPT 提示词里的每个事实声明（数字/公式/逻辑），给 ✅/⚠️/❌ 与源码行号',
    source: 'prompt-auditor · ' + LOCAL,
    tags: ['写作', '核查', 'PPT', '事实'],
    kind: 'text',
    bullets: [
      '审计提示词准确性：数字、公式、逻辑逐条对照源码',
      '给 ✅/⚠️/❌ 结论和源码行号',
      '说"检查提示词""审计 prompt""验证一下图和代码对不对得上"时触发',
    ],
    howto: '做报告/PPT 前，用它把图和代码对一遍，防止数字和逻辑出错。',
    origin: 'referenced',
  },
  {
    id: 'w-khazix',
    layer: 'writing',
    name: '公众号长文写作',
    oneLine: '数字生命卡兹克风格公众号长文：写稿、续写、扩写、按素材产出长文',
    source: 'khazix-writer · ' + LOCAL,
    tags: ['写作', '公众号', '长文'],
    kind: 'text',
    bullets: [
      '写文章、写稿子、续写、扩写、公众号文章、长文、出稿、按我的风格写',
      '可把 PDF/brief/新闻链接/语音转文字等素材转成文章',
      '不适用于小红书/推特等短内容',
    ],
    howto: '要把论文成果写成科普/公众号长文时用；和论文正文写作分开，语气完全不同。',
    origin: 'referenced',
  },
]

/* ══════ 二、选题与创新 ══════ */
const IDEA = [
  {
    id: 'i-scoop',
    layer: 'idea',
    name: '撞题检查（scoop-check）',
    oneLine: '给定问题陈述和主张的创新点，核查是否与已发表工作重叠，判断想法是否已被抢先',
    source: 'scoop-check · ' + BUILTIN,
    tags: ['选题', '创新', '新颖性', '文献'],
    kind: 'text',
    bullets: [
      '验证研究新颖性：把 proposed novelty 对照已发表文献',
      '判断是否被 scoop（抢先发表）、与现有工作的重叠程度',
      '用于研究启动前的新颖性论证与 related work 布局',
    ],
    howto: '定选题后、动手前先跑一遍；发现撞题及时调整主张，省得写完才发现。',
    origin: 'referenced',
  },
  {
    id: 'i-hv',
    layer: 'idea',
    name: '横纵分析法',
    oneLine: '系统性研究一个产品/公司/概念/技术/人物：横向铺开、纵向挖深，做 deep research',
    source: 'hv-analysis · ' + LOCAL,
    tags: ['选题', '调研', 'deep research', '分析'],
    kind: 'text',
    bullets: [
      '横纵两条轴：横向比较同类，纵向追时间线与本质',
      '适合"帮我摸清楚""做个深度研究""竞品分析"这类系统性问题',
      '输出结构化的认知框架，不做名词解释',
    ],
    howto: '进新方向、做背景调研时用；和 scoop-check 顺序配合：先横纵摸清领域，再查新颖性。',
    origin: 'referenced',
  },
  {
    id: 'i-paper-search',
    layer: 'idea',
    name: '多库论文检索',
    oneLine: '跨 arXiv / DBLP / OpenAlex / OpenReview / Semantic Scholar / Crossref 按主题和年份检索论文',
    source: 'paper-search · ' + LOCAL,
    tags: ['选题', '检索', 'arXiv', '文献'],
    kind: 'text',
    bullets: [
      '一次查六个学术库，按年份/会场（NeurIPS/ICLR/ICML）过滤',
      '通过 ./scripts/search_papers.py 执行，返回带链接的结果',
      '找 related work、先验、近期论文时用',
    ],
    howto: '写 related work 或查某方向最新进展时用它，比逐个库手搜快。',
    origin: 'referenced',
  },
]

/* ══════ 三、统计与方法 ══════ */
const METHOD = [
  {
    id: 'm-stats',
    layer: 'method',
    name: '统计分析助手',
    oneLine: '假设检验选型、前提假设检查、效应量、功效分析、贝叶斯替代、APA 格式报告',
    source: 'statistical-analysis · ' + BUILTIN,
    tags: ['方法', '统计', '检验', '功效'],
    kind: 'text',
    bullets: [
      't 检验 / ANOVA / 卡方 / 相关 / 回归 / 非参数 / 贝叶斯方法',
      '检查统计假设、计算所需样本量、写 APA 格式结果',
      '用户想比较组、检验假设、分析实验/调查数据时触发（哪怕没点名具体检验）',
    ],
    howto: '跑实验前用它定检验方法和功效；写结果节时用 APA 格式输出。',
    origin: 'referenced',
  },
  {
    id: 'm-critical',
    layer: 'method',
    name: '科学批判性思维',
    oneLine: '评估科学主张与证据质量：实验设计效度、偏倚混杂、统计解释、GRADE/Cochrane 证据分级',
    source: 'scientific-critical-thinking · ' + BUILTIN,
    tags: ['方法', '批判', '证据', '审稿'],
    kind: 'text',
    bullets: [
      '评判实验设计有效性、偏倚与混杂、统计解释',
      'GRADE / Cochrane Risk of Bias 等证据分级框架',
      '支持证据评估与缺陷识别，formal peer review 另属 peer-review',
    ],
    howto: '审稿或 self-review 时加载；和 anti-defensive-writing 搭配，一个管批判一个管叙事。',
    origin: 'referenced',
  },
  {
    id: 'm-units',
    layer: 'method',
    name: '单位与不确定度传播',
    oneLine: '用 pint / uncertainties 做单位换算与量纲检查、GUM 不确定度预算、Monte Carlo 传播、有效数字',
    source: 'uncertainty-and-units · ' + BUILTIN,
    tags: ['方法', '单位', '不确定度', '物理'],
    kind: 'text',
    bullets: [
      '单位换算与量纲检查，防止代码里丢了单位',
      'GUM 不确定度预算、A 类/B 类评定、扩展不确定度',
      '误差传播、曲线拟合的不确定度、有效数字与 ± 报告',
    ],
    howto: '涉及物理量/测量数据的论文（如环境、气象）用它核对单位和不确定度，避免低级错误。',
    origin: 'referenced',
  },
  {
    id: 'm-pm25',
    layer: 'method',
    name: 'PM2.5 日值处理',
    oneLine: '把小时级 PM2.5 站点监测数据转日均浓度：≥20 有效小时质控，出日值/小时值带站点坐标',
    source: 'process-daily-pm25 · ' + LOCAL,
    tags: ['方法', 'PM2.5', '数据', '环境'],
    kind: 'text',
    bullets: [
      '小时→日均，带 ≥20 有效小时的质控规则',
      '生成日值和小时值监测数据文件（含站点坐标）',
      '专门针对环境科学 PM2.5 数据流程',
    ],
    howto: '处理 PM2.5 原始监测数据时用；生成的数据可直接喂给统计/建模流程。',
    origin: 'referenced',
  },
]

/* ══════ 四、文献 · Zotero ══════ */
const ZOTERO = [
  {
    id: 'z-core',
    layer: 'zotero',
    name: 'Zotero 文献管理',
    oneLine: '用 Zotero 做参考文献管理、PDF 阅读、引用生成与论文写作',
    source: 'zotero · ' + BUILTIN,
    tags: ['文献', 'Zotero', '引用', 'PDF'],
    kind: 'text',
    bullets: [
      '书目管理、PDF 阅读、引文生成、论文写作集成',
      '学术引用/PDF/Zotero 库相关任务统一入口',
      '相关：zotero-db（直连 SQLite）、zotero-research（全文检索）',
    ],
    howto: '文献相关任务先加载它；要批量导入/清库用 zotero-db，要按主题找文献用 zotero-research。',
    origin: 'referenced',
  },
  {
    id: 'z-db',
    layer: 'zotero',
    name: 'Zotero 数据库直连',
    oneLine: '直接操作 Zotero 本地 SQLite：PDF 导入、引用键生成、全文索引、数据库清理',
    source: 'zotero-db · ' + LOCAL,
    tags: ['文献', 'Zotero', 'SQLite', '批处理'],
    kind: 'text',
    bullets: [
      '批量导入、孤儿条目清理、引用键生成、全文索引',
      'Zotero API 不可用时的替代路径',
      '直接改本地库，操作前要确认',
    ],
    howto: '需要批量处理或 API 不通时用；普通文献管理走 zotero skill 即可。',
    origin: 'referenced',
  },
  {
    id: 'z-research',
    layer: 'zotero',
    name: 'Zotero 库全文检索',
    oneLine: '按主题搜自己的 Zotero 库，抽出 PDF 里匹配的段落，产出可直接用的引文',
    source: 'zotero-research · ' + BUILTIN,
    tags: ['文献', 'Zotero', '全文检索', '引文'],
    kind: 'text',
    bullets: [
      '全文搜索库内文档，返回带上下文的匹配段落',
      '从 PDF 抽原文，生成格式化引文',
      '写 related work 想引用"我库里某篇说过什么"时用它',
    ],
    howto: '写论文找内部文献支撑时用；比 zotero 基础 skill 更聚焦"按主题找证据"。',
    origin: 'referenced',
  },
]

/* ══════ 五、文献 · CNKI ══════ */
function cnki(id, name, oneLine, tags, bullets, howto) {
  return { id, layer: 'cnki', name, oneLine, source: id.replace('c-', 'cnki-') + ' · ' + BUILTIN, tags, kind: 'text', bullets, howto, origin: 'referenced' }
}
const CNKI = [
  cnki('c-search', 'CNKI 关键词检索', '按关键词在中国知网搜论文', ['CNKI', '检索'], ['按关键词搜索论文', '知网中文文献入口'], '找中文文献先用它搜，再按需要用 detail 看详情。'),
  cnki('c-advanced', 'CNKI 高级检索', '按作者/标题/期刊/年份/来源类别（SCI/EI/CSSCI/北大核心）精确过滤', ['CNKI', '高级检索', '筛选'], ['字段过滤：作者、标题、期刊、日期、来源类别', '比简单关键词更精确'], '要按期刊等级或作者精确筛时用。'),
  cnki('c-download', 'CNKI 下载论文', '下载指定论文的 PDF/CAJ，需要已登录', ['CNKI', '下载', 'PDF'], ['下载单篇论文 PDF/CAJ', '需用户已登录知网'], '锁定目标论文后下载全文。'),
  cnki('c-export', 'CNKI 导出/推 Zotero', '把论文导出并推送到 Zotero，或存成 RIS', ['CNKI', '导出', 'Zotero'], ['导出到 Zotero 或 RIS 文件', '打通知网与文献库'], '知网找到的文献一键进 Zotero，和 zotero skill 衔接。'),
  cnki('c-detail', 'CNKI 论文详情', '提取论文页完整信息：标题、作者、单位、摘要、关键词、基金、分类', ['CNKI', '详情', '摘要'], ['抓全文元数据而不只搜索结果', '含摘要/关键词/基金/中图分类'], '需要某篇论文的完整元数据时用。'),
  cnki('c-journal-search', 'CNKI 期刊检索', '按名称/ISSN/CN/主办单位搜索期刊', ['CNKI', '期刊'], ['找期刊、看主办单位', '按 ISSN/CN 精确查'], '投稿前查目标期刊基本信息。'),
  cnki('c-journal-index', 'CNKI 期刊收录查询', '查期刊被哪些库收录（北大核心/CSSCI/CSCD/SCI/EI）、影响因子与评价', ['CNKI', '期刊', '分区', '影响因子'], ['查收录情况与影响因子', '判断期刊级别'], '选投稿期刊时评估档次。'),
  cnki('c-journal-toc', 'CNKI 期刊目录', '浏览期刊各期目录，下载原版 TOC PDF', ['CNKI', '期刊', '目录'], ['按期浏览目录', '下载封面/目录原图'], '跟踪目标期刊最新论文。'),
  cnki('c-nav', 'CNKI 翻页与排序', '在搜索结果页翻页（下一页/上一页/指定页）或改排序', ['CNKI', '翻页', '排序'], ['翻页与排序操作', '配合 search/parse 做批量'], '搜索结果多时翻页浏览。'),
  cnki('c-parse', 'CNKI 结果解析', '把当前搜索结果页解析成结构化论文数据（标题/作者/期刊/日期/引用）', ['CNKI', '解析', '结构化'], ['把页面结果转成结构化数据', '便于批量处理'], '搜索后要批量提取结果时用。'),
]

/* ══════ 六、检索与发布 ══════ */
const SEARCH = [
  {
    id: 's-tavily', layer: 'search', name: 'Tavily 网络检索',
    oneLine: 'AI 优化的网络搜索：返回简洁、相关、带来源的结果',
    source: 'tavily · ' + BUILTIN, tags: ['检索', '网络', '搜索'], kind: 'text',
    bullets: ['AI 优化的搜索，结果精简且相关', '适合快速查资料、查最新信息'],
    howto: '需要联网查证时用；和 web-access 配合（后者管登录/动态页）。', origin: 'referenced',
  },
  {
    id: 's-web-access', layer: 'search', name: '网页访问与抓取',
    oneLine: '所有联网操作统一入口：搜索、抓取、登录后操作、动态渲染页、网络交互',
    source: 'web-access · ' + LOCAL, tags: ['检索', '抓取', '登录', '动态页'], kind: 'text',
    bullets: ['统一处理需要真实浏览器的网络任务', '支持登录后操作、抓取社交媒体、动态渲染页', '所有联网操作走它'],
    howto: '遇到需要登录或 JS 渲染的网页（知网、期刊后台等）用它。', origin: 'referenced',
  },
  {
    id: 's-extractor', layer: 'search', name: '文章正文提取',
    oneLine: '从 URL 抽取干净的文章正文（博客/文章/教程），去掉广告导航存成文本',
    source: 'article-extractor · ' + LOCAL, tags: ['检索', '抓取', '正文'], kind: 'text',
    bullets: ['从网页提取干净正文', '去广告/导航/杂乱元素，保存为可读文本'],
    howto: '要把某个网页文章存成干净文本供写作引用时用。', origin: 'referenced',
  },
  {
    id: 's-hf-publish', layer: 'search', name: 'Hugging Face 论文发布',
    oneLine: '在 Hugging Face Hub 发布与管理论文页、关联模型/数据集、生成 markdown 论文文章',
    source: 'huggingface-paper-publisher · ' + BUILTIN, tags: ['发布', 'HuggingFace', '论文页'], kind: 'text',
    bullets: ['创建/管理 HF 论文页', '关联模型与数据集', '生成专业 markdown 论文文章'],
    howto: '论文要在 HF 上展示/发布时用。', origin: 'referenced',
  },
]

/* ══════ 七、MCP 工具 ══════ */
const MCP = [
  {
    id: 'mcp-zotero', layer: 'mcp', name: 'Zotero MCP（本机插件）',
    oneLine: '本机自建 bundle，把 zotero-mcp-plugin 的工具注册成 mcp__zotero__* 原生工具',
    source: 'dsh-zotero-mcp · 本机自建', tags: ['MCP', 'Zotero', '自建'], kind: 'text',
    bullets: ['空入口 bundle，只声明 cordis patch', '把本地 zotero-mcp-plugin 的工具注入为原生工具', '已装入 web profile'],
    howto: '要在会话里直接调 Zotero 工具时用；和 zotero skill（读写库）互补。', origin: 'mine',
  },
  {
    id: 'mcp-docs', layer: 'mcp', name: '腾讯文档 MCP',
    oneLine: '腾讯文档 MCP（含文档/表格/幻灯片/智能表/思维导图/流程图等 227 个工具）',
    source: 'dsh-tencent-mcp · 社区/本机', tags: ['MCP', '腾讯文档', '写作协作'], kind: 'text',
    bullets: ['在线文档/表格/PPT/智能表协作', '227 个工具，鉴权走 TENCENT_DOCS_TOKEN', '已配好凭据并解禁'],
    howto: '论文协作、在线表格整理数据、生成幻灯片时用。', origin: 'referenced',
  },
]

// 基础 7 层（本机已装能力）。条目数组后面会被市面精选的 merge 组追加。
const WRITING_ALL = [...WRITING]
const METHOD_ALL = [...METHOD]

export const LAYERS = [
  { id: 'writing', name: '写作与润色', hint: '叙事、LaTeX、摘要/引言/结论、PPT 审计', filters: ['写作', '润色', '叙事', '投稿', '核查'], entries: WRITING_ALL },
  { id: 'idea', name: '选题与创新', hint: '撞题检查、横纵分析、多库检索', filters: ['选题', '创新', '调研', '检索'], entries: IDEA },
  { id: 'method', name: '统计与方法', hint: '统计分析、批判性思维、单位不确定度、PM2.5 数据', filters: ['统计', '方法', '证据', '环境'], entries: METHOD_ALL },
  { id: 'zotero', name: '文献 · Zotero', hint: '文献管理、直连 SQLite、全文检索', filters: ['Zotero', '文献', '引用'], entries: ZOTERO },
  { id: 'cnki', name: '文献 · CNKI', hint: '检索、下载、导出、期刊评估、目录', filters: ['CNKI', '检索', '期刊', '导出'], entries: CNKI },
  { id: 'search', name: '检索与发布', hint: 'Tavily、网页抓取、正文提取、HF 发布', filters: ['检索', '抓取', '发布'], entries: SEARCH },
  { id: 'mcp', name: 'MCP 工具', hint: '本机可用的论文相关 MCP', filters: ['MCP', '自建'], entries: MCP },
]

// 接入市面精选：新层追加、merge 组并入现有层；条目补 sources（只有仓库 URL，无本地副本）。
for (const group of MARKET_GROUPS) {
  for (const e of group.entries) {
    if (MARKET_URL[e.id] !== undefined) e.sources = [{ label: '仓库', url: MARKET_URL[e.id] }]
    e.tags = [...new Set([...(e.tags || []), '市面精选'])]
  }
  if (group.layer.merge === true) {
    const target = LAYERS.find((l) => l.id === group.layer.id)
    if (target) target.entries = [...target.entries, ...group.entries]
  } else {
    LAYERS.push({ ...group.layer, entries: group.entries })
  }
}

export const ALL_ENTRIES = LAYERS.flatMap((l) => l.entries)

/* ══════ 原始材料 / 本地副本映射（对齐设计工作台的 sources 字段）══════
 * 每条 skill：本地副本 = 真实绝对路径 C:\Users\<user>\.agents\skills\<name>\SKILL.md
 * （不写 ~ 缩写——设计工作台的本地副本给的是能直接打开的绝对路径，这里对齐；
 *  用 os.homedir() 运行时展开，换机器/user 也对）。
 * 原始材料：只有确有可靠公开 URL 的才给（tavily / web-access），
 * 其余是本机自建或来源不明，不编造 URL——原始材料退回 skill 名说明。
 * MCP 条目：本地副本 = 本机插件目录（绝对路径）。
 * ════════════════════════════════════════════════════════════════════ */
const SKILL_DIR = {
  "w-anti-defensive": "anti-defensive-writing",
  "w-latex": "latex-paper-writing",
  "w-prompt-auditor": "prompt-auditor",
  "w-khazix": "khazix-writer",
  "i-scoop": "scoop-check",
  "i-hv": "hv-analysis",
  "i-paper-search": "paper-search",
  "m-stats": "statistical-analysis",
  "m-critical": "scientific-critical-thinking",
  "m-units": "uncertainty-and-units",
  "m-pm25": "process-daily-pm25",
  "z-core": "zotero",
  "z-db": "zotero-db",
  "z-research": "zotero-research",
  "c-search": "cnki-search",
  "c-advanced": "cnki-advanced-search",
  "c-download": "cnki-download",
  "c-export": "cnki-export",
  "c-detail": "cnki-paper-detail",
  "c-journal-search": "cnki-journal-search",
  "c-journal-index": "cnki-journal-index",
  "c-journal-toc": "cnki-journal-toc",
  "c-nav": "cnki-navigate-pages",
  "c-parse": "cnki-parse-results",
  "s-tavily": "tavily",
  "s-web-access": "web-access",
  "s-extractor": "article-extractor",
  "s-hf-publish": "huggingface-paper-publisher"
}
// 上游仓库（联网逐字核对过 SKILL.md 的 name/description 才填；对不上的保持本地，不张冠李戴）：
// - K-Dense Scientific Agent Skills：statistical-analysis / uncertainty-and-units 的 description
//   与仓库逐字一致，scientific-critical-thinking 出自同作者的 claude-scientific-writer。
// - microsoft/ResearchStudio：scoop-check / paper_search 的 SKILL.md 精确路径。
// - cookjohn/cnki-skills：CNKI 系列（search/advanced/download/export/journal 等）成套来源。
const KDENSE = 'https://github.com/K-Dense-AI/scientific-agent-skills/tree/main/skills/'
const CLOUD_URL = {
  "s-tavily": "https://tavily.com",
  "s-web-access": "https://github.com/eze-is/web-access",
  "m-stats": KDENSE + 'statistical-analysis',
  "m-units": KDENSE + 'uncertainty-and-units',
  "m-critical": 'https://github.com/K-Dense-AI/claude-scientific-writer/tree/main/skills/scientific-critical-thinking',
  "i-scoop": 'https://github.com/microsoft/ResearchStudio/tree/main/ResearchStudio-Idea/skills/scoop_check',
  "i-paper-search": 'https://github.com/microsoft/ResearchStudio/tree/main/ResearchStudio-Idea/skills/paper_search',
  "c-search": 'https://github.com/cookjohn/cnki-skills/tree/master/skills/cnki-search',
  "c-advanced": 'https://github.com/cookjohn/cnki-skills/tree/master/skills/cnki-advanced-search',
  "c-download": 'https://github.com/cookjohn/cnki-skills/tree/master/skills/cnki-download',
  "c-export": 'https://github.com/cookjohn/cnki-skills/tree/master/skills/cnki-export',
  "c-detail": 'https://github.com/cookjohn/cnki-skills/tree/master/skills/cnki-paper-detail',
  "c-journal-search": 'https://github.com/cookjohn/cnki-skills/tree/master/skills/cnki-journal-search',
  "c-journal-index": 'https://github.com/cookjohn/cnki-skills/tree/master/skills/cnki-journal-index',
  "c-journal-toc": 'https://github.com/cookjohn/cnki-skills/tree/master/skills/cnki-journal-toc',
  "c-nav": 'https://github.com/cookjohn/cnki-skills/tree/master/skills/cnki-navigate-pages',
  "c-parse": 'https://github.com/cookjohn/cnki-skills/tree/master/skills/cnki-parse-results',
}
const PLUGIN_DIR = {
  "mcp-zotero": "dsh-zotero-mcp",
  "mcp-docs": "dsh-tencent-mcp"
}
// 运行时展开本机用户目录 → 真实绝对路径（不写 ~ 缩写），换机器也对。
const SKILLS_HOME = homedir() + '\\' + '.agents\\skills'
const PLUGINS_HOME = 'E:\\CodeProject\\zhaowen-dsh\\packages'

for (const e of ALL_ENTRIES) {
  const sources = []
  if (CLOUD_URL[e.id] !== undefined) sources.push({ label: '官方站点', url: CLOUD_URL[e.id] })
  if (SKILL_DIR[e.id] !== undefined) {
    sources.push({ label: 'SKILL.md', path: SKILLS_HOME + '\\' + SKILL_DIR[e.id] + '\\SKILL.md' })
  } else if (PLUGIN_DIR[e.id] !== undefined) {
    sources.push({ label: '插件目录', path: PLUGINS_HOME + '\\' + PLUGIN_DIR[e.id] })
  }
  if (sources.length > 0) e.sources = sources
}


export function findEntry(id) { return ALL_ENTRIES.find((e) => e.id === id) || null }
export function layerOf(id) { return LAYERS.find((l) => l.entries.some((e) => e.id === id)) || null }

// 与设计/代码工作台同一位置收尾（引用模板结构一致）；措辞按论文工具库场景调整。
const ASK = '按上面这套来就行；要换个工具或调做法先问我。'

/** 索引式引用：面板复制这一行，AI 需要细节时自己 paper_style op=get。
 *  与设计工作台完全同构：用X工作台「名」（层 · id）→ 原始材料(url) →
 *  本地副本(path) → 要看完整规格。没有云端 URL 的条目退回用 source 描述当原始材料。 */
export function refOf(entry) {
  const layer = layerOf(entry.id)
  const src = Array.isArray(entry.sources) ? entry.sources : []
  const cloud = src.find((s) => typeof s.url === 'string' && s.url !== '')
  const local = src.find((s) => typeof s.path === 'string' && s.path !== '')
  const lines = [
    `用论文工作台里的「${entry.name}」（${layer === null ? '论文工具' : layer.name} · ${entry.id}），按这个设计来。`,
  ]
  if (cloud !== undefined) {
    lines.push(`原始材料：${cloud.url}`)
    if (local !== undefined) lines.push(`本地副本：${local.path}`)
  } else if (local !== undefined) {
    // 本机自建 skill：原始材料就是本地的 SKILL.md，再点一次「本地副本」会重复，
    // 所以用 source 说明当原始材料，本地路径单列一行——和漫画层「原始材料+本地副本」双行一致。
    lines.push(`原始材料：${entry.source}`)
    lines.push(`本地副本：${local.path}`)
  } else {
    lines.push(`原始材料：${entry.source}`)
  }
  lines.push(`要看完整规格：paper_style op=get ${entry.id}`)
  return lines.join('\n')
}

export function memberRef(entry) { return refOf(entry) }

/** 完整规格：与设计工作台的 specOf 同构
 *  【XX参考】名（层）/ 一句话 / 出处 / 要点 / 原始材料 / 怎么用 / ASK */
export function specOf(entry) {
  const layer = layerOf(entry.id)
  const lines = [
    `【论文参考】${entry.name}（${layer === null ? '论文工具' : layer.name}）`,
    `一句话：${entry.oneLine}`,
    `出处：${entry.source}`,
  ]
  if (Array.isArray(entry.bullets) && entry.bullets.length > 0) {
    lines.push('', '要点：', ...entry.bullets.map((b) => '  - ' + b))
  }
  if (Array.isArray(entry.sources) && entry.sources.length > 0) {
    lines.push('', '原始材料：', ...entry.sources.map((x) => `  - ${x.label}：${x.url ?? x.path}`))
  } else {
    lines.push('', `原始材料：${entry.source}`)
  }
  lines.push('', `怎么用：${entry.howto}`, '', ASK)
  return lines.join('\n')
}

for (const e of ALL_ENTRIES) {
  e.prompt = refOf(e)
  e.spec = specOf(e)
}

export const TAGS = [...new Set(ALL_ENTRIES.flatMap((e) => e.tags || []))]
