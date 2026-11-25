/**
 * dsh-paper-workbench · 宿主半身
 *
 * AI 接触工作台数据的通道：paper_style 工具读写同一份 catalog（与设计/代码工作台同构）。
 * 浏览器面板读 /paper-workbench/state。面板与工具共享 catalog + 覆盖层。
 * 覆盖层 extra.json 放所有 AI/人的改动（新增/置顶/隐藏/改字段），不动 catalog.js。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ALL_ENTRIES, LAYERS, TAGS, findEntry, layerOf, refOf, specOf } from './catalog.js'

const NAME = 'dsh-paper-workbench'
const ROUTE = '/paper-workbench'

function dshHome() {
  return process.env.DSH_HOME && process.env.DSH_HOME.trim() !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
}

// ── 覆盖层：AI/人 改过的东西都落这里，不动 catalog.js ──────────────────
function extraPath() { return join(dshHome(), 'plugins', NAME, 'extra.json') }
function loadOverlay() {
  const empty = { entries: [], overrides: {} }
  try {
    const raw = JSON.parse(readFileSync(extraPath(), 'utf8'))
    const entries = Array.isArray(raw?.entries) ? raw.entries.filter((e) => e && typeof e.id === 'string') : []
    const overrides = raw?.overrides && typeof raw.overrides === 'object' ? raw.overrides : {}
    return { entries, overrides }
  } catch { return empty }
}
function saveOverlay(overlay) {
  const dir = join(dshHome(), 'plugins', NAME)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(extraPath(), JSON.stringify({ entries: overlay.entries, overrides: overlay.overrides }, null, 2), 'utf8')
}
function applyOverride(entry, overrides) {
  const ov = overrides[entry.id]
  if (!ov || typeof ov !== 'object') return entry
  const merged = { ...entry }
  for (const [k, v] of Object.entries(ov)) {
    if (k === 'hidden' || k === 'pinned' || k === 'order') continue
    merged[k] = v
  }
  if (ov.hidden === true) merged.hidden = true
  if (ov.pinned === true) merged.pinned = true
  if (typeof ov.order === 'number') merged.order = ov.order
  return merged
}
function decorate(e) { return { ...e, prompt: e.prompt || refOf(e), spec: e.spec || specOf(e) } }
/** catalog + 覆盖层合并后的 5 层（默认不含隐藏条目）。 */
function mergedLayers(opts = {}) {
  const overlay = loadOverlay()
  const includeHidden = opts.includeHidden === true
  return LAYERS.map((l) => {
    const builtin = l.entries.map((e) => applyOverride(e, overlay.overrides))
    const added = overlay.entries.filter((e) => e.layer === l.id).map((e) => applyOverride(e, overlay.overrides)).map((e) => ({ ...e, added: true }))
    let list = [...builtin, ...added].filter((e) => includeHidden || e.hidden !== true)
    const orderOf = (e) => (typeof e.order === 'number' && Number.isFinite(e.order) ? e.order : Number.POSITIVE_INFINITY)
    list.sort((a, b) => {
      const pin = Number(b.pinned === true) - Number(a.pinned === true)
      if (pin !== 0) return pin
      return orderOf(a) - orderOf(b)
    })
    return { ...l, entries: list.map(decorate), hiddenCount: [...builtin, ...added].filter((e) => e.hidden === true).length }
  })
}
function allEntries(opts = {}) { return mergedLayers(opts).flatMap((l) => l.entries) }
function findAny(id, opts = {}) {
  const overlay = loadOverlay()
  const base = findEntry(id) ?? overlay.entries.find((e) => e.id === id) ?? null
  if (base === null) return null
  const merged = applyOverride(base, overlay.overrides)
  return opts.includeHidden === true || merged.hidden !== true ? merged : null
}
function validLayer(id) { return LAYERS.some((l) => l.id === id) }
function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9一-龥]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)
}
const FIELD_WHITELIST = ['name', 'oneLine', 'source', 'tags', 'kind', 'bullets', 'howto', 'sources', 'origin', 'layer']
function pickFields(args) {
  const out = {}
  for (const k of FIELD_WHITELIST) if (args[k] !== undefined) out[k] = args[k]
  return out
}
function snapshot() {
  const layers = mergedLayers()
  return {
    ok: true, at: new Date().toISOString(), layers, tags: TAGS,
    counts: layers.map((l) => ({ id: l.id, name: l.name, count: l.entries.length })),
    total: layers.reduce((n, l) => n + l.entries.length, 0),
    channel: 'paper_style op=list / layer / get / search / add / update / remove / pin / unpin / hide / unhide / stats / reorder / import / export',
  }
}
export const name = NAME
export const inject = { tools: { required: true }, webServer: { required: false } }

