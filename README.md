# zhaowen-dsh

赵文自己的 **DeepSeek Harness（DSH）** 工具集：团队编排插件、会话导入插件、TUI 前端插件、终端客户端。

| 目录 | 包名 | 是什么 |
|---|---|---|
| [`packages/dsh-balance`](packages/dsh-balance) | `@zhuobichen/dsh-balance` | **DSH 插件**：DeepSeek 账户余额作为输入框上方的一行（宿主半身：会话投影 + `/balance` 命令 + TUI `\${balance}` 槽位）。移植自 Claude Code 的 `deepseek-balance` mod |
| [`packages/dsh-client-ui-balance`](packages/dsh-client-ui-balance) | `@zhuobichen/dsh-client-ui-balance` | **DSH 客户端插件**：Web GUI 里画那一行的浏览器半身（无构建步骤，手写 `window.__ModuleLoader__` 信封） |
| [`packages/dsh-team`](packages/dsh-team) | `@zhuobichen/dsh-team` | **DSH 插件**：多 Agent 团队编排（顺序接力 loop + DAG 图编排），角色化 agent 协作 |
| [`packages/dsh-cc-tui`](packages/dsh-cc-tui) | `dsh-cc-tui` | **DSH 插件**：Claude Code 风格的交互式 TUI 入口（基于移植的 Ink core） |
| [`packages/dsh-term`](packages/dsh-term) | `dsh-term` | **独立的终端客户端**（不是插件）：像 Claude Code 一样住在终端的 DSH 前端 |
| [`packages/dsh-import`](packages/dsh-import) | `@zhuobichen/dsh-import` | **DSH 插件**：把 Claude Code / Codex 的本地会话导入 DSH（扫描 + 导入 + 用 DSH 自己的还原器校验） |

`dsh-balance` 和 `dsh-client-ui-balance` 是一对：前者算数、后者画条，**两个都装**才在 Web GUI 里看得到那一行。

六个包各自独立：**各有自己的 package.json / lockfile / 构建脚本**，可以单独 `npm install`、单独发版。
本仓库只做“放在一起”，不引入 workspace 依赖提升（六个包的包管理器还不一样：`dsh-cc-tui` 用 pnpm，其余用 npm）。

## 安装

```sh
# 插件装到本地 DSH profile（link 安装，改动即时生效）
dsh plugin --profile web add ./packages/dsh-team
dsh plugin --profile web add ./packages/dsh-cc-tui

# 或从 npm 装（发布后）
dsh plugin --profile web add @zhuobichen/dsh-team
dsh plugin --profile web add dsh-cc-tui

# 终端客户端
cd packages/dsh-term && npm install && npm run build && npm start
```

三个包各自的细节看包内 README。

## 发版

三个包共享一个标签命名空间，用**带包名前缀的标签**触发对应流水线：

```sh
git tag dsh-cc-tui-v0.4.3 && git push origin dsh-cc-tui-v0.4.3
git tag dsh-team-v0.2.1   && git push origin dsh-team-v0.2.1
```

| 流水线 | 触发 | 说明 |
|---|---|---|
| `cc-tui-ci.yml` | 改 `packages/dsh-cc-tui/**` | pnpm 构建 + 12 条回归脚本 |
| `cc-tui-publish.yml` | 推 `dsh-cc-tui-v*` 标签 | 校验标签=package.json 版本后发 npm，**需要 `NPM_TOKEN` secret** |
| `team-ci.yml` | 改 `packages/dsh-team/**` | npm 构建（`tsc` 出 `lib/`） |
| `term-ci.yml` | 改 `packages/dsh-term/**` | npm 安装 + `tsc --noEmit` |

## 历史

由三个仓库合并而来，各自完整提交历史保留（`git subtree`）：

- `zhuobichen/dsh-team` → `packages/dsh-team`
- `zhuobichen/dsh-tui` → `packages/dsh-cc-tui`
- `zhuobichen/dsh-term` → `packages/dsh-term`
