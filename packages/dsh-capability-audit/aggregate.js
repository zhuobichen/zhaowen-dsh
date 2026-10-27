/**
 * 聚合 + 建议（纯函数，便于单测）。
 *
 * 口径对齐同类产品的做法：
 *   工具/MCP  调用数 / 成功率 / p50·p95（不用平均值，避免被长尾拉爆）/ 覆盖会话 / 最后使用 / 错误分类
 *   skill     每轮上下文成本（tok/轮 × 轮数）/ 机会 / 触发 / 漏 / 按任务画像细分
 *   归因      skill 加载后同一 turn 里的工具调用与 token（近似 LangSmith 的父子 span 归因）
 *
 * 仍然保留的谦逊之处：skill 的"机会"是关键词推断（inferred:true），不是事实。
 */

export const DEFAULT_ALIAS = {
  'cnki-search': ['知网', 'cnki'],
  'academic-paper-download': ['下载论文'],
  'academic-plotting': ['论文图', '架构图'],
  'nature-figure': ['nature 图'],
  'latex-paper-writing': ['latex', '写论文'],
  zhihu: ['知乎'],
  tieba: ['贴吧'],
  watch: ['看视频', '这个视频', '视频里'],
  'browser-skill': ['浏览器', '打开网页', 'bsk'],
  docx_to_mp: ['docx', '公众号文章'],
  wechat_mp_ops: ['公众号', '草稿箱'],
  'ppt-assembler': ['ppt', '幻灯片', '演示文稿'],
  'photo-to-scan': ['扫描', '拍照'],
  'memory-organizer': ['整理记忆', 'memory'],
  'prompt-auditor': ['审计提示词'],
  'khazix-writer': ['公众号长文'],
  'reverse-engineer-anything': ['逆向', '反编译', '脱壳'],
  'agent-dialog_management': ['会话检索', '导出会话'],
  'dsh-session-viewer': ['dsh 会话', '会话日志'],
  onehub_usage_monitor: ['onehub', '中转额度'],
  'research_evidence_synthesis': ['证据综合', '文献综述'],
  'remote-exec': ['云服务器', '远程执行'],
  'agent-dispatch': ['子代理', '子 agent'],
  'zcode-kimi-integration': ['zcode', 'kimi code'],
  'android-phone-ops': ['安卓', '模拟器'],
  'aram-mayhem-assistant': ['大乱斗'],
  'kb-capture': ['知识库卡片'],
  'obsidian-wiki-workflow': ['obsidian'],
  'n8n-web-ops': ['n8n'],
  'abacas-cloud-ops': ['abacas'],
}

/** 工具族：给会话打"任务画像"，canary 按画像分组 */
export const TOOL_FAMILY = {
  code: ['pwsh', 'PowerShell', 'Bash', 'bash', 'ops_bash', 'edit', 'Edit', 'write', 'Write', 'read', 'Read', 'grep', 'Grep', 'glob', 'Glob', 'ops_grep', 'ops_glob', 'ops_replace', 'ops_inspect_local_file'],
  research: ['web_fetch', 'web_search', 'WebFetch', 'WebSearch'],
  browser: ['browser_act', 'browser', 'bsk'],
  docs: ['tencent-docs', 'tencent_docs', 'docx'],
  media: ['read_image', 'generate_image', 'edit_image', 'watch'],
  blender: ['blender_rt_do', 'blender_rt_see', 'blender_rt_headless', 'blender_viewport'],
  rea: ['rea'],
}

const FAMILY_OF = new Map()
for (const [family, names] of Object.entries(TOOL_FAMILY)) {
  for (const n of names) FAMILY_OF.set(n, family)
}

/** 去掉会自我命中的目录块（技能清单本身含每个名字） */
export function stripCatalogs(text) {
  return String(text)
    .replace(/<available_skills>[\s\S]*?<\/available_skills>/gi, ' ')
    .replace(/<available_tools>[\s\S]*?<\/available_tools>/gi, ' ')
    .replace(/The following skills are available in this session:[\s\S]*?(?=\n\n|$)/gi, ' ')
}

const round = (x) => Math.round(x * 1000) / 1000

/** 分位数：比平均值抗异常值 */
export function percentile(list, p) {
  if (!Array.isArray(list) || list.length === 0) return null
  const sorted = [...list].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return Math.round(sorted[idx])
}

