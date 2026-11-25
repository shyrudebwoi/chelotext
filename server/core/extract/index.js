// Извлечение текста: paste | url | file (txt/md/docx/pdf).
// Все пути возвращают единый результат: { text, ast, meta }.
import { parsePlainText } from '../text/ast.js';

export const SOURCE = {
  PASTE: 'paste',
  URL: 'url',
  FILE: 'file',
};

export function fromPaste(text) {
  const normalized = normalizeText(text);
  return {
    text: normalized,
    ast: parsePlainText(normalized),
    meta: { source: SOURCE.PASTE, chars: normalized.length },
  };
}

export function normalizeText(input) {
  return String(input ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/\t/g, '    ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

// Универсальная точка входа для файлов.
export async function fromFile({ buffer, filename, mimetype }) {
  const name = String(filename || '').toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';

  if (ext === 'txt' || ext === 'md' || ext === 'markdown' || mimetype === 'text/plain' || mimetype === 'text/markdown') {
    const text = normalizeText(buffer.toString('utf8'));
    return { text, ast: parsePlainText(text), meta: { source: SOURCE.FILE, kind: 'text', filename, chars: text.length } };
  }

  if (ext === 'docx') {
    const { extractDocx } = await import('./docx.js');
    return extractDocx(buffer, filename);
  }

  if (ext === 'pdf') {
    const { extractPdf } = await import('./pdf.js');
    return extractPdf(buffer, filename);
  }

  throw Object.assign(new Error('Этот формат пока не умеем. Подойдут TXT, MD, DOCX или PDF'), {
    code: 'unsupported_format',
    status: 415,
  });
}

export function titleFromText(text) {
  const firstLine = String(text || '').split('\n').map((l) => l.trim()).find(Boolean);
  if (!firstLine) return null;
  const cleaned = firstLine.replace(/^#{1,6}\s*/, '').replace(/[.:;]+$/, '');
  return cleaned.length > 90 ? `${cleaned.slice(0, 87)}…` : cleaned;
}
