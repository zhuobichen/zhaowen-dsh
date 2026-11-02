/**
 * dsh-import —— 把 Claude Code / Codex 的本地会话导入 DeepSeek Harness。
 *
 * 三个工具：
 *   agent_sessions_scan    列出本机可导入的会话（只读，不写任何东西）
 *   agent_sessions_import  导入（默认空跑；apply=true 才写）
 *   agent_sessions_fork    从既有 DSH 会话 fork 一个新会话（默认空跑；apply=true 才写）
 *
 * 写入的是 DSH 自己的 v4 会话日志（`<root>/--<cwd>--/<session-id>/session.v4.jsonl.zstd`），
 * 写完用 DSH 的 format catalog 还原校验：PASS 就代表 DSH 一定读得动。
 * 绝不修改 `~/.claude` / `~/.codex` 下的原始记录。
 */
import { join } from "node:path";
import { homedir } from "node:os";
import { findSessionFile, planFork, writeFork } from "./dsh_format.js";
import { exportToDsh, listAgentSessions, type AgentKind } from "./importer.js";

export const name = "dsh-import";

/** 只需要工具注册表；不依赖会话/持久化服务。 */
export const inject: string[] = ["tools"];

export interface Config {
  /** 目标 sessions 根目录；缺省读 $DSH_HOME/sessions（再缺省 ~/.dsh/sessions）。 */
  root?: string;
}

const SOURCE_ENUM = ["claude", "codex", "all"];

/** DSH sessions 根目录：$DSH_HOME/sessions（缺省 ~/.dsh/sessions）。 */
function defaultRoot(): string {
  return join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "sessions");
}

const render = (_args: unknown, value: unknown) =>
  [{ type: "text" as const, text: JSON.stringify(value, null, 1) }];

const outputSchema = (properties: Record<string, unknown>) => ({
  schema: { type: "object", additionalProperties: true, properties },
  render,
});

