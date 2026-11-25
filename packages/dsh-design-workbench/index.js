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
import { coverPath, coverUrlsOf, coversDir, fetchCover, warmCovers } from './covers.js'

const NAME = 'dsh-design-workbench'
const ROUTE = '/design-workbench'
const MAX_COVER_BYTES = 12 * 1024 * 1024

function dshHome() {
  return process.env.DSH_HOME && process.env.DSH_HOME.trim() !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
}

/** 封面路由用的两个小工具（之前 cover 路由调用了却没定义，导致每次请求 ReferenceError → HTTP 400 裂图）。 */
function isFile(file) {
  if (typeof file !== 'string' || file === '') return false
  try {
    return existsSync(file) && statSync(file).isFile()
  } catch {
    return false
  }
}

/** 给定云端 URL，返回它已下载好的本地缓存路径（没有就 null）。 */
function cachedCover(url) {
  if (typeof url !== 'string' || url === '') return null
  try {
    const candidate = coverPath(coversDir(NAME), url)
    return isFile(candidate) ? candidate : null
  } catch {
    return null
  }
}

const MEDIA = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
}

// ── 覆盖层：AI/人 改过的东西都落这里，不动 catalog.js ──────────────────
//
// extra.json = {
//   entries:   [ {id, layer, name, oneLine, ...} ],   // 新增的（扫描导入或 AI 自己写的）
//   overrides: { <id>: { hidden, pinned, ...要覆盖的字段 } }  // 对任意条目（含内置）的修改
// }
//
// 这样「写」有一个统一入口：AI 通过 design_style 的 add/update/pin/hide 改，
// 结果同时作用于面板与工具，且随时能 export 出来带走。

function extraPath() {
  return join(dshHome(), 'plugins', NAME, 'extra.json')
}

function loadOverlay() {
  const empty = { entries: [], overrides: {} }
  try {
    const raw = JSON.parse(readFileSync(extraPath(), 'utf8'))
    const entries = Array.isArray(raw?.entries) ? raw.entries.filter((e) => e && typeof e.id === 'string') : []
    const overrides = raw?.overrides && typeof raw.overrides === 'object' ? raw.overrides : {}
    return { entries, overrides }
  } catch {
    return empty
  }
}

function saveOverlay(overlay) {
  const dir = join(dshHome(), 'plugins', NAME)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(extraPath(), JSON.stringify({ entries: overlay.entries, overrides: overlay.overrides }, null, 2), 'utf8')
}

/** 兼容旧调用：只取新增条目 */
function loadExtra() {
  return loadOverlay().entries
}

/** 兼容旧调用（design_scan 的入库走这里）：只改 entries，保留 overrides。 */
function saveExtra(entries) {
  const overlay = loadOverlay()
  overlay.entries = entries
  saveOverlay(overlay)
}

/** 对一条应用 overrides（隐藏/置顶/字段覆盖）。 */
function applyOverride(entry, overrides) {
  const ov = overrides[entry.id]
  if (!ov || typeof ov !== 'object') return entry
  const merged = { ...entry }
  for (const [k, v] of Object.entries(ov)) {
    if (k === 'hidden' || k === 'pinned') continue
    merged[k] = v
  }
  if (ov.hidden === true) merged.hidden = true
  if (ov.pinned === true) merged.pinned = true
  return merged
}

/** 给条目补上 nature（style / method / reference），面板与工具都靠它筛。 */
function withNature(e) {
  const r = classifyEntry(e)
  return { ...e, nature: r.nature, natureScore: r.score }
}

/**
 * catalog + 覆盖层合并后的四类。
 * @param opts { includeHidden }  默认不含隐藏条目
 */
function mergedLayers(opts = {}) {
  const overlay = loadOverlay()
  const includeHidden = opts.includeHidden === true
  return LAYERS.map((l) => {
    const builtin = l.entries.map((e) => applyOverride(e, overlay.overrides))
    const added = overlay.entries
      .filter((e) => e.layer === l.id)
      .map((e) => applyOverride(e, overlay.overrides))
      .map((e) => ({ ...e, added: true }))
    let list = [...builtin, ...added].map(withNature)
    if (!includeHidden) list = list.filter((e) => e.hidden !== true)
    // 排序：置顶 → 显式 order → 原顺序（Array.sort 稳定，未设 order 的不会被搅乱）
    const orderOf = (e) => {
      const ov = overlay.overrides[e.id]
      return ov && typeof ov.order === 'number' && Number.isFinite(ov.order) ? ov.order : Number.POSITIVE_INFINITY
    }
    list.sort((a, b) => {
      const pin = Number(b.pinned === true) - Number(a.pinned === true)
      if (pin !== 0) return pin
      return orderOf(a) - orderOf(b)
    })
    return {
      ...l,
      entries: list.map((e) => ({ ...e, prompt: refOf(e), spec: specOf(e) })),
      hiddenCount: [...builtin, ...added].filter((e) => e.hidden === true).length,
    }
  })
}

