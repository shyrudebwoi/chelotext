// Абстракция LLM-провайдера. Реализации: rules (без модели), ollama (self-host),
// openai-совместимый и gigachat (Сбер, API для физлиц).
// Замена провайдера — только через конфиг, бизнес-логика не меняется.
import { config } from '../../config.js';
import { buildSystemPrompt, buildUserPrompt, PROMPT_VERSION } from './prompts.js';
import { createGigaChatClient } from './gigachat.js';
import { normalizeUsage } from './usage.js';

class CircuitBreaker {
  constructor({ failuresToOpen = 3, cooldownMs = 60_000 } = {}) {
    this.failuresToOpen = failuresToOpen;
    this.cooldownMs = cooldownMs;
    this.failures = 0;
    this.openedAt = 0;
  }

  get isOpen() {
    if (!this.openedAt) return false;
    if (Date.now() - this.openedAt > this.cooldownMs) {
      this.openedAt = 0;
      this.failures = 0;
      return false;
    }
    return true;
  }

  success() {
    this.failures = 0;
    this.openedAt = 0;
  }

  failure() {
    this.failures += 1;
    if (this.failures >= this.failuresToOpen) this.openedAt = Date.now();
  }
}

const breaker = new CircuitBreaker();

export class LlmUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LlmUnavailableError';
  }
}

/** Базовый интерфейс провайдера. */
export class LlmProvider {
  get name() {
    return 'base';
  }

  get available() {
    return false;
  }

  // eslint-disable-next-line no-unused-vars
  async generate(text, options) {
    throw new LlmUnavailableError('Провайдер не реализован');
  }
}

/** Провайдер без модели: возвращает текст как есть, всё делает движок правил. */
export class RulesOnlyProvider extends LlmProvider {
  get name() {
    return 'rules';
  }

  get available() {
    return true;
  }

  async generate(text) {
    return text;
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function retry(fn, retries) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
  }
  throw lastError;
}

/** Ollama (self-host, по умолчанию для бюджета ≈ 0). */
export class OllamaProvider extends LlmProvider {
  get name() {
    return 'ollama';
  }

  get available() {
    return config.llm.enabled && !breaker.isOpen;
  }

  async generate(text, { level = 3, modes = {}, onUsage } = {}) {
    if (!this.available) throw new LlmUnavailableError('LLM выключена или временно недоступна');
    const body = {
      model: config.llm.model,
      stream: false,
      options: { temperature: config.llm.temperature },
      messages: [
        { role: 'system', content: buildSystemPrompt(level) },
        { role: 'user', content: buildUserPrompt(text, { modes, level }) },
      ],
    };
    try {
      const result = await retry(async () => {
        const response = await fetchWithTimeout(
          `${config.llm.baseUrl.replace(/\/$/, '')}/api/chat`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
          config.llm.timeoutMs,
        );
        if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
        const data = await response.json();
        try {
          onUsage?.({ ...normalizeUsage(data), calls: 1 });
        } catch {
          // учёт не должен ломать генерацию
        }
        return data?.message?.content ?? '';
      }, config.llm.maxRetries);
      breaker.success();
      return cleanLlmOutput(result);
    } catch (error) {
      breaker.failure();
      throw new LlmUnavailableError(`Ollama: ${error.message}`);
    }
  }
}

/** OpenAI-совместимый API (включая бесплатные тарифы и локальные шлюзы). */
export class OpenAiCompatibleProvider extends LlmProvider {
  get name() {
    return 'openai';
  }

  get available() {
    return config.llm.enabled && Boolean(config.llm.apiKey) && !breaker.isOpen;
  }

  async generate(text, { level = 3, modes = {}, onUsage } = {}) {
    if (!this.available) throw new LlmUnavailableError('LLM выключена или временно недоступна');
    const body = {
      model: config.llm.model,
      temperature: config.llm.temperature,
      messages: [
        { role: 'system', content: buildSystemPrompt(level) },
        { role: 'user', content: buildUserPrompt(text, { modes, level }) },
      ],
    };
    try {
      const result = await retry(async () => {
        const response = await fetchWithTimeout(
          `${config.llm.baseUrl.replace(/\/$/, '')}/v1/chat/completions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.llm.apiKey}` },
            body: JSON.stringify(body),
          },
          config.llm.timeoutMs,
        );
        if (!response.ok) throw new Error(`LLM HTTP ${response.status}`);
        const data = await response.json();
        try {
          onUsage?.({ ...normalizeUsage(data?.usage), calls: 1 });
        } catch {
          // учёт не должен ломать генерацию
        }
        return data?.choices?.[0]?.message?.content ?? '';
      }, config.llm.maxRetries);
      breaker.success();
      return cleanLlmOutput(result);
    } catch (error) {
      breaker.failure();
      throw new LlmUnavailableError(`LLM: ${error.message}`);
    }
  }
}

/** GigaChat (Сбер): ключ → токен на 30 минут → POST /v1/chat/completions. */
export class GigaChatProvider extends LlmProvider {
  constructor() {
    super();
    this.client = createGigaChatClient({ config: config.llm });
  }

  get name() {
    return 'gigachat';
  }

  get available() {
    return config.llm.enabled && this.client.hasCredentials && !breaker.isOpen;
  }

  get credentialSource() {
    return this.client.credentialSource;
  }

  async generate(text, { level = 3, modes = {}, onUsage } = {}) {
    if (!this.available) {
      throw new LlmUnavailableError('GigaChat выключен или не задан ключ в .env');
    }
    try {
      const result = await this.client.generate(text, { level, modes, onUsage });
      breaker.success();
      return cleanLlmOutput(result);
    } catch (error) {
      breaker.failure();
      // Не печатаем секреты: ошибка уже прошла через redact в клиенте.
      throw new LlmUnavailableError(`GigaChat: ${error.message}`);
    }
  }
}

function cleanLlmOutput(text) {
  let out = String(text ?? '').trim();
  // Снимаем возможные обёртки, которые модели любят добавлять.
  out = out.replace(/^```(?:markdown|md|text)?\s*/i, '').replace(/```\s*$/i, '');
  out = out.replace(/^<<<НАЧАЛО>>>\s*/i, '').replace(/\s*<<<КОНЕЦ>>>$/i, '');
  out = out.replace(/^Вот (?:исправленный|переработанный|улучшенный) текст:?\s*/i, '');
  return out.trim();
}

export function createProvider() {
  switch (config.llm.provider) {
    case 'ollama':
      return new OllamaProvider();
    case 'openai':
      return new OpenAiCompatibleProvider();
    case 'gigachat':
      return new GigaChatProvider();
    default:
      return new RulesOnlyProvider();
  }
}

export const providerInfo = () => {
  const provider = config.llm.provider;
  const gc = config.llm.gigachat;
  const hasGigaChatKey = Boolean(gc?.cred || (gc?.clientId && gc?.clientSecret));
  const configured = provider === 'rules' || provider === 'ollama'
    ? true
    : provider === 'gigachat' ? hasGigaChatKey : Boolean(config.llm.apiKey);
  return {
    provider,
    model: provider === 'rules' ? 'rules-only' : config.llm.model,
    promptVersion: PROMPT_VERSION,
    enabled: provider !== 'rules' && config.llm.enabled,
    configured,
    // Только факт наличия ключа, никогда само значение.
    ...(provider === 'gigachat'
      ? { credentialSource: gc?.cred ? 'authorization key' : hasGigaChatKey ? 'client id + client secret' : 'not configured' }
      : {}),
  };
};
