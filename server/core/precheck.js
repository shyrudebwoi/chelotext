// Предпроверка контента (ТЗ 4.6): блокируем незаконное и чужие авторские тексты целиком,
// научные статьи пропускаем. Работает на стоп-маркерах + эвристике, без внешних сервисов.
import { ILLEGAL_MARKERS, COPYRIGHT_MARKERS, SCIENTIFIC_MARKERS } from './rules/dictionaries.js';
import { cyrify } from '../lib/regex.js';

const REASONS = {
  illegal: {
    title: 'Этот текст мы не можем обработать',
    message: 'В тексте есть признаки недопустимого содержания. Мы не обрабатываем такие материалы.',
  },
  copyright: {
    title: 'Похоже, это чужой текст целиком',
    message: 'Мы не перерабатываем чужие авторские материалы целиком. Вставь свой текст или его часть, которую ты вправе менять.',
  },
  empty: {
    title: 'Пусто',
    message: 'Вставь текст — и мы его переделаем.',
  },
  tooShort: {
    title: 'Слишком мало текста',
    message: 'Нужно хотя бы 80 знаков, чтобы было что переделывать.',
  },
};

export const PRECHECK_MIN_CHARS = 80;

/**
 * @returns {{ ok: boolean, code?: string, reason?: {title:string,message:string}, scientific: boolean, details?: object }}
 */
export function precheck(text) {
  const src = String(text ?? '').trim();
  const chars = src.length;

  if (!chars) return { ok: false, code: 'empty', reason: REASONS.empty, scientific: false };
  if (chars < PRECHECK_MIN_CHARS) return { ok: false, code: 'tooShort', reason: REASONS.tooShort, scientific: false };

  const scientific = isScientific(src);

  // 1. Незаконный контент — блокируем всегда.
  for (const marker of ILLEGAL_MARKERS) {
    const base = cyrify(marker.re);
    const re = new RegExp(base.source, base.flags.includes('g') ? base.flags : `${base.flags}g`);
    const m = re.exec(src);
    if (m) {
      return {
        ok: false,
        code: 'illegal',
        reason: REASONS.illegal,
        scientific,
        details: { marker: marker.code, excerpt: excerptAround(src, m.index, m[0].length) },
      };
    }
  }

  // 2. Чужой авторский текст целиком — не трогаем, но научные статьи разрешены.
  if (!scientific) {
    const copyrightHits = COPYRIGHT_MARKERS.filter((re) => cyrify(re).test(src)).length;
    const longEnough = chars >= 1200;
    if (copyrightHits >= 1 && longEnough) {
      return {
        ok: false,
        code: 'copyright',
        reason: REASONS.copyright,
        scientific,
        details: { copyrightHits, chars },
      };
    }
  }

  return { ok: true, scientific };
}

export function isScientific(text) {
  const hits = SCIENTIFIC_MARKERS.filter((re) => cyrify(re).test(text)).length;
  // Порог: 3 разных признака. Один случайный — не повод считать текст научным.
  return hits >= 3;
}

function excerptAround(text, index, length) {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + length + 40);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}
