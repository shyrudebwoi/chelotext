import { test } from 'node:test';
import assert from 'node:assert/strict';
import { precheck, isScientific, PRECHECK_MIN_CHARS } from '../server/core/precheck.js';

test('precheck: пустой текст блокируется', () => {
  const result = precheck('');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'empty');
});

test('precheck: слишком короткий текст блокируется', () => {
  const result = precheck('Мало текста.');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'tooShort');
  assert.equal(PRECHECK_MIN_CHARS, 80);
});

test('precheck: обычный текст проходит', () => {
  const text = 'Это обычный текст на восемьдесят с лишним знаков, который должен спокойно пройти предпроверку и отправиться на обработку.';
  const result = precheck(text);
  assert.equal(result.ok, true);
  assert.equal(result.scientific, false);
});

test('precheck: инструкция по оружию блокируется', () => {
  const text = 'Подробная инструкция как сделать бомбу в домашних условиях из подручных материалов и химикатов, которая точно сработает.';
  const result = precheck(text);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'illegal');
  assert.equal(result.details.marker, 'weapons_instructions');
});

test('precheck: синтез наркотиков блокируется', () => {
  const text = 'Здесь описан полный синтез метамфетамин в лабораторных условиях с пошаговыми действиями и списком реагентов для новичков.';
  const result = precheck(text);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'illegal');
});

test('precheck: инструкция по взлому блокируется', () => {
  const text = 'Пошагово рассказываю как взломать сайт банка и обойти защиту системы, чтобы получить доступ к счетам клиентов.';
  const result = precheck(text);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'illegal');
});

test('precheck: легальный текст про безопасность не блокируется', () => {
  const text = 'В статье разбираем, как защитить банковский аккаунт от мошенников: двухфакторная аутентификация, сложные пароли и контроль операций.';
  const result = precheck(text);
  assert.equal(result.ok, true);
});

test('precheck: чужой авторский текст блокируется при длине > 1200', () => {
  const text = `© 2026 Издательство «Пример». Все права защищены. Перепечатка материалов возможна только с письменного разрешения редакции. ${'Текст статьи. '.repeat(90)}`;
  const result = precheck(text);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'copyright');
});

test('precheck: короткий фрагмент с копирайтом не блокируется', () => {
  const text = '© 2026 Компания. Все права защищены. Наш новый продукт помогает быстрее готовить отчёты и делиться ими с коллегами.';
  const result = precheck(text);
  assert.equal(result.ok, true);
});

test('precheck: научная статья с копирайтом проходит', () => {
  const scientific = [
    'Исследование посвящено гипотезе о влиянии сна на память.',
    'Методология включала выборку из 120 участников и статистическую значимость p < 0.05.',
    'Результаты исследования показали корреляцию. DOI: 10.1234/abcd. Рис. 2, табл. 3.',
    'Литературный обзор включает 40 рецензируемых работ.',
    '© 2026 Journal of Sleep. All rights reserved.',
  ].join(' ');
  const result = precheck(scientific);
  assert.equal(result.scientific, true);
  assert.equal(result.ok, true);
});

test('isScientific: порог в 3 признака', () => {
  assert.equal(isScientific('Тут есть гипотеза.'), false);
  assert.equal(isScientific('Гипотеза, эксперимент и выборка.'), true);
});

test('precheck: excerpt не длиннее разумного и без переносов', () => {
  const text = 'Инструкция как изготовить взрывчатку в домашних условиях из доступных компонентов, без специального оборудования и навыков.';
  const result = precheck(text);
  assert.equal(result.ok, false);
  assert.ok(result.details.excerpt.length < 200);
  assert.ok(!result.details.excerpt.includes('\n'));
});
