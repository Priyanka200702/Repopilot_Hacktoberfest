const test = require('node:test');
const assert = require('node:assert/strict');

for (const k of ['GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'OLLAMA_URL', 'GEMMA_STRICT']) delete process.env[k];
process.env.DOTENV_CONFIG_QUIET = 'true';
const app = require('../src/index.js');
const cache = require('../src/services/cache');
const ProviderManager = require('../src/services/ai/ProviderManager');
const { _internals } = require('../src/routes/voice');
const { TABS, buildPageFacts, factsNarration } = require('../src/services/voice/pageFacts');
for (const k of ['GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'OLLAMA_URL', 'GEMMA_STRICT']) delete process.env[k];

const analysis = {
  meta: { owner: 'acme', repo: 'shop', commitSha: 'c0ffee' },
  summary: { oneLiner: 'An Express API for a small shop.', projectType: 'API', architectureType: 'Layered', primaryTechStack: ['Node.js', 'Express', 'MongoDB'], complexity: 'Medium', onboardingTime: '20-30 minutes', analyzedFiles: 12, quickInsights: ['Docker is configured.'] },
  entryPoint: { file: 'src/index.js', line: 1 },
  setupSteps: [{ order: 1, title: 'Install dependencies', command: 'npm install' }, { order: 2, title: 'Start the server', command: 'npm run dev' }],
  envVars: [{ name: 'MONGO_URI', required: true }, { name: 'PORT', required: false, defaultValue: '3000' }],
  routes: [{ method: 'GET', path: '/products', auth: null }, { method: 'POST', path: '/orders', auth: 'jwt' }],
  apis: [{ name: 'Stripe', category: 'Payments' }],
  files: [
    { path: 'src/index.js', role: 'Entry Point', sha: 's1', description: 'Starts Express.' },
    { path: 'src/routes/orders.js', role: 'Express Route', sha: 's2', description: 'Order routes.' },
    { path: 'src/services/payment.js', role: 'Service', sha: 's3' },
    { path: 'test/payment.js', role: 'Unknown', sha: 's4' },
  ],
  graph: { nodes: [{ id: 'a', label: 'index.js' }, { id: 'b', label: 'orders.js' }], edges: [{ id: 'e', source: 'a', target: 'b' }] },
  onboardingScore: { score: 68, breakdown: [{ check: 'Has README', passed: true }, { check: 'Has tests', passed: false, detail: 'Add a test suite' }] },
  securityScore: 74,
  securityAlerts: [{ severity: 'HIGH', type: 'Exposed Secret' }],
  dependencySecurity: [{ package: 'lodash', severity: 'high' }],
  staticCodeAnalysis: [],
  gitHygiene: [],
  securityRecommendations: ['Rotate the exposed Stripe key.'],
};

let server; let base;
test.before(async () => {
  cache.set('acme/shop', analysis);
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/voice`;
});
test.after(() => server.close());
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json().then(j => ({ status: r.status, body: j })));

test('every page has a facts-only narration (no AI needed)', () => {
  for (const tab of TABS) {
    const s = factsNarration(tab, buildPageFacts(tab, analysis), 'full');
    assert.ok(s.length >= 1, tab);
    assert.ok(s.every(x => !/undefined|null|\[object/.test(x)), `${tab}: ${s.join(' ')}`);
  }
  const brief = factsNarration('Overview', buildPageFacts('Overview', analysis), 'brief');
  const full = factsNarration('Overview', buildPageFacts('Overview', analysis), 'full');
  assert.ok(brief.length < full.length);
});

test('narrate falls back to page facts when Gemma is not configured', async () => {
  const r = await post('/narrate', { owner: 'acme', repo: 'shop', tab: 'Security Audit' });
  assert.equal(r.status, 200);
  assert.equal(r.body.source, 'facts');
  assert.match(r.body.sentences.join(' '), /74 out of 100/);
});

test('narrate uses Gemma, cleans markdown out of the script, and caches it', async () => {
  let calls = 0;
  const original = ProviderManager.gemma.generateVoiceNarration;
  ProviderManager.gemma.generateVoiceNarration = async (payload) => {
    calls++;
    assert.equal(payload.tab, 'Setup Guide');
    assert.equal(payload.language, 'hi');
    return { text: '```json\n{"sentences": ["**Step one** is npm install.", "- Then run `npm run dev`."]}\n```', model: 'gemma-4-26b-a4b-it' };
  };
  try {
    const r1 = await post('/narrate', { owner: 'acme', repo: 'shop', tab: 'Setup Guide', language: 'hi' });
    assert.deepEqual(r1.body.sentences, ['Step one is npm install.', 'Then run npm run dev.']);
    assert.equal(r1.body.source, 'gemma');
    const r2 = await post('/narrate', { owner: 'acme', repo: 'shop', tab: 'Setup Guide', language: 'hi' });
    assert.equal(r2.body.cached, true);
    assert.equal(calls, 1);
  } finally { ProviderManager.gemma.generateVoiceNarration = original; }
});

test('narrate never speaks template sentences copied from the prompt', async () => {
  const original = ProviderManager.gemma.generateVoiceNarration;
  ProviderManager.gemma.generateVoiceNarration = async () => ({ text: '{"sentences": ["first sentence", "second sentence"]}', model: 'gemma-4-26b-a4b-it' });
  try {
    const r = await post('/narrate', { owner: 'acme', repo: 'shop', tab: 'Env Variables', length: 'brief' });
    assert.equal(r.body.source, 'facts');
    assert.ok(!/first sentence|second sentence/i.test(r.body.sentences.join(' ')));
    assert.match(r.body.sentences.join(' '), /MONGO_URI/);
  } finally { ProviderManager.gemma.generateVoiceNarration = original; }
});

test('narrate explains the Detailed Analysis page from its text', async () => {
  const r = await post('/narrate', { owner: 'acme', repo: 'shop', tab: 'Detailed Analysis', filePath: 'src/index.js', pageText: '## Summary\nStarts the **Express** server. It loads routes.\n## Responsibilities\n1. **Boot**: starts the app.', length: 'brief' });
  assert.equal(r.body.source, 'facts');
  assert.match(r.body.sentences[0], /Starts the Express server/);
});

test('narrate rejects unknown pages and unanalysed repos', async () => {
  assert.equal((await post('/narrate', { owner: 'acme', repo: 'shop', tab: 'Hacker Page' })).status, 400);
  assert.equal((await post('/narrate', { owner: 'acme', repo: 'nope', tab: 'Overview' })).status, 404);
});

test('command: Gemma actions are validated against real pages and files', async () => {
  const original = ProviderManager.gemma.generateVoiceReply;
  let seen;
  ProviderManager.gemma.generateVoiceReply = async (payload) => {
    seen = payload;
    return { text: JSON.stringify({
      say: '**Sure!** Opening the security audit and the story of orders.js.',
      actions: [
        { type: 'navigate', tab: 'Security Audit' },
        { type: 'openFileStory', path: 'orders.js' },
        { type: 'navigate', tab: 'Secret Admin Panel' },
        { type: 'deleteRepo' },
      ],
    }), model: 'gemma-4-26b-a4b-it' };
  };
  try {
    const r = await post('/command', { owner: 'acme', repo: 'shop', transcript: 'open security and tell me the story of orders', currentPage: 'Overview', history: [{ role: 'user', text: 'hi' }] });
    assert.equal(r.body.source, 'gemma');
    assert.equal(r.body.say, 'Opening the security audit and the story of orders.js.');
    assert.deepEqual(r.body.actions, [
      { type: 'navigate', tab: 'Security Audit' },
      { type: 'openFileStory', path: 'src/routes/orders.js', sha: 's2' },
    ]);
    assert.ok(seen.pages.includes('Time Machine'));
    assert.equal(seen.files[seen.files.length - 1], 'test/payment.js', 'meaningful files are listed first');
  } finally { ProviderManager.gemma.generateVoiceReply = original; }
});

test('command falls back politely when Gemma is unavailable', async () => {
  const r = await post('/command', { owner: 'acme', repo: 'shop', transcript: 'what database does this use?' });
  assert.equal(r.body.source, 'fallback');
  assert.deepEqual(r.body.actions, []);
  assert.match(r.body.say, /couldn't reach Gemma 4/);
  const hi = await post('/command', { owner: 'acme', repo: 'shop', transcript: 'kya hai', language: 'hi' });
  assert.match(hi.body.say, /Gemma 4/);
});

test('resolveFile matches exact paths, unique suffixes and unique basenames only', () => {
  const files = analysis.files;
  assert.equal(_internals.resolveFile('src/index.js', files).path, 'src/index.js');
  assert.equal(_internals.resolveFile('routes/orders.js', files).path, 'src/routes/orders.js');
  assert.equal(_internals.resolveFile('payment.js', files), null, 'ambiguous basename is rejected');
  assert.equal(_internals.resolveFile('../etc/passwd', files), null);
});
