const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(`Node.js 20 or newer is required (you have ${process.versions.node}).`);
  console.error('Download the LTS version from https://nodejs.org and run this command again.');
  process.exit(1);
}

const config = require('./config');
const { ChatbotEngine } = require('./engine');
const { GeminiService } = require('./ai');
const { createChat } = require('./chat');
const { createApp } = require('./app');

const engine = new ChatbotEngine(config);
const ai = new GeminiService(config);
const app = createApp(config, engine, ai, createChat({ config, engine, ai }));

if (config.envCreated) {
  console.log('Created a new .env file from .env.example.');
}

if (!config.hasApiKey) {
  console.warn('');
  console.warn('AI is NOT configured: open the .env file in the project folder, replace');
  console.warn('PASTE_YOUR_API_KEY_HERE with your Gemini API key, save, and restart.');
  console.warn('Get a free key at https://aistudio.google.com/apikey');
  console.warn('');
} else {
  console.log(`Gemini model: ${config.model} (web search: ${config.grounding})`);
}

const missing = engine.checkFiles();
if (missing === 'missing-executable') {
  console.warn('C++ engine not built. Run "npm run build:cpp" (needs g++, see README).');
  console.warn('The website and AI chat still work, but the C++ calculator and notes are unavailable.');
} else if (missing === 'missing-database') {
  console.warn('Question file not found at data/qa_database.txt. AI chat still works without it.');
}

const server = app.listen(config.port, config.host, () => {
  console.log(`Shahane GPT is running at http://localhost:${config.port}`);
  console.log(`Listening on ${config.host}:${config.port} (local only). Press Ctrl+C to stop.`);

  if (!missing) {
    engine.ping().catch((err) => console.error(`C++ engine warm-up failed: ${err.message}`));
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use.`);
    console.error('Close the other program using it, or start on another port with PORT=3001 (see README).');
  } else {
    console.error(`Server failed to start: ${err.message}`);
  }
  process.exit(1);
});

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nShutting down...');
  engine.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
