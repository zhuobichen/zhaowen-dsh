// 真·shell 冒烟：用本机 bash 跑一遍插件生成的作业脚本，验证
// 「启动 → 状态 → 日志 → 终止 → 列表」这套状态机在真实 shell 里成立。
//
// 这里不是 mock：buildStartScript / buildStatusScript / buildLogsScript /
// buildKillScript 的输出被原样喂给 bash，作用对象是真实文件和真实进程。
// 远端跑的是 Linux 的 bash，本机（Git Bash / MSYS）足以验证引号、退出码捕获、
// 状态文件落盘这些易错点。找不到 bash 就跳过（CI 上一般都有）。

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runProcess } from '../lib/ssh.js'
import {
  buildKillScript,
  buildListScript,
  buildLogsScript,
  buildStartScript,
  buildStatusScript,
  parseList,
  parseLogs,
  parseStatus,
} from '../lib/jobs.js'

const candidates = [
  process.env.DSH_TEST_BASH,
  'bash',
  'C:/Program Files/Git/bin/bash.exe',
  'C:/Program Files/Git/usr/bin/bash.exe',
  'D:/git/Git/bin/bash.exe',
  'D:/git/Git/usr/bin/bash.exe',
].filter(Boolean)

const bash = candidates.find((candidate) => {
  const probe = spawnSync(candidate, ['-c', 'echo ok'], { encoding: 'utf8' })

  return probe.status === 0 && probe.stdout.includes('ok')
})

if (!bash) {
  console.log('SKIP local-jobs: 本机找不到 bash（设 DSH_TEST_BASH 指向一个 bash 即可跑）')
  process.exit(0)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 临时目录放在包内：这台机器的 %TEMP% 不可写（EPERM），而包目录一定是可写的。
const here = dirname(fileURLToPath(import.meta.url))
const scratchRoot = join(here, '.tmp')

await mkdir(scratchRoot, { recursive: true })

const tmp = await mkdtemp(join(scratchRoot, 'run-'))
const workdir = tmp.replace(/\\/g, '/')
const host = { name: 'local', host: 'localhost', workdir, options: {}, target: 'localhost' }

const run = async (script, timeoutMs = 30000) => {
  const result = await runProcess(bash, ['-l'], { stdin: script, timeoutMs, maxBytes: 200000 })

  assert.notEqual(result.code, 255, `脚本本身崩了: ${result.stderr}`)
  return result
}

const idOf = (scriptResult) => {
  const line = scriptResult.stdout.split(/\r?\n/).find((l) => l.startsWith('STARTED='))

  assert.ok(line, `启动脚本没有返回 STARTED=: ${scriptResult.stdout}\n${scriptResult.stderr}`)

  return line.slice('STARTED='.length).trim().split('/').pop()
}

const waitDone = async (id, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs

  for (;;) {
    const result = await run(buildStatusScript(host, id))
    const status = parseStatus(id, result.stdout)

    if (status.status === 'done') return status
    if (Date.now() > deadline) throw new Error(`作业 ${id} 没在 ${timeoutMs}ms 内结束: ${result.stdout}`)

    await sleep(200)
  }
}

let failures = 0

const check = async (label, fn) => {
  try {
    await fn()
    console.log(`✔ ${label}`)
  } catch (error) {
    failures += 1
    console.error(`✘ ${label}\n${error.stack}`)
  }
}

try {
  // ---- 1. 普通作业：退出码 / 两路输出 / 工作目录 ----
  let quickId

  await check('前台作业跑完并保留退出码、stdout、stderr', async () => {
    const started = await run(
      buildStartScript(host, {
        id: 'r20260101010101-aaaaaa',
        command: 'pwd\necho hello-out\necho hello-err >&2\nexit 3',
        cwd: '~/',
        name: 'quick',
      }),
    )

    quickId = idOf(started)
    const status = await waitDone(quickId)

    assert.equal(status.exitCode, 3, JSON.stringify(status))
    assert.equal(status.status, 'done')

    const logs = parseLogs((await run(buildLogsScript(host, quickId, null, 8192))).stdout)

    assert.match(logs.stdout, /hello-out/)
    assert.match(logs.stderr, /hello-err/)
    assert.equal(logs.exitCode, 3)
  })

  // ---- 2. 命令里的 $ 和引号不被提前展开 ----
  await check('用户命令里的 $VAR / 引号原样交给远端 shell', async () => {
    const started = await run(
      buildStartScript(host, {
        id: 'r20260101010101-bbbbbb',
        command: 'x=42; echo "x=$x" \'及单引号\'',
        cwd: '~/',
      }),
    )
    const status = await waitDone(idOf(started))
    const logs = parseLogs((await run(buildLogsScript(host, idOf(started), null, 8192))).stdout)

    assert.equal(status.exitCode, 0)
    assert.match(logs.stdout, /x=42 及单引号/)
  })

  // ---- 3. 长作业：running → kill → 143 ----
  await check('后台长作业能被终止，并写下 143', async () => {
    const started = await run(buildStartScript(host, { id: 'r20260101010101-cccccc', command: 'sleep 30', cwd: '~/' }))
    const id = idOf(started)
    const running = parseStatus(id, (await run(buildStatusScript(host, id))).stdout)

    assert.equal(running.status, 'running')

    const killed = await run(buildKillScript(host, id))

    assert.match(killed.stdout, /KILLED=yes/)

    const status = await waitDone(id, 10000)

    assert.equal(status.exitCode, 143)
  })

  // ---- 4. 列表能看到作业 ----
  await check('list 能列出作业', async () => {
    const jobs = parseList((await run(buildListScript(host, 20))).stdout)

    assert.ok(jobs.length >= 2, `只看到 ${jobs.length} 个作业`)
    assert.ok(jobs.some((job) => job.id === quickId))
  })

  // ---- 5. 增量读日志 ----
  await check('logs 支持按字节偏移增量读', async () => {
    const first = parseLogs((await run(buildLogsScript(host, quickId, 0, 5))).stdout)
    const nextOffset = Buffer.byteLength(first.stdout, 'utf8')
    const second = parseLogs((await run(buildLogsScript(host, quickId, nextOffset, 8192))).stdout)

    assert.ok(nextOffset > 0)
    assert.notEqual(first.stdout, second.stdout)
  })

  // ---- 6. 目录不存在时启动器立刻报错，而不是留下一个假 running ----
  await check('cwd 不存在时立刻失败（126/97），不会假装在跑', async () => {
    const started = await run(
      buildStartScript(host, { id: 'r20260101010101-dddddd', command: 'echo never', cwd: '/nope/definitely/missing' }),
    )
    const status = await waitDone(idOf(started), 15000)

    assert.ok(status.exitCode === 97 || status.exitCode === 126 || status.exitCode === 1, `退出码=${status.exitCode}`)
  })
} finally {
  await rm(tmp, { recursive: true, force: true }).catch(() => {})
}

if (failures > 0) {
  console.error(`\n${failures} 项失败`)
  process.exit(1)
}

console.log('\nlocal-jobs: 全部通过')
