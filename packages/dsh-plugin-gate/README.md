# dsh-plugin-gate

**会话级插件闸门。** 默认什么都不做（所有插件照今天一样全局注入）；在某个会话里 `/gate on <能力集>` 之后，**只有那个会话**的工具目录被裁剪成指定插件注册的那几件，其余工具从模型视野里消失——不卸载插件、不改 profile、不动对话历史。

```
/gate list              看配置里有哪些能力集
/gate on writing        本会话开闸，只放行 writing 这套
/gate status            本会话现在什么状态、放行了哪些工具
/gate off               关闸，恢复全局注入
```

## 为什么不是现成方案

| 现成的 | 做不到的部分 |
|---|---|
| `agent preset` | 只能**加**一层，没法对 profile 层注册做减法；换预设还要求会话没开跑 |
| `dsh-preset-tool-filter` | 键是 preset，不是会话；没有“默认关、按会话开”的开关 |
| `dsh-capability-panel` | 是逐项开关（deny 语义）加面板 UI，没有“只留这些”的 allow 模式 |

这个插件补的就是这三者之间那条缝：**按会话、allowlist 语义、默认关**。

## 机制

DSH 里「插件注入了什么」其实是三个面，本插件只碰第一个：

| 面 | 接缝 | 本插件 |
|---|---|---|
| 工具 | `agent.ctx.tools.restrict({ allow })` | ✅ 唯一的裁剪面 |
| 技能 | 分层注册表同名遮蔽 | ❌ 不管 |
| prompt 段 | `system-prompt/assemble` 过滤 | 只加一句「你被限制成什么」的告知，不删插件写的段 |

三条实测出来的硬约束（都是真踩过的）：

1. **只有 profile 层能包住全局注册表。** preset 树是隔离的 `tools` 实例，在那里 `restrict` 对 profile 工具是空操作。
2. **`tools.restrict()` 对未知工具名直接抛错**，所以放行集合必须先和 `tools.schemas()` 求交，并且随 `tools/change` 重算。
3. **`restrict` 只裁剪 global 层。** preset 自己挂的 `pwsh` / `read` / `edit` / `skill` / `todo_write` 挡不掉——它们天然就是「不可取消的全局能力」。这也正好符合「有些插件本来就是全局的、不能取消」。

### 归属是怎么认出来的

`ToolDefinition` 不带来源，loader 也没有「行 → 工具」的映射。所以本插件在 profile 层包一层 `tools.register`：
Cordis 的 Service 方法里 `this.ctx` 是**调用方**的上下文（traceable 机制），注册那一刻能读到对方的 `fiber.name` 与 `baseUrl`，再据此反查 `package.json` 的包名。

这意味着**加载顺序有意义**：本行必须排在其它插件之前，否则在它之前注册的工具只能归到 `unknown`。

## 安装

```powershell
dsh plugin --profile web add ./packages/dsh-plugin-gate
```

然后把 `dsh-plugin-gate` 放进 profile 的 `dsh.profile.bundles`，**放在列表最前面**（bundle 的 patch 按列表顺序应用，只有排第一才能包住后面所有注册）：

```json
"dsh": { "profile": { "bundles": ["@zhuobichen/dsh-plugin-gate", "@deepseek-ai/dsh-base", "..."] } }
```

最后在 `cordis.patch.yml` 里给这一行配置能力集（默认配置见包内 `cordis.patch.yml`）。

## 配置

```yaml
- id: plugin-gate
  name: '@zhuobichen/dsh-plugin-gate'
  config:
    defaultMode: off          # off（默认，行为同没装）| allow（新会话默认开闸）
    defaultProfile: ''        # defaultMode: allow 时用哪套
    profiles:                 # 能力集：名字 → 匹配串
      writing: ['@zhuobichen/dsh-novel-pane', '@zhuobichen/dsh-image-gen']
      reverse: [dsh-infinite-gen-5, dsh-ops]
    alwaysOn: [dsh-ops]       # 本身就是全局插件的，永远放行、不可取消
    keepTools: ['blender_*']  # 额外始终保留的工具（名字或前缀通配）
    unattributed: hide        # 归属认不出来的工具：hide（默认）| keep
    notice: true              # 在系统提示里告诉模型「本会话被限制成什么」
```

匹配串依次对**工具名**、**包名**、**fiber 名**做匹配；`xxx*` 是前缀通配。名字写错不会炸，只是匹配不到——`/gate on` 会直接告诉你「匹配到 0 个工具」。

## 状态

`$DSH_HOME/plugins/dsh-plugin-gate/state.json`，按 `sessionId` 记 `{ mode, profile }`，最多保留 200 个会话。

它**不写会话日志**（和 `dsh-capability-panel` 同一取舍）：好处是开关不会污染历史、随时可后悔；代价是 replay 还原不出当时的可见集合。要忠实回放就得改成写 session 事件，那是另一个量级的改动。

## 边界

- **挡不住 preset 层**：核心工具（`pwsh`/`read`/`edit`/`skill`/`todo_write`/`present`…）来自 standard preset，永远在。要更窄就得配一个更窄的 preset。
- **`run_code` 不可遮罩**：它是保留传输，注册表明令禁止，本插件会跳过它。
- **客户端 UI 是全局的**：插件画在输入框上的行、面板不受会话级限制影响（浏览器里只有一个 app）。插件自己的面板可以按 session 判断，但那要插件作者配合。
- **只影响工具目录**：被隐藏的工具，模型调用时会得到「工具不存在」，不是「被拒绝」。所以 `notice` 默认打开，避免模型凭记忆瞎调。

## 自测

```powershell
node test/gate.test.mjs
```

跑的是真 `@deepseek-ai/cordis` + 真 `@deepseek-ai/dsh-tools`：归属识别、会话级裁剪、全局不受影响、后注册工具补算、默认不开启、销毁撤销，六项。
`test/` 下需要能解析 `@deepseek-ai/*`（本仓库里是把它 link 到 `dsh/toolchain/node_modules` 的 `node_modules` 软链）。

诊断：`GATE_DEBUG=1` 时把 `sync` / `plan` 的过程打到 stderr。
