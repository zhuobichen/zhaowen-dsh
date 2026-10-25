/**
 * DSH 侧测试：服务不可用时自己解 `session.v4.jsonl.zstd`（magic 切帧 + zstdDecompressSync）。
 * 只读真实 `dsh/home/sessions`，不写任何东西。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { buildIr, findSessionFile, readDshSession, readSessionFile, readZstdRows } from "../dsh.js";
import { firstDshSessionFile, realDshSessions } from "./helpers.ts";

test("7 DSH 解析：真实会话文件解出 header + 事件数", async () => {
  const file = firstDshSessionFile(realDshSessions);
  const { header, events } = readSessionFile(file);
  console.log("[dsh] sessions root =", realDshSessions);
  console.log("[dsh] file =", file);
  console.log("[dsh] header =", JSON.stringify({ type: header.type, version: header.version, id: header.id, cwd: header.cwd, createdAt: header.createdAt }));
  console.log("[dsh] events =", events.length, "firstType =", events[0]?.type);

  assert.equal(header.type, "session");
  assert.equal(header.version, 4);
  assert.ok(header.id, "header 应有 id");
  assert.ok(existsSync(file));
  assert.ok(events.length > 0, "事件数应 > 0");

  // 兜底路径：服务不可用 → 按 id 在根目录里找文件 → 解帧 → 建 IR
  const located = findSessionFile(realDshSessions, header.id);
  console.log("[dsh] findSessionFile =", located);
  assert.equal(located, file);

  const loaded = await readDshSession(undefined, header.id, { root: realDshSessions });
  const roles = loaded.ir.messages.reduce((acc, message) => {
    acc[message.role] = (acc[message.role] ?? 0) + 1;
    return acc;
  }, {});
  console.log("[dsh] source =", loaded.source, "via =", loaded.via);
  console.log("[dsh] ir messages =", loaded.ir.messages.length, "roles =", JSON.stringify(roles));
  assert.equal(loaded.source, "file");
  assert.ok(loaded.ir.messages.length > 0, "IR 应至少有一条消息");
  assert.ok(roles.user > 0, "IR 里应有 user 消息");
});

test("7b DSH 帧切分：纯 zstd 帧流无 header 时也能给出条数", () => {
  const file = firstDshSessionFile(realDshSessions);
  const rows = readZstdRows(file);
  const types = rows.slice(1).reduce((acc, row) => {
    acc[row.type] = (acc[row.type] ?? 0) + 1;
    return acc;
  }, {});
  console.log("[dsh] rows =", rows.length, "top types =", JSON.stringify(Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 6)));
  assert.ok(rows.length > 1);
  assert.equal(rows[0].type, "session");

  const ir = buildIr(rows[0], rows.slice(1));
  assert.equal(typeof ir.id, "string");
  assert.ok(Array.isArray(ir.messages));
});
