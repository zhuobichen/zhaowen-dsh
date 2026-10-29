# @zhuobichen/dsh-web-search-yuanbao

把**腾讯元宝搜索**（腾讯云产品 `wsa`，接口 `SearchPro` / Version `2025-05-08`）接成 DSH 的
搜索提供方，注册 id 为 `yuanbao`。`web_search` 工具、以及任何走 `ctx.web.search()` 的地方
都会自动切换过去。

它是 `@deepseek-ai/dsh-web` 这个 "web capability seam" 的第三个提供方（前两个是
`deepseek-official` 与 `deepseek-search-api`），所以：

- 不新增工具，模型看到的仍是同一个 `web_search`；
- 选择按 `web.searchProvider` 走，不在代码里硬编码；
- 取消、超时、错误码沿用 seam 的语义。

## 装了之后怎么用

在 profile 的 `cordis.patch.yml` 里覆盖 `web` 行（这一行只影响选择，不影响注册）：

```yaml
- id: web
  config:
    searchProvider: yuanbao      # 想切回 DeepSeek 就写 deepseek-official
    fetchProvider: http
```

改完保存即可，DSH 会热重载配置（约几秒），**不需要重启**。也可以在
设置 → 插件 → 网页搜索 里切（那一页写的是同一对字段）。

## 凭据

按 `secretIdEnv` / `secretKeyEnv`（默认 `TENCENTCLOUD_SECRET_ID` /
`TENCENTCLOUD_SECRET_KEY`）解析，顺序是：

1. 插件配置里的字面量 `secretId` / `secretKey`（写了就用，不推荐）；
2. `process.env`；
3. `$DSH_HOME/.env`（**直接读文件**，所以刚写进去的密钥不用重启就能生效）。

推荐位置就是 `$DSH_HOME/.env`：

```ini
TENCENTCLOUD_SECRET_ID=AKID...
TENCENTCLOUD_SECRET_KEY=...
```

密钥只用于本机签名，不出现在任何返回给模型的内容里。

## 回落

`fallbackProvider`（默认 `deepseek-official`）指向同一个 `ctx.web` 上已注册的提供方。
以下三种情况会自动转交：

- 元宝没凭据；
- 元宝报错（未开通 / 欠费 / 限流 / 超时 / 签名失败）；
- 元宝返回 0 条。

所以元宝挂掉时 `web_search` 不会整体失效；想关掉回落就写一个不存在的 id，例如
`fallbackProvider: __none__`。

## 配置项

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `secretIdEnv` / `secretKeyEnv` | `TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY` | 凭据引用名 |
| `secretId` / `secretKey` | 无 | 字面量凭据（优先于上一条） |
| `mode` | `2` | `0` 公开网页 / `1` 优质权威垂直信源（**旗舰版才有内容**，标准版返回空）/ `2` 混合 |
| `site` | 无 | `zhihu.com` 只搜某站；`exclude:a.com\|b.com` 过滤站点 |
| `industry` | 无 | `gov` / `news` / `acad` / `finance` |
| `freshness` | 无 | `d7` / `m3` / `y2` / `2026-08-20` / `2026-08-20,2026-08-30` |
| `timeoutMs` | `20000` | 单次请求超时 |
| `fallbackProvider` | `deepseek-official` | 回落目标，空串或自己则关闭回落 |

`Cnt` 不单独配置：由 seam 的 `searchMaxResults` 向上取整到接口允许的
`10/20/30/40/50`（`searchMaxResults: 8` → `Cnt=10`），最终条数仍由 seam 截断。

## 实现要点

- 签名是 TC3-HMAC-SHA256，纯 `node:crypto`，零第三方依赖。
- `Pages` 是 JSON 字符串数组，逐个解析后映射成 seam 的 `sources[]`：
  `title` → `title`，`url` → `url`，`passage`（退化用 `content`）→ `snippet`，
  `date` → `publishedAt`。按 url 去重，畸形条目跳过。
- 每次 `search()` 重读配置与凭据，换密钥/换参数不用重启。
- 错误都带 `code`：缺凭据 `WEB_PROVIDER_CREDENTIAL_MISSING`，取消 `WEB_ABORTED`，
  其余 `WEB_PROVIDER_ERROR`。

## 测试

```powershell
cd zhaowen-dsh/packages/dsh-web-search-yuanbao
node test/smoke.mjs          # 离线单测（签名形状、Cnt 取整、Pages 映射、回落链）
node test/smoke.mjs --live   # 再打一次真实 SearchPro（需要上面两个环境变量）
```

## 已知限制

- 只用 `SearchPro`；没接 `api.wsa…` 那种单一 API Key 的认证方式（可后续加）。
- 标准版下 `Mode=1` 恒返回空数组，`Deeplinks` 被忽略——这是账号档位决定的，不是插件问题。
- `Site` 过滤质量取决于元宝索引，实测 `qq.com` 会命中首页快照，建议少用。
