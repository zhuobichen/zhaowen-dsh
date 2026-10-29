// 真机端到端：连真实 SSH 主机，把 5 个工具全跑一遍。
//
// 需要环境变量（或直接改下面的 fallback）：
//   DSH_REMOTE_HOST / DSH_REMOTE_USER / DSH_REMOTE_PORT / DSH_REMOTE_KEY
//   DSH_REMOTE_KNOWN_HOSTS（可选，主机密钥落盘位置）
//
// 跑法：node test/live.mjs
// 没有任何主机信息就自动跳过（普通 CI 不会碰网络）。

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply } from '../lib/index.js'

const host = process.env.DSH_REMOTE_HOST
const user = process.env.DSH_REMOTE_USER

if (!host || !user) {
  console.log('SKIP live: 没有 DSH_REMOTE_HOST / DSH_REMOTE_USER（不想动真机就保持这样）')
  process.exit(0)
}

const here = dirname(fileURLToPath(import.meta.url))
const tools = new Map()

apply(
  { tools: { register: (definition) => tools.set(definition.name, definition) }, logger: { warn() {} } },
  {
    defaultHost: 'live',
    hosts: {
      live: {
        host,
        user,
        ...(process.env.DSH_REMOTE_PORT ? { port: Number(process.env.DSH_REMOTE_PORT) } : {}),
        ...(process.env.DSH_REMOTE_KEY ? { identityFile: process.env.DSH_REMOTE_KEY } : {}),
        workdir: process.env.DSH_REMOTE_WORKDIR || '~/.dsh-remote',
        ...(process.env.DSH_REMOTE_KNOWN_HOSTS
          ? { options: { UserKnownHostsFile: process.env.DSH_REMOTE_KNOWN_HOSTS } }
          : {}),
      },
    },
  },
)

const signal = new AbortController().signal
const call = (name, args) => tools.get(name).execute(args, { signal })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let failures = 0

const check = async (label, fn) => {
  try {
    await fn()
    console.log(`✔ ${label}`)
  } catch (error) {
    failures += 1
    console.error(`✘ ${label}\n${error?.stack ?? error}`)
  }
}

const scratch = `~/.dsh-remote/live-${Date.now()}`

