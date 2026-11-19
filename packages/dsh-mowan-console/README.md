# 破甲工具台（@local/dsh-mowan-console）

**只改指定会话**，并且每一次改动都留记录。不改宿主源码、不动审批、不动沙箱。

## 它做两件事

| 层 | 挂点 | 效果 | 作用域 |
|---|---|---|---|
| 软注入 | `ctx.systemPrompt.section()` | 每轮组装时往系统提示里塞一段会话专属设定 | 只对该 `sessionId` |
| 换模型 | `ctx.on('agent/request')` waterfall | 替换该会话的 `provider` / `model` / `temperature` | 只对该 `sessionId` |

**为什么软注入不用开新会话**：系统提示本来就是**每一轮重新组装**的，`section.text` 每次组装都会被调用。
所以规则一改，下一轮就生效，历史上下文不受影响。

**为什么改模型也能只针对一个会话**：`agent/request` 的 payload 里带着 `agent`（即 sessionId），
返回一个替换过的 `LlmCallConfig` 即可。文档明确写这个 waterfall *cannot mutate messages*，
所以它能换模型参数，但改不了消息内容——两条路互不冲突。

## 用法

```
mowan op=status                          # 看现有规则
mowan op=set_prompt  session_id=... text="..."    # 给某会话注入
mowan op=clear_prompt session_id=...               # 撤掉注入
mowan op=set_model   session_id=... model=qwen-max # 把某会话换模型
mowan op=clear_model session_id=...                # 模型复原
mowan op=log         limit=50                      # 看审计
```

## 落盘位置

```
$DSH_HOME/plugins/dsh-mowan-console/rules.json      # 当前规则
$DSH_HOME/plugins/dsh-mowan-console/changes.jsonl   # 审计，append-only
```

审计里每一条都带 `at / op / sessionId / before / after / caller`。
**注入成功时也会写一条 `inject`**，所以你能验证「这条规则到底有没有真的用上」——
而不是改完只能靠感觉。

## 已知边界

- `PromptSection.text` 拿不到 `sessionId`（`AssembleContext` 只有 `scope`/`signal`），
  所以用 `ctx.agents.currentInitiator()` 反查当前 agent。拿不到时不注入（宁缺勿错）。
- 模型替换要求目标 `provider` 已在本机 `llm` 里注册；没注册会在该会话报错。
- 只对**新的一轮**生效，正在跑的那一轮不受影响。
