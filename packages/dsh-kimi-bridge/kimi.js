/**
 * Kimi Code 会话存储（`~/.kimi-code/sessions`）的读写。
 *
 * 文件是唯一真相：
 *   <sessionsRoot>/<workspaceKey>/<sessionId>/agents/main/wire.jsonl   ← 事件流
 *   <sessionsRoot>/<workspaceKey>/<sessionId>/state.json              ← 会话元数据（标题/cwd/时间）
 *
 * `.index-cache/` / `.index-dirty/` / `server/events/` 都是派生文件，这里既不读也不写。
 *
 * wire.jsonl 的行分两类（详见 README 的清单）：
 *   环境声明 —— metadata / runtime.set_binding / mcp.tools_discovered / profile.bind /
 *               changeNotifier.snapshot / config.update / permission.set_mode /
 *               llm.tools_snapshot / plugin.session_start      → 克隆模板时照抄
 *   会话内容 —— context.append_message / agent.message.appended / agent.turn.started /
 *               turn.prompt / turn.ended / agent.turn.ended    → 按导入的对话重写
 * 其余（llm.request / usage.record / token_counting.* / context.append_loop_event …）是
 * 上一轮对话的实测数据，复制过来就是伪造，一律丢掉。
 *
 * 时间戳一律毫秒（样本 metadata.created_at = 1792774655980）。
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

/** 照抄的环境声明行。其余 type 都是会话内容或上一轮的实测数据。 */
export const ENV_LINE_TYPES = Object.freeze([
  "metadata",
  "runtime.set_binding",
  "mcp.tools_discovered",
  "profile.bind",
  "changeNotifier.snapshot",
  "config.update",
  "permission.set_mode",
  "llm.tools_snapshot",
  "plugin.session_start",
]);

const ENV_SET = new Set(ENV_LINE_TYPES);

/** 重写时会用到的会话内容行（仅供文档/自检）。 */
export const CONVERSATION_LINE_TYPES = Object.freeze([
  "context.append_message",
  "agent.message.appended",
  "agent.turn.started",
  "agent.turn.ended",
  "turn.prompt",
  "turn.ended",
]);

/** 从模板里丢掉的"上一轮实测"行。 */
export const DROPPED_LINE_TYPES = Object.freeze([
  "llm.request",
  "usage.record",
  "token_counting.measured",
  "token_counting.turn_recorded",
  "context.append_loop_event",
  "prompt.completed",
]);

/* ------------------------------------------------------------------ 路径 */

/** `~/.kimi-code`（可用 KIMI_CODE_HOME 覆盖）。 */
export function kimiHome(options = {}) {
  return options.kimiHome || process.env.KIMI_CODE_HOME || join(homedir(), ".kimi-code");
}

/** `<kimiHome>/sessions`（可用 sessionsRoot 直接覆盖，测试只对副本操作）。 */
export function sessionsRoot(options = {}) {
  if (options.sessionsRoot) return resolve(options.sessionsRoot);
  return join(kimiHome(options), "sessions");
}

export const workspaceDir = (root, key) => join(root, key);
export const sessionDir = (root, key, id) => join(root, key, id);
export const wirePath = (root, key, id) => join(root, key, id, "agents", "main", "wire.jsonl");
export const statePath = (root, key, id) => join(root, key, id, "state.json");

/* ------------------------------------------------------------------ id */

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Kimi 的消息/prompt id 是 ULID：`msg_` + 26 位 Crockford base32
 * （样本 `msg_01M5MV4M08RX7ER7VHF9ZTME4B`，前十位编码毫秒时间）。
 */
export function newUlid(time = Date.now()) {
  let head = "";
  let rest = Math.floor(time);
  for (let i = 0; i < 10; i += 1) {
    head = ULID_ALPHABET[rest % 32] + head;
    rest = Math.floor(rest / 32);
  }
  const bytes = randomBytes(16);
  let tail = "";
  for (let i = 0; i < 16; i += 1) tail += ULID_ALPHABET[bytes[i] % 32];
  return head + tail;
}

export const newMessageId = () => `msg_${newUlid()}`;

/** `session_<uuid>` —— 与样本 `session_465a214d-...` 一致。 */
export const newSessionId = () => `session_${randomUUID()}`;

/** `traceId` 是 32 位小写十六进制（样本 54f8f1bcb6d71972b588e9138e7d7478）。 */
export const newTraceId = () => randomBytes(16).toString("hex");

export const newUuid = () => randomUUID();

/* ------------------------------------------------------------------ 读 */

