/**
 * 封面本地缓存：把 catalog 里的云端 raw URL 下载到本机，让面板不依赖外网。
 *
 * 背景：collections.js / catalog.js 里的封面有两种来源——
 *   - 内页 MEMBERS[].cover 指向原作者的 D:/github_project/...，本机不存在；
 *   - 主封面只用 coverUrl（raw.githubusercontent），国内经常连不上。
 * 两种都会让面板裂图。这里在应用启动时把它们按需拉到 ~/.dsh/plugins/<name>/covers/，
 * 并把「条目 id / raw URL」映射到缓存文件；服务端的 /cover、/member 路由读缓存即可。
 *
 * 约束：
 *   - 只下载 catalog 里写死的 raw URL（白名单），不接受任意 URL；
 *   - 已有缓存跳过，不重复下载；失败只警告，不影响启动；
 *   - 用 Node 18+ 内置 fetch，无第三方依赖。
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
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

/** 下载一个 URL 到缓存文件。成功返回路径，失败返回 null（只警告）。 */
export async function fetchCover(url, dir) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null
  const file = cacheFile(dir, url)
  if (validFile(file)) return file
  try {
    mkdirSync(dir, { recursive: true })
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) {
      process.stderr.write(`[design-workbench] 封面下载失败 HTTP ${res.status}: ${url}\n`)
      return null
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0 || buf.length > MAX_BYTES) {
      process.stderr.write(`[design-workbench] 封面大小异常 ${buf.length}B: ${url}\n`)
      return null
    }
    writeFileSync(file, buf)
    return file
  } catch (e) {
    process.stderr.write(`[design-workbench] 封面下载出错: ${url} (${e?.message ?? e})\n`)
    return null
  }
}

/**
 * 收集 catalog 里所有云端封面 URL（主封面 coverUrl + 内页 raw），启动时后台预热。
 * 传入 ALL_ENTRIES；每个条目的 members[].raw 也一并收集。
 */
export function warmCovers(entries, name) {
  const dir = coversDir(name)
  const urls = new Set()
  for (const e of entries) {
    if (typeof e.coverUrl === 'string' && /^https?:\/\//i.test(e.coverUrl)) urls.add(e.coverUrl)
    if (Array.isArray(e.members)) {
      for (const m of e.members) {
        if (typeof m.raw === 'string' && /^https?:\/\//i.test(m.raw)) urls.add(m.raw)
        // 内页也可能直接给了 http 的 cover
        if (typeof m.cover === 'string' && /^https?:\/\//i.test(m.cover)) urls.add(m.cover)
      }
    }
  }
  // 后台跑，不阻塞启动；并发限制 4
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