/** 失败归类：给"修哪里"提供线索 */
export function classifyError(text) {
  const t = String(text ?? '')
  if (/timeout|timed out|ETIMEDOUT|deadline/i.test(t)) return 'timeout'
  if (/permission|denied|EPERM|EACCES|not allowed|sandbox/i.test(t)) return 'permission'
  if (/not found|ENOENT|no such file|404/i.test(t)) return 'not-found'
  if (/exit code [1-9]/i.test(t)) return 'nonzero-exit'
  if (/invalid|malformed|parse|schema/i.test(t)) return 'invalid-input'
  return 'other'
}

const bucket = (map, key) => {
  if (!map.has(key)) {
    map.set(key, {
      calls: 0,
      ok: 0,
      fail: 0,
      durations: [],
      errorTypes: new Map(),
      sessions: new Set(),
      families: new Map(),
      first: Infinity,
      last: 0,
    })
  }
  return map.get(key)
}

function familyOfTool(name) {
  if (name.startsWith('mcp__')) {
    const server = name.split('__')[1] ?? ''
    return FAMILY_OF.get(server) ?? 'mcp'
  }
  return FAMILY_OF.get(name) ?? 'other'
}

/** 会话画像：按工具族出现次数取主导；没有明显主导就算 mixed */
export function profileOf(calls) {
  const counts = new Map()
  for (const c of calls ?? []) {
    if (c.name === 'skill') continue // 加载 skill 是元动作，不代表任务类型
    const fam = familyOfTool(c.name)
    counts.set(fam, (counts.get(fam) ?? 0) + 1)
  }
  if (counts.size === 0) return 'empty'
  const total = [...counts.values()].reduce((a, b) => a + b, 0)
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  return top[1] / total >= 0.6 ? top[0] : 'mixed'
}

/**
 * 归因：skill 加载后，同一 turn 里后续的工具调用与 token。
 * 这是 trace 父子关系的近似——DSH 没有 skill→tool 的显式 span，但同 turn 的先后顺序足够强。
 */
export function attributeSkillTurns(session) {
  const byTurn = new Map()
  const ensure = (turn) => {
    if (!byTurn.has(turn)) byTurn.set(turn, { calls: [], usages: [] })
    return byTurn.get(turn)
  }
  for (const c of session.calls ?? []) ensure(c.turn ?? 0).calls.push(c)
  for (const u of session.usages ?? []) ensure(u.turn ?? 0).usages.push(u)

  const out = new Map()
  for (const [, group] of byTurn) {
    const skillCalls = group.calls.filter((c) => c.name === 'skill' && (c.args?.name || c.args?.skill))
    if (skillCalls.length === 0) continue
    for (const sc of skillCalls) {
      const name = sc.args.name ?? sc.args.skill
      const step = sc.step ?? 0
      const after = group.calls.filter((c) => c !== sc && (c.step ?? 0) > step && c.name !== 'skill')
      const tokens = group.usages.filter((u) => (u.step ?? 0) >= step).reduce((a, u) => a + (u.total ?? 0), 0)
      const rec = out.get(name) ?? { loadedTurns: 0, callsAfterLoad: 0, tokensAfterLoad: 0 }
      rec.loadedTurns++
      rec.callsAfterLoad += after.length
      rec.tokensAfterLoad += tokens
      out.set(name, rec)
    }
  }
  return out
}

/**
 * @param sessions scanSessions().sessions
 * @param options  { alias?, installedSkills? }
 */
