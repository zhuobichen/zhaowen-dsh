# @zhuobichen/dsh-deliverables-index

**「文档总览」的宿主半身**：把**每个会话各自产出过哪些文档**摊成一张表，让「找文件」不用再先想起来是哪个对话。

数据不是扫盘猜的——DSH 的 `present` 工具本来就把「哪个会话呈现过哪个文件」写进了会话日志（`deliverables/presented` 事件）。这个包只做四件事：

1. 列最近 N 个会话（默认 50）；
2. 读每个会话的事件、折出所有 `deliverables/presented`；
3. 把日志里的路径按**会话 cwd** 解析成绝对路径，并且**真查一次文件在不在**；
4. 把这份清单通过 `GET /dsh-deliverables/list` 交给浏览器那半（**本包内的客户端半身** `client/client.js`）。

宿主半身和客户端半身在同一个包里，**装一次就够**。

---

## 安装

```sh
dsh plugin --profile web add ./packages/dsh-deliverables-index
```

或者（发布后）从 npm 装。装完重启 `dsh web` 并刷新页面，右下角会出现一个文件图标。

---

## 路由

前缀 `/dsh-deliverables`（客户端那半写死同一个串）。

### `GET /dsh-deliverables/list`

查询参数：

| 参数 | 说明 |
|---|---|
| `limit` | 最多列最近多少个会话（1–500，默认 50） |
| `refresh=1` | 绕过进程内缓存，强制重读会话日志 |

返回：

```json
{
  "ok": true,
  "generatedAt": "2026-10-24T00:40:00.000Z",
  "cached": false,
  "ttlMs": 20000,
  "limit": 50,
  "source": "sessionController",
  "desktop": { "name": "Windows", "available": true, "fileManager": "explorer", "canOpen": true },
  "totalSessions": 2,
  "totalFiles": 3,
  "totalMissing": 1,
  "sessions": [
    {
      "sessionId": "sess-A",
      "title": "写报告",
      "updatedAt": "2026-10-20T10:00:00.000Z",
      "cwd": "D:\\work",
      "presentedCount": 3,
      "files": [
        {
          "name": "报告.md",
          "path": "D:\\work\\报告.md",
          "displayPath": "报告.md",
          "ext": "md",
          "description": "最终报告",
          "turn": 2,
          "seq": 12,
          "index": 0,
          "time": 1792700000000,
          "url": "api/present.open?sessionId=sess-A&seq=12&index=0",
          "fileUrl": "api/file?path=D%3A%5Cwork%5C%E6%8A%A5%E5%91%8A.md",
          "exists": true
        }
      ]
    }
  ]
}
```

字段约定：

- `exist === false` 的文件是**真的不在了**（`fs.existsSync` 查过），客户端会把它灰掉、点不动。绝不假装能打开。
- `path` 永远是绝对路径；`displayPath` 是给人看的那一版（在 cwd 里面就给相对路径，在家目录里给 `~/…`）。
- `seq` / `index` 是打开时定位用的坐标：`seq` 是那条 `deliverables/presented` 事件的序号，`index` 是它 `files` 数组里的原始下标。
- 读某个会话失败**不会**让整个请求挂掉：那一行带 `error`（真实原因，例如「readSession：日志损坏」），`files` 为空，别的会话照常返回。

### `POST /dsh-deliverables/open`

body：

```json
{ "sessionId": "sess-A", "seq": 12, "index": 0, "action": "open" }
```

- `action` 只能是 `open`（默认）或 `reveal`（在文件夹里显示），别的回 **400 `BAD_ACTION`**，且**不会**碰到宿主原生打开。
- 坐标不合法回 400；事件里没有这个下标回 404 `NOT_IN_EVENT`；文件不在回 404 `FILE_MISSING`；宿主没有原生打开能力回 501 `NO_NATIVE_OPEN`；原生打开自己失败回 502 `OPEN_FAILED`。
- 成功回 `200 { ok: true, action, path, displayPath, name, ext }`。

---

## 三种「打开」，区别在这里

| 方式 | 路由 | 调用方 | 依赖 | 说明 |
|---|---|---|---|---|
| **① 官方交付物路由**（首选） | `POST api/present.open?sessionId&seq&index[&action=reveal]` | 客户端直接 fetch | 宿主桌面（`workspaceDesktop().available`） | 就是 `@deepseek-ai/dsh-client-ui-deliverables` 里 `presentedFileUrl()` 生成的那条地址。**它不需要经过本插件**，本插件只是把 URL 拼好放进 `url` 字段。 |
| **② 本插件的 `/open`** | `POST /dsh-deliverables/open` | 客户端或任何脚本 | `ctx.sessionController.openWorkspacePath` | 走宿主服务的原生打开，功能等价；好处是路由在本插件自己的前缀下，排错时可以直接 curl。 |
| **③ 浏览器直读**（兜底） | `GET api/file?path=<绝对路径>` | 客户端在新标签打开 | 无 | 宿主没有桌面（`available: false`）或 ① 失败时用。PDF / md / txt / 图片浏览器自己就能看，docx 会下载。 |

客户端的行为：**点一行 → ① → 失败就退到 ③**，并把原因写在面板底部；「在文件夹里显示」走 ① 的 `&action=reveal`。

### `presentedFileUrl` 的真实形状（2026-10 版）

