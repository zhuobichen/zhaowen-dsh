import { MEMBERS } from './collections.js'

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

/** 规格页只留一句要求；详细数值都在上面，不重复啰嗦。 */
const ASK = '按上面这套来就行；要新颜色/新档位先问我。'

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


/**
 * ── huashu-design（花叔）风格库 ─────────────────────────────────────
 * 92 种风格：网页 20 / PPT 20 / 信息图 20 / App 12 / 中文与东亚 12 / 小红书 8。
 * 这里收 6 条分区总览 + 一批有代表性的单条；样张直接引 GitHub 上的 jpg（远程，不落盘）。
 * 源：https://github.com/alchaincyf/huashu-design · references/design-styles.md
 */
const HD = 'https://raw.githubusercontent.com/alchaincyf/huashu-design/master/assets/style-specimens'
const HD_REF = 'huashu-design · references/design-styles.md'

const HUASHU_APP = [
  {
    id: 'app-huasu-app-zone',
    layer: 'app',
    name: 'huashu · App 风格库 12 种',
    oneLine: '按「这个 App 管的事在现实里长什么样」建屏：硬件面板 / 液态玻璃 / 玩味 3D / 友好金融 / 专业相机 / 地形工具 / 瀑布流 / 命令面板 / 健康色码 / 原生精修 / 柔和鼓励 / 编辑阅读',
    source: 'huashu-design · assets/style-specimens/app（12 张样张）',
    tags: ['方法层', 'App 风格库', '12 种'],
    kind: 'image',
    coverUrl: HD + '/app/01-hardware-panel.jpg',
    bullets: ['每条都带样张，先看图再读文字', '样张是「展示板」：2–3 块手机屏，构图本身也是示范', '挑一条当主范式，别把四条缝在一起'],
    howto: '做 App 原型时先在这一区挑一个风格，再去看对应细节；库里每条都写了纯 HTML 的还原度。',
    origin: 'referenced',
  },
  {
    id: 'app-huasu-hardware-panel',
    layer: 'app',
    name: '硬件面板（Teenage Engineering 式）',
    oneLine: '近黑屏 + 信号橙 + 米灰按键，点阵读数、方格按键阵列、丝印标签',
    source: 'huashu · style-specimens/app/01-hardware-panel.jpg（参考 OP-1 / EP-133）',
    tags: ['App 风格', '工具类', '点阵'],
    kind: 'image',
    coverUrl: HD + '/app/01-hardware-panel.jpg',
    bullets: ['橙色只给「当前激活」，别满屏刷', '按键用 inset 底边阴影表达「压下去的厚度」', '点阵字做读数，标签全大写 + 宽字距'],
    howto: '音频/创作/极客小工具类 App 用这套；纯 CSS 可还原 85%。',
    origin: 'referenced',
  },
  {
    id: 'app-huasu-liquid-glass',
    layer: 'app',
    name: '液态玻璃（iOS 26 语言）',
    oneLine: '内容铺满全屏，控件是半透明白玻璃胶囊，浮在内容上',
    source: 'huashu · style-specimens/app/02-liquid-glass.jpg（参考 Apple Liquid Glass）',
    tags: ['App 风格', '玻璃', '原生感'],
    kind: 'image',
    coverUrl: HD + '/app/02-liquid-glass.jpg',
    bullets: ['背景必须有色彩层次，玻璃才看得出来；纯色底上等于灰块', 'backdrop-filter: blur(22px) saturate(180%) 是核心', '标签栏做成悬浮胶囊，不是贴底整条'],
    howto: '天气/运动/媒体类要「内容为主、控件悬浮」时用；折射光效 CSS 做不到，降级为高光描边并在产出里说明。',
    origin: 'referenced',
  },
  {
    id: 'app-huasu-friendly-fintech',
    layer: 'app',
    name: '友好金融（Monzo 式）',
    oneLine: '珊瑚红满铺顶部 + 白色大圆角面板抬起，余额大字 + 胶囊按钮 + 彩色「罐子」',
    source: 'huashu · style-specimens/app/04-friendly-fintech.jpg（参考 Monzo）',
    tags: ['App 风格', '金融', '大圆角'],
    kind: 'image',
    coverUrl: HD + '/app/04-friendly-fintech.jpg',
    bullets: ['圆角 28–34px，两列罐子方块', '余额 58px 以上粗体，口语化小标题', '图标不用画：单字 + 同色系深浅底'],
    howto: '把「严肃的钱」说得亲切时用；纯 CSS 可 1:1 还原。',
    origin: 'referenced',
  },
  {
    id: 'app-huasu-native-polish',
    layer: 'app',
    name: '原生精修（Things 3 式）',
    oneLine: '纯白 + 近黑 + 一个蓝，勾选框、缩进发丝线、浮起任务卡',
    source: 'huashu · style-specimens/app/10-native-polish.jpg（参考 Things 3）',
    tags: ['App 风格', '效率', '安静'],
    kind: 'image',
    coverUrl: HD + '/app/10-native-polish.jpg',
    bullets: ['行分隔线从复选框右侧起（缩进发丝线）', '任务展开成带大阴影的浮起卡片', '蓝色只给勾选、链接、加号'],
    howto: '任务/笔记/日程这类「用久了不累」的工具；纯 CSS 可还原 95%。',
    origin: 'referenced',
  },
]

