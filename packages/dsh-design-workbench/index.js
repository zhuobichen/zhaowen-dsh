/**
 * dsh-design-workbench · 宿主半身
 *
 * 干三件事：
 *   ① 把「设计样式目录」暴露成 HTTP（面板读它画卡片）；
 *   ② 记住用户在工作台里「选中的是哪一种」（state.json + 审计），
 *      这样 AI 不用等用户复述，一个 design_style 工具就能读到；
 *   ③ 给 agent 一个 design_style 工具：list / get / current / pick。
 *
 * 为什么要有这个包：
 *   用户的原话是「在工作台能查看各种设计样式并引用给 AI 我想要哪种，而不是到处翻来翻去」。
 *   所以核心不是"再做一个色板"，而是**把"我要这个"变成一条 AI 能读到的记录**。
 *
 * 设计约束：
 *   - 目录只有一份（catalog.js），宿主与面板共用，避免两处漂移；
 *   - 写操作只有 pick 一个，落盘小 JSON + append-only 审计；
 *   - 没有任何 await 外部 IO，工具执行是同步拼装，不触碰门禁里那两条铁律。
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'

import { FILTERS, STYLES, findStyle, promptOf } from './catalog.js'

const NAME = 'dsh-design-workbench'
const ROUTE = '/design-workbench'
const MAX_RECENT = 12

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

/** { picked: { id, at }, recent: [{ id, at, by }] } */
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
    // 记不上审计不影响选样式
  }
}

/** 选中一种样式：写 picked + 压进 recent（同 id 去重，只留最新）。 */
function pick(id, by = 'user') {
  const style = findStyle(id)
  if (style === null) return { ok: false, code: 'UNKNOWN_STYLE', error: `没有这个样式：${id}（可选：${STYLES.map((s) => s.id).join(' / ')}）` }
  const state = loadState()
  const at = new Date().toISOString()
  state.picked = { id: style.id, at, by }
  state.recent = [{ id: style.id, at, by }, ...state.recent.filter((x) => x.id !== style.id)].slice(0, MAX_RECENT)
  saveState(state)
  audit({ op: 'pick', styleId: style.id, by })
  return { ok: true, picked: state.picked }
}

/** 面板读的整包状态：目录 + 选中 + 最近 + 筛选芯片。 */
function snapshot(state) {
  const picked = state.picked === null ? null : { ...state.picked, style: findStyle(state.picked.id) }
  return {
    ok: true,
    at: new Date().toISOString(),
    styles: STYLES,
    filters: FILTERS,
    picked: picked === null ? null : { id: picked.id, at: picked.at, by: picked.by, name: picked.style?.name ?? '' },
    pickedPrompt: picked === null ? '' : promptOf(picked.style),
    recent: state.recent.map((r) => ({ ...r, name: findStyle(r.id)?.name ?? r.id })),
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

/** tools 必需（要有 design_style）；webServer 可选（没面板也能给 AI 查）。 */
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
        '前端设计工作台的数据入口：**读用户在工作台里选中的设计样式**，不用再问一遍。\n' +
        'op=list 列出全部样式（id / 名称 / 一句话 / 出处）；op=get 取某一条的完整 token 与「引用给 AI」正文；' +
        'op=current 取用户当前选中的那一条（含 prompt，可直接照做）；op=pick 替用户选中一条（用户说「就用第 N 种/某某风」时用）。\n' +
        '写前端代码前，先 op=current——用户可能已经在工作台里挑好了。',
      parameters: {
        op: { type: 'string', required: true, description: 'list | get | current | pick' },
        id: { type: 'string', description: '样式 id（get / pick 必填），如 dash-compact、kaguya-sky' },
      },
      output: OUTPUT,
      execute: async (args) => {
        const op = String(args.op ?? '').trim()

        if (op === 'list') {
          return {
            ok: true,
            count: STYLES.length,
            styles: STYLES.map((s) => ({ id: s.id, name: s.name, oneLine: s.oneLine, source: s.source, tags: s.tags })),
            note: STYLES.map((s) => `${s.id.padEnd(14)} ${s.name} —— ${s.oneLine}`).join('\n'),
          }
        }

        if (op === 'get') {
          const style = findStyle(String(args.id ?? '').trim())
          if (style === null) {
            return { ok: false, code: 'UNKNOWN_STYLE', error: `没有这个样式：${args.id}（可选：${STYLES.map((s) => s.id).join(' / ')}）`, note: '用 op=list 看全部 id。' }
          }
          return { ok: true, style, prompt: style.prompt, note: style.prompt }
        }

        if (op === 'current') {
          const state = loadState()
          if (state.picked === null) {
            return {
              ok: true,
              picked: null,
              note: '用户还没在工作台里选样式。可以先 op=list 给他看，或直接问他要哪一种。',
            }
          }
          const style = findStyle(state.picked.id)
          const at = state.picked.at
          const by = state.picked.by ?? 'user'
          return {
            ok: true,
            picked: { id: state.picked.id, name: style?.name ?? state.picked.id, at, by },
            style,
            prompt: style === null ? '' : promptOf(style),
            note: `用户已选：${style?.name ?? state.picked.id}（${at}，${by === 'user' ? '工作台里点的' : by}）\n\n` + (style === null ? '' : promptOf(style)),
          }
        }

        if (op === 'pick') {
          const result = pick(String(args.id ?? '').trim(), `agent:${callerIdOf({}) || 'unknown'}`)
          if (!result.ok) return { ...result, note: result.error }
          const style = findStyle(result.picked.id)
          return {
            ok: true,
            picked: result.picked,
            prompt: style === null ? '' : promptOf(style),
            note: `已选中 ${style?.name ?? result.picked.id}。\n\n` + (style === null ? '' : promptOf(style)),
          }
        }

        return { ok: false, code: 'UNKNOWN_OP', error: `op 只支持 list / get / current / pick，收到：${op}`, note: 'op 只支持 list / get / current / pick。' }
      },
    }),
  )

  // ──────────────────────────────────────────────────────────────────────
  // Web 面板接口
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
                return json(400, { ok: false, code: 'BAD_JSON', error: 'body 必须是 JSON，例如 {"id":"dash-compact"}' })
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
 * 为什么要 deadline：`end` / `error` 都是「事件」，客户端半开连接时可能永远不来。
 * 门禁文档（docs/门禁-等待与取消.md）第一条就是「每一个 await 都有无论如何都会结束的兜底」，
 * 这里的兜底就是这个 setTimeout —— 到点先 destroy 连接，再 settle。
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
        // 连接已经断了，destroy 失败无所谓
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
