const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const GemmaProvider = require('../src/services/ai/providers/GemmaProvider');

const ENV_KEYS = ['GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'OLLAMA_URL', 'GEMMA_BACKEND', 'AI_PROVIDER', 'GEMMA_MODEL', 'GEMMA_FAST_MODEL', 'GEMMA_OLLAMA_MODEL', 'GEMMA_RETRY_DELAY_MS'];
async function withEnv(env, fn) {
  const saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  ENV_KEYS.forEach(k => delete process.env[k]);
  Object.assign(process.env, env);
  try { return await fn(); } finally { ENV_KEYS.forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); }
}

test('backend resolution order and model ids', () => withEnv({}, async () => {
  const g = new GemmaProvider();
  await withEnv({ GEMINI_API_KEY: 'AIza1', OPENROUTER_API_KEY: 'sk-or' }, () => {
    assert.deepEqual(g.resolveBackend(), { backend: 'gemini', key: 'AIza1' });
    assert.equal(g.modelFor('gemini'), 'gemma-4-31b-it');
    assert.equal(g.modelFor('gemini', 'fast'), 'gemma-4-26b-a4b-it');
  });
  await withEnv({ GEMINI_API_KEY: 'AIza1', OPENROUTER_API_KEY: 'sk-or', AI_PROVIDER: 'openrouter' }, () => {
    assert.equal(g.resolveBackend().backend, 'openrouter');
    assert.equal(g.modelFor('openrouter'), 'google/gemma-4-31b-it');
    assert.equal(g.modelFor('openrouter', 'fast'), 'google/gemma-4-26b-a4b-it');
  });
  await withEnv({ OLLAMA_URL: 'http://localhost:11434', GEMMA_OLLAMA_MODEL: 'gemma4:e2b' }, () => {
    assert.equal(g.resolveBackend().backend, 'ollama');
    assert.equal(g.modelFor('ollama'), 'gemma4:e2b');
  });
  await withEnv({ GEMINI_API_KEY: 'AIza1', OLLAMA_URL: 'http://x', GEMMA_BACKEND: 'ollama' }, () => {
    assert.equal(g.resolveBackend().backend, 'ollama');
  });
}));

test('model ids are normalised per backend', () => withEnv({ GEMMA_MODEL: 'google/gemma-4-31b-it', GEMMA_FAST_MODEL: 'gemma-4-26b-a4b-it' }, () => {
  const g = new GemmaProvider();
  assert.equal(g.modelFor('gemini'), 'gemma-4-31b-it');
  assert.equal(g.modelFor('openrouter', 'fast'), 'google/gemma-4-26b-a4b-it');
}));

test('BYOK: key prefix or provider hint picks the Gemma backend; other keys are ignored', () => withEnv({ OPENROUTER_API_KEY: 'server-key' }, () => {
  const g = new GemmaProvider();
  assert.deepEqual(g.resolveBackend('user-key', 'gemini'), { backend: 'gemini', key: 'user-key' });
  assert.deepEqual(g.resolveBackend({ key: 'AIzaUser' }), { backend: 'gemini', key: 'AIzaUser' });
  assert.deepEqual(g.resolveBackend({ key: 'sk-or-v1-user', provider: 'gemini' }), { backend: 'openrouter', key: 'sk-or-v1-user' });
  assert.deepEqual(g.resolveBackend('user-key', 'anthropic'), { backend: 'openrouter', key: 'server-key' });
  assert.deepEqual(g.resolveBackend({ key: 'sk-ant-123', provider: 'anthropic' }), { backend: 'openrouter', key: 'server-key' });
}));

test('placeholder keys from .env.example count as not configured', () => withEnv({ GEMINI_API_KEY: 'your_gemini_api_key_here', OPENROUTER_API_KEY: 'your_openrouter_api_key_here' }, () => {
  const g = new GemmaProvider();
  assert.throws(() => g.resolveBackend(), /not configured/);
  assert.equal(g.isConfigured(), false);
  assert.equal(g.describe().configured, false);
}));

