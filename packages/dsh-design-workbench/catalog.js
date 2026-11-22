/**
 * 设计资料库 —— 三层：App 设计 / 前端设计 / 视频风格。
 *
 * 每一条都指到**本机真实存在的东西**（路径可点开核对），少数是外部方法层
 * （huashu-design 的 App 范式），会明确写来源 URL，不冒充本机资产。
 *
 * 字段约定：
 *   kind    —— image（有封面图）/ tokens（用同一块迷你界面换皮预览）/ text（只有文字卡）
 *   cover   —— 绝对路径，由 /design-workbench/cover/<id> 提供给面板（白名单，只认本文件里写的）
 *   style   —— kind=tokens 时的样式对象（颜色/圆角/密度…），见下方 STYLES
 *   prompt  —— 「引用给 AI」的正文，点一下整段复制走
 */

const SHARED_RULES = [
  '按上面给出的数值与做法来，别自己发明新的圆角/字号/颜色档位',
  '就按这个样式做，不需要「做得不一样」；需要新色/新档位时先问我',
  '拿不准的先问我，别顺手加一个「差不多」的',
]

/** 八种前端样式（量自本机代码，见 README「怎么量出来的」）。 */
export const STYLES = [
  {
    id: 'dsh-native',
    name: 'DSH 原生基线',
    oneLine: '全部走宿主语义变量，深浅色自动跟着主题走',
    source: 'packages/dsh-image-gen/client/client.js · packages/dsh-deliverables-index/client/client.js',
    tags: ['稳妥', '跟随主题', '零维护'],
    layout: 'panel',
    colors: { bg: '#ffffff', surface: '#f7f7f8', text: '#1b1b1b', muted: '#8a8a8a', border: 'rgba(0,0,0,0.10)', accent: '#4d6bfe', accentSoft: 'rgba(77,107,254,0.12)', ok: '#22c55e', warn: '#f59e0b', danger: '#d97070' },
    shape: { radius: '8px', radiusSm: '6px', shadow: 'none', font: 'inherit', mono: 'ui-monospace, Consolas, monospace', density: 8 },
    craft: ['1px 描边分层，不靠阴影', '状态色只出现在文字/圆点上'],
    when: '新面板、工具卡片、任何要跟着深浅主题自动变的地方',
    avoid: '需要一眼抓住的强视觉主张时（它太中性）',
    tokens: ['background: var(--dsw-alias-bg-base)', 'color: var(--dsw-alias-label-primary)', 'border: 1px solid var(--dsw-alias-border-l2)', 'border-radius: 8px', '强调色: var(--dsw-alias-brand-primary)（实测 #4d6bfe）'],
  },
  {
    id: 'dash-compact',
    name: '紧凑仪表盘',
    oneLine: '等宽数字 + pill 标签 + 虚线分隔，一屏塞下最多信息',
    source: 'packages/dsh-mowan-console/client.js（破甲工作台）',
    tags: ['仪表盘', '高密度', '日志感'],
    layout: 'dashboard',
    colors: { bg: '#ffffff', surface: 'rgba(0,0,0,0.02)', text: '#1b1b1b', muted: '#8a8a8a', border: 'rgba(0,0,0,0.12)', accent: '#4d6bfe', accentSoft: 'rgba(77,107,254,0.10)', ok: '#22c55e', warn: '#f59e0b', danger: '#ef4444' },
    shape: { radius: '8px', radiusSm: '6px', shadow: 'none', font: 'inherit', mono: 'ui-monospace, Consolas, monospace', density: 6 },
    craft: ['卡片 8px、按钮 6px、标签 999px 三档圆角', '数字与 id 一律等宽 11.5–12px', '行分隔用 dashed 1px，不用整块阴影'],
    when: '状态面板、日志流、规则列表、任何「一眼看全」的运维界面',
    avoid: '营销页、需要呼吸感的阅读界面',
    tokens: ['--r-card: 8px; --r-btn: 6px; --r-pill: 999px', 'font-size: 13px（正文）/ 15px（标题）/ 11.5–12px（等宽数字）', '数字: font-family: ui-monospace, Consolas, monospace', '行分隔: border-bottom: 1px dashed var(--dsw-alias-border-l2)', '无 box-shadow'],
  },
  {
    id: 'float-panel',
    name: '悬浮面板',
    oneLine: '小圆角 + 双层投影，像浮在内容上面的一块玻璃纸',
    source: 'packages/dsh-deliverables-index/client/client.js（文档总览）',
    tags: ['悬浮', '轻量', '小字'],
    layout: 'panel',
    colors: { bg: '#ffffff', surface: '#ffffff', text: '#1b1b1b', muted: '#8a8a8a', border: 'rgba(0,0,0,0.08)', accent: '#4d6bfe', accentSoft: 'rgba(77,107,254,0.10)', ok: '#22c55e', warn: '#f59e0b', danger: '#b4342f' },
    shape: { radius: '7px', radiusSm: '6px', shadow: '0 2px 10px rgba(0,0,0,.12), 0 12px 40px rgba(0,0,0,.16)', font: 'inherit', mono: 'ui-monospace, Consolas, monospace', density: 7 },
    craft: ['近景 + 远景两层阴影，别只写一个', '正文 10–12px，克制到近于元信息', '只在标题上用品牌色'],
    when: '悬浮卡、右下角小面板、抽屉旁边的浮动层',
    avoid: '深色底（双层黑影会糊成一片）',
    tokens: ['box-shadow: 0 2px 10px rgba(0,0,0,.12), 0 12px 40px rgba(0,0,0,.16)', 'border-radius: 7px（小元素 6px）', 'font-size: 12px / 辅助 10–11px', '强调: #4d6bfe'],
  },
  {
    id: 'drawer',
    name: '侧滑抽屉',
    oneLine: '8px 圆角 + 朝左的大投影，滑出来时不盖住主内容的重心',
    source: 'packages/dsh-novel-pane/client/client.js（读书窗格）',
    tags: ['抽屉', '大留白', '阅读'],
    layout: 'drawer',
    colors: { bg: '#fbfbfc', surface: '#ffffff', text: '#1b1b1b', muted: '#8a8a8a', border: 'rgba(0,0,0,0.08)', accent: '#4d6bfe', accentSoft: 'rgba(77,107,254,0.10)', ok: '#22c55e', warn: '#f59e0b', danger: '#d97070' },
    shape: { radius: '8px', radiusSm: '7px', shadow: '-14px 0 36px rgba(0,0,0,.07), -1px 0 0 rgba(0,0,0,.02)', font: 'inherit', mono: 'ui-monospace, Consolas, monospace', density: 10 },
    craft: ['投影只朝一个方向（负 x），另一侧用 1px 细线压边', '行高与段落间距放大，密度别学仪表盘', '标题 13–14px，正文 12–13px'],
    when: '阅读、长文、需要和主对话并排看的侧栏',
    avoid: '信息密度优先的后台面板',
    tokens: ['box-shadow: -14px 0 36px rgba(0,0,0,.07), -1px 0 0 rgba(0,0,0,.02)', 'border-radius: 8px（内侧元素 7px）', '留白: 上下 10px 起，别压到 6px'],
  },
  {
    id: 'glass-dark',
    name: '暗色玻璃卡',
    oneLine: '黑底 + 1px 内高光 + 大投影，小面积用在对话里最抓眼',
    source: 'packages/dsh-agent-supervisor/client/client.js（主管面板）',
    tags: ['暗色', '玻璃', '卡片'],
    layout: 'glass',
    colors: { bg: '#141416', surface: 'rgba(255,255,255,0.04)', text: '#f2f2f2', muted: 'rgba(255,255,255,0.55)', border: 'rgba(255,255,255,0.16)', accent: '#4d6bfe', accentSoft: 'rgba(77,107,254,0.20)', ok: '#22c55e', warn: '#f59e0b', danger: '#c0504d' },
    shape: { radius: '12px', radiusSm: '10px', shadow: 'inset 0 0 0 1px rgba(255,255,255,.16), 0 8px 22px rgba(0,0,0,.32)', font: 'inherit', mono: 'ui-monospace, Consolas, monospace', density: 9 },
    craft: ['用 inset 1px 高光替代描边，边缘才「立」得起来', '投影要到 22–26px 才够沉', '头像/状态点用 50% 圆'],
    when: '对话里的单张卡片、状态卡、需要跳出来的小面板',
    avoid: '整页铺开（大面积暗色在浅色主题里会显得突兀）',
    tokens: ['box-shadow: inset 0 0 0 1px rgba(255,255,255,.16), 0 8px 22px rgba(0,0,0,.32)', 'background: #141416（或 rgba(20,20,22,.92) + backdrop-filter: blur(12px)）', 'border-radius: 12px（内层 10px）', '正文 #f2f2f2，次要 rgba(255,255,255,.55)'],
  },
  {
    id: 'kaguya-sky',
    name: '冷蓝绘本',
    oneLine: '近白蓝底 + 深海蓝强调色，安静、干净、不抢话',
    source: 'packages/dsh-theme-kaguya-hime/client.js（超时空辉夜姬主题的 token 表）',
    tags: ['浅色', '冷调', '主题级'],
    layout: 'panel',
    colors: { bg: '#f5f8fe', surface: '#ffffff', text: '#14243f', muted: '#68799a', border: 'rgba(43,95,168,0.14)', accent: '#2b5fa8', accentSoft: 'rgba(43,95,168,0.12)', ok: '#22c55e', warn: '#f59e0b', danger: '#b4342f' },
    shape: { radius: '8px', radiusSm: '6px', shadow: '0 1px 2px rgba(20,36,63,.18)', font: 'inherit', mono: 'ui-monospace, Consolas, monospace', density: 8 },
    craft: ['底色 #F5F8FE 不要用纯白，纯白会显得刺', '描边用品牌色的低透明度 rgba(43,95,168,.14)', '三档文字色 #14243F / #42546F / #68799A'],
    when: '整站/整主题换肤，或想让面板安静下来的时候',
    avoid: '需要高对比警示的运维面板（它的语义色偏淡）',
    tokens: ['--bg-base: #F5F8FE; --bg-layer-1: #FFFFFF; --bg-layer-2: #F2F6FD', '--label-primary: #14243F; --label-secondary: #42546F; --label-tertiary: #68799A', '--brand-primary: #2B5FA8', '--border-l2: rgba(43,95,168,0.14)', '--shadow-1: 0 1px 2px rgba(20,36,63,.18)'],
  },
  {
    id: 'mono-timeline',
    name: '等宽时间线',
    oneLine: '全等宽字 + 语义色圆点 + 虚线行，像 tail -f 但看得懂',
    source: 'dsh/home/plugins/dsh-qq-panel/client.js（QQ 纪实）',
    tags: ['时间线', '等宽', '审计'],
    layout: 'timeline',
    colors: { bg: '#ffffff', surface: 'rgba(0,0,0,0.02)', text: '#1b1b1b', muted: '#8a8a8a', border: 'rgba(0,0,0,0.12)', accent: '#4d6bfe', accentSoft: 'rgba(77,107,254,0.10)', ok: '#22c55e', warn: '#f59e0b', danger: '#ef4444' },
    shape: { radius: '7px', radiusSm: '6px', shadow: 'none', font: 'ui-monospace, Menlo, Consolas, monospace', mono: 'ui-monospace, Menlo, Consolas, monospace', density: 6 },
    craft: ['全等宽，但标题允许 15px 破一下', '语义色只染文字与圆点，不染整行背景', '长文本必须 ellipsis，不许换行撑高'],
    when: '聊天记录、审计日志、事件流水、任何按时间读的东西',
    avoid: '表单与设置页（等宽字读中文正文很累）',
    tokens: ['font-family: ui-monospace, Menlo, Consolas, monospace', 'font-size: 12px（正文）/ 11px（时间戳）/ 15px（标题例外）', '语义色: 成功 #22c55e / 警示 #f59e0b / 错误 #ef4444', '行: 6px 上下内边距 + 1px dashed 分隔'],
  },
  {
    id: 'mini-row',
    name: '极简单行',
    oneLine: '一行、无圆角、无边框，只有 tertiary 文字和一个 pill',
    source: 'packages/dsh-moon-band/client/client.js + packages/dsh-balance/client/client.js',
    tags: ['极简', '常驻', '零打扰'],
    layout: 'row',
    colors: { bg: 'transparent', surface: 'transparent', text: '#8a8a8a', muted: '#9a9a9a', border: 'rgba(0,0,0,0.08)', accent: '#4d6bfe', accentSoft: 'rgba(77,107,254,0.10)', ok: '#22c55e', warn: '#f59e0b', danger: '#d97070' },
    shape: { radius: '0', radiusSm: '999px', shadow: 'none', font: 'inherit', mono: 'ui-monospace, Consolas, monospace', density: 2 },
    craft: ['整行只用 tertiary 文字色，hover 才提亮', '唯一允许的圆角是 999px 的小 pill', '低于 12px 的字别用，会糊'],
    when: '输入框上方/下方常驻的一行信息（余额、月相、状态）',
    avoid: '任何需要点击多处的场景',
    tokens: ['color: var(--dsw-alias-label-tertiary)（实测 #8a8a8a）', 'font-size: 12px；唯一圆角 999px（小 pill）', '无 border / 无 shadow / 背景透明'],
  },
]

