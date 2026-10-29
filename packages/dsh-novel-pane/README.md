# dsh-novel-pane

在当前会话里开一间**可折叠的读书窗格**。窗格没开时，输入框上方有一个 `📖 读书` 小按钮：
点开是**书库**（本机所有书扫成一张索引），点一本就读。命令仍然可用：`/novel <文件>` 打开，`/novel` 再敲一次收起。

```
┌ 白夜行 ───────────────────────────────────┐
│ [⇄ 卷轴] [↑] [↓] [⌂] [☰]   7/20700        │  ← 表头：按钮 + 进度
│ 第一章　夜航                               │
│ 船在雾里走，灯是唯一的方向。               │
└───────────────────────────────────────────┘
```

移植自 Claude Code 的 `novel-pane` mod；画窗格的是**本包内的客户端半身**
（`client/client.js`，`exports["./client"]` + `dsh.client.platform=web`），装本包就够。

## 能读什么

| 格式 | 怎么读 |
| --- | --- |
| `.txt` / `.md` | 直接读（按行分页） |
| `.epub` | 自己读 ZIP → `container.xml` → OPF → 按 spine 顺序合并 XHTML |
| `.pdf` | 本机 `python` + **PyMuPDF** 抽文字（没有文字层的扫描件 / 图片漫画会明确报错） |

`.mobi` / `.azw3` 不收，会在索引的 `skipped` 里说明「先转成 EPUB 或 TXT」。

正文抽出来后会缓存到 `$DSH_HOME/plugins/dsh-novel-pane/text/<hash>.txt`
（hash = 路径 + mtime + size），第二次打开直接读缓存，不再解包 / 不再 spawn python。

> PDF 为什么不用 pdf.js：实测抽中文 PDF 会丢几乎全部汉字（《大语言模型》第 2 页：
> pdf.js 207 字符且无中文，PyMuPDF 1063 字符、内容完整）。所以只走 PyMuPDF。

## 书库索引

`GET /dsh-novel-pane/library` 返回：

```jsonc
{
  "books": [
    { "id": "…", "name": "白夜行 (东野圭吾) (z-library.sk…).epub", "title": "白夜行",
      "kind": "epub", "dir": "C:\\Users\\Administrator\\Downloads", "path": "…", "size": 619555 }
  ],
  "skipped": [ { "name": "某书.mobi", "kind": "mobi", "reason": "MOBI 暂不支持…" } ],
  "duplicates": 3, "excluded": 1, "truncated": false, "total": 90
}
```

- **缺省扫四个根目录**：`C:\Users\Administrator\Downloads`、`ebook-library/files`、
  `lingtai-reader/books`、`lingtai-reader/data/text_cache`；可用 `config.library` 覆盖。
- 递归深度 ≤ 3、最多 500 本、最多看 20000 个目录项、扫描预算 2 秒（撞上限会置 `truncated`）。
- **进程内缓存 60 秒**；根目录 mtime/size 变了也会重建，`?refresh=1` 强制重建。
- 同名文件只留一条（先扫到的根目录优先）；标题会去掉 z-library 尾巴、`= 英文名`
  副标题和末尾的作者括注，卷册标记（`(上)`、`(白金版)`）保留。
- `config.exclude` 是一小串明显的垃圾（缺省 `简历`、`_raw`、`副本`、`~$`，
  子串或正则都认）。**刻意不做「猜哪些是书」**——论文和书的文件名分不干净。

## 命令

| 打什么 | 做什么 |
| --- | --- |
| `/novel <文件>` | 打开一本（相对路径按会话工作目录算；epub / pdf 都行） |
| `/novel n` | 下一页，并把这一页打在对话里 |
| `/novel p` | 上一页 |
| `/novel 12` | 跳到第 12 页 |
| `/novel read` | 把当前页打出来，不动位置 |
| `/novel shelf` / `list` | 列出**当前目录**里能读的纯文本文件（`.txt/.md/...`） |
| `/novel` | 窗格开着就收起；没开就把上次那本打开 |

## 路（给浏览器那半）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/dsh-novel-pane/state?rows=N&shelf=1` | 当前快照；`shelf=1` 时给目录书单 |
| POST | `/dsh-novel-pane/move` | `open` / `close` / `mode` / `top` / `down` / `up` / `wheel` / `goto` / `open-book` / `open-path` / `browse` |
| GET | `/dsh-novel-pane/library` | 书库索引（`?refresh=1` 绕过缓存） |
| GET | `/dsh-novel-pane/lingtai` | 只查灵台阅读器状态：`{ok, running, url}`，**不启动任何东西** |
| POST | `/dsh-novel-pane/lingtai` | 确保它在跑：在跑 → `{ok:true, launched:false, url}`；没在跑就 spawn 后最多等 12 秒 → `{ok:true, launched:true, url}`；超时 → `{ok:false, launched:true, code:"LINGTAI_TIMEOUT", message, url}`（200，不抛） |

## 灵台阅读器（lingtai-reader）

「读书」现在打开的是**灵台阅读器**——另一个独立 web app（`lingtai-reader`：
`python server.py`，python 标准库 http.server，零第三方依赖，端口 8769，
可用 `sys.argv[1]` 覆盖）。宿主只负责「确保它在跑」，**不改它的代码**：

1. `GET/POST` 先 TCP 探测 `127.0.0.1:<port>`，单次 800ms
2. 没在跑 → `spawn(python, ['server.py'], {cwd: dir, detached: true, stdio: 'ignore', windowsHide: true})` + `unref()`
   （端口被配成非 8769 时把端口作为 `argv[1]` 传过去）
3. 每 250ms 探一次，最多等 12 秒
4. 超时 / 没配目录 / 目录里没有 `server.py` / 没有 python → 回可读 `message`，**不抛**

目录**没有缺省值**：`config.lingtai.dir` > `process.env.LINGTAI_DIR`，都没有就报
`LINGTAI_NO_DIR`（不会猜一个绝对路径）。测试里 `probe` / `spawn` 都是注入的，
**不真起 python**。

`open-path` 传绝对路径（也认 `~` 和相对上一本书目录）；打不开时 400 带
`error: "unreadable"` 和可读的 `message`。

## 配置（`cordis.patch.yml`）

```yaml
- insert:
    - id: novel-pane
      name: '@zhuobichen/dsh-novel-pane'
      # 可选：覆盖书库根目录 / 排除规则 / python
      # config:
      #   library: ['D:\books']
      #   exclude: ['简历', '_raw', '副本', '~$']
      #   python: python        # 缺省先试 python，再试 py -3
      #   pdfTimeoutMs: 120000  # 超时会杀子进程
      #   lingtai:              # 灵台阅读器（独立 web app，默认 8769）
      #     dir: 'D:\github_project\ZhaoWen_GitHub维护\lingtai-reader'
      #                           # 不写就取环境变量 LINGTAI_DIR；都没有就报可读错误
      #     port: 8769
      #     python: python      # 用什么解释器跑 server.py
```

## 开发

```
npm install
npm run build      # tsc → lib/
npm test           # 25 条纯函数 + 19 条索引 + 8 条 EPUB + 5 条 PDF + 14 条宿主冒烟 + 15 条灵台阅读器
```

测试的临时文件都落在包内 `.tmp/`（本机 OS Temp 不可写）。
