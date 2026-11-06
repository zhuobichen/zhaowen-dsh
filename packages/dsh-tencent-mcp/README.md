# 腾讯 MCP 合集（DSH）

一个 bundle 装下一组腾讯服务的 MCP server：**大包里内嵌小服务，按行启用/停用**。密钥全部从 `dsh/home/.env` 经 `!!js process.env.*` 注入，patch 里不出现明文。

## 当前收录

| 服务 | 传输 | 状态 | 说明 |
|---|---|---|---|
| **腾讯文档** `tencent-docs` | streamable-http | ✅ 启用 | `https://docs.qq.com/openapi/mcp`，一套工具覆盖文档/表格/幻灯片/智能表/流程图/思维导图/OCR/网页剪藏 |
| **云服务器** `tencent-cvm` | stdio（uvx） | ✅ 启用 | 列实例、开关机、查规格；用 `.env` 里的 `TENCENTCLOUD_SECRET_ID/KEY` |
| **自动化助手** `tencent-tat` | stdio（uvx） | ⏸ 停用 | 无需 SSH 在云服务器上跑命令；把 `disabled: true` 去掉即启用 |
| **对象存储** `tencent-cos` | stdio（npx） | ⏸ 停用 | 需在 `.env` 补 `COS_CONFIG`（bucket/region 的 JSON）再启用 |

后续想加 CLS（日志）、TAPD（需求缺陷）、DNSPod、轻量服务器等，复制一行 patch 改 `serverName` / 包名即可——官方合集见 [TencentCloudCommunity/mcp-server](https://github.com/TencentCloudCommunity/mcp-server)。

## 两个环境前提

**1. 密钥在 `.env`**

```dotenv
TENCENT_DOCS_TOKEN=...            # 腾讯文档 MCP 的 Authorization
TENCENTCLOUD_SECRET_ID=...        # 腾讯云 API
TENCENTCLOUD_SECRET_KEY=...
# TENCENTCLOUD_REGION=ap-guangzhou   # 可选，默认 ap-guangzhou
# COS_CONFIG={"cos":[{"bucket":"...","region":"..."}]}
```

**2. stdio 服务需要可写缓存**

这台机器的 `D:\dev-cache\npm` 与 `D:\dev-cache\uv` 权限被拒（EPERM / 拒绝访问），`npx`、`uvx` 默认都装不动。patch 里已把缓存重定向到工作区：

```yaml
env:
  UV_CACHE_DIR: 'D:\...\_mcp-cache\uv'
  UV_TOOL_DIR: 'D:\...\_mcp-cache\uv-tools'
  UV_TOOL_BIN_DIR: 'D:\...\_mcp-cache\uv-bin'
  npm_config_cache: 'D:\...\_mcp-cache\npm'
```

第一次启用某个 stdio 服务要下载依赖（实测 `mcp-server-cvm` 约 3 分钟，之后走缓存秒开）。这段时间工具可能还没出现，是正常的。

## 安装

```sh
dsh plugin --profile web add ./dsh-tencent-docs-mcp
```

pnpm 被上面那个权限问题挡住时，手动接线（junction + profile 的 `dependencies` / `dsh.profile.bundles`）。

## 验证

- 腾讯文档：让 agent 调 `mcp__tencent-docs__get_user_info`，应返回自己的昵称与 user_id。
- 云服务器：`mcp__tencent-cvm__*` 里挑一个只读工具；返回鉴权错误说明 SECRET_ID/KEY 或 REGION 不对。

## 边界

- 只做连接层，不修改、不代理腾讯服务的行为。
- 腾讯文档工具会**真实写你的文档**；删除类操作（`manage_delete_file`、`delete_space_node`）不可撤销，先确认。
- 腾讯云密钥权限很大（能开关机），建议在控制台给这个密钥收窄到只读或指定产品。
