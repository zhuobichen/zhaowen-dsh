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
import { existsSync } from 'node:fs'

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

export const name = '@local/dsh-craft-anything'
export const inject = []

export function apply(ctx, config = {}) {
  const cli = config?.cliPath || DEFAULT_CLI

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
