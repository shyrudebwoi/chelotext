// Единый внутренний AST документа.
// Блоки: heading | paragraph | list | table | quote | footnotes | divider.
// Все режимы R1–R3, diff, экспорт и сохранение структуры PDF работают через этот AST.

export const BLOCK = {
  HEADING: 'heading',
  PARAGRAPH: 'paragraph',
  LIST: 'list',
  TABLE: 'table',
  QUOTE: 'quote',
  FOOTNOTES: 'footnotes',
  DIVIDER: 'divider',
};

let uidCounter = 0;
const nextId = () => `b${(++uidCounter).toString(36)}`;

export function makeBlock(type, data = {}) {
  return { id: data.id || nextId(), type, ...data };
}

export const heading = (text, level = 2) => makeBlock(BLOCK.HEADING, { text: String(text).trim(), level: clampLevel(level) });
export const paragraph = (text) => makeBlock(BLOCK.PARAGRAPH, { text: String(text).trim() });
export const list = (items, ordered = false) =>
  makeBlock(BLOCK.LIST, { ordered: Boolean(ordered), items: items.map((t) => String(t).trim()).filter(Boolean) });
export const table = (rows, header = null) =>
  makeBlock(BLOCK.TABLE, { rows: rows.map((r) => r.map((c) => String(c ?? '').trim())), header });
export const quote = (text) => makeBlock(BLOCK.QUOTE, { text: String(text).trim() });
export const footnotes = (items) => makeBlock(BLOCK.FOOTNOTES, { items: items.map((t) => String(t).trim()) });
export const divider = () => makeBlock(BLOCK.DIVIDER);

function clampLevel(level) {
  const n = Number(level) || 2;
  return Math.min(4, Math.max(1, n));
}

export function emptyDoc() {
  return { version: 1, blocks: [] };
}

export function docFromBlocks(blocks) {
  return { version: 1, blocks };
}

export function blockText(block) {
  switch (block.type) {
    case BLOCK.HEADING:
    case BLOCK.PARAGRAPH:
    case BLOCK.QUOTE:
      return block.text || '';
    case BLOCK.LIST:
      return (block.items || []).join('\n');
    case BLOCK.TABLE:
      return (block.rows || []).map((row) => row.join(' | ')).join('\n');
    case BLOCK.FOOTNOTES:
      return (block.items || []).join('\n');
    default:
      return '';
  }
}

export function astToPlainText(ast) {
  const parts = [];
  for (const block of ast.blocks || []) {
    switch (block.type) {
      case BLOCK.HEADING:
        parts.push(block.text);
        break;
      case BLOCK.PARAGRAPH:
        parts.push(block.text);
        break;
      case BLOCK.QUOTE:
        parts.push(block.text.split('\n').map((line) => `> ${line}`).join('\n'));
        break;
      case BLOCK.LIST:
        block.items.forEach((item, index) => {
          parts.push(`${block.ordered ? `${index + 1}.` : '•'} ${item}`);
        });
        break;
      case BLOCK.TABLE:
        parts.push((block.rows || []).map((row) => row.join(' | ')).join('\n'));
        break;
      case BLOCK.FOOTNOTES:
        block.items.forEach((item, index) => parts.push(`[${index + 1}] ${item}`));
        break;
      case BLOCK.DIVIDER:
        parts.push('---');
        break;
      default:
        break;
    }
  }
  return parts.join('\n\n').trim();
}

