#!/usr/bin/env npx tsx
/**
 * 把 Claude Code / Codex 的会话导入 DeepSeek Harness（DSH）。
 *
 * 复用 sessions.ts 的会话枚举（listSessions / findSession），
 * 只在这里补"全保真"解析（工具调用/结果、reasoning）与 DSH v4 事件映射。
 *
 *   node <tsx> export_dsh.ts --agent all --days 7 --limit 10        # 空跑，看编号
 *   node <tsx> export_dsh.ts --pick 2,5,9 --apply                   # 按编号挑着导
 *   node <tsx> export_dsh.ts --include 83dab15e,01a02f3f --apply    # 按 id 前缀挑
 *   node <tsx> export_dsh.ts --exclude-cwd Temp --skip-existing --apply
 *
 * 选项：
 *   --agent claude|codex|all   默认 all
 *   --id <前缀>                 只导一个会话（等价于 --include 一个）
 *   --include a,b,c            白名单：id 完整值或前缀，可写 claude:/codex: 前缀
 *   --exclude a,b,c            黑名单：同上，优先于白名单
 *   --exclude-cwd Temp,foo     排除工作目录含这些子串的会话
 *   --pick 1,3,5               按空跑列表里的编号挑选（编号 = 其余过滤后按时间倒序）
 *   --from-file <path>         从文件读清单：一行一个 id/前缀，`#` 注释，`!` 开头为排除
 *   --skip-existing            已导入过的（目标日志已存在）跳过
 *   --title-prefix "<文本>"     侧栏标题加前缀，用来区分来源（如 "[Claude] "）
 *   --limit N                  最多 N 个
 *   --days N                   只要最近 N 天有更新的
 *   --max-mb N                 跳过大于 N MB 的源文件
 *   --out <dir>                sessions 根目录，默认 $DSH_HOME/sessions
 *   --apply                    真写；不加则空跑
 *   --no-tools                 丢掉工具调用，只留对话
 *   --overwrite                覆盖已存在的同名会话
 *   --json                     机器可读输出（每项带 index）
 *
 * 写完后会用 DSH 自己的 format catalog 还原每个文件：还原不过 = DSH 也读不动。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  SessionBuilder,
  loadDshCatalog,
  logPath,
  verifyWithCatalog,
  writeSession,
} from "./dsh_format.js";

export type AgentKind = "claude" | "codex";

export interface AgentSession {
  agent: AgentKind;
  id: string;
  cwd: string;
  project: string;
  time: string;
  archived: boolean;
  file: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function collectFiles(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) collectFiles(full, out);
    else if (ent.isFile() && ent.name.endsWith(".jsonl")) out.push(full);
  }
}

/** 从文件前部扫出 cwd / id（Claude 看 user 行，Codex 看 session_meta）。 */
function scanMeta(file: string, agent: AgentKind): { cwd: string; id: string } {
  let cwd = "";
  let id = "";
  const text = readFileSync(file, "utf8");
  const limit = Math.min(text.length, 512 * 1024);
  for (const line of text.slice(0, limit).split("\n")) {
    if (!line.startsWith("{")) continue;
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (agent === "claude") {
      if (rec.type === "user" || rec.type === "assistant") {
        if (!cwd && rec.cwd) cwd = rec.cwd;
        if (!id && rec.sessionId) id = rec.sessionId;
      }
    } else if (rec.type === "session_meta") {
      cwd = rec.payload?.cwd ?? cwd;
      id = rec.payload?.session_id ?? rec.payload?.id ?? id;
    } else if (rec.type === "turn_context" && !cwd) {
      cwd = rec.payload?.cwd ?? "";
    }
    if (cwd && id) break;
  }
  return { cwd, id };
}

/** 枚举本机可导入的会话（Claude: projects/<proj>/<uuid>.jsonl；Codex: sessions + archived_sessions）。 */
export function listAgentSessions(agent: AgentKind | "all" = "all"): AgentSession[] {
  const home = homedir();
  const out: AgentSession[] = [];
  if (agent === "all" || agent === "claude") {
    const root = join(home, ".claude", "projects");
    const files: string[] = [];
    if (existsSync(root)) {
      for (const proj of readdirSync(root, { withFileTypes: true })) {
        if (proj.isDirectory()) collectFiles(join(root, proj.name), files);
      }
    }
    for (const file of files) {
      const stem = file.slice(file.lastIndexOf("\\") + 1, -".jsonl".length);
      if (!UUID_RE.test(stem)) continue;
      const meta = scanMeta(file, "claude");
      out.push({
        agent: "claude",
        id: meta.id || stem,
        cwd: meta.cwd,
        project: meta.cwd,
        time: "",
        archived: false,
        file,
      });
    }
  }
  if (agent === "all" || agent === "codex") {
    const roots = [
      { dir: join(home, ".codex", "sessions"), archived: false },
      { dir: join(home, ".codex", "archived_sessions"), archived: true },
    ];
    for (const { dir, archived } of roots) {
      const files: string[] = [];
      collectFiles(dir, files);
      for (const file of files) {
        const meta = scanMeta(file, "codex");
        out.push({
          agent: "codex",
          id: meta.id || file.slice(file.lastIndexOf("-") + 1, -".jsonl".length),
          cwd: meta.cwd,
          project: meta.cwd,
          time: "",
          archived,
          file,
        });
      }
    }
  }
  return out;
}

