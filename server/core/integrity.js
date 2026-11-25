// Контроль целостности: сверяем числа, даты, имена и цитаты между входом и выходом.
// Это главный технический ответ на требование «сохранить смысл».
import { astToPlainText } from './text/ast.js';

const NUMBER_RE = /(?<![\p{L}\d])\d+(?:[.,]\d+)?(?![\p{L}\d])/gu;
const DATE_RE = /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{4}\s*(?:год|года|году|г\.)/giu;
const QUOTE_RE = /«[^»]{1,600}»|“[^”]{1,600}”|"[^"\n]{1,600}"/gu;
const URL_RE = /https?:\/\/\S+/gu;
const CAPITALIZED_RE = /(?<![\p{L}])\p{Lu}[\p{L}-]{2,}(?:\s+\p{Lu}[\p{L}-]{2,})?/gu;

function collect(text) {
  const src = String(text || '');
  const dateMatches = src.match(DATE_RE) || [];
  // Регистр для дат не значим: capitalizeStart поднимает «г.» → «Г.» на старте
  // абзаца, и сверка с учётом регистра дала бы ложную «потерю».
  const dates = dateMatches.map((d) => d.replace(/\s+/g, ' ').trim().toLowerCase());
  // Дату не считаем набором чисел: маскируем её целиком, чтобы «01.02.2026»
  // не давало три отдельных числа, но отдельные числа рядом остались.
  let masked = src;
  for (const date of dateMatches) {
    masked = masked.split(date).join(' ');
  }
  return {
    numbers: unique(masked.match(NUMBER_RE) || []),
    dates: unique(dates),
    quotes: unique((src.match(QUOTE_RE) || []).map(normalizeQuote)),
    urls: unique(src.match(URL_RE) || []),
    capitalized: unique(src.match(CAPITALIZED_RE) || []),
  };
}

function unique(list) {
  return Array.from(new Set(list.map((s) => String(s).trim()).filter(Boolean)));
}

function normalizeQuote(q) {
  return q.replace(/^[«“"]|[»”"]$/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

const STOP_CAPS = new Set([
  'Это', 'Его', 'Она', 'Они', 'Онo', 'Он', 'Но', 'Так', 'Там', 'Тут', 'Тогда', 'Теперь', 'Когда', 'Если',
  'Что', 'Как', 'Все', 'Этот', 'Эта', 'Эти', 'Например', 'Однако', 'Поэтому', 'Кроме', 'После', 'Перед',
  'Через', 'Между', 'Также', 'Более', 'Можно', 'Нужно', 'Важно', 'Главное', 'При', 'Для', 'Причём',
]);

// Убираем заглавные буквы на старте предложения — они не имена.
function meaningfulCapitals(text, caps) {
  const sentencesStarts = new Set();
  const src = String(text || '');
  for (const m of src.matchAll(/[.!?…]\s+(\p{Lu}[\p{L}-]+)/gu)) sentencesStarts.add(m[1]);
  for (const m of src.matchAll(/^(\p{Lu}[\p{L}-]+)/gu)) sentencesStarts.add(m[1]);
  return caps.filter((word) => {
    if (STOP_CAPS.has(word)) return false;
    if (sentencesStarts.has(word) && word.length < 10) return false;
    return true;
  });
}

/**
 * Сверяет вход и выход. Возвращает:
 * - ok: bool — нет потерь
 * - missing: что пропало
 * - added: что появилось нового (числа/даты/цитаты)
 * - score: 0..1 — доля сохранённых сущностей
 */
export function checkIntegrity(inputText, outputText) {
  const before = collect(inputText);
  const after = collect(outputText);

  const missingNumbers = diffList(before.numbers, after.numbers);
  const missingDates = diffList(before.dates, after.dates);
  const missingUrls = diffList(before.urls, after.urls);
  const missingQuotes = before.quotes.filter((q) => !after.quotes.includes(q));

  const beforeCaps = meaningfulCapitals(inputText, before.capitalized);
  const missingNames = beforeCaps.filter((name) => !after.capitalized.includes(name));

  const addedNumbers = diffList(after.numbers, before.numbers);
  const addedDates = diffList(after.dates, before.dates);

  const totalEntities = before.numbers.length + before.dates.length + before.quotes.length + before.urls.length + beforeCaps.length;
  const lostEntities = missingNumbers.length + missingDates.length + missingQuotes.length + missingUrls.length + missingNames.length;
  const score = totalEntities ? round((totalEntities - lostEntities) / totalEntities) : 1;

  return {
    ok: lostEntities === 0 && addedNumbers.length === 0 && addedDates.length === 0,
    score,
    missing: {
      numbers: missingNumbers,
      dates: missingDates,
      quotes: missingQuotes.slice(0, 20),
      urls: missingUrls,
      names: missingNames.slice(0, 40),
    },
    added: { numbers: addedNumbers, dates: addedDates },
    checked: {
      numbers: before.numbers.length,
      dates: before.dates.length,
      quotes: before.quotes.length,
      urls: before.urls.length,
      names: beforeCaps.length,
    },
  };
}

function diffList(source, target) {
  const set = new Set(target);
  return source.filter((item) => !set.has(item));
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * Восстанавливает потерянные числа/даты, вставляя их обратно в текст,
 * если нашлось похожее место. Используется как «страховка» после LLM.
 */
export function repairLosses(originalAst, resultAst, integrity) {
  if (!integrity || integrity.ok) return { ast: resultAst, repaired: [] };
  const repaired = [];
  let text = astToPlainText(resultAst);
  const originalText = astToPlainText(originalAst);

  for (const number of integrity.missing.numbers) {
    if (text.includes(number)) continue;
    const context = contextAround(originalText, number);
    if (!context) continue;
    const patched = tryInsertByContext(text, context, number);
    if (patched) {
      text = patched;
      repaired.push({ kind: 'number', value: number });
    }
  }
  for (const date of integrity.missing.dates) {
    if (text.includes(date)) continue;
    const context = contextAround(originalText, date);
    if (!context) continue;
    const patched = tryInsertByContext(text, context, date);
    if (patched) {
      text = patched;
      repaired.push({ kind: 'date', value: date });
    }
  }
  return { text, repaired };
}

function contextAround(text, needle) {
  const index = text.indexOf(needle);
  if (index === -1) return null;
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + needle.length + 60);
  return { before: text.slice(start, index), after: text.slice(index + needle.length, end) };
}

function tryInsertByContext(text, context, needle) {
  const beforeAnchor = context.before.trim().split(/\s+/).slice(-3).join(' ');
  if (!beforeAnchor) return null;
  const index = text.indexOf(beforeAnchor);
  if (index === -1) return null;
  const insertAt = index + beforeAnchor.length;
  return `${text.slice(0, insertAt)} ${needle}${text.slice(insertAt)}`;
}
