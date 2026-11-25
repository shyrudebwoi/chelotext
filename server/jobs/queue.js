// Встроенная очередь задач: статусы, прогресс, отмена. Один процесс, N параллельных воркеров.
// При росте нагрузки заменяется на внешний брокер без изменения API.
import { config } from '../config.js';
import { runPipeline, PipelineCancelled } from '../core/pipeline.js';
import { getJobRaw, updateJob, isCancelRequested } from '../services/documents.js';
import { safeRecordLlmUsage } from '../services/usage.js';
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

  try {
    if (payload.kind === 'extract') {
      await runExtractJob(jobId, payload, { isCancelled, userId: job.user_id });
    } else {
      await runProcessJob(jobId, payload, { isCancelled, userId: job.user_id });
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
    cancellers.delete(jobId);
    unregisterJobHandler(jobId);
  }
}

async function runProcessJob(jobId, payload, { isCancelled, userId }) {
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
  });

  if (!result.ok) {
    updateJob(jobId, {
      status: 'failed',
      stage: 'precheck',
      errorCode: result.code,
      errorMessage: result.reason?.message || 'Текст не прошёл проверку',
      finishedAt: now(),
    });
    return;
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
  safeRecordLlmUsage({
    userId,
    jobId,
    provider: result.llm.provider,
    model: result.llm.model,
    usage: result.llm.usage,
  });
}

async function runExtractJob(jobId, payload, { isCancelled, userId }) {
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
  });

  if (!result.ok) {
    updateJob(jobId, {
      status: 'failed',
      stage: 'precheck',
      errorCode: result.code,
      errorMessage: result.reason?.message || 'Текст не прошёл проверку',
      finishedAt: now(),
    });
    return;
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
  safeRecordLlmUsage({
    userId,
    jobId,
    provider: result.llm.provider,
    model: result.llm.model,
    usage: result.llm.usage,
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

// Восстановление после падения: задачи, застрявшие в processing, помечаем failed.
export function recoverStuckJobs() {
  const stuck = q.all(`SELECT id FROM jobs WHERE status = 'processing'`);
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
