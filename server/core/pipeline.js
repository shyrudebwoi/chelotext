// Оркестратор обработки: предпроверка → правила → LLM → сборка → контроль целостности.
import { config } from '../config.js';
import {
  parsePlainText, astToPlainText, astFromEditedText, countChars, cloneAst, BLOCK,
} from './text/ast.js';
import { chunkAst } from './text/chunk.js';
import { applyRules, readability } from './rules/engine.js';
import { createProvider, providerInfo } from './llm/provider.js';
import { PROMPT_VERSION } from './llm/prompts.js';
import { emptyUsage, addUsage } from './llm/usage.js';
import { checkIntegrity } from './integrity.js';
import { precheck } from './precheck.js';

export class PipelineCancelled extends Error {
  constructor() {
    super('Задача отменена');
    this.name = 'PipelineCancelled';
  }
}

const STAGES = {
  precheck: { key: 'precheck', label: 'Проверяю текст', progress: 8 },
  rules: { key: 'rules', label: 'Причёсываю формулировки', progress: 30 },
  llm: { key: 'llm', label: 'Упрощаю язык', progress: 45 },
  assemble: { key: 'assemble', label: 'Собираю результат', progress: 85 },
  integrity: { key: 'integrity', label: 'Проверяю, что всё на месте', progress: 93 },
  done: { key: 'done', label: 'Готово', progress: 100 },
};

/**
 * Основной вход пайплайна.
 * @param {object} params
 * @param {string} params.text — исходный текст
 * @param {object} params.options — { r1, r2, r3, level }
 * @param {(stage: object) => void} [params.onProgress]
 * @param {() => boolean} [params.isCancelled]
 * @param {(usage: object) => void} [params.onUsage] — расход токенов, в том числе до отмены/падения
 */
export async function runPipeline({ text, options = {}, onProgress = () => {}, isCancelled = () => false, onUsage = () => {} }) {
  const level = clampLevel(options.level);
  const modes = { r1: Boolean(options.r1), r2: Boolean(options.r2), r3: Boolean(options.r3) };
  const report = (stage, extra = {}) => onProgress({ ...stage, ...extra });
  const assertNotCancelled = () => {
    if (isCancelled()) throw new PipelineCancelled();
  };

  // 1. Предпроверка
  report(STAGES.precheck);
  assertNotCancelled();
  const check = precheck(text);
  if (!check.ok) {
    return {
      ok: false,
      blocked: true,
      code: check.code,
      reason: check.reason,
      scientific: check.scientific,
    };
  }

  const sourceAst = parsePlainText(text);
  const inputPlain = astToPlainText(sourceAst);
  const inputChars = inputPlain.length;

  // 2. Правила
  report(STAGES.rules);
  assertNotCancelled();
  const ruled = applyRules(sourceAst, { ...modes, level });
  let resultAst = ruled.ast;

  // 3. LLM (только если провайдер доступен и включён R2)
  const provider = createProvider();
  const llmInfo = providerInfo();
  let llmUsed = false;
  let llmFallbackReason = null;
  const llmUsage = emptyUsage();

  if (modes.r2 && llmInfo.enabled && provider.available) {
    report(STAGES.llm, { progress: 45 });
    try {
      const pass = await runLlmPass(resultAst, {
        modes,
        level,
        provider,
        onProgress: report,
        assertNotCancelled,
        onUsage: (usage) => {
          addUsage(llmUsage, usage);
          onUsage(usage);
        },
      });
      resultAst = pass.ast;
      llmUsed = pass.used > 0;
      if (pass.failed > 0) {
        llmFallbackReason = `Часть текста оставлена после правил: блоков без модели — ${pass.failed}`;
      }
    } catch (error) {
      if (error instanceof PipelineCancelled) throw error;
      llmFallbackReason = error.message;
    }
  } else if (modes.r2 && !llmInfo.enabled) {
    llmFallbackReason = 'Модель выключена — работают только правила';
  } else if (modes.r2 && !provider.available) {
    llmFallbackReason = llmInfo.configured
      ? 'Модель временно недоступна — работают только правила'
      : 'Ключ модели не задан — работают только правила';
  }

  // 4. Сборка + пост-контроль целостности
  report(STAGES.assemble);
  assertNotCancelled();
  const resultText = astToPlainText(resultAst);
  const integrity = checkIntegrity(inputPlain, resultText);

  report(STAGES.integrity, { progress: 93 });
  const finalAst = resultAst;
  const finalText = astToPlainText(finalAst);

  report(STAGES.done, { progress: 100 });

  return {
    ok: true,
    ast: finalAst,
    text: finalText,
    inputChars,
    outputChars: finalText.length,
    scientific: check.scientific,
    stats: ruled.stats,
    readability: {
      before: readability(inputPlain),
      after: readability(finalText),
    },
    integrity,
    llm: {
      used: llmUsed,
      provider: llmInfo.provider,
      model: llmInfo.model,
      promptVersion: PROMPT_VERSION,
      fallbackReason: llmFallbackReason,
      usage: llmUsage,
    },
  };
}

async function runLlmPass(ast, { modes, level, provider, onProgress, assertNotCancelled, onUsage }) {
  const chunks = chunkAst(ast, config.llm.chunkChars);
  const processed = [];
  let used = 0;
  let failed = 0;

  for (const chunk of chunks) {
    assertNotCancelled();
    const chunkText = astToPlainText({ blocks: chunk.blocks.filter((b) => !b.__overlap) });
    if (!chunkText.trim()) {
      processed.push(...chunk.blocks);
      continue;
    }
    let rewritten;
    try {
      rewritten = await provider.generate(chunkText, { level, modes, onUsage });
    } catch (error) {
      if (error instanceof PipelineCancelled) throw error;
      // Не валим всю задачу: чанк остаётся как есть после правил.
      failed += 1;
      processed.push(...chunk.blocks);
      continue;
    }
    const rebuilt = astFromEditedText(rewritten);
    if (!rebuilt.blocks.length) {
      failed += 1;
      processed.push(...chunk.blocks);
      continue;
    }
    processed.push(...rebuilt.blocks);
    used += 1;
    const progress = 45 + Math.round(((chunk.index + 1) / chunks.length) * 38);
    onProgress({ key: 'llm', label: 'Упрощаю язык', progress: Math.min(84, progress) });
  }

  // Таблицы и сноски из оригинала сохраняем: LLM не должен их менять.
  const preserved = (ast.blocks || []).filter((b) => b.type === BLOCK.TABLE || b.type === BLOCK.FOOTNOTES);
  return { ast: { version: 1, blocks: mergePreserved(processed, preserved) }, used, failed };
}

function mergePreserved(processed, preserved) {
  if (!preserved.length) return processed;
  const result = [...processed];
  // Таблицы/сноски, которых нет в результате, добавляем в конец, чтобы данные не потерялись.
  for (const block of preserved) {
    const key = JSON.stringify(block.type === BLOCK.TABLE ? block.rows : block.items);
    const exists = result.some((b) => JSON.stringify(b.type === BLOCK.TABLE ? b.rows : b.items) === key);
    if (!exists) result.push(block);
  }
  return result;
}

export function clampLevel(level) {
  const n = Math.round(Number(level));
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, n));
}

export { countChars, cloneAst, readability };
