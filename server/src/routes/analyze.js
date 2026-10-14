const express = require('express');
const router = express.Router();
const mockAnalysis = require('../../data/mockAnalysis.json');

const { fetchAllFiles } = require('../services/github');
const { analyzeRepo } = require('../services/parser');
const cache = require('../services/cache');

router.get('/:owner/:repo', async (req, res) => {
  const { owner, repo } = req.params;
  const force = req.query.force === 'true';
  const cacheKey = `${owner}/${repo}`;
  
  // Return mock data for the specific realworld example if requested (for frontend dev)
  if (owner === 'gothinkster' && repo === 'node-express-realworld-example-app' && !force) {
    cache.set(cacheKey, mockAnalysis);
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.write(JSON.stringify({ type: 'complete', data: mockAnalysis }) + '\n');
    return res.end();
  }

  try {
    if (!force && cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.write(JSON.stringify({ type: 'complete', data: cached }) + '\n');
      return res.end();
    }

    // 1. Fetch files from GitHub
    const { meta, files } = await fetchAllFiles(owner, repo);
    
    // Update cacheKey to include commitSha
    const shaCacheKey = `${owner}/${repo}@${meta.commitSha}`;
    if (!force && cache.has(shaCacheKey)) {
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.write(JSON.stringify({ type: 'complete', data: cache.get(shaCacheKey) }) + '\n');
      return res.end();
    }

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');

    // 2. Parse and analyze (we will stream updates inside analyzeRepo)
    const { analysis, aiPromise } = await analyzeRepo(owner, repo, files, meta, (update) => {
      res.write(JSON.stringify(update) + '\n');
    });
    
    // 3. Cache immediately so subsequent requests are fast
    cache.set(shaCacheKey, analysis);
    // Also update the short key to point to the latest
    cache.set(cacheKey, analysis);
    
    // 4. Wait for background AI stream to finish before closing the response stream
    await aiPromise;
    res.end();
    
  } catch (error) {
    console.error(`Analyze error for ${owner}/${repo}:`, error.message);
    
    // If headers are already sent (streaming started), just end the response
    if (res.headersSent) {
      return res.end();
    }
    
    const status = error.status || error.response?.status;
    const message = error.message || '';
    
    // If it's a 404 from GitHub
    if (status === 404) {
      return res.status(404).json({ error: 'Repository not found or is private' });
    }
    
    // Rate limit (includes Octokit's internal throttling)
    if (status === 403 || status === 429 || message.includes('quota exhausted') || message.includes('rate limit')) {
      return res.status(429).json({ error: 'GitHub API rate limit exceeded. Please wait a few minutes and try again.' });
    }
    
    // Bad credentials
    if (status === 401 || message.includes('Bad credentials')) {
      return res.status(401).json({ error: 'GitHub Token is invalid (Bad Credentials). Please update the GITHUB_TOKEN in server/.env with a valid token, or remove it to use unauthenticated access.' });
    }
    
    return res.status(500).json({ error: 'Failed to analyze repository' });
  }
});

// Asynchronous background AI Executive Summary generation endpoint
router.get('/:owner/:repo/summary', async (req, res) => {
  const { owner, repo } = req.params;
  const cacheKey = `${owner}/${repo}`;

  try {
    if (!cache.has(cacheKey)) {
      return res.status(400).json({ error: 'Repository analysis must be performed first' });
    }

    const analysis = cache.get(cacheKey);
    const shaCacheKey = `${owner}/${repo}@${analysis.meta.commitSha}`;

    // If already has executive summary in memory/cache
    if (analysis.summary.aiExecutiveSummary) {
      return res.json({ aiExecutiveSummary: analysis.summary.aiExecutiveSummary });
    }

    // Call AI provider to generate summary
    const ProviderManager = require('../services/ai/ProviderManager');
    const apiKey = req.headers['x-ai-key'];
    const aiProvider = req.headers['x-ai-provider'];
    const aiResponse = await ProviderManager.execute('generateExecutiveSummary', analysis, { key: apiKey, provider: aiProvider });
    
    // Only a real Gemma answer is stored; a fallback is not shown or saved, so the next visit retries Gemma.
    if (aiResponse.success && aiResponse.provider === 'gemma' && aiResponse.data) {
      analysis.summary.aiExecutiveSummary = aiResponse.data;
      
      // Update caches
      cache.set(shaCacheKey, analysis);
      cache.set(cacheKey, analysis);
      
      return res.json({ aiExecutiveSummary: aiResponse.data });
    } else {
      // Return null with error, client will handle gracefully
      return res.json({ aiExecutiveSummary: null, error: aiResponse.fallbackReason || aiResponse.message || 'Gemma 4 summary is unavailable right now' });
    }
  } catch (error) {
    console.error(`AI Summary error for ${owner}/${repo}:`, error.message);
    return res.status(500).json({ error: 'Failed to generate AI executive summary' });
  }
});

