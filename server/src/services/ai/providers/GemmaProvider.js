const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const BaseProvider = require('./BaseProvider');
const { prompts } = require('../prompts');
const { toPlainText } = require('../textClean');
const { ANSWER_RULE, extractAnswer, looksLikePromptEcho } = require('../answerExtract');

/**
 * Gemma 4 — the only AI model used by RepoPilot.
 *
 * Every AI feature (detailed file analysis, file descriptions, AI Assistant
 * chat, executive summary, security review, API explanations, README
 * generation and the Time Machine) runs on Gemma 4 through this provider.
 *
 * Gemma 4 can be reached through three backends; the first configured one wins
 * (force one with GEMMA_BACKEND=gemini|openrouter|ollama):
 *   - gemini      Google AI Studio / Gemini API key (GEMINI_API_KEY)
 *   - openrouter  OpenRouter key (OPENROUTER_API_KEY)
 *   - ollama      Local Ollama server (OLLAMA_URL, e.g. http://localhost:11434)
 *
 * Models:
 *   - GEMMA_MODEL       (default gemma-4-31b-it)        long or reasoning-heavy tasks
 *   - GEMMA_FAST_MODEL  (default gemma-4-26b-a4b-it)    short tasks (descriptions, summaries)
 *   - GEMMA_OLLAMA_MODEL (default gemma4:e4b)           all tasks when using Ollama
 * Model ids are normalised per backend, so "gemma-4-31b-it" and
 * "google/gemma-4-31b-it" both work everywhere.
 *
 * Users may bring their own key (BYOK): a Google AI Studio key ("AIza...") or an
 * OpenRouter key ("sk-or-..."). Either one is used to call Gemma 4.
 */
const DEFAULTS = {
  model: 'gemma-4-31b-it',
  fastModel: 'gemma-4-26b-a4b-it',
  ollamaModel: 'gemma4:e4b',
};

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * Small priority queue that caps concurrent Gemma calls. Free Gemma endpoints
 * have tight per-minute limits; without this, the background file descriptions
 * that run after every analysis competed with what the user clicked on
 * (Detailed Analysis, chat) and pushed those into rate limits. Interactive
 * calls ('high') always go before background ones ('low').
 */
class GemmaLimiter {
  constructor(max) {
    this.max = max;
    this.active = 0;
    this.queue = { high: [], low: [] };
  }
  run(fn, priority = 'high') {
    return new Promise((resolve, reject) => {
      this.queue[priority === 'low' ? 'low' : 'high'].push({ fn, resolve, reject });
      this._next();
    });
  }
  _next() {
    if (this.active >= this.max) return;
    const job = this.queue.high.shift() || this.queue.low.shift();
    if (!job) return;
    this.active++;
    Promise.resolve()
      .then(job.fn)
      .then(job.resolve, job.reject)
      .finally(() => { this.active--; this._next(); });
  }
}

/** How long to wait before retrying, using the provider's own hint when it gives one. */
function retryDelayMs(err, attempt) {
  const base = Number(process.env.GEMMA_RETRY_DELAY_MS || 3000);
  let hinted = 0;
  const header = err?.response?.headers?.['retry-after'];
  if (header && !Number.isNaN(Number(header))) hinted = Number(header) * 1000;
  // Gemini API errors carry google.rpc.RetryInfo { retryDelay: "23s" }
  for (const d of err?.errorDetails || []) {
    const m = typeof d?.retryDelay === 'string' && d.retryDelay.match(/([\d.]+)s/);
    if (m) hinted = Math.max(hinted, Number(m[1]) * 1000);
  }
  if (!hinted) {
    const m = String(err?.message || '').match(/retry in ([\d.]+)\s*s/i);
    if (m) hinted = Number(m[1]) * 1000;
  }
  const cap = Number(process.env.GEMMA_MAX_RETRY_WAIT_MS || 20000);
  return Math.min(Math.max(hinted, base * attempt), cap);
}

function isPlaceholder(v) {
  return !v || /^your_.*_here$/i.test(String(v).trim());
}

function real(v) {
  return isPlaceholder(v) ? null : String(v).trim();
}

