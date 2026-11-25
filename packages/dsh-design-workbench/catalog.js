import { MEMBERS } from './collections.js'

/**
 * 设计资料库 —— 五层：App 设计 / 前端设计 / 视频风格 / 代码生视频 / 漫画。
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

/**
 * 「漫画」层引用的两套外部风格库装在哪。
 *
 * 它们不是本仓库的东西，是本地参考副本（约 740 MB），所以目录位置可以换：
 *   - 默认 D:/github_project/ZhaoWen_GitHub维护/code-to-film
 *   - 用环境变量 DESIGN_COMIC_SRC 指到别处即可（封面、本地副本链接、云端映射都跟着走）
 *   - 丢了就用 `node scripts/fetch-libs.mjs` 重新拉回来
 */
const COMIC_SRC = process.env.DESIGN_COMIC_SRC || 'D:/github_project/ZhaoWen_GitHub维护/code-to-film'
const LEMO = COMIC_SRC + '/lemo-opuscar/styles'
const MG15 = COMIC_SRC + '/mg-styles-15'

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
    id: 'vid-sweety-handdraw',
    name: '手绘口播（sweety-handdraw-video）',
    oneLine: '给一个主题或一篇文章，做成「边画边讲」的有声视频：先出线稿、按模块描线、马克笔上色、配音逐句对齐',
    source: 'https://github.com/threerocks/sweety-handdraw-video',
    tags: ['视频风格', '手绘', '口播', 'skill'],
    kind: 'image',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/vid-sweety-handdraw.jpg',
    bullets: [
      '先线稿后上色：笔先起形 → 按模块描线 → 橡皮擦掉起形 → 再由浅到深马克笔上色，墨线有压感',
      '旁白先行：先写完整口播稿 → 按段落生成配音 → 画面按**真实时间戳**对齐，不手写时间轴',
      '有门禁：按实际配音算时长预算，笔忙占比 ≤70%，单幅停留 ≥1 秒；出图前先过「可画性」检查',
      '默认竖屏 1280×1920 / 30fps；六款声音、六种手臂（含仅笔不露手），水印自动避开画面',
    ],
    howto: '做知识科普、故事讲述、文章转视频；它是 Skill 形态（不是库），需要 Claude Code / Codex 宿主，官方只承诺 macOS / Linux。',
    sources: [
      { label: '云端仓库', url: 'https://github.com/threerocks/sweety-handdraw-video' },
      { label: '本地副本', path: 'D:/github_project/ZhaoWen_GitHub维护/code-to-film/sweety-handdraw-video' },
      { label: '封面（README 样片）', path: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/vid-sweety-handdraw.jpg' },
    ],
    origin: 'referenced',
  },
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
    kind: 'demo',
    bullets: ['颜色 ≤ 5 个纯色，线条统一粗细', '镜头只做 pan/zoom，元素分批入场'],
    howto: '要做概念讲解/流程演示动画时用这套：纯色块 + 分批入场，别加投影和渐变。',
  },
  {
    id: 'vid-carl-ink',
    name: '中国水墨（chinese-ink-wash）',
    oneLine: '墨色浓淡 + 晕染扩散，转场用「一笔扫过」而不是切',
    source: 'D:/github_project/ZhaoWen_GitHub维护/agent-skills/carl-motion/scenes/chinese-ink-wash',
    tags: ['动效风格', '国风', '晕染'],
    kind: 'demo',
    bullets: ['只在黑白灰里做层次，最多一点赭石', '入场用墨迹扩散，出场用飞白'],
    howto: '做国风/文化类片头时用；别把水墨和发光特效混用。',
  },
  {
    id: 'vid-carl-clay',
    name: '黏土定格（claymation）',
    oneLine: '哑光材质 + 指纹瑕疵 + 12fps 顿挫，暖光从侧上方来',
    source: 'D:/github_project/ZhaoWen_GitHub维护/agent-skills/carl-motion/scenes/claymation',
    tags: ['动效风格', '定格', '材质'],
    kind: 'demo',
    bullets: ['帧率故意压到 12–15，抖动是特征不是缺陷', '材质要哑光，高光点很小'],
    howto: '做手作/童趣题材时用；真实感来自瑕疵，不要磨平。',
  },
  {
    id: 'vid-carl-blueprint',
    name: '技术蓝图（blueprint）',
    oneLine: '深蓝底 + 白色细线 + 网格与标注，像工程图在动',
    source: 'D:/github_project/ZhaoWen_GitHub维护/agent-skills/carl-motion/scenes/blueprint',
    tags: ['动效风格', '技术感', '线稿'],
    kind: 'demo',
    bullets: ['线宽 ≤ 2px，标注带引线', '动效是「逐段绘制」而不是整块淡入'],
    howto: '讲原理/结构时用：先画骨架再逐段描出来。',
  },
  {
    id: 'vid-carl-exploded',
    name: '爆炸视图（exploded-view）',
    oneLine: '部件沿轴分离再合拢，交代「里面有什么」',
    source: 'D:/github_project/ZhaoWen_GitHub维护/agent-skills/carl-motion/scenes/exploded-view',
    tags: ['动效风格', '产品演示', '结构'],
    kind: 'demo',
    bullets: ['分离距离按部件重要性分级，不要等距', '合拢前留 0.3s 静止让人看清'],
    howto: '做产品结构/拆解演示时用；分离和合拢各留一次静止。',
  },
  {
    id: 'vid-carl-brick',
    name: '积木玩具（brick-toy）',
    oneLine: '塑料反光 + 凸点细节 + 一块块拼起来，量大但节奏清楚',
    source: 'D:/github_project/ZhaoWen_GitHub维护/agent-skills/carl-motion/scenes/brick-toy',
    tags: ['动效风格', '玩具', '拼装'],
    kind: 'demo',
    bullets: ['拼装顺序要有逻辑（先底再上），不能随机落块', '每块落位给一个小回弹'],
    howto: '做「从零搭起来」的叙事时用；落块顺序要能讲通。',
  },
  {
    id: 'vid-carl-glass',
    name: '玻璃拟态 UI 动效（glassmorphism-ui）',
    oneLine: '毛玻璃卡片在渐变背景上漂浮，焦点靠模糊与高光转移',
    source: 'D:/github_project/ZhaoWen_GitHub维护/agent-skills/carl-motion/scenes/glassmorphism-ui',
    tags: ['动效风格', 'UI 演示', '玻璃'],
    kind: 'demo',
    bullets: ['背景必须有内容，否则模糊没意义', '同一屏最多两层玻璃，再多就糊'],
    howto: '做产品 UI 演示动效时用；背景要真有点东西在动。',
  },
  {
    id: 'vid-carl-huashu',
    name: '花叔风人像（huashu-portraits）',
    oneLine: '半调网点 + 双色套印的人像处理，静态图也能当封面',
    source: 'D:/github_project/ZhaoWen_GitHub维护/agent-skills/carl-motion/scenes/huashu-portraits',
    tags: ['动效风格', '人像', '印刷感'],
    kind: 'demo',
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
  // 漫画层：直接用风格库自带的样片海报
  'cm-cel-anime-80s': LEMO + '/cel-anime-80s/poster.jpg',
  'cm-ukiyoe': LEMO + '/ukiyoe/poster.jpg',
  'cm-rubber-hose': LEMO + '/rubber-hose/poster.jpg',
  'cm-midcentury-toon': LEMO + '/midcentury-toon/poster.jpg',
  'cm-scifi-toon': LEMO + '/scifi-toon/poster.jpg',
  'cm-halftone-dossier': LEMO + '/halftone-dossier/poster.jpg',
  'cm-pixel-rpg': LEMO + '/pixel-rpg/poster.jpg',
  'cm-hd-2d': LEMO + '/hd-2d/poster.jpg',
  'cm-cel-boil': MG15 + '/docs/readme/films/05-cel-boil.webp',
  'cm-pixel-art': MG15 + '/docs/readme/films/20-pixel.webp',
  'cm-crayon-book': LEMO + '/crayon-book/poster.jpg',
  'cm-isometric-picture-book': LEMO + '/isometric-picture-book/poster.jpg',
  'cm-paper-popup': LEMO + '/paper-popup/poster.jpg',
  'cm-shadow-puppet': LEMO + '/shadow-puppet/poster.jpg',
  'cm-papercut-red': LEMO + '/papercut-red/poster.jpg',
  'cm-risograph': LEMO + '/risograph/poster.jpg',
  'cm-one-line': LEMO + '/one-line/poster.jpg',
  'cm-microgame': LEMO + '/microgame/poster.jpg',
  'cm-game-show': LEMO + '/game-show/poster.jpg',
  'cm-variety-hanazi': MG15 + '/docs/readme/films/18-hanazi.webp',
  'cm-sticker-explainer': MG15 + '/docs/readme/films/19-paperclip.webp',
  'cm-synthwave-80s': MG15 + '/docs/readme/films/10-synthwave.webp',
  'cm-collage-cutout': MG15 + '/docs/readme/films/06-collage.webp',
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
    id: 'arch-ai-dark',
    layer: 'frontend',
    name: 'AI 生图 · 深色玻璃等距',
    oneLine: '深蓝渐变 + 半透明玻璃层 + 悬浮立方体 + 霓虹流线——发布会主视觉那种（示意，非精确拓扑）',
    source: 'AI 生成 · 本机 MiniMax image-01',
    tags: ['架构图', '架构图风格', 'AI 生图', '深色'],
    kind: 'image',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/arch-ai-dark.jpg',
    bullets: [
      '**示意，不是拓扑**：层与层之间没有真实连线，流线是装饰，别拿去当技术文档',
      '三要素：深蓝渐变底、半透明玻璃（1px 亮边）、顶部三个发光立方体',
      '生成的图里文字必然是乱码——真要用必须后期叠字与连线',
      '复现提示词：Isometric 3D technical architecture diagram, deep navy gradient background, floating translucent glass panels and rounded cubes arranged in layers, thin glowing cyan and violet connection lines, soft volumetric light, subtle bloom, cinematic depth of field, premium tech keynote aesthetic, no text, 16:9',
    ],
    howto: '发布会开场、方案汇报封面、落地页 hero 图。当「氛围图」用，别当架构图用。',
    sources: [
      { label: '生成方式', url: 'MiniMax image-01 · 本机 mcp__minimax-image__generate_image' },
      { label: '封面', path: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/arch-ai-dark.jpg' },
    ],
    origin: 'referenced',
  },
  {
    id: 'arch-ai-warm',
    layer: 'frontend',
    name: 'AI 生图 · 暖色扁平静物',
    oneLine: '米色纸底 + 马卡龙色块 + 一条细线穿过——像拍出来的静物，不像画出来的图（示意，非精确拓扑）',
    source: 'AI 生成 · 本机 MiniMax image-01',
    tags: ['架构图', '架构图风格', 'AI 生图', '浅色'],
    kind: 'image',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/arch-ai-warm.jpg',
    bullets: [
      '**示意，不是拓扑**：色块之间只有一条装饰性的线，没有真实依赖关系',
      '它的强项是「质感」：纸纹、投影、圆角厚度——适合当版式的一部分而不是正文图',
      '色块数量控制在 6–8 个，多了就变成抽象画',
      '复现提示词：Flat vector technical architecture illustration, warm cream paper background, soft pastel colored rounded blocks connected by hand-drawn arrows, Notion and Linear documentation style, gentle long shadows, generous whitespace, friendly and clean, minimal editorial poster, no text, 16:9',
    ],
    howto: '产品文档头图、公众号配图、需要「不那么工程」的场合；技术评审别用。',
    sources: [
      { label: '生成方式', url: 'MiniMax image-01 · 本机 mcp__minimax-image__generate_image' },
      { label: '封面', path: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/arch-ai-warm.jpg' },
    ],
    origin: 'referenced',
  },
  {
    id: 'arch-ai-cyber',
    layer: 'frontend',
    name: 'AI 生图 · 赛博 HUD',
    oneLine: '黑底 + 霓虹绿/品红线框立方体 + 光轨——像从监控界面里截出来的一帧（示意，非精确拓扑）',
    source: 'AI 生成 · 本机 MiniMax image-01',
    tags: ['架构图', '架构图风格', 'AI 生图', '深色'],
    kind: 'image',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/arch-ai-cyber.jpg',
    bullets: [
      '**示意，不是拓扑**：立方体是随机摆的，连线是光轨不是调用关系',
      '配色锁死：黑底 + 霓虹绿 + 品红，一条暖色都不用加',
      '景深很浅、颗粒感重——它是「氛围镜头」，不是信息载体',
      '复现提示词：Cyberpunk holographic system architecture visualization, black background, glowing wireframe boxes in neon green and magenta, thin luminous data streams connecting nodes, subtle scanlines and grain, futuristic HUD interface, high contrast, cinematic, no text, 16:9',
    ],
    howto: '技术发布会片头、黑客/安全主题的封面；日常文档用会显得用力过猛。',
    sources: [
      { label: '生成方式', url: 'MiniMax image-01 · 本机 mcp__minimax-image__generate_image' },
      { label: '封面', path: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/arch-ai-cyber.jpg' },
    ],
    origin: 'referenced',
  },
  {
    id: 'arch-dark-ui',
    layer: 'frontend',
    name: '暗色系统架构图（Cocoon）',
    oneLine: '近黑底 + 点阵网格 + 彩色描边卡片 + 正交连线——**好看且拓扑准确**，GitHub 上这类里最火的一个（7.6k）',
    source: 'https://github.com/Cocoon-AI/architecture-diagram-generator',
    tags: ['架构图', '架构图风格', '暗色', 'skill'],
    kind: 'image',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/arch-dark-microservices.png',
    bullets: [
      '和上面三条 AI 生图最大的区别：**它由代码生成，连线和分组是真的**（虚线框 = Kubernetes Cluster，图例区分 Service/Database/Gateway/Message Bus）',
      '每个卡片带技术栈与端口（Go :8081 / Java :8082），信息密度高但不糊',
      '输出是单个 HTML 文件，自带 Copy / PNG / PDF 导出',
      '实现形态是 Claude Skill（和 sweety-handdraw-video 一样），需要装进宿主',
    ],
    howto: '要「能贴进技术文档、又比 Mermaid 好看」的架构图时用；追求纯视觉冲击再考虑上面三条生图风格。',
    sources: [
      { label: '云端仓库', url: 'https://github.com/Cocoon-AI/architecture-diagram-generator' },
      { label: '封面（README 示例）', path: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/arch-dark-microservices.png' },
    ],
    origin: 'referenced',
  },
  {
    id: 'arch-mermaid',
    layer: 'frontend',
    name: 'Mermaid（代码即图）',
    oneLine: '几行文本写出架构图，GitHub / Notion / 几乎所有文档工具直接渲染——零设计成本',
    source: 'https://github.com/mermaid-js/mermaid',
    tags: ['架构图', '架构图风格', '代码即图'],
    kind: 'image',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/arch-mermaid.png',
    bullets: [
      '语法极简：`A --> B` 就是一条边；写错渲染器直接报错，逼着图是对的',
      '布局自动（dagre 算法），你只管拓扑不管位置——适合结构清晰的系统',
      'GitHub README / Issue、Notion、Obsidian、语雀都原生支持，改一行图就变',
    ],
    howto: '文档里嵌图、PR 说明、设计评审初稿；要精细排版就换 D2 或手绘。',
    sources: [
      { label: '官方文档', url: 'https://mermaid.js.org/' },
      { label: '封面（mermaid.ink 渲染）', path: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/arch-mermaid.png' },
    ],
    origin: 'referenced',
  },
  {
    id: 'arch-sequence',
    layer: 'frontend',
    name: '时序图（sequence diagram）',
    oneLine: '按时间顺序摊开一次调用：谁在什么时候向谁发了什么、等了多久',
    source: 'https://mermaid.js.org/syntax/sequenceDiagram.html',
    tags: ['架构图', '架构图风格', '时序图'],
    kind: 'image',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/arch-sequence.png',
    bullets: [
      '参与者横排、时间向下；**实线是调用、虚线是返回**，一眼看出同步还是异步',
      '必须画失败/超时分支，否则图看起来像「一切顺利」，等于没画',
      '一次只讲一条主链路；参与者超过 8 个就该拆成两张',
    ],
    howto: '讲清楚「一次请求走了哪几步」、排查超时、写 RFC 和事故复盘。',
    sources: [
      { label: '官方语法', url: 'https://mermaid.js.org/syntax/sequenceDiagram.html' },
      { label: '封面（本机渲染）', path: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/arch-sequence.png' },
    ],
    origin: 'referenced',
  },
  {
    id: 'arch-wardley',
    layer: 'frontend',
    name: 'Wardley 地图（战略 / 演化）',
    oneLine: '纵轴是价值链（谁依赖谁），横轴是演化（从全新到商品化）——看技术要往哪走',
    source: 'https://onlinewardleymaps.com/',
    tags: ['架构图', '架构图风格', '战略图'],
    kind: 'image',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/arch-wardley.png',
    bullets: [
      '纵轴：用户可见的在上、底层组件在下；连线表示依赖，越靠上越「值钱」',
      '横轴四段：Genesis（全新）/ Custom（自建）/ Product（产品）/ Commodity（商品化）',
      '同一个组件会随时间向右移动——自建变采购、采购变云服务，这张图能预测下一步',
    ],
    howto: '做技术选型、平台演进规划、解释「为什么现在要重构」；比架构图更偏决策。',
    sources: [
      { label: '在线工具', url: 'https://onlinewardleymaps.com/' },
      { label: '封面（Tea Shop 示例）', path: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/arch-wardley.png' },
    ],
    origin: 'referenced',
  },
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

/**
 * ── 漫画（comic）─────────────────────────────────────────────────────
 * 动漫 / 漫画 / 动画的视觉语言。来源是本地参考仓库 code-to-film 下的两套风格库：
 *   lemo-opuscar  —— 66 种影片风格，每种一份 STYLE.md（材质/色彩/运镜/音色/坑）+ 一张样片海报
 *   mg-styles-15  —— 15 种 MG 风格，每种一支 10 秒成片 + 完整提示词与源码
 * 每条都指到原始的 STYLE.md / 提示词，本层只做索引。
 */
const COMIC_ENTRIES = [
  {
    id: 'cm-cel-anime-80s',
    layer: 'comic',
    name: '80 年代赛璐璐动画',
    oneLine: '日本 OVA 黄金时代：手绘赛璐璐叠在喷绘背景上、背光霓虹、有限动画的节奏，整片录进一盘 CRT 磁带',
    source: LEMO + '/cel-anime-80s/STYLE.md',
    tags: ['日系', '赛璐璐', '复古', '动画风格'],
    kind: 'image',
    bullets: [
      '平涂色块叠在喷绘背景上——两者的质感差本身就是年代感，别把背景也画平',
      '背光：光源永远在角色背后或窗外，脸是暗的，只有轮廓有一道亮边',
      '有限动画：关键动作只画 2–3 张，靠速度线与抖动补足，不要补成流畅的 24 帧',
      '最后过一遍 CRT：扫描线、色渗、轻微几何形变，声音也要跟着变糊',
    ],
    howto: '做 80 年代怀旧、city pop、机甲/青春题材时用。规范在 STYLE.md（含镜头表与音色表），样片 City Lights, 1987。',
    sources: [
      { label: '风格规范 STYLE.md', path: LEMO + '/cel-anime-80s/STYLE.md' },
      { label: '海报', path: LEMO + '/cel-anime-80s/poster.jpg' },
    ],
    origin: 'referenced',
  },
  {
    id: 'cm-ukiyoe',
    layer: 'comic',
    name: '浮世绘',
    oneLine: '江户木版画活过来：平涂色块、刻出来的墨线、晕染天空，镜头像展开手卷一样在画面上移动',
    source: LEMO + '/ukiyoe/STYLE.md',
    tags: ['日系', '版画', '东方', '动画风格'],
    kind: 'image',
    bullets: [
      '每一镜都是一整张版画：和纸、细双线边框、竖排题签、朱印',
      '世界是平的——纵深靠横带堆叠与雾带，不靠透视与光影',
      '主版墨线压在色块之上，色块之间允许留一线纸白（这就是「印」出来的感觉）',
      '镜头横移像展开手卷，不推不拉',
    ],
    howto: '做日式风物、四季、旅途题材；也可作为日本漫画视觉的源头来引用。样片 Toward the Mountain · 山へ五景。',
    sources: [
      { label: '风格规范 STYLE.md', path: LEMO + '/ukiyoe/STYLE.md' },
      { label: '海报', path: LEMO + '/ukiyoe/poster.jpg' },
    ],
    origin: 'referenced',
  },
  {
    id: 'cm-rubber-hose',
    layer: 'comic',
    name: '1930s 橡皮管卡通',
    oneLine: '黑白手绘，所有东西都是活的，跟着热爵士乐队摇摆——弗莱舍工作室那一路',
    source: LEMO + '/rubber-hose/STYLE.md',
    tags: ['美式', '复古', '手绘', '动画风格'],
    kind: 'image',
    bullets: [
      '万物有生命：家具、杯子、云都会随手势扭动，肢体是橡皮管没有关节',
      '黑白墨线 + 手绘毛边，高光靠留白不靠灰度',
      '动作必须落在爵士乐的拍子上，每个动作一记音效',
      '允许不可能的变形（身体拉长成桥、头转 360°），这是这一派的语言',
    ],
    howto: '做复古、嬉闹、音乐驱动的短片；样片 Coffee Cup Chase。',
    sources: [
      { label: '风格规范 STYLE.md', path: LEMO + '/rubber-hose/STYLE.md' },
      { label: '海报', path: LEMO + '/rubber-hose/poster.jpg' },
    ],
    origin: 'referenced',
  },
  {
    id: 'cm-midcentury-toon',
    layer: 'comic',
    name: '50s 扁平卡通（UPA）',
    oneLine: '色与线分在两张片上、刻意印偏几像素；身体不动，只有手在干活；冷静课堂旁白配酷爵士',
    source: LEMO + '/midcentury-toon/STYLE.md',
    tags: ['美式', '扁平', '复古', '动画风格'],
    kind: 'image',
    bullets: [
      '颜色故意错开线几像素——这是印刷套版不准，不是失误，别对齐',
      '几何化的人：圆柱、圆、三角，不要细节',
      '有限动画：主体静止，只有手/眼在动，靠构图与色彩块推进',
      '一句话一张图，编号卡片，旁白是课堂式的第二人称',
    ],
    howto: '做解释性、教学式、克制的复古动画；样片 Meet Pip。',
    sources: [
      { label: '风格规范 STYLE.md', path: LEMO + '/midcentury-toon/STYLE.md' },
      { label: '海报', path: LEMO + '/midcentury-toon/poster.jpg' },
    ],
    origin: 'referenced',
  },
  {
    id: 'cm-scifi-toon',
    layer: 'comic',
    name: '成人动画情景喜剧',
    oneLine: '粗描边线条持续「沸腾」、平涂色、一对反应永远对不上的搭档、每个世界一套配色',
    source: LEMO + '/scifi-toon/STYLE.md',
    tags: ['美式', '成人动画', '线条沸腾', '动画风格'],
    kind: 'image',
    bullets: [
      '线条每帧重画，边缘持续抖动（boiling line）——用固定的种子抖动，别让它真的乱跳',
      '两人对话：一个在认真讲，另一个的反应完全不在频道上，笑点全在反应特写',
      '科幻硬件当成家用电器画：传送门像微波炉，飞船像吸尘器',
      '每个世界一套配色，换场景就换色板',
    ],
    howto: '做对白驱动的喜剧短片；样片 Coffee Run。',
    sources: [
      { label: '风格规范 STYLE.md', path: LEMO + '/scifi-toon/STYLE.md' },
      { label: '海报', path: LEMO + '/scifi-toon/poster.jpg' },
    ],
    origin: 'referenced',
  },
  {
    id: 'cm-halftone-dossier',
    layer: 'comic',
    name: '复古半调案卷（漫画网点）',
    oneLine: '奶油档案纸、几种平涂油墨叠印的网点、大标题带错位的投影、会砸下来的橡皮章',
    source: LEMO + '/halftone-dossier/STYLE.md',
    tags: ['漫画', '网点', '印刷风格', '复古'],
    kind: 'image',
    bullets: [
      '网点（halftone）是漫画的印刷语言，不是滤镜：密度决定明暗，角度决定质感',
      '三种色版叠印，套不准的偏移要保留',
      '大标题带一层错位重影，字重压到最粗',
      '橡皮章是节奏工具：一记「砸」下来就是一次分镜切换',
    ],
    howto: '做漫画感、档案感、复古印刷感的片子或封面；样片 胖橘案卷 Case File: Chubby。',
    sources: [
      { label: '风格规范 STYLE.md', path: LEMO + '/halftone-dossier/STYLE.md' },
      { label: '海报', path: LEMO + '/halftone-dossier/poster.jpg' },
    ],
    origin: 'referenced',
  },
  {
    id: 'cm-pixel-rpg',
    layer: 'comic',
    name: '16-bit 像素 RPG',
    oneLine: '320×180 像素、索引色板、逐字打出的对话框、菜单、存档点、带回声的芯片音乐',
    source: LEMO + '/pixel-rpg/STYLE.md',
    tags: ['像素', '游戏', '复古', '动画风格'],
    kind: 'image',
    bullets: [
      '分辨率锁死 320×180，所有元素按整数像素对齐，禁止亚像素移动',
      '索引色板：调色板换色就是「换场景」，用阶跃淡出不用连续渐变',
      'UI 是内容的一部分：对话框、菜单、存档点都是叙事工具',
      '音乐是芯片音源，带一点回声；音效短、干、脆',
    ],
    howto: '做游戏怀旧、像素叙事、轻喜剧；样片 The Last Save Point。',
    sources: [
      { label: '风格规范 STYLE.md', path: LEMO + '/pixel-rpg/STYLE.md' },
      { label: '海报', path: LEMO + '/pixel-rpg/poster.jpg' },
    ],
    origin: 'referenced',
  },
  {
    id: 'cm-hd-2d',
    layer: 'comic',
    name: 'HD-2D',
    oneLine: '像素小人像纸片一样立在有雾有光的 3D 微缩场景里，俯角四分之三、移轴镜头',
    source: LEMO + '/hd-2d/STYLE.md',
    tags: ['像素', '3D', '游戏', '动画风格'],
    kind: 'image',
    bullets: [
      '像素精灵站在真 3D 场景里——材质冲突才是这个风格的核心，别把场景也做成像素',
      '固定俯角四分之三，移轴景深把上下压虚',
      '每盏灯都要投出真的影子，雾与泛光要重',
      '对话用带边框的对话框，是游戏界面语言',
    ],
    howto: '做游戏化叙事、微缩世界；样片 The Lampbearer。注意「HD-2D」是 Square Enix 的商标术语，不能用作片名或品牌。',
    sources: [
      { label: '风格规范 STYLE.md', path: LEMO + '/hd-2d/STYLE.md' },
      { label: '海报', path: LEMO + '/hd-2d/poster.jpg' },
    ],
    origin: 'referenced',
  },
  {
    id: 'cm-cel-boil',
    layer: 'comic',
    name: '逐帧手绘 / 线条沸腾',
    oneLine: '逐帧重画带来的线条抖动（line boil），手作感最强的赛璐璐动画',
    source: MG15 + '/prompts/05-cel-boil.md',
    tags: ['手绘', '逐帧', '线条沸腾', '动画风格'],
    kind: 'image',
    bullets: [
      '线条每帧重画，抖动是特征不是瑕疵——但抖动要受控，不能变成噪点',
      '先出线稿再上色，笔先起形、按模块描线、擦掉起形、再由浅到深上色',
      '墨线有压感，完成色要平涂干净（别把马克笔笔道留在色块里）',
      '这一条已经能在本机跑通：mg-styles-15 + Edge 渲染',
    ],
    howto: '想要「手作动画」质感又不想真的手绘时用；样片 手作 HAND MADE。',
    sources: [
      { label: '完整提示词', path: MG15 + '/prompts/05-cel-boil.md' },
      { label: '源码', path: MG15 + '/demos/05-cel-boil' },
    ],
    origin: 'referenced',
  },
  {
    id: 'cm-pixel-art',
    layer: 'comic',
    name: '像素风（8-bit）',
    oneLine: '8-bit 像素美术，色板克制，每一格像素都算数',
    source: MG15 + '/prompts/20-pixel.md',
    tags: ['像素', '8-bit', '游戏', '动画风格'],
    kind: 'image',
    bullets: [
      '色板先定死（8–16 色），之后所有画面只能从这里面取',
      '像素画不缩放：要么整数倍放大，要么按目标分辨率重画',
      '动画靠 2–4 帧循环，不是平滑补间',
      '这一条已经能在本机跑通：mg-styles-15 + Edge 渲染',
    ],
    howto: '做怀旧游戏感、轻快叙事；样片 PIXEL QUEST 像素冒险。',
    sources: [
      { label: '完整提示词', path: MG15 + '/prompts/20-pixel.md' },
      { label: '源码', path: MG15 + '/demos/20-pixel' },
    ],
    origin: 'referenced',
  },
  {
    id: 'cm-crayon-book',
    layer: 'comic',
    name: '蜡笔儿童绘本',
    oneLine: '一页绘本被当场画出来：蜡笔在粗糙纸上、每一帧都微微抖动，水彩晕开把蜡笔藏起来的部分露出来',
    source: LEMO + '/crayon-book/STYLE.md',
    tags: ['绘本', '手绘', '蜡笔', '动画风格'],
    kind: 'image',
    bullets: [
      '蜡只沾在纸纹的凸起上——压力决定覆盖多少，这是材质不是滤镜',
      '每帧重画，线条持续抖动，画面在呼吸',
      '水彩是客人、蜡笔是主人：晕染只用来揭示，不主导',
      '画完一页就是一页，不留半成品；叙事靠「这一页被画完」推动',
    ],
    howto: '做童年、亲情、睡前故事、无言的温柔；样片 The Moon Can\'t Sleep。参考《雪人》那种无台词抒情。',
    sources: [
      { label: '风格规范 STYLE.md', path: LEMO + '/crayon-book/STYLE.md' },
      { label: '海报', path: LEMO + '/crayon-book/poster.jpg' },
    ],
    origin: 'referenced',
  },
  {
    id: 'cm-isometric-picture-book',
    layer: 'comic',
    name: '等距绘本',
    oneLine: '一个日常规则讲成真等距绘本：小人物背对镜头按顺序做事，衬线字一个一个落在地上，像画在地面',
    source: LEMO + '/isometric-picture-book/STYLE.md',
    tags: ['绘本', '等距', '信息图', '动画风格'],
    kind: 'image',
    bullets: [
      '真等距、平涂色，人没有脸、一律背对镜头——人是图的一部分，不是角色',
      '字落在地面上（贴地透视），不是浮在画面前',
      '节奏很慢：一件事做完再做下一件，不要并置',
      '遮挡动作的东西要像掀开屋顶一样移走，而不是淡出',
    ],
    howto: '讲一条日常规则、公共礼仪、流程「应该是怎样」；样片 Seventy-Two Seats。',
    sources: [
      { label: '风格规范 STYLE.md', path: LEMO + '/isometric-picture-book/STYLE.md' },
      { label: '海报', path: LEMO + '/isometric-picture-book/poster.jpg' },
    ],
    origin: 'referenced',
  },
  {
    id: 'cm-paper-popup',
    layer: 'comic',
    name: '纸片立体书',
    oneLine: '桌上翻开一本立体书，纸片角色带白边在弹起的纸景前表演，真台灯、真微距镜头',
    source: LEMO + '/paper-popup/STYLE.md',
    tags: ['绘本', '纸艺', '3D', '动画风格'],
    kind: 'image',
    bullets: [
      '两个世界同框：写实的桌面（HDRI 光）＋ 扁平的纸片（厚白边、灰卡纸边）',
      '靠尺度与材质冲突取胜——让真光和真景深把纸片「做实」',
      '景片沿底边弹起（V 折），不是淡入',
      '角色也是纸片，几厘米高，投出剪纸形状的阴影',
    ],
    howto: '做手工感、童心、礼物/贺卡式的叙事；样片 The Little Sprite\'s Adventure。',
    sources: [
      { label: '风格规范 STYLE.md', path: LEMO + '/paper-popup/STYLE.md' },
      { label: '海报', path: LEMO + '/paper-popup/poster.jpg' },
    ],
    origin: 'referenced',
  },
  {
    id: 'cm-shadow-puppet',
    layer: 'comic',
    name: '皮影戏',
    oneLine: '半透明的染色皮偶贴着棉布幕，油灯在后面打光——镂空得像蕾丝，动作是侧身表演',
    source: LEMO + '/shadow-puppet/STYLE.md',
    tags: ['东方', '皮影', '剪影', '动画风格'],
    kind: 'image',
    bullets: [
      '一切都在侧影里发生：角色只有轮廓与镂空，不画正脸',
      '光从左后方来，皮偶是暗的、镂空是亮的——明暗关系不能反',
      '关节分段摆动，动作是「操纵」出来的，不是流畅补间',
      '锣鼓点决定节奏，一个亮相就是一记锣',
    ],
    howto: '中国传统故事、神话、民间叙事；样片 Hou Yi Shoots the Suns。也适合做剪影式的抽象叙事。',
    sources: [
      { label: '风格规范 STYLE.md', path: LEMO + '/shadow-puppet/STYLE.md' },
      { label: '海报', path: LEMO + '/shadow-puppet/poster.jpg' },
    ],
    origin: 'referenced',
  },
  {
    id: 'cm-papercut-red',
    layer: 'comic',
    name: '红色窗花剪纸',
    oneLine: '中国窗花活起来：关节可动的红色剪纸上场，镂空就是画面，光从洞里进来',
    source: LEMO + '/papercut-red/STYLE.md',
    tags: ['东方', '剪纸', '节庆', '动画风格'],
    kind: 'image',
    bullets: [
      '剪就是画：轮廓由剪刀决定，洞的形状就是形体的负形',
      '阴阳剪法（留红/留白）两套逻辑不能混用',
      '关节用铆钉式连接，动作幅度大、干脆',
      '配色克制：正红 + 纸白，最多加一点金',
    ],
    howto: '春节、年味、民俗、喜庆题材；样片 Nian Comes to Town。',
    sources: [
      { label: '风格规范 STYLE.md', path: LEMO + '/papercut-red/STYLE.md' },
      { label: '海报', path: LEMO + '/papercut-red/poster.jpg' },
    ],
    origin: 'referenced',
  },
  {
    id: 'cm-risograph',
    layer: 'comic',
    name: '孔版印刷（Riso）',
    oneLine: '像在油印机上逐帧印出来的：两三种半透明专色叠印在暖纸上，网点、墨粒、永远对不准的版',
    source: LEMO + '/risograph/STYLE.md',
    tags: ['印刷风格', 'zine', '漫画', '复古'],
    kind: 'image',
    bullets: [
      '2–3 种半透明专色，叠印处产生第三色——这是 riso 的核心，别直接画第三种颜色',
      '错版是签名：色块与线故意错开 1–2mm',
      '网点、针孔、走纸痕都要留，太干净就不像印的',
      '人物小、场面大：一个小人在大片色块里',
    ],
    howto: '独立漫画、zine、海报、文艺短片——当下最被认可的印刷质感；样片 Sunday Ride。',
    sources: [
      { label: '风格规范 STYLE.md', path: LEMO + '/risograph/STYLE.md' },
      { label: '海报', path: LEMO + '/risograph/poster.jpg' },
    ],
    origin: 'referenced',
  },
  {
    id: 'cm-one-line',
    layer: 'comic',
    name: '一笔画',
    oneLine: '一条墨线，从不离开纸面。画面里所有东西都是这条线在画，转场不切、是变形',
    source: LEMO + '/one-line/STYLE.md',
    tags: ['线条', '极简', '动画风格', '手绘'],
    kind: 'image',
    bullets: [
      '全片可以真的只是一个点数组：从落笔到最后一帧不断线',
      '没有填充、没有明暗、没有第二种线宽',
      '角色、场景、甚至时间都是这条线——变形即转场',
      '镜头跟着笔尖跑，带一点滞后与预判',
    ],
    howto: '做极简、俏皮、音乐驱动的小品；样片 The Line That Never Lifted。参考《La Linea》。',
    sources: [
      { label: '风格规范 STYLE.md', path: LEMO + '/one-line/STYLE.md' },
      { label: '海报', path: LEMO + '/one-line/poster.jpg' },
    ],
    origin: 'referenced',
  },
  {
    id: 'cm-microgame',
    layer: 'comic',
    name: '微游戏快闪',
    oneLine: '一个词、几秒钟、一个动作：每个微游戏都是完全不同的画风，片子越来越快',
    source: LEMO + '/microgame/STYLE.md',
    tags: ['游戏', '快节奏', '动画风格', '亚文化'],
    kind: 'image',
    bullets: [
      '一条指令字 + 一个动作 = 一个微游戏，2–5 秒结束',
      '每个微游戏换一套画风（像素/剪纸/涂鸦/3D），风格切换本身就是节奏',
      '结果用大字判词（成功/失败）一刀切，不留过渡',
      '全片速度递增，最后一个最荒诞',
    ],
    howto: '做快节奏、鬼畜、梗密集的短片；样片 Five-Second Astronaut。参考 WarioWare。',
    sources: [
      { label: '风格规范 STYLE.md', path: LEMO + '/microgame/STYLE.md' },
      { label: '海报', path: LEMO + '/microgame/poster.jpg' },
    ],
    origin: 'referenced',
  },
  {
    id: 'cm-game-show',
    layer: 'comic',
    name: '综艺节奏扁平',
    oneLine: '扁平矢量的节奏游戏综艺：厚描边玩偶吉祥物、糖果色条纹与放射线、每一击都落在固定节拍上',
    source: LEMO + '/game-show/STYLE.md',
    tags: ['综艺', '扁平', '游戏', '动画风格'],
    kind: 'image',
    bullets: [
      '厚墨线 + 糖果色条纹 + 放射线，是日本综艺 telop 那套视觉',
      '所有动作对齐固定节拍网格，不自由发挥',
      '呼麦式来回：cue → answer，一问一答',
      '每回合结束给一个「判词」大字',
    ],
    howto: '做热闹、竞技、综艺感的短片；样片 AI进化节拍 Rhythm of AI 1997 → 2026。',
    sources: [
      { label: '风格规范 STYLE.md', path: LEMO + '/game-show/STYLE.md' },
      { label: '海报', path: LEMO + '/game-show/poster.jpg' },
    ],
    origin: 'referenced',
  },
  {
    id: 'cm-variety-hanazi',
    layer: 'comic',
    name: '综艺花字（Hanazi）',
    oneLine: '日韩综艺式的动态花字：大字带描边与投影砸进画面，跟着语速逐字蹦出，情绪靠字的大小与歪斜',
    source: MG15 + '/prompts/18-hanazi.md',
    tags: ['综艺', '花字', '日韩', '动画风格'],
    kind: 'image',
    bullets: [
      '花字是表演：字要有弹入、抖动、歪斜，不能只是淡入',
      '厚描边 + 硬投影 + 高饱和，保证小屏上也能读',
      '竖屏 9:16 是原生画幅，字占屏比例比横屏大得多',
      '每个字跟着语音节奏逐字出现，重音字单独放大',
    ],
    howto: '做综艺感、vlog、科普花字、竖屏短视频；原片 喵呜日记 EP.07，AI 评审 7.64/10。',
    sources: [
      { label: '完整提示词', path: MG15 + '/prompts/18-hanazi.md' },
      { label: '源码', path: MG15 + '/demos/18-hanazi' },
    ],
    origin: 'referenced',
  },
  {
    id: 'cm-sticker-explainer',
    layer: 'comic',
    name: '粗描边贴纸人科普',
    oneLine: '回形针/林超那种贴纸人 MG：粗黑描边的人物贴进真实物件里，靠贴纸的「贴」来讲解',
    source: MG15 + '/prompts/19-paperclip.md',
    tags: ['漫画', '贴纸', '科普', '动画风格'],
    kind: 'image',
    bullets: [
      '粗描边 + 纯色填充 + 白边，贴着真实照片或物体走',
      '人物是「讲解员」不是主角：它的作用是当指针',
      '信息靠移动贴纸来推进，不靠字幕堆叠',
      '一个镜头只讲一件事，讲完立刻换贴纸',
    ],
    howto: '做科普、拆解、知识类 MG，视觉记忆点强；原片「一部手机里，藏着多少种元素？」AI 评审 7.71/10。',
    sources: [
      { label: '完整提示词', path: MG15 + '/prompts/19-paperclip.md' },
      { label: '源码', path: MG15 + '/demos/19-paperclip' },
    ],
    origin: 'referenced',
  },
  {
    id: 'cm-synthwave-80s',
    layer: 'comic',
    name: '复古 80s Synthwave / VHS',
    oneLine: '霓虹网格、落日、磁带噪点：80 年代合成器美学，和赛璐璐动画共用同一个年代底色',
    source: MG15 + '/prompts/10-synthwave.md',
    tags: ['复古', '80s', '赛博', '动画风格'],
    kind: 'image',
    bullets: [
      '配色锁死：品红 / 青 / 深紫，加一点橙当落日',
      '透视网格地平线是标志性构图，镜头常做向前推进',
      'VHS 质感要真：扫描线、色差、噪点、偶尔的磁迹跳动',
      '字用霓虹描边或铬金属反射，不要现代无衬线',
    ],
    howto: '做 80 年代怀旧、合成器音乐、赛博题材；原片 NEON DRIVE 霓虹夜驰 1986，AI 评审 8.21/10（本库最高分之一）。',
    sources: [
      { label: '完整提示词', path: MG15 + '/prompts/10-synthwave.md' },
      { label: '源码', path: MG15 + '/demos/10-synthwave' },
    ],
    origin: 'referenced',
  },
  {
    id: 'cm-collage-cutout',
    layer: 'comic',
    name: '拼贴剪贴',
    oneLine: '旧杂志剪下来拼在一起：剪口毛边、纸质纹理、每块素材都在轻微地独立抖动',
    source: MG15 + '/prompts/06-collage.md',
    tags: ['拼贴', '拼贴风格', '手工', '动画风格'],
    kind: 'image',
    bullets: [
      '每一块都要有剪口毛边与纸张厚度，别做成矢量色块',
      '拼贴的幽默在「错位」：比例、年代、风格越不搭越好',
      '各元素轻微独立抖动，像手在一点点挪',
      '留白用纸底，不要用纯色背景',
    ],
    howto: '做脑洞、杂志感、独立风格短片；原片 NOGGIN 脑洞季刊，AI 评审 8.14/10。',
    sources: [
      { label: '完整提示词', path: MG15 + '/prompts/06-collage.md' },
      { label: '源码', path: MG15 + '/demos/06-collage' },
    ],
    origin: 'referenced',
  },
]

/**
 * 漫画层的「云端 → 本地」对应。
 *
 * 条目上的 source 写的是本地副本路径，但**最初的来源在 GitHub**——不能只标下载之后的位置。
 * 这里统一补两件事：
 *   ① source 改写成云端仓库里的位置（面板「出处」、specOf 的「出处」都读它）；
 *   ② sources 最前面插入云端原文 URL，本地副本降级为「本地 · xxx」排在后面。
 * refOf 的「复制引用」取 sources[0]，所以粘给 AI 的是云端地址，不是我这台机器的 D 盘路径。
 */
const CLOUD = {
  lemo: 'https://github.com/lemomo-ai/lemo-opuscar',
  mg: 'https://github.com/Vincentwei1021/mg-styles-15',
}
for (const e of COMIC_ENTRIES) {
  const local = String(e.source)
  const isMg = local.startsWith(MG15)
  const repo = isMg ? CLOUD.mg : CLOUD.lemo
  const rel = (isMg ? '' : 'styles/') + local.slice((isMg ? MG15 : LEMO).length + 1)
  const cloud = repo + '/blob/main/' + rel
  e.cloud = cloud
  e.source = repo.replace('https://', '') + ' · ' + rel.replace(/(\/STYLE\.md|\.md)$/, '')
  e.sources = [
    { label: '云端原文', url: cloud },
    ...(Array.isArray(e.sources) ? e.sources : []).map((s) => ({ ...s, label: '本地 · ' + s.label })),
  ]
}

/**
 * 每层的筛选芯片。
 *
 * 条目的 tags 是「写给自己的注释」（200 个里有 143 个只出现一次），不适合直接当筛选维度。
 * 这里给每层单独定一组**可用作筛选**的标签：语义不重叠、每个至少命中 2 条、覆盖本层主要群体。
 * 面板只渲染这一组；条目的 tags 仍原样保留，搜索与 nature 判定照旧。
 */
/**
 * ── 个人主页 / 作品集（GitHub 上的参考做法）──────────────────────────
 * 12 种常见做法的代表仓库，按 star 数从 GitHub 搜出来挑的。
 * 封面取自各自 README 的截图（已下载到 _design/covers/）；README 没截图的给色卡。
 * 这些是**别人的仓库**，只作参照，别把整套布局照搬。
 */
const PERSONAL_HOME = [
  {
    id: 'fe-ph-simplefolio',
    name: '极简单页（simplefolio）',
    oneLine: '一行自我介绍 + 三张项目卡 + 技能条，几乎没有装饰——干净到能直接改',
    source: 'https://github.com/cobiwave/simplefolio',
    tags: ['网页风格', '个人主页', '极简'],
    kind: 'image',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-ph-simplefolio.png',
    bullets: [
      '首屏只有三样：名字、一句话定位、两个按钮',
      '项目卡固定三段：标题 / 一行结果 / 技术栈标签',
      '圆角 8px、几乎无阴影，靠 80px 的段落间距撑开呼吸',
    ],
    howto: '要一个一天能改完、又不显廉价的个人站时首选；14.2k star，改法最多。',
    sources: [{ label: '仓库', url: 'https://github.com/cobiwave/simplefolio' }],
  },
  {
    id: 'fe-ph-devportfolio',
    name: '极简 Astro 作品集（devportfolio）',
    oneLine: 'Astro + Tailwind 的极简作品集，首屏大字 + 横向项目带，构建产物极小',
    source: 'https://github.com/RyanFitzgerald/devportfolio',
    tags: ['网页风格', '个人主页', '极简'],
    kind: 'image',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-ph-devportfolio.png',
    bullets: [
      '标题字号 64–80px，正文 16px——用字号差制造层级，而不是靠颜色',
      '项目用横向卡片带，一屏能看到 2–3 个，不做瀑布流',
      '整站零图片也能成立（纯排版驱动）',
    ],
    howto: '想用 Astro、要极快首屏、内容以文字与项目链接为主时用它。',
    sources: [{ label: '仓库', url: 'https://github.com/RyanFitzgerald/devportfolio' }],
  },
  {
    id: 'fe-ph-academicpages',
    name: '学术简历风（academicpages）',
    oneLine: '侧栏放身份与链接、正文放论文与时间线——科研人员的事实标准，17.8k star',
    source: 'https://github.com/academicpages/academicpages.github.io',
    tags: ['网页风格', '个人主页', '学术'],
    kind: 'image',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-ph-academicpages.png',
    bullets: [
      '两栏固定结构：左 30% 头像+身份+社交，右 70% 论文/项目列表',
      '每条成果一行：标题 + 作者 + 会议 + 徽章（PDF/Code/Slide）',
      '配色克制到只有黑灰加一个链接蓝，图表与公式才是主角',
    ],
    howto: '做科研/学术个人主页的首选骨架；换成你的论文即可，别改两栏结构。',
    sources: [
      { label: '仓库', url: 'https://github.com/academicpages/academicpages.github.io' },
      { label: '封面（README 截图）', path: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-ph-academicpages.png' },
    ],
  },
  {
    id: 'fe-ph-3d-portfolio',
    name: '3D 交互作品集',
    oneLine: 'Three.js 做的可探索场景：不是滚动看页面，而是「走进」你的作品',
    source: 'https://github.com/adrianhajdin/project_3D_developer_portfolio',
    tags: ['网页风格', '个人主页', '3D'],
    kind: 'image',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-ph-3d-portfolio.png',
    bullets: [
      '模型本身要有意义（飞船/房间/工位），别为 3D 而 3D',
      '必须有降级路径：低端设备退回静态首图 + 普通列表',
      '加载期用进度条承接，超过 3 秒不给反馈就会掉人',
    ],
    howto: '前端/3D 方向、想用作品集本身证明技术能力时用；代价是首屏重、要兜底。',
    sources: [
      { label: '仓库', url: 'https://github.com/adrianhajdin/project_3D_developer_portfolio' },
      { label: '封面（README 截图）', path: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-ph-3d-portfolio.png' },
    ],
  },
  {
    id: 'fe-ph-terminal',
    name: '终端风（terminal portfolio）',
    oneLine: '整站是个终端窗口：敲 help 看命令、敲 about 看简介，开发者一看就懂',
    source: 'https://github.com/satnaing/terminal-portfolio',
    tags: ['网页风格', '个人主页', '终端'],
    kind: 'image',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-ph-terminal.png',
    bullets: [
      '保留常见命令（help/about/projects/contact），别发明新语法',
      '必须有 Tab 补全与 ↑ 历史，否则键盘用户立刻出戏',
      '字号 14–15px 等宽、行高 1.6，深色底对比 ≥7:1',
    ],
    howto: '开发者/运维方向、想显得极客时用；非技术访客会懵，记得留一个「普通模式」入口。',
    sources: [
      { label: '仓库', url: 'https://github.com/satnaing/terminal-portfolio' },
      { label: '封面（README 截图）', path: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-ph-terminal.png' },
    ],
  },
  {
    id: 'fe-ph-bento',
    name: 'Bento 便当盒网格',
    oneLine: '大小不一的卡片各装一块内容——自我介绍、时钟、作品、留言板，扫一眼全在',
    source: 'https://github.com/Ladvace/astro-bento-portfolio',
    tags: ['网页风格', '个人主页', 'Bento'],
    kind: 'image',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-ph-bento.webp',
    bullets: [
      '网格用 CSS Grid + Subgrid，卡片跨 1/2/4 列，但永远对齐同一套轨道',
      '每张卡自洽：一个数字、一张图、一段话，不跨卡引用',
      '深色底 + 单一强调色（这里红），花哨只花在图案上',
    ],
    howto: '内容杂（作品+技能+生活+链接）又想一屏讲完时最合适；2026 年最主流的作品集版式。',
    sources: [
      { label: '仓库', url: 'https://github.com/Ladvace/astro-bento-portfolio' },
      { label: '封面（README 截图）', path: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-ph-bento.webp' },
    ],
  },
  {
    id: 'fe-ph-vcard',
    name: 'vCard 名片式',
    oneLine: '整站就是一张翻开的名片：左头像右简介，点「More」滑出详情',
    source: 'https://github.com/codewithsadee/vcard-personal-portfolio',
    tags: ['网页风格', '个人主页', '名片'],
    kind: 'image',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-ph-vcard.png',
    bullets: [
      '主卡宽度锁 1000–1100px，两侧留白，像桌上一张实体卡',
      '分栏：左 40% 头像与联系方式，右 60% 简介与标签页',
      '阴影要重（0 20px 60px），才「浮」得起来',
    ],
    howto: '内容少、想快速有个像样门面时用；也适合当简历的可视化载体。',
    sources: [
      { label: '仓库', url: 'https://github.com/codewithsadee/vcard-personal-portfolio' },
      { label: '封面（README 截图）', path: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-ph-vcard.png' },
    ],
  },
  {
    id: 'fe-ph-developerfolio',
    name: '开发者作品集全家桶（developerFolio）',
    oneLine: '深色主题 + 动画 + 博客 + 多语言，开箱即用的重装模板',
    source: 'https://github.com/saadpasta/developerFolio',
    tags: ['网页风格', '个人主页', '模板'],
    kind: 'image',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-ph-developerfolio.png',
    bullets: [
      '首屏是插画+大字，滚动触发动画（每个区块进入时上浮 24px）',
      '技能按「熟练度条」展示——这个做法已经过时，建议换成项目里的实际使用',
      '所有文案集中在一个配置文件，改内容不用碰组件',
    ],
    howto: '想快速上线、能接受模板感时用；6.6k star，配套教程最多。',
    sources: [{ label: '仓库', url: 'https://github.com/saadpasta/developerFolio' }],
  },
  {
    id: 'fe-ph-gitprofile',
    name: 'GitHub 同步生成（gitprofile）',
    oneLine: '只填 GitHub 用户名，作品与技能自动从仓库长出来',
    source: 'https://github.com/arifszn/gitprofile',
    tags: ['网页风格', '个人主页', '自动化'],
    kind: 'image',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-ph-gitprofile.png',
    bullets: [
      '内容源是 GitHub API：仓库、语言占比、star——写一次不用维护',
      '要处理「空账号」：没有星标仓库时页面不能塌成空白',
      '适合作为长期不更新的兜底站，不适合当主打作品集',
    ],
    howto: '不想维护内容、主要靠 GitHub 说话时用；想讲故事的场合别用。',
    sources: [
      { label: '仓库', url: 'https://github.com/arifszn/gitprofile' },
      { label: '封面（README 截图）', path: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-ph-gitprofile.png' },
    ],
  },
  {
    id: 'fe-ph-web-desktops',
    name: '桌面 OS 模拟',
    oneLine: '整站伪装成一个操作系统桌面：图标可双击、窗口可拖动，合集收录几十个',
    source: 'https://github.com/syxanash/awesome-web-desktops',
    tags: ['网页风格', '个人主页', '拟物'],
    kind: 'image',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-ph-web-desktops.png',
    bullets: [
      '封面截的是合集里最有名的 daedalOS（dustinbrett.com），不是某个模板',
      '交互必须真：窗口能拖动、能最小化，否则比普通页面更假',
      '图标网格 32px 间距、窗口圆角 12px、投影 0 24px 60px——这些尺寸决定它像不像真的',
      '移动端几乎无法成立——要么做触屏适配，要么直接退回列表页',
      '适合「作品多、需要分类」的人：文件夹即分类',
    ],
    howto: '想让人记住、且愿意为交互买单时用；做之前先想清楚移动端怎么办。',
    sources: [{ label: '合集仓库', url: 'https://github.com/syxanash/awesome-web-desktops' }],
  },
  {
    id: 'fe-ph-portfolio-list',
    name: '开发者作品集合集（27.8k）',
    oneLine: '一份按字母排的开发者作品集清单——想看真实的人怎么做，从这里挑',
    source: 'https://github.com/emmabostian/developer-portfolios',
    tags: ['网页风格', '个人主页', '合集'],
    kind: 'image',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-ph-portfolio-list.png',
    bullets: [
      '收录的是真人站点，不是模板——适合判断「哪种风格真的有人用」',
      '按字母排，找参考时先按行业筛（设计/前端/数据）',
      '点进去看三件事：首屏一句话、项目怎么讲、联系方式在哪',
    ],
    howto: '动手前先在这里翻 10 个同类站，比看 100 条设计原则有用。',
    sources: [
      { label: '合集仓库', url: 'https://github.com/emmabostian/developer-portfolios' },
      { label: '封面（README 截图）', path: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-ph-portfolio-list.png' },
    ],
  },
  {
    id: 'fe-ph-portfolio-ideas',
    name: '作品集创意合集（portfolio-ideas）',
    oneLine: '带截图的创意库：同一个身份能长成什么样，一次看十几版',
    source: 'https://github.com/Evavic44/portfolio-ideas',
    tags: ['网页风格', '个人主页', '合集'],
    kind: 'image',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-ph-portfolio-ideas.png',
    bullets: [
      '每条带截图 + 技术栈 + 仓库链接，能直接看源码',
      '按角色分区（设计/开发/数据），先按角色筛再谈风格',
      '注意：里面的排版很多过时了，看结构别看细节',
    ],
    howto: '找版式灵感时用；但别抄具体配色与字体，那是别人的身份。',
    sources: [
      { label: '合集仓库', url: 'https://github.com/Evavic44/portfolio-ideas' },
      { label: '封面（README 截图）', path: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/fe-ph-portfolio-ideas.png' },
    ],
  },
]

// 这 12 条全是别人的仓库，明确标成引用（origin 字段默认是 'mine'，漏写就会被当成自制）
for (const e of PERSONAL_HOME) e.origin = 'referenced'

/**
 * ── 动效设计（motion）────────────────────────────────────────────────
 * 时间、缓动、编排、转场——界面「高级感」的那一半，和视觉风格是两件事。
 * 分四组：原则 / 缓动与转场 / 微交互 / 引擎。全部是别人的开源项目，只作参照。
 */
const MOTION_ENTRIES = [
  {
    id: 'mo-motion-skill',
    name: '通用动效原则（Lottie）',
    oneLine: 'timing / easing / choreography 三件套——专为 AI agent 写的动效规范，不是给人看的教程',
    source: 'https://github.com/LottieFiles/motion-design-skill',
    tags: ['动效风格', '原则', 'AI skill'],
    kind: 'demo',
    swatch: { a: '#141225', b: '#2a2450', fg: '#e8e6ff', accent: '#8b7cf6', pattern: 'grid' },
    bullets: [
      'timing 分三档：微反馈 100–150ms、状态切换 200–300ms、页面转场 300–500ms',
      'easing：进场用 ease-out（快进慢出），出场用 ease-in；位移超过 400px 才考虑 spring',
      'choreography：同组元素错峰 30–50ms，超过 6 个元素就分组，别一起动',
    ],
    howto: '写任何交互动效前先对一遍这三条；它是 skill 形式，可以直接丢给 agent 读。',
    sources: [{ label: '仓库', url: 'https://github.com/LottieFiles/motion-design-skill' }],
  },
  {
    id: 'mo-principles',
    name: '动效设计原则（判定标准）',
    oneLine: '一套可执行的判断标准：什么时候该动、动多少、什么时候该干脆不动',
    source: 'https://github.com/kylezantos/design-motion-principles',
    tags: ['动效风格', '原则'],
    kind: 'demo',
    swatch: { a: '#1a1410', b: '#332620', fg: '#f5ece4', accent: '#e08a4a', pattern: 'stripes' },
    bullets: [
      '动效只服务三件事：引导注意力、表达状态变化、维持空间连续',
      '没有状态变化的动画就是装饰，删掉',
      '每个动画问一句「去掉它，用户会困惑吗」——不会就删',
      '同屏同时动的不超过 3 组；组间位移差 40px 以上才看得出层次，否则挤成一团',
    ],
    howto: '做交互评审时当 checklist 用；也能挡住「这个能不能加个动效」这类需求。',
    sources: [{ label: '仓库', url: 'https://github.com/kylezantos/design-motion-principles' }],
  },
  {
    id: 'mo-easing',
    name: '缓动曲线速查（easings.net）',
    oneLine: '所有标准缓动曲线的可视对照：从 easeInSine 到 easeInOutBack，一眼挑对',
    source: 'https://github.com/ai/easings.net',
    tags: ['动效风格', '缓动与转场'],
    kind: 'demo',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/mo-easing.png',
    bullets: [
      '默认组合：进场 easeOutCubic、出场 easeInCubic、双向过渡 easeInOutCubic',
      '弹跳感用 easeOutBack（过冲约 10%），别自己手调 cubic-bezier',
      '同一页面里缓动曲线不超过 3 种，多了就没有「节奏」可言',
    ],
    howto: '写 CSS transition 前先在这里挑一条；它是动效里最容易做对、也最容易做砸的一项。',
    sources: [
      { label: '仓库', url: 'https://github.com/ai/easings.net' },
      { label: '封面（官网截图）', path: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/mo-easing.png' },
    ],
  },
  {
    id: 'mo-barba',
    name: '页面转场（barba.js）',
    oneLine: '让多页站像单页一样无缝切换：旧页先退场、新页再进场，中间不留白',
    source: 'https://github.com/barbajs/barba',
    tags: ['动效风格', '缓动与转场'],
    kind: 'demo',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/mo-barba.png',
    bullets: [
      '转场总时长 400–600ms；超过 800ms 用户会以为卡住',
      '必须有「旧页退场」阶段，直接换页会闪白',
      '共享元素（同一张图/标题）跨页延续，是最省力的高级感',
    ],
    howto: '多页站（文档、作品集）想做出 App 手感时用；单页站不需要。',
    sources: [
      { label: '仓库', url: 'https://github.com/barbajs/barba' },
      { label: '封面（官网截图）', path: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/mo-barba.png' },
    ],
  },
  {
    id: 'mo-vivus',
    name: 'SVG 描线动画（vivus）',
    oneLine: '让线条像被笔一点点画出来——logo、插画、流程图的入场最常用手法',
    source: 'https://github.com/maxwellito/vivus',
    tags: ['动效风格', '缓动与转场'],
    kind: 'demo',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/mo-vivus.png',
    bullets: [
      '基于 stroke-dasharray / stroke-dashoffset，不需要 canvas',
      '描线速度按路径长度分配：长线快、短线慢，匀速会像机器',
      '描完再填充（fill 延迟 100–200ms），比同时出现自然',
    ],
    howto: 'logo 入场、手绘感插画、流程逐段出现；和「一笔画」那类视觉风格很搭。',
    sources: [
      { label: '仓库', url: 'https://github.com/maxwellito/vivus' },
      { label: '封面（demo 截图）', path: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/mo-vivus.png' },
    ],
  },
  {
    id: 'mo-interior',
    name: '点击后的半秒（微交互）',
    oneLine: '专做「点下去之后那 500ms」的反馈：按压、涟漪、状态确认',
    source: 'https://github.com/ddoemonn/interior',
    tags: ['动效风格', '微交互'],
    kind: 'demo',
    swatch: { a: '#101d1f', b: '#1d3438', fg: '#e4f4f5', accent: '#38d9c4', pattern: 'dots' },
    bullets: [
      '按压反馈 80–120ms、下沉 2px 必须有，否则用户会重复点',
      '成功/失败用颜色 + 形变双重编码，只变色不够',
      '微交互不该阻塞主流程，动画期间仍可继续操作',
    ],
    howto: '按钮、开关、表单提交这些高频操作；这是用户感知「流畅」最直接的地方。',
    sources: [{ label: '仓库', url: 'https://github.com/ddoemonn/interior' }],
  },
  {
    id: 'mo-rewards',
    name: '奖励型微交互（react-rewards）',
    oneLine: '彩带、粒子、数字跳动——把「你做对了」这件事做成看得见的奖励',
    source: 'https://github.com/thedevelobear/react-rewards',
    tags: ['动效风格', '微交互'],
    kind: 'demo',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/mo-rewards.png',
    bullets: [
      '只在真正的里程碑用（首次完成、连续打卡），天天放就没感觉了',
      '粒子 20–40 个足够，超过 100 会掉帧',
      '提供关闭开关：重复用户和晕动症人群需要它',
    ],
    howto: '游戏化、打卡、成就系统；和「微游戏快闪」那类视觉风格可以叠加。',
    sources: [
      { label: '仓库', url: 'https://github.com/thedevelobear/react-rewards' },
      { label: '封面（README 截图）', path: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/mo-rewards.png' },
    ],
  },
  {
    id: 'mo-animejs',
    name: 'anime.js（通用动画引擎）',
    oneLine: '一个 API 覆盖 CSS 属性、SVG、DOM 变换——写复杂时间线最省事',
    source: 'https://github.com/juliangarnier/anime',
    tags: ['动效风格', '动画引擎'],
    kind: 'demo',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/mo-animejs.png',
    bullets: [
      '时间线（timeline）比一堆 setTimeout 可靠，能统一控制播放/暂停/倍速',
      'stagger 参数直接做错峰，不用手写 delay',
      '体积约 17KB gzip，比 GSAP 轻；功能够用，生态小一些',
    ],
    howto: '需要编排多个元素、或做可暂停的演示时用；简单 hover 用 CSS 就够。',
    sources: [
      { label: '仓库', url: 'https://github.com/juliangarnier/anime' },
      { label: '封面（官网截图）', path: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/mo-animejs.png' },
    ],
  },
  {
    id: 'mo-mojs',
    name: 'mo.js（motion graphics 工具带）',
    oneLine: '为「图形运动」设计的库：形状、爆发、路径，做视觉特效比通用引擎顺',
    source: 'https://github.com/mojs/mojs',
    tags: ['动效风格', '动画引擎'],
    kind: 'demo',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/mo-mojs.png',
    bullets: [
      '内置 burst / swirl / path 这些「图形化」的运动预设',
      '适合封面动画、加载特效，不适合 UI 状态过渡',
      '声明式 API，学习曲线比 anime.js 陡',
    ],
    howto: '做视觉冲击强的开场/过渡，而不是日常交互；和「代码生视频」那层的动效风格互补。',
    sources: [
      { label: '仓库', url: 'https://github.com/mojs/mojs' },
      { label: '封面（官网截图）', path: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/mo-mojs.png' },
    ],
  },
  {
    id: 'mo-motionity',
    name: 'Motionity（网页动效编辑器）',
    oneLine: '浏览器里的 After Effects 简化版：拖元素、打关键帧、导出',
    source: 'https://github.com/alyssaxuu/motionity',
    tags: ['动效风格', '动画引擎'],
    kind: 'demo',
    cover: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/mo-motionity.png',
    bullets: [
      '适合不写代码的人做短动效，也适合快速试版式',
      '关键帧 + 缓动曲线的操作逻辑和 AE 一致，迁移成本低',
      '导出的是视频/GIF，不是可交互代码——别指望直接上生产',
    ],
    howto: '做提案、演示、短视频动效；要落地成代码还得重写一遍。',
    sources: [
      { label: '仓库', url: 'https://github.com/alyssaxuu/motionity' },
      { label: '封面（README 截图）', path: 'D:/github_project/ZhaoWen_GitHub维护/_design/covers/mo-motionity.png' },
    ],
  },
]

// 动效层这 10 条也全是别人的开源项目
for (const e of MOTION_ENTRIES) e.origin = 'referenced'

export const LAYERS = [
  { id: 'app', name: 'App 设计', hint: '手机 / 桌面应用的界面与产品设计', filters: ['App 风格', '桌面', 'Android', '动效', '产品设计'], entries: [...APP_ENTRIES, ...HUASHU_APP, ...LOCAL_PULLED_APP] },
  { id: 'frontend', name: '前端设计', hint: '网页、面板、主题皮肤、风格库、个人主页', filters: ['架构图', '个人主页', '网页风格', '中文版式', '主题', '浅色', '暗色', '极简', '大胆'], entries: [...styleEntries(), ...FRONTEND_EXTRA, ...HUASHU_FRONTEND, ...LOCAL_PULLED_FRONTEND, ...ARCH_ENTRIES, ...PERSONAL_HOME] },
  { id: 'video', name: '视频风格', hint: '短片 / 动效 / 片头的视觉风格与复刻方法', filters: ['动效风格'], entries: [...VIDEO_ENTRIES, ...LOCAL_PULLED_VIDEO, ...CODEVIDEO_ENGINES.filter((e) => e.layer === 'video')] },
  { id: 'codevideo', name: '代码生视频', hint: '用 HTML/CSS/JS 写视频：工作室 / 模板 / 渲染栈 + 八种可落地的视觉风格', filters: ['风格', '引擎', '开源', '零素材', '解释性'], entries: [...CODEVIDEO, ...CODEVIDEO_STYLES, ...CODEVIDEO_ENGINES.filter((e) => e.layer === 'codevideo')] },
  { id: 'comic', name: '漫画', hint: '动漫 / 漫画 / 动画的视觉语言：赛璐璐、木版画、网点、像素', filters: ['日系', '美式', '东方', '绘本', '漫画', '像素', '复古', '游戏'], entries: COMIC_ENTRIES },
  { id: 'motion', name: '动效设计', hint: '时间 / 缓动 / 编排 / 转场：界面「高级感」的那一半', filters: ['原则', '缓动与转场', '微交互', '动画引擎'], entries: MOTION_ENTRIES },
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
  const src = Array.isArray(entry.sources) ? entry.sources : []
  const cloud = src.find((s) => typeof s.url === 'string' && s.url !== '')
  const local = src.find((s) => typeof s.path === 'string' && s.path !== '')
  const lines = [
    `用设计工作台里的「${entry.name}」（${layer === null ? '' : layer.name} · ${entry.id}），按这个设计来。`,
  ]
  if (cloud !== undefined) {
    lines.push(`原始材料：${cloud.url}`)
    // 云端之外还有本地副本的（比如漫画层），一并给出——省得 AI 或人再翻一遍目录
    if (local !== undefined) lines.push(`本地副本：${local.path}`)
  } else if (local !== undefined) {
    lines.push(`原始材料：${local.path}`)
  }
  lines.push(`要看完整规格：design_style op=get ${entry.id}`)
  return lines.join('\n')
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
  'vid-bv-ref': 'referenced',
  'vid-rea-video': 'referenced',
  'vid-carl-flat': 'referenced',
  'vid-carl-ink': 'referenced',
  'vid-carl-clay': 'referenced',
  'vid-carl-blueprint': 'referenced',
  'vid-carl-exploded': 'referenced',
  'vid-carl-brick': 'referenced',
  'vid-carl-glass': 'referenced',
  'vid-carl-huashu': 'referenced',
  // 这八种「代码生视频风格」的手法来自 OpenMotion 的模板，我只是整理成条目 —— 不是我做的风格，算引用
  'cv-style-kinetic-type': 'referenced',
  'cv-style-dataviz': 'referenced',
  'cv-style-terminal': 'referenced',
  'cv-style-whiteboard': 'referenced',
  'cv-style-product-ui': 'referenced',
  'cv-style-parallax-cards': 'referenced',
  'cv-style-logo-reveal': 'referenced',
  'cv-style-sprite-2d': 'referenced',
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