const textBlock = (text: string) => ({ type: "text", text });
const reasoningBlock = (text: string) => ({ type: "reasoning", text });

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (part?.type === "text") return part.text ?? "";
        if (part?.type === "image") return "[image]";
        return asText(part);
      })
      .join("\n");
  }
  return asText(content);
}

const ms = (iso: string | undefined): number => (iso ? Date.parse(iso) : Number.NaN);
const firstFinite = (current: number, candidate: number): number =>
  Number.isFinite(current) ? current : Number.isFinite(candidate) ? candidate : undefined;

interface IrItem {
  kind: "assistant" | "tool_call" | "tool_result";
  time: number;
  id?: string;
  content?: any[];
  callId?: string;
  name?: string;
  arguments?: string;
  text?: string;
  isError?: boolean;
}

interface IrTurn {
  time: number;
  user: { id: string; content: any[] } | null;
  items: IrItem[];
}

export interface IrSession {
  source: AgentKind;
  id: string;
  cwd?: string;
  provider: string;
  model: string;
  createdAt: number;
  /** 源头自带的标题（Claude 的 custom-title / ai-title），优先于首条用户消息。 */
  title?: string;
  turns: IrTurn[];
}

// ---------------------------------------------------------------- Claude

export function parseClaudeFile(file: string, fallbackCwd?: string): IrSession {
  const turns: IrTurn[] = [];
  let cwd = fallbackCwd;
  let provider = "anthropic";
  let model = "claude";
  let createdAt = Number.NaN;
  let current: IrTurn | null = null;
  const names = new Map<string, string>();
  let sessionId = "";
  let customTitle = "";
  let aiTitle = "";

  const closeTurn = () => {
    if (!current) return;
    if (current.user || current.items.length > 0) turns.push(current);
    current = null;
  };
  const ensureTurn = (time: number): IrTurn => {
    if (!current) current = { time, user: null, items: [] };
    return current;
  };

  const lines = readFileSync(file, "utf8").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    let record: any;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    cwd = cwd || record.cwd;
    sessionId = sessionId || record.sessionId || "";
    createdAt = firstFinite(createdAt, ms(record.timestamp));

    // Claude Code 自己记的标题：custom-title（用户改过）> ai-title（自动生成）。
    if (record.type === "custom-title") {
      customTitle = record.customTitle || record.title || customTitle;
      continue;
    }
    if (record.type === "ai-title") {
      aiTitle = record.aiTitle || aiTitle;
      continue;
    }

    if (record.isSidechain === true) continue;
    if (record.type !== "user" && record.type !== "assistant") continue;
    if (record.isMeta === true) continue;

    const time = ms(record.timestamp) || createdAt || Date.now();

    if (record.type === "user") {
      const raw = record.message?.content;
      const parts = Array.isArray(raw) ? raw : raw == null ? [] : [textBlock(asText(raw))];
      const results = parts.filter((p: any) => p?.type === "tool_result");
      if (results.length > 0) {
        const turn = ensureTurn(time);
        for (const part of results) {
          const callId = part.tool_use_id;
          if (!callId) continue;
          turn.items.push({
            kind: "tool_result",
            time,
            callId,
            name: names.get(callId),
            text: resultText(part.content),
            isError: part.is_error === true,
          });
        }
        continue;
      }
      const content: any[] = [];
      for (const part of parts as any[]) {
        if (part?.type === "text" && part.text) content.push(textBlock(part.text));
        else if (part?.type === "image") content.push(textBlock("[image]"));
      }
      if (content.length === 0) continue;
      const text = content.map((b: any) => b.text).join("\n");
      if (/^\s*<(?:command-name|local-command-stdout)>/.test(text)) continue;
      if (/^\s*Caveat: The messages below were generated/.test(text)) continue;

      closeTurn();
      const turn = ensureTurn(time);
      turn.user = { id: record.uuid ?? `user-${turns.length + 1}`, content };
      continue;
    }

    const message = record.message ?? {};
    model = message.model ?? model;
    if (record.provider) provider = record.provider;
    const blocks: any[] = [];
    for (const part of Array.isArray(message.content) ? message.content : []) {
      if (part?.type === "text" && part.text) blocks.push(textBlock(part.text));
      else if (part?.type === "thinking" && part.thinking) blocks.push(reasoningBlock(part.thinking));
      else if (part?.type === "tool_use") {
        names.set(part.id, part.name);
        blocks.push({
          type: "tool-call",
          id: part.id,
          name: part.name,
          arguments: asText(part.input ?? {}),
        });
      }
    }
    if (blocks.length === 0) continue;
    const turn = ensureTurn(time);
    turn.items.push({ kind: "assistant", time, id: record.uuid ?? message.id, content: blocks });
  }

  closeTurn();
  if (!Number.isFinite(createdAt)) createdAt = turns[0]?.time ?? Date.now();
  return {
    source: "claude",
    id: sessionId || file.replace(/\.jsonl$/, "").split(/[\\/]/).pop()!,
    cwd,
    provider,
    model,
    createdAt,
    title: customTitle || aiTitle || undefined,
    turns,
  };
}