/** 前端层里那 8 条由 style 派生，避免两处写两遍。 */
function styleEntries() {
  return STYLES.map((s) => ({
    id: s.id,
    layer: 'frontend',
    name: s.name,
    oneLine: s.oneLine,
    source: s.source,
    tags: s.tags,
    kind: 'tokens',
    style: s,
    bullets: s.craft,
    howto: `做前端/面板时按这套 token 来（圆角 ${s.shape.radius}、密度 ${s.shape.density}px、投影 ${s.shape.shadow}）。`,
  }))
}

const APP_ENTRIES = [
  {
    id: 'app-huasu-paradigms',
    name: 'huashu-design 3.4 · 八条 App 界面范式',
    oneLine: '先定「这个 App 管的事在现实里长什么样」，再画屏——八条界面范式各带样张',
    source: 'https://github.com/alchaincyf/huashu-design（3.4 新增 App 原型范式，走查两届 App Store Awards 的 90 个入围作品提炼）',
    tags: ['方法层', 'App 原型', '范式'],
    kind: 'text',
    bullets: [
      '界面即世界：主屏就是这件事发生的地方，不是一张带卡片的白底',
      '签名物件：给这个 App 造一个只有它有的可视物（仪表/册页/容器），而不是通用图标',
      '时间有形状：把进度、等待、推移画成看得见的形状',
      '先量数字再动手：看原图、量间距与字号，只借机制不借外衣',
      '该是图的地方放真图（截图/实物/生成图），不拿 emoji 和灰块顶替',
    ],
    howto: '要做 App 原型/移动端界面时，先按这八条各写一句「这个 App 的现实对应物是什么」，再挑一条当主范式，别四条都用。',
  },
  {
    id: 'app-mapmate',
    name: 'MapMate · 会说话的手机地图',
    oneLine: '高德地图 + 语音 Agent 的导航 App：说一句「导航到广州塔」就规划路线、沿途播报',
    source: 'D:/Android/MapMate/MapMate（README 里有主界面与导航模式截图）',
    tags: ['Android', '地图', '语音'],
    kind: 'image',
    cover: 'D:/Android/MapMate/MapMate/docs/screenshot-main.png',
    bullets: [
      '主界面重心是定位箭头，地图铺满、控件浮在角落',
      '导航态换成「路线 + 转向提示」的信息层级，不堆按钮',
      '语音交互做成一问一答的底部抽屉，不打断地图',
    ],
    howto: '要做地图/位置类 App 时借它的「地图铺底 + 角落浮控件」结构；配色与字体按新题材重来。',
  },
  {
    id: 'app-videoquiz',
    name: 'VideoQuiz · 视频成卷',
    oneLine: '把一段拍试卷的视频，变成可作答的题目与答案——Android 端 + 本机 OCR 桥',
    source: 'D:/Android/MapMate/VideoQuiz · /d/github_project/ZhaoWen_GitHub维护/AndroidApps-apk/VideoQuiz-1.4-debug.apk',
    tags: ['Android', '工具型', '拍摄流'],
    kind: 'text',
    bullets: [
      '拍摄 → 抽帧 → 透视校正 → OCR → 结构化，每步都要给可见进度',
      '结果页优先「题目清单 + 逐题展开」，不是一张大图',
      '失败态要能只重拍某一页，不回退整卷',
    ],
    howto: '做「拍摄 → 识别 → 结构化结果」这类工具 App 时借它的进度与失败态设计。',
  },
  {
    id: 'app-huajing',
    name: 'Q 版桌宠（HuaJing）',
    oneLine: 'PyQt5 桌宠：序列帧长图驱动，压扁/拉伸都按 Sprite Sheet 走',
    source: 'D:/github_project/ZhaoWen_GitHub维护/HuaJing/pet-app',
    tags: ['桌面', '像素/卡通', '动效'],
    kind: 'image',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/HuaJing/pet-app/assets/happy.png',
    bullets: [
      '角色只用几个状态帧（idle/happy/wave），靠切换节奏出「活」的感觉',
      '窗口透明 + 置顶，交互区只留角色本身',
    ],
    howto: '做小工具/桌宠的可爱向界面时借它的「状态帧 + 少控件」思路。',
  },
  {
    id: 'app-ember',
    name: '余烬 Ember · 人生纪念碑',
    oneLine: '从一个人的聊天记录里，AI 生成一座属于他的人生纪念碑',
    source: 'D:/github_project/ZhaoWen_GitHub维护/Ember',
    tags: ['概念 App', '叙事', '情感'],
    kind: 'image',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/Ember/assets/logo.png',
    bullets: ['一个页面只讲一件事，长滚动叙事', '深色底 + 单一暖色点缀（余烬感）'],
    howto: '做叙事型/纪念型页面时借它的「深底 + 单色点缀 + 一屏一事」节奏。',
  },
  {
    id: 'app-aurowendao',
    name: 'AuroWendao · 长篇小说写作系统',
    oneLine: '融合六个开源项目的写作引擎：记忆与一致性做骨架，叙事结构做灵魂',
    source: 'D:/github_project/ZhaoWen_GitHub维护/AuroWendao/aurowendao-design.md',
    tags: ['产品设计', '文档', '架构'],
    kind: 'text',
    bullets: [
      '设计文档先讲「为什么是这六个东西」，再讲功能',
      '把「记忆 / 一致性 / 多粒度生成 / 质量闭环」拆成四条并列的骨架',
    ],
    howto: '写产品设计文档时借它的结构：先竞品态势，再四大能力骨架，最后才到功能清单。',
  },
  {
    id: 'app-desktopjelly',
    name: 'DesktopJelly · 桌面图标弹弹弹',
    oneLine: '让 Windows 桌面图标像软糖一样循环伸缩：底部固定，压扁变宽、拉高变窄',
    source: 'D:/github_project/ZhaoWen_GitHub维护/DesktopJelly（C# + WinForms + 原生窗口接口）',
    tags: ['桌面', '交互点子', '动效'],
    kind: 'text',
    bullets: ['一句话就能说清的物理隐喻（软糖），全部交互围绕它', '托盘常驻，参数只暴露速度/幅度/帧率三个'],
    howto: '做「一个物理隐喻撑起整个交互」的小工具时，借它只暴露三个参数的克制。',
  },
]

