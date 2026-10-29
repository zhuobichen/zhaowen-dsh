// 纯函数单测：配置解析、引号/路径、状态文件解析、文本裁剪。
// 只 import 编译产物（lib/*.js），测的就是最终发出去的东西。

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { pickHost, resolveConfig, DEFAULT_REMOTE_WORKDIR } from '../lib/config.js'
import { quotePosix, remotePathExpr, clampTimeout, sshArgv } from '../lib/ssh.js'
import { buildStartScript, buildStatusScript, parseKv, parseList, parseLogs, parseStatus, newJobId, assertJobId } from '../lib/jobs.js'
import { clipTail, commandPreview, humanBytes, humanDuration } from '../lib/text.js'

test('quotePosix 能安全包住单引号', () => {
  assert.equal(quotePosix('abc'), `'abc'`)
  assert.equal(quotePosix("a'b"), `'a'\\''b'`)
})

test('remotePathExpr 把 ~ 交给远端 $HOME', () => {
  assert.equal(remotePathExpr('~'), '"$HOME"')
  assert.equal(remotePathExpr('~/.dsh-remote'), `"$HOME"/'.dsh-remote'`)
  assert.equal(remotePathExpr('/opt/x y'), `'/opt/x y'`)
  assert.throws(() => remotePathExpr('   '), /不能为空/)
})

test('clampTimeout 拒绝非法值并封顶', () => {
  assert.equal(clampTimeout(undefined, 1000), 1000)
  assert.equal(clampTimeout(5000, 1000), 5000)
  assert.equal(clampTimeout(9e12, 1000, 600000), 600000)
  assert.throws(() => clampTimeout(-1, 1000), /正整数/)
  assert.throws(() => clampTimeout('abc', 1000), /正整数/)
})

test('resolveConfig 用环境变量兜底并给出默认主机', () => {
  const previous = { ...process.env }

  process.env.DSH_REMOTE_HOST = '1.2.3.4'
  process.env.DSH_REMOTE_USER = 'root'
  process.env.DSH_REMOTE_PORT = '2222'

  try {
    const config = resolveConfig({})

    assert.equal(config.hosts.length, 1)
    assert.equal(config.hosts[0].target, 'root@1.2.3.4')
    assert.equal(config.hosts[0].port, 2222)
    assert.equal(config.hosts[0].workdir, DEFAULT_REMOTE_WORKDIR)
    assert.equal(config.defaultHost, 'default')
    assert.equal(config.execTimeoutMs, 120000)
  } finally {
    for (const key of ['DSH_REMOTE_HOST', 'DSH_REMOTE_USER', 'DSH_REMOTE_PORT']) delete process.env[key]
    Object.assign(process.env, previous)
  }
})

test('resolveConfig 明确拒绝坏配置，不静默跳过', () => {
  assert.throws(() => resolveConfig({ hosts: { a: { host: '' } } }), /host 必须是非空字符串/)
  assert.throws(() => resolveConfig({ hosts: { a: { host: 'x', port: 0 } } }), /port/)
  assert.throws(() => resolveConfig({ hosts: { a: { host: 'x' } }, defaultHost: 'nope' }), /不存在的主机/)
  assert.throws(() => resolveConfig({ hosts: { a: { host: 'x' } }, strictHostKeyChecking: 'weird' }), /strictHostKeyChecking/)
})

test('pickHost 按名字/默认取主机，名字错了报出可选值', () => {
  const config = resolveConfig({
    hosts: { tencent: { host: '1.1.1.1', user: 'root' }, other: { host: '2.2.2.2' } },
    defaultHost: 'tencent',
  })

  assert.equal(pickHost(config).name, 'tencent')
  assert.equal(pickHost(config, 'other').target, '2.2.2.2')
  assert.throws(() => pickHost(config, 'nope'), /可选: tencent, other/)
})

