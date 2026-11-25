// Учёт обращений субъектов ПДн и журнал доступа к персональным данным.
import { q, now } from '../db/index.js';
import { config } from '../config.js';
import { randomToken } from '../lib/crypto.js';

const KINDS = new Set(['access', 'delete', 'revoke', 'other']);

/** Журнал фактов доступа/обработки: без содержимого текстов и секретов. */
export function logPdAccess({ actor, action, userId = null, detail = null }) {
  q.run(
    'INSERT INTO pd_access_log (actor, action, user_id, detail, created_at) VALUES (?,?,?,?,?)',
    String(actor || 'system').slice(0, 100),
    String(action || 'unknown').slice(0, 100),
    userId ?? null,
    detail == null ? null : String(detail).slice(0, 300),
    now(),
  );
}

/** Срок ответа по ст. 20 152-ФЗ: рабочие дни, суббота и воскресенье пропускаются. */
export function subjectRequestDeadline(from = new Date(), days = config.personalData.subjectRequestSlaDays) {
  const date = new Date(from);
  date.setHours(0, 0, 0, 0);
  let left = Math.max(1, Math.trunc(Number(days)) || 10);
  while (left > 0) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return date.toISOString();
}

export function createSubjectRequest({ name, email, kind, comment = '' }) {
  const cleanKind = KINDS.has(kind) ? kind : 'other';
  const publicId = randomToken(12);
  const timestamp = now();
  const dueAt = subjectRequestDeadline(new Date(timestamp));
  const text = [
    `Имя: ${name}`,
    `Почта: ${email}`,
    `Тип: ${cleanKind}`,
    '',
    String(comment || '').slice(0, 2000),
  ].join('\n');
  q.run(
    `INSERT INTO subject_requests (public_id, email, name, kind, text, status, created_at, due_at)
     VALUES (?,?,?,?,?,'received',?,?)`,
    publicId,
    email,
    String(name).slice(0, 120),
    cleanKind,
    text,
    timestamp,
    dueAt,
  );
  logPdAccess({ actor: `subject:${email}`, action: 'subject_request.created', detail: `ticket=${publicId} kind=${cleanKind}` });
  return { publicId, createdAt: timestamp, dueAt, kind: cleanKind };
}

export function findSubjectRequest(publicId, email) {
  const row = q.get(
    'SELECT public_id, kind, status, created_at, due_at, resolved_at FROM subject_requests WHERE public_id = ? AND email = ?',
    String(publicId || '').slice(0, 100),
    String(email || '').trim().toLowerCase(),
  );
  if (!row) return null;
  return {
    publicId: row.public_id,
    kind: row.kind,
    status: row.status,
    createdAt: row.created_at,
    dueAt: row.due_at,
    resolvedAt: row.resolved_at,
  };
}

export function deleteSubjectRequestsForEmail(email) {
  return q.run('DELETE FROM subject_requests WHERE email = ?', String(email || '').trim().toLowerCase()).changes;
}

/** Очистка служебных журналов по отдельному сроку, не зависящему от retention текстов. */
export function purgePersonalDataLogs() {
  const logDays = config.personalData.accessLogRetentionDays;
  const requestDays = config.personalData.subjectRequestRetentionDays;
  const logThreshold = new Date(Date.now() - logDays * 24 * 3600 * 1000).toISOString();
  const requestThreshold = new Date(Date.now() - requestDays * 24 * 3600 * 1000).toISOString();
  const accessLog = q.run('DELETE FROM pd_access_log WHERE created_at < ?', logThreshold).changes;
  const requests = q.run('DELETE FROM subject_requests WHERE created_at < ?', requestThreshold).changes;
  return { accessLog, subjectRequests: requests };
}
