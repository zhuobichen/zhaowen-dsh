# @zhuobichen/dsh-agent-supervisor

「管理Bot」Agent：一个**管理其它会话**的插件——派活、查状态、改名、记记忆，外加右下角一个能跟它
直接对话的头像。

一个包两半：

| 位置 | 做什么 |
| --- | --- |
| **宿主**（`index.js`） | 注册 6 个 `dsh_*` 工具；开两条 HTTP 路由给面板取数据 |
| **客户端**（`client/client.js`） | `shell.overlay` 上的头像（可拖动）、点开是聊天面板、语音输入 |

纯 JS 手写，**没有 TypeScript、没有构建步骤**：装进去就能跑。

---

## 一、设计上没有「删除」这一类能力

**这不是漏写，是设计。**

注册的工具只有 6 个，一个都不碰「让东西消失」：

```
dsh_sessions_list    列会话
dsh_session_send     往指定会话发一条消息
dsh_session_start    新建会话并让它跑一个任务
dsh_session_status   查某个会话最近在干什么
dsh_session_rename   改会话标题
dsh_memory           记/读/列长期记忆
```

没有 `delete` / `cancel` / `archive` / `remove` / `purge` / `kill`。原因很直白：

- 管理Bot可以**派活**，但不可以**抹掉别人的活**；
- 「取消正在跑的活」和「删除会话记录」都会让一次误判变成不可恢复的损失，
  而这两件事用户自己在侧栏/输入框里都能做——不需要一个 Agent 代劳；
- 这个插件还会被**任何会话**的 Agent 看见（见下面「安全边界」），所以能力边界必须
  是「越用越安全」的那一侧。

测试里有一条断言专门盯这个：`宿主：注册了 6 个工具，且没有任何 delete / cancel / archive / remove`。
它会同时检查工具名和描述，任何人以后偷偷加一个删除类工具，测试立刻红。

---

## 二、安全边界（必读）

### 这些工具任何会话都看得见

工具注册在 `ctx.tools` 的**全局**层。也就是说：**任何会话的 Agent 都能在工具列表里看到
`dsh_session_send` 之类的工具，并且能调用**——不只是「管理Bot」。

这是插件形态决定的，不是配置问题。为了不把这个事实变成风险，默认开着一条闸：

```yaml
config:
  onlySupervisor: true   # 默认 true
```

`onlySupervisor: true` 时，每个工具的执行都会先回答一个问题：**调用方会话的标题在不在白名单里**。

- 是 → 放行；
- 不是 → 返回 `{ ok:false, code:'FORBIDDEN', error:'...' }`（不是抛异常，模型能读懂并停手）；
- 拿不到调用方会话（没有绑定 agent/session）→ 同样 `FORBIDDEN`。

### 标题白名单：不只「管理Bot」一个会话能用

白名单默认只有 `管理Bot` 一项。想让别的会话（例如你自己常用的那一个）也能派活，
在插件配置里追加标题即可——**只增不减**，`管理Bot` 永远在、并且排第一：

```yaml
- id: agent-supervisor
  name: '@zhuobichen/dsh-agent-supervisor'
  config:
    supervisorTitles:
      - '管理Bot'
      - '豆包'
```

- 也接受单个字符串：`supervisorTitles: 豆包`；
- 前后空白会被 `trim`，空白项 / 非字符串 / 重复项静默跳过——配置写错最差退化成默认白名单，不会抛；
- **两个标题同时存在时**，客户端右下角面板和 `/chat` 路由仍然优先找「管理Bot」那个会话
  （按白名单顺序取第一个命中），所以多一个白名单标题不会让面板换目标。

判定只看**标题**，因为标题是用户唯一改得动、也唯一看得见的那个标签：

1. 先问 `ctx.sessionTitle.get(session)?.title`（`@deepseek-ai/dsh-session-title`）；
2. 服务不在位时，自己折会话日志里最后一条 `session/title` 事件（`data.title`）。

两条都不依赖外部包，所以「这个部署没装 session-title」不会让闸门变成「一律放行」。

> 把 `onlySupervisor` 设为 `false` 就等于把「派活 / 改标题 / 写记忆」开放给所有会话。
> 你知道自己在做什么再关。

