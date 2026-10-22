# @zhuobichen/dsh-client-ui-voice

输入框卡片内、工具行左端的一颗麦克风：**点一下开始听，再点一下停；识别文本写进当前会话的输入框草稿，不自动发送**（用户自己改完再按回车）。

```
┌─ 输入框卡片 ────────────────────────────────┐
│                                             │
│  [＋] [权限] [计划]  🎙   ……            [↑] │
└─────────────────────────────────────────────┘
```

挂在槽位 **`conversation.input.left`**（`conversation.input.dock` 是整行，这里要的是卡片内工具行，所以不用它）。
纯浏览器插件，宿主半身是空的。

## 功能

- 点击 🎙 → `new (window.SpeechRecognition || window.webkitSpeechRecognition)`，开始听。
- 识别中按钮变 ⏹（外加呼吸动画），`aria-pressed=true`；再点一下 `stop()`。
- 参数固定：`lang = 'zh-CN'`、`interimResults = true`、`continuous = false`。
- **只把 `isFinal` 的结果写进草稿**；interim 结果只用来判断"听到了"，不往草稿里写（否则文本会随浏览器反复修正而抖动）。
- 写入位置：**当前会话草稿的末尾**。草稿非空且结尾不是空白时补一个空格，不覆盖已有内容。
- 浏览器不支持、没麦克风权限（`not-allowed`）、没听到声音（`no-speech`）、网络失败等，都会给一句人话：既走 composer 的通知通道（`SessionInput.notify`），也在按钮旁边显示一行小字。

## 安装

```sh
dsh plugin --profile web add ./packages/dsh-client-ui-voice
```

装完**重启 `dsh web`**。刷新页面后，输入框工具行的「＋」后面会出现 🎙。

## 浏览器支持

| 浏览器 | 情况 |
| --- | --- |
| Chrome / Edge 79+ | ✅ 有 `webkitSpeechRecognition`；识别音频由浏览器送到 Google 的语音服务，**需要联网** |
| Safari 14.1+ | ✅ 有 `webkitSpeechRecognition`（行为随版本略有差异） |
| Firefox | ❌ 没有 `SpeechRecognition`；点按钮会显示"当前浏览器不支持语音识别" |
| 其他 | 按 `webkitSpeechRecognition` 是否存在判断，没有就提示 |

另外两点是浏览器的硬要求，不是插件能绕过的：

- 麦克风只在 **HTTPS 或 localhost** 下可用。DSH 部署在纯 HTTP 上时会被浏览器拒绝（插件会提示）。
- 首次使用要在地址栏允许麦克风；拒绝之后再次点击会提示去开权限。

## 实现说明（最终用了哪条写入路径）

**用的是 `setDraft`，不是 `send`。** 而且准备了两条 `setDraft` 路径，按顺序尝试：

注册参数：槽位 `conversation.input.left`、`id: 'voice-input'`、`order: 50`（该槽位目前没有 shipped occupant，order 只是个稳定占位）、`inject: (sessionId) => …`；`inject` 声明是 `["slots", "sessions"]`。

### 首选：槽位标准件 `inputActions.setDraft`

`conversation.input.left` 是 session 作用域的 list 槽位，槽位框架会给每个条目发一套 standard props，其中就包含 `inputActions: InputActions`（公开的草稿操作面，里面是 `setDraft(text)`）。组件里直接：

```js
props.inputActions.setDraft(nextDraft)
```

依据（都在安装目录的 `@deepseek-ai/` 下）：

- `dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:216` —— `conversation.input.left` 的声明（`kind: 'list'`、`scope: 'session'`、owner `InputZone`）。
- `dsh-client-ui-conversation/lib/types/client/input/contract.d.ts:67` —— `InputActions.setDraft(text)`，"Single public draft write path"。
- `dsh-client-ui-conversation/lib/client.js:9504-9514` —— 该会话向标准件注册 `props: ["inputActions"]`，值为 `shell.actions`。
- `dsh-client-web-react/lib/index.js:428`、`:486` —— `Object.assign(standard, info.props)`，再把 `...kit` 展开成条目 props。
- `dsh-client-ui-conversation/lib/client.js:6873` —— `leftItems: renderSlot('conversation.input.left', zone)`，owner props 是 `{ session, input }`。

