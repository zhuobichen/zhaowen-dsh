# @zhuobichen/dsh-client-ui-balance

DSH Web GUI 里、**输入框上沿**那一行余额。是 [`@zhuobichen/dsh-balance`](../dsh-balance) 的客户端半身。

```
DeepSeek ¥16.65 · 3m ago · 5h ? 0.34 0.00 ? 5.00
```

它自己不算钱、不发请求：每 15 秒拉一次宿主的 `GET /dsh-balance/current`，把回包里**宿主算好的 `line`** 直接画出来。所以**必须先装 `@zhuobichen/dsh-balance`**，否则这个路由不存在，那一行永远不出现（这是有意的——没数据就不占布局）。

余额是**账户级**的，宿主只持有一份状态，所以每个对话、每个标签页看到的是同一个数、同一个读取时刻。

## 安装

```sh
dsh plugin --profile web add ./packages/dsh-client-ui-balance
```

装完**重启 `dsh web`**。

## 这个包为什么长得不像别的包

其他包是 `src/*.ts` + `tsc` 出 `lib/`。这个包**没有构建步骤**，`client/client.js` 就是手写的源码。

原因是 DSH 的客户端模块 ABI 不是普通 ESM，而是一层自注册信封：

```js
window.__ModuleLoader__.load({
  id: '@zhuobichen/dsh-client-ui-balance',   // 必须等于包名
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    // ...这里面可以用 react / react/jsx-runtime 等静态表里的模块...
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
```

官方包（如 `dsh-client-ui-goal`）是用 tsdown 把 JSX + CSS Module 打成的这一层。这里没有构建链，就直接照着这层信封手写，用 `jsx()` 调用代替 JSX——改一行立刻生效，少一整条工具链。

三条硬约束（踩到会静默失败，所以写在这儿）：

1. **必须是 classic script**：顶层不能有 `import`/`export`，浏览器是用 `<script src>` 加载它的。
2. **`require()` 只能命中静态种子表**：`react`、`react/jsx-runtime`、`react-dom`、`@deepseek-ai/cordis`、`dsh-client-ui-slots`、`dsh-client-web-react`、`dsh-client-ui-primitives`、`dsh-client-ui-attachment`、`dsh-client-schema-form`。require 别的 → materialize 抛错，整个插件不激活。
3. **`id` 必须等于包名**，它同时是 `/plugins/<id>/client.js` 的路由键。

## 挂在哪

槽位是 `conversation.input.dock`（输入框上沿、独占一行的那条）。该槽位已有的 order：`todo=0`、`goal=10`、`queue=20`，所以这里取 **15**，夹在目标条和队列之间，不撞号。

组件不拿 `useProjection`：它自己每 **15 秒** `fetch('/dsh-balance/current', { cache: 'no-store' })`，回包里有宿主算好的一整行 `line`（含金额、age、时长条），照着画即可——措辞只有宿主那一份，客户端不抄第二份，也就不会漂移。拿不到（非 200 / 网络错 / 宿主还没给出可用的一行）就 `return null`，不画、不占布局；已经拿到过的那一行在宿主短暂抽风时保持不动，免得一闪一闪。

## 样式

跟着 DSH 自己的 StatsLine（会话底部那行 12px 灰字）走：`12px` + `--dsw-alias-label-tertiary` + `line-height:20px`，宽度对齐 `--dsh-chat-content-width`。

**不带 margin**——父级 `composerStack` 已经用 `--dsh-composer-stack-gap`（6px）排好了间距。

## License

MIT
