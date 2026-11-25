# GigaChat API: генерация ответа

Источники (сверено 24.11.2026):
- https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/post-chat
- https://developers.sber.ru/docs/ru/gigachat/models/main
- https://developers.sber.ru/docs/ru/gigachat/tariffs/individual-tariffs

Перед запросом нужен токен доступа, см. `GigaChat_01_Авторизация.md`.

## Запрос

**POST** `https://api.giga.chat/v1/chat/completions`

Заголовки:

| Заголовок | Значение |
|---|---|
| `Content-Type` | `application/json` |
| `Accept` | `application/json` |
| `Authorization` | `Bearer <токен_доступа>` |
| `User-Agent` | Любое значение, например `my-app`. Без него на api.giga.chat приходит 403 |

## Тело запроса

Обязательные поля: `model` и `messages`.

| Поле | Тип | Что делает |
|---|---|---|
| `model` | строка | Модель, см. таблицу ниже |
| `messages` | массив | История диалога: объекты `{"role": ..., "content": ...}` |
| `temperature` | число | Случайность ответа. Ниже - стабильнее, выше - разнообразнее. Меньше 0.001 - почти одинаковые ответы, больше 2 - хаос. По умолчанию зависит от модели |
| `top_p` | число | Альтернатива `temperature`. Меняйте что-то одно |
| `max_tokens` | целое | Максимум токенов в ответе |
| `repetition_penalty` | число | 1.0 - нейтрально, больше 1 - модель избегает повторов |
| `stream` | bool | Ответ по частям (SSE), поток заканчивается `data: [DONE]`. По умолчанию `false` |
| `response_format` | объект | Структурированный ответ (JSON по схеме) |
| `functions`, `function_call` | | Вызов функций. Для простого приложения не нужны |

Роли в `messages`:

| Роль | Что это |
|---|---|
| `system` | Инструкция модели: роль, тон, формат ответа |
| `user` | Сообщение пользователя |
| `assistant` | Предыдущие ответы модели |
| `function` | Результат пользовательской функции (только при работе с функциями) |

Правила:
- Системное сообщение **одно** и стоит **первым**. Иначе ошибка 422 `Invalid params: system message must be the first message`.
- Модель не помнит прошлые запросы. Чтобы продолжить диалог, передавайте всю историю заново.
- Текст передавайте в UTF-8.
- Слишком большой текст не поместится в контекст модели (ошибка 413 или 422). Длинные тексты делите на части.

## Модели для генерации текста

| ID модели в запросе | Описание |
|---|---|
| `GigaChat-2` (или `GigaChat`) | Lite: быстрая и лёгкая, для простых задач |
| `GigaChat-2-Pro` (или `GigaChat-Pro`) | Для ресурсоёмких задач |
| `GigaChat-2-Max` (или `GigaChat-Max`) | Самая мощная из линейки 2 |
| `GigaChat-3-Ultra` | Новая модель, только для физлиц во freemium-режиме |

Список моделей, доступных вашему ключу: `GET https://api.giga.chat/v1/models`.

## Бесплатные токены для физлиц (freemium)

| Модели | Токенов | Срок |
|---|---:|---|
| Lite (`GigaChat`, `GigaChat-2`) | 250 000 000 | 12 месяцев |
| Pro (`GigaChat-Pro`, `GigaChat-2-Pro`) | 40 000 000 | 12 месяцев |
| Max (`GigaChat-Max`, `GigaChat-2-Max`) | 25 000 000 | 12 месяцев |
| Ultra (`GigaChat-3-Ultra`) | 50 000 000 | 12 месяцев |

- Физлицам доступен **один поток**: параллельные запросы получат ошибку 429.
- Остаток токенов смотрите в личном кабинете. Когда токены модели заканчиваются, приходит ошибка 402.
- Условия меняются, актуальные - на странице тарифов (ссылка выше). С 1.09.2026 новые клиенты могут оплачивать модели на платформе cloud.ru.

## Пример запроса (Python)

```python
import os

import requests

API_URL = "https://api.giga.chat/v1/chat/completions"
CA_BUNDLE = "certs/ca_bundle.pem"


def ask_gigachat(user_text: str, system_prompt: str) -> dict:
    token = get_access_token()  # из GigaChat_01_Авторизация.md
    resp = requests.post(
        API_URL,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "my-app",
        },
        json={
            "model": os.environ.get("GIGACHAT_MODEL", "GigaChat-2"),
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_text},
            ],
            "temperature": 0.3,
            "max_tokens": 1500,
        },
        verify=CA_BUNDLE,
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()


data = ask_gigachat("Объясни простыми словами, что такое API.", "Отвечай кратко и понятно.")
print(data["choices"][0]["message"]["content"])
print(data["usage"])
```

## Ответ

```json
{
  "choices": [
    {
      "message": {"role": "assistant", "content": "Текст ответа"},
      "index": 0,
      "finish_reason": "stop"
    }
  ],
  "created": 1678878333,
  "model": "GigaChat:2.0.28.2",
  "usage": {
    "prompt_tokens": 18,
    "completion_tokens": 42,
    "precached_prompt_tokens": 0,
    "total_tokens": 60
  },
  "object": "chat.completion"
}
```

Текст ответа: `choices[0].message.content`.

`finish_reason`:

| Значение | Что значит |
|---|---|
| `stop` | Ответ завершён полностью |
| `length` | Достигнут лимит токенов, ответ оборван. Увеличьте `max_tokens` или попросите отвечать короче |
| `function_call` | Модель вызвала функцию |
| `blacklist` | Запрос попал под тематические ограничения GigaChat |
| `error` | Невалидные аргументы пользовательской функции |

`usage` - расход токенов по запросу (пригодится для отчёта об использовании):

| Поле | Что считает |
|---|---|
| `prompt_tokens` | Токены входящих сообщений |
| `completion_tokens` | Токены ответа модели |
| `precached_prompt_tokens` | Токены из кэша. Вычитаются из оплачиваемых |
| `total_tokens` | Итого к тарификации (уже за вычетом кэша) |

При `stream: true` объект `usage` приходит в предпоследнем событии потока.
