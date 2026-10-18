# @zhuobichen/dsh-balance

DeepSeek 账户余额，作为**输入框上方的一行**。

这是 Claude Code mod [`deepseek-balance`](https://github.com/zhuobichen/zhaowen-claudemod) 的 DSH 移植：同一个数字、同一套措辞、同一条「最近 5 个整小时各花了多少」的时长条，跑在 DeepSeek Harness 上。

```
DeepSeek ¥16.65 · 3m ago · 5h ? 0.34 0.00 ? 5.00
```

## 它给了你什么

| 在哪儿 | 长什么样 |
|---|---|
| **Web GUI** | 输入框上沿一行 12px 灰字（靠 `@zhuobichen/dsh-client-ui-balance` 那半画） |
| **`/bal`** | 立刻重读一次，把结果作为命令输出吐出来 |
| **TUI** | 有 `dsh-tui` 时注册 `${balance}` 提示槽位，加进 `theme.leftPrompt` 就能看到 |

每 5 分钟自动重读一次（`refreshMs` 可调）。

## 安装

```sh
# 从本仓库本地装（link 安装，改完立刻生效）
dsh plugin --profile web add ./packages/dsh-balance
dsh plugin --profile web add ./packages/dsh-client-ui-balance

# 或从 npm（发版后）
dsh plugin --profile web add @zhuobichen/dsh-balance @zhuobichen/dsh-client-ui-balance
```

> **要重启 `dsh web`**：插件集合的变化只在重启后生效（客户端包元数据按名字缓存，永不过期）。
> 装好之后可以在 Web GUI 的**设置 → 插件列表**里看到这两行，`fiberPhase` 应该是 `active`。

### 密钥

余额接口要 DeepSeek 的 API key。按顺序找：

1. DSH 自己的凭据服务 `ctx.credentials` 里的 `ANTHROPIC_AUTH_TOKEN`
2. 同上的 `DEEPSEEK_API_KEY`
3. 进程环境变量里的同名两个

所以最省事的做法是把 key 放进 `~/.dsh/.credentials.yaml` 或 `$DSH_HOME/.env` 的 `DEEPSEEK_API_KEY`。
**没有 key 时它不猜、不发请求**，那一行会直接说 `no key in ANTHROPIC_AUTH_TOKEN or DEEPSEEK_API_KEY`。

## 配置

在 profile 的 `cordis.patch.yml` 里按行 id `balance` 覆盖（注意 patch 是**整行替换**，不是深合并）：

```yaml
- id: balance
  name: '@zhuobichen/dsh-balance'
  config:
    refreshMs: 600000   # 10 分钟
    tuiPrompt: false    # 不注册 TUI 槽位
```

| 键 | 缺省 | 说明 |
|---|---|---|
| `refreshMs` | `300000`（5 分钟） | 多久重读一次 |
| `tuiPrompt` | `true` | 是否注册 TUI 的 `${balance}` 槽位 |

## 它是怎么接上去的

三个接缝，每个都可选，缺了就静默退化：

1. **会话投影 `balance`** —— 每次读数追加一条 log-only 的 `plugin:balance/status` 事件，投影把它折成当前读数（含时长条）。Web 客户端 `useProjection('balance')` 直接读，不需要任何 remote 代码生成。
2. **`/bal` 命令** —— `ctx.commands.register`。
3. **TUI prompt 槽位** —— `ctx.get('tuiPrompt')` 存在时才注册。

意图：**只报它真的看见的东西**。读不到就是读不到的理由，没被观察的小时是 `?` 而不是 0；刷新失败时保留上一次的好数字**和它自己的读取时间**，让旁边的 age 自己说明这个数字有多旧。

## 和 Claude Code 版的三处差别

1. **怎么判断「这条会话该不该显示」**：原版看 `ANTHROPIC_BASE_URL` 里有没有 `deepseek`；DSH 没这个变量，所以改成「能不能解析到 DeepSeek 的密钥」。
2. **密钥从哪儿来**：原版读 Claude Code 的 settings `env`；这里读 DSH 的 `ctx.credentials`。
3. **没有 `hasSurvey` 那个判断**：DSH 的 `conversation.input.dock` 槽位在没有当前会话时整块不渲染，插件不用自己判断。

其余（金额格式、时长条切法、失败保留、措辞）逐字一致，有测试钉着。

## 开发

```sh
npm install
npm run build          # tsc → lib/
node test/balance.test.ts    # 18 条：纯函数（数字/措辞/时长条）
node test/parity.test.ts     # 3 条：客户端与宿主的措辞一致性
node test/host.smoke.ts      # 9 条：拿编译后的 lib/ 在假 Cordis 上下文里真跑
```

三个测试都直接 `node <file>.ts` 跑（Node 24 原生剥类型），不要用 `node --test <dir>`——那会 spawn 子进程。

第四个 `test/integration.mjs` 是另一回事：它用本机 DSH 安装里**真的** `SessionProjectionRegistry`，发真的 `session/event`，读回折出来的值。专门钉两件事——一是 **zod 实例**：我的 schema 和注册表各自那份 zod 若不兼容，症状是插件装得上、不报错、但投影**永远不更新**；二是真驱动的行为（无关事件必须不改状态引用）。没有 DSH 安装时它会自己 SKIP。

`test/parity.test.ts` 值得单说一句：客户端信封里那份措辞是**抄**过去的（浏览器侧拿不到宿主源码），所以这个测试加载**真正会被下发给浏览器的那个 `client.js`**，和宿主逐条对表。改了一边忘了另一边，它会当场变红。

## License

MIT
