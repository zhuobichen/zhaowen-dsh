# dsh-client-ui-novel-pane

`@zhuobichen/dsh-novel-pane` 的**浏览器半身**：输入框上方一行「读书」入口 +
右侧一块 `position: fixed` 的阅读区（槽位 `conversation.input.dock`，order 16——
余额与月光之下、队列之上）。

| 做什么 | 怎么做 |
| --- | --- |
| 入口 | 永远显示一行 `📖 读书` + 小字「内置」；阅读区开着时右侧顺带显示当前书名 /「书库」/「灵台阅读器」 |
| **灵台阅读器** | 点「读书」→ `POST /dsh-novel-pane/lingtai`（宿主：探测 → 没在跑就 `python server.py` → 最多等 12 秒）→ 右侧面板里渲染 `<iframe src={返回的 url}>`；期间按钮显示「正在启动…」 |
| 灵台失败 | 面板里给宿主返回的可读错误 + 「重试」+「新标签打开」（拿到 url 时）；不会 alert |
| 新标签兜底 | 面板头部 / 错误页的「新标签打开」→ `window.open(url, '_blank', 'noopener')`；被拦时 dock 下方出现可点的「点这里手动打开」（走 `location.href`） |
| 内置面板 | dock 行的「内置」小按钮 / 灵台面板头部的「内置」→ 切回书库面板，一条功能都没删 |
| 书库 | `GET /dsh-novel-pane/library` 拿索引 + `GET /state?rows=N&shelf=1` 拿目录；标题 + 类型徽标（TXT/MD/EPUB/PDF）+ 所在目录 |
| 分组 | 顶部 `全部 / 电子书 / PDF`（电子书 = epub + txt + md），纯前端过滤 |
| 搜索 | 按标题 / 原文件名过滤（纯前端，不发请求） |
| 分页 | 一次只画 50 条，点「显示更多」再加 50（列表可能上百条） |
| 打开一本（索引） | 点书名 → `POST .../move` `{op:"open-path", path}`（绝对路径） |
| 打开一本（目录） | 点书名 → `{op:"open-book", name}`（`name` 相对书库目录） |
| 接着读 | 书库顶部那一行 → `{op:"open"}` |
| 正文 | 宿主返回的 `text`；`up` / `down` / `top` / `goto`（界面行号从 1 数，宿主从 0）/ `wheel` / `mode` |
| 换目录 / 开文件 | 输入框先试 `open-path`（文件）；宿主回 `not a file` 再试 `browse`（目录，带 `shelf:true` 直接拿书单） |
| 布局让位 | 打开时给 `documentElement` 加 `dshnp-reading`，注入 `html.dshnp-reading #root{width:calc(100vw - var(--dshnp-w,440px))}`；关闭 / 连不上 / 卸载都摘掉 |
| 轮询 | 正文视图每 3 秒取一次 `/state`，在提示框里敲 `/novel n` 右边也会跟着翻 |
| 测试 | `node test/reading-mode.test.ts`（17 条）+ `node test/lingtai.test.ts`（6 条灵台链路） |

分页、折行、书单、位置全在宿主，这里只管画和转译点击。`.mobi/.azw3` 这类真不支持的
文件，宿主会在 `skipped` 里给原因，书库页底部显示一条说明。

## 灵台阅读器（iframe）

灵台阅读器是另一个独立 web app（`lingtai-reader`，`python server.py`，默认 8769）。
它的响应头**没有** `X-Frame-Options`、也没有 CSP `frame-ancestors`，所以本页（3080）
可以把它嵌进右侧面板；跨端口 = 跨源，浏览器**不允许**我们读它的 DOM，所以：

- iframe 加载失败（被扩展拦、端口后来挂了）我们**检测不到**——面板头部的「新标签打开」
  就是那条退路，别删。
- 它的 `localStorage` 在 iframe 里是**它自己的 origin**（`http://localhost:8769`）：
  和 3080 的存储互不相干，书架 / 上次读到哪由它自己记，刷新 page 也不会丢。**不要**
  为了这一点去改它的代码。
- 宿主 `GET /dsh-novel-pane/lingtai` 只查状态，不启动任何东西；`POST` 才会拉起。
