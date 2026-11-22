# 设计工作台（dsh-design-workbench）

把**这台电脑上的设计资料**整理成三层，看着挑，点一下就把「我要这种」变成 AI 能读到的记录。

```
App 设计（12）     手机 / 桌面应用 + huashu 的 App 风格库（硬件面板 / 液态玻璃 / Monzo / Things 3 …）
前端设计（24）    本机八种样式 + 主题皮肤 + huashu 的网页/PPT/信息图/中文东亚/小红书风格库
视频风格（10）    本机复刻与 carl-motion 的八种动效风格
代码生视频（13）  工程侧：OpenMotion 的工作室 / 参考片重构 / 模板与 Motion.md / 渲染栈 + 选型对照；
                 风格侧：动力排版 / 数据动起来 / 终端与代码 / 白板手绘 / 产品 UI 演示 /
                 视差卡片 / 品牌片头 / 2D 角色逐帧（八种都能纯代码落地）
```

共 **59 条**，其中自制 25 条、引用 34 条（huashu-design 与 OpenMotion 都在引用里，卡片上挂「引用」徽标）。

## 它解决什么

| 之前 | 现在 |
|---|---|
| 想指定风格只能形容，来回收敛 | 同一层里并排看，卡片直接给封面 / 换皮预览 / 海报 |
| 想精确指定就得翻仓库找那段 CSS | 卡片里给 token、圆角、密度、阴影、出处路径 |
| 说了「用那个蓝白的」，AI 还是猜 | 「选中它」落盘，AI 用 `design_style op=current` 直接读 |

## 三层里都有什么

**App 设计**：huashu-design 3.4 的八条 App 界面范式（外部方法层，注明来源）、MapMate（会说话的手机地图）、
VideoQuiz（视频成卷）、Q 版桌宠 HuaJing、余烬 Ember、AuroWendao 设计文档、DesktopJelly。

**前端设计**：八种量自本机代码的样式（DSH 原生基线 / 紧凑仪表盘 / 悬浮面板 / 侧滑抽屉 / 暗色玻璃卡 /
冷蓝绘本 / 等宽时间线 / 极简单行）＋ 超时空辉夜姬皮肤 ＋ 鲸鱼娘主题 ＋ WeSight 主题设计 QA。

**视频风格**：BV1KHaG6bEb9 复刻（洗衣机鲸鱼娘）、rea-video 逆向拆解方法、
carl-motion 的八种动效风格（扁平矢量 / 水墨 / 黏土定格 / 技术蓝图 / 爆炸视图 / 积木玩具 / 玻璃拟态 / 花叔人像）。

**代码生视频**：单独一层，13 条分两半——
- **工程侧**：OpenMotion 四条（HTML 即视频、参考片重构五维、模板库与 Motion.md、Chromium+FFmpeg 渲染栈）+ 我写的选型对照
- **风格侧**：八种纯代码能落地的视觉风格（动力排版 / 数据动起来 / 终端与代码 / 白板手绘 /
  产品 UI 演示 / 视差卡片 / 品牌片头 / 2D 角色逐帧），每条都有「要点」与「怎么用」

**外部两套库怎么进来的**：
- [huashu-design](https://github.com/alchaincyf/huashu-design)（花叔，MIT）：92 种风格分 6 区，
  这里收 6 条分区总览 + 13 条代表作，样张是它仓库里的 jpg（已下载到 `_design/covers/` 本地副本，无网也能看）
- [OpenMotion](https://github.com/nexu-io/openmotion)（Apache-2.0）：4 条方法，封面用它的产品截图

## 面板怎么用

1. 顶部三个大标签切层（带条目数）；下面是这一层的标签芯片 + 搜索。
2. 每张卡片的视觉区按条目类型三选一：
   - **图**：条目自带的封面（手机截图 / 主题背景 / 成片首帧），经 `/design-workbench/cover/<id>` 提供；
   - **样式**：同一块迷你界面的换皮预览（`iframe + srcDoc`，样式互不污染）；
   - **风格**：纯文字条目的海报（自带配色 + 图案），**不是成品帧**，只用来区分条目。
3. 点卡片 → 细节：大图 / 大预览、要点、怎么用、完整「引用给 AI」正文。
4. 一个按钮：**复制引用（一行索引）**。

引用是**索引式**的，不把规格塞进对话（像 wiki 链接，不是把整页贴过来）：

```
用设计工作台里的「紧凑仪表盘」（前端设计 · dash-compact），按这个设计来。
要看完整规格：design_style op=get dash-compact
```

AI 拿到这一行，需要细节时自己 `design_style op=get` 展开——完整规格（颜色/圆角/投影/密度/CSS/要点/怎么用）只存在工具里。

## 工具

```
design_style op=list                        三层全列（按层分组）
design_style op=layer {app|frontend|video}  只看一层
design_style op=get {id}                    完整规格（颜色/圆角/CSS/要点/怎么用）
design_style op=search {关键词}             按名称/标签/出处搜（「水墨」「仪表盘」）
```

**这就是「AI 接触工作台数据的通道」**：面板是给人看的，工具是给 AI 读同一份 `catalog.js` 的。
面板「复制引用」复制的那两行索引，指向的正是 `op=get <id>`。工具只读，没有 pick/current
——工作台不再记录「选中了哪条」，选中这件事本身就是把索引粘到对话里。

写前端、做 App 原型、做视频/动效前先 `op=current` 或 `op=layer`：用户可能已经攒好参照了。

## 数据落点

没有落点。这个插件**只读**：目录在 `catalog.js`，封面读本机文件，不写 `state.json`、不留审计。

## 怎么加的（新条目）

只改 `catalog.js` 一处：在对应层的 `entries` 里加一条 `{ id, name, oneLine, source, tags, kind, cover?|style?|swatch?, bullets, howto }`，
`prompt` 由 `promptOf()` 统一拼出来。封面只认这个小文件里写死的路径 —— `/cover/` 路由是白名单，不接受任意路径。

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
