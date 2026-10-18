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

装完重启 `dsh web`，agent 的工具列表里会出现 `agent_sessions_scan` 和 `agent_sessions_import`。

## 两个工具

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
| `apply` / `overwrite` | 真写 / 覆盖同名 |
| `out` | 覆盖目标 sessions 根目录 |

返回 `{ applied, written, reports[] }`，`reports[i]` 带 `turns / events / file / verified / skipped`。

## 为什么要这么写（DSH v4 的硬约束）

DSH 的 v4 还原会校验**工具生命周期**，不满足直接拒收：

| 规则 | 报错 |
|---|---|
| `tool/call` 必须被前一条 assistant 消息里的 `tool-call` 块公示，且 name/arguments 逐字相同 | `has no advertised tool lifecycle` / `does not match one advertised tool call` |
| `step/end` 不能留未回款的调用 | `leaves unresolved tool call` |
| `tool/result` 必须在本 step 内有对应 call | `no prior tool/call in this step` |
| 时间戳必须是非负安全整数 | `createdAt must be a non-negative safe integer` |

本插件对应的处理：Codex 的独立 `function_call` → 合成公示消息；被中断的调用 → 补 `TOOL_OUTCOME_UNKNOWN` 结果；同一 call id 的第二条结果（Claude 会先写 interrupted 再补真实输出）→ 并入上一条而不是新造调用。

## 已知行为

- **侧栏标题来自投影缓存**：冷导入的会话没有缓存，刚导入时可能显示「未命名」，打开一次即恢复；想批量预置标题可以给 `storages/session_projcache/sessions/<id>.json` 写一条只含 `title` 行的记录。
- **工作区分组按 cwd**：DSH 要求 `workspace.path === realpath(该会话 header.cwd)`，所以同一目录下的 Claude 和 Codex 会话无法拆进两个工作区。
- **大文件**：几百 MB 的会话会产生十几到几十 MB 的 DSH 日志，先 `keepTools:false` 或加 `maxMb` 更稳。

## 许可证

MIT。逻辑与同仓库 `agent-sessions`（MCP 工具）共用一套解析与映射实现。