const HUASHU_FRONTEND = [
  {
    id: 'fe-huasu-web-zone',
    layer: 'frontend',
    name: 'huashu · 网页风格库 20 种',
    oneLine: '从媒体级粗野主义到瑞士黑白、日式白盒：每条都带样张与「纯 HTML 还原度」',
    source: HD_REF + '（网页分区 20 条）',
    tags: ['方法层', '网页风格库', '20 种'],
    kind: 'image',
    coverUrl: HD + '/web/01-editorial-brutalism.jpg',
    bullets: ['每条标了 大胆/中性/安静 与还原度（≥90% 闭眼做）', '先看样张再读文字：只读名字做出来是「平均印象」', '三个方向别都落在同一种气质'],
    howto: '做网页/落地页/官网时先在这一区挑一条，再按它的「HTML 实现」写。',
    origin: 'referenced',
  },
  {
    id: 'fe-huasu-ppt-zone',
    layer: 'frontend',
    name: 'huashu · PPT 风格库 20 种',
    oneLine: '新瑞士大字报 / 黑底巨型数字 / 单色撞色海报 / Bento 格 / Tufte 证据页……',
    source: HD_REF + '（PPT 分区 20 条）',
    tags: ['方法层', 'PPT 风格库', '20 种'],
    kind: 'image',
    coverUrl: HD + '/ppt/01-neo-swiss-billboard.jpg',
    bullets: ['母版都是「一页一句 + 一个图」', '数字用 tabular-nums 等宽收紧字距', '章节页用大色块一个词'],
    howto: '做 deck/汇报/路演时来这一区挑；纯 HTML/CSS 就能到 90% 以上。',
    origin: 'referenced',
  },
  {
    id: 'fe-huasu-info-zone',
    layer: 'frontend',
    name: 'huashu · 信息图库 20 种',
    oneLine: 'McCandless 美丽信息 / Tufte 小倍数 / 地铁拓扑图 / 科学期刊图版 / 瑞士网格年报',
    source: HD_REF + '（信息图分区 20 条）',
    tags: ['方法层', '信息图', '20 种'],
    kind: 'image',
    coverUrl: HD + '/info/11-beautiful-information.jpg',
    bullets: ['「一张以数据为主角、能脱离交互独立阅读的图」走这一区', '小倍数必须共用坐标轴范围，否则失去可比性', '地铁图牺牲地理准确性换可读性'],
    howto: '做数据图/长图/年报时用；全部可用纯 SVG + CSS 画，不需要素材。',
    origin: 'referenced',
  },
  {
    id: 'fe-huasu-east-zone',
    layer: 'frontend',
    name: 'huashu · 中文与东亚 12 种',
    oneLine: '吕敬人书籍设计 / 宋刻本版式 / 民国书衣 / 上海摩登 / 香港街招 / 田中一光 / 佐藤可士和',
    source: HD_REF + '（中文与东亚分区 12 条）',
    tags: ['方法层', '中文版式', '12 种'],
    kind: 'image',
    coverUrl: HD + '/east/01-lu-jingren-bookcraft.jpg',
    bullets: ['中文版面有自己的语法：竖排、版心、界栏、题签', '不是「西方风格 + 换中文字体」', '手写题签/做旧纸张做不到，按条目里的「降级」处理'],
    howto: '中文内容尤其值得来这一区翻：跨媒介，网页/deck/海报/信息图都能用。',
    origin: 'referenced',
  },
  {
    id: 'fe-huasu-xhs-zone',
    layer: 'frontend',
    name: 'huashu · 小红书图文 8 种',
    oneLine: '标本志 / 贴纸本 / 索引 / 长卷 / 日报 / 集换卡 / 留白 / 面积信息图',
    source: HD_REF + '（小红书分区 8 条，每张样张同时是模板）',
    tags: ['方法层', '小红书', '8 种'],
    kind: 'image',
    coverUrl: HD + '/xhs/01-specimen-journal.jpg',
    bullets: ['3:4 竖图 1242×1660，第一张是封面', '正文 ≥42px、标签 ≥32px，换内容别往下缩', '一组里穿插一两张「留白」换气'],
    howto: '做图文/封面/轮播时用；样张按 1200×750 打开是样张，按真实尺寸打开交给切图脚本。',
    origin: 'referenced',
  },
  {
    id: 'fe-huasu-editorial-brutalism',
    layer: 'frontend',
    name: '媒体级粗野主义',
    oneLine: '纯黑白 + 超链接蓝 + 信号橙红，120px 巨号标题直接压 14px 小正文',
    source: 'huashu · style-specimens/web/01-editorial-brutalism.jpg（参考 Bloomberg Businessweek）',
    tags: ['网页风格', '大胆', '高密度'],
    kind: 'image',
    coverUrl: HD + '/web/01-editorial-brutalism.jpg',
    bullets: ['极端字号反差是主手法，别把标题缩小', '用 1px 规则线分栏切割，不留白', '零素材依赖，纯 CSS 可 98% 还原'],
    howto: '媒体/内容出版、观点型长文、发布 hero；要「信息密度 + 态度」时首选。',
    origin: 'referenced',
  },
  {
    id: 'fe-huasu-neo-brutalism',
    layer: 'frontend',
    name: '新粗野主义撞色',
    oneLine: '电光紫/品红 + 亮黄，3px 粗黑描边 + 4px 硬投影，几乎无圆角',
    source: 'huashu · style-specimens/web/02-neo-brutalism.jpg（参考 The Verge 2022）',
    tags: ['网页风格', '大胆', '撞色'],
    kind: 'image',
    coverUrl: HD + '/web/02-neo-brutalism.jpg',
    bullets: ['border: 3px solid #000 + box-shadow: 4px 4px 0 #000', 'hover 撞色翻转（不是变浅）', '卡片化 feed 流、硬色块分区'],
    howto: '内容站/活动 landing/榜单页；想要「未完成的界面气质」时用。',
    origin: 'referenced',
  },
  {
    id: 'fe-huasu-warm-editorial',
    layer: 'frontend',
    name: '暖色出版物（Anthropic 式）',
    oneLine: '奶油纸底 #F5F0E8 + 赤陶橙点缀 + 衬线标题×无衬线正文，书籍式单栏',
    source: 'huashu · style-specimens/web/12-warm-editorial.jpg（参考 Anthropic / Penguin）',
    tags: ['网页风格', '中性', '长文'],
    kind: 'image',
    coverUrl: HD + '/web/12-warm-editorial.jpg',
    bullets: ['max-width 控阅读宽度，line-height 1.7', '衬线标题 + 无衬线正文混排', '注意：这也是 AI 最容易滑进去的默认外观，别三个方向都挤这里'],
    howto: 'AI 产品站/长文/白皮书；要「出版物感」又要克制时用。',
    origin: 'referenced',
  },
  {
    id: 'fe-huasu-linear-bento',
    layer: 'frontend',
    name: 'Linear 暗色发光 + Bento',
    oneLine: '近黑底 + 去饱和蓝紫品牌色 + 发丝分割线的便当盒网格',
    source: 'huashu · style-specimens/web/13-glassmorphism-bento.jpg（参考 Linear / Cursor）',
    tags: ['网页风格', '中性', '暗色'],
    kind: 'image',
    coverUrl: HD + '/web/13-glassmorphism-bento.jpg',
    bullets: ['bento 分块 + 1px 发丝线，靠层次不靠阴影', '发光用 radial-gradient 晕，不做霓虹描边', '产品截图位用简化假 UI，别用灰块'],
    howto: 'SaaS/开发者工具 hero、功能展示；「The Linear Look」已经成流派，配方成熟。',
    origin: 'referenced',
  },
  {
    id: 'fe-huasu-swiss-mono',
    layer: 'frontend',
    name: 'Swiss 极致黑白',
    oneLine: '纯黑白 + Geist + 直角锐边 + 精密栅格，零彩色或仅一抹蓝链接',
    source: 'huashu · style-specimens/web/19-swiss-monochrome.jpg（参考 Vercel）',
    tags: ['网页风格', '安静', '极简'],
    kind: 'image',
    coverUrl: HD + '/web/19-swiss-monochrome.jpg',
    bullets: ['border-radius: 0，发丝边框', 'Geist 已开源，可直接引', '100% 纯 CSS 还原'],
    howto: '开发者文档/技术官网；最安全也最容易做成「没有主张」——用它就要靠版式取胜。',
    origin: 'referenced',
  },
  {
    id: 'fe-huasu-song-block',
    layer: 'frontend',
    name: '宋刻本版式',
    oneLine: '一整叶居中：版框外粗内细、竖排界栏、版心鱼尾、朱批点圈',
    source: 'huashu · style-specimens/east/02-song-block-print.jpg',
    tags: ['中文版式', '古籍', '竖排'],
    kind: 'image',
    coverUrl: HD + '/east/02-song-block-print.jpg',
    bullets: ['writing-mode: vertical-rl 每列一个 div，从右往左读', '鱼尾用 clip-path 三角，界栏用 border-left', '朱圈用 text-emphasis'],
    howto: '文献/档案/文化类内容页、deck 引文页；墨色浓淡与纸张破损做不到，降级为均匀墨色。',
    origin: 'referenced',
  },
  {
    id: 'fe-huasu-tanaka',
    layer: 'frontend',
    name: '田中一光几何构成',
    oneLine: '网格上的方/圆/四分之一圆拼成抽象主图：红、黑、芥黄、一点钢蓝',
    source: 'huashu · style-specimens/east/09-tanaka-geometric-poster.jpg',
    tags: ['中文版式', '海报', '几何'],
    kind: 'image',
    coverUrl: HD + '/east/09-tanaka-geometric-poster.jpg',
    bullets: ['70px 为单位在 560 方阵里排', 'border-radius 做四分之一圆，repeating-linear-gradient 做条纹', '竖排粗宋体大标题 + 小红标签信息块'],
    howto: '展览/演出海报、文化机构首屏；丝网套色质感做不到，降级纯色平涂。',
    origin: 'referenced',
  },
  {
    id: 'fe-huasu-hk-signs',
    layer: 'frontend',
    name: '香港街招与招牌',
    oneLine: '层层叠放的竖招横招、高饱和底色 + 奶白边框 + 外发光，电线横穿',
    source: 'huashu · style-specimens/east/06-hk-street-signs.jpg',
    tags: ['中文版式', '大胆', '霓虹'],
    kind: 'image',
    coverUrl: HD + '/east/06-hk-street-signs.jpg',
    bullets: ['绝对定位逐块摆放，招牌之间要遮挡', 'box-shadow 做灯箱外发光，text-shadow 做硬投影', '竖招用 writing-mode: vertical-rl'],
    howto: '餐饮/零售/夜市类品牌页、活动海报；北魏体手写笔画做不到，降级 Noto 粗黑。',
    origin: 'referenced',
  },
]

