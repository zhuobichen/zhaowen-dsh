/**
 * dsh-paper-workbench · 宿主半身
 *
 * AI 接触工作台数据的通道：paper_style 工具读同一份 catalog（list/layer/get/search）；
 * 浏览器面板读 /paper-workbench/state。纯只读，不写 state、不留审计。
 * 面板「复制引用」给一行索引，指向的就是这个工具。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ALL_ENTRIES, LAYERS, TAGS, findEntry, layerOf, refOf, specOf } from './catalog.js'

const NAME = 'dsh-paper-workbench'
const ROUTE = '/paper-workbench'

function mergedLayers() {
  // 每条补 nature（工具库里都是 method/tool，面板据此筛选不影响）与 prompt/spec。
  return LAYERS.map((l) => ({
    ...l,
    entries: l.entries.map((e) => ({
      ...e,
      nature: 'method',
      natureScore: 1,
      prompt: typeof e.prompt === 'string' ? e.prompt : refOf(e),
      spec: typeof e.spec === 'string' ? e.spec : specOf(e),
    })),
  }))
}

function snapshot() {
  const layers = mergedLayers()
  return {
    ok: true,
    at: new Date().toISOString(),
    layers,
    tags: TAGS,
    counts: layers.map((l) => ({ id: l.id, name: l.name, count: l.entries.length })),
    total: layers.reduce((n, l) => n + l.entries.length, 0),
    channel: 'paper_style op=list / op=layer / op=get / op=search',
  }
}

export const name = NAME
export const inject = { tools: { required: true }, webServer: { required: false } }

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
      name: 'paper_style',
      description:
        '论文工作台的数据通道：本机论文相关 skill / MCP / 插件的资料库，七层\n' +
        '（写作与润色 / 选题与创新 / 统计与方法 / 文献Zotero / 文献CNKI / 检索与发布 / MCP工具）。\n' +
        '面板给人挑，这是给 AI 读同一份数据的入口。\n' +
        'op=list 全列（id/名称/一句话/出处）；op=layer {id} 只看一层；op=get {id} 完整规格（要点/原始材料/怎么用）；op=search {关键词} 按名称/标签/出处搜。\n' +
        '用户说「用论文工作台里那个 XX」「按那个反防御性写作来」时，先 op=search 找 id，要细节再 op=get。',
      parameters: {
        op: { type: 'string', required: true, description: 'list | layer | get | search' },
        id: { type: 'string', description: '条目 id（get）、层 id（layer：writing|idea|method|zotero|cnki|search|mcp）、或关键词（search）' },
        nature: { type: 'string', description: '只要哪一类：all（默认）/ method / reference。与设计/代码工作台一致。' },
      },
      output: OUTPUT,
      execute: async (args) => {
        const op = String(args.op ?? '').trim()
        const arg = String(args.id ?? '').trim()
        // 与设计/代码工作台同构：统一的 nature 参数（工具库条目都是 method/referenced）。
        const nature = String(args.nature ?? 'all').trim()
        const keep = (e) => nature === 'all' || nature === '' || e.nature === nature

        if (op === 'list') {
          return {
            ok: true,
            count: ALL_ENTRIES.filter(keep).length,
            nature,
            layers: LAYERS.map((l) => {
              const kept = l.entries.filter(keep)
              return {
                id: l.id,
                name: l.name,
                hint: l.hint,
                count: kept.length,
                totalInLayer: l.entries.length,
                entries: kept.map((e) => ({ id: e.id, name: e.name, oneLine: e.oneLine, origin: e.origin, nature: e.nature ?? 'method', tags: e.tags })),
              }
            }),
            note: LAYERS.map((l) => `【${l.name}】${l.entries.length} 条\n` + l.entries.map((e) => `  ${e.id.padEnd(22)} ${e.name} —— ${e.oneLine}`).join('\n')).join('\n\n'),
          }
        }

        if (op === 'layer') {
          const layer = LAYERS.find((l) => l.id === arg || l.name === arg)
          if (layer === undefined) {
            return { ok: false, code: 'UNKNOWN_LAYER', error: `层只支持：${LAYERS.map((l) => l.id).join(' / ')}`, note: 'op=layer 需要层 id：' + LAYERS.map((l) => l.id).join(' / ') }
          }
          const kept = layer.entries.filter(keep)
          return {
            ok: true,
            layer: { id: layer.id, name: layer.name, hint: layer.hint, count: kept.length, totalInLayer: layer.entries.length },
            entries: kept.map((e) => ({ ...e, prompt: refOf(e), spec: specOf(e), nature: e.nature ?? 'method' })),
            note: `【${layer.name}】${kept.length} 条（nature=${nature}）\n` + kept.map((e) => `  ${e.id.padEnd(22)} ${e.name} —— ${e.oneLine}`).join('\n'),
          }
        }

        if (op === 'get') {
          const entry = findEntry(arg)
          if (entry === null) {
            return { ok: false, code: 'UNKNOWN_ENTRY', error: `没有这个条目：${arg}`, note: '用 op=list 看全部 id，或 op=search 搜关键词。' }
          }
          const layer = layerOf(entry.id)
          return {
            ok: true,
            entry: { ...entry, prompt: refOf(entry), spec: specOf(entry) },
            layer: layer === null ? null : { id: layer.id, name: layer.name, hint: layer.hint },
            ref: refOf(entry),
            spec: specOf(entry),
            members: [],
            note: specOf(entry),
          }
        }

        if (op === 'search') {
          if (arg === '') return { ok: false, code: 'EMPTY_QUERY', error: 'op=search 需要关键词（名称/标签/出处都可以）', note: '例如 op=search id=统计。' }
          const q = arg.toLowerCase()
          const hits = ALL_ENTRIES.filter(keep).filter((e) =>
            [e.id, e.name, e.oneLine, e.source, ...(e.tags || [])].join(' ').toLowerCase().includes(q)
          )
          return {
            ok: true,
            count: hits.length,
            entries: hits.map((e) => ({ id: e.id, name: e.name, oneLine: e.oneLine, layer: layerOf(e.id)?.name ?? '', origin: e.origin })),
            note: hits.length === 0
              ? `没搜到「${arg}」。换个别名试试（比如「统计」「Zotero」「撞题」）。`
              : hits.map((e) => `${e.id}  ${e.name} —— ${e.oneLine}`).join('\n'),
          }
        }

        return { ok: false, code: 'UNKNOWN_OP', error: `op 只支持 list / layer / get / search，收到：${op}`, note: 'op=list / layer / get / search。' }
      },
    })
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
            } catch {
              path = '/'
            }
            if (path === '/state' || path === '/') return json(200, snapshot())
            return json(404, { ok: false, code: 'NOT_FOUND', error: `没有这个路由：${path}` })
          },
        })
      )
    })
  }
}
