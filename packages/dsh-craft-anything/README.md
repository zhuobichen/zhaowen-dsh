# Craft Anything × DSH

把 [Craft Anything](https://github.com/storytold/craft-anything)（v0.3.0）接进 DeepSeek Harness：一个配置型 bundle，通过 MCP（stdio）把它的逆向引擎暴露给 agent。

Craft Anything 是纯 Rust 的"看懂任何软件，再让 AI 造一个自己的"工作流：
**Study → Build → Check → Ready**。默认 **Clean room**（只读外部可见：截图、可见文本、实测布局、颜色、字距），**Deep** 模式才读代码/文件/页面源码，装了 Ghidra 还会用它。

## 接上之后有什么

MCP server 启动后会注册 **17 个工具集 / 315 个工具**，默认只暴露 `core`（35 个），其余按需开：

| 工具集 | 工具数 | 管什么 |
|---|---|---|
| `core` | 35 | 证据账本、调查记忆、计划、报告、目标 |
| `native` | 55 | 原生程序：反汇编、伪 C、调用图、字节搜索 |
| `browser` | 22 | 网站：打开、实测、逐宽度对照 |
| `formats` | 36 | 固件、抓包、游戏包、SQLite、WASM、EVM |
| `android` / `adb` | 14 / 24 | APK 解析、真机操作 |
| `javascript` | 11 | Electron / JS / ASAR / fuse |
| `runtime` / `frida` | 14 / 9 | GDB / Rizin 会话、Frida 插桩 |
| `projects` / `build` | 27 / 6 | 复刻项目、进度、构建 |
| 其它 | — | apple、managed、java、database、setup、application |

打开方式：让 agent 调 `list_toolsets` → `enable_toolset {"toolset":"browser"}`（也可以用 `"all"`）。

## 必备的前置

只有 `core` 是零依赖的；其它工具集按需装引擎（它自己会检测并告诉你缺什么）：

```powershell
craft-anything-cli.exe doctor        # 体检：引擎、AI 后端、MCP
craft-anything-cli.exe capabilities  # 这台机器能跑哪些工具
```

## 安装

1. 解压 upstream 的 Windows x64 portable 包到 `vendor/craft-anything/`：

   ```powershell
   Expand-Archive .\vendor\craft-anything-0.3.0-windows-x64-portable.zip `
     -DestinationPath .\vendor\craft-anything
   ```

2. 确认 CLI：

   ```powershell
   .\vendor\craft-anything\craft-anything-0.3.0-windows-x64-portable\craft-anything-cli.exe --version
   ```

3. `cordis.patch.yml` 里的 `command` / `cwd` 指向这个 exe 和它所在目录（默认按上面路径写死）。

4. 装 bundle（pnpm 正常时）：

   ```sh
   dsh plugin --profile web add ./dsh-craft-anything
   ```

   pnpm 被权限挡住时（本机就遇到了），手动接：

   ```powershell
   # junction + profile 的 dependencies / dsh.profile.bundles 各加一条
   New-Item -ItemType Junction `
     -Path "$env:DSH_PROFILE_DIR\node_modules\@local\dsh-craft-anything" `
     -Target "<repo>\dsh-craft-anything"
   ```

5. 验证：让 agent 调 `mcp__craft-anything__core_session_show`，应返回
   `{"server":{"name":"craft-anything","version":"0.3.0"},"clean_room":true,...}`。

## 用法示例

```
enable_toolset {toolset:"browser"}
core_brief_write {question:"这个网站的目录页怎么渲染列表？", purpose:"复刻"}
core_target_open {path:"https://example.com"}
browser_… / web_…
rebuild_start {request:"Recreate this website"}
```

完整四步流水线可以用 `rebuild_start` / `rebuild_status` / `rebuild_activity_show` 跟着走，也可以自己调细粒度工具。

## 注意

- Clean room 是 Craft Anything 自己的规则，不是操作系统沙箱：它不隔离你的机器，真正能读写什么取决于跑它的 agent 的权限。
- 会执行代码或改设备的工具需要你批准（`--allow-run` / 工具级 consent）。
- 只做连接，不附带 upstream 二进制；`vendor/` 已在 `.gitignore` 里。
- 上游 Apache-2.0 / MIT 双许可；这个连接层 MIT。
