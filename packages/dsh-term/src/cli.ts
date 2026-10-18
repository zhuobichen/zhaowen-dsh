#!/usr/bin/env node
/**
 * dsh-term —— 终端版 DeepSeek Harness
 * 像 Claude Code 一样住在终端：交互式 REPL + 多轮对话 + 流式输出 + 实时工具调用显示 + markdown 渲染。
 */
import { spawn } from 'node:child_process'
import readline from 'node:readline/promises'
import chalk from 'chalk'
import path from 'node:path'

interface Turn {
  role: 'user' | 'assistant'
  text: string
}

/** 全局 npm 安装的 dsh 运行时入口（node 直接跑，绕开 Windows 上 spawn 找不到 shim 的问题）。 */
const DSH_RUNTIME =
  process.env.DSH_RUNTIME ??
  path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')


/** 把 stderr 里的工具调用行（⚙ 前缀）渲染成灰色。 */
function renderToolCalls(stderrChunk: string): void {
  const lines = stderrChunk.split('\n')
  for (const line of lines) {
    if (line.includes('⚙')) {
      process.stdout.write(chalk.dim(line.trim()) + '\n')
    }
  }
}

/**
 * 跑一次 headless 任务。
 * stdout 是流式 assistant 文本（打字机），stderr 是 ⚙ 工具调用行。
 * 返回完整的 assistant 文本（用于对话历史）。
 */
function runHeadless(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DSH_RUNTIME, '--profile', 'headless', prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => {
      const text = d.toString()
      stdout += text
      process.stdout.write(text) // 流式打字机
    })
    child.stderr.on('data', (d: Buffer) => {
      const text = d.toString()
      stderr += text
      renderToolCalls(text)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr.trim() || `dsh 退出码 ${code}`))
    })
  })
}

function buildPrompt(input: string, history: Turn[]): string {
  if (history.length === 0) return input
  const lines = history.map((t) => (t.role === 'user' ? `用户：${t.text}` : `助手：${t.text}`))
  return `以下是我们的对话历史，请基于它回答最后的问题。\n\n${lines.join('\n')}\n\n用户：${input}`
}

function printHelp(): void {
  console.log(chalk.gray(`
内置命令：
  /help    显示本帮助
  /new     清空上下文、开始一个新会话
  /quit    退出（等价 /exit）

直接输入即可与 agent 对话。agent 可以读取文件、执行 shell 命令、编辑代码。
`))
}

/** DeepSeek 鲸鱼像素 logo（40×25，深蓝描边 + 品牌蓝身 + 冰蓝肚皮 + 白嘴）。 */
const WHALE_ROWS = [
  '........................................',
  '........................................',
  '........................D...............',
  '.......................DBD.......D......',
  '.......................DBBD.....DBD.....',
  '.......................DBBBD..DDBBD.....',
  '.......................DBBBBDDBBBBD.....',
  '.......DDDDDDDDD........DBBBBBBBBD......',
  '......DBBBBBBBBBDD.......DBBBBBBBD......',
  '.....DBBBBBBBBBBBBDD.....DBBBBBDD.......',
  '....DBBBBBBBBBBBBBBBDD....DBBBD.........',
  '...DDBBBBBBBBBBBBBBBBBD..DBBBBD.........',
  '...DBBBBBBBBBBBBBBBBBBBDDBBBBBD.........',
  '...DBBBDBBBBBBDBBBBBBBBBBBBBBBD.........',
  '...DBBBDBBBBBBDBBBBBBBBBBBBBBD..........',
  '...DBBBBBBBBBBBBBBBBBBBBBBBBBD..........',
  '...DBBBBWWWWWWWBBBBBBBBDBBBBD...........',
  '...DDBWWWWWWWWWWWWBBBBBBDBBBD...........',
  '....DLLWWWWWWWWWWWWDBBBBDDBD............',
  '.....DLLLWWWWWWWWWWDBBBBBDD.............',
  '......DDLLLWWWWWWLLLDBBBBBDD............',
  '........DLLLLLLLLLLLDDBBBBBBD...........',
  '.........DDDDDDDDDDD..DDDDDDD...........',
  '........................................',
  '........................................',
]

function colorWhaleChar(ch: string): string {
  switch (ch) {
    case 'D':
      return chalk.blue(ch) // 深蓝描边
    case 'B':
      return chalk.blueBright(ch) // 品牌蓝身
    case 'L':
      return chalk.cyanBright(ch) // 冰蓝肚皮
    case 'W':
      return chalk.white(ch) // 白嘴
    default:
      return ' ' // 透明
  }
}

function printLogo(): void {
  for (const row of WHALE_ROWS) {
    let line = ''
    for (const ch of row) {
      line += colorWhaleChar(ch)
    }
    console.log(line)
  }
}

async function main(): Promise<void> {
  process.env.DSH_CWD = process.env.DSH_CWD ?? process.cwd()

  printLogo()
  console.log(chalk.bold.green('dsh-term') + chalk.gray(' — 终端版 DeepSeek Harness'))
  console.log(chalk.gray('模型: ' + (process.env.DSH_MODEL ?? '默认') + '   工作目录: ' + process.env.DSH_CWD))
  console.log(chalk.gray('输入 /help 查看命令\n'))

  const history: Turn[] = []
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  for (;;) {
    const input = (await rl.question(chalk.cyan('❯ '))).trim()
    if (input === '') continue
    if (input === '/quit' || input === '/exit') break
    if (input === '/help') {
      printHelp()
      continue
    }
    if (input === '/new') {
      history.length = 0
      console.log(chalk.gray('已开始新会话\n'))
      continue
    }

    process.stdout.write('\n')
    try {
      const response = await runHeadless(buildPrompt(input, history))
      history.push({ role: 'user', text: input }, { role: 'assistant', text: response })
      process.stdout.write('\n')
    } catch (e) {
      console.error(chalk.red('错误: ' + (e as Error).message) + '\n')
    }
  }

  rl.close()
}

main().catch((e) => {
  const msg = (e as Error).message
  // 非交互（管道 EOF）时 readline 会关闭，属正常退出
  if (msg.includes('readline was closed')) process.exit(0)
  console.error(chalk.red('致命错误: ' + msg))
  process.exit(1)
})
