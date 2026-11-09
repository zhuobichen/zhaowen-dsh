#!/usr/bin/env node
/**
 * 门禁检查：等待必须终结，取消必须生效。
 *
 * 背景见 docs/门禁-等待与取消.md。两次真实事故：
 *   - host_exec 等一个永不退出的 daemon，`close` 不来 → 工具永久挂起、停止键无效
 *   - generate_video 等隐藏页的 CDP 回包，没有超时 → 同上
 *
 * 这个脚本自动找**同形**的代码，输出三档：
 *   [必错] 结构上就能挂死（单一落点且无 deadline / 超时只 kill 不结算 / 工具不接取消）
 *   [存疑] 无 deadline，但等的对象通常会自己退出（需要人工确认）
 *   [提示] 有 deadline 但写法可以更稳
 *
 * 用法：
 *   node scripts/check-await-safety.mjs                 # 扫本仓库 packages/
 *   node scripts/check-await-safety.mjs <dir> [dir...]  # 扫指定目录
 *   node scripts/check-await-safety.mjs --json          # 机器可读
 *
 * 退出码：发现 [必错] 时为 1，否则 0（方便挂 CI）。
 *
 * 已知误报：间接 resolve（`setTimeout(() => done(v))` 而 done 内部 resolve）
 * 会被判成"没结算"。所以 [必错] 必须人工复核一次再改代码，不要盲信。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const dirs = args.filter((a) => !a.startsWith('--'))

const ROOTS = dirs.length
  ? dirs.map((d) => resolve(d))
  : [resolve(import.meta.dirname, '..', 'packages')]

const SKIP = /node_modules|[/\\](lib|dist|output|coverage|\.git)[/\\]|\.map$|\.min\.js$/
const EXT = /\.(js|mjs|cjs|ts|tsx|mts|cts)$/
const TESTISH = /(^|[/\\])(test|tests|__tests__|scripts)[/\\]|\.(test|spec)\./

function walk(dir, depth, out) {
  if (depth > 6) return out
  let ents = []
  try {
    ents = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of ents) {
    const p = join(dir, e.name)
    if (SKIP.test(p)) continue
    if (e.isDirectory()) walk(p, depth + 1, out)
    else if (EXT.test(e.name)) out.push(p)
  }
  return out
}

const files = []
for (const r of ROOTS) walk(r, 0, files)

const out = []

/** 取一段窗口（行数组，0-based 起止，含端点）。 */
const win = (lines, from, to) => lines.slice(Math.max(0, from), Math.min(lines.length, to)).join('\n')

