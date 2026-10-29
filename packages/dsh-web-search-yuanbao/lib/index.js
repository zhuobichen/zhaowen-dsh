/**
 * 腾讯元宝搜索（Tencent Yuanbao Search，产品 `wsa`）的 DSH 搜索提供方。
 *
 * 走 `ctx.web.registerSearchProvider`，id 固定为 `yuanbao`；一次搜索 = 一次
 * `SearchPro` 调用（TC3-HMAC-SHA256 签名，纯 `node:crypto`，零第三方依赖）。
 *
 * 设计要点：
 * - 只在 `search()` 里读配置快照，密钥每次请求现取，换密钥不需要重启。
 * - 凭据来源顺序：配置里的字面量 → `process.env` → `$DSH_HOME/.env`（直接读文件，
 *   所以新写进 `.env` 的密钥不用重启进程就能生效）。
 * - `fallbackProvider`（默认 `deepseek-official`）：元宝不可用、报错或返回 0 条时，
 *   转交给已在同一个 `ctx.web` 上注册的 DeepSeek 搜索，`web_search` 不会因为
 *   元宝欠费/未开通而整体失效。
 */

import { createHash, createHmac } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 提供方 id（写进 `web.searchProvider` 的就是它）。 */
export const PROVIDER_ID = 'yuanbao';

const HOST = 'wsa.tencentcloudapi.com';
const SERVICE = 'wsa';
const ACTION = 'SearchPro';
const VERSION = '2025-05-08';
/** 接口只认这几个取值，其它值直接 InvalidParameter。 */
const ALLOWED_CNT = [10, 20, 30, 40, 50];
const DEFAULT_SECRET_ID_ENV = 'TENCENTCLOUD_SECRET_ID';
const DEFAULT_SECRET_KEY_ENV = 'TENCENTCLOUD_SECRET_KEY';
const DEFAULT_FALLBACK = 'deepseek-official';
const DEFAULT_TIMEOUT_MS = 20_000;

/** 带 `code` 的错误，形状对齐 `WebError` 的消费方（`error.code` / `error.message`）。 */
function webError(message, code, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.code = code;
  return error;
}

/* ────────────────────────────── 凭据 ────────────────────────────── */

let dotEnvCache = { mtimeMs: -1, file: '', values: {} };

/** 读 `$DSH_HOME/.env`（Harness 主目录的机器级默认值），按 mtime 缓存。 */
function dotEnvValues() {
  const home = process.env.DSH_HOME;
  if (home === undefined || home.length === 0) return {};
  const file = join(home, '.env');
  let stat;
  try {
    stat = statSync(file);
  } catch {
    return {};
  }
  if (stat.mtimeMs === dotEnvCache.mtimeMs && file === dotEnvCache.file) return dotEnvCache.values;
  const values = {};
  try {
    for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (line.length === 0 || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      values[key] = value;
    }
  } catch {
    return {};
  }
  dotEnvCache = { mtimeMs: stat.mtimeMs, file, values };
  return values;
}

/** 一个字面量或环境变量名的解析结果（找不到返回 undefined）。 */
function resolveEnv(name, literal) {
  if (typeof literal === 'string' && literal.length > 0) return literal;
  if (typeof name !== 'string' || name.length === 0) return undefined;
  const ambient = process.env[name];
  if (typeof ambient === 'string' && ambient.length > 0) return ambient;
  const fromFile = dotEnvValues()[name];
  return typeof fromFile === 'string' && fromFile.length > 0 ? fromFile : undefined;
}

/* ────────────────────────────── 签名 ────────────────────────────── */

const sha256hex = (value) => createHash('sha256').update(value).digest('hex');

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest();
}

/** TC3-HMAC-SHA256 请求头；`payload` 已是字符串化的 JSON 正文。 */
export function signHeaders({ secretId, secretKey, payload, action = ACTION, version = VERSION, now = Date.now() }) {
  const timestamp = Math.floor(now / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const contentType = 'application/json; charset=utf-8';
  const signedHeaders = 'content-type;host';
  const canonicalRequest = [
    'POST',
    '/',
    '',
    `content-type:${contentType}\nhost:${HOST}\n`,
    signedHeaders,
    sha256hex(payload),
  ].join('\n');
  const scope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    scope,
    sha256hex(canonicalRequest),
  ].join('\n');
  const kSigning = hmac(hmac(hmac(`TC3${secretKey}`, date), SERVICE), 'tc3_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return {
    Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'Content-Type': contentType,
    'X-TC-Action': action,
    'X-TC-Version': version,
    'X-TC-Timestamp': String(timestamp),
  };
}

