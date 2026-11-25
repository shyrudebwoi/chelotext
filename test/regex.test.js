import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cyrify, cyrifyList, cyrifyRules } from '../server/lib/regex.js';

test('cyrify: \\b работает на кириллице', () => {
  const re = cyrify(/\bданный\b/gi);
  assert.equal('данный текст'.replace(re, 'этот'), 'этот текст');
  assert.equal('неданный текст'.replace(re, 'этот'), 'неданный текст');
});

test('cyrify: границы не срабатывают внутри слова', () => {
  const re = cyrify(/\bв\s+целях\b/gi);
  assert.equal('в целях'.replace(re, 'чтобы'), 'чтобы');
  assert.equal('вв целях'.replace(re, 'чтобы'), 'вв целях');
});

test('cyrify: \\w покрывает кириллицу', () => {
  const re = cyrify(/\bосуществля\w+\b/gi);
  assert.equal('осуществляет'.replace(re, 'делает'), 'делает');
  assert.equal('осуществляют'.replace(re, 'делает'), 'делает');
});

test('cyrify: сохраняет флаги и не ломает латиницу', () => {
  const re = cyrify(/\bdata\b/g);
  assert.equal('data и metadata'.replace(re, 'X'), 'X и metadata');
});

test('cyrify: несколько \\b внутри шаблона', () => {
  const re = cyrify(/\bв\b\s+\bсвязи\b/gi);
  assert.equal('в связи с тем'.replace(re, 'из-за'), 'из-за с тем');
});

test('cyrifyRules: тройки [re, замена, уровень]', () => {
  const rules = cyrifyRules([[/(?<![а-яё])данный/gi, 'этот', 2]]);
  assert.equal(rules[0][1], 'этот');
  assert.equal(rules[0][2], 2);
});

test('cyrifyList: массив регулярок', () => {
  const [re] = cyrifyList([/\bгипотез\w*/i]);
  assert.ok(re.test('Гипотеза подтвердилась'));
});

test('cyrify: идемпотентность — повторный вызов не ломает шаблон', () => {
  const once = cyrify(/\bданный\b/gi);
  const twice = cyrify(once);
  assert.equal('данный'.replace(twice, 'X'), 'X');
});
