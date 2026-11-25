// Бот сообщества ВКонтакте на Bots Long Poll API.
// Показывает администраторам, кто и когда обрабатывал текст и сколько токенов потратил.
// Токен читается только из .env; в логи и ответы он не попадает.
import { config } from '../config.js';
import { listRecentUsage, usageSummary, usageByUser } from './usage.js';

const VK_API = 'https://api.vk.com/method';
const MAX_MESSAGE_CHARS = 3800;

const COMMAND_ALIASES = {
  start: 'help',
  help: 'help',
  помощь: 'help',
  начать: 'help',
  привет: 'help',
  меню: 'help',
  stats: 'stats',
  статистика: 'stats',
  отчёт: 'stats',
  отчет: 'stats',
  запросы: 'stats',
  последние: 'stats',
  last: 'stats',
  today: 'today',
  сегодня: 'today',
  день: 'today',
  week: 'week',
  неделя: 'week',
  '7дней': 'week',
  total: 'total',
  итого: 'total',
  всего: 'total',
};

export function parseCommand(text) {
  const raw = String(text || '').trim();
  if (!raw) return { command: 'help' };

  const words = raw.split(/\s+/);
  const head = words[0].toLowerCase().replace(/^\/+/, '');
  const rest = words.slice(1);

  if (/сегодня/i.test(raw)) return { command: 'today' };
  if (/недел/i.test(raw)) return { command: 'week' };

  const command = COMMAND_ALIASES[head] || 'help';
  if (command === 'stats') {
    const n = Math.trunc(Number(rest[0]));
    return { command, limit: Number.isFinite(n) && n > 0 ? Math.min(50, n) : 10 };
  }
  return { command };
}

export function isAdmin(fromId, adminIds = []) {
  return adminIds.includes(Number(fromId));
}

/** Убирает секреты из текста ошибки перед логированием. */
export function redactSecrets(text, secrets = []) {
  let out = String(text ?? '');
  for (const secret of secrets) {
    if (secret && String(secret).length >= 4) out = out.split(String(secret)).join('[скрыто]');
  }
  return out.slice(0, 500);
}

export function pluralTokens(n) {
  const value = Math.abs(Math.trunc(Number(n))) || 0;
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return 'токен';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'токена';
  return 'токенов';
}

function formatNumber(value) {
  return new Intl.NumberFormat('ru-RU').format(Math.trunc(Number(value)) || 0);
}

function formatTokens(value) {
  const n = Math.trunc(Number(value)) || 0;
  return `${formatNumber(n)} ${pluralTokens(n)}`;
}

function formatDateTime(iso, timeZone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDate(iso, timeZone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

// Смещение часового пояса в миллисекундах для конкретного момента.
function timeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const map = {};
  for (const part of parts) map[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) % 24,
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - date.getTime();
}

/** Начало календарного дня в заданной зоне, в ISO/UTC. */
export function startOfDay(date = new Date(), timeZone = 'Europe/Moscow') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = {};
  for (const part of parts) map[part.type] = part.value;
  const offset = timeZoneOffsetMs(date, timeZone);
  return new Date(Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day)) - offset).toISOString();
}

export function startOfDaysAgo(days, date = new Date(), timeZone = 'Europe/Moscow') {
  const start = new Date(startOfDay(date, timeZone));
  const shifted = new Date(start.getTime() - Math.max(0, Math.trunc(days)) * 86_400_000);
  return startOfDay(shifted, timeZone);
}

export function helpText() {
  return [
    'Я служебный бот «Челотекста». Показываю, кто обрабатывал текст и сколько токенов потратил.',
    '',
    '/stats [N] — последние N запросов (по умолчанию 10)',
    '/today — итоги за сегодня',
    '/week — итоги за 7 дней',
    '/total — итоги за всё время',
    '/help — эта справка',
    '',
    'В отчёте: почта пользователя, время запроса и токены (вход + ответ).',
  ].join('\n');
}

export function formatRecent(rows = [], { timeZone = 'Europe/Moscow' } = {}) {
  if (!rows.length) {
    return 'Пока нет записей о расходе токенов. Они появятся после первого запроса к модели.';
  }
  const lines = [`Последние запросы (${timeZone}):`, ''];
  rows.forEach((row, index) => {
    lines.push(
      `${index + 1}. ${formatDateTime(row.createdAt, timeZone)} — ${row.email} — ${formatTokens(row.totalTokens)}`
      + ` (вход ${formatNumber(row.promptTokens)}, ответ ${formatNumber(row.completionTokens)})`,
    );
  });
  lines.push('', 'Ещё: /today — за сегодня, /week — за неделю, /total — за всё время.');
  return lines.join('\n');
}