/** 读一个目录下的 workspaceKey（跳过 .index-cache / .index-dirty 这类派生目录）。 */
export function listWorkspaceKeys(root) {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** 逐行解析 wire.jsonl；坏行跳过并计数，不抛。 */
export function parseWire(text) {
  const rows = [];
  let bad = 0;
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      bad += 1;
    }
  }
  return { rows, bad };
}

/** 读 wire.jsonl 文件。 */
export function readWire(file) {
  const text = readFileSync(file, "utf8");
  const { rows, bad } = parseWire(text);
  return { rows, bad, path: file, bytes: Buffer.byteLength(text) };
}

function readStateFile(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** 一条消息的文本：content 里所有 text 块拼起来。 */
export function textOfContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (!isPlainObject(block)) continue;
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
    else if (block.type === "tool_result" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n");
}

/** 一条消息上的工具调用（content 里的 tool_use / toolCalls 字段都算）。 */
export function toolCallsOfMessage(message) {
  const calls = [];
  if (Array.isArray(message?.toolCalls)) {
    for (const call of message.toolCalls) {
      if (!isPlainObject(call)) continue;
      const fn = isPlainObject(call.function) ? call.function : call;
      const args = fn.arguments ?? fn.args ?? "";
      calls.push({
        id: String(call.id ?? call.callId ?? ""),
        name: String(fn.name ?? call.name ?? ""),
        arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
      });
    }
  }
  if (Array.isArray(message?.content)) {
    for (const block of message.content) {
      if (!isPlainObject(block)) continue;
      if (block.type !== "tool_use" && block.type !== "tool-call") continue;
      const args = block.arguments ?? block.inputs ?? block.input ?? {};
      calls.push({
        id: String(block.id ?? ""),
        name: String(block.name ?? ""),
        arguments: typeof args === "string" ? args : JSON.stringify(args),
      });
    }
  }
  return calls;
}

const isInjection = (message) => message?.origin?.kind === "injection";

/** 助手消息里的 think 块（Kimi 把思维链放在 content 的 think 块里）。 */
export function reasoningOfContent(content) {
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (!isPlainObject(block)) continue;
    if (block.type === "think" && typeof block.think === "string") parts.push(block.think);
    else if (block.type === "reasoning" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n");
}

/**
 * 从 wire 行里抽出对话（user / assistant / tool），丢掉 <system-reminder> 这类注入。
 *
 * 两个来源，按行序合并：
 *   context.append_message   —— 真正进上下文的记录（user / tool，以及本插件写出的 assistant）
 *   agent.message.appended   —— UI 流；**真实 Kimi 会话里的 assistant 回复只在这里**
 * 去重：user 用 message.id / meta.userMessageId；assistant 若 context 里已经有就整段跳过，
 * 否则按 `文本|工具调用 id` 指纹去重。
 */
export function extractConversation(rows) {
  const hasContextAssistant = rows.some(
    (row) =>
      row?.type === "context.append_message" &&
      row.message?.role === "assistant" &&
      !isInjection(row.message),
  );

  const messages = [];
  const seen = new Set();
  const seenAssistant = new Set();

  for (const row of rows) {
    if (row?.type === "context.append_message") {
      const message = row.message;
      if (!isPlainObject(message) || isInjection(message)) continue;
      const role = String(message.role ?? "");
      if (role !== "user" && role !== "assistant" && role !== "tool") continue;
      const key = message.id ? `id:${message.id}` : undefined;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      const assistantKey = `${textOfContent(message.content)}|${toolCallsOfMessage(message).map((c) => c.id).join(",")}`;
      if (role === "assistant") seenAssistant.add(assistantKey);
      messages.push({
        role,
        text: textOfContent(message.content),
        reasoning: reasoningOfContent(message.content),
        toolCalls: toolCallsOfMessage(message),
        toolCallId: message.toolCallId ? String(message.toolCallId) : undefined,
        id: message.id ? String(message.id) : undefined,
        time: Number.isFinite(row.time) ? row.time : undefined,
      });
      continue;
    }

    if (row?.type === "agent.message.appended") {
      const message = row?.message?.message;
      if (!isPlainObject(message) || isInjection(message)) continue;
      const role = String(message.role ?? "");
      if (role !== "user" && role !== "assistant") continue;
      const meta = isPlainObject(row?.message?.meta) ? row.message.meta : {};
      if (role === "assistant" && hasContextAssistant) continue;
      const id = meta.userMessageId ?? meta.messageId;
      const key = id ? `id:${id}` : undefined;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      const text = textOfContent(message.content);
      const toolCalls = toolCallsOfMessage(message);
      const assistantKey = `${text}|${toolCalls.map((c) => c.id).join(",")}`;
      if (role === "assistant") {
        if (seenAssistant.has(assistantKey)) continue;
        seenAssistant.add(assistantKey);
      }
      messages.push({
        role,
        text,
        reasoning: reasoningOfContent(message.content),
        toolCalls,
        id: id ? String(id) : undefined,
        time: Number.isFinite(row.time) ? row.time : undefined,
      });
    }
  }

  if (messages.length === 0) {
    for (const row of rows) {
      if (row?.type !== "turn.prompt") continue;
      const text = textOfContent(row.input);
      if (!text) continue;
      messages.push({
        role: "user",
        text,
        toolCalls: [],
        time: Number.isFinite(row.time) ? row.time : undefined,
      });
    }
  }

  return messages;
}

/** 统计一个 wire。 */
export function summarizeRows(rows) {
  let protocolVersion;
  let createdAt;
  let title;
  let lastTime = 0;
  let toolCalls = 0;
  for (const row of rows) {
    if (row?.type === "metadata") {
      if (row.protocol_version !== undefined) protocolVersion = row.protocol_version;
      if (Number.isFinite(row.created_at)) createdAt = row.created_at;
    }
    if (Number.isFinite(row?.time)) lastTime = Math.max(lastTime, row.time);
  }
  const conversation = extractConversation(rows);
  const roles = { user: 0, assistant: 0, tool: 0 };
  for (const m of conversation) {
    roles[m.role] = (roles[m.role] ?? 0) + 1;
    toolCalls += m.toolCalls.length;
  }
  const firstUser = conversation.find((m) => m.role === "user");
  if (firstUser) title = firstUser.text.replace(/\s+/g, " ").trim().slice(0, 40);
  return {
    lineCount: rows.length,
    protocolVersion,
    createdAt,
    lastTime,
    messages: conversation.length,
    roles,
    toolCalls,
    title,
  };
}

/**
 * 扫 sessions 根目录：每个 workspaceKey 下每个 sessionId 一条记录。
 * 只解析 wire.jsonl + state.json，不碰任何派生索引。
 */
export function listSessions(options = {}) {
  const root = sessionsRoot(options);
  const sessions = [];
  for (const workspaceKey of listWorkspaceKeys(root)) {
    const dir = workspaceDir(root, workspaceKey);
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const sessionId = entry.name;
      const file = wirePath(root, workspaceKey, sessionId);
      if (!existsSync(file)) continue;
      let wire;
      try {
        wire = readWire(file);
      } catch {
        continue;
      }
      const state = readStateFile(statePath(root, workspaceKey, sessionId));
      const summary = summarizeRows(wire.rows);
      let updatedAt = state?.updatedAt;
      if (!Number.isFinite(updatedAt)) {
        try {
          updatedAt = statSync(file).mtimeMs;
        } catch {
          updatedAt = summary.lastTime || 0;
        }
      }
      sessions.push({
        sessionId,
        workspaceKey,
        path: file,
        updatedAt,
        createdAt: Number.isFinite(state?.createdAt) ? state.createdAt : summary.createdAt,
        cwd: state?.cwd,
        title: state?.title ?? summary.title ?? null,
        archived: state?.archived === true,
        messages: summary.messages,
        roles: summary.roles,
        toolCalls: summary.toolCalls,
        lineCount: summary.lineCount,
        protocolVersion: summary.protocolVersion,
      });
    }
  }
  sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return sessions;
}

/* --------------------------------------------------- workspaceKey */

/** 路径归一：去尾分隔符、盘符大写（`d:\` → `D:`）。 */
export function normalizeRootPath(path) {
  if (!path) return "";
  let p = String(path).replace(/[\\/]+/g, sep);
  if (p.length > 1) p = p.replace(/[\\/]+$/, "");
  if (/^[a-z]:$/i.test(p)) p = p.toUpperCase();
  return p;
}

/**
 * 观测到的 workspaceKey 形状：`wd_<drive>_<sha256(调用点传入的路径字符串)[0..12]>`。
 * 哈希**大小写敏感**，两个真实样本正好落在两种写法上：
 *   sessions/wd_d_4eac808749fa        ← sha256("D:")[:12] = 4eac808749fa
 *   workspace-trust/wd_d_394e0f7e2f80 ← sha256("d:")[:12] = 394e0f7e2f80
 * 前两段（`wd_d_`）只有 D: 盘一个盘符的证据，因此**不**用它来臆造别的工作区。
 */
export function workspaceKeyFromString(path) {
  const raw = String(path ?? "");
  if (!raw) return undefined;
  const drive = /^([A-Za-z]):/.exec(raw)?.[1]?.toLowerCase();
  const digest = createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 12);
  return drive ? `wd_${drive}_${digest}` : `wd_${digest}`;
}

