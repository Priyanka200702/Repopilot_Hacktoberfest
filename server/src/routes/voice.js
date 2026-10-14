const express = require('express');
const crypto = require('crypto');
const { LRUCache } = require('lru-cache');

const cache = require('../services/cache');
const ProviderManager = require('../services/ai/ProviderManager');
const { extractJson } = require('../services/history/storySchema');
const { evolutionCache } = require('../services/history/historyCache');
const { toPlainText } = require('../services/ai/textClean');
const { looksLikePromptEcho } = require('../services/ai/answerExtract');

// Template text a model can copy from instructions instead of writing a real line.
const PLACEHOLDER = /^(?:the )?(?:first|second|third|fourth|next|another|last)\s+sentence\.?$|^sentence\s*\d+\.?$|^\.{3}$|^string$/i;
const { TABS, TOUR, DETAILED, buildPageFacts, factsNarration } = require('../services/voice/pageFacts');

const router = express.Router();

// Spoken scripts are cached per repo commit + page + length + language, so replays
// and repeated tours are instant and do not spend Gemma quota.
const narrationCache = new LRUCache({ max: 300, ttl: 1000 * 60 * 60 });

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const LANGS = new Set(['en', 'hi']);
const ACTIONS = new Set(['navigate', 'explainPage', 'startTour', 'openFileStory', 'openDetailedAnalysis', 'openChat']);

function aiOverride(req) {
  return { key: req.headers['x-ai-key'] || undefined, provider: req.headers['x-ai-provider'] || undefined };
}

function findAnalysis(owner, repo, bodyAnalysis) {
  if (bodyAnalysis && typeof bodyAnalysis === 'object' && (bodyAnalysis.meta || bodyAnalysis.summary)) {
    cache.set(`${owner}/${repo}`, bodyAnalysis);
    return bodyAnalysis;
  }
  const exact = cache.get(`${owner}/${repo}`);
  if (exact) return exact;
  const want = `${owner}/${repo}`.toLowerCase();
  for (const k of cache.keys()) {
    if (String(k).toLowerCase() === want) return cache.get(k);
  }
  return null;
}

function findEvolution(owner, repo) {
  const want = `${owner}/${repo}`.toLowerCase();
  for (const v of evolutionCache.values()) {
    const r = v?.evolution?.repository;
    if (r && `${r.owner}/${r.repo}`.toLowerCase() === want) return v.evolution;
  }
  return null;
}

