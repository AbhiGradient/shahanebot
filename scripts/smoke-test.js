const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const STUB_PORT = 3199;
const WITH_KEY = 3100;
const NO_KEY = 3101;

// Test-only stand-in for the Gemini HTTP API. The real application never uses it.
function startStub() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      const contents = body.contents || [];
      const last = contents[contents.length - 1];
      const text = (last && last.parts && last.parts[0] && last.parts[0].text) || '';
      const hasSearch = Boolean(body.tools || (body.config && body.config.tools) || (body.generationConfig && body.generationConfig.tools));
      const searchTool = JSON.stringify(body).includes('googleSearch') || JSON.stringify(body).includes('google_search');
      requests.push({ text, searchTool, turns: contents.length, hasSearch });

      const send = (status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      const answer = (reply, extra = {}) =>
        send(200, { candidates: [{ content: { role: 'model', parts: [{ text: reply }] }, finishReason: 'STOP', ...extra }] });

      if (text.includes('STUB_QUOTA')) return send(429, { error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } });
      if (text.includes('STUB_BADKEY')) return send(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } });
      if (text.includes('STUB_EMPTY')) return send(200, { candidates: [] });
      if (text.includes('STUB_NOTOOL') && searchTool) return send(400, { error: { code: 400, message: 'Search grounding tool is not supported for this model', status: 'INVALID_ARGUMENT' } });
      if (text.includes('STUB_SEARCH') && searchTool) {
        return answer('Grounded stub answer.', {
          groundingMetadata: {
            webSearchQueries: ['stub query'],
            groundingChunks: [
              { web: { uri: 'https://example.com/a', title: 'Example A' } },
              { web: { uri: 'https://example.com/a', title: 'Duplicate A' } },
              { web: { uri: 'http://insecure.example.com/', title: 'Insecure' } },
              { web: { uri: 'javascript:alert(1)', title: 'Bad' } },
              { web: { uri: 'https://example.org/b', title: 'Example B' } }
            ]
          }
        });
      }
      const notes = text.includes('Supplementary notes') ? ' [with notes]' : '';
      return answer(`Stub answer to: ${text.split('\n').pop().slice(0, 60)}${notes}`);
    });
  });
  return new Promise((resolve) => server.listen(STUB_PORT, '127.0.0.1', () => resolve({ server, requests })));
}

