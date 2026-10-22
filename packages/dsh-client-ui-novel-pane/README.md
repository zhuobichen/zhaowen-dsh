# dsh-client-ui-novel-pane

`@zhuobichen/dsh-novel-pane` 的**浏览器半身**：输入框上方一行「读书」入口 +
右侧一块 `position: fixed` 的阅读区（槽位 `conversation.input.dock`，order 16——
余额与月光之下、队列之上）。

| 做什么 | 怎么做 |
| --- | --- |
| 入口 | 永远显示一行 `📖 读书`；阅读区开着时右侧顺带显示当前书名 /「书库」 |
| 书库 | 点「读书」→ `GET /dsh-novel-pane/library` 拿索引 + `GET /state?rows=N&shelf=1` 拿目录；标题 + 类型徽标（TXT/MD/EPUB/PDF）+ 所在目录 |
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
| 测试 | `node test/reading-mode.test.ts`（12 条原有 + 5 条书库索引） |

分页、折行、书单、位置全在宿主，这里只管画和转译点击。`.mobi/.azw3` 这类真不支持的
文件，宿主会在 `skipped` 里给原因，书库页底部显示一条说明。
