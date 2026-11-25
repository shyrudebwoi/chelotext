// Границы слов для кириллицы. Встроенный \b в JS работает по ASCII,
// поэтому для русских текстов он почти никогда не срабатывает.
// Эта утилита переписывает паттерны на Unicode-границы.

export function cyrify(re) {
  if (!(re instanceof RegExp)) return re;
  let src = re.source;

  // \b в начале и в конце шаблона — самые частые случаи.
  src = src.replace(/^\\b/, '(?<![\\p{L}\\p{N}_])');
  src = src.replace(/\\b$/, '(?![\\p{L}\\p{N}_])');
  // Оставшиеся \b (внутри) — полноценная Unicode-граница слова.
  src = src.replace(/\\b/g, '(?:(?<![\\p{L}\\p{N}_])(?=[\\p{L}\\p{N}_])|(?<=[\\p{L}\\p{N}_])(?![\\p{L}\\p{N}_]))');
  // \w тоже ASCII-only.
  src = src.replace(/\\w/g, '[\\p{L}\\p{N}_]');
  src = src.replace(/\\W/g, '[^\\p{L}\\p{N}_]');

  const flags = re.flags.includes('u') ? re.flags : `${re.flags}u`;
  try {
    return new RegExp(src, flags);
  } catch {
    return re;
  }
}

export function cyrifyRules(rules) {
  return rules.map(([re, replacement, level]) => [cyrify(re), replacement, level]);
}

export function cyrifyList(list) {
  return list.map((re) => cyrify(re));
}

// Проверка «это слово на кириллице/латинице» — без ASCII-ограничений.
export const WORD_RE = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;