/** 归一（盘符大写、去尾分隔符）之后再套用上面的公式。 */
export function deriveWorkspaceKey(path) {
  return workspaceKeyFromString(normalizeRootPath(path));
}

/** 读 `workspaces.json`（只读，不写）。 */
export function readWorkspacesFile(home) {
  const file = join(home ?? kimiHome(), "workspaces.json");
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    return { file, workspaces: isPlainObject(data?.workspaces) ? data.workspaces : {} };
  } catch {
    return { file, workspaces: {} };
  }
}

/**
 * 选 workspaceKey：
 *   1. 显式传入 —— 必须是已存在的工作区（否则 Kimi 侧看不到这个会话）。
 *   2. 否则挑一个已有工作区：优先 root 是 cwd 前缀（最长匹配），其次最近打开。
 * 绝不新建工作区：新建要改 `workspaces.json`，那在 `sessions/` 之外，明确禁止。
 */
export function chooseWorkspace(options = {}) {
  const root = sessionsRoot(options);
  const home = options.kimiHome ?? kimiHome();
  const existing = new Set(listWorkspaceKeys(root).filter((key) => {
    const dir = join(root, key);
    try {
      return readdirSync(dir, { withFileTypes: true }).some((e) => e.isDirectory() && !e.name.startsWith("."));
    } catch {
      return false;
    }
  }));
  const { workspaces } = readWorkspacesFile(home);
  const cwd = normalizeRootPath(options.cwd ?? "");

  if (options.workspaceKey) {
    const key = String(options.workspaceKey);
    if (!existing.has(key)) {
      return {
        ok: false,
        code: "UNKNOWN_WORKSPACE",
        workspaceKey: key,
        reason: "显式指定的 workspaceKey 在 sessions 根目录下不存在；本插件不会新建工作区（那需要改 sessions/ 之外的 workspaces.json）",
        candidates: [...existing],
      };
    }
    return {
      ok: true,
      workspaceKey: key,
      root: workspaces[key]?.root ?? null,
      name: workspaces[key]?.name ?? null,
      matchedBy: "explicit",
      reason: "调用方显式指定",
    };
  }

  if (existing.size === 0) {
    return {
      ok: false,
      code: "NO_WORKSPACE",
      reason: "sessions 根目录下没有任何工作区，无法确定 workspaceKey",
      suggestedWorkspaceKey: cwd ? deriveWorkspaceKey(cwd) : undefined,
      candidates: [],
    };
  }

  const candidates = [...existing].map((key) => ({
    key,
    root: normalizeRootPath(workspaces[key]?.root ?? ""),
    openedAt: Date.parse(workspaces[key]?.last_opened_at ?? "") || 0,
  }));

  if (cwd) {
    const prefixed = candidates
      .filter((c) => c.root && (cwd === c.root || cwd.startsWith(c.root + sep) || c.root.endsWith(":")))
      .filter((c) => c.root.endsWith(":") || cwd === c.root || cwd.startsWith(c.root + sep))
      .sort((a, b) => b.root.length - a.root.length || b.openedAt - a.openedAt);
    if (prefixed.length > 0) {
      const pick = prefixed[0];
      return {
        ok: true,
        workspaceKey: pick.key,
        root: pick.root,
        name: workspaces[pick.key]?.name ?? null,
        matchedBy: "root-prefix",
        reason: `复用已有工作区 ${pick.key}（root=${pick.root || "?"} 是会话 cwd 的祖先${pick.root === cwd ? "，完全一致" : "，但不等同"}）`,
      };
    }
  }

  const newest = candidates.sort((a, b) => b.openedAt - a.openedAt)[0];
  return {
    ok: true,
    workspaceKey: newest.key,
    root: newest.root,
    name: workspaces[newest.key]?.name ?? null,
    matchedBy: "recent",
    reason: `无法从 cwd 推出工作区，复用最近打开的工作区 ${newest.key}（root=${newest.root || "?"}）`,
  };
}

