/**
 * dsh-design-workbench · 宿主半身
 *
 * 这是「AI 接触工作台数据的通道」：
 *   - 人：浏览器面板读 /design-workbench/state 与封面图；
 *   - AI：design_style 工具读同一份 catalog（list / layer / get / search）。
 *     面板里「复制引用」复制的那一行索引，指向的就是这个工具。
 *
 * 所以这里**只读**：不写 state、不留审计。工作台是给人看的，AI 需要时来查。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'

import { ALL_ENTRIES, LAYERS, TAGS, findEntry, layerOf, memberRef, refOf, specOf } from './catalog.js'
import { classifyEntry } from './classify.js'
import { scanRoot } from './scan.js'

const NAME = 'dsh-design-workbench'
const ROUTE = '/design-workbench'
const MAX_COVER_BYTES = 12 * 1024 * 1024

function dshHome() {
  return process.env.DSH_HOME && process.env.DSH_HOME.trim() !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
}

const MEDIA = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
}

// ── 覆盖层：用户用 design_scan 扫进来的条目（不写死进 catalog.js）──────
function extraPath() {
  return join(dshHome(), 'plugins', NAME, 'extra.json')
}

/** { entries: [ {id, layer, name, oneLine, source, cover, tags, kind, bullets, howto, sources} ] } */
function loadExtra() {
  try {
    const raw = JSON.parse(readFileSync(extraPath(), 'utf8'))
    if (raw && Array.isArray(raw.entries)) {
      return raw.entries.filter((e) => e && typeof e.id === 'string' && typeof e.layer === 'string')
    }
  } catch {
    // 没有覆盖层就是空
  }
  return []
}

function saveExtra(entries) {
  const dir = join(dshHome(), 'plugins', NAME)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(extraPath(), JSON.stringify({ entries }, null, 2), 'utf8')
}

/** catalog + 覆盖层合并后的五层（含每层的 filters）；面板与工具都从这读。 */
/** 给条目补上 nature（style / method / reference），面板与工具都靠它筛。 */
function withNature(e) {
  const r = classifyEntry(e)
  return { ...e, nature: r.nature, natureScore: r.score }
}

function mergedLayers() {
  const extra = loadExtra()
  return LAYERS.map((l) => {
    const added = extra.filter((e) => e.layer === l.id).map((e) => withNature({ ...e, prompt: refOf(e), spec: specOf(e), added: true }))
    return { ...l, entries: [...l.entries.map(withNature), ...added] }
  })
}

function allEntries() {
  return mergedLayers().flatMap((l) => l.entries)
}

function findAny(id) {
  return findEntry(id) ?? loadExtra().find((e) => e.id === id) ?? null
}

function layerOfAny(id) {
  return mergedLayers().find((l) => l.entries.some((e) => e.id === id)) ?? null
}

/** 扫描结果按 id 暂存，供 op=add 用（同一进程内有效）。 */
const scanProposals = new Map()

/** 面板读的整包状态：目录 + 标签 + 计数。 */
function snapshot() {
  const layers = mergedLayers()
  return {
    ok: true,
    at: new Date().toISOString(),
    layers,
    tags: TAGS,
    counts: layers.map((l) => ({ id: l.id, name: l.name, count: l.entries.length })),
    total: layers.reduce((n, l) => n + l.entries.length, 0),
    channel: 'design_style op=list / op=layer / op=get / op=search',
  }
}

export const name = NAME

export const inject = {
  tools: { required: true },
  webServer: { required: false },
}

