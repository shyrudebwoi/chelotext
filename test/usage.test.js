// Учёт токенов: миграция таблицы, запись и агрегаты для бота ВК.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelotext-usage-'));
process.env.DATA_DIR = tmpDir;
process.env.DB_FILE = path.join(tmpDir, 'test.sqlite');
process.env.NODE_ENV = 'test';

const { q, now, closeDb } = await import('../server/db/index.js');
const {
  recordLlmUsage,
  safeRecordLlmUsage,
  listRecentUsage,
  usageSummary,
  usageByUser,
} = await import('../server/services/usage.js');

let userId;
let otherUserId;

before(() => {
  const first = q.run(
    `INSERT INTO users (email, password_hash, consent_status, created_at, updated_at)
     VALUES (?, ?, 'granted', ?, ?)`,
    'first@example.com',
    'x',
    now(),
    now(),
  );
  userId = Number(first.lastInsertRowid);
  const second = q.run(
    `INSERT INTO users (email, password_hash, consent_status, created_at, updated_at)
     VALUES (?, ?, 'granted', ?, ?)`,
    'second@example.com',
    'x',
    now(),
    now(),
  );
  otherUserId = Number(second.lastInsertRowid);
});

after(() => {
  closeDb();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

test('usage: пишет расход и отдаёт последние запросы', () => {
  assert.ok(recordLlmUsage({
    userId,
    jobId: null,
    provider: 'gigachat',
    model: 'GigaChat-2',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, calls: 1 },
  }));

  const rows = listRecentUsage({ limit: 5 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, 'first@example.com');
  assert.equal(rows[0].totalTokens, 15);
  assert.equal(rows[0].promptTokens, 10);
  assert.equal(rows[0].completionTokens, 5);
});

test('usage: нулевой вызов не пишется', () => {
  const beforeCount = usageSummary().requests;
  assert.equal(recordLlmUsage({ userId, usage: { totalTokens: 0, calls: 0 } }), null);
  assert.equal(usageSummary().requests, beforeCount);
});

test('usage: агрегаты и разбивка по пользователям', () => {
  recordLlmUsage({
    userId: otherUserId,
    provider: 'gigachat',
    model: 'GigaChat-2',
    usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120, calls: 1 },
  });
  recordLlmUsage({
    userId: otherUserId,
    provider: 'gigachat',
    model: 'GigaChat-2',
    usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60, calls: 1 },
  });

  const summary = usageSummary();
  assert.equal(summary.requests, 3);
  assert.equal(summary.promptTokens, 160);
  assert.equal(summary.completionTokens, 35);
  assert.equal(summary.totalTokens, 195);

  const byUser = usageByUser({ limit: 10 });
  assert.equal(byUser.length, 2);
  assert.equal(byUser[0].email, 'second@example.com');
  assert.equal(byUser[0].requests, 2);
  assert.equal(byUser[0].totalTokens, 180);
});

test('usage: ошибка записи не пробрасывается', () => {
  assert.equal(safeRecordLlmUsage({ userId: null, usage: { totalTokens: 5, calls: 1 } }), null);
});
