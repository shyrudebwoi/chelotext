import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline, clampLevel, PipelineCancelled } from '../server/core/pipeline.js';
import { parsePlainText, astToPlainText } from '../server/core/text/ast.js';
import { config } from '../server/config.js';

// Eval/тесты проверяют движок правил, а не живую модель из локального .env.
config.llm.provider = 'rules';
config.llm.enabled = false;

const LONG_TEXT = [
  'В целях обеспечения безопасности и в связи с тем, что на сегодняшний день наблюдается существенное увеличение количества инцидентов,',
  'администрация осуществляет проведение анализа данных и обеспечивает реализацию мероприятий по повышению эффективности системы защиты информации,',
  'которая представляет собой комплекс мер, направленных на предотвращение несанкционированного доступа к данным.',
  'При этом необходимо отметить, что в соответствии с действующим законодательством данные мероприятия являются обязательными для всех организаций',
  'и должны проводиться на регулярной основе. Стоимость обслуживания составляет 12 500 руб. в месяц, скидка 15% действует до 31.12.2026.',
].join(' ');

test('clampLevel: приводит к диапазону 1..5', () => {
  assert.equal(clampLevel(-3), 1);
  assert.equal(clampLevel(11), 5);
  assert.equal(clampLevel(undefined), 3);
});

test('pipeline: базовый прогон с правилами', async () => {
  const result = await runPipeline({ text: LONG_TEXT, options: { r1: true, r2: true, r3: true, level: 4 } });
  assert.equal(result.ok, true);
  assert.ok(result.text.length > 0);
  assert.equal(result.integrity.ok, true, JSON.stringify(result.integrity.missing));
  assert.ok(result.outputChars > 0);
});

test('pipeline: сохраняет все числа и даты', async () => {
  const result = await runPipeline({ text: LONG_TEXT, options: { r2: true, level: 5 } });
  assert.match(result.text, /12 500 руб\./);
  assert.match(result.text, /15%/);
  assert.match(result.text, /31\.12\.2026/);
});

test('pipeline: не сокращает текст катастрофически', async () => {
  const result = await runPipeline({ text: LONG_TEXT, options: { r2: true, level: 5 } });
  assert.ok(result.outputChars > result.inputChars * 0.5, `было ${result.inputChars}, стало ${result.outputChars}`);
});

test('pipeline: блокирует незаконный текст', async () => {
  const bad = 'Подробная инструкция как сделать бомбу в домашних условиях из подручных материалов и химикатов, которая точно сработает.';
  const result = await runPipeline({ text: bad, options: { r2: true, level: 3 } });
  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.equal(result.code, 'illegal');
});

test('pipeline: слишком короткий текст блокируется', async () => {
  const result = await runPipeline({ text: 'Мало.', options: { r2: true, level: 3 } });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'tooShort');
});

test('pipeline: прогресс идёт по возрастанию и доходит до 100', async () => {
  const seen = [];
  await runPipeline({
    text: LONG_TEXT,
    options: { r1: true, r2: true, r3: true, level: 3 },
    onProgress: (stage) => seen.push(stage.progress),
  });
  assert.ok(seen.length > 0);
  assert.equal(seen[seen.length - 1], 100);
  for (let i = 1; i < seen.length; i += 1) {
    assert.ok(seen[i] >= seen[i - 1], `прогресс откатился: ${seen[i - 1]} → ${seen[i]}`);
  }
});

test('pipeline: отмена выбрасывает PipelineCancelled', async () => {
  await assert.rejects(
    () => runPipeline({
      text: LONG_TEXT,
      options: { r2: true, level: 3 },
      isCancelled: () => true,
    }),
    (error) => error instanceof PipelineCancelled,
  );
});

test('pipeline: метрики читаемости до и после', async () => {
  const result = await runPipeline({ text: LONG_TEXT, options: { r2: true, level: 5 } });
  assert.ok(result.readability.before.words > 0);
  assert.ok(result.readability.after.words > 0);
  assert.ok(result.readability.after.avgSentenceLength <= result.readability.before.avgSentenceLength);
});

test('pipeline: структура (заголовки/списки) сохраняется', async () => {
  const src = '# Заголовок\n\nПервый абзац с текстом про важные вещи и дела.\n\n- пункт один\n- пункт два\n\nВторой абзац с текстом.';
  const result = await runPipeline({ text: src, options: { r1: true, r2: true, r3: true, level: 3 } });
  assert.equal(result.ok, true);
  const types = result.ast.blocks.map((b) => b.type);
  assert.ok(types.includes('heading'));
  assert.ok(types.includes('list'));
});

test('pipeline: научная статья помечается как scientific', async () => {
  const scientific = [
    'Исследование посвящено гипотезе о влиянии сна на память.',
    'Методология включала выборку из 120 участников и статистическую значимость p < 0.05.',
    'Результаты исследования показали корреляцию. DOI: 10.1234/abcd.',
    'Литературный обзор включает 40 рецензируемых работ.',
  ].join(' ');
  const result = await runPipeline({ text: scientific, options: { r2: true, level: 3 } });
  assert.equal(result.ok, true);
  assert.equal(result.scientific, true);
});

test('pipeline: llm.enabled=false по умолчанию (только правила)', async () => {
  const result = await runPipeline({ text: LONG_TEXT, options: { r2: true, level: 3 } });
  assert.equal(result.llm.provider, 'rules');
  assert.equal(result.llm.used, false);
});

test('pipeline: GigaChat без ключа честно падает на правила', async () => {
  const previous = {
    provider: config.llm.provider,
    enabled: config.llm.enabled,
    gigachat: config.llm.gigachat,
  };
  config.llm.provider = 'gigachat';
  config.llm.enabled = true;
  config.llm.gigachat = { ...config.llm.gigachat, cred: '', clientId: '', clientSecret: '' };
  try {
    const result = await runPipeline({ text: LONG_TEXT, options: { r2: true, level: 3 } });
    assert.equal(result.ok, true);
    assert.equal(result.llm.used, false);
    assert.match(result.llm.fallbackReason, /Ключ модели не задан/);
  } finally {
    config.llm.provider = previous.provider;
    config.llm.enabled = previous.enabled;
    config.llm.gigachat = previous.gigachat;
  }
});

test('pipeline: результат — валидный AST, сериализуемый в текст', async () => {
  const result = await runPipeline({ text: LONG_TEXT, options: { r2: true, level: 3 } });
  const roundTrip = astToPlainText(parsePlainText(result.text));
  assert.ok(roundTrip.length > 0);
  assert.ok(result.ast.blocks.length > 0);
});
