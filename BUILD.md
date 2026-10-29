# 从源码到能跑：构建与安装

本仓库**不提交构建产物**：`lib/` 被 `.gitignore` 忽略，`src/` 才是所有 TypeScript 包的真正源码。
所以别人 clone 下来之后，有一半的包需要先构建一次才能加载。

只有 `packages/dsh-web-search-yuanbao/lib/` 是例外——那个包没有 `src/`，`lib/index.js` 就是手写源码，
所以它被 `.gitignore` 显式放行了。

---

## 一、先看你要不要构建

| 包 | 需要构建 | 命令 |
|---|---|---|
| `dsh-balance` | ✅ | `npm install && npm run build` |
| `dsh-image-gen` | ✅ | `npm install && npm run build` |
| `dsh-import` | ✅ | `npm install && npm run build` |
| `dsh-moon-band` | ✅ | `npm install && npm run build` |
| `dsh-novel-pane` | ✅ | `npm install && npm run build` |
| `dsh-remote-exec` | ✅ | `npm install && npm run build` |
| `dsh-team` | ✅ | `npm install && npm run build` |
| `dsh-cc-tui` | ✅ | `pnpm install && pnpm run build`（用 pnpm） |
| `dsh-web-search-yuanbao` | ❌ | 手写 JS，`lib/` 已在仓库里 |
| `dsh-agent-dispatch` | ❌ | 手写 JS，入口 `index.js` |
| `dsh-agent-supervisor` | ❌ | 手写 JS（一个包两半） |
| `dsh-capability-audit` | ❌ | 手写 JS |
| `dsh-client-ui-voice` | ❌ | 手写 JS |
| `dsh-deliverables-index` | ❌ | 手写 JS，入口 `index.js` |
| `dsh-kimi-bridge` | ❌ | 手写 JS |
| `dsh-zcode-bridge` | ❌ | 手写 JS |

判断依据：包里有 `src/` 就说明 `lib/` 是 `tsc` 产物，必须构建。

---

## 二、一键构建

Windows PowerShell：

```powershell
# 在仓库根目录
powershell -File scripts\build-all.ps1
```

只构建缺 `lib/` 的（快）：

```powershell
powershell -File scripts\build-all.ps1 -OnlyMissing
```

脚本做的事：逐个进入需要构建的包 → 装依赖 → 跑 `build` → 最后列出每个包 `main` 入口是否存在。

---

## 三、装进 DSH

构建完再装。**link 安装**（改动即时生效，适合开发）：

```powershell
dsh plugin --profile web add ./packages/dsh-balance
dsh plugin --profile web add ./packages/dsh-moon-band
# …逐个装你需要的那几个
```

装完**重启 `dsh web`**：插件集合和客户端元数据都是启动时读的，热重载不生效。

> 带界面的插件现在都是**一个包两半**（宿主 + `client/client.js` 在同一个包里），
> 装一次就够，不用再找 `dsh-client-ui-*`——那些包已经合并掉了。

---

## 四、常见问题

**插件列表里只有名字、没有说明？**
包的 `exports` 必须暴露 `"./package.json": "./package.json"`。`exports` 是封闭的，
没列出来的子路径外部解析不到，读不到 manifest 就没有说明文字。

**界面插件装了但界面上什么都没有？**
1. 确认 `package.json` 里有 `"dsh": { "client": { "platform": "web" } }`
2. 确认 `exports["./client"]` 指向的文件真实存在
3. **重启 `dsh web`**——客户端包元数据按包名缓存且永不清除（`pkgMeta` 只有 `get`/`set`），
   给已有包新增 `dsh.client` 声明后，不重启永远不会被发现
4. 浏览器再 `Ctrl+Shift+R` 硬刷新（boot 清单带 `immutable` 缓存头）

**改了 `src/` 但行为没变？**
忘了重新 `npm run build`。`lib/` 不被提交，所以本地改了源码不构建，跑的还是旧产物。
