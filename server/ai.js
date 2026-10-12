const { GoogleGenAI } = require('@google/genai');

const SYSTEM_INSTRUCTION = [
  'You are Shahane GPT, an educational AI assistant built for a college project.',
  'Answer general-knowledge and educational questions, with special strength in C++ and computer science.',
  'Explain technical ideas in beginner-friendly language and start with a simple example before advanced detail.',
  'When asked for C++ code, write valid, standard C++ (C++17) in fenced code blocks and briefly explain the important lines.',
  'When debugging, point out the exact problem, show the corrected code, and explain why it fixes the issue.',
  'You cannot run code. Never claim that code was compiled, executed, or tested.',
  'If you are unsure, say so instead of inventing facts, and separate established facts from assumptions.',
  'Do not invent links or citations. Source links are attached separately by the application.',
  'Keep answers concise unless the user asks for more detail.',
  'The message may include supplementary notes from a local Q&A file; use them only when relevant and correct them if they are wrong.'
].join(' ');

class AiError extends Error {
  constructor(code, message, httpStatus) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const FRIENDLY = {
  'missing-key': ['No Gemini API key is configured. Open the .env file, replace PASTE_YOUR_API_KEY_HERE with your key, save it, and restart the server.', 503],
  'invalid-key': ['The Gemini API key was rejected. Check the key in the .env file (get one at https://aistudio.google.com/apikey), then restart the server.', 502],
  quota: ['The Gemini usage limit for your key has been reached. Wait a while and try again, or check your quota in Google AI Studio.', 429],
  timeout: ['The AI service took too long to respond. Please try again.', 504],
  network: ['Could not reach the Gemini service. Check your internet connection and try again.', 502],
  'unsupported-model': ['The configured Gemini model is not available. Change GEMINI_MODEL in the .env file and restart the server.', 502],
  'bad-request': ['The AI service could not process that request. Try rephrasing your message.', 502],
  blocked: ['The AI service declined to answer that message. Try rephrasing it.', 422],
  empty: ['The AI service returned an empty answer. Please try again.', 502],
  unavailable: ['The AI service is temporarily unavailable. Please try again shortly.', 502]
};

function aiError(code) {
  const [message, status] = FRIENDLY[code] || FRIENDLY.unavailable;
  return new AiError(code, message, status);
}

function classify(err) {
  const status = Number(err && err.status);
  const text = String((err && err.message) || '');

  if (/api key not valid|API_KEY_INVALID|api key.*(expired|invalid)/i.test(text)) return 'invalid-key';
  if (status === 401 || status === 403) return 'invalid-key';
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(text)) return 'quota';
  if (status === 404 || /model.*(not found|not supported|is not available)/i.test(text)) return 'unsupported-model';
  if (status === 408 || status === 504 || err.name === 'AbortError' || /timed? ?out|DEADLINE/i.test(text)) return 'timeout';
  if (status >= 500) return 'unavailable';
  if (status >= 400) return 'bad-request';
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ETIMEDOUT|network/i.test(text)) return 'network';
  return 'unavailable';
}

function redact(text, key) {
  let out = String(text).slice(0, 300);
  if (key) out = out.split(key).join('[hidden]');
  return out.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[hidden]');
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function extractSources(candidate) {
  const chunks = (candidate && candidate.groundingMetadata && candidate.groundingMetadata.groundingChunks) || [];
  const seen = new Set();
  const sources = [];

  for (const chunk of chunks) {
    const web = chunk && chunk.web;
    if (!web || typeof web.uri !== 'string' || !isHttpsUrl(web.uri) || seen.has(web.uri)) continue;
    seen.add(web.uri);
    const title = typeof web.title === 'string' && web.title.trim() ? web.title.trim().slice(0, 150) : new URL(web.uri).hostname;
    sources.push({ title, url: web.uri, kind: 'web' });
  }

  return sources;
}

class GeminiService {
  #config;
  #client = null;
  #groundingBlockedUntil = 0;

  constructor(config) {
    this.#config = config;
    if (config.hasApiKey) {
      this.#client = new GoogleGenAI({
        apiKey: config.apiKey,
        httpOptions: { timeout: config.aiTimeoutMs, ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}) }
      });
    }
  }

  get configured() {
    return this.#client !== null;
  }

  get groundingState() {
    if (this.#config.grounding === 'off') return 'off';
    if (Date.now() < this.#groundingBlockedUntil) return 'unavailable';
    return 'enabled';
  }

  async generate({ message, history = [], notes = [], useSearch = false }) {
    if (!this.#client) throw aiError('missing-key');

    const wantSearch = useSearch && this.groundingState === 'enabled';
    let groundingNote = null;

    if (useSearch && !wantSearch && this.#config.grounding !== 'off') {
      groundingNote = 'Live web search is not available for this model or API tier, so no web sources were used.';
    }

    if (wantSearch) {
      try {
        return { ...(await this.#call(message, history, notes, true)), groundingNote: null };
      } catch (err) {
        const toolProblem = err instanceof AiError
          ? false
          : /search|ground|tool/i.test(String(err.message)) && [400, 403, 404, 429].includes(Number(err.status));
        if (!toolProblem) throw this.#toAiError(err);
        this.#groundingBlockedUntil = Date.now() + 30 * 60 * 1000;
        console.warn(`[ai] web search grounding rejected (status ${err.status}); continuing without it for 30 minutes`);
        groundingNote = 'Live web search is not available for this model or API tier, so this answer was generated without it.';
      }
    }

    try {
      return { ...(await this.#call(message, history, notes, false)), groundingNote };
    } catch (err) {
      throw this.#toAiError(err);
    }
  }

  #toAiError(err) {
    if (err instanceof AiError) return err;
    const code = classify(err);
    console.error(`[ai] request failed: ${code} (status ${err && err.status || 'n/a'}): ${redact(err && err.message, this.#config.apiKey)}`);
    return aiError(code);
  }

  async #call(message, history, notes, search) {
    const contents = history.map((turn) => ({
      role: turn.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: turn.text }]
    }));

    let finalText = message;
    if (notes.length) {
      const block = notes.map((n) => `Q: ${n.question}\nA: ${n.answer}`).join('\n\n');
      finalText = `Supplementary notes from the local Q&A file (may be incomplete):\n${block}\n\n---\nUser message:\n${message}`;
    }
    contents.push({ role: 'user', parts: [{ text: finalText }] });

    const config = { systemInstruction: SYSTEM_INSTRUCTION, temperature: 0.6 };
    if (search) config.tools = [{ googleSearch: {} }];

    const response = await this.#client.models.generateContent({
      model: this.#config.model,
      contents,
      config
    });

    if (response.promptFeedback && response.promptFeedback.blockReason) throw aiError('blocked');

    const candidate = response.candidates && response.candidates[0];
    const parts = (candidate && candidate.content && candidate.content.parts) || [];
    const text = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('').trim();

    if (!text) {
      if (candidate && candidate.finishReason && /SAFETY|BLOCK|PROHIBITED/i.test(candidate.finishReason)) throw aiError('blocked');
      throw aiError('empty');
    }

    const sources = search ? extractSources(candidate) : [];
    const queries = (candidate && candidate.groundingMetadata && candidate.groundingMetadata.webSearchQueries) || [];

    return { text, sources, searchQueries: queries, searched: search };
  }
}

module.exports = { GeminiService, AiError, aiError, classify, extractSources };
