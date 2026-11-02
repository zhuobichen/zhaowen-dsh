/**
 * DSH (DeepSeek Harness) v4 session log writer.
 *
 * 目标格式：`<root>/--<projectKey(cwd)>--/<session-id>/session.v4.jsonl.zstd`
 * 物理编码：一串独立的 Zstandard 帧 —— 第 1 帧只有 header 行，之后每帧一批事件行。
 *
 * 这里的严格程度是按 DSH 自己的还原器反推的，不是"能解析就行"：
 *   - tool/call 必须被前一条 assistant 消息里的 tool-call 块"公示"，且 name/arguments 逐字相同
 *   - step/end 不能留下未回款的调用
 *   - tool/result 必须在本 step 内有对应 call
 *   - turn/step 编号从 1 连续；时间戳必须是非负安全整数
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";

export const FORMAT_VERSION = 4;

const SAFE = /[A-Za-z0-9_.-]/;

function escapeUnit(ch: string): string {
  return "~" + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0");
}

/** 会话 id / 任意字符串 → 安全的单段路径名（与 format.ts 的 encodeSegment 等价）。 */
export function encodeSegment(raw: string): string {
  if (!raw) throw new Error("empty segment");
  let out = "";
  for (const ch of raw) out += SAFE.test(ch) ? ch : escapeUnit(ch);
  if (out === "." || out === "..") out = out.replace(/\./g, "~002E");
  return out;
}

/** cwd → 可读项目目录名（分隔符并成 `-`，非安全码元转 ~XXXX）。 */
export function projectKey(cwd: string): string {
  return cwd
    .replace(/[\\/:]+/g, "-")
    .replace(/[^A-Za-z0-9_.-]/g, (ch) => escapeUnit(ch));
}

export function projectDir(root: string, cwd: string | undefined): string {
  return join(root, cwd === undefined ? "_no-cwd" : `--${projectKey(cwd)}--`);
}

export function sessionDir(root: string, cwd: string | undefined, id: string): string {
  return join(projectDir(root, cwd), encodeSegment(id));
}

export function logPath(
  root: string,
  cwd: string | undefined,
  id: string,
  version = FORMAT_VERSION,
): string {
  return join(sessionDir(root, cwd, id), `session.v${version}.jsonl.zstd`);
}

export interface DshHeaderMeta {
  id: string;
  cwd?: string;
  createdAt: number;
  agentPreset?: string;
}

export interface DshEvent {
  type: string;
  seq: number;
  time: number;
  data: any;
  surfaceOp?: "append" | { op: "replace"; startSeq: number; endSeq: number };
  sourceEventSeqs?: number[];
}

export class SessionBuilder {
  readonly meta: DshHeaderMeta;
  readonly events: DshEvent[] = [];
  seq = 0;
  turn = 0;
  step = 0;
  openTurn = false;
  openStep = false;
  lastTime: number;
  closedUnresolved = 0;
  duplicateResults = 0;
  private pending = new Map<string, number>();
  /** callId → 已发出的 tool/result 在 events 里的下标（用于合并重复结果）。 */
  private resolved = new Map<string, number>();

  constructor(meta: DshHeaderMeta) {
    this.meta = meta;
    this.lastTime = Number.isFinite(meta.createdAt) ? meta.createdAt : Date.now();
  }

  private emit(type: string, time: number, data: any, extra: Partial<DshEvent> = {}): DshEvent {
    // 源里 compaction 摘要会被插到文件最前、时间反而更晚；持久化时间保持单调不减。
    const stamped = Number.isFinite(time) ? Math.max(time, this.lastTime) : this.lastTime;
    this.lastTime = stamped;
    const event: DshEvent = { type, seq: this.seq++, time: stamped, data, ...extra };
    this.events.push(event);
    return event;
  }

  startTurn(time: number): void {
    this.turn += 1;
    this.emit("turn/start", time, { turn: this.turn });
    this.openTurn = true;
    this.step = 0;
  }

  startStep(time: number): void {
    this.step += 1;
    this.emit("step/start", time, { turn: this.turn, step: this.step });
    this.openStep = true;
  }

