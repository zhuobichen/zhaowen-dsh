/**
 * 目录扫描：把「一堆项目/文档/截图」变成设计工作台的候选条目。
 *
 * 只用文件名与少量 manifest 字段判断，不读全文、不联网；有硬上限（目录数/候选数），
 * 扫大目录也不会卡住。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', 'dist', 'build', '.next', '.nuxt', '.output',
  '__pycache__', '.venv', 'venv', 'target', 'coverage', '.cache', '.idea', '.vscode',
  '.turbo', '.parcel-cache', 'obj', 'bin', 'Pods', '.gradle', '.dart_tool',
])

const NOISE_NAMES = new Set([
  'assets', 'asset', 'static', 'public', 'images', 'img', 'media', 'pics', 'screenshots',
  'docs', 'doc', 'apk', 'src', 'lib', 'components', 'pages', 'styles', 'css', 'js',
  'scripts', 'test', 'tests', 'examples', 'example', 'fixtures', 'locales', 'i18n',
  // 输出/临时目录：一堆图不代表一个设计素材，别让它们进库
  'out', 'output', 'outputs', 'tmp', 'temp', 'cache', 'logs', 'generated',
  'generated_images', 'imgs', 'renders', 'exports', 'downloads', 'node-build',
])

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'])
const IMAGE_HINT = /(screen|shot|preview|cover|banner|demo|capture|poster|mockup|ui)/i

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function firstLineOfReadme(dir) {
  const p = join(dir, 'README.md')
  if (!existsSync(p)) return ''
  try {
    const text = readFileSync(p, 'utf8').slice(0, 4000)
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (line === '' || line.startsWith('#') || line.startsWith('<') || line.startsWith('[') || line.startsWith('!') || line.startsWith('---')) continue
      const clean = line.replace(/[*`>]/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1').trim()
      if (clean.length >= 6) return clean.slice(0, 80)
    }
  } catch {
    /* 读不到就算了 */
  }
  return ''
}

/** 目录里最像「封面」的图：按 hint 打分，取第一个命中的。 */
function pickCover(dir, depth = 2) {
  let best = null
  let bestScore = -1
  const walk = (d, level) => {
    if (level > depth) return
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p, level + 1)
        continue
      }
      if (!IMAGE_EXT.has(extname(e.name).toLowerCase())) continue
      let size = 0
      try {
        size = statSync(p).size
      } catch {
        continue
      }
      if (size < 6000) continue
      const score = (IMAGE_HINT.test(e.name) ? 2 : 0) + (size > 60000 ? 2 : 1) - level
      if (score > bestScore) {
        bestScore = score
        best = p
      }
    }
  }
  walk(dir, 0)
  return best
}

function classify(dir) {
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const files = entries.filter((e) => e.isFile()).map((e) => e.name)
  const lower = files.map((f) => f.toLowerCase())

  const has = (re) => lower.some((f) => re.test(f))

  let images = 0
  for (const f of files) if (IMAGE_EXT.has(extname(f).toLowerCase())) images++

  const designDoc = has(/^(design|design-system|style-?guide|tokens|theme)\.(md|json)$/) || has(/^design[-_].*\.md$/)
  const android = has(/^androidmanifest\.xml$/) || has(/^build\.gradle(\.kts)?$/) || files.some((f) => f.toLowerCase().endsWith('.apk'))
  const videoAsset = has(/^render\.sh$/) || has(/^scene\.py$/) || has(/^remotion\.config\.(ts|js|mjs)$/) || has(/^hyperframes\.(json|yaml|yml)$/)
  const motion = has(/^motion-canvas/) || has(/^project\.ts$/)
  const siteRoot = has(/^index\.html$/) && images >= 3

  let pkg = null
  if (existsSync(join(dir, 'package.json'))) pkg = readJson(join(dir, 'package.json'))
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) }
  const frontend = Boolean(deps.react || deps.vue || deps.svelte || deps.next || deps.nuxt || deps.tailwindcss || deps.vite)
  const electron = Boolean(deps.electron)

  if (!(designDoc || android || videoAsset || motion || frontend || electron || siteRoot || images >= 5)) return null

  let layer = 'frontend'
  if (android || electron) layer = 'app'
  else if (videoAsset || motion) layer = 'codevideo'
  // 纯图目录（截图集/参考图）算前端素材，不再误判成「视频风格」

  const tags = []
  if (designDoc) tags.push('设计文档')
  if (siteRoot) tags.push('静态站')
  if (frontend) tags.push('前端项目')
  if (android) tags.push('Android')
  if (electron) tags.push('桌面')
  if (videoAsset) tags.push('代码生视频')
  if (images >= 5) tags.push('截图集')

  return { layer, designDoc, tags }
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
}

