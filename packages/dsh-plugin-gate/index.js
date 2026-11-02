/**
 * dsh-plugin-gate —— 宿主半身：会话级插件闸门。
 *
 * 默认（`defaultMode: off`）什么都不做，插件生态与今天完全一样；`/gate on <profile>`
 * 之后，**这个会话**只看得见指定插件注册的工具，别的工具从工具目录里消失。
 *
 * 它知道「哪个工具是哪个插件注册的」的方式，是包一层 `tools.register`：
 * Cordis 的 Service 方法里 `this.ctx` 是**调用方**的上下文（traceable 机制），
 * 所以注册那一刻能读到对方的 `fiber.name` 与 `baseUrl`，据此反查 package.json。
 *
 * 三条硬约束（都是实测出来的，不是猜的）：
 *
 * 1. 只有 profile 层能包住全局注册表。preset 树是隔离的 `tools` 实例，在那里 restrict
 *    对 profile 工具是空操作。
 * 2. `tools.restrict()` 对**未知工具名会直接抛错**，所以放行集合必须先与
 *    `tools.schemas()` 求交，且随 `tools/change` 重算。
 * 3. `restrict` 只裁剪 global 层；preset 自己挂的 `pwsh` / `fs` / `skill` 那一层挡不掉，
 *    它们天然就是「不可取消的全局能力」。
 *
 * 另外：本行要排在 profile 的最前面，否则在它加载之前注册的工具只能归到 `unknown`。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'plugin-gate'

/** 只要工具注册表；其余服务（agents / systemPrompt / commands）用 ctx.get 现取，缺了就降级。 */
export const inject = ['tools']

/** 落盘目录名（$DSH_HOME/plugins/dsh-plugin-gate）。 */
const PLUGIN_DIRNAME = 'dsh-plugin-gate'

/** 最多记多少个会话的开闸状态，超了淘汰最旧的。 */
const MAX_SESSIONS = 200

const DEFAULTS = {
  defaultMode: 'off',
  defaultProfile: '',
  profiles: {},
  alwaysOn: [],
  keepTools: [],
  unattributed: 'hide',
  notice: true,
}

//#region 配置

/**
 * 把 loader 传进来的原始 config 收成一套确定的形状。
 * 这里刻意不做严格校验后抛错：一个配置写错不该让整个 host 起不来，
 * 认不出来的字段忽略，类型不对的退回默认值。
 */