// ----------------------------------------------------------------- Codex

const SYSTEM_CONTEXT = [
  "<app-context>",
  "<permissions",
  "<collaboration_mode>",
  "<environment_context>",
  "<skills_instructions>",
  "<tool_instructions>",
  "<approval_policy>",
  "# AGENTS.md",
];

function isSystemContext(text: string): boolean {
  const low = text.replace(/^\s+/, "");
  if (!low) return true;
  if (SYSTEM_CONTEXT.some((p) => low.startsWith(p))) return true;
  return text.slice(0, 200).includes("AGENTS.md instructions");
}

export function parseCodexFile(file: string, fallbackCwd?: string): IrSession {
  const turns: IrTurn[] = [];
  let cwd = fallbackCwd;
  let model = "codex";
  let provider = "openai";
  let createdAt = Number.NaN;
  let sessionId = "";
  let current: IrTurn | null = null;
  let pendingReasoning: string[] = [];
  const names = new Map<string, string>();

  const closeTurn = () => {
    if (!current) return;
    if (current.items.length > 0) turns.push(current);
    current = null;
  };
  const ensureTurn = (time: number): IrTurn => {
    if (!current) current = { time, user: null, items: [] };
    return current;
  };
  const flushReasoning = (time: number) => {
    if (pendingReasoning.length === 0) return;
    const turn = ensureTurn(time);
    turn.items.push({
      kind: "assistant",
      time,
      id: `reasoning-${turn.items.length}`,
      content: [reasoningBlock(pendingReasoning.join("\n\n"))],
    });
    pendingReasoning = [];
  };

  const lines = readFileSync(file, "utf8").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    let record: any;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = record.payload ?? {};
    const time = ms(record.timestamp) || createdAt || Date.now();

    if (record.type === "session_meta") {
      sessionId = payload.session_id ?? payload.id ?? sessionId;
      cwd = cwd || payload.cwd;
      model = payload.model ?? model;
      provider = payload.model_provider ?? provider;
      createdAt = firstFinite(createdAt, ms(payload.timestamp)) ?? time;
      continue;
    }
    if (record.type === "turn_context") {
      model = payload.model ?? model;
      cwd = cwd || payload.cwd;
      continue;
    }
    if (record.type !== "response_item") continue;

    switch (payload.type) {
      case "message": {
        const parts = Array.isArray(payload.content) ? payload.content : [];
        const text = parts
          .map((p: any) => (typeof p === "string" ? p : p?.text ?? ""))
          .filter(Boolean)
          .join("\n");
        if (!text) break;
        if (payload.role === "developer" || payload.role === "system") break;
        if (payload.role === "user") {
          if (isSystemContext(text)) break;
          closeTurn();
          pendingReasoning = [];
          const turn = ensureTurn(time);
          turn.user = { id: payload.id ?? `user-${turns.length + 1}`, content: [textBlock(text)] };
          break;
        }
        if (payload.role === "assistant") {
          flushReasoning(time);
          const turn = ensureTurn(time);
          turn.items.push({
            kind: "assistant",
            time,
            id: payload.id ?? `assistant-${turn.items.length}`,
            content: [textBlock(text)],
          });
        }
        break;
      }
      case "reasoning": {
        const summary = Array.isArray(payload.summary) ? payload.summary : [];
        const content = Array.isArray(payload.content) ? payload.content : [];
        const text = [...summary, ...content]
          .map((p: any) => (typeof p === "string" ? p : p?.text ?? ""))
          .filter(Boolean)
          .join("\n\n");
        if (text) pendingReasoning.push(text);
        break;
      }
      case "function_call":
      case "custom_tool_call": {
        flushReasoning(time);
        const callId = payload.call_id ?? payload.id;
        if (!callId) break;
        names.set(callId, payload.name);
        const turn = ensureTurn(time);
        turn.items.push({
          kind: "tool_call",
          time,
          callId,
          name: payload.name ?? "tool",
          arguments: asText(payload.arguments ?? payload.input ?? {}),
        });
        break;
      }
      case "function_call_output":
      case "custom_tool_call_output": {
        const callId = payload.call_id ?? payload.id;
        if (!callId) break;
        const turn = ensureTurn(time);
        turn.items.push({
          kind: "tool_result",
          time,
          callId,
          name: payload.name ?? names.get(callId),
          text: resultText(payload.output ?? payload.result ?? ""),
          isError: payload.success === false,
        });
        break;
      }
      default:
        break;
    }
  }

  closeTurn();
  if (!Number.isFinite(createdAt)) createdAt = turns[0]?.time ?? Date.now();
  return {
    source: "codex",
    id: sessionId || file.replace(/\.jsonl$/, "").split(/[\\/-]/).pop()!,
    cwd,
    provider,
    model,
    createdAt,
    turns,
  };
}

