#!/usr/bin/env node
// Eval-выборка качества: прогоняем русские тексты через движок правил
// и проверяем, что смысл на месте (числа, даты, имена, цитаты), объём
// не просел, а читаемость улучшилась.
//
// Запуск:
//   npm run eval                — уровень 3, отчёт в eval/report.md
//   npm run eval -- --levels    — уровни 1, 3, 5
//   npm run eval -- --json      — машинный вывод в stdout
//   npm run eval -- --text=02   — только тексты, чьё имя содержит «02»
//
// Код возврата 1, если хотя бы один текст провалил проверку сохранности.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline } from '../server/core/pipeline.js';
import { config } from '../server/config.js';

// Eval измеряет качество правил: живая модель из локального .env не участвует.
config.llm.provider = 'rules';
config.llm.enabled = false;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEXTS_DIR = path.join(HERE, 'texts');
const REPORT_PATH = path.join(HERE, 'report.md');

// Пороги. Ниже MIN_RATIO текст считается сокращённым сверх допустимого.
const MIN_RATIO = 0.8;
const MAX_RATIO = 1.6;
const OPTIONS = { r1: true, r2: true, r3: true };

const args = process.argv.slice(2);
const useLevels = args.includes('--levels');
const asJson = args.includes('--json');
const textFilter = (args.find((a) => a.startsWith('--text=')) || '').slice('--text='.length);

const levels = useLevels ? [1, 3, 5] : [3];

async function loadTexts() {
  const files = (await readdir(TEXTS_DIR))
    .filter((name) => name.endsWith('.txt'))
    .filter((name) => !textFilter || name.includes(textFilter))
    .sort();
  const texts = [];
  for (const file of files) {
    const raw = await readFile(path.join(TEXTS_DIR, file), 'utf8');
    texts.push({ name: file.replace(/\.txt$/, ''), text: raw.trim() });
  }
  return texts;
}

function pct(n) {
  return `${Math.round(n * 100)}%`;
}

