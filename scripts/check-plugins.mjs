/**
 * 插件库体检：manifest 一致性 + 图标体积 + 客户端 bundle 存在性。
 *
 * 只读仓库文件，不装依赖、不联网。CI 里跑一次，本地也可以直接 `node scripts/check-plugins.mjs`。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = join(ROOT, 'packages')
const ICON_LIMIT = 256 * 1024

const problems = []
const notes = []

for (const dir of readdirSync(PACKAGES)) {
  const pkgDir = join(PACKAGES, dir)
  if (!statSync(pkgDir).isDirectory()) continue

  const manifestPath = join(pkgDir, 'package.json')
  if (!existsSync(manifestPath)) {
    problems.push(`${dir}: 缺少 package.json`)
    continue
  }

  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    problems.push(`${dir}: package.json 不是合法 JSON（${error.message}）`)
    continue
  }

  if (!manifest.name) problems.push(`${dir}: 缺少 name`)
  if (!manifest.version) problems.push(`${dir}: 缺少 version`)
  else if (!/^\d+\.\d+\.\d+/.test(manifest.version)) problems.push(`${dir}: version 不是 semver（${manifest.version}）`)
  if (!manifest.description) problems.push(`${dir}: 缺少 description`)
  if (!existsSync(join(pkgDir, 'README.md'))) problems.push(`${dir}: 缺少 README.md`)

  const exportsField = manifest.exports ?? {}
  const client = manifest.dsh?.client
  if (client) {
    if (!client.platform) problems.push(`${dir}: dsh.client 缺少 platform`)
    if (!exportsField['./client']) problems.push(`${dir}: 声明了 dsh.client 但没有 ./client export`)
    const clientFile = join(pkgDir, 'client.js')
    if (!existsSync(clientFile)) notes.push(`${dir}: 没有根 client.js（可能在 client/ 或 lib/ 下）`)
  }

  if (!manifest.files) problems.push(`${dir}: 缺少 files[]（发布时会带上一堆无关文件）`)
  if (!manifest.license) notes.push(`${dir}: package.json 没写 license 字段`)

  for (const icon of ['icon.svg', 'icon.png', 'icon.webp', 'icon.jpg']) {
    const iconPath = join(pkgDir, icon)
    if (!existsSync(iconPath)) continue
    const size = statSync(iconPath).size
    if (size > ICON_LIMIT) {
      problems.push(`${relative(ROOT, iconPath)}: ${(size / 1024).toFixed(0)} KB，超过 256 KB 上限`)
    }
  }
}

console.log(`packages: ${readdirSync(PACKAGES).filter((d) => existsSync(join(PACKAGES, d, 'package.json'))).length}`)
if (notes.length > 0) {
  console.log('\n提示：')
  for (const note of notes) console.log('  - ' + note)
}
if (problems.length > 0) {
  console.log('\n问题：')
  for (const problem of problems) console.log('  - ' + problem)
  process.exitCode = 1
} else {
  console.log('\nOK：所有包的 manifest / 图标 / README 都过检。')
}
