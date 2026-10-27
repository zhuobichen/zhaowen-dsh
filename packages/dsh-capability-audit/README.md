# dsh-capability-audit

长期使用之后，**哪些能力在真干活、哪些只是占位置**。

一次调用输出四组指标 + 建议清单：

| 组 | 内容 |
|---|---|
| **profiles** | 任务画像（code / research / browser / mixed…），canary 分组用 |
| **skills** | 每轮上下文成本 / 机会 / 触发 / 漏 / 按画像拆分 / 加载后归因 |
| **mcp** | 按 server：调用、成功率、**p50/p95**、覆盖会话、最后使用、**错误分类** |
| **tools** | 原生工具：同上 |

## 口径（必须先看）

**skill 的"机会"是推断。** 来自"用户消息里命中该 skill 的名字或同义词"，输出固定带 `inferred: true`。它回答的是"这些会话提到了相关意图但没调用"，**不是**"没调用就错了"。

**首次可用时间**取自会话里 `<available_skills>` 第一次出现的时间——这是它在这台机器上真正可用的起点，晚做的 skill 不会被算上更早的机会。

**自指已排除**：那份清单本身写在用户消息里、包含每个名字，匹配前会被剥掉，否则所有 skill 都会虚高。

**token 是累计计费量**，不是净上下文：每一步都会重发整段历史。`tokenBreakdown` 里 `input`/`cacheRead` 是大头，`output` 才是生成。

## 三类成本，别混着看

| 指标 | 含义 | 谁在用 |
|---|---|---|
| 每轮上下文成本 `contextCost` | 清单行 token/轮 × 轮数 = 累计为这个 skill 付的上下文 | Claude Code `/skill-doctor` |
| 加载后归因 `attribution` | skill 加载那一轮里后续调用的工具数 / 消耗 token | LangSmith 的父子 span（近似） |
| 触发率 `triggerRate` | 触发会话 / 机会会话 | 本插件独有（因为要"该不该触发"的判断） |

## 用法

```
dsh_capability_audit({ format: "text" })
dsh_capability_audit({ format: "json", refresh: true })
dsh_capability_audit({ staleDays: 30, slowMs: 120000 })
dsh_capability_audit({ examples: true })
```

### 三个新字段

| 字段 | 说明 |
|---|---|
| `lastAvailableAt` | 该 skill 最后一次出现在清单里的时间。**成本窗口在它处停止**——卸载后不该继续计费 |
| `examples` | 每个 skill 最多 5 条"命中但没调用"的用户原话，**截取命中词附近**（不是句首），用来判断是关键词太宽还是真漏触发 |
| `failureSamples` | 每个工具/MCP 最多 3 条失败原文 + 分类；光有分类看不出该修哪里 |

### 系统消息已排除

`background job ...`、`<task-notification>`、`<goal_round>`、`This session is being continued...` 这类**不是用户意图**的消息会被过滤，否则机会数系统性虚高（实测虚高 30–60%）。清单块仍照常读取——那是安装事实，不是意图。

## 判定规则

| kind | 条件 | 怎么处理 |
|---|---|---|
| `skill-never-used` | 已安装 + 0 次调用 | 归档/停用（别直接删，低频任务还会用到） |
| `skill-costly-idle` | 累计上下文成本 ≥20 万 token 且触发率 ≤20% | 优先归档——这是最大浪费 |
| `skill-trigger-mismatch` | 机会 ≥5 且触发率 ≤20% | 先看例句：改描述加中文触发词，或从匹配表删掉过宽的词 |
| `skill-loaded-no-work` | 加载过但那一轮无后续工具调用 | 可能"拉进来没用"，也可能纯问答 |
| `mcp-one-off` | 只覆盖 1 个会话且 ≥21 天没碰 | 保留即可（MCP 不占每轮上下文） |
| `mcp-slow` | **p95** ≥60s | 加超时/改异步（平均值会被单次异常拉爆） |
| `mcp-flaky` / `tool-flaky` | 成功率 <90% | 看 `errorTypes` 是哪一类 |

## 方法论（来自同类产品）

- **成本单位是"每轮"**：skill 清单每轮都会注入，闲着也在付费（Claude Code `/skill-doctor`）
- **判定要重复采样**：一个安静会话不是全局结论；至少跨几次同类任务（canary）——`profiles` 就是给这个用的
- **用分位数不用平均**：一次 11 小时的调用会把 avg 拉爆，p95 不会
- **归档而非删除**：周五才用的部署 skill，canary 上看不出损失

## 性能

81 个会话（约 2.3 万次调用 / 1.7 万步 token 记录）冷扫约 10.6 秒；5 分钟内走缓存。

## 测试

```bash
node --test "test/*.test.ts"
```

12 个用例：时间基线、按会话去重触发、MCP 聚合、工具统计、never-used/mismatch、MCP 慢/一次性/不稳、别名表、空输入、归因（同 turn 先后）、画像分组、分位数与错误分类、成本+token+画像拆分。