export function aggregate(sessions, options = {}) {
  const alias = { ...DEFAULT_ALIAS, ...(options.alias ?? {}) }
  const tools = new Map()
  const mcp = new Map()
  const skillCalls = new Map()
  const skillSeen = new Map()
  const attribution = new Map()
  const profileOfSession = new Map()
  const tokensBySession = new Map()
  const tokenSums = { input: 0, output: 0, cacheRead: 0, total: 0 }
  let totalCalls = 0
  let mcpCalls = 0
  const mcpSessions = new Set()

  for (const s of sessions) {
    for (const [name, t] of s.availableSkills ?? []) {
      const prev = skillSeen.get(name)
      if (prev === undefined || t < prev) skillSeen.set(name, t)
    }

    profileOfSession.set(s.sessionId, profileOf(s.calls))
    tokensBySession.set(s.sessionId, (s.usages ?? []).reduce((a, u) => a + (u.total ?? 0), 0))
    for (const u of s.usages ?? []) {
      tokenSums.input += u.input ?? 0
      tokenSums.output += u.output ?? 0
      tokenSums.cacheRead += u.cacheRead ?? 0
      tokenSums.total += u.total ?? 0
    }

    for (const [name, rec] of attributeSkillTurns(s)) {
      const acc = attribution.get(name) ?? { loadedTurns: 0, callsAfterLoad: 0, tokensAfterLoad: 0 }
      acc.loadedTurns += rec.loadedTurns
      acc.callsAfterLoad += rec.callsAfterLoad
      acc.tokensAfterLoad += rec.tokensAfterLoad
      attribution.set(name, acc)
    }

    const pending = new Map()
    for (const call of s.calls ?? []) {
      totalCalls++
      const isMcp = call.name.startsWith('mcp__')
      const target = isMcp ? mcp : tools
      const key = isMcp ? (call.name.split('__')[1] ?? '(unknown)') : call.name
      const b = bucket(target, key)
      b.calls++
      b.sessions.add(s.sessionId)
      b.first = Math.min(b.first, call.time || Infinity)
      b.last = Math.max(b.last, call.time || 0)
      const fam = familyOfTool(call.name)
      b.families.set(fam, (b.families.get(fam) ?? 0) + 1)
      if (call.callId) pending.set(call.callId, { key, time: call.time, isMcp })

      if (isMcp) {
        mcpCalls++
        mcpSessions.add(s.sessionId)
      }

      if (call.name === 'skill') {
        const skillName = call.args?.name ?? call.args?.skill
        if (skillName) {
          const b2 = bucket(skillCalls, skillName)
          b2.calls++
          b2.sessions.add(s.sessionId)
          b2.first = Math.min(b2.first, call.time || Infinity)
          b2.last = Math.max(b2.last, call.time || 0)
        }
      }
    }

    for (const r of s.results ?? []) {
      const p = pending.get(r.callId)
      if (!p) continue
      const target = p.isMcp ? mcp : tools
      const b = target.get(p.key)
      if (!b) continue
      if (r.ok) b.ok++
      else {
        b.fail++
        const kind = classifyError(r.text)
        b.errorTypes.set(kind, (b.errorTypes.get(kind) ?? 0) + 1)
      }
      if (r.time && p.time) b.durations.push(Math.max(0, r.time - p.time))
      pending.delete(r.callId)
    }
  }

  const skills = buildSkillRows(sessions, skillCalls, skillSeen, alias, options.installedSkills, attribution, profileOfSession)

  return {
    totals: {
      sessions: sessions.length,
      toolCalls: totalCalls,
      mcpCalls,
      mcpShare: totalCalls === 0 ? 0 : round(mcpCalls / totalCalls),
      mcpSessions: mcpSessions.size,
      mcpSessionShare: sessions.length === 0 ? 0 : round(mcpSessions.size / sessions.length),
      tokens: tokenSums.total,
      tokenBreakdown: {
        input: tokenSums.input,
        output: tokenSums.output,
        cacheRead: tokenSums.cacheRead,
        total: tokenSums.total,
        note: '每步都会重发整段历史，所以这是累计计费量；input/cacheRead 是大头，output 才是生成',
      },
    },
    profiles: summarizeProfiles(sessions, profileOfSession, tokensBySession),
    tools: tableOf(tools),
    mcp: tableOf(mcp),
    skills,
  }
}

function summarizeProfiles(sessions, profileOfSession, tokensBySession) {
  const map = new Map()
  for (const s of sessions) {
    const p = profileOfSession.get(s.sessionId) ?? 'empty'
    const rec = map.get(p) ?? { sessions: 0, tokens: 0 }
    rec.sessions++
    rec.tokens += tokensBySession.get(s.sessionId) ?? 0
    map.set(p, rec)
  }
  return [...map.entries()].map(([profile, v]) => ({ profile, ...v })).sort((a, b) => b.sessions - a.sessions)
}

