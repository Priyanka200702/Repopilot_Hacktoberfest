/**
 * Regression tests for "Detailed Analysis only shows the fallback":
 * fallback results must never be cached or saved, and the real reason must be returned.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

for (const k of ['GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'OLLAMA_URL', 'GEMMA_STRICT']) delete process.env[k];
process.env.DOTENV_CONFIG_QUIET = 'true';

// Stub GitHub blob reads used by the Detailed Analysis route (no network in tests).
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('https://api.github.com/')) {
    const content = Buffer.from('function add(a, b) {\n  return a + b;\n}\n').toString('base64');
    return new Response(JSON.stringify({ content, encoding: 'base64' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return realFetch(input, init);
};

const app = require('../src/index.js');
const cache = require('../src/services/cache');
const ProviderManager = require('../src/services/ai/ProviderManager');
for (const k of ['GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'OLLAMA_URL', 'GEMMA_STRICT']) delete process.env[k];

let server; let base;
test.before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => server.close());

const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('Detailed Analysis: fallback is labelled with the reason and not cached; Gemma result is cached', async () => {
  const body = { owner: 'o', repo: 'r', path: 'src/math.js', sha: 'deadbeef' };
  const original = ProviderManager.gemma.generateDetailedAnalysis;
  let calls = 0;
  ProviderManager.gemma.generateDetailedAnalysis = async () => { calls++; const e = new Error('Gemma 4 rate limit'); e.status = 429; throw e; };
  try {
    const first = await (await post('/explorer/analyze-line-by-line', body)).json();
    assert.equal(first.provider, 'fallback');
    assert.match(first.notice, /Gemma 4 could not finish this analysis \(Gemma 4 rate limit\)/);
    assert.match(first.analysis, /Static analysis fallback/);

    ProviderManager.cache.clear();
    ProviderManager.gemma.generateDetailedAnalysis = async () => { calls++; return '## Summary\nAdds two numbers.'; };
    const second = await (await post('/explorer/analyze-line-by-line', body)).json();
    assert.equal(second.provider, 'gemma', 'the earlier fallback did not stick');
    assert.match(second.analysis, /Adds two numbers/);

    const third = await (await post('/explorer/analyze-line-by-line', body)).json();
    assert.equal(third.cached, true);
    assert.equal(calls, 2);
  } finally { ProviderManager.gemma.generateDetailedAnalysis = original; }
});

test('Executive summary and security review are only saved when Gemma wrote them', async () => {
  const analysis = { meta: { owner: 'o2', repo: 'r2', commitSha: 'abc' }, summary: { oneLiner: 'x' }, securityAlerts: [], routes: [] };
  cache.set('o2/r2', analysis);
  const origSummary = ProviderManager.gemma.generateExecutiveSummary;
  const origReview = ProviderManager.gemma.generateSecurityReview;
  ProviderManager.gemma.generateExecutiveSummary = async () => { throw new Error('Gemma is not configured: set GEMINI_API_KEY'); };
  ProviderManager.gemma.generateSecurityReview = async () => { throw new Error('Gemma is not configured: set GEMINI_API_KEY'); };
  try {
    const s1 = await (await fetch(`${base}/analyze/o2/r2/summary`)).json();
    assert.equal(s1.aiExecutiveSummary, null);
    assert.match(s1.error, /not configured/);
    assert.equal(cache.get('o2/r2').summary.aiExecutiveSummary, undefined, 'fallback text was not saved');
    const r1 = await (await fetch(`${base}/analyze/o2/r2/security-review`)).json();
    assert.equal(r1.aiSecurityReview, null);

    ProviderManager.cache.clear();
    ProviderManager.gemma.generateExecutiveSummary = async () => 'A demo API built with Express.';
    const s2 = await (await fetch(`${base}/analyze/o2/r2/summary`)).json();
    assert.equal(s2.aiExecutiveSummary, 'A demo API built with Express.');
    assert.equal(cache.get('o2/r2').summary.aiExecutiveSummary, 'A demo API built with Express.');
  } finally {
    ProviderManager.gemma.generateExecutiveSummary = origSummary;
    ProviderManager.gemma.generateSecurityReview = origReview;
  }
});
