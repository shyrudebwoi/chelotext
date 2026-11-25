// Пользователи, сессии, согласие на обработку ПДн.
import { q, now } from '../db/index.js';
import { hashPassword, verifyPassword, randomToken, hmac, safeEqual } from '../lib/crypto.js';
import { config } from '../config.js';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Zа-яА-Я]{2,}$/;

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function validateEmail(email) {
  const value = normalizeEmail(email);
  if (!value || value.length > 254) return 'Укажи почту';
  if (!EMAIL_RE.test(value)) return 'Похоже, в почте опечатка';
  return null;
}

export function validatePassword(password) {
  const value = String(password ?? '');
  if (value.length < config.limits.minPassword) return `Пароль должен быть не короче ${config.limits.minPassword} символов`;
  if (value.length > 200) return 'Слишком длинный пароль';
  if (!/\p{L}/u.test(value)) return 'Добавь в пароль хотя бы одну букву';
  return null;
}

export async function createUser(email, password) {
  const normalized = normalizeEmail(email);
  const existing = q.get('SELECT id FROM users WHERE email = ?', normalized);
  if (existing) return { error: 'Такая почта уже зарегистрирована' };
  const hash = await hashPassword(password);
  const timestamp = now();
  const result = q.run(
    `INSERT INTO users (email, password_hash, consent_status, created_at, updated_at)
     VALUES (?, ?, 'none', ?, ?)`,
    normalized,
    hash,
    timestamp,
    timestamp,
  );
  return { id: Number(result.lastInsertRowid) };
}

export async function authenticate(email, password) {
  const user = q.get('SELECT * FROM users WHERE email = ?', normalizeEmail(email));
  if (!user) {
    // Постоянное время: не даём понять, есть ли такая почта.
    await verifyPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
    return null;
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return null;
  return publicUser(user);
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    consentStatus: user.consent_status,
    consentAt: user.consent_at,
    consentPolicyVersion: user.consent_policy_version,
    retentionDays: user.retention_days ?? config.retentionDays,
    createdAt: user.created_at,
  };
}

export function getUserById(id) {
  return q.get('SELECT * FROM users WHERE id = ?', id);
}

// ---------- Сессии ----------
export function createSession(userId, { ip, userAgent } = {}) {
  const id = randomToken(32);
  const created = new Date();
  const expires = new Date(created.getTime() + config.sessionTtlDays * 24 * 3600 * 1000);
  q.run(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?)',
    id,
    userId,
    created.toISOString(),
    expires.toISOString(),
    ip ?? null,
    (userAgent ?? '').slice(0, 300),
  );
  return { id, expiresAt: expires.toISOString() };
}

export function getSession(sessionId) {
  if (!sessionId) return null;
  const session = q.get('SELECT * FROM sessions WHERE id = ?', sessionId);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    q.run('DELETE FROM sessions WHERE id = ?', sessionId);
    return null;
  }
  const user = getUserById(session.user_id);
  if (!user) return null;
  return { session, user };
}

export function destroySession(sessionId) {
  if (sessionId) q.run('DELETE FROM sessions WHERE id = ?', sessionId);
}

export function destroyUserSessions(userId) {
  q.run('DELETE FROM sessions WHERE user_id = ?', userId);
}

export function pruneSessions() {
  q.run('DELETE FROM sessions WHERE expires_at < ?', now());
}

// ---------- Согласие ПДн ----------
export function recordConsent(userId, { ip, userAgent, policyVersion = config.policyVersion, action = 'grant' } = {}) {
  const timestamp = now();
  q.tx(() => {
    q.run(
      'INSERT INTO consents (user_id, action, policy_version, at, ip, user_agent) VALUES (?,?,?,?,?,?)',
      userId,
      action,
      policyVersion,
      timestamp,
      ip ?? null,
      (userAgent ?? '').slice(0, 300),
    );
    if (action === 'grant') {
      q.run(
        `UPDATE users SET consent_status = 'granted', consent_at = ?, consent_policy_version = ?, consent_ip = ?, updated_at = ? WHERE id = ?`,
        timestamp,
        policyVersion,
        ip ?? null,
        timestamp,
        userId,
      );
    } else {
      q.run(
        `UPDATE users SET consent_status = 'revoked', updated_at = ? WHERE id = ?`,
        timestamp,
        userId,
      );
    }
  });
  return { status: action === 'grant' ? 'granted' : 'revoked', at: timestamp, policyVersion };
}

export function hasConsent(user) {
  return Boolean(user && user.consent_status === 'granted');
}

export function consentHistory(userId) {
  return q.all('SELECT action, policy_version, at FROM consents WHERE user_id = ? ORDER BY id DESC LIMIT 50', userId);
}

// ---------- Удаление данных ----------
export function deleteUserData(userId) {
  q.tx(() => {
    q.run('DELETE FROM exports WHERE user_id = ?', userId);
    q.run('DELETE FROM edits WHERE user_id = ?', userId);
    q.run('DELETE FROM jobs WHERE user_id = ?', userId);
    q.run('DELETE FROM documents WHERE user_id = ?', userId);
    q.run('DELETE FROM precheck_log WHERE user_id = ?', userId);
    q.run('DELETE FROM llm_usage WHERE user_id = ?', userId);
  });
}

export function deleteUserAccount(userId) {
  q.tx(() => {
    q.run('DELETE FROM sessions WHERE user_id = ?', userId);
    q.run('DELETE FROM exports WHERE user_id = ?', userId);
    q.run('DELETE FROM edits WHERE user_id = ?', userId);
    q.run('DELETE FROM jobs WHERE user_id = ?', userId);
    q.run('DELETE FROM documents WHERE user_id = ?', userId);
    q.run('DELETE FROM precheck_log WHERE user_id = ?', userId);
    q.run('DELETE FROM llm_usage WHERE user_id = ?', userId);
    q.run('DELETE FROM consents WHERE user_id = ?', userId);
    q.run('DELETE FROM users WHERE id = ?', userId);
  });
}

// ---------- Cookie-подпись ----------
export function signSessionId(sessionId) {
  return `${sessionId}.${hmac(config.sessionSecret, sessionId)}`;
}

export function verifySessionCookie(value) {
  if (!value || typeof value !== 'string') return null;
  const index = value.lastIndexOf('.');
  if (index === -1) return null;
  const sessionId = value.slice(0, index);
  const signature = value.slice(index + 1);
  const expected = hmac(config.sessionSecret, sessionId);
  if (!safeEqual(signature, expected)) return null;
  return sessionId;
}