export function formatSummary({
  title,
  fromIso,
  summary,
  users = [],
  timeZone = 'Europe/Moscow',
} = {}) {
  const header = title === 'total'
    ? 'За всё время'
    : title === 'сегодня'
      ? `За сегодня · ${formatDate(fromIso || new Date().toISOString(), timeZone)}`
      : `За ${title} · с ${formatDate(fromIso || new Date().toISOString(), timeZone)}`;
  const lines = [
    `${header} (${timeZone})`,
    `Запросов: ${formatNumber(summary?.requests)} · Токенов: ${formatNumber(summary?.totalTokens)}`
    + ` (вход ${formatNumber(summary?.promptTokens)}, ответ ${formatNumber(summary?.completionTokens)})`,
  ];
  if (!users.length) {
    lines.push('', 'Записей за этот период нет.');
    return lines.join('\n');
  }
  lines.push('', 'Кто тратил:');
  for (const user of users) {
    lines.push(
      `• ${user.email} — ${formatTokens(user.totalTokens)} · ${formatNumber(user.requests)} запросов`,
    );
  }
  return lines.join('\n');
}

/**
 * @param {object} options
 * @param {object} [options.settings] — config.vk
 * @param {Function} [options.fetchImpl]
 * @param {object} [options.usage] — хранилище статистики (для тестов)
 * @param {object} [options.logger]
 * @param {Function} [options.sleep]
 * @param {Function} [options.randomId]
 * @param {Function} [options.now]
 */
