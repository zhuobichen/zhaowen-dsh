# 设计工作台（dsh-design-workbench）

把**这台电脑上的设计资料**整理成六层，看着挑，点一下就把「我要这种」变成 AI 能读到的记录。

```
App 设计（15）     手机 / 桌面应用 + huashu 的 App 风格库 + 本机拉来的桌面端（Jev 浮层 / Pinky / 她不一样）
前端设计（40）    本机八种样式 + 主题皮肤 + huashu 六区风格库 + 拉来的站（百年京张 / Archify /
                 Precision Data / Nature 图表理论 / 会议图表规范 / 价格对比站）+ 十种架构图版式
视频风格（12）    本机复刻与 carl-motion 八种动效 + 城市设计征集片 + AI 生视频链路（minimax MCP）
代码生视频（16）  引擎：HyperFrames（HeyGen，HTML→MP4）/ Remotion（React）/ Manim（数学动画）；
                 工程侧：OpenMotion 四条 + 选型对照；风格侧：八种纯代码可落地的动效风格
漫画（23）        动漫 / 漫画 / 动画视觉语言：赛璐璐 / 浮世绘 / 橡皮管 / UPA / 成人动画 / 网点 /
                 像素 RPG / HD-2D / 线条沸腾 / 8-bit / 蜡笔绘本 / 等距绘本 / 纸片立体书 /
                 皮影 / 剪纸 / Riso / 一笔画 / 微游戏 / 综艺扁平 / 综艺花字 / 贴纸人 / Synthwave / 拼贴
动效设计（10）    时间 / 缓动 / 编排 / 转场：动效原则、缓动曲线、页面转场、SVG 描线、
                 微交互、奖励动效，以及 anime.js / mo.js / Motionity 三个引擎与工具
```

共 **128 条**，其中自制 19 条、引用 109 条（huashu-design 与 OpenMotion 都在引用里，卡片上挂「引用」徽标）；另有 `design_scan` 扫进来的 4 条。

## 它解决什么

| 之前 | 现在 |
|---|---|
| 想指定风格只能形容，来回收敛 | 同一层里并排看，卡片直接给封面 / 换皮预览 / 海报 |
| 想精确指定就得翻仓库找那段 CSS | 卡片里给 token、圆角、密度、阴影、出处路径 |
| 说了「用那个蓝白的」，AI 还是猜 | 「选中它」落盘，AI 用 `design_style op=current` 直接读 |

## 六层里都有什么

**App 设计**：huashu-design 3.4 的八条 App 界面范式（外部方法层，注明来源）、MapMate（会说话的手机地图）、
VideoQuiz（视频成卷）、Q 版桌宠 HuaJing、余烬 Ember、AuroWendao 设计文档、DesktopJelly。

**前端设计**：八种量自本机代码的样式（DSH 原生基线 / 紧凑仪表盘 / 悬浮面板 / 侧滑抽屉 / 暗色玻璃卡 /
冷蓝绘本 / 等宽时间线 / 极简单行）＋ 超时空辉夜姬皮肤 ＋ 鲸鱼娘主题 ＋ WeSight 主题设计 QA。

**视频风格**：BV1KHaG6bEb9 复刻（洗衣机鲸鱼娘）、rea-video 逆向拆解方法、
carl-motion 的八种动效风格（扁平矢量 / 水墨 / 黏土定格 / 技术蓝图 / 爆炸视图 / 积木玩具 / 玻璃拟态 / 花叔人像）。

**代码生视频**：单独一层，16 条分三块——
- **引擎**：HyperFrames（HeyGen，HTML 里用 data 属性标时间轴，无头 Chrome + FFmpeg，Apache-2.0）、
  Remotion（React 组件即帧，注意商业授权）、Manim（Python 数学动画）
- **工程侧**：OpenMotion 四条（HTML 即视频、参考片重构五维、模板库与 Motion.md、Chromium+FFmpeg 渲染栈）+ 我写的选型对照
- **风格侧**：八种纯代码能落地的视觉风格（动力排版 / 数据动起来 / 终端与代码 / 白板手绘 /
  产品 UI 演示 / 视差卡片 / 品牌片头 / 2D 角色逐帧），每条都有「要点」与「怎么用」