/* -------------------------------------------------------------- 进程检测 */

function defaultListProcesses() {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("tasklist", ["/FO", "CSV", "/NH"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000,
      });
      return out
        .split(/\r?\n/)
        .map((line) => /^"([^"]+)"/.exec(line)?.[1])
        .filter(Boolean);
    }
    const out = execFileSync("ps", ["-A", "-o", "comm="], { encoding: "utf8", timeout: 15000 });
    return out.split("\n").map((line) => basename(line.trim())).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Kimi 在跑就不能写它的会话库。名字匹配 kimi / Kimi / moonshot 三种写法。
 * listProcesses 可注入（测试用桩）。
 */
export function detectKimiRunning(options = {}) {
  const list = options.listProcesses ?? defaultListProcesses;
  let names = [];
  try {
    names = list() ?? [];
  } catch {
    names = [];
  }
  const hits = [...new Set(names.filter((name) => /kimi|moonshot/i.test(String(name))))];
  return { running: hits.length > 0, processes: hits };
}

/* -------------------------------------------------------------- 模板 */

/**
 * 挑模板会话：优先"有完整环境声明"的（profile.bind + llm.tools_snapshot），
 * 再按行数、更新时间。返回模板行本身，供克隆。
 */
export function pickTemplate(sessions) {
  const scored = sessions
    .filter((s) => existsSync(s.path))
    .map((s) => {
      let rows = [];
      try {
        rows = readWire(s.path).rows;
      } catch {
        rows = [];
      }
      const types = new Set(rows.map((r) => r?.type));
      let score = 0;
      if (types.has("profile.bind")) score += 100;
      if (types.has("llm.tools_snapshot")) score += 50;
      if (types.has("mcp.tools_discovered")) score += 25;
      if (types.has("metadata")) score += 10;
      score += Math.min(rows.length, 50) / 100;
      return { session: s, rows, types, score };
    })
    .filter((entry) => entry.rows.length > 0 && entry.types.has("metadata"))
    .sort((a, b) => b.score - a.score || (b.session.updatedAt ?? 0) - (a.session.updatedAt ?? 0));
  return scored[0];
}

