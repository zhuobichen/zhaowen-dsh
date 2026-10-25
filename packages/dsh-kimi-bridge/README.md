# dsh-kimi-bridge

DSH ↔ Kimi Code 双向会话迁移。宿主插件，纯 ESM，无构建（`node:zlib` 的 zstd 需要 Node ≥ 22.15）。

```
GET  /dsh-kimi/list                           列出 Kimi Code 会话（只读）
GET  /dsh-kimi/export-preview?dshSessionId=…  DSH → Kimi 的 dry-run
POST /dsh-kimi/export                         写 Kimi 会话（apply:true 才写）
GET  /dsh-kimi/import-preview?sessionId=…     Kimi → DSH 的 dry-run
POST /dsh-kimi/import                         写 DSH 会话（apply:true 才写）
```

```js
export const name = "dsh-kimi-bridge";
export const inject = ["webServer"];
export function apply(ctx, config = {}) { … }
```

`config`（全部可选）：`kimiRoot`（Kimi sessions 根目录，测试只对副本操作）、`kimiHome`、
`dshRoot`（DSH sessions 根目录）、`listProcesses`（进程名枚举，测试注入桩）、`now`。

---

## 1. `workspaceKey` 的派生规则

**观测结论**：key 形如 `wd_<盘符小写>_<sha256(调用点传入的路径字符串)[0..12]>`，哈希**大小写敏感**。

