// Клиент GigaChat API: обмен ключа на токен (30 мин) и запрос к chat/completions.
// Секреты живут только в .env на сервере и никогда не попадают в ответы/логи.
// Источники: api/GigaChat_01_Авторизация.md, GigaChat_02_Генерация_ответа.md, GigaChat_03_Ошибки.md.
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import tls from 'node:tls';
import { randomUUID } from 'node:crypto';
import { ROOT } from '../../config.js';
import { buildSystemPrompt, buildUserPrompt } from './prompts.js';

const DEFAULT_CA_PATH = path.join(ROOT, 'certs', 'russian_trusted_root_ca.crt');

// Физлицам доступен один поток: запросы к GigaChat идут строго по очереди.
let queueTail = Promise.resolve();

function serialize(task) {
  const result = queueTail.then(task, task);
  queueTail = result.catch(() => {});
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redact(text, secrets) {
  let out = String(text ?? '');
  for (const secret of secrets) {
    if (secret && String(secret).length >= 4) out = out.split(String(secret)).join('[скрыто]');
  }
  return out.slice(0, 500);
}

export class GigaChatHttpError extends Error {
  constructor(status, detail, scope, secrets) {
    const safeDetail = redact(detail, secrets);
    super(`GigaChat ${scope}: HTTP ${status}${safeDetail ? ` — ${safeDetail}` : ''}`);
    this.name = 'GigaChatHttpError';
    this.status = status;
    this.scope = scope;
  }
}

/** Дополнительные корневые сертификаты (НУЦ Минцифры) без отключения проверки TLS. */
export function buildCaCertificates(caFile = '') {
  const files = [DEFAULT_CA_PATH, caFile].filter(Boolean);
  return files.reduce((list, file) => {
    const resolved = path.isAbsolute(file) ? file : path.join(ROOT, file);
    if (!fs.existsSync(resolved)) return list;
    const pem = fs.readFileSync(resolved, 'utf8').trim();
    if (pem && !list.includes(pem)) list.push(pem);
    return list;
  }, [...new Set(tls.rootCertificates)]);
}

/** Минимальный JSON-транспорт на node:https: позволяет задать свои корневые CA. */
export function requestJson(url, { method = 'GET', headers = {}, body = null, timeoutMs = 45_000, ca = [] } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers, timeout: timeoutMs, ca }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          data = null;
        }
        resolve({ status: res.statusCode || 0, data, raw });
      });
    });
    req.on('timeout', () => req.destroy(new Error('превышено время ожидания')));
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

/**
 * @param {object} options
 * @param {object} options.config — config.llm
 * @param {Function} [options.requestJson] — инъекция транспорта для тестов
 * @param {Function} [options.sleep] — инъекция задержки для тестов
 * @param {Function} [options.now] — инъекция времени для тестов
 */
export function createGigaChatClient({
  config,
  requestJson: transport = requestJson,
  sleep: delay = sleep,
  now = Date.now,
} = {}) {
  const llm = config || {};
  const gc = llm.gigachat || {};
  const secrets = [gc.cred, gc.clientId, gc.clientSecret].filter(Boolean);
  const timeoutMs = llm.timeoutMs || 45_000;
  const maxRetries = Number.isFinite(llm.maxRetries) ? llm.maxRetries : 2;
  const skewMs = Number.isFinite(gc.tokenRefreshSkewMs) ? gc.tokenRefreshSkewMs : 60_000;
  const oauthUrl = gc.oauthUrl || 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
  const apiUrl = (gc.apiUrl || 'https://api.giga.chat/v1').replace(/\/$/, '');
  const chatUrl = `${apiUrl}/chat/completions`;
  const ca = buildCaCertificates(gc.caFile);

  let token = '';
  let tokenExpiresAt = 0;

  function basicCredential() {
    if (gc.cred) return gc.cred;
    if (gc.clientId && gc.clientSecret) {
      return Buffer.from(`${gc.clientId}:${gc.clientSecret}`, 'utf8').toString('base64');
    }
    throw new Error('Не задан GIGACHAT_CRED или GIGACHAT_CLIENT_ID + GIGACHAT_CLIENT_SECRET в .env');
  }

  async function getAccessToken(force = false) {
    if (!force && token && now() < tokenExpiresAt - skewMs) return token;
    const basic = basicCredential();
    secrets.push(basic);
    const response = await transport(oauthUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        RqUID: randomUUID(),
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({ scope: gc.scope || 'GIGACHAT_API_PERS' }).toString(),
      timeoutMs,
      ca,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new GigaChatHttpError(
        response.status,
        response.data?.message || response.data?.code || response.raw,
        'token',
        secrets,
      );
    }
    if (!response.data?.access_token || !Number.isFinite(Number(response.data?.expires_at))) {
      throw new Error('GigaChat: в ответе нет access_token или expires_at');
    }
    token = response.data.access_token;
    tokenExpiresAt = Number(response.data.expires_at);
    secrets.push(token);
    return token;
  }

  async function chat(text, { level = 3, modes = {} } = {}) {
    const body = {
      model: llm.model || 'GigaChat-2',
      messages: [
        { role: 'system', content: buildSystemPrompt(level) },
        { role: 'user', content: buildUserPrompt(text, { modes, level }) },
      ],
      temperature: Number.isFinite(llm.temperature) ? llm.temperature : 0.2,
      max_tokens: llm.maxTokens || 4096,
    };
    let bearer = await getAccessToken();
    let refreshed = false;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const response = await transport(chatUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${bearer}`,
          'User-Agent': gc.userAgent || 'chelotext/1.0',
        },
        body: JSON.stringify(body),
        timeoutMs,
        ca,
      });

      // Токен мог истечь между запросами — обновляем один раз и повторяем.
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        bearer = await getAccessToken(true);
        continue;
      }
      if (response.status >= 200 && response.status < 300) {
        const choice = response.data?.choices?.[0];
        if (!choice?.message?.content) throw new Error('GigaChat вернул пустой ответ');
        if (choice.finish_reason === 'length') {
          throw new Error('GigaChat оборвал ответ — оставляем текст после правил');
        }
        if (choice.finish_reason === 'blacklist') {
          throw new Error('GigaChat не пропустил запрос');
        }
        return choice.message.content;
      }

      const error = new GigaChatHttpError(
        response.status,
        response.data?.message || response.data?.error?.message || response.data?.detail || response.raw,
        'chat',
        secrets,
      );
      if ([429, 502, 503, 504].includes(response.status) && attempt < maxRetries) {
        await delay(400 * 2 ** attempt);
        continue;
      }
      throw error;
    }
    throw new Error('GigaChat: исчерпаны повторы запроса');
  }

  return {
    get hasCredentials() {
      return Boolean(gc.cred || (gc.clientId && gc.clientSecret));
    },
    get credentialSource() {
      if (gc.cred) return 'authorization key';
      if (gc.clientId && gc.clientSecret) return 'client id + client secret';
      return 'not configured';
    },
    getAccessToken,
    generate: (text, options) => serialize(() => chat(text, options)),
  };
}
