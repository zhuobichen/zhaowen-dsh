# @zhuobichen/dsh-client-ui-deliverables-index

**「文档总览」的浏览器半身**：右下角一个文件图标，点开就是**每个会话各自产出了哪些文档**——搜索、按类型筛、点一行直接用系统应用打开，或者退到浏览器里看。

数据来自配套的宿主插件 [`@zhuobichen/dsh-deliverables-index`](../dsh-deliverables-index) 的 `GET /dsh-deliverables/list`。**两个都装**才看得到面板；只装这一个，面板会如实显示「连不上文档索引服务」。

这个包是手写的 `window.__ModuleLoader__` 信封（无构建步骤），`require` 只用 `react` / `react/jsx-runtime`，挂在 `shell.overlay` 槽位（和 `dsh-client-ui-novel-pane` 同一个槽）。

---

## 长什么样

- **收起时**：右下角一个 40px 圆形按钮（inline SVG 文件图标），`aria-pressed` 标开合。
- **展开后**：396px 宽、60vh 高的面板，默认贴右下角（在输入框上方 50px），可拖动表头移动，位置记 localStorage。
- 面板顶部是标题 + 文件总数 + 刷新 / 收起；下面是搜索框 + 类型筛选（全部 / md / pdf / docx / txt / 其他）；再下面是按**会话标题分组**的列表：每行 = 类型徽标 + 文件名 + 描述（灰字）+ 时间。
- 底部一行：`已显示 / 共 N 个文件`、`· M 个不在了`、以及最近一次操作的提示（"已用系统默认应用打开：…"）。

## 交互

| 操作 | 行为 |
|---|---|
| 点悬浮球 | 展开 / 收起（开合记 localStorage，切会话重挂也不收） |
| 拖表头 | 移动面板；夹在视口内；松手落盘（`dshdi-pos`） |
| 搜索框 | 按**文件名 / 描述 / 会话标题 / 路径**过滤（大小写不敏感） |
| 类型页签 | 只看某一类；`其他` 收下 md/pdf/docx/txt 之外的一切 |
| 点一行 | 打开：先 `POST api/present.open?sessionId&seq&index`（官方交付物路由，宿主原生打开）；失败就退到 `api/file?path=…` 新标签直读，并把原因写在底部 |
| 行尾文件夹图标 / 右键 | `&action=reveal`，在文件管理器里定位 |
| 灰掉的行（`exists:false`） | **不可点**：没有 `onClick`、没有 reveal 按钮、不发任何请求，行上写「文件不在了」 |

打开失败的原因会翻成人话，不把 HTTP 状态码直接甩给用户：409 → 「这个宿主没有桌面，不能交给系统应用打开」、404 → 「宿主那边找不到这个文件」、401/403 → 「没有权限（页面登录态可能过期了，刷新一下）」…

## 空态 / 错误态

- 真的一个文件都没有：**「还没有任何会话产出过文档。需要有会话调用过 present 工具，它呈现的文件才会出现在这里。」**
- 有文档但筛没了：「没有匹配的文档：清掉搜索词或换一个类型。」
- 宿主连不上：可读错误 + 「重试」按钮（不会画半截列表）。
- 某个会话读不到（日志损坏 / 没有读取通道）：那个分组下面单独一行「这个会话读不到：…」——**不假装它没有文件**。

## 样式隔离

- 根节点和 style 标签都带 `data-plugin="dsh-deliverables-index"`；
- 所有类名带 `dshdi_` 前缀，规则全部挂在 `.dshdi_root` 下面；
- 覆盖层根节点 `position: fixed; inset: 0; pointer-events: none`（整页覆盖但不吃点击），只有悬浮球和面板自己 `pointer-events: auto`；
- 不写 body / 全局元素选择器。

## 它调用的接口

| 请求 | 用途 |
|---|---|
| `GET /dsh-deliverables/list` | 会话 → 文件清单（宿主半身提供） |
| `POST api/present.open?sessionId&seq&index[&action=reveal]` | 宿主原生打开 / 在文件夹里显示（DSH 自带的交付物路由，`presentedFileUrl()` 生成的那条） |
| `GET api/file?path=<绝对路径>` | 桌面不可用时的浏览器兜底（新标签） |

## 测试

```sh
cd packages/dsh-client-ui-deliverables-index && node test/panel.test.ts
```

15 个用例，加载的是**真正下发给浏览器的** `client/client.js`，用假的 `__ModuleLoader__` / `document` / `react` / `fetch` 跑整条链：

- 信封 id == `package.json` name、`require` 只有 `react` / `react/jsx-runtime`、注册进 `shell.overlay`；
- 点悬浮球开面板 → 出现会话标题分组与文件名、分组数量、描述、时间；再点一次收起；
- 搜索框过滤（按标题 / 描述）、类型筛选（pdf）、切回全部；
- 点一行 → `POST api/present.open?...`（断言 URL 与 method，不带 action）；
- 「在文件夹里显示」→ 同一个 URL 加 `&action=reveal`；
- `exists:false` 的行：没有 `onClick`、`aria-disabled`、没有 reveal、点/右键都不发请求；
- 409（宿主没桌面）→ `window.open` 拿到 `api/file?path=…`；被拦截（返回 null）→ 只留可读失败提示；
- 空态点名 `present`；读不到的会话单独说明；宿主连不上 → 错误 + 重试；
- 纯函数 `kindOf` / `presentUrl` / `clampPos`；位置从 localStorage 恢复。

## License

MIT