const FRONTEND_EXTRA = [
  {
    id: 'fe-kaguya-theme',
    name: '超时空辉夜姬皮肤（完整主题）',
    oneLine: '蜡笔绘本背景 + Q 版八千代头像 + TSUKUYOMI STAGE 字标，只换颜色 token 不动布局',
    source: 'packages/dsh-theme-kaguya-hime（assets/backdrop-crayon-v8.png 等）',
    tags: ['主题', '浅色', '二次元'],
    kind: 'image',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/zhaowen-dsh/packages/dsh-theme-kaguya-hime/assets/backdrop-crayon-v8.png',
    bullets: ['皮肤只动 token，布局一行不改 —— 换肤才不会牵连结构', '背景用低对比手绘纹理，正文仍然要 ≥4.5:1'],
    howto: '做主题/换肤时借它的「只换 token」边界；背景图永远压到不抢正文。',
  },
  {
    id: 'fe-whalegirl',
    name: '鲸鱼娘主题（第三方皮肤）',
    oneLine: '蓝白水感的整套皮肤，含背景图与预览图',
    source: 'dsh/home/profiles/web/node_modules/dsh-theme-whalegirl（assets/background.jpg、assets/previews）',
    tags: ['主题', '第三方', '蓝白'],
    kind: 'image',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/dsh/home/profiles/web/node_modules/dsh-theme-whalegirl/assets/background.jpg',
    bullets: ['大面积浅蓝渐变 + 白卡，靠水的质感而不是装饰贴图', '强调色只用一个深蓝'],
    howto: '做蓝白/水感界面时借它的底色层次；不要叠太多装饰元素。',
  },
  {
    id: 'fe-wesight-qa',
    name: 'WeSight 主题与皮肤设计 QA',
    oneLine: '拿设计源图和实现截图逐项对照的 QA 文档：间距、字号、色值、圆角一条条核',
    source: 'D:/github_project/ZhaoWen_GitHub维护/wesight/design-qa.md · dmg-design-qa.md',
    tags: ['设计 QA', '对照', '方法'],
    kind: 'text',
    bullets: ['先把「对照基准」写成两张图（源图 / 实现截图），再逐项列差异', '差异要写成可执行的修正值，不写「看起来不太对」'],
    howto: '交付前做设计走查时按这个格式写：基准图 + 逐项差异 + 修正值。',
  },
]

