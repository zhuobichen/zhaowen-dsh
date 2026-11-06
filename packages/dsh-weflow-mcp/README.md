# WeFlow MCP（DSH）

把 [WeFlow CLI](https://github.com/zhuobichen/weflow-cli) 自带的 MCP server 接进 DSH，让 agent 直接读本机微信数据。

WeFlow 自己已经提供 stdio MCP 服务（`mcp-server/index.ts`，编译产物 `dist/mcp-server/index.js`），这个 bundle 只做连接，不重写任何逻辑。

## 工具

| 工具 | 作用 | 主要参数 |
|---|---|---|
| `wechat.search_articles` | 搜索知识库文章 | `keyword` / `topic` / `date` / `limit` |
| `wechat.get_daily` | 指定日期的公众号日报 | `date`（默认最新） |
| `wechat.get_concept` | 概念 Wiki 页 | `name`（如 RAG、Agent） |
| `wechat.export_messages` | 导出指定会话的本地消息（`weflow-message/v1`） | `contact`（必填）/ `limit` / `from` / `to` |

还有一批与 `weflow-cli assistant` 共享的本地数据工具（`ASSISTANT_TOOLS`），启动后会一起出现。

## 前提

1. weflow-cli 已经在这台机器上跑过（数据目录、微信数据源都就绪）；
2. `dist/mcp-server/index.js` 存在（`npm run build` 产出）；
3. `node` 可用（`>= 22.13`）。

## 配置

`cordis.patch.yml` 里是：

```yaml
command: 'D:\Node_js\node.exe'
args: ['D:\...\weflow-cli\dist\mcp-server\index.js']
cwd: 'D:\...\weflow-cli'
```

**`cwd` 必须是 weflow-cli 的项目根**：server 会按相对路径找配置与数据。

## 安装与验证

```sh
dsh plugin --profile web add ./dsh-weflow-mcp
```

验证：让 agent 调 `mcp__weflow__wechat.get_daily`（只读，无参数）。

如果这台机器上 DSH 的 stdio MCP 又出现「连上了但工具没注册」的情况（CVM、QQ 邮箱都遇到过），用 mcporter 兜底：

```powershell
cd D:\...\weflow-cli
mcporter call --stdio "node dist/mcp-server/index.js" wechat.get_daily
```

## 边界

- 只读：`search_articles` / `get_daily` / `get_concept` / `export_messages` 都不写数据库、不改微信数据。
- 数据不出本机；`export_messages` 不返回数据库路径、密钥或配置。
- 仅处理你本人有权访问的数据。
