// Роуты обработки: paste, файлы, URL, задачи, ревизии, экспорт.
import express from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { requireAuth, requireConsent, clientIp, rateLimitMiddleware } from '../middleware/index.js';
import { checkCharLimit, ingestPaste, ingestText, needsAsync, extractFile, extractUrlText } from '../services/ingest.js';
import {
  createJob, getJob, getJobByPublicId, updateJob, listJobs, requestCancel,
  getDocument, saveRevision, listRevisions, getRevision, logExport, logBlockedAttempt,
  activeJobsCount, mapJob, getJobRaw,
} from '../services/documents.js';
import { enqueueJob } from '../jobs/queue.js';
import { runPipeline } from '../core/pipeline.js';
import { precheck } from '../core/precheck.js';
import { buildLineDiff, diffSummary } from '../core/diff.js';
import { exportDocument, filenameFor, FORMATS, FORMAT_META } from '../core/export/index.js';
import { astFromEditedText, parsePlainText, astToPlainText } from '../core/text/ast.js';
import { q } from '../db/index.js';

export const processRouter = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.limits.maxUploadBytes, files: 1 },
});

const processLimiter = rateLimitMiddleware({ name: 'process', limit: config.rateLimit.processPerHour, windowMs: 3600_000 });
const uploadLimiter = rateLimitMiddleware({ name: 'upload', limit: config.rateLimit.uploadPerHour, windowMs: 3600_000 });

const normalizeOptions = (body = {}) => ({
  r1: Boolean(body.r1),
  r2: Boolean(body.r2),
  r3: Boolean(body.r3),
  level: Math.min(5, Math.max(1, Math.round(Number(body.level) || 3))),
});

// ---------- Обработка вставленного текста ----------
processRouter.post('/process', processLimiter, express.json({ limit: '4mb' }), requireAuth, requireConsent, async (req, res) => {
  const { text, options } = req.body || {};
  const limit = checkCharLimit(text);
  if (!limit.ok) {
    return res.status(413).json({ error: limit.error, code: limit.code, chars: limit.chars, max: limit.max });
  }
  if (!String(text || '').trim()) {
    return res.status(400).json({ error: 'Вставь текст — и мы его переделаем', code: 'empty' });
  }

  const opts = normalizeOptions(options);
  if (!opts.r1 && !opts.r2 && !opts.r3) {
    return res.status(400).json({ error: 'Включи хотя бы один режим', code: 'no_modes' });
  }

  // Быстрая предпроверка до создания документа: не храним заблокированный текст.
  const check = precheck(text);
  if (!check.ok) {
    logBlockedAttempt({
      userId: req.user.id,
      reasonCode: check.code,
      excerpt: check.details?.excerpt,
      charCount: String(text).length,
    });
    return res.status(422).json({
      error: check.reason.message,
      code: check.code,
      title: check.reason.title,
      scientific: check.scientific,
    });
  }

  const { documentId, text: normalized } = ingestPaste({ userId: req.user.id, text });

  if (String(normalized).length > config.syncMaxChars) {
    const jobId = createJob({ userId: req.user.id, documentId, options: opts, mode: 'async' });
    enqueueJob(jobId, { kind: 'process', text: normalized, options: opts, documentId });
    const job = getJob(req.user.id, jobId);
    return res.status(202).json({ async: true, job: serializeJob(job), documentId });
  }

  const started = Date.now();
  const jobId = createJob({ userId: req.user.id, documentId, options: opts, mode: 'sync' });
  updateJob(jobId, { status: 'processing', stage: 'precheck', startedAt: new Date().toISOString() });

  try {
    const result = await runPipeline({
      text: normalized,
      options: opts,
      onProgress: (stage) => updateJob(jobId, { stage: stage.key, progress: stage.progress }),
      isCancelled: () => false,
    });

    if (!result.ok) {
      updateJob(jobId, {
        status: 'failed',
        errorCode: result.code,
        errorMessage: result.reason?.message,
        finishedAt: new Date().toISOString(),
      });
      return res.status(422).json({ error: result.reason?.message, code: result.code, title: result.reason?.title });
    }

    updateJob(jobId, {
      status: 'done',
      stage: 'done',
      progress: 100,
      resultText: result.text,
      resultAst: result.ast,
      integrity: result.integrity,
      llmProvider: result.llm.provider,
      llmModel: result.llm.model,
      promptVersion: result.llm.promptVersion,
      finishedAt: new Date().toISOString(),
    });

    const job = getJob(req.user.id, jobId);
    return res.json({
      async: false,
      job: serializeJob(job),
      documentId,
      elapsedMs: Date.now() - started,
      readability: result.readability,
      stats: result.stats,
      integrity: result.integrity,
      llm: result.llm,
      diff: diffSummary(normalized, result.text),
    });
  } catch (error) {
    updateJob(jobId, {
      status: 'failed',
      errorCode: error.code || 'internal',
      errorMessage: 'Что-то пошло не так. Попробуй ещё раз',
      finishedAt: new Date().toISOString(),
    });
    return res.status(500).json({ error: 'Что-то пошло не так. Попробуй ещё раз', code: 'internal' });
  }
});