try {
  // 先把测试目录建出来（cwd 显式给出的目录不存在时，插件会明确报 97——见第 8 项）。
  await call('remote_exec', { command: `mkdir -p ${scratch}`, cwd: '~' })

  // ---- 1. 体检 ----
  await check('remote_doctor 连通并报出系统信息', async () => {
    const value = await call('remote_doctor', {})

    assert.equal(value.reachable, true, JSON.stringify(value))
    assert.match(value.report, /Linux|Darwin/)
    assert.match(value.report, /bash=/)
  })

  // ---- 2. 前台执行：输出、退出码、两路流 ----
  await check('remote_exec 带回 stdout/stderr/退出码', async () => {
    const value = await call('remote_exec', {
      command: 'echo out-line\necho err-line >&2\nexit 3',
      cwd: scratch,
    })

    assert.equal(value.exit_code, 3, JSON.stringify(value))
    assert.match(value.stdout, /out-line/)
    assert.match(value.stderr, /err-line/)
    assert.equal(value.timed_out, false)
  })

  // ---- 3. 引号 / 变量 / 多行不被破坏 ----
  await check('脚本里的引号与 $VAR 原样生效', async () => {
    const value = await call('remote_exec', {
      command: `x=42\nprintf '%s|%s\\n' "x=$x" 'single $x'\ncat <<'EOF'\nheredoc 里的 $HOME 不展开\nEOF`,
      cwd: scratch,
    })

    assert.equal(value.exit_code, 0, JSON.stringify(value))
    assert.match(value.stdout, /x=42\|single \$x/)
    assert.match(value.stdout, /heredoc 里的 \$HOME 不展开/)
  })

  // ---- 4. 脚本不会被「读 stdin 的命令」啃掉 ----
  await check('脚本里夹着读 stdin 的命令时，后面的行不受影响', async () => {
    const value = await call('remote_exec', {
      command: 'echo one\nhead -c 1 >/dev/null 2>&1 || true\necho two\ncat >/dev/null 2>&1 || true\necho three',
      cwd: scratch,
    })

    assert.equal(value.exit_code, 0, JSON.stringify(value))
    assert.match(value.stdout, /one\ntwo\nthree/)
  })

  // ---- 5. 后台作业：running → 跑完 → 日志 ----
  let jobId

  await check('后台作业能起来、能等到结束、日志可读', async () => {
    const started = await call('remote_exec', {
      command: 'echo started\nsleep 8\necho finished',
      background: true,
      name: 'live-sleep',
      cwd: scratch,
    })

    jobId = started.job_id
    assert.ok(jobId, JSON.stringify(started))

    const running = await call('remote_job', { op: 'status', job_id: jobId })

    assert.equal(running.job.status, 'running')

    const done = await call('remote_job', { op: 'wait', job_id: jobId, timeout_ms: 30000 })

    assert.equal(done.job.status, 'done', JSON.stringify(done))
    assert.equal(done.job.exit_code, 0)
    assert.match(done.stdout, /started/)
    assert.match(done.stdout, /finished/)
  })

  // ---- 5. 作业列表 ----
  await check('remote_job list 能看到刚起的作业', async () => {
    const listed = await call('remote_job', { op: 'list', limit: 20 })

    assert.ok(listed.jobs.some((job) => job.id === jobId), JSON.stringify(listed.jobs))
  })

  // ---- 6. 终止长作业 ----
  await check('remote_job kill 能终止长作业（143）', async () => {
    const started = await call('remote_exec', { command: 'sleep 300', background: true, name: 'live-kill', cwd: scratch })
    const killed = await call('remote_job', { op: 'kill', job_id: started.job_id })

    assert.equal(killed.killed, true, JSON.stringify(killed))

    const status = await call('remote_job', { op: 'status', job_id: started.job_id })

    assert.equal(status.job.status, 'done')
    assert.equal(status.job.exit_code, 143)
  })

  // ---- 7. 上传 → 远端可见 → 拉回 → 内容一致 ----
  await check('upload / download 往返一致', async () => {
    const localRoot = join(here, '.tmp', `live-${Date.now()}`)
    const source = join(localRoot, 'payload')
    const target = join(localRoot, 'back')

    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'a.txt'), 'hello-from-windows\n')
    await writeFile(join(source, 'b.txt'), 'x'.repeat(10000))
    await mkdir(join(source, 'nested'), { recursive: true })
    await writeFile(join(source, 'nested', 'c.txt'), '深一层的文件\n')

    const up = await call('remote_upload', {
      local_path: source,
      remote_dir: scratch,
      exclude: ['node_modules'],
    })

    assert.ok(up.bytes > 0, JSON.stringify(up))

    const listing = await call('remote_exec', {
      command: 'find payload -type f | sort\nwc -c < payload/a.txt',
      cwd: scratch,
    })

    assert.match(listing.stdout, /payload\/a.txt/)
    assert.match(listing.stdout, /payload\/nested\/c.txt/)

    const down = await call('remote_download', { remote_path: `${scratch}/payload`, local_dir: target })

    assert.ok(down.bytes > 0)

    const { readFile, readdir } = await import('node:fs/promises')
    const back = await readFile(join(target, 'payload', 'nested', 'c.txt'), 'utf8')

    assert.equal(back.trim(), '深一层的文件')
    assert.deepEqual((await readdir(join(target, 'payload', 'nested'))).sort(), ['c.txt'])

    await rm(localRoot, { recursive: true, force: true })
  })

  // ---- 8. 错误路径：不存在的 cwd 要明确失败 ----
  await check('cwd 不存在时退出码 97 且 stderr 有解释', async () => {
    const value = await call('remote_exec', { command: 'echo nope', cwd: '/definitely/not/here' })

    assert.equal(value.exit_code, 97, JSON.stringify(value))
    assert.match(value.stderr, /远端目录不存在/)
  })

  // ---- 9. 不存在的作业要报 missing，而不是假装成功 ----
  await check('不存在的 job_id 报 missing', async () => {
    const value = await call('remote_job', { op: 'status', job_id: 'r20260101010101-abcdef' })

    assert.equal(value.missing, true)
  })
} finally {
  await call('remote_exec', { command: `rm -rf ${scratch}`, cwd: '~' }).catch(() => {})
}

if (failures > 0) {
  console.error(`\n${failures} 项失败`)
  process.exit(1)
}

console.log('\nlive: 全部通过')