function num(n) {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

function evaluateResult(result) {
  const problems = [];
  const warnings = [];

  if (!result.ok) {
    problems.push(`blocked:${result.code || 'unknown'}`);
    return { problems, warnings, ratio: 0, integrityOk: false, score: 0 };
  }

  const ratio = result.inputChars ? result.outputChars / result.inputChars : 1;
  const integrity = result.integrity || { ok: false, score: 0, missing: {} };

  if (!integrity.ok) {
    const missing = integrity.missing || {};
    const parts = [];
    for (const [kind, list] of Object.entries(missing)) {
      if (Array.isArray(list) && list.length) parts.push(`${kind}:${list.length}`);
    }
    problems.push(`integrity(${parts.join(',') || '?'})`);
  }
  if (ratio < MIN_RATIO) problems.push(`shrunk(${pct(ratio)})`);
  if (ratio > MAX_RATIO) warnings.push(`grown(${pct(ratio)})`);

  const before = num(result.readability?.before?.flesch);
  const after = num(result.readability?.after?.flesch);
  if (after + 0.5 < before) warnings.push(`readability(${before}->${after})`);

  return {
    problems,
    warnings,
    ratio,
    integrityOk: Boolean(integrity.ok),
    score: num(integrity.score),
    before,
    after,
  };
}

function renderMarkdown(rows) {
  const lines = [];
  lines.push('# Eval: сохранность и читаемость');
  lines.push('');
  lines.push(`Дата прогона: ${new Date().toISOString().slice(0, 10)}. Движок: только правила (LLM выключен).`);
  lines.push('');
  lines.push('Пороги: сохранность — 100% сущностей (числа, даты, имена, цитаты, ссылки);');
  lines.push(`объём — не ниже ${pct(MIN_RATIO)} и не выше ${pct(MAX_RATIO)} от исходного; читаемость — не хуже исходной.`);
  lines.push('');
  lines.push('| Текст | Ур. | Объём | Сохранность | Flesch до → после | Предложения до → после | Канцелярит /1000 до → после | Статус |');
  lines.push('|---|---|---|---|---|---|---|---|');

  for (const row of rows) {
    const r = row.result;
    const status = row.problems.length ? `FAIL (${row.problems.join(', ')})` : row.warnings.length ? `WARN (${row.warnings.join(', ')})` : 'OK';
    if (!r.ok) {
      lines.push(`| ${row.name} | ${row.level} | — | — | — | — | — | ${status} |`);
      continue;
    }
    const b = r.readability?.before || {};
    const a = r.readability?.after || {};
    lines.push(
      `| ${row.name} | ${row.level} | ${pct(row.ratio)} | ${pct(row.score)} | ${num(b.flesch)} → ${num(a.flesch)} | `
      + `${num(b.avgSentenceLength)} → ${num(a.avgSentenceLength)} | ${num(b.bureaucracyPer1000)} → ${num(a.bureaucracyPer1000)} | ${status} |`,
    );
  }

  const okRows = rows.filter((row) => row.result.ok);
  const avg = (pick) => (okRows.length ? okRows.reduce((sum, row) => sum + pick(row), 0) / okRows.length : 0);
  const passCount = rows.filter((row) => !row.problems.length).length;

  lines.push('');
  lines.push('## Итоги');
  lines.push('');
  lines.push(`- Текстов: ${rows.length}, без потерь и сокращений: ${passCount}.`);
  lines.push(`- Средняя сохранность сущностей: ${pct(avg((row) => row.score))}.`);
  lines.push(`- Средний объём относительно исходного: ${pct(avg((row) => row.ratio))}.`);
  lines.push(`- Средний Flesch: ${num(Math.round(avg((row) => row.before) * 10) / 10)} → ${num(Math.round(avg((row) => row.after) * 10) / 10)}.`);
  lines.push(`- Средняя длина предложения: ${num(Math.round(avg((row) => num(row.result.readability?.before?.avgSentenceLength)) * 10) / 10)} → ${num(Math.round(avg((row) => num(row.result.readability?.after?.avgSentenceLength)) * 10) / 10)}.`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const texts = await loadTexts();
  if (!texts.length) {
    console.error('No eval texts found. Put .txt files into eval/texts/.');
    process.exit(1);
  }

  const rows = [];
  for (const level of levels) {
    for (const { name, text } of texts) {
      const result = await runPipeline({ text, options: { ...OPTIONS, level } });
      const evaluated = evaluateResult(result);
      rows.push({ name, level, text, result, ...evaluated });
    }
  }

  const failures = rows.filter((row) => row.problems.length);

  if (asJson) {
    const payload = rows.map((row) => ({
      name: row.name,
      level: row.level,
      blocked: !row.result.ok,
      code: row.result.ok ? null : row.result.code,
      scientific: row.result.scientific,
      chars: { in: row.result.inputChars || 0, out: row.result.outputChars || 0 },
      ratio: Math.round(row.ratio * 1000) / 1000,
      integrity: row.result.ok
        ? { ok: row.result.integrity.ok, score: row.result.integrity.score, missing: row.result.integrity.missing }
        : null,
      readability: row.result.ok ? row.result.readability : null,
      problems: row.problems,
      warnings: row.warnings,
    }));
    console.log(JSON.stringify(payload, null, 2));
  } else {
    for (const row of rows) {
      const mark = row.problems.length ? 'FAIL' : row.warnings.length ? 'WARN' : 'OK  ';
      const details = row.problems.length ? row.problems.join(',') : row.warnings.join(',');
      console.log(`${mark} level=${row.level} ${row.name} ratio=${pct(row.ratio)} score=${pct(row.score)} ${details}`);
    }
    const okRows = rows.filter((row) => row.result.ok);
    const avgRatio = okRows.length ? okRows.reduce((s, r) => s + r.ratio, 0) / okRows.length : 0;
    const avgScore = okRows.length ? okRows.reduce((s, r) => s + r.score, 0) / okRows.length : 0;
    console.log(`---`);
    console.log(`texts=${rows.length} failures=${failures.length} avgRatio=${pct(avgRatio)} avgScore=${pct(avgScore)}`);
    await writeFile(REPORT_PATH, renderMarkdown(rows), 'utf8');
    console.log(`report: ${path.relative(process.cwd(), REPORT_PATH)}`);
  }

  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
