/**
 * dsh-rea-video —— rea-video CLI（视频逆向拆解）的 DSH 接入 + 工作台。
 *
 * 上游（JuneYaooo/rea-video）是纯 Python CLI：ffmpeg 抽帧 → 逐镜判定（实拍 / AI / 3D /
 * 2D / 录屏 / 静态图…）→ 产出带证据的 report.html + 复刻方案。它不做 MCP，所以这里：
 *   1. 注册 rea_video_cli 工具（子命令白名单 + 自动 --out + 模型缓存重定向）；
 *   2. 挂 GET /rea-video/status，给工作台读最近一次拆解结果。
 */
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'rea-video'

export const inject = ['tools']

const PY = 'C:/Users/Administrator/AppData/Roaming/Python/Python311/Scripts/rea-video.exe'
const FFMPEG_DIR = 'D:/github_project/ZhaoWen_GitHub维护/_tools/ffmpeg/bin'
// ~/.cache is not writable on this machine, and rea-video caches face/stem models there.
const MODELS_DIR = 'D:\\github_project\\ZhaoWen_GitHub维护\\_tools\\rea-video-models'
const OUT_ROOT = 'D:\\github_project\\ZhaoWen_GitHub维护\\_tools\\rea-video-out'

const ALLOWED = new Set([
  'decompose', 'stems', 'probe', 'capsule', 'remake-plan', 'remake-run',
  'capsule-draft', 'assemble', 'tiles', 'summary', 'review', 'apply-review',
  'correct', 'prefs', 'memory', 'eval',
])

const NEEDS_OUT = new Set(['decompose', 'stems', 'capsule', 'remake-plan', 'capsule-draft', 'assemble'])

const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: true,
    properties: { ok: { type: 'boolean' } },
  },
  render: (_args, value) => [{ type: 'text', text: String(value?.text ?? JSON.stringify(value, null, 2)) }],
}

function run(args, timeout = 900_000) {
  return new Promise((resolve) => {
    const env = { ...process.env }
    env.PATH = FFMPEG_DIR.replace(/\//g, '\\') + ';' + (env.PATH ?? '')
    env.PYTHONIOENCODING = 'utf-8'
    env.REA_VIDEO_MODELS = MODELS_DIR
    execFile(PY, args, { timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024, env }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        exitCode: error?.code ?? 0,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
        error: error ? String(error.message) : undefined,
      })
    })
  })
}

/** 给需要输出目录的子命令补一个稳定的 --out，避免落到宿主 cwd。 */
function withOutputDir(argv) {
  const sub = argv[0]
  if (!NEEDS_OUT.has(sub)) return argv
  if (argv.includes('--out') || argv.includes('-o')) return argv
  const video = argv.find((a, i) => i > 0 && !a.startsWith('-') && /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(a))
  const dir = video ? join(OUT_ROOT, basename(video).replace(/\.[^.]+$/, '')) : join(OUT_ROOT, 'default')
  return [...argv, '--out', dir]
}

/** 最近一次拆解：OUT_ROOT 下最新的 breakdown.json。 */
function latestBreakdown() {
  if (!existsSync(OUT_ROOT)) return undefined
  let best
  for (const entry of readdirSync(OUT_ROOT)) {
    const file = join(OUT_ROOT, entry, 'breakdown.json')
    if (!existsSync(file)) continue
    const mtime = statSync(file).mtimeMs
    if (!best || mtime > best.mtime) best = { dir: join(OUT_ROOT, entry), file, mtime }
  }
  return best
}

function statusPayload() {
  const found = latestBreakdown()
  if (!found) return { ok: false, reason: 'no-run', message: '还没有拆解记录。' }
  try {
    const data = JSON.parse(readFileSync(found.file, 'utf8'))
    const summary = data?.summary ?? {}
    return {
      ok: true,
      dir: found.dir,
      video: (data?.video_context?.path ?? data?.video_context?.file ?? '').toString(),
      duration: summary.duration,
      shots: summary.shots,
      confidence: summary.confidence,
      verdict: summary.verdict,
      mix: summary.production_mix ?? [],
      overlays: summary.overlay_kinds ?? [],
      packaging: summary.packaging ?? [],
      aspects: summary.aspects ?? [],
      vlm: summary.vlm ?? '',
      report: join(found.dir, 'report.html'),
      updatedAt: new Date(found.mtime).toISOString(),
    }
  } catch (error) {
    return { ok: false, reason: 'bad-json', message: String(error?.message ?? error) }
  }
}

export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'rea_video_cli',
      description:
        '执行 rea-video 视频逆向拆解 CLI。常用子命令：' +
        'decompose <video>（逐镜拆解，产出 report.html + breakdown，最常用；自动写到 _tools\\rea-video-out\\<视频名>）；' +
        'summary <dir>（打印已有拆解结论）；tiles <dir>（抽帧拼图，给能看图的 agent）；' +
        'probe <video>（只看元数据/来源）；prefs（查看偏好）；memory（查看记忆）。' +
        '视频路径必须是本机绝对路径。首次跑会下载人脸/分离模型（约 70 MB），1 分钟视频约几分钟，超时上限 15 分钟。' +
        '判定标准与报告结构见 rea-video 这个 skill。',
      parameters: {
        args: {
          type: 'array',
          items: { type: 'string' },
          required: true,
          description:
            '完整参数数组，第一个是子命令，例如 ["decompose","D:\\\\videos\\\\a.mp4","--lang","zh"]。' +
            '可用选项：--lang zh|en、--no-vlm、--no-packaging、--out <dir>、--workers <n>。',
        },
      },
      output: OUTPUT,
      execute: async (args) => {
        const argv = Array.isArray(args?.args) ? args.args.filter((x) => typeof x === 'string') : []
        const sub = argv[0]
        if (!sub || !ALLOWED.has(sub)) {
          return { ok: false, text: `未知子命令：${sub ?? '(空)'}\n可用：${[...ALLOWED].join(', ')}` }
        }
        if (!existsSync(PY)) {
          return { ok: false, text: `找不到 rea-video：${PY}\n先 pip install -e <rea-video 仓库>` }
        }
        const result = await run(withOutputDir(argv))
        const clip = (s, n) => (s.length > n ? s.slice(0, n) + `\n…（截断，共 ${s.length} 字符）` : s)
        const parts = []
        if (result.ok) parts.push('成功')
        else parts.push(`失败（exit ${result.exitCode}）：${result.error ?? ''}`)
        if (result.stdout.trim()) parts.push('--- stdout ---\n' + clip(result.stdout.trim(), 12_000))
        if (result.stderr.trim()) parts.push('--- stderr ---\n' + clip(result.stderr.trim(), 4_000))
        return { ok: result.ok, exitCode: result.exitCode, text: parts.join('\n\n') }
      },
    }),
  )

  ctx.inject(['webServer'], (sub) => {
    let ws
    try {
      ws = sub.webServer ?? (typeof sub.get === 'function' ? sub.get('webServer') : undefined)
    } catch {
      ws = undefined
    }
    if (!ws || typeof ws.register !== 'function') return
    ws.register({
      kind: 'prefix',
      path: '/rea-video',
      handler: (req, res) => {
        if (req.method !== 'GET') {
          res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
          res.end('{"ok":false,"error":"method-not-allowed"}')
          return
        }
        try {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(statusPayload()))
        } catch (error) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: String(error?.message ?? error) }))
        }
      },
    })
  })
}
