// Движок правил R1/R2/R3. Работает по AST и не меняет смысл: числа, имена,
// даты и цитаты защищены от замен. Правила снимают простую работу до LLM.
import {
  BLOCK, cloneAst, paragraph, heading, list, divider, astToPlainText, blockText,
} from '../text/ast.js';
import {
  BUREAUCRATIC, FILLER, CLICHES, HARD_WORDS, NOMINALIZATIONS, REPEAT_STOPWORDS,
} from './dictionaries.js';
import { cyrify, cyrifyRules } from '../../lib/regex.js';

export const RULE_ENGINE_VERSION = '1.0.0';

// Порог уровня, начиная с которого применяется правило.
const LEVEL_NAMES = {
  1: 'Чуть подправить',
  2: 'Полегче',
  3: 'Заметно проще',
  4: 'Сильно проще',
  5: 'Максимально просто',
};

export function levelName(level) {
  return LEVEL_NAMES[clampLevel(level)] || LEVEL_NAMES[3];
}

export function clampLevel(level) {
  const n = Math.round(Number(level));
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, n));
}

// ---------- Защита смысла ----------
// Разбиваем текст на сегменты: защищённые (цитаты, числа, даты, ссылки, аббревиатуры)
// и обычные. Замены применяем только к обычным.

const PROTECTED_PATTERNS = [
  /«[^»]{0,600}»/g,          // русские кавычки
  /„[^“”]{0,600}[“”]/g,      // немецкие кавычки
  /"[^"\n]{0,600}"/g,        // прямые кавычки
  /“[^”]{0,600}”/g,
  /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g,   // даты
  /\b\d{4}\s*(год|года|году|г\.)/gi,
  /\b\d[\d\s.,]*\s*(%|руб|₽|\$|€|тыс|млн|млрд|км|кг|м|см|мм|°C|°)/gi,
  /\b\d+([.,]\d+)?\b/g,      // числа
  /https?:\/\/\S+/g,         // ссылки
  /\b[A-ZА-ЯЁ]{2,}\b/g,      // аббревиатуры (МГУ, РФ, США)
];

export function splitProtected(text) {
  const src = String(text ?? '');
  const marks = new Array(src.length).fill(false);
  for (const pattern of PROTECTED_PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(src)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      for (let i = start; i < end; i += 1) marks[i] = true;
      if (m[0].length === 0) pattern.lastIndex += 1;
    }
  }
  const segments = [];
  let i = 0;
  while (i < src.length) {
    const flag = marks[i];
    let j = i;
    while (j < src.length && marks[j] === flag) j += 1;
    segments.push({ text: src.slice(i, j), protected: flag });
    i = j;
  }
  return segments;
}

function applySafe(text, rules, level) {
  const active = rules.filter(([, , minLevel]) => level >= minLevel);
  if (!active.length) return text;
  return splitProtected(text)
    .map((segment) => {
      if (segment.protected) return segment.text;
      let out = segment.text;
      for (const [re, replacement] of active) {
        re.lastIndex = 0;
        out = out.replace(re, replacement);
      }
      return out;
    })
    .join('');
}

// ---------- Сокращения и границы предложений ----------
const ABBREVIATIONS = new Set([
  'т.е', 'т.д', 'т.п', 'т.к', 'др', 'пр', 'г', 'гг', 'в', 'вв', 'стр', 'рис', 'табл', 'см', 'им', 'проф',
  'акад', 'доц', 'напр', 'млн', 'млрд', 'тыс', 'руб', 'коп', 'ул', 'д', 'кв', 'оф', 'тел', 'e.g', 'i.e', 'etc',
]);