  /**
   * 系统提示消息，必须是 surface 的第一个节点（v4 的「protected first surface head」）。
   * 导入的会话如果缺这一段，续聊时 DSH 追加 system/message 会写到中间，日志随即被判定损坏。
   */
  systemMessage(time: number, text: string): void {
    const { turn, step } = this.requireOpen();
    this.emit(
      "system/message",
      time,
      {
        turn,
        step,
        message: {
          role: "system",
          id: `system-${this.turn}`,
          content: [{ type: "text", text }],
          source: { kind: "system-prompt" },
        },
      },
      { surfaceOp: "append" },
    );
  }

  userMessage(time: number, message: { id: string; content: any[]; source?: any }): void {
    this.emit(
      "user/message",
      time,
      {
        role: "user",
        id: message.id,
        content: message.content,
        source: message.source ?? { kind: "user" },
      },
      { surfaceOp: "append" },
    );
  }

  /** 侧栏标题，取首条用户消息，与 DSH 的 fallback 一致。 */
  title(time: number, text: string, messageSeqs: number[]): string | undefined {
    const title = text.replace(/\s+/g, " ").trim().slice(0, 60);
    if (!title) return undefined;
    this.emit("session/title", time, { title, messageSeqs, source: { kind: "fallback" } });
    return title;
  }

  assistantMessage(
    time: number,
    message: { id: string; content: any[]; provider: string; model: string },
  ): void {
    const { turn, step } = this.requireOpen();
    this.emit(
      "assistant/message",
      time,
      {
        turn,
        step,
        message: {
          role: "assistant",
          id: message.id,
          content: message.content,
          source: { kind: "model", provider: message.provider, model: message.model },
        },
        stream: [],
      },
      { surfaceOp: "append" },
    );
  }

  toolCall(time: number, call: { callId: string; name: string; arguments: string }): void {
    const { turn, step } = this.requireOpen();
    const event = this.emit("tool/call", time, {
      turn,
      step,
      callId: call.callId,
      name: call.name,
      arguments: call.arguments,
    });
    this.pending.set(call.callId, event.seq);
  }

  /**
   * 合成一条只含该 tool-call 块的 assistant 消息再发调用。
   * v4 还原要求每个 tool/call 都被"公示"，而且 name/arguments 必须逐字相同。
   */
  synthesizeToolCall(
    time: number,
    call: { callId: string; name: string; arguments?: string; provider?: string; model?: string },
  ): void {
    const args = call.arguments ?? "{}";
    this.assistantMessage(time, {
      id: `synthetic-call-${call.callId}`,
      content: [{ type: "tool-call", id: call.callId, name: call.name, arguments: args }],
      provider: call.provider ?? "unknown",
      model: call.model ?? "unknown",
    });
    this.toolCall(time, { callId: call.callId, name: call.name, arguments: args });
  }

  hasPending(callId: string): boolean {
    return this.pending.has(callId);
  }

  toolResult(
    time: number,
    result: {
      callId: string;
      text: string;
      isError?: boolean;
      id?: string;
      error?: { name: string; code: string; reason?: string };
    },
  ): void {
    const callSeq = this.pending.get(result.callId);
    if (callSeq === undefined) {
      // 同一 call id 的第二条结果（Claude 会先写「interrupted」再补真实输出）：
      // 不新造一次调用，而是把内容并入已发出的那条结果，避免丢数据也避免重复 call。
      const existing = this.resolved.get(result.callId);
      if (existing === undefined) return;
      const target = this.events[existing];
      const content = (target.data as any)?.message?.content;
      if (Array.isArray(content)) {
        content.push({ type: "text", text: `--- duplicate result ---\n${result.text}` });
        this.duplicateResults += 1;
      }
      return;
    }
    const { turn, step } = this.requireOpen();
    const data: any = {
      turn,
      step,
      message: {
        role: "tool",
        id: result.id ?? `tool-${result.callId}`,
        content: [{ type: "text", text: result.text }],
        source: { kind: "tool", callId: result.callId },
        toolCallId: result.callId,
        ...(result.isError ? { isError: true } : {}),
      },
      ...(result.error ? { error: result.error } : {}),
    };
    this.pending.delete(result.callId);
    const event = this.emit("tool/result", time, data, {
      sourceEventSeqs: [callSeq],
      surfaceOp: "append",
    });
    this.resolved.set(result.callId, this.events.indexOf(event));
  }

