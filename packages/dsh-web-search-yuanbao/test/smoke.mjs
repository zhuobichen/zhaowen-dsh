/**
 * 冒烟测试：不启动 DSH，直接用假 ctx 驱动元宝搜索提供方。
 *
 *   node test/smoke.mjs            # 只跑离线单测
 *   node test/smoke.mjs --live     # 再打一次真实 SearchPro
 */
import assert from 'node:assert/strict';
import { createYuanbaoProvider, mapPages, pickCnt, signHeaders } from '../lib/index.js';

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${name}\n      ${error.message}`);
  }
}

console.log('单测：');
await check('pickCnt 向上取整到接口允许值', () => {
  assert.equal(pickCnt(undefined), 10);
  assert.equal(pickCnt(1), 10);
  assert.equal(pickCnt(8), 10);
  assert.equal(pickCnt(10), 10);
  assert.equal(pickCnt(11), 20);
  assert.equal(pickCnt(50), 50);
  assert.equal(pickCnt(80), 50);
});

await check('mapPages 解析 JSON 字符串并去重', () => {
  const pages = [
    JSON.stringify({ title: 'A', url: 'https://a.example/1', passage: 'pa', date: '2026-01-01' }),
    JSON.stringify({ title: 'A dup', url: 'https://a.example/1', passage: 'dup' }),
    JSON.stringify({ title: 'B', url: 'https://b.example/2', content: 'cb' }),
    '{not json',
    JSON.stringify({ title: 'no url' }),
  ];
  const sources = mapPages(pages);
  assert.equal(sources.length, 2);
  assert.deepEqual(sources[0], {
    url: 'https://a.example/1',
    title: 'A',
    snippet: 'pa',
    publishedAt: '2026-01-01',
  });
  assert.equal(sources[1].snippet, 'cb');
});

await check('signHeaders 形状与官方 TC3 一致', () => {
  const headers = signHeaders({
    secretId: 'AKIDtest',
    secretKey: 'secret',
    payload: '{"Query":"x"}',
    now: Date.parse('2026-10-23T00:00:00Z'),
  });
  assert.match(headers.Authorization, /^TC3-HMAC-SHA256 Credential=AKIDtest\/2026-10-23\/wsa\/tc3_request, SignedHeaders=content-type;host, Signature=[0-9a-f]{64}$/u);
  assert.equal(headers['X-TC-Timestamp'], String(Math.floor(Date.parse('2026-10-23T00:00:00Z') / 1000)));
  assert.equal(headers['X-TC-Action'], 'SearchPro');
});

/* ── 假 ctx：只需要 web.searchProviders 这个 Map 与 logger ── */
function fakeCtx(extraProviders = {}) {
  const providers = new Map();
  for (const [id, provider] of Object.entries(extraProviders)) providers.set(id, provider);
  return { web: { searchProviders: providers }, logger: { warn: () => {}, info: () => {} } };
}

console.log('\n回落链：');
const fallbackCalls = [];
const fallback = {
  id: 'deepseek-official',
  available: () => true,
  async search(request) {
    fallbackCalls.push(request.query);
    return { sources: [{ url: 'https://fallback.example/', title: 'fallback' }], truncated: false };
  },
};

const brokenProvider = createYuanbaoProvider({
  ctx: fakeCtx({ 'deepseek-official': fallback }),
  config: { secretId: '', secretKey: '', fallbackProvider: 'deepseek-official', secretIdEnv: 'NO_SUCH_ID_VAR', secretKeyEnv: 'NO_SUCH_KEY_VAR' },
});

let missingCredsError;
try {
  await brokenProvider.search({ query: 'x', maxResults: 8 });
} catch (error) {
  missingCredsError = error;
}
await check('没凭据时不抛错而是回落到 DeepSeek', () => {
  assert.equal(missingCredsError, undefined);
  assert.deepEqual(fallbackCalls, ['x']);
});

const noFallback = createYuanbaoProvider({
  ctx: fakeCtx(),
  config: { secretIdEnv: 'NO_SUCH_ID_VAR', secretKeyEnv: 'NO_SUCH_KEY_VAR' },
});
await check('没凭据且没回落时抛 WEB_PROVIDER_CREDENTIAL_MISSING', async () => {
  await assert.rejects(
    () => noFallback.search({ query: 'x', maxResults: 8 }),
    (error) => error.code === 'WEB_PROVIDER_CREDENTIAL_MISSING',
  );
});

await check('available() 跟着凭据/回落走', () => {
  assert.equal(noFallback.available(), false);
  assert.equal(brokenProvider.available(), true);
});

if (process.argv.includes('--live')) {
  console.log('\n真实调用 SearchPro：');
  const provider = createYuanbaoProvider({ ctx: fakeCtx(), config: { mode: 2 } });
  if (!provider.available()) {
    console.log('  跳过：环境里没有 TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY');
  } else {
    const result = await provider.search({ query: '元宝搜索 API', maxResults: 8 });
    console.log(`  条数=${result.sources.length}`);
    for (const source of result.sources.slice(0, 3)) {
      console.log(`  - ${source.title}`);
      console.log(`    ${source.url}`);
      console.log(`    ${(source.snippet ?? '').slice(0, 80)}`);
      console.log(`    ${source.publishedAt ?? '(no date)'}`);
    }
    check('真实调用返回至少 1 条且字段齐全', () => {
      assert.ok(result.sources.length > 0);
      for (const source of result.sources) {
        assert.match(source.url, /^https?:\/\//u);
        assert.equal(typeof source.title, 'string');
      }
    });
  }
}

if (failed > 0) {
  console.log(`\n${failed} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');