// --------------------------------------------------------------- 映射 + 落盘

export interface TrimOptions {
  /** 只保留最后 N 轮（0/缺省 = 全留）。长会话不裁会超出模型上下文窗口。 */
  maxTurns?: number;
  /** 丢掉 reasoning（thinking）块——通常是体积大头。缺省 true。 */
  dropReasoning?: boolean;
  /** 工具结果截断长度（字符）；0 = 不截。缺省 2000。 */
  maxToolResultChars?: number;
  /** 工具调用参数截断长度（字符）；0 = 不截。缺省 2000。 */
  maxToolArgChars?: number;
  /** 普通文本块截断长度（字符）；0 = 不截。缺省 12000。 */
  maxTextChars?: number;
}

function clip(text: string, limit: number): string {
  if (!limit || text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…[imported: truncated ${text.length - limit} chars]`;
}

/** 粗略 token 估计（字符数 / 3），只用来提前发现「会撑爆上下文」。 */
function estimateTokens(events: any[]): number {
  let chars = 0;
  for (const e of events) {
    if (e.type === "user/message") {
      for (const b of e.data.content ?? []) chars += (b.text ?? "").length;
    } else if (e.type === "assistant/message") {
      for (const b of e.data.message?.content ?? []) {
        chars += (b.text ?? b.arguments ?? "").length + (b.name ?? "").length;
      }
    } else if (e.type === "tool/result") {
      for (const b of e.data.message?.content ?? []) chars += (b.text ?? "").length;
    }
  }
  return Math.round(chars / 3);
}

function trimContent(content: any[], trim: TrimOptions, kind: "assistant" | "user"): any[] {
  const out: any[] = [];
  for (const block of content) {
    if (block.type === "reasoning") {
      if (trim.dropReasoning !== false) continue;
      out.push({ ...block, text: clip(block.text ?? "", trim.maxTextChars ?? 12000) });
      continue;
    }
    if (block.type === "text") {
      out.push({ ...block, text: clip(block.text ?? "", trim.maxTextChars ?? 12000) });
      continue;
    }
    if (block.type === "tool-call") {
      out.push({ ...block, arguments: clip(block.arguments ?? "", trim.maxToolArgChars ?? 2000) });
      continue;
    }
    out.push(block);
  }
  // 裁完可能只剩空文本块
  return out.filter((b) => !(b.type === "text" && !b.text));
}

export function toBuilder(
  ir: IrSession,
  options: {
    keepTools: boolean;
    titlePrefix?: string;
    /** 显式指定要导的轮次（分片时用）；缺省按 maxTurns 截尾。 */
    turns?: IrTurn[];
    /** 会话 id 后缀（分片时用，例如 `-p2`）。 */
    idSuffix?: string;
    /** 标题后缀（分片时用，例如 ` (2/3)`）。 */
    titleSuffix?: string;
  } & TrimOptions,
): SessionBuilder {
  const builder = new SessionBuilder({
    id: `session-${String(ir.id).replace(/^session-/, "")}${options.idSuffix ?? ""}`,
    cwd: ir.cwd,
    createdAt: options.turns?.[0]?.time ?? ir.createdAt,
  });

  let lastTime = ir.createdAt;
  let titled = false;
  const titlePrefix = options.titlePrefix ?? "";
  const titleSuffix = options.titleSuffix ?? "";
  const trim: TrimOptions = options;
  const turns =
    options.turns ??
    (options.maxTurns && options.maxTurns > 0 ? ir.turns.slice(-options.maxTurns) : ir.turns);

  for (const turn of turns) {
    const start = turn.time ?? ir.createdAt;
    builder.startTurn(start);
    builder.startStep(start);
    const advertised = new Set<string>();

    if (turn.user) {
      builder.userMessage(start, {
        id: turn.user.id,
        content: trimContent(turn.user.content, trim, "user"),
      });
      // 标题取「第一条带用户消息的 turn」，不一定是第一个 turn（有的源头几轮只有 assistant）。
      if (!titled) {
        const text = turn.user.content.find((b: any) => b.type === "text")?.text ?? "";
        // 源头有自带标题（Claude custom-title / ai-title）就用它，别拿首句硬凑。
        if (builder.title(start, titlePrefix + (ir.title || text) + titleSuffix, [builder.seq - 1]))
          titled = true;
      }
    }

    // Claude 会把一轮 assistant 拆成多条记录（thinking / text / tool_use），结果还可能
    // 乱序、甚至更晚才到。DeepSeek 要求「带 tool_calls 的 assistant 消息后面必须紧跟
    // 每个 call 对应的 tool 消息」，否则整轮报 `tool calls need immediate results`。
    // 所以按轮做一次「先收集、再按 call 顺序重排发出」。
    type Assist = { id: string; time: number; content: any[]; calls: any[] };
    const assists: Assist[] = [];
    const resultMap = new Map<string, { time: number; text: string; isError?: boolean }>();
    const extraResultText = new Map<string, string[]>();
    const standaloneCalls: any[] = [];

    for (const item of turn.items) {
      const time = item.time || start;
      lastTime = time;
      if (item.kind === "assistant") {
        const base = options.keepTools
          ? item.content!
          : item.content!.filter((b: any) => b.type !== "tool-call");
        const content = trimContent(base, trim, "assistant");
        if (content.length === 0) continue;
        assists.push({
          id: item.id!,
          time,
          content: [...content],
          calls: content.filter((b: any) => b.type === "tool-call"),
        });
        continue;
      }
      if (!options.keepTools) continue;
      if (item.kind === "tool_call") {
        standaloneCalls.push(item);
        continue;
      }
      if (item.kind === "tool_result") {
        const id = item.callId!;
        if (!resultMap.has(id)) {
          resultMap.set(id, { time, text: item.text ?? "", isError: item.isError });
        } else {
          extraResultText.set(id, [...(extraResultText.get(id) ?? []), item.text ?? ""]);
        }
      }
    }

    const emitResult = (callId: string) => {
      const r = resultMap.get(callId);
      if (!r) return false;
      const extra = extraResultText.get(callId) ?? [];
      const joined = [r.text, ...extra.filter(Boolean)].join("\n--- duplicate result ---\n");
      builder.toolResult(r.time || start, {
        callId,
        text: clip(joined, trim.maxToolResultChars ?? 2000),
        isError: r.isError,
      });
      return true;
    };

    for (const a of assists) {
      builder.assistantMessage(a.time, {
        id: a.id,
        content: a.content,
        provider: ir.provider,
        model: ir.model,
      });
      if (!options.keepTools) continue;
      for (const block of a.calls) {
        advertised.add(block.id);
        builder.toolCall(a.time, { callId: block.id, name: block.name, arguments: block.arguments });
      }
      // 同一轮里这个 assistant 的所有结果紧跟其后、按 call 顺序发出
      for (const block of a.calls) emitResult(block.id);
    }

    for (const call of standaloneCalls) {
      if (!advertised.has(call.callId)) {
        builder.synthesizeToolCall(call.time || start, {
          callId: call.callId,
          name: call.name ?? "tool",
          arguments: call.arguments,
          provider: ir.provider,
          model: ir.model,
        });
        advertised.add(call.callId);
      } else {
        builder.toolCall(call.time || start, {
          callId: call.callId,
          name: call.name ?? "tool",
          arguments: call.arguments ?? "{}",
        });
      }
      emitResult(call.callId);
    }

    // 没有对应调用的孤儿结果：合成一次调用再发，内容不丢
    for (const [callId, r] of resultMap) {
      if (advertised.has(callId)) continue;
      builder.synthesizeToolCall(r.time || start, {
        callId,
        name: "tool",
        provider: ir.provider,
        model: ir.model,
      });
      builder.toolResult(r.time || start, { callId, text: r.text, isError: r.isError });
    }

    builder.endTurn(lastTime);
  }

  // 整场都没有用户消息（自动化/工具型 rollout）：用第一条 assistant 文本兜底，
  // 至少保证带上来源前缀，列表里不会变成一片「无标题」。
  if (!titled) {
    const firstAssistant = builder.events.find(
      (e) => e.type === "assistant/message" && Array.isArray((e.data as any)?.message?.content),
    );
    if (firstAssistant) {
      const text =
        (firstAssistant.data as any).message.content.find((b: any) => b.type === "text")?.text ?? "";
      builder.title(lastTime, titlePrefix + (text || "(无用户消息)"), [firstAssistant.seq]);
    }
  }

  return builder;
}

export interface ExportOptions {
  agent?: AgentKind | "all";
  id?: string;
  /** 只要 id 命中这些前缀/完整 id 的会话（白名单，可带 `claude:` / `codex:` 前缀）。 */
  include?: string[];
  /** 排除 id 命中这些前缀/完整 id 的会话（黑名单，优先于白名单）。 */
  exclude?: string[];
  /** 排除工作目录含这些子串的会话。 */
  excludeCwd?: string[];
  /** 按编号挑选（1 起，编号 = 其余过滤条件筛完、再按时间倒序的序号）。 */
  pick?: number[];
  /** 从文件读挑选清单：一行一个 id/前缀，`#` 注释，`!` 开头表示排除。 */
  fromFile?: string;
  /** 已经导入过的（目标文件存在）直接跳过。 */
  skipExisting?: boolean;
  /** 侧栏标题前缀，例如 `[Claude] ` / `[Codex] `，用来在列表里区分来源。 */
  titlePrefix?: string;
  limit?: number;
  days?: number;
  maxMb?: number;
  cwd?: string;
  out?: string;
  apply?: boolean;
  keepTools?: boolean;
  overwrite?: boolean;
  /** 只保留最后 N 轮（0/缺省 = 全留）。长会话不裁会超出模型上下文窗口。 */
  maxTurns?: number;
  /** 丢掉 reasoning（thinking）块；缺省 true。 */
  dropReasoning?: boolean;
  /** 工具结果截断长度（字符）；0 = 不截；缺省 2000。 */
  maxToolResultChars?: number;
  /** 工具调用参数截断长度（字符）；0 = 不截；缺省 2000。 */
  maxToolArgChars?: number;
  /** 普通文本块截断长度（字符）；0 = 不截；缺省 12000。 */
  maxTextChars?: number;
  /** 单个 DSH 会话的 token 预算（缺省 0 = 不分片）；超过就按轮切段，每段单独成会、标题带 (1/N)。 */
  maxSessionTokens?: number;
}

export interface ExportReport {
  /** 1 起的挑选序号，与空跑列表一致；配合 --pick 使用。 */
  index: number;
  agent: AgentKind;
  sourceId: string;
  sessionId: string;
  cwd?: string;
  turns: number;
  events: number;
  bytes?: number;
  file?: string;
  verified: boolean;
  closedUnresolved: number;
  /** 重放成请求时的粗略 token 估计（字符数 / 3），用来判断会不会撑爆上下文。 */
  estimatedTokens?: number;
  skipped?: string;
}

function defaultRoot(): string {
  return join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "sessions");
}