const CODEVIDEO = [
  {
    id: 'cv-openmotion',
    layer: 'codevideo',
    name: 'OpenMotion · HTML 即视频的全栈工作室',
    oneLine: '把参考片拆成镜头，用 HTML/CSS/JS 重建，Studio 里调时间线，最后渲 MP4——同一份工程',
    source: 'https://github.com/nexu-io/openmotion（Apache-2.0）',
    tags: ['视频方法', 'HTML 即视频', '开源'],
    kind: 'image',
    coverUrl: 'https://raw.githubusercontent.com/nexu-io/openmotion/main/docs/readme/live-product/editor.en.jpg',
    bullets: ['视频不是剪出来的，是「用代码写出来」的：场景、字、转场、时间都在 HTML 里', 'Motion.md：镜头顺序/时长/转场的可分享格式', 'BYOA（带自己的 Agent）+ BYOK（带自己的 key）'],
    howto: '要做产品片/品牌短片/口播剪辑时，按它的路子：先拆参考，再写 HTML 场景，最后渲 MP4。',
    origin: 'referenced',
  },
  {
    id: 'cv-recreate',
    layer: 'codevideo',
    name: 'OpenMotion · 参考片重构流程',
    oneLine: '拆钩子与叙事、拆镜头结构、拆动效节奏、拆字体与色彩、拆声音——再换成你的素材重建',
    source: 'https://github.com/nexu-io/openmotion/blob/main/skills/openmotion-recreate/SKILL.md',
    tags: ['视频方法', '复刻', '拆解'],
    kind: 'text',
    swatch: { a: '#1f2430', b: '#2f3a4d', fg: '#e8eef7', accent: '#7aa2f7', pattern: 'stripes' },
    bullets: ['五个维度逐条拆：钩子 / 镜头 / 动效 / 字体色彩 / 声音', '保留「动效意图」，替换成你的品牌与文案', '做完和参考并排对一遍，说明还差什么'],
    howto: '复刻一条参考片时按这五维写拆解表，再决定哪些保留、哪些替换。',
    origin: 'referenced',
  },
  {
    id: 'cv-templates',
    layer: 'codevideo',
    name: 'OpenMotion · 模板库与 Motion.md',
    oneLine: '一批可编辑的动效模板（OpenAI/Anthropic/Notion/Slack/Stripe/Kimi…），每个带 Motion.md',
    source: 'https://open-design.ai/templates/ · https://github.com/nexu-io/openmotion/blob/main/docs/motion-md.md',
    tags: ['视频方法', '模板', 'Motion.md'],
    kind: 'image',
    coverUrl: 'https://raw.githubusercontent.com/nexu-io/openmotion/main/docs/readme/live-product/remix.en.jpg',
    bullets: ['模板不是视频文件，是可编辑的 HTML 工程', 'Motion.md 写清镜头顺序、时长、转场与 Brand Kit', '下载 motion.md 就能照着重做'],
    howto: '想快速出一个片子时，挑一个同题材模板，改文案/配色/产品截图，再渲。',
    origin: 'referenced',
  },
  {
    id: 'cv-stack',
    layer: 'codevideo',
    name: 'OpenMotion · 渲染栈（HTML → MP4）',
    oneLine: 'Chromium + Puppeteer 渲帧、FFmpeg 编码、GSAP 驱动时间线，导出前做规格校验',
    source: 'https://github.com/nexu-io/openmotion（hyperframes 引擎 + scripts/verify-export.ts）',
    tags: ['视频方法', '渲染', '工程'],
    kind: 'text',
    swatch: { a: '#151a21', b: '#243040', fg: '#dfe9f5', accent: '#4ec9b0', pattern: 'grid' },
    bullets: ['时间线用 GSAP，帧由无头 Chromium 抓', '导出走 FFmpeg/FFprobe，并校验分辨率/时长/音轨', '同一工程既能预览也能出片，避免「设计稿和成片两张皮」'],
    howto: '想知道「HTML 怎么变成片子」时看这条：这就是本机 generate_video 之外的另一条路。',
    origin: 'referenced',
  },
  {
    id: 'cv-when',
    layer: 'codevideo',
    name: '什么时候用代码生视频（而不是 AI 生成）',
    oneLine: '要精确的排版/时间/文案就写代码；要真实质感与角色就生成——两条路经常混着用',
    source: '综合 OpenMotion 与豆包生视频两条链路（本机 generate_video 插件）',
    tags: ['方法', '选型', '对比'],
    kind: 'text',
    swatch: { a: '#101820', b: '#1d2b3a', fg: '#e6f0fa', accent: '#66d9a8', pattern: 'grid' },
    bullets: [
      '代码生视频擅长的：排版精确、文案随时改、图表/信息图动起来、多语言版本、可复现可版本管理',
      'AI 生成擅长的：真人/角色一致性、真实材质与光影、手部与表情、镜头语言（推拉摇移）',
      '混着来的常见做法：AI 出关键画面当素材，代码负责排字、转场、字幕与节奏',
      '判断一句话：这次错一个字会不会毁掉整条？会 → 写代码；不会、但要「像真的」→ 去生成',
    ],
    howto: '接到片子先问这三句：素材是不是真拍的/要生成？字与版式重要不重要？要不要多版本？然后决定写代码还是去生成。',
    origin: 'mine',
  },
]


/**
 * 远程样张的本地副本（下载自 coverUrl）。面板优先用本地图：
 * 工作台不该因为没网就白屏，也不该每次打开都去抓 GitHub。
 */
/**
 * 原生材料：每条指向**原始文档/样张/代码**，不是我的转述。
 * 面板里列出来、复制引用时也带上——AI 要读就去读原文。
 */
const HD_REPO = 'https://github.com/alchaincyf/huashu-design'
const HD_STYLES = HD_REPO + '/blob/master/references/design-styles.md'
const HD_SPEC = 'https://raw.githubusercontent.com/alchaincyf/huashu-design/master/assets/style-specimens'
const OM_REPO = 'https://github.com/nexu-io/openmotion'

const SOURCES = {
  'app-huasu-paradigms': [{ label: 'huashu · App 原型手册', url: HD_REPO + '/blob/master/references/app-prototype.md' }, { label: 'App 界面范式', url: HD_REPO + '/blob/master/references/app-paradigms.md' }],
  'app-huasu-app-zone': [{ label: '风格库总表（App 分区 12 条）', url: HD_STYLES }, { label: 'App 样张目录', url: HD_REPO + '/tree/master/assets/style-specimens/app' }],
  'app-huasu-hardware-panel': [{ label: '样张（jpg）', url: HD_SPEC + '/app/01-hardware-panel.jpg' }, { label: '样张源码（html）', url: HD_SPEC + '/app/01-hardware-panel.html' }, { label: '风格库总表', url: HD_STYLES }],
  'app-huasu-liquid-glass': [{ label: '样张（jpg）', url: HD_SPEC + '/app/02-liquid-glass.jpg' }, { label: '样张源码（html）', url: HD_SPEC + '/app/02-liquid-glass.html' }, { label: '风格库总表', url: HD_STYLES }],
  'app-huasu-friendly-fintech': [{ label: '样张（jpg）', url: HD_SPEC + '/app/04-friendly-fintech.jpg' }, { label: '风格库总表', url: HD_STYLES }],
  'app-huasu-native-polish': [{ label: '样张（jpg）', url: HD_SPEC + '/app/10-native-polish.jpg' }, { label: '风格库总表', url: HD_STYLES }],
  'fe-huasu-web-zone': [{ label: '风格库总表（网页分区 20 条）', url: HD_STYLES }, { label: '网页样张目录', url: HD_REPO + '/tree/master/assets/style-specimens/web' }],
  'fe-huasu-ppt-zone': [{ label: '风格库总表（PPT 分区 20 条）', url: HD_STYLES }, { label: 'PPT 样张目录', url: HD_REPO + '/tree/master/assets/style-specimens/ppt' }],
  'fe-huasu-info-zone': [{ label: '风格库总表（信息图 20 条）', url: HD_STYLES }, { label: '信息图样张目录', url: HD_REPO + '/tree/master/assets/style-specimens/info' }],
  'fe-huasu-east-zone': [{ label: '风格库总表（中文与东亚 12 条）', url: HD_STYLES }, { label: '东亚样张目录', url: HD_REPO + '/tree/master/assets/style-specimens/east' }],
  'fe-huasu-xhs-zone': [{ label: '风格库总表（小红书 8 条）', url: HD_STYLES }, { label: '小红书样张目录', url: HD_REPO + '/tree/master/assets/style-specimens/xhs' }],
  'fe-huasu-editorial-brutalism': [{ label: '样张（jpg）', url: HD_SPEC + '/web/01-editorial-brutalism.jpg' }, { label: '样张源码（html）', url: HD_SPEC + '/web/01-editorial-brutalism.html' }, { label: '风格库总表', url: HD_STYLES }],
  'fe-huasu-neo-brutalism': [{ label: '样张（jpg）', url: HD_SPEC + '/web/02-neo-brutalism.jpg' }, { label: '风格库总表', url: HD_STYLES }],
  'fe-huasu-warm-editorial': [{ label: '样张（jpg）', url: HD_SPEC + '/web/12-warm-editorial.jpg' }, { label: '风格库总表', url: HD_STYLES }],
  'fe-huasu-linear-bento': [{ label: '样张（jpg）', url: HD_SPEC + '/web/13-glassmorphism-bento.jpg' }, { label: '风格库总表', url: HD_STYLES }],
  'fe-huasu-swiss-mono': [{ label: '样张（jpg）', url: HD_SPEC + '/web/19-swiss-monochrome.jpg' }, { label: '风格库总表', url: HD_STYLES }],
  'fe-huasu-song-block': [{ label: '样张（jpg）', url: HD_SPEC + '/east/02-song-block-print.jpg' }, { label: '风格库总表', url: HD_STYLES }],
  'fe-huasu-tanaka': [{ label: '样张（jpg）', url: HD_SPEC + '/east/09-tanaka-geometric-poster.jpg' }, { label: '风格库总表', url: HD_STYLES }],
  'fe-huasu-hk-signs': [{ label: '样张（jpg）', url: HD_SPEC + '/east/06-hk-street-signs.jpg' }, { label: '风格库总表', url: HD_STYLES }],
  'cv-openmotion': [{ label: 'OpenMotion README', url: OM_REPO + '/blob/main/README.md' }, { label: 'Motion.md 规范', url: OM_REPO + '/blob/main/docs/motion-md.md' }],
  'cv-recreate': [{ label: '参考片重构 SKILL', url: OM_REPO + '/blob/main/skills/openmotion-recreate/SKILL.md' }],
  'cv-templates': [{ label: '模板站', url: 'https://open-design.ai/templates/' }, { label: 'Motion.md 规范', url: OM_REPO + '/blob/main/docs/motion-md.md' }],
  'cv-stack': [{ label: '渲染/导出校验脚本', url: OM_REPO + '/blob/main/scripts/verify-export.ts' }, { label: 'README（架构）', url: OM_REPO + '/blob/main/README.md' }],
  'app-mapmate': [{ label: 'README（含截图）', path: 'D:/Android/MapMate/MapMate/README.md' }, { label: '主界面截图', path: 'D:/Android/MapMate/MapMate/docs/screenshot-main.png' }],
  'app-videoquiz': [{ label: '工程目录', path: 'D:/Android/MapMate/VideoQuiz' }],
  'app-huajing': [{ label: 'README', path: 'D:/github_project/ZhaoWen_GitHub维护/HuaJing/pet-app/README.md' }, { label: '角色帧', path: 'D:/github_project/ZhaoWen_GitHub维护/HuaJing/pet-app/assets/happy.png' }],
  'app-ember': [{ label: 'README', path: 'D:/github_project/ZhaoWen_GitHub维护/Ember/README.md' }],
  'app-aurowendao': [{ label: '设计文档', path: 'D:/github_project/ZhaoWen_GitHub维护/AuroWendao/aurowendao-design.md' }],
  'app-desktopjelly': [{ label: 'README', path: 'D:/github_project/ZhaoWen_GitHub维护/DesktopJelly/README.md' }],
  'fe-kaguya-theme': [{ label: '主题 client.js（token 表）', path: 'D:/github_project/ZhaoWen_GitHub维护/zhaowen-dsh/packages/dsh-theme-kaguya-hime/client.js' }],
  'fe-whalegirl': [{ label: '主题包目录', path: 'D:/github_project/ZhaoWen_GitHub维护/dsh/home/profiles/web/node_modules/dsh-theme-whalegirl' }],
  'fe-wesight-qa': [{ label: '主题与皮肤 QA', path: 'D:/github_project/ZhaoWen_GitHub维护/wesight/design-qa.md' }, { label: 'dmg 设计 QA', path: 'D:/github_project/ZhaoWen_GitHub维护/wesight/dmg-design-qa.md' }],
  'vid-bv-ref': [{ label: '参考原片', path: 'D:/github_project/ZhaoWen_GitHub维护/_videos/BV1KHaG6bEb9.mp4' }, { label: '复刻素材（角色参考/首帧）', path: 'D:/github_project/ZhaoWen_GitHub维护/_tools/doubao-video' }],
  'vid-rea-video': [{ label: 'rea-video 仓库', path: 'D:/github_project/ZhaoWen_GitHub维护/rea-video' }, { label: '判定标准（skill）', path: 'D:/github_project/ZhaoWen_GitHub维护/rea-video/SKILL.md' }],
  'vid-carl-flat': [{ label: '场景源码（scene.py / engine.json）', path: 'D:/github_project/ZhaoWen_GitHub维护/agent-skills/carl-motion/scenes/flat-vector' }],
  'vid-carl-ink': [{ label: '场景源码', path: 'D:/github_project/ZhaoWen_GitHub维护/agent-skills/carl-motion/scenes/chinese-ink-wash' }],
  'vid-carl-clay': [{ label: '场景源码', path: 'D:/github_project/ZhaoWen_GitHub维护/agent-skills/carl-motion/scenes/claymation' }],
  'vid-carl-blueprint': [{ label: '场景源码', path: 'D:/github_project/ZhaoWen_GitHub维护/agent-skills/carl-motion/scenes/blueprint' }],
  'vid-carl-exploded': [{ label: '场景源码', path: 'D:/github_project/ZhaoWen_GitHub维护/agent-skills/carl-motion/scenes/exploded-view' }],
  'vid-carl-brick': [{ label: '场景源码', path: 'D:/github_project/ZhaoWen_GitHub维护/agent-skills/carl-motion/scenes/brick-toy' }],
  'vid-carl-glass': [{ label: '场景源码（index.html）', path: 'D:/github_project/ZhaoWen_GitHub维护/agent-skills/carl-motion/scenes/glassmorphism-ui/index.html' }],
  'vid-carl-huashu': [{ label: '场景源码', path: 'D:/github_project/ZhaoWen_GitHub维护/agent-skills/carl-motion/scenes/huashu-portraits' }],
}


