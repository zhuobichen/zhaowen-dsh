# dsh-image-gen

让 DSH 的 agent 用**本机豆包桌面版**生图 / 改图。不走 API，不需要 key；
豆包驱动从 [`zhaowen-mcp/image-vision/doubao.ts`](../../../zhaowen-mcp/image-vision/doubao.ts)
vendored 过来，改成可配置的工厂。

客户端半身是**本包内的** `client/client.js`（`exports["./client"]` + `dsh.client.platform=web`）：
它把工具调用卡片画成「生图中 → 图片 + 路径 → 错误」，图片内联显示。

## 工具

| 工具 | 做什么 |
| --- | --- |
| `generate_image` | 文字 → 图片。约 15–35 秒，通常 2048×2048 |
| `edit_image` | 1–4 张参考图 + 指令 → 图片。约 30–60 秒 |
| `image_gen_status` | 只读诊断：调试端口通不通、聊天页/输入框在不在、队列状态 |

产物右下角有「豆包 AI 生成」可见水印，PNG 里还有 AIGC 元数据；**本插件不裁剪**。

## 前提

1. 豆包桌面版正在运行，且带 `--remote-debugging-port=9333` 启动：
   ```cmd
   packages\dsh-image-gen\scripts\start-doubao-debug.cmd
   ```
   默认用**真实的日常 profile**（`%LOCALAPPDATA%\Doubao\User Data`，profile `Default`），
   这样登录态是现成的、生成的才是图而不是文字。
   可用 `DOUBAO_EXE` / `DOUBAO_USER_DATA_DIR` / `DOUBAO_PROFILE_DIR` / `DOUBAO_PORT` 覆盖；
   `DOUBAO_RESTART=1` 会先杀掉现有进程再启动。
2. 那个实例**已登录**。
3. Node 22+（依赖全局 `WebSocket`；当前 DSH 用 Node v24）。

> 调试端口等于本地后门：任何本机进程都能驱动那个窗口。

### 2.32.4 上启动必须同时满足三条（缺一条都静默失败）

红过很多次的坑，记在这里省得下次再挖：

1. **策略位**。豆包把 Chromium 的远程调试按「企业策略」关掉了，只加
   `--remote-debugging-port` 端口永远不会监听。开关是注册表
   `HKLM/HKCU\SOFTWARE\Policies\Chromium\RemoteDebuggingAllowed=1`
   （写 HKLM 需要管理员）。豆包二进制里那句
   `DevTools remote debugging is disallowed by the system admin` 就是这个检查。
   `start-doubao-debug.ps1` 每次都会把策略写一遍（幂等）。
2. **启动哪个 exe**。`D:\豆包\Doubao\Doubao.exe` 是 launcher，它**会**把参数
   透传给 `app\Doubao.exe`（`"%s" %s --start_time=%llu`）。直接跑
   `app\Doubao.exe` 会立刻退出。
3. **用哪个 profile**。端口只在 `--user-data-dir` 非默认时才开；但空 profile 没登录，
   豆包会回一段文字 + 提示词改写而**不出图**。所以指向真实 profile。

### 运行时还有三个坑（`src/doubao.ts` 已处理，别删）

- **聊天页是隐藏页**（`document.visibilityState === 'hidden'`）。刚启动的那一页能发出去，
  一旦 `Page.navigate` 过就再也发不出去：点发送键会把它变灰，但抓包看**一个请求都不发**。
  所以驱动里不做导航。
- **成品图在 shadow root 里**。普通 `document.querySelectorAll('img')` 只能看到 320px 缩略图，
  必须递归 `shadowRoot`；并且优先取 URL 里带 `rc_gen_image` 的（那才是成图）。
- **输入必须走 CDP `Input.insertText`**。合成的 `execCommand` 插不进 React，
  发送键会一直是 disabled。回车没反应时再补一次「点发送键」。

## 安装

```sh
cd packages/dsh-image-gen && npm install && npm run build

dsh plugin --profile web add ./packages/dsh-image-gen
```

然后重启 dsh web。客户端半身没有构建步骤，但改动后需要刷新页面（`Ctrl+Shift+R`）。

## 输出

默认目录：

```
$DSH_HOME/plugins/dsh-image-gen/output/
  gen_20261019-201530_a1b2c3.png
  gen_20261019-201530_a1b2c3.png.meta.json
```

- 文件名：`gen_<YYYYMMDD-HHmmss>_<6hex>.<实际格式>` / `edit_...`
- 扩展名按**实际字节**（PNG/JPEG）决定
- 同名文件已存在时自动加 `-1`、`-2`，**不覆盖**
- `.meta.json` 记录 prompt、输入图、实际尺寸、AIGC 标记、耗时
- `output_path` 可以是目录、文件主干，或带 `.png/.jpg/.jpeg/.webp` 的完整路径；
  相对路径按输出目录解析

## 配置

| Config | 环境变量 | 默认 |
| --- | --- | --- |
| `outputDir` | `DSH_IMAGE_GEN_OUTPUT_DIR` | `$DSH_HOME/plugins/dsh-image-gen/output` |
| `cdpUrl` | `DOUBAO_CDP_URL` | `http://127.0.0.1:9333` |
| `minPx` | `DOUBAO_MIN_PX` | `512` |
| `timeoutMs` | `DOUBAO_TIMEOUT_MS` | `240000` |
| `newChat` | `DOUBAO_NEW_CHAT` | `false`（接着当前会话发） |
| `maxPending` | `DSH_IMAGE_GEN_MAX_PENDING` | `8` |
| `maxPromptChars` | `DSH_IMAGE_GEN_MAX_PROMPT` | `8000` |
| `attachImages` | `DSH_IMAGE_GEN_ATTACH` | `true` |

在 `cordis.patch.yml` 里给这一行加 `config:` 也可以。

## 行为细节

- **所有豆包调用串行**：只有一个窗口/输入框，并发会互相污染。排队上限默认 8。
- `attachments` 服务不可用时自动降级：文件照写，工具结果里只有路径（`attachment_error` 说明原因）。
- 单张最多等 4 分钟；工具不声明 `timeoutMs`，不会被框架提前掐断。
- 图生图默认复用当前豆包会话；输入框有上一轮残留附件时会先刷新页面清掉。

## 开发

```sh
npm install
npm run build     # tsc → lib/
npm test          # 19 条纯函数测试 + 7 条宿主冒烟（不需要豆包）
npm run smoke:doubao -- "画一只戴帽子的小猫，白底"   # 需要调试端口
```

`test/live-doubao.smoke.ts --edit <输入图> "提示词"` 可以测图生图，并断言产物与输入 MD5 不同。

## 许可

MIT。`src/doubao.ts` vendored 自 `zhaowen-mcp/image-vision/doubao.ts`（© 2026 zhuobichen）。