function buildSkillRows(sessions, skillCalls, skillSeen, alias, installedSkills, attribution, profileOfSession) {
  const names = new Set([...skillSeen.keys(), ...skillCalls.keys(), ...(installedSkills ?? [])])

  const charsByName = new Map()
  for (const s of sessions) {
    for (const [name, rec] of s.skillChars ?? []) {
      const acc = charsByName.get(name) ?? { sum: 0, n: 0 }
      acc.sum += rec.sum
      acc.n += rec.n
      charsByName.set(name, acc)
    }
  }

  const rows = []
  for (const name of names) {
    const birth = skillSeen.get(name) ?? 0
    const words = [name, ...(alias[name] ?? [])].map((w) => String(w).toLowerCase())

    let turnsAfterBirth = 0
    const oppByProfile = new Map()
    const trigByProfile = new Map()
    for (const s of sessions) {
      const profile = profileOfSession.get(s.sessionId) ?? 'empty'
      let hit = false
      for (const m of s.msgs ?? []) {
        if (m.time < birth) continue
        turnsAfterBirth++
        if (!hit && words.some((w) => w && stripCatalogs(m.text).toLowerCase().includes(w))) hit = true
      }
      if (hit) oppByProfile.set(profile, (oppByProfile.get(profile) ?? 0) + 1)
      if (skillCalls.get(name)?.sessions.has(s.sessionId) === true) {
        trigByProfile.set(profile, (trigByProfile.get(profile) ?? 0) + 1)
      }
    }

    const opp = [...oppByProfile.values()].reduce((a, b) => a + b, 0)
    const trig = skillCalls.get(name)?.sessions.size ?? 0

    const chars = charsByName.get(name)
    const charsPerTurn = chars && chars.n > 0 ? Math.round(chars.sum / chars.n) : null
    const tokensPerTurn = charsPerTurn === null ? null : Math.round(charsPerTurn / 2.5)

    const byProfile = {}
    for (const p of new Set([...oppByProfile.keys(), ...trigByProfile.keys()])) {
      byProfile[p] = { opportunities: oppByProfile.get(p) ?? 0, triggered: trigByProfile.get(p) ?? 0 }
    }

    rows.push({
      name,
      firstAvailableAt: birth || undefined,
      calls: skillCalls.get(name)?.calls ?? 0,
      triggeredSessions: trig,
      opportunities: opp,
      missed: Math.max(0, opp - trig),
      triggerRate: opp === 0 ? null : round(trig / opp),
      lastUsedAt: skillCalls.get(name)?.last || undefined,
      installed: (installedSkills ?? []).includes(name),
      byProfile,
      attribution: attribution.get(name) ?? { loadedTurns: 0, callsAfterLoad: 0, tokensAfterLoad: 0 },
      contextCost:
        tokensPerTurn === null
          ? null
          : {
              charsPerTurn,
              tokensPerTurn,
              turns: turnsAfterBirth,
              cumulativeEstTokens: tokensPerTurn * turnsAfterBirth,
              assumption: 'chars/2.5 粗估；只算清单行，不含 skill 正文（正文只在调用时载入）',
            },
      inferred: true,
    })
  }
  return rows.sort((a, b) => b.missed - a.missed || b.opportunities - a.opportunities)
}

function tableOf(map) {
  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      calls: v.calls,
      ok: v.ok,
      failed: v.fail,
      successRate: v.ok + v.fail === 0 ? null : round(v.ok / (v.ok + v.fail)),
      avgMs: v.durations.length === 0 ? null : Math.round(v.durations.reduce((a, b) => a + b, 0) / v.durations.length),
      p50Ms: percentile(v.durations, 0.5),
      p95Ms: percentile(v.durations, 0.95),
      errorTypes: Object.fromEntries([...v.errorTypes.entries()].sort((a, b) => b[1] - a[1])),
      sessions: v.sessions.size,
      families: Object.fromEntries(v.families),
      firstUsedAt: Number.isFinite(v.first) ? v.first : undefined,
      lastUsedAt: v.last || undefined,
    }))
    .sort((a, b) => b.calls - a.calls)
}

/**
 * 建议规则（每条都带证据）
 * @param options { now?, staleDays?, slowMs?, costlyTokens? }
 */
