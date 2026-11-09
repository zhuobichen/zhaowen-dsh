/**
 * dsh-rea-video —— 把 rea-video CLI 的「视频逆向拆解」接成 DSH 工具。
 *
 * 上游（JuneYaooo/rea-video）是纯 Python CLI：ffmpeg 抽帧 → 逐镜判定（实拍 / AI / 3D /
 * 2D / 录屏 / 静态图…）→ 产出一份带证据的 report.html + 复刻方案。它本身不做 MCP，
 * 所以这里只包一层：给 agent 一个稳定入口，并把 ffmpeg 放进 PATH（本机 ffmpeg 不在 PATH）。
 *
 * 判什么、怎么判、证据怎么写，交给 rea-video 这个 skill；这个工具只负责执行。
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'rea-video'

export const inject = ['tools']

const PY = 'C:/Users/Administrator/AppData/Roaming/Python/Python311/Scripts/rea-video.exe'
const FFMPEG_DIR = 'D:/github_project/ZhaoWen_GitHub维护/_tools/ffmpeg/bin'

const ALLOWED = new Set([
  'decompose', 'stems', 'probe', 'capsule', 'remake-plan', 'remake-run',
  'capsule-draft', 'assemble', 'tiles', 'summary', 'review', 'apply-review',
  'correct', 'prefs', 'memory', 'eval',
])

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

export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'rea_video_cli',
      description:
        '执行 rea-video 视频逆向拆解 CLI。常用子命令：' +
        'decompose <video>（逐镜拆解，产出 report.html + breakdown，最常用）；' +
        'summary <dir>（打印已有拆解结论）；tiles <dir>（抽帧拼图，给能看图的 agent）；' +
        'probe <video>（只看元数据/来源）；prefs（查看偏好）；memory（查看记忆）。' +
        '视频路径必须是本机绝对路径；输出目录默认在视频旁的 rea-video 工作目录。' +
        '首次跑一条 1 分钟的视频约几分钟到十几分钟（抽帧 + OCR + 判定），超时上限 15 分钟。' +
        '判定标准与报告结构见 rea-video 这个 skill。',
      parameters: {
        args: {
          type: 'array',
          items: { type: 'string' },
          required: true,
          description:
            '完整参数数组，第一个是子命令，例如 ["decompose","D:\\\\videos\\\\a.mp4","--lang","zh"]。' +
            '可用选项：--lang zh|en、--no-vlm（默认关闭 VLM）、--no-packaging（省 30-50 秒）、--out <dir>、--workers <n>。',
        },
      },
      output: OUTPUT,
      execute: async (args) => {
        const argv = Array.isArray(args?.args) ? args.args.filter((x) => typeof x === 'string') : []
        const sub = argv[0]
        if (!sub || !ALLOWED.has(sub)) {
          return {
            ok: false,
            text: `未知子命令：${sub ?? '(空)'}\n可用：${[...ALLOWED].join(', ')}`,
          }
        }
        if (!existsSync(PY)) {
          return { ok: false, text: `找不到 rea-video：${PY}\n先 pip install -e <rea-video 仓库>` }
        }
        const result = await run(argv)
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
}
