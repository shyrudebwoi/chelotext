// Diff по блокам: показываем, что изменилось, не превращая сравнение в кашу.
import { diffWordsWithSpace, diffChars } from 'diff';

/**
 * Построчный diff исходного и итогового текста.
 * Возвращает массив строк:
 * { type: 'equal'|'added'|'removed'|'changed', left, right }
 */
export function buildLineDiff(before, after) {
  const leftLines = splitLines(before);
  const rightLines = splitLines(after);
  const rows = [];
  const matcher = new LineMatcher(leftLines, rightLines);
  for (const op of matcher.ops()) {
    if (op.type === 'equal') {
      rows.push({ type: 'equal', left: op.left, right: op.right });
    } else if (op.type === 'removed') {
      rows.push({ type: 'removed', left: op.left, right: null });
    } else if (op.type === 'changed') {
      rows.push({ type: 'changed', left: op.left ?? null, right: op.right ?? null });
    } else {
      rows.push({ type: 'added', left: null, right: op.right });
    }
  }
  return rows;
}

function splitLines(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd());
}

// Простой LCS-дифф по строкам (O(n*m) с ограничением, чтобы не вешать браузер).
function lcsMatrix(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

class LineMatcher {
  constructor(left, right) {
    this.left = left;
    this.right = right;
  }

  ops() {
    const { left, right } = this;
    // Для очень больших текстов сравниваем по «окнам», чтобы не считать матрицу 20k×20k.
    if (left.length * right.length > 4_000_000) return this.opsGreedy();
    const dp = lcsMatrix(left, right);
    const ops = [];
    let i = 0;
    let j = 0;
    while (i < left.length && j < right.length) {
      if (left[i] === right[j]) {
        ops.push({ type: 'equal', left: left[i], right: right[j] });
        i += 1;
        j += 1;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        ops.push({ type: 'removed', left: left[i] });
        i += 1;
      } else {
        ops.push({ type: 'added', right: right[j] });
        j += 1;
      }
    }
    while (i < left.length) {
      ops.push({ type: 'removed', left: left[i] });
      i += 1;
    }
    while (j < right.length) {
      ops.push({ type: 'added', right: right[j] });
      j += 1;
    }
    return coalesce(ops);
  }

  opsGreedy() {
    const { left, right } = this;
    const ops = [];
    const max = Math.max(left.length, right.length);
    for (let k = 0; k < max; k += 1) {
      const l = left[k];
      const r = right[k];
      if (l === r) {
        ops.push({ type: 'equal', left: l, right: r });
      } else {
        if (l !== undefined) ops.push({ type: 'removed', left: l });
        if (r !== undefined) ops.push({ type: 'added', right: r });
      }
    }
    return coalesce(ops);
  }
}

// Склеиваем подряд идущие removed+added в одну «замену» — так читается легче.
function coalesce(ops) {
  const out = [];
  let index = 0;
  while (index < ops.length) {
    if (ops[index].type === 'removed') {
      const removed = [];
      while (index < ops.length && ops[index].type === 'removed') {
        removed.push(ops[index].left);
        index += 1;
      }
      const added = [];
      while (index < ops.length && ops[index].type === 'added') {
        added.push(ops[index].right);
        index += 1;
      }
      if (added.length) {
        const count = Math.max(removed.length, added.length);
        for (let k = 0; k < count; k += 1) {
          out.push({ type: 'changed', left: removed[k] ?? null, right: added[k] ?? null });
        }
      } else {
        for (const line of removed) out.push({ type: 'removed', left: line, right: null });
      }
      continue;
    }
    if (ops[index].type === 'added') {
      const added = [];
      while (index < ops.length && ops[index].type === 'added') {
        added.push(ops[index].right);
        index += 1;
      }
      for (const line of added) out.push({ type: 'added', left: null, right: line });
      continue;
    }
    out.push(ops[index]);
    index += 1;
  }
  return out;
}

/**
 * Diff внутри строки: подсветка изменённых слов для «заменённых» строк.
 */
export function wordDiff(before, after) {
  const parts = diffWordsWithSpace(String(before ?? ''), String(after ?? ''));
  return parts.map((part) => ({
    text: part.value,
    type: part.added ? 'added' : part.removed ? 'removed' : 'equal',
  }));
}

export function charDiff(before, after) {
  return diffChars(String(before ?? ''), String(after ?? '')).map((part) => ({
    text: part.value,
    type: part.added ? 'added' : part.removed ? 'removed' : 'equal',
  }));
}

/**
 * Сводка изменений для интерфейса.
 */
export function diffSummary(before, after) {
  const rows = buildLineDiff(before, after);
  const added = rows.filter((r) => r.type === 'added' || r.type === 'changed').length;
  const removed = rows.filter((r) => r.type === 'removed' || r.type === 'changed').length;
  const changed = rows.filter((r) => r.type === 'changed').length;
  const total = rows.length;
  const same = rows.filter((r) => r.type === 'equal').length;
  return {
    rows,
    added,
    removed,
    changed,
    same,
    similarity: total ? Math.round((same / total) * 100) : 100,
  };
}
