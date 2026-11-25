// Chunking под LLM: режем по границам блоков, никогда внутри предложения или таблицы.
import { BLOCK, blockText } from './ast.js';

/**
 * Делит AST на чанки, не превышающие chunkChars.
 * Возвращает массив { blocks: [...], index, total }.
 * Перекрытие (overlapBlocks) даёт LLM контекст, но помечается __overlap,
 * чтобы результат не дублировался при сборке.
 */
export function chunkAst(ast, chunkChars = 3000, overlapBlocks = 1) {
  const blocks = ast.blocks || [];
  const chunks = [];
  let current = [];
  let currentLen = 0;

  const flush = () => {
    if (!current.length) return;
    chunks.push(current);
    const overlap = overlapBlocks > 0 ? current.slice(-overlapBlocks) : [];
    current = overlap.map((b) => ({ ...b, __overlap: true }));
    currentLen = current.reduce((sum, b) => sum + blockText(b).length + 2, 0);
  };

  for (const block of blocks) {
    const len = blockText(block).length + 2;
    // Таблица всегда целиком: не режем данные.
    if (block.type === BLOCK.TABLE) {
      if (current.length && currentLen + len > chunkChars) flush();
      current.push(block);
      currentLen += len;
      continue;
    }
    if (current.length && currentLen + len > chunkChars) flush();
    current.push(block);
    currentLen += len;
  }
  if (current.length) chunks.push(current);

  return chunks.map((chunk, index) => ({ blocks: chunk, index, total: chunks.length }));
}

export function chunkPlainText(text, chunkChars = 3000) {
  const src = String(text || '');
  if (src.length <= chunkChars) return [src];
  const paragraphs = src.split(/\n{2,}/);
  const chunks = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current.length + paragraph.length + 2 > chunkChars && current) {
      chunks.push(current.trim());
      current = '';
    }
    current += (current ? '\n\n' : '') + paragraph;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