export function apply(ctx) {
  const OUTPUT = {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        ok: { type: 'boolean', required: true },
        code: { type: 'string' },
        error: { type: 'string' },
        note: { type: 'string' },
      },
    },
    render: (_args, value) => [{ type: 'text', text: typeof value?.note === 'string' ? value.note : JSON.stringify(value, null, 2) }],
  }

  ctx.tools.register(
    defineTool({
      name: 'design_style',
      description:
        '设计工作台的数据通道：**用户本机的设计资料库，分五层（App 设计 / 前端设计 / 视频风格 / 代码生视频 / 漫画）**。\n' +
        '工作台面板是给人看的；这是给 AI 读同一份数据的入口。\n' +
        'op=list 五层全列（id / 名称 / 一句话 / 出处）；op=layer {id} 只看一层（app | frontend | video | codevideo | comic）；' +
        'op=get {id} 取完整规格（颜色/圆角/投影/CSS/要点/怎么用，几百字）；op=search {id: 关键词} 按名称/标签/出处搜。\n' +
        '用户说「用工作台里那个水墨的」「按那个紧凑仪表盘做」时，先用 op=search 或 op=list 找到 id，再 op=get 拿规格。',
      parameters: {
        op: { type: 'string', required: true, description: 'list | layer | get | search' },
        id: { type: 'string', description: '条目 id（get）、层 id（layer：app|frontend|video|codevideo|comic）、或关键词（search）' },
        nature: { type: 'string', description: '只要哪一类：style（风格，默认）/ all（含方法与素材）/ method / reference' },
        member: { type: 'number', description: 'op=get 时取内页第几种（1 起）；不给就是整个库' },
      },
      output: OUTPUT,
      execute: async (args) => {
        const op = String(args.op ?? '').trim()
        const arg = String(args.id ?? '').trim()
        const nature = String(args.nature ?? 'style').trim()
        const keep = (e) => nature === 'all' || nature === '' || e.nature === nature

        if (op === 'list') {
          return {
            ok: true,
            count: allEntries().filter(keep).length,
            nature,
            layers: mergedLayers().map((l) => {
              const kept = l.entries.filter(keep)
              return {
                id: l.id,
                name: l.name,
                hint: l.hint,
                count: kept.length,
                totalInLayer: l.entries.length,
                entries: kept.map((e) => ({ id: e.id, name: e.name, oneLine: e.oneLine, origin: e.origin, nature: e.nature, tags: e.tags })),
              }
            }),
            note: mergedLayers()
              .map((l) => `【${l.name}】${l.entries.length} 条\n` + l.entries.map((e) => `  ${e.id.padEnd(20)} ${e.name} —— ${e.oneLine}`).join('\n'))
              .join('\n\n'),
          }
        }

        if (op === 'layer') {
          const layer = mergedLayers().find((l) => l.id === arg || l.name === arg)
          if (layer === undefined) {
            return { ok: false, code: 'UNKNOWN_LAYER', error: `层只支持：${LAYERS.map((l) => l.id).join(' / ')}`, note: 'op=layer 需要 id：' + LAYERS.map((l) => l.id).join(' / ') }
          }
          const kept = layer.entries.filter(keep)
          return {
            ok: true,
            layer: { id: layer.id, name: layer.name, hint: layer.hint, count: kept.length, totalInLayer: layer.entries.length },
            entries: kept,
            note:
              `【${layer.name}】${kept.length}${kept.length !== layer.entries.length ? '/' + layer.entries.length : ''} 条（nature=${nature}）\n` +
              kept.map((e) => `  ${e.id.padEnd(20)} ${e.name} —— ${e.oneLine}`).join('\n') +
              (kept.length !== layer.entries.length ? '\n（被筛掉的是方法/素材；要看得传 nature=all）' : ''),
          }
        }

        if (op === 'get') {
          const entry = findAny(arg)
          if (entry === null) {
            return { ok: false, code: 'UNKNOWN_ENTRY', error: `没有这个条目：${arg}`, note: '用 op=list 看全部 id，或 op=search 搜关键词。' }
          }
          const members = Array.isArray(entry.members) ? entry.members : []
          const wantMember = Number(args.member)
          if (Number.isFinite(wantMember) && wantMember >= 1) {
            const idx = Math.floor(wantMember) - 1
            const mem = members[idx]
            if (mem === undefined) {
              return { ok: false, code: 'MEMBER_OUT_OF_RANGE', error: `这个库只有 ${members.length} 种，收到第 ${wantMember} 种`, note: `member 取 1–${members.length}` }
            }
            const text = memberRef(entry, idx)
            return {
              ok: true,
              entry: { id: entry.id, name: entry.name },
              member: { index: idx + 1, name: mem.name, tier: mem.tier, raw: mem.raw, cover: mem.cover },
              ref: text,
              spec: `【设计参考】${entry.name} · 第 ${idx + 1} 种「${mem.name}」${mem.tier ? '（' + mem.tier + '）' : ''}
` +
                `出处：${entry.source}

原图：${mem.raw || mem.cover}
` +
                `整套的要点与做法沿用库条目（另一次 op=get ${entry.id} 可取全套）。`,
              note: text,
            }
          }
          const memberText =
            members.length > 0
              ? '\n\n内页（' + members.length + ' 种）：\n' + members.map((m, i) => `  ${i + 1}. ${m.name}${m.tier ? '（' + m.tier + '）' : ''}`).join('\n')
              : ''
          return {
            ok: true,
            entry,
            layer: layerOfAny(entry.id),
            ref: refOf(entry),
            spec: specOf(entry) + memberText,
            members: members.map((m, i) => ({ index: i, name: m.name, tier: m.tier, raw: m.raw })),
            note: specOf(entry) + memberText,
          }
        }

        if (op === 'search') {
          const q = arg.toLowerCase()
          if (q === '') return { ok: false, code: 'EMPTY_QUERY', error: 'op=search 需要关键词（名称/标签/出处都可以）', note: '例如 op=search id=水墨' }
          const hits = allEntries().filter(keep).filter((e) => {
            const hay = [e.id, e.name, e.oneLine, e.source, ...(e.tags ?? [])].join(' ').toLowerCase()
            return hay.includes(q)
          })
          return {
            ok: true,
            count: hits.length,
            entries: hits.map((e) => ({ id: e.id, name: e.name, oneLine: e.oneLine, layer: layerOf(e.id)?.name ?? '', origin: e.origin })),
            note:
              hits.length === 0
                ? `没搜到「${arg}」。换个别名试试（比如「水墨」「仪表盘」「地图」）。`
                : hits.map((e) => `${e.id}  ${e.name} —— ${e.oneLine}`).join('\n'),
          }
        }

        return { ok: false, code: 'UNKNOWN_OP', error: `op 只支持 list / layer / get / search，收到：${op}`, note: 'op 只支持 list / layer / get / search。' }
      },
    }),
  )

  // ──────────────────────────────────────────────────────────────────────
  // 工具：扫目录 → 候选 → 入库（写 extra.json 覆盖层，不改 catalog.js）
  // ──────────────────────────────────────────────────────────────────────
  ctx.tools.register(
    defineTool({
      name: 'design_scan',
      description:
        '设计工作台的「导入」通道：扫一个本机目录，按四层给出候选，确认后写进工作台。\n' +
        'op=scan {id: 绝对路径} 扫目录（可选 depth，默认 3）→ 返回候选（id/层/名称/封面/出处）；' +
        'op=add {id: "all"} 或 {id: "id1,id2"} 把候选入库；op=list 看已导入的；op=remove {id} 删一条。\n' +
        '判断依据只看文件名与 manifest（package.json 依赖 / AndroidManifest / remotion 配置 / 截图数量），不读全文、不联网。',
      parameters: {
        op: { type: 'string', required: true, description: 'scan | add | list | remove' },
        id: { type: 'string', description: 'scan 时是根目录绝对路径；add 时是 "all" 或逗号分隔的候选 id；remove 时是条目 id' },
        depth: { type: 'number', description: 'scan 的递归深度，默认 3，最大 6' },
      },
      output: OUTPUT,
      execute: async (args) => {
        const op = String(args.op ?? '').trim()
        const arg = String(args.id ?? '').trim()

        if (op === 'scan') {
          if (arg === '') return { ok: false, code: 'EMPTY_ROOT', error: 'op=scan 需要一个绝对路径，例如 D:/github_project/third-party', note: '给我一个根目录。' }
          // 已知路径：把 source 里「（…）」后面的注解去掉，只留路径；外加 sources[].path
          const known = allEntries()
            .flatMap((e) => [e.source, ...(e.sources || []).map((x) => x.path || '')])
            .filter((x) => typeof x === 'string' && x !== '')
            .map((x) => x.split(/[（(]/)[0].trim())
          const result = scanRoot(arg, { depth: Number(args.depth) > 0 ? Number(args.depth) : 3, knownPaths: known })
          if (result.ok !== true) return { ...result, note: result.error }
          for (const c of result.candidates) scanProposals.set(c.id, c)
          return {
            ok: true,
            root: result.root,
            scanned: result.scanned,
            truncated: result.truncated,
            count: result.candidates.length,
            candidates: result.candidates.map((c) => ({ id: c.id, layer: c.layer, name: c.name, oneLine: c.oneLine, source: c.source, cover: c.cover })),
            note:
              result.candidates.length === 0
                ? `扫了 ${result.scanned} 个目录，没有发现新的设计素材。换个更靠里的根目录，或把 depth 调大。`
                : `扫了 ${result.scanned} 个目录，发现 ${result.candidates.length} 个候选：\n` +
                  result.candidates.map((c) => `  [${c.layer}] ${c.id}  ${c.name} —— ${c.oneLine}`).join('\n') +
                  '\n确认用 op=add id=all（或指定几个 id）。',
          }
        }

        if (op === 'add') {
          if (arg === '') return { ok: false, code: 'EMPTY_ID', error: 'op=add 需要 "all" 或候选 id 列表' }
          const wanted = arg === 'all' ? [...scanProposals.keys()] : arg.split(',').map((x) => x.trim()).filter(Boolean)
          const extra = loadExtra()
          const have = new Set(extra.map((e) => e.id))
          const added = []
          for (const id of wanted) {
            const c = scanProposals.get(id)
            if (c === undefined || have.has(id)) continue
            extra.push(c)
            have.add(id)
            added.push(c)
          }
          saveExtra(extra)
          return {
            ok: true,
            added: added.length,
            total: allEntries().length,
            note:
              added.length === 0
                ? '没有新增（候选已失效或已存在）。重新 scan 一次再 add。'
                : `入库 ${added.length} 条：\n` + added.map((c) => `  [${c.layer}] ${c.name}`).join('\n') + `\n工作台现在 ${allEntries().length} 条。`,
          }
        }

        if (op === 'list') {
          const extra = loadExtra()
          return {
            ok: true,
            count: extra.length,
            entries: extra.map((e) => ({ id: e.id, layer: e.layer, name: e.name, source: e.source })),
            note:
              extra.length === 0
                ? '还没有导入过条目。用 op=scan 扫一个目录。'
                : extra.map((e) => `  [${e.layer}] ${e.id}  ${e.name}`).join('\n'),
          }
        }

        if (op === 'remove') {
          if (arg === '') return { ok: false, code: 'EMPTY_ID', error: 'op=remove 需要条目 id' }
          const extra = loadExtra()
          const next = extra.filter((e) => e.id !== arg)
          if (next.length === extra.length) return { ok: false, code: 'NOT_FOUND', error: `没有这条导入记录：${arg}` }
          saveExtra(next)
          return { ok: true, removed: arg, total: allEntries().length, note: `已移除 ${arg}，工作台现在 ${allEntries().length} 条。` }
        }

        return { ok: false, code: 'UNKNOWN_OP', error: `op 只支持 scan / add / list / remove，收到：${op}` }
      },
    }),
  )

  // ──────────────────────────────────────────────────────────────────────
  // Web 面板接口：/state、/cover/<id>
  // ──────────────────────────────────────────────────────────────────────
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (webCtx) => {
      webCtx.effect(() =>
        webCtx.webServer.register({
          kind: 'prefix',
          path: ROUTE,
          handler: async (req, res) => {
            const json = (code, body) => {
              res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
              res.end(JSON.stringify(body))
            }

            let path = '/'
            try {
              path = new URL(String(req.url ?? '/'), 'http://localhost').pathname.replace(ROUTE, '') || '/'
            } catch {
              path = '/'
            }

            const method = String(req.method ?? 'GET').toUpperCase()

            if (path === '/state' || path === '/') {
              if (method !== 'GET') return json(405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: '这里只支持 GET。' })
              return json(200, snapshot())
            }

            if (path.startsWith('/member/')) {
              if (method !== 'GET') return json(405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: '内页图只支持 GET。' })
              const rest = decodeURIComponent(path.slice('/member/'.length))
              const slash = rest.lastIndexOf('/')
              const entry = findAny(slash > 0 ? rest.slice(0, slash) : '')
              const idx = Number(rest.slice(slash + 1))
              const member = entry && Array.isArray(entry.members) ? entry.members[idx] : null
              if (member === null || member === undefined || typeof member.cover !== 'string' || member.cover === '') {
                return json(404, { ok: false, code: 'NO_MEMBER_COVER', error: '内页没有这张图' })
              }
              try {
                if (!existsSync(member.cover)) return json(404, { ok: false, code: 'MEMBER_COVER_MISSING', error: member.cover })
                const st2 = statSync(member.cover)
                if (!st2.isFile() || st2.size > MAX_COVER_BYTES) return json(413, { ok: false, code: 'MEMBER_COVER_TOO_BIG', error: '图太大' })
                const type2 = MEDIA[extname(member.cover).toLowerCase()] ?? 'application/octet-stream'
                res.writeHead(200, { 'content-type': type2, 'cache-control': 'public, max-age=3600' })
                res.end(readFileSync(member.cover))
                return undefined
              } catch (e) {
                return json(500, { ok: false, code: 'MEMBER_COVER_READ_FAILED', error: String(e && e.message ? e.message : e) })
              }
            }

            if (path.startsWith('/cover/')) {
              if (method !== 'GET') return json(405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: '封面只支持 GET。' })
              const id = decodeURIComponent(path.slice('/cover/'.length))
              const entry = findEntry(id)
              // 白名单：只发 catalog.js 里写死的 cover，不接受任意路径
              if (entry === null || typeof entry.cover !== 'string' || entry.cover === '') {
                return json(404, { ok: false, code: 'NO_COVER', error: `这条没有封面：${id}` })
              }
              const file = entry.cover
              try {
                if (!existsSync(file)) return json(404, { ok: false, code: 'COVER_MISSING', error: `封面文件不在了：${file}` })
                const stat = statSync(file)
                if (!stat.isFile() || stat.size > MAX_COVER_BYTES) {
                  return json(413, { ok: false, code: 'COVER_TOO_BIG', error: '封面过大或不是文件' })
                }
                const type = MEDIA[extname(file).toLowerCase()] ?? 'application/octet-stream'
                res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=3600' })
                res.end(readFileSync(file))
                return undefined
              } catch (e) {
                return json(500, { ok: false, code: 'COVER_READ_FAILED', error: String(e && e.message ? e.message : e) })
              }
            }

            return json(404, { ok: false, code: 'NOT_FOUND', error: `没有这个路由：${path}` })
          },
        }),
      )
    })
  }
}