// ---------- Загрузка файла ----------
processRouter.post('/process/file', uploadLimiter, upload.single('file'), requireAuth, requireConsent, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не пришёл', code: 'no_file' });
  const opts = normalizeOptions(req.body || {});

  try {
    const extracted = await extractFile(req.file);
    const limit = checkCharLimit(extracted.text);
    if (!limit.ok) {
      return res.status(413).json({ error: limit.error, code: limit.code, chars: limit.chars, max: limit.max });
    }
    if (!extracted.text.trim()) {
      return res.status(422).json({ error: 'В файле не нашлось текста', code: 'no_text' });
    }

    const check = precheck(extracted.text);
    if (!check.ok) {
      logBlockedAttempt({
        userId: req.user.id,
        reasonCode: check.code,
        excerpt: check.details?.excerpt,
        charCount: extracted.text.length,
      });
      return res.status(422).json({ error: check.reason.message, code: check.code, title: check.reason.title });
    }

    const { documentId } = ingestText({
      userId: req.user.id,
      text: extracted.text,
      source: 'file',
      title: extracted.title || req.file.originalname,
      meta: extracted.meta,
      ast: extracted.ast,
      pageCount: extracted.meta?.pages,
      fromOcr: Boolean(extracted.meta?.fromOcr || extracted.fromOcr),
      ocrConfidence: extracted.meta?.ocrConfidence,
    });

    // Скан-PDF и длинные документы — всегда в очередь.
    if (needsAsync({ source: 'file', text: extracted.text, meta: extracted.meta })) {
      const jobId = createJob({ userId: req.user.id, documentId, options: opts, mode: 'async' });
      enqueueJob(jobId, { kind: 'process', text: extracted.text, options: opts, documentId });
      const job = getJob(req.user.id, jobId);
      return res.status(202).json({
        async: true,
        job: serializeJob(job),
        documentId,
        fromOcr: Boolean(extracted.meta?.fromOcr),
        meta: extracted.meta,
      });
    }

    const jobId = createJob({ userId: req.user.id, documentId, options: opts, mode: 'sync' });
    updateJob(jobId, { status: 'processing', stage: 'precheck', startedAt: new Date().toISOString() });
    const result = await runPipeline({ text: extracted.text, options: opts });
    if (!result.ok) {
      updateJob(jobId, { status: 'failed', errorCode: result.code, errorMessage: result.reason?.message, finishedAt: new Date().toISOString() });
      return res.status(422).json({ error: result.reason?.message, code: result.code, title: result.reason?.title });
    }
    updateJob(jobId, {
      status: 'done', stage: 'done', progress: 100,
      resultText: result.text, resultAst: result.ast, integrity: result.integrity,
      llmProvider: result.llm.provider, llmModel: result.llm.model, promptVersion: result.llm.promptVersion,
      finishedAt: new Date().toISOString(),
    });
    const job = getJob(req.user.id, jobId);
    return res.json({
      async: false,
      job: serializeJob(job),
      documentId,
      fromOcr: Boolean(extracted.meta?.fromOcr),
      meta: extracted.meta,
      readability: result.readability,
      integrity: result.integrity,
      llm: result.llm,
      diff: diffSummary(extracted.text, result.text),
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      error: status === 500 ? 'Не получилось прочитать файл. Попробуй другой' : error.message,
      code: error.code || 'extract_failed',
    });
  }
});

