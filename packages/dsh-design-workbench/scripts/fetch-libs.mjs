#!/usr/bin/env node
/**
 * 拉回「漫画」层引用的外部风格库。
 *
 * 这三个仓库不是本项目的代码，是**本地参考副本**（约 740 MB），所以不放进 git，
 * 由这个脚本按需拉取。catalog.js 里 `COMIC_SRC` 指向它们，丢了封面与「本地副本」链接会断
 * （云端 URL 不受影响）。
 *
 * 用法：
 *   node scripts/fetch-libs.mjs                    # 拉到默认目录，已存在的跳过
 *   node scripts/fetch-libs.mjs --force            # 重拉（覆盖）
 *   node scripts/fetch-libs.mjs --only lemo,mg     # 只拉其中几个
 *   node scripts/fetch-libs.mjs --dir D:/libs      # 换目录（同时要设 DESIGN_COMIC_SRC 指向它）
 *   node scripts/fetch-libs.mjs --mirror https://ghfast.top   # 走镜像（GitHub 直连不通时）
 *
 * 默认目录与 catalog.js 一致：环境变量 DESIGN_COMIC_SRC，否则 D:/github_project/ZhaoWen_GitHub维护/code-to-film。
 * 依赖：node 18+（内置 fetch）、系统 tar（Windows 10+ 自带）。
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { spawnSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'

const DEFAULT_DIR = process.env.DESIGN_COMIC_SRC || 'D:/github_project/ZhaoWen_GitHub维护/code-to-film'

const REPOS = [
  { name: 'lemo-opuscar', repo: 'lemomo-ai/lemo-opuscar', desc: '66 种影片风格（约 110 MB）' },
  { name: 'mg-styles-15', repo: 'Vincentwei1021/mg-styles-15', desc: '15 种 MG 风格，含 421 MB 成片（约 560 MB）' },
  { name: 'sweety-handdraw-video', repo: 'threerocks/sweety-handdraw-video', desc: '手绘口播 Skill（约 42 MB）' },
]

function parseArgs(argv) {
  const a = { dir: DEFAULT_DIR, force: false, only: null, mirror: '' }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--force') a.force = true
    else if (k === '--dir') a.dir = argv[++i]
    else if (k === '--only') a.only = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean)
    else if (k === '--mirror') a.mirror = String(argv[++i] || '').replace(/\/+$/, '')
    else if (k === '-h' || k === '--help') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]); process.exit(0) }
  }
  return a
}

const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB'

/**
 * 下载：用 node 原生 http/https，不依赖外部 curl。
 *
 * 踩过的坑：镜像（ghfast 这类）经常不给 content-length；某些 curl 构建（MSYS2 版）
 * 遇到这种情况会「看起来成功、文件其实短一截」，tar 解压时报 "unexpected end of file"。
 * 原生 https + 收完核对字节数，能同时覆盖直连与镜像。
 */
function download(url, dest, hop = 0) {
  return new Promise((resolve, reject) => {
    if (hop > 6) return reject(new Error('重定向过多'))
    const mod = url.startsWith('https:') ? https : http
    const req = mod.get(url, { headers: { 'user-agent': 'zhaowen-dsh/fetch-libs' } }, (res) => {
      const code = res.statusCode || 0
      if (code >= 300 && code < 400 && res.headers.location !== undefined) {
        res.resume()
        return download(new URL(res.headers.location, url).href, dest, hop + 1).then(resolve, reject)
      }
      if (code !== 200) {
        res.resume()
        return reject(new Error('HTTP ' + code + ' · ' + url))
      }
      const total = Number(res.headers['content-length'] || 0)
      let got = 0
      res.on('data', (c) => { got += c.length })
      pipeline(res, fs.createWriteStream(dest)).then(
        () => {
          if (total > 0 && got !== total) return reject(new Error('下载不完整：' + got + '/' + total + ' 字节'))
          process.stdout.write('    下载 ' + mb(got) + '\n')
          resolve()
        },
        reject,
      )
    })
    req.on('error', reject)
    req.setTimeout(120000, () => req.destroy(new Error('连接超时')))
  })
}