/** 一行一个 id/前缀；`#` 注释；`!` 开头是排除。 */
function readPickFile(file: string): { include: string[]; exclude: string[] } {
  const include: string[] = [];
  const exclude: string[] = [];
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("!")) exclude.push(line.slice(1).trim());
    else include.push(line);
  }
  return { include, exclude };
}

/** 匹配一条挑选模式：`<id 前缀>`，或 `claude:<id 前缀>` / `codex:<id 前缀>`。 */
function matchesPattern(session: AgentSession, pattern: string): boolean {
  const text = pattern.trim();
  if (!text) return false;
  for (const agent of ["claude", "codex"] as AgentKind[]) {
    if (text.toLowerCase().startsWith(`${agent}:`)) {
      if (session.agent !== agent) return false;
      const key = text.slice(agent.length + 1).trim();
      return key.length > 0 && session.id.startsWith(key);
    }
  }
  return session.id === text || session.id.startsWith(text);
}

/** 导出（默认只空跑）。返回每个会话的处理结果。 */
export async function exportToDsh(options: ExportOptions = {}): Promise<ExportReport[]> {
  const agent = options.agent ?? "all";
  const keepTools = options.keepTools !== false;
  const root = options.out ?? defaultRoot();
  const apply = options.apply === true;
  // 默认策略对齐豆包：过滤 + 分片。单个 DSH 会话留 400k token 预算，
  // 加上 completion 预留 256k 仍远低于 1M 窗口，同时保留完整历史（不靠截轮数）。
  const DEFAULT_MAX_SESSION_TOKENS = 400_000;
  const opts: ExportOptions = {
    ...options,
    maxSessionTokens:
      options.maxSessionTokens === undefined ? DEFAULT_MAX_SESSION_TOKENS : options.maxSessionTokens,
  };

  let sessions: AgentSession[] = listAgentSessions(agent);
  if (options.id) {
    const key = options.id.trim();
    const pool = sessions.filter((s) => agent === "all" || s.agent === agent);
    const hit = pool.find((s) => s.id === key) ?? pool.find((s) => s.id.startsWith(key));
    sessions = hit ? [hit] : [];
  }
  if (options.days) {
    const cut = Date.now() - options.days * 86400_000;
    sessions = sessions.filter((s) => {
      try {
        return statSync(s.file).mtimeMs >= cut;
      } catch {
        return false;
      }
    });
  }
  if (options.cwd) {
    const needle = options.cwd.toLowerCase();
    sessions = sessions.filter((s) => (s.cwd || s.project || "").toLowerCase().includes(needle));
  }
  if (options.excludeCwd?.length) {
    const needles = options.excludeCwd.map((n) => n.toLowerCase()).filter(Boolean);
    sessions = sessions.filter(
      (s) => !needles.some((n) => (s.cwd || s.project || "").toLowerCase().includes(n)),
    );
  }

  // 挑选清单：--from-file 与 --include/--exclude 合并；黑名单优先。
  const fromFile = options.fromFile ? readPickFile(options.fromFile) : { include: [], exclude: [] };
  const include = [...(options.include ?? []), ...fromFile.include];
  const exclude = [...(options.exclude ?? []), ...fromFile.exclude];
  if (exclude.length > 0) {
    sessions = sessions.filter((s) => !exclude.some((p) => matchesPattern(s, p)));
  }
  if (include.length > 0) {
    sessions = sessions.filter((s) => include.some((p) => matchesPattern(s, p)));
  }

  // 编号在 --pick 之前定下来：按时间倒序的候选列表，和空跑输出一一对应。
  const numbered = sessions.map((session, i) => ({ session, index: i + 1 }));
  const selected = options.pick?.length
    ? numbered.filter((entry) => options.pick!.includes(entry.index))
    : numbered;
  const limited = selected.slice(0, options.limit ?? 20);

  const catalog = apply ? await loadDshCatalog() : undefined;
  const reports: ExportReport[] = [];

  for (const { session, index } of limited) {
    const sizeMb = (() => {
      try {
        return statSync(session.file).size / 1024 / 1024;
      } catch {
        return 0;
      }
    })();
    if (options.maxMb && sizeMb > options.maxMb) {
      reports.push({
        index,
        agent: session.agent,
        sourceId: session.id,
        sessionId: `session-${session.id}`,
        turns: 0,
        events: 0,
        verified: false,
        closedUnresolved: 0,
        skipped: `source is ${sizeMb.toFixed(1)} MB > --max-mb ${options.maxMb}`,
      });
      continue;
    }

    let ir: IrSession;
    try {
      ir = session.agent === "claude" ? parseClaudeFile(session.file, session.cwd) : parseCodexFile(session.file, session.cwd);
    } catch (error: any) {
      reports.push({
        index,
        agent: session.agent,
        sourceId: session.id,
        sessionId: `session-${session.id}`,
        turns: 0,
        events: 0,
        verified: false,
        closedUnresolved: 0,
        skipped: `parse failed: ${error?.message ?? error}`,
      });
      continue;
    }

    // 全是系统/元数据记录的会话不写，避免往侧栏塞空会话。
    if (ir.turns.length === 0) {
      reports.push({
        index,
        agent: session.agent,
        sourceId: session.id,
        sessionId: `session-${session.id}`,
        turns: 0,
        events: 0,
        verified: false,
        closedUnresolved: 0,
        skipped: "没有对话内容（全是系统/元数据记录）",
      });
      continue;
    }

    // 已导入过：目标日志已存在就不重复写（除非显式 --overwrite）。
    if (options.skipExisting && !options.overwrite) {
      const target = logPath(root, ir.cwd, `session-${String(ir.id).replace(/^session-/, "")}`);
      if (existsSync(target)) {
        reports.push({
          index,
          agent: session.agent,
          sourceId: session.id,
          sessionId: `session-${String(ir.id).replace(/^session-/, "")}`,
          cwd: ir.cwd,
          turns: ir.turns.length,
          events: 0,
          file: target,
          verified: false,
          closedUnresolved: 0,
          skipped: "已导入过（目标日志已存在）",
        });
        continue;
      }
    }

    // 豆包在导出侧用 JsonlShardWriter + SessionFilterState 把大会话「过滤 + 分片」；
    // 这里等价实现：超过 token 预算就按轮切段，每段单独成会（标题带 1/N），
    // 整段历史都在，但每一段都能真的打开继续聊。
    const chunks = planShards(ir, { ...opts, keepTools }, opts);
    const parts = chunks.length;

    const emitOne = (turns: IrTurn[], part: number): ExportReport => {
      const builder = toBuilder(ir, {
        keepTools,
        titlePrefix: options.titlePrefix,
        maxTurns: 0,
        dropReasoning: options.dropReasoning,
        maxToolResultChars: options.maxToolResultChars,
        maxToolArgChars: options.maxToolArgChars,
        maxTextChars: options.maxTextChars,
        turns,
        idSuffix: parts > 1 ? `-p${part + 1}` : "",
        titleSuffix: parts > 1 ? ` (${part + 1}/${parts})` : "",
      });
      const report: ExportReport = {
        index,
        agent: session.agent,
        sourceId: session.id,
        sessionId: String(builder.meta.id),
        cwd: ir.cwd,
        turns: builder.turn,
        events: builder.events.length,
        verified: false,
        closedUnresolved: builder.closedUnresolved,
        estimatedTokens: estimateTokens(builder.events),
      };
      if (apply) {
        try {
          const written = writeSession(builder, { root, overwrite: options.overwrite === true });
          report.file = written.file;
          report.bytes = written.bytes;
          if (catalog) {
            const verified = verifyWithCatalog(written.file, catalog);
            report.verified = verified.events === builder.events.length;
          }
        } catch (error: any) {
          report.skipped = `write failed: ${error?.message ?? error}`;
        }
      }
      return report;
    };

    for (let i = 0; i < parts; i++) reports.push(emitOne(chunks[i], i));
  }

  return reports;
}

