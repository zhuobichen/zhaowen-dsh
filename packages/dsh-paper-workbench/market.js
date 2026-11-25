/**
 * 市面精选：联网搜罗的科研 skill / 工具，带真实上游仓库地址。
 *
 * 与 catalog.js 里"本机已装"的条目区分：
 *   - origin 一律 referenced（别人的，只作参照）
 *   - tags 含「市面精选」，面板一眼能认出
 *   - source 前缀「市面精选 · 本机未装」——避免误以为已安装
 *   - sources 只有 url（仓库地址），没有本地 path → 引用只给「原始材料」一行
 *
 * 数据来源：neverbiasu/awesome-research-skills（逐个读过 SKILL.md 的精选列表，
 * 带 audited 审计结论）、HKUSTDial/Supervisor-Skills、K-Dense-AI 套件等。
 * 24 条仓库 URL 已批量 fetch 验证全部可达（2026-11-25）。
 *
 * 结构：MARKET_GROUPS = [{ layer:{id,name,hint,filters}, entries:[...] }, ...]
 * 前 4 组是新层，后 2 组并入 catalog 现有的 writing / method 层。
 */
export const MARKET_GROUPS = [
  {
    layer: { id: 'figure', name: '论文图表与绘图', hint: '科研制图、示意图生成、Tufte 准则、TikZ——把图做到投稿级', filters: ['制图', '示意图', '数据可视化', 'TikZ'] },
    entries: [
      {
        id: 'ext-nature-figure', name: 'Nature 级科研制图', layer: 'figure',
        oneLine: '生成/修订/审计高影响期刊的多面板科研图',
        source: '市面精选 · 本机未装 · Yuan1z0825/nature-skills',
        tags: ['制图', '投稿', '多面板'], kind: 'text',
        bullets: ['用 Python 或 R 出图，支持多面板（multi-panel）布局', '按高影响期刊标准审计投稿级图片：坐标轴、字体、色盲友好、导出规格', '可「修订」已有图：读入现有图后按审稿意见迭代', '产出期刊可直接投稿的矢量/高分辨率文件'],
        howto: '结果数据已成、要把图做到 Nature/顶会投稿水准时。', origin: 'referenced',
      },
      {
        id: 'ext-paperbanana', name: 'PaperBanana 论文示意图生成', layer: 'figure',
        oneLine: '从方法文字和图注自动生成发表级示意图',
        source: '市面精选 · 本机未装 · dwzhu-pku/PaperBanana（北大）',
        tags: ['示意图', '多智能体', '生成'], kind: 'text',
        bullets: ['输入论文的方法段落和图注（caption），自动产出流程图/架构图', '多智能体流水线：Retriever→Planner→Stylist→Visualizer→Critic', '针对 NeurIPS/ICML/ACL 等 venue 的绘图规范做风格适配', 'Critic 环节对图做质量评审后再定稿'],
        howto: '机制图/流水线图还没画，只有方法文字描述时。', origin: 'referenced',
      },
      {
        id: 'ext-figures4papers', name: 'Figures4Papers 数据图排版', layer: 'figure',
        oneLine: '固定风格批量出论文柱状/趋势/热力图',
        source: '市面精选 · 本机未装 · ChenLiu-1996/figures4papers',
        tags: ['制图', 'Matplotlib', '风格统一'], kind: 'text',
        bullets: ['Matplotlib 出论文图：bar、trend、scatter、heatmap、多面板布局', '固定 house style，保证同一论文所有图风格统一', '遵守 print/vector 导出约定（PDF/SVG 与 DPI 要求）', '面向 AI 会议与期刊投稿的成图标准'],
        howto: '有多组实验数据要快速出一套风格一致的论文数据图。', origin: 'referenced',
      },
      {
        id: 'ext-tufte-dataviz', name: 'Tufte 数据可视化准则', layer: 'figure',
        oneLine: '按 Tufte 原则审查并改进学术图表',
        source: '市面精选 · 本机未装 · caylent/tufte-data-viz',
        tags: ['数据可视化', '审查', '精简'], kind: 'text',
        bullets: ['强制 data-ink ratio：删掉不承载信息的墨迹与装饰', '直接标注（direct labeling）替代图例', 'range-frame 坐标轴、去冗余网格', '跨多个绘图库（Matplotlib/ggplot 等）通用'],
        howto: '图已画出但显得杂乱、信息密度低，需要按经典准则精简时。', origin: 'referenced',
      },
      {
        id: 'ext-academic-figure-tikz', name: 'TikZ 学术图独立编译', layer: 'figure',
        oneLine: '用独立 TikZ→PDF 流程画论文矢量示意图',
        source: '市面精选 · 本机未装 · nanoAgentTeam/research-claw',
        tags: ['TikZ', '矢量图', 'LaTeX'], kind: 'text',
        bullets: ['强制 standalone TikZ→PDF，禁止在论文源码里内联 TikZ', '每张图必须先编译通过并人工/视觉核验再插入论文', '产出矢量图，放大不失真', '把绘图与论文源码解耦，便于复用与版本管理'],
        howto: '需要可精确控制、可进 LaTeX 的矢量架构图/机制图时。', origin: 'referenced',
      },
    ],
  },
  {
    layer: { id: 'repro', name: '实验管理与可复现', hint: '论文复现、Paper2Code、复现包、结果核验、实验日志', filters: ['复现', '代码', '可复现', '核验', '实验记录'] },
    entries: [
      {
        id: 'ext-phd-reproduce', name: 'PhD 论文复现七步法', layer: 'repro',
        oneLine: '从 arXiv 链接走到可测量复现实验',
        source: '市面精选 · 本机未装 · fcakyon/phd-skills',
        tags: ['复现', 'baseline', '七步法'], kind: 'text',
        bullets: ['七阶段流程：从 arXiv URL 到可度量的 replication run', '代码缺失时用公开替代实现（public-substitute）策略', '超参缺失时从论文/附录/社区反推并记录假设', '私有数据集不可得时给出可行的替代数据方案'],
        howto: '要复现别人论文作为 baseline，但缺代码/超参/数据时。', origin: 'referenced',
      },
      {
        id: 'ext-paper2code', name: 'Paper2Code 论文转代码', layer: 'repro',
        oneLine: '把 arXiv 论文转成带引用锚点的 Python 实现',
        source: '市面精选 · 本机未装 · PrathamLearnsToCode/paper2code',
        tags: ['复现', '代码', '可追溯'], kind: 'text',
        bullets: ['逐模块标注它实现了论文的哪一节（citation-anchored）', '遇到论文含糊处显式标 flag，而不是自行猜测补全', '输出可直接运行的 Python 实现骨架', '反向核对：代码每个部件都能回溯到论文依据'],
        howto: '读论文后想快速把方法落地成代码、且要保证可追溯时。', origin: 'referenced',
      },
      {
        id: 'ext-replication-package', name: '复现材料打包（AEA 标准）', layer: 'repro',
        oneLine: '按 AEA 标准组装投稿级复现包',
        source: '市面精选 · 本机未装 · pedrohcgs/claude-code-my-workflow [audited: works_with_caveats]',
        tags: ['复现', '投稿', 'AEA'], kind: 'text',
        bullets: ['按 AEA Data and Code Availability Standard 组织材料', '生成 README、数据集 manifest、计算环境捕获', '建立表/图→脚本映射表（table/figure-to-script map）', '含机密数据的存档计划（confidential-data deposit plan）'],
        howto: '期刊/会议要求提交复现包、data availability statement 时。', origin: 'referenced',
      },
      {
        id: 'ext-verify-results', name: '结果核验（论文本身）', layer: 'repro',
        oneLine: '核对本地代码指标与论文表格是否一致',
        source: '市面精选 · 本机未装 · ShaishavMaisuria/research-paper-lifecycle-skills [audited: works]',
        tags: ['核验', '数字', '审稿'], kind: 'text',
        bullets: ['用作者自己的本地代码重跑，检查指标是否仍匹配论文表格与主张', '在给定容差（tolerance）内判定是否吻合', '把「数字对不上」与「复现失败」分开报告', '定位到具体脚本/配置，便于修回'],
        howto: '投稿前自查数字，或审稿人质疑结果前后不一致时。', origin: 'referenced',
      },
      {
        id: 'ext-nature-experiment-log', name: 'Nature 实验记录规范化', layer: 'repro',
        oneLine: '把照片/语音/文字整理成标准实验日志',
        source: '市面精选 · 本机未装 · Yuan1z0825/nature-skills',
        tags: ['实验记录', '结构化', 'Obsidian'], kind: 'text',
        bullets: ['输入照片、语音或文字，统一整理为结构化记录', '输出 YAML frontmatter 的 Markdown，落到本地纯文件夹', '可选接入 Obsidian vault 与飞书', '实验条件、步骤、结果字段标准化，便于日后复用'],
        howto: '实验室日常记录散乱、想建立可追溯的电子实验记录本时。', origin: 'referenced',
      },
    ],
  },
  {
    layer: { id: 'review', name: '同行评审与 Rebuttal', hint: '审稿意见分诊、模拟审稿、投稿前数字核验、虚拟博导', filters: ['审稿', 'rebuttal', '核验', '投稿'] },
    entries: [
      {
        id: 'ext-rebuttal-skill', name: 'Rebuttal 回复助手', layer: 'review',
        oneLine: '分诊审稿意见并规划补实验与回复',
        source: '市面精选 · 本机未装 · TobiasLee/Rebuttal-Skill',
        tags: ['rebuttal', '审稿', '回复'], kind: 'text',
        bullets: ['先查目标 venue 的生成式 AI 政策再动笔', '按优先级分诊（triage）所有 reviewer 意见', '按优先级规划 rebuttal 需要补的实验', '准备回复素材，对缺失证据处留占位符而非编造'],
        howto: '收到审稿意见、要写 response letter / rebuttal 时。', origin: 'referenced',
      },
      {
        id: 'ext-academic-paper-reviewer', name: '学术审稿人模拟（五人 panel）', layer: 'review',
        oneLine: '模拟五人国际期刊审稿组给出编辑决定',
        source: '市面精选 · 本机未装 · Imbad0202/academic-research-skills',
        tags: ['审稿', '模拟', '编辑决定'], kind: 'text',
        bullets: ['按领域配置五个审稿人 persona，各司其职', '产出结构化的 editorial decision（accept/minor/major/reject）', '给出 revision roadmap（分条修改路线图）', '从多视角覆盖方法、实验、写作、相关性'],
        howto: '投稿前想预演审稿人视角、提前发现硬伤时。', origin: 'referenced',
      },
      {
        id: 'ext-paper-proof', name: 'Paper Proof 投稿前数字核验', layer: 'review',
        oneLine: 'LaTeX 投稿前逐项核对引用与数字',
        source: '市面精选 · 本机未装 · zch6a/paper-proof',
        tags: ['核验', 'LaTeX', '引用'], kind: 'text',
        bullets: ['用 Crossref/OpenAlex/Semantic Scholar/arXiv 逐个核验参考文献', '加粗数字、主张的增益、摘要里的数字与正文表格逐一对账', '每条发现给出文件名+行号，便于直接修', '覆盖图表引用与文献一致性'],
        howto: 'LaTeX 稿件定稿、提交前做最后一道数字/引用体检。', origin: 'referenced',
      },
      {
        id: 'ext-hkust-presub-reviewer', name: '投稿前评审（HKUST 博导版）', layer: 'review',
        oneLine: '按写作 Checklist 系统性扫描手稿缺陷',
        source: '市面精选 · 本机未装 · HKUSTDial/Supervisor-Skills',
        tags: ['审稿', '港科大', 'checklist'], kind: 'text',
        bullets: ['基于写作 Checklist 做逐条缺陷扫描（港科大 DIAL 实验室经验）', '从「成果展示」视角而非「项目总结」视角审查', '识别自我贬低、防御性叙述与逻辑断层', '输出可执行的修订优先级清单'],
        howto: '手稿完成、想让「虚拟博导」先挑一轮毛病时。', origin: 'referenced',
      },
    ],
  },
  {
    layer: { id: 'qualitative', name: '定性研究方法', hint: '主题分析、定性编码、五大定性传统——你原来空白的方向', filters: ['定性', '编码', '访谈', '方法论'] },
    entries: [
      {
        id: 'ext-thematic-analysis', name: '主题分析（Braun & Clarke）', layer: 'qualitative',
        oneLine: '按六阶段框架编码访谈与开放回答',
        source: '市面精选 · 本机未装 · keemanxp/thematic-analysis-skill',
        tags: ['定性', '主题分析', '访谈'], kind: 'text',
        bullets: ['对访谈、焦点小组、开放问卷做主题编码', '遵循 Braun & Clarke 六阶段框架', '落实四个前置分析决策（分析取向、编码粒度等）', '附 15 点质量检查清单'],
        howto: '有访谈转写文本、要做规范的主题分析时。', origin: 'referenced',
      },
      {
        id: 'ext-qualitative-analysis', name: '定性编码与编码本', layer: 'qualitative',
        oneLine: '演绎/归纳/混合编码并算信度',
        source: '市面精选 · 本机未装 · MattArtzAnthro/AI-Anthropology-Toolkit',
        tags: ['定性', '编码', '信度'], kind: 'text',
        bullets: ['支持演绎、归纳、混合三种编码路径', '构建和维护 codebook，统计编码频率', '做共现（co-occurrence）分析', '计算编码者间信度（intercoder reliability）'],
        howto: '有多份定性资料、要建立编码本并检验编码一致性时。', origin: 'referenced',
      },
      {
        id: 'ext-alterlab-qualitative', name: 'AlterLab 定性方法五传统', layer: 'qualitative',
        oneLine: '覆盖五大定性传统与可信度标准',
        source: '市面精选 · 本机未装 · AlterLab-IEU/AlterLab-Academic-Skills',
        tags: ['定性', '方法论', '扎根理论'], kind: 'text',
        bullets: ['覆盖主题分析、扎根理论、解释现象学分析（IPA）、民族志、案例研究五种传统', '为每种传统给出适用的设计要点', '用可信度（trustworthiness）标准评估质量', '帮助在多种定性路径间做方法论选择'],
        howto: '不确定该用哪种定性研究传统、或要评审定性论文方法论时。', origin: 'referenced',
      },
    ],
  },
  // ── 以下并入现有层 ──────────────────────────────────────────────
  {
    layer: { id: 'writing', merge: true },
    entries: [
      {
        id: 'ext-research-paper-writing', name: '科研论文写作精修（ML/CV/NLP）', layer: 'writing',
        oneLine: '段落级清晰度与论证对齐的论文精修',
        source: '市面精选 · 本机未装 · Master-cai/Research-Paper-Writing-Skills',
        tags: ['写作', '润色', '论证'], kind: 'text',
        bullets: ['逐段 clarity check：找出含糊、跳跃的段落', 'reverse outlining：反向提纲检查结构是否成立', 'topic-sentence mapping：主题句与段落内容对齐', 'claim-evidence alignment audit：每个主张都有证据支撑'],
        howto: '论文初稿写完、需要逐段提升论证质量时。', origin: 'referenced',
      },
      {
        id: 'ext-skill-deslop', name: 'Skill Deslop 去 AI 味', layer: 'writing',
        oneLine: '去除学术写作中的常见 AI 腔调',
        source: '市面精选 · 本机未装 · stephenturner/skill-deslop',
        tags: ['写作', '润色', '去AI味'], kind: 'text',
        bullets: ['识别并删除常见 AI 写作套路（模板化过渡、空泛总结等）', '恢复自然、克制的学术声音', '针对 research proposal / 论文散文体', '与反防御性写作互补：一个管论证姿态，一个管语言痕迹'],
        howto: '文字被说「AI 味重」、想让语言更像人写的学术散文时。', origin: 'referenced',
      },
      {
        id: 'ext-journal-adapt', name: '期刊文风适配', layer: 'writing',
        oneLine: '按目标期刊语料改写全文文风',
        source: '市面精选 · 本机未装 · wantongc/journal-adapt-writing-skill',
        tags: ['写作', '投稿', '文风'], kind: 'text',
        bullets: ['先分析目标期刊的参考语料（reference corpus）', '归纳该期刊的用词、句式、结构约定', '逐节（section by section）改写而非整篇替换', '保留作者原有观点与证据范围'],
        howto: '一稿多投、需要把稿件适配到不同期刊风格时。', origin: 'referenced',
      },
      {
        id: 'ext-paperfit-float', name: 'PaperFit 浮动体排版修复', layer: 'writing',
        oneLine: '修复 LaTeX 图表浮动体位置缺陷',
        source: '市面精选 · 本机未装 · openraiser/paperfit',
        tags: ['写作', 'LaTeX', '排版'], kind: 'text',
        bullets: ['修复图表离首次引用过远的缺陷', '检测宽度不匹配、图表扎堆、跨页孤儿等问题', '直接修改学术论文的 LaTeX 源码', '与 overflow-repair（溢出修复）是姊妹 skill，可配套'],
        howto: '编译后图表位置乱、影响阅读与审稿观感时。', origin: 'referenced',
      },
    ],
  },
  {
    layer: { id: 'method', merge: true },
    entries: [
      {
        id: 'ext-hypothesis-generation', name: 'K-Dense 假设生成', layer: 'method',
        oneLine: '把观察转成可检验的研究计划',
        source: '市面精选 · 本机未装 · K-Dense-AI/scientific-agent-skills [audited: works]',
        tags: ['方法', '假设', '预注册'], kind: 'text',
        bullets: ['写出竞争性解释（rival explanations）而非单一假设', '给出能区分竞争解释的判别性预测（discriminating predictions）', '产出预注册就绪（preregistration-ready）的分析方案', '自带标准库脚本，无需网络或凭证即可跑'],
        howto: '有观察现象、要把模糊想法变成可证伪假设与实验计划时。', origin: 'referenced',
      },
      {
        id: 'ext-experimental-design', name: 'K-Dense 实验设计', layer: 'method',
        oneLine: '数据收集前规划随机化与区组设计',
        source: '市面精选 · 本机未装 · K-Dense-AI/scientific-agent-skills',
        tags: ['方法', '实验设计', '随机化'], kind: 'text',
        bullets: ['采集数据前规划研究：随机化、区组（blocking）', '覆盖析因设计（factorial）与交叉设计（crossover）', '支持整群（cluster）与自适应（adaptive）设计', '把设计选择与其统计效力含义绑定说明'],
        howto: '实验还没开始、要先定方案避免事后补数据时。', origin: 'referenced',
      },
      {
        id: 'ext-preregister', name: '预注册文档撰写', layer: 'method',
        oneLine: '按 OSF/AEA 格式写结构化预注册',
        source: '市面精选 · 本机未装 · pedrohcgs/claude-code-my-workflow',
        tags: ['方法', '预注册', '可信度'], kind: 'text',
        bullets: ['支持 OSF、AsPredicted、AEA RCT Registry 三种格式', '覆盖假设、抽样计划、分析计划、排除标准、推断准则', '用 MUST/SHOULD/MAY 清晰度标记区分条款', '冻结研究问题，防止事后漂移'],
        howto: '实验上线前想锁定假设与分析计划、提升可信度时。', origin: 'referenced',
      },
    ],
  },
]

