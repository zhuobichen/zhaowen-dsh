/**
 * 导入方向：Kimi 会话副本 → 假 DSH ctx，断言 seed 的消息数 / 角色顺序 / 文本，
 * 并用 DSH 自己的 `Session.create`（若本机能找到）做一次硬校验。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { listSessions, readWire } from "../kimi.js";
import { buildSeed } from "../dsh.js";
import { apply, createBridge, stableSessionId } from "../index.js";
import { callRoute, copyKimiSessions, loadDshSessionModule, makeCtx, tmpRoot } from "./helpers.ts";

const SENTINEL_ASSISTANT = "你好！有什么需要我帮你处理的吗？";

test("6 导入：副本会话 → create(seed)，消息数/角色顺序/文本正确", async () => {
  const kimiRoot = copyKimiSessions("import");
  const session = listSessions({ sessionsRoot: kimiRoot })[0];
  const { ctx, created, flushed } = makeCtx();
  const dshRoot = join(tmpRoot, "import", "dsh-sessions");
  const bridge = createBridge({ kimiRoot, ctx, dshRoot });

  const preview = await bridge.importPreview({ sessionId: session.sessionId });
  console.log("[import] preview counts =", JSON.stringify(preview.body.counts));
  console.log("[import] preview target =", JSON.stringify(preview.body.target));
  console.log("[import] preview sample =", JSON.stringify(preview.body.sample));
  assert.equal(preview.status, 200);
  assert.equal(preview.body.counts.user, 1);
  assert.equal(preview.body.counts.assistant, 1);
  assert.equal(preview.body.target.sessionId, `session-${stableSessionId(session.sessionId).slice("session_".length)}`);

  const result = await bridge.importToDsh({ sessionId: session.sessionId, apply: true, titlePrefix: "[Kimi] " });
  console.log("[import] status =", result.status, "applied =", result.body.applied);
  console.log("[import] target =", JSON.stringify(result.body.target));
  console.log("[import] seed stats =", JSON.stringify(result.body.seed));
  assert.equal(result.status, 200);
  assert.equal(result.body.applied, true);

  assert.equal(created.length, 1, "应调用一次 ctx.sessions.create");
  assert.equal(flushed.length, 1, "应调用一次 ctx.sessions.flush");
  const { id, options } = created[0];
  const seed = options.seed;
  const types = seed.map((event) => event.type);
  console.log("[import] seed types =", JSON.stringify(types));

  // 序号连续、时间戳单调
  assert.deepEqual(seed.map((event) => event.seq), seed.map((_, index) => index));
  const times = seed.map((event) => event.time);
  assert.equal(times.every((t, i) => i === 0 || t >= times[i - 1]), true);

  // surface 第一个节点必须是 system/message
  const firstSurface = seed.find((event) => event.surfaceOp === "append");
  assert.equal(firstSurface.type, "system/message");

  const users = seed.filter((event) => event.type === "user/message");
  const assistants = seed.filter((event) => event.type === "assistant/message");
  assert.equal(users.length, 1, "user 消息数应为 1");
  assert.equal(assistants.length, 1, "assistant 消息数应为 1");
  assert.equal(users[0].data.content[0].text, "你好");
  assert.equal(assistants[0].data.message.content[0].text, SENTINEL_ASSISTANT);

  // 角色顺序：user 在 assistant 之前
  assert.ok(types.indexOf("user/message") < types.indexOf("assistant/message"));
  assert.ok(types.includes("turn/start") && types.includes("turn/end"));
  assert.ok(types.includes("step/start") && types.includes("step/end"));
  assert.ok(types.includes("session/title"));
  const title = seed.find((event) => event.type === "session/title");
  console.log("[import] title =", JSON.stringify(title.data.title));
  assert.ok(title.data.title.startsWith("[Kimi] "), "titlePrefix 应生效");

  // 用 DSH 自己的还原器复核：接受就代表 DSH 读得动
  const module = await loadDshSessionModule();
  if (module?.Session?.create) {
    const restored = module.Session.create(id, seed);
    const derived = restored.deriveMessages();
    console.log(
      "[import] Session.create OK roles =",
      JSON.stringify(derived.map((m) => m.role)),
      "texts =",
      JSON.stringify(derived.map((m) => (m.content.find((b) => b.type === "text") ?? {}).text)),
    );
    assert.deepEqual(
      derived.map((m) => m.role),
      ["system", "user", "assistant"],
    );
    assert.equal(derived[1].content[0].text, "你好");
    assert.equal(derived[2].content[0].text, SENTINEL_ASSISTANT);
  } else {
    console.log("[import] 跳过 Session.create 校验：本机没找到 @deepseek-ai/dsh-session");
  }
});

test("6b 导入路由：/dsh-kimi/import 走真实 handler，apply:true 才写", async () => {
  const kimiRoot = copyKimiSessions("import-route");
  const session = listSessions({ sessionsRoot: kimiRoot })[0];
  const { ctx, routes, created } = makeCtx();
  apply(ctx, { kimiRoot, dshRoot: join(tmpRoot, "import-route", "dsh-sessions") });

  const dry = await callRoute(routes, "/dsh-kimi/import", {
    method: "POST",
    body: { sessionId: session.sessionId },
  });
  console.log("[import-route] dry status =", dry.status, "applied =", dry.body.applied, "created =", created.length);
  assert.equal(dry.status, 200);
  assert.equal(dry.body.applied, false);
  assert.equal(created.length, 0, "没有 apply:true 不能写");

  const wet = await callRoute(routes, "/dsh-kimi/import", {
    method: "POST",
    body: { sessionId: session.sessionId, apply: true },
  });
  console.log("[import-route] wet status =", wet.status, "via =", wet.body.target.via);
  assert.equal(wet.status, 200);
  assert.equal(wet.body.applied, true);
  assert.equal(created.length, 1);
  assert.equal(created[0].options.seed.filter((e) => e.type === "user/message").length, 1);
});

test("6c 导入：tool 调用被映射成 tool/call + tool/result，缺结果会合成 TOOL_OUTCOME_UNKNOWN", () => {
  const ir = {
    id: "session-tools",
    cwd: "D:\\",
    createdAt: 1792774655000,
    title: "工具调用",
    messages: [
      { role: "user", text: "读一下文件" },
      {
        role: "assistant",
        text: "我来读。",
        toolCalls: [
          { id: "call_1", name: "Read", arguments: '{"path":"a.txt"}' },
          { id: "call_2", name: "Read", arguments: '{"path":"b.txt"}' },
        ],
      },
      { role: "tool", text: "a.txt 的内容", toolCallId: "call_1" },
    ],
  };
  const { seed, stats } = buildSeed(ir, { title: "工具调用" });
  const calls = seed.filter((event) => event.type === "tool/call");
  const results = seed.filter((event) => event.type === "tool/result");
  console.log("[tools] calls =", JSON.stringify(calls.map((c) => c.data.callId)));
  console.log("[tools] results =", results.length, "synthesized =", stats.synthesizedResults);

  assert.equal(calls.length, 2);
  assert.equal(results.length, 2);
  assert.equal(stats.synthesizedResults, 1, "缺结果的调用必须补一条 TOOL_OUTCOME_UNKNOWN");
  const synthesized = results.find((r) => r.data.message.toolCallId === "call_2");
  assert.equal(synthesized.data.isError, true);
  assert.match(synthesized.data.message.content[0].text, /TOOL_OUTCOME_UNKNOWN/);
});

test("6d 导入：从副本读回的 wire 里没有 system-reminder 注入混进对话", () => {
  const kimiRoot = copyKimiSessions("import-filter");
  const session = listSessions({ sessionsRoot: kimiRoot })[0];
  const rows = readWire(session.path).rows;
  const injections = rows.filter((row) => row.type === "context.append_message" && row.message?.origin?.kind === "injection");
  console.log("[filter] injections in wire =", injections.length, "session.roles =", JSON.stringify(session.roles));
  assert.ok(injections.length > 0, "样本里确实有注入行（否则这条断言没意义）");
  assert.equal(session.roles.user, 1, "注入行不应被算成 user 消息");
});
