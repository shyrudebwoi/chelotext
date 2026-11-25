import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGigaChatClient } from '../server/core/llm/gigachat.js';
import { config } from '../server/config.js';
import { providerInfo } from '../server/core/llm/provider.js';

const NOW = 1_700_000_000_000;

function makeConfig(gigachat = {}, llm = {}) {
  return {
    model: 'GigaChat-2',
    temperature: 0.2,
    maxTokens: 4096,
    timeoutMs: 1000,
    maxRetries: 1,
    ...llm,
    gigachat: {
      cred: '',
      clientId: '',
      clientSecret: '',
      scope: 'GIGACHAT_API_PERS',
      oauthUrl: 'https://oauth.test/token',
      apiUrl: 'https://api.test/v1',
      userAgent: 'chelotext-test',
      caFile: '',
      tokenRefreshSkewMs: 60_000,
      ...gigachat,
    },
  };
}

const tokenResponse = () => ({
  status: 200,
  data: { access_token: 'tok-123456789', expires_at: NOW + 3_600_000 },
});

const chatResponse = (content = 'Готовый текст', finishReason = 'stop') => ({
  status: 200,
  data: { choices: [{ message: { role: 'assistant', content }, finish_reason: finishReason }] },
});

function transportWith(handler) {
  const calls = [];
  const transport = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options, calls.length);
  };
  return { transport, calls };
}

test('gigachat: собирает Basic из Client ID + Client Secret', async () => {
  const expectedBasic = Buffer.from('my-client:my-secret', 'utf8').toString('base64');
  const { transport, calls } = transportWith((url) => (url.includes('oauth') ? tokenResponse() : chatResponse()));
  const client = createGigaChatClient({
    config: makeConfig({ clientId: 'my-client', clientSecret: 'my-secret' }),
    requestJson: transport,
    sleep: async () => {},
    now: () => NOW,
  });

  const text = await client.generate('В целях обеспечения безопасности проводится анализ.', { level: 3, modes: { r2: true } });
  assert.equal(text, 'Готовый текст');

  const oauth = calls.find((call) => call.url.includes('oauth'));
  assert.equal(oauth.options.headers.Authorization, `Basic ${expectedBasic}`);
  assert.match(oauth.options.headers.RqUID, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(oauth.options.body, 'scope=GIGACHAT_API_PERS');

  const chat = calls.find((call) => call.url.endsWith('/chat/completions'));
  assert.equal(chat.options.headers.Authorization, 'Bearer tok-123456789');
  assert.equal(chat.options.headers['User-Agent'], 'chelotext-test');
  const body = JSON.parse(chat.options.body);
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[1].role, 'user');
  assert.equal(body.model, 'GigaChat-2');
});

test('gigachat: готовый Authorization Key использует Basic без перекодирования', async () => {
  const { transport, calls } = transportWith((url) => (url.includes('oauth') ? tokenResponse() : chatResponse()));
  const client = createGigaChatClient({
    config: makeConfig({ cred: 'prepared-key' }),
    requestJson: transport,
    sleep: async () => {},
    now: () => NOW,
  });
  await client.generate('Текст для проверки ключа.', { level: 2, modes: {} });
  const oauth = calls.find((call) => call.url.includes('oauth'));
  assert.equal(oauth.options.headers.Authorization, 'Basic prepared-key');
});

test('gigachat: токен переиспользуется в течение 30 минут', async () => {
  const { transport, calls } = transportWith((url) => (url.includes('oauth') ? tokenResponse() : chatResponse()));
  const client = createGigaChatClient({
    config: makeConfig({ cred: 'prepared-key' }),
    requestJson: transport,
    sleep: async () => {},
    now: () => NOW,
  });
  await client.generate('Первый текст.', {});
  await client.generate('Второй текст.', {});
  assert.equal(calls.filter((call) => call.url.includes('oauth')).length, 1);
  assert.equal(calls.filter((call) => call.url.endsWith('/chat/completions')).length, 2);
});

