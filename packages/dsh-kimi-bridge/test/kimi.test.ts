/**
 * Kimi 侧测试：读 / 导出 / 模板克隆 / 进程检测 / 幂等。
 * 全部只对 `.tmp/` 下的副本操作。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, appendFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  extractConversation,
  listSessions,
  parseWire,
  readWire,
  readWorkspacesFile,
  verifyWireFile,
  wirePath,
  deriveWorkspaceKey,
  workspaceKeyFromString,
  chooseWorkspace,
} from "../kimi.js";
import { buildSeed, readDshSession, sessionHeader, writeSessionFile } from "../dsh.js";
import { apply, createBridge, stableSessionId } from "../index.js";
import { callRoute, copyKimiSessions, copyTree, freshDir, makeCtx, realKimiSessions, tmpRoot } from "./helpers.ts";

const SENTINEL_ASSISTANT = "你好！有什么需要我帮你处理的吗？";
const SENTINEL_INJECTION = "Auto permission mode is active";

/** 3 条 user + 3 条 assistant + 1 次工具调用。 */
function syntheticIr() {
  return {
    id: "session-synthetic",
    cwd: "D:\\",
    createdAt: 1792774655000,
    title: "迁移测试",
    messages: [
      { role: "user", text: "第一条：帮我列一下目录" },
      { role: "assistant", text: "好的，先看 D:\\ 根目录。" },
      { role: "user", text: "第二条：读一下 README" },
      {
        role: "assistant",
        text: "读到 README 了。",
        toolCalls: [{ id: "call_1", name: "Read", arguments: '{"path":"README.md"}' }],
      },
      { role: "tool", text: "README 内容：DSH ↔ Kimi 迁移测试。", toolCallId: "call_1" },
      { role: "user", text: "第三条：总结一下" },
      { role: "assistant", text: "总结：三条用户消息 + 三次助手回复 + 一次工具调用。" },
    ],
  };
}

/** 准备一个隔离场景：`.tmp/<name>/sessions`（Kimi 副本）+ `.tmp/<name>/dsh-sessions`（合成 DSH 会话）。 */
function setupExport(name, id = `session-synthetic-${name}`) {
  const dir = freshDir(name);
  const kimiRoot = join(dir, "sessions");
  copyTree(realKimiSessions, kimiRoot);
  const dshRoot = join(dir, "dsh-sessions");
  mkdirSync(dshRoot, { recursive: true });
  const header = sessionHeader(id, { cwd: "D:\\", createdAt: 1792774655000 });
  const { seed, stats } = buildSeed(syntheticIr(), { title: "迁移测试", createdAt: header.createdAt });
  writeSessionFile({ root: dshRoot, header, seed });
  return { dir, kimiRoot, dshRoot, id, stats, header };
}

/* ------------------------------------------------------------------ 1 读 */

test("1 读：真实会话副本能认出 1 个 workspace / 1 个 session，user 消息数 > 0", () => {
  const sessionsRoot = copyKimiSessions("read");
  const sessions = listSessions({ sessionsRoot });
  const workspaces = [...new Set(sessions.map((s) => s.workspaceKey))];

  console.log("[read] root =", sessionsRoot);
  console.log("[read] workspaces =", JSON.stringify(workspaces));
  console.log(
    "[read] sessions =",
    JSON.stringify(sessions.map((s) => ({ id: s.sessionId, messages: s.messages, roles: s.roles }))),
  );

  assert.equal(workspaces.length, 1, "副本里应只有 1 个 workspaceKey");
  assert.equal(sessions.length, 1, "副本里应只有 1 个 session");
  assert.ok(sessions[0].roles.user > 0, "user 消息数应 > 0");
  assert.ok(sessions[0].roles.assistant > 0, "assistant 消息数应 > 0");
  assert.equal(sessions[0].workspaceKey, "wd_d_4eac808749fa");
  assert.equal(sessions[0].sessionId, "session_465a214d-fb62-442d-8681-22706ef4ffa7");
  assert.ok(existsSync(sessions[0].path), "路径应指向真实文件");

  // 派生索引没被我们写过：内容还是扫描前的样子
  const cache = join(sessionsRoot, ".index-cache", "scan.json");
  console.log("[read] .index-cache/scan.json =", existsSync(cache) ? readFileSync(cache, "utf8").trim() : "(absent)");
});

