# 写作工作台（dsh-writing-workbench）

按题材分标签页的写作资料库，整体风格用「1930s 橡皮管卡通」（漫画 · cm-rubber-hose）：
黑白手绘、橡皮管肢体、万物随爵士乐呼吸、4:3 胶片门、line boil 抖动、胶片划痕。

## 题材标签页

| 标签页 | 收录 |
|---|---|
| 小说 | 网文 skill 精选 244 个 / 三幕结构 / 百万字防漂移 / 去 AI 味 |
| 新闻 | 倒金字塔+AP 写法 / 科技新闻聚合 / 深度调查蓝图 |
| 公众号 | 日志到公众号+X 双语 / 卡兹克长文 / 商业技术文章 |
| 古诗 | 古典诗词生成与格律 / chinese-poetry 数据结构 |
| 通用技法 | 去 AI 味 / 斯坦福科学写作 / ABT 叙事框架 |

## AI 通道

和设计/代码/论文工作台同构——面板给人挑，`writing_style` 工具给 AI 读同一份：

```
writing_style op=list              列全部题材与条目
writing_style op=page {id:novel}   看某题材标签页
writing_style op=get {id}          取完整规格
writing_style op=search {id:关键词} 搜
写：add / update / remove / pin / unpin / hide / unhide / reorder
运维：stats / export / import
```

用户说「按倒金字塔写」「用那个网文 skill」「看工作台里古诗那条」时先 list/search 找 id 再 get。

## 风格出处

- 云端原文：https://github.com/lemomo-ai/lemo-opuscar/blob/main/styles/rubber-hose/STYLE.md
- 本地规范：`D:/github_project/ZhaoWen_GitHub维护/code-to-film/lemo-opuscar/styles/rubber-hose/STYLE.md`
- 本地样张：`.../rubber-hose/poster.jpg`（仅为参考图，非提示词规范）
