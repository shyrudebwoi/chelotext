import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCK, parsePlainText, astToPlainText, astToMarkdown, astToHtml, astStats,
  countChars, countWords, blockText, paragraph, heading, list, table, quote, footnotes, divider,
} from '../server/core/text/ast.js';

test('parsePlainText: абзацы по пустой строке', () => {
  const ast = parsePlainText('Первый абзац.\n\nВторой абзац.');
  assert.equal(ast.blocks.length, 2);
  assert.ok(ast.blocks.every((b) => b.type === BLOCK.PARAGRAPH));
});

test('parsePlainText: строки внутри абзаца склеиваются', () => {
  const ast = parsePlainText('Первая строка\nвторая строка');
  assert.equal(ast.blocks.length, 1);
  assert.equal(ast.blocks[0].text, 'Первая строка вторая строка');
});

test('parsePlainText: markdown-заголовки', () => {
  const ast = parsePlainText('# Заголовок\n\n## Подзаголовок\n\nТекст.');
  assert.equal(ast.blocks[0].type, BLOCK.HEADING);
  assert.equal(ast.blocks[0].level, 1);
  assert.equal(ast.blocks[1].level, 2);
});

test('parsePlainText: маркированный и нумерованный список', () => {
  const bullets = parsePlainText('- один\n- два\n- три');
  assert.equal(bullets.blocks[0].type, BLOCK.LIST);
  assert.equal(bullets.blocks[0].items.length, 3);
  assert.equal(bullets.blocks[0].ordered, false);

  const numbered = parsePlainText('1. один\n2. два');
  assert.equal(numbered.blocks[0].ordered, true);
  assert.deepEqual(numbered.blocks[0].items, ['один', 'два']);
});

test('parsePlainText: одиночный маркер остаётся абзацем', () => {
  const ast = parsePlainText('- единственный пункт');
  assert.equal(ast.blocks[0].type, BLOCK.PARAGRAPH);
});

test('parsePlainText: markdown-таблица с заголовком', () => {
  const ast = parsePlainText('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |');
  const t = ast.blocks[0];
  assert.equal(t.type, BLOCK.TABLE);
  assert.deepEqual(t.header, ['A', 'B']);
  assert.deepEqual(t.rows, [['1', '2'], ['3', '4']]);
});

test('parsePlainText: цитата и разделитель', () => {
  const ast = parsePlainText('> цитата\n> вторая строка\n\n---\n\nТекст.');
  assert.equal(ast.blocks[0].type, BLOCK.QUOTE);
  assert.equal(ast.blocks[0].text, 'цитата\nвторая строка');
  assert.equal(ast.blocks[1].type, BLOCK.DIVIDER);
});

test('parsePlainText: нормализация переносов, табов и nbsp', () => {
  const ast = parsePlainText('Строка\u00a0с nbsp\r\nи табом\tтут');
  assert.equal(ast.blocks[0].text, 'Строка с nbsp и табом тут');
});

test('parsePlainText: пустой вход', () => {
  const ast = parsePlainText('');
  assert.equal(ast.blocks.length, 0);
  assert.equal(astToPlainText(ast), '');
});

test('astToPlainText: восстанавливает разметку', () => {
  const ast = {
    version: 1,
    blocks: [
      heading('Заголовок', 2),
      paragraph('Абзац.'),
      list(['один', 'два'], true),
      quote('Цитата'),
      table([['1', '2']], ['A', 'B']),
      footnotes(['Сноска']),
      divider(),
    ],
  };
  const text = astToPlainText(ast);
  assert.match(text, /Заголовок/);
  assert.match(text, /1\. один/);
  assert.match(text, /2\. два/);
  assert.match(text, /^> Цитата$/m);
  assert.match(text, /1 \| 2/);
  assert.match(text, /\[1\] Сноска/);
  assert.match(text, /---/);
});

test('astToMarkdown: заголовки, списки, таблицы, цитаты', () => {
  const ast = {
    version: 1,
    blocks: [
      heading('H2', 2),
      paragraph('Текст.'),
      list(['a', 'b'], false),
      list(['x', 'y'], true),
      quote('Q'),
      table([['1', '2']], ['A', 'B']),
    ],
  };
  const md = astToMarkdown(ast);
  assert.match(md, /^## H2$/m);
  assert.match(md, /^- a$/m);
  assert.match(md, /^1\. x$/m);
  assert.match(md, /^> Q$/m);
  assert.match(md, /\| A \| B \|/);
  assert.match(md, /\| --- \| --- \|/);
});

test('astToHtml: экранирует HTML в тексте', () => {
  const ast = { version: 1, blocks: [paragraph('<script>alert(1)</script>')] };
  const { body } = astToHtml(ast);
  assert.ok(!body.includes('<script>alert(1)</script>'));
  assert.ok(body.includes('&lt;script&gt;'));
});

test('countChars и countWords считают по plain-тексту', () => {
  const ast = { version: 1, blocks: [paragraph('Раз два три.')] };
  assert.equal(countWords(ast), 3);
  assert.equal(countChars(ast), 'Раз два три.'.length + 2);
});

test('astStats: базовые счётчики', () => {
  const ast = parsePlainText('# T\n\nАбзац один. Абзац два.\n\n- a\n- b');
  const stats = astStats(ast);
  assert.equal(stats.headings, 1);
  assert.equal(stats.paragraphs, 1);
  assert.equal(stats.lists, 1);
});

test('blockText: все типы блоков', () => {
  assert.equal(blockText(paragraph('p')), 'p');
  assert.equal(blockText(list(['a', 'b'])), 'a\nb');
  assert.equal(blockText(table([['1', '2']])), '1 | 2');
  assert.equal(blockText(footnotes(['f'])), 'f');
  assert.equal(blockText(divider()), '');
});