  /** 该 call id 是否已经有结果（用于识别重复结果）。 */
  hasResolved(callId: string): boolean {
    return this.resolved.has(callId);
  }

  endStep(time: number): void {
    if (!this.openStep) return;
    // 被中断的 tool_use 没有结果：不许静默丢弃，补一条结果并标明"结果未知"。
    for (const callId of [...this.pending.keys()]) {
      this.closedUnresolved += 1;
      this.toolResult(time, {
        callId,
        text: "No tool result was recorded for this call in the source transcript (TOOL_OUTCOME_UNKNOWN).",
        isError: true,
        error: {
          name: "import",
          code: "TOOL_OUTCOME_UNKNOWN",
          reason: "source transcript ended before the tool result",
        },
      });
    }
    this.emit("step/end", time, { turn: this.turn, step: this.step });
    this.openStep = false;
  }

  endTurn(time: number, reason: any = { kind: "completed" }): void {
    if (!this.openTurn) return;
    this.endStep(time);
    this.emit("turn/end", time, { turn: this.turn, reason });
    this.openTurn = false;
    this.pending.clear();
  }

  private requireOpen(): { turn: number; step: number } {
    if (!this.openTurn) throw new Error("no open turn");
    if (!this.openStep) throw new Error("no open step");
    return { turn: this.turn, step: this.step };
  }

  header(): Record<string, any> {
    return {
      type: "session",
      version: FORMAT_VERSION,
      id: this.meta.id,
      createdAt: this.meta.createdAt,
      ...(this.meta.cwd === undefined ? {} : { cwd: this.meta.cwd }),
      isSeeded: false,
      delegationDepth: 0,
      ...(this.meta.agentPreset === undefined ? {} : { agentPreset: this.meta.agentPreset }),
    };
  }