/** 一轮在裁剪之后大约占多少 token（用于分片预算）。 */
function turnTokens(turn: IrTurn, keepTools: boolean, trim: TrimOptions): number {
  let chars = 0;
  const cap = (s: string | undefined, limit: number) => Math.min((s ?? "").length, limit);
  if (turn.user) {
    for (const b of turn.user.content ?? []) if (b.type === "text") chars += cap(b.text, trim.maxTextChars ?? 12000);
  }
  for (const item of turn.items) {
    if (item.kind === "assistant") {
      for (const b of item.content ?? []) {
        if (b.type === "reasoning") {
          if (trim.dropReasoning === false) chars += cap(b.text, trim.maxTextChars ?? 12000);
        } else if (b.type === "text") {
          chars += cap(b.text, trim.maxTextChars ?? 12000);
        } else if (b.type === "tool-call" && keepTools) {
          chars += cap(b.arguments, trim.maxToolArgChars ?? 2000) + (b.name ?? "").length;
        }
      }
    } else if (item.kind === "tool_call" && keepTools) {
      chars += cap(item.arguments, trim.maxToolArgChars ?? 2000);
    } else if (item.kind === "tool_result" && keepTools) {
      chars += cap(item.text, trim.maxToolResultChars ?? 2000);
    }
  }
  return Math.ceil(chars / 3);
}

/**
 * 按 token 预算把会话切成若干段（豆包 JsonlShardWriter 的等价物）：
 * 每段单独成一个 DSH 会话，整段历史都在，但每一段都放得进上下文。
 */
export function planShards(
  ir: IrSession,
  options: { maxTurns?: number; maxSessionTokens?: number; keepTools?: boolean } & TrimOptions,
  trim: TrimOptions,
): IrTurn[][] {
  const base =
    options.maxTurns && options.maxTurns > 0 ? ir.turns.slice(-options.maxTurns) : ir.turns;
  const budget = options.maxSessionTokens && options.maxSessionTokens > 0 ? options.maxSessionTokens : 0;
  if (!budget) return [base];

  const keepTools = options.keepTools !== false;
  const chunks: IrTurn[][] = [];
  let cur: IrTurn[] = [];
  let curTokens = 0;
  for (const turn of base) {
    const t = turnTokens(turn, keepTools, trim);
    if (cur.length > 0 && curTokens + t > budget) {
      chunks.push(cur);
      cur = [];
      curTokens = 0;
    }
    cur.push(turn);
    curTokens += t;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks.length > 0 ? chunks : [base];
}
