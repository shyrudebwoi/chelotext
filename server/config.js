// Конфигурация приложения. Значения читаются из окружения, с безопасными дефолтами.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

// Мини-загрузчик .env без внешних зависимостей.
function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile();

const num = (key, fallback) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? value : fallback;
};
const bool = (key, fallback) => {
  const value = process.env[key];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const DATA_DIR = process.env.DATA_DIR ? path.resolve(ROOT, process.env.DATA_DIR) : path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'rules').toLowerCase();
const LLM_MODEL = process.env.LLM_MODEL
  || (LLM_PROVIDER === 'gigachat' ? (process.env.GIGACHAT_MODEL || 'GigaChat-2') : 'qwen2.5:7b-instruct');

function readSecret() {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  const secretFile = path.join(DATA_DIR, '.session-secret');
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf8').trim();
  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  return generated;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: num('PORT', 3000),
  host: process.env.HOST || '127.0.0.1',
  dataDir: DATA_DIR,
  dbFile: process.env.DB_FILE ? path.resolve(ROOT, process.env.DB_FILE) : path.join(DATA_DIR, 'chelotext.sqlite'),
  sessionSecret: readSecret(),
  sessionTtlDays: num('SESSION_TTL_DAYS', 30),
  cookieName: 'chelotext_sid',
  secureCookies: bool('SECURE_COOKIES', process.env.NODE_ENV === 'production'),
  trustProxy: bool('TRUST_PROXY', false),

  // Жёсткие лимиты из ТЗ (4.3, 4.3.1)
  limits: {
    maxChars: num('MAX_CHARS', 100_000),
    maxPdfPages: num('MAX_PDF_PAGES', 50),
    maxUploadBytes: num('MAX_UPLOAD_BYTES', 25 * 1024 * 1024),
    minPassword: 8,
  },

  // Порог переключения на асинхронную очередь (ТЗ 5)
  syncMaxChars: num('SYNC_MAX_CHARS', 12_000),
  syncMaxMs: num('SYNC_MAX_MS', 55_000),
  jobConcurrency: num('JOB_CONCURRENCY', 2),
  ocrConcurrency: num('OCR_CONCURRENCY', 1),

  // Хранение (ТЗ 8: минимизация и настраиваемый срок)
  retentionDays: num('RETENTION_DAYS', 30),

  // Rate limit
  rateLimit: {
    loginPerHour: num('RL_LOGIN_PER_HOUR', 10),
    registerPerHour: num('RL_REGISTER_PER_HOUR', 5),
    processPerHour: num('RL_PROCESS_PER_HOUR', 30),
    uploadPerHour: num('RL_UPLOAD_PER_HOUR', 20),
    globalPerMinute: num('RL_GLOBAL_PER_MINUTE', 240),
  },

  // LLM-провайдер: rules | ollama | openai | gigachat
  llm: {
    provider: LLM_PROVIDER,
    model: LLM_MODEL,
    baseUrl: process.env.LLM_BASE_URL || 'http://127.0.0.1:11434',
    apiKey: process.env.LLM_API_KEY || '',
    timeoutMs: num('LLM_TIMEOUT_MS', 45_000),
    maxRetries: num('LLM_MAX_RETRIES', 2),
    chunkChars: num('LLM_CHUNK_CHARS', 3_000),
    maxTokens: num('LLM_MAX_TOKENS', 4096),
    temperature: Number(process.env.LLM_TEMPERATURE ?? 0.2),
    enabled: bool('LLM_ENABLED', false),

    // GigaChat: ключ авторизации (Authorization Key) или Client ID + Client Secret.
    // Оба значения — секреты, в логи не попадают. См. api/GigaChat_01_Авторизация.md.
    gigachat: {
      cred: process.env.GIGACHAT_CRED || '',
      clientId: process.env.GIGACHAT_CLIENT_ID || '',
      clientSecret: process.env.GIGACHAT_CLIENT_SECRET || '',
      scope: process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS',
      oauthUrl: process.env.GIGACHAT_OAUTH_URL || 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
      apiUrl: process.env.GIGACHAT_API_URL || 'https://api.giga.chat/v1',
      userAgent: process.env.GIGACHAT_USER_AGENT || 'chelotext/1.0',
      // Дополнительный PEM с корневым сертификатом НУЦ Минцифры (см. npm run certs).
      caFile: process.env.GIGACHAT_CA_FILE || '',
      tokenRefreshSkewMs: num('GIGACHAT_TOKEN_SKEW_MS', 60_000),
    },
  },

  // OCR (ТЗ 4.3.1)
  ocr: {
    enabled: bool('OCR_ENABLED', true),
    languages: (process.env.OCR_LANGS || 'rus+eng').split(/[,+]/).map((s) => s.trim()).filter(Boolean),
    dpi: num('OCR_DPI', 200),
    minConfidence: num('OCR_MIN_CONFIDENCE', 60),
    maxPages: num('OCR_MAX_PAGES', 50),
  },

  policyVersion: process.env.POLICY_VERSION || '2026-11-24',
  operator: {
    name: process.env.OPERATOR_NAME || 'Оператор сервиса «Челотекст»',
    email: process.env.OPERATOR_EMAIL || 'privacy@chelotext.local',
  },
};

export const isProd = config.env === 'production';