export function apply(ctx) {
  const OUTPUT = {
    schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean', required: true }, code: { type: 'string' }, error: { type: 'string' }, note: { type: 'string' } } },
    render: (_args, value) => [{ type: 'text', text: typeof value?.note === 'string' ? value.note : JSON.stringify(value, null, 2) }],
  }
  ctx.tools.register(
    defineTool({
      name: 'paper_style',
      description:
        '论文工作台的数据通道：本机论文 skill / MCP / 市面精选工具的资料库，五层\n' +
        '（写作与润色 / 选题与方法论 / 文献与检索 / 图表与实验 / 评审与投稿）。\n' +
        '面板给人挑，这是给 AI 读同一份数据的入口。\n' +
        '读：list / layer / get / search；写：add / update / remove / pin / unpin / hide / unhide；运维：stats / reorder / import / export。\n' +
        '用户说「用论文工作台里那个 XX」「按那个反防御性写作来」时，先 op=search 找 id，要细节再 op=get。',
      parameters: {
        op: { type: 'string', required: true, description: 'list | layer | get | search | add | update | remove | pin | unpin | hide | unhide | stats | reorder | import | export' },
        id: { type: 'string', description: '条目 id（get/写）、层 id（layer：write|idea|lit|figure|review）、或关键词（search）' },
        nature: { type: 'string', description: '只要哪一类：all（默认）/ method / reference。' },
        name: { type: 'string', description: 'add：名称' }, oneLine: { type: 'string', description: 'add：一句话' },
        layer: { type: 'string', description: 'add：层 id' }, source: { type: 'string', description: 'add：出处' },
        tags: { type: 'array', description: 'add/update：标签数组' }, bullets: { type: 'array', description: 'add/update：要点数组' },
        howto: { type: 'string', description: 'add/update：什么时候用' }, sources: { type: 'array', description: 'add/update：原始材料 [{label,url}|{label,path}]' },
        origin: { type: 'string', description: 'add：referenced（别人的）| mine（本机自建）' },
        ids: { type: 'array', description: 'reorder：该层新顺序（id 数组）' }, to: { type: 'string', description: 'reorder 单条：top|bottom|up|down|before:<id>|after:<id>' },
        data: { type: 'object', additionalProperties: true, description: 'import：{entries,overrides} 包；也可用 path 读文件' },
        path: { type: 'string', description: 'import 读文件 / export 写文件（绝对路径）' }, overwrite: { type: 'boolean', description: 'import：已存在是否覆盖（默认跳过）' },
      },
      output: OUTPUT,
      execute: async (args) => {
        const op = String(args.op ?? '').trim()
        const arg = String(args.id ?? '').trim()
        const nature = String(args.nature ?? 'all').trim()
        const keep = (e) => nature === 'all' || nature === '' || e.nature === nature

        // ── 读 ──
        if (op === 'list') {
          return {
            ok: true, count: allEntries().filter(keep).length, nature,
            layers: mergedLayers().map((l) => {
              const kept = l.entries.filter(keep)
              return { id: l.id, name: l.name, hint: l.hint, count: kept.length, totalInLayer: l.entries.length,
                entries: kept.map((e) => ({ id: e.id, name: e.name, oneLine: e.oneLine, origin: e.origin, nature: e.nature ?? 'method', tags: e.tags })) }
            }),
            note: mergedLayers().map((l) => `【${l.name}】${l.entries.length} 条\n` + l.entries.map((e) => `  ${e.id.padEnd(26)} ${e.name} —— ${e.oneLine}`).join('\n')).join('\n\n'),
          }
        }
        if (op === 'layer') {
          const layer = mergedLayers().find((l) => l.id === arg || l.name === arg)
          if (!layer) return { ok: false, code: 'UNKNOWN_LAYER', error: `层只支持：${LAYERS.map((l) => l.id).join(' / ')}`, note: 'op=layer 需要层 id。' }
          const kept = layer.entries.filter(keep)
          return { ok: true, layer: { id: layer.id, name: layer.name, hint: layer.hint, count: kept.length, totalInLayer: layer.entries.length },
            entries: kept, note: `【${layer.name}】${kept.length} 条（nature=${nature}）\n` + kept.map((e) => `  ${e.id.padEnd(26)} ${e.name} —— ${e.oneLine}`).join('\n') }
        }
        if (op === 'get') {
          const entry = findAny(arg)
          if (!entry) return { ok: false, code: 'UNKNOWN_ENTRY', error: `没有这个条目：${arg}`, note: '用 op=list 看全部 id，或 op=search 搜关键词。' }
          const l = layerOf(entry.id)
          return { ok: true, entry: decorate(entry), layer: l ? { id: l.id, name: l.name, hint: l.hint } : null,
            ref: refOf(entry), spec: specOf(entry), members: [], note: specOf(entry) }
        }
        if (op === 'search') {
          if (arg === '') return { ok: false, code: 'EMPTY_QUERY', error: 'op=search 需要关键词', note: '例如 op=search id=统计。' }
          const hits = allEntries().filter(keep).filter((e) => [e.id, e.name, e.oneLine, e.source, ...(e.tags || [])].join(' ').toLowerCase().includes(arg.toLowerCase()))
          return { ok: true, count: hits.length, entries: hits.map((e) => ({ id: e.id, name: e.name, oneLine: e.oneLine, layer: layerOf(e.id)?.name ?? '', origin: e.origin })),
            note: hits.length === 0 ? `没搜到「${arg}」。` : hits.map((e) => `${e.id}  ${e.name} —— ${e.oneLine}`).join('\n') }
        }

        // ── 写 ──
        if (op === 'add') {
          const layer = String(args.layer ?? '').trim()
          if (!validLayer(layer)) return { ok: false, code: 'BAD_LAYER', error: `layer 必须是 ${LAYERS.map((l) => l.id).join(' / ')}` }
          const name = String(args.name ?? '').trim(), oneLine = String(args.oneLine ?? '').trim()
          if (!name || !oneLine) return { ok: false, code: 'MISSING_FIELD', error: 'add 至少要有 name 与 oneLine' }
          const overlay = loadOverlay()
          const id = arg || 'ai-' + slugify(name) + '-' + Math.random().toString(36).slice(2, 6)
          if (findAny(id, { includeHidden: true }) !== null || overlay.entries.some((e) => e.id === id)) return { ok: false, code: 'ID_EXISTS', error: `id 已存在：${id}`, note: '换个 id 或用 op=update。' }
          overlay.entries.push({ id, layer, name, oneLine, source: String(args.source ?? 'AI 录入'), tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
            kind: String(args.kind ?? 'text'), bullets: Array.isArray(args.bullets) ? args.bullets.map(String) : [], howto: String(args.howto ?? ''),
            sources: Array.isArray(args.sources) ? args.sources : [], origin: String(args.origin ?? 'referenced') })
          saveOverlay(overlay)
          return { ok: true, entry: { id, layer, name }, total: allEntries().length, note: `已入库：${id}（${layer}）。工作台现在 ${allEntries().length} 条。` }
        }
        if (op === 'update') {
          if (!arg) return { ok: false, code: 'MISSING_ID', error: 'update 需要 id' }
          if (findAny(arg, { includeHidden: true }) === null) return { ok: false, code: 'NOT_FOUND', error: `没有这条：${arg}` }
          const fields = pickFields(args)
          if (!Object.keys(fields).length) return { ok: false, code: 'NO_FIELD', error: '没给要改的字段', note: `可改：${FIELD_WHITELIST.join(' / ')}` }
          if (fields.layer !== undefined && !validLayer(fields.layer)) return { ok: false, code: 'BAD_LAYER', error: `layer 必须是 ${LAYERS.map((l) => l.id).join(' / ')}` }
          const overlay = loadOverlay()
          if (overlay.entries.some((e) => e.id === arg)) {
            const i = overlay.entries.findIndex((e) => e.id === arg)
            overlay.entries[i] = { ...overlay.entries[i], ...fields }
          } else overlay.overrides[arg] = { ...(overlay.overrides[arg] ?? {}), ...fields }
          saveOverlay(overlay)
          return { ok: true, updated: arg, fields: Object.keys(fields), note: `已更新 ${arg}：${Object.keys(fields).join(', ')}` }
        }
        if (op === 'remove') {
          if (!arg) return { ok: false, code: 'MISSING_ID', error: 'remove 需要 id' }
          if (findAny(arg, { includeHidden: true }) === null) return { ok: false, code: 'NOT_FOUND', error: `没有这条：${arg}` }
          const overlay = loadOverlay()
          if (overlay.entries.some((e) => e.id === arg)) {
            overlay.entries = overlay.entries.filter((e) => e.id !== arg)
            delete overlay.overrides[arg]
            saveOverlay(overlay)
            return { ok: true, removed: arg, mode: 'deleted', total: allEntries().length, note: `已删除 ${arg}。` }
          }
          overlay.overrides[arg] = { ...(overlay.overrides[arg] ?? {}), hidden: true }
          saveOverlay(overlay)
          return { ok: true, removed: arg, mode: 'hidden', total: allEntries().length, note: `内置条目不能删，已隐藏 ${arg}（op=unhide 恢复）。` }
        }
        if (op === 'pin' || op === 'unpin' || op === 'hide' || op === 'unhide') {
          if (!arg) return { ok: false, code: 'MISSING_ID', error: `${op} 需要 id` }
          if (findAny(arg, { includeHidden: true }) === null) return { ok: false, code: 'NOT_FOUND', error: `没有这条：${arg}` }
          const overlay = loadOverlay()
          const key = op === 'pin' || op === 'unpin' ? 'pinned' : 'hidden'
          overlay.overrides[arg] = { ...(overlay.overrides[arg] ?? {}), [key]: op === 'pin' || op === 'hide' }
          saveOverlay(overlay)
          return { ok: true, [key]: overlay.overrides[arg][key], id: arg, note: `${op} ${arg}` }
        }
        if (op === 'stats') {
          const overlay = loadOverlay(), layers = mergedLayers()
          return { ok: true, total: layers.reduce((n, l) => n + l.entries.length, 0),
            byLayer: layers.map((l) => ({ id: l.id, name: l.name, visible: l.entries.length, hidden: l.hiddenCount })),
            added: overlay.entries.length, overridden: Object.keys(overlay.overrides).length,
            pinned: Object.values(overlay.overrides).filter((o) => o && o.pinned === true).length, path: extraPath(),
            note: layers.map((l) => `${l.name}: ${l.entries.length} 条（隐藏 ${l.hiddenCount}）`).join('\n') }
        }
        if (op === 'reorder') {
          const overlay = loadOverlay()
          const ids = Array.isArray(args.ids) ? args.ids.map(String) : null
          const assign = (lid) => { const l = mergedLayers().find((x) => x.id === lid); return l ? l.entries.map((e) => e.id) : null }
          const layerId = String(args.layer ?? '').trim()
          if (ids !== null && layerId !== '') {
            const current = assign(layerId)
            if (current === null) return { ok: false, code: 'BAD_LAYER', error: `没有这一层：${layerId}` }
            const unknown = ids.filter((i) => !current.includes(i))
            if (unknown.length) return { ok: false, code: 'NOT_IN_LAYER', error: `不在 ${layerId}：${unknown.join(', ')}` }
            const final = [...ids, ...current.filter((i) => !ids.includes(i))]
            final.forEach((id, i) => { overlay.overrides[id] = { ...(overlay.overrides[id] ?? {}), order: i } })
            saveOverlay(overlay)
            return { ok: true, layer: layerId, order: final, note: `已重排 ${layerId}（${final.length} 条）` }
          }
          const to = String(args.to ?? '').trim()
          if (!arg || !to) return { ok: false, code: 'MISSING_FIELD', error: 'reorder 需要 {layer,ids} 或 {id,to}' }
          const found = findAny(arg, { includeHidden: true })
          if (found === null) return { ok: false, code: 'NOT_FOUND', error: `没有这条：${arg}` }
          const owner = found.layer ?? (LAYERS.find((l) => l.entries.some((e) => e.id === arg))?.id ?? '')
          const current = assign(owner)
          if (current === null) return { ok: false, code: 'BAD_LAYER', error: `层 id 不合法：${owner}` }
          const idx = current.indexOf(arg)
          let next = idx
          if (to === 'top') next = 0
          else if (to === 'bottom') next = current.length - 1
          else if (to === 'up') next = Math.max(0, idx - 1)
          else if (to === 'down') next = Math.min(current.length - 1, idx + 1)
          else if (to.startsWith('before:') || to.startsWith('after:')) {
            const anchor = to.slice(to.indexOf(':') + 1)
            const without = current.filter((i) => i !== arg)
            const at = without.indexOf(anchor)
            if (at < 0) return { ok: false, code: 'ANCHOR_NOT_FOUND', error: `锚点不在同层：${anchor}` }
            next = to.startsWith('before:') ? at : at + 1
          } else return { ok: false, code: 'BAD_TO', error: 'to 只支持 top/bottom/up/down/before:<id>/after:<id>' }
          const without = current.filter((i) => i !== arg)
          const final = [...without.slice(0, next), arg, ...without.slice(next)]
          final.forEach((id, i) => { overlay.overrides[id] = { ...(overlay.overrides[id] ?? {}), order: i } })
          saveOverlay(overlay)
          return { ok: true, moved: arg, to, note: `已把 ${arg} 移到 ${to}` }
        }
        if (op === 'import') {
          let bundle = args.data
          const path = String(args.path ?? '').trim()
          if ((bundle === undefined || bundle === null) && path !== '') {
            if (!existsSync(path)) return { ok: false, code: 'FILE_NOT_FOUND', error: `文件不存在：${path}` }
            try { bundle = JSON.parse(readFileSync(path, 'utf8')) } catch (e) { return { ok: false, code: 'BAD_JSON', error: String(e && e.message ? e.message : e) } }
          }
          if (!bundle || typeof bundle !== 'object') return { ok: false, code: 'NO_DATA', error: 'import 需要 data={entries,overrides} 或 path=<json>' }
          const overwrite = args.overwrite === true
          const inEntries = Array.isArray(bundle.entries) ? bundle.entries : []
          const inOverrides = bundle.overrides && typeof bundle.overrides === 'object' ? bundle.overrides : {}
          const overlay = loadOverlay()
          const existing = new Set(overlay.entries.map((e) => e.id))
          const builtin = new Set(LAYERS.flatMap((l) => l.entries.map((e) => e.id)))
          let added = 0, skipped = 0
          for (const e of inEntries) {
            if (!e || typeof e.id !== 'string' || typeof e.layer !== 'string' || !validLayer(e.layer)) { skipped++; continue }
            if (existing.has(e.id) || builtin.has(e.id)) {
              if (!overwrite) { skipped++; continue }
              const i = overlay.entries.findIndex((x) => x.id === e.id)
              if (i >= 0) overlay.entries[i] = e
              else overlay.overrides[e.id] = { ...(overlay.overrides[e.id] ?? {}), ...e }
            } else { overlay.entries.push(e); existing.add(e.id) }
            added++
          }
          let ovApplied = 0
          for (const [id, ov] of Object.entries(inOverrides)) {
            if (!ov || typeof ov !== 'object') continue
            overlay.overrides[id] = overwrite ? ov : { ...ov, ...(overlay.overrides[id] ?? {}) }
            ovApplied++
          }
          saveOverlay(overlay)
          return { ok: true, added, skipped, overrides: ovApplied, total: allEntries().length,
            note: `导入完成：新增 ${added}，跳过 ${skipped}，覆盖 ${ovApplied} 条 overrides。` }
        }
        if (op === 'export') {
          const overlay = loadOverlay(), bundle = { entries: overlay.entries, overrides: overlay.overrides }
          const outPath = String(args.path ?? '').trim()
          if (outPath !== '') {
            try {
              const dir = join(outPath, '..')
              if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
              writeFileSync(outPath, JSON.stringify(bundle, null, 2), 'utf8')
              return { ok: true, export: bundle, path: outPath, note: `已导出到 ${outPath}（${bundle.entries.length} 条新增 / ${Object.keys(bundle.overrides).length} 条 overrides）` }
            } catch (e) { return { ok: false, code: 'WRITE_FAILED', error: String(e && e.message ? e.message : e) } }
          }
          return { ok: true, export: bundle, note: JSON.stringify(bundle, null, 2) }
        }

        return { ok: false, code: 'UNKNOWN_OP', error: `op 只支持 list/layer/get/search/add/update/remove/pin/unpin/hide/unhide/stats/reorder/import/export，收到：${op}` }
      },
    })
  )

  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (webCtx) => {
      webCtx.effect(() =>
        webCtx.webServer.register({
          kind: 'prefix', path: ROUTE,
          handler: async (req, res) => {
            const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
            let path = '/'
            try { path = new URL(String(req.url ?? '/'), 'http://localhost').pathname.replace(ROUTE, '') || '/' } catch { path = '/' }
            if (path === '/state' || path === '/') return json(200, snapshot())
            return json(404, { ok: false, code: 'NOT_FOUND', error: `没有这个路由：${path}` })
          },
        })
      )
    })
  }
}