test('OpenRouter request uses the Gemma model id and both prompts', () => withEnv({ OPENROUTER_API_KEY: 'sk-or-v1-x' }, async () => {
  const g = new GemmaProvider();
  const original = axios.post;
  let captured;
  axios.post = async (url, body, opts) => { captured = { url, body, opts }; return { data: { choices: [{ message: { content: 'A short description 🚀 — done' } }] } }; };
  try {
    const out = await g.generateFileDescription('src/app.js', 'const app = express()');
    assert.equal(captured.url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(captured.body.model, 'google/gemma-4-26b-a4b-it', 'short tasks use the fast Gemma model');
    assert.equal(captured.body.messages[0].role, 'system');
    assert.match(captured.body.messages[1].content, /File: src\/app\.js/);
    assert.equal(captured.opts.headers.Authorization, 'Bearer sk-or-v1-x');
    assert.equal(out, 'A short description, done.', 'plain text: emoji stripped, em dash replaced');
  } finally { axios.post = original; }
}));

test('Gemini API request targets the Gemma model endpoint', () => withEnv({ GEMINI_API_KEY: 'AIzaTest' }, async () => {
  const g = new GemmaProvider();
  const originalFetch = globalThis.fetch;
  let url;
  globalThis.fetch = async (u) => {
    url = String(u);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '## 📄 Summary\nWalkthrough' }], role: 'model' }, finishReason: 'STOP' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const out = await g.generateDetailedAnalysis('a.js', '1: const x = 1');
    assert.match(url, /models\/gemma-4-26b-a4b-it:generateContent/, 'detailed analysis uses the fast Gemma 4 model');
    assert.match(out, /Walkthrough/);
    await g.generateReadme({ summary: {} });
    assert.match(url, /models\/gemma-4-31b-it:generateContent/, 'README uses the main Gemma 4 model');
  } finally { globalThis.fetch = originalFetch; }
}));

test('one retry on rate limit, none on auth errors', () => withEnv({ OPENROUTER_API_KEY: 'sk-or-v1-x', GEMMA_RETRY_DELAY_MS: '1' }, async () => {
  const g = new GemmaProvider();
  const original = axios.post;
  let calls = 0;
  axios.post = async () => { calls++; if (calls === 1) { const e = new Error('rl'); e.response = { status: 429, data: {} }; throw e; } return { data: { choices: [{ message: { content: 'Demo app' } }] } }; };
  try {
    assert.equal(await g.generateExecutiveSummary({ summary: {} }), 'Demo app.');
    assert.equal(calls, 2);
    calls = 0;
    axios.post = async () => { calls++; const e = new Error('bad key'); e.response = { status: 401, data: {} }; throw e; };
    await assert.rejects(() => g.generateExecutiveSummary({ summary: {} }), e => e.status === 401);
    assert.equal(calls, 1);
  } finally { axios.post = original; }
}));

test('answerQuestion extracts citations and README strips code fences', () => withEnv({}, async () => {
  const g = new GemmaProvider();
  g._complete = async (system, user) => {
    if (/README/.test(system)) return { text: '```markdown\n# Demo\n```', backend: 'test', model: 'gemma-test' };
    assert.match(system, /REPOSITORY ANALYSIS DATA/);
    assert.ok(!system.includes('"graph"'), 'chat context is compacted');
    return { text: 'Routes live in [server.js:L12](https://github.com/o/r/blob/x/server.js#L12).', backend: 'test', model: 'gemma-test' };
  };
  const a = await g.answerQuestion('where are routes?', { summary: { oneLiner: 'x' }, graph: { nodes: [1] }, routes: [] });
  assert.deepEqual(a.citations, [{ file: 'server.js', line: 12, githubUrl: 'https://github.com/o/r/blob/x/server.js#L12' }]);
  assert.equal(a.model, 'gemma-test');
  assert.equal(await g.generateReadme({ summary: {} }), '# Demo');
}));