export function apply(ctx: any, config: Config = {}): void {
  const root = config.root;
  // 宿主桥：有 sessions 服务时走 create+flush+attach，导入立刻生效。
  const sessions = ctx.get ? ctx.get("sessions") : ctx.sessions;
  const workspaceRegistry = ctx.get ? ctx.get("workspaceRegistry") : undefined;

  ctx.tools.register({
    name: "agent_sessions_scan",
    description:
      "列出本机可导入 DeepSeek Harness 的会话（Claude Code 的 ~/.claude/projects 与 Codex 的 ~/.codex/sessions + archived_sessions）。只读：不写任何文件、不改原始记录。返回每个会话的 agent / id / cwd / 归档状态，用于挑选后再调 agent_sessions_import。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        source: { type: "string", enum: SOURCE_ENUM, description: "来源；缺省 all" },
        cwd: { type: "string", description: "只看工作目录含该子串的会话" },
        include: {
          type: "array",
          items: { type: "string" },
          description: "白名单：id 完整值或前缀（可带 claude:/codex: 前缀）",
        },
        exclude: { type: "array", items: { type: "string" }, description: "黑名单：同上" },
        limit: { type: "integer", description: "最多返回多少条；缺省 50" },
      },
    },
    output: outputSchema({
      total: { type: "integer" },
      returned: { type: "integer" },
      sessions: { type: "array", items: { type: "object", additionalProperties: true, properties: {} } },
    }),
    async execute(args: any) {
      const source: AgentKind | "all" = args?.source ?? "all";
      const limit = Number(args?.limit ?? 50);
      let sessions = listAgentSessions(source);
      if (args?.cwd) {
        const needle = String(args.cwd).toLowerCase();
        sessions = sessions.filter((s) => (s.cwd || "").toLowerCase().includes(needle));
      }
      const matchers = (values: unknown): string[] =>
        Array.isArray(values) ? values.map(String).filter(Boolean) : [];
      const include = matchers(args?.include);
      const exclude = matchers(args?.exclude);
      const matches = (id: string, pattern: string): boolean => {
        for (const agent of ["claude", "codex"] as AgentKind[]) {
          if (pattern.toLowerCase().startsWith(`${agent}:`)) {
            if (source !== "all" && source !== agent) return false;
            return id.startsWith(pattern.slice(agent.length + 1));
          }
        }
        return id.startsWith(pattern);
      };
      if (exclude.length) sessions = sessions.filter((s) => !exclude.some((p) => matches(s.id, p)));
      if (include.length) sessions = sessions.filter((s) => include.some((p) => matches(s.id, p)));
      return {
        total: sessions.length,
        returned: Math.min(sessions.length, limit),
        sessions: sessions.slice(0, limit).map((s) => ({
          agent: s.agent,
          id: s.id,
          cwd: s.cwd || null,
          archived: s.archived,
        })),
      };
    },
  });

  ctx.tools.register({
    name: "agent_sessions_import",
    description:
      "把 Claude Code / Codex 的会话导入 DeepSeek Harness（写成 DSH v4 会话日志，写完用 DSH 自己的还原器校验）。默认空跑只返回计划；apply=true 才写。写完后 DSH 侧栏刷新即可看到（新会话没有投影缓存时标题可能先显示未命名，打开一次即恢复）。绝不修改原始会话文件。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        source: { type: "string", enum: SOURCE_ENUM, description: "来源；缺省 all" },
        id: { type: "string", description: "只导一个会话（支持 id 前缀）" },
        include: { type: "array", items: { type: "string" }, description: "白名单：id 或前缀" },
        exclude: { type: "array", items: { type: "string" }, description: "黑名单：id 或前缀，优先于 include" },
        days: { type: "integer", description: "只要最近 N 天有更新的会话" },
        cwd: { type: "string", description: "只要工作目录含该子串的会话" },
        maxMb: { type: "number", description: "跳过大于 N MB 的源文件" },
        keepTools: { type: "boolean", description: "是否保留工具调用；缺省 true，传 false 只留对话" },
        titlePrefix: { type: "string", description: "标题前缀，如 \"[Claude] \"，用来在列表里区分来源" },
        maxTurns: {
          type: "integer",
          description:
            "只导入最后 N 轮（缺省 0 = 全留）。长会话必须裁，否则重放会超出上下文窗口；返回里的 estimatedTokens 用来判断会不会撑爆。",
        },
        keepReasoning: {
          type: "boolean",
          description: "是否保留 thinking（reasoning）块；缺省 false —— 它通常是体积大头",
        },
        maxToolResultChars: {
          type: "integer",
          description: "工具结果截断长度（字符），缺省 800；0 = 不截",
        },
        maxSessionTokens: {
          type: "integer",
          description:
            "单个 DSH 会话的 token 预算（缺省 0 = 不分片）。超过就按轮切段，每段单独成会、标题带 (1/N)——豆包 JsonlShardWriter 的等价做法。",
        },
        apply: { type: "boolean", description: "true 才真写；缺省只空跑" },
        overwrite: { type: "boolean", description: "覆盖已存在的同名会话" },
        out: { type: "string", description: "DSH sessions 根目录；缺省用插件配置或 $DSH_HOME/sessions" },
      },
    },
    output: outputSchema({
      applied: { type: "boolean" },
      written: { type: "integer" },
      reports: { type: "array", items: { type: "object", additionalProperties: true, properties: {} } },
    }),
    async execute(args: any) {
      const reports = await exportToDsh({
        agent: (args?.source as AgentKind | "all") ?? "all",
        id: args?.id ? String(args.id) : undefined,
        include: Array.isArray(args?.include) ? args.include.map(String) : undefined,
        exclude: Array.isArray(args?.exclude) ? args.exclude.map(String) : undefined,
        days: args?.days ? Number(args.days) : undefined,
        cwd: args?.cwd ? String(args.cwd) : undefined,
        maxMb: args?.maxMb ? Number(args.maxMb) : undefined,
        keepTools: args?.keepTools !== false,
        titlePrefix: args?.titlePrefix ? String(args.titlePrefix) : undefined,
        maxTurns: args?.maxTurns ? Number(args.maxTurns) : undefined,
        dropReasoning: args?.keepReasoning !== true,
        maxToolResultChars:
          args?.maxToolResultChars === undefined ? undefined : Number(args.maxToolResultChars),
        maxSessionTokens:
          args?.maxSessionTokens === undefined ? undefined : Number(args.maxSessionTokens),
        apply: args?.apply === true,
        overwrite: args?.overwrite === true,
        out: args?.out ? String(args.out) : root,
        host: sessions ? { sessions, workspaceRegistry } : undefined,
      });
      return {
        applied: args?.apply === true,
        written: reports.filter((r) => r.file && !r.skipped).length,
        reports,
      };
    },
  });

  ctx.tools.register({
    name: "agent_sessions_fork",
    description:
      "从本机已有的 DSH 会话 fork 出一个新会话（复制到最后一个完整 turn，语义与 DSH 自己的 fork 一致：源事件前缀 + session/end-seed + 标题事件，header.parentSession 指向源、isSeeded=true）。默认空跑只返回计划；apply=true 才写。写入坚持「header 单独一帧 + 事件分批帧」——单帧压缩会让 DSH 判定会话损坏、从侧栏消失并自动从 workspace 剔除。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sessionId: {
          type: "string",
          description: "源会话 id，支持前缀（可带 session- 前缀）",
        },
        title: { type: "string", description: "新会话标题；缺省 fork-<源id前8位>" },
        atSeq: {
          type: "integer",
          description: "fork 到哪个事件 seq（含）；缺省最后一个完整 turn",
        },
        apply: { type: "boolean", description: "true 才真写；缺省只空跑" },
        out: { type: "string", description: "DSH sessions 根目录；缺省用插件配置或 $DSH_HOME/sessions" },
      },
    },
    output: outputSchema({
      applied: { type: "boolean" },
      source: { type: "string" },
      target: { type: "string" },
      title: { type: "string" },
      boundary: { type: "integer" },
      events: { type: "integer" },
      runtime: { type: "string" },
      file: { type: "string" },
    }),
    async execute(args: any) {
      const pattern = String(args?.sessionId ?? "").trim();
      if (!pattern) throw new Error("sessionId is required");
      const outRoot = args?.out ? String(args.out) : (root ?? defaultRoot());
      const sourceFile = findSessionFile(outRoot, pattern);
      if (!sourceFile) throw new Error(`session not found under ${outRoot}: ${pattern}`);
      const plan = planFork(sourceFile, {
        title: args?.title ? String(args.title) : undefined,
        atSeq: args?.atSeq === undefined ? undefined : Number(args.atSeq),
      });
      const report: Record<string, any> = {
        applied: false,
        source: plan.sourceId,
        target: plan.id,
        title: plan.title,
        boundary: plan.boundary,
        events: plan.events.length,
        sourceFile,
      };
      if (args?.apply !== true) return report;

      // 首选宿主桥：sessions.create + flush + 工作区 attach，立刻生效。
      const host = sessions ? { sessions, workspaceRegistry } : undefined;
      if (host) {
        try {
          const live = host.sessions.create(plan.id, {
            seed: plan.events,
            meta: {
              ...(plan.cwd === undefined ? {} : { cwd: plan.cwd }),
              createdAt: plan.createdAt,
              parentSession: plan.sourceId,
              isSeeded: true,
            },
          });
          await host.sessions.flush(live);
          report.runtime = "live";
          report.applied = true;
          if (host.workspaceRegistry && plan.cwd) {
            try {
              const ws =
                (await host.workspaceRegistry.resolveByPath(plan.cwd)) ??
                (await host.workspaceRegistry.create(plan.cwd));
              if (ws) {
                await ws.attachSession(plan.id);
                report.workspace = ws.title ?? ws.path;
              }
            } catch (error: any) {
              report.workspaceError = `工作区归属失败（会话已创建）: ${error?.message ?? error}`;
            }
          }
          return report;
        } catch (error: any) {
          report.hostError = `host 路径失败，回退文件写入: ${error?.message ?? error}`;
        }
      }

      const written = writeFork(plan, outRoot);
      report.applied = true;
      report.runtime = "file";
      report.file = written.file;
      report.bytes = written.bytes;
      report.note = "已写入会话文件；若侧栏没出现，重启 dsh web 后打开一次该会话即可生成标题缓存。";
      return report;
    },
  });
}
