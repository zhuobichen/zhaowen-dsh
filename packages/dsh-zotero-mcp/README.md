# dsh-zotero-mcp

Zotero MCP 客户端 bundle：把 `@deepseek-ai/dsh-mcp-client` 的一个实例 insert 到 DSH profile 里，连接 Zotero 插件 `zotero-mcp-plugin` 的本地 MCP 服务。

## 前提

- Zotero 桌面端已启动
- Zotero 插件 `zotero-mcp-plugin` 已启用（**端口 23120** = MCP server）
- Zotero 偏好设置 `extensions.zotero.httpServer.localAPI.enabled` = true（**端口 23119** = Connector/Local API）

两个端口别搞混：
- `23120` → MCP server，本 bundle 连的就是这个
- `23119` → Zotero Connector / Local API，`cnki-export` 的 `push_to_zotero.py` 和本地 API 授权走这个

## 配置说明

```yaml
- insert:
    - id: mcp-zotero
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: zotero
        transport: streamable-http
        url: http://127.0.0.1:23120/mcp
        toolCallTimeoutMs: 180000
        failOnStartupError: false
        reconnect:
          enabled: true
          initialDelayMs: 1000
          maxDelayMs: 30000
          maxAttempts: 20
```

| 字段 | 值 | 为什么 |
|---|---|---|
| `toolCallTimeoutMs` | `180000` | `add_by_identifier` 要联网跑 Zotero 的 translator 解析元数据，慢的时候单个标识符可能跑十几秒，SDK 默认的 60s 不够用 |
| `failOnStartupError` | `false` | Zotero 没开着是常态（不是故障）。设 true 会让插件激活失败，DSH 起不来 |
| `reconnect.maxAttempts` | `20` | 默认 10 次，按指数退避（1s→30s）算下来最多覆盖约 4 分钟；Zotero 开机慢时给足次数 |
| `reconnect.initialDelayMs` | `1000` | 默认 500ms 偏急，改成 1s 对本地服务更合适 |

## 安装后效果

Zotero MCP 的工具以 `mcp__zotero__*` 注册为原生工具：

| 工具 | 用途 |
|---|---|
| `mcp__zotero__add_by_identifier` | 通过 DOI / arXiv ID / ISBN / PMID / ADS bibcode 导入文献（走 Zotero 自己的 translator） |
| `mcp__zotero__write_item` | 创建条目（action `create`）、附加本地 PDF（action `import`）、重挂附件（action `reparent`） |
| `mcp__zotero__write_metadata` | 修改标题 / 摘要 / 日期 / DOI / 作者 |
| `mcp__zotero__write_tag` | 增删标签 |
| `mcp__zotero__create_collection` / `update_collection` / `delete_collection` | 集合管理 |
| `mcp__zotero__add_items_to_collection` / `remove_items_from_collection` | 移动条目 |
| `mcp__zotero__write_note` | 笔记增改 |
| `mcp__zotero__search_library` / `search_fulltext` / `get_content` | 检索与全文读取 |
| `mcp__zotero__get_annotations` / `search_annotations` | PDF 批注 |

## 已知限制

**这个 MCP 没有删除工具。** `write_item` / `write_metadata` 只能改不能删。要删条目得走 Zotero 本地 API（端口 23119）：

1. `POST http://127.0.0.1:23119/api/local/authorize`
   Body: `{"username":"...","password":"...","appName":"dsh","scopes":["library","files"]}`
   Header: `Zotero-Server-ID: <任意值>`
   → 返回 token（`remember: true` 时会持久化，后续无需重复授权）
2. 从任意响应头读 `Zotero-Server-ID`（它和第 1 步传的值**必须一致**，不一致返回 412）
3. `DELETE http://127.0.0.1:23119/api/users/0/items/<itemKey>`
   Headers: `Authorization: Bearer <token>` + `If-Unmodified-Since-Version: <version>`
   → `204` = 删除成功；复查 GET 返回 `404` 即已消失

**`add_by_identifier` 超时不代表失败。** 工具调用超时后导入可能其实已经成功。先用 `search_library` 查标题：重复导入会返回 `exists` 而不是建新条目，所以盲目重试不会产生重复，但查一下更稳妥。

**批量超过 3 个标识符时转后台任务。** 返回 `jobID`，用它轮询进度。

## 相关文档

- Skill `zotero` — 日常操作指引（导入工作流、写入安全规则）
- Skill `zotero-db` — 数据库层操作与备份脚本