test('limiter runs interactive work before queued background work', async () => {
  const limiter = new GemmaProvider.GemmaLimiter(1);
  const order = [];
  const slow = () => new Promise(r => setTimeout(r, 20));
  const a = limiter.run(async () => { await slow(); order.push('first'); }, 'high');
  const b = limiter.run(async () => { order.push('background'); }, 'low');
  const c = limiter.run(async () => { order.push('interactive'); }, 'high');
  await Promise.all([a, b, c]);
  assert.deepEqual(order, ['first', 'interactive', 'background']);
});

test('retry wait follows the provider hint, capped', () => {
  assert.equal(GemmaProvider.retryDelayMs({ errorDetails: [{ retryDelay: '12s' }] }, 1), 12000);
  assert.equal(GemmaProvider.retryDelayMs({ response: { headers: { 'retry-after': '5' } } }, 1), 5000);
  assert.equal(GemmaProvider.retryDelayMs({ errorDetails: [{ retryDelay: '90s' }] }, 1), 20000);
});

test('short AI texts come back as plain text even when the model adds markdown', () => withEnv({}, async () => {
  const g = new GemmaProvider();
  g._complete = async () => ({ text: '**Security score: 72/100.** There are *2* exposed secrets.\n- Rotate the keys in `.env` first.\n- Extra sentence that should be cut.', backend: 't', model: 'm' });
  const review = await g.generateSecurityReview({});
  assert.ok(!review.includes('*') && !review.includes('`') && !review.includes('\n'));
  assert.equal(review, 'Security score: 72/100. There are 2 exposed secrets. Rotate the keys in .env first.');
}));

test('planning text and prompt echo never reach the user', () => withEnv({ GEMINI_API_KEY: 'AIzaTest' }, async () => {
  const g = new GemmaProvider();
  const originalFetch = globalThis.fetch;
  const replies = [];
  let body;
  globalThis.fetch = async (u, opts) => {
    body = JSON.parse(opts.body);
    const parts = replies.shift();
    return new Response(JSON.stringify({ candidates: [{ content: { parts, role: 'model' }, finishReason: 'STOP' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    // 1. Gemini thought parts are dropped; the system prompt goes in systemInstruction.
    replies.push([{ text: 'Role: RepoPilot (experienced teammate). Goal: summarise.', thought: true }, { text: '<answer>RepoPilot maps GitHub repos for new developers. It uses React and Express.</answer>' }]);
    assert.equal(await g.generateExecutiveSummary({ summary: {} }), 'RepoPilot maps GitHub repos for new developers. It uses React and Express.');
    assert.match(body.systemInstruction.parts[0].text, /<answer>/);

    // 2. Planning dump before the real walkthrough is cut off at "## Summary".
    replies.push([{ text: 'RepoPilot (experienced teammate). New developer. Plain, specific, short.\nNo emojis. Markdown with exactly three sections: `## Summary`, `## Responsibilities`.\n*Content:* readme\n\n## Summary\nThe README explains setup.\n\n## Responsibilities\n1. **Setup**: lists commands.' }]);
    const detailed = await g.generateDetailedAnalysis('README.md', '1: # Demo');
    assert.ok(detailed.startsWith('## Summary\nThe README explains setup.'), detailed);

    // 3. An answer that is only the instructions echoed back is retried, then rejected.
    replies.push([{ text: 'Role: RepoPilot (experienced teammate). Goal: Summarize a repository. No filler words. Plain text only.' }]);
    replies.push([{ text: 'Role: RepoPilot (experienced teammate). Constraints: no emojis, under 50 words.' }]);
    await assert.rejects(() => g.generateExecutiveSummary({ summary: {} }), /planning notes/);
  } finally { globalThis.fetch = originalFetch; }
}));