/* ---------------------------------------------------------- workspaceKey */

test("1b workspaceKey：sha256 反推 + 缺省复用已有 key 的策略", () => {
  const derived = deriveWorkspaceKey("D:\\");
  console.log("[ws] deriveWorkspaceKey('D:\\\\') =", derived);
  console.log("[ws] workspaceKeyFromString('D:') =", workspaceKeyFromString("D:"));
  console.log("[ws] workspaceKeyFromString('d:') =", workspaceKeyFromString("d:"));

  // 两个真实样本都对得上：sessions 用大写盘符、workspace-trust 用小写
  assert.equal("wd_d_4eac808749fa", derived);
  assert.equal("wd_d_4eac808749fa", workspaceKeyFromString("D:"));
  assert.equal("wd_d_394e0f7e2f80", workspaceKeyFromString("d:"));

  const sessionsRoot = copyKimiSessions("workspace");
  const pick = chooseWorkspace({ sessionsRoot, cwd: "D:\\github_project\\ZhaoWen_GitHub维护" });
  console.log("[ws] choose cwd=D:\\github_project\\... →", JSON.stringify(pick));
  assert.equal(pick.ok, true);
  assert.equal(pick.workspaceKey, "wd_d_4eac808749fa");
  assert.equal(pick.matchedBy, "root-prefix");

  const explicitBad = chooseWorkspace({ sessionsRoot, cwd: "D:\\", workspaceKey: "wd_d_deadbeef0000" });
  console.log("[ws] explicit 不存在的 key →", JSON.stringify(explicitBad));
  assert.equal(explicitBad.ok, false);
  assert.equal(explicitBad.code, "UNKNOWN_WORKSPACE");

  const { workspaces } = readWorkspacesFile(join(sessionsRoot, ".."));
  console.log("[ws] 副本里没有 workspaces.json，解析结果 =", JSON.stringify(Object.keys(workspaces ?? {})));
});

/* ------------------------------------------------------------- 2 导出 */

test("2 导出：合成 DSH 会话 → 克隆模板写入副本 → 读回校验", async () => {
  const { kimiRoot, dshRoot, id } = setupExport("export");
  const before = listSessions({ sessionsRoot: kimiRoot });
  const template = readWire(before[0].path);
  const templateProtocol = template.rows.find((r) => r.type === "metadata").protocol_version;

  const bridge = createBridge({ kimiRoot, dshRoot, listProcesses: () => ["explorer.exe", "node.exe"] });

  const preview = await bridge.exportPreview({ dshSessionId: id });
  console.log("[export] preview counts =", JSON.stringify(preview.body.counts));
  console.log("[export] preview skeleton =", JSON.stringify(preview.body.skeleton));
  console.log("[export] preview target =", JSON.stringify(preview.body.target));
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.body.counts, { user: 3, assistant: 3, tool: 1, toolCalls: 1 });
  assert.equal(preview.body.skeleton.protocolVersion, templateProtocol);
  assert.equal(preview.body.skeleton.fromSession, before[0].sessionId);

  const result = await bridge.exportToKimi({ dshSessionId: id, apply: true, title: "Kimi 迁移测试" });
  console.log("[export] status =", result.status);
  console.log("[export] target =", JSON.stringify(result.body.target));
  console.log("[export] lines =", result.body.lines, "bytes =", result.body.bytes);
  console.log("[export] skeleton =", JSON.stringify(result.body.skeleton));
  assert.equal(result.status, 200);
  assert.equal(result.body.applied, true);
  assert.equal(result.body.target.sessionId, stableSessionId(id));

  const written = readWire(result.body.target.path);
  const conv = extractConversation(written.rows);
  const protocol = written.rows.find((r) => r.type === "metadata").protocol_version;
  console.log("[export] written lines =", written.rows.length, "conv =", JSON.stringify(conv.map((m) => m.role)));
  assert.equal(protocol, templateProtocol, "metadata.protocol_version 应与模板一致");

  const users = conv.filter((m) => m.role === "user").map((m) => m.text);
  const assistants = conv.filter((m) => m.role === "assistant").map((m) => m.text);
  assert.deepEqual(users, syntheticIr().messages.filter((m) => m.role === "user").map((m) => m.text));
  assert.deepEqual(
    assistants,
    syntheticIr().messages.filter((m) => m.role === "assistant").map((m) => m.text),
  );
  // 工具调用暂不迁移（真机上工具帧会触发 Zod/"toolCalls is not iterable"）
  assert.equal(conv.filter((m) => m.role === "tool").length, 0);

  const times = written.rows.map((r) => r.time).filter((t) => Number.isFinite(t));
  const monotonic = times.every((t, i) => i === 0 || t >= times[i - 1]);
  console.log("[export] timestamps =", times[0], "→", times[times.length - 1], "monotonic =", monotonic);
  assert.equal(monotonic, true, "时间戳必须单调不减");

  const verify = verifyWireFile(result.body.target.path);
  console.log("[export] verify =", JSON.stringify({ ok: verify.ok, messages: verify.messages, monotonic: verify.monotonic }));
  assert.equal(verify.ok, true);
  assert.equal(verify.badLines, 0);
});

