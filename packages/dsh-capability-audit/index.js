/**
 * dsh-capability-audit —— 长期使用后，哪些能力在真干活、哪些只是占位置。
 *
 * 一次调用给三张表 + 建议清单：
 *   skills 首次可用时间 / 机会 / 触发 / 漏触发率（时间基线自动取自会话里的 <available_skills>）
 *   mcp    按 server：调用 / 成功率 / 均耗时 / 覆盖会话 / 最后使用
 *   tools  原生工具：同上
 *
 * 口径说明（重要）：skill 的"机会"是关键词匹配，属于**推断**，输出里固定带 inferred:true。
 * 它回答的是"这些会话里提到了相关意图但没调用"，不是"漏调用了就一定是错"。
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { homedir } from 'node:os'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { scanSessions } from './scan.js'
import { aggregate, advise } from './aggregate.js'

export const name = 'capability-audit'

export const inject = ['tools']

const CACHE_TTL_MS = 5 * 60 * 1000
let cache = { at: 0, report: undefined, root: '' }

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function sessionsRoot(explicit) {
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit
  return join(dshHome(), 'sessions')
}

/** 本机实际安装的 skill 目录（两处） */
function installedSkills() {
  const roots = [join(dshHome(), 'skills'), join(homedir(), '.agents', 'skills')]
  const names = []
  for (const root of roots) {
    let entries
    try {
      entries = readdirSync(root)
    } catch {
      continue
    }
    for (const entry of entries) {
      try {
        if (!statSync(join(root, entry)).isDirectory()) continue
      } catch {
        continue
      }
      names.push(entry)
    }
  }
  return [...new Set(names)]
}

function buildReport(root, refresh) {
  const now = Date.now()
  if (!refresh && cache.report !== undefined && cache.root === root && now - cache.at < CACHE_TTL_MS) {
    return { report: cache.report, cached: true }
  }
  const scanned = scanSessions(root)
  const skills = installedSkills()
  const report = aggregate(scanned.sessions, { installedSkills: skills })
  report.health = {
    scannedFiles: scanned.totalFiles,
    parseFailures: scanned.failed,
    installedSkills: skills.length,
    root,
  }
  report.advice = advise(report)
  report.generatedAt = now
  cache = { at: now, report, root }
  return { report, cached: false }
}

/** 工具输出必须是无损 JSON：丢掉 undefined、把 Infinity/NaN 换成 null */
export function toPlain(value) {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === 'number' && !Number.isFinite(v)) return null
      if (typeof v === 'undefined') return undefined
      return v
    }) ?? 'null',
  )
}

const pct = (x) => (x === null || x === undefined ? '  -' : `${Math.round(x * 100)}%`)
const days = (now, t) => (t ? `${Math.round((now - t) / 86400000)}d` : '?')
const ms = (x) => (x === null || x === undefined ? '-' : x >= 1000 ? `${Math.round(x / 1000)}s` : `${x}ms`)