/** 市面精选条目的仓库 URL 映射（24 条全部 fetch 验证可达） */
export const MARKET_URL = {
  'ext-nature-figure': 'https://github.com/Yuan1z0825/nature-skills/tree/HEAD/skills/nature-figure',
  'ext-paperbanana': 'https://github.com/dwzhu-pku/PaperBanana/tree/HEAD/skill',
  'ext-figures4papers': 'https://github.com/ChenLiu-1996/figures4papers/tree/HEAD/scientific-figure-making',
  'ext-tufte-dataviz': 'https://github.com/caylent/tufte-data-viz',
  'ext-academic-figure-tikz': 'https://github.com/nanoAgentTeam/research-claw/tree/HEAD/config/.skills/figure-drawing',
  'ext-phd-reproduce': 'https://github.com/fcakyon/phd-skills/tree/HEAD/plugin/skills/reproduce',
  'ext-paper2code': 'https://github.com/PrathamLearnsToCode/paper2code/tree/HEAD/skills/paper2code',
  'ext-replication-package': 'https://github.com/pedrohcgs/claude-code-my-workflow/tree/HEAD/.claude/skills/replication-package',
  'ext-verify-results': 'https://github.com/ShaishavMaisuria/research-paper-lifecycle-skills/tree/HEAD/skills/verify-results',
  'ext-nature-experiment-log': 'https://github.com/Yuan1z0825/nature-skills/tree/HEAD/skills/nature-experiment-log',
  'ext-rebuttal-skill': 'https://github.com/TobiasLee/Rebuttal-Skill',
  'ext-academic-paper-reviewer': 'https://github.com/Imbad0202/academic-research-skills/tree/HEAD/academic-paper-reviewer',
  'ext-paper-proof': 'https://github.com/zch6a/paper-proof/tree/HEAD/plugin/skills/paper-proof',
  'ext-hkust-presub-reviewer': 'https://github.com/HKUSTDial/Supervisor-Skills/tree/HEAD/skills/pre-submission-reviewer',
  'ext-thematic-analysis': 'https://github.com/keemanxp/thematic-analysis-skill/tree/HEAD/thematic-analysis',
  'ext-qualitative-analysis': 'https://github.com/MattArtzAnthro/AI-Anthropology-Toolkit/tree/HEAD/skills/qualitative-analysis',
  'ext-alterlab-qualitative': 'https://github.com/AlterLab-IEU/AlterLab-Academic-Skills/tree/HEAD/skills/research-tools/alterlab-qualitative-methods',
  'ext-research-paper-writing': 'https://github.com/Master-cai/Research-Paper-Writing-Skills/tree/HEAD/research-paper-writing',
  'ext-skill-deslop': 'https://github.com/stephenturner/skill-deslop',
  'ext-journal-adapt': 'https://github.com/wantongc/journal-adapt-writing-skill/tree/HEAD/skill',
  'ext-paperfit-float': 'https://github.com/openraiser/paperfit/tree/HEAD/skills/float-optimizer',
  'ext-hypothesis-generation': 'https://github.com/K-Dense-AI/scientific-agent-skills/tree/HEAD/skills/hypothesis-generation',
  'ext-experimental-design': 'https://github.com/K-Dense-AI/scientific-agent-skills/tree/HEAD/skills/experimental-design',
  'ext-preregister': 'https://github.com/pedrohcgs/claude-code-my-workflow/tree/HEAD/.claude/skills/preregister',
}