/** Accept a plain key string or the { key, provider } override object used by routes. */
function normalizeOverride(override) {
  if (!override) return {};
  if (typeof override === 'string') return { key: override };
  return { key: override.key || undefined, provider: override.provider || undefined };
}

function inferBackendFromKey(key) {
  if (!key) return null;
  if (/^sk-or-/.test(key)) return 'openrouter';
  // Accept AIza... keys (standard Gemini API keys) as well as
  // any other key format that is not clearly an OpenRouter key.
  // The Gemini API accepts various token formats.
  if (/^AIza/.test(key) || /^AQ\./.test(key) || key.length > 10) return 'gemini';
  return null;
}

class GemmaProvider extends BaseProvider {
  constructor() {
    super('Gemma 4');
    this.limiter = new GemmaLimiter(Number(process.env.GEMMA_MAX_CONCURRENCY || 2));
  }

  _timeout(override) {
    return Number(override || process.env.GEMMA_TIMEOUT_MS || process.env.AI_REQUEST_TIMEOUT_MS || 90000);
  }

  /**
   * Decide which backend + credential to use.
   * @param {string|object} [override] user key string, or { key, provider } from request headers
   * @param {string} [hint] backend hint ('gemini' | 'openrouter') for a user key
   */
  resolveBackend(override, hint) {
    const { key, provider } = normalizeOverride(override);
    const userKey = real(key);
    const hintLc = (hint || provider || '').toLowerCase();
    if (userKey) {
      const fromKey = inferBackendFromKey(userKey);
      const backend = fromKey || (hintLc === 'gemini' || hintLc === 'openrouter' ? hintLc : null);
      if (backend) return { backend, key: userKey };
      // A key for a provider that cannot serve Gemma is ignored; the server's configuration is used.
    }

    const forced = (process.env.GEMMA_BACKEND || 'auto').toLowerCase();
    let order = ['gemini', 'openrouter', 'ollama'];
    if (forced !== 'auto') order = [forced];
    else if ((process.env.AI_PROVIDER || '').toLowerCase() === 'openrouter') order = ['openrouter', 'gemini', 'ollama'];

    for (const backend of order) {
      if (backend === 'gemini' && real(process.env.GEMINI_API_KEY)) return { backend, key: real(process.env.GEMINI_API_KEY) };
      if (backend === 'openrouter' && real(process.env.OPENROUTER_API_KEY)) return { backend, key: real(process.env.OPENROUTER_API_KEY) };
      if (backend === 'ollama' && real(process.env.OLLAMA_URL)) return { backend, key: null };
    }
    // ProviderManager maps "not configured" to the AI_KEY_MISSING response code.
    throw new Error('Gemma is not configured: set GEMINI_API_KEY, OPENROUTER_API_KEY or OLLAMA_URL');
  }

  isConfigured(override) {
    try {
      this.resolveBackend(override);
      return true;
    } catch (_) {
      return false;
    }
  }

