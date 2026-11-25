// Роуты истории и настроек.
import express from 'express';
import { config } from '../config.js';
import { requireAuth, requireConsent } from '../middleware/index.js';
import {
  listDocuments, countDocuments, deleteDocument, listJobs, exportStats,
  purgeExpired,
} from '../services/documents.js';
import { publicUser, consentHistory, deleteUserData, hasConsent } from '../services/users.js';
import { q } from '../db/index.js';

export const historyRouter = express.Router();

historyRouter.get('/documents', requireAuth, (req, res) => {
  const query = String(req.query.q || '');
  const limit = Math.min(100, Number(req.query.limit) || 30);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  res.json({
    items: listDocuments(req.user.id, { query, limit, offset }),
    total: countDocuments(req.user.id, query),
    limit,
    offset,
  });
});

historyRouter.delete('/documents/:id', requireAuth, (req, res) => {
  const ok = deleteDocument(req.user.id, Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'Документ не найден', code: 'not_found' });
  res.json({ ok: true });
});

historyRouter.get('/settings', requireAuth, (req, res) => {
  res.json({
    user: publicUser(req.user),
    consentRequired: !hasConsent(req.user),
    policyVersion: config.policyVersion,
    operator: config.operator,
    retentionDays: req.user.retention_days ?? config.retentionDays,
    limits: { maxChars: config.limits.maxChars, maxPdfPages: config.limits.maxPdfPages },
    llm: { provider: config.llm.provider, enabled: config.llm.provider !== 'rules' && config.llm.enabled, model: config.llm.model },
    ocr: { enabled: config.ocr.enabled, languages: config.ocr.languages },
    history: consentHistory(req.user.id),
    exports: exportStats(req.user.id),
  });
});

historyRouter.post('/settings/retention', express.json(), requireAuth, (req, res) => {
  const days = Math.min(365, Math.max(1, Math.round(Number(req.body?.days) || config.retentionDays)));
  q.run('UPDATE users SET retention_days = ?, updated_at = ? WHERE id = ?', days, new Date().toISOString(), req.user.id);
  res.json({ ok: true, retentionDays: days });
});

historyRouter.post('/settings/purge', requireAuth, (req, res) => {
  const result = purgeExpired(req.user.retention_days ?? config.retentionDays);
  res.json({ ok: true, ...result });
});

historyRouter.post('/settings/delete-data', express.json(), requireAuth, (req, res) => {
  if (req.body?.confirm !== 'УДАЛИТЬ') {
    return res.status(400).json({ error: 'Подтверди удаление', code: 'confirm_required' });
  }
  deleteUserData(req.user.id);
  res.json({ ok: true, deleted: true });
});

historyRouter.get('/jobs', requireAuth, (req, res) => {
  const limit = Math.min(100, Number(req.query.limit) || 30);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  res.json({ items: listJobs(req.user.id, { limit, offset }) });
});
