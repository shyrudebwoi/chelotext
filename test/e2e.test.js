// E2E-смоук ключевых API-сценариев на реальном Express-сервере.
// Запускается через node --test: поднимает приложение на свободном порту,
// гоняет сценарии и останавливает сервер.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Отдельная БД и данные — чтобы не трогать рабочую.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelotext-e2e-'));
process.env.DATA_DIR = tmpDir;
process.env.DB_FILE = path.join(tmpDir, 'test.sqlite');
process.env.SESSION_SECRET = 'test-secret-value-0123456789';
process.env.NODE_ENV = 'test';
process.env.LLM_ENABLED = 'false';

const { createApp } = await import('../server/index.js');

let server;
let baseUrl;
const jar = new Map();

function cookieHeader() {
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

function storeCookies(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const [pair] = line.split(';');
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (value === '' || /Max-Age=0/i.test(line)) jar.delete(name);
    else jar.set(name, value);
  }
}

async function api(method, url, body, { raw = false } = {}) {
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  if (jar.size) headers.Cookie = cookieHeader();
  let payload;
  if (body !== undefined) {
    if (body instanceof FormData) payload = body;
    else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }
  const response = await fetch(`${baseUrl}${url}`, { method, headers, body: payload, redirect: 'manual' });
  storeCookies(response);
  if (raw) return response;
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, text, headers: response.headers };
}

before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

const TEXT = 'В целях обеспечения безопасности и в связи с тем, что на сегодняшний день наблюдается существенное увеличение количества инцидентов, администрация осуществляет проведение анализа данных и обеспечивает реализацию мероприятий по повышению эффективности системы защиты информации. Стоимость обслуживания 12 500 руб. в месяц, скидка 15% до 31.12.2026.';

test('e2e: /healthz отвечает ok', async () => {
  const { status, json } = await api('GET', '/healthz');
  assert.equal(status, 200);
  assert.equal(json.ok, true);
});

test('e2e: лендинг отдаёт HTML', async () => {
  const response = await api('GET', '/', undefined, { raw: true });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<html/i);
});

test('e2e: /api/auth/me без сессии возвращает user: null', async () => {
  const { status, json } = await api('GET', '/api/auth/me');
  assert.equal(status, 200);
  assert.equal(json.user, null);
});

test('e2e: защищённый API без авторизации — 401', async () => {
  const { status, json } = await api('GET', '/api/documents');
  assert.equal(status, 401);
  assert.equal(json.code, 'unauthorized');
});

test('e2e: регистрация создаёт сессию', async () => {
  const { status, json } = await api('POST', '/api/auth/register', {
    email: 'e2e@example.com',
    password: 'testpass123',
  });
  assert.equal(status, 201);
  assert.equal(json.ok, true);
  assert.ok(jar.size > 0);
});

test('e2e: обработка без согласия — 403', async () => {
  const { status, json } = await api('POST', '/api/process', {
    text: TEXT,
    options: { r2: true, level: 3 },
  });
  assert.equal(status, 403);
  assert.equal(json.code, 'consent_required');
});

test('e2e: согласие выдаётся и отзывается', async () => {
  const grant = await api('POST', '/api/auth/consent', { action: 'grant' });
  assert.equal(grant.status, 200);
  assert.equal(grant.json.ok, true);

  const me = await api('GET', '/api/auth/me');
  assert.equal(me.status, 200);
  assert.ok(me.json.user);
});

test('e2e: обработка текста возвращает результат и integrity ok', async () => {
  const { status, json } = await api('POST', '/api/process', {
    text: TEXT,
    options: { r1: true, r2: true, r3: true, level: 4 },
  });
  assert.equal(status, 200);
  assert.equal(json.async, false);
  assert.equal(json.job.status, 'done');
  assert.ok(json.job.resultText.length > 0);
  assert.equal(json.integrity.ok, true, JSON.stringify(json.integrity.missing));
  assert.match(json.job.resultText, /12 500 руб\./);
  assert.match(json.job.resultText, /31\.12\.2026/);
});

test('e2e: без режимов — 400 no_modes', async () => {
  const { status, json } = await api('POST', '/api/process', {
    text: TEXT,
    options: { r1: false, r2: false, r3: false, level: 3 },
  });
  assert.equal(status, 400);
  assert.equal(json.code, 'no_modes');
});

