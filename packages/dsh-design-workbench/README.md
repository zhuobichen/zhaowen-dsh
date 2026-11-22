# 设计工作台（dsh-design-workbench）

给「我想要那种风格」这件事一个**不用翻代码的出口**。

平时想指定前端长什么样，只能描述（"蓝白色、圆角小一点、浮起来那种"）或者翻仓库找那段 CSS。
这个插件把本机已经存在的**八种真实设计样式**做成并排的卡片：同一块迷你界面、八套皮肤，
看着挑，点一下就把「引用给 AI」的整段文本复制走，或者直接「选中它」让 AI 读到。

## 它解决什么

| 之前 | 现在 |
|---|---|
| 描述风格靠形容词，来回收敛好几轮 | 八张卡片并排比，同一块界面的不同皮肤 |
| 想精确指定就得翻 `client.js` 里的 CSS | 卡片里直接给 token、阴影、圆角、字号 |
| 说了「用那个蓝白的」，AI 还是猜 | 「选中它」落盘，AI 用 `design_style op=current` 直接读 |

## 八种样式（全部量自本机代码）

| id | 名称 | 出处 |
|---|---|---|
| `dsh-native` | DSH 原生基线 | 各插件共用的 `var(--dsw-alias-*)` |
| `dash-compact` | 紧凑仪表盘 | `packages/dsh-mowan-console/client.js` |
| `float-panel` | 悬浮面板 | `packages/dsh-deliverables-index/client/client.js` |
| `drawer` | 侧滑抽屉 | `packages/dsh-novel-pane/client/client.js` |
| `glass-dark` | 暗色玻璃卡 | `packages/dsh-agent-supervisor/client/client.js` |
| `kaguya-sky` | 冷蓝绘本 | `packages/dsh-theme-kaguya-hime/client.js` 的 token 表 |
| `mono-timeline` | 等宽时间线 | `dsh/home/plugins/dsh-qq-panel/client.js` |
| `mini-row` | 极简单行 | `packages/dsh-moon-band` + `packages/dsh-balance` |

**怎么量出来的**：`scripts/design-fingerprint.mjs`（临时脚本，未入库）对每个 `client.js` 的 CSS
做统计——十六进制颜色频次、`border-radius` 取值、`font-size` 档位、`box-shadow` 原文、
`var(--dsw-alias-*)` 引用次数——然后人工挑出最有代表性的几档写进 `catalog.js`。
所以表里的 `6px / 7px / 8px`、`ui-monospace`、双层阴影这些数字不是编的，是从那几份文件里数出来的。

## 面板怎么用

1. 顶栏搜关键词，或用芯片按用途过滤（面板 / 仪表盘 / 抽屉 / 暗色 / 极简）。
2. 每张卡片是**同一块迷你界面**的换皮预览（`iframe + srcDoc`，样式互不污染）。
3. 点卡片 → 下面出细节：大图、色板、圆角/密度/阴影、适合与不适合、完整的「引用给 AI」正文。
4. 三个按钮：
   - **选中它 → AI 可见**：写 `state.json` + 审计，AI 用 `design_style` 能读到；
   - **复制 引用给 AI**：整段 prompt（含 token 与约束），直接粘进对话；
   - **复制 CSS**：只要那几行 token。

## 工具

```
design_style op=list      列出八种（id / 名称 / 一句话 / 出处）
design_style op=get       {id} → 完整 token + prompt
design_style op=current   用户当前选中的那一种（含 prompt）
design_style op=pick      {id} 替用户选中（他说"就用第三种"时用）
```

写前端前先 `op=current`：用户可能已经在工作台里挑好了，别再问一遍。

## 数据落点

```
$DSH_HOME/plugins/dsh-design-workbench/
  state.json      { picked: {id, at, by}, recent: [...] }
  changes.jsonl   append-only 审计（pick / 谁选的 / 什么时候）
```

## 边界

- 不改宿主主题，不注入全局 CSS（面板自己的样式挂 `data-design-workbench` 属性）。
- 预览是静态 HTML，无脚本；不读其它插件的 DOM 或样式表。
- 样式目录只有 `catalog.js` 一份，宿主与面板共用，不会两处漂移。