/** Resolve a path Gemma mentioned to a real analysed file (exact, then unique suffix/basename match). */
function resolveFile(candidate, files) {
  if (!candidate || typeof candidate !== 'string') return null;
  const c = candidate.trim().replace(/^\.?\//, '');
  const exact = files.find(f => f.path === c);
  if (exact) return exact;
  const lower = c.toLowerCase();
  const bySuffix = files.filter(f => f.path.toLowerCase().endsWith(`/${lower}`) || f.path.toLowerCase() === lower);
  if (bySuffix.length === 1) return bySuffix[0];
  const baseName = lower.split('/').pop();
  const byBase = files.filter(f => f.path.toLowerCase().split('/').pop() === baseName);
  return byBase.length === 1 ? byBase[0] : null;
}

function cleanSentence(text) {
  return toPlainText(text, { maxSentences: 2, maxWords: 45 });
}

/**
 * POST /api/voice/narrate
 * body: { owner, repo, tab, length?: 'full'|'brief', language?: 'en'|'hi', pageText?, filePath? }
 * Returns { sentences: string[], source: 'gemma'|'facts', model? }
 */
router.post('/narrate', async (req, res) => {
  const { owner, repo, tab, pageText, filePath } = req.body || {};
  const length = req.body?.length === 'brief' ? 'brief' : 'full';
  const language = LANGS.has(req.body?.language) ? req.body.language : 'en';
  if (!NAME.test(owner || '') || !NAME.test(repo || '')) return res.status(400).json({ error: 'Valid owner and repo are required.' });
  if (![...TABS, DETAILED].includes(tab)) return res.status(400).json({ error: 'Unknown page.' });

  const analysis = findAnalysis(owner, repo, req.body?.analysis);
  if (!analysis && tab !== DETAILED) return res.status(404).json({ error: 'Analyze the repository first.' });

  const facts = buildPageFacts(tab, analysis, { pageText, filePath, evolution: findEvolution(owner, repo) });
  const key = crypto.createHash('sha256')
    .update(JSON.stringify({ v: 2, r: `${owner}/${repo}`.toLowerCase(), sha: analysis?.meta?.commitSha, tab, length, language, facts }))
    .digest('hex');
  if (narrationCache.has(key)) return res.json({ ...narrationCache.get(key), cached: true });

  const fallback = () => ({ sentences: factsNarration(tab, facts, length), source: 'facts' });

  try {
    const result = await ProviderManager.execute('generateVoiceNarration', {
      tab, length, language, facts, repository: `${owner}/${repo}`,
    }, aiOverride(req));

    if (!result.success) {
      return res.json({ ...fallback(), notice: result.message });
    }
    const parsed = extractJson(result.data.text);
    const raw = parsed.ok && Array.isArray(parsed.value?.sentences) ? parsed.value.sentences : [];
    const sentences = raw
      .map(x => (typeof x === 'string' ? x : (x && typeof x.text === 'string' ? x.text : '')))
      .map(cleanSentence)
      .filter(x => x && !PLACEHOLDER.test(x.trim()))
      .slice(0, length === 'brief' ? 4 : 10);
    if (sentences.length < 2 || looksLikePromptEcho(sentences.join(' '))) {
      return res.json({ ...fallback(), notice: 'Gemma returned an unusable script; using page facts.' });
    }
    const payload = { sentences, source: 'gemma', model: result.data.model };
    narrationCache.set(key, payload);
    return res.json(payload);
  } catch (err) {
    console.error('[Voice] narrate failed:', err.message);
    return res.json({ ...fallback(), notice: 'Voice guide error; using page facts.' });
  }
});

/**
 * POST /api/voice/command
 * body: { owner, repo, transcript, currentPage, language?, history?: [{role, text}] }
 * Returns { say, actions: [...], source: 'gemma'|'fallback', model? }
 */
router.post('/command', async (req, res) => {
  const { owner, repo, transcript, currentPage } = req.body || {};
  const language = LANGS.has(req.body?.language) ? req.body.language : 'en';
  if (!NAME.test(owner || '') || !NAME.test(repo || '')) return res.status(400).json({ error: 'Valid owner and repo are required.' });
  if (typeof transcript !== 'string' || !transcript.trim()) return res.status(400).json({ error: 'Say something first.' });

  const analysis = findAnalysis(owner, repo, req.body?.analysis);
  if (!analysis) return res.status(404).json({ error: 'Analyze the repository first.' });

  const files = (analysis.files || [])
    .slice()
    .sort((a, b) => (/unknown|other/i.test(a.role || '') ? 1 : 0) - (/unknown|other/i.test(b.role || '') ? 1 : 0))
    .slice(0, 150);
  const history = (Array.isArray(req.body?.history) ? req.body.history : [])
    .slice(-4)
    .map(h => ({ role: h?.role === 'assistant' ? 'assistant' : 'user', text: String(h?.text || '').slice(0, 300) }));

  try {
    const result = await ProviderManager.execute('generateVoiceReply', {
      transcript: transcript.slice(0, 500),
      currentPage: [...TABS, DETAILED].includes(currentPage) ? currentPage : 'Overview',
      pages: TABS,
      files: files.map(f => f.path),
      history,
      analysis,
      language,
    }, aiOverride(req));

    if (!result.success) {
      return res.json({
        say: language === 'hi'
          ? 'अभी Gemma 4 से जुड़ नहीं पाया। मैं फिर भी पेज खोल सकता हूँ, पेज समझा सकता हूँ, या टूर शुरू कर सकता हूँ।'
          : "I couldn't reach Gemma 4 just now. I can still open pages, explain this page, or start a tour.",
        actions: [],
        source: 'fallback',
        notice: result.message,
      });
    }

    const parsed = extractJson(result.data.text);
    const value = parsed.ok ? parsed.value : {};
    const actions = [];
    for (const a of Array.isArray(value.actions) ? value.actions : []) {
      if (!a || !ACTIONS.has(a.type) || actions.length >= 2) continue;
      if (a.type === 'navigate' || a.type === 'explainPage') {
        if (TABS.includes(a.tab)) actions.push({ type: a.type, tab: a.tab });
      } else if (a.type === 'openFileStory' || a.type === 'openDetailedAnalysis') {
        const file = resolveFile(a.path, files);
        if (file) actions.push({ type: a.type, path: file.path, sha: file.sha });
      } else if (a.type === 'openChat') {
        const q = String(a.question || transcript).slice(0, 300);
        actions.push({ type: 'openChat', question: q });
      } else if (a.type === 'startTour') {
        actions.push({ type: 'startTour' });
      }
    }
    let say = toPlainText(typeof value.say === 'string' ? value.say : '', { maxSentences: 3, maxWords: 70 });
    if (PLACEHOLDER.test(say.trim()) || /^\.*$/.test(say.trim()) || looksLikePromptEcho(say)) say = '';
    if (!say) say = actions.length ? 'Done.' : "Sorry, I didn't catch that. Try asking me to explain this page.";
    return res.json({ say, actions, source: 'gemma', model: result.data.model });
  } catch (err) {
    console.error('[Voice] command failed:', err.message);
    return res.status(500).json({ error: 'Voice command failed.' });
  }
});

/** GET /api/voice/tour: the page order used by the guided tour. */
router.get('/tour', (req, res) => res.json({ steps: TOUR }));

module.exports = router;
module.exports._internals = { resolveFile, narrationCache };