const LOCAL_COVERS = {
  'app-huasu-app-zone': 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/app-huasu-app-zone.jpg',
  'app-huasu-hardware-panel': 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/app-huasu-hardware-panel.jpg',
  'app-huasu-liquid-glass': 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/app-huasu-liquid-glass.jpg',
  'app-huasu-friendly-fintech': 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/app-huasu-friendly-fintech.jpg',
  'app-huasu-native-polish': 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/app-huasu-native-polish.jpg',
  'fe-huasu-web-zone': 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-huasu-web-zone.jpg',
  'fe-huasu-ppt-zone': 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-huasu-ppt-zone.jpg',
  'fe-huasu-info-zone': 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-huasu-info-zone.jpg',
  'fe-huasu-east-zone': 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-huasu-east-zone.jpg',
  'fe-huasu-xhs-zone': 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-huasu-xhs-zone.jpg',
  'fe-huasu-editorial-brutalism': 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-huasu-editorial-brutalism.jpg',
  'fe-huasu-neo-brutalism': 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-huasu-neo-brutalism.jpg',
  'fe-huasu-warm-editorial': 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-huasu-warm-editorial.jpg',
  'fe-huasu-linear-bento': 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-huasu-linear-bento.jpg',
  'fe-huasu-swiss-mono': 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-huasu-swiss-mono.jpg',
  'fe-huasu-song-block': 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-huasu-song-block.jpg',
  'fe-huasu-tanaka': 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-huasu-tanaka.jpg',
  'fe-huasu-hk-signs': 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-huasu-hk-signs.jpg',
  'cv-openmotion': 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/cv-openmotion.jpg',
  'cv-templates': 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/cv-templates.jpg',
}


/**
 * 「代码生视频」这一层的**风格**分支。
 * OpenMotion 那几条讲的是工程与方法；这里补的是「用代码能做出哪几种视觉风格」——
 * 每条都是纯 HTML/CSS/JS（或 SVG/Canvas）能落地的，不依赖生成模型。
 */
