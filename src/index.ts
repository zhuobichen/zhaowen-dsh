/**
 * dsh-team —— 多 Agent 团队编排框架（loop → graph 升级）。
 *
 * 把 MathModeling-Agent（5 角色多 Agent 编排）的协作经验通用化成 DSH 技能包。
 * 本版在「顺序接力（loop）」之上，新增「图编排（graph）」：
 *   - skills/ 下的团队角色 SKILL.md 注册进 skill registry
 *   - graphs/ 下的声明式 DAG 模板加载后渲染成 Mermaid，注册为可发现/可改编的 skill
 *     （agent 可据此 fan-out 并行、条件边路由、join 汇聚，动态改拓扑）
 *
 * 角色：team-lead / analyst / coder / reviewer / tester / team-workflow / team-graph
 * 图模板：dev-team（开发）/ research-team（调研）/ audit-team（审计）
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

/** 稳定的 cordis 插件名。 */
export const name = 'dsh-team'

/** skill registry 的最小结构视图。 */
interface SkillRegistryLike {
  register(skill: {
    name: string
    description: string
    content: string
    path?: string
    provider?: string
    source?: string
  }): () => void
}

/** 声明式图模板的节点。 */
interface GraphNode {
  id: string
  role: string
  label: string
}

/** 声明式图模板的边（缺省 condition = 无条件流转）。 */
interface GraphEdge {
  from: string
  to: string
  condition?: string
}

/** 声明式图模板（graphs/*.json）。 */
interface GraphTemplate {
  id: string
  name: string
  description: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  fanOut?: string[][]
  join?: string[]
}

/** 解析 SKILL.md 的 frontmatter（name / description）与正文。 */
function parseSkillMarkdown(raw: string, fallbackName: string): { name: string; description: string; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  const frontmatter = match?.[1] ?? ''
  const content = (match?.[2] ?? raw).trim()
  const skillName = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? fallbackName
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? ''
  return { name: skillName, description, content }
}

/** 把图模板渲染成 Mermaid DAG（`graph TD`）。 */
function graphToMermaid(g: GraphTemplate): string {
  const lines: string[] = ['```mermaid', 'graph TD']
  for (const n of g.nodes) {
    lines.push(`  ${n.id}[${n.label}]`)
  }
  for (const e of g.edges) {
    lines.push(e.condition ? `  ${e.from} -->|${e.condition}| ${e.to}` : `  ${e.from} --> ${e.to}`)
  }
  lines.push('```')
  return lines.join('\n')
}

/** 把图模板整理成可注册的 skill 内容：说明 + Mermaid 图 + 可改编的原始 JSON。 */
function graphToSkillContent(g: GraphTemplate): string {
  const fanOut = g.fanOut?.map((g) => g.join(' ⨯ ')).join('；') ?? '无'
  const join_ = g.join?.join(' → ') ?? '无'
  return [
    `# 图模板：${g.name}（${g.id}）`,
    '',
    g.description,
    '',
    '## DAG 拓扑（Mermaid）',
    '',
    graphToMermaid(g),
    '',
    '## 并行与汇聚',
    '',
    `- fan-out 并行组：${fanOut}`,
    `- join 汇聚节点：${join_}`,
    '',
    '## 可改编的模板 JSON',
    '',
    '```json',
    JSON.stringify(g, null, 2),
    '```',
    '',
    '按任务规模动态改图：模块多就 fan-out 更多并行节点、有质量门就加条件边。',
  ].join('\n')
}

/** 加载 graphs/*.json 图模板，渲染后注册为 skill（`graph-<id>`）。 */
function registerGraphTemplates(ctx: Context): void {
  const registry = ctx.get('skills') as SkillRegistryLike | undefined
  if (!registry) return
  const graphsRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'graphs')
  if (!existsSync(graphsRoot)) return
  for (const entry of readdirSync(graphsRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const file = join(graphsRoot, entry.name)
    let graph: GraphTemplate
    try {
      graph = JSON.parse(readFileSync(file, 'utf8')) as GraphTemplate
    } catch (error) {
      ctx.logger.warn(`dsh-team graph "${entry.name}" skipped: ${(error as Error).message}`)
      continue
    }
    if (!graph.id || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) continue
    try {
      registry.register({
        name: `graph-${graph.id}`,
        description: `图编排模板：${graph.name} —— ${graph.description}`,
        content: graphToSkillContent(graph),
        path: file,
        provider: 'dsh-team',
        source: 'bundled',
      })
    } catch (error) {
      ctx.logger.warn(`dsh-team graph "${graph.id}" skipped: ${(error as Error).message}`)
    }
  }
}

/** 注册 skills/ 下所有团队角色 SKILL.md。 */
function registerTeamSkills(ctx: Context): void {
  const registry = ctx.get('skills') as SkillRegistryLike | undefined
  if (!registry) return
  const skillsRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')
  if (!existsSync(skillsRoot)) return
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = join(skillsRoot, entry.name, 'SKILL.md')
    if (!existsSync(file)) continue
    const { name: skillName, description, content } = parseSkillMarkdown(readFileSync(file, 'utf8'), entry.name)
    if (!description) continue
    try {
      registry.register({ name: skillName, description, content, path: file, provider: 'dsh-team', source: 'bundled' })
    } catch (error) {
      ctx.logger.warn(`dsh-team skill "${skillName}" skipped: ${(error as Error).message}`)
    }
  }
}

/** 插件入口：注册团队角色 skills + 图模板。 */
export function apply(ctx: Context): void {
  registerTeamSkills(ctx)
  registerGraphTemplates(ctx)
}