test('gigachat: 401 обновляет токен один раз и повторяет запрос', async () => {
  let chatAttempts = 0;
  const { transport, calls } = transportWith((url) => {
    if (url.includes('oauth')) return tokenResponse();
    chatAttempts += 1;
    return chatAttempts === 1 ? { status: 401, data: { message: 'Unauthorized' } } : chatResponse();
  });
  const client = createGigaChatClient({
    config: makeConfig({ cred: 'prepared-key' }),
    requestJson: transport,
    sleep: async () => {},
    now: () => NOW,
  });
  const text = await client.generate('Текст с истёкшим токеном.', {});
  assert.equal(text, 'Готовый текст');
  assert.equal(calls.filter((call) => call.url.includes('oauth')).length, 2);
  assert.equal(chatAttempts, 2);
});

test('gigachat: оборванный ответ не отдаётся в пайплайн', async () => {
  const { transport } = transportWith((url) => (url.includes('oauth') ? tokenResponse() : chatResponse('оборв', 'length')));
  const client = createGigaChatClient({
    config: makeConfig({ cred: 'prepared-key' }),
    requestJson: transport,
    sleep: async () => {},
    now: () => NOW,
  });
  await assert.rejects(() => client.generate('Текст.', {}), /оборвал/);
});

test('gigachat: ошибка 402 не повторяется и не содержит секрет', async () => {
  const { transport, calls } = transportWith((url) => (
    url.includes('oauth') ? tokenResponse() : { status: 402, data: { message: 'нет токенов my-secret' } }
  ));
  const client = createGigaChatClient({
    config: makeConfig({ clientId: 'my-client', clientSecret: 'my-secret' }),
    requestJson: transport,
    sleep: async () => {},
    now: () => NOW,
  });
  await assert.rejects(
    () => client.generate('Текст.', {}),
    (error) => {
      assert.match(error.message, /HTTP 402/);
      assert.doesNotMatch(error.message, /my-secret|my-client/);
      return true;
    },
  );
  assert.equal(calls.filter((call) => call.url.endsWith('/chat/completions')).length, 1);
});

test('gigachat: сообщает расход токенов после успешного ответа', async () => {
  const { transport } = transportWith((url) => (
    url.includes('oauth')
      ? tokenResponse()
      : {
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'Готовый текст' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 18, completion_tokens: 42, precached_prompt_tokens: 0, total_tokens: 60 },
        },
      }
  ));
  const client = createGigaChatClient({
    config: makeConfig({ cred: 'prepared-key' }),
    requestJson: transport,
    sleep: async () => {},
    now: () => NOW,
  });

  let captured = null;
  await client.generate('Текст.', { onUsage: (usage) => { captured = usage; } });
  assert.deepEqual(captured, { promptTokens: 18, completionTokens: 42, totalTokens: 60, calls: 1 });
});

test('gigachat: без ключа доступность false, а providerInfo не раскрывает секрет', async () => {
  const client = createGigaChatClient({ config: makeConfig(), requestJson: async () => tokenResponse(), now: () => NOW });
  assert.equal(client.hasCredentials, false);
  assert.equal(client.credentialSource, 'not configured');
  await assert.rejects(() => client.generate('Текст.', {}), /GIGACHAT_CRED|GIGACHAT_CLIENT_ID/);

  const original = { provider: config.llm.provider, enabled: config.llm.enabled, gigachat: config.llm.gigachat };
  config.llm.provider = 'gigachat';
  config.llm.enabled = true;
  config.llm.gigachat = makeConfig({ cred: 'super-secret-key' }).gigachat;
  try {
    const info = providerInfo();
    assert.equal(info.provider, 'gigachat');
    assert.equal(info.configured, true);
    assert.equal(info.credentialSource, 'authorization key');
    assert.doesNotMatch(JSON.stringify(info), /super-secret-key/);
  } finally {
    config.llm.provider = original.provider;
    config.llm.enabled = original.enabled;
    config.llm.gigachat = original.gigachat;
  }
});
