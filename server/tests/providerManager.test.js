const test = require('node:test');
const assert = require('node:assert/strict');
const { ProviderManager } = require('../src/services/ai/ProviderManager');

function manager({ gemma = {}, strict = false } = {}) {
  const pm = new ProviderManager();
  pm.cache.clear();
  Object.assign(pm.gemma, gemma);
  if (strict) process.env.GEMMA_STRICT = 'true'; else delete process.env.GEMMA_STRICT;
  return pm;
}

test('only Gemma and the rule-based fallback are registered', () => {
  const pm = manager();
  assert.deepEqual(Object.keys(pm.providers).sort(), ['gemma', 'mock']);
  assert.equal(pm.describe().provider, 'Gemma 4');
});

test('Gemma answers, result is cached and tagged', async () => {
  let calls = 0;
  const pm = manager({ gemma: { generateExecutiveSummary: async () => { calls++; return 'Gemma summary'; } } });
  const r1 = await pm.execute('generateExecutiveSummary', { summary: {} }, { key: undefined, provider: undefined });
  const r2 = await pm.execute('generateExecutiveSummary', { summary: {} }, { key: undefined, provider: undefined });
  assert.deepEqual([r1.success, r1.provider, r1.data], [true, 'gemma', 'Gemma summary']);
  assert.equal(r2.data, 'Gemma summary');
  assert.equal(calls, 1);
});

test('Gemma failure falls back to rule-based output, is labelled, and is not cached', async () => {
  let calls = 0;
  const pm = manager({ gemma: { generateSecurityReview: async () => { calls++; const e = new Error('Gemma is not configured: set GEMINI_API_KEY'); throw e; } } });
  const r = await pm.execute('generateSecurityReview', {}, { key: undefined });
  assert.equal(r.success, true);
  assert.equal(r.provider, 'mock');
  assert.match(r.fallbackReason, /not configured/);
  await pm.execute('generateSecurityReview', {}, { key: undefined });
  assert.equal(calls, 2, 'Gemma is retried on the next request');
});

test('GEMMA_STRICT disables the fallback and maps errors', async () => {
  const pm = manager({ strict: true, gemma: { generateApiExplanation: async () => { const e = new Error('slow down'); e.status = 429; throw e; } } });
  const r = await pm.execute('generateApiExplanation', { method: 'GET', path: '/' }, { key: undefined });
  assert.deepEqual([r.success, r.code, r.status], [false, 'AI_RATE_LIMITED', 429]);
  delete process.env.GEMMA_STRICT;
});

test('Time Machine methods never fall back', async () => {
  const pm = manager({ gemma: { generateFileStory: async () => { throw new Error('Gemma is not configured: set GEMINI_API_KEY'); } } });
  const r = await pm.execute('generateFileStory', { systemPrompt: 's', userPrompt: 'u' }, { provider: 'gemma' });
  assert.equal(r.success, false);
  assert.equal(r.code, 'AI_KEY_MISSING');
});

test('user key from headers reaches Gemma unchanged', async () => {
  let seen;
  const pm = manager({ gemma: { answerQuestion: async (q, a, override) => { seen = override; return { answer: 'ok', citations: [] }; } } });
  await pm.execute('answerQuestion', 'q', {}, { key: 'AIzaUser', provider: 'gemini' });
  assert.deepEqual(seen, { key: 'AIzaUser', provider: 'gemini' });
});
