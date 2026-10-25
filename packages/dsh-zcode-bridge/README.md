# dsh-zcode-bridge

**DSH ↔ ZCode 双向会话迁移**（DSH 插件，纯 JS，无构建）。

- **ZCode → DSH**：读 `~/.zcode` 的 CLI 会话库，转成 DSH 的 v4 会话（走 `ctx.sessions.create()` + `flush()`，没有该服务时直接写 v4 日志文件）。
- **DSH → ZCode**：读 DSH 的 zstd 多帧会话日志，写进 ZCode 的 `session` / `message` / `part` 三张表。

写库是这套东西里唯一危险的部分，所以默认全是 dry-run：

> 不传 `apply:true` 就一行都不写；写 ZCode 还要求 **ZCode 进程没在跑**，写完前先备份 `db.sqlite`，
> 全程 `BEGIN IMMEDIATE` 单事务，失败整体 `ROLLBACK`；同名会话再来一次直接 `409 ALREADY_EXISTS`。

---

## 1. 安装

```bash
# 在 DSH 的 profile 里挂上（二选一）
dsh plugin add @zhuobichen/dsh-zcode-bridge
# 或者手动把这一条插进 profile：
#   - id: dsh-zcode-bridge
#     name: '@zhuobichen/dsh-zcode-bridge'
```

重启 DSH 后打开 <http://127.0.0.1:3080/dsh-zcode/> 有个不依赖前端构建的小面板。

要求：Node ≥ 22.6（用到 `node:sqlite` 与 `node:zlib` 的 zstd）。插件本身 **零运行时依赖**，不需要 `npm install`，不需要 `tsc`。

## 2. 路由

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/dsh-zcode/list` | ZCode 会话列表 `{ok, sessions:[{id,title,directory,updatedAt,messages,…}]}` |
| GET | `/dsh-zcode/preview?sessionId=<zcode>` | **ZCode → DSH 的 dry-run**：`{target:{cwd,title,dshSessionId}, counts, sample:[{role,text}]}` |
| POST | `/dsh-zcode/import` | `{sessionId, apply?, titlePrefix?, force?}`，`apply:true` 才写 DSH |
| GET | `/dsh-zcode/export-preview?dshSessionId=…` | **DSH → ZCode 的 dry-run**：要写几张 session/message/part、目标 `project_id`、标题 |
| POST | `/dsh-zcode/export` | `{dshSessionId, apply?, title?, directory?, projectId?, force?}`，`apply:true` 才写 ZCode |
| GET | `/dsh-zcode/schema` | 抽样证据：表/行数、`part.data.type`、`role`、`semantics.*`、`project_id` 推导命中情况 |
| GET | `/dsh-zcode/dsh-sessions` | 本机 DSH 会话列表（export 的候选目标） |
| GET | `/dsh-zcode/` | 小面板（列两边会话、点按钮 dry-run / 真导） |

错误一律是 `{ok:false, code, message, detail?}`：

| code | HTTP | 什么时候 |
| --- | --- | --- |
| `ZCODE_RUNNING` | 409 | 检测到 `ZCode.exe` 在跑；**连备份都不做**，直接拒绝 |
| `ZCODE_STATE_UNKNOWN` | 500 | 检测不到进程状态（`tasklist` 不可用）——为安全起见也不写 |
| `ALREADY_EXISTS` | 409 | 同名 `slug`/`title` 已存在（`detail.existingId` 给出已有 id）；`force:true` 可越过 |
| `BACKUP_FAILED` | 500 | 备份失败或备份大小对不上；**此时一行都还没写** |
| `WRITE_FAILED` | 500 | 事务中出错，已 `ROLLBACK`；`detail.cause` 是原始错误 |
| `DB_BUSY` | 503 | 库打不开（还有别的连接占着） |
| `SCHEMA_MISMATCH` | 500 | 库里缺 session/message/part 表 |
| `SESSION_NOT_FOUND` / `DSH_SESSION_NOT_FOUND` | 404 | 找不到会话 |
| `NO_DIRECTORY` | 400 | DSH 会话没有 cwd，派生不出 ZCode `directory` |
| `EMPTY_SESSION` | 400 | 源会话没有任何可见消息 |

## 3. 安全模型（顺序就是 `applyExport()` 的语句顺序）

```
① apply === true                 ← 缺省 dry-run，false/缺省 一律不写
② detectZCodeRunning()           ← 镜像名 zcode.exe/ZCode.exe（大小写无关），在跑 → 409，且此时还没备份
③ backupDatabase()               ← copyFileSync 到 db.sqlite.bak-<YYYYMMDD-HHMMSS>，再核对 size；失败 → BACKUP_FAILED
④ new DatabaseSync + 幂等复查     ← 备份与事务之间别人可能刚写过，所以这里再查一次同名
⑤ BEGIN IMMEDIATE                ← 拿写锁，防并发写者
⑥ INSERT session / message / part ← 只碰这三张表
⑦ COMMIT  /  出错 ROLLBACK        ← 回滚后库仍可正常写（有测试）
```

进程检测只认**镜像名**，不认路径：`tasklist /FO CSV /NH` 全量列举后过滤 `/^zcode\.exe$/i`。不用 `/FI IMAGENAME eq …` 是因为那个过滤的语义在窗口版本之间不完全一致，而"漏判成没在跑"的代价是硬写别人正在用的库。

## 4. 抽样证据（真实库，只读副本）

全部出自 `node scripts/sample-zcode.mjs`（读 `.tmp/base.sqlite`，只读连接）：

```
## 表与行数
  session 7 / message 460 / part 1739 / session_input 25 / session_entry 91
  tool_usage 443 / model_usage 394 / turn_usage 18 / todo 34 / input_history 18
  triggers: message_sequence_autofill, part_sequence_autofill

