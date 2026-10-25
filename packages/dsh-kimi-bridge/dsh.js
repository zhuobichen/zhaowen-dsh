/**
 * DSH（DeepSeek Harness）v4 会话的读与写。
 *
 * 读：优先服务（`ctx.sessionQuery.readSession` / `ctx.sessionController.inspect` /
 *     `ctx.sessions.get`），服务不可用时自己解 `session.v4.jsonl.zstd`
 *     （magic `28 B5 2F FD` 切帧 + `zstdDecompressSync`，Node 内置）。
 * 写：`ctx.sessions.create(id, { seed, meta })` → `ctx.sessions.flush(session)`；
 *     没有会话服务时退回写文件（同一套 seed → 行 → zstd 帧）。
 *
 * 事件行形状（以真实文件为准）：
 *   { type, seq, time, data, surfaceOp? }
 *   header `{type:"session", version:4, id, createdAt, cwd, ...}`
 *   user/message    data = { role, id, content, source:{kind:"user"} }
 *   assistant/message data = { turn, step, message:{role,id,content,source}, stream:[] }
 *   system/message  data = { turn, step, message:{role,id,content,source} }
 *   tool/call       data = { turn, step, callId, name, arguments }
 *   tool/result     data = { turn, step, message:{role,id,content,source,toolCallId} }
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";

export const FORMAT_VERSION = 4;

const ESCAPE_UNIT = (ch) => "~" + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0");
const SAFE = /[A-Za-z0-9_.-]/;

/** 会话 id / 任意字符串 → 安全单段路径名（与 DSH format 的 encodeSegment 等价）。 */
export function encodeSegment(raw) {
  if (!raw) throw new Error("empty segment");
  let out = "";
  for (const ch of raw) out += SAFE.test(ch) ? ch : ESCAPE_UNIT(ch);
  if (out === "." || out === "..") out = out.replace(/\./g, "~002E");
  return out;
}

/** cwd → 项目目录名（`D:\a\b` → `-D-a-b`，非安全码元转 ~XXXX）。 */
export function projectKey(cwd) {
  return String(cwd)
    .replace(/[\\/:]+/g, "-")
    .replace(/[^A-Za-z0-9_.-]/g, (ch) => ESCAPE_UNIT(ch));
}

export const projectDir = (root, cwd) =>
  join(root, cwd === undefined || cwd === null ? "_no-cwd" : `--${projectKey(cwd)}--`);

export const sessionDir = (root, cwd, id) => join(projectDir(root, cwd), encodeSegment(id));

export const sessionFile = (root, cwd, id, version = FORMAT_VERSION) =>
  join(sessionDir(root, cwd, id), `session.v${version}.jsonl.zstd`);

/* ------------------------------------------------------------------ 根目录 */

/**
 * DSH sessions 根目录：显式 root > $DSH_HOME/sessions > ~/.dsh/sessions。
 * 本机开发树里还有 `<repo>/dsh/home/sessions`，由调用方通过 config 传入。
 */
export function dshSessionsRoot(options = {}) {
  if (options.root) return resolve(options.root);
  const home = process.env.DSH_HOME || join(homedir(), ".dsh");
  return join(home, "sessions");
}

/* ------------------------------------------------------------------ 读文件 */

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** 解一串独立 zstd 帧里的全部 JSONL 行。 */
export function readZstdRows(file) {
  const buf = readFileSync(file);
  const offsets = [];
  for (let i = buf.indexOf(ZSTD_MAGIC); i >= 0; i = buf.indexOf(ZSTD_MAGIC, i + 4)) offsets.push(i);
  if (offsets.length === 0) throw new Error(`no zstd frame found in ${file}`);
  const rows = [];
  for (let k = 0; k < offsets.length; k += 1) {
    const end = k + 1 < offsets.length ? offsets[k + 1] : buf.length;
    const text = zstdDecompressSync(buf.subarray(offsets[k], end)).toString("utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line));
      } catch {
        /* 坏行跳过 */
      }
    }
  }
  return rows;
}

