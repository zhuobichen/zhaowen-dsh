# @zhuobichen/dsh-import

把 **Claude Code** / **Codex** 的本地会话导入 **DeepSeek Harness**。一个纯插件：装进 profile 后，agent 自己就能扫描和导入，不需要命令行、不需要外部脚本。

```
~/.claude/projects/**/*.jsonl ─┐
                               ├─→ DSH v4 会话日志 ─→ 用 DSH 自己的还原器校验
~/.codex/{sessions,archived} ──┘
```

- **只读源文件**：`~/.claude` / `~/.codex` 里的记录一个字节都不改。
- **写在 DSH 自己的存储里**：`<root>/--<cwd>--/session-<id>/session.v4.jsonl.zstd`，`root` 默认 `$DSH_HOME/sessions`。
- **写完即校验**：调用 `@deepseek-ai/dsh-session-format-catalog` 还原一遍，PASS 才代表 DSH 读得动。
- **默认空跑**：`apply: true` 才真写。

## 安装

```sh
# 从仓库目录 link 安装（改动即时生效）
dsh plugin --profile web add ./packages/dsh-import

# 或先打包再装（pnpm 建符号链接受限的机器上更稳）
cd packages/dsh-import && npm pack
dsh plugin --profile web add ./zhuobichen-dsh-import-0.1.0.tgz
```

装完重启 `dsh web`，agent 的工具列表里会出现 `agent_sessions_scan`、`agent_sessions_import` 和 `agent_sessions_fork`。

## 三个工具

### `agent_sessions_scan`（只读）

| 参数 | 说明 |
|---|---|
| `source` | `claude` / `codex` / `all`（缺省 all） |
| `cwd` | 只看工作目录含该子串的会话 |
| `include` / `exclude` | id 完整值或前缀；`exclude` 优先 |
| `limit` | 最多返回几条（缺省 50） |

返回 `{ total, returned, sessions: [{agent,id,cwd,archived}] }`。

### `agent_sessions_import`

| 参数 | 说明 |
|---|---|
| `source` / `id` / `include` / `exclude` | 挑哪些会话 |
| `days` / `cwd` / `maxMb` | 时间窗 / 目录过滤 / 体积上限 |
| `keepTools` | 缺省 true；false 只留对话 |
| `titlePrefix` | 标题前缀，如 `"[Claude] "`，侧栏里区分来源 |
| `maxTurns` | 只导最后 N 轮（缺省 0 = 全留）；**长会话必须裁** |
| `keepReasoning` | 是否保留 thinking；缺省 false（通常是体积大头） |
| `maxToolResultChars` | 工具结果截断长度，缺省 800 字符 |
| `maxSessionTokens` | 单个会话的 token 预算，**默认 0 = 不分片**（一个对话 = 一条 DSH 会话）；传数字才按轮切段成多个会话 |
| `apply` / `overwrite` | 真写 / 覆盖同名 |
| `out` | 覆盖目标 sessions 根目录 |

返回 `{ applied, written, reports[] }`，`reports[i]` 带 `turns / events / estimatedTokens / file / verified / skipped`。

### `agent_sessions_fork`

从**已有的 DSH 会话**往上分叉一个新会话，语义与 DSH 自己的 `fork` 一致：

```
子会话 = 源事件 [0..boundary]
       + session/end-seed {seq: boundary+1, data:{inherited:true}}
       + 未闭合 tail 的收尾事件（见下）
       + session/title
header.parentSession = 源 id, isSeeded = true
```

`boundary` 缺省取**最后一个完整 turn**（`latestCompletedPrefixBoundary`：最后一个 `turn/end` 之后、
遇到 `turn/start` / `user/message(append)` / `agent/inbox/spliced` 为止）。未完成的 turn 不会被带过去。

#### 收尾事件（与 DSH 的 `openTurnClosers` 逐字对齐）

用 `atSeq` 把边界落在 **turn 中间**时，前缀里会留下未闭合的 tail。DSH 的 `buildForkSeed`
会调用 `openTurnClosers(prefix, { kind: 'forked' })` 把它补平，本插件做同样的事：

| 情况 | 补什么 |
|---|---|
| assistant 公示过、且有 `tool/call`、但没有 `tool/result` | `tool/result`（`isError`，`error.code = TOOL_OUTCOME_UNKNOWN`，`sourceEventSeqs` 指回 call） |
| assistant 公示过、但连 `tool/call` 都没有 | `tool/result`（`isError`，`error.code = TOOL_NOT_STARTED`，不带 `sourceEventSeqs`） |
| 未闭合的 step | `step/end` |
| 未闭合的 turn | `turn/end`，`data.reason.kind = 'forked'` |

补齐顺序固定为「工具结果 → step/end → turn/end」，seq 连续，时间戳复用最后一个事件的时间。
默认边界落在一个完整 `turn/end` 上时这一步产出为空，与不带收尾事件的老行为完全一致。

> 为什么要补：提供方拒收**悬空的 assistant tool-call**。少了这些事件，DSH 还原该会话时
> 会因「有未回款的调用」拒绝加载。

