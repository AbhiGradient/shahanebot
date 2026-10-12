export class ApiError extends Error {
  constructor(message, { status = 0, code = null, kind = 'server', data = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.kind = kind;
    this.data = data;
  }
}

async function request(path, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(path, {
      ...options,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(options.headers || {}) }
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      throw new ApiError((data && data.error) || 'The request failed.', {
        status: response.status,
        code: data && data.code,
        kind: 'server',
        data
      });
    }

    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.name === 'AbortError') throw new ApiError('The request timed out.', { kind: 'timeout' });
    throw new ApiError('Could not reach the local server.', { kind: 'network' });
  } finally {
    clearTimeout(timer);
  }
}

export function getHealth() {
  return request('/api/health', {}, 6000);
}

export async function getQuestions() {
  const data = await request('/api/questions');
  return Array.isArray(data.questions) ? data.questions : [];
}

export function sendMessage({ message, history, webSearch }) {
  return request(
    '/api/chat',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history, webSearch })
    },
    60000
  );
}
