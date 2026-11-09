# dsh-sandbox-grant

给**指定会话**切换沙箱模式（提权 / 降权）。

## 为什么需要

DSH 里每个会话有一个沙箱模式：

| 模式 | Windows 上的实际含义 |
|---|---|
| `read-only` | 子进程降级令牌 + Low 完整性，**不可写任何地方** |
| `workspace-write` | 同上，但授予工作区 + 私有临时目录的写 |
| `danger-full-access` | 不加沙箱，直接执行 |

模式由 `dsh-sandbox-policy` 用一条 `sandbox/mode` 会话事件承载（只写日志、可回放、跨重启保留），
写入路径是 `setSandboxMode(session, mode)`。

`workspace-write` 下这些事都会失败，而且报错很迷惑：

- 启动 NapCat → 写不了自己的 `loadNapCat.js`
- 启动 QQ → 报「文件已损坏」（写不了自己的配置）
- 连 ToDesk IPC → 命名管道 `Access denied`
- 写 `%USERPROFILE%` / `%TEMP%` / `C:\` → `Access denied`，但**工作区内一切正常**

## 工具

| 工具 | 作用 |
|---|---|
| `sandbox_grant(session_id, mode, reason?)` | 切模式。`mode` ∈ `read-only` / `workspace-write` / `danger-full-access` |
| `sandbox_revoke(session_id, reason?)` | 收回提权，等价于 `sandbox_grant(mode=workspace-write)` |

`session_id` 支持**唯一前缀**匹配；命中多个会报 `AMBIGUOUS_SESSION` 并列出候选，
绝不替你猜。

## 安全边界（写在代码里，不靠配置兜）

1. **降级永远允许**：切到 `read-only` / `workspace-write` 不需要任何审批。
2. **升级要资格**：切到 `danger-full-access` 只允许两种情况——
   - 调用方给自己提权（self-grant）；
   - 调用方会话标题在 `escalationOwners`（默认 `['管理Bot']`）里。
   其余一律 `ESCALATION_DENIED`，并在错误里说明原因。
3. **只对活会话生效**：冷会话没有 live `Session` 对象，直接报 `NOT_LIVE`，
   不去重放日志猜状态。
4. **可审计**：每次变更写一条到 `$DSH_HOME/plugins/dsh-sandbox-grant/audit.jsonl`
   （时间、目标、调用方、标题、是否 self、原因）。

## 配置

```yaml
- id: sandbox-grant
  name: '@zhuobichen/dsh-sandbox-grant'
  config:
    escalationOwners: ['管理Bot']
```

## 已知限制

- 只改**沙箱模式**，不改审批策略（那是 `dsh-user-approval` 的事）。
- 变更对该会话**之后的下一次受限调用**生效，不会 retroactively 改变已在跑的进程。
- 前端 Permissions 选择器仍可用；两边写的是同一个 `sandbox/mode` 事件，后写的覆盖先写的。

## host_exec：默认关闭的宿主机执行

沙箱模式只决定"给多少写权限"，而子进程的降级令牌是 spawn 时由沙箱后端打的，
**模式切到 danger-full-access 也不会解除**。插件代码本身跑在宿主进程里（正常令牌），
所以 `host_exec` 直接用 `node:child_process` 派生子进程，绕过 `ctx.subprocess` / 沙箱后端。

### 开关与授权

```yaml
- id: sandbox-grant
  config:
    hostExec:
      enabled: true                      # 默认 false，必须用户显式打开
      authorizedSessions:                # 只有这些会话能调（完整 id 或唯一前缀）
        - 'session-5c7d1b4e-97fd-413b-9528-32a17e00130c'
      timeoutMs: 120000
```

三道闸：全局 `enabled`、会话白名单、调用审计。不在白名单的会话返回 `ESCALATION_DENIED`。

### 代价

这是**给 agent 的无沙箱执行入口**：开启后该会话可以在宿主机上以你的完整权限运行任何命令。
缓解只有审计与超时，没有隔离。不用时把 `enabled` 改回 `false` 并重启。
