import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRules, readability, clampLevel, levelName, splitProtected, splitSentences,
} from '../server/core/rules/engine.js';
import { parsePlainText, astToPlainText, BLOCK } from '../server/core/text/ast.js';

const run = (text, options) => {
  const result = applyRules(parsePlainText(text), options);
  return astToPlainText(result.ast);
};

test('clampLevel: ограничивает 1..5 и чинит мусор', () => {
  assert.equal(clampLevel(0), 1);
  assert.equal(clampLevel(9), 5);
  assert.equal(clampLevel('3'), 3);
  assert.equal(clampLevel('abc'), 3);
  assert.equal(clampLevel(2.6), 3);
});

test('levelName: человеческие названия для всех уровней', () => {
  for (let level = 1; level <= 5; level += 1) {
    assert.equal(typeof levelName(level), 'string');
    assert.ok(levelName(level).length > 0);
  }
});

test('splitProtected: числа, даты и цитаты помечены защищёнными', () => {
  const segments = splitProtected('Цена 12 500 руб. «цитата» и дата 01.02.2026.');
  const protectedText = segments.filter((s) => s.protected).map((s) => s.text).join('|');
  assert.match(protectedText, /12 500/);
  assert.match(protectedText, /01\.02\.2026/);
  assert.match(protectedText, /«цитата»/);
});

test('splitProtected: склейка сегментов возвращает исходный текст', () => {
  const src = 'Текст 42 со «вставкой» и ссылкой https://example.com/a?b=1 тут.';
  assert.equal(splitProtected(src).map((s) => s.text).join(''), src);
});

test('splitSentences: не рвёт сокращения и инициалы', () => {
  const parts = splitSentences('Это т.е. пример. Он стоит 5 руб. за штуку. Далее идёт А. С. Пушкин.');
  assert.equal(parts.length, 3);
  assert.match(parts[2], /Пушкин/);
});

test('splitSentences: не рвёт нумерованный список', () => {
  const parts = splitSentences('Введение. 1. Первый пункт. 2. Второй пункт.');
  assert.ok(parts.length >= 2);
  assert.ok(parts.some((p) => p.includes('Первый пункт')));
});

test('R2: канцеляризмы заменяются на простые обороты', () => {
  const out = run('В целях повышения качества на данный момент необходимо провести анализ.', {
    r2: true, level: 3,
  });
  assert.match(out, /Чтобы повысить качество/);
  assert.match(out, /сейчас/);
  assert.doesNotMatch(out, /на данный момент/);
});

test('R2: числа, даты и проценты не меняются', () => {
  const src = 'Скидка 15% действует до 31.12.2026 на сумму 12 500 руб.';
  const out = run(src, { r2: true, level: 5 });
  assert.match(out, /15%/);
  assert.match(out, /31\.12\.2026/);
  assert.match(out, /12 500 руб\./);
});

test('R2: цитаты не меняются', () => {
  const src = 'Автор пишет: «В целях обеспечения безопасности на данный момент» — и это важно.';
  const out = run(src, { r2: true, level: 5 });
  assert.match(out, /«В целях обеспечения безопасности на данный момент»/);
});

test('R2: не оставляет висячих знаков препинания', () => {
  const out = run('Необходимо отметить, что система работает. Следует отметить, что это важно.', {
    r2: true, level: 4,
  });
  assert.doesNotMatch(out, /,\s*\./);
  assert.doesNotMatch(out, /^\s*[,;]/);
  assert.doesNotMatch(out, /\s{2,}/);
});

test('R2: сохраняет заглавную букву в начале абзаца', () => {
  const out = run('Необходимо отметить, что сроки сдвинулись.', { r2: true, level: 4 });
  assert.match(out, /^Сроки сдвинулись/);
});

