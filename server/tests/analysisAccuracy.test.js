const test = require('node:test');
const assert = require('node:assert/strict');
const { isTestOrFixturePath } = require('../src/utils/filterFiles');
const { detectEntryPoint } = require('../src/parser/detectEntryPoint');
const { analyzeRepo } = require('../src/services/parser');
const { scanStaticCode } = require('../src/parser/security/staticAnalysisScanner');
const { scanSecrets } = require('../src/parser/security/secretScanner');
const { extractEnvVars } = require('../src/parser/extractEnvVars');
const { extractJson } = require('../src/services/history/storySchema');

test('test, fixture and mock files are recognised', () => {
  for (const p of ['server/test_integration.js', 'server/tests/a.test.js', 'src/__tests__/x.tsx', 'src/app.spec.ts', 'server/data/mockAnalysis.json', 'cypress/e2e/login.cy.ts', 'pkg/handler_test.go']) {
    assert.equal(isTestOrFixturePath(p), true, p);
  }
  for (const p of ['server/src/index.js', 'src/services/ai/providers/MockProvider.js', 'src/latest.js', 'contest/app.js']) {
    assert.equal(isTestOrFixturePath(p), false, p);
  }
});

test('monorepo entry point comes from the backend package.json, not the first .listen()', () => {
  const files = [
    { path: 'client/package.json', content: JSON.stringify({ scripts: { dev: 'vite' } }) },
    { path: 'client/src/lib/voice.ts', content: 'recognizer.listen()' },
    { path: 'server/package.json', content: JSON.stringify({ scripts: { dev: 'node --watch src/index.js' } }) },
    { path: 'server/src/index.js', content: 'app.listen(3000)' },
  ];
  const ep = detectEntryPoint(files, null);
  assert.equal(ep.file, 'server/src/index.js');
  assert.equal(ep.confidence, 'high');
});

test('analysis ignores test files for entry point, stack, routes and env vars', async () => {
  const files = [
    { path: 'server/package.json', content: JSON.stringify({ scripts: { start: 'node src/index.js' } }) },
    { path: 'server/src/index.js', content: "const express = require('express');\nconst app = express();\napp.use('/api/users', require('./users'));\n// app.get('/example', handler)\napp.listen(process.env.PORT || 3000);" },
    { path: 'server/src/users.js', content: "const router = require('express').Router();\nrouter.get('/', list);\nrouter.post('/', create);\nmodule.exports = router;" },
    { path: 'server/test_integration.js', content: "const mongoose = require('mongoose');\nprocess.env.TEST_DB;\nrequire('http').createServer().listen(1);\napp.get('/fake', x);" },
    { path: 'server/tests/routes.test.js', content: "router.post('/only-in-tests', x); process.env.TEST_ONLY;" },
  ].map(f => ({ ...f, size: 10, sha: 'x' }));
  const { analysis } = await analyzeRepo('o', 'r', files, { commitSha: 'abc' }, () => {});
  assert.equal(analysis.entryPoint.file, 'server/src/index.js');
  assert.ok(!analysis.summary.primaryTechStack.some(t => /mongoose/i.test(t)), analysis.summary.primaryTechStack.join(','));
  const paths = analysis.routes.map(r => `${r.method} ${r.path}`);
  assert.ok(!paths.some(p => /fake|only-in-tests|example/.test(p)), paths.join(', '));
  assert.ok(!analysis.routes.some(r => String(r.method).toUpperCase() === 'USE'), 'router mounts are not endpoints');
  const env = analysis.envVars.map(e => e.name);
  assert.deepEqual(env, ['PORT']);
  assert.equal(new Set(analysis.routes.map(r => `${r.method}|${r.path}|${r.file}`)).size, analysis.routes.length, 'no duplicate routes');
});

test('static analysis: regex.exec and rule tables are not shell commands', () => {
  const src = [
    "const { DANGER } = [{ regex: /\\beval\\s*\\(/, type: 'eval' }];",
    'while ((m = re.exec(text)) !== null) {}',
    "const x = Math.random() * 10; // animation",
    "const q = 'SELECT * FROM users WHERE id = ' + id;",
    'exec(cmd);',
  ].join('\n');
  const types = scanStaticCode([{ path: 'src/a.js', content: src }]).map(a => `${a.line}:${a.type}`);
  assert.deepEqual(types, ['4:SQL Concatenation', '5:Command Injection (exec)']);
});

test('secret scan skips docs, tests and placeholders but catches real keys', () => {
  const real = 'const k = "AIzaSyA1234567890abcdefghijklmnopqrstuv";';
  assert.equal(scanSecrets([{ path: 'README.md', content: real }]).length, 0);
  assert.equal(scanSecrets([{ path: 'server/tests/a.test.js', content: real }]).length, 0);
  assert.equal(scanSecrets([{ path: 'src/db.js', content: 'mongoose.connect("mongodb://localhost:27017/app")' }]).length, 0);
  assert.equal(scanSecrets([{ path: 'src/sha.js', content: 'const sha = "3f786850e387550fdab836ed7e6dc881de23001b";' }]).length, 0);
  assert.ok(scanSecrets([{ path: 'src/config.js', content: real }]).length >= 1);
  assert.ok(scanSecrets([{ path: 'src/db.js', content: 'const uri = "mongodb+srv://admin:hunter2@cluster0.x.net/db";' }]).length === 1);
});

test('env vars in comments are not counted', () => {
  const names = extractEnvVars(null, "// process.env.VAR_NAME\n * process.env.DOC\nconst a = process.env.REAL || 'x';", 'a.js').map(e => e.name);
  assert.deepEqual(names, ['REAL']);
});

test('extractJson prefers the real answer over an example object in planning notes', () => {
  const r = extractJson('Plan: return {"sentences": ["first sentence"]}.\nFinal:\n{"sentences": ["Uses Express {v5}.", "Has 36 routes."]}');
  assert.deepEqual(r.value, { sentences: ['Uses Express {v5}.', 'Has 36 routes.'] });
});
