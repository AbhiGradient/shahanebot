import { el, icon } from './dom-core.js';

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\(https:\/\/[^)\s]+\))|(\*[^*\n]+\*)/g;

export function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function inline(text) {
  const nodes = [];
  let last = 0;
  INLINE.lastIndex = 0;
  let match;

  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];

    if (match[1]) {
      nodes.push(el('code', { className: 'inline-code', text: token.slice(1, -1) }));
    } else if (match[2]) {
      nodes.push(el('strong', { text: token.slice(2, -2) }));
    } else if (match[3]) {
      const split = token.indexOf('](');
      const href = safeHttpsUrl(token.slice(split + 2, -1));
      const label = token.slice(1, split);
      nodes.push(
        href
          ? el('a', { text: label, attrs: { href, target: '_blank', rel: 'noopener noreferrer' } })
          : token
      );
    } else {
      nodes.push(el('em', { text: token.slice(1, -1) }));
    }

    last = match.index + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = el('textarea', { attrs: { readonly: '' } });
    area.value = text;
    area.className = 'sr-only';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

export { copyText };

function codeBlock(language, code) {
  const label = el('span', { className: 'code-lang', text: language || 'code' });
  const button = el(
    'button',
    {
      className: 'code-copy',
      attrs: { type: 'button', 'aria-label': 'Copy code' },
      on: {
        click: async () => {
          const span = button.querySelector('span');
          span.textContent = (await copyText(code)) ? 'Copied' : 'Copy failed';
          setTimeout(() => (span.textContent = 'Copy'), 1600);
        }
      }
    },
    [icon('copy'), el('span', { text: 'Copy' })]
  );

  return el('div', { className: 'codeblock' }, [
    el('div', { className: 'code-head' }, [label, button]),
    el('pre', {}, [el('code', { text: code })])
  ]);
}

function splitRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

function table(lines) {
  const head = splitRow(lines[0]);
  const rows = lines.slice(2).map(splitRow);
  return el('div', { className: 'md-table-wrap' }, [
    el('table', { className: 'md-table' }, [
      el('thead', {}, [el('tr', {}, head.map((cell) => el('th', {}, inline(cell))))]),
      el('tbody', {}, rows.map((row) => el('tr', {}, row.map((cell) => el('td', {}, inline(cell))))))
    ])
  ]);
}

export function renderMarkdown(source) {
  const root = el('div', { className: 'md' });
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  let i = 0;

  const isBlockStart = (line) =>
    /^\s*```/.test(line) || /^\s{0,3}#{1,4}\s/.test(line) || /^\s*[-*+]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line) || /^\s*>/.test(line);

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = line.match(/^\s*```\s*([\w+#.-]*)/);
    if (fence) {
      const code = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      root.append(codeBlock(fence[1], code.join('\n')));
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,4})\s+(.*)$/);
    if (heading) {
      root.append(el('p', { className: `md-h md-h${heading[1].length}` }, inline(heading[2])));
      i += 1;
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const rows = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(lines[i]);
        i += 1;
      }
      root.append(table(rows));
      continue;
    }

    const bullet = /^\s*[-*+]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const pattern = ordered ? numbered : bullet;
      const items = [];
      while (i < lines.length && pattern.test(lines[i])) {
        items.push(el('li', {}, inline(lines[i].replace(pattern, ''))));
        i += 1;
      }
      root.append(el(ordered ? 'ol' : 'ul', { className: 'md-list' }, items));
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      root.append(el('blockquote', {}, inline(quote.join(' '))));
      continue;
    }

    const paragraph = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    if (!paragraph.length) {
      paragraph.push(line);
      i += 1;
    }

    const kids = [];
    paragraph.forEach((text, index) => {
      if (index > 0) kids.push(el('br'));
      kids.push(...inline(text));
    });
    root.append(el('p', {}, kids));
  }

  return root;
}