### 每条工具只做一件事

- 所有工具都**先校验 `session_id` 真实存在**：活会话对象 → 宿主会话列表 → 冷读标题快照，
  三级判据任何一级命中才算存在；三级全挂就返回 `SESSION_LOOKUP_UNAVAILABLE`，
  不会退化成「发给最近活跃的那个会话」。
- `dsh_session_send` 的返回里**带目标会话的标题**，方便核对「发对人了」。
- 除了「新建会话」（`dsh_session_start` 的职责本身）之外，没有任何工具改会话内容以外的
  系统状态。

---

## 三、宿主半身：6 个工具用什么服务实现的

用的是宿主服务，**不走 HTTP 打自己**（0.2.1 的 `/api/*` 已经不是 0.1 那套了）。
所有服务都用 `ctx.get(name)` 现取：取不到就如实报「这个能力在当前部署不可用」，
不假装成功。

| 工具 | 靠什么实现 | 源码位置 |
| --- | --- | --- |
| `dsh_sessions_list` | `ctx.sessionController.list({}, signal)`（`@deepseek-ai/dsh-api-session-controller`）；退路是 `ctx.sessions.list()` + `ctx.sessionTitle` | `index.js` `listRowsOf` / 工具 `dsh_sessions_list` |
| `dsh_session_send` | `ctx.sessionController.prompt({ requestId, sessionId, mode:'queue', content:[{type:'text',text}] }, signal)` | `index.js` 工具 `dsh_session_send` |
| `dsh_session_start` | `ctx.sessionController.create({ cwd })` → `rename(...)` → `prompt(...)` | `index.js` 工具 `dsh_session_start` |
| `dsh_session_status` | 活会话 `session.snapshotEvents()`；冷会话 `ctx.sessionQuery.listEvents()` → `ctx.sessionController.inspect()` | `index.js` `eventsOfSession` |
| `dsh_session_rename` | `ctx.sessionController.rename({ sessionId, title })` | `index.js` 工具 `dsh_session_rename` |
| `dsh_memory` | 纯文件：`$DSH_HOME/plugins/dsh-agent-supervisor/memory/facts.jsonl` + `notes.md` | `index.js` `appendFact` / `readFacts` |

**`sessionController` 就是 API 会话控制器那个服务**（`dsh-api-session-controller` 的
`ctx.sessionController`，`prompt` / `create` / `rename` / `list` / `inspect` 都是它的公开
非 Remote 面）。`mode:'queue'` 是「排队，不打断它手上正在做的事」。

### 做不到 / 有代价的，如实说

- **`dsh_session_status` 想要「最后一条助手回复」就得读事件。** 活会话读内存快照很便宜；
  冷会话只有 `sessionQuery.readSession()`（整份日志，重）或 `sessionController.inspect()`
  （也是整份）。事件量大的冷会话会让这次调用变慢——所以我只取尾巴 8 条 + 最后一句文本。
- **没有「订阅」**：状态是一次快照，不是推送。要看变化就再调一次。
- **没有删除类**：见第一节。

### 配置

```yaml
- id: agent-supervisor
  name: '@zhuobichen/dsh-agent-supervisor'
  config:
    onlySupervisor: true      # 默认 true：只有标题在白名单里的会话能执行工具
    supervisorTitles:         # 默认 ['管理Bot']；只增不减，管理Bot 永远在且排第一
      - '管理Bot'
      - '豆包'
    web: true                 # 默认 true：开 /dsh-agent-supervisor/* 两条路由
    memoryDir: ''             # 可选：覆盖记忆落盘目录（测试用它指到包内 .tmp/）
```

---

## 四、宿主路由（给客户端面板取数据）

前缀 `/dsh-agent-supervisor`，用 `ctx.inject(['webServer'])` + `webServer.register({kind:'prefix'})`
注册（和 `@zhuobichen/dsh-novel-pane` 同一写法）。

### `GET /dsh-agent-supervisor/chat`

```json
{
  "ok": true,
  "sessionId": "session-…",
  "title": "管理Bot",
  "messages": [
    { "id": "seq-2", "role": "user",  "text": "你好", "atMs": 1730000000000 },
    { "id": "seq-3", "role": "agent", "text": "收到", "atMs": 1730000001000 }
  ]
}
```