function renderReport(report) {
  const now = Date.now()
  const t = report.totals
  const lines = []
  lines.push(`会话 ${t.sessions} · 工具调用 ${t.toolCalls} · MCP 调用 ${t.mcpCalls}（${pct(t.mcpShare)}）· 用过 MCP 的会话 ${t.mcpSessions}（${pct(t.mcpSessionShare)}）`)
  lines.push(`扫描文件 ${report.health.scannedFiles}，解析失败 ${report.health.parseFailures}；本机装 skill ${report.health.installedSkills} 个`)

  if ((report.profiles ?? []).length > 0) {
    lines.push('')
    lines.push('=== 任务画像（canary 分组用）===')
    for (const p of report.profiles) {
      lines.push(`  ${String(p.profile).padEnd(10)} 会话 ${String(p.sessions).padStart(3)}  tokens ${p.tokens}`)
    }
  }

  const hot = (report.skills ?? []).filter((s) => s.opportunities > 0 || s.calls > 0).slice(0, 20)
  lines.push('')
  lines.push('=== skill：机会 / 触发 / 漏 ===')
  for (const s of hot) {
    const cc = s.contextCost ? `${s.contextCost.tokensPerTurn}tok/轮×${s.contextCost.turns}=${s.contextCost.cumulativeEstTokens}` : '-'
    const at = s.attribution && s.attribution.loadedTurns > 0 ? `  加载${s.attribution.loadedTurns}轮/后续调用${s.attribution.callsAfterLoad}/token${s.attribution.tokensAfterLoad}` : ''
    lines.push(`  ${s.name.padEnd(30)} 机会 ${String(s.opportunities).padStart(4)}  触发 ${String(s.triggeredSessions).padStart(3)}  率 ${pct(s.triggerRate).padStart(4)}  成本 ${cc}${at}${s.installed ? '' : '  (未安装)'}`)
  }

  const mcpTop = (report.mcp ?? []).slice(0, 15)
  lines.push('')
  lines.push('=== MCP server 健康度 ===')
  for (const m of mcpTop) {
    lines.push(`  ${m.key.padEnd(20)} 调用 ${String(m.calls).padStart(4)}  成功 ${pct(m.successRate).padStart(4)}  均 ${ms(m.avgMs).padStart(6)}  会话 ${String(m.sessions).padStart(2)}  最后 ${days(now, m.lastUsedAt)}前`)
  }

  const toolTop = (report.tools ?? []).slice(0, 10)
  lines.push('')
  lines.push('=== 原生工具（前 10）===')
  for (const x of toolTop) {
    lines.push(`  ${x.key.padEnd(20)} 调用 ${String(x.calls).padStart(6)}  成功 ${pct(x.successRate).padStart(4)}  均 ${ms(x.avgMs).padStart(6)}  会话 ${x.sessions}`)
  }

  if ((report.advice ?? []).length > 0) {
    lines.push('')
    lines.push('=== 建议 ===')
    for (const a of report.advice.slice(0, 20)) {
      lines.push(`  [${a.severity}] ${a.kind} · ${a.target}`)
      lines.push(`      ${a.advice}`)
      lines.push(`      证据: ${JSON.stringify(a.evidence)}`)
    }
  }
  return lines.join('\n')
}

export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'dsh_capability_audit',
      description:
        '体检本机的 skill / MCP / 原生工具使用情况：调用次数、成功率、耗时、覆盖会话、最后使用时间，' +
        '并对 skill 算"机会 vs 触发"的漏触发率（只统计该 skill 首次可用之后的对话）。' +
        '结果带建议清单。只读会话日志，不改任何文件。' +
        '注意：skill 的机会是关键词匹配推断，报告里固定标 inferred:true；判读时结合例句。',
      parameters: {
        root: { type: 'string', description: '可选：会话目录，默认 $DSH_HOME/sessions' },
        refresh: { type: 'boolean', description: '可选：跳过 5 分钟缓存，强制重扫' },
        format: { type: 'string', enum: ['json', 'text'], description: '可选：json（默认）| text（人读的表格）' },
        staleDays: { type: 'number', description: '可选：MCP 多久没用算"停用"（默认 21 天）' },
        slowMs: { type: 'number', description: '可选：MCP 均耗时超过多少算慢（默认 60000ms）' },
        topSkills: { type: 'number', description: '可选：skills 表最多返回多少条（默认 50）' },
      },
      execute: async (args) => {
        const root = sessionsRoot(args?.root)
        if (!existsSync(root)) {
          return { ok: false, error: `会话目录不存在：${root}` }
        }
        let built
        try {
          built = buildReport(root, args?.refresh === true)
        } catch (error) {
          return { ok: false, error: `扫描失败：${error?.message ?? error}` }
        }
        const report = built.report
        if (args?.staleDays !== undefined || args?.slowMs !== undefined) {
          report.advice = advise(report, { staleDays: args?.staleDays, slowMs: args?.slowMs })
        }
        if (args?.format === 'text') {
          return { ok: true, text: renderReport(report), cached: built.cached }
        }
        const limit = Number.isFinite(args?.topSkills) ? Math.max(1, args.topSkills) : 50
        return toPlain({
          ok: true,
          cached: built.cached,
          ...report,
          skills: (report.skills ?? []).slice(0, limit),
        })
      },
    }),
  )
}
