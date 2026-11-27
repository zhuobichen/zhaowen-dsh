/**
 * 封面本地缓存：把 catalog 里的云端封面下载到本机，让面板不依赖外网。
 *
 * 背景：catalog 里的封面有三种来源，本机都可能裂图——
 *   - 内页 MEMBERS[].cover 指向原作者的 D:/github_project/...，本机不存在；
 *   - 前端/视频层主封面只用 coverUrl（raw.githubusercontent），国内经常连不上；
 *   - 漫画层（cm-*）只有失效的本地 cover + cloud（GitHub blob 的 STYLE.md），
 *     海报要从 blob 路径推导出 raw 的 poster.jpg。
 * 这里在启动时把它们按需拉到 ~/.dsh/plugins/<name>/covers/，服务端 /cover、/member
 * 路由读缓存即可。
 *
 * 下载通道：优先 raw.githubusercontent；失败（国内常超时）回退 GitHub API
 * contents（返回 base64，这条通道实测稳定）。两条都只认 catalog 里写死的 GitHub URL。
 *
 * 约束：已有缓存跳过；失败只警告不阻塞启动；Node 18+ 内置 fetch，无第三方依赖。
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { extname, join } from 'node:path'
import { homedir } from 'node:os'

const MAX_BYTES = 12 * 1024 * 1024

function dshHome() {
  return process.env.DSH_HOME && process.env.DSH_HOME.trim() !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
}

export function coversDir(name) {
  return join(dshHome(), 'plugins', name, 'covers')
}

/** 用 URL 的 sha1 当文件名，避免不同目录同名（如各区的 01-xxx.jpg）。 */
export function coverPath(dir, url) {
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 20)
  let ext = ''
  try {
    ext = extname(new URL(url).pathname).toLowerCase()
  } catch {
    ext = ''
  }
  return join(dir, hash + (ext || '.img'))
}
const cacheFile = coverPath

function validFile(file) {
  try {
    return existsSync(file) && statSync(file).isFile() && statSync(file).size > 0
  } catch {
    return false
  }
}

/** GitHub blob URL → raw URL；其它 URL 原样返回。 */
function toRaw(url) {
  const m = /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/([^/]+)\/(.+)$/i.exec(url)
  if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`
  return url
}

/** raw URL → GitHub API contents 端点（失败时的回退通道）。 */
function toApi(url) {
  const m = /^https?:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([^/]+)\/(.+)$/i.exec(url)
  if (m) return `https://api.github.com/repos/${m[1]}/contents/${m[3]}?ref=${m[2]}`
  return null
}
/** raw URL → jsdelivr CDN（大图兜底：GitHub API 对 >1MB 文件不给 content，raw 又常超时）。 */
function toCdn(url) {
  const m = /^https?:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([^/]+)\/(.+)$/i.exec(url)
  if (m) return `https://cdn.jsdelivr.net/gh/${m[1]}@${m[2]}/${m[3]}`
  return null
}

async function getBuffer(url) {
  // 通道 1：raw
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'dsh-design-workbench' }, signal: AbortSignal.timeout(12000) })
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > 0 && buf.length <= MAX_BYTES) return buf
    }
  } catch {
    /* raw 超时 —— 走 API 回退 */
  }
  // 通道 2：GitHub API contents（base64）
  const api = toApi(url)
  if (api) {
    try {
      const res = await fetch(api, {
        headers: { 'User-Agent': 'dsh-design-workbench', Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(20000),
      })
      if (res.ok) {
        const j = await res.json()
        if (typeof j.content === 'string' && !j.truncated) {
          const buf = Buffer.from(j.content.replace(/\s/g, ''), 'base64')
          if (buf.length > 0 && buf.length <= MAX_BYTES) return buf
        }
      }
    } catch {
      /* API 也失败 —— 继续试 CDN */
    }
  }
  // 通道 3：jsdelivr CDN。raw 在国内常超时、GitHub API 对 >1MB 图不给 content，
  // CDN 能代理任意大小的 GitHub 文件，实测稳定。
  const cdn = toCdn(url)
  if (cdn) {
    try {
      const res = await fetch(cdn, { headers: { 'User-Agent': 'dsh-design-workbench' }, signal: AbortSignal.timeout(30000) })
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.length > 0 && buf.length <= MAX_BYTES) return buf
      }
    } catch {
      /* 三条都失败 —— 返回 null */
    }
  }
  return null
}

