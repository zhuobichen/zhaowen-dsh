/**
 * dsh-zcode-bridge —— DSH ↔ ZCode 双向会话迁移（DSH 插件，纯 JS 无构建）。
 *
 * 路由（前缀 /dsh-zcode）：
 *   GET  /dsh-zcode/list                ZCode 会话列表
 *   GET  /dsh-zcode/preview             ZCode → DSH 的 dry-run
 *   POST /dsh-zcode/import              ZCode → DSH（apply:true 才写）
 *   GET  /dsh-zcode/export-preview      DSH → ZCode 的 dry-run
 *   POST /dsh-zcode/export              DSH → ZCode（apply:true + ZCode 未运行才写）
 *   GET  /dsh-zcode/schema              抽样证据（schema / 枚举 / project_id 推导）
 *   GET  /dsh-zcode/dsh-sessions        本机 DSH 会话列表（export 的可选目标）
 *   GET  /dsh-zcode/                    一个不依赖前端构建的小面板
 *
 * 安全默认：所有写操作缺省 dry-run。写 ZCode 必须同时满足 apply:true 与 ZCode 未运行，
 * 且写前自动备份、单事务、失败整体回滚。
 */
import { createHash } from 'node:crypto'

import {
  eventsToIR,
  findSessionFile,
  irToSeedEvents,
  listDshSessions,
  logPath,
  readDshViaHost,
  readSessionFile,
  sessionsRoot,
  writeSessionFile,
} from './dsh.js'
import {
  ZcodeError,
  applyExport,
  defaultDbPath,
  detectZCodeRunning,
  findExistingSession,
  inferDefaults,
  listSessions,
  openDatabase,
  planExport,
  projectIdForDirectory,
  readSessionIR,
  resolveProjectId,
  sampleSchema,
} from './zcode.js'

export const name = 'dsh-zcode-bridge'

/** 只有 webServer 是硬依赖；其余服务（sessions / sessionController / sessionQuery）现取现用。 */
export const inject = ['webServer']

export const ROUTE = '/dsh-zcode'

const MAX_BODY = 1024 * 1024

const STATUS_BY_CODE = {
  ZCODE_RUNNING: 409,
  ALREADY_EXISTS: 409,
  BACKUP_FAILED: 500,
  WRITE_FAILED: 500,
  SCHEMA_MISMATCH: 500,
  ZCODE_STATE_UNKNOWN: 500,
  SESSION_NOT_FOUND: 404,
  DB_NOT_FOUND: 404,
  DSH_SESSION_NOT_FOUND: 404,
  NO_DIRECTORY: 400,
  EMPTY_SESSION: 400,
  BAD_REQUEST: 400,
  DB_BUSY: 503,
  HOST_UNAVAILABLE: 503,
}

function statusOf(error) {
  if (error instanceof ZcodeError) return STATUS_BY_CODE[error.code] ?? 500
  return STATUS_BY_CODE[error?.code] ?? 500
}

function errorBody(error) {
  const code = error instanceof ZcodeError || typeof error?.code === 'string' ? error.code ?? 'ERROR' : 'ERROR'
  return {
    ok: false,
    code,
    message: String(error?.message ?? error),
    ...(error?.detail === undefined ? {} : { detail: error.detail }),
  }
}

/** 服务现取：`ctx.get(name)` 优先，退到属性直挂（兼容老宿主）。 */
function serviceOf(ctx, name) {
  if (ctx === undefined || ctx === null) return undefined
  try {
    if (typeof ctx.get === 'function') {
      const value = ctx.get(name)
      if (value !== undefined && value !== null) return value
    }
  } catch {
    // 服务没装或还没激活：退到属性
  }
  return ctx[name]
}

function hostOf(ctx) {
  return {
    sessions: serviceOf(ctx, 'sessions'),
    sessionController: serviceOf(ctx, 'sessionController'),
    sessionQuery: serviceOf(ctx, 'sessionQuery'),
  }
}

