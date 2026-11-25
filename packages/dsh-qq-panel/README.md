# 朝闻录（dsh-qq-panel）

把 qchat-cli 的运行状态、表情库、梗库、人情冷暖画成 DSH Web GUI 里的一个标签。

主机半读文件并挂 `/qq-panel-data`；浏览器半在「对话 / 轨迹」那一行注册标签。

---

## 装一个新插件，必须同时改三个地方

这是踩了两轮才弄清的。少任何一个，标签都不会出现。

### ① 插件目录

```
$DSH_HOME/plugins/<名字>/
  package.json      ← 关键：dsh.client 声明 + exports["./client"]
  index.js          ← 主机半边（Cordis 插件）
  client.js         ← 浏览器半边
  cordis.patch.yml  ← bundle 层补丁
```

`package.json` 里这几段不能少：

```json
"exports": { ".": "./index.js", "./client": "./client.js" },
"dsh": {
  "id": "dsh-qq-panel",
  "client": { "platform": "web", "immediately": true }
}
```

没有 `dsh.client` → 浏览器不会加载 `client.js`，标签自然没有。
没有 `exports["./client"]` → 宿主找不到浏览器半边的入口。

### ② profile 的 dependencies

```bash
# home/profiles/web/package.json
"dsh-qq-panel": "file:../../plugins/dsh-qq-panel"
```

**光有目录不算数。** DSH 用 pnpm 管插件，不在 dependencies 里就不认。

装的时候**必须用 pnpm**：

```bash
pnpm install          # ✅
npm install           # ❌ EUNSUPPORTEDPROTOCOL: link:
```

因为这个 profile 里别的插件用的是 `link:` 协议，npm 不认。

> 小坑：`pnpm install` 时如果 DSH 正在跑，会报
> `EPERM: rename ... dsh-infinite-gen-5`（目录被占用）。
> 不影响新插件链接成功，但会留下 `*_tmp_*` 垃圾目录，事后要清。

### ③ 注册写 `cordis.patch.yml`，**不是** `cordis.yml`

```yaml
# home/profiles/web/cordis.patch.yml
- insert:
    - id: dsh-qq-panel
      name: dsh-qq-panel
```

**这是最容易踩的一脚。**

`cordis.yml` 是 DSH **自己生成**的合成结果。手动往里加条目，改完 `tail` 能看到、
`--dump-config` 也能看到，但**下次启动就被重写成原样**，条目消失。

`cordis.patch.yml` 才是「你的覆盖层」。两种写法：

```yaml
# 改已有插件的配置
- id: some-plugin
  config:
    key: value

# 插入新插件
- insert:
    - id: new-plugin
      name: new-plugin
```

验证是否真的进了合成树：

```bash
DSH_HOME=... node <dsh>/lib/bin.js --profile web --dump-config | grep <插件id>
```

---

## 路由 handler 必须同步

```js
// ✅ 对
handler: (req, res) => {
  const body = JSON.stringify(buildSync());
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(body);
}

// ❌ 错：异步写法框架会提前结束响应，body 是空的（实测 size=0）
handler: (req, res) => {
  snapshot().then((d) => { res.writeHead(200); res.end(JSON.stringify(d)); });
}
```

需要慢数据（比如探测外部服务）就缓存：后台定时刷新，请求时读缓存。

这个坑很难看出来——状态码 200、响应头也对，就是没有 body。

---

## 怎么在不打断当前会话的情况下验证

`restart-web.ps1` 会杀掉所有 dsh node 进程，**包括 agent 自己**。
所以验证插件别重启主实例，另起一个端口：

```bash
DSH_HOME=... node <dsh>/lib/bin.js web --port 3099 --no-open
curl -s --compressed http://127.0.0.1:3099/qq-panel-data
```

> `--compressed` 不能省：不带它 curl 拿到的是 gzip 响应，
> 量出来的 size 是 0，会误判成"没数据"。

URL 里的 token 从该实例自己的输出里取（`dsh web: http://...?token=...`），
不要用别的实例的（会拿到 `authentication required`）。

---

## 这个面板显示什么

| 卡片 | 内容 |
|---|---|
| 头部 | OneBot 在线状态（`get_status.online === true` 才算真的在线） |
| 表情库 | 总数 / 偷来的 / 已打标 / 用过 / 有人接的比率 |
| 梗库 | 总数 / 现在能用 / 年龄未知 / 来源分布 |
| 关系 | 有互动记录的人数 + 前三名 |
| 任务 | 未完成数 / 历史总数 |
| 最近偷到的表情 | 标签 + 从谁那偷的 |
| 关系榜 | 按好感度排前 8 |
| 最近任务 | 类型 / 状态 / 时间 |
| 梗库热更日志 | `refresh.log` 尾部 |

每 5 秒自动刷新，也可以手点。

---

## 数据从哪来

全部是 qchat-cli 的私有文件，**只读，不写**：

```
private/emoji-library/manifest.json     表情库
private/.sticker-usage.json             用过哪些
private/.sticker-feedback.json          发出去有没有人接
private/knowledge/terms.jsonl           梗库
private/knowledge/refresh.log           热更日志
private/affinity.json                   好感度
private/tasks/*.json                    任务队列
```

OneBot 状态另外走 `http://127.0.0.1:3000` 的 `get_status` + `get_login_info`。

项目路径默认写死 `D:\github_project\ZhaoWen_GitHub维护\qchat-cli`，可用
`QCE_PROJECT_DIR` 覆盖。