test('R2: не создаёт придаточных в начале предложения', () => {
  const out = run(
    'Система защиты информации, которая представляет собой комплекс мер, направленных на предотвращение доступа, работает круглосуточно и постоянно обновляется специалистами.',
    { r2: true, level: 5 },
  );
  assert.doesNotMatch(out, /(?:^|\. )Котор\w+/);
  assert.match(out, /Это комплекс мер/);
});

test('R2: «данные» как существительное не превращается в «эти»', () => {
  const out = run('Администрация проводит анализ данных и хранит данные в защищённом виде.', {
    r2: true, level: 5,
  });
  assert.match(out, /анализ данных/);
});

test('R1: длинный абзац делится на несколько', () => {
  const sentence = 'Это достаточно длинное предложение для проверки разбиения текста на абзацы. ';
  const src = sentence.repeat(14).trim();
  const result = applyRules(parsePlainText(src), { r1: true, level: 3 });
  const paragraphs = result.ast.blocks.filter((b) => b.type === BLOCK.PARAGRAPH);
  assert.ok(paragraphs.length > 1, `ожидалось >1 абзаца, получено ${paragraphs.length}`);
  assert.equal(result.stats.r1, true);
});

test('R1: короткий абзац не трогается', () => {
  const result = applyRules(parsePlainText('Короткий абзац.'), { r1: true, level: 5 });
  assert.equal(result.ast.blocks.length, 1);
});

test('R3: перечисление в абзаце становится списком', () => {
  const result = applyRules(
    parsePlainText('Правила такие: а) первое правило, б) второе правило, в) третье правило.'),
    { r3: true, level: 3 },
  );
  const lists = result.ast.blocks.filter((b) => b.type === BLOCK.LIST);
  assert.equal(lists.length, 1);
  assert.equal(lists[0].items.length, 3);
  assert.equal(result.stats.r3, true);
});

test('R3: нумерованное перечисление сохраняет порядок', () => {
  const result = applyRules(
    parsePlainText('Шаги: 1) открыть форму, 2) заполнить поля, 3) отправить заявку.'),
    { r3: true, level: 3 },
  );
  const lists = result.ast.blocks.filter((b) => b.type === BLOCK.LIST);
  assert.equal(lists.length, 1);
  assert.equal(lists[0].ordered, true);
  assert.equal(lists[0].items.length, 3);
});

test('R3: таблицы не меняются', () => {
  const ast = parsePlainText('| A | B |\n| --- | --- |\n| 1 | 2 |');
  const result = applyRules(ast, { r1: true, r2: true, r3: true, level: 5 });
  const t = result.ast.blocks.find((b) => b.type === BLOCK.TABLE);
  assert.deepEqual(t.rows, [['1', '2']]);
});

test('applyRules: без режимов текст не ломается', () => {
  const src = 'Текст  с   лишними пробелами.';
  const out = run(src, {});
  assert.equal(out, 'Текст с лишними пробелами.');
});

test('applyRules: не мутирует исходный AST', () => {
  const ast = parsePlainText('В целях повышения качества нужно провести анализ.');
  const snapshot = JSON.stringify(ast);
  applyRules(ast, { r2: true, level: 5 });
  assert.equal(JSON.stringify(ast), snapshot);
});

test('readability: считает метрики и не падает на пустом тексте', () => {
  const empty = readability('');
  assert.equal(empty.words, 0);
  assert.equal(empty.avgSentenceLength, 0);

  const m = readability('Это короткое предложение. Это второе предложение.');
  assert.equal(m.sentences, 2);
  assert.ok(m.words > 5);
  assert.ok(m.avgSentenceLength > 0);
});

test('readability: упрощение повышает индекс читаемости', () => {
  const src = 'В целях обеспечения безопасности и в связи с тем, что на сегодняшний день наблюдается существенное увеличение количества инцидентов, администрация осуществляет проведение анализа данных.';
  const before = readability(src);
  const after = readability(run(src, { r2: true, level: 5 }));
  assert.ok(after.avgSentenceLength <= before.avgSentenceLength);
  assert.ok(after.bureaucracy <= before.bureaucracy);
});
