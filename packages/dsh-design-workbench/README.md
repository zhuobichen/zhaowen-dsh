# 设计工作台（dsh-design-workbench）

把**这台电脑上的设计资料**整理成三层，看着挑，点一下就把「我要这种」变成 AI 能读到的记录。

```
App 设计（7）    手机 / 桌面应用的界面与产品设计
前端设计（11）   网页、面板、主题皮肤（八种样式量自本机代码）
视频风格（10）   短片 / 动效 / 片头的视觉风格与复刻方法
```

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

**视频风格**：BV1KHaG6bEb9 复刻（洗衣机鲸鱼娘）、rea-video 逆向拆解方法，
以及 carl-motion 的八种动效风格（扁平矢量 / 水墨 / 黏土定格 / 技术蓝图 / 爆炸视图 / 积木玩具 / 玻璃拟态 / 花叔人像）。

## 面板怎么用

1. 顶部三个大标签切层（带条目数）；下面是这一层的标签芯片 + 搜索。
2. 每张卡片的视觉区按条目类型三选一：
   - **图**：条目自带的封面（手机截图 / 主题背景 / 成片首帧），经 `/design-workbench/cover/<id>` 提供；
   - **样式**：同一块迷你界面的换皮预览（`iframe + srcDoc`，样式互不污染）；
   - **风格**：纯文字条目的海报（自带配色 + 图案），**不是成品帧**，只用来区分条目。
3. 点卡片 → 细节：大图 / 大预览、要点、怎么用、完整「引用给 AI」正文。
4. 两个按钮：**选中它 → AI 可见**（写 `state.json` + 审计）、**复制引用（一行索引）**。

引用是**索引式**的，不把规格塞进对话（像 wiki 链接，不是把整页贴过来）：

```
用设计工作台里的「紧凑仪表盘」（前端设计 · dash-compact），按这个设计来。
要看完整规格：design_style op=get dash-compact
```

AI 拿到这一行，需要细节时自己 `design_style op=get` 展开——完整规格（颜色/圆角/投影/密度/CSS/要点/怎么用）只存在工具里。

## 工具

```
design_style op=list                三层全列（按层分组）
design_style op=layer {app|frontend|video}  只看一层
design_style op=get {id}            完整规格（spec，几百字）+ 一行索引
design_style op=current             用户当前选中的那一条（含 prompt）
design_style op=pick {id}           替用户选中（他说「就用那个水墨的」时用）
```

写前端、做 App 原型、做视频/动效前先 `op=current` 或 `op=layer`：用户可能已经攒好参照了。

## 数据落点

```
$DSH_HOME/plugins/dsh-design-workbench/
  state.json      { picked: {id, at, by}, recent: [...] }
  changes.jsonl   append-only 审计（pick / 谁选的 / 什么时候）
```

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
