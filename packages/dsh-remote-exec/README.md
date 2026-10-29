# @zhuobichen/dsh-remote-exec

把**指定的任务**直接推到一台一直开着的服务器（腾讯云 / 任何 POSIX SSH 主机）上跑：本地留模型循环和会话，重活、长活在云上。

不是「整个 profile 搬到远端」——那会让每次 `ls` 都过一个 SSH 往返。这里只多 5 个工具，由模型（或你）按任务决定什么时候推过去。

## 目录

- [它解决什么](#why)
- [配置](#configure)
- [首次连通](#first-connect)
- [五个工具](#tools)
- [典型工作流](#workflow)
- [远端布局](#layout)
- [安全边界](#security)
- [已知限制](#limits)

<a id="why"></a>
## 它解决什么

| 场景 | 本地跑 | 推上去跑 |
|---|---|---|
| 编译一个大项目 | 占满 CPU，风扇起飞 | `remote_exec` + `background` |
| 训练 / 爬取 / 批处理 | 关机就没了 | 远端 `setsid nohup`，活过断网和重启 |
| 需要 Linux 环境 | Windows 上装不干净 | 直接就是 Linux |
| 产物要看一眼 | 只能看日志 | `remote_download` 拉回来 |

设计上刻意只做三件事：跑命令、管后台作业、双向传文件。**不改** DSH 自己的 bash/文件工具——本地操作仍然是本地的。

<a id="configure"></a>
## 配置

最快的方式：往 `$DSH_HOME/.env` 里写四行（DSH 启动时会把这个文件读进环境变量，不用改 YAML）：

```dotenv
DSH_REMOTE_HOST=1.2.3.4
DSH_REMOTE_USER=root
DSH_REMOTE_KEY=~/.ssh/id_tencent        # 可选；不写就交给 ssh-agent / ~/.ssh/config
DSH_REMOTE_WORKDIR=~/.dsh-remote        # 可选；远端工作目录
```

或者在 profile 的 `cordis.patch.yml` 里给这个插件写 config（多主机就用这种）：

```yaml
- id: remote-exec
  config:
    defaultHost: tencent
    hosts:
      tencent:
        host: 1.2.3.4
        user: root
        identityFile: ~/.ssh/id_tencent
        workdir: ~/dsh-remote
      lab:
        host: lab.example.com   # 也可以直接写 ~/.ssh/config 里的别名，认证全交给 OpenSSH
```

其余可调项（都有合理默认）：`sshBinary`、`tarBinary`、`connectTimeoutMs`（15000）、`execTimeoutMs`（120000）、`maxOutputBytes`（64000）、`maxTransferBytes`（256 MiB）、`strictHostKeyChecking`（`accept-new`）、`backgroundPollMs`（1500）、`remoteShell`（`bash -l`）。

**一台都没配时**，插件只注册 `remote_doctor`，不会把 4 个必然失败的工具塞进 prompt。

<a id="first-connect"></a>
## 首次连通

插件走系统自带的 OpenSSH，**只支持密钥认证**（`BatchMode=yes`，不弹密码框）。没配密钥的话，在本机跑一次：

```powershell
# 1. 生成一把专用密钥（没有就生成）
ssh-keygen -t ed25519 -f $HOME\.ssh\id_tencent -N '""'

# 2. 把公钥装到服务器（会让你输一次密码）
type $HOME\.ssh\id_tencent.pub | ssh root@1.2.3.4 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"

# 3. 验证
ssh -i $HOME\.ssh\id_tencent root@1.2.3.4 'echo ok'
```

然后调 `remote_doctor`，它会把系统、CPU/内存/磁盘、工具链、工作目录状态一次报回来。

> 连不上时先看 `remote_doctor` 的 `error` / `hint`：认证被拒、端口不通、主机密钥变了、端口被安全组挡住，这四类占了绝大多数。
>
> 如果这台机器**写不进 `~/.ssh`**（有些 Windows 环境给 SSH 目录加了保护），`accept-new` 会每次都因写不进 known_hosts 而往 stderr 打两行告警，污染每次工具结果。用一个可写位置就干净了：
>
> ```yaml
> options:
>   UserKnownHostsFile: <DSH_HOME>/.remote-exec/known_hosts
> ```

<a id="tools"></a>
## 五个工具

### `remote_exec`

在远端跑一段 shell 脚本，返回退出码 / stdout / stderr / 耗时。

- `command` 是**脚本正文**。它经 stdin 落到远端临时文件后**再执行**，所以引号、`$VAR`、多行都不用自己转义；脚本里即使有读 stdin 的命令（`ffmpeg` 不加 `-nostdin`、`head`、`read`）也**不会**把脚本本身啃掉一个字节。
- 代价：脚本里的命令读 stdin 只会读到 EOF——要喂数据就 `remote_upload`，或者脚本内用 heredoc。
- `cwd` 省略时用远端工作目录（不存在会自动建）。
- `background: true` → 立刻返回作业 id，进程落到远端后台。
- 退出码非零**不算工具错误**，是正常结果。

### `remote_job`

管 `background` 起的作业：`list` / `status` / `logs` / `wait` / `kill`。

- 作业状态存在远端磁盘，**DSH 重启、断网、关电脑都不影响**；回来继续 `status`。
- `logs` 默认读尾部，也可以给 `offset` 增量读（`next_offset` 就是下次的偏移）。
- `wait` 有上限（默认 60s，最大 10min）；超时只是「还没跑完」，不是失败。

### `remote_upload` / `remote_download`

tar over ssh，一条连接搬完，支持 `exclude`。

```text
remote_upload   local_path=D:\proj\app  remote_dir=~/dsh-remote  exclude=["node_modules",".git",".venv"]
remote_download remote_path=~/dsh-remote/app/dist  local_dir=D:\proj\app
```

传过去的目录会成为目标目录下的**同名子目录**（和 `scp -r` 一致）。

### `remote_doctor`

只读体检：连通性、延迟、系统、CPU/内存/磁盘、`node`/`python3`/`docker`/`git`/`gcc`/`ffmpeg` 有没有、工作目录状态、作业数。

<a id="workflow"></a>
## 典型工作流

```text
1. remote_upload(local_path="D:\proj\app", exclude=["node_modules",".git"])
2. remote_exec(cwd="~/.dsh-remote/app",
               command="npm ci && npm run build",
               background=true, name="build")
3. remote_job(op="wait", job_id="r...", timeout_ms=600000)
4. remote_job(op="logs",  job_id="r...")        # 失败时看 stderr
5. remote_download(remote_path="~/.dsh-remote/app/dist")
```

短任务（< 1 分钟）直接 `remote_exec` 前台就行，不必起作业。

<a id="layout"></a>
## 远端布局

```text
~/.dsh-remote/
  runs/<job-id>/
    run.sh        实际执行的脚本（用户命令 + EXIT trap 写退出码）
    meta          id / cwd / name
    pid           进程组号（setsid 之后）
    status        running | done
    exit_code     结束才写
    stdout.log
    stderr.log
  ...上传的内容
```

退出码由 `EXIT` trap 写盘——这样用户脚本里 `exit 3` 或中途报错也留得下真实退出码。作业用 `setsid` 起成独立进程组，`kill` 时整组带走，不留孤儿编译进程。

<a id="security"></a>
## 安全边界

- **不碰凭据。** 不读私钥内容，不存密码；认证、known_hosts、agent、ProxyJump 全部沿用 `ssh` 本身。
- `BatchMode=yes` 保证不会卡在交互提示上。
- `StrictHostKeyChecking=accept-new`：首次信任并记住指纹，之后指纹变了就拒绝（可改成 `yes` 更严）。
- 远端脚本以登录用户身份运行，插件本身**不提供**额外提权或隔离；要隔离请用远端的容器 / 沙箱。
- 本地取消（超时 / 中断）会先 `SIGTERM` ssh，远端由 coreutils `timeout` 收尾；远端没有 `timeout` 时会退回无包装模式。

<a id="limits"></a>
## 已知限制

- 只支持密钥认证（Windows 上没有可靠的 stdin 密码通道）。
- 不支持 Windows 作为远端（远端要 POSIX：Linux / macOS）。
- 每条 `ssh` 调用都是一次独立连接（Windows OpenSSH 不支持连接复用），所以每次往返 ~100–300ms；**很多条小命令应在一次 `remote_exec` 里拼成脚本**，别一条一条发。
- `logs` 按字节切，可能切断多字节字符（中文字符在截断处会变成替换符）。
- 未做断点续传：传输中断要从头再来。
