/**
 * dsh-design-workbench · 宿主半身
 *
 * 干四件事：
 *   ① 把「三层设计资料库」暴露成 HTTP（面板读它画卡片）；
 *   ② 提供封面图（白名单：只认 catalog.js 里写死的 cover 路径）；
 *   ③ 记住用户选中了哪一条（state.json + 审计），AI 用 design_style 直接读；
 *   ④ 给 agent 一个 design_style 工具：list / get / current / pick。
 *
 * 为什么要有这个包：用户的诉求是「把本机各种设计资料整理成三层，在工作台里看，
 * 并且能引用给 AI 我想要哪种」。所以核心是**把"我要这个"变成 AI 能读到的记录**，
 * 而不是再做一个色板。
 *
 * 边界：
 *   - 资料目录只此一份（catalog.js），宿主与面板共用；
 *   - 只读本机文件，只写 state.json / changes.jsonl 两个小文件；
 *   - 没有任何长时间的 await，工具执行是同步拼装。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'

import { ALL_ENTRIES, LAYERS, TAGS, findEntry, layerOf, refOf, specOf } from './catalog.js'

const NAME = 'dsh-design-workbench'
const ROUTE = '/design-workbench'
const MAX_RECENT = 12
const MAX_COVER_BYTES = 12 * 1024 * 1024

const MEDIA = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
}

function dshHome() {
  return process.env.DSH_HOME && process.env.DSH_HOME.trim() !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
}

const storeDir = () => join(dshHome(), 'plugins', NAME)
const statePath = () => join(storeDir(), 'state.json')
const auditPath = () => join(storeDir(), 'changes.jsonl')

function ensureDir() {
  const d = storeDir()
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

/** { picked: { id, at, by }, recent: [{ id, at, by }] } */
function loadState() {
  try {
    const raw = JSON.parse(readFileSync(statePath(), 'utf8'))
    if (raw && typeof raw === 'object') {
      return {
        picked: raw.picked && typeof raw.picked === 'object' && typeof raw.picked.id === 'string' ? raw.picked : null,
        recent: Array.isArray(raw.recent) ? raw.recent.filter((x) => x && typeof x.id === 'string') : [],
      }
    }
  } catch {
    // 文件不存在 / 坏掉：当作还没选过
  }
  return { picked: null, recent: [] }
}

function saveState(state) {
  ensureDir()
  writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf8')
}