const CODEVIDEO_STYLES = [
  {
    id: 'cv-style-kinetic-type',
    layer: 'codevideo',
    name: '动力排版（kinetic typography）',
    oneLine: '大字在时间轴上撞、擦、逐字弹出，靠字号与节奏说话，几乎没有画面素材',
    source: '代码生视频通用手法（OpenMotion 模板里大量使用）',
    tags: ['风格', '排版驱动', '零素材'],
    kind: 'demo',
    swatch: { a: '#111111', b: '#242424', fg: '#ffffff', accent: '#ff4d4d', pattern: 'stripes' },
    bullets: ['一句一个镜头，字比画面重要：字重 800+、字号占屏 60% 以上', '每个 cut 都给一个字级动效（scale / clip-path / 逐字 stagger），别用淡入', '配一两个撞色块做「节拍标记」'],
    howto: '做观点片/金句片/产品卖点片时首选；没有素材也能出片。',
    origin: 'mine',
  },
  {
    id: 'cv-style-dataviz',
    layer: 'codevideo',
    name: '数据动起来（dataviz motion）',
    oneLine: '柱状/折线/地图随时间生长，数字滚动到位，标注卡跟着数据出现',
    source: '代码生视频通用手法（SVG + 时间轴）',
    tags: ['风格', '数据', '信息图'],
    kind: 'demo',
    swatch: { a: '#0f172a', b: '#1e293b', fg: '#e2e8f0', accent: '#38bdf8', pattern: 'grid' },
    bullets: ['先定格最终画面，再反推每个元素的入场顺序', '数字用 tabular-nums，滚动到位时停 0.3s', '坐标轴与网格低对比，数据高对比'],
    howto: '年报/复盘/发布会数据页用这套；HTML 的 SVG 比 AE 改起来快。',
    origin: 'mine',
  },
  {
    id: 'cv-style-terminal',
    layer: 'codevideo',
    name: '终端与代码（terminal / IDE）',
    oneLine: '黑底等宽字逐行敲出，光标闪烁，diff 绿红块，窗口边框带红黄绿点',
    source: '代码生视频通用手法（开发者向片头/演示）',
    tags: ['风格', '等宽', '开发者'],
    kind: 'demo',
    swatch: { a: '#0b0f14', b: '#121a22', fg: '#c9d4e3', accent: '#22c55e', pattern: 'grid' },
    bullets: ['打字机效果按字符 stagger，速率不均匀才像人', '只高亮关键 token，别整行染色', '窗口 chrome 用 3 个 8px 圆点'],
    howto: '讲工具/CLI/开源项目的片子用；观众一眼知道「这是给工程师的」。',
    origin: 'mine',
  },
  {
    id: 'cv-style-whiteboard',
    layer: 'codevideo',
    name: '白板手绘（whiteboard sketch）',
    oneLine: '线条像被手画出来，箭头随手标注，元素带轻微抖动',
    source: '代码生视频通用手法（rough.js / SVG stroke-dashoffset）',
    tags: ['风格', '解释性', '手绘'],
    kind: 'demo',
    swatch: { a: '#f7f5f0', b: '#ece7dc', fg: '#2b2b2b', accent: '#d97706', pattern: 'blot' },
    bullets: ['stroke-dasharray + dashoffset 做「被画出来」，线宽 2.5px', '线条端点用 round cap，路径加 1–2px 抖动', '同一画面最多 4 个元素，讲完一个擦一个'],
    howto: '讲原理/流程/架构时用；比 PPT 有生气，比 3D 便宜。',
    origin: 'mine',
  },
  {
    id: 'cv-style-product-ui',
    layer: 'codevideo',
    name: '产品 UI 演示（product walkthrough）',
    oneLine: '真界面在设备框里滚动、点按出光标、状态切换，镜头沿界面推近',
    source: '代码生视频通用手法（HTML 重绘或真实截图 + 变换）',
    tags: ['风格', '产品', '演示'],
    kind: 'demo',
    swatch: { a: '#1b1f2a', b: '#2a3242', fg: '#eef2f8', accent: '#6ea8fe', pattern: 'dots' },
    bullets: ['界面要重绘成 HTML，才能精确控制滚动与点击', '光标移动带缓动与回弹，点击时给一次 scale', '镜头推近用 transform: scale + transform-origin，别换分辨率'],
    howto: '产品发布/功能介绍片；比录屏稳，改文案不用重录。',
    origin: 'mine',
  },
  {
    id: 'cv-style-parallax-cards',
    layer: 'codevideo',
    name: '视差卡片与深度（parallax depth）',
    oneLine: '多层元素以不同速度移动/缩放，做出「空间在动」的错觉，不需要 3D',
    source: '代码生视频通用手法（CSS transform + perspective）',
    tags: ['风格', '空间感', '零素材'],
    kind: 'demo',
    swatch: { a: '#171327', b: '#2b2148', fg: '#f0eaff', accent: '#a78bfa', pattern: 'rays' },
    bullets: ['3–4 层足够：底层 bg、中景卡、前景标签、浮尘', '速度比 1 : 0.6 : 1.4 这样错开，不要等速', '加一点 blur 做景深，前景最清晰'],
    howto: '产品 hero/开场/转场用；纯 CSS 就能做出「像 3D」的效果。',
    origin: 'mine',
  },
  {
    id: 'cv-style-logo-reveal',
    layer: 'codevideo',
    name: '品牌片头（logo reveal）',
    oneLine: '遮罩擦开、笔画描绘、粒子聚拢，最后字标落位 + 一次光扫',
    source: '代码生视频通用手法（SVG mask / clip-path / canvas）',
    tags: ['风格', '片头', '品牌'],
    kind: 'demo',
    swatch: { a: '#0d0d0f', b: '#1c1c22', fg: '#f5f5f5', accent: '#d4af37', pattern: 'rays' },
    bullets: ['2.5–4 秒就够，超过 4 秒观众开始等', '结尾定格留 0.5s，别切太快', '光扫只做一次，宁少不多'],
    howto: '每条片子的头/尾；同一套动效复用到所有片子，形成识别度。',
    origin: 'mine',
  },
  {
    id: 'cv-style-sprite-2d',
    layer: 'codevideo',
    name: '2D 角色与逐帧（sprite / frame-by-frame）',
    oneLine: '序列帧或骨骼动画的角色在场景里走位，配对话气泡与拟声字',
    source: '代码生视频通用手法（sprite sheet / Canvas / Spine）',
    tags: ['风格', '角色', '动画'],
    kind: 'demo',
    swatch: { a: '#f3e9d2', b: '#e2d3b3', fg: '#3a2f22', accent: '#e07a5f', pattern: 'dots' },
    bullets: ['帧率压到 12–15 才像手绘动画，60fps 反而假', '角色只做 3–5 个动作（idle / 走 / 说 / 惊讶 / 笑）', '气泡与拟声字单独一层，别和角色一起动'],
    howto: '做角色向短视频/讲解片；素材可以自己画序列帧，也可以用生成图切帧。',
    origin: 'mine',
  },
]


/**
 * 本机「拉来的别人的」仓（third-party / _pull_check / github-repositories），
 * 以及自己几个有设计含量的站。全部指本地文件，不依赖网络。
 */
const LOCAL_PULLED_FRONTEND = [
  {
    id: 'fe-hd-open-city',
    layer: 'frontend',
    name: '百年京张 · 城市设计征集站',
    oneLine: '铁路叙事 + 大图 + 时间轴的城市设计征集页：把「一条铁路的百年」讲成可滚动的版式',
    source: '/d/github_project/third-party/haidian（assets/open-city-film-poster.jpg 等）',
    tags: ['拉来的', '网页', '叙事长页'],
    kind: 'image',
    cover: 'D:/github_project/third-party/haidian/assets/open-city-film-poster.jpg',
    bullets: [
      '大图压满屏 + 细字标注，靠图像承担情绪、文字承担信息',
      '历史照片与现代渲染图交替，用色调区分「过去/方案」',
      '章节标题做在图片边缘，不居中、不加大字重',
    ],
    howto: '做城市/建筑/征集类长页时借它的「大图 + 边缘标题 + 时间轴」结构。',
    sources: [
      { label: '海报', path: 'D:/github_project/third-party/haidian/assets/open-city-film-poster.jpg' },
      { label: 'README', path: 'D:/github_project/third-party/haidian/README.md' },
      { label: '目录', path: 'D:/github_project/third-party/haidian' },
    ],
    origin: 'referenced',
  },
  {
    id: 'fe-archify',
    layer: 'frontend',
    name: 'Archify · 深色技术仪器风',
    oneLine: '近黑底 #020617 + 精确细线 + 高亮单色，像一台可交互的测量仪器',
    source: '/d/github_project/_pull_check/archify/DESIGN.md（带 colors 令牌清单）',
    tags: ['拉来的', '网页', '深色'],
    kind: 'image',
    cover: 'D:/github_project/_pull_check/archify/docs/article-cover.jpg',
    bullets: [
      'DESIGN.md 第一屏就是 colors 令牌表（canvas/surface/…），先定色再写组件',
      '线宽 1px、间距按 4 的倍数，视觉重量全靠「精确」',
      '交互态只提亮 8–12%，不做跳色',
    ],
    howto: '做开发者工具/架构图/数据面板时借它的深色令牌结构与克制交互。',
    sources: [
      { label: 'DESIGN.md（含令牌）', path: 'D:/github_project/_pull_check/archify/DESIGN.md' },
      { label: '封面图', path: 'D:/github_project/_pull_check/archify/docs/article-cover.jpg' },
    ],
    origin: 'referenced',
  },
  {
    id: 'fe-precision-data',
    layer: 'frontend',
    name: 'Precision Data · 把文档当空间来排',
    oneLine: '瑞士国际主义网格 + 实验室的温度：每个标题是地标、每张表是网格画',
    source: '/d/github_project/ZhaoWen_GitHub维护/github-repositories/PM25-Fusion-AutoResearch/design-philosophy.md',
    tags: ['拉来的', '排版哲学', '技术文档'],
    kind: 'text',
    swatch: { a: '#f4f1ea', b: '#e4dfd2', fg: '#1b1b1b', accent: '#0f766e', pattern: 'grid' },
    bullets: [
      '把「技术文档」当空间构图：层级即导航，留白即段落',
      '表格用网格画的方式排，不做斑马纹',
      '克制的暖中性色，避免纯白纯黑的「屏幕感」',
    ],
    howto: '写技术文档/白皮书/说明页时，按它的三条原则排：网格、层级、留白。',
    sources: [{ label: 'design-philosophy.md', path: 'D:/github_project/ZhaoWen_GitHub维护/github-repositories/PM25-Fusion-AutoResearch/design-philosophy.md' }],
    origin: 'referenced',
  },
  {
    id: 'fe-nature-figure',
    layer: 'frontend',
    name: 'Nature 论文图表设计理论',
    oneLine: '从 figures4papers 反推：一张能进 Nature 的图，信息密度与留白怎么平衡',
    source: '/d/github_project/ZhaoWen_GitHub维护/zhaowen-skill/nature-figure/references/design-theory.md',
    tags: ['拉来的', '图表', '学术'],
    kind: 'text',
    swatch: { a: '#f8f8f6', b: '#ecebe6', fg: '#222222', accent: '#b91c1c', pattern: 'dots' },
    bullets: [
      '一张图只讲一个结论；子图是论据不是装饰',
      '字号按最终印刷尺寸定（≥7pt），别按屏幕放大再缩',
      '配色优先「同色系深浅」，红绿只留给关键对比',
    ],
    howto: '做科研配图/数据图时先读这条，再动手改 matplotlib 样式。',
    sources: [{ label: 'design-theory.md', path: 'D:/github_project/ZhaoWen_GitHub维护/zhaowen-skill/nature-figure/references/design-theory.md' }],
    origin: 'referenced',
  },
  {
    id: 'fe-academic-plotting',
    layer: 'frontend',
    name: 'ML 会议论文图表规范',
    oneLine: 'NeurIPS/ICML/CVPR 的图表样式差异：字号、线宽、色板、图例位置',
    source: '/d/github_project/ZhaoWen_GitHub维护/zhaowen-skill/academic-plotting/references/style-guide.md',
    tags: ['拉来的', '图表', '规范'],
    kind: 'text',
    swatch: { a: '#eef2f7', b: '#dfe6ef', fg: '#1f2937', accent: '#2563eb', pattern: 'stripes' },
    bullets: ['统一字号与线宽（各会议模板不同，按目标会议选）', '色板要过灰度可辨：彩印/黑白都要能读', '图例放图内空白，不放图外挤压正文'],
    howto: '投论文前照它过一遍图：字号、线宽、色板、图例四项。',
    sources: [{ label: 'style-guide.md', path: 'D:/github_project/ZhaoWen_GitHub维护/zhaowen-skill/academic-plotting/references/style-guide.md' }],
    origin: 'referenced',
  },
  {
    id: 'fe-real-api-pricing',
    layer: 'frontend',
    name: '真实模型价格对比站',
    oneLine: '一张表讲清几十家模型的单价与额度：可筛选、可对比、双语',
    source: '/d/github_project/third-party/real-api-pricing（web/design-qa.md 是它的设计走查）',
    tags: ['拉来的', '数据表', '对比'],
    kind: 'text',
    swatch: { a: '#ffffff', b: '#eef1f5', fg: '#111827', accent: '#0ea5e9', pattern: 'grid' },
    bullets: ['表格是主角：列少、行密、数字右对齐+等宽', '筛选器贴表头，不另开面板', '双语切换只换文案，不动版式'],
    howto: '做对比/选型类页面时借它的「表格即产品」思路。',
    sources: [
      { label: 'design-qa.md', path: 'D:/github_project/third-party/real-api-pricing/web/design-qa.md' },
      { label: '仓库', path: 'D:/github_project/third-party/real-api-pricing' },
    ],
    origin: 'referenced',
  },
  {
    id: 'fe-personal-page',
    layer: 'frontend',
    name: '我的个人主页',
    oneLine: '把构成主义/波普的参考图直接放进站里：作品即装饰',
    source: '/d/github_project/personal-page/site（assets/art-*.jpg 是选取的参考画作）',
    tags: ['自制', '个人站', '拼贴'],
    kind: 'image',
    cover: 'D:/github_project/personal-page/site/assets/art-rodchenko.jpg',
    bullets: ['每个板块配一张参考画作，用作品本身当视觉锚点', '文字极少，靠作品与留白说话'],
    howto: '做作品集/个人站时借它「作品即装饰、文字退后」的做法。',
    sources: [
      { label: '站点目录', path: 'D:/github_project/personal-page/site' },
      { label: '参考画作示例', path: 'D:/github_project/personal-page/site/assets/art-rodchenko.jpg' },
    ],
    origin: 'mine',
  },
  {
    id: 'fe-sand3d-tokens',
    layer: 'frontend',
    name: 'sand3d · 把数据家族做成展示条',
    oneLine: '用 families 结构把「谁写的、多少条、中位数」排成一条条可扫的家族带',
    source: '/d/github_project/ZhaoWen_GitHub维护/_tools/sand3d/site/assets/tokens.json（数据形状）',
    tags: ['自制', '数据展示', '信息设计'],
    kind: 'text',
    swatch: { a: '#141b22', b: '#22303c', fg: '#e6eef5', accent: '#f2b84b', pattern: 'dots' },
    bullets: ['一条 = 一个家族：key/label 左对齐、n 与 median 右对齐', 'note 用一句话说结论，不做解释型长句', '颜色只区分家族，不表达大小'],
    howto: '把一堆同类数据（模型/工具/样本）排成可扫的家族带时借这个形状。',
    sources: [{ label: 'tokens.json（数据结构）', path: 'D:/github_project/ZhaoWen_GitHub维护/_tools/sand3d/site/assets/tokens.json' }],
    origin: 'mine',
  },
]

