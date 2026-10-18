# dsh-client-ui-moon-band

`@zhuobichen/dsh-moon-band` 的**浏览器半身**：把宿主算好的「月相 + 一句古诗」
画在输入框上方（槽位 `conversation.input.dock`，order 14，压在余额行上面）。

只做三件事：

1. 挂载时 `fetch('/dsh-moon-band/line')`；
2. 每 20 秒再问一次（换句的格子是一分钟，20 秒内一定翻过去）；
3. `hidden` 或 `text` 为空就不画——不往页面上写错误文案。

月相、月龄、选句全在宿主侧，这里不做任何天文或语料计算。
