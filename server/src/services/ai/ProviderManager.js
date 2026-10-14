const crypto = require('crypto');
const { LRUCache } = require('lru-cache');

const BaseProvider = require('./providers/BaseProvider');
const GemmaProvider = require('./providers/GemmaProvider');
const MockProvider = require('./providers/MockProvider');

/**
 * Routes every AI call in RepoPilot to Gemma 4.
 *
 * Gemma 4 is the only AI model. If Gemma is not configured or fails, features
 * that have a rule-based fallback (MockProvider: static analysis, no AI model)
 * degrade to it so the app keeps working, and the response says so
 * (provider: 'mock'). Set GEMMA_STRICT=true to disable the fallback.
 * Time Machine and voice methods never fall back here: their routes build their own
 * facts-only output (Git facts, page facts) when Gemma is unavailable.
 */
const NO_FALLBACK = new Set(['generateFileStory', 'generateRepoEvolution', 'generateVoiceNarration', 'generateVoiceReply']);

// Separate from services/cache.js so AI responses never evict repository analyses.
const aiCache = new LRUCache({ max: 300, ttl: 1000 * 60 * 60 });

function implementsMethod(provider, methodName) {
  return typeof provider[methodName] === 'function' && provider[methodName] !== BaseProvider.prototype[methodName];
}

class ProviderManager {
  constructor() {
    this.gemma = new GemmaProvider();
    this.mock = new MockProvider();
    this.providers = { gemma: this.gemma, mock: this.mock };
    this.cache = aiCache;
  }

  isGemmaConfigured(override) {
    return this.gemma.isConfigured(override);
  }

  describe(override) {
    return { provider: 'Gemma 4', ...this.gemma.describe(override) };
  }

  _generateCacheKey(methodName, args) {
    const data = JSON.stringify({ methodName, args });
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * execute(methodName, ...args[, { key, provider }])
   * The optional last argument carries the user's own key (BYOK) from the
   * X-AI-Key / X-AI-Provider headers; it is passed to Gemma as-is.
   * @returns {Promise<{success: true, data: any, provider: 'gemma'|'mock'} | {success: false, status: number, code: string, message: string}>}
   */
  async execute(methodName, ...args) {
    const last = args[args.length - 1];
    if (last && typeof last === 'object' && ('key' in last || 'provider' in last)) {
      args[args.length - 1] = { key: last.key || undefined, provider: last.provider || undefined };
    } else if (typeof last === 'string' && GemmaProvider.inferBackendFromKey(last)) {
      args[args.length - 1] = { key: last }; // legacy plain-key override
    }

    const cacheKey = this._generateCacheKey(methodName, args);
    if (this.cache.has(cacheKey)) {
      console.log(`[AI] Cache Hit | Executing: ${methodName}`);
      return this.cache.get(cacheKey);
    }

    const order = ['gemma'];
    const allowFallback = process.env.GEMMA_STRICT !== 'true' && !NO_FALLBACK.has(methodName);
    if (allowFallback && implementsMethod(this.mock, methodName)) order.push('mock');

    let gemmaError = null;
    for (const name of order) {
      const provider = this.providers[name];
      if (!implementsMethod(provider, methodName)) continue;
      try {
        console.log(`[AI] Provider: ${provider.name} | Executing: ${methodName}`);
        const data = await provider[methodName](...args);
        console.log(`[AI] Provider: ${provider.name} | Status: Success`);
        const result = { success: true, data, provider: name };
        // Only Gemma results are cached, so Gemma is retried once it is available again.
        if (name === 'gemma') this.cache.set(cacheKey, result);
        else if (gemmaError) result.fallbackReason = gemmaError.message;
        return result;
      } catch (error) {
        if (name === 'gemma') gemmaError = error;
        console.log(`[AI] Provider: ${provider.name} | Status: ${error.status || 'Error'} | Detail: ${error.message}`);
      }
    }

    return this._errorResult(gemmaError);
  }

  _errorResult(error) {
    const message = error?.message || 'Unknown error';
    console.error('[AI] Gemma request failed:', message);

    if (message.includes('not configured')) {
      return {
        success: false,
        status: 400,
        code: 'AI_KEY_MISSING',
        message: 'Gemma 4 is not configured. Add GEMINI_API_KEY (Google AI Studio), OPENROUTER_API_KEY or OLLAMA_URL to server/.env, or add your own key in API Key Settings.',
      };
    }
    const status = error?.status || error?.response?.status;
    if (status === 401 || status === 403) {
      return { success: false, status: 503, code: 'AI_AUTH_FAILED', message: `The Gemma provider rejected the API key: ${message}` };
    }
    if (status === 402) {
      return { success: false, status: 503, code: 'AI_CREDITS_REQUIRED', message: 'The configured Gemma endpoint needs provider credits. Use a free Gemma endpoint or top up the provider account.' };
    }
    if (status === 404) {
      return { success: false, status: 503, code: 'AI_MODEL_NOT_FOUND', message: `The Gemma model id was not found on this provider (${message}). Check GEMMA_MODEL / GEMMA_FAST_MODEL.` };
    }
    if (status === 429) {
      return { success: false, status: 429, code: 'AI_RATE_LIMITED', message: 'Gemma is rate-limiting requests. Please wait a moment and retry.' };
    }
    return { success: false, status: 503, code: 'AI_PROVIDER_UNAVAILABLE', message: `Gemma failed: ${message}` };
  }
}

module.exports = new ProviderManager();
module.exports.ProviderManager = ProviderManager;