export function splitSentences(text) {
  const src = String(text ?? '');
  const result = [];
  let start = 0;
  const re = /[.!?…]+(?=\s|$)/g;
  let match;
  while ((match = re.exec(src)) !== null) {
    const end = match.index + match[0].length;
    const tail = src.slice(end);
    // Проверяем, не сокращение ли это
    const before = src.slice(start, match.index);
    const lastWord = (before.match(/[\p{L}\p{N}.]+$/u) || [''])[0].replace(/\.$/, '').toLowerCase();
    const isAbbrev = ABBREVIATIONS.has(lastWord) || /^[а-яё]$/i.test(lastWord);
    const nextChar = tail.trimStart()[0];
    const looksLikeList = /^\s*\d+[.)]\s/.test(tail);
    if (isAbbrev || looksLikeList) continue;
    if (!nextChar) {
      result.push(src.slice(start, end).trim());
      start = end;
      break;
    }
    if (/[\p{Lu}«"“\d]/u.test(nextChar)) {
      const piece = src.slice(start, end).trim();
      if (piece) result.push(piece);
      start = end;
    }
  }
  const rest = src.slice(start).trim();
  if (rest) result.push(rest);
  return result.filter(Boolean);
}

// Разбиение длинного предложения на части по союзам и вводным словам.
// Относительные местоимения («который», «которая»…) сюда НЕ входят: разрез
// перед ними отрывает придаточное от главного и получается неграмотный текст.
const SPLIT_CONNECTORS = /\s+(?:а\s+именно|потому\s+что|в\s+связи\s+с\s+тем,?\s+что|при\s+этом|причём|причем|однако|хотя|несмотря\s+на\s+то,?\s+что|в\s+то\s+время\s+как|тогда\s+как|поскольку)\s+/gi;

function shortenSentence(sentence, level, maxWords) {
  const words = countWords(sentence);
  if (words <= maxWords) return [sentence];
  const pieces = [];
  let lastIndex = 0;
  SPLIT_CONNECTORS.lastIndex = 0;
  let m;
  while ((m = SPLIT_CONNECTORS.exec(sentence)) !== null) {
    const cut = m.index;
    const candidate = sentence.slice(lastIndex, cut).trim();
    if (countWords(candidate) >= Math.min(6, Math.ceil(maxWords * 0.35))) {
      pieces.push(candidate);
      lastIndex = cut;
    }
  }
  const tail = sentence.slice(lastIndex).trim();
  if (tail) pieces.push(tail);
  if (pieces.length <= 1) {
    // Пробуем разрезать по запятым в середине.
    const byComma = sentence.split(/,\s+/);
    if (byComma.length > 2 && level >= 3) {
      const merged = [];
      let current = '';
      for (const part of byComma) {
        const next = current ? `${current}, ${part}` : part;
        if (countWords(next) > maxWords && current) {
          merged.push(current);
          current = part;
        } else {
          current = next;
        }
      }
      if (current) merged.push(current);
      // Разрез по запятой допустим, только если каждая часть может быть
      // самостоятельным предложением. Иначе придаточное повиснет («Которая …»).
      if (merged.length > 1 && merged.every(canStartSentence)) {
        return merged.map(fixSentenceStart);
      }
      return [sentence];
    }
    return [sentence];
  }
  return pieces.map(fixSentenceStart);
}

// Слова, с которых русское предложение начинаться не может.
const DEPENDENT_START = /^(котор\w*|чей|чья|чьё|чьи|где|куда|откуда|когда|потому|поскольку|хотя|если|чтобы|что)\b/iu;

