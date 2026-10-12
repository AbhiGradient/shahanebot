import { ApiError, getHealth, getQuestions, sendMessage } from './api.js';
import { botMessage, el, icon, stateCard, typingMessage, userMessage } from './dom.js';

const $ = (id) => document.getElementById(id);

const ui = {
  sidebar: $('sidebar'),
  scrim: $('scrim'),
  conversation: $('conversation'),
  welcome: $('welcome'),
  messages: $('messages'),
  suggestionGrid: $('suggestionGrid'),
  welcomeActions: $('welcomeActions'),
  sidebarQuestions: $('sidebarQuestions'),
  input: $('input'),
  sendBtn: $('sendBtn'),
  clearInput: $('clearInput'),
  clearChat: $('clearChat'),
  counter: $('counter'),
  searchToggle: $('searchToggle'),
  statusPill: $('statusPill'),
  sidebarStatus: $('sidebarStatus'),
  browseDialog: $('browseDialog'),
  browseSearch: $('browseSearch'),
  browseList: $('browseList'),
  browseCount: $('browseCount'),
  browseState: $('browseState'),
  toast: $('toast'),
  toastText: $('toastText'),
  toastAction: $('toastAction')
};

const DEMO_PROMPTS = [
  'What is a constructor in C++?',
  'Explain the difference between a constructor and a member function',
  'Write a C++ program to reverse an array',
  'Explain inheritance and polymorphism',
  'Explain binary search and its time complexity',
  'What causes rain?',
  'Explain the quadratic equation x² - 5x + 6 = 0',
  'What are the newest features of the latest C++ standard? Give sources.'
];

const STORE_KEY = 'shahane-gpt.session.v1';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const state = {
  busy: false,
  chat: [],
  webSearch: false,
  health: null,
  maxLength: 4000,
  questions: [],
  questionsStatus: 'loading',
  order: [],
  snapshot: null,
  toastTimer: null
};

function loadSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
    if (saved && Array.isArray(saved.chat)) {
      state.chat = saved.chat.filter((m) => m && typeof m.text === 'string' && (m.role === 'user' || m.role === 'assistant'));
      state.webSearch = saved.webSearch === true;
    }
  } catch {
    state.chat = [];
  }
}

function saveSession() {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify({ chat: state.chat.slice(-60), webSearch: state.webSearch }));
  } catch {
    /* storage can be unavailable; the chat still works */
  }
}

function setStatus(tone, label) {
  for (const node of [ui.statusPill, ui.sidebarStatus]) {
    node.dataset.state = tone;
    node.querySelector('.status-text').textContent = label;
  }
}

function applyHealth(health) {
  state.health = health;
  if (typeof health.maxQuestionLength === 'number') {
    state.maxLength = health.maxQuestionLength;
    ui.input.maxLength = health.maxQuestionLength;
  }

  const aiOk = health.ai && health.ai.configured;
  const cppOk = health.engine && health.engine.state === 'ready';

  if (!aiOk) setStatus('warn', 'API key missing');
  else if (!cppOk) setStatus('warn', 'AI ready · C++ offline');
  else setStatus('ready', 'AI + C++ ready');

  const searchOff = health.ai && health.ai.grounding === 'off';
  ui.searchToggle.disabled = searchOff;
  ui.searchToggle.title = searchOff
    ? 'Web search is turned off in the .env file (GEMINI_GROUNDING=off)'
    : 'Ask Gemini to use Google Search and return source links';
  renderWelcomeNotice();
}