## part.data.type
{ tool: 443, 'step-start': 395, 'step-finish': 388, text: 264, reasoning: 246, timeline: 3 }
  tool.state.status: { completed: 434, error: 8, running: 1 }

## message.data.role / semantics.*
  role: { assistant: 398, user: 62 }                       ← 只有两个值
  semantics.origin: { agent_runtime: 436, real_user: 21, system: 3 }
  semantics.kind: { assistant_response: 395, todo_reminder: 30, user_prompt: 21,
                    background_notification: 7, system_reminder: 4, timeline_event: 3 }
  uiVisibility:        { visible: 419, hidden: 41 }
  providerVisibility:  { visible: 457, hidden: 3 }
  transcriptVisibility:{ visible: 419, hidden: 41 }
```

每种 `part.data.type` 的真实形状（字段名逐字来自库，不是猜的）：

```jsonc
{"type":"text","text":"你好","time":{"start":1792764374906,"end":1792764374906}}

{"type":"step-start"}

{"type":"reasoning","text":"The user just said …","metadata":{"anthropic":{"signature":"78cb…"}},
 "time":{"start":…,"end":…}}

{"type":"step-finish","reason":"stop","cost":0,
 "tokens":{"total":27643,"input":27557,"output":86,"reasoning":0,"cache":{"read":22080,"write":0}}}

{"type":"tool","callID":"call_ddd6d7e35ae04a2b98780159","declarationIndex":0,"tool":"Bash","metadata":{},
 "state":{"status":"completed","input":{"command":"ls -la …","description":"…"},
          "output":"total 0\n…","title":"Bash",
          "metadata":{"schemaVersion":1,"serialization":{…}},
          "time":{"start":…,"end":…}}}

{"type":"tool", … "state":{"status":"error","input":{…},"error":"File content (43008 tokens) exceeds …"}}

{"type":"tool", … "state":{"status":"running","input":{…},"title":"Bash","metadata":{},"time":{"start":…}}}

{"type":"timeline","timelineType":"model_change","display":"separator","status":"completed",
 "time":{…},"type":"timeline","toModel":{…},"toModelSelection":{…}}