function canStartSentence(piece) {
  const t = piece.trim();
  if (!t) return false;
  if (DEPENDENT_START.test(t)) return false;
  return /^[\p{Lu}\p{N}«"(]/u.test(t) || /^[а-яё]/u.test(t);
}

function fixSentenceStart(piece) {
  const trimmed = piece.trim();
  if (!trimmed) return trimmed;
  const connectors = /^(потому\s+что|в\s+связи\s+с\s+тем,?\s+что|а\s+именно|при\s+этом|причём|причем|однако|но\s+и|хотя|тогда\s+как|так\s+как|поскольку|чтобы|если)\s+/iu;
  const m = connectors.exec(trimmed);
  let body = trimmed;
  if (m) {
    body = trimmed.slice(m[0].length);
    body = `${m[1][0].toUpperCase()}${m[1].slice(1)}${body ? ` ${body}` : ''}`;
  }
  body = body[0] ? body[0].toUpperCase() + body.slice(1) : body;
  if (!/[.!?…]$/.test(body)) body = `${body}.`;
  return body;
}

function countWords(text) {
  return (String(text).match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || []).length;
}

// ---------- R1: визуальное форматирование ----------
function applyR1(ast, level) {
  const blocks = [];
  const splitLimit = level <= 2 ? 900 : level <= 4 ? 650 : 480;

  for (const block of ast.blocks || []) {
    if (block.type !== BLOCK.PARAGRAPH) {
      blocks.push(block);
      continue;
    }
    const text = block.text || '';
    if (text.length <= splitLimit) {
      blocks.push(block);
      continue;
    }
    // Делим мега-абзац на логические абзацы по предложениям.
    const sentences = splitSentences(text);
    if (sentences.length < 2) {
      blocks.push(block);
      continue;
    }
    let current = [];
    let currentLen = 0;
    const target = Math.max(240, Math.floor(splitLimit * 0.75));
    for (const sentence of sentences) {
      if (currentLen + sentence.length > target && current.length) {
        blocks.push({ ...paragraph(current.join(' ')), originId: block.id });
        current = [];
        currentLen = 0;
      }
      current.push(sentence);
      currentLen += sentence.length + 1;
    }
    if (current.length) blocks.push({ ...paragraph(current.join(' ')), originId: block.id });
  }
  return { version: 1, blocks };
}

// ---------- R2: лингвистическое упрощение ----------
function applyR2(ast, level) {
  const maxWords = level <= 1 ? 60 : level <= 2 ? 42 : level <= 3 ? 32 : level <= 4 ? 26 : 20;
  const useBureau = level >= 1;
  const rules = cyrifyRules([
    ...(useBureau ? BUREAUCRATIC : []),
    ...(level >= 2 ? NOMINALIZATIONS : []),
    ...(level >= 2 ? CLICHES : []),
    ...(level >= 3 ? FILLER : []),
    ...(level >= 3 ? HARD_WORDS : []),
  ]);

  const blocks = (ast.blocks || []).map((block) => {
    switch (block.type) {
      case BLOCK.PARAGRAPH:
      case BLOCK.QUOTE:
      case BLOCK.HEADING: {
        let text = applySafe(block.text || '', rules, level);
        text = capitalizeStart(cleanupSpacing(text));
        if (block.type !== BLOCK.HEADING) {
          const sentences = splitSentences(text);
          const shortened = sentences.flatMap((s) => shortenSentence(s, level, maxWords));
          text = capitalizeStart(cleanupSpacing(shortened.join(' ')));
        }
        return { ...block, text };
      }
      case BLOCK.LIST: {
        const items = block.items.map((item) => cleanupSpacing(applySafe(item, rules, level)));
        return { ...block, items };
      }
      case BLOCK.TABLE: {
        // Таблицы не трогаем: в них данные, их нельзя искажать.
        return block;
      }
      case BLOCK.FOOTNOTES: {
        const items = block.items.map((item) => cleanupSpacing(applySafe(item, rules, level)));
        return { ...block, items };
      }
      default:
        return block;
    }
  });

  const deduped = level >= 2 ? dedupeRepeats({ version: 1, blocks }) : { version: 1, blocks };
  return deduped;
}

function cleanupSpacing(text) {
  return String(text)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?…])/g, '$1')
    // Пробел после запятой/точки с запятой/двоеточия — кроме десятичных дробей:
    // «2,2» и «0,05» должны остаться без пробела.
    .replace(/([,;:])(?=\S)/g, (mark, _m, offset, source) => {
      const prev = source[offset - 1] || '';
      const next = source[offset + 1] || '';
      if (mark === ',' && /\d/.test(prev) && /\d/.test(next)) return mark;
      return `${mark} `;
    })
    // Висячие знаки после удалённых оборотов: «, .», «, ,», «( )», «(, )».
    .replace(/[,;:]\s*(?=[.!?…])/g, '')
    .replace(/([,;:])\s*[,;:]+/g, '$1')
    .replace(/\(\s*[,;:.]*\s*\)/g, '')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s*—\s*/g, ' — ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,\s]+/, '')
    .trim();
}