function shuffle(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function scrollToEnd() {
  ui.conversation.scrollTo({ top: ui.conversation.scrollHeight, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
}

function hasMessages() {
  return state.chat.length > 0 || ui.messages.childElementCount > 0;
}

function syncView() {
  ui.welcome.hidden = hasMessages();
  ui.clearChat.disabled = !hasMessages();
}

function syncToggle() {
  ui.searchToggle.setAttribute('aria-pressed', String(state.webSearch));
  ui.searchToggle.classList.toggle('on', state.webSearch);
}

function syncComposer() {
  const value = ui.input.value;
  ui.sendBtn.disabled = state.busy || !value.trim();
  ui.clearInput.hidden = value.length === 0;

  const nearLimit = value.length >= state.maxLength * 0.8;
  ui.counter.hidden = !nearLimit;
  ui.counter.textContent = `${value.length} / ${state.maxLength}`;
  ui.counter.classList.toggle('near', value.length >= state.maxLength * 0.95);

  ui.input.style.height = 'auto';
  ui.input.style.height = `${Math.min(ui.input.scrollHeight, 168)}px`;
}

function setBusy(value) {
  state.busy = value;
  syncComposer();
  document.querySelectorAll('.suggestion-card, .question-item').forEach((node) => {
    node.disabled = value;
  });
}

function showToast(message, action) {
  clearTimeout(state.toastTimer);
  ui.toastText.textContent = message;
  ui.toastAction.hidden = !action;
  ui.toastAction.onclick = action || null;
  ui.toast.hidden = false;
  state.toastTimer = setTimeout(hideToast, 5000);
}

function hideToast() {
  clearTimeout(state.toastTimer);
  ui.toast.hidden = true;
}

function renderWelcomeNotice() {
  const old = document.getElementById('setupNotice');
  if (old) old.remove();
  const health = state.health;
  if (!health || (health.ai && health.ai.configured)) return;

  const card = stateCard({
    title: 'Add your Gemini API key to enable AI answers',
    message: 'Open the .env file in the project folder, replace PASTE_YOUR_API_KEY_HERE with your key, save it, and restart the server (get a free key at aistudio.google.com/apikey).'
  });
  card.id = 'setupNotice';
  ui.suggestionGrid.before(card);
}

function renderSuggestions() {
  ui.suggestionGrid.replaceChildren();
  ui.sidebarQuestions.replaceChildren();

  DEMO_PROMPTS.forEach((prompt) => {
    ui.suggestionGrid.append(
      el('button', { className: 'suggestion-card', attrs: { type: 'button' }, on: { click: () => send(prompt) } }, [
        el('span', { text: prompt }),
        icon('arrow')
      ])
    );
  });

  ui.welcomeActions.hidden = false;

  if (state.questionsStatus === 'loading') {
    ui.sidebarQuestions.append(el('li', { className: 'bubble-note', text: 'Loading…' }));
    return;
  }

  if (state.questionsStatus === 'error') {
    ui.sidebarQuestions.append(el('li', { className: 'bubble-note', text: 'The Q&A file could not be loaded (C++ engine offline).' }));
    return;
  }

  if (!state.questions.length) {
    ui.sidebarQuestions.append(el('li', { className: 'bubble-note', text: 'No questions in the Q&A file.' }));
    return;
  }

  state.order.slice(0, 8).forEach((index) => {
    const question = state.questions[index];
    ui.sidebarQuestions.append(
      el('li', {}, [
        el('button', {
          className: 'question-item',
          text: question,
          attrs: { type: 'button', title: question },
          on: {
            click: () => {
              closeDrawer();
              send(question);
            }
          }
        })
      ])
    );
  });
}

function reshuffle() {
  state.order = shuffle(state.questions.map((_, index) => index));
  renderSuggestions();
}

async function loadQuestions() {
  state.questionsStatus = 'loading';
  renderSuggestions();

  try {
    state.questions = await getQuestions();
    state.questionsStatus = 'ready';
    state.order = shuffle(state.questions.map((_, index) => index));
  } catch {
    state.questionsStatus = 'error';
  }

  renderSuggestions();
}

async function checkHealth({ retries = 0 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      applyHealth(await getHealth());
      return true;
    } catch {
      if (attempt >= retries) {
        setStatus('error', 'Server unreachable');
        return false;
      }
      setStatus('checking', 'Starting up…');
      await sleep(700);
    }
  }
}

function renderChat() {
  ui.messages.replaceChildren();
  for (const message of state.chat) {
    ui.messages.append(message.role === 'user' ? userMessage(message.text, message.time) : botMessage(message, { onToast: showToast }));
  }
  syncView();
}

async function initialize() {
  setStatus('checking', 'Checking status…');
  renderSuggestions();
  await checkHealth({ retries: 4 });

  if (state.health && state.health.engine && state.health.engine.state === 'ready') {
    await loadQuestions();
  } else {
    state.questionsStatus = 'error';
    renderSuggestions();
  }
}

function friendlyError(error) {
  if (error.kind === 'timeout') return { message: 'The request timed out before an answer arrived.', note: 'Please try again in a moment.' };
  if (error.kind === 'network') return { message: 'I could not reach the local server.', note: 'Check that the terminal running npm start is still open.' };
  if (error.code === 'missing-key') return { message: error.message, note: 'The .env file is in the project folder, next to package.json.' };
  if (error.status === 400) return { message: error.message, note: null };
  return { message: error.message || 'Something went wrong while generating an answer.', note: 'Your message is kept, so you can try again.' };
}

function historyForServer() {
  return state.chat.slice(0, -1).map((m) => ({ role: m.role, text: m.text }));
}

async function runQuery(text) {
  setBusy(true);
  const typing = typingMessage(state.webSearch ? 'Thinking and searching the web…' : 'Thinking…');
  ui.messages.append(typing);
  scrollToEnd();

  try {
    const reply = await sendMessage({ message: text, history: historyForServer(), webSearch: state.webSearch });
    typing.remove();

    const message = {
      role: 'assistant',
      text: reply.answer,
      sources: reply.sources || [],
      notice: reply.notice || null,
      via: reply.via,
      model: reply.model,
      grounded: reply.grounded === true,
      time: Date.now()
    };

    state.chat.push(message);
    saveSession();
    ui.messages.append(botMessage(message, { onToast: showToast }));
  } catch (error) {
    typing.remove();
    const apiError = error instanceof ApiError ? error : new ApiError('Unexpected error');
    const { message, note } = friendlyError(apiError);

    const row = botMessage(
      { text: message, time: Date.now() },
      {
        variant: 'error',
        note,
        actions:
          apiError.status === 400
            ? []
            : [
                {
                  label: 'Retry',
                  iconName: 'refresh',
                  onClick: () => {
                    row.remove();
                    runQuery(text);
                  }
                }
              ]
      }
    );

    ui.messages.append(row);
    checkHealth();
  } finally {
    setBusy(false);
    syncView();
    scrollToEnd();
    if (!ui.browseDialog.open && !ui.sidebar.classList.contains('open')) ui.input.focus();
  }
}

function send(raw) {
  const text = String(raw).trim();
  if (!text || state.busy) return;

  if (text.length > state.maxLength) {
    showToast(`Please keep messages under ${state.maxLength} characters.`);
    return;
  }

  state.snapshot = null;
  hideToast();
  document.querySelectorAll('.msg.error').forEach((node) => node.remove());

  const message = { role: 'user', text, time: Date.now() };
  state.chat.push(message);
  saveSession();
  ui.messages.append(userMessage(text, message.time));
  ui.input.value = '';
  syncComposer();
  syncView();
  runQuery(text);
}

function clearConversation() {
  if (state.busy || !hasMessages()) return;

  state.snapshot = state.chat.slice();
  state.chat = [];
  saveSession();
  ui.messages.replaceChildren();
  syncView();
  ui.conversation.scrollTo({ top: 0 });

  showToast('Conversation cleared', () => {
    if (!state.snapshot) return;
    state.chat = state.snapshot;
    state.snapshot = null;
    saveSession();
    renderChat();
    hideToast();
    scrollToEnd();
  });
}

function openDrawer() {
  ui.sidebar.classList.add('open');
  ui.scrim.hidden = false;
  ui.sidebar.querySelector('button').focus();
}

function closeDrawer() {
  if (!ui.sidebar.classList.contains('open')) return;
  ui.sidebar.classList.remove('open');
  ui.scrim.hidden = true;
}

function renderBrowseList() {
  const term = ui.browseSearch.value.trim().toLowerCase();
  ui.browseList.replaceChildren();
  ui.browseState.replaceChildren();
  ui.browseState.hidden = true;

  if (state.questionsStatus !== 'ready') {
    ui.browseCount.textContent = '';
    ui.browseState.hidden = false;
    ui.browseState.append(
      stateCard({
        title: 'Q&A file unavailable',
        message: 'The question list comes from the C++ engine, which is not ready. Build it with npm run build:cpp.',
        actionLabel: 'Try again',
        onAction: async () => {
          await initialize();
          renderBrowseList();
        }
      })
    );
    return;
  }

  const matches = term ? state.questions.filter((q) => q.toLowerCase().includes(term)) : state.questions;

  if (!matches.length) {
    ui.browseCount.textContent = '0 results';
    ui.browseState.hidden = false;
    ui.browseState.append(stateCard({ title: 'No matching questions', message: `Nothing in the Q&A file matches “${ui.browseSearch.value.trim()}”.`, iconName: 'search' }));
    return;
  }

  ui.browseCount.textContent = term ? `${matches.length} of ${state.questions.length} questions` : `${state.questions.length} questions`;

  const fragment = document.createDocumentFragment();
  matches.slice(0, 300).forEach((question) => {
    fragment.append(
      el('li', {}, [
        el('button', {
          className: 'browse-item',
          text: question,
          attrs: { type: 'button' },
          on: {
            click: () => {
              ui.browseDialog.close();
              send(question);
            }
          }
        })
      ])
    );
  });
  ui.browseList.append(fragment);
}

function openBrowse() {
  closeDrawer();
  ui.browseSearch.value = '';
  renderBrowseList();
  if (!ui.browseDialog.open) ui.browseDialog.showModal();
  ui.browseSearch.focus();
}

ui.input.addEventListener('input', syncComposer);

ui.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send(ui.input.value);
  }
});

