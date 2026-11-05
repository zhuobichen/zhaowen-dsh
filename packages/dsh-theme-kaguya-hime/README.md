# 超时空辉夜姬 · TSUKUYOMI 主题（DSH Web UI）

给 DeepSeek Harness Web UI 套一层《超时空辉夜姬！》题材的皮：蜡笔绘本背景、Q 版八千代头像、`TSUKUYOMI` 字标、冷蓝白配色，以及星蓝色的「新会话」主按钮。

## 效果

| 位置 | 原来 | 现在 |
| --- | --- | --- |
| 整幅背景 | 无 | 蜡笔 + 水彩绘本页（三人夜游月读街头），透明度 0.22 铺底 |
| 侧栏左上品牌图 | 鲸鱼 | Q 版八千代（圆形头像） |
| 侧栏品牌字 | `deepseek HARNESS` | `TSUKUYOMI HARNESS` |
| 空白会话 Hero 图标 | 鲸鱼 | Q 版八千代（同一张） |
| 整体配色 | 原生浅色 | 冷蓝白 `kaguya-sky` 主题（只换颜色 token，不动间距/字体/布局） |
| 「新会话」按钮 | 白底描边 | 星蓝实心 + 白字 |
| 右下角 | 无 | 「极简机器人脸」八千代从角落探出头（纯装饰、可点穿） |

## 实现方式

一个纯动态 Client 插件，只做五件事：

1. 注册浅色主题 `kaguya-sky`（`ctx.theme.register`），并持续接管，保证插件开关、刷新后不会掉回深色；
2. 在 `shell.overlay` 放一张固定定位、`pointer-events: none` 的背景图（不参与布局）；
3. 覆盖 `sidebar.brand.mark` / `sidebar.brand.name` / `conversation.hero.brand.mark` 三个展示槽；
4. 一段定向 CSS，把「新会话」按钮刷成星蓝；
5. `shell.overlay` 里再放一张右下角探头图（`23vh` 左右，只露头和手）。

图片全部以 data URI 内嵌在 `client.js` 里，装好即用，不需要额外静态服务。

## 安装

```bash
dsh plugin --profile <profile> add /path/to/packages/dsh-theme-kaguya-hime
```

装完刷新页面。不想用了在「插件」页禁用即可。

## 素材与版权

- 角色立绘来自《超かぐや姫！》官方网站角色页（©コロリド・ツインエンジンパートナーズ），仅作本地个人装饰用途，请勿再分发。
- Q 版头像与蜡笔绘本背景是用 `gpt-image-2.5` 以上述官方立绘为参考图重绘的，同属二次创作，仅供个人使用。

## 可调项

`client.js` 顶部：

- `ART`：背景图（data URI）；
- `.gy-wrap` 里 `opacity`：背景浓淡，当前 `0.22`；
- `TOKENS`：主题色板；
- `GROUP` / chibi 相关常量已移除，如需贴纸可自行恢复。
