# 腾讯 MCP 合集（DSH）

一个 bundle 装下一组腾讯服务的 MCP server：**大包里内嵌小服务，按行启用/停用**。密钥全部从 `dsh/home/.env` 经 `!!js process.env.*` 注入，patch 里不出现明文。

## 当前收录

| 服务 | 传输 | 状态 | 说明 |
|---|---|---|---|
| **腾讯文档** `tencent-docs` | streamable-http | ✅ 实测可用 | `https://docs.qq.com/openapi/mcp`，工具覆盖文档/表格/幻灯片/智能表/流程图/OCR/网页剪藏 |
| **QQ 邮箱** `tencent-qqmail` | stdio（node 直跑） | ✅ 实测可用 | 只读 IMAP：列新邮件、取摘要、读全文；用 `.env` 的 `QQMAIL_USER` + `QQMAIL_AUTH_CODE` |
| **云服务器** `tencent-cvm` | stdio（uvx） | ⚠ 已连接，工具未注册 | 见下方「stdio 的现状」 |
| **QQ 邮箱（全功能）** `tencent-qqmail-full` | stdio（npx） | ⏸ 停用 | 官方 12 项工具、可发信，首次要手机 QQ 扫码；扫码后去掉 `disabled` |
| **自动化助手** `tencent-tat` | stdio（uvx） | ⏸ 停用 | 不用 SSH 在云服务器跑命令 |
| **对象存储** `tencent-cos` | stdio（npx） | ⏸ 停用 | 需补 `COS_CONFIG`（bucket/region JSON） |
| **IMA 知识库** `tencent-ima` | stdio（uvx） | ⏸ 停用 | 需从 ima.qq.com 复制 cookie（见下） |

## stdio 的现状（重要）

这台机器上 DSH 的 `dsh-mcp-client` 能**连上** stdio server（`tencent-cvm`、`tencent-qqmail` 都会出现在 MCP 服务列表里），但工具没有注册进 agent 的工具表，调用会报 `unknown tool`。HTTP 型的腾讯文档完全正常。

所以 stdio 服务目前走两条路：

1. **DSH 侧配置保留**（缓存热了以后重启宿主有机会恢复）；
2. **mcporter 兜底**（本机已装，实测可用）：

```powershell
# 先加载 .env 里的 QQMAIL_*，再调用
mcporter call --stdio "node D:\...\_mcp-cache\qqmail-local\node_modules\qqmail-mcp\dist\index.js" qqmail_list_new_messages limit=5
```

QQ 邮箱这条路实测返回 `[]`（收件箱没有新邮件），exit 0，链路是通的。

## 两个环境前提

**1. 密钥在 `.env`**

```dotenv
TENCENT_DOCS_TOKEN=...            # 腾讯文档 MCP 的 Authorization
TENCENTCLOUD_SECRET_ID=...        # 腾讯云 API
TENCENTCLOUD_SECRET_KEY=...
QQMAIL_USER=...@qq.com            # IMAP 账号
QQMAIL_AUTH_CODE=...              # IMAP 授权码（不是 QQ 密码）
# TENCENTCLOUD_REGION=ap-guangzhou
# COS_CONFIG={"cos":[{"bucket":"...","region":"..."}]}
# IMA_X_IMA_COOKIE=... IMA_X_IMA_BKN=... IMA_KNOWLEDGE_BASE_ID=...
```

**2. stdio 服务要可写缓存**

这台机器的 `D:\dev-cache\npm` / `D:\dev-cache\uv` 权限被拒，`npx`、`uvx` 默认装不动。patch 里已重定向到工作区 `_mcp-cache\`：

```yaml
env:
  UV_CACHE_DIR / UV_TOOL_DIR / UV_TOOL_BIN_DIR → \_mcp-cache\uv*
  npm_config_cache → \_mcp-cache\npm
```

`npx` 的 shim 在这台机器上会被拒（`Access is denied`），所以 QQ 邮箱改成**先把包装到 `_mcp-cache\qqmail-local`，再用 `node` 直接跑入口**——这条路稳定。

## IMA 知识库怎么接

[highkay/tencent-ima-copilot-mcp](https://github.com/highkay/tencent-ima-copilot-mcp) 包装的是 ima.qq.com 的网页接口，需要一个**浏览器里的登录态**：

1. 打开 <https://ima.qq.com> 登录，F12 → Network，随便发一条提问；
2. 找 `/cgi-bin/assistant/qa` 的请求，复制：
   - `x-ima-cookie` → `IMA_X_IMA_COOKIE`
   - `x-ima-bkn` → `IMA_X_IMA_BKN`
3. 再填 `IMA_KNOWLEDGE_BASE_ID`（知识库 ID）；
4. 把这几条写进 `.env`，然后去掉 patch 里 `tencent-ima` 行的 `disabled: true`。

cookie 会过期，过期后工具返回未授权，重新复制即可。

## 安装 / 验证

```sh
dsh plugin --profile web add ./dsh-tencent-docs-mcp
```

- 腾讯文档：`mcp__tencent-docs__get_user_info` 应返回你的昵称与 user_id；
- QQ 邮箱：`mcporter call --stdio "node …\qqmail-mcp\dist\index.js" qqmail_list_new_messages limit=3`。

## 边界

- 只做连接层，不修改腾讯服务的行为。
- 腾讯文档工具会**真实写你的文档**；`manage_delete_file`、`delete_space_node` 这类不可撤销，先确认。
- QQ 邮箱只读（IMAP 版不提供发信）；要发信就用全功能版（扫码）。
- 腾讯云密钥权限很大（能开关机），建议在控制台收窄到只读或指定产品。