/* ────────────────────────────── 结果映射 ────────────────────────────── */

/** `searchMaxResults` → 接口允许的 `Cnt`（向上取整到 10/20/.../50）。 */
export function pickCnt(maxResults) {
  const wanted = Number.isInteger(maxResults) && maxResults > 0 ? maxResults : 10;
  for (const cnt of ALLOWED_CNT) if (cnt >= wanted) return cnt;
  return ALLOWED_CNT[ALLOWED_CNT.length - 1];
}

/** `Pages`（JSON 字符串数组）→ seam 的 `sources[]`，按 url 去重。 */
export function mapPages(pages) {
  const sources = [];
  const seen = new Set();
  for (const page of pages ?? []) {
    let doc = page;
    if (typeof page === 'string') {
      try {
        doc = JSON.parse(page);
      } catch {
        continue;
      }
    }
    if (doc === null || typeof doc !== 'object') continue;
    const url = typeof doc.url === 'string' ? doc.url.trim() : '';
    if (url.length === 0 || seen.has(url)) continue;
    seen.add(url);
    const source = { url };
    if (typeof doc.title === 'string' && doc.title.length > 0) source.title = doc.title;
    const snippet = typeof doc.passage === 'string' && doc.passage.length > 0
      ? doc.passage
      : typeof doc.content === 'string' ? doc.content : '';
    if (snippet.length > 0) source.snippet = snippet;
    if (typeof doc.date === 'string' && doc.date.length > 0) source.publishedAt = doc.date;
    sources.push(source);
  }
  return sources;
}

/* ────────────────────────────── 提供方 ────────────────────────────── */

