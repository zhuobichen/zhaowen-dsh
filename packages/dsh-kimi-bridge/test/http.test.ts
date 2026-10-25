/**
 * HTTP 层集成：把真实的路由处理函数挂到一个真 `node:http` 服务上，
 * 用 fetch 走一遍 query 解析 / JSON body / 方法校验 / 状态码。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join } from "node:path";

import { apply } from "../index.js";
import { buildSeed, sessionHeader, writeSessionFile } from "../dsh.js";
import { listSessions } from "../kimi.js";
import { copyKimiSessions, freshDir, tmpRoot } from "./helpers.ts";

function syntheticDsh(dir, id) {
  const root = join(dir, "dsh-sessions");
  const header = sessionHeader(id, { cwd: "D:\\", createdAt: 1792774655000 });
  const { seed } = buildSeed(
    {
      id,
      cwd: "D:\\",
      createdAt: header.createdAt,
      title: "HTTP 测试",
      messages: [
        { role: "user", text: "http 第一条" },
        { role: "assistant", text: "http 回复一" },
        { role: "user", text: "http 第二条" },
        { role: "assistant", text: "http 回复二" },
        { role: "user", text: "http 第三条" },
        { role: "assistant", text: "http 回复三" },
      ],
    },
    { title: "HTTP 测试", createdAt: header.createdAt },
  );
  writeSessionFile({ root, header, seed });
  return root;
}

test("8 HTTP：五个路由在真 node:http 上的行为", async () => {
  const dir = freshDir("http");
  const kimiRoot = copyKimiSessions("http");
  const dshRoot = syntheticDsh(dir, "session-http-demo");

  const routes = new Map();
  const created = [];
  const ctx = {
    effect: (fn) => fn(),
    webServer: {
      register: (route) => {
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      },
    },
    sessions: {
      create: (id, options) => {
        created.push({ id, options });
        return { id };
      },
      flush: async () => true,
    },
  };
  apply(ctx, { kimiRoot, dshRoot, listProcesses: () => [] });

  const server = createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    const route = routes.get(path);
    if (!route) {
      res.statusCode = 404;
      res.end("{}");
      return;
    }
    route.handler(req, res).catch((error) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ message: String(error) }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const listRes = await fetch(`${base}/dsh-kimi/list`);
    const list = await listRes.json();
    console.log("[http] list =", listRes.status, "sessions =", list.sessions.length, "workspaces =", JSON.stringify(list.workspaces));
    assert.equal(listRes.status, 200);
    assert.equal(list.sessions.length, 1);
    assert.equal(list.sessions[0].roles.user > 0, true);

    const badPreview = await fetch(`${base}/dsh-kimi/export-preview`);
    const badBody = await badPreview.json();
    console.log("[http] preview without id =", badPreview.status, badBody.code);
    assert.equal(badPreview.status, 400);
    assert.equal(badBody.code, "MISSING_SESSION_ID");

    const previewRes = await fetch(`${base}/dsh-kimi/export-preview?dshSessionId=session-http-demo`);
    const preview = await previewRes.json();
    console.log("[http] preview =", previewRes.status, JSON.stringify(preview.counts));
    assert.equal(previewRes.status, 200);
    assert.deepEqual(preview.counts, { user: 3, assistant: 3, tool: 0, toolCalls: 0 });
    assert.equal(preview.sample.length, 6);
    assert.ok(preview.sample.every((row) => row.text.length <= 120));

    const wrongMethod = await fetch(`${base}/dsh-kimi/export`);
    const wrongBody = await wrongMethod.json();
    console.log("[http] GET export =", wrongMethod.status, wrongBody.code);
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongBody.code, "METHOD_NOT_ALLOWED");

    const dry = await fetch(`${base}/dsh-kimi/export`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dshSessionId: "session-http-demo" }),
    });
    const dryBody = await dry.json();
    console.log("[http] dry export =", dry.status, "applied =", dryBody.applied);
    assert.equal(dry.status, 200);
    assert.equal(dryBody.applied, false);

    const wet = await fetch(`${base}/dsh-kimi/export`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dshSessionId: "session-http-demo", apply: true, title: "HTTP 导出" }),
    });
    const wetBody = await wet.json();
    console.log("[http] wet export =", wet.status, "lines =", wetBody.lines, "skeleton =", wetBody.skeleton.fromSession);
    assert.equal(wet.status, 200);
    assert.equal(wetBody.applied, true);

    const session = listSessions({ sessionsRoot: kimiRoot }).find((s) => s.sessionId === wetBody.target.sessionId);
    console.log("[http] list sees new session =", JSON.stringify({ sessions: listSessions({ sessionsRoot: kimiRoot }).length, messages: session?.messages }));
    assert.ok(session, "list 应该能看到刚导出的会话");
    assert.equal(session.messages, 6);

    const importPreviewRes = await fetch(`${base}/dsh-kimi/import-preview?sessionId=${session.sessionId}`);
    const importPreview = await importPreviewRes.json();
    console.log("[http] import-preview =", importPreviewRes.status, JSON.stringify(importPreview.counts));
    assert.equal(importPreviewRes.status, 200);
    assert.equal(importPreview.counts.user, 3);

    const importRes = await fetch(`${base}/dsh-kimi/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: session.sessionId, apply: true }),
    });
    const importBody = await importRes.json();
    console.log("[http] import =", importRes.status, "via =", importBody.target.via, "seed =", JSON.stringify(importBody.seed));
    assert.equal(importRes.status, 200);
    assert.equal(created.length, 1);
    assert.equal(created[0].options.seed.filter((event) => event.type === "user/message").length, 3);

    const notFound = await fetch(`${base}/dsh-kimi/import-preview?sessionId=session_nope`);
    const notFoundBody = await notFound.json();
    console.log("[http] unknown session =", notFound.status, notFoundBody.code);
    assert.equal(notFound.status, 404);
    assert.equal(notFoundBody.code, "SESSION_NOT_FOUND");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    void tmpRoot;
  }
});