/* -------------------------------------------------------- 3 模板克隆 */

test("3 模板克隆：没有旧会话文本，但保留环境声明行", async () => {
  const { kimiRoot, dshRoot, id } = setupExport("clone");
  const bridge = createBridge({ kimiRoot, dshRoot, listProcesses: () => [] });
  const result = await bridge.exportToKimi({ dshSessionId: id, apply: true, title: "克隆测试" });
  assert.equal(result.status, 200);

  const text = readFileSync(result.body.target.path, "utf8");
  const rows = parseWire(text).rows;
  const types = rows.map((r) => r.type);

  console.log("[clone] env lines =", JSON.stringify(rows.filter((r) => ["metadata", "runtime.set_binding", "profile.bind", "llm.tools_snapshot"].includes(r.type)).map((r) => r.type)));
  console.log("[clone] sentinel(assistant) present =", text.includes(SENTINEL_ASSISTANT));
  console.log("[clone] sentinel(injection) present =", text.includes(SENTINEL_INJECTION));
  console.log("[clone] has usage.record =", types.includes("usage.record"));

  assert.equal(text.includes(SENTINEL_ASSISTANT), false, "旧会话的助手回复不该出现在新文件里");
  assert.equal(text.includes(SENTINEL_INJECTION), false, "旧会话的 system-reminder 注入不该被复制");
  assert.equal(types.includes("usage.record"), false, "上一轮的用量统计不该被伪造");

  assert.ok(types.includes("runtime.set_binding"), "应保留 runtime.set_binding");
  assert.ok(types.includes("profile.bind"), "应保留 profile.bind");
  assert.ok(types.includes("llm.tools_snapshot"), "应保留 llm.tools_snapshot");
  assert.ok(types.includes("metadata"), "应保留 metadata");
  assert.ok(types.includes("mcp.tools_discovered"), "应保留 mcp.tools_discovered");

  const binding = rows.find((r) => r.type === "runtime.set_binding");
  assert.equal(binding.workspaceId, "wd_d_4eac808749fa", "runtime.set_binding 必须指向目标工作区");
  const profile = rows.find((r) => r.type === "profile.bind");
  console.log("[clone] profile.bind.cwd =", JSON.stringify(profile.environmentDisclosure?.cwd));
  assert.equal(profile.environmentDisclosure.cwd, "D:\\");
});

/* ------------------------------------------------------------ 4 进程检测 */

test("4 进程检测：kimi 在跑 → 409 KIMI_RUNNING，零写入", async () => {
  const { kimiRoot, dshRoot, id } = setupExport("running");
  const targetPath = wirePath(kimiRoot, "wd_d_4eac808749fa", stableSessionId(id));

  const { ctx, routes } = makeCtx();
  apply(ctx, { kimiRoot, dshRoot, listProcesses: () => ["explorer.exe", "Kimi.exe", "node.exe"] });

  const http = await callRoute(routes, "/dsh-kimi/export", {
    method: "POST",
    body: { dshSessionId: id, apply: true },
  });
  console.log("[running] status =", http.status, "code =", http.body.code, "processes =", JSON.stringify(http.body.processes));
  assert.equal(http.status, 409);
  assert.equal(http.body.code, "KIMI_RUNNING");
  assert.deepEqual(http.body.processes, ["Kimi.exe"]);
  assert.equal(existsSync(targetPath), false, "409 时不能落盘");
  assert.equal(existsSync(join(kimiRoot, "wd_d_4eac808749fa", stableSessionId(id), ".bak-1")), false);

  // moonshot 进程名也要认
  const second = makeCtx();
  apply(second.ctx, { kimiRoot, dshRoot, listProcesses: () => ["moonshot-agent"] });
  const again = await callRoute(second.routes, "/dsh-kimi/export", {
    method: "POST",
    body: { dshSessionId: id, apply: true },
  });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "KIMI_RUNNING");

  // 没有 kimi 进程时仍可写（先决条件回归）
  const clean = makeCtx();
  apply(clean.ctx, { kimiRoot, dshRoot, listProcesses: () => ["explorer.exe"] });
  const okRoute = await callRoute(clean.routes, "/dsh-kimi/export", {
    method: "POST",
    body: { dshSessionId: id, apply: true },
  });
  console.log("[running] clean run status =", okRoute.status);
  assert.equal(okRoute.status, 200);
});