### 退路：`register` 的 `inject` 面

`apply()` 注册时带一个 `inject: (sessionId) => …`（session 作用域槽位的 inject 工厂第一个参数就是会话 id）。里面：

```js
const actx = ctx.sessions.scope(sessionId)
const conversation = actx.get('conversation') ?? ctx.get('conversation')
conversation.input.for(actx).setDraft(text)
```

这和 DSH 官方 queue dock 的写法逐字同源（`dsh-client-ui-conversation/lib/client.js:6568-6578`：`ctx.sessions.scope(sessionId)` → `actx.get('conversation')` → `conversation.input.for(actx).notify(...)`）。
会话门面是惰性解析的（第一次真要写的时候才解析），解析失败不会让插件整个不挂载，只会把错误挂到提示行 / `notify` 上。

### 为什么不用 `ctx.conversation.send(text)`

`IConversation.send(text)` 的语义是"**把这一句作为 prompt 送进当前会话**"（`dsh-client-ui-conversation/lib/types/client/service.d.ts:37`），也就是说完立刻发送。这和本插件的目标（写草稿、用户自己改完再发）正好相反。所以 `send` 在这里不是退路，是错误路径；代码里也没有调用它。

两条草稿路径最终都进同一台 input machine（`setDraft` → `draft-changed` 事件），都只改草稿、不提交。

## 测试

```sh
node test/contract.test.ts
```

Node 24 原生剥类型，不需要编译。测试加载的是**真正会被下发给浏览器的 `client/client.js`**，用假的 `__ModuleLoader__` / react / slots / sessions / conversation / `SpeechRecognition` 跑完整链路：

- 信封 `id` == `package.json` 的 `name`；
- `factory(stub)` 交出的 `inject` 是数组且包含 `slots`，`apply` 是函数；
- `apply(ctx)` 注册的槽位名是 `conversation.input.left`，组件是函数；
- 假 `ctx.conversation.input.for(...)`（`{ setDraft }`）+ 假 `SpeechRecognition`，喂一条 final 结果 → 断言 `setDraft` 收到那句原文，且 interim 结果不写；
- 已有草稿时追加而不是覆盖；
- 有 `inputActions` 时优先走标准件，不再走注入退路；
- 浏览器不支持 / `not-allowed` / 一个字都没听到，都有可读提示；
- 再点一下会 `stop()`，按钮图标从 🎙 变 ⏹；
- `appendToDraft` / `errorTextOf` 的纯函数护栏。

当前输出：**12 passing**（`tests 12 / pass 12 / fail 0`）。

## 限制（诚实清单）

- **只能追加到草稿末尾。** `SessionInput.setDraft(text)` 写的是整份草稿，DSH 没有公开"按光标位置插入"的接口，所以做不到"插到光标处"。
- 一次点击只录一句：`continuous = false`，浏览器说完自己停。不支持连续听写。
- 语言固定 `zh-CN`，没做语言切换。
- 识别过程中不显示临时文本（interim 只用于内部判断），只在 final 到达时写草稿。
- 依赖浏览器自带语音服务：Chrome/Edge 会把音频发到 Google，断网会报 `network`。DSH 后端不参与、不保存音频。
- **还没在真实浏览器里点过。** 已按安装目录里的 DSH 源码核对槽位声明、standard props 组装和会话作用域写法，并用契约测试跑了整条代码路径；但"麦克风权限弹窗、真实识别质量、HTTPS 部署下的行为"只能在浏览器里验，这部分本仓库的测试覆盖不到。
- 只适用于 `dsh.client.platform = web`（Web GUI）。

## 包结构

```
dsh-client-ui-voice/
├── client/client.js      # 浏览器半身（手写，不是构建产物）
├── index.js              # 宿主半身：空的 apply()
├── package.json          # dsh.bundle.patch + dsh.client.platform=web
├── cordis.patch.yml      # 在 profile 组合树里占一行
├── README.md
└── test/contract.test.ts # node 直接跑
```

`client/client.js` 必须是 classic script，信封 `id` 必须等于包名，`require()` 只能命中静态种子表（这里只用了 `react` 和 `react/jsx-runtime`）。

## License

MIT
