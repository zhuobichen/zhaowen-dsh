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

import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname } from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'

import { ALL_ENTRIES, LAYERS, TAGS, findEntry, layerOf, refOf, specOf } from './catalog.js'

const NAME = 'dsh-design-workbench'
const ROUTE = '/design-workbench'
const MAX_COVER_BYTES = 12 * 1024 * 1024

const MEDIA = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
}

/** 面板读的整包状态：目录 + 标签 + 计数。 */
function snapshot() {
  return {
    ok: true,
    at: new Date().toISOString(),
    layers: LAYERS,
    tags: TAGS,
    counts: LAYERS.map((l) => ({ id: l.id, name: l.name, count: l.entries.length })),
    total: ALL_ENTRIES.length,
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
        '设计工作台的数据通道：**用户本机的设计资料库，分四层（App 设计 / 前端设计 / 视频风格 / 代码生视频）**。\n' +
        '工作台面板是给人看的；这是给 AI 读同一份数据的入口。\n' +
        'op=list 四层全列（id / 名称 / 一句话 / 出处）；op=layer {id} 只看一层（app | frontend | video | codevideo）；' +
        'op=get {id} 取完整规格（颜色/圆角/投影/CSS/要点/怎么用，几百字）；op=search {id: 关键词} 按名称/标签/出处搜。\n' +
        '用户说「用工作台里那个水墨的」「按那个紧凑仪表盘做」时，先用 op=search 或 op=list 找到 id，再 op=get 拿规格。',
      parameters: {
        op: { type: 'string', required: true, description: 'list | layer | get | search' },
        id: { type: 'string', description: '条目 id（get）、层 id（layer：app|frontend|video|codevideo）、或关键词（search）' },
      },
      output: OUTPUT,
      execute: async (args) => {
        const op = String(args.op ?? '').trim()
        const arg = String(args.id ?? '').trim()

        if (op === 'list') {
          return {
            ok: true,
            count: ALL_ENTRIES.length,
            layers: LAYERS.map((l) => ({
              id: l.id,
              name: l.name,
              hint: l.hint,
              count: l.entries.length,
              entries: l.entries.map((e) => ({ id: e.id, name: e.name, oneLine: e.oneLine, origin: e.origin, tags: e.tags })),
            })),
            note: LAYERS.map(
              (l) => `【${l.name}】${l.entries.length} 条\n` + l.entries.map((e) => `  ${e.id.padEnd(20)} ${e.name} —— ${e.oneLine}`).join('\n'),
            ).join('\n\n'),
          }
        }

        if (op === 'layer') {
          const layer = LAYERS.find((l) => l.id === arg || l.name === arg)
          if (layer === undefined) {
            return { ok: false, code: 'UNKNOWN_LAYER', error: `层只支持：${LAYERS.map((l) => l.id).join(' / ')}`, note: 'op=layer 需要 id：' + LAYERS.map((l) => l.id).join(' / ') }
          }
          return {
            ok: true,
            layer: { id: layer.id, name: layer.name, hint: layer.hint, count: layer.entries.length },
            entries: layer.entries,
            note: `【${layer.name}】${layer.entries.length} 条\n` + layer.entries.map((e) => `  ${e.id.padEnd(20)} ${e.name} —— ${e.oneLine}`).join('\n'),
          }
        }

        if (op === 'get') {
          const entry = findEntry(arg)
          if (entry === null) {
            return { ok: false, code: 'UNKNOWN_ENTRY', error: `没有这个条目：${arg}`, note: '用 op=list 看全部 id，或 op=search 搜关键词。' }
          }
          return { ok: true, entry, layer: layerOf(entry.id), ref: refOf(entry), spec: specOf(entry), note: specOf(entry) }
        }

        if (op === 'search') {
          const q = arg.toLowerCase()
          if (q === '') return { ok: false, code: 'EMPTY_QUERY', error: 'op=search 需要关键词（名称/标签/出处都可以）', note: '例如 op=search id=水墨' }
          const hits = ALL_ENTRIES.filter((e) => {
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