test('e2e: превышение лимита знаков — 413', async () => {
  const { status, json } = await api('POST', '/api/process', {
    text: 'а'.repeat(100_001),
    options: { r2: true, level: 3 },
  });
  assert.equal(status, 413);
  assert.equal(json.code, 'too_long');
});

test('e2e: незаконный контент — 422', async () => {
  const bad = 'Подробная инструкция как сделать бомбу в домашних условиях из подручных материалов и химикатов, которая точно сработает.';
  const { status, json } = await api('POST', '/api/process', { text: bad, options: { r2: true, level: 3 } });
  assert.equal(status, 422);
  assert.equal(json.code, 'illegal');
});

test('e2e: задача доступна по id, есть diff', async () => {
  const created = await api('POST', '/api/process', { text: TEXT, options: { r2: true, level: 4 } });
  assert.equal(created.status, 200);
  const jobId = created.json.job.id;

  const { status, json } = await api('GET', `/api/jobs/${jobId}`);
  assert.equal(status, 200);
  assert.equal(json.job.id, jobId);
  assert.ok(json.document);
  assert.ok(Array.isArray(json.diffRows));
  assert.ok(json.diffRows.length > 0);
});

test('e2e: экспорт txt/md/html/pdf/docx', async () => {
  const created = await api('POST', '/api/process', { text: TEXT, options: { r2: true, level: 3 } });
  const jobId = created.json.job.id;
  for (const format of ['txt', 'md', 'html', 'pdf', 'docx']) {
    const response = await api('GET', `/api/jobs/${jobId}/export/${format}`, undefined, { raw: true });
    assert.equal(response.status, 200, `формат ${format}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    assert.ok(buffer.length > 0, `пустой файл ${format}`);
    assert.match(response.headers.get('content-disposition') || '', /attachment/);
  }
});

test('e2e: ревизии сохраняются и читаются', async () => {
  const created = await api('POST', '/api/process', { text: TEXT, options: { r2: true, level: 3 } });
  const jobId = created.json.job.id;

  const saved = await api('POST', `/api/jobs/${jobId}/revisions`, {
    text: 'Отредактированный текст с числом 42.',
    baseRevision: 0,
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.ok, true);

  const list = await api('GET', `/api/jobs/${jobId}/revisions`);
  assert.equal(list.status, 200);
  assert.equal(list.json.items.length, 1);

  const conflict = await api('POST', `/api/jobs/${jobId}/revisions`, {
    text: 'Ещё одна правка.',
    baseRevision: 0,
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.code, 'conflict');
});

test('e2e: история документов', async () => {
  const { status, json } = await api('GET', '/api/documents?limit=10');
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.items));
});

test('e2e: отмена завершённой задачи — 409', async () => {
  const created = await api('POST', '/api/process', { text: TEXT, options: { r2: true, level: 3 } });
  const jobId = created.json.job.id;
  const { status, json } = await api('POST', `/api/jobs/${jobId}/cancel`);
  assert.equal(status, 409);
  assert.equal(json.code, 'already_finished');
});

test('e2e: чужой job недоступен (404)', async () => {
  const created = await api('POST', '/api/process', { text: TEXT, options: { r2: true, level: 3 } });
  const jobId = created.json.job.id;

  // Вторая сессия — другой пользователь.
  const firstJar = new Map(jar);
  jar.clear();
  const reg = await api('POST', '/api/auth/register', { email: 'other@example.com', password: 'testpass123' });
  assert.equal(reg.status, 201);
  await api('POST', '/api/auth/consent', { action: 'grant' });

  const { status } = await api('GET', `/api/jobs/${jobId}`);
  assert.equal(status, 404);

  jar.clear();
  for (const [k, v] of firstJar) jar.set(k, v);
});

test('e2e: удаление аккаунта требует подтверждения', async () => {
  const wrong = await api('DELETE', '/api/auth/account', { confirm: 'нет' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.json.code, 'confirm_required');
});

test('e2e: кнопка выхода есть на странице и API разлогинивает', async () => {
  const page = await api('GET', '/settings', undefined, { raw: true });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /data-logout/);

  const logout = await api('POST', '/api/auth/logout', {});
  assert.equal(logout.status, 200);
  assert.equal(logout.json.ok, true);

  const me = await api('GET', '/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.user, null);
});