/* -------------------------------------------------------------- 写模板 */

class Clock {
  constructor(start) {
    this.value = Number.isFinite(start) ? start : Date.now();
  }
  next(step = 1) {
    this.value += step;
    return this.value;
  }
}

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

/**
 * 克隆模板 + 重写会话内容。
 *
 * @param {object} options
 * @param {object[]} options.templateRows 模板 wire 的全部行
 * @param {object[]} options.conversation  extractConversation() 的结果
 * @param {string}   options.workspaceKey  目标工作区（会写进 runtime.set_binding）
 * @param {string}   [options.cwd]         写进 profile.bind.environmentDisclosure.cwd
 * @param {number}   [options.startTime]   起始毫秒时间戳
 */
export function buildWire(options) {
  const templateRows = options.templateRows ?? [];
  const conversation = options.conversation ?? [];
  const clock = new Clock(options.startTime ?? Date.now());
  const rows = [];

  /* 1) 环境声明：照抄，只改 time / agentId / workspaceId / cwd */
  const emittedEnv = new Set();
  for (const row of templateRows) {
    if (!isPlainObject(row) || !ENV_SET.has(row.type)) continue;
    if (emittedEnv.has(row.type)) continue;
    emittedEnv.add(row.type);
    const copy = cloneJson(row);
    if (copy.type === "metadata") {
      copy.created_at = clock.value;
    } else {
      copy.time = clock.next();
    }
    if (copy.type === "runtime.set_binding") {
      copy.workspaceId = options.workspaceKey;
      copy.agentId = "main";
    }
    if ("agentId" in copy && copy.type !== "runtime.set_binding") copy.agentId = "main";
    if (copy.type === "profile.bind" && options.cwd) {
      copy.environmentDisclosure = { ...(copy.environmentDisclosure ?? {}), cwd: options.cwd };
    }
    rows.push(copy);
  }
  if (!emittedEnv.has("metadata")) {
    rows.unshift({ type: "metadata", protocol_version: "1.5", created_at: clock.value });
  }

  /* 2) 会话内容：按 turn 重写 */
  const turns = groupTurns(conversation);
  const render = options.includeTools === true ? renderTurnWithTools : renderTurn;
  turns.forEach((turn, index) => {
    rows.push(...render(turn, index, clock));
  });

  return { rows, turns: turns.length, envTypes: [...emittedEnv] };
}

/** user 消息开启新 turn；其后的 assistant/tool 都归这个 turn。 */
export function groupTurns(conversation) {
  const turns = [];
  let current;
  for (const message of conversation) {
    if (message.role === "user" || current === undefined) {
      current = { user: message.role === "user" ? message : undefined, parts: [], time: message.time };
      turns.push(current);
      if (message.role !== "user") current.parts.push(message);
      continue;
    }
    current.parts.push(message);
  }
  return turns;
}

const isoOf = (ms) => new Date(ms).toISOString();

function userContent(text) {
  return [{ type: "text", text: String(text ?? "") }];
}

