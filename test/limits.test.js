import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCharLimit, needsAsync } from '../server/services/ingest.js';
import { config } from '../server/config.js';

test('checkCharLimit: пустой текст проходит', () => {
  const result = checkCharLimit('');
  assert.equal(result.ok, true);
});

test('checkCharLimit: ровно на границе проходит', () => {
  const result = checkCharLimit('а'.repeat(config.limits.maxChars));
  assert.equal(result.ok, true);
});

test('checkCharLimit: превышение на 1 знак блокируется', () => {
  const result = checkCharLimit('а'.repeat(config.limits.maxChars + 1));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'too_long');
  assert.equal(result.max, config.limits.maxChars);
  assert.equal(result.chars, config.limits.maxChars + 1);
});

test('checkCharLimit: лимит из ТЗ — 100 000 знаков', () => {
  assert.equal(config.limits.maxChars, 100_000);
});

test('checkCharLimit: null и undefined не падают', () => {
  assert.equal(checkCharLimit(null).ok, true);
  assert.equal(checkCharLimit(undefined).ok, true);
});

test('needsAsync: короткий текст — синхронно', () => {
  assert.equal(needsAsync({ source: 'paste', text: 'короткий текст', meta: {} }), false);
});

test('needsAsync: длинный текст — очередь', () => {
  const text = 'а'.repeat(config.syncMaxChars + 1);
  assert.equal(needsAsync({ source: 'paste', text, meta: {} }), true);
});

test('needsAsync: скан-PDF всегда в очередь, даже если короткий', () => {
  const result = needsAsync({ source: 'file', text: 'коротко', meta: { kind: 'pdf', fromOcr: true } });
  assert.equal(result, true);
});

test('needsAsync: PDF с текстовым слоем и коротким текстом — синхронно', () => {
  const result = needsAsync({ source: 'file', text: 'коротко', meta: { kind: 'pdf', fromOcr: false } });
  assert.equal(result, false);
});
