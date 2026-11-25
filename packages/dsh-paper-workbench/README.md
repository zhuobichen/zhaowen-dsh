# 论文工作台（dsh-paper-workbench）

把本机的论文 skill / MCP / 插件收成一屏，像设计工作台那样：看着挑，点一下把「按这个来」变成 AI 能读到的索引。

## 七层

| 层 | 内容 |
|---|---|
| 写作与润色 | 反防御性写作、LaTeX 写作编译、PPT 提示词审计、公众号长文 |
| 选题与创新 | 撞题检查、横纵分析、多库论文检索 |
| 统计与方法 | 统计分析、科学批判性思维、单位不确定度、PM2.5 日值处理 |
| 文献 · Zotero | zotero 主 skill / 直连 SQLite / 全文检索 |
| 文献 · CNKI | 检索、高级检索、下载、导出、详情、期刊检索/收录/目录、翻页、结果解析 |
| 检索与发布 | Tavily、网页抓取、正文提取、HuggingFace 论文发布 |
| MCP 工具 | 本机 Zotero MCP、腾讯文档 MCP |

共 31 条，标注「自建 / 内置 / 社区」出处，只作参照。

## 工具

```
paper_style op=list                         七层全列
paper_style op=layer {id}                   只看一层
paper_style op=get {id}                     完整规格（要点 / 出处 / 怎么用）
paper_style op=search {关键词}              按名称 / 标签 / 出处搜
```

引用是索引式的，**格式与设计工作台逐行同构**（首行「用X工作台里的『名』（层 · id），按这个设计来」→ 原始材料（URL）→ 本地副本（真实路径）→ 要看完整规格）；四个 op 的返回元数据字段也与它们同构（count / nature / layers / entries / ref / spec / members）。

```
用论文工作台里的「Tavily 网络检索」（检索与发布 · s-tavily），按这个设计来。
原始材料：https://tavily.com
本地副本：~/.agents/skills/tavily/SKILL.md
要看完整规格：paper_style op=get s-tavily
```

和设计工作台的「浮世绘」引用（原始材料 GitHub URL + 本地副本 D 盘路径）完全同一个结构。本机自建、无公开来源的 skill 没有云端 URL，原始材料退回 skill 来源说明，本地副本仍给真实路径；不编造 URL。

完整规格 `op=get` 的结构也统一：【论文参考】名（层）→ 一句话 → 出处 → 要点 → 原始材料（列表：官方站点/本地 SKILL.md）→ 怎么用 → 统一收尾话术。AI 拿到索引行，需要细节时自己 `op=get` 展开，不把整页塞进对话。

## 与设计工作台的关系

UI 完全复刻设计工作台（client.js 同源，样式一致：多层标签 + 筛选芯片 + 卡片 + 详情 + 一键复制引用）。
内容全由 `catalog.js` 决定；工作台是只读的，不写 state、不留审计。

## 加条目

只改 `catalog.js`：在对应层的数组里加一条
`{ id, layer, name, oneLine, source, tags, kind, bullets, howto, origin }`。
`prompt` 与 `spec` 由 `refOf()` / `specOf()` 统一生成。

## 改完怎么生效

| 改的是 | 生效方式 |
|---|---|
| `client.js` | 页面 F5 |
| `index.js` / `catalog.js` | 用 plugin_manager 禁用再启用，或重启 |
| `package.json` / 新增包 | 必须重启 DSH |

## 边界

只读本机文件与内置目录清单，不发网络请求；不改动任何 skill/MCP 本身，只做索引与引用。