export function astToMarkdown(ast) {
  const out = [];
  for (const block of ast.blocks || []) {
    switch (block.type) {
      case BLOCK.HEADING:
        out.push(`${'#'.repeat(block.level || 2)} ${block.text}`);
        break;
      case BLOCK.PARAGRAPH:
        out.push(block.text);
        break;
      case BLOCK.QUOTE:
        out.push(block.text.split('\n').map((line) => `> ${line}`).join('\n'));
        break;
      case BLOCK.LIST: {
        const lines = block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${item}`);
        out.push(lines.join('\n'));
        break;
      }
      case BLOCK.TABLE: {
        const rows = block.rows || [];
        if (!rows.length) break;
        const header = block.header || rows[0];
        const body = block.header ? rows : rows.slice(1);
        const width = Math.max(header.length, ...body.map((r) => r.length));
        const pad = (row) => Array.from({ length: width }, (_, i) => row[i] ?? '');
        out.push(`| ${pad(header).join(' | ')} |`);
        out.push(`| ${pad(header).map(() => '---').join(' | ')} |`);
        for (const row of body) out.push(`| ${pad(row).join(' | ')} |`);
        break;
      }
      case BLOCK.FOOTNOTES:
        out.push(block.items.map((item, index) => `${index + 1}. ${item}`).join('\n'));
        break;
      case BLOCK.DIVIDER:
        out.push('---');
        break;
      default:
        break;
    }
  }
  return out.join('\n\n').trim() + '\n';
}

const escapeHtml = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function astToHtml(ast, { title = 'Челотекст' } = {}) {
  const body = [];
  for (const block of ast.blocks || []) {
    switch (block.type) {
      case BLOCK.HEADING: {
        const level = clampLevel(block.level || 2);
        body.push(`<h${level}>${escapeHtml(block.text)}</h${level}>`);
        break;
      }
      case BLOCK.PARAGRAPH:
        body.push(`<p>${escapeHtml(block.text)}</p>`);
        break;
      case BLOCK.QUOTE:
        body.push(`<blockquote>${escapeHtml(block.text)}</blockquote>`);
        break;
      case BLOCK.LIST: {
        const tag = block.ordered ? 'ol' : 'ul';
        body.push(`<${tag}>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</${tag}>`);
        break;
      }
      case BLOCK.TABLE: {
        const rows = block.rows || [];
        if (!rows.length) break;
        const header = block.header || rows[0];
        const bodyRows = block.header ? rows : rows.slice(1);
        body.push(
          `<table><thead><tr>${header.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>` +
            bodyRows.map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('') +
            '</tbody></table>',
        );
        break;
      }
      case BLOCK.FOOTNOTES:
        body.push(`<ol class="footnotes">${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol>`);
        break;
      case BLOCK.DIVIDER:
        body.push('<hr>');
        break;
      default:
        break;
    }
  }
  return { body: body.join('\n'), title };
}

export function countChars(ast) {
  let total = 0;
  for (const block of ast.blocks || []) {
    const text = blockText(block);
    if (text) total += text.length + 2;
  }
  return total;
}

export function countWords(ast) {
  const text = astToPlainText(ast);
  return (text.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || []).length;
}

// Разбор «сырого» текста в AST. Понимает Markdown-подобную разметку и типовые
// текстовые структуры (нумерованные списки, маркеры, таблицы с |, сноски).
export function parsePlainText(input, { source = 'paste' } = {}) {
  const text = String(input ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\t/g, '    ');
  const blocks = [];

  const lines = text.split('\n');
  let buffer = [];
  const flush = () => {
    if (!buffer.length) return;
    const chunk = buffer.join('\n').trim();
    buffer = [];
    if (!chunk) return;
    const paragraphs = chunk.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    for (const p of paragraphs) {
      const singleLine = p.replace(/\n/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
      if (singleLine) blocks.push(paragraph(singleLine));
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Пустая строка — граница абзаца
    if (!trimmed) {
      flush();
      i += 1;
      continue;
    }

    // Markdown-заголовок
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      flush();
      blocks.push(heading(headingMatch[2], headingMatch[1].length));
      i += 1;
      continue;
    }

    // Разделитель
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush();
      blocks.push(divider());
      i += 1;
      continue;
    }

    // Цитата
    if (/^>\s?/.test(trimmed)) {
      flush();
      const quoteLines = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push(quote(quoteLines.join('\n').trim()));
      continue;
    }

    // Таблица Markdown
    if (/^\|.*\|$/.test(trimmed) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      flush();
      const rows = [];
      let headerRow = null;
      const headerCells = splitTableRow(trimmed);
      headerRow = headerCells;
      i += 2;
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        rows.push(splitTableRow(lines[i].trim()));
        i += 1;
      }
      blocks.push(table(rows, headerRow));
      continue;
    }

    // Список
    const listMatch = /^(\s*)([-•*]|\d{1,3}[.)])\s+(.*)$/.exec(line);
    if (listMatch) {
      flush();
      const ordered = /\d/.test(listMatch[2]);
      const items = [];
      while (i < lines.length) {
        const m = /^(\s*)([-•*]|\d{1,3}[.)])\s+(.*)$/.exec(lines[i]);
        if (!m || /\d/.test(m[2]) !== ordered) break;
        items.push(m[3].trim());
        i += 1;
      }
      if (items.length >= 2) {
        blocks.push(list(items, ordered));
      } else {
        blocks.push(paragraph(items[0]));
      }
      continue;
    }

    buffer.push(line);
    i += 1;
  }
  flush();

  return { version: 1, blocks, source };
}

function splitTableRow(line) {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

// Склейка AST обратно в текст с сохранением разметки — для экспорта и правок.
export function astFromEditedText(text) {
  return parsePlainText(text);
}

export function cloneAst(ast) {
  return JSON.parse(JSON.stringify(ast));
}

export function astStats(ast) {
  const plain = astToPlainText(ast);
  const blocks = ast.blocks || [];
  return {
    chars: plain.length,
    words: (plain.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || []).length,
    sentences: (plain.match(/[^.!?…]+[.!?…]+/g) || []).length,
    paragraphs: blocks.filter((b) => b.type === BLOCK.PARAGRAPH).length,
    headings: blocks.filter((b) => b.type === BLOCK.HEADING).length,
    lists: blocks.filter((b) => b.type === BLOCK.LIST).length,
    tables: blocks.filter((b) => b.type === BLOCK.TABLE).length,
    avgSentenceLength: averageSentenceLength(plain),
  };
}

export function averageSentenceLength(plain) {
  const sentences = plain.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter((s) => s.length > 1);
  if (!sentences.length) return 0;
  const words = sentences.map((s) => (s.match(/[\p{L}\p{N}]+/gu) || []).length);
  return Math.round((words.reduce((a, b) => a + b, 0) / words.length) * 10) / 10;
}