const VIDEO_ENTRIES = [
  {
    id: 'vid-bv-ref',
    name: 'BV1KHaG6bEb9 复刻 · 洗衣机鲸鱼娘',
    oneLine: '10.07 秒竖屏 AI 短片：同一角色、固定机位、单镜到底——先有角色参考再生成',
    source: 'D:/github_project/ZhaoWen_GitHub维护/_videos/BV1KHaG6bEb9.mp4 · _tools/doubao-video/（参考图 + 首帧 + 成片）',
    tags: ['AI 短片', '竖屏', '角色一致性'],
    kind: 'image',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_tools/doubao-video/01-first-frame.png',
    bullets: [
      '复刻角色的前提是拿到**角色参考图**，纯文字提示词守不住脸和服装',
      '10 秒只讲一个动作（随滚筒旋转 → 贴近玻璃 → 眨眼歪头）',
      '镜头固定，靠主体运动制造时间感',
    ],
    howto: '要做角色向短片时：先定参考图，再写「镜头固定 + 一个连续动作 + 结尾停在哪一帧」。',
  },
  {
    id: 'vid-rea-video',
    name: 'rea-video · 视频逆向拆解',
    oneLine: '逐镜头判断实拍/AI/3D/代码渲染，产出带证据的 report.html 与复刻方案',
    source: 'D:/github_project/ZhaoWen_GitHub维护/rea-video（skill + CLI，插件为 packages/dsh-rea-video）',
    tags: ['方法', '拆解', '复刻'],
    kind: 'text',
    bullets: ['先拆镜头再谈风格：每个镜头标素材类型 + 运镜 + 转场', '证据落在帧号/时间码上，不写「看起来像 AI」'],
    howto: '给我一条参考视频时，先跑 rea-video 拆解，再按它的分镜表挑一条风格往下做。',
  },
  {
    id: 'vid-carl-flat',
    name: '扁平矢量（flat-vector）',
    oneLine: '纯色块 + 粗描边 + 无渐变，动效靠位移与缩放，不靠光影',
    source: 'D:/github_project/ZhaoWen_GitHub维护/agent-skills/carl-motion/scenes/flat-vector',
    tags: ['动效风格', '矢量', '通用'],
    kind: 'text',
    bullets: ['颜色 ≤ 5 个纯色，线条统一粗细', '镜头只做 pan/zoom，元素分批入场'],
    howto: '要做概念讲解/流程演示动画时用这套：纯色块 + 分批入场，别加投影和渐变。',
  },
  {
    id: 'vid-carl-ink',
    name: '中国水墨（chinese-ink-wash）',
    oneLine: '墨色浓淡 + 晕染扩散，转场用「一笔扫过」而不是切',
    source: 'D:/github_project/ZhaoWen_GitHub维护/agent-skills/carl-motion/scenes/chinese-ink-wash',
    tags: ['动效风格', '国风', '晕染'],
    kind: 'text',
    bullets: ['只在黑白灰里做层次，最多一点赭石', '入场用墨迹扩散，出场用飞白'],
    howto: '做国风/文化类片头时用；别把水墨和发光特效混用。',
  },
  {
    id: 'vid-carl-clay',
    name: '黏土定格（claymation）',
    oneLine: '哑光材质 + 指纹瑕疵 + 12fps 顿挫，暖光从侧上方来',
    source: 'D:/github_project/ZhaoWen_GitHub维护/agent-skills/carl-motion/scenes/claymation',
    tags: ['动效风格', '定格', '材质'],
    kind: 'text',
    bullets: ['帧率故意压到 12–15，抖动是特征不是缺陷', '材质要哑光，高光点很小'],
    howto: '做手作/童趣题材时用；真实感来自瑕疵，不要磨平。',
  },
  {
    id: 'vid-carl-blueprint',
    name: '技术蓝图（blueprint）',
    oneLine: '深蓝底 + 白色细线 + 网格与标注，像工程图在动',
    source: 'D:/github_project/ZhaoWen_GitHub维护/agent-skills/carl-motion/scenes/blueprint',
    tags: ['动效风格', '技术感', '线稿'],
    kind: 'text',
    bullets: ['线宽 ≤ 2px，标注带引线', '动效是「逐段绘制」而不是整块淡入'],
    howto: '讲原理/结构时用：先画骨架再逐段描出来。',
  },
  {
    id: 'vid-carl-exploded',
    name: '爆炸视图（exploded-view）',
    oneLine: '部件沿轴分离再合拢，交代「里面有什么」',
    source: 'D:/github_project/ZhaoWen_GitHub维护/agent-skills/carl-motion/scenes/exploded-view',
    tags: ['动效风格', '产品演示', '结构'],
    kind: 'text',
    bullets: ['分离距离按部件重要性分级，不要等距', '合拢前留 0.3s 静止让人看清'],
    howto: '做产品结构/拆解演示时用；分离和合拢各留一次静止。',
  },
  {
    id: 'vid-carl-brick',
    name: '积木玩具（brick-toy）',
    oneLine: '塑料反光 + 凸点细节 + 一块块拼起来，量大但节奏清楚',
    source: 'D:/github_project/ZhaoWen_GitHub维护/agent-skills/carl-motion/scenes/brick-toy',
    tags: ['动效风格', '玩具', '拼装'],
    kind: 'text',
    bullets: ['拼装顺序要有逻辑（先底再上），不能随机落块', '每块落位给一个小回弹'],
    howto: '做「从零搭起来」的叙事时用；落块顺序要能讲通。',
  },
  {
    id: 'vid-carl-glass',
    name: '玻璃拟态 UI 动效（glassmorphism-ui）',
    oneLine: '毛玻璃卡片在渐变背景上漂浮，焦点靠模糊与高光转移',
    source: 'D:/github_project/ZhaoWen_GitHub维护/agent-skills/carl-motion/scenes/glassmorphism-ui',
    tags: ['动效风格', 'UI 演示', '玻璃'],
    kind: 'text',
    bullets: ['背景必须有内容，否则模糊没意义', '同一屏最多两层玻璃，再多就糊'],
    howto: '做产品 UI 演示动效时用；背景要真有点东西在动。',
  },
  {
    id: 'vid-carl-huashu',
    name: '花叔风人像（huashu-portraits）',
    oneLine: '半调网点 + 双色套印的人像处理，静态图也能当封面',
    source: 'D:/github_project/ZhaoWen_GitHub维护/agent-skills/carl-motion/scenes/huashu-portraits',
    tags: ['动效风格', '人像', '印刷感'],
    kind: 'text',
    bullets: ['两色套印（深色 + 一个亮色），网点大小随明暗变化', '人像只保留轮廓与关键阴影'],
    howto: '做人物封面/访谈片头时用；网点密度是调性开关。',
  },
]

