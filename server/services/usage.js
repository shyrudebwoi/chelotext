// Учёт расхода токенов LLM по пользователям и запросам.
// Одна строка — один завершённый запрос обработки (job), который реально вызвал модель.
import { q, now } from '../db/index.js';

const int = (value) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function recordLlmUsage({ userId, jobId = null, provider = null, model = null, usage } = {}) {
  if (!userId || !usage) return null;
  const promptTokens = int(usage.promptTokens);
  const completionTokens = int(usage.completionTokens);
  const totalTokens = int(usage.totalTokens) || promptTokens + completionTokens;
  const calls = int(usage.calls);
  if (!calls && !totalTokens) return null;

  const result = q.run(
    `INSERT INTO llm_usage
       (user_id, job_id, provider, model, prompt_tokens, completion_tokens, total_tokens, calls, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    userId,
    jobId ?? null,
    provider ?? null,
    model ?? null,
    promptTokens,
    completionTokens,
    totalTokens,
    calls,
    now(),
  );
  return Number(result.lastInsertRowid);
}

// Учёт не должен ломать обработку текста: ошибка записи только логируется.
export function safeRecordLlmUsage(args) {
  try {
    return recordLlmUsage(args);
  } catch (error) {
    console.error('[usage]', error.message);
    return null;
  }
}

function whereClause({ since, until } = {}) {
  const parts = [];
  const params = [];
  if (since) {
    parts.push('l.created_at >= ?');
    params.push(since);
  }
  if (until) {
    parts.push('l.created_at < ?');
    params.push(until);
  }
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}

export function listRecentUsage({ limit = 10 } = {}) {
  const n = Math.min(100, Math.max(1, Math.trunc(Number(limit)) || 10));
  return q.all(
    `SELECT u.email, l.provider, l.model, l.prompt_tokens, l.completion_tokens,
            l.total_tokens, l.calls, l.created_at
       FROM llm_usage l
       JOIN users u ON u.id = l.user_id
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT ?`,
    n,
  ).map(mapRow);
}

export function usageSummary({ since, until } = {}) {
  const where = whereClause({ since, until });
  const row = q.get(
    `SELECT COUNT(*) AS requests,
            COALESCE(SUM(l.prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(l.completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(l.total_tokens), 0) AS total_tokens
       FROM llm_usage l
       ${where.sql}`,
    ...where.params,
  );
  return {
    requests: Number(row?.requests) || 0,
    promptTokens: Number(row?.prompt_tokens) || 0,
    completionTokens: Number(row?.completion_tokens) || 0,
    totalTokens: Number(row?.total_tokens) || 0,
  };
}

export function usageByUser({ since, until, limit = 10 } = {}) {
  const where = whereClause({ since, until });
  const n = Math.min(50, Math.max(1, Math.trunc(Number(limit)) || 10));
  return q.all(
    `SELECT u.email,
            COUNT(*) AS requests,
            COALESCE(SUM(l.total_tokens), 0) AS total_tokens
       FROM llm_usage l
       JOIN users u ON u.id = l.user_id
       ${where.sql}
      GROUP BY u.id, u.email
      ORDER BY total_tokens DESC, requests DESC
      LIMIT ?`,
    ...where.params,
    n,
  ).map((row) => ({
    email: row.email,
    requests: Number(row.requests) || 0,
    totalTokens: Number(row.total_tokens) || 0,
  }));
}

function mapRow(row) {
  return {
    email: row.email,
    provider: row.provider,
    model: row.model,
    promptTokens: Number(row.prompt_tokens) || 0,
    completionTokens: Number(row.completion_tokens) || 0,
    totalTokens: Number(row.total_tokens) || 0,
    calls: Number(row.calls) || 0,
    createdAt: row.created_at,
  };
}