// Замена в начале абзаца могла убрать заглавную («необходимо отметить, что …» →
// «…»), поэтому восстанавливаем регистр первой буквы.
function capitalizeStart(text) {
  const src = String(text);
  const m = /^([«"“(\s]*)([а-яёa-z])/u.exec(src);
  if (!m) return src;
  const index = m[1].length;
  return src.slice(0, index) + src[index].toUpperCase() + src.slice(index + 1);
}

// Удаление повторов: только ПОДРЯД идущие одинаковые предложения («тавтология»).
// Разнесённые по тексту повторы — это часто законный повтор (приём, рефрен,
// одинаковые строки в перечислениях), вырезать их нельзя: теряется содержание.
function dedupeRepeats(ast) {
  const blocks = [];
  for (const block of ast.blocks || []) {
    if (block.type !== BLOCK.PARAGRAPH) {
      blocks.push(block);
      continue;
    }
    const sentences = splitSentences(block.text || '');
    const kept = [];
    let previousNorm = null;
    for (const sentence of sentences) {
      const norm = sentence.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      // Соседний дубликат: то же предложение сразу после себя.
      if (norm.length >= 25 && norm === previousNorm) continue;
      kept.push(sentence);
      previousNorm = norm;
    }
    const text = cleanupSpacing(kept.join(' '));
    if (text) blocks.push({ ...block, text });
  }
  return { version: 1, blocks };
}

// ---------- R3: структурирование ----------
const HEADING_START = cyrify(/^(?:итак|теперь|далее|кроме того|важно|главное|вывод|итог|проблема|решение|причина|результат|пример|суть|что делать|как это работает)\b/i);

function applyR3(ast, level) {
  const blocks = [];
  const listSplit = level >= 2;
  const autoHeading = level >= 2;

  for (let index = 0; index < (ast.blocks || []).length; index += 1) {
    const block = ast.blocks[index];
    if (block.type !== BLOCK.PARAGRAPH) {
      blocks.push(block);
      continue;
    }
    const text = block.text || '';

    // Короткая строка без точки в конце и без запятых — вероятный заголовок.
    if (autoHeading && isHeadingCandidate(text) && blocks.length > 0) {
      blocks.push(heading(text.replace(/[:.]+$/, ''), 2));
      continue;
    }

    // Перечисление внутри абзаца → список.
    if (listSplit) {
      const items = extractEnumeration(text);
      if (items) {
        const lead = items.lead;
        if (lead) blocks.push(paragraph(lead));
        blocks.push(list(items.items, items.ordered));
        continue;
      }
    }

    blocks.push(markKeySentence(block, level));
  }
  return { version: 1, blocks };
}

function isHeadingCandidate(text) {
  const t = text.trim();
  if (!t || t.length > 90) return false;
  if (/[.!?…]$/.test(t)) return false;
  if (t.split(/\s+/).length > 12) return false;
  if ((t.match(/,/g) || []).length > 1) return false;
  return true;
}

function extractEnumeration(text) {
  const t = text.trim();
  // «а) …, б) …, в) …» или «1) … 2) … 3) …» в одном абзаце
  const letterList = cyrify(/\b([а-яё])\)\s+/gi);
  const numberList = /\b(\d{1,2})\)\s+/g;
  const hasLetters = (t.match(letterList) || []).length >= 2;
  const hasNumbers = (t.match(numberList) || []).length >= 2;
  if (!hasLetters && !hasNumbers) return null;
  const re = hasNumbers ? numberList : letterList;
  re.lastIndex = 0;
  const marks = [];
  let m;
  while ((m = re.exec(t)) !== null) marks.push(m.index);
  if (marks.length < 2) return null;
  const lead = t.slice(0, marks[0]).trim().replace(/[:;]$/, '');
  const items = [];
  for (let i = 0; i < marks.length; i += 1) {
    const start = marks[i] + (hasNumbers ? String(i + 1).length + 2 : 2);
    const end = i + 1 < marks.length ? marks[i + 1] : t.length;
    const item = t.slice(start, end).trim().replace(/[;,]$/, '').trim();
    if (item) items.push(item);
  }
  if (items.length < 2) return null;
  return { lead, items, ordered: hasNumbers };
}