**漫画**：动漫 / 漫画 / 动画的视觉语言，23 条。来源是本地参考仓库 `code-to-film/` 下的两套风格库——
[lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar)（66 种影片风格，每种一份 STYLE.md）与
[mg-styles-15](https://github.com/Vincentwei1021/mg-styles-15)（15 种 MG 风格，含完整源码）。
分五组：
- **日系 / 美式动画**：80 年代赛璐璐、浮世绘、1930s 橡皮管、50s UPA、成人动画
- **漫画印刷与线条**：半调网点、孔版印刷（Riso）、一笔画
- **绘本与手工**：蜡笔儿童绘本、等距绘本、纸片立体书
- **东方民间动画**：皮影戏、红色窗花剪纸
- **游戏与综艺**：16-bit 像素 RPG、HD-2D、线条沸腾、8-bit、微游戏快闪、综艺节奏扁平、综艺花字、粗描边贴纸人、80s Synthwave、拼贴剪贴

每条都指回原始 `STYLE.md` 或提示词，本层只做索引，不改原作。有云端的条目 `source` 写云端仓库位置、`sources[0]` 是云端原文 URL，本地副本排在后面。

**参考库丢了怎么重建**：这三个仓库是本地副本（约 740 MB），不进 git。丢了就跑

```bash
node scripts/fetch-libs.mjs                              # 拉到默认目录，已存在的跳过
node scripts/fetch-libs.mjs --mirror https://ghfast.top  # GitHub 直连不通时走镜像
node scripts/fetch-libs.mjs --dir D:/libs --only lemo,mg # 换位置 / 只拉其中几个
```

换位置后要把 `DESIGN_COMIC_SRC` 指到同一处，`catalog.js` 里 23 条封面与本地副本链接都跟着这个变量走。
两个踩过的坑都写进脚本注释了：下载用 node 原生 https（某些 curl 构建遇到无 content-length 的镜像响应会「假成功」），
解压时 GNU tar 必须加 `--force-local`（否则 Windows 盘符 `D:` 被当成远程主机名）。

**动效设计**：时间、缓动、编排、转场——界面「高级感」的那一半，和视觉风格是两件事。10 条分四组：
**原则**（LottieFiles 的 motion-design-skill、kylezantos 的 design-motion-principles，都是给 AI 读的规范）、
**缓动与转场**（easings.net 的曲线速查、barba.js 的页面转场、vivus 的 SVG 描线）、
**微交互**（点击后的半秒、奖励型反馈）、**引擎**（anime.js / mo.js / Motionity）。
每条都写了具体时间与距离（100–150ms 的微反馈、30–50ms 的错峰、400px 才用 spring），不是形容词。

**外部两套库怎么进来的**：
- [huashu-design](https://github.com/alchaincyf/huashu-design)（花叔，MIT）：92 种风格分 6 区，
  这里收 6 条分区总览 + 13 条代表作，样张是它仓库里的 jpg（已下载到 `_design/covers/` 本地副本，无网也能看）
- [OpenMotion](https://github.com/nexu-io/openmotion)（Apache-2.0）：4 条方法，封面用它的产品截图

**本机拉来的别人的仓**（third-party / _pull_check / github-repositories）也收进来了：
百年京张城市设计征集站、Archify（带 DESIGN.md 令牌表）、Precision Data 设计哲学、
Nature 论文图表理论、ML 会议图表规范、真实模型价格对比站；桌面端有 Jev 聊天助手浮层、
Pinky 产品设计文档、"她不一样" Skill 展示页；视频层加了一条城市设计征集片。
每条都指本地文件，不联网也能看。

## 面板怎么用

1. 顶部五个大标签切层（带条目数）；下面是这一层的筛选芯片 + 搜索。
   **筛选分两类，各归各位**：
   - **内容维度**（日系 / 架构图 / 极简……）直接铺一排，来自 `catalog.js` 里每层自己的 `filters`：
     语义不重叠、每个至少命中 2 条、覆盖本层主要群体。不再从条目 tags 自动提取——那些 tags 是写给自己的注释，
     200 个里 143 个只出现一次，拿来当筛选项一半以上点了只剩一条。条目的 tags 仍原样保留，搜索与 nature 判定照旧。
   - **数据维度**（只看风格 / 风格+素材 / 全部、全部来源 / 只看自制 / 只看引用）收进「更多筛选 ▾」，默认不占版面；
     整层都是风格、或整层只有一个来源时，对应的组连下拉里都不出现。选了非默认值，按钮会亮着提示当前有筛选。
2. 每张卡片的视觉区按条目类型三选一：
   - **图**：条目自带的封面（手机截图 / 主题背景 / 成片首帧），经 `/design-workbench/cover/<id>` 提供；
   - **样式**：同一块迷你界面的换皮预览（`iframe + srcDoc`，样式互不污染）；
   - **风格**：纯文字条目的海报（自带配色 + 图案），**不是成品帧**，只用来区分条目。
3. 点卡片 → 弹层：大图 / 会动的预览、要点、**原始材料**（原文 URL 或本机路径，可逐条复制）、怎么用、一行索引。
   - 代码生视频那八种风格不是截图，是**能跑的 HTML/CSS 动画**（纯 CSS，无脚本），打开就在演
   - 原始材料指向**原文**：huashu 的样张 jpg/html 与风格库总表、OpenMotion 的 README/SKILL/Motion.md、
     本机项目的 README/截图/场景源码——不是我的转述
4. 一个按钮：**复制引用（一行索引）**。

引用是**索引式**的，不把规格塞进对话（像 wiki 链接，不是把整页贴过来）：

```
用设计工作台里的「紧凑仪表盘」（前端设计 · dash-compact），按这个设计来。
原始材料：<原文 URL 或本机路径>
要看完整规格：design_style op=get dash-compact
```

AI 拿到这一行，需要细节时自己 `design_style op=get` 展开——完整规格（颜色/圆角/投影/密度/CSS/要点/怎么用）只存在工具里。

## 工具

```
design_style op=list                                  六层全列（按层分组）
design_style op=layer {app|frontend|video|codevideo|comic|motion}  只看一层
design_style op=get {id}                              完整规格（颜色/圆角/CSS/要点/怎么用）
design_style op=search {关键词}                       按名称/标签/出处搜（「水墨」「仪表盘」）
```

**这就是「AI 接触工作台数据的通道」**：面板是给人看的，工具是给 AI 读同一份 `catalog.js` 的。
面板「复制引用」复制的那两行索引，指向的正是 `op=get <id>`。工具只读，没有 pick/current
——工作台不再记录「选中了哪条」，选中这件事本身就是把索引粘到对话里。

写前端、做 App 原型、做视频/动效前先 `op=current` 或 `op=layer`：用户可能已经攒好参照了。

## 风格 / 方法 / 素材：规则判性质（classify.js）

不是每一条都算「风格」。`classify.js` 用**打分规则**（0 token、毫秒级）给每条判一个 `nature`：

| nature | 含义 | 例 |
|---|---|---|
| `style` | 能指着它说「照这个样子做」：有配色/字号/圆角/CSS 参数，或有可看的样张 | 硬件面板、水墨、动力排版 |
| `method` | 讲流程/工程/选型/规范的 | OpenMotion 渲染栈、参考片重构、HyperFrames |
| `reference` | 项目/站点/截图集，可参照但不是一套样式 | MapMate、个人主页 |

打分依据：颜色令牌 / 可播预览 / token 表（各 +3）、标签里的「风格/版式/配色」、
名字里的「风格/主义/式」、要点里出现 `px`/`#hex`/`border-radius` 这类具体参数、
有真样张；反向信号是标签/名字里的「方法/工程/流程/规范/理论」、出处指向 `SKILL.md`/`docs/`。

**面板默认只显示「风格 + 素材」，方法隐藏**（顶栏可切「只看风格 / 风格+素材 / 全部」）。
`design_style` 工具默认也只列风格，要看全部传 `nature=all`。

## 索引的规范格式（复制这句粘给 AI）

**整条**（一个风格）：

```
用设计工作台里的「<名称>」（<层> · <id>），按这个设计来。
原始材料：<原文 URL 或本机路径>
要看完整规格：design_style op=get <id>
```

**库里的某一种**（内页单项）：

```
用设计工作台里的「<库名>」第 N 种「<风格名>」（还原 xx%），按这个设计来。
原始材料：<该风格的样张原图地址>
要看完整规格：design_style op=get <库 id> member=N
```

N 从 1 起，和面板内页的序号一致。AI 拿到这句就能 `op=get <库 id> member=N` 精确取到那一条，
不用你在对话里解释「第几个」。

## 把新目录扫进来（design_scan）

从云端拉了一堆项目？不用手写 catalog：

```
design_scan op=scan id=D:/github_project/third-party        # 给根目录，depth 默认 3
design_scan op=add  id=all                                  # 或 id=fe-scan-xxx,app-scan-yyy
design_scan op=list                                         # 看已导入的
design_scan op=remove id=fe-scan-xxx                        # 删掉
```

判定只看文件名与 manifest：`DESIGN.md`/`style-guide`/`tokens`、`package.json` 里的
react/vue/next/tailwind/electron、`AndroidManifest.xml`/`.apk`、`remotion.config.*`/`scene.py`、
截图数量与 `index.html`。分到四层里（App / 前端 / 视频 / 代码生视频；漫画层靠手写目录，不参与扫描），封面取目录里最像封面的那张图。

导入的条目写在 `$DSH_HOME/plugins/dsh-design-workbench/extra.json`（覆盖层），
**不动 catalog.js**；工作台与工具都从「catalog + 覆盖层」合并后的结果读。
扫描有硬上限（4000 个目录 / 80 个候选），不会把磁盘扫穿。

## 数据落点

没有落点。这个插件**只读**：目录在 `catalog.js`，封面读本机文件，不写 `state.json`、不留审计。

## 怎么加的（新条目）

只改 `catalog.js` 一处：在对应层的 `entries` 里加一条 `{ id, name, oneLine, source, tags, kind, cover?|style?|swatch?, bullets, howto }`，
`prompt` 由 `promptOf()` 统一拼出来。封面只认这个小文件里写死的路径 —— `/cover/` 路由是白名单，不接受任意路径。

**有云端的条目必须标云端，不能只标下载之后的本地路径**：

- `source` 写云端仓库里的位置：`github.com/<org>/<repo> · <路径>`（面板「出处」、`specOf` 的「出处」都读它）
- `sources[0]` 必须是**云端原文 URL**，本地副本排在后面并加「本地 ·」前缀
- 原因：`refOf()` 的「复制引用」取 `sources[0]`。粘给 AI 的应该是云端地址 —— 别人能打开、能核对，
  而不是 `D:/...` 这种只在这台机器上成立、换个环境就断的路径
- 漫画层就是这么做的（见 `catalog.js` 里 `CLOUD` 那段：从本地路径反推 `blob/main/` 地址，一次补完 10 条）

**加一层时别忘了写 `filters`**：`{ id, name, hint, filters: [...], entries }`。
`filters` 是这一层面板上显示的那排筛选芯片，要求：语义互不重叠、每个至少命中 2 条、合起来覆盖本层主要群体。
不写也能用，但会回退到「从 tags 自动提取」，效果通常很差。

## 改完之后怎么生效（省一次重启）

| 改的是 | 生效方式 |
|---|---|
| `client.js`（面板） | 页面按 F5（客户端 bundle 按内容哈希发号） |
| `index.js` / `catalog.js`（宿主） | 用 `plugin_manager` 把 `include:design-workbench` 禁用再启用一次——宿主会重新 import 模块，**不用重启整个 DSH**；之后面板点「刷新」即可 |
| `package.json` / 新增包 | 必须重启 DSH（boot 图在启动时组装） |

2026-11-22 的现场：面板已经换成新版（界面文字是新的），但接口还返回旧的 `styles`，
于是网格空白——就是宿主半身没重载。禁/启用一次后 `/state` 立刻变成三层。

## 边界

- 只读本机文件；写盘只有 `state.json` 与 `changes.jsonl` 两个小文件。
- 不改宿主主题，不注入全局 CSS（面板自己的样式挂 `data-design-workbench`）。
- 预览是静态 HTML，无脚本；不读其它插件的 DOM 或样式表。
- 目录只有 `catalog.js` 一份，宿主与面板共用，不会两处漂移。