const LOCAL_PULLED_APP = [
  {
    id: 'app-jev-jarvis',
    layer: 'app',
    name: 'Jev 聊天助手（桌面浮层）',
    oneLine: '全局快捷键唤起的透明浮层：一问一答，不抢焦点、不挡内容',
    source: '/d/github_project/third-party/jev-chat-jarvis（docs/images/overlay.png、settings.png）',
    tags: ['拉来的', '桌面', '浮层'],
    kind: 'image',
    cover: 'D:/github_project/third-party/jev-chat-jarvis/docs/images/overlay.png',
    bullets: ['浮层是「毛玻璃 + 单输入框」，默认只占屏幕一角', '设置页与主界面共用一套卡片间距', '键盘优先：Esc 收起、Enter 发送'],
    howto: '做桌面快捷浮层（翻译/问答/取词）时借它的「最小打扰」布局。',
    sources: [
      { label: '浮层截图', path: 'D:/github_project/third-party/jev-chat-jarvis/docs/images/overlay.png' },
      { label: '设置页截图', path: 'D:/github_project/third-party/jev-chat-jarvis/docs/images/settings.png' },
      { label: 'README', path: 'D:/github_project/third-party/jev-chat-jarvis/README.md' },
    ],
    origin: 'referenced',
  },
  {
    id: 'app-pinky-design',
    layer: 'app',
    name: 'Pinky · 产品与技术设计文档',
    oneLine: '「让人看着 agent 操作手机」这件事怎么被设计出来：权限、审批、接管、留痕',
    source: '/d/github_project/ZhaoWen_GitHub维护/_tools/pinky/docs/DESIGN.md（DIYgod，2026-11 草稿）',
    tags: ['拉来的', '产品设计', 'Agent'],
    kind: 'text',
    swatch: { a: '#1b1b2f', b: '#2b2b47', fg: '#eaeaf5', accent: '#f472b6', pattern: 'rays' },
    bullets: ['把「人机共驾」拆成四个状态：观察 / 审批 / 接管 / 结束', '每个危险动作都要有可见的等待与拒绝路径', '界面语言不用「AI 在帮你」，用「它现在要做什么」'],
    howto: '设计「Agent 操作真实设备」类产品时，先读它怎么处理审批与接管。',
    sources: [{ label: 'DESIGN.md', path: 'D:/github_project/ZhaoWen_GitHub维护/_tools/pinky/docs/DESIGN.md' }],
    origin: 'referenced',
  },
  {
    id: 'app-she-love-me',
    layer: 'app',
    name: '她不一样 · Skill 展示页',
    oneLine: '把「一个 Skill 能干什么」讲成三张预览图：图表 / 成分表 / 对话',
    source: '/d/github_project/third-party/she-love-me（assets/preview-*.png、banner.svg）',
    tags: ['拉来的', 'Skill', '展示页'],
    kind: 'image',
    cover: 'D:/github_project/third-party/she-love-me/assets/preview-charts.png',
    bullets: ['每种能力配一张「真的输出」截图，不画示意图', 'banner 用 SVG 保证任何分辨率都锐利', '正文短句 + 图，读起来像产品说明而不是 README'],
    howto: '给自己的 skill/插件做介绍页时，用「真实输出截图 + 短句」的组合。',
    sources: [
      { label: '预览图', path: 'D:/github_project/third-party/she-love-me/assets/preview-charts.png' },
      { label: 'README', path: 'D:/github_project/third-party/she-love-me/README.md' },
    ],
    origin: 'referenced',
  },
]

const LOCAL_PULLED_VIDEO = [
  {
    id: 'vid-open-city-film',
    layer: 'video',
    name: '城市设计征集片 · 影像海报',
    oneLine: '一张海报就是一条片子的分镜总纲：铁路、山、机车、方案效果图各占一格',
    source: '/d/github_project/third-party/haidian/assets/open-city-film-poster.jpg',
    tags: ['参考片', '海报', '叙事'],
    kind: 'image',
    cover: 'D:/github_project/third-party/haidian/assets/open-city-film-poster.jpg',
    bullets: ['海报用「历史—现在—方案」三段并置，等于给片子定了三幕', '每格只放一个主体，靠色调区分年代', '标题压在图上而不是图下'],
    howto: '要做城市/品牌叙事片时，先照这个思路画一张「三幕海报」，再按它排分镜。',
    sources: [{ label: '海报', path: 'D:/github_project/third-party/haidian/assets/open-city-film-poster.jpg' }],
    origin: 'referenced',
  },
]


/**
 * 代码生视频：第三方的「引擎」级条目。
 * 用户提到「还有一个专门的关于代码生视频的远程库」——扫本机 git remote + 知识库笔记后确认是
 * HeyGen 的 HyperFrames（wiki 里有 [[Hyperframes]] 笔记，OpenMotion 的渲染引擎也是它那一路）。
 * 顺带把两条同赛道的引擎也收进来做对照：Remotion（React）与 Manim（Python 数学动画）。
 */
