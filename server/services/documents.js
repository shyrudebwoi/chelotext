// Документы и задачи: хранение, лимиты, жизненный цикл.
import { q, now } from '../db/index.js';
import { config } from '../config.js';

export function createDocument({ userId, source, text, title, meta, ast, pageCount, fromOcr, ocrConfidence, lang }) {
  const timestamp = now();
  const result = q.run(
    `INSERT INTO documents (user_id, source, title, source_meta, original_text, ast_json, char_count, page_count, lang, from_ocr, ocr_confidence, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    userId,
    source,
    title ?? null,
    meta ? JSON.stringify(meta) : null,
    text,
    ast ? JSON.stringify(ast) : null,
    text.length,
    pageCount ?? null,
    lang ?? 'ru',
    fromOcr ? 1 : 0,
    ocrConfidence ?? null,
    timestamp,
  );
  return Number(result.lastInsertRowid);
}

export function getDocument(userId, id) {
  const doc = q.get('SELECT * FROM documents WHERE id = ? AND user_id = ? AND deleted_at IS NULL', id, userId);
  if (!doc) return null;
  return {
    id: doc.id,
    source: doc.source,
    title: doc.title,
    meta: doc.source_meta ? safeJson(doc.source_meta) : null,
    text: doc.original_text,
    ast: doc.ast_json ? safeJson(doc.ast_json) : null,
    charCount: doc.char_count,
    pageCount: doc.page_count,
    lang: doc.lang,
    fromOcr: Boolean(doc.from_ocr),
    ocrConfidence: doc.ocr_confidence,
    createdAt: doc.created_at,
  };
}

export function listDocuments(userId, { query = '', limit = 50, offset = 0 } = {}) {
  const like = `%${String(query).trim()}%`;
  const rows = q.all(
    `SELECT d.id, d.source, d.title, d.char_count, d.from_ocr, d.ocr_confidence, d.created_at,
            (SELECT id FROM jobs WHERE document_id = d.id ORDER BY id DESC LIMIT 1) AS last_job_id,
            (SELECT status FROM jobs WHERE document_id = d.id ORDER BY id DESC LIMIT 1) AS last_status,
            substr(d.original_text, 1, 180) AS excerpt
       FROM documents d
      WHERE d.user_id = ? AND d.deleted_at IS NULL
        AND (? = '' OR d.original_text LIKE ? OR COALESCE(d.title,'') LIKE ?)
      ORDER BY d.created_at DESC
      LIMIT ? OFFSET ?`,
    userId,
    String(query).trim(),
    like,
    like,
    limit,
    offset,
  );
  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    title: row.title,
    charCount: row.char_count,
    fromOcr: Boolean(row.from_ocr),
    ocrConfidence: row.ocr_confidence,
    createdAt: row.created_at,
    lastJobId: row.last_job_id,
    lastStatus: row.last_status,
    excerpt: (row.excerpt || '').replace(/\s+/g, ' ').trim(),
  }));
}

export function countDocuments(userId, query = '') {
  const like = `%${String(query).trim()}%`;
  const row = q.get(
    `SELECT COUNT(*) AS n FROM documents d WHERE d.user_id = ? AND d.deleted_at IS NULL
       AND (? = '' OR d.original_text LIKE ? OR COALESCE(d.title,'') LIKE ?)`,
    userId,
    String(query).trim(),
    like,
    like,
  );
  return row?.n ?? 0;
}

export function deleteDocument(userId, id) {
  const result = q.run('UPDATE documents SET deleted_at = ? WHERE id = ? AND user_id = ?', now(), id, userId);
  return result.changes > 0;
}

// ---------- Задачи ----------
export function createJob({ userId, documentId, options, mode }) {
  const publicId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const timestamp = now();
  const result = q.run(
    `INSERT INTO jobs (public_id, user_id, document_id, options_json, mode, status, stage, progress, queued_at, created_at)
     VALUES (?,?,?,?,?,'queued','queued',0,?,?)`,
    publicId,
    userId,
    documentId,
    JSON.stringify(options || {}),
    mode,
    timestamp,
    timestamp,
  );
  return Number(result.lastInsertRowid);
}

export function getJob(userId, id) {
  const job = q.get('SELECT * FROM jobs WHERE id = ? AND user_id = ?', id, userId);
  return job ? mapJob(job) : null;
}

export function getJobByPublicId(userId, publicId) {
  const job = q.get('SELECT * FROM jobs WHERE public_id = ? AND user_id = ?', publicId, userId);
  return job ? mapJob(job) : null;
}

export function getJobRaw(id) {
  return q.get('SELECT * FROM jobs WHERE id = ?', id);
}

export function mapJob(job) {
  return {
    id: job.id,
    publicId: job.public_id,
    documentId: job.document_id,
    options: safeJson(job.options_json) || {},
    mode: job.mode,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    resultText: job.result_text,
    resultAst: job.result_ast_json ? safeJson(job.result_ast_json) : null,
    errorCode: job.error_code,
    errorMessage: job.error_message,
    integrity: job.integrity_json ? safeJson(job.integrity_json) : null,
    llm: { provider: job.llm_provider, model: job.llm_model, promptVersion: job.prompt_version },
    cancelRequested: Boolean(job.cancel_requested),
    queuedAt: job.queued_at,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
    createdAt: job.created_at,
  };
}

export function updateJob(id, patch) {
  const fields = [];
  const values = [];
  const mapping = {
    status: 'status',
    stage: 'stage',
    progress: 'progress',
    resultText: 'result_text',
    resultAst: 'result_ast_json',
    errorCode: 'error_code',
    errorMessage: 'error_message',
    integrity: 'integrity_json',
    llmProvider: 'llm_provider',
    llmModel: 'llm_model',
    promptVersion: 'prompt_version',
    cancelRequested: 'cancel_requested',
    startedAt: 'started_at',
    finishedAt: 'finished_at',
  };
  for (const [key, column] of Object.entries(mapping)) {
    if (!(key in patch)) continue;
    let value = patch[key];
    if (key === 'resultAst' || key === 'integrity') value = value == null ? null : JSON.stringify(value);
    if (key === 'cancelRequested') value = value ? 1 : 0;
    fields.push(`${column} = ?`);
    values.push(value);
  }
  if (!fields.length) return;
  values.push(id);
  q.run(`UPDATE jobs SET ${fields.join(', ')} WHERE id = ?`, ...values);
}

export function requestCancel(userId, id) {
  const job = getJob(userId, id);
  if (!job) return { ok: false, code: 'not_found' };
  if (['done', 'failed', 'cancelled'].includes(job.status)) {
    return { ok: false, code: 'already_finished', status: job.status };
  }
  updateJob(id, { cancelRequested: true });
  return { ok: true, status: job.status };
}

export function isCancelRequested(id) {
  const row = q.get('SELECT cancel_requested FROM jobs WHERE id = ?', id);
  return Boolean(row?.cancel_requested);
}

export function listJobs(userId, { limit = 50, offset = 0 } = {}) {
  const rows = q.all(
    `SELECT j.*, d.title AS doc_title, d.source AS doc_source, d.from_ocr AS doc_from_ocr
       FROM jobs j LEFT JOIN documents d ON d.id = j.document_id
      WHERE j.user_id = ? ORDER BY j.created_at DESC LIMIT ? OFFSET ?`,
    userId,
    limit,
    offset,
  );
  return rows.map((row) => ({ ...mapJob(row), documentTitle: row.doc_title, documentSource: row.doc_source, fromOcr: Boolean(row.doc_from_ocr) }));
}

export function activeJobsCount(userId) {
  const row = q.get(
    `SELECT COUNT(*) AS n FROM jobs WHERE user_id = ? AND status IN ('queued','processing')`,
    userId,
  );
  return row?.n ?? 0;
}

// ---------- Ревизии (правки пользователя) ----------
export function saveRevision({ jobId, userId, text, ast }) {
  return q.tx(() => {
    const last = q.get('SELECT MAX(revision) AS rev FROM edits WHERE job_id = ?', jobId);
    const revision = (last?.rev ?? 0) + 1;
    q.run(
      'INSERT INTO edits (job_id, user_id, revision, text, ast_json, created_at) VALUES (?,?,?,?,?,?)',
      jobId,
      userId,
      revision,
      text,
      ast ? JSON.stringify(ast) : null,
      now(),
    );
    q.run('UPDATE jobs SET result_text = ?, result_ast_json = ? WHERE id = ?', text, ast ? JSON.stringify(ast) : null, jobId);
    return revision;
  });
}

export function listRevisions(jobId, userId) {
  return q
    .all(
      'SELECT revision, created_at, length(text) AS chars FROM edits WHERE job_id = ? AND user_id = ? ORDER BY revision DESC',
      jobId,
      userId,
    )
    .map((row) => ({ revision: row.revision, createdAt: row.created_at, chars: row.chars }));
}

export function getRevision(jobId, userId, revision) {
  const row = q.get('SELECT * FROM edits WHERE job_id = ? AND user_id = ? AND revision = ?', jobId, userId, revision);
  if (!row) return null;
  return { revision: row.revision, text: row.text, ast: row.ast_json ? safeJson(row.ast_json) : null, createdAt: row.created_at };
}

// ---------- Экспорт ----------
export function logExport({ jobId, userId, format, bytes }) {
  q.run(
    'INSERT INTO exports (job_id, user_id, format, bytes, created_at) VALUES (?,?,?,?,?)',
    jobId ?? null,
    userId,
    format,
    bytes ?? null,
    now(),
  );
}

export function exportStats(userId) {
  return q.all(
    `SELECT format, COUNT(*) AS n FROM exports WHERE user_id = ? GROUP BY format ORDER BY n DESC`,
    userId,
  );
}

// ---------- Предпроверка: лог блокировок ----------
export function logBlockedAttempt({ userId, reasonCode, excerpt, charCount }) {
  q.run(
    'INSERT INTO precheck_log (user_id, reason_code, excerpt, char_count, created_at) VALUES (?,?,?,?,?)',
    userId ?? null,
    reasonCode,
    (excerpt ?? '').slice(0, 300),
    charCount ?? 0,
    now(),
  );
}

// ---------- Срок хранения ----------
export function purgeExpired(retentionDays = config.retentionDays) {
  const threshold = new Date(Date.now() - retentionDays * 24 * 3600 * 1000).toISOString();
  const docs = q.run('DELETE FROM documents WHERE created_at < ?', threshold);
  const jobs = q.run(`DELETE FROM jobs WHERE created_at < ? AND status IN ('done','failed','cancelled')`, threshold);
  return { documents: docs.changes, jobs: jobs.changes };
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
