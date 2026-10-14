const express = require('express');
const router = express.Router();
const ProviderManager = require('../services/ai/ProviderManager');

/**
 * POST /api/ai/test-key { provider, key }
 * Verifies that a user key can reach Gemma 4. Google AI Studio ("gemini") and
 * OpenRouter keys are supported. Calls Gemma directly, with no fallback.
 */
router.post('/test-key', async (req, res) => {
  const { provider, key } = req.body || {};

  if (!provider || !key) {
    return res.status(400).json({ error: 'Provider and key are required' });
  }
  if (!['gemini', 'openrouter'].includes(String(provider).toLowerCase())) {
    return res.status(400).json({ valid: false, error: 'RepoPilot runs on Gemma 4. Use a Google AI Studio (Gemini API) key or an OpenRouter key.' });
  }

  try {
    await ProviderManager.gemma.generateFileDescription('test.txt', 'const a = 1;', { key, provider });
    return res.json({ valid: true, model: ProviderManager.gemma.modelFor(String(provider).toLowerCase(), 'fast') });
  } catch (error) {
    const status = error.status || error.response?.status;
    const reason = status === 401 || status === 403 ? 'The key was rejected.'
      : status === 404 ? 'This key cannot access the Gemma 4 model.'
      : status === 429 ? 'The key is rate-limited right now; try again in a minute.'
      : error.message;
    return res.status(401).json({ valid: false, error: `Gemma 4 test failed: ${reason}` });
  }
});

/** GET /api/ai/status: which Gemma 4 backend and model the server will use (no AI call). */
router.get('/status', (req, res) => {
  res.json(ProviderManager.describe({ key: req.headers['x-ai-key'], provider: req.headers['x-ai-provider'] }));
});

module.exports = router;
