import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createVkBot,
  parseCommand,
  pluralTokens,
  formatRecent,
  formatSummary,
  startOfDay,
  redactSecrets,
} from '../server/services/vk-bot.js';

const settings = {
  enabled: true,
  groupId: 123,
  token: 'super-secret-token-value',
  apiVersion: '5.199',
  adminIds: [42],
  waitSeconds: 25,
  timeZone: 'Europe/Moscow',
};

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(data),
    json: async () => data,
  };
}

function makeBot({ usage, logger, fetchImpl } = {}) {
  const calls = [];
  const logs = [];
  const bot = createVkBot({
    settings,
    fetchImpl: fetchImpl || (async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('messages.send')) return jsonResponse({ response: 1 });
      return jsonResponse({ response: { server: 'https://lp.test', key: 'lp-key', ts: 1 } });
    }),
    usage: usage || {
      listRecentUsage: async () => [],
      usageSummary: async () => ({ requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
      usageByUser: async () => [],
    },
    logger: logger || { warn: (message) => logs.push(message), info: () => {} },
  });
  return { bot, calls, logs };
}

test('vk: разбор команд', () => {
  assert.deepEqual(parseCommand('/stats 5'), { command: 'stats', limit: 5 });
  assert.deepEqual(parseCommand('статистика'), { command: 'stats', limit: 10 });
  assert.deepEqual(parseCommand('/today'), { command: 'today' });
  assert.deepEqual(parseCommand('итоги за сегодня'), { command: 'today' });
  assert.deepEqual(parseCommand('за неделю'), { command: 'week' });
  assert.deepEqual(parseCommand('/total'), { command: 'total' });
  assert.deepEqual(parseCommand(''), { command: 'help' });
  assert.deepEqual(parseCommand('что-то непонятное'), { command: 'help' });
});

test('vk: склонение токенов и формат отчёта', () => {
  assert.equal(pluralTokens(1), 'токен');
  assert.equal(pluralTokens(2), 'токена');
  assert.equal(pluralTokens(5), 'токенов');
  assert.equal(pluralTokens(11), 'токенов');
  assert.equal(pluralTokens(21), 'токен');

  const text = formatRecent([
    {
      email: 'ivan@example.com',
      createdAt: '2026-11-25T11:32:00.000Z',
      promptTokens: 1000,
      completionTokens: 234,
      totalTokens: 1234,
    },
  ], { timeZone: 'Europe/Moscow' });

  assert.match(text, /ivan@example\.com/);
  assert.match(text, /25\.11\.2026/);
  assert.match(text, /14:32/);
  assert.match(text, /1\s234\sтокена/);
});

test('vk: сводка по пользователям', () => {
  const text = formatSummary({
    title: 'сегодня',
    fromIso: '2026-11-24T21:00:00.000Z',
    summary: { requests: 3, promptTokens: 300, completionTokens: 60, totalTokens: 360 },
    users: [{ email: 'a@b.ru', requests: 3, totalTokens: 360 }],
    timeZone: 'Europe/Moscow',
  });
  assert.match(text, /За сегодня/);
  assert.match(text, /25\.11\.2026/);
  assert.match(text, /a@b\.ru/);
  assert.match(text, /360 токенов/);
});

test('vk: начало дня в Москве', () => {
  assert.equal(
    startOfDay(new Date('2026-11-25T10:00:00.000Z'), 'Europe/Moscow'),
    '2026-11-24T21:00:00.000Z',
  );
});

test('vk: секреты вырезаются из текста ошибки', () => {
  const text = redactSecrets('bad token super-secret-token-value and lp-key', [
    'super-secret-token-value',
    'lp-key',
  ]);
  assert.doesNotMatch(text, /super-secret-token-value|lp-key/);
  assert.match(text, /\[скрыто\]/);
});

test('vk: админ получает отчёт, токен не попадает в лог', async () => {
  const usage = {
    listRecentUsage: async ({ limit }) => {
      assert.equal(limit, 10);
      return [{
        email: 'user@example.com',
        createdAt: '2026-11-25T11:32:00.000Z',
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      }];
    },
    usageSummary: async () => ({ requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
    usageByUser: async () => [],
  };
  const { bot, calls, logs } = makeBot({ usage });

  await bot.handleUpdate({
    type: 'message_new',
    object: { message: { from_id: 42, peer_id: 42, text: '/stats' } },
  });

  assert.equal(calls.length, 1);
  const body = new URLSearchParams(calls[0].options.body);
  assert.equal(body.get('peer_id'), '42');
  assert.match(body.get('message'), /user@example\.com/);
  assert.equal(body.get('access_token'), settings.token);
  assert.doesNotMatch(logs.join('\n'), /super-secret-token-value/);
});

test('vk: не-админ не получает данные', async () => {
  let usageCalled = false;
  const usage = {
    listRecentUsage: async () => {
      usageCalled = true;
      return [];
    },
    usageSummary: async () => ({ requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
    usageByUser: async () => [],
  };
  const { bot, calls } = makeBot({ usage });

  await bot.handleUpdate({
    type: 'message_new',
    object: { message: { from_id: 99, peer_id: 99, text: '/stats' } },
  });

  assert.equal(usageCalled, false);
  const body = new URLSearchParams(calls[0].options.body);
  assert.match(body.get('message'), /только администраторам/);
  assert.match(body.get('message'), /Ваш VK ID: 99/);
  assert.doesNotMatch(body.get('message'), /user@example\.com/);
});

test('vk: без токена бот не стартует и не раскрывает секрет', () => {
  const logs = [];
  const bot = createVkBot({
    settings: { ...settings, token: '' },
    fetchImpl: async () => {
      throw new Error('не должен вызываться');
    },
    logger: { warn: (message) => logs.push(message), info: () => {} },
  });
  const result = bot.start();
  assert.equal(result.started, false);
  assert.match(logs.join('\n'), /VK_BOT_TOKEN/);
  assert.equal(bot.started, false);
});

test('vk: Long Poll берёт сервер и обрабатывает событие', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('groups.getLongPollServer')) {
      return jsonResponse({ response: { server: 'https://lp.test', key: 'lp-key', ts: 7 } });
    }
    if (String(url).includes('lp.test')) {
      return jsonResponse({
        ts: 8,
        updates: [{ type: 'message_new', object: { message: { from_id: 42, peer_id: 42, text: '/help' } } }],
      });
    }
    return jsonResponse({ response: 1 });
  };
  const { bot } = makeBot({ fetchImpl });

  await bot.pollOnce();

  const longPollCall = calls.find((call) => call.url.includes('lp.test'));
  assert.match(longPollCall.url, /act=a_check/);
  assert.match(longPollCall.url, /key=lp-key/);
  assert.match(longPollCall.url, /ts=7/);

  const sent = calls.find((call) => call.url.includes('messages.send'));
  const body = new URLSearchParams(sent.options.body);
  assert.match(body.get('message'), /\/stats/);
});
