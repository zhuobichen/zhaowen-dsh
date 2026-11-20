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

  // bundle patch 里 insert 的模块名必须能解析：自身 / 依赖 / 宿主自带的 @deepseek-ai/*。
  // 2026-11-20 的真实事故：包改名（@local → @zhuobichen）只改了 package.json，
  // cordis.patch.yml 还指着旧名 —— 结果是插件 enabled:true 但 fiberPhase:null，
  // 工具消失、面板 404，而启动日志里并不显眼。
  const patchRel = manifest.dsh?.bundle?.patch
  if (patchRel) {
    const patchPath = join(pkgDir, patchRel)
    if (!existsSync(patchPath)) {
      problems.push(`${dir}: dsh.bundle.patch 指向的文件不存在（${patchRel}）`)
    } else {
      const text = readFileSync(patchPath, 'utf8')
      const deps = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ])
      for (const match of text.matchAll(/^\s*(?:-\s*)?name:\s*['"]?([^'"\s#]+)['"]?\s*$/gm)) {
        const name = match[1]
        if (name === manifest.name || name.startsWith(manifest.name + '/')) continue
        if (deps.has(name) || name.startsWith('@deepseek-ai/')) continue
        problems.push(
          `${dir}: ${patchRel} 引用的模块 ${name} 既不是自身也不是依赖` +
            `（改了包名却漏改 patch，重启后这个插件会 enabled 但挂不上）`,
        )
      }
    }
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
