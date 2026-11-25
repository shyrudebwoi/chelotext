import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkIntegrity, repairLosses } from '../server/core/integrity.js';
import { parsePlainText } from '../server/core/text/ast.js';

test('checkIntegrity: идентичный текст — ok', () => {
  const text = 'Цена 12 500 руб. Срок до 31.12.2026. Иван Петров подписал.';
  const result = checkIntegrity(text, text);
  assert.equal(result.ok, true);
  assert.equal(result.score, 1);
});

test('checkIntegrity: ловит потерянное число', () => {
  const result = checkIntegrity('Скидка 15% на всё.', 'Скидка на всё.');
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing.numbers, ['15']);
});

test('checkIntegrity: ловит потерянную дату', () => {
  const result = checkIntegrity('Срок до 31.12.2026 включительно.', 'Срок до включительно.');
  assert.equal(result.ok, false);
  assert.ok(result.missing.dates.length === 1);
});

test('checkIntegrity: ловит потерянную цитату', () => {
  const result = checkIntegrity('Автор пишет: «Слова важны».', 'Автор пишет что-то.');
  assert.equal(result.ok, false);
  assert.equal(result.missing.quotes.length, 1);
});

test('checkIntegrity: ловит потерянную ссылку', () => {
  const result = checkIntegrity('Смотри https://example.com/page тут.', 'Смотри тут.');
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing.urls, ['https://example.com/page']);
});

test('checkIntegrity: ловит добавленные числа (галлюцинация)', () => {
  const result = checkIntegrity('Продажи выросли.', 'Продажи выросли на 47%.');
  assert.equal(result.ok, false);
  assert.deepEqual(result.added.numbers, ['47']);
});

test('checkIntegrity: нормализует кавычки при сравнении цитат', () => {
  const result = checkIntegrity('Он сказал «привет  мир».', 'Он сказал «Привет мир».');
  assert.deepEqual(result.missing.quotes, []);
});

test('checkIntegrity: score падает пропорционально потерям', () => {
  const src = 'Числа 1 и 2, дата 01.02.2026, имя Иван Петров.';
  const result = checkIntegrity(src, 'Числа 1, дата 01.02.2026, имя Иван Петров.');
  assert.ok(result.score < 1);
  assert.ok(result.score > 0.5);
});

test('checkIntegrity: пустой вход — score 1', () => {
  const result = checkIntegrity('', '');
  assert.equal(result.score, 1);
  assert.equal(result.ok, true);
});

test('checkIntegrity: считает checked-метрики', () => {
  const result = checkIntegrity('42 рубля, 01.02.2026, «цитата», https://a.b', '');
  assert.equal(result.checked.numbers, 1);
  assert.equal(result.checked.dates, 1);
  assert.equal(result.checked.quotes, 1);
  assert.equal(result.checked.urls, 1);
});

test('repairLosses: не трогает корректный результат', () => {
  const ast = parsePlainText('Цена 100 руб.');
  const integrity = checkIntegrity('Цена 100 руб.', 'Цена 100 руб.');
  const { repaired } = repairLosses(ast, ast, integrity);
  assert.equal(repaired.length, 0);
});

test('repairLosses: возвращает repaired-список при потерях', () => {
  const original = parsePlainText('Стоимость услуги составляет 12 500 руб. в месяц.');
  const broken = parsePlainText('Стоимость услуги составляет руб. в месяц.');
  const integrity = checkIntegrity('Стоимость услуги составляет 12 500 руб. в месяц.', 'Стоимость услуги составляет руб. в месяц.');
  const result = repairLosses(original, broken, integrity);
  assert.ok(Array.isArray(result.repaired));
});
