/**
 * dsh-qq-panel · 主机半边
 *
 * 只做一件事：把 qchat-cli 的私有文件读成一个 JSON 快照，挂在 /qq-panel-data。
 * 浏览器半边不直接碰文件系统（也不该碰），拿到的就是这个快照。
 *
 * AI 通道：qq_view 工具读的就是面板同款快照（用户要求工作台都是 AI base 的）。
 * 跑实际操作仍走 qchat-cli 自己的 CLI。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'dsh-qq-panel';
export const inject = { tools: { required: true }, webServer: { required: false } };

/** qchat-cli 项目根。可用 QCE_PROJECT_DIR 覆盖。 */
function projectDir() {
  return process.env.QCE_PROJECT_DIR || 'D:\\github_project\\ZhaoWen_GitHub维护\\qchat-cli';
}

function readJson(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function readJsonl(p) {
  try {
    if (!fs.existsSync(p)) return [];
    return fs
      .readFileSync(p, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** 读 qchat-cli 的 OneBot token，用来查在线状态 */
function onebotToken(root) {
  try {
    const p = path.join(os.homedir(), '.qchat-cli', 'NapCat.Shell', 'napcat', 'config', 'onebot11_2396130865.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'))?.network?.httpServers?.[0]?.token ?? '';
  } catch {
    return '';
  }
}

/** 探 OneBot 是否真能用：get_status.online 是唯一可信判据 */
async function probeOneBot(endpoint, token, timeoutMs = 4000) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const call = async (action) => {
    const res = await fetch(`${endpoint}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: '{}',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json())?.data;
  };
  try {
    const status = await call('get_status');
    if (status?.online !== true) return { ready: false, reason: '进程在，但账号未登录' };
    const login = await call('get_login_info');
    return { ready: true, uin: String(login?.user_id ?? ''), nickname: login?.nickname ?? '' };
  } catch (error) {
    return { ready: false, reason: String(error?.message ?? error).slice(0, 80) };
  }
}

/** 表情库统计：总数 / 偷来的 / 待打标 */
function emojiStats(root) {
  const manifest = readJson(path.join(root, 'private', 'emoji-library', 'manifest.json'), { emojis: [] });
  const list = manifest.emojis ?? [];
  const stolen = list.filter((e) => e.stolenFrom);
  const unlabeled = list.filter((e) => String(e.label || '').startsWith('待标'));
  const usage = readJson(path.join(root, 'private', '.sticker-usage.json'), {});
  const feedback = readJson(path.join(root, 'private', '.sticker-feedback.json'), { events: [] });
  const events = feedback.events ?? [];
  const resolved = events.filter((e) => e.outcome !== 'pending');
  const engaged = resolved.filter((e) => e.outcome === 'engaged');
  return {
    total: list.length,
    stolen: stolen.length,
    unlabeled: unlabeled.length,
    labeled: list.length - unlabeled.length,
    used: Object.keys(usage).length,
    feedback: {
      total: events.length,
      resolved: resolved.length,
      engaged: engaged.length,
      rate: resolved.length ? engaged.length / resolved.length : null,
    },
    recentStolen: stolen
      .slice(-5)
      .reverse()
      .map((e) => ({ label: e.label, from: e.stolenFrom?.name || '', at: e.stolenFrom?.at || '' })),
  };
}

/** 梗库统计 */
function memeStats(root) {
  const terms = readJsonl(path.join(root, 'private', 'knowledge', 'terms.jsonl'));
  const now = Date.now();
  const HALF_LIFE = 180 * 24 * 3600_000;
  const USABLE = 0.45;
  let usable = 0;
  let unknownAge = 0;
  for (const t of terms) {
    if (t.risky) continue;
    let fresh;
    if (!t.lastSeenAt && t.ageUnknown) fresh = 0.5;
    else {
      const ref = t.lastSeenAt || t.firstSeenAt || t.addedAt || 0;
      fresh = ref ? Math.pow(0.5, Math.max(0, now - ref) / HALF_LIFE) : 0.5;
    }
    if (fresh >= USABLE) usable += 1;
    if (t.ageUnknown) unknownAge += 1;
  }
  const bySource = {};
  for (const t of terms) bySource[t.source || 'unknown'] = (bySource[t.source || 'unknown'] ?? 0) + 1;
  return { total: terms.length, usable, unknownAge, bySource };
}

/** 好感度榜 */
function affinityStats(root) {
  const aff = readJson(path.join(root, 'private', 'affinity.json'), { users: {} });
  const users = Object.values(aff.users ?? {});
  const now = Date.now();
  const HALF_LIFE = 45 * 24 * 3600_000;
  const score = (r) => {
    const raw = r.msgsFrom * 1 + r.engaged * 3 + r.msgsTo * 0.5 + r.snubs * 0.5;
    if (raw <= 0) return 0;
    const idle = Math.max(0, now - (r.lastTalkAt || r.firstMetAt || now));
    return raw * Math.pow(0.5, idle / HALF_LIFE);
  };
  const tagOf = (s) => (s >= 30 ? '老哥' : s >= 10 ? '熟人' : s >= 3 ? '眼熟' : '生面孔');
  const rows = users
    .map((r) => ({ name: r.name, uin: r.uin, score: score(r), tag: tagOf(score(r)), msgsFrom: r.msgsFrom, engaged: r.engaged }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  return { total: users.length, rows };
}

/** 任务队列 */
function taskStats(root) {
  const dir = path.join(root, 'private', 'tasks');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return { total: 0, pending: 0, recent: [] };
  }
  const tasks = files
    .map((f) => readJson(path.join(dir, f), null))
    .filter(Boolean)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === 'queued' || t.status === 'running').length,
    recent: tasks.slice(0, 6).map((t) => ({
      id: t.id,
      type: t.type,
      status: t.status,
      target: t.target || '',
      at: t.createdAt || 0,
      result: t.result ? String(t.result).slice(-60) : '',
    })),
  };
}

/** 梗库热更器日志尾部 */
function refreshLog(root, lines = 6) {
  try {
    const p = path.join(root, 'private', 'knowledge', 'refresh.log');
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).slice(-lines);
  } catch {
    return [];
  }
}

/**
 * OneBot 在线状态由后台定时刷新。
 *
 * 为什么不在请求里现探：DSH 的路由 handler 必须**同步**返回，
 * 异步写法会导致框架提前结束响应（body 被截断，实测 size=0）。
 * 探测本来就要 1~4 秒，放在请求里也不合理。
 */
let onebotState = { ready: null, reason: '探测中', endpoint: '' };
let onebotTimer = null;

async function refreshOneBot(root) {
  const endpoint = process.env.QCE_ONEBOT || 'http://127.0.0.1:3000';
  try {
    const r = await probeOneBot(endpoint, onebotToken(root));
    onebotState = { ...r, endpoint };
  } catch (error) {
    onebotState = { ready: false, reason: String(error?.message ?? error).slice(0, 80), endpoint };
  }
}

/** 同步组装快照：只读文件，不碰网络。 */
function snapshotSync(root) {
  return {
    at: new Date().toISOString(),
    projectDir: root,
    onebot: onebotState,
    emoji: emojiStats(root),
    meme: memeStats(root),
    affinity: affinityStats(root),
    tasks: taskStats(root),
    refreshLog: refreshLog(root),
    wiki: wikiStats(root),
    media: mediaStats(root),
    diary: { total: diaryEntries(root, 1).total },
  };
}

// ── 梗库检索 ────────────────────────────────────────────────────────────
//
// 词库有 2700+ 条、1.5MB。每次请求都重读会拖慢面板，所以按 mtime 缓存：
// 文件没变就复用上次解析好的数组。
const wikiCache = { key: '', terms: [] };

function loadTerms(root) {
  const file = path.join(root, 'private', 'knowledge', 'terms.jsonl');
  let key = '';
  try {
    const st = fs.statSync(file);
    key = `${st.mtimeMs}:${st.size}`;
  } catch {
    return [];
  }
  if (wikiCache.key === key) return wikiCache.terms;
  const terms = [];
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const d = JSON.parse(line);
        if (d?.term && d?.meaning) terms.push(d);
      } catch {
        /* 坏行跳过 */
      }
    }
  } catch {
    return [];
  }
  wikiCache.key = key;
  wikiCache.terms = terms;
  return terms;
}

/** 概览：总数 + 按月分布（给面板头部用，不含正文） */
function wikiStats(root) {
  const terms = loadTerms(root);
  const byMonth = {};
  let risky = 0;
  for (const t of terms) {
    const m = /^(\d{4}-\d{2})/.exec(String(t.era ?? ''))?.[1] ?? '未标日期';
    byMonth[m] = (byMonth[m] ?? 0) + 1;
    if (t.risky) risky += 1;
  }
  return { total: terms.length, risky, byMonth };
}

/** 检索：term/meaning 里包含 q 即命中，简单但够用（中文不用分词） */
function wikiSearch(root, q, limit = 30) {
  const terms = loadTerms(root);
  const kw = String(q ?? '').trim();
  if (kw === '') return { total: terms.length, hits: [] };
  const hits = [];
  for (const t of terms) {
    const name = String(t.term ?? '');
    const body = String(t.meaning ?? '');
    if (!name.includes(kw) && !body.includes(kw)) continue;
    hits.push({
      term: name,
      // 命中在正文里时，截取关键词附近的一段，比从头截更有用
      meaning: body.length > 240 ? `${body.slice(0, 240)}…` : body,
      era: t.era ?? '',
      risky: t.risky === true,
      source: t.source ?? '',
      exact: name === kw,
    });
    if (hits.length >= limit) break;
  }
  // 完全同名的排最前
  hits.sort((a, b) => Number(b.exact) - Number(a.exact));
  return { total: terms.length, matched: hits.length, hits };
}

// ── 表情库检索 ──────────────────────────────────────────────────────────
//
// 表情的 manifest 只有 hash/label/file/importedAt，没有语义标签
//（label 是自动生成的整句描述），所以只能按 label 关键词搜。

const emojiCache = { key: '', items: [] };

function loadEmoji(root) {
  const lib = path.join(root, 'private', 'emoji-library');
  const file = path.join(lib, 'manifest.json');
  let key = '';
  try {
    const st = fs.statSync(file);
    key = `${st.mtimeMs}:${st.size}`;
  } catch {
    return { lib, items: [] };
  }
  if (emojiCache.key === key) return { lib, items: emojiCache.items };
  let items = [];
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    items = Array.isArray(m?.emojis) ? m.emojis : [];
  } catch {
    items = [];
  }
  emojiCache.key = key;
  emojiCache.items = items;
  return { lib, items };
}

/** hash → 真实文件名（manifest 不存扩展名） */
const emojiFilesCache = { key: '', map: new Map() };

function emojiFileMap(lib) {
  let key = '';
  try {
    key = String(fs.statSync(lib).mtimeMs);
  } catch {
    return new Map();
  }
  if (emojiFilesCache.key === key) return emojiFilesCache.map;
  const map = new Map();
  try {
    for (const n of fs.readdirSync(lib)) {
      if (n.endsWith('.json')) continue;
      const dot = n.lastIndexOf('.');
      if (dot > 0) map.set(n.slice(0, dot), n);
    }
  } catch {
    /* 读不到就当空 */
  }
  emojiFilesCache.key = key;
  emojiFilesCache.map = map;
  return map;
}

function stickerSearch(root, q, limit = 24) {
  const { lib, items } = loadEmoji(root);
  const files = emojiFileMap(lib);
  const kw = String(q ?? '').trim().toLowerCase();
  const hits = [];
  for (const e of items) {
    const label = String(e.label ?? '');
    if (kw !== '' && !label.toLowerCase().includes(kw)) continue;
    const f = files.get(e.file) ?? files.get(e.hash);
    if (!f) continue;
    hits.push({
      label: label || '(无标签)',
      // 面板拿这个去 /qq-panel-emoji/<file> 取图
      file: f,
      at: e.importedAt ?? '',
    });
    if (hits.length >= limit) break;
  }
  return { total: items.length, matched: hits.length, hits };
}

// ── 素材库（生成过的图/视频）──────────────────────────────────────────
//
// 为什么要把这些列出来：豆包生成的产物散在两个目录里，
// 用的时候根本想不起来生成过什么。工作台的意义就是把它们摊开。

const MEDIA_DIRS = [
  { id: 'plugin', label: '豆包产物', dir: 'D:/github_project/ZhaoWen_GitHub维护/dsh/home/plugins/dsh-image-gen/output' },
  { id: 'gen', label: 'qchat 生成', dir: 'output' },
];

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const VIDEO_EXT = ['.mp4', '.mov', '.webm'];

function listMedia(root, kind = 'all', limit = 40) {
  const items = [];
  for (const d of MEDIA_DIRS) {
    const base = d.dir.startsWith('output') ? path.join(root, d.dir) : d.dir;
    let names = [];
    try {
      names = fs.readdirSync(base);
    } catch {
      continue;
    }
    for (const n of names) {
      const ext = path.extname(n).toLowerCase();
      if (![...IMAGE_EXT, ...VIDEO_EXT].includes(ext)) continue;
      const isVideo = VIDEO_EXT.includes(ext);
      if (kind === 'image' && isVideo) continue;
      if (kind === 'video' && !isVideo) continue;
      let st;
      try {
        st = fs.statSync(path.join(base, n));
      } catch {
        continue;
      }
      items.push({
        name: n,
        dir: d.id,
        dirLabel: d.label,
        kind: isVideo ? 'video' : 'image',
        size: st.size,
        mtime: st.mtimeMs,
      });
    }
  }
  items.sort((a, b) => b.mtime - a.mtime);
  return { total: items.length, items: items.slice(0, limit) };
}

function mediaStats(root) {
  const all = listMedia(root, 'all', 100000);
  const images = all.items.filter((i) => i.kind === 'image').length;
  const videos = all.items.filter((i) => i.kind === 'video').length;
  const bytes = all.items.reduce((n, i) => n + i.size, 0);
  return { total: all.total, images, videos, mb: Math.round(bytes / 1048576) };
}

/** 按 dir id 解析出真实目录（白名单，不接受任意路径） */
function mediaBase(root, dirId) {
  const hit = MEDIA_DIRS.find((d) => d.id === dirId);
  if (!hit) return '';
  return hit.dir.startsWith('output') ? path.join(root, hit.dir) : hit.dir;
}

// ── 日记 ────────────────────────────────────────────────────────────────

function diaryEntries(root, limit = 20) {
  const file = path.join(root, 'private', 'diary.jsonl');
  let lines = [];
  try {
    const raw = fs.readFileSync(file, 'utf8');
    lines = raw.split('\n').filter((l) => l.trim() !== '');
  } catch {
    return { total: 0, entries: [] };
  }
  const out = [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      out.push(JSON.parse(lines[i]));
    } catch {
      /* 坏行跳过 */
    }
    if (out.length >= limit) break;
  }
  return { total: lines.length, entries: out };
}

export function apply(ctx, config = {}) {
  const root = config.projectDir || projectDir();

  // AI 通道：面板读的快照，工具读同一份（用户要求所有工作台都要 AI base）
  ctx.tools.register(
    defineTool({
      name: 'qq_view',
      description:
        'QQ 纪实工作台的数据通道：**面板上看到的东西，AI 用这个读同一份**。\n' +
        'op=state 全部状态（OneBot/表情/梗图/亲和力/任务/刷新日志/词库/媒体/日记统计）；' +
        'op=wiki {id:关键词} 搜梗库词；op=diary 读日记列表；op=media 读媒体统计。\n' +
        '用户说「看 QQ 纪实里那个梗」「查最近日记」时用这个。',
      parameters: {
        op: { type: 'string', required: true, description: 'state | wiki | diary | media' },
        id: { type: 'string', description: 'op=wiki 时的关键词' },
        limit: { type: 'number', description: '返回条数，默认 20' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: typeof value?.note === 'string' ? value.note : JSON.stringify(value, null, 2) }],
      },
      execute: async (args) => {
        const op = String(args.op ?? 'state').trim()
        const limit = Number(args.limit) > 0 ? Math.floor(Number(args.limit)) : 20
        if (op === 'state') {
          const snap = snapshotSync(root)
          return { ...snap, note: JSON.stringify(snap, null, 2) }
        }
        if (op === 'wiki') {
          const q = String(args.id ?? '').trim()
          if (q === '') return { ok: false, code: 'EMPTY_QUERY', error: 'op=wiki 需要关键词（用 id 传）' }
          const rows = wikiSearch(root, q, limit)
          return { ok: true, count: Array.isArray(rows) ? rows.length : 0, wiki: rows, note: (rows || []).map((r) => JSON.stringify(r).slice(0, 200)).join('\n') || '没找到。' }
        }
        if (op === 'diary') {
          const rows = diaryEntries(root, limit)
          return { ok: true, diary: rows, note: Array.isArray(rows) && rows.length > 0 ? rows.map((r) => JSON.stringify(r).slice(0, 200)).join('\n') : '没有日记。' }
        }
        if (op === 'media') {
          const stats = mediaStats(root)
          return { ok: true, media: stats, note: JSON.stringify(stats, null, 2) }
        }
        return { ok: false, code: 'UNKNOWN_OP', error: `op 只支持 state | wiki | diary | media，收到：${op}` }
      },
    }),
  );


  // 后台每 5 秒探一次 OneBot，请求时直接读缓存
  try {
    if (onebotTimer) clearInterval(onebotTimer);
    refreshOneBot(root);
    onebotTimer = setInterval(() => refreshOneBot(root), 5000);
    if (typeof onebotTimer.unref === 'function') onebotTimer.unref();
  } catch {
    /* 定时器起不来不影响路由 */
  }

  ctx.inject(['webServer'], (subCtx) => {
    let ws;
    try {
      ws = subCtx.webServer ?? (typeof subCtx.get === 'function' ? subCtx.get('webServer') : undefined);
    } catch {
      ws = undefined;
    }
    if (!ws || typeof ws.register !== 'function') return;

    try {
      ws.register({
        kind: 'prefix',
        path: '/qq-panel-data',
        // 必须同步：异步 handler 会被框架提前结束响应（踩过，body 是空的）
        handler: (req, res) => {
          if (req.method !== 'GET') {
            res.writeHead(405);
            res.end();
            return;
          }
          let body;
          try {
            body = JSON.stringify(snapshotSync(root));
          } catch (error) {
            body = JSON.stringify({ error: String(error?.message ?? error) });
          }
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          });
          res.end(body);
        },
      });
    } catch {
      /* 路由挂了不影响宿主 */
    }

    // 梗库检索：/qq-panel-wiki?q=关键词&limit=30
    // 同步 handler（异步会被框架提前结束响应，body 变空——踩过）
    try {
      ws.register({
        kind: 'prefix',
        path: '/qq-panel-wiki',
        handler: (req, res) => {
          if (req.method !== 'GET') {
            res.writeHead(405);
            res.end();
            return;
          }
          let body;
          try {
            const url = new URL(req.url ?? '/', 'http://local');
            const q = url.searchParams.get('q') ?? '';
            const kind = url.searchParams.get('kind') ?? 'term';
            const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 30));
            body = JSON.stringify(
              kind === 'sticker' ? stickerSearch(root, q, limit) : wikiSearch(root, q, limit),
            );
          } catch (error) {
            body = JSON.stringify({ error: String(error?.message ?? error), hits: [] });
          }
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          });
          res.end(body);
        },
      });
    } catch {
      /* 路由挂了不影响宿主 */
    }
    // 素材列表：/qq-panel-media?kind=image|video|all&limit=40
    try {
      ws.register({
        kind: 'prefix',
        path: '/qq-panel-media',
        handler: (req, res) => {
          if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
          let body;
          try {
            const url = new URL(req.url ?? '/', 'http://local');
            const kind = url.searchParams.get('kind') ?? 'all';
            const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 40));
            body = JSON.stringify(listMedia(root, kind, limit));
          } catch (e) {
            body = JSON.stringify({ error: String(e?.message ?? e), items: [] });
          }
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          res.end(body);
        },
      });
    } catch { /* 忽略 */ }

    // 日记：/qq-panel-diary?limit=20
    try {
      ws.register({
        kind: 'prefix',
        path: '/qq-panel-diary',
        handler: (req, res) => {
          if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
          let body;
          try {
            const url = new URL(req.url ?? '/', 'http://local');
            const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 20));
            body = JSON.stringify(diaryEntries(root, limit));
          } catch (e) {
            body = JSON.stringify({ error: String(e?.message ?? e), entries: [] });
          }
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          res.end(body);
        },
      });
    } catch { /* 忽略 */ }

    // 素材文件：/qq-panel-file?dir=plugin|gen&name=xxx.png
    try {
      ws.register({
        kind: 'prefix',
        path: '/qq-panel-file',
        handler: (req, res) => {
          if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
          let url;
          try { url = new URL(req.url ?? '/', 'http://local'); } catch { res.writeHead(400); res.end(); return; }
          const dirId = url.searchParams.get('dir') ?? '';
          const name = path.basename(url.searchParams.get('name') ?? '');
          const base = mediaBase(root, dirId);
          if (!base || !name) { res.writeHead(400); res.end(); return; }
          const file = path.join(base, name);
          const ext = path.extname(name).toLowerCase();
          if (![...IMAGE_EXT, ...VIDEO_EXT].includes(ext) || !file.startsWith(base)) {
            res.writeHead(404); res.end(); return;
          }
          let buf;
          try { buf = fs.readFileSync(file); } catch { res.writeHead(404); res.end(); return; }
          const type = ext === '.mp4' ? 'video/mp4' : ext === '.webm' ? 'video/webm'
            : ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif'
            : ext === '.webp' ? 'image/webp' : 'image/jpeg';
          res.writeHead(200, { 'content-type': type, 'cache-control': 'max-age=3600' });
          res.end(buf);
        },
      });
    } catch { /* 忽略 */ }

    // 表情图片：/qq-panel-emoji/<文件名>
    // 只允许 emoji-library 目录下的文件，且不允许路径穿越。
    try {
      ws.register({
        kind: 'prefix',
        path: '/qq-panel-emoji',
        handler: (req, res) => {
          if (req.method !== 'GET') {
            res.writeHead(405);
            res.end();
            return;
          }
          const lib = path.join(root, 'private', 'emoji-library');
          const name = path.basename(decodeURIComponent(String(req.url ?? '').replace(/^\/qq-panel-emoji\/?/, '')));
          const file = path.join(lib, name);
          if (name === '' || !file.startsWith(lib)) {
            res.writeHead(400);
            res.end();
            return;
          }
          let buf;
          try {
            buf = fs.readFileSync(file);
          } catch {
            res.writeHead(404);
            res.end();
            return;
          }
          const ext = path.extname(name).toLowerCase();
          // 只放行图片。basename 已经挡住了目录穿越，但 manifest.json 这类
          // 内部文件仍在同目录下——不卡扩展名的话它会被当普通文件送出去（实测泄露 275KB）。
          if (!['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
            res.writeHead(404);
            res.end();
            return;
          }
          const type =
            ext === '.png' ? 'image/png'
            : ext === '.gif' ? 'image/gif'
            : ext === '.webp' ? 'image/webp'
            : 'image/jpeg';
          res.writeHead(200, { 'content-type': type, 'cache-control': 'max-age=86400' });
          res.end(buf);
        },
      });
    } catch {
      /* 路由挂了不影响宿主 */
    }
  });
}

// 给测试/外部脚本用（面板内部不用导出）
export { wikiSearch, wikiStats, stickerSearch };
