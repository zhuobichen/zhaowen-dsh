# AI 工作台（dsh-ai-workbench）

一个**嵌套结构**的工作台：顶层是「AI 工作台」标签，里面细分小工作台。
目前引入第一个：**Agent 设计工作台**。

和设计/代码/论文工作台同构——面板给人挑，`ai_style` 工具给 AI 读同一份数据，
挑中一条复制索引粘给 AI，AI 用 `ai_style op=get <id>` 展开完整规格。

## 结构

```
AI 工作台
└── Agent 设计工作台（19 条）
    ├── 架构模式（6）  提示词链 / 路由 / 并行 / 编排者-工人 / 评估者-优化者 / Agent vs Workflow
    ├── Skill 设计（4）Agent Skills 规范与渐进式披露 / description 触发 / 四者抉择 / Hooks 编排
    ├── 上下文工程（4）五层栈 / ACI 工具文档 / 上下文过载 / 透明性
    ├── 评估与安全（3）Evals / Guardrails / 成本缓存
    └── 本机经验（2）agent-dispatch / zcode-kimi-integration
```

## AI 通道

```
ai_style op=list                     列全部小工作台/分类/条目
ai_style op=section {id:agent}       看某个小工作台
ai_style op=layer {id:pattern}       看某分类
ai_style op=get {id}                 完整规格（要点/做法/原始材料）
ai_style op=search {id:关键词}       按名称/标签/出处搜
写：add / update / remove / pin / unpin / hide / unhide / reorder
运维：stats / export / import
```

用户说「用那个 superpowers」「按 Anthropic 的模式来」「看工作台里的 Agent 设计」时，
先用 search / list 找 id，再 get 拿规格。

## 资料来源

以云端权威规范为主：[Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)
（五种架构模式）、[Agent Skills](https://www.anthropic.com/research/equipping-agents-for-the-real-world-with-agent-skills)
（渐进式披露开放标准）、OpenAI 的 Evals / Guardrails / 成本优化、Context Engineering 五层栈，
以及本机的 `agent-dispatch` / `zcode-kimi-integration` 两个 skill。

每条都挂原始材料（URL 或本机路径）。

## 怎么加第二个小工作台

在 `catalog.js` 里新增一个 section（像 `SECTIONS` 那样），再往 profile 的 bundles 确认包已启用。
面板会自动多一个子工作台按钮，AI 工具也会在 `op=list` 里列出来。
