const express = require('express');
const router = express.Router();
const { Octokit } = require('octokit');

const cache = require('../services/cache');

const MAX_DETAILED_ANALYSIS_BYTES = 1024 * 1024; // 1 MB limit
const ANALYZABLE_EXTENSIONS = new Set([
  'c', 'cc', 'cpp', 'cs', 'css', 'dart', 'go', 'h', 'html', 'ino', 'java', 'js', 'json',
  'jsx', 'kt', 'kts', 'md', 'php', 'py', 'rb', 'rs', 'scala', 'sh', 'sql', 'swift',
  'ts', 'tsx', 'vue', 'xml', 'yaml', 'yml'
]);

// Initialize local Octokit
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN || undefined
});

// We no longer filter any files or directories as per user requirements.

function parseGithubUrl(url) {
  try {
    const trimmed = url.trim().replace(/\/$/, "");
    const match = trimmed.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) return null;
    return {
      owner: match[1],
      repo: match[2].replace(/\.git$/, "")
    };
  } catch (e) {
    return null;
  }
}

/**
 * Endpoint to fetch the tree structure
 */
router.get('/tree', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'GitHub URL is required' });
  }

  const parsed = parseGithubUrl(url);
  if (!parsed) {
    return res.status(400).json({ error: 'Invalid GitHub URL format. Please use https://github.com/owner/repo' });
  }

  const { owner, repo } = parsed;
  const cacheKey = `tree:${owner}:${repo}`;

  if (cache.has(cacheKey)) {
    return res.json(cache.get(cacheKey));
  }

  try {
    // Get repo meta
    const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
    const defaultBranch = repoData.default_branch;

    if (!defaultBranch) {
      return res.status(404).json({ error: 'Default branch not found for this repository' });
    }

    // Get branch head reference
    const { data: refData } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${defaultBranch}`
    });
    const commitSha = refData.object.sha;

    // Get tree recursively
    const { data: treeData } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: commitSha,
      recursive: '1'
    });

    if (!treeData.tree || treeData.tree.length === 0) {
      return res.status(404).json({ error: 'Repository seems to be empty' });
    }

    // Filter files (include all blobs)
    const filteredFiles = treeData.tree
      .filter(item => item.type === 'blob')
      .map(item => {
        const parts = item.path.split('/');
        const fileName = parts.pop();
        const folder = parts.length > 0 ? parts.join('/') : '📄 Root Files';
        return {
          fileName,
          path: item.path,
          folder,
          size: item.size,
          sha: item.sha
        };
      });

    const responseData = {
      owner,
      repo,
      defaultBranch,
      commitSha,
      files: filteredFiles
    };

    cache.set(cacheKey, responseData);
    res.json(responseData);
  } catch (error) {
    console.error(`Explorer tree error for ${owner}/${repo}:`, error.message);
    if (error.status === 404) {
      return res.status(404).json({ error: 'Repository not found or is private' });
    }
    if (error.status === 403 || error.status === 429) {
      return res.status(429).json({ error: 'GitHub API rate limit exceeded' });
    }
    res.status(500).json({ error: `Failed to fetch repository tree: ${error.message}` });
  }
});

/**
 * Endpoint to comprehensively analyze a specific file (Detailed Analysis)
 */
router.post('/analyze-line-by-line', async (req, res) => {
  const { owner, repo, path, sha } = req.body;
  const userAiKey = req.headers['x-ai-key'];
  const userAiProvider = req.headers['x-ai-provider'];

  if (!owner || !repo || !path || !sha) {
    return res.status(400).json({ error: 'Missing required parameters: owner, repo, path, sha' });
  }

  const extension = path.split('.').pop()?.toLowerCase();
  if (!extension || !ANALYZABLE_EXTENSIONS.has(extension)) {
    return res.status(422).json({
      error: 'Detailed analysis is available for source and text files only.',
      code: 'UNSUPPORTED_FILE_TYPE'
    });
  }

  // v3: only Gemma results are cached, so an earlier fallback can never stick around.
  const cacheKey = `detailed-v3:${owner}:${repo}:${sha}:${path}`;
  if (cache.has(cacheKey)) {
    return res.json({ path, analysis: cache.get(cacheKey), provider: 'gemma', cached: true });
  }

  try {
    const { data: blobData } = await octokit.rest.git.getBlob({
      owner,
      repo,
      file_sha: sha
    });

    const decodedContent = Buffer.from(blobData.content, 'base64').toString('utf8');

    if (Buffer.byteLength(decodedContent, 'utf8') > MAX_DETAILED_ANALYSIS_BYTES) {
      return res.status(413).json({
        error: 'This file is too large for detailed AI analysis. Choose a file smaller than 1 MB.',
        code: 'FILE_TOO_LARGE'
      });
    }

    if (decodedContent.includes('\0')) {
      return res.status(422).json({
        error: 'This file appears to be binary and cannot be analyzed as source code.',
        code: 'BINARY_FILE'
      });
    }

    // Format content with explicit line numbers so the AI model can analyze line-by-line precisely
    const lineNumberedContent = decodedContent
      .split('\n')
      .map((line, index) => `${index + 1}: ${line}`)
      .join('\n');

    // Route through ProviderManager
    const ProviderManager = require('../services/ai/ProviderManager');
    const result = await ProviderManager.execute('generateDetailedAnalysis', path.split('/').pop(), lineNumberedContent, { key: userAiKey, provider: userAiProvider });

    if (result.success && result.provider === 'gemma') {
      cache.set(cacheKey, result.data);
      res.json({ path, analysis: result.data, provider: 'gemma' });
    } else if (result.success) {
      // Gemma failed; show the static-analysis fallback with the real reason, and do not cache it.
      res.json({
        path,
        analysis: result.data,
        provider: 'fallback',
        notice: `Gemma 4 could not finish this analysis (${result.fallbackReason || 'unavailable'}). Showing RepoPilot's static analysis instead. Press retry to ask Gemma again.`,
      });
    } else {
      res.status(result.status || 503).json({ error: result.message, code: result.code });
    }
  } catch (error) {
    console.error(`Error generating detailed analysis for ${path}:`, error.message);
    res.status(500).json({ error: `Failed to generate detailed analysis: ${error.message}` });
  }
});

module.exports = router;
