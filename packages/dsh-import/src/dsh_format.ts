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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