function normalizeConfig(raw) {
  const config = { ...DEFAULTS }
  if (!raw || typeof raw !== 'object') return config

  if (raw.defaultMode === 'allow' || raw.defaultMode === 'off') config.defaultMode = raw.defaultMode
  if (isNonEmptyString(raw.defaultProfile)) config.defaultProfile = raw.defaultProfile
  if (raw.unattributed === 'keep' || raw.unattributed === 'hide') config.unattributed = raw.unattributed
  if (typeof raw.notice === 'boolean') config.notice = raw.notice
  if (Array.isArray(raw.alwaysOn)) config.alwaysOn = raw.alwaysOn.filter(isNonEmptyString)
  if (Array.isArray(raw.keepTools)) config.keepTools = raw.keepTools.filter(isNonEmptyString)

  if (raw.profiles && typeof raw.profiles === 'object' && !Array.isArray(raw.profiles)) {
    const profiles = {}
    for (const [key, value] of Object.entries(raw.profiles)) {
      if (!isNonEmptyString(key) || !Array.isArray(value)) continue
      profiles[key] = value.filter(isNonEmptyString)
    }
    config.profiles = profiles
  }
  return config
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

//#endregion

//#region 归属：谁注册了这个工具

/** 已验证：Service 方法内的 `this.ctx` 是调用方上下文，`fiber.name` 能区分到插件。 */
const WRAPPED = Symbol.for('dsh-plugin-gate.wrapped')

/** 一轮注册里读到的插件身份；`pkg` 来自最近的 package.json，`fiber` 是 Cordis 的运行时名。 */
function describeCaller(caller) {
  const baseUrl = typeof caller?.baseUrl === 'string' ? caller.baseUrl : ''
  const fiber = typeof caller?.fiber?.name === 'string' ? caller.fiber.name : ''
  const pkg = baseUrl === '' ? '' : packageFromUrl(baseUrl)
  return { pkg, fiber, baseUrl }
}

/** 从模块 URL 反查包名：node_modules 布局直接切，link 布局往上找 package.json。 */
function packageFromUrl(url) {
  const path = safeFileUrlToPath(url)
  if (path === '') return ''
  const normalized = path.replaceAll('\\', '/')
  const marker = normalized.lastIndexOf('/node_modules/')
  if (marker >= 0) {
    const rest = normalized.slice(marker + '/node_modules/'.length)
    const parts = rest.split('/')
    if (parts[0]?.startsWith('@')) return parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0]
    return parts[0] ?? ''
  }
  // link 安装：.../packages/<name>/lib/index.js —— 往上找 package.json 拿真名。
  let dir = dirname(path)
  for (let depth = 0; depth < 4; depth += 1) {
    const manifest = join(dir, 'package.json')
    try {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
      if (isNonEmptyString(parsed?.name)) return parsed.name
    } catch {
      // 这一层没有 package.json，或者它坏了：继续往上。
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return ''
}

function safeFileUrlToPath(url) {
  try {
    return url.startsWith('file:') ? new URL(url).pathname.replace(/^\/([A-Za-z]:)/, '$1') : url
  } catch {
    return ''
  }
}

/**
 * 包住 `tools.register`，把每次注册的归属记下来。
 *
 * 这里没有官方接缝可用：ToolDefinition 不带来源，loader 也没有「行 → 工具」的映射。
 * 包装是幂等的、可撤销的（effect 里还原本体），并且失败绝不影响注册本身。
 */
function installAttribution(ctx, owners) {
  const tools = ctx.tools
  const current = tools.register
  if (typeof current !== 'function' || current[WRAPPED]) return

  const wrapped = function register(definition) {
    try {
      if (definition && typeof definition.name === 'string') {
        owners.set(definition.name, describeCaller(this?.ctx))
      }
    } catch {
      // 归属失败只影响「能不能按插件筛」，不该影响工具本身。
    }
    return current.call(this, definition)
  }
  wrapped[WRAPPED] = true
  tools.register = wrapped

  ctx.effect(() => () => {
    try {
      if (tools.register?.[WRAPPED]) tools.register = current
    } catch {
      // 服务已经卸载时无需还原。
    }
  }, 'plugin-gate.attribution')
}

/** 一个匹配串命中一个身份串：支持 `blender_*` 前缀通配，路径串按包含匹配。 */
function matches(spec, value) {
  if (!isNonEmptyString(spec) || !isNonEmptyString(value)) return false
  if (spec.endsWith('*')) return value.startsWith(spec.slice(0, -1))
  if (spec.includes('/') && (value.includes('/') || value.includes('\\'))) return value.includes(spec)
  return spec === value
}

//#endregion

//#region 状态：每个会话开了没开、开的是哪套

function dshHome() {
  return isNonEmptyString(process.env.DSH_HOME) ? process.env.DSH_HOME : join(homedir(), '.dsh')
}

function statePath() {
  return join(dshHome(), 'plugins', PLUGIN_DIRNAME, 'state.json')
}

function loadState() {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf8'))
    const sessions = parsed?.sessions
    if (sessions && typeof sessions === 'object' && !Array.isArray(sessions)) {
      return { sessions: { ...sessions } }
    }
  } catch {
    // 文件不存在、或者坏掉了：从空状态开始，不阻塞启动。
  }
  return { sessions: {} }
}

function saveState(state) {
  const file = statePath()
  try {
    mkdirSync(dirname(file), { recursive: true })
    const ids = Object.keys(state.sessions)
    if (ids.length > MAX_SESSIONS) {
      // 淘汰最旧的会话开关；对象键顺序即写入顺序，够用。
      for (const id of ids.slice(0, ids.length - MAX_SESSIONS)) delete state.sessions[id]
    }
    const tmp = `${file}.tmp`
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    renameSync(tmp, file)
  } catch (error) {
    process.stderr.write(`[plugin-gate] 状态写盘失败：${String(error)}\n`)
  }
}

//#endregion

/** 会话 id：Agent 的主键就是会话 id（`ctx.agents.get(id)` 也按它查）。 */
function sessionIdOf(agent) {
  const id = agent?.session?.id ?? agent?.id
  return typeof id === 'string' && id !== '' ? id : undefined
}

/** 诊断日志：只有 GATE_DEBUG=1 时才往 stderr 写，正常跑不吵。 */
function debug(...parts) {
  if (process.env.GATE_DEBUG !== '1') return
  process.stderr.write(`[plugin-gate] ${parts.join(' ')}\n`)
}

/** 插件安装入口。 */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const owners = new Map()
  const state = loadState()
  /** agent → { disposeRestrict, disposeNotice, allow, unattributed } */
  const applied = new Map()

  installAttribution(ctx, owners)

  /** 组装服务是可选件：没有它就不写提示，其余照旧。 */
  const systemPromptOf = (agent) => {
    try {
      return agent?.ctx?.get?.('systemPrompt') ?? undefined
    } catch {
      return undefined
    }
  }

  /**
   * 算这个会话允许看见的工具集合。
   * 顺序：keepTools 永远保留 → 归属能对上 profile/alwaysOn 的保留 → 剩下的按 unattributed 策略。
   */
  function planFor(entry) {
    const specs = [
      ...(Array.isArray(entry?.allow) ? entry.allow : []),
      ...(Array.isArray(config.profiles[entry?.profile]) ? config.profiles[entry.profile] : []),
      ...config.alwaysOn,
    ]
    let known = []
    try {
      known = ctx.tools.schemas().map(schema => schema.name)
    } catch (error) {
      debug('schemas() 读取失败：', String(error))
    }
    debug(`known=${known.join(',') || '(空)'}`)
    const allow = new Set()
    const unattributed = []

    for (const tool of known) {
      // run_code 是保留传输，注册表禁止遮罩它；把它写进 allow 会直接抛错。
      if (tool === 'run_code') continue
      if (config.keepTools.some(spec => matches(spec, tool))) {
        allow.add(tool)
        continue
      }
      const owner = owners.get(tool)
      if (owner === undefined) {
        unattributed.push(tool)
        continue
      }
      const keys = [owner.pkg, owner.fiber].filter(isNonEmptyString)
      const hit = specs.some(spec => matches(spec, tool) || keys.some(key => matches(spec, key)))
      if (hit) allow.add(tool)
    }
    if (config.unattributed === 'keep') for (const tool of unattributed) allow.add(tool)
    return { allow, unattributed }
  }

  function release(agent) {
    const record = applied.get(agent)
    if (record === undefined) return
    applied.delete(agent)
    try { record.disposeNotice?.() } catch { /* 组装监听已随 scope 走 */ }
    try { record.disposeRestrict?.() } catch { /* 同上 */ }
  }

  /** 对某个 agent 落一次限制。没有开关、或不是 allow 模式，就是 no-op。 */
  function sync(agent) {
    const id = sessionIdOf(agent)
    if (id === undefined) return
    const entry = state.sessions[id]
    const mode = entry?.mode === 'allow' ? 'allow' : entry?.mode === 'off' ? 'off' : config.defaultMode
    // `defaultMode: allow` 时给没有开关记录的会话一个默认能力集
    const effective = entry?.profile === undefined && isNonEmptyString(config.defaultProfile)
      ? { ...entry, profile: config.defaultProfile }
      : entry
    debug(`sync session=${id} entry=${JSON.stringify(entry)} mode=${mode}`)
    if (mode !== 'allow') {
      release(agent)
      return
    }

    const { allow, unattributed } = planFor(effective)
    debug(`plan allow=${[...allow].join(',') || '(空)'} unattributed=${unattributed.length}`)
    if (allow.size === 0) {
      release(agent)
      ctx.logger?.warn?.(`[plugin-gate] 会话 ${id} 的允许集合为空，本次不施加限制（检查 profile 名与归属）`)
      return
    }

    // 先撤旧的再上新：两个 allow 过滤器会取交集，多活一个 tick 就可能把工具全挡掉。
    release(agent)

    let disposeRestrict
    try {
      disposeRestrict = agent.ctx.tools.restrict({ allow: [...allow] })
    } catch (error) {
      ctx.logger?.warn?.(`[plugin-gate] 施加限制失败：${String(error)}`)
      return
    }

    const record = { disposeRestrict, disposeNotice: undefined, allow: [...allow], unattributed }
    applied.set(agent, record)

    const prompt = systemPromptOf(agent)
    if (config.notice && prompt !== undefined) {
      try {
        record.disposeNotice = prompt.context({
          name: 'plugin-gate',
          order: 3200,
          text: () => (applied.get(agent) === record ? noticeText(effective, allow, unattributed) : ''),
        })
      } catch {
        // 提示是锦上添花：失败不影响限制本身。
      }
    }
  }

  function noticeText(entry, allow, unattributed) {
    const label = entry?.profile ?? '(自定义清单)'
    const lines = [
      `本会话的能力被用户限制为「${label}」：只有下列工具可用，其余工具不存在——不要凭记忆调用未列出的工具。`,
      `可用工具：${[...allow].sort().join(', ')}`,
    ]
    if (unattributed.length > 0) {
      lines.push(`（另有 ${unattributed.length} 个工具归不到插件，已按策略隐藏；如需放行请把它们加进 keepTools。）`)
    }
    return lines.join('\n')
  }

  // —— agent 生命周期 ——
  ctx.on('agent/created', (payload) => {
    try { sync(payload?.agent) } catch (error) { debug('agent/created 失败：', String(error)) }
  })
  ctx.on('agent/disposed', (payload) => {
    const agent = payload?.agent
    if (agent !== undefined) release(agent)
  })
  // 会话中途才注册上来的工具：重算一次，否则它们会漏进受限会话。
  // 遍历快照，避免 sync 里先删后加把同一个 agent 又排到队尾导致死循环。
  ctx.on('tools/change', () => {
    for (const agent of [...applied.keys()]) {
      try { sync(agent) } catch { /* 单个 agent 失败不影响其他 */ }
    }
  })

  // —— /gate 命令 ——
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'gate',
      description: '会话级插件闸门：/gate [status|on <profile>|off|list]',
      handler: (invocation) => handleCommand(invocation),
    })
  })

  function handleCommand(invocation) {
    const agent = invocation?.agent
    const id = sessionIdOf(agent)
    if (id === undefined) return { kind: 'error', text: '这个调用没有归属会话，无法按会话开闸。' }

    const argv = String(invocation?.args ?? '').trim().split(/\s+/).filter(Boolean)
    const verb = argv[0] ?? 'status'

    if (verb === 'list') {
      const names = Object.keys(config.profiles)
      if (names.length === 0) return { kind: 'success', text: '还没有配置任何能力集（config.profiles 是空的）。' }
      return {
        kind: 'success',
        text: names.map((key) => `- ${key}: ${config.profiles[key].join(', ') || '(空)'}`).join('\n'),
      }
    }

    if (verb === 'off') {
      state.sessions[id] = { mode: 'off' }
      saveState(state)
      sync(agent)
      return { kind: 'success', text: '本会话已关闸：恢复全局注入。' }
    }

    if (verb === 'on') {
      const profile = argv[1]
      if (profile === undefined) {
        return { kind: 'error', text: '用法：/gate on <能力集名>（先 /gate list 看有哪些）' }
      }
      if (!Array.isArray(config.profiles[profile])) {
        return { kind: 'error', text: `没有叫「${profile}」的能力集；/gate list 看可用的。` }
      }
      state.sessions[id] = { mode: 'allow', profile }
      saveState(state)
      sync(agent)
      const record = applied.get(agent)
      const allow = record?.allow ?? []
      return {
        kind: 'success',
        text: allow.length === 0
          ? `已开闸到「${profile}」，但没有匹配到任何工具——检查 config.profiles 里的匹配串与插件归属。`
          : `本会话已开闸到「${profile}」：${allow.length} 个工具可用。\n${allow.sort().join(', ')}`,
      }
    }

    // status
    const entry = state.sessions[id]
    const record = applied.get(agent)
    const mode = entry?.mode === 'allow' ? 'allow' : entry?.mode === 'off' ? 'off' : config.defaultMode
    if (mode !== 'allow') return { kind: 'success', text: `闸门状态：off（全局注入）。可用 /gate on <profile> 开闸。` }
    const allow = record?.allow ?? []
    const unattributed = record?.unattributed ?? []
    return {
      kind: 'success',
      text: [
        `闸门状态：on，能力集「${entry?.profile ?? '?'}」`,
        `放行工具 ${allow.length} 个：${allow.sort().join(', ') || '(无)'}`,
        unattributed.length > 0 ? `归不到插件的工具 ${unattributed.length} 个（当前策略：${config.unattributed}）` : '',
      ].filter(Boolean).join('\n'),
    }
  }

  // 启动时已经在跑的 agent（热重载场景）也要对齐一次。
  const agents = ctx.get('agents')
  if (agents !== undefined) {
    try {
      for (const agent of agents.list()) sync(agent)
    } catch {
      // 列表接口不可用时，等 agent/created 再处理。
    }
  }
}