```

补充事实（同样是 `pragma` / `sqlite_master` 现取的）：

- `part` → `message(id)`、`message` → `session(id)` 都有 **`on delete cascade` 外键**，所以插入顺序必须是 session → message → part；`node:sqlite` 默认 `PRAGMA foreign_keys=1`。
- 两个触发器 `message_sequence_autofill` / `part_sequence_autofill`：**只在新行的 `sequence is null` 时才补号**。本插件显式写 `sequence`（消息按会话 0..n、part 按消息 0..n），因此不依赖触发器，也不受它影响。
- `session.title_source` 有 check 约束 `in ('default','first_input','generated','custom')`，写 `custom`。
- `session.version` / `permission` / `task_type` 不自己编：从库里**最近更新的那条 session** 抄（`inferDefaults()`），保持和 ZCode 自己写的一致。

## 5. `project_id` 的派生规则（附推导过程）

```
project_id = ("proj_" + lower(directory).replace(/[\\/:]+/g, "-")).slice(0, 85)
```

证据（`scripts/sample-zcode.mjs` 现算，5/5 命中）：

| directory | 派生 | 库里实际的 project_id | len |
| --- | --- | --- | --- |
| `C:\Users\Administrator\.zcode\workspace\default` | 同左 | `proj_c-users-administrator-.zcode-workspace-default` | 51 |
| `…\workspace\draft-31e25bdb-06a0-4952-8005-86f460c7b8f9` | 长度 86 | `…-86f460c7b8f`（**少了最后一位 `9`**） | 85 |
| `…\draft-31e25bdb-…-86f460c7b8f9\weflow-cli` | 长度 97 | `…-86f460c7b8f`（同上，后半截全被截掉） | 85 |
| `…\workspace\draft-6fd524b3-e114-43ce-bffd-60ee47be7b4c` | 长度 86 | `…-60ee47be7b4`（少了 `c`） | 85 |
| `…\workspace\draft-a7726920-b4c2-4a7b-a398-54aaa88779c1` | 长度 86 | `…-54aaa88779c`（少了 `1`） | 85 |

推导过程：
1. `default` 那条最长 51，`C:\` → `c-`（`:` 和 `\` 连续 → **合并成一个** `-`），`.zcode` 的 `.` 保留、`\_` 不转义、全部小写 → 完全吻合。
2. 另外四条都"差一个字符"。把规则套上去算长度是 86，而库里是 85 —— 于是试 `slice(0, 85)`：四条全中（`slice(0,84)` / `slice(0,86)` 都只有 1/5 命中，只有 85 是 5/5）。
3. 第 2 条的 `…\weflow-cli` 子目录跟父目录的 uuid **映射到同一个 project_id**，正是因为截断把 `-weflow-cli` 整段吃掉了 —— 这反过来证明"截断的是整串，不是每个路径段"。

**所以规则是推出来了，但它有个真实的副作用：85 字符截断会让长路径撞名。** 插件因此不是无脑套公式：

- 派生值在库里已存在 → 直接用，回执标 `projectSource: "derived-existing"`；
- 不存在 → 用派生值新建一个 project 桶（`derived-new`）；
- 派生值撞到一个**不同目录**的已存在 project → 回执里带 `projectCollision.existingDirectories`，让人自己判断；
- 想强制指定就传 `projectId`（`override`）。

没有采用"用目录最接近的那个 project_id"当默认，是因为那会把一个 DSH 会话塞进一个**语义上完全无关**的 ZCode 项目（本机现有 project 全在 `~/.zcode/workspace/…`），比新建一个桶更容易误导。

## 6. 字段映射

### 6.1 ZCode → DSH（`readSessionIR()` → `irToSeedEvents()`）

写的是 DSH v4 事件流（`turn/start` … `turn/end`）。DSH 有几条硬规矩，映射必须顺着它：

- `system/message` 必须是 **surface 的第一个节点**，否则之后续聊追加会写进中间、日志被判损坏 → 首个 step 里先发一条合成系统提示（`DEFAULT_SYSTEM_TEXT`，明说"本会话来自 ZCode、原系统提示不在转录里"）。
- 每个 `tool/call` 必须被同 step 里前一条 `assistant/message` 的 `tool-call` 块**公示**，`name`/`arguments` 逐字相同。
- 每个 `tool/result` 必须在本 step 内有对应 call；`step/end` 前不许留悬空调用（本插件会给未回款的调用补一条 `TOOL_OUTCOME_UNKNOWN` 结果）。

| ZCode | → | DSH |
| --- | --- | --- |
| `session.title` | → | `session/title` 事件 `{title, messageSeqs, source:{kind:'fallback'}}` |
| `session.directory` | → | header `cwd` |
| `session.time_created` | → | header `createdAt` |
| `message.anchor.turnId` | → | 分组边界 → `turn/start` / `turn/end`（每 turn 的 `turn` 从 1 递增） |
| `message.role='user'` 且 `semantics.transcriptVisibility='visible'` | → | 挂起的 `user/message`，在**下一个 assistant 消息的 step 里**发出（`content=[{type:'text'}]`） |
| `semantics.transcriptVisibility='hidden'` 的消息 | → | 丢弃（计入 `counts.hiddenMessages`；模型注入上下文不是人看的转录） |
| `message.role='assistant'` | → | 一个 step：`step/start` → [`system/message`] → 挂起的 `user/message` → `assistant/message` → `tool/call`×n → `tool/result`×n → `step/end` |
| `part(type=reasoning).text` | → | `assistant/message.content[] += {type:'reasoning', text}` |
| `part(type=text).text` | → | `assistant/message.content[] += {type:'text', text}` |
| `part(type=tool)` | → | `content[] += {type:'tool-call', id: callID, name: tool, arguments: JSON.stringify(state.input)}` + `tool/call` 事件 + `tool/result` 事件（正文 `state.output` 或 `state.error`，`isError = state.status==='error'`） |
| `message.data.tokens` | → | `assistant/message.usage`（DSH `TokenUsage`：`inputTokens/outputTokens/totalTokens/cacheReadTokens/cacheWriteTokens/reasoningTokens`，只保留 DSH 认识的字段） |
| `message.data.providerId/modelId` | → | `message.source.{provider,model}` |
| `part(type=step-start/step-finish/timeline)` | → | 丢弃（ZCode 的内部结构），计入 `counts.ignoredParts` |
| `message.semantics.*` | → | 丢弃（DSH 无对应字段） |

### 6.2 DSH → ZCode（`eventsToIR()` → `planExport()` → `applyExport()`）

| DSH | → | ZCode |
| --- | --- | --- |
| header `cwd` | → | `session.directory` = `session.path`；`session.project_id` 由它派生（见 §5） |
| `session/title` | → | `session.title`，`title_source='custom'`，`title_message_id`=首条 user 消息 id |
| header `createdAt` / 最后一条消息时间 | → | `session.time_created` / `time_updated` |
| （新生成） | → | `session.id = session_<32 hex>`，`slug = id`；`version`/`permission`/`task_type` 从库里现成的行抄 |
| `turn/start`…`turn/end` 区间 | → | `message.data.anchor.turnId`（生成 `turn-<n>`，同 turn 的消息共用一个） |
| `user/message` | → | `message(role='user')`，`semantics={origin:'real_user',kind:'user_prompt',ui/provider/transcriptVisibility:'visible'}` + `part(type=text)` |
| `assistant/message` | → | `message(role='assistant')`，`semantics={origin:'agent_runtime',kind:'assistant_response',…}`；`tokens`、`parentID`（上一条 user 消息）、`anchor.orderedMessageIds/boundaryMessageId/historyRoundCount` 一并写 |
| `assistant/message.content[type=reasoning]` | → | `part(type=reasoning, metadata:{}, time:{start,end})` |
| `assistant/message.content[type=text]` | → | `part(type=text)` |
| `assistant/message.content[type=tool-call]` + `tool/call` | → | `part(type=tool, callID, declarationIndex, tool, state:{status,input,output/error,title,metadata,time})`，`input` 由 `arguments` 反序列化 |
| `tool/result` | → | 回填到对应 `part(state.output)`，`isError → status='error'`（错误正文进 `state.error`） |
| `assistant/message.usage` | → | `message.data.tokens` = `{total,input,output,reasoning,cache:{read,write}}` + `part(step-finish).tokens` |
| `assistant/message.source.{provider,model}` | → | `providerId`/`modelId` + `model{providerID,modelID}` + `modelSelection` |
| `system/message` | → | 丢弃（ZCode 没有 system 角色）；计入 `counts.systemMessages` |
| 其它事件（`request/*`、`command/*`、`session-log-deepseek/*`、`web/*`、`permission/preset`…） | → | 丢弃，按类型计数（`ir.ignored`），不静默丢 |

每个 assistant 消息的 part 顺序固定成 ZCode 自己的写法：`step-start` → `reasoning` → `text` → `tool`×n → `step-finish`；`part.sequence` 在消息内从 0 连续，`message.sequence` 在会话内从 0 连续。

## 7. 中间表示（IR）

两个方向都先变成同一个 IR，再各自落库，避免"两套映射各写一遍"：

```ts
{
  title?, cwd?, createdAt?, sourceId?,
  messages: [{
    role: 'user' | 'assistant',
    id, at, completedAt?, turnId,
    parts: [{kind:'text',text} | {kind:'reasoning',text}
          | {kind:'tool',callId,name,arguments,input,output,status,isError}],
    provider?, model?, tokens?, synthetic?
  }],
  counts: {...}, ignored: {...}
}
```

## 8. 踩到的坑（都是实测踩出来的，写在这里免得下次重踩）

1. **`SQLITE_CANTOPEN(14) "unable to open database file"`**：把整个大会话（268 message / 981 part）在一个事务里写进 WAL 库时，SQLite 会去落临时文件，本机就在那里炸了 —— 报错看起来像"库打不开"，其实库好好的。修法：连接上 `PRAGMA temp_store=MEMORY`。加之前写到第 8 个 WAL 帧左右必挂，加之后 100% 稳。回归测试见 `test/zcode.test.ts` 的「写 7/7」。
2. **同一个进程里还有别的连接开着时**，再开读写连接会 `SQLITE_CANTOPEN`。插件的读写连接严格分阶段（先读→关掉→再写），测试里也照这个顺序摆。
3. `part`/`message` 有 `on delete cascade` 外键，`node:sqlite` 默认开启外键强制 → 插入顺序不能乱。
4. `sequence` 有两个 autofill 触发器，只在 `sequence is null` 时动手；本插件显式写号，绕开它。
5. DSH 的 zstd 日志是**多帧拼接**（71 条事件能有 41 帧），必须按 magic `28 B5 2F FD` 切帧后逐帧解；`node:zlib` 的 `zstdDecompressSync` 一次只能解一帧。

## 9. 测试

```bash
cd packages/dsh-zcode-bridge
npm test          # = node --test test/zcode.test.ts test/dsh.test.ts test/route.test.ts
node scripts/sample-zcode.mjs   # 重新打印 §4 的抽样证据（只读）
node scripts/sample-dsh.mjs     # 解一个真实 DSH 会话，打印 header/事件/IR
```

测试**绝不动真库**：`test/helpers.ts` 先把真库（连同 `-wal`/`-shm`）`copyFile` 到包内 `.tmp/`，`PRAGMA wal_checkpoint(TRUNCATE)` 成一个自包含快照，之后每个用例再复制一份到 `work-*.sqlite` 上写。

覆盖：

| 要求 | 用例 |
| --- | --- |
| 读：list / preview | `zcode.test.ts` 读 1/3、2/3；`route.test.ts` 路由 1、2 |
| 写：合成 DSH 会话（2 轮 + 1 工具调用）导出后读回 | `zcode.test.ts` 写 1/6；`route.test.ts` 路由 5 |
| 幂等：同标题再来 → `ALREADY_EXISTS` | `zcode.test.ts` 写 2/6；`route.test.ts` 路由 5 ④ |
| 备份：`.bak-*` 存在且大小 == 写前 | `zcode.test.ts` 写 1/6 |
| 事务：NOT NULL 置空 → 表里没有半个会话 | `zcode.test.ts` 写 4/6 |
| 进程在跑 → 409 且无写入（连备份都没有） | `zcode.test.ts` 写 5/6；`route.test.ts` 路由 5 ② |
| DSH 侧 zstd 解一个真实会话 → 编码回去再解 → 结构一致 | `dsh.test.ts` DSH 1/4、2/4 |
| （额外）用 **DSH 自己的还原器**验收两个方向产出的日志 | `dsh.test.ts` DSH 3/4、4/4 |
| （额外）大会话整份写入的回归守卫 | `zcode.test.ts` 写 7/7 |

## 10. 目录

```
dsh-zcode-bridge/
├── index.js           # apply(ctx) + 8 条路由 + 小面板
├── zcode.js           # ZCode：进程检测 / 抽样 / 读 IR / planExport / 备份+事务写入
├── dsh.js             # DSH：zstd 多帧编解码 / 事件↔IR / v4 seed 构造 / 宿主通道
├── cordis.patch.yml
├── test/
│   ├── helpers.ts     # 真库副本、合成会话、假宿主
│   ├── zcode.test.ts  # 读/写/幂等/备份/事务/进程/volume
│   ├── dsh.test.ts    # 解码/编码/IR/官方还原器验收
│   └── route.test.ts  # 8 条路由的端到端
└── scripts/           # 只读证据脚本
```

## 11. 没有验证的东西（照实说）

1. **ZCode 自己的读取器没有逆过。** 写入的 `message.data` / `part.data` 字段是**按真实样本镜像**的（该有的都有、值域照抄），但 ZCode 打开这个会话时会不会因为某个我漏掉的字段（或某条不满足的隐式约束）而拒绝、降级甚至崩，**没有在真机上验证过**。验证它需要真正写一次真库并用 ZCode 打开——按要求我没有这么做。
2. **只写了 `session` / `message` / `part`。** `tool_usage` / `model_usage` / `turn_usage` / `todo` / `session_input` / `session_entry` 一行没写。后果：导进来/导出去的会话，ZCode 里的**用量统计、TODO、模型选择、执行状态**这些面板大概率是空的；在 ZCode 里**继续聊**可能还需要 `session_input`（`status='promoted'`、`promoted_message_id` 指回那条 user 消息）和 `session_entry(type='runtime/model_selection')`，我没验证缺了会怎样。
3. **`project_id` 撞名**：85 字符截断是硬事实，两个长路径可能派生出同一个 `project_id`。插件会在回执里报 `projectCollision`，但没有"另造一个不撞的名字"——那会更偏离 ZCode 自己的规则。
4. **DSH 侧的宿主通道**只按 `ctx.sessions.create(id,{seed,meta})` + `flush()` 这一条路写（并且 `readSessionIR` 优先 `sessionQuery.readSession`）。`ctx.sessionController.list()` 的结构是照着各家插件用法写的，但**本机这份 profile 里我没有真正跑过带真实服务的 create/flush**（测试用的是假宿主 + 文件通路）。第一次真用请先 dry-run 看一眼 `counts`。
5. **消息 id 的形状**是镜像的（`msg_<base36 时间戳>_<uuid>`、`part_…`、`session_<32 hex>`），没有证据表明 ZCode 会解析时间戳前缀，也没有证据表明它不解析。
6. **`assistant/message` 的 `usage`** 用 DSH 的 `TokenUsage` 字段；ZCode 的 `tokens.cache.read/write` 与 DSH 的 `cacheReadTokens/cacheWriteTokens` 语义是否完全一致（含不含 reasoning）没有核对。

**真要写你自己的库，还差这几步：**

1. 退出 ZCode（全部三个进程），确认 `tasklist` 里没有 `ZCode.exe`；
2. 先只跑 dry-run：`GET /dsh-zcode/export-preview?dshSessionId=…`，核 `counts` / `target.projectId` / `warnings`；
3. 用**一份库的拷贝**演练一次真写（本包的测试就是这么做的）；
4. 真写：`POST /dsh-zcode/export {dshSessionId, apply:true}`，回执里记下 `backup.path` 与 `zcodeSessionId`；
5. 打开 ZCode，看那条会话能不能正常显示、能不能继续聊；不行就用 `backup.path` 换回去（`copyFile` 覆盖 `db.sqlite`，同时删掉 `-wal`/`-shm`）。

反向（ZCode → DSH）风险小得多：DSH 的 v4 日志在测试里已经用 **DSH 自己的还原器**验过（`dsh.test.ts` 的 3/4、4/4 两段），但"DSH 界面里看起来对不对"（标题、工具块折叠、token 统计）仍属于没验证的部分。

---

## 真库验证记录（2026-10-25，对 `db.sqlite` 的副本）

```
写入   1 session / 2524 message / 8111 part   1.2 s   自动备份 21.8 MB
回读   tool 1933 · reasoning 550 · text 916 · step-start 2356 · step-finish 2356
首个 tool part  PowerShell / {"command":"git ls-remote …"} / 输出 835 字符
pragma integrity_check = ok
```

这轮修的三个问题：

1. **工具调用全丢**：DSH IR 给的是 `toolCalls` + 独立 `role:'tool'` 消息，而 `planExport`
   按 ZCode 的 part 模型消费。加了 `normalizeIrMessages()`：工具结果按 `callId` 折回调用，
   `role:'tool'` 不再单独成 message。
2. **`UNIQUE constraint failed: message.id`**：DSH 侧多条消息共用一个 `id`，按 `idMap` 取会
   复用同一个新 id。改成**按位置**分配（`orderedIds[messageIndex]`）。
3. **进程守卫太宽**：原来连"库的副本"也拦，导致不关 ZCode 就没法演练。现在默认仍检查，
   显式传 `allowWhileRunning:true` 才放开（意味着"我确认没在用这个库"）。

**未验证**：`project_id` 含中文（`proj_d-github_project-zhaowen_github维护`）时 ZCode 认不认。
真库现有 id 全是 ASCII（从 `~/.zcode/workspace/draft-*` 派生）。这是真写时唯一需要人眼确认的点。
