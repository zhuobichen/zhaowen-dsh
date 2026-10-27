# dsh-agent-dispatch

在**动手之前**判断：这件事该由当前 Agent 直接做完，还是拆给子 Agent。

## 结论先说

**默认不拆。** 判据来自 Anthropic Applied AI 团队的企业级复盘：

> 配备了 Skills 的「单 Agent」，输出质量往往优于复杂的「子 Agent」架构，单任务成本与延迟也更低。

子 Agent 只在**三个门槛之一**成立时才保留：

| 门槛 | 判据 | 注意 |
|---|---|---|
| ① 上下文膨胀 | **可测量**的性能衰退（跑过、变差过） | 要证据，不是"材料看起来多" |
| ② 独立并发 | 高并发 + 各任务上下文独立（用完即弃的新窗口） | 共享状态就不算 |
| ③ 工具过载 | 工具 >30–50 个，或系统提示词指令互相冲突 | 选不动工具才拆 |

不满足就并回主循环：**单 Agent + Skills/工具搜索（渐进式披露）**。

## 两个工具

| 工具 | 用途 |
|---|---|
| `dsh_dispatch_decide` | 给任务 → 结论 + 三个门槛判定 + 计划 + 成本/延迟量级 |
| `dsh_dispatch_rubric` | 判定表：门槛、五大失败模式、反模式、四步迁移 |

```
dsh_dispatch_decide({
  task: "找出这个函数在 users、orders、payments 三个服务里分别被谁调用",
  signals: { independentTargets: 3, concurrency: true, summaryOnly: true }
})
```

`signals` 全可选，不给也能从描述里推断。关键字段：

```
measuredDegradation  门槛① 的证据（布尔）
independentTargets   互不依赖的目标数
concurrency          真要并行
toolCount            挂了多少工具
instructionConflict  指令打架
detailSensitive      'low' | 'medium' | 'high'   ← 最有用的一个
sequential / sharedContext / interactive / breadth / contextLoad
```

## 三种结论

### `single` —— 直接做

顺序依赖、共用上下文、逐字精确、中途要人拍板、单目标。

### `single+progressive` —— 单 Agent + 渐进式披露

**最常被误判成"该拆子 Agent"的一类：材料多，但没有劣化证据。**

做法：先列索引 → 按关键词定位 → 只读命中处 → 原文留在上下文里，总结留到最后。把领域步骤写进 Skill，把硬约束（审批/权限/存在性检查）放进工具。

这之所以成立，是因为：共享上下文能产出更好的回答；渐进式披露能防止膨胀；模型本身变强了（Claude Code 的系统提示词因此缩减了 80%+）。

### `subagents` —— 拆

只按**上下文边界**切，不按业务/问题类型切（那是把组织架构图照搬进技术架构）。每路只拿自己那份材料，回传只收「结论 + 证据位置 + 没查到什么」。

门槛成立但要求逐字时，引擎会**自动降级**为渐进式披露，并标 `detail-loss` 风险——交接是有损的。

## 五大失败模式（`dsh_dispatch_rubric` 会一并返回）

1. **上下文丢失** —— 交接越多，保真度越低
2. **子 Agent 泛滥** —— 各团队各交一个，最后上百个互相重叠
3. **拼接提示词冲突** —— 各加一句，口吻割裂、规则打架
4. **评测局部化** —— 各团队只优化自己的子任务，端到端分数失真
5. **高延迟** —— 多 Agent 跳转耗时，单循环约 2× 快

## 成本与延迟

```
单循环  ≈ parentOverhead + 材料量 + 20% 加工
n 路子  ≈ n × (childOverhead + 材料量/n) + parentOverhead + 12% 摘要
延迟    ≈ n 路并行仍要每次往返 → 默认按 2× 记
默认 parent=4000 / child=6000 / summaryRatio=0.12 / latencyPenalty=2
```

**拆开不省钱，换来的是并行与上下文隔离。** 数字是量级判断，不是账单。

## 已经有一堆子 Agent 怎么收

`dsh_dispatch_rubric().migration` 给出四步：

1. 建端到端评测集（10 个黄金样例够起步），判断哪个子 Agent 该并回
2. 先合并紧密耦合的（输出串联 / 访问同一份数据 / 常被连着调用）
3. 过渡期把保留的子 Agent 降级为**工具**（主 Agent 继续对话）
4. 逐一转成 Skills + MCP 工具；每次只改一个，比得分**和"翻转过哪些任务"**

## 安装

```bash
dsh plugin add @zhuobichen/dsh-agent-dispatch
```

或 profile 里 `link:` + 把包名加进 `dsh.profile.bundles`，重启 DSH。

## 测试

```bash
node --test "test/*.test.ts"
```

12 个用例：并行检索（门槛②）、改配置值（无门槛→single）、顺序重构、20 篇调研、大仓库取原文（→渐进式）、劣化证据（门槛①）、工具过载（门槛③）、门槛成立但要求逐字（→降级+报风险）、成本方向、信号推断、空输入、门槛清单。