function allEntries(opts = {}) {
  return mergedLayers(opts).flatMap((l) => l.entries)
}

function findAny(id, opts = {}) {
  const overlay = loadOverlay()
  const builtin = findEntry(id)
  const extra = overlay.entries.find((e) => e.id === id)
  const base = builtin ?? extra ?? null
  if (base === null) return null
  const merged = applyOverride(base, overlay.overrides)
  return opts.includeHidden === true || merged.hidden !== true ? merged : null
}

function layerOfAny(id) {
  const entry = findAny(id, { includeHidden: true })
  if (entry === null) return null
  return LAYERS.find((l) => l.id === entry.layer) ?? null
}

const FIELD_WHITELIST = ['name', 'oneLine', 'source', 'tags', 'kind', 'swatch', 'bullets', 'howto', 'sources', 'origin', 'layer']

/** 校验并挑出可写字段 */
function pickFields(args) {
  const out = {}
  for (const k of FIELD_WHITELIST) {
    if (args[k] !== undefined) out[k] = args[k]
  }
  return out
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
}

function validLayer(id) {
  return LAYERS.some((l) => l.id === id)
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
  // 启动后台预热：把 catalog 里的云端封面（主封面 coverUrl + 内页 raw）拉到本地缓存。
  // 异步进行，不阻塞插件加载；面板首次请求若还没下完，/cover、/member 路由会按需补拉。
  try {
    const w = warmCovers(ALL_ENTRIES, NAME)
    if (w.count > 0) process.stderr.write(`[design-workbench] 封面缓存预热：${w.count} 张 → ${w.dir}\n`)
  } catch (e) {
    process.stderr.write(`[design-workbench] 封面缓存预热未启动：${e?.message ?? e}\n`)
  }

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
        '设计工作台的数据通道：**用户本机的设计资料库，分六层（App 设计 / 前端设计 / 视频风格 / 代码生视频 / 漫画 / 动效设计）**。\n' +
        '工作台面板是给人看的；这是给 AI 读同一份数据的入口。\n' +
        'op=list 六层全列（id / 名称 / 一句话 / 出处）；op=layer {id} 只看一层（app | frontend | video | codevideo | comic | motion）；' +
        'op=get {id} 取完整规格（颜色/圆角/投影/CSS/要点/怎么用，几百字）；op=search {id: 关键词} 按名称/标签/出处搜。\n' +
        '用户说「用工作台里那个水墨的」「按那个紧凑仪表盘做」时，先用 op=search 或 op=list 找到 id，再 op=get 拿规格。',
      parameters: {
        op: { type: 'string', required: true, description: '读：list | layer | get | search；写：add | update | remove | pin | unpin | hide | unhide；运维：stats | export | import | reorder' },
        id: { type: 'string', description: '条目 id（get）、层 id（layer：app|frontend|video|codevideo|comic|motion）、或关键词（search）' },
        nature: { type: 'string', description: '只要哪一类：style（风格，默认）/ all（含方法与素材）/ method / reference' },
        member: { type: 'number', description: 'op=get 时取内页第几种（1 起）；不给就是整个库' },
        // 写操作（add / update）
        layer: { type: 'string', description: 'op=add 时必填：app | frontend | video | codevideo | comic | motion' },
        name: { type: 'string', description: 'op=add 时必填：名称' },
        oneLine: { type: 'string', description: 'op=add 时必填：一句话它替你做什么' },
        source: { type: 'string', description: '出处：谁做的、什么形态' },
        tags: { type: 'array', description: 'op=add/update：标签数组', items: { type: 'string' } },
        bullets: { type: 'array', description: 'op=add/update：要点数组（3–5 条，写具体做法）', items: { type: 'string' } },
        howto: { type: 'string', description: 'op=add/update：什么时候用它' },
        sources: { type: 'array', description: 'op=add/update：原始材料 [{label,url}|{label,path}]' },
        origin: { type: 'string', description: 'op=add：referenced（别人的）| mine（本机自建）' },
        ids: { type: 'array', description: 'op=reorder：该层的新顺序（id 数组）', items: { type: 'string' } },
        to: { type: 'string', description: 'op=reorder 单条移动：top | bottom | up | down | before:<id> | after:<id>' },
        data: { type: 'object', additionalProperties: true, description: 'op=import：{ entries, overrides } 包；也可用 path 读文件' },
        path: { type: 'string', description: 'op=import 读文件 / op=export 写文件（绝对路径）' },
        overwrite: { type: 'boolean', description: 'op=import：已存在的条目是否覆盖（默认跳过）' },
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

        // ── 写操作：AI 自己的操作口 ──────────────────────────────────
        if (op === 'add') {
          const layer = String(args.layer ?? '').trim()
          if (!validLayer(layer)) {
            return { ok: false, code: 'BAD_LAYER', error: `layer 必须是 ${LAYERS.map((l) => l.id).join(' / ')}`, note: 'op=add 需要 layer=dev|web|data|cli' }
          }
          const name = String(args.name ?? '').trim()
          const oneLine = String(args.oneLine ?? '').trim()
          if (name === '' || oneLine === '') return { ok: false, code: 'MISSING_FIELD', error: 'add 至少要有 name 与 oneLine', note: '给 name + oneLine。' }
          const overlay = loadOverlay()
          const id = String(args.id ?? '').trim() || 'ai-' + slugify(name) + '-' + Math.random().toString(36).slice(2, 6)
          if (findAny(id, { includeHidden: true }) !== null || overlay.entries.some((e) => e.id === id)) {
            return { ok: false, code: 'ID_EXISTS', error: `id 已存在：${id}`, note: '换个 id，或用 op=update 改现有的。' }
          }
          const entry = {
            id,
            layer,
            name,
            oneLine,
            source: String(args.source ?? 'AI 录入'),
            tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
            kind: String(args.kind ?? 'text'),
            bullets: Array.isArray(args.bullets) ? args.bullets.map(String) : [],
            howto: String(args.howto ?? ''),
            sources: Array.isArray(args.sources) ? args.sources : [],
            origin: String(args.origin ?? 'referenced'),
          }
          if (args.swatch !== undefined) entry.swatch = args.swatch
          overlay.entries.push(entry)
          saveOverlay(overlay)
          return { ok: true, entry: { id, layer, name }, total: allEntries().length, note: `已入库：${id}（${layer}）\n工作台现在 ${allEntries().length} 条。` }
        }

        if (op === 'update') {
          const id = String(args.id ?? '').trim()
          if (id === '') return { ok: false, code: 'MISSING_ID', error: 'update 需要 id' }
          const target = findAny(id, { includeHidden: true })
          if (target === null) return { ok: false, code: 'NOT_FOUND', error: `没有这条：${id}` }
          const fields = pickFields(args)
          if (Object.keys(fields).length === 0) return { ok: false, code: 'NO_FIELD', error: '没给要改的字段', note: `可改：${FIELD_WHITELIST.join(' / ')}` }
          if (fields.layer !== undefined && !validLayer(fields.layer)) return { ok: false, code: 'BAD_LAYER', error: `layer 必须是 ${LAYERS.map((l) => l.id).join(' / ')}` }
          const overlay = loadOverlay()
          const isExtra = overlay.entries.some((e) => e.id === id)
          if (isExtra) {
            const i = overlay.entries.findIndex((e) => e.id === id)
            overlay.entries[i] = { ...overlay.entries[i], ...fields }
          } else {
            overlay.overrides[id] = { ...(overlay.overrides[id] ?? {}), ...fields }
          }
          saveOverlay(overlay)
          return { ok: true, updated: id, fields: Object.keys(fields), note: `已更新 ${id}：${Object.keys(fields).join(', ')}` }
        }

        if (op === 'remove') {
          const id = String(args.id ?? '').trim()
          if (id === '') return { ok: false, code: 'MISSING_ID', error: 'remove 需要 id' }
          const target = findAny(id, { includeHidden: true })
          if (target === null) return { ok: false, code: 'NOT_FOUND', error: `没有这条：${id}` }
          const overlay = loadOverlay()
          const isExtra = overlay.entries.some((e) => e.id === id)
          if (isExtra) {
            overlay.entries = overlay.entries.filter((e) => e.id !== id)
            delete overlay.overrides[id]
            saveOverlay(overlay)
            return { ok: true, removed: id, mode: 'deleted', total: allEntries().length, note: `已从覆盖层删除 ${id}。` }
          }
          overlay.overrides[id] = { ...(overlay.overrides[id] ?? {}), hidden: true }
          saveOverlay(overlay)
          return { ok: true, removed: id, mode: 'hidden', total: allEntries().length, note: `内置条目不能删，已隐藏 ${id}（op=unhide 可恢复）。` }
        }

        if (op === 'pin' || op === 'unpin') {
          const id = String(args.id ?? '').trim()
          if (id === '') return { ok: false, code: 'MISSING_ID', error: `${op} 需要 id` }
          if (findAny(id, { includeHidden: true }) === null) return { ok: false, code: 'NOT_FOUND', error: `没有这条：${id}` }
          const overlay = loadOverlay()
          overlay.overrides[id] = { ...(overlay.overrides[id] ?? {}), pinned: op === 'pin' }
          saveOverlay(overlay)
          return { ok: true, [op === 'pin' ? 'pinned' : 'unpinned']: id, note: op === 'pin' ? `已置顶 ${id}` : `已取消置顶 ${id}` }
        }

        if (op === 'hide' || op === 'unhide') {
          const id = String(args.id ?? '').trim()
          if (id === '') return { ok: false, code: 'MISSING_ID', error: `${op} 需要 id` }
          if (findAny(id, { includeHidden: true }) === null) return { ok: false, code: 'NOT_FOUND', error: `没有这条：${id}` }
          const overlay = loadOverlay()
          overlay.overrides[id] = { ...(overlay.overrides[id] ?? {}), hidden: op === 'hide' }
          saveOverlay(overlay)
          return { ok: true, [op === 'hide' ? 'hidden' : 'shown']: id, note: op === 'hide' ? `已隐藏 ${id}` : `已恢复 ${id}` }
        }

        if (op === 'stats') {
          const overlay = loadOverlay()
          const layers = mergedLayers()
          return {
            ok: true,
            total: layers.reduce((n, l) => n + l.entries.length, 0),
            byLayer: layers.map((l) => ({ id: l.id, name: l.name, visible: l.entries.length, hidden: l.hiddenCount })),
            added: overlay.entries.length,
            overridden: Object.keys(overlay.overrides).length,
            pinned: Object.values(overlay.overrides).filter((o) => o && o.pinned === true).length,
            path: extraPath(),
            note: layers.map((l) => `${l.name}: ${l.entries.length} 条（隐藏 ${l.hiddenCount}）`).join('\n') + `\n新增 ${overlay.entries.length} / 改过 ${Object.keys(overlay.overrides).length} / 置顶 ${Object.values(overlay.overrides).filter((o) => o && o.pinned === true).length}`,
          }
        }

        if (op === 'reorder') {
          // 两种用法：
          //   A) { layer, ids: [a,b,c] }   → 按给定顺序重排该层
          //   B) { id, to: 'top'|'bottom'|'up'|'down'|'before:<id>'|'after:<id>' }
          const overlay = loadOverlay()
          const layerId = String(args.layer ?? '').trim()
          const ids = Array.isArray(args.ids) ? args.ids.map(String) : null

          // 用「已应用 overrides 的合并结果」作为基准，否则会忽略上一次的 order
          const assign = (targetLayer) => {
            const layer = mergedLayers().find((l) => l.id === targetLayer)
            if (!layer) return null
            return layer.entries.map((e) => e.id)
          }

          if (ids !== null && layerId !== '') {
            const current = assign(layerId)
            if (current === null) return { ok: false, code: 'BAD_LAYER', error: `没有这一层：${layerId}` }
            const unknown = ids.filter((i) => !current.includes(i))
            if (unknown.length > 0) return { ok: false, code: 'NOT_IN_LAYER', error: `这些 id 不在 ${layerId}：${unknown.join(', ')}` }
            // 未列出的排在后面，保持它们原来的相对顺序
            const rest = current.filter((i) => !ids.includes(i))
            const finalOrder = [...ids, ...rest]
            finalOrder.forEach((id, i) => {
              overlay.overrides[id] = { ...(overlay.overrides[id] ?? {}), order: i }
            })
            saveOverlay(overlay)
            return { ok: true, layer: layerId, order: finalOrder, note: `已重排 ${layerId}（${finalOrder.length} 条）：${finalOrder.slice(0, 5).join(' → ')}…` }
          }

          const id = String(args.id ?? '').trim()
          const to = String(args.to ?? '').trim()
          if (id === '' || to === '') return { ok: false, code: 'MISSING_FIELD', error: 'reorder 需要 {layer,ids} 或 {id,to}' }
          const entry = findAny(id, { includeHidden: true })
          if (entry === null) return { ok: false, code: 'NOT_FOUND', error: `没有这条：${id}` }
          // 条目不一定会带 layer 字段（设计工作台就是靠 LAYERS 分组），兜底用 layerOfAny
          const ownerLayer = entry.layer ?? (LAYERS.find((l) => l.entries.some((e) => e.id === id))?.id ?? '')
          const current = assign(ownerLayer)
          if (current === null) return { ok: false, code: 'BAD_LAYER', error: `这一层的 id 不合法：${ownerLayer || '(未知)'}` }
          const idx = current.indexOf(id)
          let next = idx
          if (to === 'top') next = 0
          else if (to === 'bottom') next = current.length - 1
          else if (to === 'up') next = Math.max(0, idx - 1)
          else if (to === 'down') next = Math.min(current.length - 1, idx + 1)
          else if (to.startsWith('before:') || to.startsWith('after:')) {
            const isBefore = to.startsWith('before:')
            const anchorId = to.slice(to.indexOf(':') + 1)
            const at = current.indexOf(anchorId)
            if (at < 0) return { ok: false, code: 'ANCHOR_NOT_FOUND', error: `锚点不在同一层：${anchorId}` }
            const without = current.filter((i) => i !== id)
            const at2 = without.indexOf(anchorId)
            next = isBefore ? at2 : at2 + 1
            const finalOrder = [...without.slice(0, next), id, ...without.slice(next)]
            finalOrder.forEach((i, n) => {
              overlay.overrides[i] = { ...(overlay.overrides[i] ?? {}), order: n }
            })
            saveOverlay(overlay)
            return { ok: true, moved: id, to, order: finalOrder, note: `已把 ${id} 移到 ${to}` }
          } else {
            return { ok: false, code: 'BAD_TO', error: "to 只支持 top / bottom / up / down / before:<id> / after:<id>" }
          }
          const without = current.filter((i) => i !== id)
          const finalOrder = [...without.slice(0, next), id, ...without.slice(next)]
          finalOrder.forEach((i, n) => {
            overlay.overrides[i] = { ...(overlay.overrides[i] ?? {}), order: n }
          })
          saveOverlay(overlay)
          return { ok: true, moved: id, to, note: `已把 ${id} 移到 ${to}` }
        }

        if (op === 'import') {
          // 把 export 出来的包灌回来：{ entries, overrides }
          // 也可以给 path 直接读文件。
          let bundle = args.data
          const path = String(args.path ?? '').trim()
          if ((bundle === undefined || bundle === null) && path !== '') {
            if (!existsSync(path)) return { ok: false, code: 'FILE_NOT_FOUND', error: `文件不存在：${path}` }
            try {
              bundle = JSON.parse(readFileSync(path, 'utf8'))
            } catch (e) {
              return { ok: false, code: 'BAD_JSON', error: String(e && e.message ? e.message : e) }
            }
          }
          if (bundle === null || typeof bundle !== 'object') {
            return { ok: false, code: 'NO_DATA', error: 'import 需要 data={entries,overrides} 或 path=<json>' }
          }
          const overwrite = args.overwrite === true
          const inEntries = Array.isArray(bundle.entries) ? bundle.entries : []
          const inOverrides = bundle.overrides && typeof bundle.overrides === 'object' ? bundle.overrides : {}
          const overlay = loadOverlay()
          const existing = new Set(overlay.entries.map((e) => e.id))
          const builtin = new Set(LAYERS.flatMap((l) => l.entries.map((e) => e.id)))
          let added = 0
          let skipped = 0
          for (const e of inEntries) {
            if (!e || typeof e.id !== 'string' || typeof e.layer !== 'string') { skipped++; continue }
            if (!validLayer(e.layer)) { skipped++; continue }
            if (existing.has(e.id) || builtin.has(e.id)) {
              if (!overwrite) { skipped++; continue }
              const i = overlay.entries.findIndex((x) => x.id === e.id)
              if (i >= 0) overlay.entries[i] = e
              else overlay.overrides[e.id] = { ...(overlay.overrides[e.id] ?? {}), ...e }
              added++
              continue
            }
            overlay.entries.push(e)
            existing.add(e.id)
            added++
          }
          let ovApplied = 0
          for (const [id, ov] of Object.entries(inOverrides)) {
            if (!ov || typeof ov !== 'object') continue
            overlay.overrides[id] = overwrite ? ov : { ...ov, ...(overlay.overrides[id] ?? {}) }
            ovApplied++
          }
          saveOverlay(overlay)
          return {
            ok: true,
            added,
            skipped,
            overrides: ovApplied,
            total: allEntries().length,
            note: `导入完成：新增 ${added} 条，跳过 ${skipped} 条（已存在或字段不全），覆盖 ${ovApplied} 条 overrides。工作台现在 ${allEntries().length} 条。`,
          }
        }

        if (op === 'export') {
          const overlay = loadOverlay()
          const bundle = { entries: overlay.entries, overrides: overlay.overrides }
          const outPath = String(args.path ?? '').trim()
          if (outPath !== '') {
            try {
              mkdirSync(join(outPath, '..'), { recursive: true })
              writeFileSync(outPath, JSON.stringify(bundle, null, 2), 'utf8')
              return { ok: true, export: bundle, path: outPath, note: `已导出到 ${outPath}（${bundle.entries.length} 条新增 / ${Object.keys(bundle.overrides).length} 条 overrides）` }
            } catch (e) {
              return { ok: false, code: 'WRITE_FAILED', error: String(e && e.message ? e.message : e) }
            }
          }
          return { ok: true, export: bundle, note: JSON.stringify(bundle, null, 2) }
        }

        return { ok: false, code: 'UNKNOWN_OP', error: `op 只支持 list / layer / get / search / add / update / remove / pin / unpin / hide / unhide / stats / export，收到：${op}`, note: '读：list / layer / get / search；写：add / update / remove / pin / unpin / hide / unhide；运维：stats / export。' }
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
              if (member === null || member === undefined) {
                return json(404, { ok: false, code: 'NO_MEMBER_COVER', error: '内页没有这张图' })
              }
              // 本地副本优先（可能是原作者的 D 盘路径，已失效）；失效则用 raw 云端 URL 的本地缓存。
              let file = isFile(member.cover) ? member.cover : null
              if (file === null && typeof member.raw === 'string' && /^https?:\/\//i.test(member.raw)) {
                file = cachedCover(member.raw) ?? (await fetchCover(member.raw, coversDir(NAME)))
              }
              if (file === null) return json(404, { ok: false, code: 'MEMBER_COVER_MISSING', error: '本地缓存和云端都没有这张内页图' })
              try {
                const st2 = statSync(file)
                if (!st2.isFile() || st2.size > MAX_COVER_BYTES) return json(413, { ok: false, code: 'MEMBER_COVER_TOO_BIG', error: '图太大' })
                const type2 = MEDIA[extname(file).toLowerCase()] ?? 'application/octet-stream'
                res.writeHead(200, { 'content-type': type2, 'cache-control': 'public, max-age=3600' })
                res.end(readFileSync(file))
                return undefined
              } catch (e) {
                return json(500, { ok: false, code: 'MEMBER_COVER_READ_FAILED', error: String(e && e.message ? e.message : e) })
              }
            }

            if (path.startsWith('/cover/')) {
              if (method !== 'GET') return json(405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: '封面只支持 GET。' })
              const id = decodeURIComponent(path.slice('/cover/'.length))
              const entry = findEntry(id)
              if (entry === null) return json(404, { ok: false, code: 'NO_COVER', error: `这条没有封面：${id}` })
              // 本地副本优先；失效则用 coverUrlsOf 推导的云端 URL（含漫画层从 cloud 推出的 poster）的本地缓存，按需补拉。
              let file = isFile(entry.cover) ? entry.cover : null
              if (file === null) {
                for (const url of coverUrlsOf(entry)) {
                  file = cachedCover(url) ?? (await fetchCover(url, coversDir(NAME)))
                  if (file !== null) break
                }
              }
              if (file === null) return json(404, { ok: false, code: 'COVER_MISSING', error: '本地缓存和云端都没有这张封面' })
              try {
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