// Asynchronous background AI Security Review generation endpoint
router.get('/:owner/:repo/security-review', async (req, res) => {
  const { owner, repo } = req.params;
  const cacheKey = `${owner}/${repo}`;

  try {
    if (!cache.has(cacheKey)) {
      return res.status(400).json({ error: 'Repository analysis must be performed first' });
    }

    const analysis = cache.get(cacheKey);
    const shaCacheKey = `${owner}/${repo}@${analysis.meta.commitSha}`;

    // If already has security review in memory/cache
    if (analysis.aiSecurityReview) {
      return res.json({ aiSecurityReview: analysis.aiSecurityReview });
    }

    // Call AI provider to generate summary
    const ProviderManager = require('../services/ai/ProviderManager');
    const apiKey = req.headers['x-ai-key'];
    const aiProvider = req.headers['x-ai-provider'];
    const aiResponse = await ProviderManager.execute('generateSecurityReview', analysis, { key: apiKey, provider: aiProvider });
    
    if (aiResponse.success && aiResponse.provider === 'gemma' && aiResponse.data) {
      analysis.aiSecurityReview = aiResponse.data;
      
      // Update caches
      cache.set(shaCacheKey, analysis);
      cache.set(cacheKey, analysis);
      
      return res.json({ aiSecurityReview: aiResponse.data });
    } else {
      // Return null with error, client will handle gracefully
      return res.json({ aiSecurityReview: null, error: aiResponse.fallbackReason || aiResponse.message || 'Gemma 4 security review is unavailable right now' });
    }
  } catch (error) {
    console.error(`AI Security Review error for ${owner}/${repo}:`, error.message);
    return res.status(500).json({ error: 'Failed to generate AI security review' });
  }
});

// Asynchronous background AI API Explanation generation endpoint
router.post('/:owner/:repo/api-explanation', async (req, res) => {
  const { owner, repo } = req.params;
  const { routePath, method } = req.body;
  const cacheKey = `${owner}/${repo}`;

  if (!routePath || !method) {
    return res.status(400).json({ error: 'routePath and method are required' });
  }

  try {
    if (!cache.has(cacheKey)) {
      return res.status(400).json({ error: 'Repository analysis must be performed first' });
    }

    const analysis = cache.get(cacheKey);
    const shaCacheKey = `${owner}/${repo}@${analysis.meta.commitSha}`;

    // Find the specific route in analysis
    const route = analysis.routes.find(r => r.path === routePath && r.method === method);
    if (!route) {
        return res.status(404).json({ error: 'Route not found in analysis' });
    }

    // If already has explanation in memory/cache
    if (route.aiExplanation) {
      return res.json({ aiExplanation: route.aiExplanation });
    }

    // Call AI provider to generate summary
    const ProviderManager = require('../services/ai/ProviderManager');
    const apiKey = req.headers['x-ai-key'];
    const aiProvider = req.headers['x-ai-provider'];
    const aiResponse = await ProviderManager.execute('generateApiExplanation', route, { key: apiKey, provider: aiProvider });
    
    if (aiResponse.success && aiResponse.provider === 'gemma' && aiResponse.data) {
      route.aiExplanation = aiResponse.data;
      
      // Update caches
      cache.set(shaCacheKey, analysis);
      cache.set(cacheKey, analysis);
      
      return res.json({ aiExplanation: aiResponse.data });
    } else {
      return res.json({ aiExplanation: null, error: aiResponse.fallbackReason || aiResponse.message || 'Gemma 4 explanation is unavailable right now' });
    }
  } catch (error) {
    console.error(`AI API Explanation error for ${owner}/${repo}:`, error.message);
    return res.status(500).json({ error: 'Failed to generate AI explanation' });
  }
});

module.exports = router;
