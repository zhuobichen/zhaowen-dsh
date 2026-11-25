/**
 * Host half of the Craft Anything bundle.
 *
 * It does two things:
 *   1. answers the workbench panel (`GET /craft-anything/status`) with a cached report of the
 *      CLI version, its toolsets and the engines it can see;
 *   2. leaves the analysis itself to the MCP row (`craft-anything-cli mcp`), which the bundle's
 *      patch inserts beside this one.
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'

const DEFAULT_CLI = String.raw`D:\github_project\ZhaoWen_GitHub维护\craft-anything-plugin\vendor\craft-anything\craft-anything-0.3.0-windows-x64-portable\craft-anything-cli.exe`

const CACHE_MS = 60_000
let cache = { at: 0, value: null }

function run(exe, args, timeout = 20_000) {
  return new Promise((resolve) => {
    execFile(exe, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, error: String(error.message || error) })
        return
      }
      resolve({ ok: true, stdout: String(stdout || ''), stderr: String(stderr || '') })
    })
  })
}

/** The CLI can answer as a JSON array, a one-line object or JSON-lines; accept all three. */
function extractEntries(stdout) {
  const text = String(stdout || '').trim()
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed
    if (parsed && Array.isArray(parsed.tools)) return parsed.tools
    if (parsed && Array.isArray(parsed.commands)) return parsed.commands
    if (parsed && typeof parsed === 'object') return [parsed]
  } catch {
    /* fall through to JSON-lines */
  }
  const rows = []
  for (const line of text.split(/\r?\n/)) {
    const candidate = line.trim()
    if (candidate.startsWith('{')) {
      try {
        rows.push(JSON.parse(candidate))
      } catch {
        /* ignore malformed line */
      }
      continue
    }
    if (candidate.startsWith('[')) {
      try {
        const parsed = JSON.parse(candidate)
        if (Array.isArray(parsed)) rows.push(...parsed)
      } catch {
        /* ignore malformed line */
      }
    }
  }
  return rows
}

function groupToolsets(stdout) {
  const groups = new Map()
  for (const entry of extractEntries(stdout)) {
    if (!entry || typeof entry !== 'object') continue
    if (!entry.toolset && !entry.tool && !entry.command) continue
    const id = entry.toolset || 'other'
    const current = groups.get(id) || { id, tools: 0, needsTarget: 0 }
    current.tools += 1
    if (entry.needs_target) current.needsTarget += 1
    groups.set(id, current)
  }
  return [...groups.values()].sort((a, b) => b.tools - a.tools)
}

function pickEngines(stdout) {
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return []
  }
  const checks = Array.isArray(parsed?.checks) ? parsed.checks : []
  return checks
    .filter((check) => String(check?.name || '').startsWith('engine:'))
    .map((check) => ({
      name: String(check.name).slice('engine:'.length),
      ok: check.status === 'ok',
      message: String(check.message || ''),
    }))
    .sort((a, b) => Number(b.ok) - Number(a.ok) || a.name.localeCompare(b.name))
}

function summarizeCapabilities(parsed) {
  const toolsets = (Array.isArray(parsed?.toolsets) ? parsed.toolsets : []).map((group) => {
    const tools = Array.isArray(group?.tools) ? group.tools : []
    return {
      id: String(group?.id || 'other'),
      title: String(group?.title || group?.id || ''),
      total: tools.length,
      available: tools.filter((tool) => tool?.available !== false).length,
    }
  })
  toolsets.sort((a, b) => b.total - a.total)
  const engines = (Array.isArray(parsed?.engines) ? parsed.engines : []).map((engine) => ({
    id: String(engine?.id || ''),
    name: String(engine?.name || engine?.id || ''),
    found: engine?.found === true,
    neededFor: String(engine?.needed_for || ''),
  }))
  engines.sort((a, b) => Number(b.found) - Number(a.found) || a.name.localeCompare(b.name))
  return {
    analysisMode: String(parsed?.analysis_mode || ''),
    host: String(parsed?.host || ''),
    version: String(parsed?.version || ''),
    toolsets,
    engines,
    toolCount: toolsets.reduce((sum, item) => sum + item.total, 0),
    availableCount: toolsets.reduce((sum, item) => sum + item.available, 0),
  }
}

async function collect(cli) {
  if (!cli || !existsSync(cli)) {
    return { ok: false, cli, reason: 'missing-cli', message: `找不到 craft-anything-cli：${cli}` }
  }
  const capabilities = await run(cli, ['capabilities'], 40_000)
  const version = await run(cli, ['--version'], 8_000)
  if (!capabilities.ok) {
    return { ok: false, cli, reason: 'capabilities-failed', message: capabilities.error || 'capabilities 执行失败' }
  }
  let parsed
  try {
    parsed = JSON.parse(capabilities.stdout)
  } catch {
    return { ok: false, cli, reason: 'bad-json', message: 'capabilities 输出不是合法 JSON' }
  }
  const summary = summarizeCapabilities(parsed)
  const versionText = version.ok ? String(version.stdout || '').trim().split(/\r?\n/)[0] : summary.version
  return {
    ok: true,
    cli,
    version: versionText || summary.version || 'unknown',
    analysisMode: summary.analysisMode,
    host: summary.host,
    toolsets: summary.toolsets,
    toolCount: summary.toolCount,
    availableCount: summary.availableCount,
    engines: summary.engines,
    checkedAt: new Date().toISOString(),
  }
}

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))

/** 面板与 AI 工具共用：4399 实战案例（case-4399.json） */
function readCase() {
  try {
    return JSON.parse(readFileSync(join(MODULE_DIR, 'case-4399.json'), 'utf8'))
  } catch (e) {
    return null
  }
}

