/**
 * dsh-kimi-bridge —— DSH ↔ Kimi Code 会话迁移（宿主插件，纯 ESM，无构建）。
 *
 *   GET  /dsh-kimi/list                           列出 Kimi Code 会话（只读）
 *   GET  /dsh-kimi/export-preview?dshSessionId=…  DSH → Kimi 的 dry-run
 *   POST /dsh-kimi/export                         写 Kimi 会话（apply:true 才写）
 *   GET  /dsh-kimi/import-preview?sessionId=…     Kimi → DSH 的 dry-run
 *   POST /dsh-kimi/import                         写 DSH 会话（apply:true 才写）
 *
 * 安全边界：只读写 `<sessionsRoot>/<workspaceKey>/<sessionId>/`，不碰 `.index-cache`、
 * `.index-dirty`、`server/events`，也不碰 `~/.kimi-code` 里 sessions 之外的任何东西。
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  ENV_LINE_TYPES,
  buildState,
  buildWire,
  backupSessionDir,
  chooseWorkspace,
  detectKimiRunning,
  extractConversation,
  listSessions,
  pickTemplate,
  readWire,
  sessionsRoot,
  statePath,
  verifyWireFile,
  wirePath,
  writeKimiSession,
} from "./kimi.js";
import { buildSeed, createDshSession, dshSessionsRoot, readDshSession } from "./dsh.js";

export const name = "dsh-kimi-bridge";
export const inject = ["webServer"];

/* ------------------------------------------------------------------ 工具 */

const fail = (status, code, message, extra = {}) => ({
  status,
  body: { ok: false, code, message, ...extra },
});

const ok = (body) => ({ status: 200, body: { ok: true, ...body } });

const asText = (value) => (typeof value === "string" ? value : value == null ? "" : String(value));