失败时（**不编假消息**）：

```json
{ "ok": false, "code": "NO_SUPERVISOR",         "message": "还没有「管理Bot」会话：…",        "messages": [] }
{ "ok": false, "code": "TRANSCRIPT_UNAVAILABLE", "message": "暂时读不到管理Bot会话的内容…", "sessionId": "session-…", "messages": [] }
```

消息从哪来（三级，取到为止）：

1. **活会话**：`session.snapshotEvents()` → 取 `user/message` / `assistant/message`；
2. **冷会话**：`ctx.sessionQuery.readSession(id)` → 同一套事件；
3. **兜底**：`ctx.sessionController.inspect(id, signal)`。

两个刻意的过滤：

- `user/message` 只认 `source.kind === 'user'` 的（真人打的字）；system 注入的上下文、
  文件变更通知不冒充「你说的话」。
- 落过 replacement 的 assistant 事件（`surfaceOp !== 'append'`）跳过——那是给模型看的历史，
  不是用户已经看见过的对话。

### `POST /dsh-agent-supervisor/chat`

body `{ "text": "..." }` → 把这句话发进管理Bot会话的队列（`mode:'queue'`）。

```json
{ "ok": true, "sessionId": "session-…", "title": "管理Bot" }
```

没有管理Bot会话 → `{ ok:false, code:'NO_SUPERVISOR' }`；发不出去 → `{ ok:false, code:'PROMPT_FAILED' }`。

---

## 五、客户端半身：右下角的头像 + 面板

- 槽位：`shell.overlay`（`kind:'list'`、`scope:'root'`，条目自己开 `pointer-events`），`order: 880`。
- 图标：`assets/agent-128.png` 的 base64 **内联**进 bundle，`<img src="data:image/png;base64,…">`。
  56px 圆形容器、`object-fit:cover`、一圈很淡的描边 + 阴影。**不用 emoji**（中文字体下会变怪符号）。
- 样式：注入一个 `data-plugin` / `data-plugin-css` 标记的 `<style>`，类名全部 `dshas_` 前缀，
  不污染全局。
- 拖动：pointer 事件（`onPointerDown` → `window` 上的 `pointermove` / `pointerup`），
  `touch-action:none`；**位移 > 4px 才算拖动**，拖动结束会吞掉随后那次 `click`；
  位置存 `localStorage['dsh-agent-pos'] = {x,y}`（按钮左上角，视口坐标）；
  拖动/恢复/resize 三处都把位置夹在视口内（8px 边距）。
- 点击：切换面板（不跳转会话）。
- 面板：约 360×520，跟着头像走但夹在视口内；宽高用 CSS `min()` 自适应窄屏。
  头部「管理Bot」+ 关闭；消息区（用户右侧、Agent 左侧，可滚动，新消息自动滚到底）；
  底部输入行 = `textarea` + 麦克风 + 发送。
- 麦克风：`webkitSpeechRecognition` / `SpeechRecognition`，点一下开始、再点结束，
  结果**只写进草稿**，不自动发送。
- 轮询：面板开着时每 4 秒 GET 一次（Agent 的回复是异步来的）。
- 读不到消息时：面板里显示一句可读的话 + 一个**「打开管理Bot会话」**按钮（退路）；
  没有管理Bot会话时：「还没有『管理Bot』会话…」+ 一个**「新建管理Bot会话」**按钮
  （`ctx.sessions.create` → 会话面 `rename('管理Bot')` → `refresh`；任何一步失败都只变成提示）。

### 客户端能自动新建会话吗？——能

`@deepseek-ai/dsh-api-session-controller` 的客户端面 `ISessions` 有：

- `create(opts?): Promise<SessionId>`（`client/contract/sessions.d.ts`）
- `retain(...)` + `binding.session.rename(title)`（`client/contract/session.d.ts`）
- `refresh(): Promise<void>`

所以「新建管理Bot会话」是**真的做了**，不是 TODO。见 `client/client.js` 的
`createSupervisorSession`。它仍然包在 try/catch 里：改名失败只影响名字，不影响新建。