/** 在 sessions 根目录下按 id 找会话文件（不依赖 cwd）。 */
export function findSessionFile(root, id, version = FORMAT_VERSION) {
  const target = `session.v${version}.jsonl.zstd`;
  let projects = [];
  try {
    projects = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return undefined;
  }
  const encoded = encodeSegment(id);
  for (const project of projects) {
    const dir = join(root, project, encoded);
    const file = join(dir, target);
    if (existsSync(file)) return file;
  }
  return undefined;
}

/** 读一个会话文件 → {header, events, rows}。 */
export function readSessionFile(file) {
  const rows = readZstdRows(file);
  const [header, ...rest] = rows;
  if (!header || header.type !== "session") throw new Error(`unexpected header in ${file}`);
  return { header, events: rest, rows, file };
}

/* ------------------------------------------------------------------ IR */

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function blocksText(content) {
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (isPlainObject(block) && block.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n");
}

function blocksReasoning(content) {
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (isPlainObject(block) && block.type === "reasoning" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n");
}

function blocksToolCalls(content) {
  if (!Array.isArray(content)) return [];
  const calls = [];
  for (const block of content) {
    if (!isPlainObject(block) || block.type !== "tool-call") continue;
    const args = block.arguments;
    calls.push({
      id: String(block.id ?? ""),
      name: String(block.name ?? ""),
      arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
    });
  }
  return calls;
}

/**
 * 事件 → IR：{id, cwd, createdAt, title, system, messages:[{role,text,toolCalls,…}]}
 * 只取 surface 里的消息事件；工具调用同时来自 assistant 的 tool-call 块和 tool/call 事件。
 */
export function buildIr(header, events) {
  const messages = [];
  let title;
  let cwd = header?.cwd;
  let createdAt = header?.createdAt;
  const lastIndexOfCall = new Map();

  for (const event of events ?? []) {
    if (!isPlainObject(event)) continue;
    switch (event.type) {
      case "session/title":
        if (typeof event.data?.title === "string") title = event.data.title;
        break;
      case "user/message": {
        const text = typeof event.data?.content === "string" ? event.data.content : blocksText(event.data?.content);
        messages.push({ role: "user", text, time: event.time });
        break;
      }
      case "assistant/message": {
        const content = event.data?.message?.content ?? [];
        const message = {
          role: "assistant",
          text: blocksText(content),
          reasoning: blocksReasoning(content),
          toolCalls: blocksToolCalls(content),
          time: event.time,
        };
        messages.push(message);
        for (const call of message.toolCalls) if (call.id) lastIndexOfCall.set(call.id, message);
        break;
      }
      case "tool/call": {
        // tool-call 块已在 assistant/message 里；这里只补齐缺失的（孤立调用）
        const known = messages.some((m) => (m.toolCalls ?? []).some((c) => c.id === event.data?.callId));
        if (!known && event.data?.callId) {
          const message = messages[messages.length - 1];
          if (message?.role === "assistant") {
            message.toolCalls = [
              ...(message.toolCalls ?? []),
              {
                id: String(event.data.callId),
                name: String(event.data.name ?? ""),
                arguments:
                  typeof event.data.arguments === "string"
                    ? event.data.arguments
                    : JSON.stringify(event.data.arguments ?? {}),
              },
            ];
          }
        }
        break;
      }
      case "tool/result": {
        const text =
          typeof event.data?.message?.content === "string"
            ? event.data.message.content
            : blocksText(event.data?.message?.content);
        const callId = event.data?.message?.toolCallId ?? event.data?.toolCallId ?? "";
        messages.push({ role: "tool", text, toolCallId: callId ? String(callId) : undefined, time: event.time });
        break;
      }
      case "system/message": {
        const text = blocksText(event.data?.message?.content);
        if (text && !messages.some((m) => m.role === "system")) {
          messages.unshift({ role: "system", text, time: event.time });
        }
        break;
      }
      default:
        break;
    }
  }

  return { id: header?.id, cwd, createdAt, title, messages };
}

/** 来自服务的内存会话（有 deriveMessages 时用它的模型面）。 */
function irFromLiveSession(session) {
  const header = session?.header ?? session?.meta ?? {};
  const messages = [];
  let list = [];
  if (typeof session?.deriveMessages === "function") list = session.deriveMessages() ?? [];
  else if (Array.isArray(session?.messages)) list = session.messages;
  for (const message of list) {
    if (!isPlainObject(message)) continue;
    const role = String(message.role ?? "");
    if (role === "system") continue;
    if (role === "user") messages.push({ role: "user", text: blocksText(message.content), time: message.time });
    else if (role === "assistant")
      messages.push({
        role: "assistant",
        text: blocksText(message.content),
        reasoning: blocksReasoning(message.content),
        toolCalls: blocksToolCalls(message.content),
        time: message.time,
      });
    else if (role === "tool")
      messages.push({
        role: "tool",
        text: blocksText(message.content),
        toolCallId: message.toolCallId ? String(message.toolCallId) : undefined,
        time: message.time,
      });
  }
  return {
    id: header.id,
    cwd: header.cwd,
    createdAt: header.createdAt,
    title: undefined,
    messages,
  };
}

function services(ctx) {
  const get = (name) => {
    if (ctx === undefined || ctx === null) return undefined;
    let value;
    try {
      if (typeof ctx.get === "function") value = ctx.get(name);
    } catch {
      /* 服务未注册时会抛，忽略 */
    }
    return value === undefined ? ctx[name] : value;
  };
  return {
    sessionQuery: get("sessionQuery"),
    sessionController: get("sessionController"),
    sessions: get("sessions"),
  };
}

/**
 * 读一个 DSH 会话：服务优先，文件兜底。
 * @returns {{source:"service"|"file", header:object, events:object[], ir:object, file?:string}}
 */
export async function readDshSession(ctx, id, options = {}) {
  const { sessionQuery, sessionController, sessions } = services(ctx);
  const attempts = [];

  const unwrap = (value) => {
    if (!value) return undefined;
    if (Array.isArray(value)) return { header: undefined, events: value };
    if (Array.isArray(value.events)) return { header: value.header ?? value.session?.header, events: value.events };
    if (Array.isArray(value.rows)) return { header: value.header, events: value.rows.filter((r) => r?.type !== "session") };
    return undefined;
  };

  if (sessionQuery?.readSession) {
    try {
      const wrapped = unwrap(await sessionQuery.readSession(id));
      if (wrapped) attempts.push({ source: "service", via: "sessionQuery.readSession", ...wrapped });
    } catch (error) {
      attempts.push({ error: `sessionQuery.readSession: ${error?.message ?? error}` });
    }
  }
  if (sessionController?.inspect) {
    try {
      const wrapped = unwrap(await sessionController.inspect(id));
      if (wrapped) attempts.push({ source: "service", via: "sessionController.inspect", ...wrapped });
    } catch (error) {
      attempts.push({ error: `sessionController.inspect: ${error?.message ?? error}` });
    }
  }
  if (sessions?.get) {
    try {
      const live = await sessions.get(id);
      if (live && (typeof live.deriveMessages === "function" || live.header)) {
        attempts.push({ source: "service", via: "sessions.get", live });
      }
    } catch (error) {
      attempts.push({ error: `sessions.get: ${error?.message ?? error}` });
    }
  }

  for (const attempt of attempts) {
    if (attempt.error) continue;
    if (attempt.live) {
      const ir = irFromLiveSession(attempt.live);
      if (ir.messages.length > 0) {
        return { source: "service", via: attempt.via, header: attempt.live.header ?? {}, events: [], ir };
      }
      continue;
    }
    const ir = buildIr(attempt.header, attempt.events);
    if (ir.messages.length > 0) {
      return { source: "service", via: attempt.via, header: attempt.header ?? {}, events: attempt.events, ir };
    }
  }

  const root = dshSessionsRoot(options);
  const file = findSessionFile(root, id, options.version ?? FORMAT_VERSION);
  if (!file) {
    const error = new Error(`找不到 DSH 会话 ${id}（服务不可用，${root} 下也没有对应文件）`);
    error.code = "SESSION_NOT_FOUND";
    error.attempts = attempts.map((a) => a.error ?? a.via);
    throw error;
  }
  const parsed = readSessionFile(file);
  return {
    source: "file",
    via: "session.v4.jsonl.zstd",
    header: parsed.header,
    events: parsed.events,
    rows: parsed.rows,
    file,
    ir: buildIr(parsed.header, parsed.events),
  };
}

/* ------------------------------------------------------------------ seed */

const nowMs = () => Date.now();

class Builder {
  constructor(meta) {
    this.meta = meta;
    this.events = [];
    this.seq = 0;
    this.turn = 0;
    this.step = 0;
    this.lastTime = Number.isFinite(meta.createdAt) ? meta.createdAt : nowMs();
    this.openTurn = false;
    this.openStep = false;
    this.droppedOrphans = 0;
    this.synthesizedResults = 0;
  }

  emit(type, time, data, extra = {}) {
    const stamped = Number.isFinite(time) ? Math.max(time, this.lastTime) : this.lastTime;
    this.lastTime = stamped;
    const event = { type, seq: this.seq, time: stamped, data, ...extra };
    this.seq += 1;
    this.events.push(event);
    return event;
  }

  startTurn(time) {
    this.turn += 1;
    this.emit("turn/start", time, { turn: this.turn });
    this.openTurn = true;
    this.step = 0;
  }

  startStep(time) {
    this.step += 1;
    this.emit("step/start", time, { turn: this.turn, step: this.step });
    this.openStep = true;
  }

  systemMessage(time, text) {
    this.emit(
      "system/message",
      time,
      {
        turn: this.turn,
        step: this.step,
        message: {
          role: "system",
          id: randomUUID(),
          content: [{ type: "text", text }],
          source: { kind: "system-prompt" },
        },
      },
      { surfaceOp: "append" },
    );
  }

  userMessage(time, text) {
    const event = this.emit(
      "user/message",
      time,
      {
        role: "user",
        id: randomUUID(),
        content: [{ type: "text", text }],
        source: { kind: "user" },
      },
      { surfaceOp: "append" },
    );
    return event;
  }

  title(time, text, messageSeqs) {
    const title = String(text).replace(/\s+/g, " ").trim().slice(0, 60);
    if (!title) return undefined;
    this.emit("session/title", time, { title, messageSeqs, source: { kind: "fallback" } });
    return title;
  }

  assistantMessage(time, message, provider, model) {
    return this.emit(
      "assistant/message",
      time,
      {
        turn: this.turn,
        step: this.step,
        message: {
          role: "assistant",
          id: randomUUID(),
          content: message.content,
          source: { kind: "model", provider, model },
        },
        stream: [],
      },
      { surfaceOp: "append" },
    );
  }

  toolCall(time, call) {
    const event = this.emit("tool/call", time, {
      turn: this.turn,
      step: this.step,
      callId: call.id,
      name: call.name,
      arguments: call.arguments,
    });
    this.pending.set(call.id, event.seq);
    return event;
  }

  toolResult(time, result) {
    const callSeq = this.pending.get(result.callId);
    this.pending.delete(result.callId);
    return this.emit(
      "tool/result",
      time,
      {
        turn: this.turn,
        step: this.step,
        message: {
          role: "tool",
          id: randomUUID(),
          content: [{ type: "text", text: result.text }],
          source: { kind: "tool", callId: result.callId },
          toolCallId: result.callId,
        },
        ...(result.isError ? { isError: true } : {}),
      },
      { ...(callSeq === undefined ? {} : { sourceEventSeqs: [callSeq] }), surfaceOp: "append" },
    );
  }

  endStep(time) {
    if (!this.openStep) return;
    for (const callId of [...this.pending.keys()]) {
      this.synthesizedResults += 1;
      this.toolResult(time, {
        callId,
        text: "No tool result was recorded for this call in the source transcript (TOOL_OUTCOME_UNKNOWN).",
        isError: true,
      });
    }
    this.emit("step/end", time, { turn: this.turn, step: this.step });
    this.openStep = false;
  }

  endTurn(time, reason = { kind: "completed" }) {
    if (!this.openTurn) return;
    this.endStep(time);
    this.emit("turn/end", time, { turn: this.turn, reason });
    this.openTurn = false;
  }
}

// pending 是惰性 Map，只有 toolCall 用得到
Object.defineProperty(Builder.prototype, "pending", {
  get() {
    if (!this._pending) this._pending = new Map();
    return this._pending;
  },
});

/**
 * IR → DSH seed 事件（num 从 1 连续、time 单调不减）。
 *
 * 结构：每个 turn 一个 user step + 若干 assistant/tool step，
 * system/message 是 surface 的第一个节点（缺了它续聊会写坏日志）。
 */
export function buildSeed(ir, options = {}) {
  const createdAt = Number.isFinite(options.createdAt)
    ? options.createdAt
    : Number.isFinite(ir?.createdAt)
      ? ir.createdAt
      : nowMs();
  const builder = new Builder({ createdAt });
  const provider = options.provider ?? "kimi-code";
  const model = options.model ?? "kimi";
  const baseTime = createdAt;

  const turns = groupTurns(ir?.messages ?? []);
  const systemText =
    options.systemText ??
    `This conversation was imported from Kimi Code (${ir?.id ?? "unknown session"}) by dsh-kimi-bridge. The original system prompt is not part of a Kimi Code session log.`;

  let clock = baseTime;
  const next = (step = 2) => (clock += step);
  let titleSet = false;
  let userMessages = 0;
  let assistantMessages = 0;
  let toolCalls = 0;

  turns.forEach((turn, index) => {
    if (!turn.user) {
      // 开头的 assistant/tool 片段：没有用户消息就不该有 turn，直接并到下一轮之前丢弃
      builder.droppedOrphans += turn.parts.length;
      return;
    }
    builder.startTurn(next());
    builder.startStep(next());
    if (index === 0) builder.systemMessage(next(), systemText);
    const userEvent = builder.userMessage(next(), turn.user.text);
    userMessages += 1;
    if (!titleSet) {
      const text = options.title ?? ir?.title ?? turn.user.text;
      builder.title(next(), text, [userEvent.seq]);
      titleSet = true;
    }
    builder.endStep(next());

    // 助手轮：一条 assistant/message 一个 step，随后的工具结果同 step
    let cursor = 0;
    while (cursor < turn.parts.length) {
      const part = turn.parts[cursor];
      if (part.role !== "assistant") {
        builder.droppedOrphans += 1;
        cursor += 1;
        continue;
      }
      builder.startStep(next());
      const content = [];
      if (part.reasoning) content.push({ type: "reasoning", text: part.reasoning });
      if (part.text) content.push({ type: "text", text: part.text });
      const calls = (part.toolCalls ?? []).map((call) => ({
        id: call.id || randomUUID(),
        name: call.name,
        arguments: call.arguments ?? "{}",
      }));
      for (const call of calls) content.push({ type: "tool-call", id: call.id, name: call.name, arguments: call.arguments });
      if (content.length === 0) {
        builder.endStep(next());
        cursor += 1;
        continue;
      }
      builder.assistantMessage(next(), { content }, provider, model);
      assistantMessages += 1;
      for (const call of calls) builder.toolCall(next(), call);
      toolCalls += calls.length;

      // 收集紧随其后的 tool 结果
      const results = [];
      let lookahead = cursor + 1;
      while (lookahead < turn.parts.length && turn.parts[lookahead].role === "tool") {
        results.push(turn.parts[lookahead]);
        lookahead += 1;
      }
      for (const call of calls) {
        const matchIndex = results.findIndex(
          (result) => !result.__used && (!result.toolCallId || result.toolCallId === call.id),
        );
        const match = matchIndex >= 0 ? results[matchIndex] : undefined;
        if (match) {
          match.__used = true;
          builder.toolResult(next(), { callId: call.id, text: match.text });
        } else {
          builder.synthesizedResults += 1;
          builder.toolResult(next(), {
            callId: call.id,
            text: "No tool result was recorded for this call in the source transcript (TOOL_OUTCOME_UNKNOWN).",
            isError: true,
          });
        }
      }
      builder.droppedOrphans += results.filter((result) => !result.__used).length;
      builder.endStep(next());
      cursor = lookahead;
    }

    builder.endTurn(next());
  });

  return {
    seed: builder.events,
    stats: {
      turns: builder.turn,
      user: userMessages,
      assistant: assistantMessages,
      toolCalls,
      synthesizedResults: builder.synthesizedResults,
      droppedOrphans: builder.droppedOrphans,
      events: builder.events.length,
    },
  };
}

/** user 消息开 turn；assistant/tool 归属最近的 turn。 */
export function groupTurns(messages) {
  const turns = [];
  let current;
  for (const message of messages) {
    if (message.role === "user") {
      current = { user: message, parts: [] };
      turns.push(current);
      continue;
    }
    if (current === undefined) {
      current = { user: undefined, parts: [] };
      turns.push(current);
    }
    current.parts.push(message);
  }
  return turns;
}

/* ------------------------------------------------------------------ 写 */

export function sessionHeader(id, options = {}) {
  return {
    type: "session",
    version: FORMAT_VERSION,
    id,
    createdAt: Number.isFinite(options.createdAt) ? options.createdAt : nowMs(),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    isSeeded: false,
    delegationDepth: 0,
  };
}

/** seed → 一串 zstd 帧（第一帧只有 header 行）。 */
export function encodeSession(header, events, batch = 500) {
  const frames = [zstdCompressSync(Buffer.from(JSON.stringify(header) + "\n", "utf8"))];
  for (let i = 0; i < events.length; i += batch) {
    const text = events
      .slice(i, i + batch)
      .map((event) => JSON.stringify(event) + "\n")
      .join("");
    frames.push(zstdCompressSync(Buffer.from(text, "utf8")));
  }
  return Buffer.concat(frames);
}

/** 兜底写文件（没有会话服务时）。 */
export function writeSessionFile(options) {
  const root = dshSessionsRoot(options);
  const header = options.header ?? sessionHeader(options.id, options);
  const dir = sessionDir(root, header.cwd, header.id);
  mkdirSync(dir, { recursive: true });
  const file = sessionFile(root, header.cwd, header.id);
  const buffer = encodeSession(header, options.seed ?? []);
  writeFileSync(file, buffer);
  return { file, dir, bytes: buffer.length };
}

/**
 * 写会话：优先 `ctx.sessions.create(id, {seed, meta})` + `flush()`，否则退回文件。
 * @returns {{id, via, file?}}
 */
export async function createDshSession(ctx, options) {
  const id = options.id;
  const { sessions } = services(ctx);
  const seed = options.seed ?? [];
  if (sessions?.create) {
    const session = sessions.create(id, {
      seed,
      meta: options.cwd === undefined ? undefined : { cwd: options.cwd },
    });
    if (typeof sessions.flush === "function") await sessions.flush(session);
    return { id, via: "service", events: seed.length, session };
  }
  const written = writeSessionFile({ ...options, seed });
  return { id, via: "file", events: seed.length, ...written };
}

/** 校验 seed 是否被 DSH 自己的还原器接受（需要 @deepseek-ai/dsh-session）。 */
export async function validateSeedWithCatalog(id, seed, header) {
  const candidates = [
    process.env.DSH_SESSION_MODULE,
    join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "..", "toolchain", "node_modules", "@deepseek-ai", "dsh-session", "lib", "index.js"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) continue;
    const module = await import("file:///" + candidate.replace(/\\/g, "/"));
    if (typeof module?.Session?.create !== "function") continue;
    const session = module.Session.create(id, seed, header);
    return { ok: true, module: candidate, messages: session.deriveMessages().length, seq: session.seq };
  }
  return { ok: false, reason: "找不到 @deepseek-ai/dsh-session 的 Session.create" };
}
