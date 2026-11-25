import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLineDiff, wordDiff, charDiff, diffSummary } from '../server/core/diff.js';

test('buildLineDiff: одинаковый текст — только equal', () => {
  const rows = buildLineDiff('строка', 'строка');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'equal');
});

test('buildLineDiff: добавление строки', () => {
  const rows = buildLineDiff('a\nb', 'a\nb\nc');
  assert.ok(rows.some((r) => r.type === 'added' && r.right === 'c'));
});

test('buildLineDiff: удаление строки', () => {
  const rows = buildLineDiff('a\nb', 'a');
  assert.ok(rows.some((r) => r.type === 'removed' && r.left === 'b'));
});

test('buildLineDiff: замена строки склеивается в changed', () => {
  const rows = buildLineDiff('старая строка', 'новая строка');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'changed');
  assert.equal(rows[0].left, 'старая строка');
  assert.equal(rows[0].right, 'новая строка');
});

test('buildLineDiff: нормализует CRLF', () => {
  const rows = buildLineDiff('a\r\nb', 'a\nb');
  assert.ok(rows.every((r) => r.type === 'equal'));
});

test('wordDiff: находит изменённые слова', () => {
  const parts = wordDiff('В целях повышения', 'Чтобы повысить');
  assert.ok(parts.some((p) => p.type === 'added'));
  assert.ok(parts.some((p) => p.type === 'removed'));
  assert.ok(parts.some((p) => p.type === 'equal'));
});

test('charDiff: посимвольное сравнение', () => {
  const parts = charDiff('аб', 'ав');
  assert.ok(parts.some((p) => p.type === 'removed' && p.text.includes('б')));
  assert.ok(parts.some((p) => p.type === 'added' && p.text.includes('в')));
});

test('diffSummary: считает изменённые строки', () => {
  const summary = diffSummary('первая строка\nвторая строка', 'первая строка\nдругая строка');
  assert.equal(summary.changed, 1);
  assert.equal(summary.same, 1);
  assert.equal(summary.added, 1);
  assert.equal(summary.removed, 1);
  assert.ok(summary.similarity > 0 && summary.similarity < 100);
});

test('diffSummary: одинаковый текст — полное совпадение', () => {
  const summary = diffSummary('текст', 'текст');
  assert.equal(summary.added, 0);
  assert.equal(summary.removed, 0);
  assert.equal(summary.similarity, 100);
});