export const LAYERS = [
  { id: 'app', name: 'App 设计', hint: '手机 / 桌面应用的界面与产品设计', entries: APP_ENTRIES },
  { id: 'frontend', name: '前端设计', hint: '网页、面板、主题皮肤（八种样式量自本机代码）', entries: [...styleEntries(), ...FRONTEND_EXTRA] },
  { id: 'video', name: '视频风格', hint: '短片 / 动效 / 片头的视觉风格与复刻方法', entries: VIDEO_ENTRIES },
]

export const ALL_ENTRIES = LAYERS.flatMap((l) => l.entries)

export function findEntry(id) {
  return ALL_ENTRIES.find((e) => e.id === id) || null
}

export function layerOf(id) {
  return LAYERS.find((l) => l.entries.some((e) => e.id === id)) || null
}

/** 「引用给 AI」的正文。三类（tokens / image / text）措辞一致，都带出处与约束。 */
export function promptOf(entry) {
  const layer = layerOf(entry.id)
  const lines = [
    `【设计参考】${entry.name}（${layer === null ? '设计' : layer.name}）`,
    `一句话：${entry.oneLine}`,
    `出处：${entry.source}`,
  ]
  if (entry.style !== undefined) {
    const s = entry.style
    lines.push(
      '',
      '颜色：',
      `  底 ${s.colors.bg}　面 ${s.colors.surface}　字 ${s.colors.text}　次 ${s.colors.muted}`,
      `  描边 ${s.colors.border}　强调 ${s.colors.accent}`,
      '',
      '形状与排版：',
      `  圆角 ${s.shape.radius}（小元素 ${s.shape.radiusSm}）`,
      `  投影 ${s.shape.shadow}`,
      `  字体 ${s.shape.font}；等宽 ${s.shape.mono}`,
      `  密度 上下内边距 ${s.shape.density}px`,
      '',
      '直接可用的 CSS：',
      ...s.tokens.map((t) => `  ${t}`),
    )
  }
  if (Array.isArray(entry.bullets) && entry.bullets.length > 0) {
    lines.push('', '要点：', ...entry.bullets.map((b) => `  - ${b}`))
  }
  if (entry.style !== undefined) lines.push('', `视觉手法：${entry.style.craft.join('；')}`, `适合：${entry.style.when}`, `别用在：${entry.style.avoid}`)
  lines.push('', `怎么用：${entry.howto}`, '', '约束：', ...SHARED_RULES.map((r) => `  - ${r}`))
  return lines.join('\n')
}