两个真实样本（同一台机器、同一个 `D:\` 根）都对得上：

| key | 出处 | 哈希输入 | sha256[0..12] |
|---|---|---|---|
| `wd_d_4eac808749fa` | `sessions/` 目录名 | `"D:"` | `4eac808749fa` ✅ |
| `wd_d_394e0f7e2f80` | `workspace-trust/` 文件名 | `"d:"` | `394e0f7e2f80` ✅ |

`workspaces.json` 佐证了 `root` 与 key 的对应：`{"wd_d_4eac808749fa":{"root":"D:\\","name":"D:"}}`；
`state.json` 里 `cwd: "D:\\"`，即 key 来自**工作区根**，而不是某个会话的 cwd。

**没推出来的部分**：`wd_` 与盘符之间的连接规则只有 `D:` 一个盘符的证据，所以插件**不拿它去臆造**
新工作区。原因很实际：新建工作区要写 `~/.kimi-code/workspaces.json`（在 `sessions/` 之外，明确禁止），
而且 Kimi 自己的列表以 `workspaces.json` 为准，凭空造一个 `sessions/<key>/` 只会变成孤儿目录。

**替代策略**（`kimi.js: chooseWorkspace`）：

1. 显式传 `workspaceKey` → 必须是 sessions 根目录下**已存在**的 key，否则 `400 UNKNOWN_WORKSPACE`。
2. 否则挑已有工作区：`root` 是会话 cwd 祖先的最长匹配 → 退化为"最近打开"（`workspaces.json.last_opened_at`）。
3. 回执里一定带 `workspace: { workspaceKey, root, matchedBy, reason }`，`reason` 是中文说明
   （例如"复用已有工作区 wd_d_4eac808749fa（root=D: 是会话 cwd 的祖先，但不等同）"）。

`export-preview` / `export` 的 `target.workspaceKey` 就是这一步的结果，调用方看得见、也能覆盖。

---

## 2. wire.jsonl 行的分类

样本：`~/.kimi-code/sessions/wd_d_4eac808749fa/session_465a214d-…/agents/main/wire.jsonl`（29 行，`protocol_version: "1.5"`，时间戳是**毫秒**）。

### 环境声明 —— 克隆模板时照抄（只改 `time` / `agentId` / `workspaceId` / `cwd`）

| 行 | 作用 | 克隆时怎么处理 |
|---|---|---|
| `metadata` | `{protocol_version, created_at}` | 照抄 `protocol_version`，`created_at` 换成本次写入的起点 |
| `runtime.set_binding` | `{workspaceId, runtimeId, agentId}` | **`workspaceId` 改成目标 workspaceKey**，`agentId: "main"` |
| `mcp.tools_discovered` | MCP 工具清单（20 KB） | 原样照抄（环境事实，不是会话内容） |
| `profile.bind` | 模型别名 / systemPrompt / `environmentDisclosure.cwd` / 工具白名单 | 照抄；显式给了 `cwd` 时只改 `environmentDisclosure.cwd` |
| `changeNotifier.snapshot` | agentsMd / skills / subagent 名单 | 原样照抄 |
| `config.update` | `thinkingEffort` | 原样照抄 |
| `permission.set_mode` | `mode` | 原样照抄 |
| `llm.tools_snapshot` | 工具定义快照（80 KB） | 原样照抄 |
| `plugin.session_start` | `{content: null}` 会话开始标记 | 原样照抄 |

### 会话内容 —— 按导入的对话重写（新 id / promptId / turnId / time）

| 行 | 生成方式 |
|---|---|
| `agent.message.appended`（user） | 每个 user 消息一条：`meta.source="input"`、`promptId`、`userMessageId`、`createdAt`(ISO) |
| `agent.turn.started` | `{turnId, queueItemId: promptId}`，`turnId` 从 0 起 |
| `turn.prompt` | `{input:[{type:"text",text}], origin:{kind:"user"}, promptId, turnId}` |
| `context.append_message`（user） | `message:{role:"user", content:[text], id:promptId, toolCalls:[], origin:{kind:"user"}}` |
| `context.append_message`（assistant） | `{role:"assistant", content:[text], id:"msg_"+ULID, toolCalls:[…]}` |
| `agent.message.appended`（assistant） | UI 流：`meta.model={provider:"agent-loop"}`, `meta.finish`, `messageId:"chatcmpl-…"` |
| `context.append_message`（tool） | `{role:"tool", content:[text], id, toolCallId}` |
| `agent.turn.ended` | `{turnId, outcome:"done"}` |
| `turn.ended` | `{turnId, reason:"completed", durationMs, traceId}`（32 位十六进制） |

### 直接丢掉 —— 它们是"上一轮对话的实测数据"，复制过来就是伪造

`llm.request`、`usage.record`、`token_counting.measured`、`token_counting.turn_recorded`、
`context.append_loop_event`（`step.begin`/`content.part`/`step.end`）、`prompt.completed`。
`mcp.tools_discovered` / `llm.tools_snapshot` / `usage.record` / `plugin.session_start` /
`changeNotifier.snapshot` / `config.update` / `permission.set_mode` 也从**新造**的意义上不伪造：
前两类是从模板照抄的环境声明，后几类直接丢。

### 额外写的文件

`<sessionId>/state.json` —— 照样本字段重建（`id/version:2/cwd/archived/agents.main.homedir/
custom/title/titleKind/createdAt/updatedAt/lastPrompt/lastTurnReason/isCustomTitle`）。
没有它 Kimi 侧多半看不到会话；这属于**推断**（见第 6 节）。

`notify/state.json`、`logs/`、`.index-cache/`、`.index-dirty/`、`server/events/` 一律不写。

### id 与时间

| 东西 | 规则 | 证据 |
|---|---|---|
| Kimi sessionId | `session_<uuid>` | 样本 `session_465a214d-…` |
| 消息 / prompt id | `msg_<26 位 ULID>`（前 10 位编码毫秒时间） | 样本 `msg_01M5MV4M08RX7ER7VHF9ZTME4B` |
| `turnId` | 0 起递增 | 样本 `turnId: 0` |
| `traceId` | 32 位小写十六进制 | 样本 `54f8f1bcb6d71972b588e9138e7d7478` |
| 所有时间 | **毫秒**，逐行严格递增 | 样本 `time: 1792774655980` |

---

## 3. 字段映射表

### 3.1 DSH → Kimi（export）

| DSH v4 事件 | Kimi wire 行 | 映射 |
|---|---|---|
| `system/message` | —— | 丢弃（Kimi 的 systemPrompt 在 `profile.bind`，由模板提供） |
| `user/message` | `turn.prompt` + `context.append_message(user)` + `agent.message.appended(user)` | 文本 → `content:[{type:"text",text}]` |
| `assistant/message` 的 `text` 块 | `context.append_message(assistant).content[].text` | 一个 turn 内多条 assistant 各自成条 |
| `assistant/message` 的 `tool-call` 块 | assistant 的 `toolCalls[]` + `tool/call`（**无对应行**，Kimi 只把调用挂在消息上） | `{id, type:"function", function:{name, arguments}}` |
| `assistant/message` 的 `reasoning` 块 | `content[].think`（可选，默认丢） | `{type:"think", think, reasoningKey:"reasoning_content"}` |
| `tool/result` | `context.append_message(role:"tool")` | 文本 + `toolCallId` |
| `step/start` / `step/end` / `turn/start` / `turn/end` | `agent.turn.started` / `agent.turn.ended` / `turn.ended` | turn 边界，step 折叠掉（Kimi 没有 step 概念） |
| `session/title` | —— | 进 `state.json.title`（Kimi 侧用 `state.json`，不是 wire） |

### 3.2 Kimi → DSH（import）

| Kimi wire 行 | DSH v4 事件 | 映射 |
|---|---|---|
| `context.append_message(origin.kind !== "injection")` | `user/message` / `assistant/message` / `tool/result` | `content[]` 的 `text`/`think` 块 → `text`/`reasoning`；`toolCalls[]` → `tool-call` 块 |
| `agent.message.appended` | 同上（**真实会话的 assistant 回复只在这里**） | `message.message` |
| `turn.prompt` | `user/message`（兜底） | `input` |
| `origin.kind === "injection"`（`<system-reminder>`） | —— | 丢弃（是注入，不是对话） |
| —— | `turn/start` / `step/start` / `step/end` / `turn/end` | 合成：user 一个 step，每条 assistant（+ 它的工具结果）一个 step |
| —— | `system/message` | 合成一条说明性 system 消息，必须是 surface 的**第一个节点** |
| 工具调用 | `tool/call` + `tool/result` | callId 对齐；缺结果的调用补 `TOOL_OUTCOME_UNKNOWN` 错误结果 |
| `state.json.title` | `session/title` | `{title, messageSeqs:[userSeq], source:{kind:"fallback"}}` |

---

## 4. 写路径与安全边界

**Kimi 侧**（`kimi.js: writeKimiSession`）
- 只写 `<sessionsRoot>/<workspaceKey>/<sessionId>/agents/main/wire.jsonl` 与同级 `state.json`。
- 目标已存在 → `409 ALREADY_EXISTS`；`force:true` → 先把旧目录 `rename` 成 `<sessionId>.bak-<ts>` 再写。
- Kimi 在跑（进程名匹配 `kimi|moonshot`，大小写不敏感）→ `409 KIMI_RUNNING`，**零写入**（检查在读取目标之前）。

**DSH 侧**（`dsh.js`）
- 读：`ctx.sessionQuery.readSession(id)` → `ctx.sessionController.inspect(id)` → `ctx.sessions.get(id)`；
  都不行才解文件 `session.v4.jsonl.zstd`（`28 B5 2F FD` 切帧 + `zstdDecompressSync`）。
- 写：`ctx.sessions.create(id, { seed, meta:{ cwd } })` → `ctx.sessions.flush(session)`；
  没有会话服务时退回写文件（同一套 seed → zstd 帧）。

**永不触碰**：`.index-cache/`、`.index-dirty/`、`server/events/`、`session_index.jsonl`、
`workspaces.json`（只读）、`~/.kimi-code` 里 `sessions/` 之外的一切。

---

## 5. 测试

```powershell
cd packages/dsh-kimi-bridge
node --test "test/*.test.ts"     # 13 个用例，全部只对 .tmp/ 里的副本操作
```

覆盖：读副本 → 导出（3 user + 3 assistant + 1 tool）→ 模板克隆哨兵 → 进程桩 409 → 幂等/force 备份
→ 导入假 ctx（并用 DSH 自己的 `Session.create` 复核 seed）→ 解真实 `dsh/home/sessions` 会话。

`test/helpers.ts` 里的 `copyTree` / `removeTree` 是手写的：这台机器上 `fs.cpSync` 会 EIO、
`fs.rmSync` 会静默不删（都发生在含中文的长路径上），所以测试脚手架不用它们。

---

## 6. 未验证项（写真实 `~/.kimi-code` 之前要知道）

1. **`wd_d_` 前缀规则**只有 `D:` 盘一个盘符的证据；非 D: 盘 / 非根目录工作区未验证。
   当前策略是"复用已有工作区"，所以导出到 `D:\` 之外会带一条"root 不等同"的说明。
2. **`toolCalls` 形状**：样本会话里从没发生过工具调用。现在按 OpenAI 形状
   （`{id, type:"function", function:{name, arguments}}`）+ `context.append_message(role:"tool", toolCallId)`
   写；Kimi 真机型如何记录工具结果**未验证**。
3. **`state.json` 是否必需**：没有它 Kimi 列表很可能看不到会话；字段是照样本抄的，但没有真机重开验证。
4. **assistant 的 `origin`**：样本里 assistant 只在 `agent.message.appended`，`context.append_message`
   的 assistant 没有可参照的 `origin` —— 插件选择**不写** `origin`（缺省比写错枚举安全）。
5. **`session_index.jsonl` / `.index-cache`**：故意不更新。Kimi 下次启动会自己重建索引；
   "新会话什么时候出现在侧栏"未验证。
6. **DSH 侧 seed 的合法性**：只用打包的 `@deepseek-ai/dsh-session` 的 `Session.create` 复核过
   （`deriveMessages()` 给出 system/user/assistant 三条），没有在活的 DSH 里 `create + flush` 过
   （本任务不允许重启 DSH）。

**真往 `~/.kimi-code` 写还差的前提**
- Kimi Code 必须**完全退出**（含托盘/后台进程，`tasklist` 里不再有 `kimi*`/`moonshot*`）。
- 目标 workspaceKey 必须已经在 `workspaces.json` + `sessions/` 里存在（插件不新建工作区）。
- 建议先 `GET /dsh-kimi/export-preview` 看 `target`、`counts`、`sample`，再 `POST` 带 `apply:true`。
- 写入后由 Kimi 自己重建 `.index-cache` / `session_index.jsonl`；如果侧栏没出现，先完全退出再启动一次。
