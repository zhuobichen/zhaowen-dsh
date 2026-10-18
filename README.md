# dsh-kit

赵文自己的 **DeepSeek Harness（DSH）** 工具集：一个插件、一个 TUI 前端、一个终端客户端。

| 目录 | 包名 | 是什么 |
|---|---|---|
| [`packages/dsh-team`](packages/dsh-team) | `dsh-team` | DSH 插件：多 Agent 团队编排（顺序接力 loop + DAG 图编排），角色化 agent 协作 |
| [`packages/dsh-cc-tui`](packages/dsh-cc-tui) | `dsh-cc-tui` | DSH 插件：Claude Code 风格的交互式 TUI 入口（基于移植的 Ink core） |
| [`packages/dsh-term`](packages/dsh-term) | `dsh-term` | 独立的终端客户端（不是插件）：像 Claude Code 一样住在终端的 DSH 前端 |

三个包各自独立：**各有自己的 package.json / lockfile / 构建脚本**，可以单独 `npm install`、单独发版。
本仓库只做"放在一起"，不引入 workspace 提升（三个包的包管理器还不一样：dsh-cc-tui 用 pnpm，另两个用 npm）。

## 常用

```sh
# 插件装到本地 DSH profile（link 安装，改动即时生效）
dsh plugin --profile web add ./packages/dsh-team
dsh plugin --profile web add ./packages/dsh-cc-tui

# 终端客户端
cd packages/dsh-term && npm install && npm run build && npm start
```

每个包的细节看各自的 README。

## 发版

三个包共享一个标签命名空间，用**带包名前缀的标签**触发对应流水线：

```sh
git tag dsh-cc-tui-v0.4.3 && git push origin dsh-cc-tui-v0.4.3
git tag dsh-team-v0.2.1   && git push origin dsh-team-v0.2.1
```

CI 与发版流水线在 `.github/workflows/`，都按 `paths` 过滤，改哪个包跑哪个。
