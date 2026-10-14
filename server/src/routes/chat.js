const express = require('express');
const router = express.Router();
const cache = require('../services/cache');
const ProviderManager = require('../services/ai/ProviderManager');

function generateFallbackAnswer(question, analysisJson) {
  const q = question.toLowerCase();
  
  if (q.includes('work') || q.includes('what is this')) {
    return `**Project Summary**: ${analysisJson.summary.oneLiner}\n\n**Entry Point**: The application starts at [${analysisJson.entryPoint.file}:L${analysisJson.entryPoint.line}](${analysisJson.entryPoint.githubUrl}). This was detected because: ${analysisJson.entryPoint.reason}.`;
  }
  
  if (q.includes('run') || q.includes('setup') || q.includes('start')) {
    const steps = analysisJson.setupSteps.map(s => `${s.order}. **${s.title}**\n   \`${s.command}\`\n   _${s.description}_`).join('\n\n');
    return `Here is how to set up the project:\n\n${steps}`;
  }
  
  if (q.includes('env') || q.includes('environment')) {
    if (!analysisJson.envVars.length) return "No environment variables were detected in this repository.";
    const vars = analysisJson.envVars.map(e => `- \`${e.name}\`: ${e.required ? 'Required' : 'Optional'}${e.defaultValue ? ` (Default: ${e.defaultValue})` : ''} [Source](${e.githubUrl})`).join('\n');
    return `Here are the detected environment variables:\n\n${vars}`;
  }
  
  if (q.includes('route') || q.includes('api') || q.includes('endpoint')) {
    if (!analysisJson.routes.length) return "No API routes were detected in this repository.";
    const rts = analysisJson.routes.slice(0, 10).map(r => `- **${r.method}** \`${r.path}\` in [${r.file}:L${r.line}](${r.githubUrl})`).join('\n');
    let extra = analysisJson.routes.length > 10 ? `\n...and ${analysisJson.routes.length - 10} more.` : '';
    return `Here are some of the API routes:\n\n${rts}${extra}`;
  }

  return "I'm in basic mode (Gemma 4 is not available right now). I can answer questions about this repo's routes, env vars, APIs, and setup. Try asking about one of those!";
}

router.post('/', async (req, res) => {
  try {
    const { question, owner, repo } = req.body;
    const apiKey = req.headers['x-ai-key'];
    const aiProvider = req.headers['x-ai-provider'];
    
    if (!question || !owner || !repo) {
      return res.status(400).json({ error: 'Missing question, owner, or repo' });
    }

    // 1. Get cached analysis for this repo
    const cacheKey = `${owner}/${repo}`;
    const analysis = cache.get(cacheKey);
    
    if (!analysis) {
      return res.status(404).json({ error: 'Repo not analyzed yet. Please analyze first.' });
    }
    
    // 2. Ask Gemma 4 (the user's own key or the server's Gemma configuration), else basic mode
    const override = { key: apiKey, provider: aiProvider };
    if (ProviderManager.isGemmaConfigured(override)) {
      const result = await ProviderManager.execute('answerQuestion', question, analysis, override);
      if (!result.success) {
        return res.status(result.status || 503).json({ error: result.message, code: result.code });
      }
      if (result.provider === 'gemma') {
        return res.json({ ...result.data, mode: 'advanced', poweredBy: 'Gemma 4' });
      }
      // Gemma failed and the rule-based fallback answered: use the richer basic answer instead.
      return res.json({ answer: generateFallbackAnswer(question, analysis), citations: [], mode: 'basic', notice: result.fallbackReason });
    } else {
      const result = generateFallbackAnswer(question, analysis);
      return res.json({ answer: result, citations: [], mode: 'basic' });
    }
  } catch (err) {
    console.error('Chat endpoint error:', err.message);
    res.status(500).json({ error: 'Failed to process chat request' });
  }
});

module.exports = router;
