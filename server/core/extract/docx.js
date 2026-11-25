// Извлечение DOCX: заголовки и списки сохраняем как структуру, а не как «просто текст».
import mammoth from 'mammoth';
import { normalizeText, titleFromText } from './index.js';
import { docFromBlocks, heading, paragraph, list } from '../text/ast.js';

export async function extractDocx(buffer, filename) {
  const result = await mammoth.convertToHtml({ buffer });
  const html = result.value || '';
  const ast = htmlToAst(html);
  const text = normalizeText(blocksToText(ast.blocks));
  return {
    text,
    ast,
    meta: {
      source: 'file',
      kind: 'docx',
      filename,
      chars: text.length,
      warnings: (result.messages || []).slice(0, 10).map((m) => m.message),
    },
    title: titleFromText(text),
  };
}

function htmlToAst(html) {
  const blocks = [];
  // Простой разбор без DOM: разбиваем по блокам верхнего уровня.
  const tagRe = /<(h[1-6]|p|li|ul|ol|table|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  let listBuffer = null;

  const flushList = () => {
    if (listBuffer && listBuffer.items.length) blocks.push(list(listBuffer.items, listBuffer.ordered));
    listBuffer = null;
  };

  while ((match = tagRe.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const inner = match[2];
    if (tag === 'ul' || tag === 'ol') {
      flushList();
      const items = [];
      const itemRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
      let item;
      while ((item = itemRe.exec(inner)) !== null) items.push(stripTags(item[1]));
      if (items.length) blocks.push(list(items.filter(Boolean), tag === 'ol'));
      continue;
    }
    if (tag === 'li') {
      if (!listBuffer) listBuffer = { items: [], ordered: false };
      const value = stripTags(inner);
      if (value) listBuffer.items.push(value);
      continue;
    }
    flushList();
    if (/^h[1-6]$/.test(tag)) {
      const value = stripTags(inner);
      if (value) blocks.push(heading(value, Math.min(4, Number(tag[1]))));
      continue;
    }
    if (tag === 'p' || tag === 'blockquote') {
      const value = stripTags(inner);
      if (value) blocks.push(paragraph(value));
      continue;
    }
    if (tag === 'table') {
      // Таблицы DOCX конвертим в строки «a | b | c» — структура сохраняется в тексте.
      const rows = [];
      const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
      let row;
      while ((row = rowRe.exec(inner)) !== null) {
        const cells = [];
        const cellRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
        let cell;
        while ((cell = cellRe.exec(row[1])) !== null) cells.push(stripTags(cell[1]));
        if (cells.length) rows.push(cells);
      }
      if (rows.length) blocks.push({ id: `t${blocks.length}`, type: 'table', rows, header: rows[0] });
    }
  }
  flushList();

  if (!blocks.length) {
    const fallback = stripTags(html);
    if (fallback) blocks.push(paragraph(fallback));
  }
  return docFromBlocks(blocks);
}

function stripTags(html) {
  return decodeEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–');
}

function blocksToText(blocks) {
  return blocks
    .map((block) => {
      if (block.type === 'heading') return `## ${block.text}`;
      if (block.type === 'paragraph') return block.text;
      if (block.type === 'list') return block.items.map((i) => `- ${i}`).join('\n');
      if (block.type === 'table') return block.rows.map((r) => r.join(' | ')).join('\n');
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