/** 下载一个 URL（可含 GitHub blob）到缓存文件。成功返回路径，失败返回 null。 */
export async function fetchCover(url, dir) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null
  const raw = toRaw(url)
  const file = cacheFile(dir, raw)
  if (validFile(file)) return file
  const buf = await getBuffer(raw)
  if (buf === null) {
    process.stderr.write(`[design-workbench] 封面下载失败（raw + API 都不通）: ${raw}\n`)
    return null
  }
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, buf)
    return file
  } catch (e) {
    process.stderr.write(`[design-workbench] 封面写盘出错: ${file} (${e?.message ?? e})\n`)
    return null
  }
}

/**
 * 从条目推导所有云端封面 URL：
 *   - 主封面 coverUrl；
 *   - 内页 members[].raw / http 的 cover；
 *   - 漫画层：本地 cover 失效且无 coverUrl 时，从 cloud / sources[].url 的
 *     GitHub blob 路径换出 poster.jpg 的 raw URL。
 */
export function coverUrlsOf(entry) {
  const urls = new Set()
  const add = (u) => { if (typeof u === 'string' && /^https?:\/\//i.test(u)) urls.add(u) }
  add(entry.coverUrl)
  for (const m of (Array.isArray(entry.members) ? entry.members : [])) {
    add(m.raw)
    if (typeof m.cover === 'string' && /^https?:\/\//i.test(m.cover)) add(m.cover)
  }
  // 通用：sources[].url 里指向图片（blob 或 raw，扩展名 .jpg/png/webp…）的一并收集。
  // agent-paper 层的图源就是这种 GitHub blob URL（cover 是失效的 D 盘路径、coverUrl 为空）。
  for (const s of (Array.isArray(entry.sources) ? entry.sources : [])) {
    const u = typeof s.url === 'string' ? s.url : ''
    if (/\.(jpe?g|png|webp|gif|svg)(\?|#|$)/i.test(u)) add(u)
  }
  // 漫画层：cover 是失效的本地 D 盘路径，coverUrl 为空。云端海报按仓库分两种：
  //   lemo-opuscar  : .../styles/<style>/poster.jpg
  //   mg-styles-15  : .../docs/readme/films/<NN-name>.webp
  // 两种都从 cloud（GitHub blob）拿 owner/repo/branch，从 cover 本地路径末段拿文件名。
  if (!urls.size && typeof entry.cloud === 'string') {
    const blob = /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/([^/]+)\//i.exec(entry.cloud)
    if (blob) {
      const [, repo, branch] = blob
      const cover = typeof entry.cover === 'string' ? entry.cover.replace(/\\/g, '/') : ''
      const file = cover.replace(/^.*\//, '')
      if (file && /\.(jpg|jpeg|png|webp|gif)$/i.test(file)) {
        // 本地 cover 的相对目录里含 docs/readme/films → mg 系；否则 lemo 系
        const rel = /docs\/readme\/films/i.test(cover)
          ? `docs/readme/films/${file}`
          : (() => {
              const m = /\/styles\/([^/]+)\//.exec(cover)
              return m ? `styles/${m[1]}/${file}` : ''
            })()
        if (rel) add(`https://raw.githubusercontent.com/${repo}/${branch}/${rel}`)
      }
    }
  }
  return [...urls]
}

/** 启动时后台预热：收集所有条目的云端封面 URL 并下载，不阻塞。 */
export function warmCovers(entries, name) {
  const dir = coversDir(name)
  const urls = new Set()
  for (const e of entries) for (const u of coverUrlsOf(e)) urls.add(u)
  const list = [...urls]
  let i = 0
  const worker = async () => {
    while (i < list.length) {
      const url = list[i++]
      await fetchCover(url, dir)
    }
  }
  Promise.all([worker(), worker(), worker(), worker()]).catch(() => {})
  return { dir, count: list.length }
}
