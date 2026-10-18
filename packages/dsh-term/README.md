# dsh-term

终端版 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) —— 像 Claude Code 一样住在终端的 AI 编码助手。

在终端里与 Harness 的编码 agent 持续对话，**流式打字机输出 + 实时看到 agent 在读文件、跑命令**。

## 特性

- 🖥️ 终端 REPL：`dsh-term` 命令直接进入交互式对话
- ⚡ 流式输出：打字机效果，实时看到 agent 逐字输出
- ⚙️ 实时工具调用显示：看到 agent 正在执行的 `read` / `pwsh` / `write` 等操作
- 🔁 多轮对话：自动携带对话历史，`/new` 随时开新会话
- 🚀 复用全局安装的 DeepSeek Harness（headless 模式）

## 安装

要求 Node.js >= 22，以及已全局安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：

```sh
npm install -g @deepseek-ai/dsh

git clone <repo-url>
cd dsh-term
npm install
npm run build
```

**打补丁（启用工具调用显示）**——headless 模式默认不输出工具调用过程，本脚本给全局 dsh 的 headless runner 注入一个事件监听器：

```sh
python scripts/patch-headless.py
```

> ⚠️ 此补丁会修改全局 npm 里的 dsh 文件。`npm install -g @deepseek-ai/dsh` 更新后需重新运行。补丁有 `.bak` 备份。

## 使用

```sh
# 设置凭据（也可用 .env 或导出到 shell）
export DEEPSEEK_API_KEY=sk-...

npm start
```

进入后：

```
dsh-term — 终端版 DeepSeek Harness
❯ 读一下 README.md 第一行
⚙  read: README.md              ← 实时工具调用
README.md 第一行是：# dsh-term   ← markdown 渲染的响应
```

## 内置命令

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助 |
| `/new` | 清空上下文、开始新会话 |
| `/quit` | 退出（等价 `/exit`） |

## 环境变量

| 变量 | 用途 | 默认 |
|------|------|------|
| `DEEPSEEK_API_KEY` | API 凭据 | 必填 |
| `DEEPSEEK_BASE_URL` | OpenAI 兼容代理端点 | DeepSeek 官方 |
| `DSH_MODEL` | 模型 | Harness 默认 |
| `DSH_CWD` | agent 工作目录 | 当前目录 |
| `DSH_RUNTIME` | dsh 运行时入口路径 | 全局 npm 安装位置 |

## 原理

`src/cli.ts` 用 `readline` + `chalk` 提供终端交互界面，每次把对话历史拼进提示词，通过 Harness 的 `headless` 模式驱动编码 agent。`scripts/patch-headless.py` 给 headless runner 注入 `session/event` 监听器：工具调用（`tool/call`）实时输出到 stderr，assistant 流式文本（`text-delta`）实时输出到 stdout，由 cli 转发到终端。

## License

MIT