---

## 六、测试

```bash
node test/contract.test.ts
```

Node 24 直接跑（原生剥类型，不需要编译）。它加载的是**真正会被装载的那两份源码**：
宿主 `index.js` 与客户端 `client/client.js`。

宿主半身运行时才 `import('@deepseek-ai/dsh-tools')`（peerDependency，由 DSH 提供）。
这个仓库里它在 `dsh/toolchain/node_modules` 下，所以测试用 `node:module` 的
`registerHooks` 把这个裸模块名接到那份**真实实现**上——测的是真的 `defineTool`
（schema 编译 + 参数校验），不是替身。

覆盖：

| 类别 | 断言 |
| --- | --- |
| 信封 | `id == package.json name`；`factory` 交出 `apply`/`inject`；顶层无 import/export；`require` 只碰 react |
| 宿主 | 注册**正好 6 个**，且名字/描述里没有 delete/cancel/archive/remove/drop/purge/kill |
| 宿主 | 每个工具的返回值都按它自己的 `output.schema` 校验一遍 |
| 宿主 | `dsh_session_send` 传不存在的 id → `SESSION_NOT_FOUND`、不抛、一条都没发出去 |
| 宿主 | `dsh_session_send` 发对目标 → 返回里带标题 |
| 宿主 | `dsh_session_start` 建会话 + 改名 + 发第一条 |
| 宿主 | `dsh_session_status` 报最后几条事件与最后一句文本 |
| 宿主 | `dsh_session_rename` 只改标题，返回旧标题 |
| 宿主 | `dsh_memory` put → get 回同值；`facts.jsonl` / `notes.md` 真落盘在包内 `.tmp/` |
| 宿主 | `dsh_memory` 写不进目录时**不抛**（只报 `MEMORY_WRITE_FAILED`） |
| 宿主 | `onlySupervisor`：非白名单会话调用 6 个工具全部 `FORBIDDEN`，且没有任何副作用；关掉开关就通 |
| 宿主 | `supervisorTitles`：白名单里的标题（含脏配置 `'  豆包  '` / `''` / `42`）能执行工具，名单外仍 `FORBIDDEN`；不写这项时只有「管理Bot」 |
| 宿主 | 没有 `sessionTitle` 服务时，标题仍能从日志折出来 |
| 路由 | `GET /chat` 回消息；`POST /chat` 的 body 里带 text；没有管理Bot / 读不到时如实报 |
| 客户端 | `shell.overlay` 注册、组件是函数；图标是 `<img>` 且 `src` 以 `data:image/png;base64,` 开头（还会解回 PNG 比对大小） |
| 客户端 | 点头像开面板（标题「管理Bot」+ 输入框），再点收起 |
| 客户端 | 两条消息渲染成气泡（用户右、Agent 左） |
| 客户端 | 发消息 → `POST /chat` 的 body 里带 `text` |
| 客户端 | 读消息失败 → 可读提示 + 「打开管理Bot会话」按钮（点了确实 openSession） |
| 客户端 | 没有管理Bot会话 → 可读提示 + 「新建管理Bot会话」 |
| 客户端 | 拖动 20px → 不开面板、不发请求、位置写进 `localStorage` |
| 客户端 | 位移 2px → 当点击处理 |
| 客户端 | 位置越界/窄屏/resize 都被夹回视口 |

---

## 七、已知的坑 / 还没验证的

- **面板的宿主侧延迟**：4 秒轮询意味着 Agent 的回复最多晚 4 秒出现。
- **冷会话读转录是整份日志**（见上文），长会话会慢。
- 这台机器上 DSH 是运行中的、我没装这个包，所以**真实浏览器里的效果没实测**：
  拖动、面板定位、麦克风、`min()` 在窄屏下的表现都只有单元测试背书（假 DOM/假 fetch）。
- 头像素材：`assets/agent-128.png`（以及它的 `.b64.txt`）是包里现成的那张图，**没有重新生成**。
- `.tmp/` 是包内测试目录（已被仓库 `.gitignore` 忽略）；本机删目录不一定删得掉，
  所以测试用「每次一个新子目录」而不是「先清空」。