function untar(file, into) {
  fs.mkdirSync(into, { recursive: true })
  // Windows 盘符是最大的坑：GNU tar 会把 `D:/...` 里的 `D:` 当成「远程主机:文件」，
  // 报 `Cannot connect to D: resolve failed`，然后 gzip 读空、报 unexpected end of file。
  // GNU tar 加 --force-local 就正常；bsdtar（Windows 自带）没这问题，也不认这个参数。
  const ver = spawnSync('tar', ['--version'], { encoding: 'utf8' })
  const isGnu = String(ver.stdout || '').includes('GNU tar')
  const args = isGnu ? ['--force-local', '-xzf', file, '-C', into] : ['-xzf', file, '-C', into]
  const r = spawnSync('tar', args, { stdio: 'inherit' })
  if (r.error) throw new Error('调不动 tar：' + r.error.message + '（Windows 10+ 自带，Git Bash 也有）')
  if (r.status !== 0) throw new Error('tar 退出码 ' + r.status)
}

async function main() {
  const a = parseArgs(process.argv.slice(2))
  const list = a.only === null ? REPOS : REPOS.filter((r) => a.only.some((o) => r.name.startsWith(o) || o === r.repo))
  if (list.length === 0) {
    console.error('没有匹配的仓库。可选：' + REPOS.map((r) => r.name).join(' / '))
    process.exit(1)
  }
  fs.mkdirSync(a.dir, { recursive: true })
  console.log('目标目录：' + a.dir)
  if (a.mirror) console.log('镜像前缀：' + a.mirror)
  console.log('')

  let failed = 0
  for (const r of list) {
    const target = path.join(a.dir, r.name)
    if (fs.existsSync(target) && !a.force) {
      console.log('[跳过] ' + r.name + ' 已存在（--force 可重拉）')
      continue
    }
    console.log('[拉取] ' + r.name + ' · ' + r.desc)
    const tmp = path.join(a.dir, '.' + r.name + '.tar.gz')
    const stage = path.join(a.dir, '.' + r.name + '.unpack')
    try {
      // 镜像（ghfast 这类）快，但偶尔给截断的包；失败自动回退到 codeload 直连。
      const direct = 'https://codeload.github.com/' + r.repo + '/tar.gz/refs/heads/main'
      const viaMirror = a.mirror
        ? a.mirror.replace(/\/+$/, '') + '/https://github.com/' + r.repo + '/archive/refs/heads/main.tar.gz'
        : ''
      const urls = viaMirror ? [viaMirror, direct] : [direct]
      let packed = false
      for (let i = 0; i < urls.length && !packed; i++) {
        try {
          await download(urls[i], tmp)
          fs.rmSync(stage, { recursive: true, force: true })
          untar(tmp, stage)
          packed = true
        } catch (e) {
          console.error('    源 ' + (i + 1) + '/' + urls.length + ' 失败：' + (e && e.message ? e.message : e))
          if (i + 1 < urls.length) console.error('    换直连 codeload 再试…')
        }
      }
      if (!packed) throw new Error('所有下载源都没成功')
      const tops = fs.readdirSync(stage).filter((x) => x !== '.' && x !== '..')
      if (tops.length !== 1) throw new Error('解压后应当只有一个顶层目录，实际：' + tops.join(', '))
      fs.rmSync(target, { recursive: true, force: true })
      fs.renameSync(path.join(stage, tops[0]), target)
      console.log('    完成 → ' + target)
    } catch (e) {
      failed++
      console.error('    失败：' + (e && e.message ? e.message : e))
      console.error('    可加 --mirror https://ghfast.top 再试（GitHub 直连不通时）')
    } finally {
      fs.rmSync(tmp, { force: true })
      fs.rmSync(stage, { recursive: true, force: true })
    }
  }

  console.log('')
  if (failed > 0) {
    console.error(failed + ' 个仓库没拉成功。')
    process.exit(1)
  }
  console.log('全部就绪。面板上「漫画」层的封面与本地副本链接应当都能打开了。')
  if (path.resolve(a.dir) !== path.resolve(DEFAULT_DIR)) {
    console.log('')
    console.log('⚠ 你换了目录，把下面这句加进环境变量，catalog.js 才会指到这里：')
    console.log('  DESIGN_COMIC_SRC=' + a.dir)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
