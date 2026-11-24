# 代码工作台（dsh-code-workbench）

把**代码相关的资料**整理成五层，看着挑，点一下就把「按这个来」变成 AI 能读到的记录。

```
架构范式（6）   分层 / Clean·六边形 / CQRS+事件溯源 / 事件驱动 / 模块化单体 / 微服务
工程实践（6）   TDD / 代码评审 / 重构 / ADR / 可观测性 / CI-CD
代码风格（5）   SOLID / 函数式 / 错误处理 / 命名与结构 / 数据导向
Agent 技能（8） superpowers / addyosmani / karpathy / agent-rules-books / solid-skills / ECC / taste / caveman
工具链（5）     ESLint+Prettier / TS 严格模式 / Biome / ruff+uv / act
```

共 **30 条**，全部是 `referenced`（别人写的规范与开源 skill），只作参照。

## 它解决什么

写代码时的选择比设计更散：架构怎么切、测试写到什么程度、错误怎么传、用哪套 lint。
这些平时散在博客、书、别人的仓库里，真要动手时又得重新找一遍。

代码工作台把它们收成一屏：

- 每层并排看，卡片给要点（带具体阈值：400 行、40 行、p95、dependency depth）
- 点开有「怎么用」与「什么情况下别用」——后者往往比前者值钱
- 「选中它」落一条索引，AI 用 `code_style` 工具就能读到

## 工具

```
code_style op=list                                   五层全列
code_style op=layer {arch|practice|style|skill|tool}  只看一层
code_style op=get {id}                               完整规格（要点 / 出处 / 怎么用）
code_style op=search {关键词}                        按名称 / 标签 / 出处搜
```

引用是**索引式**的（和设计工作台一致）：

```
按代码工作台里的「Clean Architecture / 六边形」（架构范式 · arch-clean）来做。
出处：Robert C. Martin · Clean Architecture；Alistair Cockburn · Hexagonal
要看完整规格：code_style op=get arch-clean
```

AI 拿到这一行，需要细节时自己 `op=get` 展开，不把整页塞进对话。

## 和设计工作台的区别

| | 设计工作台 | 代码工作台 |
|---|---|---|
| 层 | 6 层（App / 前端 / 视频 / 代码生视频 / 漫画 / 动效） | 5 层（架构 / 实践 / 风格 / 技能 / 工具链） |
| 默认筛选 | 只看风格 | **全部**（这里的条目多是方法，不是视觉风格） |
| 条目性质 | 大多是 style（可照着做的视觉方案） | 大多是 method（可照着执行的工程规范） |
| 封面 | 大量真截图 | 主要是色卡（规范类没有可截的界面） |

## 面板怎么用

1. 顶部五个大标签切层；下面是这一层的筛选芯片 + 搜索
2. 没有封面的条目默认收进「🗑 垃圾箱」（这个库里主要就是色卡条目，所以垃圾箱基本是空的）
3. 点卡片看细节：要点、出处、怎么用、可复制的一行索引

## 加条目

只改 `catalog.js`：在对应层的数组里加一条
`{ id, layer, name, oneLine, source, tags, kind, bullets, howto, origin }`。
`prompt` 与 `spec` 由 `refOf()` / `specOf()` 统一生成。

每层还有一组 `filters`（面板上那排筛选芯片）：语义不重叠、每个至少命中 2 条。

## 改完怎么生效

| 改的是 | 生效方式 |
|---|---|
| `client.js` | 页面 F5 |
| `index.js` / `catalog.js` | 用 `plugin_manager` 把 `include:code-workbench` 禁用再启用 |
| `package.json` / 新增包 | 必须重启 DSH |

## 边界

- 只读本机文件；写盘只有 `extra.json` 与 `changes.jsonl`
- 条目内容是对公开规范的摘要，不是原文复制；出处都写明了作者与作品
