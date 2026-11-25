#!/usr/bin/env node
// Минимальный lint без внешних зависимостей: синтаксис JS, отладочные логи,
// наличие обязательных файлов. Вызывается через `npm run lint`.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git', 'data', 'tmp', 'certs']);
const problems = [];
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile()) files.push(path.relative(ROOT, full).replace(/\\/g, '/'));
  }
}

walk(ROOT);

for (const file of files.filter((name) => name.endsWith('.js'))) {
  try {
    execFileSync(process.execPath, ['--check', path.join(ROOT, file)], { stdio: 'pipe' });
  } catch (error) {
    const detail = String(error.stderr || error.message).split(/\r?\n/).slice(0, 4).join(' ');
    problems.push(`${file}: синтаксис — ${detail}`);
  }
}

for (const file of files.filter((name) => name.startsWith('server/') && name.endsWith('.js'))) {
  const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/console\.log\s*\(/.test(line)) problems.push(`${file}:${index + 1}: убери console.log`);
  });
}

const REQUIRED = [
  'package.json',
  '.env.example',
  'README.md',
  'server/index.js',
  'server/config.js',
  'server/core/pipeline.js',
  'server/core/integrity.js',
  'server/core/llm/provider.js',
  'server/core/llm/gigachat.js',
  'server/jobs/queue.js',
  'public/js/app.js',
  'public/sw.js',
  'public/manifest.webmanifest',
  'docs/TZ.md',
  'docs/context.md',
  'docs/HANDOFF.md',
  'eval/run.js',
];

for (const file of REQUIRED) {
  if (!fs.existsSync(path.join(ROOT, file))) problems.push(`нет обязательного файла: ${file}`);
}

if (problems.length) {
  console.error(`Проверка не прошла (${problems.length}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`OK: ${files.filter((name) => name.endsWith('.js')).length} JS-файлов, обязательные файлы на месте.`);