ui.sendBtn.addEventListener('click', () => send(ui.input.value));

ui.clearInput.addEventListener('click', () => {
  ui.input.value = '';
  syncComposer();
  ui.input.focus();
});

ui.searchToggle.addEventListener('click', () => {
  state.webSearch = !state.webSearch;
  syncToggle();
  saveSession();
  showToast(state.webSearch ? 'Web search is on for your next messages' : 'Web search is off (it may still run for questions about current events)');
});

$('newChat').addEventListener('click', () => {
  closeDrawer();
  if (hasMessages()) clearConversation();
  ui.input.focus();
});

ui.clearChat.addEventListener('click', () => {
  closeDrawer();
  clearConversation();
});

$('menuBtn').addEventListener('click', openDrawer);
$('drawerClose').addEventListener('click', closeDrawer);
ui.scrim.addEventListener('click', closeDrawer);

$('shuffleSidebar').addEventListener('click', reshuffle);
$('shuffleWelcome').addEventListener('click', reshuffle);
$('browseBtn').addEventListener('click', openBrowse);
$('browseWelcome').addEventListener('click', openBrowse);
$('browseClose').addEventListener('click', () => ui.browseDialog.close());
ui.browseSearch.addEventListener('input', renderBrowseList);

ui.browseDialog.addEventListener('click', (event) => {
  if (event.target === ui.browseDialog) ui.browseDialog.close();
});

ui.browseDialog.addEventListener('close', () => ui.input.focus());

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeDrawer();
});

window.matchMedia('(min-width: 901px)').addEventListener('change', (event) => {
  if (event.matches) closeDrawer();
});

setInterval(() => {
  if (document.hidden || state.busy) return;
  const wasReady = state.questionsStatus === 'ready';
  checkHealth().then((ok) => {
    if (ok && !wasReady && state.health.engine.state === 'ready') loadQuestions();
  });
}, 20000);

loadSession();
renderChat();
syncToggle();
syncComposer();
initialize().then(() => {
  ui.input.focus();
  if (state.chat.length) scrollToEnd();
});
