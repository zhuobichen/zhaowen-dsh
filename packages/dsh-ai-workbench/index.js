/**
 * dsh-ai-workbench · 宿主半身（AI 通道）
 *
 * 面板给人看，ai_style 工具给 AI 读同一份 catalog。
 * 覆盖层 extra.json 写 AI/人的改动（新增/置顶/隐藏/改字段），不动 catalog.js。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'

import { ALL_ENTRIES, SECTIONS, TAGS, findEntry, refOf, specOf } from './catalog.js'

const NAME = 'dsh-ai-workbench'
const ROUTE = '/ai-workbench'

function dshHome() {
  return process.env.DSH_HOME && process.env.DSH_HOME.trim() !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
}

function extraPath() {
  return join(dshHome(), 'plugins', NAME, 'extra.json')
}

function loadOverlay() {
  const empty = { entries: [], overrides: {} }
  try {
    const raw = JSON.parse(readFileSync(extraPath(), 'utf8'))
    return {
      entries: Array.isArray(raw?.entries) ? raw.entries.filter((e) => e && typeof e.id === 'string') : [],
      overrides: raw?.overrides && typeof raw.overrides === 'object' ? raw.overrides : {},
    }
  } catch {
    return empty
  }
}

function saveOverlay(overlay) {
  const dir = join(dshHome(), 'plugins', NAME)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(extraPath(), JSON.stringify(overlay, null, 2), 'utf8')
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
  return merged
}

function mergedSections(opts = {}) {
  const overlay = loadOverlay()
  const includeHidden = opts.includeHidden === true
  const build = (l) => {
    const builtin = l.entries.map((e) => applyOverride(e, overlay.overrides))
    const added = overlay.entries.filter((e) => e.layer === l.id).map((e) => applyOverride(e, overlay.overrides)).map((e) => ({ ...e, added: true }))
    let list = [...builtin, ...added]
    if (!includeHidden) list = list.filter((e) => e.hidden !== true)
    const orderOf = (e) => {
      const ov = overlay.overrides[e.id]
      return ov && typeof ov.order === 'number' && Number.isFinite(ov.order) ? ov.order : Number.POSITIVE_INFINITY
    }
    list.sort((a, b) => {
      const pin = Number(b.pinned === true) - Number(a.pinned === true)
      if (pin !== 0) return pin
      return orderOf(a) - orderOf(b)
    })
    return { ...l, entries: list }
  }
  return SECTIONS.map((s) => ({ ...s, layers: s.layers.map(build), hiddenCount: s.layers.reduce((n, l) => n + l.entries.filter((e) => e.hidden === true).length, 0) }))
}

function allEntries() {
  return mergedSections().flatMap((s) => s.layers.flatMap((l) => l.entries))
}

function findAny(id, opts = {}) {
  const overlay = loadOverlay()
  const base = findEntry(id) ?? overlay.entries.find((e) => e.id === id) ?? null
  if (base === null) return null
  const merged = applyOverride(base, overlay.overrides)
  return opts.includeHidden === true || merged.hidden !== true ? merged : null
}

function snapshot() {
  const sections = mergedSections()
  const entries = sections.flatMap((s) => s.layers.flatMap((l) => l.entries))
  return {
    ok: true,
    at: new Date().toISOString(),
    sections,
    tags: TAGS,
    counts: sections.map((s) => ({ id: s.id, name: s.name, count: s.layers.reduce((n, l) => n + l.entries.length, 0) })),
    total: entries.length,
    channel: 'ai_style op=list / op=section / op=layer / op=get / op=search',
  }
}

export const name = NAME
export const inject = { tools: { required: true }, webServer: { required: false } }

const OUTPUT = {
  schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' }, note: { type: 'string' } } },
  render: (_args, value) => [{ type: 'text', text: typeof value?.note === 'string' ? value.note : JSON.stringify(value, null, 2) }],
}

export function apply(ctx) {
  const FIELD_WHITELIST = ['name', 'oneLine', 'source', 'tags', 'kind', 'swatch', 'bullets', 'howto', 'sources', 'origin', 'layer', 'section']
  const validLayer = (id) => SECTIONS.some((s) => s.layers.some((l) => l.id === id))

  ctx.tools.register(
    defineTool({
      name: 'ai_style',
      description:
        'AI 工作台的数据通道：**用户本机的 AI 资料库，嵌套结构**——顶层是 AI 工作台，里面细分小工作台（目前有 Agent 设计工作台）。\n' +
        'op=list 列全部小工作台/分类/条目；op=section {id} 看某个小工作台；op=layer {id} 看某分类；' +
        'op=get {id} 取完整规格；op=search {id:关键词} 按名称/标签/出处搜。\n' +
        '写：add / update / remove / pin / unpin / hide / unhide / reorder；运维：stats / export / import。\n' +
        '用户说「用那个 superpowers」「按 Anthropic 的模式来」「看工作台里的 Agent 设计」时先用 search/list 找 id，再 get。',
      parameters: {
        op: { type: 'string', required: true, description: 'list | section | layer | get | search | add | update | remove | pin | unpin | hide | unhide | reorder | stats | export | import' },
        id: { type: 'string', description: '条目 id / 小工作台 id / 分类 id / 关键词' },
        name: { type: 'string', description: 'op=add 必填：名称' },
        oneLine: { type: 'string', description: 'op=add 必填：一句话' },
        section: { type: 'string', description: 'op=add 时所属小工作台，默认 agent' },
        layer: { type: 'string', description: 'op=add 时所属分类' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签数组' },
        bullets: { type: 'array', items: { type: 'string' }, description: '要点数组' },
        howto: { type: 'string', description: '什么时候用' },
        sources: { type: 'array', items: { type: 'object', additionalProperties: true }, description: '原始材料 [{label,url}|{label,path}]' },
        data: { type: 'object', additionalProperties: true, description: 'op=import：{entries,overrides}' },
        path: { type: 'string', description: 'op=import/export 文件路径' },
        overwrite: { type: 'boolean', description: 'op=import 是否覆盖同名' },
      },
      output: OUTPUT,
      execute: async (args) => {
        const op = String(args.op ?? 'list').trim()
        const arg = String(args.id ?? '').trim()

        if (op === 'list') {
          const sections = mergedSections()
          return {
            ok: true,
            total: allEntries().length,
            sections: sections.map((s) => ({
              id: s.id, name: s.name, hint: s.hint,
              layers: s.layers.map((l) => ({ id: l.id, name: l.name, count: l.entries.length, entries: l.entries.map((e) => ({ id: e.id, name: e.name, oneLine: e.oneLine, origin: e.origin })) })),
            })),
            note: sections.map((s) =>
              `【${s.name}】\n` + s.layers.map((l) => `  ${l.name} (${l.id}) ${l.entries.length} 条\n` + l.entries.map((e) => `    ${e.id.padEnd(24)} ${e.name} —— ${e.oneLine}`).join('\n')).join('\n')
            ).join('\n\n'),
          }
        }

        if (op === 'section' || op === 'layer') {
          const sections = mergedSections()
          if (op === 'section') {
            const s = sections.find((x) => x.id === arg || x.name === arg)
            if (!s) return { ok: false, code: 'NOT_FOUND', error: `没有这个小工作台：${arg}`, note: `可选：${sections.map((x) => x.id).join(' / ')}` }
            return { ok: true, section: { id: s.id, name: s.name, hint: s.hint }, layers: s.layers, note: s.layers.map((l) => `【${l.name}】${l.entries.length} 条\n` + l.entries.map((e) => `  ${e.id} ${e.name}`).join('\n')).join('\n') }
          }
          for (const s of sections) {
            const l = s.layers.find((x) => x.id === arg || x.name === arg)
            if (l) return { ok: true, layer: { id: l.id, name: l.name, section: s.id }, entries: l.entries, note: `【${s.name} · ${l.name}】${l.entries.length} 条\n` + l.entries.map((e) => `  ${e.id} ${e.name}`).join('\n') }
          }
          return { ok: false, code: 'NOT_FOUND', error: `没有这个分类：${arg}` }
        }

        if (op === 'get') {
          const entry = findAny(arg)
          if (!entry) return { ok: false, code: 'NOT_FOUND', error: `没有这个条目：${arg}`, note: '用 op=list 或 op=search 找 id。' }
          return { ok: true, entry, ref: refOf(entry), spec: specOf(entry), note: specOf(entry) }
        }

        if (op === 'search') {
          if (arg === '') return { ok: false, code: 'EMPTY_QUERY', error: 'op=search 需要关键词（用 id 传）' }
          const q = arg.toLowerCase()
          const hits = allEntries().filter((e) => [e.id, e.name, e.oneLine, e.source, ...(e.tags || [])].join(' ').toLowerCase().includes(q))
          return {
            ok: true,
            count: hits.length,
            entries: hits.map((e) => ({ id: e.id, name: e.name, oneLine: e.oneLine, tags: e.tags })),
            note: hits.length === 0 ? `没搜到「${arg}」` : hits.map((e) => `${e.id}  ${e.name} —— ${e.oneLine}`).join('\n'),
          }
        }

        // ── 写操作 ──
        if (op === 'add') {
          const sectionId = String(args.section ?? 'agent').trim()
          const layerId = String(args.layer ?? '').trim()
          if (!validLayer(layerId)) return { ok: false, code: 'BAD_LAYER', error: `layer 必须是：${SECTIONS.flatMap((s) => s.layers.map((l) => l.id)).join(' / ')}` }
          const name = String(args.name ?? '').trim()
          const oneLine = String(args.oneLine ?? '').trim()
          if (!name || !oneLine) return { ok: false, code: 'MISSING_FIELD', error: 'add 需要 name 与 oneLine' }
          const overlay = loadOverlay()
          const id = arg || 'ai-' + name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').slice(0, 24) + '-' + Math.random().toString(36).slice(2, 6)
          if (findAny(id, { includeHidden: true })) return { ok: false, code: 'ID_EXISTS', error: `id 已存在：${id}` }
          const entry = {
            id, section: sectionId, layer: layerId, name, oneLine,
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
          return { ok: true, entry: { id, section: sectionId, layer: layerId }, total: allEntries().length, note: `已入库：${id}（${sectionId}/${layerId}）` }
        }

        if (['update', 'remove', 'pin', 'unpin', 'hide', 'unhide'].includes(op)) {
          const target = findAny(arg, { includeHidden: true })
          if (!target) return { ok: false, code: 'NOT_FOUND', error: `没有这条：${arg}` }
          const overlay = loadOverlay()
          const isExtra = overlay.entries.some((e) => e.id === arg)
          if (op === 'update') {
            const fields = {}
            for (const k of FIELD_WHITELIST) if (args[k] !== undefined) fields[k] = args[k]
            if (Object.keys(fields).length === 0) return { ok: false, code: 'NO_FIELD', error: '没给要改的字段' }
            if (isExtra) {
              const i = overlay.entries.findIndex((e) => e.id === arg)
              overlay.entries[i] = { ...overlay.entries[i], ...fields }
            } else {
              overlay.overrides[arg] = { ...(overlay.overrides[arg] ?? {}), ...fields }
            }
            saveOverlay(overlay)
            return { ok: true, updated: arg, fields: Object.keys(fields), note: `已更新 ${arg}：${Object.keys(fields).join(', ')}` }
          }
          if (op === 'remove' && isExtra) {
            overlay.entries = overlay.entries.filter((e) => e.id !== arg)
            delete overlay.overrides[arg]
            saveOverlay(overlay)
            return { ok: true, removed: arg, mode: 'deleted', total: allEntries().length, note: `已删除 ${arg}` }
          }
          const key = op === 'pin' || op === 'unpin' ? 'pinned' : 'hidden'
          const val = op === 'pin' || op === 'hide'
          overlay.overrides[arg] = { ...(overlay.overrides[arg] ?? {}), [key]: val }
          saveOverlay(overlay)
          return { ok: true, [key]: val, note: op === 'remove' ? `内置条目不能删，已隐藏 ${arg}` : `已${op} ${arg}` }
        }

        if (op === 'reorder') {
          const overlay = loadOverlay()
          const ids = Array.isArray(args.ids) ? args.ids.map(String) : []
          if (ids.length === 0) return { ok: false, code: 'NO_IDS', error: 'reorder 需要 ids 数组' }
          ids.forEach((id, i) => { overlay.overrides[id] = { ...(overlay.overrides[id] ?? {}), order: i } })
          saveOverlay(overlay)
          return { ok: true, order: ids, note: `已按给定顺序重排 ${ids.length} 条` }
        }

        if (op === 'stats') {
          const overlay = loadOverlay()
          const s = mergedSections()
          return {
            ok: true,
            total: allEntries().length,
            bySection: s.map((x) => ({ id: x.id, name: x.name, count: x.layers.reduce((n, l) => n + l.entries.length, 0), hidden: x.hiddenCount })),
            added: overlay.entries.length,
            overridden: Object.keys(overlay.overrides).length,
            path: extraPath(),
            note: s.map((x) => `${x.name}: ${x.layers.reduce((n, l) => n + l.entries.length, 0)} 条`).join('\n'),
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
              return { ok: true, export: bundle, path: outPath, note: `已导出到 ${outPath}` }
            } catch (e) {
              return { ok: false, code: 'WRITE_FAILED', error: String(e && e.message ? e.message : e) }
            }
          }
          return { ok: true, export: bundle, note: JSON.stringify(bundle, null, 2) }
        }

        if (op === 'import') {
          let bundle = args.data
          const path = String(args.path ?? '').trim()
          if ((bundle === undefined || bundle === null) && path !== '') {
            if (!existsSync(path)) return { ok: false, code: 'FILE_NOT_FOUND', error: `文件不存在：${path}` }
            try { bundle = JSON.parse(readFileSync(path, 'utf8')) } catch (e) { return { ok: false, code: 'BAD_JSON', error: String(e && e.message ? e.message : e) } }
          }
          if (!bundle || typeof bundle !== 'object') return { ok: false, code: 'NO_DATA', error: 'import 需要 data 或 path' }
          const overwrite = args.overwrite === true
          const overlay = loadOverlay()
          let added = 0
          let skipped = 0
          for (const e of (Array.isArray(bundle.entries) ? bundle.entries : [])) {
            if (!e || !e.id || !e.layer) { skipped++; continue }
            if (!validLayer(e.layer)) { skipped++; continue }
            if (findAny(e.id, { includeHidden: true }) && !overwrite) { skipped++; continue }
            const i = overlay.entries.findIndex((x) => x.id === e.id)
            if (i >= 0) overlay.entries[i] = e
            else overlay.entries.push(e)
            added++
          }
          for (const [id, ov] of Object.entries(bundle.overrides || {})) {
            overlay.overrides[id] = overwrite ? ov : { ...ov, ...(overlay.overrides[id] ?? {}) }
          }
          saveOverlay(overlay)
          return { ok: true, added, skipped, total: allEntries().length, note: `导入完成：新增 ${added}，跳过 ${skipped}` }
        }

        return { ok: false, code: 'UNKNOWN_OP', error: `未知 op：${op}` }
      },
    }),
  )

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
            } catch { path = '/' }
            if (path === '/state' || path === '/') {
              if (String(req.method ?? 'GET').toUpperCase() !== 'GET') return json(405, { ok: false, error: 'method-not-allowed' })
              return json(200, snapshot())
            }
            return json(404, { ok: false, error: 'not-found' })
          },
        }),
      )
    })
  }
}
