/**
 * 端到端自测：真 cordis + 真 @deepseek-ai/dsh-tools，不 mock 工具注册表。
 *
 * 覆盖四件事：
 *   1. 认得出「哪个工具是哪个插件注册的」（靠包一层 register + this.ctx）
 *   2. 开闸后，该 agent scope 的 schemas() 只剩指定插件的工具
 *   3. 全局层完全不受影响（别的会话照旧）
 *   4. 会话中途新注册的工具会被重算掉，不会漏进受限会话
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import assert from 'node:assert/strict'

// 临时 HOME 放在包内的 .tmp/（系统临时目录在这台机器上会 EPERM）
const scratch = fileURLToPath(new URL('../.tmp/', import.meta.url))
mkdirSync(scratch, { recursive: true })
const home = mkdtempSync(join(scratch, 'gate-home-'))
mkdirSync(join(home, 'plugins', 'dsh-plugin-gate'), { recursive: true })
writeFileSync(join(home, 'plugins', 'dsh-plugin-gate', 'state.json'), JSON.stringify({
  sessions: { S1: { mode: 'allow', profile: 'only-a' } },
}), 'utf8')
process.env.DSH_HOME = home

const { Context } = await import('@deepseek-ai/cordis')
const { default: ToolRuntime, defineTool } = await import('@deepseek-ai/dsh-tools')
const { default: SystemPrompt } = await import('@deepseek-ai/dsh-system-prompt')
const { createScope, scopeOf, scopeTarget } = await import('@deepseek-ai/dsh-scope')
const gate = await import('../index.js')

function plug(inject, fn) {
  Object.defineProperty(fn, 'inject', { value: inject, enumerable: false })
  return fn
}

/** 最小可用工具：只有模型可见字段 + execute。 */
function tool(name) {
  return defineTool({
    name,
    description: `${name} 测试工具`,
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {} },
      render: () => [{ type: 'text', text: 'ok' }],
    },
    execute: async () => ({}),
  })
}

const ctx = new Context()
await ctx.plugin(SystemPrompt, {})
await ctx.plugin(ToolRuntime, { mode: 'native' })

// 闸门必须在其他插件注册工具之前就位。能力集里写的是插件的运行时名（fiber 名或包名）。
await ctx.plugin(gate, { profiles: { 'only-a': ['pluginA'] } })

await ctx.plugin(plug(['tools'], function pluginA(inner) {
  inner.tools.register(tool('a_tool'))
  inner.tools.register(tool('a_helper'))
}))
await ctx.plugin(plug(['tools'], function pluginB(inner) {
  inner.tools.register(tool('b_tool'))
}))

const globals = ctx.tools.schemas().map(s => s.name).sort()
assert.deepEqual(globals, ['a_helper', 'a_tool', 'b_tool'], `全局层应有三件工具，实际：${globals}`)

// 铸一个 agent scope，替身 Agent 只提供 gate 真正用到的两个字段
let scope
await ctx.plugin(plug(['tools'], function scopeHolder(inner) {
  scope = createScope(inner, { name: 'agent-S1' })
}))
const agent = { id: 'S1', session: { id: 'S1' }, ctx: scope.ctx }
// agent/* 是 scope 过滤事件：必须带 scope 载体发，普通 emit 不会派发到全局监听器
ctx.emit(scopeTarget(ctx, scopeOf(scope.ctx)), 'agent/created', { agent })

const scoped = ctx.tools.schemas(scopeOf(scope.ctx)).map(s => s.name).sort()
assert.deepEqual(scoped, ['a_helper', 'a_tool'], `受限会话只剩 plugin-a 的工具，实际：${scoped}`)

// 全局层没有被污染
assert.deepEqual(ctx.tools.schemas().map(s => s.name).sort(), globals)

// 会话中途再注册一件 plugin-b 的工具：要重新被算掉
await ctx.plugin(plug(['tools'], function pluginBLate(inner) {
  inner.tools.register(tool('b_late'))
}))
assert.equal(ctx.tools.schemas().map(s => s.name).includes('b_late'), true)
assert.equal(ctx.tools.schemas(scopeOf(scope.ctx)).map(s => s.name).includes('b_late'), false,
  '后注册的工具也必须被挡住')

// 一个没开闸的会话：什么都不该被限制（默认 off 的语义）
let otherScope
await ctx.plugin(plug(['tools'], function otherScopeHolder(inner) {
  otherScope = createScope(inner, { name: 'agent-S2' })
}))
const other = { id: 'S2', session: { id: 'S2' }, ctx: otherScope.ctx }
ctx.emit(scopeTarget(ctx, scopeOf(otherScope.ctx)), 'agent/created', { agent: other })
assert.deepEqual(
  ctx.tools.schemas(scopeOf(otherScope.ctx)).map(s => s.name).sort(),
  ['a_helper', 'a_tool', 'b_late', 'b_tool'],
  '没开闸的会话应当看见全部工具',
)

// agent 销毁：限制随之撤掉
ctx.emit(scopeTarget(ctx, scopeOf(scope.ctx)), 'agent/disposed', { agent })
assert.deepEqual(
  ctx.tools.schemas(scopeOf(scope.ctx)).map(s => s.name).sort(),
  ['a_helper', 'a_tool', 'b_late', 'b_tool'],
  'agent 销毁后限制应当撤销',
)

rmSync(home, { recursive: true, force: true })
console.log('OK  gate: 归属识别 / 会话级裁剪 / 全局不受影响 / 后注册补算 / 默认不开启 / 销毁撤销')
