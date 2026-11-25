// Нормализация и накопление расхода токенов LLM.
// Провайдеры отдают usage в разных форматах: GigaChat/OpenAI — snake_case,
// Ollama — prompt_eval_count/eval_count. Здесь всё приводится к одному виду.

const int = (value) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * @param {object} raw — блок usage из ответа провайдера
 * @returns {{promptTokens:number, completionTokens:number, totalTokens:number}}
 */
export function normalizeUsage(raw = {}) {
  const promptTokens = int(raw.prompt_tokens ?? raw.promptTokens ?? raw.prompt_eval_count);
  const completionTokens = int(raw.completion_tokens ?? raw.completionTokens ?? raw.eval_count);
  const totalTokens = int(raw.total_tokens ?? raw.totalTokens) || promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

export function emptyUsage() {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 };
}

/** Складывает usage на месте и возвращает накопитель. */
export function addUsage(target, incoming) {
  if (!incoming) return target;
  target.promptTokens += int(incoming.promptTokens);
  target.completionTokens += int(incoming.completionTokens);
  target.totalTokens += int(incoming.totalTokens) || int(incoming.promptTokens) + int(incoming.completionTokens);
  target.calls += int(incoming.calls);
  return target;
}