// 真机验证结论（Kimi Code 1.1.2）：助手消息只发 text 块最稳。
// 工具帧（frames[].name）与 toolCalls 的迭代行为在真机会触发
// ZodError / "e.toolCalls is not iterable"，所以工具调用暂不迁移。
function assistantContent(message) {
  const content = [];
  if (message.text) content.push({ type: "text", text: message.text });
  return content;
}

// 永远输出空数组：Kimi 的 transcript 加载器会遍历 message.toolCalls，
// 字段缺失时报 "e.toolCalls is not iterable"；而带内容的工具帧又要求它自己的
// schema（tool_name / input / tool_call_id）。工具迁移待单独验证，先保证可读。
function wireToolCalls() {
  return [];
}

/** 一个 turn 的完整行序列（用户 → 助手 → 工具结果）。 */
/**
 * 带工具调用的 turn —— 严格照 Kimi 原生样本（实测 session_cf179288）：
 *
 *   context.append_loop_event { event:{type:"step.begin", uuid, turnId, step} }
 *   ... content.part { part:{type:"think"|"text", ...} }
 *   ... tool.call    { toolCallId, name, args, display:{kind:"command",command,cwd,language} }
 *   ... tool.result  { parentUuid:<tool.call 的 uuid>, toolCallId, result:{output,durationMs} }
 *   ... step.end     { finishReason:"tool_use"|"end_turn", usage, messageId, providerFinishReason }
 *
 * 一个 assistant 消息 = 一个 step；它后面的 tool 结果并进同一个 step。
 * 原生这条通路里助手内容**不走** context.append_message，只走 loop 事件。
 */
function renderTurnWithTools(turn, index, clock) {
  const rows = [];
  const turnId = String(index);
  const promptId = newMessageId();
  const userText = turn.user?.text ?? "";
  const userTime = clock.next();

  rows.push({
    message: {
      message: { role: "user", content: userContent(userText) },
      meta: {
        source: "input",
        promptId,
        origin: { kind: "user" },
        tracked: true,
        createdAt: isoOf(userTime),
        userMessageId: promptId,
      },
    },
    type: "agent.message.appended",
    time: userTime,
    kind: "event",
  });
  rows.push({ turnId: index, queueItemId: promptId, type: "agent.turn.started", time: clock.next(), kind: "event" });
  rows.push({
    type: "turn.prompt",
    agentId: "main",
    input: userContent(userText),
    origin: { kind: "user" },
    promptId,
    turnId: index,
    time: clock.next(),
  });
  rows.push({
    type: "context.append_message",
    agentId: "main",
    message: { role: "user", content: userContent(userText), id: promptId, toolCalls: [], origin: { kind: "user" } },
    time: clock.next(),
  });

  const loop = (event) => rows.push({ type: "context.append_loop_event", agentId: "main", event, time: clock.next() });
  let step = 0;
  let current = null;

  const beginStep = () => {
    step += 1;
    current = { uuid: randomUUID(), step, calls: [] };
    loop({ type: "step.begin", uuid: current.uuid, turnId, step });
  };
  const endStep = (finishReason) => {
    if (!current) return;
    loop({
      type: "step.end",
      uuid: current.uuid,
      turnId,
      step: current.step,
      finishReason,
      usage: { inputOther: 0, output: 0, inputCacheRead: 0, inputCacheCreation: 0 },
      messageId: "chatcmpl-" + randomUUID().replace(/-/g, "").slice(0, 24),
      providerFinishReason: finishReason === "tool_use" ? "tool_calls" : "completed",
      rawFinishReason: finishReason === "tool_use" ? "tool_calls" : "stop",
    });
    current = null;
  };

  for (const part of turn.parts) {
    if (part.role === "assistant") {
      if (current) endStep(current.calls.length > 0 ? "tool_use" : "end_turn");
      beginStep();
      if (typeof part.reasoning === "string" && part.reasoning) {
        loop({
          type: "content.part",
          uuid: randomUUID(),
          turnId,
          step: current.step,
          stepUuid: current.uuid,
          part: { type: "think", think: part.reasoning, reasoningKey: "reasoning_content" },
        });
      }
      if (part.text) {
        loop({
          type: "content.part",
          uuid: randomUUID(),
          turnId,
          step: current.step,
          stepUuid: current.uuid,
          part: { type: "text", text: part.text },
        });
      }
      for (const call of part.toolCalls ?? []) {
        const uuid = randomUUID();
        let args = {};
        try {
          args = typeof call.arguments === "string" ? JSON.parse(call.arguments) : (call.arguments ?? {});
        } catch {
          args = { _raw: String(call.arguments ?? "") };
        }
        const toolCallId = call.id || "tool_" + uuid.replace(/-/g, "").slice(0, 20);
        const event = {
          type: "tool.call",
          uuid,
          turnId,
          step: current.step,
          stepUuid: current.uuid,
          toolCallId,
          name: call.name || "tool",
          args,
        };
        if (typeof args?.command === "string") {
          event.display = {
            kind: "command",
            command: args.command,
            ...(typeof args.cwd === "string" ? { cwd: args.cwd } : {}),
            language: "bash",
          };
        }
        loop(event);
        current.calls.push({ uuid, toolCallId, done: false });
      }
      continue;
    }

    if (part.role === "tool" && current) {
      const match =
        current.calls.find((c) => c.toolCallId === part.toolCallId && !c.done) ??
        current.calls.find((c) => !c.done);
      if (match) {
        match.done = true;
        loop({
          type: "tool.result",
          parentUuid: match.uuid,
          toolCallId: part.toolCallId || match.toolCallId,
          result: { output: String(part.text ?? ""), durationMs: 0 },
        });
      }
    }
  }

  if (current) endStep(current.calls.length > 0 ? "tool_use" : "end_turn");

  rows.push({ turnId: index, outcome: "done", type: "agent.turn.ended", time: clock.next(), kind: "event" });
  const lastTime = rows[rows.length - 1].time;
  rows.push({
    type: "turn.ended",
    agentId: "main",
    turnId: index,
    reason: "completed",
    durationMs: lastTime - userTime,
    traceId: newTraceId(),
    time: clock.next(),
  });
  return rows;
}

