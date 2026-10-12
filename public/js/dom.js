import { el, icon } from './dom-core.js';
import { copyText, renderMarkdown, safeHttpsUrl } from './markdown.js';

export { el, icon };

const KIND_LABEL = { web: 'Web', reference: 'Reference', search: 'Search' };

function formatTime(value) {
  return new Date(value || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function avatar() {
  return el('span', { className: 'avatar' }, [icon('logo')]);
}

export function userMessage(text, time) {
  return el('article', { className: 'msg user' }, [
    el('div', { className: 'msg-body' }, [
      el('div', { className: 'bubble', text }),
      el('span', { className: 'meta', text: `You · ${formatTime(time)}` })
    ])
  ]);
}

function sourceList(sources) {
  const items = [];
  for (const source of sources || []) {
    const href = safeHttpsUrl(source.url);
    if (!href) continue;
    items.push(
      el('li', {}, [
        el('a', {
          className: 'source-link',
          attrs: { href, target: '_blank', rel: 'noopener noreferrer' }
        }, [
          icon('link'),
          el('span', { className: 'source-title', text: String(source.title || href).slice(0, 120) }),
          el('span', { className: 'source-kind', text: KIND_LABEL[source.kind] || 'Link' })
        ])
      ])
    );
  }
  if (!items.length) return null;
  return el('div', { className: 'sources' }, [el('p', { className: 'sources-label', text: 'Sources' }), el('ul', {}, items)]);
}

function viaLabel(message) {
  if (message.via === 'cpp-calculator') return 'Calculated by the C++ engine';
  if (message.via === 'local-fallback') return 'Local C++ Q&A file (AI unavailable)';
  if (message.via === 'gemini') return message.grounded ? `${message.model || 'Gemini'} · web-grounded` : message.model || 'Gemini';
  return 'Shahane GPT';
}

export function botMessage(message, { variant = 'answer', note, actions = [], onToast } = {}) {
  const bubble = el('div', { className: 'bubble' });

  if (variant === 'error') {
    bubble.textContent = message.text;
    if (note) bubble.append(el('p', { className: 'bubble-note', text: note }));
  } else {
    bubble.append(renderMarkdown(message.text));
    if (message.notice) bubble.append(el('p', { className: 'bubble-note notice', text: message.notice }));
  }

  const body = el('div', { className: 'msg-body' }, [bubble]);

  if (variant !== 'error') {
    const sources = sourceList(message.sources);
    if (sources) body.append(sources);
  }

  const buttons = [...actions];
  if (variant !== 'error') {
    buttons.push({
      label: 'Copy answer',
      iconName: 'copy',
      onClick: async () => onToast && onToast((await copyText(message.text)) ? 'Answer copied' : 'Could not copy')
    });
  }

  if (buttons.length) {
    body.append(
      el(
        'div',
        { className: 'msg-actions' },
        buttons.map(({ label, iconName, onClick }) =>
          el('button', { className: 'btn btn-secondary', attrs: { type: 'button' }, on: { click: onClick } }, [
            ...(iconName ? [icon(iconName)] : []),
            el('span', { text: label })
          ])
        )
      )
    );
  }

  body.append(el('span', { className: 'meta', text: `${variant === 'error' ? 'Shahane GPT' : viaLabel(message)} · ${formatTime(message.time)}` }));

  return el('article', { className: `msg bot ${variant}` }, [avatar(), body]);
}

export function typingMessage(label) {
  const indicator = el('div', { className: 'typing' }, [
    el('span', { className: 'typing-dots', attrs: { 'aria-hidden': 'true' } }, [el('span'), el('span'), el('span')]),
    el('span', { text: label })
  ]);

  return el('article', { className: 'msg bot', attrs: { 'aria-label': 'Shahane GPT is typing' } }, [
    avatar(),
    el('div', { className: 'msg-body' }, [el('div', { className: 'bubble' }, [indicator])])
  ]);
}

export function stateCard({ title, message, iconName = 'alert', actionLabel, onAction }) {
  const card = el('div', { className: 'state-card' }, [icon(iconName), el('strong', { text: title }), el('span', { text: message })]);

  if (actionLabel && onAction) {
    card.append(
      el('button', { className: 'btn btn-secondary', attrs: { type: 'button' }, on: { click: onAction } }, [
        icon('refresh'),
        el('span', { text: actionLabel })
      ])
    );
  }

  return card;
}
