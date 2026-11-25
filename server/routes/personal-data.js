// Обращения субъектов ПДн (ст. 20 152-ФЗ). Приём и проверка статуса по номеру.
import express from 'express';
import { rateLimitMiddleware } from '../middleware/index.js';
import { createSubjectRequest, findSubjectRequest, logPdAccess } from '../services/personal-data.js';
import { validateEmail } from '../services/users.js';

export const pdRouter = express.Router();

const submitLimiter = rateLimitMiddleware({ name: 'pd_submit', limit: 5, windowMs: 3600_000 });
const statusLimiter = rateLimitMiddleware({ name: 'pd_status', limit: 20, windowMs: 3600_000 });

const KINDS = new Set(['access', 'delete', 'revoke', 'other']);

pdRouter.post('/pd/request', submitLimiter, express.json({ limit: '16kb' }), (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const kind = String(req.body?.kind ?? 'other');
  const comment = String(req.body?.comment ?? '').trim();

  if (name.length < 2 || name.length > 120) {
    return res.status(400).json({ error: 'Укажи имя (от 2 до 120 знаков)', code: 'invalid_name' });
  }
  const emailError = validateEmail(email);
  if (emailError) return res.status(400).json({ error: emailError, code: 'invalid_email' });
  if (!KINDS.has(kind)) return res.status(400).json({ error: 'Неизвестный тип обращения', code: 'invalid_kind' });
  if (comment.length > 2000) {
    return res.status(400).json({ error: 'Комментарий — не длиннее 2000 знаков', code: 'too_long' });
  }

  const created = createSubjectRequest({ name, email, kind, comment });
  res.status(201).json({
    ok: true,
    ticket: created.publicId,
    dueAt: created.dueAt,
    message: 'Обращение принято. Ответим на указанную почту в срок по закону',
  });
});

pdRouter.get('/pd/request/:ticket', statusLimiter, (req, res) => {
  const email = String(req.query.email ?? '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Укажи почту из обращения', code: 'email_required' });
  const item = findSubjectRequest(req.params.ticket, email);
  if (!item) return res.status(404).json({ error: 'Обращение не найдено', code: 'not_found' });
  logPdAccess({ actor: `subject:${email}`, action: 'subject_request.status', detail: `ticket=${item.publicId}` });
  res.json({ ok: true, request: item });
});