/**
 * 出处归属：mine = 我自己项目里的东西，可以直接复用；
 * referenced = 别人的作品（开源仓库/第三方主题/他人片子），**只作参照，不得声称原创、不得整段照抄**。
 *
 * 这条是用户明确要的：「对于别人的，不能自己自创」——别人的东西必须标清楚是引用。
 */
const ORIGIN = {
  'dsh-native': 'mine',
  'dash-compact': 'mine',
  'float-panel': 'mine',
  'drawer': 'mine',
  'glass-dark': 'mine',
  'kaguya-sky': 'mine',
  'mono-timeline': 'mine',
  'mini-row': 'mine',
  'app-huasu-paradigms': 'referenced',
  'app-mapmate': 'mine',
  'app-videoquiz': 'mine',
  'app-huajing': 'mine',
  'app-ember': 'mine',
  'app-aurowendao': 'mine',
  'app-desktopjelly': 'mine',
  'fe-kaguya-theme': 'mine',
  'fe-whalegirl': 'referenced',
  'fe-wesight-qa': 'referenced',
  'vid-bv-ref': 'mine',
  'vid-rea-video': 'referenced',
  'vid-carl-flat': 'referenced',
  'vid-carl-ink': 'referenced',
  'vid-carl-clay': 'referenced',
  'vid-carl-blueprint': 'referenced',
  'vid-carl-exploded': 'referenced',
  'vid-carl-brick': 'referenced',
  'vid-carl-glass': 'referenced',
  'vid-carl-huashu': 'referenced',
}