  toBuffer(batch = 500): Buffer {
    const frames: Buffer[] = [
      zstdCompressSync(Buffer.from(JSON.stringify(this.header()) + "\n", "utf8")),
    ];
    for (let i = 0; i < this.events.length; i += batch) {
      const text = this.events
        .slice(i, i + batch)
        .map((e) => JSON.stringify(e) + "\n")
        .join("");
      frames.push(zstdCompressSync(Buffer.from(text, "utf8")));
    }
    return Buffer.concat(frames);
  }
}

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** 读回一串 zstd 帧里的全部 JSONL 行。 */
export function readRows(file: string): any[] {
  const buf = readFileSync(file);
  const offsets: number[] = [];
  for (let i = buf.indexOf(MAGIC); i >= 0; i = buf.indexOf(MAGIC, i + 4)) offsets.push(i);
  if (offsets.length === 0) throw new Error("no zstd frame found");
  const text = offsets
    .map((off, k) => {
      const end = k + 1 < offsets.length ? offsets[k + 1] : buf.length;
      return zstdDecompressSync(buf.subarray(off, end)).toString("utf8");
    })
    .join("");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** 找到本机 DSH 的 format catalog（用它做还原校验）。 */
export async function loadDshCatalog(): Promise<any | undefined> {
  const home = homedir();
  const dshHome = process.env.DSH_HOME ?? join(home, ".dsh");
  const candidates = [
    process.env.DSH_TOOLCHAIN,
    join(dshHome, "..", "toolchain"),
    join(home, "dsh", "toolchain"),
  ].filter(Boolean) as string[];
  for (const base of candidates) {
    const file = join(
      base,
      "node_modules",
      "@deepseek-ai",
      "dsh-session-format-catalog",
      "lib",
      "index.js",
    );
    if (existsSync(file)) return import("file:///" + file.replace(/\\/g, "/"));
  }
  return undefined;
}

/** 用 DSH 自己的还原器校验刚写的文件；抛错信息就是 DSH 会拒收的理由。 */
export function verifyWithCatalog(file: string, catalog: any): { events: number } {
  const rows = readRows(file);
  const [header, ...events] = rows;
  const restore = catalog.sessionFormatCatalog.createRestore(header, {
    recovery: "strict",
    validation: "current",
  });
  for (const event of events) restore.decodeRow(event);
  const artifact = restore.finish();
  return { events: artifact.events.length };
}

export function writeSession(
  builder: SessionBuilder,
  options: { root: string; overwrite?: boolean },
): { file: string; bytes: number } {
  const header = builder.header();
  const file = logPath(options.root, header.cwd, header.id);
  const dir = sessionDir(options.root, header.cwd, header.id);
  mkdirSync(dir, { recursive: true });
  if (existsSync(file) && !options.overwrite) throw new Error(`refusing to overwrite ${file}`);
  const buffer = builder.toBuffer();
  writeFileSync(file, buffer);
  return { file, bytes: buffer.length };
}

/* ------------------------------------------------------------------ *
 * fork —— 从既有会话的最后一个完整 turn 分叉出一个新会话
 *
 * 语义与 DSH 自己的 `SessionCommandController.fork` 一致：
 *   子会话 = 源事件前缀 [0..boundary] + `session/end-seed` + 未闭合 turn 的 forked 收尾
 * boundary 取最后一个 `turn/end`（`latestCompletedPrefixBoundary`），
 * 新 header 用 `parentSession` 指向源、`isSeeded: true`。
 *
 * 会话文件必须仍是「header 单独一帧 + 事件分批帧」：DSH 读首行时要求
 * 首帧解压后**恰好只有一行 header**（`assertZstdHeaderFrame`），
 * 否则会判为损坏、跳过该会话，并在启动时把它从 workspace 里剔除。
 * ------------------------------------------------------------------ */

/** 最后一个完整 turn 的边界下标；语义与 DSH 的 latestCompletedPrefixBoundary 一致。 */
export function latestCompletedPrefixBoundary(events: DshEvent[]): number | undefined {
  let index = -1;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].type === "turn/end") {
      index = i;
      break;
    }
  }
  if (index < 0) return undefined;
  let cut = index;
  for (let i = index + 1; i < events.length; i += 1) {
    const event = events[i];
    if (
      event.type === "turn/start" ||
      (event.type === "user/message" && event.surfaceOp === "append") ||
      event.type === "agent/inbox/spliced"
    ) {
      break;
    }
    cut = i;
  }
  return cut;
}