function shortHash(text) {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return h.toString(36).slice(0, 4)
}

/**
 * 扫一个根目录，返回候选。不写任何文件。
 * @param root 绝对路径
 * @param opts { depth, maxDirs, maxCandidates, knownPaths }
 */
export function scanRoot(root, opts = {}) {
  const depth = Number.isFinite(opts.depth) ? Math.max(1, Math.min(6, opts.depth)) : 3
  const maxDirs = opts.maxDirs ?? 4000
  const maxCandidates = opts.maxCandidates ?? 80
  const known = new Set((opts.knownPaths || []).map((p) => p.replace(/\\/g, '/').toLowerCase()))

  if (!existsSync(root)) return { ok: false, code: 'ROOT_MISSING', error: `目录不存在：${root}` }
  const st = statSync(root)
  if (!st.isDirectory()) return { ok: false, code: 'NOT_DIR', error: `不是目录：${root}` }

  const candidates = []
  let visited = 0

  const walk = (dir, level) => {
    if (visited > maxDirs || candidates.length >= maxCandidates) return
    visited++

    const hit = classify(dir)
    if (hit !== null) {
      const key = dir.replace(/\\/g, '/').toLowerCase()
      // 没收录过，且不是「已收录路径的父/子目录」才当候选（避免同一项目报两次）
      const already = [...known].some((k) => {
        const kk = k.replace(/\\/g, '/').toLowerCase()
        return kk === key || kk.startsWith(key + '/') || key.startsWith(kk + '/')
      })
      if (!already) {
        const name = basename(dir)
        const cover = pickCover(dir, 1)
        const readme = firstLineOfReadme(dir)
        const rel = relative(root, dir) || '.'
        candidates.push({
          id: `${hit.layer === 'app' ? 'app' : hit.layer === 'video' ? 'vid' : hit.layer === 'codevideo' ? 'cv' : 'fe'}-scan-${slugify(name) || 'dir'}-${shortHash(dir)}`,
          layer: hit.layer,
          name,
          oneLine: readme || `扫到的目录：${rel}`,
          source: dir,
          cover: cover || '',
          tags: ['扫描', ...hit.tags],
          kind: cover ? 'image' : 'text',
          bullets: [],
          howto: '扫进来的条目：先看 cover/source，需要的话再补要点与用法。',
          sources: [{ label: '目录', path: dir }, ...(readme ? [{ label: 'README', path: join(dir, 'README.md') }] : [])],
          origin: 'referenced',
        })
      }
    }

    if (level >= depth) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue
      if (/^_(tmp|temp|probe|cache|doubao|zc_tmp|design|mascot|monthly|qwen|profile|wegame|xiaozhi)/i.test(e.name)) continue
      if (/^(out|output|tmp|temp)-?\d*$/i.test(e.name)) continue
      walk(join(dir, e.name), level + 1)
      if (visited > maxDirs || candidates.length >= maxCandidates) return
    }
  }

  walk(root, 0)

  // 去噪：① 资源类目录名不单独成条 ② 父目录已经入选时，子目录不重复报
  const filtered = candidates.filter((c) => {
    const name = basename(c.source).toLowerCase()
    if (NOISE_NAMES.has(name)) return false
    const inside = candidates.some((o) => {
      if (o === c) return false
      if (NOISE_NAMES.has(basename(o.source).toLowerCase())) return false
      const rel = relative(o.source, c.source)
      return rel !== '' && !rel.startsWith('..')
    })
    return !inside
  })

  return { ok: true, root, scanned: visited, truncated: visited > maxDirs || candidates.length >= maxCandidates, candidates: filtered }
}