const text = (value, limit = 120) => {
  const flat = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > limit ? flat.slice(0, limit) + '…' : flat
}

function sampleOf(ir, samples = 12) {
  return (ir.messages ?? [])
    .filter((message) => message.synthetic !== true)
    .slice(0, samples)
    .map((message) => ({
      role: message.role,
      text: text(message.parts.find((part) => part.kind === 'text')?.text ?? ''),
    }))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new ZcodeError('BAD_REQUEST', '请求体超过 1 MB。'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (raw === '') return resolve({})
      try {
        const parsed = JSON.parse(raw)
        resolve(parsed !== null && typeof parsed === 'object' ? parsed : {})
      } catch (error) {
        reject(new ZcodeError('BAD_REQUEST', `body 必须是 JSON：${error.message}`))
      }
    })
    req.on('error', reject)
  })
}

/** ZCode 会话 id → 稳定的 DSH 会话 id（重复导入天然撞 id，而不是悄悄造两份）。 */
export function dshSessionIdFor(zcodeSessionId) {
  const hash = createHash('sha1').update(`zcode:${zcodeSessionId}`).digest('hex')
  const hex = hash.slice(0, 32)
  return `session-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

//#region 业务动作
function zcodeList(config, query) {
  const dbPath = config.dbPath ?? defaultDbPath(config.zcodeHome)
  const db = openDatabase(dbPath, { readOnly: true })
  try {
    const sessions = listSessions(db, { limit: Number(query.get('limit') ?? 100) })
    const status = (config.detectRunning ?? detectZCodeRunning)()
    return {
      ok: true,
      db: dbPath,
      count: sessions.length,
      zcodeRunning: status.running === true,
      zcodeStateChecked: status.checked !== false,
      sessions,
    }
  } finally {
    db.close()
  }
}

/**
 * ZCode → DSH 的完整计划：读 IR → 造 seed 事件。
 * preview 与 import 共用它，保证"看到的计划"就是"写下去的东西"。
 */
function buildImportPlan(config, sessionId, options = {}) {
  const dbPath = options.dbPath ?? config.dbPath ?? defaultDbPath(config.zcodeHome)
  const db = openDatabase(dbPath, { readOnly: true })
  try {
    const { ir, session } = readSessionIR(db, sessionId)
    if ((ir.messages ?? []).length === 0) {
      throw new ZcodeError('EMPTY_SESSION', '这个 ZCode 会话没有任何可见消息，导过去会是个空会话。', { sessionId })
    }
    const title = (options.titlePrefix ?? '') + (ir.title ?? 'ZCode 会话')
    const id = options.id ?? dshSessionIdFor(sessionId)
    const plan = irToSeedEvents(
      { ...ir, title },
      { cwd: ir.cwd, createdAt: ir.createdAt ?? session.time_created, id },
    )
    return { ir, session, plan, title }
  } finally {
    db.close()
  }
}

function previewFrom(source) {
  const { ir, session, plan, title } = source
  return {
    ok: true,
    applied: false,
    source: {
      sessionId: session.id,
      directory: session.directory,
      title: session.title,
      createdAt: session.time_created,
    },
    target: {
      cwd: ir.cwd,
      title,
      dshSessionId: plan.header.id,
      systemMessage: true,
    },
    counts: {
      messages: ir.counts.messages,
      userMessages: ir.counts.userMessages,
      assistantMessages: ir.counts.assistantMessages,
      toolCalls: ir.counts.toolCalls,
      events: plan.events.length,
      turns: plan.events.filter((e) => e.type === 'turn/start').length,
      steps: plan.events.filter((e) => e.type === 'step/start').length,
      ignoredParts: ir.counts.ignoredParts,
      hiddenMessages: ir.counts.hiddenMessages,
    },
    ignored: ir.ignored,
    sample: sampleOf(ir),
  }
}

function zcodePreview(config, sessionId, options = {}) {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    throw new ZcodeError('BAD_REQUEST', '缺 sessionId（ZCode 会话 id）。')
  }
  const preview = previewFrom(buildImportPlan(config, sessionId, options))
  return { ...preview, note: 'dry-run：没有任何写入。要真导请 POST /dsh-zcode/import 并传 apply:true。' }
}

async function zcodeImport(ctx, config, body) {
  const sessionId = body.sessionId
  const source = buildImportPlan(config, sessionId, { titlePrefix: body.titlePrefix })
  const preview = previewFrom(source)
  if (body.apply !== true) {
    return { ...preview, note: 'dry-run：没有任何写入。要真导请传 apply:true。' }
  }

  const host = hostOf(ctx)
  const plan = source.plan

  // 幂等：同 id（= 同一个 ZCode 会话派生出来的 id）已存在就 ALREADY_EXISTS。
  const existingFile = findSessionFile(config.root, plan.header.id)
  if (existingFile !== undefined && body.force !== true) {
    throw new ZcodeError('ALREADY_EXISTS', '这个 ZCode 会话已经导入过（对应 DSH 会话文件已存在）。', {
      existingId: plan.header.id,
      file: existingFile,
    })
  }
  if (host.sessions !== undefined && typeof host.sessions.create === 'function') {
    // 活会话不能"覆盖"（store 里同 id 只能有一个），force 对活会话无效。
    if (typeof host.sessions.get === 'function' && host.sessions.get(plan.header.id) !== undefined) {
      throw new ZcodeError('ALREADY_EXISTS', 'DSH 里已经有同 id 的活会话，覆盖不了（先删掉那条会话再导）。', {
        existingId: plan.header.id,
      })
    }
    const session = host.sessions.create(plan.header.id, {
      seed: plan.events,
      meta: { cwd: plan.header.cwd, createdAt: plan.header.createdAt },
    })
    let flushed = false
    if (typeof host.sessions.flush === 'function') flushed = (await host.sessions.flush(session)) === true
    return {
      ok: true,
      applied: true,
      via: 'ctx.sessions.create',
      dshSessionId: plan.header.id,
      flushed,
      target: preview.target,
      counts: preview.counts,
      header: plan.header,
      sample: preview.sample,
    }
  }

  // 没有 sessions 服务：直接落 v4 文件（与 dsh-import 同一条通路）。
  const written = writeSessionFile(logPath(config.root, plan.header.cwd, plan.header.id), plan.header, plan.events, {
    overwrite: body.force === true,
  })
  return {
    ok: true,
    applied: true,
    via: 'file',
    dshSessionId: plan.header.id,
    file: written.file,
    bytes: written.bytes,
    target: preview.target,
    counts: preview.counts,
    sample: preview.sample,
    note: '当前部署没有 ctx.sessions 服务，已直接写 v4 日志文件；DSH 侧栏刷新即可看到。',
  }
}

function readDshSessionIR(ctx, config, dshSessionId) {
  const known = (async () => {
    const host = hostOf(ctx)
    const viaHost = await readDshViaHost(host, dshSessionId)
    if (viaHost !== undefined) {
      const { ir } = eventsToIR(viaHost.header, viaHost.events)
      return { ir, header: viaHost.header, via: viaHost.via }
    }
    const file = findSessionFile(config.root, dshSessionId)
    if (file === undefined) {
      throw new ZcodeError('DSH_SESSION_NOT_FOUND', `本机找不到这个 DSH 会话：${dshSessionId}`, { dshSessionId })
    }
    const log = readSessionFile(file)
    const { ir } = eventsToIR(log.header, log.events)
    return { ir, header: log.header, via: 'file', file }
  })()
  return known
}

async function exportPlan(ctx, config, query) {
  const dshSessionId = query.dshSessionId
  if (typeof dshSessionId !== 'string' || dshSessionId.trim() === '') {
    throw new ZcodeError('BAD_REQUEST', '缺 dshSessionId（DSH 会话 id）。')
  }
  const source = await readDshSessionIR(ctx, config, dshSessionId)
  const dbPath = config.dbPath ?? defaultDbPath(config.zcodeHome)
  const db = openDatabase(dbPath, { readOnly: true })
  try {
    const defaults = inferDefaults(db)
    const project = resolveProjectId(db, source.ir.cwd, query.projectId)
    if (project.projectId === undefined) {
      throw new ZcodeError('NO_DIRECTORY', '这个 DSH 会话没有 cwd，无法派生 ZCode project_id：请显式传 directory。')
    }
    const plan = planExport(source.ir, {
      title: query.title,
      directory: query.directory ?? source.ir.cwd,
      project,
      defaults,
    })
    const existing = findExistingSession(db, plan)
    return { source, dbPath, plan, project, existing }
  } finally {
    db.close()
  }
}

async function exportPreview(ctx, config, query) {
  const { source, plan, project, existing } = await exportPlan(ctx, config, query)
  const running = (config.detectRunning ?? detectZCodeRunning)()
  return {
    ok: true,
    applied: false,
    source: {
      dshSessionId: source.header.id,
      via: source.via,
      cwd: source.ir.cwd,
      title: source.ir.title,
      counts: source.ir.counts,
    },
    target: {
      projectId: project.projectId,
      projectSource: project.source,
      projectCollision: project.collision,
      directory: plan.target.directory,
      title: plan.target.title,
      slug: plan.target.slug,
      version: plan.target.version,
    },
    counts: plan.counts,
    warnings: plan.warnings,
    existing: existing === undefined ? null : { id: existing.id, title: existing.title, slug: existing.slug },
    zcodeRunning: running.running,
    willRefuse: existing === undefined ? null : 'ALREADY_EXISTS',
    note: 'dry-run：没有任何写入。要真导请 POST /dsh-zcode/export 并传 apply:true。',
  }
}

async function exportApply(ctx, config, body) {
  const query = {
    dshSessionId: body.dshSessionId,
    title: body.title,
    directory: body.directory,
    projectId: body.projectId,
  }
  const { source, plan, project, existing, dbPath } = await exportPlan(ctx, config, query)
  if (body.apply !== true) {
    return {
      ok: true,
      applied: false,
      target: {
        projectId: project.projectId,
        projectSource: project.source,
        directory: plan.target.directory,
        title: plan.target.title,
        slug: plan.target.slug,
      },
      counts: plan.counts,
      warnings: plan.warnings,
      existing: existing === undefined ? null : { id: existing.id, title: existing.title },
      note: 'dry-run：没有任何写入。要真导请传 apply:true。',
    }
  }
  const writeOptions = { force: body.force === true }
  if (config.detectRunning !== undefined) writeOptions.detectRunning = config.detectRunning
  const result = applyExport(dbPath, plan, writeOptions)
  return {
    ok: true,
    applied: true,
    source: { dshSessionId: source.header.id, via: source.via, counts: source.ir.counts },
    target: {
      projectId: result.projectId,
      projectSource: project.source,
      directory: result.directory,
      title: result.title,
    },
    inserted: result.inserted,
    backup: result.backup,
    zcodeSessionId: result.sessionId,
    warnings: plan.warnings,
  }
}
//#endregion

//#region HTTP
function send(res, code, body, contentType = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': contentType, 'cache-control': 'no-store' })
  return res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

/** 动态 import 一次 dsh.js 的 logPath（避免顶层再解构一堆名字）。 */
export function apply(ctx, config = {}) {
  const settings = {
    root: config.root ?? sessionsRoot(),
    dbPath: config.dbPath,
    zcodeHome: config.zcodeHome,
    detectRunning: config.detectRunning,
    web: config.web !== false,
  }

  if (settings.web === false || typeof ctx.inject !== 'function') return

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() =>
      webCtx.webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler: async (req, res) => {
          let path = '/'
          let url
          try {
            url = new URL(String(req?.url ?? '/'), 'http://localhost')
            path = url.pathname.slice(ROUTE.length) || '/'
          } catch {
            url = new URL('http://localhost/')
          }
          const method = String(req?.method ?? 'GET').toUpperCase()
          const requireGet = () => (method === 'GET' ? false : true)
          const methodNotAllowed = () => send(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' })
          try {
            if (path === '/' || path === '' || path === '/index.html') {
              if (method !== 'GET') return send(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' })
              return send(res, 200, PANEL_HTML, 'text/html; charset=utf-8')
            }
            if (path === '/list') {
              if (requireGet()) return methodNotAllowed()
              return send(res, 200, zcodeList(settings, url.searchParams))
            }
            if (path === '/preview') {
              if (requireGet()) return methodNotAllowed()
              return send(res, 200, zcodePreview(settings, url.searchParams.get('sessionId') ?? '', {
                titlePrefix: url.searchParams.get('titlePrefix') ?? undefined,
              }))
            }
            if (path === '/import') {
              if (method !== 'POST') return send(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' })
              return send(res, 200, await zcodeImport(ctx, settings, await readJson(req)))
            }
            if (path === '/export-preview') {
              if (requireGet()) return methodNotAllowed()
              return send(res, 200, await exportPreview(ctx, settings, {
                dshSessionId: url.searchParams.get('dshSessionId') ?? '',
                title: url.searchParams.get('title') ?? undefined,
                directory: url.searchParams.get('directory') ?? undefined,
                projectId: url.searchParams.get('projectId') ?? undefined,
              }))
            }
            if (path === '/export') {
              if (method !== 'POST') return send(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' })
              return send(res, 200, await exportApply(ctx, settings, await readJson(req)))
            }
            if (path === '/schema') {
              if (requireGet()) return methodNotAllowed()
              const dbPath = settings.dbPath ?? defaultDbPath(settings.zcodeHome)
              const db = openDatabase(dbPath, { readOnly: true })
              try {
                return send(res, 200, {
                  ok: true,
                  db: dbPath,
                  projectIdRule: {
                    formula: '("proj_" + lower(directory).replace(/[\\\\/:]+/g, "-")).slice(0, 85)',
                    maxLength: 85,
                    sample: projectIdForDirectory('C:\\Users\\Administrator\\.zcode\\workspace\\default'),
                  },
                  ...sampleSchema(db),
                })
              } finally {
                db.close()
              }
            }
            if (path === '/dsh-sessions') {
              if (requireGet()) return methodNotAllowed()
              const sessions = listDshSessions(settings.root, { maxFrames: 12 })
              return send(res, 200, { ok: true, root: settings.root, count: sessions.length, sessions })
            }
            return send(res, 404, { ok: false, code: 'NOT_FOUND', message: `没有这个路由：${path}` })
          } catch (error) {
            return send(res, statusOf(error), errorBody(error))
          }
        },
      }),
    )
  })
}
//#endregion

const PANEL_HTML = String.raw`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>DSH ↔ ZCode 迁移</title>
<style>
:root{color-scheme:dark}
body{font:14px/1.5 ui-sans-serif,system-ui,"Segoe UI",sans-serif;margin:0;background:#0f1115;color:#e6e6e6}
header{padding:14px 18px;border-bottom:1px solid #262a33;display:flex;gap:12px;align-items:baseline}
h1{font-size:15px;margin:0;font-weight:600}
small{color:#8b93a1}
main{display:grid;grid-template-columns:1fr 1fr;gap:18px;padding:18px}
section{border:1px solid #262a33;border-radius:8px;overflow:hidden;background:#13161c}
h2{font-size:13px;margin:0;padding:10px 12px;border-bottom:1px solid #262a33;color:#9fb0c8;font-weight:600}
ol{list-style:none;margin:0;padding:6px 8px;max-height:52vh;overflow:auto}
li{padding:7px 8px;border-radius:6px;cursor:pointer;display:flex;gap:8px;align-items:baseline}
li:hover{background:#1b2029}
li.sel{background:#1d2a3d}
.id{font-family:ui-monospace,monospace;font-size:11px;color:#6f7a8c;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.n{font-size:11px;color:#7d8aa0}
pre{margin:0;padding:12px;font:12px/1.55 ui-monospace,monospace;white-space:pre-wrap;word-break:break-word;max-height:34vh;overflow:auto;color:#c8d3e3}
.bar{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #262a33}
button{font:inherit;padding:5px 12px;border-radius:6px;border:1px solid #33405a;background:#1b2433;color:#dbe6f7;cursor:pointer}
button.go{background:#243a2b;border-color:#33543c;color:#cdf0d6}
button:disabled{opacity:.5;cursor:not-allowed}
</style></head><body>
<header><h1>DSH ↔ ZCode 迁移</h1><small id="status">加载中…</small></header>
<main>
<section><h2>ZCode 会话 → DSH</h2><ol id="zc"></ol>
<div class="bar"><button id="zpreview">dry-run</button><button class="go" id="zimport">导入（写 DSH）</button></div>
<pre id="zout">选一个 ZCode 会话</pre></section>
<section><h2>DSH 会话 → ZCode</h2><ol id="dsh"></ol>
<div class="bar"><button id="dpreview">dry-run</button><button class="go" id="dexport">导出（写 ZCode）</button></div>
<pre id="dout">选一个 DSH 会话</pre></section>
</main>
<script>
const api="/dsh-zcode";
let zcSel=null, dshSel=null;
const $=id=>document.getElementById(id);
const out=(el,v)=>{el.textContent=JSON.stringify(v,null,2)};
async function get(p){const r=await fetch(api+p);return r.json()}
async function post(p,b){const r=await fetch(api+p,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)});return r.json()}
function item(id,title,extra){const li=document.createElement("li");li.dataset.id=id;
li.innerHTML='<span class="id"></span><span class="n"></span>';
li.querySelector(".id").textContent=title||id; li.querySelector(".n").textContent=extra||""; return li}
async function load(){
  try{
    const z=await get("/list");
    $("status").textContent=(z.sessions||[]).length+" 个 ZCode 会话 · ZCode "+(z.zcodeRunning?"正在运行（写会被拒绝）":"未运行");
    const ol=$("zc");ol.innerHTML="";
    for(const s of z.sessions||[]){const li=item(s.id,s.title,s.messages+" 条消息");li.onclick=()=>{zcSel=s.id;[...ol.children].forEach(c=>c.classList.remove("sel"));li.classList.add("sel")};ol.append(li)}
  }catch(e){$("status").textContent="ZCode 库读不到："+e}
  try{
    const d=await get("/dsh-sessions");
    const ol=$("dsh");ol.innerHTML="";
    for(const s of d.sessions||[]){const li=item(s.id,s.title||s.id,s.cwd||"");li.onclick=()=>{dshSel=s.id;[...ol.children].forEach(c=>c.classList.remove("sel"));li.classList.add("sel")};ol.append(li)}
  }catch(e){}
}
$("zpreview").onclick=async()=>{if(!zcSel)return;$("zout").textContent="…";out($("zout"),await get("/preview?sessionId="+encodeURIComponent(zcSel)))};
$("zimport").onclick=async()=>{if(!zcSel)return;
  if(!confirm("真的写进 DSH？"))return;
  $("zout").textContent="…";out($("zout"),await post("/import",{sessionId:zcSel,apply:true}));load()};
$("dpreview").onclick=async()=>{if(!dshSel)return;$("dout").textContent="…";out($("dout"),await get("/export-preview?dshSessionId="+encodeURIComponent(dshSel)))};
$("dexport").onclick=async()=>{if(!dshSel)return;
  if(!confirm("真的写进 ZCode 库？（需要 ZCode 已退出；会自动备份）"))return;
  $("dout").textContent="…";out($("dout"),await post("/export",{dshSessionId:dshSel,apply:true}));load()};
load();
</script></body></html>`