export function createVkBot({
  settings = config.vk,
  fetchImpl = globalThis.fetch,
  usage = { listRecentUsage, usageSummary, usageByUser },
  logger = console,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  randomId = () => Math.floor(Math.random() * 2_000_000_000),
  now = () => new Date(),
} = {}) {
  const secrets = [settings?.token].filter(Boolean);
  let started = false;
  let stopped = false;
  let loopPromise = null;
  let longPoll = null; // { server, key, ts }
  let activeController = null;

  const safeError = (error) => redactSecrets(error?.message || error, [...secrets, longPoll?.key]);

  function assertConfigured() {
    if (!settings?.token) return 'не задан VK_BOT_TOKEN';
    if (!settings?.groupId) return 'не задан VK_BOT_GROUP_ID';
    return null;
  }

  async function callMethod(method, params = {}) {
    if (!fetchImpl) throw new Error('fetch недоступен');
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) body.set(key, String(value));
    body.set('access_token', settings.token);
    body.set('v', settings.apiVersion || '5.199');

    const response = await fetchImpl(`${VK_API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`VK API ${method}: некорректный ответ`);
    }
    if (data?.error) {
      throw new Error(`VK API ${method}: код ${data.error.error_code} — ${data.error.error_msg}`);
    }
    return data?.response;
  }

  async function sendMessage(peerId, text) {
    await callMethod('messages.send', {
      peer_id: peerId,
      message: text,
      random_id: randomId(),
    });
  }

  async function sendLongMessage(peerId, text) {
    let rest = String(text || '').trim();
    if (!rest) return;
    while (rest.length > MAX_MESSAGE_CHARS) {
      let cut = rest.lastIndexOf('\n', MAX_MESSAGE_CHARS);
      if (cut < MAX_MESSAGE_CHARS / 2) cut = MAX_MESSAGE_CHARS;
      await sendMessage(peerId, rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    }
    if (rest) await sendMessage(peerId, rest);
  }

  async function buildReply(text) {
    const { command, limit } = parseCommand(text);
    const timeZone = settings.timeZone || 'Europe/Moscow';

    if (command === 'stats') {
      const rows = await usage.listRecentUsage({ limit });
      return formatRecent(rows, { timeZone });
    }
    if (command === 'today') {
      const fromIso = startOfDay(now(), timeZone);
      const [summary, users] = await Promise.all([
        usage.usageSummary({ since: fromIso }),
        usage.usageByUser({ since: fromIso, limit: 10 }),
      ]);
      return formatSummary({ title: 'сегодня', fromIso, summary, users, timeZone });
    }
    if (command === 'week') {
      const fromIso = startOfDaysAgo(6, now(), timeZone);
      const [summary, users] = await Promise.all([
        usage.usageSummary({ since: fromIso }),
        usage.usageByUser({ since: fromIso, limit: 10 }),
      ]);
      return formatSummary({ title: '7 дней', fromIso, summary, users, timeZone });
    }
    if (command === 'total') {
      const [summary, users] = await Promise.all([
        usage.usageSummary(),
        usage.usageByUser({ limit: 10 }),
      ]);
      return formatSummary({ title: 'total', summary, users, timeZone });
    }
    return helpText();
  }

  async function handleUpdate(update) {
    if (update?.type !== 'message_new') return;
    const message = update.object?.message;
    if (!message) return;

    const fromId = Number(message.from_id);
    const peerId = Number(message.peer_id ?? message.from_id);
    if (!Number.isFinite(fromId) || fromId <= 0 || !Number.isFinite(peerId)) return;

    if (!isAdmin(fromId, settings.adminIds)) {
      await sendMessage(
        peerId,
        `Это служебный бот. Команды доступны только администраторам сервиса.\nВаш VK ID: ${fromId}`,
      );
      return;
    }

    let reply;
    try {
      reply = await buildReply(message.text);
    } catch (error) {
      logger.warn(`VK-бот: не удалось собрать отчёт — ${safeError(error)}`);
      reply = 'Не получилось собрать отчёт. Попробуйте позже.';
    }
    await sendLongMessage(peerId, reply);
  }

  async function refreshLongPoll() {
    const info = await callMethod('groups.getLongPollServer', { group_id: settings.groupId });
    if (!info?.server || !info?.key || !info?.ts) {
      throw new Error('VK API: Long Poll вернул неполные данные');
    }
    longPoll = { server: info.server, key: info.key, ts: info.ts };
  }

  async function pollOnce() {
    if (!longPoll) await refreshLongPoll();
    const url = new URL(longPoll.server);
    url.searchParams.set('act', 'a_check');
    url.searchParams.set('key', longPoll.key);
    url.searchParams.set('ts', String(longPoll.ts));
    url.searchParams.set('wait', String(settings.waitSeconds || 25));
    url.searchParams.set('mode', '2');
    url.searchParams.set('version', '3');

    const controller = new AbortController();
    activeController = controller;
    const timer = setTimeout(() => controller.abort(), ((settings.waitSeconds || 25) + 15) * 1000);
    timer.unref?.();

    try {
      const response = await fetchImpl(url.toString(), { signal: controller.signal });
      if (!response.ok) throw new Error(`Long Poll HTTP ${response.status}`);
      const data = await response.json();

      if (data?.failed) {
        if (data.failed === 1 && data.ts) {
          longPoll.ts = data.ts;
        } else {
          // 2 — истёк key, 3 — потеряна история. Берём новые параметры сервера.
          longPoll = null;
          await refreshLongPoll();
        }
        return;
      }

      if (data?.ts) longPoll.ts = data.ts;
      for (const update of data?.updates || []) {
        if (stopped) break;
        try {
          await handleUpdate(update);
        } catch (error) {
          logger.warn(`VK-бот: ошибка обработки события — ${safeError(error)}`);
        }
      }
    } finally {
      clearTimeout(timer);
      if (activeController === controller) activeController = null;
    }
  }

  async function loop() {
    let delayMs = 1000;
    while (!stopped) {
      try {
        await pollOnce();
        delayMs = 1000;
      } catch (error) {
        if (stopped) break;
        logger.warn(`VK-бот: ${safeError(error)}`);
        await sleep(delayMs);
        delayMs = Math.min(60_000, delayMs * 2);
      }
    }
  }

  function start() {
    if (!settings?.enabled) return { started: false, reason: 'disabled' };
    const problem = assertConfigured();
    if (problem) {
      logger.warn(`VK-бот: ${problem} — бот не запущен`);
      return { started: false, reason: problem };
    }
    if (!settings.adminIds?.length) {
      logger.warn('VK-бот: VK_BOT_ADMIN_IDS пуст — команды будут отклонены для всех');
    }
    if (started) return { started: true };
    started = true;
    stopped = false;
    loopPromise = loop();
    return { started: true };
  }

  function stop() {
    started = false;
    stopped = true;
    activeController?.abort();
    activeController = null;
    longPoll = null;
    return loopPromise;
  }

  return {
    start,
    stop,
    handleUpdate,
    pollOnce,
    buildReply,
    get started() {
      return started;
    },
  };
}

let singleton = null;

export function startVkBot(options = {}) {
  if (singleton) return singleton;
  singleton = createVkBot(options);
  const result = singleton.start();
  if (result.started) console.info('VK-бот: Long Poll запущен');
  return singleton;
}

export function stopVkBot() {
  if (!singleton) return;
  singleton.stop();
  singleton = null;
}