// 工作流四步（面板与工具共用同一份）
const FLOW = [
  { id: 'study', n: '01', name: 'Study', desc: '只读外部可见：截图、可见文本、实测布局、颜色、字距', cmd: 'list_toolsets' },
  { id: 'build', n: '02', name: 'Build', desc: '按证据复刻：结构、样式、交互，逐宽度对照', cmd: 'enable_toolset {"toolset":"browser"}' },
  { id: 'check', n: '03', name: 'Check', desc: '对照原作验收：布局差异、像素误差、交互一致性', cmd: 'core_evidence_show' },
  { id: 'ready', n: '04', name: 'Ready', desc: '交付：可复现的工程 + 一份诚实的自评', cmd: 'core_report_write' },
]

export const name = '@zhuobichen/dsh-craft-anything'
export const inject = { tools: { required: true }, webServer: { required: false } }

export function apply(ctx, config = {}) {
  const cli = config?.cliPath || DEFAULT_CLI

  // ── AI 通道：面板给人看，工具给 AI 读同一份数据 ────────────────────
  ctx.tools.register(
    defineTool({
      name: 'craft_workbench',
      description:
        'Craft Anything 工作台的数据通道：**面板上看到的东西，AI 用这个读同一份**。\n' +
        'op=status CLI/工具集/引擎/模式；op=toolsets 看 17 个工具集与可用率；op=engines 看引擎；' +
        'op=case 读实战案例（4399 首页逆向证据链，每条带证据来源）；op=flow 看 Study→Build→Check→Ready 四步指令。\n' +
        '用户说「看工作台里那个 4399 案例」「按 Craft Anything 的工作流来」时用这个读。',
      parameters: {
        op: { type: 'string', required: true, description: 'status | toolsets | engines | case | flow | all' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: typeof value?.note === 'string' ? value.note : JSON.stringify(value, null, 2) }],
      },
      execute: async (args) => {
        const op = String(args.op ?? 'status').trim()
        const value = await collect(cli)
        const caseData = readCase()

        if (op === 'status' || op === 'all') {
          return {
            ...value,
            case: caseData,
            flow: FLOW,
            note: JSON.stringify({ ok: value.ok, version: value.version, toolCount: value.toolCount, availableCount: value.availableCount, analysisMode: value.analysisMode, toolsets: value.toolsets?.length ?? 0, engines: value.engines?.length ?? 0, case: caseData?.name, flow: FLOW.length }, null, 2),
          }
        }
        if (op === 'toolsets') {
          const rows = value.toolsets || []
          return {
            ok: true,
            count: rows.length,
            toolsets: rows,
            note: rows.length === 0
              ? '没读到工具集（CLI 可能没就绪）。'
              : rows.map((t) => `${String(t.id).padEnd(14)} ${t.available}/${t.total}  ${t.title || ''}`).join('\n'),
          }
        }
        if (op === 'engines') {
          const rows = value.engines || []
          const on = rows.filter((e) => e.found)
          const off = rows.filter((e) => !e.found)
          return {
            ok: true,
            found: on.length,
            total: rows.length,
            engines: rows,
            note: `已装 ${on.length}/${rows.length}\n` +
              on.map((e) => `  ● ${e.name} — ${e.neededFor || ''}`).join('\n') + '\n' +
              off.map((e) => `  ○ ${e.name} — ${e.neededFor || ''}`).join('\n'),
          }
        }
        if (op === 'case') {
          if (caseData === null) return { ok: false, code: 'CASE_MISSING', error: '没读到 case-4399.json' }
          const ev = caseData.evidence || []
          return {
            ok: true,
            case: caseData,
            note: `${caseData.name}（${caseData.url}）\n` +
              ev.map((e, i) => `  ${i + 1}. ${e.k}：${e.v}\n     证据：${e.src}`).join('\n') +
              `\n结论：${caseData.conclusion}`,
          }
        }
        if (op === 'flow') {
          return {
            ok: true,
            flow: FLOW,
            note: FLOW.map((f) => `${f.n} ${f.name} — ${f.desc}\n   ${f.cmd}`).join('\n'),
          }
        }
        return { ok: false, code: 'UNKNOWN_OP', error: `op 只支持 status | toolsets | engines | case | flow | all，收到：${op}` }
      },
    }),
  )

  ctx.inject(['webServer'], (sub) => {
    let ws
    try {
      ws = sub.webServer ?? (typeof sub.get === 'function' ? sub.get('webServer') : undefined)
    } catch {
      ws = undefined
    }
    if (!ws || typeof ws.register !== 'function') {
      ctx.logger?.warn?.('[craft-anything] webServer 不可用，工作台接口未挂载')
      return
    }

    ws.register({
      kind: 'prefix',
      path: '/craft-anything',
      handler: async (req, res) => {
        const url = String(req?.url || '')
        if (req.method !== 'GET') {
          res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: 'method-not-allowed' }))
          return
        }
        if (/\/cases(\?|$)/.test(url)) {
          const caseData = readCase()
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(caseData === null
            ? { ok: false, error: 'case-4399.json 读不到' }
            : { ok: true, case: caseData }))
          return
        }
        if (!/\/status(\?|$)/.test(url)) {
          res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: 'not-found' }))
          return
        }
        const now = Date.now()
        if (cache.value && now - cache.at < CACHE_MS) {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(cache.value))
          return
        }
        try {
          const value = await collect(cli)
          cache = { at: now, value }
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(value))
        } catch (error) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: String(error?.message || error) }))
        }
      },
    })
  })
}