/** 归属的补充说明（IP、许可、哪部分是我做的），会写进 prompt。 */
const ORIGIN_NOTE = {
  'fe-kaguya-theme': '皮肤代码是我写的，但视觉素材是《超时空辉夜姬》的 IP，只在自己机器上用，不要分发。',
  'vid-bv-ref': '原片是 B 站 UP 主做的；复刻版是我用豆包生成的。角色「溟月」为他人原创（CC BY-NC-SA 4.0），只作私人练习。',
  'vid-rea-video': 'rea-video 是开源工具，插件壳是我写的；拆解方法可以借，产物别当原创。',
  'fe-wesight-qa': 'WeSight 是别人的项目，这份 QA 文档是照着它的设计源图与实现截图写的对照记录。',
  'app-huasu-paradigms': '花叔（alchaincyf）的 huashu-design，MIT 协议；这里是方法摘要，不是我的原创。',
  'fe-whalegirl': '第三方主题包（npm 安装），只是我这边在用。',
}

for (const e of ALL_ENTRIES) {
  e.origin = ORIGIN[e.id] ?? 'mine'
  if (ORIGIN_NOTE[e.id] !== undefined) e.originNote = ORIGIN_NOTE[e.id]
}

/**
 * 纯文字条目的「海报」配色。不是成品帧，是给这张卡一个可辨认的视觉身份
 * （panel 里按 pattern 画一个 CSS 图案），避免文档类条目全挤成白底文字块。
 */
