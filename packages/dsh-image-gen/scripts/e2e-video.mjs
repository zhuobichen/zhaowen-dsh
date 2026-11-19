#!/usr/bin/env node
/**
 * 手动跑一次「图生视频」端到端，确认驱动链路通。
 *
 * **不是 CI 测试**：需要豆包桌面版带调试端口开着并已登录，而且每跑一次消耗
 * 一次每日视频额度。所以放在 scripts/ 而不是 test/，默认不跑。
 *
 * 用法：
 *   node scripts/e2e-video.mjs                              # 纯文字提示词
 *   node scripts/e2e-video.mjs --ref ./ref.png              # 带身份锚点（复刻角色时必须）
 *   node scripts/e2e-video.mjs --ref ./ref.png --out ./out/demo --prompt "5 秒竖屏，镜头固定"
 *
 * 参数：
 *   --ref <path>     参考图（本地路径）；给了就走图生视频
 *   --prompt <text>  提示词；省略用内置的 5 秒示例
 *   --out <base>     输出主干名（不含扩展名）；省略写到 ./_e2e-out/video-<时间戳>
 *
 * 前置：豆包带 --remote-debugging-port 启动并已登录，
 *      见 scripts/start-doubao-debug.ps1 与 README「前提」一节。
 */
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createDoubaoDriver } from '../lib/doubao.js'

function argOf(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = process.argv[i + 1]
  return v && !v.startsWith('--') ? v : fallback
}

const refArg = argOf('ref', '')
const outArg = argOf('out', '')
const promptArg = argOf('prompt', '')

const DEFAULT_PROMPT =
  '生成 5 秒竖屏视频：镜头固定，角色轻微转头看向镜头并眨一下眼，室内柔和暖光，浅景深，电影感，单镜到底'

const ref = refArg ? resolve(refArg) : ''
if (ref !== '' && !existsSync(ref)) {
  console.error(`[x] 参考图不存在：${ref}`)
  process.exit(2)
}

const outputBase = outArg
  ? resolve(outArg)
  : resolve(process.cwd(), '_e2e-out', `video-${new Date().toISOString().replace(/[:.]/g, '-')}`)
mkdirSync(dirname(outputBase), { recursive: true })

const driver = createDoubaoDriver({ newChat: false, videoTimeoutMs: 900_000 })

console.log('[.] 提示词  :', (promptArg || DEFAULT_PROMPT).slice(0, 60) + '…')
console.log('[.] 参考图  :', ref || '(无，纯文字)')
console.log('[.] 输出主干:', outputBase)
console.log('[.] 等一下，图生视频通常 2–6 分钟…')

const started = Date.now()
try {
  const out = await driver.generateVideo(promptArg || DEFAULT_PROMPT, {
    outputBase,
    ...(ref ? { referenceImages: [ref] } : {}),
  })
  console.log('\n[ok] 完成，用时 ' + Math.round((Date.now() - started) / 1000) + 's')
  console.log(JSON.stringify(out, null, 2))
} catch (error) {
  console.error('\n[x] 失败：' + String(error?.message ?? error))
  console.error('    排查：image_gen_status 看 CDP/输入框；确认豆包已登录；视频额度是否用完。')
  process.exit(1)
}