| 参数 | 说明 |
|---|---|
| `sessionId` | 源会话 id，支持前缀 |
| `title` | 新会话标题；缺省 `fork-<源id前8位>` |
| `atSeq` | 指定 fork 到哪个事件 seq（含）；落在 turn 中间会自动补收尾事件 |
| `apply` | true 才真写；缺省空跑 |
| `out` | sessions 根目录 |

和 `import` 一样优先走宿主桥（`sessions.create + flush + workspace.attachSession`），
失败才回退写文件；返回的 `runtime` 标明 `live` / `file`。

### 长会话一定要裁

DSH 每轮请求都要把历史整段重放给模型，而上下文有上限（当前 1,048,576 tokens，completion 还预留 256k）。实测原始 Claude 会话：

```
785f7929  809 turns  ≈ 18M tokens   ← 直接导必炸
8c965989   76 turns  ≈ 1.3M tokens
f5a436c2  161 turns  ≈ 1.0M tokens
```

不裁就会报 `maximum context length is 1048576 tokens`。默认因此做三件事：**丢 thinking、工具结果截到 800 字符、参数截到 800 字符**，再用 `maxTurns` 控轮数。裁完：

```
785f7929  60 turns  ≈ 459k tokens
8c965989  60 turns  ≈ 273k tokens
f5a436c2  60 turns  ≈ 109k tokens
```

裁掉的地方会留一行 `…[imported: truncated N chars]`，不静默丢内容。

## 为什么要这么写（DSH v4 的硬约束）

DSH 的 v4 还原会校验**工具生命周期**，不满足直接拒收：

| 规则 | 报错 |
|---|---|
| `tool/call` 必须被前一条 assistant 消息里的 `tool-call` 块公示，且 name/arguments 逐字相同 | `has no advertised tool lifecycle` / `does not match one advertised tool call` |
| `step/end` 不能留未回款的调用 | `leaves unresolved tool call` |
| `tool/result` 必须在本 step 内有对应 call | `no prior tool/call in this step` |
| 时间戳必须是非负安全整数 | `createdAt must be a non-negative safe integer` |

本插件对应的处理：Codex 的独立 `function_call` → 合成公示消息；被中断的调用 → 补 `TOOL_OUTCOME_UNKNOWN` 结果；同一 call id 的第二条结果（Claude 会先写 interrupted 再补真实输出）→ 并入上一条而不是新造调用。

### 首帧必须恰好只有 header 一行（实测会让会话「消失」）

zstd 日志是**一串独立帧**，DSH 读首行时只解压**第一帧**并断言：

```js
// assertZstdHeaderFrame
if (plaintext.length === 0 || plaintext.indexOf(10) !== plaintext.length - 1)
  throw new Error("first frame is not exactly one header line");
```

所以物理编码必须是「**header 单独一帧** + 之后每帧一批事件」。正常会话的首帧解压后只有 **200–300 字节**。

如果把整个会话压成**单个帧**（首帧解压 = 全量几十 MB），后果是连锁的：

1. `readFirstZstdLine` 抛 `SessionPersistenceCorruptionError`；
2. `listArtifacts` 静默跳过该会话 → 侧栏不显示；
3. DSH 启动时按「会话不可读」把它从 `workspace.json` 的 `sessionIds` 里**自动剔除**——表现为「会话莫名消失」，手改登记表也救不回来。

诊断一句话：`首帧解压大小 >> 1 KB` 就是单帧损坏。修复就是把首行拆出来单独压一帧，事件部分另压。
2026-11-02 实测：一个 10.6 MB 的论文会话正是这样丢的，拆帧后立刻恢复。

## 导入是即时的（走 DSH 自己的 API）

插件在 DSH 进程内运行时，导入走 `ctx.sessions.create(seed)` → `ctx.sessions.flush()` → `workspace.attachSession()`：
**会话立刻出现在侧栏、立刻归属于工作区、标题立刻生效**，不需要重启、不需要补投影缓存、不需要改 `workspace.json`。
只有 API 路径失败时才回退到直接写日志（那种情况才需要重启让服务重新扫描）。

返回里的 `runtime` 会标明走了哪条：`live`（即时）或 `file`（需重启）。

## 已知行为

- **会话从侧栏消失先查首帧**：解压第一帧，若大小远大于 1 KB 就是被压成了单帧，按上文拆帧即可恢复；只改 `workspace.json` 没用——下次启动会被再次剔除。
- **侧栏标题来自投影缓存**：冷导入的会话没有缓存，刚导入时可能显示「未命名」，打开一次即恢复；想批量预置标题可以给 `storages/session_projcache/sessions/<id>.json` 写一条只含 `title` 行的记录。
- **工作区分组按 cwd**：DSH 要求 `workspace.path === realpath(该会话 header.cwd)`，所以同一目录下的 Claude 和 Codex 会话无法拆进两个工作区。
- **大文件**：几百 MB 的会话会产生十几到几十 MB 的 DSH 日志，先 `keepTools:false` 或加 `maxMb` 更稳。

## 许可证

MIT。逻辑与同仓库 `agent-sessions`（MCP 工具）共用一套解析与映射实现。