/** 这段代码里有没有"结算"动作（直接或通过一个局部函数）。 */
const SETTLES = /\b(resolve|reject|finish|settle|done|fin)\s*\(/

for (const file of files) {
  let src = ''
  try {
    src = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  const lines = src.split('\n')
  const rel = relative(process.cwd(), file).replace(/\\/g, '/')
  const testish = TESTISH.test(rel)

  // ── ① new Promise：只由事件结算，且整个函数窗口内没有任何 setTimeout ──
  for (let i = 0; i < lines.length; i += 1) {
    if (!/new Promise\s*[<(]/.test(lines[i])) continue
    const body = win(lines, i, i + 60)
    const eventSettle = /\.on\(['"](close|exit|message|data|end|finish|error|aborted)['"]|addEventListener\(\s*['"](message|close|error)['"]|\.once\(/.test(body)
    const hasTimer = /\bsetTimeout\s*\(/.test(body)
    if (!eventSettle) continue

    if (!hasTimer) {
      out.push({
        sev: testish ? '提示' : '必错',
        file: rel,
        line: i + 1,
        kind: 'Promise 只由事件结算，函数内没有 setTimeout',
        note: '事件不来就永不 settle。需要一个「无论如何都会结束」的 deadline。',
      })
      continue
    }

    // ── ② 有 setTimeout，但超时块里只 kill、不结算 ──
    const timerIdx = body.search(/\bsetTimeout\s*\(/)
    if (timerIdx >= 0) {
      // 按 `}, <delay>)` 精确切出 setTimeout 的第一个参数块。
      // 不能用固定字符窗口：注释一多，结算的 finish() 就落到窗口外了（pdf.ts 就漏过两次）。
      const rest = body.slice(timerIdx)
      const endM = rest.match(/\}\s*,\s*[\w.$]*\s*\)/)
      const timerBody = endM && endM.index !== undefined ? rest.slice(0, endM.index + endM[0].length) : rest.slice(0, 1200)
      const kills = /\b(kill|taskkill|SIGKILL|SIGTERM)\b/.test(timerBody)
      const settlesInTimer = SETTLES.test(timerBody)
      if (kills && !settlesInTimer) {
        out.push({
          sev: testish ? '提示' : '必错',
          file: rel,
          line: i + 1,
          kind: '超时块只 kill、不结算',
          note: 'kill 之后仍在等 close/error。超时必须自己也 resolve（带 timedOut 标记）。',
        })
      }
    }
  }

  // ── ③ 起子进程但没有任何 deadline ──
  for (let i = 0; i < lines.length; i += 1) {
    if (!/\b(spawn|spawnSync|execFile|execFileSync|exec|execSync)\s*\(/.test(lines[i])) continue
    if (/^\s*(\/\/|\*|\/\*)/.test(lines[i])) continue
    const ctx = win(lines, i, i + 8)
    // 选项里出现 timeout（简写或键值）或 signal 就算有兜底
    if (/\btimeout\b/.test(ctx) || /\bsignal\b/.test(ctx)) continue
    // 调用点附近 40 行内有 kill / taskkill 也算有兜底
    if (/\b(kill|taskkill)\s*\(/.test(win(lines, i, i + 40))) continue
    out.push({
      sev: testish ? '提示' : '存疑',
      file: rel,
      line: i + 1,
      kind: 'spawn/exec 无 timeout、附近也无 kill',
      note: '子进程不退就一直等。给它 timeout，或显式看护并在超时时收整棵树。',
    })
  }

  // ── ④ 注册了模型工具、又有长轮询，却全文件不读取消信号 ──
  const registersTool = /ctx\.tools\.register|defineTool\s*\(/.test(src)
  const hasPolling = /while\s*\(\s*Date\.now\(\)\s*-|for\s*\(\s*let\s+i\s*=\s*0;\s*i\s*<\s*\d{2,}/.test(src)
  const readsCancel = /\bexec\??\.signal\b|\bsignal\??\.aborted\b|\babortSignal\b/.test(src)
  if (registersTool && hasPolling && !readsCancel && !testish) {
    const at = lines.findIndex((l) => /while\s*\(\s*Date\.now\(\)/.test(l))
    out.push({
      sev: '必错',
      file: rel,
      line: at >= 0 ? at + 1 : 1,
      kind: '工具注册 + 长轮询，但不读 exec.signal',
      note: '用户点停止没有落点。把 exec.signal 传进来，在每个轮询里检查。',
    })
  }
}

const order = { 必错: 0, 存疑: 1, 提示: 2 }
out.sort((a, b) => (order[a.sev] ?? 9) - (order[b.sev] ?? 9) || a.file.localeCompare(b.file))

if (asJson) {
  console.log(JSON.stringify({ scanned: files.length, findings: out }, null, 2))
} else {
  console.log(`scanned ${files.length} files under:`)
  for (const r of ROOTS) console.log('  ' + r)
  for (const sev of ['必错', '存疑', '提示']) {
    const rows = out.filter((f) => f.sev === sev)
    if (!rows.length) continue
    console.log(`\n===== [${sev}] ${rows.length} 条 =====`)
    for (const f of rows) console.log(`  ${f.file}:${f.line}  ${f.kind}\n      ${f.note}`)
  }
  if (!out.length) console.log('\n没有发现可疑写法。')
  console.log('\n注意：[必错] 也要人工复核一次 —— 间接 resolve（setTimeout 里调 done()）会误判。')
}

process.exit(out.some((f) => f.sev === '必错') ? 1 : 0)
