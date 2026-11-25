/**
 * 破甲工具台（dsh-mowan-console）
 *
 * 目标：**只改指定的会话**，而且每一次改动都留下可查的记录。
 *
 * 两层能力，分别挂在 DSH 的两个正规钩子上（都不改宿主源码）：
 *
 *   ① 软注入  —— ctx.systemPrompt.section()，每轮组装都会调用一次。
 *                 因为系统提示本来就是每轮重新组的，注入立刻生效，**不用开新会话、不丢历史**。
 *                 注入内容按 sessionId 匹配，别的会话看不到。
 *
 *   ② 换模型  —— ctx.on('agent/request')（waterfall）。它拿到 payload.agent（即 sessionId），
 *                 并能替换本次调用的 LlmCallConfig（provider / model / temperature …）。
 *                 这是把某个会话"换个脑子"的唯一正规办法：
 *                 文档明确写了这个 waterfall "cannot mutate messages"，所以它只改模型参数。
 *
 * 每一次「谁、对哪个会话、改了什么都记进 changes.jsonl（append-only），
 * 每轮注入也会记一条，所以你能看到"这条规则到底有没有真的用上"。
 *
 * ⚠️ 只影响被点名的会话；不碰宿主文件、不碰审批、不碰沙箱。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'

const NAME = 'dsh-mowan-console'

/** 提示词片段插在靠后的位置：靠前会被后面的段落覆盖掉影响。 */
const SECTION_ORDER = 5100

function dshHome() {
  return process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
}

function storeDir() {
  return join(dshHome(), 'plugins', NAME)
}

function rulesPath() {
  return join(storeDir(), 'rules.json')
}

function logPath() {
  return join(storeDir(), 'changes.jsonl')
}

function ensureDir() {
  const d = storeDir()
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

/** 规则文件：{ sessions: { [sessionId]: { prompt: Fragment[], model: ModelRule|null } } } */
function loadRules() {
  try {
    const raw = JSON.parse(readFileSync(rulesPath(), 'utf8'))
    if (raw && typeof raw === 'object' && raw.sessions && typeof raw.sessions === 'object') return raw
  } catch {
    // 文件不存在或坏了：当作空规则
  }
  return { sessions: {} }
}

function saveRules(rules) {
  ensureDir()
  writeFileSync(rulesPath(), JSON.stringify(rules, null, 2), 'utf8')
}

/** 审计：一行一条，append-only，永远不会被后面的改动覆盖。 */
function audit(entry) {
  try {
    ensureDir()
    appendFileSync(logPath(), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', 'utf8')
  } catch {
    // 记不上日志不影响主流程
  }
}

function readLog(limit = 50) {
  try {
    const lines = readFileSync(logPath(), 'utf8').split('\n').filter(Boolean)
    return lines.slice(-limit).map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return { raw: l }
      }
    })
  } catch {
    return []
  }
}

function shortId(id) {
  return typeof id === 'string' && id.length > 20 ? id.slice(0, 8) + '…' + id.slice(-6) : String(id ?? '')
}

export const name = NAME

/** systemPrompt / agents 用来注入与定位；tools 用来注册工具。webServer 可选（有面板才需要）。 */
export const inject = {
  systemPrompt: { required: true },
  tools: { required: true },
  agents: { required: false },
  webServer: { required: false },
}

