#!/usr/bin/env node
// Скачивает корневой сертификат НУЦ Минцифры для GigaChat API.
// Проверка TLS НЕ отключается: сертификат добавляется к доверенным, а не игнорируется.
// Источник: https://www.gosuslugi.ru/crt (см. api/GigaChat_01_Авторизация.md).
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CERT_URL = process.env.GIGACHAT_CA_URL || 'https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt';
const TARGET = path.join(ROOT, 'certs', 'russian_trusted_root_ca.crt');

function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Слишком много перенаправлений'));
    const request = https.get(url, { timeout: 30_000 }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        return resolve(download(new URL(response.headers.location, url).href, redirects + 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`HTTP ${response.statusCode} при скачивании сертификата`));
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    request.on('timeout', () => request.destroy(new Error('Не удалось скачать сертификат: таймаут')));
    request.on('error', reject);
    return undefined;
  });
}

const pem = await download(CERT_URL).catch((error) => {
  console.error(`Не получилось скачать сертификат: ${error.message}`);
  console.error('Скачай его вручную с https://www.gosuslugi.ru/crt и положи в certs/russian_trusted_root_ca.crt');
  process.exit(1);
});

if (!pem.includes('-----BEGIN CERTIFICATE-----')) {
  console.error('По адресу сертификата пришёл не PEM. Положи сертификат в certs/russian_trusted_root_ca.crt вручную.');
  process.exit(1);
}

fs.mkdirSync(path.dirname(TARGET), { recursive: true });
fs.writeFileSync(TARGET, pem.trim() + '\n', { mode: 0o644 });
console.log(`Сертификат сохранён: ${path.relative(ROOT, TARGET)}`);
console.log('Перезапусти сервер, чтобы GigaChat заработал с проверкой TLS.');