test('sshArgv 带上非交互与主机密钥策略', () => {
  const config = resolveConfig({ hosts: { a: { host: '1.2.3.4', user: 'root', port: 2222 } } })
  const host = pickHost(config)
  const argv = sshArgv(config, host, ['bash', '-l'])

  assert.equal(argv[0], '-T')
  assert.ok(argv.includes('BatchMode=yes'))
  assert.ok(argv.includes('StrictHostKeyChecking=accept-new'))
  assert.deepEqual(argv.slice(-3), ['root@1.2.3.4', 'bash', '-l'])
  assert.ok(argv.includes('-p') && argv.includes('2222'))
})

test('parseKv 忽略噪声行、保留值里的 =', () => {
  const kv = parseKv('STATUS=done\nnoise line\nCWD=/a=b\n=bad\nlower=1\nEXIT=0')

  assert.deepEqual(kv, { STATUS: 'done', CWD: '/a=b', EXIT: '0' })
})

test('parseStatus 把状态文件读成结构化结果', () => {
  const status = parseStatus(
    'r20260101010101-abcdef',
    'MISSING=0\nSTATUS=done\nEXIT=3\nPID=99\nALIVE=no\nSTARTED=1700000000\nSTDOUT_BYTES=12\nSTDERR_BYTES=4\nNAME=build\nCWD=/w',
  )

  assert.equal(status.status, 'done')
  assert.equal(status.exitCode, 3)
  assert.equal(status.stdoutBytes, 12)
  assert.equal(status.name, 'build')
  assert.equal(status.alive, false)
})

test('parseList 跳过非法 id', () => {
  const jobs = parseList(
    'r20260101010101-abcdef\tdone\t0\t1700000000\tbuild\nnot-an-id\trunning\t\t\t\n',
  )

  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].id, 'r20260101010101-abcdef')
  assert.equal(jobs[0].exitCode, 0)
})

test('parseLogs 用随机分隔符切出两段流', () => {
  const out = parseLogs(
    'MISSING=0\nSTATUS=done\nEXIT=0\nSTDOUT_BYTES=6\nSTDERR_BYTES=3\n__DSH_REMOTE_SEG_abc123__\nhello\n__DSH_REMOTE_SEG_abc123__\nerr',
  )

  assert.equal(out.stdout.trimEnd(), 'hello')
  assert.equal(out.stderr.trimEnd(), 'err')
  assert.equal(out.stdoutBytes, 6)
  assert.equal(out.status, 'done')
})

test('buildStartScript 原样保留用户命令，并把退出码写进状态文件', () => {
  const config = resolveConfig({ hosts: { a: { host: '1.2.3.4' } } })
  const host = pickHost(config)
  const id = 'r20260101010101-abcdef'
  const script = buildStartScript(host, {
    id,
    command: 'set -e\necho "$HOME" && exit 3',
    cwd: '~/work',
    name: 'demo',
  })

  assert.ok(script.includes('echo "$HOME" && exit 3'))
  assert.ok(script.includes('echo "$__dsh_rc" > "$R/exit_code"'))
  assert.ok(script.includes('echo done > "$R/status"'))
  assert.ok(script.includes('nohup setsid bash -l'))
  assert.ok(script.includes('DSH_REMOTE_EOF_'))

  const status = buildStatusScript(host, id)

  assert.ok(status.includes(`runs/${id}`))
  assert.ok(status.includes('MISSING=1'))
})

test('作业 id 格式受约束（防路径注入）', () => {
  const id = newJobId(Date.UTC(2026, 0, 1, 1, 1, 1))

  assert.match(id, /^r\d{14}-[0-9a-f]{6}$/)
  assertJobId(id)
  assert.throws(() => assertJobId('../../etc/passwd'), /不合法/)
})

test('文本工具：字节数、耗时、尾部裁剪', () => {
  assert.equal(humanBytes(999), '999 B')
  assert.equal(humanBytes(2048), '2.0 KiB')
  assert.equal(humanDuration(450), '450ms')
  assert.equal(humanDuration(1234), '1.2s')
  assert.equal(humanDuration(61000), '1m01s')

  const clipped = clipTail('x'.repeat(100), 100, 10)

  assert.ok(clipped.includes('前面还有'))
  assert.ok(clipped.endsWith('x'.repeat(10)))
  assert.equal(clipTail('short', 5, 100), 'short')
  assert.equal(commandPreview('a\n b\t c'), 'a b c')
})