/** 同样的 DSH 会话 id 总是导出到同一个 Kimi 会话 —— 再导出就是"目标已存在"。 */
export function stableSessionId(seed) {
  const hex = createHash("sha256").update(`dsh-kimi-bridge:${asText(seed)}`, "utf8").digest("hex");
  const bytes = hex.slice(0, 32).split("");
  bytes[12] = "4";
  bytes[16] = ((parseInt(bytes[16], 16) & 0x3) | 0x8).toString(16);
  const s = bytes.join("");
  return `session_${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

const previewSample = (messages, limit = 6, chars = 120) =>
  messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(0, limit)
    .map((m) => ({ role: m.role, text: asText(m.text).slice(0, chars) }));

const countOf = (messages) => {
  const counts = { user: 0, assistant: 0, tool: 0, toolCalls: 0 };
  for (const message of messages) {
    if (message.role in counts) counts[message.role] += 1;
    counts.toolCalls += (message.toolCalls ?? []).length;
  }
  return counts;
};

/** Kimi 的会话消息 → 迁移用的 IR（丢掉 system-reminder 注入已经在 extractConversation 做过）。 */
export function kimiToIr(session, rows) {
  const conversation = extractConversation(rows);
  const messages = conversation.map((message) => ({
    role: message.role,
    text: message.text,
    toolCalls: message.toolCalls ?? [],
    toolCallId: message.toolCallId,
  }));
  const firstUser = messages.find((m) => m.role === "user");
  return {
    id: session?.sessionId,
    cwd: session?.cwd,
    createdAt: session?.createdAt,
    title: session?.title ?? firstUser?.text?.replace(/\s+/g, " ").trim().slice(0, 60),
    messages,
  };
}

/* ------------------------------------------------------------------ 主体 */

/**
 * 业务逻辑与 HTTP 解耦：每个方法返回 `{status, body}`，测试可以直接调。
 * options:
 *   ctx            宿主 ctx（读/写 DSH 会话）
 *   kimiRoot       Kimi sessions 根目录（测试只对副本操作）
 *   kimiHome       `~/.kimi-code`（读 workspaces.json，只读）
 *   dshRoot        DSH sessions 根目录（服务不可用时兜底读文件）
 *   listProcesses  进程名枚举（测试注入桩）
 *   now            时间源
 */
export function createBridge(options = {}) {
  const ctx = options.ctx;
  const kimiOptions = { sessionsRoot: options.kimiRoot, kimiHome: options.kimiHome };
  const dshOptions = { root: options.dshRoot };
  const now = options.now ?? (() => Date.now());

  const root = () => sessionsRoot(kimiOptions);
  const dshRoot = () => dshSessionsRoot(dshOptions);
  const running = () => detectKimiRunning({ listProcesses: options.listProcesses });

  async function loadDsh(id) {
    return readDshSession(ctx, id, dshOptions);
  }

  function findKimiSession(sessionId) {
    return listSessions(kimiOptions).find((s) => s.sessionId === sessionId);
  }

  /** 找出导出目标：workspaceKey + sessionId + 路径。 */
  function targetFor({ dshSessionId, cwd, workspaceKey, sessionId }) {
    const workspace = chooseWorkspace({ ...kimiOptions, cwd, workspaceKey });
    if (!workspace.ok) return { error: workspace };
    const id = sessionId ? asText(sessionId) : stableSessionId(dshSessionId);
    return {
      workspaceKey: workspace.workspaceKey,
      workspace,
      sessionId: id,
      path: wirePath(root(), workspace.workspaceKey, id),
    };
  }

  /* -------------------------------------------------------------- list */

  function list() {
    const sessions = listSessions(kimiOptions).map((s) => ({
      sessionId: s.sessionId,
      workspaceKey: s.workspaceKey,
      path: s.path,
      updatedAt: s.updatedAt ?? null,
      cwd: s.cwd ?? null,
      title: s.title ?? null,
      messages: s.messages,
      roles: { user: s.roles.user, assistant: s.roles.assistant },
      toolCalls: s.toolCalls,
      lineCount: s.lineCount,
      protocolVersion: s.protocolVersion ?? null,
    }));
    const workspaces = [...new Set(sessions.map((s) => s.workspaceKey))];
    return ok({ root: root(), workspaces, total: sessions.length, sessions });
  }

  /* ----------------------------------------------------- export preview */

  async function exportPreview(query) {
    const dshSessionId = asText(query?.dshSessionId);
    if (!dshSessionId) return fail(400, "MISSING_SESSION_ID", "缺少 dshSessionId");
    let loaded;
    try {
      loaded = await loadDsh(dshSessionId);
    } catch (error) {
      return fail(404, error?.code ?? "DSH_SESSION_NOT_FOUND", error?.message ?? String(error), {
        attempts: error?.attempts,
      });
    }
    const ir = loaded.ir;
    const conversation = ir.messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "tool");
    if (!conversation.some((m) => m.role === "user")) {
      return fail(400, "EMPTY_CONVERSATION", "这条 DSH 会话里没有 user 消息，无法导出");
    }
    const target = targetFor({ dshSessionId, cwd: ir.cwd });
    if (target.error) return fail(400, target.error.code, target.error.reason, { candidates: target.error.candidates });
    const template = pickTemplate(listSessions(kimiOptions));
    if (!template) return fail(409, "NO_TEMPLATE", `没有任何可当骨架的 Kimi 会话（${root()} 是空的？）`);
    const counts = countOf(conversation);
    return ok({
      applied: false,
      dsh: { sessionId: dshSessionId, source: loaded.source, via: loaded.via, cwd: ir.cwd ?? null, messages: conversation.length },
      target: { workspaceKey: target.workspaceKey, sessionId: target.sessionId, path: target.path },
      workspace: {
        workspaceKey: target.workspaceKey,
        root: target.workspace.root,
        matchedBy: target.workspace.matchedBy,
        reason: target.workspace.reason,
      },
      counts,
      skeleton: {
        fromSession: template.session.sessionId,
        workspaceKey: template.session.workspaceKey,
        protocolVersion: template.types.has("metadata") ? (template.rows.find((r) => r.type === "metadata")?.protocol_version ?? null) : null,
        lines: template.rows.length,
        envTypes: [...template.types].filter((type) => ENV_LINE_TYPES.includes(type)),
      },
      sample: previewSample(conversation),
    });
  }

  /* -------------------------------------------------------------- export */

  async function exportToKimi(body = {}) {
    const apply = body.apply === true;
    const dshSessionId = asText(body.dshSessionId);
    if (!dshSessionId) return fail(400, "MISSING_SESSION_ID", "缺少 dshSessionId");

    // `allowWhileRunning`：Kimi 有自愈守护（杀掉会自己重启），有时根本关不掉。
    // 因为写入是先写 staging 再原子 rename，Kimi 扫描时不会读到半个文件，
    // 所以允许显式跳过这道门 —— 但仍然要求调用方明确传 true。
    const allowWhileRunning = body.allowWhileRunning === true;
    const runningNow = running();
    if (runningNow.running && !allowWhileRunning) {
      return fail(409, "KIMI_RUNNING", "Kimi Code 正在运行，不能写它的会话库（可传 allowWhileRunning:true 走原子写入）", {
        processes: runningNow.processes,
      });
    }

    let loaded;
    try {
      loaded = await loadDsh(dshSessionId);
    } catch (error) {
      return fail(404, error?.code ?? "DSH_SESSION_NOT_FOUND", error?.message ?? String(error), {
        attempts: error?.attempts,
      });
    }
    const ir = loaded.ir;
    const conversation = ir.messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "tool");
    if (!conversation.some((m) => m.role === "user")) {
      return fail(400, "EMPTY_CONVERSATION", "这条 DSH 会话里没有 user 消息，无法导出");
    }

    const target = targetFor({
      dshSessionId,
      cwd: ir.cwd,
      workspaceKey: body.workspaceKey,
      sessionId: body.sessionId,
    });
    if (target.error) return fail(400, target.error.code, target.error.reason, { candidates: target.error.candidates });

    const force = body.force === true;
    const exists = existsSync(target.path);
    if (exists && !force) {
      return fail(409, "ALREADY_EXISTS", `目标 Kimi 会话已存在：${target.path}`, {
        target: { workspaceKey: target.workspaceKey, sessionId: target.sessionId, path: target.path },
        hint: "传 force:true 会先把旧目录挪成 <sessionId>.bak-<ts> 再写",
      });
    }

    const template = pickTemplate(listSessions(kimiOptions));
    if (!template) return fail(409, "NO_TEMPLATE", `没有任何可当骨架的 Kimi 会话（${root()} 是空的？）`);

    const counts = countOf(conversation);
    if (!apply) {
      return ok({
        applied: false,
        reason: "dry-run：传 apply:true 才写",
        target: { workspaceKey: target.workspaceKey, sessionId: target.sessionId, path: target.path },
        counts,
        skeleton: { fromSession: template.session.sessionId, protocolVersion: template.rows.find((r) => r.type === "metadata")?.protocol_version ?? null },
      });
    }

    const startTime = now();
    const built = buildWire({
      templateRows: template.rows,
      conversation,
      workspaceKey: target.workspaceKey,
      cwd: ir.cwd,
      startTime,
    });
    const title = asText(body.title ?? ir.title ?? conversation.find((m) => m.role === "user")?.text ?? "").slice(0, 60);
    const lastUser = [...conversation].reverse().find((m) => m.role === "user");
    const state = buildState({
      root: root(),
      workspaceKey: target.workspaceKey,
      sessionId: target.sessionId,
      createdAt: startTime,
      updatedAt: built.rows[built.rows.length - 1]?.time ?? startTime,
      title,
      cwd: ir.cwd,
      lastPrompt: lastUser?.text ?? null,
    });

    let backup;
    if (exists && force) backup = backupSessionDir({ ...kimiOptions, workspaceKey: target.workspaceKey, sessionId: target.sessionId, now: startTime });
    let written;
    try {
      written = writeKimiSession({
        ...kimiOptions,
        workspaceKey: target.workspaceKey,
        sessionId: target.sessionId,
        rows: built.rows,
        state,
        force: true,
      });
    } catch (error) {
      return fail(500, "WRITE_FAILED", error?.message ?? String(error), { target: { path: target.path } });
    }

    const verify = verifyWireFile(written.path);
    return ok({
      applied: true,
      target: {
        workspaceKey: target.workspaceKey,
        sessionId: target.sessionId,
        path: written.path,
        dir: written.dir,
        statePath: written.statePath,
        ...(backup ? { backup } : {}),
      },
      workspace: { root: target.workspace.root, matchedBy: target.workspace.matchedBy, reason: target.workspace.reason },
      counts,
      lines: built.rows.length,
      bytes: written.bytes,
      turns: built.turns,
      skeleton: {
        fromSession: template.session.sessionId,
        workspaceKey: template.session.workspaceKey,
        protocolVersion: template.rows.find((r) => r.type === "metadata")?.protocol_version ?? null,
        envTypes: built.envTypes,
      },
      verify: {
        ok: verify.ok,
        messages: verify.messages,
        monotonic: verify.monotonic,
        protocolVersion: verify.protocolVersion,
        hasRuntimeBinding: verify.hasRuntimeBinding,
        hasProfileBind: verify.hasProfileBind,
        hasToolsSnapshot: verify.hasToolsSnapshot,
      },
    });
  }

  /* ------------------------------------------------------- hijack native */

/**
 * 把一个 DSH 会话的内容灌进 Kimi 自己建的会话。
 *
 * 为什么要这条：Kimi 侧栏的会话登记只由它在"新建会话"时写进服务端，
 * 我们凭空造的 session 目录它能索引（scan.json 里有）却不列出来。
 * 所以借用它自己建的壳：保留壳的环境声明行（metadata / binding / tools 快照），
 * 只替换对话内容行，并保留 logs/、notify/ 等原生附属物。
 */
async function hijackNative(body = {}) {
  const apply = body.apply === true;
  const dshSessionId = asText(body.dshSessionId);
  const targetSessionId = asText(body.targetSessionId);
  if (!dshSessionId) return fail(400, "MISSING_SESSION_ID", "缺少 dshSessionId");
  if (!targetSessionId) return fail(400, "MISSING_TARGET", "缺少 targetSessionId");

  const target = listSessions(kimiOptions).find((entry) => entry.sessionId === targetSessionId);
  if (!target) return fail(404, "TARGET_NOT_FOUND", `Kimi 里没有这条会话：${targetSessionId}`);
  // listSessions 给的是扁平记录，path 指向 wire.jsonl
  const targetDir = target.path.replace(/[\\/]agents[\\/]main[\\/]wire\.jsonl$/, "");

  let loaded;
  try {
    loaded = await loadDsh(dshSessionId);
  } catch (error) {
    return fail(404, error?.code ?? "DSH_SESSION_NOT_FOUND", error?.message ?? String(error));
  }

  const conversation = loaded.ir.messages.filter(
    (m) => m.role === "user" || m.role === "assistant" || m.role === "tool",
  );
  if (!conversation.some((m) => m.role === "user")) {
    return fail(400, "EMPTY_CONVERSATION", "这条 DSH 会话里没有 user 消息");
  }

  const startTime = now();
  const built = buildWire({
    templateRows: readWire(target.path).rows,
    conversation,
    workspaceKey: target.workspaceKey,
    cwd: target.cwd ?? loaded.ir.cwd,
    startTime,
  });

  const envTypes = new Set(ENV_LINE_TYPES);
  const envRows = target.rows.filter((row) => envTypes.has(row.type));
  const convRows = built.rows.filter((row) => !envTypes.has(row.type));
  const merged = [...envRows, ...convRows];

  const counts = countOf(conversation);
  const payload = {
    target: { sessionId: targetSessionId, workspaceKey: target.workspaceKey, dir: targetDir },
    counts,
    lines: { env: envRows.length, conversation: convRows.length, total: merged.length },
  };

  if (!apply) return ok({ applied: false, reason: "dry-run：传 apply:true 才写", ...payload });

  const wire = wirePath(root(), target.workspaceKey, targetSessionId);
  const stateFile = statePath(root(), target.workspaceKey, targetSessionId);
  const stamp = new Date(startTime).toISOString().replace(/[:.]/g, "-");

  let backup;
  try {
    backup = `${wire}.orig-${stamp}`;
    copyFileSync(wire, backup);
    if (existsSync(stateFile)) copyFileSync(stateFile, `${stateFile}.orig-${stamp}`);
  } catch (error) {
    return fail(500, "BACKUP_FAILED", error?.message ?? String(error));
  }

  try {
    writeFileSync(wire, merged.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
  } catch (error) {
    return fail(500, "WRITE_FAILED", error?.message ?? String(error), { backup });
  }

  let stateBefore = {};
  try {
    stateBefore = JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    stateBefore = {};
  }
  const firstUser = conversation.find((m) => m.role === "user");
  const patched = {
    ...stateBefore,
    title: asText(body.title ?? loaded.ir.title ?? "").slice(0, 60) || stateBefore.title,
    lastPrompt: asText(firstUser?.text ?? "").slice(0, 200) || stateBefore.lastPrompt,
    agents: {
      ...(stateBefore.agents ?? {}),
      main: {
        ...(stateBefore.agents?.main ?? {}),
        homedir: `${targetDir.replace(/\\/g, "/")}/agents/main`,
        type: "main",
      },
    },
  };
  try {
    writeFileSync(stateFile, JSON.stringify(patched), "utf8");
  } catch (error) {
    return fail(500, "STATE_WRITE_FAILED", error?.message ?? String(error), { backup });
  }

  return ok({ applied: true, ...payload, backup, title: patched.title, verify: verifyWireFile(wire) });
}
/* ----------------------------------------------------- import preview */

  function loadKimi(sessionId) {
    const session = findKimiSession(sessionId);
    if (!session) return { error: fail(404, "SESSION_NOT_FOUND", `Kimi 侧找不到会话 ${sessionId}`) };
    const { rows } = readWire(session.path);
    return { session, rows, ir: kimiToIr(session, rows) };
  }

  function importPreview(query) {
    const sessionId = asText(query?.sessionId);
    if (!sessionId) return fail(400, "MISSING_SESSION_ID", "缺少 sessionId");
    const loaded = loadKimi(sessionId);
    if (loaded.error) return loaded.error;
    const { session, ir } = loaded;
    const counts = countOf(ir.messages);
    if (counts.user === 0) return fail(400, "EMPTY_CONVERSATION", "这条 Kimi 会话里没有 user 消息");
    const targetId = asText(query?.targetSessionId) || `session-${stableSessionId(sessionId).slice("session_".length)}`;
    return ok({
      applied: false,
      kimi: { sessionId, workspaceKey: session.workspaceKey, path: session.path, cwd: session.cwd ?? null, title: ir.title ?? null },
      target: { kind: "dsh-session", sessionId: targetId, cwd: ir.cwd ?? null },
      counts,
      messages: ir.messages.length,
      sample: previewSample(ir.messages),
      note: "写 DSH 时会补一条 system/message（surface 的第一个节点）并合成 turn/step 边界",
    });
  }

  /* ------------------------------------------------------------ import */

  async function importToDsh(body = {}) {
    const apply = body.apply === true;
    const sessionId = asText(body.sessionId);
    if (!sessionId) return fail(400, "MISSING_SESSION_ID", "缺少 sessionId");
    const loaded = loadKimi(sessionId);
    if (loaded.error) return loaded.error;
    const { ir } = loaded;
    const counts = countOf(ir.messages);
    if (counts.user === 0) return fail(400, "EMPTY_CONVERSATION", "这条 Kimi 会话里没有 user 消息");

    const titlePrefix = asText(body.titlePrefix);
    const rawTitle = asText(body.title ?? ir.title ?? ir.messages.find((m) => m.role === "user")?.text ?? "");
    const title = `${titlePrefix}${rawTitle}`.replace(/\s+/g, " ").trim().slice(0, 60);
    const targetId = asText(body.targetSessionId) || `session-${stableSessionId(sessionId).slice("session_".length)}`;

    const built = buildSeed(ir, {
      title,
      cwd: ir.cwd,
      createdAt: ir.createdAt,
      provider: "kimi-code",
      model: "kimi",
    });

    if (!apply) {
      return ok({
        applied: false,
        reason: "dry-run：传 apply:true 才写",
        target: { kind: "dsh-session", sessionId: targetId, cwd: ir.cwd ?? null },
        counts,
        title,
        seed: { events: built.seed.length, ...built.stats },
      });
    }

    let created;
    try {
      created = await createDshSession(ctx, {
        id: targetId,
        seed: built.seed,
        cwd: ir.cwd,
        createdAt: ir.createdAt,
        root: dshRoot(),
      });
    } catch (error) {
      return fail(500, "DSH_WRITE_FAILED", error?.message ?? String(error));
    }

    return ok({
      applied: true,
      target: {
        kind: "dsh-session",
        sessionId: targetId,
        cwd: ir.cwd ?? null,
        via: created.via,
        ...(created.file ? { file: created.file } : {}),
      },
      counts,
      title,
      seed: { events: built.seed.length, ...built.stats },
      kimi: { sessionId, workspaceKey: loaded.session.workspaceKey, path: loaded.session.path },
    });
  }

  return { list, exportPreview, exportToKimi, hijackNative, importPreview, importToDsh, root, dshRoot };
}

/* ------------------------------------------------------------------ HTTP */

async function readJsonBody(req, limitBytes = 1 << 20) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new Error("request body too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body, null, 1);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(text);
}

const queryOf = (req) => Object.fromEntries(new URL(asText(req?.url) || "/", "http://localhost").searchParams);

export function apply(ctx, config = {}) {
  const bridge = createBridge({ ctx, ...config });
  const effect = typeof ctx?.effect === "function" ? ctx.effect.bind(ctx) : (fn) => fn();
  const webServer = ctx?.webServer ?? (typeof ctx?.get === "function" ? ctx.get("webServer") : undefined);

  const route = (path, method, handle) => {
    const registration = {
      kind: "exact",
      path,
      handler: async (req, res) => {
        try {
          if (method === "GET" ? req.method !== "GET" && req.method !== "HEAD" : req.method !== "POST") {
            sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: `${path} 只接受 ${method}` });
            return;
          }
          const input = method === "GET" ? queryOf(req) : await readJsonBody(req);
          const { status, body } = await handle(input);
          sendJson(res, status, body);
        } catch (error) {
          sendJson(res, 500, { ok: false, code: "INTERNAL", message: error?.message ?? String(error) });
        }
      },
    };
    effect(() => webServer.register(registration), `dsh-kimi-bridge: ${method} ${path}`);
  };

  route("/dsh-kimi/list", "GET", async () => bridge.list());
  route("/dsh-kimi/export-preview", "GET", (query) => bridge.exportPreview(query));
  route("/dsh-kimi/export", "POST", (body) => bridge.exportToKimi(body));
    route("/dsh-kimi/hijack-native", "POST", (body) => bridge.hijackNative(body));
  route("/dsh-kimi/import-preview", "GET", (query) => bridge.importPreview(query));
  route("/dsh-kimi/import", "POST", (body) => bridge.importToDsh(body));

  return bridge;
}

export default { name, inject, apply, createBridge, stableSessionId };