/** 在 sessions 根目录下按 id 完整值或前缀找会话日志。 */
export function findSessionFile(root: string, idPattern: string): string | undefined {
  if (!existsSync(root)) return undefined;
  const needle = idPattern.replace(/^session-/, "").toLowerCase();
  if (!needle) return undefined;
  for (const project of readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const projectPath = join(root, project.name);
    for (const entry of readdirSync(projectPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const bare = entry.name.replace(/^session-/, "").toLowerCase();
      if (!bare.startsWith(needle)) continue;
      const file = join(projectPath, entry.name, `session.v${FORMAT_VERSION}.jsonl.zstd`);
      if (existsSync(file)) return file;
    }
  }
  return undefined;
}

export interface ForkPlan {
  id: string;
  title: string;
  header: Record<string, any>;
  events: DshEvent[];
  boundary: number;
  sourceId: string;
  cwd?: string;
  createdAt: number;
}

/* ------------------------------------------------------------------ *
 * fork 收尾事件：与 DSH 自己的 openTurnClosers 逐字对齐
 *
 * DSH 的 buildForkSeed 不只复制前缀 + 打 end-seed，还会调
 * `openTurnClosers(prefix, { kind: 'forked' })` 把**未闭合的 tail**补平：
 *   1. 前置 assistant 公示过、但没有 tool/result 回款的调用 → 补一条 error result
 *      （提供方拒收悬空的 assistant tool-call）
 *   2. 未闭合的 step → step/end
 *   3. 未闭合的 turn → turn/end（reason.kind = 'forked'）
 *
 * 默认边界（最后一个完整 turn）本来就落在 turn/end 上，收尾事件为空；但用 atSeq
 * 指定 turn 中间的位置 fork 时，少了这些补齐，DSH 还原会因「有未回款的调用」拒绝
 * 加载这个会话。
 *
 * 不 import @deepseek-ai/dsh-session：本插件装在 profile 的 node_modules 下，
 * 那个包只存在于 DSH 自己的 toolchain 里，宿主运行期解析不到。所以按官方实现
 * 等价重写，常量与措辞保持逐字一致。
 * ------------------------------------------------------------------ */

export const TOOL_NOT_STARTED = "TOOL_NOT_STARTED";
export const TOOL_OUTCOME_UNKNOWN = "TOOL_OUTCOME_UNKNOWN";

/** 合成 error result 的模型可见措辞（取自 DSH repair.js 的 CLOSER_TEXT.forked）。 */
const FORK_CLOSER_TEXT = {
  started:
    "The history inherited by this branch records this tool call starting but does not include its result. The parent session may have completed it after the fork point. Decide whether to retry from the tool semantics: retry only if the operation is read-only or idempotent; if it may have side effects, first verify external state or ask the user. Do not retry blindly.",
  notStarted:
    "The history inherited by this branch has no record of this tool call starting. The parent session may have executed it after the fork point. Decide whether to retry from the tool semantics: retry only if the operation is read-only or idempotent; if it may have side effects, first verify external state or ask the user. Do not retry blindly.",
} as const;

interface PendingCall {
  turn: number;
  step: number;
  callSeq?: number;
}

/**
 * 补齐未闭合的 tail（等价于 DSH 的 `openTurnClosers(events, { kind: "forked" })`）。
 *
 * `events` 应当**已经包含** `session/end-seed`：官方实现就是拿带 seed 的前缀算的，
 * 收尾事件的 seq 从 seed 的 seq 往后接着排。
 *
 * @param events - 前缀事件（含 end-seed）。
 * @returns 需要追加的收尾事件；tail 已闭合时为空数组。
 */
export function forkedTailClosers(events: DshEvent[]): DshEvent[] {
  let openTurn: number | null = null;
  let openStep: number | null = null;
  const pending = new Map<string, PendingCall>();
  let last: DshEvent | undefined;

  for (const event of events) {
    last = event;

    switch (event.type) {
      case "turn/start":
        openTurn = event.data?.turn ?? null;
        openStep = null;
        pending.clear();
        break;
      case "turn/end":
        openTurn = null;
        openStep = null;
        pending.clear();
        break;
      case "step/end":
        openStep = null;
        pending.clear();
        break;
      case "step/start":
        openStep = event.data?.step ?? null;
        break;
      case "assistant/message": {
        const blocks = event.data?.message?.content;
        if (!Array.isArray(blocks)) break;
        for (const block of blocks) {
          if (block?.type === "tool-call" && typeof block.id === "string") {
            pending.set(block.id, { turn: event.data.turn, step: event.data.step });
          }
        }
        break;
      }
      case "tool/call": {
        const entry = pending.get(event.data?.callId);
        if (entry !== undefined) entry.callSeq = event.seq;
        break;
      }
      case "tool/result": {
        const callId = event.data?.message?.source?.callId;
        const entry = callId === undefined ? undefined : pending.get(callId);
        if (
          event.surfaceOp === "append" &&
          entry !== undefined &&
          entry.turn === event.data.turn &&
          entry.step === event.data.step
        ) {
          pending.delete(callId);
        }
        break;
      }
      default:
        break;
    }
  }

  if (openTurn === null || last === undefined) return [];

  const closers: DshEvent[] = [];
  let seq = last.seq + 1;
  const time = last.time;

  // 先补工具调用（Map 的插入顺序 = 转录里的顺序），再关 step、最后关 turn。
  for (const [callId, entry] of pending) {
    const started = entry.callSeq !== undefined;
    // id 里的序号必须与事件本身的 seq 一致：官方实现用自增前的值，
    // 所以这里先取出来再用，别写成 `seq: seq++` + `${seq}`（会差 1）。
    const eventSeq = seq++;
    closers.push({
      type: "tool/result",
      seq: eventSeq,
      time,
      data: {
        turn: entry.turn,
        step: entry.step,
        message: {
          id: `forked-tool-result-${callId}-${eventSeq}`,
          role: "tool",
          toolCallId: callId,
          isError: true,
          source: { kind: "tool", callId },
          content: [
            {
              type: "text",
              text: started ? FORK_CLOSER_TEXT.started : FORK_CLOSER_TEXT.notStarted,
            },
          ],
        },
        error: started
          ? { name: "ToolOutcomeUnknownError", code: TOOL_OUTCOME_UNKNOWN }
          : { name: "ToolNotStartedError", code: TOOL_NOT_STARTED },
      },
      surfaceOp: "append",
      ...(started ? { sourceEventSeqs: [entry.callSeq as number] } : {}),
    });
  }

  if (openStep !== null) {
    closers.push({
      type: "step/end",
      seq: seq++,
      time,
      data: { turn: openTurn, step: openStep },
    });
  }

  closers.push({
    type: "turn/end",
    seq: seq++,
    time,
    data: { turn: openTurn, reason: { kind: "forked" } },
  });

  return closers;
}

/** 计算 fork 计划（不写盘）。`atSeq` 缺省取最后一个完整 turn。 */
export function planFork(
  sourceFile: string,
  options: { title?: string; atSeq?: number } = {},
): ForkPlan {
  const rows = readRows(sourceFile);
  const [header, ...rest] = rows;
  if (!header || header.type !== "session" || header.version !== FORMAT_VERSION) {
    throw new Error(`not a DSH v${FORMAT_VERSION} session log: ${sourceFile}`);
  }
  const events = rest as DshEvent[];
  let cut: number;
  if (options.atSeq === undefined) {
    const index = latestCompletedPrefixBoundary(events);
    if (index === undefined) throw new Error("source session has no completed turn to fork from");
    cut = index;
  } else {
    cut = events.findIndex((event) => event.seq === options.atSeq);
    if (cut < 0) throw new Error(`event seq ${options.atSeq} not found in source session`);
  }
  const last = events[cut];
  const createdAt = Date.now();
  const title =
    options.title ?? `fork-${String(header.id).replace(/^session-/, "").slice(0, 8)}`;
  // 前缀 + end-seed，再补未闭合 tail 的收尾事件（与 DSH 的 buildForkSeed 一致）。
  const forkEvents: DshEvent[] = events.slice(0, cut + 1).map((event) => ({ ...event }));
  forkEvents.push({
    type: "session/end-seed",
    seq: last.seq + 1,
    time: last.time,
    data: { inherited: true },
  });
  forkEvents.push(...forkedTailClosers(forkEvents));
  forkEvents.push({
    type: "session/title",
    seq: (forkEvents[forkEvents.length - 1] as DshEvent).seq + 1,
    time: createdAt,
    data: { title, messageSeqs: [], source: { kind: "user" } },
  });
  const id = `session-${randomUUID()}`;
  return {
    id,
    title,
    header: {
      type: "session",
      version: FORMAT_VERSION,
      id,
      createdAt,
      ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
      parentSession: header.id,
      isSeeded: true,
      delegationDepth: 0,
      ...(header.agentPreset === undefined ? {} : { agentPreset: header.agentPreset }),
    },
    events: forkEvents,
    boundary: last.seq,
    sourceId: String(header.id),
    cwd: header.cwd,
    createdAt,
  };
}

/** 把 fork 计划写成「header 单独一帧 + 每 500 条事件一帧」的会话日志。 */
export function writeFork(plan: ForkPlan, root: string): { file: string; bytes: number } {
  const file = logPath(root, plan.cwd, plan.id);
  const dir = sessionDir(root, plan.cwd, plan.id);
  mkdirSync(dir, { recursive: true });
  if (existsSync(file)) throw new Error(`refusing to overwrite ${file}`);
  const frames: Buffer[] = [
    zstdCompressSync(Buffer.from(JSON.stringify(plan.header) + "\n", "utf8")),
  ];
  for (let i = 0; i < plan.events.length; i += 500) {
    const text = plan.events
      .slice(i, i + 500)
      .map((event) => JSON.stringify(event) + "\n")
      .join("");
    frames.push(zstdCompressSync(Buffer.from(text, "utf8")));
  }
  const buffer = Buffer.concat(frames);
  writeFileSync(file, buffer);
  return { file, bytes: buffer.length };
}