const CODEVIDEO_ENGINES = [
  {
    id: 'cv-hyperframes',
    layer: 'codevideo',
    name: 'HyperFrames（HeyGen）· 写 HTML 出 MP4',
    oneLine: 'HTML 里用 data 属性标时间轴与轨道，无头 Chrome 抓帧、FFmpeg 封装，Apache-2.0，专为 agent 设计',
    source: 'https://github.com/heygen-com/hyperframes（Apache-2.0；npm 包 hyperframes；文档 hyperframes.heygen.com）',
    tags: ['引擎', 'HTML 即视频', '开源', 'agent'],
    kind: 'text',
    swatch: { a: '#0b1020', b: '#16233d', fg: '#e6efff', accent: '#5eead4', pattern: 'grid' },
    bullets: [
      '组合脚本就是普通 HTML/CSS/JS：不需要构建步骤，index.html 直接能播',
      '时间轴靠 data 属性（进入点/时长/轨道），动画用 GSAP，做出来是确定性的（同输入同输出）',
      '自带 agent skills：npx skills add heygen-com/hyperframes，Claude Code 里能用 /hyperframes 命令',
      '与 Remotion 的差别：HTML 原生 vs React 组件；Apache-2.0 vs 商业授权；无 build vs 要打包',
    ],
    howto: '要做「代码写视频」的产品片/解释片时，先用它跑通最小闭环：一个 index.html + 时间轴属性 + 本地渲染 MP4。',
    sources: [
      { label: '仓库', url: 'https://github.com/heygen-com/hyperframes' },
      { label: '文档（llms.txt 入口）', url: 'https://hyperframes.heygen.com/llms.txt' },
      { label: '本机笔记', path: 'D:/github_project/ZhaoWen_GitHub维护/weflow-cli/output/_wiki-backup-20261109-202714/Hyperframes.md' },
    ],
    origin: 'referenced',
  },
  {
    id: 'cv-remotion',
    layer: 'codevideo',
    name: 'Remotion · 用 React 写视频',
    oneLine: '组件即帧：<Sequence> 排时间、useCurrentFrame 驱动动画，生态与模板最多',
    source: 'https://github.com/remotion-dev/remotion（注意：商业授权有规模门槛，不是 OSI 开源）',
    tags: ['引擎', 'React', '生态'],
    kind: 'text',
    swatch: { a: '#0f0f14', b: '#1e1b2e', fg: '#f2f2f7', accent: '#8b5cf6', pattern: 'dots' },
    bullets: [
      '一切都是 React 组件，能复用前端生态（图表、字体、动画库）',
      '需要打包（webpack/vite）才能渲染；渲染器为无头 Chrome',
      '授权：公司规模超阈值要付费——自用没问题，商用前先看许可',
    ],
    howto: '团队已经在写 React、又要长期维护视频工程时选它；纯 HTML 场景 HyperFrames 更轻。',
    sources: [{ label: '仓库', url: 'https://github.com/remotion-dev/remotion' }, { label: '许可说明', url: 'https://www.remotion.dev/license' }],
    origin: 'referenced',
  },
  {
    id: 'cv-manim',
    layer: 'codevideo',
    name: 'Manim · 用 Python 画数学动画',
    oneLine: '公式、坐标系、几何变换的动画引擎（3Blue1Brown 那套），解释硬概念最快',
    source: 'https://github.com/ManimCommunity/manim（社区版，MIT）',
    tags: ['引擎', '数学', '解释性'],
    kind: 'text',
    swatch: { a: '#0a0f1a', b: '#132238', fg: '#dbeafe', accent: '#fbbf24', pattern: 'stripes' },
    bullets: [
      'Scene + 动画对象（MathTex/Axes/Graph），天生为「讲清楚」服务',
      '公式用 LaTeX 直接写，不用截图贴图',
      '渲染慢、样式老派——适合概念演示，不适合品牌片',
    ],
    howto: '要讲算法/数学/物理时用它；品牌向的片子别用，画面语言不对路。',
    sources: [{ label: '仓库', url: 'https://github.com/ManimCommunity/manim' }, { label: '本机笔记', path: 'D:/github_project/ZhaoWen_GitHub维护/weflow-cli/output/_wiki-backup-20261109-202714/Manim.md' }],
    origin: 'referenced',
  },
  {
    id: 'vid-minimax-mcp',
    layer: 'video',
    name: 'minimax-video-mcp · AI 生视频链路（本机）',
    oneLine: '把 MiniMax H3 的文生视频/图生视频封成 MCP：提交任务、轮询、拿下载链接',
    source: 'D:/github_project/ZhaoWen_GitHub维护/_audit/minimax-video-mcp（我写的 MCP server）',
    tags: ['AI 生视频', 'MCP', '本机'],
    kind: 'text',
    swatch: { a: '#1a1024', b: '#2d1b3f', fg: '#f3e8ff', accent: '#c084fc', pattern: 'blot' },
    bullets: [
      '三个工具覆盖异步全流程：submit_video / query_video / 下载',
      '与「代码生视频」正好互补：这条是生成素材，那条是排版与时间轴',
      '短视频里常见组合：AI 出 2–3 个关键画面，代码负责排字、转场、字幕',
    ],
    howto: '要「真实质感」的画面时用它生成，再用代码生视频那层把整条片子排出来。',
    sources: [{ label: 'README', path: 'D:/github_project/ZhaoWen_GitHub维护/_audit/minimax-video-mcp/README.md' }],
    origin: 'mine',
  },
]


/**
 * 架构设计图：八种视觉语言。
 * 不是「工具清单」，是「图长什么样」——每条都配一段能动的 HTML/SVG（kind: demo），
 * 面板里直接看，挑中了再决定用哪个工具画（D2 / Excalidraw / Structurizr / diagrams）。
 */