function renderTurn(turn, index, clock) {
  const rows = [];
  const turnId = index;
  const promptId = newMessageId();
  const userText = turn.user?.text ?? "";
  const userTime = clock.next();
  const createdAt = isoOf(userTime);

  // UI 流：用户消息
  rows.push({
    message: {
      message: { role: "user", content: userContent(userText) },
      meta: {
        source: "input",
        promptId,
        origin: { kind: "user" },
        tracked: true,
        createdAt,
        userMessageId: promptId,
      },
    },
    type: "agent.message.appended",
    time: userTime,
    kind: "event",
  });
  rows.push({
    turnId,
    queueItemId: promptId,
    type: "agent.turn.started",
    time: clock.next(),
    kind: "event",
  });
  rows.push({
    type: "turn.prompt",
    agentId: "main",
    input: userContent(userText),
    origin: { kind: "user" },
    promptId,
    turnId,
    time: clock.next(),
  });
  rows.push({
    type: "context.append_message",
    agentId: "main",
    message: {
      role: "user",
      content: userContent(userText),
      id: promptId,
      toolCalls: [],
      origin: { kind: "user" },
    },
    time: clock.next(),
  });

  // 助手 / 工具
  let pendingCalls = [];
  let completedCalls = 0;
  for (const part of turn.parts) {
    if (part.role === "assistant") {
      const messageId = part.id && /^msg_/.test(part.id) ? part.id : newMessageId();
      const calls = part.toolCalls ?? [];
      const messageTime = clock.next();
      rows.push({
        type: "context.append_message",
        agentId: "main",
        message: {
          role: "assistant",
          content: assistantContent(part),
          id: messageId,
          toolCalls: wireToolCalls(calls),
        },
        time: messageTime,
      });
      rows.push({
        message: {
          message: {
            role: "assistant",
            content: assistantContent(part),
            toolCalls: wireToolCalls(calls),
          },
          meta: {
            model: { provider: "agent-loop", model: "agent-loop" },
            source: "llm",
            finish: { finishReason: calls.length > 0 ? "tool_calls" : "completed", rawFinishReason: "stop" },
            messageId: `chatcmpl-${randomUUID().replace(/-/g, "").slice(0, 24)}`,
          },
        },
        type: "agent.message.appended",
        time: clock.next(),
        kind: "event",
      });
      pendingCalls = calls;
      continue;
    }
    if (part.role === "tool") {
      // 工具结果暂不迁移（见 assistantContent 的说明）
      continue;
      const callId =
        part.toolCallId ||
        pendingCalls[Math.min(completedCalls, pendingCalls.length - 1)]?.id ||
        "";
      completedCalls += 1;
      rows.push({
        type: "context.append_message",
        agentId: "main",
        message: {
          role: "tool",
          content: userContent(part.text),
          id: newMessageId(),
          toolCalls: [],
          toolCallId: callId,
        },
        time: clock.next(),
      });
    }
  }

  rows.push({ turnId, outcome: "done", type: "agent.turn.ended", time: clock.next(), kind: "event" });
  rows.push({
    type: "turn.ended",
    agentId: "main",
    turnId,
    reason: "completed",
    durationMs: rows[rows.length - 1].time - userTime,
    traceId: newTraceId(),
    time: clock.next(),
  });
  return rows;
}

