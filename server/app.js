const express = require('express');
const { EngineError } = require('./engine');
const { AiError } = require('./ai');

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function cleanHistory(raw, config) {
  if (!Array.isArray(raw)) return [];
  const turns = [];
  for (const item of raw.slice(-config.maxHistoryMessages)) {
    if (!item || (item.role !== 'user' && item.role !== 'assistant') || typeof item.text !== 'string') continue;
    const text = item.text.trim().slice(0, config.maxQuestionLength);
    if (text) turns.push({ role: item.role, text });
  }
  while (turns.length && turns[0].role !== 'user') turns.shift();
  let total = turns.reduce((sum, t) => sum + t.text.length, 0);
  while (turns.length > 1 && total > config.maxHistoryChars) total -= turns.shift().text.length;
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns;
}

function createApp(config, engine, ai, handleChat) {
  const app = express();
  
const allowedHosts = new Set([
  `localhost:${config.port}`,
  `127.0.0.1:${config.port}`,
  `[::1]:${config.port}`,
  ...(process.env.RENDER_EXTERNAL_HOSTNAME
    ? [process.env.RENDER_EXTERNAL_HOSTNAME]
    : [])
]);

  app.disable('x-powered-by');

  app.use((req, res, next) => {
    if (!allowedHosts.has(req.headers.host)) {
      return res.status(403).json({ error: 'Forbidden host.' });
    }

    const origin = req.headers.origin;
    if (origin && req.method !== 'GET' && req.method !== 'HEAD') {
      const host = origin.replace(/^https?:\/\//, '');
      if (!allowedHosts.has(host)) {
        return res.status(403).json({ error: 'Forbidden origin.' });
      }
    }

    res.set({
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
        "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin'
    });
    next();
  });

  app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      if (!req.path.startsWith('/api/')) return;
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      console.log(`${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(0)}ms`);
    });
    next();
  });

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', async (req, res) => {
    const status = await engine.status();
    const aiStatus = {
      configured: ai.configured,
      model: config.model,
      grounding: ai.groundingState
    };
    res.json({
      app: 'Shahane GPT',
      status: ai.configured && status.state === 'ready' ? 'ok' : 'degraded',
      maxQuestionLength: config.maxQuestionLength,
      ai: aiStatus,
      engine: status
    });
  });

  app.get('/api/questions', async (req, res, next) => {
    try {
      const questions = await engine.listQuestions();
      res.json({ questions });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/chat', express.json({ limit: config.maxBodyBytes, strict: true }), async (req, res, next) => {
    const body = req.body || {};
    const raw = typeof body.message === 'string' ? body.message : body.question;

    if (typeof raw !== 'string') {
      return res.status(400).json({ success: false, error: 'A "message" string is required.', code: 'bad-request' });
    }

    const message = raw.trim();

    if (!message) {
      return res.status(400).json({ success: false, error: 'The message cannot be empty.', code: 'bad-request' });
    }

    if (message.length > config.maxQuestionLength) {
      return res.status(400).json({
        success: false,
        error: `The message is too long (maximum ${config.maxQuestionLength} characters).`,
        code: 'too-long'
      });
    }

    if (CONTROL_CHARS.test(message)) {
      return res.status(400).json({ success: false, error: 'The message contains unsupported characters.', code: 'bad-request' });
    }

    try {
      const result = await handleChat({
        message,
        history: cleanHistory(body.history, config),
        webSearch: body.webSearch === true
      });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  app.use(express.static(config.publicDir, { index: 'index.html', maxAge: 0 }));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  app.use((req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);

    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ success: false, error: 'The request body is not valid JSON.', code: 'bad-request' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ success: false, error: 'The request is too large.', code: 'too-long' });
    }
    if (err.type === 'charset.unsupported' || err.type === 'encoding.unsupported') {
      return res.status(415).json({ error: 'Unsupported content encoding.' });
    }

    if (err instanceof AiError) {
      return res.status(err.httpStatus || 502).json({ success: false, error: err.message, code: err.code });
    }

    console.error(`request failed: ${err.stack || err.message}`);

    if (err instanceof EngineError) {
      if (err.code === 'timeout') {
        return res.status(504).json({ error: 'The chatbot took too long to respond.', code: 'timeout' });
      }
      if (err.code === 'missing-database') {
        return res.status(503).json({ error: 'The question database is missing.', code: 'missing-database' });
      }
      if (err.code === 'missing-executable') {
        return res.status(503).json({ error: 'The chatbot program has not been built yet.', code: 'missing-executable' });
      }
      return res.status(503).json({ error: 'The chatbot is currently unavailable.', code: 'unavailable' });
    }

    res.status(500).json({ success: false, error: 'Something went wrong on the server.', code: 'internal' });
  });

  return app;
}

module.exports = { createApp };