export function advise(report, options = {}) {
  const now = options.now ?? Date.now()
  const staleDays = options.staleDays ?? 21
  const slowMs = options.slowMs ?? 60000
  const costlyTokens = options.costlyTokens ?? 200000
  const out = []

  for (const s of report.skills ?? []) {
    const ageDays = s.firstAvailableAt ? Math.round((now - s.firstAvailableAt) / 86400000) : undefined

    if (s.installed && s.calls === 0 && (ageDays === undefined || ageDays >= 3)) {
      out.push({
        kind: 'skill-never-used',
        target: s.name,
        severity: (s.contextCost?.cumulativeEstTokens ?? 0) > costlyTokens ? 'high' : 'medium',
        evidence: {
          availableForDays: ageDays ?? null,
          opportunities: s.opportunities,
          contextCost: s.contextCost?.cumulativeEstTokens ?? null,
        },
        advice: '装了但一次没调用；建议先移到归档目录或停用（别直接删，低频任务可能还会用到）',
      })
      continue
    }

    if (s.opportunities >= 5 && s.triggerRate !== null && s.triggerRate <= 0.2) {
      out.push({
        kind: 'skill-trigger-mismatch',
        target: s.name,
        severity: s.opportunities >= 20 ? 'high' : 'medium',
        evidence: { opportunities: s.opportunities, triggered: s.triggeredSessions, rate: s.triggerRate, byProfile: s.byProfile, inferred: true },
        advice: '描述里可能缺中文触发词（或关键词表过宽）；先看例句再决定改描述还是改匹配表',
      })
    }

    const cost = s.contextCost?.cumulativeEstTokens ?? 0
    if (cost >= costlyTokens && s.triggerRate !== null && s.triggerRate <= 0.2) {
      out.push({
        kind: 'skill-costly-idle',
        target: s.name,
        severity: 'high',
        evidence: { cumulativeEstTokens: cost, rate: s.triggerRate, turns: s.contextCost?.turns ?? null },
        advice: '每轮都在付上下文成本却极少触发；优先归档',
      })
    }

    if (s.attribution.loadedTurns > 0 && s.attribution.callsAfterLoad === 0) {
      out.push({
        kind: 'skill-loaded-no-work',
        target: s.name,
        severity: 'low',
        evidence: { loadedTurns: s.attribution.loadedTurns, callsAfterLoad: 0 },
        advice: '加载过但那一轮没有后续工具调用；可能"拉进来了却没用"，也可能纯问答',
      })
    }
  }

  for (const m of report.mcp ?? []) {
    const days = m.lastUsedAt ? Math.round((now - m.lastUsedAt) / 86400000) : undefined
    if (m.sessions <= 1 && days !== undefined && days >= staleDays) {
      out.push({
        kind: 'mcp-one-off',
        target: m.key,
        severity: 'low',
        evidence: { sessions: m.sessions, calls: m.calls, daysSinceUse: days },
        advice: '只在一个会话里用过；不占每轮上下文，可保留，但不必当常驻能力',
      })
    }
    if (m.p95Ms !== null && m.p95Ms >= slowMs) {
      out.push({
        kind: 'mcp-slow',
        target: m.key,
        severity: 'medium',
        evidence: { p95Ms: m.p95Ms, avgMs: m.avgMs, calls: m.calls },
        advice: 'p95 耗时过高（平均值可能被单次异常拉爆）；给它加超时或改成显式异步',
      })
    }
    if (m.successRate !== null && m.successRate < 0.9 && m.calls >= 3) {
      out.push({
        kind: 'mcp-flaky',
        target: m.key,
        severity: 'medium',
        evidence: { successRate: m.successRate, failed: m.failed, calls: m.calls, errorTypes: m.errorTypes },
        advice: '失败率偏高；按错误分类看是哪一类再决定修还是弃',
      })
    }
  }

  for (const t of report.tools ?? []) {
    if (t.calls >= 20 && t.successRate !== null && t.successRate < 0.9) {
      out.push({
        kind: 'tool-flaky',
        target: t.key,
        severity: 'medium',
        evidence: { successRate: t.successRate, failed: t.failed, calls: t.calls, errorTypes: t.errorTypes },
        advice: '高频且失败率 >10%，按错误分类看主要失败原因',
      })
    }
  }

  return out.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
}

const severityRank = (s) => (s === 'high' ? 3 : s === 'medium' ? 2 : 1)