/* ---------------------------------------------------------------- 5 幂等 */

test("5 幂等：再导出 409；force:true 旧目录变 .bak-* 且新目录可读", async () => {
  const { kimiRoot, dshRoot, id } = setupExport("idem");
  const bridge = createBridge({ kimiRoot, dshRoot, listProcesses: () => [] });

  const first = await bridge.exportToKimi({ dshSessionId: id, apply: true, title: "幂等测试" });
  assert.equal(first.status, 200);
  const targetPath = first.body.target.path;
  const firstLines = readWire(targetPath).rows.length;

  const second = await bridge.exportToKimi({ dshSessionId: id, apply: true });
  console.log("[idem] second status =", second.status, "code =", second.body.code);
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "ALREADY_EXISTS");

  // 往旧文件里塞一句哨兵，验证 force 时它确实被挪进备份、而不是被静默覆盖
  const sentinel = "SENTINEL-OLD-SESSION";
  const sidDir = dirname(dirname(dirname(targetPath)));
  appendFileSync(targetPath, JSON.stringify({ type: "context.append_message", agentId: "main", message: { role: "assistant", content: [{ type: "text", text: sentinel }] }, time: Date.now() }) + "\n", "utf8");
  writeFileSync(join(sidDir, "state.json"), JSON.stringify({ title: "被覆盖前的标题" }), "utf8");

  const forced = await bridge.exportToKimi({ dshSessionId: id, apply: true, force: true, title: "幂等测试-覆盖" });
  console.log("[idem] force status =", forced.status, "backup =", forced.body.target.backup);
  assert.equal(forced.status, 200);
  assert.ok(forced.body.target.backup, "force 时应回报备份目录");

  const parent = dirname(sidDir);
  const backups = readdirSync(parent).filter((name) => name.includes(".bak-"));
  console.log("[idem] backups =", JSON.stringify(backups));
  assert.ok(backups.length >= 1, "force 应留下至少一个 .bak- 备份");
  const newestBackup = backups.sort().at(-1);
  const backupWire = join(parent, newestBackup, "agents", "main", "wire.jsonl");
  const backupText = readFileSync(backupWire, "utf8");
  assert.equal(backupText.includes(sentinel), true, "旧内容应原样留在备份里");
  assert.equal(readWire(backupWire).rows.length, firstLines + 1);

  const fresh = readFileSync(targetPath, "utf8");
  assert.equal(fresh.includes(sentinel), false, "新文件不该带旧哨兵");
  const reread = await bridge.exportPreview({ dshSessionId: id });
  assert.equal(reread.status, 200);
  const verify = verifyWireFile(targetPath);
  console.log("[idem] new file lines =", verify.lines, "messages =", verify.messages, "ok =", verify.ok);
  assert.equal(verify.ok, true);

  // 显式 workspaceKey / sessionId 覆盖
  const customId = "session_cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const custom = await bridge.exportToKimi({
    dshSessionId: id,
    apply: true,
    sessionId: customId,
    workspaceKey: "wd_d_4eac808749fa",
    title: "显式覆盖",
  });
  console.log("[idem] explicit override =", custom.status, "sessionId =", custom.body.target?.sessionId);
  assert.equal(custom.status, 200);
  assert.equal(custom.body.target.sessionId, customId);
  assert.equal(custom.body.workspace.matchedBy, "explicit");
  assert.equal(existsSync(join(parent, customId, "agents", "main", "wire.jsonl")), true);
});