// Помечаем «главную мысль» абзаца для подсветки в интерфейсе. Текст не меняется.
function markKeySentence(block, level) {
  if (level < 3) return block;
  const sentences = splitSentences(block.text || '');
  if (sentences.length < 3) return block;
  const scored = sentences.map((sentence, index) => ({
    sentence,
    index,
    score: keyScore(sentence, index, sentences.length),
  }));
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score <= 0) return block;
  return { ...block, keySentence: best.sentence };
}

function keyScore(sentence, index, total) {
  let score = 0;
  if (index === 0) score += 2;
  if (index === total - 1) score += 1;
  if (cyrify(/\b(главное|важно|суть|вывод|итог|значит|поэтому)\b/i).test(sentence)) score += 3;
  const words = countWords(sentence);
  if (words >= 8 && words <= 26) score += 2;
  if (/\d/.test(sentence)) score += 1;
  return score;
}

// ---------- Общий вход ----------
export function applyRules(ast, options = {}) {
  const modes = {
    r1: Boolean(options.r1),
    r2: Boolean(options.r2),
    r3: Boolean(options.r3),
  };
  const level = clampLevel(options.level);
  let current = cloneAst(ast);
  const stats = { r1: false, r2: false, r3: false, level };

  // R3 до R2: сначала наводим структуру, потом упрощаем текст внутри блоков.
  if (modes.r3) {
    current = applyR3(current, level);
    stats.r3 = true;
  }
  if (modes.r2) {
    current = applyR2(current, level);
    stats.r2 = true;
  }
  if (modes.r1) {
    current = applyR1(current, level);
    stats.r1 = true;
  }
  if (!modes.r1 && !modes.r2 && !modes.r3) {
    // Ничего не выбрано — возвращаем базовую нормализацию пробелов, но структуру не меняем.
    current = { version: 1, blocks: current.blocks.map((b) => ({ ...b, ...(b.text ? { text: cleanupSpacing(b.text) } : {}) })) };
  }
  return { ast: current, stats };
}

// Метрики читаемости для отчёта и eval.
export function readability(text) {
  const plain = String(text || '');
  const sentences = splitSentences(plain);
  const words = plain.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || [];
  const letters = plain.replace(/[^\p{L}]/gu, '').length;
  const syllablesApprox = (plain.toLowerCase().match(/[аеёиоуыэюя]/g) || []).length + (plain.match(/[aeiouy]/gi) || []).length;
  const avgSentence = sentences.length ? words.length / sentences.length : 0;
  const avgSyllables = words.length ? syllablesApprox / words.length : 0;
  // Адаптированная формула (для русского): 206.835 − 1.3·(слоги/слова) − 60.1·(слова/предложения)
  const flesch = words.length && sentences.length
    ? 206.835 - 1.3 * avgSyllables * 10 - 60.1 * avgSentence
    : 0;
  const bureau = (plain.match(cyrify(/\b(является|осуществля\w+|в\s+целях|в\s+связи\s+с|в\s+соответствии\s+с|на\s+основании|данный|указанный|настоящий)\b/gi)) || []).length;
  return {
    chars: plain.length,
    words: words.length,
    sentences: sentences.length,
    letters,
    avgSentenceLength: round(avgSentence),
    avgWordLength: words.length ? round(letters / words.length) : 0,
    bureaucracy: bureau,
    bureaucracyPer1000: words.length ? round((bureau / words.length) * 1000) : 0,
    flesch: round(flesch),
  };
}

function round(n) {
  return Math.round(n * 10) / 10;
}

export { astToPlainText, blockText, divider };
