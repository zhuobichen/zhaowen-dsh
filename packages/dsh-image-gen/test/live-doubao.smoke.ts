// 真·豆包冒烟：需要那个带 --remote-debugging-port 的豆包实例在跑。
//
//   node test/live-doubao.smoke.ts "画一只戴帽子的小猫，白底"
//   node test/live-doubao.smoke.ts --edit <输入图> "把背景换成纯白"
//
// CDP 不可达时打印 SKIP 并退出 0 —— 这样它不会挡住没开豆包的人。

import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDoubaoDriver } from '../lib/doubao.js'

const args = process.argv.slice(2)
const editIndex = args.indexOf('--edit')
const mode = editIndex >= 0 ? 'edit' : 'generate'
const input = editIndex >= 0 ? args[editIndex + 1] : undefined
const prompt = (editIndex >= 0 ? args[editIndex + 2] : args[0]) || '画一只戴蓝色渔夫帽的橘猫，纯白背景，扁平插画'

const driver = createDoubaoDriver()
const status = await driver.status()

if (!status.reachable) {
  console.log(`SKIP: 豆包调试端口不可达（${status.error || 'no chat target'}）。`)
  console.log('      先运行 scripts/start-doubao-debug.cmd，并在那个窗口里扫码登录。')
  process.exit(0)
}

if (!status.composerVisible) {
  console.log('SKIP: 找到页面了，但看不到输入框（可能还没登录或界面没起来）。')
  process.exit(0)
}

if (mode === 'edit' && (!input || !existsSync(input))) {
  console.error('用法: node test/live-doubao.smoke.ts --edit <输入图> "提示词"')
  process.exit(2)
}

const out = mkdtempSync(join(tmpdir(), 'dsh-image-live-'))
const outputBase = join(out, mode === 'edit' ? `edit_${Date.now()}` : `gen_${Date.now()}`)

console.log(`[i] mode=${mode} outputBase=${outputBase}`)
console.log(`[i] prompt=${prompt}`)

const result = mode === 'edit'
  ? await driver.edit(prompt, { images: [input!], outputBase })
  : await driver.generate(prompt, { outputBase })

if (!existsSync(result.path)) throw new Error(`没生成文件: ${result.path}`)
if (!existsSync(result.metaPath)) throw new Error(`没生成 sidecar: ${result.metaPath}`)

const size = statSync(result.path).size
const head = readFileSync(result.path).subarray(0, 12)

if (result.format === 'png' && !(head[0] === 0x89 && head[1] === 0x50)) {
  throw new Error('扩展名是 png，但文件头不是 PNG')
}
if (result.format === 'jpg' && !(head[0] === 0xff && head[1] === 0xd8)) {
  throw new Error('扩展名是 jpg，但文件头不是 JPEG')
}

if (mode === 'edit') {
  const md5 = (path: string) => createHash('md5').update(readFileSync(path)).digest('hex')

  if (md5(input!) === md5(result.path)) {
    throw new Error('图生图产物与输入图 MD5 相同 —— 很可能抓错了图')
  }
}

console.log('[OK]')
console.log(`     path: ${result.path}`)
console.log(`     size: ${result.width}x${result.height}, ${size} bytes, ${result.format}`)
console.log(`     meta: ${result.metaPath}`)
console.log(`     aigc: ${result.aigcMarker ? JSON.stringify(result.aigcMarker) : '(未检出)'}`)
console.log(`     took: ${result.durationMs}ms`)