function audit(entry) {
  try {
    ensureDir()
    appendFileSync(auditPath(), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', 'utf8')
  } catch {
    // 记不上审计不影响主流程
  }
}

/** 选中一条：写 picked + 压进 recent（同 id 去重，只留最新）。 */
function pick(id, by = 'user') {
  const entry = findEntry(id)
  if (entry === null) {
    const sample = ALL_ENTRIES.slice(0, 6).map((e) => e.id).join(' / ')
    return { ok: false, code: 'UNKNOWN_ENTRY', error: `没有这个设计条目：${id}（例如：${sample} …）` }
  }
  const state = loadState()
  const at = new Date().toISOString()
  state.picked = { id: entry.id, at, by }
  state.recent = [{ id: entry.id, at, by }, ...state.recent.filter((x) => x.id !== entry.id)].slice(0, MAX_RECENT)
  saveState(state)
  audit({ op: 'pick', entryId: entry.id, layer: layerOf(entry.id)?.id ?? '?', by })
  return { ok: true, picked: state.picked }
}

/** 面板读的整包状态。 */
function snapshot(state) {
  const pickedEntry = state.picked === null ? null : findEntry(state.picked.id)
  return {
    ok: true,
    at: new Date().toISOString(),
    layers: LAYERS,
    tags: TAGS,
    picked:
      pickedEntry === null
        ? null
        : {
            id: pickedEntry.id,
            name: pickedEntry.name,
            layer: layerOf(pickedEntry.id)?.id ?? '',
            at: state.picked.at,
            by: state.picked.by,
          },
    pickedPrompt: pickedEntry === null ? '' : refOf(pickedEntry),
    recent: state.recent.map((r) => ({ ...r, name: findEntry(r.id)?.name ?? r.id })),
    counts: LAYERS.map((l) => ({ id: l.id, name: l.name, count: l.entries.length })),
    statePath: statePath(),
    auditPath: auditPath(),
  }
}

function callerIdOf(exec) {
  const candidates = [exec?.agent?.id, exec?.session?.id, exec?.sessionId, exec?.caller?.id]
  for (const c of candidates) if (typeof c === 'string' && c !== '') return c
  return ''
}

export const name = NAME

export const inject = {
  tools: { required: true },
  webServer: { required: false },
}

export function apply(ctx) {
  ensureDir()

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
        '设计工作台的数据入口：**用户本机的设计资料库，分三层（App 设计 / 前端设计 / 视频风格）**。\n' +
        'op=list 按层列出全部条目（id / 名称 / 一句话 / 出处）；op=get {id} 取完整要点与「引用给 AI」正文；' +
        'op=current 取用户当前选中的那一条（含 prompt，可直接照做）；op=layer {id: app|frontend|video} 只看某一层；' +
        'op=pick {id} 替用户选中一条（他说「就用那个水墨的」时用）。\n' +
        '写前端、做 App 原型、做视频/动效前，先 op=current 或 op=layer 看看用户已经攒了哪些参照。',
      parameters: {
        op: { type: 'string', required: true, description: 'list | layer | get | current | pick' },
        id: { type: 'string', description: '条目 id（get / pick）或层 id（layer：app | frontend | video）' },
      },
      output: OUTPUT,
      execute: async (args) => {
        const op = String(args.op ?? '').trim()

        if (op === 'list') {
          return {
            ok: true,
            count: ALL_ENTRIES.length,
            layers: LAYERS.map((l) => ({
              id: l.id,
              name: l.name,
              hint: l.hint,
              count: l.entries.length,
              entries: l.entries.map((e) => ({ id: e.id, name: e.name, oneLine: e.oneLine, source: e.source, tags: e.tags })),
            })),
            note: LAYERS.map(
              (l) =>
                `【${l.name}】${l.entries.length} 条\n` +
                l.entries.map((e) => `  ${e.id.padEnd(20)} ${e.name} —— ${e.oneLine}`).join('\n'),
            ).join('\n\n'),
          }
        }

        if (op === 'layer') {
          const id = String(args.id ?? '').trim()
          const layer = LAYERS.find((l) => l.id === id || l.name === id)
          if (layer === undefined) {
            return { ok: false, code: 'UNKNOWN_LAYER', error: `层只支持：${LAYERS.map((l) => l.id).join(' / ')}`, note: 'op=layer 需要 id：app / frontend / video' }
          }
          return {
            ok: true,
            layer: { id: layer.id, name: layer.name, hint: layer.hint, count: layer.entries.length },
            entries: layer.entries,
            note: `【${layer.name}】${layer.entries.length} 条\n` + layer.entries.map((e) => `  ${e.id.padEnd(20)} ${e.name} —— ${e.oneLine}`).join('\n'),
          }
        }

        if (op === 'get') {
          const id = String(args.id ?? '').trim()
          const entry = findEntry(id)
          if (entry === null) {
            return { ok: false, code: 'UNKNOWN_ENTRY', error: `没有这个条目：${id}`, note: '用 op=list 看全部 id。' }
          }
          return { ok: true, entry, layer: layerOf(entry.id), prompt: entry.prompt, spec: entry.spec, note: entry.spec }
        }

        if (op === 'current') {
          const state = loadState()
          if (state.picked === null) {
            return { ok: true, picked: null, note: '用户还没在工作台里选。可以先 op=list 给他看，或问他要哪一类（App / 前端 / 视频）。' }
          }
          const entry = findEntry(state.picked.id)
          if (entry === null) return { ok: false, code: 'STALE_PICK', error: `选中的条目已不在目录里：${state.picked.id}`, note: '条目被删了，重新选一条。' }
          return {
            ok: true,
            picked: { id: entry.id, name: entry.name, layer: layerOf(entry.id)?.name ?? '', at: state.picked.at, by: state.picked.by ?? 'user' },
            entry,
            prompt: refOf(entry),
            spec: specOf(entry),
            note: `用户已选：${entry.name}（${state.picked.at}，${state.picked.by === 'user' ? '工作台里点的' : state.picked.by}）\n\n` + specOf(entry),
          }
        }

        if (op === 'pick') {
          const result = pick(String(args.id ?? '').trim(), `agent:${callerIdOf({}) || 'unknown'}`)
          if (!result.ok) return { ...result, note: result.error }
          const entry = findEntry(result.picked.id)
          return { ok: true, picked: result.picked, prompt: entry.prompt, spec: entry.spec, note: `已选中 ${entry.name}。\n\n` + entry.spec }
        }

        return { ok: false, code: 'UNKNOWN_OP', error: `op 只支持 list / layer / get / current / pick，收到：${op}`, note: 'op 只支持 list / layer / get / current / pick。' }
      },
    }),
  )

  // ──────────────────────────────────────────────────────────────────────
  // Web 面板接口：/state、/pick、/cover/<id>
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
              return json(200, snapshot(loadState()))
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

            if (path === '/pick') {
              if (method !== 'POST') return json(405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: '/pick 只支持 POST（body: {"id": "..."}）。' })
              let raw = ''
              try {
                raw = await readBody(req)
              } catch {
                raw = ''
              }
              let body = {}
              try {
                body = raw === '' ? {} : JSON.parse(raw)
              } catch {
                return json(400, { ok: false, code: 'BAD_JSON', error: 'body 必须是 JSON，例如 {"id":"app-mapmate"}' })
              }
              const id = typeof body?.id === 'string' ? body.id.trim() : ''
              if (id === '') return json(400, { ok: false, code: 'EMPTY_ID', error: '缺少 id。' })
              const result = pick(id, 'user')
              if (!result.ok) return json(400, result)
              return json(200, { ...snapshot(loadState()), justPicked: result.picked })
            }

            return json(404, { ok: false, code: 'NOT_FOUND', error: `没有这个路由：${path}` })
          },
        }),
      )
    })
  }
}

/**
 * 读请求体：1 MB 上限 + 5 秒硬 deadline。
 *
 * 门禁第一条：每一个 await 都要有「无论如何都会结束」的兜底。
 * end/error 都是事件，客户端半开连接时可能永远不来 —— 这个 setTimeout 就是兜底。
 */
function readBody(req, deadlineMs = 5000) {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer = null
    const settle = (fn, arg) => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      fn(arg)
    }

    timer = setTimeout(() => {
      try {
        req.destroy?.()
      } catch {
        // 连接已断，destroy 失败无所谓
      }
      settle(reject, new Error(`读请求体超时（${deadlineMs}ms）`))
    }, deadlineMs)

    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 1024 * 1024) {
        try {
          req.destroy?.()
        } catch {
          // 同上
        }
        settle(reject, new Error('body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => settle(resolve, Buffer.concat(chunks).toString('utf8')))
    req.on('error', (error) => settle(reject, error))
  })
}
