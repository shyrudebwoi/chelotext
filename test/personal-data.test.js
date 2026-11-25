// Тесты соответствия 152-ФЗ: согласие, обращения субъектов, ретеншн и удаление.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelotext-pd-'));
process.env.DATA_DIR = tmpDir;
process.env.DB_FILE = path.join(tmpDir, 'pd.sqlite');
process.env.SESSION_SECRET = 'test-secret-value-0123456789';
process.env.NODE_ENV = 'test';
process.env.LLM_ENABLED = 'false';

const { getDb, q } = await import('../server/db/index.js');
const { config } = await import('../server/config.js');
const {
  createUser, recordConsent, consentHistory, hasThirdPartyConsent,
  setThirdPartyConsent, deleteUserData, createSession, getUserById,
} = await import('../server/services/users.js');
const { consentDocument, consentHash } = await import('../server/services/consent.js');
const {
  createSubjectRequest, findSubjectRequest, logPdAccess,
  purgePersonalDataLogs, subjectRequestDeadline,
} = await import('../server/services/personal-data.js');
const { purgeUserExpired, purgeExpiredAll } = await import('../server/services/documents.js');

getDb();

function insertDoc(userId, createdAt) {
  return Number(q.run(
    `INSERT INTO documents (user_id, source, original_text, char_count, created_at)
     VALUES (?, 'paste', 'текст', 4, ?)`,
    userId,
    createdAt,
  ).lastInsertRowid);
}

function oldDate(days) {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
}

test('согласие без подтверждения 18+ отклоняется', async () => {
  const user = await createUser('age@example.com', 'testpass123');
  await assert.rejects(
    async () => recordConsent(user.id, { ageConfirmed: false }),
    (error) => error.code === 'age_required',
  );
  assert.equal(getUserById(user.id).consent_status, 'none');
});

test('согласие хранит хеш текста, цели, получателей и отдельную галочку', async () => {
  const user = await createUser('consent@example.com', 'testpass123');
  const result = recordConsent(user.id, { ageConfirmed: true, thirdPartyConsent: true });
  assert.equal(result.status, 'granted');

  const row = q.get('SELECT * FROM consents WHERE user_id = ? ORDER BY id DESC LIMIT 1', user.id);
  assert.equal(row.consent_text_hash, consentHash());
  assert.ok(JSON.parse(row.purposes).length >= 3);
  assert.ok(JSON.parse(row.recipients).some((item) => item.includes('GigaChat')));
  assert.equal(row.age_confirmed, 1);
  assert.equal(row.third_party_consent, 1);
  assert.equal(hasThirdPartyConsent(getUserById(user.id)), true);

  const history = consentHistory(user.id);
  assert.equal(history[0].ageConfirmed, true);
  assert.equal(history[0].thirdPartyConsent, true);
  assert.ok(history[0].consentTextHash);
});

test('передачу текста можно отозвать отдельно, не теряя согласия', async () => {
  const user = await createUser('third@example.com', 'testpass123');
  recordConsent(user.id, { ageConfirmed: true, thirdPartyConsent: true });
  setThirdPartyConsent(user.id, false);
  assert.equal(getUserById(user.id).consent_status, 'granted');
  assert.equal(hasThirdPartyConsent(getUserById(user.id)), false);
});

test('текст согласия содержит обязательные реквизиты и заглушки оператора', () => {
  const doc = consentDocument();
  for (const part of [
    '18 лет', 'Оператор', 'Получатели', 'Срок обработки', 'Отзыв', 'Трансграничная передача',
  ]) {
    assert.ok(doc.text.includes(part), `нет раздела ${part}`);
  }
  assert.ok(doc.text.includes('Оператор сервиса «Челотекст»'));
  assert.ok(doc.text.includes(config.personalData.localization));
  assert.equal(doc.text, consentDocument().text);
});

test('обращение субъекта сохраняется и ищется по номеру и почте', () => {
  const created = createSubjectRequest({
    name: 'Иван Иванов',
    email: 'ivan@example.com',
    kind: 'access',
    comment: 'Какие данные хранятся?',
  });
  assert.ok(created.publicId);
  assert.ok(new Date(created.dueAt).getTime() > new Date(created.createdAt).getTime());

  const found = findSubjectRequest(created.publicId, 'ivan@example.com');
  assert.equal(found.status, 'received');
  assert.equal(found.kind, 'access');
  assert.equal(findSubjectRequest(created.publicId, 'other@example.com'), null);
});

test('срок ответа считается по рабочим дням и не короче 10 дней', () => {
  const from = new Date('2026-11-20T10:00:00.000Z');
  const due = new Date(subjectRequestDeadline(from, config.personalData.subjectRequestSlaDays));
  assert.ok(due.getTime() > from.getTime() + 9 * 24 * 3600 * 1000);
});

test('ручная очистка не применяет срок одного пользователя к другому', async () => {
  const first = await createUser('purge1@example.com', 'testpass123');
  const second = await createUser('purge2@example.com', 'testpass123');
  const oldFirst = insertDoc(first.id, oldDate(10));
  const oldSecond = insertDoc(second.id, oldDate(10));

  const result = purgeUserExpired(first.id, 1);
  assert.ok(result.documents >= 1);
  assert.equal(q.get('SELECT id FROM documents WHERE id = ?', oldFirst), undefined);
  assert.ok(q.get('SELECT id FROM documents WHERE id = ?', oldSecond));
});

test('фоновая очистка учитывает персональный срок каждого пользователя', async () => {
  const short = await createUser('short@example.com', 'testpass123');
  const long = await createUser('long@example.com', 'testpass123');
  const shortDoc = insertDoc(short.id, oldDate(10));
  const longDoc = insertDoc(long.id, oldDate(10));
  q.run('UPDATE users SET retention_days = ? WHERE id = ?', 1, short.id);
  q.run('UPDATE users SET retention_days = ? WHERE id = ?', 365, long.id);

  purgeExpiredAll();
  assert.equal(q.get('SELECT id FROM documents WHERE id = ?', shortDoc), undefined);
  assert.ok(q.get('SELECT id FROM documents WHERE id = ?', longDoc));
});

test('удаление данных убирает сессии и обращения с той же почты', async () => {
  const user = await createUser('erase@example.com', 'testpass123');
  const session = createSession(user.id, { ip: '127.0.0.1', userAgent: 'test' });
  const request = createSubjectRequest({ name: 'Пользователь', email: 'erase@example.com', kind: 'delete' });

  deleteUserData(user.id);
  assert.equal(q.get('SELECT id FROM sessions WHERE id = ?', session.id), undefined);
  assert.equal(findSubjectRequest(request.publicId, 'erase@example.com'), null);
  assert.equal(q.get('SELECT id FROM documents WHERE user_id = ?', user.id), undefined);
});

test('журнал доступа очищается по отдельному сроку', () => {
  logPdAccess({ actor: 'test', action: 'test.action', detail: 'без секретов' });
  q.run('UPDATE pd_access_log SET created_at = ? WHERE action = ?', oldDate(400), 'test.action');
  const fresh = q.get('SELECT MAX(id) AS id FROM pd_access_log');
  const result = purgePersonalDataLogs();
  assert.ok(result.accessLog >= 1);
  assert.equal(q.get('SELECT id FROM pd_access_log WHERE id = ?', fresh.id), undefined);
});