export function apply(ctx, config = {}) {
  ensureDir()

  /** 当前规则的内存副本；改动后立刻写盘，读的时候以磁盘为准（多实例也不会打架）。 */
  let rules = loadRules()

  /** 上次读盘时 rules.json 的 mtime，用来判断"外面有人手改过"。 */
  let rulesMtime = (() => {
    try {
      return statSync(rulesPath()).mtimeMs
    } catch {
      return 0
    }
  })()

  function reload() {
    rules = loadRules()
    try {
      rulesMtime = statSync(rulesPath()).mtimeMs
    } catch {
      rulesMtime = 0
    }
    return rules
  }

  /**
   * 热载：**手改 rules.json 也立刻生效**。
   *
   * 之前只有工具 execute 里才 reload()，所以手改文件要等下一次 mowan 调用才被读到
   * —— 那是假的"热载"。这里按 mtime 判断，每轮组装/每次请求都顺带检查一次，
   * 文件没变就只多一次 stat()，几乎零成本。
   */
  function loadIfChanged() {
    try {
      const m = statSync(rulesPath()).mtimeMs
      if (m !== rulesMtime) {
        rules = loadRules()
        rulesMtime = m
        audit({ op: 'reload', note: 'rules.json 被外部修改，已重新载入' })
      }
    } catch {
      // 文件不存在 / 读不到：沿用内存里的旧规则
    }
    return rules
  }

  const fragmentsOf = (sessionId) => {
    const s = rules.sessions?.[sessionId]
    if (!s || !Array.isArray(s.prompt)) return []
    return s.prompt.filter((f) => f && f.enabled !== false && typeof f.text === 'string' && f.text.trim() !== '')
  }

  const modelOf = (sessionId) => {
    const m = rules.sessions?.[sessionId]?.model
    if (!m || typeof m.model !== 'string' || m.model.trim() === '') return null
    return m
  }

  // ──────────────────────────────────────────────────────────────────────
  // ① 软注入：每轮组装时按会话拼一段提示词
  // ──────────────────────────────────────────────────────────────────────
  //
  // 这里的难点：PromptSection.text 拿到的 AssembleContext 只有 { scope, signal }，
  // **没有 sessionId**。所以用 agents.currentInitiator() 反查当前正在跑的是哪个 agent
  // —— 组装发生在该 agent 的异步链里，这个服务就是为这种场景设计的。
  //
  // 拿不到 agent 时（例如子组装、或链路断了）就返回空串：宁可少注入，也不要注入错人。
  const injectedThisTurn = new Map() // sessionId -> 上次注入的片段数，用于去重打日志

  ctx.systemPrompt.section({
    name: 'mowan-injected',
    order: SECTION_ORDER,
    text: () => {
      let agent
      try {
        agent = ctx.agents?.currentInitiator?.()
      } catch {
        agent = undefined
      }
      const sessionId = agent && typeof agent.id === 'string' ? String(agent.id) : ''
      if (sessionId === '') return ''

      loadIfChanged() // 手改 rules.json 也在这里被读到
      const frags = fragmentsOf(sessionId)
      if (frags.length === 0) {
        if (injectedThisTurn.has(sessionId)) {
          injectedThisTurn.delete(sessionId)
          audit({ op: 'inject/off', sessionId, session: shortId(sessionId) })
        }
        return ''
      }

      const body = frags.map((f) => f.text.trim()).join('\n\n')
      const text = ['【会话专属设定（仅本会话生效）】', body].join('\n')
      injectedThisTurn.set(sessionId, frags.length)
      audit({
        op: 'inject',
        sessionId,
        session: shortId(sessionId),
        fragments: frags.map((f) => f.id ?? null),
        chars: text.length,
      })
      return text
    },
  })

  // ──────────────────────────────────────────────────────────────────────
  // ② 换模型：只对该会话生效
  // ──────────────────────────────────────────────────────────────────────
  ctx.on('agent/request', async (payload, next) => {
    const base = await next()
    const sessionId = payload?.agent?.id ? String(payload.agent.id) : ''
    if (sessionId === '') return base

    loadIfChanged() // 手改 rules.json 也在这里被读到
    const rule = modelOf(sessionId)
    if (!rule) return base

    const nextConf = { ...base, provider: rule.provider || base.provider, model: rule.model }
    if (Number.isFinite(rule.temperature)) nextConf.temperature = rule.temperature
    if (Number.isFinite(rule.maxTokens)) nextConf.maxTokens = rule.maxTokens

    audit({
      op: 'model',
      sessionId,
      session: shortId(sessionId),
      from: { provider: base.provider, model: base.model },
      to: { provider: nextConf.provider, model: nextConf.model },
    })
    return nextConf
  })

  audit({ op: 'boot', note: '破甲工具台已加载', rules: Object.keys(rules.sessions ?? {}).length })

  // ──────────────────────────────────────────────────────────────────────
  // 工具：管理规则 + 查审计
  // ──────────────────────────────────────────────────────────────────────
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

  /** 从工具 exec 里尽力取调用方会话 id（不同 DSH 版本字段名不完全一致）。 */
  function callerIdOf(exec) {
    const candidates = [exec?.agent?.id, exec?.session?.id, exec?.sessionId, exec?.caller?.id, exec?.ctx?.agents?.currentInitiator?.()?.id]
    for (const c of candidates) {
      if (typeof c === 'string' && c !== '') return c
    }
    return ''
  }

  // AI 读面板同款数据的通道（与 /mowan-state 共用 snapshot()）
  ctx.tools.register(
    defineTool({
      name: 'mowan_view',
      description:
        '破甲工作台的数据通道：**人看到的面板内容，AI 用这个读同一份**。\n' +
        'op=state 全部状态（规则卡/会话标题/运行中/三个统计/审计日志）；' +
        'op=rules 只看规则；op=log 只看改动记录（可按 op 筛）；op=stats 只看统计；' +
        'op=export 导出整包 JSON。\n' +
        '要**改**规则请用 mowan 工具；这个工具只读。',
      parameters: {
        op: { type: 'string', required: true, description: 'state | rules | log | stats | export' },
        filter: { type: 'string', description: 'op=log 时按动作筛：inject | set_*' },
        limit: { type: 'number', description: 'op=log 返回条数，默认 30' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: typeof value?.note === 'string' ? value.note : JSON.stringify(value, null, 2) }],
      },
      execute: async (args) => {
        const op = String(args.op ?? 'state').trim()
        const snap = snapshot()
        if (op === 'state' || op === 'export') {
          return { ...snap, note: JSON.stringify(snap, null, 2) }
        }
        if (op === 'rules') {
          const rows = snap.rules.map((r) => ({
            session: r.session,
            title: snap.titles[r.sessionId] || '',
            live: snap.live.indexOf(r.sessionId) >= 0,
            chars: r.promptChars,
            model: r.model?.model ?? '默认',
            prompt: r.promptText,
          }))
          return {
            ok: true,
            count: rows.length,
            rules: rows,
            note: rows.length === 0
              ? '还没有任何规则。用 mowan op=set_prompt 给某个会话加一条。'
              : rows.map((r) => `[${r.live ? '运行中' : '休眠'}] ${r.title} (${r.session}) · 注入${r.chars}字 · 模型${r.model}\n  ${r.prompt.slice(0, 120)}`).join('\n'),
          }
        }
        if (op === 'log') {
          const filter = String(args.filter ?? '').trim()
          const limit = Number(args.limit) > 0 ? Math.floor(Number(args.limit)) : 30
          let rows = snap.log
          if (filter !== '') rows = rows.filter((e) => filter === 'inject' ? e.op === 'inject' : String(e.op ?? '').indexOf('set_') === 0)
          rows = rows.slice(0, limit)
          return {
            ok: true,
            count: rows.length,
            log: rows,
            note: rows.length === 0 ? '没有匹配的记录。' : rows.map((e) => `${e.at || ''} ${e.op || '?'} ${e.session || ''} ${e.note || ''}`).join('\n'),
          }
        }
        if (op === 'stats') {
          return { ok: true, ...snap.stats, at: snap.at, note: `被改会话 ${snap.stats.rules} · 运行中 ${snap.stats.live} · 注入次数 ${snap.stats.injected}` }
        }
        return { ok: false, code: 'UNKNOWN_OP', error: `op 只支持 state | rules | log | stats | export，收到：${op}` }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'mowan',
      description:
        '破甲工具台：**只对指定会话**做两类改动，并记进审计日志。\n' +
        'op=status 查看全部规则；op=set_prompt 追加/覆盖软注入文本（每轮生效，不丢历史）；' +
        'op=clear_prompt 清空该会话注入；op=set_model 把该会话的模型换掉；op=clear_model 复原；' +
        'op=log 看最近的改动记录（谁、对哪个会话、改了什么、每轮注入是否真的发生）。\n' +
        'session_id 必须精确给出（可用 op=status 查已有规则的会话；或先用 sandbox_sessions 拿 id）。',
      parameters: {
        op: {
          type: 'string',
          required: true,
          description: 'status | set_prompt | clear_prompt | set_model | clear_model | log',
        },
        session_id: { type: 'string', description: '目标会话 id（set_*/clear_* 必填）。' },
        text: { type: 'string', description: 'set_prompt 的注入正文（会替换该会话原有的注入）。' },
        provider: { type: 'string', description: 'set_model 的 provider（省略则沿用当前）。' },
        model: { type: 'string', description: 'set_model 的模型名（必填）。' },
        temperature: { type: 'number', description: 'set_model 可选：温度。' },
        max_tokens: { type: 'number', description: 'set_model 可选：最大 token。' },
        note: { type: 'string', description: '可选：这次改动的备注，会一起进审计。' },
        limit: { type: 'number', description: 'op=log 返回最近多少条，默认 30。' },
      },
      output: OUTPUT,
      execute: async (args, exec) => {
        reload()
        const op = String(args.op ?? '').trim()
        const caller = callerIdOf(exec)
        const target = String(args.session_id ?? '').trim()

        if (op === 'status') {
          const rows = Object.entries(rules.sessions ?? {}).map(([id, r]) => ({
            sessionId: id,
            session: shortId(id),
            promptChars: Array.isArray(r?.prompt) ? r.prompt.reduce((n, f) => n + String(f?.text ?? '').length, 0) : 0,
            promptSetAt: r?.prompt?.[0]?.at ?? null,
            model: r?.model ?? null,
          }))
          return {
            ok: true,
            sessions: rows,
            count: rows.length,
            rulesPath: rulesPath(),
            logPath: logPath(),
            note:
              rows.length === 0
                ? `当前没有任何规则。文件：${rulesPath()}`
                : rows.map((r) => `${r.session}  prompt=${r.promptChars}字  model=${r.model?.model ?? '(默认)'}`).join('\n'),
          }
        }

        if (op === 'log') {
          const limit = Number(args.limit) > 0 ? Number(args.limit) : 30
          const rows = readLog(limit)
          return {
            ok: true,
            entries: rows,
            count: rows.length,
            note: rows
              .map((e) => `${e.at}  ${e.op}  ${e.session ?? ''}${e.model ? '  ' + e.model : ''}${e.fragment ? '  ' + e.fragment : ''}`)
              .join('\n') || '(还没有记录)',
          }
        }

        if (op === 'set_prompt' || op === 'clear_prompt' || op === 'set_model' || op === 'clear_model') {
          if (target === '') return { ok: false, code: 'MISSING_SESSION', error: '需要 session_id。' }
          const bucket = (rules.sessions[target] ??= { prompt: [], model: null })
          const before = JSON.parse(JSON.stringify(bucket))

          if (op === 'set_prompt') {
            const text = String(args.text ?? '')
            if (text.trim() === '') return { ok: false, code: 'EMPTY_TEXT', error: 'text 不能为空；要清空请用 clear_prompt。' }
            bucket.prompt = [{ id: 'main', text, enabled: true, at: new Date().toISOString(), note: args.note ?? null }]
          } else if (op === 'clear_prompt') {
            bucket.prompt = []
          } else if (op === 'set_model') {
            const model = String(args.model ?? '').trim()
            if (model === '') return { ok: false, code: 'MISSING_MODEL', error: '需要 model。' }
            bucket.model = {
              provider: String(args.provider ?? '').trim() || null,
              model,
              temperature: Number.isFinite(Number(args.temperature)) ? Number(args.temperature) : undefined,
              maxTokens: Number.isFinite(Number(args.max_tokens)) ? Number(args.max_tokens) : undefined,
              at: new Date().toISOString(),
              note: args.note ?? null,
            }
          } else {
            bucket.model = null
          }

          saveRules(rules)
          audit({
            op: op,
            sessionId: target,
            session: shortId(target),
            caller: caller || null,
            callerSession: shortId(caller),
            before,
            after: bucket,
            note: args.note ?? null,
          })
          // 让下一次组装/请求立刻读到新规则
          ctx.emit?.(`system-prompt/change`)
          return {
            ok: true,
            sessionId: target,
            note:
              `${op} 已生效于 ${shortId(target)}（下一轮开始）。` +
              `软注入每轮组装时读取；模型在 agent/request 生效。日志：${logPath()}`,
          }
        }

        return { ok: false, code: 'UNKNOWN_OP', error: `不认识的 op: ${op}` }
      },
    }),
  )

  // ──────────────────────────────────────────────────────────────────────
  // ③ 给 Web 面板的状态接口
  // ──────────────────────────────────────────────────────────────────────
  //
  // ⚠️ handler 必须是**同步**的：异步 handler 会被框架提前结束响应（qq-panel 踩过，
  //    拿到的 body 是空的）。所以这里全是 readFileSync / 内存读取。
  const ws = ctx.webServer
  if (ws && typeof ws.register === 'function') {
    // 热重载时旧路由不会被释放，重复注册会抛 duplicate prefix route，
    // 那会让整个插件激活失败（面板和 mowan 工具一起没了）。这里吞掉，等下次重启 DSH 才换新 handler。
    /**
     * 面板与 AI 工具共用的状态快照——这是「AI base 工作台」的基础：
     * 人看到的规则卡/日志/统计，和 AI 通过 mowan_view 读到的是同一份数据。
     */
    const snapshot = () => {
      loadIfChanged()
      const ruleRows = Object.entries(rules.sessions ?? {}).map(([id, r]) => ({
        sessionId: id,
        session: shortId(id),
        promptText: Array.isArray(r?.prompt) ? (r.prompt.find((f) => f && f.enabled !== false)?.text ?? '') : '',
        promptChars: Array.isArray(r?.prompt)
          ? r.prompt.reduce((n, f) => n + String(f?.text ?? '').length, 0)
          : 0,
        model: r?.model ?? null,
        changedAt: r?.prompt?.[0]?.at ?? r?.model?.at ?? null,
      }))

      let live = []
      try {
        live = (ctx.agents?.list?.() ?? []).map((a) => String(a?.id ?? '')).filter(Boolean)
      } catch {
        live = []
      }

      let titles = {}
      let meta = {}
      try {
        const store = ctx.get?.('sessions')
        const all = store && typeof store.list === 'function' ? Array.from(store.list() ?? []) : []
        for (const item of all) {
          const id = String(item?.id ?? item?.sessionId ?? '')
          if (id === '') continue
          titles[id] = String(item?.title ?? '') || '(无标题)'
          meta[id] = {
            lastActive: item?.updatedAt ?? item?.lastActiveAt ?? item?.lastMessageAt ?? null,
            messages:
              typeof item?.messageCount === 'number'
                ? item.messageCount
                : Array.isArray(item?.messages)
                  ? item.messages.length
                  : null,
          }
        }
      } catch {
        titles = {}
        meta = {}
      }

      const log = readLog(120)
      return {
        ok: true,
        at: new Date().toISOString(),
        rulesPath: rulesPath(),
        logPath: logPath(),
        rules: ruleRows,
        live,
        titles,
        meta,
        log,
        // 面板顶栏那三个数字，AI 也该能读到同一份口径
        stats: {
          rules: ruleRows.length,
          live: ruleRows.filter((r) => live.indexOf(r.sessionId) >= 0).length,
          injected: log.filter((e) => e && e.op === 'inject').length,
        },
      }
    }

    const safeRegister = (opts) => {
      try {
        ws.register(opts)
      } catch (error) {
        const msg = String(error?.message ?? error)
        console.warn('[mowan-console] 路由注册被拒（多半是热重载残留）：' + msg)
      }
    }
    safeRegister({
      kind: 'prefix',
      path: '/mowan-state',
      handler: (req, res) => {
        let body
        try {
          body = JSON.stringify(snapshot())
        } catch (error) {
          body = JSON.stringify({ ok: false, error: String(error?.message ?? error) })
        }
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        })
        res.end(body)
      },
    })
  }
}