const ARCH_ENTRIES = [
  {
    id: 'arch-whiteboard',
    layer: 'frontend',
    name: '手绘白板架构图（Excalidraw 风）',
    oneLine: '米白纸底 + 抖动手绘线条 + 手写体，一看就是「还在讨论」的草图',
    source: 'Excalidraw（MIT）· rough.js 抖动手法',
    tags: ['架构图', '风格', '手绘', '草稿'],
    kind: 'demo',
    bullets: [
      '线用 rough.js 抖 1–2.5px，字体走手写体，底色 #F7F5F0',
      '块内只写名词（用户/网关/服务/库），不写技术栈',
      '箭头手画感：末端画成两笔折线，不用标准箭头',
    ],
    howto: '方案预审、架构脑暴、给非技术同事讲结构时用；要正式交付就别用这套。',
    sources: [
      { label: 'Excalidraw', url: 'https://github.com/excalidraw/excalidraw' },
      { label: 'rough.js', url: 'https://roughjs.com/' },
    ],
    origin: 'referenced',
  },
  {
    id: 'arch-d2-light',
    layer: 'frontend',
    name: '现代 DSL 浅色（D2 默认）',
    oneLine: '白底圆角卡片 + 柔和投影 + 单色描边强调关键节点，最「技术文档」的一版',
    source: 'D2（Terrastruct，MPL-2.0）· 默认主题',
    tags: ['架构图', '风格', '浅色', 'DSL'],
    kind: 'demo',
    bullets: [
      '卡片圆角 6–8px、1px 描边走浅灰，关键节点换品牌色 1.6px',
      '布局交给引擎（ELK/Dagre），人不手动摆位置',
      '每张图只讲一层：Container 就别塞 Component 细节',
    ],
    howto: '写进 README/设计文档的正式架构图，首选用 D2 生成这套。',
    sources: [
      { label: 'D2 官网与主题', url: 'https://d2lang.com/' },
      { label: '仓库', url: 'https://github.com/terrastruct/d2' },
    ],
    origin: 'referenced',
  },
  {
    id: 'arch-d2-dark',
    layer: 'frontend',
    name: '深色终端架构图（D2 dark）',
    oneLine: '近黑底 + 霓虹描边 + 等宽标签，像从监控面板里截出来的',
    source: 'D2 深色主题（dark-mauve / terminal 系）',
    tags: ['架构图', '风格', '深色', '终端'],
    kind: 'demo',
    bullets: [
      '底 #14141F，卡片 #1E1E2E，描边用紫/青/绿区分角色',
      '标签等宽小写（client / gateway / orders）更像系统内部视角',
      '连线灰度压低，信息靠描边色，不靠箭头粗细',
    ],
    howto: '内部分享、事故复盘、技术博客配图；投屏到暗环境下特别清楚。',
    sources: [{ label: 'D2 主题文档', url: 'https://d2lang.com/tour/themes' }],
    origin: 'referenced',
  },
  {
    id: 'arch-c4',
    layer: 'frontend',
    name: 'C4 分层图（Structurizr 风）',
    oneLine: '深蓝系统块 + 人形 + 灰色外部系统，四级粒度（Context/Container/Component/Code）',
    source: 'C4 model（Simon Brown）· Structurizr / IcePanel 的官方配色',
    tags: ['架构图', '风格', 'C4', '分层'],
    kind: 'demo',
    bullets: [
      '人 #08427B、系统 #1168BD、容器 #438DD5、组件 #85BBF0、外部系统 #999999',
      '每张图左上角标粒度（Level 1/2/3），别混层',
      '箭头写动词（使用/调用/读取），不写「依赖」这种空话',
    ],
    howto: '需要给不同受众讲同一套系统（老板看 L1、开发看 L2/L3）时，用 C4 这套。',
    sources: [
      { label: 'C4 model', url: 'https://c4model.com/' },
      { label: 'Structurizr', url: 'https://structurizr.com/' },
    ],
    origin: 'referenced',
  },
  {
    id: 'arch-cloud',
    layer: 'frontend',
    name: '云资源图标图（AWS/GCP 风）',
    oneLine: '虚线 VPC 边界 + 官方图标方块 + 正交连线，一图说清部署拓扑',
    source: 'Python diagrams / Go-Diagrams（官方云图标集）',
    tags: ['架构图', '风格', '云', '部署'],
    kind: 'demo',
    bullets: [
      '先画边界（VPC/Region/Subnet），再往里放资源',
      '图标用官方 SVG，别自己画形状代替',
      '连线走正交折线，跨边界的线要标出协议或端口',
    ],
    howto: '画部署拓扑、给运维/客户讲环境时用；比手绘图更可信。',
    sources: [
      { label: 'diagrams（Python）', url: 'https://github.com/mingrammer/diagrams' },
      { label: 'AWS 架构图标', url: 'https://aws.amazon.com/architecture/icons/' },
    ],
    origin: 'referenced',
  },
  {
    id: 'arch-iso',
    layer: 'frontend',
    name: '等距立体架构图（isometric）',
    oneLine: '斜 45°/58° 投影的立体块，把「层」做成真的高度差，适合汇报与发布会',
    source: '等距插画风（Figma/Spline 常见做法）',
    tags: ['架构图', '风格', '立体', '汇报'],
    kind: 'demo',
    bullets: [
      '统一两个角度（rotateX 58° / rotateZ -45°），所有块共用同一套变换',
      '用高度表达层级：数据层在下、服务层居中、接入层在上',
      '配色只做「同一材质的深浅」，别每块一个色',
    ],
    howto: '对外汇报、发布会、投资人材料；内部评审别用，信息密度低。',
    sources: [{ label: 'Spline（等距 3D）', url: 'https://spline.design/' }],
    origin: 'referenced',
  },
  {
    id: 'arch-blueprint',
    layer: 'frontend',
    name: '工程蓝图（blueprint）',
    oneLine: '深蓝底 + 白色细线 + 网格 + 图号/比例标注，把架构当工程图来画',
    source: '蓝图制图语言（工程图纸转译）',
    tags: ['架构图', '风格', '蓝图', '怀旧'],
    kind: 'demo',
    bullets: [
      '底 #0B2545、线 #7FD1FF，线宽 1–1.1px，全部细线',
      '四角带图号/比例/修订号（DWG-01 · REV B）',
      '文字用等宽大写，字号极小，像图纸标注',
    ],
    howto: '给硬件/嵌入式/工业背景的受众，或想要「工程感」的封面页。',
    sources: [{ label: '参考：C4 与工程制图的结合', url: 'https://c4model.com/' }],
    origin: 'referenced',
  },
  {
    id: 'arch-mono',
    layer: 'frontend',
    name: '极简线框（无填充黑白）',
    oneLine: '只留方框、细线与名字，没有任何颜色与阴影——信息密度最高的一版',
    source: 'Mermaid 默认 / Tufte 式极简',
    tags: ['架构图', '风格', '极简', '黑白'],
    kind: 'demo',
    bullets: [
      '全部 1px 黑线、无填充、无圆角（圆角会让它显得随便）',
      '标签全大写、8–9px，放框内居中',
      '一张图里节点 ≤ 9 个，超了就拆图',
    ],
    howto: '文档里嵌的图、代码评审附图、打印用；花哨的场合别用。',
    sources: [
      { label: 'Mermaid', url: 'https://mermaid.js.org/' },
      { label: 'likec4（C4 as code）', url: 'https://likec4.dev/' },
    ],
    origin: 'referenced',
  },
]

export const LAYERS = [
  { id: 'app', name: 'App 设计', hint: '手机 / 桌面应用的界面与产品设计', entries: [...APP_ENTRIES, ...HUASHU_APP, ...LOCAL_PULLED_APP] },
  { id: 'frontend', name: '前端设计', hint: '网页、面板、主题皮肤、风格库', entries: [...styleEntries(), ...FRONTEND_EXTRA, ...HUASHU_FRONTEND, ...LOCAL_PULLED_FRONTEND, ...ARCH_ENTRIES] },
  { id: 'video', name: '视频风格', hint: '短片 / 动效 / 片头的视觉风格与复刻方法', entries: [...VIDEO_ENTRIES, ...LOCAL_PULLED_VIDEO, ...CODEVIDEO_ENGINES.filter((e) => e.layer === 'video')] },
  { id: 'codevideo', name: '代码生视频', hint: '用 HTML/CSS/JS 写视频：工作室 / 模板 / 渲染栈 + 八种可落地的视觉风格', entries: [...CODEVIDEO, ...CODEVIDEO_STYLES, ...CODEVIDEO_ENGINES.filter((e) => e.layer === 'codevideo')] },
]

export const ALL_ENTRIES = LAYERS.flatMap((l) => l.entries)

for (const e of ALL_ENTRIES) {
  if (LOCAL_COVERS[e.id] !== undefined) {
    e.cover = LOCAL_COVERS[e.id]
    e.coverUrl = e.coverUrl || ''
  }
}

for (const e of ALL_ENTRIES) {
  if (SOURCES[e.id] !== undefined) e.sources = SOURCES[e.id]
}

// 分区风格库：把 92 条内页成员挂到对应的大条目上
for (const e of ALL_ENTRIES) {
  if (Array.isArray(MEMBERS[e.id]) && MEMBERS[e.id].length > 0) e.members = MEMBERS[e.id]
}

export function findEntry(id) {
  return ALL_ENTRIES.find((e) => e.id === id) || null
}

export function layerOf(id) {
  return LAYERS.find((l) => l.entries.some((e) => e.id === id)) || null
}

/** 「引用给 AI」的正文。三类（tokens / image / text）措辞一致，都带出处与约束。 */
/** 索引式引用：只给「用哪一条」，细节让 AI 自己 design_style op=get。 */
export function refOf(entry) {
  const layer = layerOf(entry.id)
  return [
    `用设计工作台里的「${entry.name}」（${layer === null ? '' : layer.name} · ${entry.id}），按这个设计来。`,
    ...(Array.isArray(entry.sources) && entry.sources.length > 0
      ? [`原始材料：${entry.sources[0].url ?? entry.sources[0].path}`]
      : []),
    `要看完整规格：design_style op=get ${entry.id}`,
  ].join('\n')
}

/**
 * 内页里某一项的索引：和整体索引同一个模板，只是多一层「第 N 种」。
 *
 * 用设计工作台里的「<库名>」第 N 种「<风格名>」（<还原度>），按这个设计来。
 * 原始材料：<原图地址>
 * 要看完整规格：design_style op=get <库 id> member=N
 */
export function memberRef(entry, index) {
  const layer = layerOf(entry.id)
  const mem = Array.isArray(entry.members) ? entry.members[index] : null
  if (mem === null || mem === undefined) return refOf(entry)
  const tier = mem.tier ? `（${mem.tier}）` : ''
  return [
    `用设计工作台里的「${entry.name}」第 ${index + 1} 种「${mem.name}」${tier}，按这个设计来。`,
    `原始材料：${mem.raw || mem.cover || ''}`,
    `要看完整规格：design_style op=get ${entry.id} member=${index + 1}`,
  ]
    .filter((x) => x !== '')
    .join(String.fromCharCode(10))
}

/** 完整规格：工具的 get / current 返回它，AI 按需展开。 */
export function specOf(entry) {
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
  if (Array.isArray(entry.sources) && entry.sources.length > 0) {
    lines.push('', '原始材料：', ...entry.sources.map((x) => `  - ${x.label}：${x.url ?? x.path}`))
  }
  lines.push('', `怎么用：${entry.howto}`, '', ASK)
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
  e.origin = ORIGIN[e.id] ?? e.origin ?? 'mine'
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

for (const e of ALL_ENTRIES) {
  e.prompt = refOf(e) // 面板「复制 引用给 AI」用的就是它：一行索引
  e.spec = specOf(e) // 工具 get / current 展开的完整规格
}

/** 面板顶部的大层切换（三个），二级筛选按 tags。 */
export const TAGS = [...new Set(ALL_ENTRIES.flatMap((e) => e.tags ?? []))]
