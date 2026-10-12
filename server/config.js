const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

function createEnvIfMissing() {
  if (fs.existsSync(envPath) || !fs.existsSync(examplePath)) return false;
  fs.copyFileSync(examplePath, envPath);
  return true;
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || line.trim().startsWith('#')) continue;
    let value = match[2];
    if (/^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

const envCreated = createEnvIfMissing();
loadEnvFile(envPath);

const PLACEHOLDER = 'PASTE_YOUR_API_KEY_HERE';
const apiKey = (process.env.GEMINI_API_KEY || '').trim();
const grounding = (process.env.GEMINI_GROUNDING || 'auto').trim().toLowerCase();

module.exports = {
  root,
  envCreated,
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT) || 10000,
  publicDir: path.join(root, 'public'),
  executablePath: path.join(root, 'bin', isWindows ? 'ShahaneBot.exe' : 'ShahaneBot'),
  databasePath: path.join(root, 'data', 'qa_database.txt'),
  apiKey,
  hasApiKey: apiKey.length > 0 && apiKey !== PLACEHOLDER,
  model: (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite').trim(),
  grounding: ['auto', 'on', 'off'].includes(grounding) ? grounding : 'auto',
  baseUrl: process.env.GEMINI_BASE_URL || undefined,
  aiTimeoutMs: 45000,
  maxQuestionLength: 4000,
  maxHistoryMessages: 12,
  maxHistoryChars: 12000,
  maxBodyBytes: '64kb',
  startupTimeoutMs: 5000,
  requestTimeoutMs: 5000
};
