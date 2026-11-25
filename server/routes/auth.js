// Роуты авторизации и согласия.
import express from 'express';
import { config } from '../config.js';
import {
  createUser, authenticate, validateEmail, validatePassword, publicUser,
  createSession, destroySession, recordConsent, consentHistory, hasConsent,
  deleteUserData, deleteUserAccount, destroyUserSessions,
} from '../services/users.js';
import {
  setSessionCookie, clearSessionCookie, requireAuth, clientIp,
  rateLimitMiddleware, attachUser,
} from '../middleware/index.js';

export const authRouter = express.Router();

const loginLimiter = rateLimitMiddleware({ name: 'login', limit: config.rateLimit.loginPerHour, windowMs: 3600_000 });
const registerLimiter = rateLimitMiddleware({ name: 'register', limit: config.rateLimit.registerPerHour, windowMs: 3600_000 });

authRouter.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null, policyVersion: config.policyVersion });
  return res.json({
    user: publicUser(req.user),
    consentRequired: !hasConsent(req.user),
    policyVersion: config.policyVersion,
    limits: { maxChars: config.limits.maxChars, maxPdfPages: config.limits.maxPdfPages },
    llm: { provider: config.llm.provider, enabled: config.llm.provider !== 'rules' && config.llm.enabled },
  });
});

authRouter.post('/register', registerLimiter, express.json(), async (req, res) => {
  const { email, password } = req.body || {};
  const emailError = validateEmail(email);
  if (emailError) return res.status(400).json({ error: emailError, code: 'invalid_email' });
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError, code: 'invalid_password' });

  const created = await createUser(email, password);
  if (created.error) return res.status(409).json({ error: created.error, code: 'email_taken' });

  const session = createSession(created.id, { ip: clientIp(req), userAgent: req.headers['user-agent'] });
  setSessionCookie(res, session.id);
  return res.status(201).json({ ok: true, user: publicUser({ id: created.id, email: String(email).toLowerCase(), consent_status: 'none', created_at: new Date().toISOString() }) });
});

authRouter.post('/login', loginLimiter, express.json(), async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Заполни почту и пароль', code: 'missing_credentials' });
  const user = await authenticate(email, password);
  if (!user) return res.status(401).json({ error: 'Почта или пароль не подошли', code: 'invalid_credentials' });
  const session = createSession(user.id, { ip: clientIp(req), userAgent: req.headers['user-agent'] });
  setSessionCookie(res, session.id);
  return res.json({ ok: true, user });
});

authRouter.post('/logout', express.json(), (req, res) => {
  if (req.sessionId) destroySession(req.sessionId);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ---------- Согласие ПДн ----------
authRouter.post('/consent', attachUser, requireAuth, express.json(), (req, res) => {
  const { action = 'grant', policyVersion } = req.body || {};
  if (!['grant', 'revoke'].includes(action)) {
    return res.status(400).json({ error: 'Неизвестное действие', code: 'invalid_action' });
  }
  if (action === 'grant' && policyVersion && policyVersion !== config.policyVersion) {
    return res.status(409).json({
      error: 'Политика обновилась. Прочитай новую версию и подтверди снова',
      code: 'policy_changed',
      policyVersion: config.policyVersion,
    });
  }

  const consent = recordConsent(req.user.id, {
    ip: clientIp(req),
    userAgent: req.headers['user-agent'],
    policyVersion: config.policyVersion,
    action,
  });

  if (action === 'revoke') {
    // Отзыв согласия = фактическое удаление данных (ТЗ 8).
    deleteUserData(req.user.id);
    return res.json({
      ok: true,
      consent,
      deleted: true,
      message: 'Согласие отозвано, тексты удалены',
    });
  }
  return res.json({ ok: true, consent });
});

authRouter.get('/consent/history', attachUser, requireAuth, (req, res) => {
  res.json({ items: consentHistory(req.user.id), policyVersion: config.policyVersion });
});

// ---------- Аккаунт ----------
authRouter.delete('/account', attachUser, requireAuth, express.json(), (req, res) => {
  const { confirm } = req.body || {};
  if (confirm !== 'УДАЛИТЬ') {
    return res.status(400).json({ error: 'Подтверди удаление', code: 'confirm_required' });
  }
  destroyUserSessions(req.user.id);
  deleteUserAccount(req.user.id);
  clearSessionCookie(res);
  return res.json({ ok: true, deleted: true });
});
