// Встроенная очередь задач: статусы, прогресс, отмена. Один процесс, N параллельных воркеров.
// При росте нагрузки заменяется на внешний брокер без изменения API.
import { config } from '../config.js';
import { runPipeline, PipelineCancelled } from '../core/pipeline.js';
import { getJobRaw, updateJob, isCancelRequested, requestCancel } from '../services/documents.js';
import { safeRecordLlmUsage } from '../services/usage.js';
import { emptyUsage, addUsage } from '../core/llm/usage.js';
import { providerInfo } from '../core/llm/provider.js';
import { parsePlainText, astToPlainText } from '../core/text/ast.js';
import { q, now } from '../db/index.js';

const queue = [];
let running = 0;
let ocrRunning = 0;
const handlers = new Map();
const cancellers = new Map();

export function registerJobHandler(jobId, fn) {
  handlers.set(jobId, fn);
}

export function unregisterJobHandler(jobId) {
  handlers.delete(jobId);
}

export function cancelJobRuntime(jobId) {
  const canceller = cancellers.get(jobId);
  if (canceller) canceller();
  updateJob(jobId, { cancelRequested: true });
}

/** Отзыв согласия/удаление аккаунта обязаны остановить и очередь, и уже идущий рантайм. */
export function cancelUserJobs(userId) {
  const jobs = q.all(`SELECT id, status FROM jobs WHERE user_id = ? AND status IN ('queued','processing')`, userId);
  for (const job of jobs) {
    requestCancel(job.user_id, job.id);
    cancelJobRuntime(job.id);
    if (job.status === 'queued') {
      for (let i = queue.length - 1; i >= 0; i -= 1) {
        if (queue[i].jobId === job.id) queue.splice(i, 1);
      }
      updateJob(job.id, { status: 'cancelled', stage: 'cancelled', finishedAt: now() });
    }
  }
  return jobs.length;
}

/**
 * Ставит задачу в очередь.
 * payload: { kind: 'process'|'extract', text?, options, documentId }
 */
export function enqueueJob(jobId, payload) {
  queue.push({ jobId, payload, priority: payload.kind === 'extract' ? 0 : 1 });
  queue.sort((a, b) => a.priority - b.priority);
  drain();
}

function drain() {
  while (running < config.jobConcurrency && queue.length) {
    const item = queue.shift();
    running += 1;
    runJob(item)
      .catch(() => {})
      .finally(() => {
        running -= 1;
        drain();
      });
  }
}

async function runJob({ jobId, payload }) {
  const job = getJobRaw(jobId);
  if (!job) return;
  if (job.cancel_requested) {
    updateJob(jobId, { status: 'cancelled', stage: 'cancelled', finishedAt: now() });
    return;
  }
  updateJob(jobId, { status: 'processing', stage: 'start', startedAt: now(), progress: 2 });

  const controller = new AbortController();
  cancellers.set(jobId, () => controller.abort());

  const isCancelled = () => isCancelRequested(jobId) || controller.signal.aborted;
  const usage = emptyUsage();
  let llmMeta = null;

  try {
    if (payload.kind === 'extract') {
      llmMeta = await runExtractJob(jobId, payload, { isCancelled, usage });
    } else {
      llmMeta = await runProcessJob(jobId, payload, { isCancelled, usage });
    }
  } catch (error) {
    if (error instanceof PipelineCancelled || error?.name === 'AbortError' || isCancelled()) {
      updateJob(jobId, { status: 'cancelled', stage: 'cancelled', finishedAt: now() });
    } else {
      updateJob(jobId, {
        status: 'failed',
        stage: 'failed',
        errorCode: error.code || 'internal',
        errorMessage: error.message || 'Что-то пошло не так',
        finishedAt: now(),
      });
    }
  } finally {
    // Токены могли быть потрачены и до отмены/падения — учитываем их всегда.
    // Если данные уже удалены по отзыву согласия, строк задачи нет — запись не нужна.
    if (getJobRaw(jobId)) {
      const info = providerInfo();
      safeRecordLlmUsage({
        userId: job.user_id,
        jobId,
        provider: llmMeta?.provider ?? info.provider,
        model: llmMeta?.model ?? info.model,
        usage,
      });
    }
    cancellers.delete(jobId);
    unregisterJobHandler(jobId);
  }
}

async function runProcessJob(jobId, payload, { isCancelled, usage }) {
  const options = payload.options || {};
  const onProgress = (stage) => {
    if (isCancelled()) return;
    updateJob(jobId, { stage: stage.key, progress: Math.min(99, stage.progress), status: 'processing' });
  };

  const result = await runPipeline({
    text: payload.text,
    options,
    onProgress,
    isCancelled,
    onUsage: (part) => addUsage(usage, part),
  });

  if (!result.ok) {
    updateJob(jobId, {
      status: 'failed',
      stage: 'precheck',
      errorCode: result.code,
      errorMessage: result.reason?.message || 'Текст не прошёл проверку',
      finishedAt: now(),
    });
    return null;
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
    finishedAt: now(),
  });
  return { provider: result.llm.provider, model: result.llm.model };
}

async function runExtractJob(jobId, payload, { isCancelled, usage }) {
  const { extractFile } = await import('../services/ingest.js');
  const step = (stage, progress) => {
    if (isCancelled()) return;
    updateJob(jobId, { stage, progress, status: 'processing' });
  };

  step('extract', 10);
  const extracted = await extractFile(payload.file, {
    onProgress: (progress, stage) => step(stage || 'extract', 10 + Math.round(progress * 0.35)),
    isCancelled,
  });

  step('rules', 50);
  const result = await runPipeline({
    text: extracted.text,
    options: payload.options || {},
    onProgress: (stage) => {
      const mapped = 50 + Math.round(stage.progress * 0.45);
      step(stage.key, Math.min(97, mapped));
    },
    isCancelled,
    onUsage: (part) => addUsage(usage, part),
  });

  if (!result.ok) {
    updateJob(jobId, {
      status: 'failed',
      stage: 'precheck',
      errorCode: result.code,
      errorMessage: result.reason?.message || 'Текст не прошёл проверку',
      finishedAt: now(),
    });
    return null;
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
    finishedAt: now(),
  });

  // Обновляем документ: сохраняем извлечённый текст и метаданные.
  if (payload.documentId) {
    q.run(
      `UPDATE documents SET original_text = ?, ast_json = ?, char_count = ?, page_count = ?, from_ocr = ?, ocr_confidence = ?, source_meta = ? WHERE id = ?`,
      extracted.text,
      JSON.stringify(extracted.ast),
      extracted.text.length,
      extracted.meta?.pages ?? null,
      extracted.meta?.fromOcr ? 1 : 0,
      extracted.meta?.ocrConfidence ?? null,
      JSON.stringify(extracted.meta || {}),
      payload.documentId,
    );
  }
}

export function queueStats() {
  return { running, queued: queue.length, concurrency: config.jobConcurrency };
}

// Восстановление после падения: задачи в processing и queued больше не имеют рантайма.
export function recoverStuckJobs() {
  const stuck = q.all(`SELECT id FROM jobs WHERE status IN ('processing','queued')`);
  for (const job of stuck) {
    updateJob(job.id, {
      status: 'failed',
      errorCode: 'interrupted',
      errorMessage: 'Обработка прервалась. Запусти заново',
      finishedAt: now(),
    });
  }
  return stuck.length;
}

export { parsePlainText, astToPlainText };