const SWATCH = {
  'app-huasu-paradigms': { a: '#12233b', b: '#1d3a5f', fg: '#e6eefb', accent: '#f0b429', pattern: 'grid' },
  'app-videoquiz': { a: '#20303c', b: '#2f4a5a', fg: '#e7f1f6', accent: '#4dd0e1', pattern: 'stripes' },
  'app-aurowendao': { a: '#2a2118', b: '#4a3626', fg: '#f3e7d6', accent: '#d99b4a', pattern: 'blot' },
  'app-desktopjelly': { a: '#241f3a', b: '#3d2f66', fg: '#efe9ff', accent: '#8ef0c0', pattern: 'dots' },
  'vid-rea-video': { a: '#1a1a1d', b: '#2b2b30', fg: '#f0f0f0', accent: '#ff5a5f', pattern: 'rays' },
  'vid-carl-flat': { a: '#f4f1ea', b: '#e6e0d4', fg: '#232323', accent: '#e4572e', pattern: 'dots' },
  'vid-carl-ink': { a: '#f3efe6', b: '#e4ddcd', fg: '#1a1a1a', accent: '#6b6256', pattern: 'blot' },
  'vid-carl-clay': { a: '#e8d5c0', b: '#d3b79c', fg: '#4a3524', accent: '#b5651d', pattern: 'dots' },
  'vid-carl-blueprint': { a: '#0b2a4a', b: '#123a63', fg: '#cfe4fa', accent: '#9fc7e8', pattern: 'grid' },
  'vid-carl-exploded': { a: '#1c1c22', b: '#2b2b34', fg: '#f2f2f2', accent: '#ffb703', pattern: 'stripes' },
  'vid-carl-brick': { a: '#2b2b2b', b: '#3a3a3a', fg: '#f7f7f7', accent: '#e63946', pattern: 'grid' },
  'vid-carl-glass': { a: '#5b6bd6', b: '#9b6bd6', fg: '#ffffff', accent: 'rgba(255,255,255,.55)', pattern: 'blot' },
  'vid-carl-huashu': { a: '#f2e8d5', b: '#e3d3b8', fg: '#2b2b2b', accent: '#d64545', pattern: 'dots' },
}
for (const e of ALL_ENTRIES) if (SWATCH[e.id] !== undefined) e.swatch = SWATCH[e.id]

for (const e of ALL_ENTRIES) e.prompt = promptOf(e)

/** 面板顶部的大层切换（三个），二级筛选按 tags。 */
export const TAGS = [...new Set(ALL_ENTRIES.flatMap((e) => e.tags ?? []))]
