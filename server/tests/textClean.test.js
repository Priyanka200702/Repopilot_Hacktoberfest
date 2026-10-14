const test = require('node:test');
const assert = require('node:assert/strict');
const { toPlainText } = require('../src/services/ai/textClean');

test('removes markdown stars, headings, bullets and emojis', () => {
  const raw = '## Executive Summary\n**RepoPilot** is a *developer onboarding* tool 🚀.\n- It uses `Express` and React.\n- Third point.';
  assert.equal(toPlainText(raw, { maxSentences: 3, maxWords: 50 }), 'RepoPilot is a developer onboarding tool. It uses Express and React. Third point.');
});

test('strips chatty preambles and labels but keeps real words', () => {
  assert.equal(toPlainText('Sure! Here is the summary: The app runs on Express.'), 'The app runs on Express.');
  assert.equal(toPlainText('Executive summary: A CLI for invoices.'), 'A CLI for invoices.');
  assert.equal(toPlainText('Okta handles login for the dashboard.'), 'Okta handles login for the dashboard.');
});

test('enforces sentence and word budgets at sentence boundaries', () => {
  const long = 'One two three four five. Six seven eight nine ten. Eleven twelve thirteen.';
  assert.equal(toPlainText(long, { maxSentences: 2, maxWords: 50 }), 'One two three four five. Six seven eight nine ten.');
  assert.equal(toPlainText(long, { maxSentences: 3, maxWords: 7 }), 'One two three four five.');
  assert.match(toPlainText('a b c d e f g h i j', { maxWords: 4 }), /^A b c d…$/);
});

test('collapses lists and newlines into one paragraph', () => {
  const t = toPlainText('Score is 72/100.\n\n1. Two exposed secrets.\n2. Rotate them first.', { maxSentences: 3 });
  assert.equal(t, 'Score is 72/100. Two exposed secrets. Rotate them first.');
});