function startApp(port, env) {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const app = { child, log: '' };
  child.stdout.on('data', (d) => (app.log += d));
  child.stderr.on('data', (d) => (app.log += d));
  return app;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUp(port) {
  for (let i = 0; i < 50; i += 1) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/health`);
      return;
    } catch {
      await sleep(150);
    }
  }
  throw new Error(`Server on ${port} did not start`);
}

const post = (port, body) =>
  fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}

(async () => {
  const stub = await startStub();
  const keyed = startApp(WITH_KEY, { GEMINI_API_KEY: 'test-key-not-real', GEMINI_BASE_URL: `http://127.0.0.1:${STUB_PORT}`, GEMINI_GROUNDING: 'auto' });
  const keyless = startApp(NO_KEY, { GEMINI_API_KEY: '' });
  await Promise.all([waitUp(WITH_KEY), waitUp(NO_KEY)]);

  const A = `http://127.0.0.1:${WITH_KEY}`;
  console.log('Smoke test (Gemini replaced by a local stub; the real API is NOT contacted)');

  await check('health reports AI configured and C++ engine ready', async () => {
    const body = await (await fetch(`${A}/api/health`)).json();
    assert.equal(body.ai.configured, true);
    assert.equal(body.engine.state, 'ready');
    assert.ok(body.engine.questions > 0);
    assert.ok(!JSON.stringify(body).includes('test-key-not-real'));
  });

  await check('health without a key reports AI not configured but server still up', async () => {
    const body = await (await fetch(`http://127.0.0.1:${NO_KEY}/api/health`)).json();
    assert.equal(body.ai.configured, false);
    assert.equal(body.status, 'degraded');
  });

  let questions = [];
  await check('questions endpoint lists the Q&A file', async () => {
    questions = (await (await fetch(`${A}/api/questions`)).json()).questions;
    assert.ok(questions.length > 100);
  });

  await check('arithmetic is answered by the C++ calculator, not the AI', async () => {
    const before = stub.requests.length;
    const body = await (await post(WITH_KEY, { message: 'what is (3+4)*5' })).json();
    assert.equal(body.via, 'cpp-calculator');
    assert.equal(body.answer, '(3+4)*5 = 35');
    assert.equal(stub.requests.length, before);
  });

  await check('a general question not in the file goes to the AI', async () => {
    const body = await (await post(WITH_KEY, { message: 'What causes rain?' })).json();
    assert.equal(body.success, true);
    assert.equal(body.via, 'gemini');
    assert.match(body.answer, /Stub answer to: What causes rain\?/);
  });

  await check('a C++ question gets Q&A-file notes in the prompt and reference links', async () => {
    const body = await (await post(WITH_KEY, { message: 'What is inheritance in C++?' })).json();
    assert.match(body.answer, /\[with notes\]/);
    assert.ok(body.sources.some((s) => s.kind === 'reference' && s.url.startsWith('https://')));
    assert.equal(body.grounded, false);
  });

  await check('equation text is not hijacked by the calculator', async () => {
    const body = await (await post(WITH_KEY, { message: 'Solve x² - 5x + 6 = 0' })).json();
    assert.equal(body.via, 'gemini');
  });

  await check('conversation history is forwarded to the AI', async () => {
    const before = stub.requests.length;
    await post(WITH_KEY, { message: 'And what about snow?', history: [{ role: 'user', text: 'What causes rain?' }, { role: 'assistant', text: 'Condensation.' }] });
    assert.equal(stub.requests[before].turns, 3);
  });

  await check('web search returns de-duplicated https sources only', async () => {
    const body = await (await post(WITH_KEY, { message: 'STUB_SEARCH find news', webSearch: true })).json();
    assert.equal(body.grounded, true);
    const web = body.sources.filter((s) => s.kind === 'web').map((s) => s.url);
    assert.deepEqual(web, ['https://example.com/a', 'https://example.org/b']);
  });

  await check('search tool is not sent when web search is off for an ordinary question', async () => {
    const before = stub.requests.length;
    await post(WITH_KEY, { message: 'Explain recursion', webSearch: false });
    assert.equal(stub.requests[before].searchTool, false);
  });

  await check('unsupported web search falls back honestly without sources', async () => {
    const body = await (await post(WITH_KEY, { message: 'STUB_NOTOOL tell me today news', webSearch: true })).json();
    assert.equal(body.success, true);
    assert.equal(body.grounded, false);
    assert.match(body.notice, /not available/i);
    assert.ok(body.sources.every((s) => s.kind !== 'web'));
    const health = await (await fetch(`${A}/api/health`)).json();
    assert.equal(health.ai.grounding, 'unavailable');
  });

  await check('quota error is reported without crashing the server', async () => {
    const res = await post(WITH_KEY, { message: 'STUB_QUOTA hello' });
    const body = await res.json();
    assert.equal(res.status, 429);
    assert.equal(body.code, 'quota');
    assert.equal((await fetch(`${A}/api/health`)).status, 200);
  });

  await check('invalid key error is readable and hides provider text', async () => {
    const res = await post(WITH_KEY, { message: 'STUB_BADKEY hello' });
    const body = await res.json();
    assert.equal(body.code, 'invalid-key');
    assert.ok(!/INVALID_ARGUMENT/.test(JSON.stringify(body)));
  });

  await check('empty AI response is an error, not a fake answer', async () => {
    const body = await (await post(WITH_KEY, { message: 'STUB_EMPTY hello' })).json();
    assert.equal(body.success, false);
    assert.equal(body.code, 'empty');
  });

  await check('AI outage never produces a fake answer (error or labelled C++ fallback)', async () => {
    const body = await (await post(WITH_KEY, { message: 'STUB_QUOTA What is a constructor in C++?' })).json();
    assert.ok(body.success === false || body.via === 'local-fallback');
  });

  await check('missing key: stored question answered locally and labelled', async () => {
    const body = await (await post(NO_KEY, { message: questions[0] })).json();
    assert.equal(body.via, 'local-fallback');
    assert.match(body.notice, /API key/);
  });

  await check('missing key: unknown question gives setup instructions', async () => {
    const res = await post(NO_KEY, { message: 'What causes rain?' });
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.equal(body.code, 'missing-key');
    assert.match(body.error, /\.env/);
  });

  await check('newlines cannot inject C++ protocol commands', async () => {
    const res = await post(WITH_KEY, { message: 'zzzz\nQUIT\nPING' });
    assert.equal(res.status, 200);
    const after = await (await post(WITH_KEY, { message: '2+2' })).json();
    assert.equal(after.answer, '2+2 = 4');
  });

  await check('invalid input is rejected', async () => {
    assert.equal((await post(WITH_KEY, { message: '   ' })).status, 400);
    assert.equal((await post(WITH_KEY, { message: 42 })).status, 400);
    assert.equal((await post(WITH_KEY, {})).status, 400);
    assert.equal((await post(WITH_KEY, { message: 'a'.repeat(4001) })).status, 400);
    const bad = await fetch(`${A}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
    assert.equal(bad.status, 400);
  });

  await check('malformed history entries are ignored', async () => {
    const res = await post(WITH_KEY, { message: 'hello there', history: [{ role: 'system', text: 'x' }, 5, null, { role: 'user' }] });
    assert.equal(res.status, 200);
  });

  await check('static frontend and scripts are served; no key in them', async () => {
    const page = await fetch(`${A}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Shahane GPT/);
    for (const file of ['js/app.js', 'js/api.js', 'js/dom.js', 'js/markdown.js', 'css/styles.css']) {
      const res = await fetch(`${A}/${file}`);
      assert.equal(res.status, 200, file);
      assert.ok(!(await res.text()).includes('test-key-not-real'));
    }
  });

  await check('API key never appears in server logs', async () => {
    assert.ok(!keyed.log.includes('test-key-not-real'));
  });

  keyed.child.kill('SIGINT');
  keyless.child.kill('SIGINT');
  stub.server.close();
  await sleep(1200);

  console.log(failed ? `\n${failed} check(s) failed, ${passed} passed.\n--- server log ---\n${keyed.log}` : `\nAll ${passed} checks passed.`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