function isAbortError(error) {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

/**
 * 造一个元宝搜索提供方。
 * @param options.ctx   cordis 插件上下文（只用到 `ctx.web` 与 `ctx.logger`）
 * @param options.config 插件配置（每次请求重新读，允许运行期改）
 */
export function createYuanbaoProvider({ ctx, config }) {
  const settings = () => (config !== null && typeof config === 'object' ? config : {});

  function credentials() {
    const cfg = settings();
    return {
      secretId: resolveEnv(cfg.secretIdEnv ?? DEFAULT_SECRET_ID_ENV, cfg.secretId),
      secretKey: resolveEnv(cfg.secretKeyEnv ?? DEFAULT_SECRET_KEY_ENV, cfg.secretKey),
    };
  }

  /** 同 seam 上已注册的回落提供方（自己不会回落给自己）。 */
  function fallbackProvider() {
    const id = settings().fallbackProvider ?? DEFAULT_FALLBACK;
    if (typeof id !== 'string' || id.length === 0 || id === PROVIDER_ID) return undefined;
    const providers = ctx?.web?.searchProviders;
    if (!(providers instanceof Map)) return undefined;
    const provider = providers.get(id);
    if (provider === undefined || provider === null || provider.id === PROVIDER_ID) return undefined;
    try {
      return provider.available() === false ? undefined : provider;
    } catch {
      return undefined;
    }
  }

  async function searchYuanbao(request, signal) {
    const cfg = settings();
    const { secretId, secretKey } = credentials();
    if (secretId === undefined || secretKey === undefined) {
      throw webError(
        `元宝搜索缺少凭据：请在 $DSH_HOME/.env 里设置 ${cfg.secretIdEnv ?? DEFAULT_SECRET_ID_ENV} 与 ${cfg.secretKeyEnv ?? DEFAULT_SECRET_KEY_ENV}（或给插件配置字面量 secretId/secretKey）`,
        'WEB_PROVIDER_CREDENTIAL_MISSING',
      );
    }
    const payload = { Query: request.query, Cnt: pickCnt(request.maxResults) };
    const mode = cfg.mode;
    if (Number.isInteger(mode)) payload.Mode = mode;
    if (typeof cfg.site === 'string' && cfg.site.length > 0) payload.Site = cfg.site;
    if (typeof cfg.industry === 'string' && cfg.industry.length > 0) payload.Industry = cfg.industry;
    if (typeof cfg.freshness === 'string' && cfg.freshness.length > 0) payload.Freshness = cfg.freshness;

    const body = JSON.stringify(payload);
    const headers = signHeaders({ secretId, secretKey, payload: body });
    const timeoutMs = Number.isInteger(cfg.timeoutMs) && cfg.timeoutMs > 0 ? cfg.timeoutMs : DEFAULT_TIMEOUT_MS;
    const timeout = AbortSignal.timeout(timeoutMs);
    const composed = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);

    let response;
    try {
      response = await fetch(`https://${HOST}/`, {
        method: 'POST',
        redirect: 'error',
        headers: { ...headers, accept: 'application/json' },
        body,
        signal: composed,
      });
    } catch (error) {
      if (signal?.aborted === true) throw webError('元宝搜索已取消', 'WEB_ABORTED', signal.reason);
      if (isAbortError(error)) {
        throw webError(`元宝搜索超时（${timeoutMs}ms）`, 'WEB_PROVIDER_ERROR', error);
      }
      throw webError(`元宝搜索请求失败：${String(error)}`, 'WEB_PROVIDER_ERROR', error);
    }

    if (!response.ok) {
      throw webError(`元宝搜索 HTTP ${response.status}`, 'WEB_PROVIDER_ERROR');
    }

    let parsed;
    try {
      parsed = await response.json();
    } catch (error) {
      throw webError(`元宝搜索响应无法解析：${String(error)}`, 'WEB_PROVIDER_ERROR', error);
    }
    const envelope = parsed?.Response ?? parsed;
    if (envelope?.Error !== undefined) {
      const code = envelope.Error.Code ?? 'Unknown';
      const message = envelope.Error.Message ?? '';
      throw webError(
        `元宝搜索 ${code}: ${message}${envelope.RequestId ? ` (RequestId ${envelope.RequestId})` : ''}`,
        'WEB_PROVIDER_ERROR',
      );
    }
    // seam 自己按 searchMaxResults 截断，这里不设 truncated。
    return { sources: mapPages(envelope?.Pages), truncated: false };
  }

  return {
    id: PROVIDER_ID,

    available() {
      const { secretId, secretKey } = credentials();
      if (secretId !== undefined && secretKey !== undefined) return true;
      // 没有元宝凭据时，只要回落链可用，通道整体仍然可用。
      return fallbackProvider() !== undefined;
    },

    async search(request, signal) {
      if (typeof request?.query !== 'string' || request.query.trim().length === 0) {
        throw webError('元宝搜索需要一个非空 query', 'WEB_PROVIDER_ERROR');
      }
      let primaryError;
      try {
        const result = await searchYuanbao(request, signal);
        if (result.sources.length > 0 || signal?.aborted === true) return result;
        primaryError = webError('元宝搜索返回 0 条结果', 'WEB_PROVIDER_ERROR');
      } catch (error) {
        if (signal?.aborted === true || error?.code === 'WEB_ABORTED') throw error;
        primaryError = error;
      }

      const fallback = fallbackProvider();
      if (fallback === undefined) throw primaryError;
      ctx?.logger?.warn?.(`元宝搜索失败，回落到 ${fallback.id}：${primaryError.message}`);
      return fallback.search(request, signal);
    },
  };
}

/* ────────────────────────────── 插件 ────────────────────────────── */

/** cordis 插件名（Loader 诊断里出现的就是它）。 */
export const name = 'web-search-yuanbao';

/** 需要 `ctx.web` 这个 seam 先就位。 */
export const inject = ['web'];

/**
 * 只做一件事：把元宝提供方注册进 `ctx.web`。
 * 提供方 id 与回落目标都在 `web.searchProvider` / 本插件配置里选，不在代码里硬编码。
 */
export function apply(ctx, config) {
  const provider = createYuanbaoProvider({ ctx, config });
  ctx.web.registerSearchProvider(provider);
  ctx?.logger?.info?.(`元宝搜索提供方已注册（id: ${PROVIDER_ID}）`);
}