// ---------- Загрузка по ссылке ----------
processRouter.post('/process/url', processLimiter, express.json(), requireAuth, requireConsent, async (req, res) => {
  const { url, options } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Вставь ссылку', code: 'no_url' });
  const opts = normalizeOptions(options);
  try {
    const extracted = await extractUrlText(url);
    const limit = checkCharLimit(extracted.text);
    if (!limit.ok) return res.status(413).json({ error: limit.error, code: limit.code });
    const check = precheck(extracted.text);
    if (!check.ok) {
      logBlockedAttempt({ userId: req.user.id, reasonCode: check.code, excerpt: check.details?.excerpt, charCount: extracted.text.length });
      return res.status(422).json({ error: check.reason.message, code: check.code, title: check.reason.title });
    }
    const { documentId } = ingestText({
      userId: req.user.id, text: extracted.text, source: 'url',
      title: extracted.title, meta: extracted.meta, ast: extracted.ast,
    });
    if (needsAsync({ source: 'url', text: extracted.text, meta: extracted.meta })) {
      const jobId = createJob({ userId: req.user.id, documentId, options: opts, mode: 'async' });
      enqueueJob(jobId, { kind: 'process', text: extracted.text, options: opts, documentId });
      return res.status(202).json({ async: true, job: serializeJob(getJob(req.user.id, jobId)), documentId });
    }
    const jobId = createJob({ userId: req.user.id, documentId, options: opts, mode: 'sync' });
    updateJob(jobId, { status: 'processing', stage: 'precheck', startedAt: new Date().toISOString() });
    const result = await runPipeline({ text: extracted.text, options: opts });
    if (!result.ok) {
      updateJob(jobId, { status: 'failed', errorCode: result.code, errorMessage: result.reason?.message, finishedAt: new Date().toISOString() });
      return res.status(422).json({ error: result.reason?.message, code: result.code });
    }
    updateJob(jobId, {
      status: 'done', stage: 'done', progress: 100, resultText: result.text, resultAst: result.ast,
      integrity: result.integrity, llmProvider: result.llm.provider, llmModel: result.llm.model,
      promptVersion: result.llm.promptVersion, finishedAt: new Date().toISOString(),
    });
    return res.json({
      async: false, job: serializeJob(getJob(req.user.id, jobId)), documentId,
      readability: result.readability, integrity: result.integrity, llm: result.llm,
      diff: diffSummary(extracted.text, result.text),
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Не получилось открыть ссылку', code: error.code || 'url_failed' });
  }
});

// ---------- Задачи ----------
processRouter.get('/jobs', requireAuth, (req, res) => {
  const limit = Math.min(100, Number(req.query.limit) || 30);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  res.json({ items: listJobs(req.user.id, { limit, offset }), active: activeJobsCount(req.user.id) });
});

processRouter.get('/jobs/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const job = Number.isFinite(id) ? getJob(req.user.id, id) : getJobByPublicId(req.user.id, req.params.id);
  if (!job) return res.status(404).json({ error: 'Задача не найдена', code: 'not_found' });
  const document = job.documentId ? getDocument(req.user.id, job.documentId) : null;
  const payload = { job: serializeJob(job) };
  if (document) {
    payload.document = {
      id: document.id, source: document.source, title: document.title,
      charCount: document.charCount, pageCount: document.pageCount,
      fromOcr: document.fromOcr, ocrConfidence: document.ocrConfidence,
      createdAt: document.createdAt,
    };
    if (job.status === 'done' && job.resultText != null) {
      payload.original = document.text;
      payload.diff = diffSummary(document.text, job.resultText);
      // Подсветка изменений внутри строк — на клиенте строится по парам.
      payload.diffRows = buildLineDiff(document.text, job.resultText).slice(0, 3000);
    }
  }
  res.json(payload);
});

processRouter.post('/jobs/:id/cancel', requireAuth, (req, res) => {
  const result = requestCancel(req.user.id, Number(req.params.id));
  if (!result.ok) {
    if (result.code === 'not_found') return res.status(404).json({ error: 'Задача не найдена', code: 'not_found' });
    return res.status(409).json({ error: 'Задача уже завершена', code: result.code, status: result.status });
  }
  res.json({ ok: true, status: 'cancelling' });
});

// ---------- Документы ----------
processRouter.get('/documents/:id', requireAuth, (req, res) => {
  const doc = getDocument(req.user.id, Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Документ не найден', code: 'not_found' });
  res.json({ document: { ...doc, text: doc.text } });
});

// ---------- Ревизии ----------
processRouter.get('/jobs/:id/revisions', requireAuth, (req, res) => {
  const job = getJob(req.user.id, Number(req.params.id));
  if (!job) return res.status(404).json({ error: 'Задача не найдена', code: 'not_found' });
  res.json({ items: listRevisions(job.id, req.user.id) });
});

processRouter.post('/jobs/:id/revisions', express.json({ limit: '4mb' }), requireAuth, requireConsent, (req, res) => {
  const job = getJob(req.user.id, Number(req.params.id));
  if (!job) return res.status(404).json({ error: 'Задача не найдена', code: 'not_found' });
  const { text, baseRevision } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Пустая правка', code: 'empty' });
  }
  const limit = checkCharLimit(text);
  if (!limit.ok) return res.status(413).json({ error: limit.error, code: limit.code });

  const latest = q.get('SELECT MAX(revision) AS rev FROM edits WHERE job_id = ?', job.id);
  const currentRevision = latest?.rev ?? 0;
  if (baseRevision != null && Number(baseRevision) !== currentRevision) {
    return res.status(409).json({
      error: 'Текст уже правили в другой вкладке. Обнови страницу, чтобы не потерять правки',
      code: 'conflict',
      currentRevision,
    });
  }
  const ast = parsePlainText(text);
  const revision = saveRevision({ jobId: job.id, userId: req.user.id, text, ast });
  res.json({ ok: true, revision, savedAt: new Date().toISOString() });
});

processRouter.get('/jobs/:id/revisions/:revision', requireAuth, (req, res) => {
  const job = getJob(req.user.id, Number(req.params.id));
  if (!job) return res.status(404).json({ error: 'Задача не найдена', code: 'not_found' });
  const rev = getRevision(job.id, req.user.id, Number(req.params.revision));
  if (!rev) return res.status(404).json({ error: 'Версия не найдена', code: 'not_found' });
  res.json({ revision: rev });
});

// ---------- Экспорт ----------
processRouter.get('/jobs/:id/export/:format', requireAuth, async (req, res) => {
  const job = getJob(req.user.id, Number(req.params.id));
  if (!job) return res.status(404).json({ error: 'Задача не найдена', code: 'not_found' });
  if (job.status !== 'done' || !job.resultText) {
    return res.status(409).json({ error: 'Результат ещё не готов', code: 'not_ready' });
  }
  const format = String(req.params.format || '').toLowerCase();
  if (!FORMATS.includes(format)) {
    return res.status(400).json({ error: 'Этот формат пока не умеем', code: 'unsupported_format' });
  }
  const document = job.documentId ? getDocument(req.user.id, job.documentId) : null;
  const ast = job.resultAst || astFromEditedText(job.resultText);
  const title = document?.title || 'Челотекст';

  try {
    const { buffer, meta } = await exportDocument(ast, format, { title });
    logExport({ jobId: job.id, userId: req.user.id, format, bytes: buffer.length });
    const filename = filenameFor(title, format);
    res.setHeader('Content-Type', meta.mime);
    res.setHeader('Content-Disposition', `attachment; filename="chelotext.${meta.ext}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Не получилось собрать файл', code: error.code || 'export_failed' });
  }
});

// ---------- Копирование: чистый plain text ----------
processRouter.get('/jobs/:id/text', requireAuth, (req, res) => {
  const job = getJob(req.user.id, Number(req.params.id));
  if (!job) return res.status(404).json({ error: 'Задача не найдена', code: 'not_found' });
  res.json({ text: job.resultText ?? '' });
});

function serializeJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    publicId: job.publicId,
    documentId: job.documentId,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    mode: job.mode,
    options: job.options,
    resultText: job.resultText,
    resultAst: job.resultAst,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    integrity: job.integrity,
    llm: job.llm,
    cancelRequested: job.cancelRequested,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

export { serializeJob };
