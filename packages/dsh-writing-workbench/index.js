/**
 * dsh-writing-workbench · 宿主半身（AI 通道）
 * 面板给人看，writing_style 工具给 AI 读同一份 catalog。
 * 覆盖层 extra.json 放 AI/人的改动，不动 catalog.js。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { PAGES, ALL_ENTRIES, TAGS, findEntry, pageOf, refOf, specOf } from './catalog.js'

const NAME = 'dsh-writing-workbench'
const ROUTE = '/writing-workbench'

function dshHome() { return process.env.DSH_HOME && process.env.DSH_HOME.trim() !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh') }
function extraPath() { return join(dshHome(), 'plugins', NAME, 'extra.json') }
function loadOverlay() {
  try {
    const raw = JSON.parse(readFileSync(extraPath(), 'utf8'))
    return { entries: Array.isArray(raw?.entries) ? raw.entries : [], overrides: raw?.overrides && typeof raw.overrides === 'object' ? raw.overrides : {} }
  } catch { return { entries: [], overrides: {} } }
}
function saveOverlay(o) {
  const dir = join(dshHome(), 'plugins', NAME)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(extraPath(), JSON.stringify(o, null, 2), 'utf8')
}
function applyOverride(entry, ov) {
  const o = ov[entry.id]
  if (!o || typeof o !== 'object') return entry
  const merged = { ...entry }
  for (const [k, v] of Object.entries(o)) if (k !== 'hidden' && k !== 'pinned' && k !== 'order') merged[k] = v
  if (o.hidden === true) merged.hidden = true
  if (o.pinned === true) merged.pinned = true
  return merged
}
function mergedPages(opts = {}) {
  const overlay = loadOverlay()
  const includeHidden = opts.includeHidden === true
  return PAGES.map((p) => {
    let list = [...p.entries.map((e) => applyOverride(e, overlay.overrides)), ...overlay.entries.filter((e) => e.page === p.id).map((e) => applyOverride(e, overlay.overrides))]
    if (!includeHidden) list = list.filter((e) => e.hidden !== true)
    return { ...p, entries: list }
  })
}
function findAny(id, opts = {}) {
  const overlay = loadOverlay()
  const base = findEntry(id) ?? overlay.entries.find((e) => e.id === id) ?? null
  if (base === null) return null
  const merged = applyOverride(base, overlay.overrides)
  return opts.includeHidden === true || merged.hidden !== true ? merged : null
}
function snapshot() {
  const pages = mergedPages()
  return {
    ok: true, at: new Date().toISOString(),
    pages, tags: TAGS,
    counts: pages.map((p) => ({ id: p.id, name: p.name, count: p.entries.length })),
    total: pages.reduce((n, p) => n + p.entries.length, 0),
    channel: 'writing_style op=list / page / get / search',
  }
}

export const name = NAME
export const inject = { tools: { required: true }, webServer: { required: false } }

const OUTPUT = {
  schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' }, note: { type: 'string' } } },
  render: (_args, value) => [{ type: 'text', text: typeof value?.note === 'string' ? value.note : JSON.stringify(value, null, 2) }],
}

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'writing_style',
    description:
      '写作工作台的数据通道：**用户本机的写作资料库，按题材分标签页**——小说 / 新闻 / 公众号 / 古诗 / 通用技法。\n' +
      'op=list 列全部题材与条目；op=page {id} 看某题材；op=get {id} 取完整规格；op=search {id:关键词} 按名称/标签/出处搜。\n' +
      '写：add / update / remove / pin / unpin / hide / unhide / reorder；运维：stats / export / import。\n' +
      '用户说「用那个网文 skill」「按倒金字塔写」「看工作台里古诗那条」时先 list/search 找 id 再 get。',
    parameters: {
      op: { type: 'string', required: true, description: 'list | page | get | search | add | update | remove | pin | unpin | hide | unhide | reorder | stats | export | import' },
      id: { type: 'string', description: '条目 id / 题材 id / 关键词' },
      page: { type: 'string', description: 'op=add 时所属题材（novel/news/wechat/poetry/craft）' },
      name: { type: 'string', description: 'op=add 必填：名称' },
      oneLine: { type: 'string', description: 'op=add 必填：一句话' },
      source: { type: 'string', description: '出处' },
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
        const pages = mergedPages()
        return {
          ok: true, total: pages.reduce((n, p) => n + p.entries.length, 0),
          pages: pages.map((p) => ({ id: p.id, name: p.name, hint: p.hint, entries: p.entries.map((e) => ({ id: e.id, name: e.name, oneLine: e.oneLine })) })),
          note: pages.map((p) => `【${p.name}】${p.entries.length} 条\n` + p.entries.map((e) => `  ${e.id.padEnd(22)} ${e.name}`).join('\n')).join('\n\n'),
        }
      }
      if (op === 'page') {
        const p = mergedPages().find((x) => x.id === arg || x.name === arg)
        if (!p) return { ok: false, code: 'NOT_FOUND', error: `没有这个题材：${arg}`, note: `可选：${PAGES.map((x) => x.id).join(' / ')}` }
        return { ok: true, page: { id: p.id, name: p.name, hint: p.hint }, entries: p.entries, note: `【${p.name}】${p.entries.length} 条\n` + p.entries.map((e) => `  ${e.id} ${e.name}`).join('\n') }
      }
      if (op === 'get') {
        const e = findAny(arg)
        if (!e) return { ok: false, code: 'NOT_FOUND', error: `没有这条：${arg}`, note: '用 op=list 找 id。' }
        return { ok: true, entry: e, ref: refOf(e), spec: specOf(e), note: specOf(e) }
      }
      if (op === 'search') {
        if (arg === '') return { ok: false, code: 'EMPTY_QUERY', error: 'op=search 需要关键词' }
        const q = arg.toLowerCase()
        const hits = mergedPages().flatMap((p) => p.entries).filter((e) => [e.id, e.name, e.oneLine, e.source, ...(e.tags || [])].join(' ').toLowerCase().includes(q))
        return { ok: true, count: hits.length, entries: hits, note: hits.length === 0 ? `没搜到「${arg}」` : hits.map((e) => `${e.id}  ${e.name} —— ${e.oneLine}`).join('\n') }
      }
      if (op === 'add') {
        const pageId = String(args.page ?? 'craft').trim()
        if (!PAGES.some((p) => p.id === pageId)) return { ok: false, code: 'BAD_PAGE', error: `题材应是：${PAGES.map((p) => p.id).join(' / ')}` }
        const nameV = String(args.name ?? '').trim()
        const oneLine = String(args.oneLine ?? '').trim()
        if (!nameV || !oneLine) return { ok: false, code: 'MISSING_FIELD', error: 'add 需要 name 与 oneLine' }
        const overlay = loadOverlay()
        const id = arg || 'w-' + nameV.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').slice(0, 24) + '-' + Math.random().toString(36).slice(2, 6)
        if (findAny(id, { includeHidden: true })) return { ok: false, code: 'ID_EXISTS', error: `id 已存在：${id}` }
        overlay.entries.push({
          id, page: pageId, name: nameV, oneLine, source: String(args.source ?? 'AI 录入'),
          tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
          bullets: Array.isArray(args.bullets) ? args.bullets.map(String) : [],
          howto: String(args.howto ?? ''), sources: Array.isArray(args.sources) ? args.sources : [], origin: String(args.origin ?? 'referenced'),
        })
        saveOverlay(overlay)
        return { ok: true, entry: { id, page: pageId }, note: `已入库：${id}（${pageId}）` }
      }
      if (['update', 'remove', 'pin', 'unpin', 'hide', 'unhide'].includes(op)) {
        const target = findAny(arg, { includeHidden: true })
        if (!target) return { ok: false, code: 'NOT_FOUND', error: `没有这条：${arg}` }
        const overlay = loadOverlay()
        const isExtra = overlay.entries.some((e) => e.id === arg)
        if (op === 'update') {
          const fields = {}
          for (const k of ['name', 'oneLine', 'source', 'tags', 'bullets', 'howto', 'sources', 'origin', 'page']) if (args[k] !== undefined) fields[k] = args[k]
          if (Object.keys(fields).length === 0) return { ok: false, code: 'NO_FIELD', error: '没给要改的字段' }
          if (isExtra) { const i = overlay.entries.findIndex((e) => e.id === arg); overlay.entries[i] = { ...overlay.entries[i], ...fields } }
          else overlay.overrides[arg] = { ...(overlay.overrides[arg] ?? {}), ...fields }
          saveOverlay(overlay)
          return { ok: true, updated: arg, note: `已更新 ${arg}` }
        }
        if (op === 'remove' && isExtra) {
          overlay.entries = overlay.entries.filter((e) => e.id !== arg)
          delete overlay.overrides[arg]
          saveOverlay(overlay)
          return { ok: true, removed: arg, note: `已删除 ${arg}` }
        }
        const key = op === 'pin' || op === 'unpin' ? 'pinned' : 'hidden'
        const val = op === 'pin' || op === 'hide'
        overlay.overrides[arg] = { ...(overlay.overrides[arg] ?? {}), [key]: val }
        saveOverlay(overlay)
        return { ok: true, [key]: val, note: op === 'remove' ? `内置不能删，已隐藏 ${arg}` : `已${op} ${arg}` }
      }
      if (op === 'reorder') {
        const overlay = loadOverlay()
        const ids = Array.isArray(args.ids) ? args.ids.map(String) : []
        if (ids.length === 0) return { ok: false, code: 'NO_IDS', error: 'reorder 需要 ids 数组' }
        ids.forEach((id, i) => { overlay.overrides[id] = { ...(overlay.overrides[id] ?? {}), order: i } })
        saveOverlay(overlay)
        return { ok: true, note: `已重排 ${ids.length} 条` }
      }
      if (op === 'stats') {
        const overlay = loadOverlay()
        return { ok: true, total: mergedPages().reduce((n, p) => n + p.entries.length, 0), byPage: mergedPages().map((p) => ({ id: p.id, name: p.name, count: p.entries.length })), added: overlay.entries.length, overridden: Object.keys(overlay.overrides).length, path: extraPath(), note: mergedPages().map((p) => `${p.name}: ${p.entries.length}`).join('\n') }
      }
      if (op === 'export') {
        const overlay = loadOverlay()
        const bundle = { entries: overlay.entries, overrides: overlay.overrides }
        const outPath = String(args.path ?? '').trim()
        if (outPath !== '') {
          try { mkdirSync(join(outPath, '..'), { recursive: true }); writeFileSync(outPath, JSON.stringify(bundle, null, 2), 'utf8'); return { ok: true, path: outPath, note: `已导出到 ${outPath}` } }
          catch (e) { return { ok: false, code: 'WRITE_FAILED', error: String(e && e.message ? e.message : e) } }
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
        let added = 0, skipped = 0
        for (const e of (Array.isArray(bundle.entries) ? bundle.entries : [])) {
          if (!e || !e.id || !e.page) { skipped++; continue }
          if (!PAGES.some((p) => p.id === e.page)) { skipped++; continue }
          if (findAny(e.id, { includeHidden: true }) && !overwrite) { skipped++; continue }
          const i = overlay.entries.findIndex((x) => x.id === e.id)
          if (i >= 0) overlay.entries[i] = e; else overlay.entries.push(e)
          added++
        }
        for (const [id, ov] of Object.entries(bundle.overrides || {})) overlay.overrides[id] = overwrite ? ov : { ...ov, ...(overlay.overrides[id] ?? {}) }
        saveOverlay(overlay)
        return { ok: true, added, skipped, note: `导入完成：新增 ${added}，跳过 ${skipped}` }
      }
      return { ok: false, code: 'UNKNOWN_OP', error: `未知 op：${op}` }
    },
  }))

  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (webCtx) => webCtx.effect(() =>
      webCtx.webServer.register({
        kind: 'prefix', path: ROUTE,
        handler: async (req, res) => {
          const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
          let path = '/'
          try { path = new URL(String(req.url ?? '/'), 'http://localhost').pathname.replace(ROUTE, '') || '/' } catch { path = '/' }
          if (path === '/state' || path === '/') {
            if (String(req.method ?? 'GET').toUpperCase() !== 'GET') return json(405, { ok: false, error: 'method-not-allowed' })
            return json(200, snapshot())
          }
          return json(404, { ok: false, error: 'not-found' })
        },
      }),
    ))
  }
}
