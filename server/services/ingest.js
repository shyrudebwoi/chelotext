// Приём материалов: paste / url / file → документ + задача.
import { config } from '../config.js';
import { fromPaste, fromFile, normalizeText, titleFromText } from '../core/extract/index.js';
import { createDocument } from './documents.js';

/**
 * Извлекает текст из файла. Для PDF сообщает о страницах и OCR.
 */
export async function extractFile(file, { onProgress = () => {}, isCancelled = () => false } = {}) {
  if (isCancelled()) throw Object.assign(new Error('Отменено'), { code: 'cancelled' });
  onProgress(5, 'extract');
  const result = await fromFile({ buffer: file.buffer, filename: file.originalname || file.filename, mimetype: file.mimetype });
  if (isCancelled()) throw Object.assign(new Error('Отменено'), { code: 'cancelled' });
  onProgress(100, 'extract');
  return result;
}

export async function extractUrlText(url) {
  const { extractUrl } = await import('../core/extract/url.js');
  return extractUrl(url);
}

export function ingestPaste({ userId, text }) {
  const normalized = normalizeText(text);
  const extracted = fromPaste(normalized);
  const documentId = createDocument({
    userId,
    source: 'paste',
    text: extracted.text,
    title: titleFromText(extracted.text),
    meta: extracted.meta,
    ast: extracted.ast,
  });
  return { documentId, ...extracted };
}

export function ingestText({ userId, text, source = 'paste', title, meta, ast, pageCount, fromOcr, ocrConfidence }) {
  const normalized = normalizeText(text);
  const documentId = createDocument({
    userId,
    source,
    text: normalized,
    title: title || titleFromText(normalized),
    meta,
    ast,
    pageCount,
    fromOcr,
    ocrConfidence,
  });
  return { documentId, text: normalized, ast };
}

// Скан-PDF всегда в очередь (ТЗ 5). Обычный PDF с текстовым слоем может идти синхронно,
// если текст короткий.
export function needsAsync({ source, text, meta }) {
  if (source === 'file' && meta?.kind === 'pdf' && meta?.fromOcr) return true;
  return String(text || '').length > config.syncMaxChars;
}

export function checkCharLimit(text) {
  const length = String(text || '').length;
  if (length > config.limits.maxChars) {
    return {
      ok: false,
      error: `Слишком длинно. Убери лишнее — до ${config.limits.maxChars.toLocaleString('ru-RU')} знаков`,
      code: 'too_long',
      chars: length,
      max: config.limits.maxChars,
    };
  }
  return { ok: true, chars: length };
}
