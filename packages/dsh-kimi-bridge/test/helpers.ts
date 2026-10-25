/**
 * 测试脚手架：把真实 `~/.kimi-code/sessions` 复制到包内 `.tmp/`，所有读写只对副本。
 * 另外提供假 ctx（webServer + sessions）用来走真实的路由处理函数。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const pkgRoot = dirname(here);
export const tmpRoot = join(pkgRoot, ".tmp");
export const realKimiSessions =
  process.env.KIMI_SESSIONS_SRC || join(homedir(), ".kimi-code", "sessions");
export const realDshSessions =
  process.env.DSH_SESSIONS_SRC ||
  join(pkgRoot, "..", "..", "..", "dsh", "home", "sessions");

/** 手写递归删除：`fs.rmSync` 在这台机器的长路径上会静默不删。 */
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
    else unlinkSync(path);
  }
  rmdirSync(dir);
}

/** 干净的工作目录 `.tmp/<name>`。 */
export function freshDir(name) {
  const dir = join(tmpRoot, name);
  removeTree(dir);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 手写递归复制：`fs.cpSync` 在这台机器的长路径上会 EIO。 */
export function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
  }
}

/** 把真实 sessions 复制成 `.tmp/<name>/sessions` 并返回该副本根目录。 */
/** 干净的固定夹具：只复制指定的相对路径会话，避免受真实目录里新增会话影响。 */
export const FIXTURE_SESSIONS = [
  "wd_d_4eac808749fa/session_465a214d-fb62-442d-8681-22706ef4ffa7",
];

export function copyKimiSessions(name, only = FIXTURE_SESSIONS) {
  const dir = freshDir(name);
  const dest = join(dir, "sessions");
  mkdirSync(dest, { recursive: true });
  let copied = 0;
  for (const rel of only) {
    const src = join(realKimiSessions, rel);
    if (!existsSync(src)) continue;
    const target = join(dest, rel);
    mkdirSync(dirname(target), { recursive: true });
    copyTree(src, target);
    copied += 1;
  }
  // 白名单都缺失时退回全量复制，保证测试在有数据的机器上仍能跑
  if (copied === 0) copyTree(realKimiSessions, dest);
  return dest;
}

/** 第一个存在的 DSH 会话文件（只读，用来验证解帧）。 */
export function firstDshSessionFile(root = realDshSessions) {
  for (const project of readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const projectDir = join(root, project.name);
    for (const entry of readdirSync(projectDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = join(projectDir, entry.name, "session.v4.jsonl.zstd");
      if (existsSync(file)) return file;
    }
  }
  throw new Error(`no DSH session file under ${root}`);
}

/** 假 ctx：webServer.register 收集路由，sessions.create 记录 seed。 */
export function makeCtx() {
  const routes = new Map();
  const created = [];
  const flushed = [];
  const ctx = {
    effect(fn) {
      return fn();
    },
    get() {
      return undefined;
    },
    webServer: {
      register(route) {
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      },
    },
    sessions: {
      create(id, options) {
        created.push({ id, options });
        return { id, header: { id, cwd: options?.meta?.cwd } };
      },
      flush(session) {
        flushed.push(session?.id);
        return Promise.resolve(true);
      },
    },
  };
  return { ctx, routes, created, flushed };
}

function makeReq(method, url, body) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), "utf8")];
  return {
    method,
    url,
    headers: {},
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    text: "",
    setHeader(key, value) {
      res.headers[key.toLowerCase()] = value;
    },
    end(text) {
      res.text = text ?? "";
    },
  };
  return res;
}

/** 走真实路由处理函数：返回 {status, body}。 */
export async function callRoute(routes, path, { method = "GET", query, body } = {}) {
  const route = routes.get(path);
  if (!route) throw new Error(`route ${path} not registered`);
  const search = query ? `?${new URLSearchParams(query).toString()}` : "";
  const req = makeReq(method, `${path}${search}`, body);
  const res = makeRes();
  await route.handler(req, res);
  return { status: res.statusCode, body: JSON.parse(res.text) };
}

/** 真 DSH 会话包（用来做"还原器接受吗"的硬校验）。 */
export function dshSessionModulePath() {
  const candidates = [
    process.env.DSH_SESSION_MODULE,
    join(pkgRoot, "..", "..", "..", "dsh", "toolchain", "node_modules", "@deepseek-ai", "dsh-session", "lib", "index.js"),
    join(pkgRoot, "..", "..", "..", "dsh", "home", "..", "toolchain", "node_modules", "@deepseek-ai", "dsh-session", "lib", "index.js"),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

export async function loadDshSessionModule() {
  const path = dshSessionModulePath();
  if (!path) return undefined;
  return import("file:///" + path.replace(/\\/g, "/"));
}