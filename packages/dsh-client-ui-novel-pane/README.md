# dsh-client-ui-novel-pane

`@zhuobichen/dsh-novel-pane` 的**浏览器半身**：在输入框上方画那间读书窗格
（槽位 `conversation.input.dock`，order 16——余额与月光之下、队列之上）。

| 做什么 | 怎么做 |
| --- | --- |
| 取状态 | `GET /dsh-novel-pane/state?rows=18`，每 3 秒一次（这样在提示框里敲 `/novel n` 窗格也会跟着翻） |
| 按钮 / 滚轮 | `POST /dsh-novel-pane/move`，`op` 是 `mode` / `up` / `down` / `top` / `close` / `wheel` / `open-book` |
| 书单 | 点头部的 `☰`，状态里带上 `shelf` 数组；点书名发 `open-book` |

分页、折行、进度文案全在宿主，这里只管画。
