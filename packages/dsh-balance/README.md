# @zhuobichen/dsh-balance

DeepSeek 账户余额，作为**输入框上方的一行**。

这是 Claude Code mod [`deepseek-balance`](https://github.com/zhuobichen/zhaowen-claudemod) 的 DSH 移植：同一个数字、同一套措辞、同一条「最近 5 个整小时各花了多少」的时长条，跑在 DeepSeek Harness 上。

```
DeepSeek ¥16.65 · 3m ago · 5h ? 0.34 0.00 ? 5.00
```

## 它给了你什么

| 在哪儿 | 长什么样 |
|---|---|
| **Web GUI** | 输入框上沿一行 12px 灰字（本包内的客户端半身 `client/client.js` 画） |
| **`/bal`** | 立刻重读一次，把结果作为命令输出吐出来 |
| **TUI** | 有 `dsh-tui` 时注册 `${balance}` 提示槽位，加进 `theme.leftPrompt` 就能看到 |

每 5 分钟自动重读一次（`refreshMs` 可调）；Web 那一行每 15 秒拉一次宿主的 `GET /dsh-balance/current`，所以**所有对话永远是同一个数**，新对话一打开就有，不用等下一拍。

## 安装

```sh
# 从本仓库本地装（link 安装，改完立刻生效）
dsh plugin --profile web add ./packages/dsh-balance

# 或从 npm（发版后）
dsh plugin --profile web add @zhuobichen/dsh-balance
```

> **要重启 `dsh web`**：插件集合的变化只在重启后生效（客户端包元数据按名字缓存，永不过期）。
> 装好之后可以在 Web GUI 的**设置 → 插件列表**里看到这一行，`fiberPhase` 应该是 `active`；
> 宿主半身和客户端半身都在这个包里，**只装一次**。

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

1. **宿主持有唯一状态 + 只读路由** —— 余额是**账户级**的，所以状态只有一份：当前读数 + 算时长条用的采样历史，落盘在 `$DSH_HOME/plugins/dsh-balance/state.json`（重启后时长条还在）。客户端拉 `GET /dsh-balance/current`，回包是
   `{ line, kind, amount, total, atMs, note, hours, ts }`，其中 `line` 是宿主算好的整行。
2. **`/bal` 命令** —— `ctx.commands.register`，立刻重读一次并把结果作为命令输出。
3. **TUI prompt 槽位** —— `ctx.get('tuiPrompt')` 存在时才注册。

> **为什么不在会话投影里**：账户级的数字放进会话级的投影，就变成每个对话各存一份
> 「最后一次采样时的快照」——不同对话显示的金额不一样（本质是读数时间不同）。
> 那是这个插件修掉的一个真 bug。现在宿主只有一份状态，`/bal`、TUI、Web 读的都是它。

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
node test/parity.test.ts     # 8 条：客户端画的就是宿主给的 line + 挂载契约
node test/host.smoke.ts      # 14 条：拿编译后的 lib/ 在假 Cordis 上下文里真跑
node test/integration.mjs    # 落盘 roundtrip：重启后时长条还在、不同对话同一个数
```

前三个都直接 `node <file>.ts` 跑（Node 24 原生剥类型），不要用 `node --test <dir>`——那会 spawn 子进程。

第四个 `test/integration.mjs` 起**两个宿主实例共用一个临时 `DSH_HOME`**，中间只隔着一次 `apply`（就是「重启」的最短复现）：宿主 A 采两次并落盘 → 检查 state.json 里有读数、有采样、**没有** `hours`（那是纯函数现算的）→ 宿主 B 用「永远不返回」的假 fetch 启动，证明它给出的数字只可能来自文件；最后用三个不同 `session` 的请求断言金额与读取时刻完全一致（那个 bug 的回归）。它不需要本机装 DSH、也不开端口，只要求先 `npm run build`。

`test/parity.test.ts` 值得单说一句：它加载**真正会被下发给浏览器的那个 `client.js`**，用一对最小的 react 桩把组件跑起来，然后逐字比对「画出来的字」和宿主 `lineOf` 的输出；还有一条故意喂一条和字段互相矛盾的 `line`，证明客户端**不再自己算**（之前它抄了一份 `lineOf`，靠对表防漂移）。

## License

MIT
