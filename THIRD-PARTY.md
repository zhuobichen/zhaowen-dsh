# 第三方插件索引

本仓库自己写的插件在 `packages/`。这份文档索引**别人做的、我装了在用**的东西——记录出处、版本、许可证和约束，方便升级、审计和换机器重建。

> 更新方式：`插件名 | 装的位置` 两栏对应本机 `dsh/home/profiles/web/package.json` 的 `bundles` 与 `dependencies`。
> 最后核对：2026-11-19，本机 DSH `0.2.2-rc.1`

---

## 一、纯第三方（完全别人写的，我只装）

| 插件 | 版本 | 许可证 | 上游 | 本机位置 |
|---|---|---|---|---|
| **`dsh-ops`** | 0.2.9 | MIT AND Apache-2.0 | <https://github.com/T-Auto/dsh-ops> | npm（profile 依赖 `^0.2.9`） |
| **`@dsh-external/dsh-blender-plugin`** | 2.5.0 | BSD-3-Clause（© 2026 sixtyseven67） | <https://github.com/sixtysevenlf/dsh-blender-plugin> | `thirdparty/dsh-blender-plugin/package`（link） |
| **`dsh-infinite-gen-5`** | 1.0.0 | **CC-BY-NC-SA-4.0** | <https://github.com/Minglink/dsh-infinite-gen-5> | `dsh/home/plugins/dsh-infinite-gen-5`（file） |

### 说明

**`dsh-ops`** — 提供 bash / PowerShell 7 / 一组文件与系统工具。本仓库 `dsh-sandbox-grant` 的 `host_exec` 就是为绕开它的沙箱限制而写的。

**`@dsh-external/dsh-blender-plugin`** — 15 个模型侧工具直接驱动 Blender（`blender_rt_*`）。上游 3.0.6，本机装的 2.5.0，**落后**。

**`dsh-infinite-gen-5`（IG5）** — Reverse / Ghidra 静态分析 + x64dbg 无头调试工作台。本机代码量最大的插件（约 21.8k 行）。许可证是 **CC-BY-NC-SA-4.0**：

- ✅ 自己用、学习、非商业项目
- ❌ 商业用途
- ⚠️ 二次分发必须**同许可**（ShareAlike），并保留署名
- 它自带的 `THIRD_PARTY_NOTICES.txt` 说明：IG5 自己的代码是 CC-BY-NC-SA，但它链接的 Ghidra 等第三方仍按各自上游许可（Ghidra 是 Apache-2.0）

---

## 二、移植自别的工具（代码我重写，功能/设计来自别人）

| 本仓库包 | 源自 | 声明位置 |
|---|---|---|
| `packages/dsh-balance` | Claude Code 的 `deepseek-balance` mod | `package.json` description 自述「移植自」 |
| `packages/dsh-moon-band` | Claude Code 的 `moon-band` mod | 同上 |
| `packages/dsh-novel-pane` | Claude Code 的 `novel-pane` mod | 同上 |

原 mod 多为社区作品，本仓库按 DSH 插件架构重写（MIT）。**再分发时建议保留「源自 xxx」的说明**。

---

## 三、包装第三方 CLI / 服务（我的壳子薄，里面是别人的）

| 本仓库包 | 包装的是什么 | 我的代码量 |
|---|---|---|
| `packages/dsh-craft-anything` | Craft Anything MCP（`craft-anything-cli.exe`，vendor 在 `craft-anything-plugin/vendor/`） | ~345 行 |
| `packages/dsh-tencent-mcp` | 腾讯官方 MCP 全家桶：腾讯文档（HTTP）、qqmail、CVM、TAT、COS、IMA | ~67 行（几乎全是 `cordis.patch.yml` 配置） |
| `packages/dsh-weflow-mcp` | WeFlow CLI（本地微信聊天导出 / 公众号） | 0 行（纯配置） |
| `packages/dsh-rea-video` | rea-video CLI（视频逆向拆解，含人脸/分离模型） | ~301 行 |

这些都只做**连接层**，不修改上游行为。上游升级时重新装 CLI 即可，壳子不用动。

---

## 四、素材 / IP 说明

| 包 | 情况 |
|---|---|
| `packages/dsh-theme-kaguya-hime` | 主题代码是本仓库的（MIT），但 `assets/` 里是《超时空辉夜姬》的**角色形象与官方视觉图**，版权属于原作者 / 版权方。**自己用没问题，不要随仓库分发素材**；对外分发请移除 `assets/` 或替换为自制素材。 |

---

## 五、升级与重建

**升级纯第三方**

```powershell
# npm 型
dsh plugin --profile web update dsh-ops

# vendored / file 型：拉上游新版覆盖本地目录，再同步版本号
```

**换机器重建**

1. 装 DSH 本体（`dsh/toolchain`）
2. 本仓库各包 `pnpm link` 进 `profiles/web`
3. 按本表把三个第三方插件装回去（注意 IG5 的非商业约束）
4. `dsh/home/.env` 填凭据（说明见 `dsh-tencent-docs-mcp/凭据说明.md`）

---

## 六、机检

本机装了哪 25 个 bundle、哪些是第三方，可以直接跑：

```powershell
# 列出 profile 的全部 bundle 与来源（link / file / npm）
node -e "const p=require('D:/github_project/ZhaoWen_GitHub维护/dsh/home/profiles/web/package.json');for(const b of p.dsh.profile.bundles)console.log(b,'->',p.dependencies[b]||'(官方)')"
```
