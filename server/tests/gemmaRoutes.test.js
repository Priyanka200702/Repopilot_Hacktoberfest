/**
 * HTTP-level checks of the routes that use AI: chat, README, key test, status,
 * and the background Gemma file descriptions during analysis.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

for (const k of ['GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'OLLAMA_URL', 'GEMMA_STRICT']) delete process.env[k];
process.env.DOTENV_CONFIG_QUIET = 'true';

const app = require('../src/index.js');
const cache = require('../src/services/cache');
const ProviderManager = require('../src/services/ai/ProviderManager');
const { analyzeRepo } = require('../src/services/parser');

// dotenv may load a local server/.env; tests must not use real keys.
for (const k of ['GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'OLLAMA_URL', 'GEMMA_STRICT']) delete process.env[k];

let server;
let base;
test.before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  cache.set('o/r', {
    meta: { owner: 'o', repo: 'r', commitSha: 'abc' },
    summary: { oneLiner: 'Demo app', projectType: 'API', primaryTechStack: ['Node.js'] },
    entryPoint: { file: 'index.js', line: 1, reason: 'main', githubUrl: 'https://github.com/o/r/blob/abc/index.js' },
    setupSteps: [{ order: 1, title: 'Install', command: 'npm install', description: 'deps' }],
    envVars: [], routes: [], apis: [], files: [],
  });
});
test.after(() => server.close());
test.afterEach(() => { ProviderManager.cache.clear(); });

const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('status endpoint reports Gemma 4 and configuration', async () => {
  const s = await (await fetch(base + '/ai/status')).json();
  assert.equal(s.provider, 'Gemma 4');
  assert.equal(s.configured, false);
  const s2 = await (await fetch(base + '/ai/status', { headers: { 'X-AI-Key': 'AIzaUser', 'X-AI-Provider': 'gemini' } })).json();
  assert.deepEqual([s2.configured, s2.backend, s2.model], [true, 'gemini', 'gemma-4-31b-it']);
});

test('chat without Gemma uses basic mode; with Gemma it is advanced and labelled', async () => {
  const basic = await (await post('/chat', { owner: 'o', repo: 'r', question: 'how do I run it?' })).json();
  assert.equal(basic.mode, 'basic');
  assert.match(basic.answer, /npm install/);

  const original = ProviderManager.gemma.answerQuestion;
  ProviderManager.gemma.answerQuestion = async () => ({ answer: 'Gemma says hi', citations: [], model: 'gemma-4-31b-it' });
  try {
    const adv = await (await post('/chat', { owner: 'o', repo: 'r', question: 'what is this?' }, { 'X-AI-Key': 'AIzaUser', 'X-AI-Provider': 'gemini' })).json();
    assert.deepEqual([adv.mode, adv.poweredBy, adv.answer, adv.model], ['advanced', 'Gemma 4', 'Gemma says hi', 'gemma-4-31b-it']);
  } finally { ProviderManager.gemma.answerQuestion = original; }
});

test('README route no longer crashes on the {key, provider} argument and uses Gemma', async () => {
  const original = ProviderManager.gemma.generateReadme;
  let seen;
  ProviderManager.gemma.generateReadme = async (a, override) => { seen = override; return '# Written by Gemma'; };
  try {
    const r = await (await post('/readme', { owner: 'o', repo: 'r' }, { 'X-AI-Key': 'sk-or-v1-user', 'X-AI-Provider': 'openrouter' })).json();
    assert.deepEqual([r.mode, r.readme], ['completed', '# Written by Gemma']);
    assert.deepEqual(seen, { key: 'sk-or-v1-user', provider: 'openrouter' });
  } finally { ProviderManager.gemma.generateReadme = original; }
  const fallback = await (await post('/readme', { owner: 'o', repo: 'r' })).json();
  assert.equal(fallback.mode, 'basic', 'without Gemma the structured README is used');
});

test('key test only accepts keys that can run Gemma', async () => {
  const bad = await post('/ai/test-key', { provider: 'anthropic', key: 'sk-ant-x' });
  assert.equal(bad.status, 400);
  const original = ProviderManager.gemma.generateFileDescription;
  ProviderManager.gemma.generateFileDescription = async (f, c, override) => { assert.equal(override.key, 'AIzaGood'); return 'ok'; };
  try {
    const good = await (await post('/ai/test-key', { provider: 'gemini', key: 'AIzaGood' })).json();
    assert.deepEqual([good.valid, good.model], [true, 'gemma-4-26b-a4b-it']);
  } finally { ProviderManager.gemma.generateFileDescription = original; }
  ProviderManager.gemma.generateFileDescription = async () => { const e = new Error('denied'); e.status = 401; throw e; };
  try {
    const rejected = await post('/ai/test-key', { provider: 'openrouter', key: 'sk-or-v1-bad' });
    assert.equal(rejected.status, 401);
  } finally { ProviderManager.gemma.generateFileDescription = original; }
});

test('analysis streams Gemma file descriptions for key files (previously never ran)', async () => {
  const original = ProviderManager.gemma.generateFileDescription;
  const described = [];
  ProviderManager.gemma.generateFileDescription = async (path) => { described.push(path); return `Gemma description of ${path}`; };
  const files = [
    { path: 'package.json', content: '{"name":"x","dependencies":{"express":"^5"}}', size: 50, sha: '1' },
    { path: 'src/routes/users.js', content: "const router = require('express').Router();\nrouter.get('/users', (req, res) => res.json([]));\nmodule.exports = router;\n", size: 100, sha: '2' },
    { path: 'src/services/userService.js', content: 'function getUsers() { return []; }\nmodule.exports = { getUsers };\n', size: 60, sha: '3' },
  ];
  const updates = [];
  try {
    const { aiPromise } = await analyzeRepo('o', 'x', files, { owner: 'o', repo: 'x', defaultBranch: 'main', commitSha: 'abc' }, u => updates.push(u));
    await aiPromise;
  } finally { ProviderManager.gemma.generateFileDescription = original; }
  const fileUpdates = updates.filter(u => u.type === 'file_update');
  assert.ok(described.length >= 1, `Gemma was asked to describe files (got ${described.length})`);
  assert.ok(fileUpdates.some(u => u.description.startsWith('Gemma description of')));
});