/** state.json —— 照样本字段重建（没有它 Kimi 侧多半看不到会话）。 */
export function buildState(options) {
  const { root, workspaceKey, sessionId, createdAt, updatedAt, title, cwd, lastPrompt } = options;
  const agentHome = join(sessionDir(root, workspaceKey, sessionId), "agents", "main").replace(/\\/g, "/");
  return {
    id: sessionId,
    version: 2,
    cwd: cwd ?? null,
    archived: false,
    agents: { main: { homedir: agentHome, type: "main" } },
    custom: {},
    title: title ?? null,
    titleKind: "replaceable",
    createdAt,
    updatedAt,
    lastPrompt: lastPrompt ?? null,
    lastTurnReason: "completed",
    isCustomTitle: false,
  };
}

/**
 * 落盘：<root>/<workspaceKey>/<sessionId>/agents/main/wire.jsonl (+ state.json)。
 * 已存在时抛 ALREADY_EXISTS（force 由调用方先备份、删目录）。
 */
export function writeKimiSession(options) {
  const root = sessionsRoot(options);
  const { workspaceKey, sessionId, rows, state, force = false, now = Date.now() } = options;
  const dir = sessionDir(root, workspaceKey, sessionId);
  const wire = wirePath(root, workspaceKey, sessionId);
  if (existsSync(dir) && !force) {
    const error = new Error(`目标会话已存在：${dir}`);
    error.code = "ALREADY_EXISTS";
    error.path = dir;
    throw error;
  }

  const text = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";

  // 先写到同时卷上的 staging 目录，再整体 rename 落位。
  // 这样即使 Kimi 正在运行、正在扫描 sessions/，它要么看到"还没有"，要么看到
  // "写完整了"，绝不会读到只写了一半的 wire.jsonl。
  const staging = `${dir}.staging-${now}`;
  removeTree(staging);
  const stagingWire = join(staging, "agents", "main", "wire.jsonl");
  mkdirSync(dirname(stagingWire), { recursive: true });
  writeFileSync(stagingWire, text, "utf8");
  if (state) writeFileSync(join(staging, "state.json"), JSON.stringify(state), "utf8");

  if (existsSync(dir)) {
    // 调用方本该先备份；走到这里说明没备份，自己挪开，绝不覆盖
    renameSync(dir, `${dir}.bak-${now}`);
  }
  renameSync(staging, dir);

  return { dir, path: wire, statePath: state ? statePath(root, workspaceKey, sessionId) : undefined, lines: rows.length, bytes: Buffer.byteLength(text) };
}

/** 把已存在的会话目录挪成 `<sessionId>.bak-<ts>`（force 导出用）。 */
export function backupSessionDir(options) {
  const root = sessionsRoot(options);
  const { workspaceKey, sessionId, now = Date.now() } = options;
  const dir = sessionDir(root, workspaceKey, sessionId);
  if (!existsSync(dir)) return undefined;
  const backup = `${dir}.bak-${now}`;
  renameSync(dir, backup);
  return backup;
}

/** 手写递归删除（Windows 上 fs.rmSync 对长路径可能静默不删）。 */
export function removeTree(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) removeTree(path);
    else rmSync(path, { force: true });
  }
  rmSync(dir, { recursive: true, force: true });
}

/** 删掉一个会话目录（只用于回滚半途失败的导出）。 */
export function removeSessionDir(options) {
  const root = sessionsRoot(options);
  removeTree(sessionDir(root, options.workspaceKey, options.sessionId));
}

/** 只读自检：新写出来的 wire 能不能按同样规则读回对话。 */
export function verifyWireFile(file) {
  const { rows, bad } = readWire(file);
  const conversation = extractConversation(rows);
  const timestamps = rows.map((r) => r.time).filter((t) => Number.isFinite(t));
  let monotonic = true;
  for (let i = 1; i < timestamps.length; i += 1) {
    if (timestamps[i] < timestamps[i - 1]) {
      monotonic = false;
      break;
    }
  }
  const types = rows.map((r) => r?.type);
  return {
    ok: bad === 0 && rows.length > 0,
    badLines: bad,
    lines: rows.length,
    messages: conversation.length,
    monotonic,
    hasRuntimeBinding: types.includes("runtime.set_binding"),
    hasProfileBind: types.includes("profile.bind"),
    hasToolsSnapshot: types.includes("llm.tools_snapshot"),
    hasMetadata: types.includes("metadata"),
    protocolVersion: summarizeRows(rows).protocolVersion,
    conversation,
  };
}