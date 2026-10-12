const { spawn } = require('node:child_process');
const fs = require('node:fs');

function oneLine(text) {
  return String(text).replace(/\s+/g, ' ').trim().slice(0, 500);
}

class EngineError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class ChatbotEngine {
  #config;
  #child = null;
  #waiter = null;
  #buffer = '';
  #tail = Promise.resolve();
  #closing = false;

  constructor(config) {
    this.#config = config;
  }

  checkFiles() {
    if (!fs.existsSync(this.#config.executablePath)) {
      return 'missing-executable';
    }
    if (!fs.existsSync(this.#config.databasePath)) {
      return 'missing-database';
    }
    return null;
  }

  ask(question) {
    const line = 'ASK ' + oneLine(question);
    return this.#enqueue(line, 'answer');
  }

  async calculate(text) {
    const reply = await this.#enqueue('CALC ' + oneLine(text), 'calc');
    return reply.found === true ? reply.answer : null;
  }

  async search(text, limit = 3) {
    const reply = await this.#enqueue(`SEARCH ${limit} ${oneLine(text)}`, 'matches');
    return Array.isArray(reply.matches) ? reply.matches : [];
  }

  async status() {
    const problem = this.checkFiles();
    if (problem) return { state: problem, questions: 0 };
    try {
      return { state: 'ready', questions: await this.ping() };
    } catch {
      return { state: 'unavailable', questions: 0 };
    }
  }

  async listQuestions() {
    const reply = await this.#enqueue('LIST', 'questions');
    return reply.questions;
  }

  async ping() {
    const reply = await this.#enqueue('PING', 'pong');
    return reply.count;
  }

  close() {
    this.#closing = true;
    const child = this.#child;
    if (!child) return;
    try {
      child.stdin.write('QUIT\n');
      child.stdin.end();
    } catch {
      child.kill();
    }
    setTimeout(() => child.kill(), 1000).unref();
  }

  #enqueue(line, expectedType) {
    const run = () => this.#exchange(line, expectedType);
    const result = this.#tail.then(run, run);
    this.#tail = result.catch(() => {});
    return result;
  }

  async #exchange(line, expectedType) {
    const problem = this.checkFiles();
    if (problem) {
      throw new EngineError(problem, `Backend files unavailable: ${problem}`);
    }

    if (!this.#child) {
      await this.#spawn();
    }

    const child = this.#child;
    const pending = this.#expectLine(this.#config.requestTimeoutMs, child);

    child.stdin.write(line + '\n', (err) => {
      if (err && this.#waiter) {
        this.#waiter.reject(new EngineError('unavailable', 'Failed to write to chatbot process'));
      }
    });

    const raw = await pending;
    let reply;

    try {
      reply = JSON.parse(raw);
    } catch {
      this.#discard(child);
      throw new EngineError('protocol', 'Chatbot returned malformed output');
    }

    if (reply.type !== expectedType) {
      throw new EngineError('protocol', `Unexpected chatbot reply type: ${reply.type}`);
    }

    return reply;
  }

  async #spawn() {
    const { executablePath, databasePath, startupTimeoutMs } = this.#config;

    const child = spawn(executablePath, ['--server', '--db', databasePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    this.#child = child;
    this.#buffer = '';
    this.#closing = false;

    child.stdin.on('error', () => {});
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk) => this.#onData(chunk, child));
    child.stderr.on('data', (text) => {
      text.split(/\r?\n/).filter(Boolean).forEach((l) => console.warn(`[chatbot] ${l}`));
    });

    child.on('error', (err) => {
      console.error(`[chatbot] process error: ${err.message}`);
      this.#failWaiter(new EngineError('unavailable', 'Chatbot process could not be started'), child);
    });

    child.on('exit', (code, signal) => {
      if (!this.#closing) {
        console.warn(`[chatbot] process exited (code=${code}, signal=${signal})`);
      }
      this.#failWaiter(new EngineError('unavailable', 'Chatbot process exited'), child);
      if (this.#child === child) this.#child = null;
    });

    const raw = await this.#expectLine(startupTimeoutMs, child);
    let ready;

    try {
      ready = JSON.parse(raw);
    } catch {
      ready = null;
    }

    if (!ready || ready.type !== 'ready') {
      this.#discard(child);
      throw new EngineError('protocol', 'Chatbot did not report ready');
    }

    console.log(`[chatbot] ready, ${ready.count} Q&A pairs loaded`);
  }

  #onData(chunk, child) {
    if (child !== this.#child) return;
    this.#buffer += chunk;

    let index;
    while ((index = this.#buffer.indexOf('\n')) !== -1) {
      const line = this.#buffer.slice(0, index).replace(/\r$/, '');
      this.#buffer = this.#buffer.slice(index + 1);
      if (!line) continue;

      if (this.#waiter) {
        this.#waiter.resolve(line);
      } else {
        console.warn('[chatbot] unexpected output ignored');
      }
    }
  }

  #expectLine(timeoutMs, child) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiter = null;
        this.#discard(child);
        reject(new EngineError('timeout', 'Chatbot did not respond in time'));
      }, timeoutMs);

      this.#waiter = {
        resolve: (line) => {
          clearTimeout(timer);
          this.#waiter = null;
          resolve(line);
        },
        reject: (err) => {
          clearTimeout(timer);
          this.#waiter = null;
          reject(err);
        }
      };
    });
  }

  #failWaiter(error, child) {
    if (child === this.#child || !this.#child) {
      if (this.#waiter) this.#waiter.reject(error);
    }
  }

  #discard(child) {
    if (this.#child === child) {
      this.#child = null;
      this.#buffer = '';
    }
    child.kill();
  }
}

module.exports = { ChatbotEngine, EngineError };