源码位置：`@deepseek-ai/dsh-client-ui-deliverables/lib/client.js:273-317`

```js
const PRESENT_OPEN_PATH = "/api/present.open";
const PRESENT_OPEN_ROUTE = PRESENT_OPEN_PATH.slice(1); // "api/present.open"（文档相对！）

function presentedFileUrl(sessionId, seq, index) {
  return `${PRESENT_OPEN_ROUTE}?${new URLSearchParams({ sessionId, seq, index })}`;
}
```

- **没有 body**：`action` 是 **query 参数**（`?action=open|reveal`），不是 POST body（`lib/index.js:144-151`）。
- 路由同时挂了 `GET` 和 `POST`（`lib/index.js:67-71`）：`GET` 返回「这个文件能用哪些应用打开」的列表；`POST` 才是真的打开（`lib/index.js:128-143`），成功回 **204** 空体。
- 宿主没有桌面时回 **409**；坐标非法 / action 非法回 400；事件或文件找不到回 404（`lib/index.js:104-108, 144-167`）。

---

## 配置（都可以不写）

```yaml
- insert:
    - id: deliverables-index
      name: '@zhuobichen/dsh-deliverables-index'
      config:
        limit: 50        # 最多列最近多少个会话（1-500）
        ttlMs: 20000     # 列表 + 每会话折叠结果的进程内缓存（0 = 不缓存）
        skipBlank: true  # 跳过 seq 为 0 的空白会话（不可能有 present）
        web: true        # false = 只加载不注册路由
```

## 缓存

两层，都在进程内：

- `list:<limit>`：整份响应，默认 20 秒。`?refresh=1` 会 `clear()` 整个缓存。
- `session:<id>@<updatedAt>`：单个会话的折叠结果；会话一有新事件 `updatedAt` 变，key 就变，自然失效。

为什么要缓存：第一次点开面板要把最近 50 份会话日志读一遍（本机 73 份日志实测约 3 秒，含 6.8 MB 那一份），不缓存的话每次点都是这个代价；缓存太长又会看不到刚产出的文档，20 秒是这两头之间的取值。

## 实现要点（为什么这么写）

- **只认日志里记过的那一条**。`deliverables/presented` 的 payload 按官方校验规则校验（`turn` 是 ≥1 的整数、`callId` 非空、`files` 是数组、每个 `path` 非空），不合规就当没这条——不猜、不补。
- **相对路径按会话 cwd 解析**，不是按宿主进程的 cwd。模型写 `./out/report.md` 时只有这样才对。
- **同一份文件在一个会话里出现多次**（改了两版、present 两次）→ 按绝对路径去重，**后面的赢**（保留最新一次的 turn/seq/时间，打开时用它定位）；`presentedCount` 保留原始条数。
- **读取顺序**：活会话先读内存快照（免费）→ `sessionQuery.readSession`（完整日志 + 重放校验）→ `sessionController.inspect`。三条都不通时把**每一层的失败原因**带回去，而不是一句「读不到」。
- **`open` 定位**：先 `sessionQuery.readEvent` 精确读那一条事件，读不到才退回整份日志里找。
- 服务依赖：`inject` 只声明 `webServer`；`sessionController` / `sessionQuery` / `sessions` 在调用时用 `ctx.get()` 现取——缺了要如实报「读不到」，不该让整个插件加载不起来。

## 已知边界

- **`/dsh-deliverables` 没有额外鉴权**。它和本仓库的 `dsh-novel-pane`、`dsh-agent-supervisor` 一个路子：`webServer.register({kind:'prefix'})`，宿主默认只监听回环地址（`127.0.0.1`），所以本机可用。**如果把 webServer 的 `host` 改成局域网地址，这条路由会把绝对路径暴露给同网段**，那时请自行加保护（或只装客户端包并改用 ① 那条官方路由）。
- **`exists` 是宿主本进程看到的文件系统**。文件在别的机器 / 容器里（远程执行场景）时，这个探测反映的不是那台机器。
- **只覆盖调用过 `present` 的会话**。模型只是把文件写在回复里（`[说明](path)`）而没有调用 `present`，日志里就没有这条事件，这里也就没有它。这是「不猜」的代价。
- **子会话（subagent）也算独立会话**：它的 `present` 记在它自己的日志里，会和父会话各占一组。`origin: "subagent"` 会如实带出来。
- 会话上限默认 50（`limit`），更早的会话不出现在默认视图里；要更多就调大 `limit`（代价是更慢）。

## 测试

```sh
cd packages/dsh-deliverables-index && node test/host.test.ts
```

25 个用例，真跑 `index.js` 的假 Cordis 上下文（假会话日志 + 真文件系统）：

- 两条 `deliverables/presented`（2 个 + 1 个文件）→ 3 个文件、按会话分组；
- 相对路径按会话 cwd 解析；
- `exists` 反映真实文件系统（包内 `.tmp/` 造真文件与「不存在的文件」）；
- 某会话读取抛错 → 其它会话照常、该行带 `error`；
- 空白会话跳过、不合规事件忽略、`?limit=` / `config.limit` / 缓存 / `?refresh=1`；
- `POST /open` 的 `action` 透传（open / reveal）、未知 action 400、文件不在 404、无能力 501；
- 缺 `sessionQuery` 时退回 `inspect`、连列表通道都没有时 500。

## License

MIT