  /** Model id for a backend, normalised to that backend's naming. tier: 'main' | 'fast' */
  modelFor(backend, tier = 'main') {
    if (backend === 'ollama') return process.env.GEMMA_OLLAMA_MODEL || DEFAULTS.ollamaModel;
    const raw = tier === 'fast'
      ? (process.env.GEMMA_FAST_MODEL || DEFAULTS.fastModel)
      : (process.env.GEMMA_MODEL || DEFAULTS.model);
    const bare = raw.replace(/^google\//, '');
    return backend === 'openrouter' ? `google/${bare}` : bare;
  }

  /** Describe the active configuration without making a call (used by /api/ai/status). */
  describe(override) {
    try {
      const { backend } = this.resolveBackend(override);
      return { configured: true, backend, model: this.modelFor(backend), fastModel: this.modelFor(backend, 'fast') };
    } catch (_) {
      return { configured: false, backend: null, model: null, fastModel: null };
    }
  }

  /**
   * One Gemma call. The final answer is taken from <answer> tags (planning text
   * removed); an answer that is just the prompt echoed back is retried once and
   * then reported as an error, so the UI never shows it.
   * extract: { startHeading?, dropEcho? } passed to extractAnswer.
   */
  async _complete(systemPrompt, userPrompt, override, { hint, tier = 'main', maxTokens = 4096, json = false, timeoutMs, priority = 'high', extract = {} } = {}) {
    const { backend, key } = this.resolveBackend(override, hint);
    const model = this.modelFor(backend, tier);
    const timeout = this._timeout(timeoutMs);
    // Thinking tokens count against the output budget; tiny budgets cut the answer off
    // mid-plan, which is how instruction text ended up in the Overview summary.
    const budget = Math.max(maxTokens, Number(process.env.GEMMA_MIN_OUTPUT_TOKENS || 2048));
    const system = `${systemPrompt}${ANSWER_RULE}`;
    const rawCall = () => {
      if (backend === 'gemini') return this._callGemini(key, model, system, userPrompt, budget, timeout);
      if (backend === 'openrouter') return this._callOpenRouter(key, model, system, userPrompt, budget, timeout);
      if (backend === 'ollama') return this._callOllama(model, system, userPrompt, false, timeout);
      throw new Error(`Unknown Gemma backend: ${backend}`);
    };
    let echoRetried = false;
    const call = async () => {
      for (;;) {
        const raw = await rawCall();
        const answer = extractAnswer(raw, json ? { dropEcho: false } : extract);
        if (answer && (json || !looksLikePromptEcho(answer))) return answer;
        if (echoRetried) {
          const e = new Error(`Gemma (${model}) returned its planning notes instead of an answer`);
          e.status = 502;
          e.noRetry = true;
          throw e;
        }
        echoRetried = true;
        console.warn(`[Gemma] ${model} answer was empty or echoed the prompt; asking again`);
      }
    };

    const maxRetries = Number(process.env.GEMMA_MAX_RETRIES ?? 2);
    const started = Date.now();
    const text = await this.limiter.run(async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await call();
        } catch (err) {
          const status = err.status || err.response?.status;
          // Retry rate limits and transient upstream errors, never bad keys or bad model ids.
          if (err.noRetry || !RETRYABLE.has(status) || attempt >= maxRetries) throw err;
          const wait = retryDelayMs(err, attempt + 1);
          console.warn(`[Gemma] ${model} returned ${status}; retrying in ${Math.round(wait / 1000)}s (attempt ${attempt + 2}/${maxRetries + 1})`);
          await new Promise(r => setTimeout(r, wait));
        }
      }
    }, priority);

    if (!text) {
      const e = new Error(`Gemma (${model}) returned an empty response`);
      e.status = 502;
      throw e;
    }
    console.log(`[Gemma] ${model} via ${backend} answered in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    // Returned together so concurrent requests never mix up metadata.
    return { text, backend, model };
  }

  /** The other Gemma 4 model, used once when the first one has a server error. */
  gemmaFallbackFor(model) {
    const env = process.env.GEMMA_FALLBACK_MODEL;
    if (env && env.replace(/^google\//, '') !== model) return env.replace(/^google\//, '');
    if (/31b/i.test(model)) return 'gemma-4-26b-a4b-it';
    if (/26b/i.test(model)) return 'gemma-4-31b-it';
    return null;
  }

  async _callGemini(key, model, systemPrompt, userPrompt, maxTokens, timeout) {
    const genAI = new GoogleGenerativeAI(key);
    const generationConfig = { temperature: 0.2, maxOutputTokens: maxTokens };

    // One request with its own abort timer (the SDK's `timeout` option leaves its timer running).
    const attempt = async (modelId, withSystem) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        if (withSystem) {
          const m = genAI.getGenerativeModel({ model: modelId, generationConfig, systemInstruction: systemPrompt });
          return await m.generateContent(userPrompt, { signal: controller.signal });
        }
        const m = genAI.getGenerativeModel({ model: modelId, generationConfig });
        return await m.generateContent(
          { contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n---\n\n${userPrompt}` }] }] },
          { signal: controller.signal }
        );
      } catch (err) {
        if (controller.signal.aborted) {
          const e = new Error(`Gemini API (Gemma) request timed out after ${Math.round(timeout / 1000)}s`);
          e.status = 504;
          throw e;
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    };

    // Gemma on the Gemini API can reject the systemInstruction field, sometimes with a 400 and
    // sometimes with a 500 "internal error". Then the instructions go in the prompt instead,
    // and that choice is remembered for the model.
    const run = async (modelId) => {
      if (GemmaProvider.noSystemInstruction.has(modelId)) return attempt(modelId, false);
      try {
        return await attempt(modelId, true);
      } catch (err) {
        if (![400, 500].includes(err.status)) throw err;
        console.warn(`[Gemma] ${modelId} failed with systemInstruction (${err.status}); retrying with instructions in the prompt`);
        const r = await attempt(modelId, false);
        GemmaProvider.noSystemInstruction.add(modelId);
        return r;
      }
    };

    let result;
    try {
      result = await run(model);
    } catch (err) {
      const fallback = this.gemmaFallbackFor(model);
      if (!fallback || ![500, 503].includes(err.status)) throw err;
      console.warn(`[Gemma] ${model} returned ${err.status}; trying ${fallback}`);
      result = await run(fallback);
    }

    const candidate = result.response?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    // response.text() joins every part, including Gemma's thought parts. Keep only the answer.
    const text = parts
      .filter(p => typeof p.text === 'string' && !p.thought)
      .map(p => p.text)
      .join('')
      .trim();
    if (!text) {
      const reason = result.response?.promptFeedback?.blockReason || candidate?.finishReason;
      const e = new Error(`Gemini API returned no answer text${reason ? ` (${reason})` : ''}`);
      e.status = 502;
      throw e;
    }
    if (candidate?.finishReason === 'MAX_TOKENS') {
      console.warn(`[Gemma] ${model} hit the output token limit (${maxTokens}); answer may be cut off`);
    }
    return text;
  }

  async _callOpenRouter(key, model, systemPrompt, userPrompt, maxTokens, timeout) {
    try {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model,
          temperature: 0.2,
          max_tokens: maxTokens,
          // Keep Gemma's reasoning out of message.content.
          reasoning: { exclude: true },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        },
        {
          timeout,
          headers: {
            Authorization: `Bearer ${key}`,
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'RepoPilot',
            'Content-Type': 'application/json',
          },
        }
      );
      return (response.data?.choices?.[0]?.message?.content || '').trim();
    } catch (err) {
      throw this._wrapAxiosError(err, 'OpenRouter');
    }
  }

  async _callOllama(model, systemPrompt, userPrompt, json = false, timeout) {
    const base = real(process.env.OLLAMA_URL).replace(/\/$/, '');
    try {
      const response = await axios.post(
        `${base}/api/chat`,
        {
          model,
          stream: false,
          ...(json ? { format: 'json' } : {}),
          options: { temperature: 0.2 },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        },
        { timeout: timeout || this._timeout() }
      );
      return (response.data?.message?.content || '').trim();
    } catch (err) {
      throw this._wrapAxiosError(err, 'Ollama');
    }
  }

  _wrapAxiosError(err, label) {
    if (err.code === 'ECONNABORTED') {
      const e = new Error(`${label} (Gemma) request timed out`);
      e.status = 504;
      return e;
    }
    if (err.response) {
      const msg = err.response.data?.error?.message || err.response.data?.error || err.message;
      const e = new Error(`${label} (Gemma) error: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
      e.status = err.response.status;
      return e;
    }
    return err;
  }

  static stripFences(text) {
    return text.replace(/^```(?:markdown|md)?\n?/i, '').replace(/\n?```\s*$/i, '');
  }

  // -------------------------------------------------------------------------
  // RepoPilot AI features
  // -------------------------------------------------------------------------

  async generateDetailedAnalysis(fileName, fileContent, override) {
    const p = prompts.detailedAnalysis(fileName, fileContent);
    // The fast Gemma 4 model (26B A4B, ~4B active parameters) writes this walkthrough several
    // times faster than 31B; the long timeout covers big files on free endpoints.
    const { text } = await this._complete(p.system, p.user, override, {
      tier: process.env.GEMMA_DETAILED_TIER || 'fast',
      maxTokens: 6000,
      timeoutMs: Number(process.env.GEMMA_DETAILED_TIMEOUT_MS || 150000),
      extract: { startHeading: 'Summary' },
    });
    return GemmaProvider.stripFences(text);
  }

  async generateFileDescription(fileName, compressedContext, override, options = {}) {
    const p = prompts.fileDescription(fileName, compressedContext);
    const { text } = await this._complete(p.system, p.user, override, { tier: 'fast', maxTokens: 120, priority: options.priority || 'high' });
    return toPlainText(text, { maxSentences: 1, maxWords: 30 });
  }

  async answerQuestion(question, analysisJson, override) {
    const p = prompts.answerQuestion(question, analysisJson);
    const { text, model } = await this._complete(p.system, p.user, override, { maxTokens: 3000, extract: { dropEcho: false } });
    const citations = [];
    const citationRegex = /\[([^:\]]+):L(\d+)\]\(([^)]+)\)/g;
    let match;
    while ((match = citationRegex.exec(text)) !== null) {
      citations.push({ file: match[1], line: parseInt(match[2], 10), githubUrl: match[3] });
    }
    return { answer: text, citations, model };
  }

  async generateExecutiveSummary(analysisJson, override) {
    const p = prompts.executiveSummary(analysisJson);
    const { text } = await this._complete(p.system, p.user, override, { tier: 'fast', maxTokens: 200 });
    return toPlainText(text, { maxSentences: 2, maxWords: 60 });
  }

  async generateSecurityReview(analysisJson, override) {
    const p = prompts.securityReview(analysisJson);
    const { text } = await this._complete(p.system, p.user, override, { tier: 'fast', maxTokens: 220 });
    return toPlainText(text, { maxSentences: 3, maxWords: 70 });
  }

  async generateApiExplanation(route, override) {
    const p = prompts.apiExplanation(route);
    const { text } = await this._complete(p.system, p.user, override, { tier: 'fast', maxTokens: 180 });
    return toPlainText(text, { maxSentences: 2, maxWords: 55 });
  }

  async generateReadme(analysisJson, override) {
    const p = prompts.readme(analysisJson);
    const { text } = await this._complete(p.system, p.user, override, { maxTokens: 8192, timeoutMs: Number(process.env.GEMMA_README_TIMEOUT_MS || 150000), extract: { dropEcho: false } });
    return GemmaProvider.stripFences(text);
  }

  /**
   * Voice assistant: spoken explanation of one page. Returns raw JSON text
   * ({"sentences": [...]}) that routes/voice.js parses and checks.
   */
  async generateVoiceNarration(payload, override) {
    const p = prompts.voiceNarration(payload);
    return this._complete(p.system, p.user, override, {
      tier: 'fast', maxTokens: payload.length === 'brief' ? 220 : 650, json: true, timeoutMs: Number(process.env.GEMMA_VOICE_TIMEOUT_MS || 16000),
    });
  }

  /** Voice assistant: answer a spoken command/question and choose app actions. Returns raw JSON text. */
  async generateVoiceReply(payload, override) {
    const p = prompts.voiceCommand(payload);
    return this._complete(p.system, p.user, override, { tier: 'fast', maxTokens: 350, json: true, timeoutMs: Number(process.env.GEMMA_VOICE_TIMEOUT_MS || 16000) });
  }

  /**
   * Time Machine: prompts are pre-built by services/history; returns raw text
   * which storySchema.js parses and validates.
   * @returns {Promise<{text: string, backend: string, model: string}>}
   */
  async generateFileStory(payload, override) {
    return this._complete(payload.systemPrompt, payload.userPrompt, override, { hint: payload.backendHint, json: true });
  }

  async generateRepoEvolution(payload, override) {
    return this._complete(payload.systemPrompt, payload.userPrompt, override, { hint: payload.backendHint, json: true });
  }
}

GemmaProvider.noSystemInstruction = new Set();
GemmaProvider.normalizeOverride = normalizeOverride;
GemmaProvider.GemmaLimiter = GemmaLimiter;
GemmaProvider.retryDelayMs = retryDelayMs;
GemmaProvider.inferBackendFromKey = inferBackendFromKey;

module.exports = GemmaProvider;
