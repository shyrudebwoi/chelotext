# Контекст проекта «Челотекст» — руководство для ИИ-агентов

> **Актуально на 25.11.2026.** Этот файл — точка входа для следующего агента: здесь собраны
> архитектура, договорённости, состояние работ, грабли окружения и готовые плейбуки.
> Репозиторий: `https://github.com/shyrudebwoi/chelotext` (private, основная ветка `master`).
> Дополнительно: [README.md](../README.md), [architecture.md](./architecture.md),
> [decisions.md](./decisions.md), [HANDOFF.md](./HANDOFF.md), [TZ.md](./TZ.md), [design.md](./design.md).

---

## 0. Как пользоваться этим файлом

1. Сначала прочитайте разделы **1–3**: что за продукт, что нельзя ломать, как всё запускается.
2. Перед правкой конкретной области — соответствующий раздел (ядро, GigaChat, фронтенд, БД, деплой).
3. Перед коммитом — **17 (плейбуки)** и **18 (правила для агента)**.
4. Если что-то расходится с кодом — верьте коду; этот файл обновляйте в том же коммите.

---

## 1. Что это за продукт

**Челотекст** — PWA для массовой аудитории, которая делает длинный русский текст легче для чтения,
**не сокращая содержание**. Меняется только подача: абзацы, формулировки, структура.

Жёсткие инварианты (нарушение = баг уровня «не сдано»):

- Смысл, факты, имена, числа, даты и цитаты сохраняются **1:1**. Это не саммаризатор.
- Три независимых режима: **R1** — визуальное форматирование, **R2** — упрощение языка,
  **R3** — структурирование. Любая комбинация, включая один режим.
- Ползунок глубины **1…5**, по умолчанию 3.
- Вход: до **100 000 знаков**; PDF — **100 000 знаков или 50 страниц** (что раньше); файл до **25 МБ**.
- Согласие на обработку ПДн обязательно: без него защищённые API отдают **403**.
- Скан-PDF всегда обрабатывается **асинхронно** (OCR), с прогрессом и отменой.
- Бюджет ≈ 0: бесплатный GigaChat для физлиц, self-hosted Tesseract, никаких платных очередей.

---

## 2. TL;DR для агента

| Вопрос | Ответ |
|---|---|
| Стек | Node.js **>= 22.5**, Express 4, встроенный `node:sqlite`, in-process очередь, `tesseract.js`, `pdfjs-dist`, PWA |
| Точка входа | `server/index.js` → `npm start` (`node --no-warnings server/index.js`) |
| Порт | `127.0.0.1:3000` по умолчанию (`PORT`, `HOST`) |
| БД | `data/chelotext.sqlite` (WAL), миграции в `server/db/index.js` |
| Данные | `data/` (SQLite, tessdata, `.session-secret`), в git не попадают |
| LLM | GigaChat (`LLM_PROVIDER=gigachat`), запасные: `openai` (ProxyAPI), `ollama`, `rules` |
| Ключи | Только в `.env` на сервере; в коде/логах/ответах/документации их нет |
| Тесты | `npm test` — 140 тестов, `node:test`, без сети (GigaChat на мок-транспорте) |
| Eval | `npm run eval` — 18 эталонных текстов, проверка сохранности |
| Линт | `npm run lint` — синтаксис, запрет `console.log` в `server/`, обязательные файлы |
| Деплой | `deploy/` — Docker Compose; HTTPS и домен — в Nginx Proxy Manager |
| Ветка | `master`, remote `origin`, приватный GitHub-репозиторий |

**Windows-особенность:** в PowerShell вызывайте `npm.cmd`, а не `npm` (блокируется execution policy).
`gh` установлен в `C:\Program Files\GitHub CLI\gh.exe` и не всегда есть в PATH.

---

## 3. Стек и почему именно он

| Решение | Причина |
|---|---|
| Node 22 + `node:sqlite` | В рабочем окружении не было Python/Docker/PostgreSQL; `node:sqlite` убирает нативную зависимость и отдельный сервер БД |
| Один Express-процесс | SSR-страницы + JSON API + статика; проще деплой, меньше движущихся частей |
| In-process очередь | Длинные тексты и OCR не блокируют HTTP; при росте заменяется на внешний брокер без смены API |
| `tesseract.js` | Бесплатный self-hosted OCR, языки `rus+eng`, данные кладутся в `data/tessdata` |
| `pdfjs-dist` + `@napi-rs/canvas` | Текстовый слой PDF и рендер страниц для OCR |
| GigaChat | Бесплатные токены физлицам, хороший русский, OpenAI-совместимый `chat/completions` |
| PWA + service worker | Установка на телефон/десктоп; офлайн — только оболочка, обработка требует сети |

Осознанно **не используются**: Python, FastAPI, PostgreSQL, Redis, Celery, BullMQ, Docker в
рабочей конфигурации (Docker есть только как вариант деплоя в `deploy/`).

---

## 4. Карта репозитория

```text
chelotext/
├─ server/
│  ├─ index.js                 # Express, security headers, статика, /healthz, SSR-страницы, ошибки
│  ├─ config.js                # мини-загрузчик .env, все лимиты и настройки
│  ├─ render.js                # HTML-оболочка, иконки, иллюстрации, esc()
│  ├─ pages/index.js           # все SSR-страницы (лендинг, /app, история, настройки, legal)
│  ├─ db/index.js              # DatabaseSync, PRAGMA, миграции, q.* обёртки
│  ├─ middleware/index.js      # cookie-сессии, consent gate, rate limit, CSRF, CSP
│  ├─ lib/crypto.js            # scrypt-пароли, HMAC-подпись cookie, randomToken
│  ├─ lib/rateLimit.js         # in-memory rate limit
│  ├─ lib/regex.js             # общие регулярки
│  ├─ routes/auth.js           # регистрация, вход, согласие, удаление аккаунта
│  ├─ routes/process.js        # обработка paste/file/url, jobs, ревизии, экспорт
│  ├─ routes/history.js        # история документов, настройки хранения, purge
│  ├─ services/users.js        # пользователи, сессии, согласия
│  ├─ services/documents.js    # документы, задачи, ревизии, экспорт-лог, precheck-лог
│  ├─ services/ingest.js       # приём текста, лимиты, выбор sync/async, файлы, URL
│  ├─ jobs/queue.js            # очередь: приоритеты, прогресс, отмена, OCR
│  ├─ core/pipeline.js         # precheck → rules → LLM → integrity → AST
│  ├─ core/precheck.js         # блокировки (незаконное/плагиат), детект научного текста
│  ├─ core/rules/              # R1–R3, словари замен, статистика
│  ├─ core/text/ast.js         # единый AST: parse/plain/markdown/html
│  ├─ core/text/chunk.js       # чанкинг AST с перекрытием
│  ├─ core/llm/provider.js     # rules/ollama/openai/gigachat, circuit breaker, retry
│  ├─ core/llm/gigachat.js     # OAuth, токен-кэш, serial-очередь, TLS, redaction
│  ├─ core/llm/prompts.js      # системный и пользовательский промпты, PROMPT_VERSION
│  ├─ core/extract/            # paste/url/txt/docx/pdf/ocr
│  ├─ core/export/index.js     # TXT, MD, HTML, PDF, DOCX
│  ├─ core/integrity.js        # сверка чисел/дат/цитат/URL/имён
│  └─ core/diff.js             # построчный diff для редактора
├─ public/
│  ├─ styles/app.css           # дизайн-код, токены, компоненты, адаптив
│  ├─ js/app.js                # api(), toast, modal, setLoading, PWA-регистрация
│  ├─ js/pages/*.js            # клиентская логика страниц
│  ├─ sw.js                    # service worker, VERSION = chelotext-v2
│  ├─ manifest.webmanifest
│  ├─ fonts/                   # Manrope + Literata (woff2, локально)
│  └─ icons/
├─ deploy/                     # Dockerfile, docker-compose.yml, README для VDS
├─ docs/                       # TZ, PROMPT, design, context, architecture, decisions, HANDOFF
├─ api/                        # выжимки документации GigaChat и ProxyAPI (без ключей)
├─ eval/                       # run.js + 18 текстов; report.md генерируется и не коммитится
├─ test/                       # 140 тестов на node:test
├─ scripts/                    # check.js (lint), certs.js (CA), icons.js
├─ certs/                      # russian_trusted_root_ca.crt (в git не попадает)
├─ data/                       # SQLite, tessdata, .session-secret (в git не попадает)
├─ .env / .env.example         # рабочие настройки / заполненный шаблон
├─ .dockerignore / .gitignore
└─ package.json
```

---

## 5. Поток запроса

### 5.1 Обработка вставленного текста (синхронный путь)

```text
POST /api/process
  → requireAuth → requireConsent (403 без согласия)
  → checkCharLimit (413 при > MAX_CHARS)
  → precheck (422 при блокировке; текст не сохраняется)
  → ingestPaste (нормализация + документ)
  → если длина > SYNC_MAX_CHARS (12 000) → createJob(mode=async) + enqueueJob → 202
  → иначе createJob(mode=sync) → runPipeline → 200 с результатом
```

### 5.2 Файл / URL

- `POST /api/process/file` — multer в памяти, лимит `MAX_UPLOAD_BYTES`; формат определяется по
  расширению/MIME. PDF: сначала текстовый слой, если его нет — OCR через очередь.
- `POST /api/process/url` — загрузка страницы, извлечение основного текста (cheerio).
- Оба пути создают документ и задачу; длинные/сканы уходят в очередь.

### 5.3 Очередь

`server/jobs/queue.js`:

- Массив `queue`, приоритет `extract` (OCR) выше `process`.
- `running < JOB_CONCURRENCY` (по умолчанию 1), `ocrRunning < OCR_CONCURRENCY`.
- `AbortController` для отмены; `cancel_requested` в БД + runtime-canceller.
- После перезапуска процесса задачи в `processing` помечаются `failed` (`interrupted`) —
  внешнего брокера нет, автоперезапуск не делается.

### 5.4 Пайплайн

`server/core/pipeline.js`:

1. `precheck` — блокировки и определение научного текста.
2. `parsePlainText` → AST.
3. Движок правил R1–R3 (работает всегда, даже без модели).
4. LLM-проход по чанкам (если провайдер доступен).
5. `checkIntegrity(original, result)` — числа, даты, цитаты, URL, имена.
6. `readability` до/после, diff, финальный AST и текст.

`llm.used` выставляется **только** если хотя бы один чанк реально прошёл модель.
`llm.fallbackReason` объясняет, почему модель не использовалась/упала. Ошибка одного чанка
не валит задачу: чанк остаётся после правил.

---

## 6. Ядро обработки: детали

### 6.1 Precheck

- Блокирует незаконный контент и запросы «переписать чужой авторский текст целиком».
- Научные статьи **разрешены** (это отдельное требование ТЗ).
- Заблокированные попытки логируются в `precheck_log` (без сохранения полного текста).
- Коды ошибок отдаются клиенту (`422`), текст в БД не создаётся.

### 6.2 Движок правил R1–R3

- `server/core/rules/engine.js` + `dictionaries.js`.
- R1: разбиение длинных абзацев, заголовки, интервалы.
- R2: замена канцеляризмов, упрощение оборотов, дробление длинных предложений.
- R3: заголовки, списки, выделение главного.
- Работает без сети и без ключей; именно он даёт fallback.

### 6.3 LLM-проход

- Чанки по `LLM_CHUNK_CHARS` (3000) с перекрытием; таблицы и сноски сохраняются из оригинала.
- Промпты: `server/core/llm/prompts.js`, `PROMPT_VERSION = 2026-11-24.1`.
- Ответ с `finish_reason: length` отвергается (оборванный ответ).
- Если ответ пустой/не парсится — чанк остаётся после правил, `failed += 1`.

### 6.4 Контроль целостности

`server/core/integrity.js` сверяет:

- числа (кроме чисел внутри дат),
- даты (регистр не важен),
- цитаты в «…», “…” и "…",
- URL,
- имена/капитализированные слова (с эвристиками против заголовков предложений).

Возвращает `ok`, `score` (0…1), `missing`, `added`, `checked`. `ok` требует отсутствия потерь
и отсутствия **новых** чисел/дат. Это техническая гарантия «не соврать», но не полноценная
семантическая проверка.

### 6.5 AST и diff

- `server/core/text/ast.js` — единый AST блоков (параграф, заголовок, список, таблица, сноска,
  цитата и т. д.), функции `parsePlainText`, `astFromEditedText`, `astToPlainText`,
  `astToMarkdown`, `astToHtml`.
- `server/core/diff.js` — построчный diff; редактор показывает «Было / Стало» с подсветкой.

---

## 7. LLM-провайдеры и GigaChat

### 7.1 Выбор провайдера

`server/core/llm/provider.js`:

| `LLM_PROVIDER` | Поведение |
|---|---|
| `rules` | модель не вызывается, текст не уходит наружу |
| `ollama` | self-host, `LLM_BASE_URL` (по умолчанию `http://127.0.0.1:11434`), `/api/chat` |
| `openai` | OpenAI-совместимый (ProxyAPI), `LLM_BASE_URL`, `LLM_API_KEY` |
| `gigachat` | основной вариант, см. ниже |

Есть `CircuitBreaker`: 3 ошибки → пауза 60 сек. Ретраи с экспоненциальной паузой.

### 7.2 GigaChat: авторизация

- Два равнозначных варианта в `.env`:
  - `GIGACHAT_CRED` — готовый Authorization Key (Base64 от `Client ID:Client Secret`);
  - `GIGACHAT_CLIENT_ID` + `GIGACHAT_CLIENT_SECRET` — сервер сам собирает Basic.
- OAuth: `POST https://ngw.devices.sberbank.ru:9443/api/v2/oauth`
  - заголовки: `Authorization: Basic <ключ>`, `RqUID: <uuid4>`, `Content-Type: application/x-www-form-urlencoded`;
  - тело: `scope=GIGACHAT_API_PERS`;
  - ответ: `access_token`, `expires_at` (мс).
- Токен живёт **30 минут**. Кэш в памяти, обновление за `GIGACHAT_TOKEN_SKEW_MS` (60 000 мс)
  и один принудительный refresh при `401`.
- Модель: `POST https://api.giga.chat/v1/chat/completions`, `Authorization: Bearer <токен>`,
  обязательный `User-Agent` (без него `403`).

### 7.3 GigaChat: особенности

- **Один поток** у физлиц: параллельные запросы получают `429`. Внутри процесса все вызовы
  сериализуются через promise-очередь; `JOB_CONCURRENCY=1`.
- Повторы при `429/502/503/504` с backoff.
- `GIGACHAT_SCOPE`: `GIGACHAT_API_PERS` для физлиц, `GIGACHAT_API_B2B` / `GIGACHAT_API_CORP` для ИП/юрлиц.
- Модели: `GigaChat-2` по умолчанию; список — `GET https://api.giga.chat/v1/models`.
  При смене модели менять **обе** переменные: `GIGACHAT_MODEL` и `LLM_MODEL`.
- Бесплатные токены физлицам: 250 млн для `GigaChat-2` на 12 месяцев (условия могут меняться).
- **Сертификат:** нужен корневой PEM НУЦ Минцифры (`certs/russian_trusted_root_ca.crt`),
  скачивается `npm run certs` с `https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt`.
  Клиент добавляет PEM к `tls.rootCertificates`. **Проверку TLS отключать нельзя**
  (`rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, `verify=False` — запрещены).
- Секреты вырезаются из текста ошибок (`redact`), `/healthz` отдаёт только
  `configured` и `credentialSource`.

### 7.4 Реальный инцидент с ключом (важно)

Пользователь вписал все три поля. Готовый `GIGACHAT_CRED` декодировался в правильный Client ID,
но **другой Client Secret** (ключ устарел) → OAuth отвечал
`401 credentials doesn't match db data` на всех scope. Пара `GIGACHAT_CLIENT_ID` +
`GIGACHAT_CLIENT_SECRET` работала. Поле `GIGACHAT_CRED` очистили, сервер перезапустили.
После этого реальный запрос прошёл: токен получен, `chat/completions` ответил,
пайплайн дал `llm.used: true`, `integrity.ok: true`, `score: 1`, `fallbackReason: null`.

**Вывод для агента:** при `401` не крутите scope — сначала проверьте, что ключ и пара
принадлежат одному проекту/секрету; при утере ключа его нужно перевыпустить в кабинете.

### 7.5 ProxyAPI (запасной)

```dotenv
LLM_PROVIDER=openai
LLM_ENABLED=true
LLM_BASE_URL=https://api.proxyapi.ru
LLM_API_KEY=sk-...
LLM_MODEL=openai/gpt-5-mini
```

Адаптер сам добавляет `/v1/chat/completions`; суффикс `/v1` в `LLM_BASE_URL` не нужен.
ProxyAPI платный. Документация — `api/ProxyAPI_*.md`.

---

## 8. Данные и БД

`server/db/index.js`, SQLite в WAL, `foreign_keys=ON`, `busy_timeout=5000`.

| Таблица | Назначение |
|---|---|
| `users` | email, scrypt-хеш пароля, статус/дата/версия согласия, IP, срок хранения |
| `sessions` | id, user_id, expires_at, ip, user_agent |
| `consents` | журнал grant/revoke с версией политики и IP |
| `documents` | исходный текст, AST, источник, title, chars, pages, OCR-флаг/уверенность, soft delete |
| `jobs` | public_id, режим, статус, стадия, прогресс, результат, ошибки, integrity, LLM-метаданные |
| `edits` | ревизии результата (job_id + revision, уникально) |
| `exports` | лог скачиваний (формат, байты) |
| `precheck_log` | заблокированные попытки (код причины, короткий excerpt) |

- Пароли: **scrypt** (`N=16384, r=8, p=1`), формат `scrypt$N$r$p$salt$hash`.
- Cookie сессии: HttpOnly, SameSite=Lax, подпись HMAC; `Secure` при `SECURE_COOKIES=true`.
- Секрет сессий: `SESSION_SECRET` (>=16 символов) или авто `data/.session-secret` (0600).
- Удаление аккаунта/отзыв согласия удаляет данные каскадно.
- Ретеншн: `RETENTION_DAYS` (30 по умолчанию), purge вручную из настроек.

---

## 9. HTTP API

Все защищённые роуты требуют cookie-сессию; изменяющие — согласие и CSRF-проверку.
Ошибки — JSON `{ error, code, ... }`.

### Публичные

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/healthz` | статус, очередь, LLM (`provider`, `model`, `enabled`, `configured`, `credentialSource`), версия |
| GET | `/api/auth/me` | текущий пользователь, `consentRequired`, лимиты, LLM-флаг |
| POST | `/api/auth/register` | регистрация (email + пароль >= 8) |
| POST | `/api/auth/login` | вход |
| POST | `/api/auth/logout` | выход |

### Требуют авторизации

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/api/auth/consent` | `{action:'grant'|'revoke', policyVersion?}`; revoke удаляет данные |
| GET | `/api/auth/consent/history` | журнал согласий |
| DELETE | `/api/auth/account` | удаление аккаунта, body `{confirm:'УДАЛИТЬ'}` |
| POST | `/api/process` | текст + `options {r1,r2,r3,level}`; 200 sync / 202 async |
| POST | `/api/process/file` | multipart `file` (TXT/MD/DOCX/PDF) |
| POST | `/api/process/url` | `{url}` |
| GET | `/api/jobs` | список задач |
| GET | `/api/jobs/:id` | статус/результат задачи |
| POST | `/api/jobs/:id/cancel` | отмена |
| GET | `/api/documents/:id` | документ |
| GET | `/api/jobs/:id/revisions` | список ревизий |
| POST | `/api/jobs/:id/revisions` | сохранить правку |
| GET | `/api/jobs/:id/revisions/:revision` | конкретная ревизия |
| GET | `/api/jobs/:id/export/:format` | `txt|md|html|pdf|docx` |
| GET | `/api/jobs/:id/text` | текст результата |
| GET | `/api/documents` | история документов |
| DELETE | `/api/documents/:id` | soft delete документа |
| GET | `/api/settings` | согласие, ретеншн, LLM/OCR-инфо |
| POST | `/api/settings/retention` | `{days}` 1…365 |
| POST | `/api/settings/purge` | удалить старое сейчас |
| POST | `/api/settings/delete-data` | удалить данные |

> Мелкий нюанс: `GET /api/jobs` объявлен и в `routes/process.js`, и в `routes/history.js`.
> `processRouter` монтируется первым, поэтому обработчик из `history.js` фактически недостижим.
> При правках истории учитывайте это или уберите дубль.

### Страницы (SSR)

`/`, `/start`, `/login`, `/register`, `/app`, `/history`, `/jobs/:id`, `/settings`,
`/legal/privacy`, `/legal/terms`, `/legal/personal-data`.

---

## 10. Frontend: SSR, CSS, PWA

### 10.1 Общая схема

- Страницы рендерятся на сервере в `server/pages/index.js`, оболочка — `server/render.js`.
- Клиентская логика — модули в `public/js/pages/*.js`, общие утилиты — `public/js/app.js`.
- CSS — один файл `public/styles/app.css` с токенами дизайн-кода.
- Шрифты локальные: Manrope (UI), Literata (чтение), woff2.

### 10.2 Главный экран `/app`

С 25.11.2026 — двухколоночная рабочая область:

```text
┌──────────────────────────────┬─────────────────────┐
│ вкладки: текст / файл / ссылка│  Настройки          │
│ поле ввода / загрузка / URL  │  R1 / R2 / R3       │
│ счётчик знаков               │  ползунок 1…5       │
│                              │  Обработать         │
└──────────────────────────────┴─────────────────────┘
        прогресс / блокировка / результат — на всю ширину
```

- Классы: `.workspace`, `.workspace__source`, `.workspace__settings`.
- Сетка: `minmax(0,1fr) minmax(300px,340px)`, зазор 24 px.
- На десктопе карточка настроек `position: sticky; top: calc(64px + 16px)`.
- На ширине **≤900 px** колонки складываются, sticky отключается.
- Верхний отступ `/app`: 24 px; textarea — 9 строк; внутренние отступы настроек уплотнены.
- Кнопка «Обработать» — `#process-btn`, режимы — `data-mode="r1|r2|r3"`, ползунок — `#level`.

### 10.3 Результат и diff

- Вкладки «Сравнить / Редактор».
- `.diff` — grid из двух колонок; `.diff__head` («БЫЛО / СТАЛО») — **статичный**, не sticky:
  он является соседом скроллируемого `.diff__body`, и sticky-заголовок наезжал на текст.
- `.diff__body` — `max-height: 60vh; overflow-y: auto`.
- На мобильных колонки складываются, заголовки статичны.
- Подсветка: удалённое — красный фон + зачёркивание, добавленное — зелёный, главное — янтарный.

### 10.4 PWA и кэш

- `public/sw.js`, `VERSION = 'chelotext-v2'`.
- Precache: CSS, `app.js`, иконки, манифест, часть шрифтов.
- Стратегии: статика — cache-first; навигация — network-first с офлайн-заглушкой; `/api/*` — **никогда** не кэшируется.
- `skipWaiting()` + `clients.claim()`.
- `/sw.js` отдаётся с `Cache-Control: no-cache, no-store, must-revalidate` (иначе обновление
  статики застревает до часа).
- **При изменении CSS/JS обязательно поднимайте `VERSION`** — иначе установленные PWA
  продолжат отдавать старый кэш.

### 10.5 Доступность и адаптив

- Крупные тач-цели (>=44 px), `:focus-visible`, `aria-*` у переключателей и вкладок.
- `prefers-reduced-motion` отключает анимации.
- Тёмная тема: в CSS есть `prefers-color-scheme`, но решение по ней ещё не подтверждено.
- Ручной смоук мобильного редактора и скринридера **ещё не проводился**.

---

## 11. Конфигурация и секреты

### 11.1 Файлы

- `.env.example` — полностью заполненный шаблон; пусты **только** три поля доступа GigaChat.
- `.env` — рабочие настройки, в git не попадает (`.gitignore`). Docker Compose читает этот же файл.
- `.gitignore`: `.env`, `data/`, `tmp/`, `certs/*.crt`, `certs/*.pem`, `*.log`, `node_modules/`,
  `eval/report.md`, `coverage/`, `NUL`.
- `.dockerignore`: `.env*`, `data`, `node_modules`, `certs/*.crt`, `docs/`, `test/`, `eval/`, `api/`, `.git` и т. д.

### 11.2 Ключевые переменные

| Группа | Переменные |
|---|---|
| Сервер | `NODE_ENV`, `PORT=3000`, `HOST=127.0.0.1`, `SESSION_SECRET=`, `SECURE_COOKIES=false`, `TRUST_PROXY=false` |
| Хранилище | `DATA_DIR=data`, `DB_FILE` (опционально), `RETENTION_DAYS=30` |
| Лимиты | `MAX_CHARS=100000`, `MAX_PDF_PAGES=50`, `MAX_UPLOAD_BYTES=26214400` |
| Очередь | `SYNC_MAX_CHARS=12000`, `SYNC_MAX_MS=55000`, `JOB_CONCURRENCY=1`, `OCR_CONCURRENCY=1` |
| Rate limit | `RL_LOGIN_PER_HOUR=10`, `RL_REGISTER_PER_HOUR=5`, `RL_PROCESS_PER_HOUR=30`, `RL_UPLOAD_PER_HOUR=20`, `RL_GLOBAL_PER_MINUTE=240` |
| LLM | `LLM_PROVIDER=gigachat`, `LLM_ENABLED=true`, `LLM_MODEL=GigaChat-2`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_TIMEOUT_MS=45000`, `LLM_MAX_RETRIES=2`, `LLM_MAX_TOKENS=4096`, `LLM_CHUNK_CHARS=3000`, `LLM_TEMPERATURE=0.2` |
| GigaChat | `GIGACHAT_CRED`, `GIGACHAT_CLIENT_ID`, `GIGACHAT_CLIENT_SECRET`, `GIGACHAT_SCOPE=GIGACHAT_API_PERS`, `GIGACHAT_MODEL=GigaChat-2`, `GIGACHAT_API_URL=https://api.giga.chat/v1`, `GIGACHAT_OAUTH_URL=https://ngw.devices.sberbank.ru:9443/api/v2/oauth`, `GIGACHAT_USER_AGENT=chelotext/1.0`, `GIGACHAT_TOKEN_SKEW_MS=60000`, `GIGACHAT_CA_FILE=certs/russian_trusted_root_ca.crt` |
| OCR | `OCR_ENABLED=true`, `OCR_LANGS=rus+eng`, `OCR_DPI=200`, `OCR_MIN_CONFIDENCE=60` |
| Юридическое | `POLICY_VERSION`, `OPERATOR_NAME`, `OPERATOR_EMAIL` |

### 11.3 Правила секретов

- Ключи вписывает **только пользователь** в `.env`; агент не просит их в чате и не выводит.
- В коде, логах, ответах API, документации, скриншотах и коммитах секретов быть не должно.
- `/healthz` показывает только факт наличия ключа (`configured`) и источник (`credentialSource`).
- При утечке ключ нужно **аннулировать в кабинете**; удаления из `.env` недостаточно.
- Тесты и eval принудительно используют `rules`, чтобы локальный `.env` не влиял на результат.

---

## 12. Тесты, eval, линт

```bash
npm.cmd test          # 140 тестов, node:test, ~2.5 c
npm.cmd run eval      # 18 текстов, отчёт eval/report.md, exit 1 при потере сущностей
npm.cmd run lint      # синтаксис всех JS, запрет console.log в server/, обязательные файлы
npm.cmd run certs     # скачать корневой PEM НУЦ Минцифры
npm.cmd start         # сервер
npm.cmd run dev       # сервер с --watch
```

- `npm test` покрывает: правила, regex, precheck, pipeline, лимиты, integrity, GigaChat
  (мок-транспорт), e2e на временной БД, diff, AST.
- `npm run eval -- --levels` — уровни 1/3/5; `--json` — машинный вывод; `--text=05` — фильтр.
- Eval проверяет сохранность сущностей и объём **движка правил**, не LLM-прохода.
- После правок ядра/провайдера всегда прогоняйте `test` + `lint`; после правок правил — ещё `eval`.

---

## 13. Деплой на VDS

Комплект в `deploy/`, подробная инструкция — [deploy/README.md](../deploy/README.md).

### 13.1 Файлы

| Файл | Назначение |
|---|---|
| `Dockerfile` | `node:22-bookworm-slim`, `npm ci --omit=dev`, только `server/` и `public/`, non-root `chelotext`, healthcheck |
| `docker-compose.yml` | `env_file: ../.env`, volume `chelotext-data:/app/data`, `../certs:/app/certs:ro`, хост-порт `${APP_PORT:-3000}:3000` |
| `README.md` | окружение, сертификат НУЦ Минцифры, Nginx Proxy Manager, обновление, бэкап, диагностика |

### 13.2 Команды

```bash
cp .env.example .env                 # вписать только ключи GigaChat
mkdir -p certs && curl -fsSL \
  https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt \
  -o certs/russian_trusted_root_ca.crt

docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml ps
curl -s http://127.0.0.1:3000/healthz

# обновление
git pull
docker compose -f deploy/docker-compose.yml up -d --build
```

- Приложение слушает `0.0.0.0:3000`; наружу его публикует Nginx Proxy Manager
  (Proxy Host → `172.17.0.1:3000`, затем Let's Encrypt и Force SSL).
- `SECURE_COOKIES=true` требует HTTPS; `TRUST_PROXY=true` включает доверие `X-Forwarded-*`.
- `data/` заменён на volume `chelotext-data`: переживает перезапуск и `docker compose down`;
  `down -v` удаляет. Бэкап — `tar` содержимого volume (команда в `deploy/README.md`).
- Сертификат НУЦ Минцифры скачивается на хост и монтируется read-only.
- Приватный репозиторий: deploy key (рекомендуется) или PAT; токен не коммитить.
- Порт 3000 при публичном IP стоит закрыть файрволом: снаружи — только NPM на 80/443.

---

## 14. Рабочие грабли

### 14.1 Windows / PowerShell

- `npm` может блокироваться execution policy → используйте **`npm.cmd`**.
- Кириллица в консоли ломается (cp866). Для длинного вывода пишите в файл и читайте через `read`.
- `curl.exe` — не `curl` (в PowerShell это алиас `Invoke-WebRequest`).
- `-o NUL` создаёт файл `NUL`; используйте `-o $null` или `Out-Null`.
- Порт 3000 может быть занят предыдущим сервером:
  `Get-NetTCPConnection -LocalPort 3000 -State Listen` → `Stop-Process`.
- `gh` не в PATH: `& 'C:\Program Files\GitHub CLI\gh.exe' ...`.
- Git предупреждает про LF→CRLF — это нормально; в репозитории LF, на Linux клон получит LF.

### 14.2 Node / приложение

- `node:sqlite` требует Node **>= 22.5**; на старом Node приложение не стартует.
- `.env` читается только при старте — после правки ключей **перезапустите сервер**.
- Очередь в памяти: после падения/перезапуска `processing`-задачи становятся `failed`.
- `data/tessdata` заполняется из `node_modules/@tesseract.js-data/*` при первом OCR.
- PDF-экспорт ищет TTF: Literata TTF в репозитории нет, поэтому на Windows берётся Georgia,
  на Linux — DejaVu. Для идеального PDF можно положить TTF в `public/fonts`.
- E2E-тесты используют временную БД; рабочую `data/chelotext.sqlite` не трогают.

### 14.3 Кэш и фронтенд

- После правки `public/styles` или `public/js` поднимайте `VERSION` в `public/sw.js`.
- Если браузер показывает старое — `Ctrl+F5` или удалить service worker в DevTools.
- `/sw.js` теперь не кэшируется, но старый SW мог быть установлен до этой правки.
- CSP запрещает inline-скрипты (`script-src 'self'`); inline-стили разрешены.
- `fetch`-запросы из клиента идут с `X-Requested-With: fetch`; CSRF проверяет Origin.

---

## 15. Текущее состояние

### 15.1 Готово

- Backend: auth, consent gate, документы, задачи, ревизии, экспорт, настройки, purge.
- Ядро: precheck, R1–R3, AST, chunking, GigaChat/ProxyAPI/Ollama/rules, integrity, diff.
- Извлечение: paste, URL, TXT/MD, DOCX, PDF (текстовый слой + OCR), лимиты.
- Экспорт: TXT, MD, HTML, PDF, DOCX.
- Frontend: SSR-страницы, PWA, адаптив, двухколоночный `/app`, редактор, история, настройки.
- GigaChat реально проверен: OAuth, `chat/completions`, пайплайн с `llm.used: true`.
- Тесты 140/140, eval 18/18, lint OK.
- Документация: README, architecture, decisions (ADR-001…011), HANDOFF, context.
- Деплой: Docker Compose (`deploy/`), HTTPS и домен — в Nginx Proxy Manager; пошаговая инструкция в `deploy/README.md`.
- Репозиторий: приватный GitHub, ветка `master`, актуальный список коммитов — `git log --oneline`.

### 15.2 Осталось / не проверено вручную

1. **Ручной смоук мобильного редактора (≤768 px)** и проход клавиатурой/скринридером.
2. Проверка 404/500 и офлайн-страницы в реальном браузере.
3. Опционально: `npm run eval -- --levels` для отчёта о деградации на глубине 5.
4. Подтвердить решение по тёмной теме (CSS уже частично поддерживает).
5. Заменить юридические заглушки (`OPERATOR_NAME`, `OPERATOR_EMAIL`, тексты политики) на реальные.
6. Живой деплой на VDS: комплект готов, но на сервере ещё не разворачивался.

### 15.3 Известные ограничения

- Модель может сокращать объём сильнее движка правил; eval это не ловит (он про rules).
- Integrity проверяет сущности, но не полную семантику.
- EPUB не поддерживается (в ТЗ был «в очереди»); принимаются TXT/MD/DOCX/PDF.
- Офлайн — только оболочка; обработка текста без сети невозможна.
- Один поток GigaChat у физлиц; при нескольких процессах у каждого своя очередь.
- Очередь не переживает перезапуск.
- Визуальный нюанс правил: «г.» в начале абзаца может стать «Г.».

---

## 16. Журнал ключевых решений (ADR)

Полные тексты — в [decisions.md](./decisions.md). Кратко:

| ADR | Решение |
|---|---|
| 001 | Node 22 + Express + `node:sqlite` вместо Python/PostgreSQL/Celery |
| 002 | Один процесс + in-process очередь вместо Redis/BullMQ |
| 003 | Единый AST и детерминированные правила R1–R3 |
| 004 | Гибрид «правила → LLM → integrity» с fallback на правила |
| 005 | Локальные шрифты и PWA без внешних CDN |
| 006 | Consent gate 403 и удаление данных при отзыве |
| 007 | Экспорт TXT/MD/HTML/PDF/DOCX через единый интерфейс |
| 008 | Регистрация service worker без ожидания `load` |
| 009 | GigaChat — основной провайдер для физлиц |
| 010 | Никаких секретов в репозитории; `/healthz` без значений |
| 011 | Деплой на VDS: Docker Compose + внешний Nginx Proxy Manager, volume `chelotext-data` |

---

## 17. Плейбуки для агента

### 17.1 Изменить UI `/app`

1. Разметка — `server/pages/index.js`, функция `appPage`.
2. Стили — `public/styles/app.css`, блок `.workspace` и адаптив `@media (max-width: 900px)`.
3. Клиентская логика — `public/js/pages/editor.js` (id элементов не менять без правки JS).
4. Поднять `VERSION` в `public/sw.js`.
5. Проверить в браузере: десктоп + ≤900 px, клавиатура, консоль без ошибок.
6. `npm.cmd run lint && npm.cmd test`.

### 17.2 Добавить/сменить LLM-провайдера

1. Реализуйте класс в `server/core/llm/provider.js` (или отдельный файл) с `name`, `available`, `generate`.
2. Добавьте ветку в `createProvider()` и `providerInfo()`.
3. Не раскрывайте ключ в `providerInfo`/`/healthz`.
4. Добавьте тесты с мок-транспортом, без сети.
5. Обновите `.env.example`, README, context; проверьте `deploy/docker-compose.yml` и `deploy/README.md`.

### 17.3 Обновить статику/PWA

1. Измените CSS/JS.
2. Поднимите `VERSION` в `public/sw.js` (например, `chelotext-v3`).
3. Убедитесь, что `/sw.js` отдаётся с `no-cache` (уже настроено в `server/index.js`).
4. Проверьте: DevTools → Application → Service Workers → Update; `Ctrl+F5`.

### 17.4 Ротация ключа GigaChat

1. Пользователь перевыпускает ключ в Студии Сбера.
2. В `.env` заполняет **один** вариант: `GIGACHAT_CRED` или пару ID+Secret.
3. Перезапуск сервера.
4. `curl.exe -s http://127.0.0.1:3000/healthz` → `configured: true`.
5. Учебный текст через `/app` с R2 → `llm.used: true`, `integrity.ok: true`.
6. Старый ключ аннулировать в кабинете.

### 17.5 Диагностика GigaChat

| Симптом | Действие |
|---|---|
| `configured:false` | ключ не в `.env`, пробелы/кавычки, сервер не перезапущен |
| `401 credentials doesn't match db data` | ключ устарел/не от того проекта; используйте пару ID+Secret или перевыпустите |
| `certificate verify failed` | нет `certs/russian_trusted_root_ca.crt`; `npm run certs`; TLS не отключать |
| `403` от `api.giga.chat` | нет `User-Agent`; проверьте `GIGACHAT_USER_AGENT` |
| `429` | параллельные запросы; `JOB_CONCURRENCY=1`, клиент сам повторит |
| `402` | кончились токены; кабинет/тариф |
| `finish_reason: length` | ответ оборван; уменьшите `LLM_MAX_TOKENS`/чанк, блок останется после правил |

### 17.6 Деплой/обновление VDS

1. `git pull`.
2. `docker compose -f deploy/docker-compose.yml up -d --build`.
3. Проверить `docker compose -f deploy/docker-compose.yml ps` и `/healthz`.
4. Перед обновлением — бэкап volume `chelotext-data` (команда в `deploy/README.md`).
5. После изменения `.env` — `docker compose -f deploy/docker-compose.yml up -d --force-recreate`.

---

## 18. Правила для следующего агента

1. **Не ломайте инварианты** из раздела 1: смысл/факты/числа/даты/цитаты 1:1, R1–R3 независимы,
   лимиты 100 000/50 страниц, consent gate 403, скан-PDF async.
2. **Секреты:** не просите и не выводите ключи; не пишите их в код/логи/доки/коммиты.
   Для проверки используйте `configured`/`credentialSource` и учебные тексты.
3. **TLS:** никогда не отключайте проверку сертификатов; добавляйте PEM НУЦ Минцифры.
4. **Комментарии:** пишите по-русски, только там, где решение неочевидно (почему, а не что).
   В `server/` запрещён `console.log` (проверяется линтом).
5. **Стиль:** 2 пробела, ES-модули, одинарные кавычки, точка с запятой; следуйте окружающему коду.
6. **Тесты:** после правок ядра — `npm.cmd test`; после правил — ещё `npm.cmd run eval`;
   перед коммитом — `npm.cmd run lint`.
7. **Статика:** меняете CSS/JS — поднимайте `VERSION` в `public/sw.js`.
8. **Документация:** обновляйте README/context/HANDOFF в том же коммите, если меняете поведение.
9. **Git:** не коммитьте `.env`, `data/`, `certs/*.crt`, `node_modules/`, `eval/report.md`.
   Коммит-сообщения — по-русски, содержательные.
10. **Проверка UI:** можно использовать browse (Chrome пользователя) или in-app browser;
    для тестового аккаунта удаляйте его после проверки.
11. **Не переписывайте чужие изменения** без понимания: сначала `git status`, `git log`, чтение кода.
12. **Не обещайте живой деплой**, если нет доступа к VDS; комплект в `deploy/` — это подготовка.

---

## 19. История проекта: интервью и решения

### 19.1 Формулировка задачи

Спроектировать веб-приложение «Челотекст», которое **меняет подачу текста, но сохраняет смысл,
факты, имена и цифры**. Сначала — интервью из 10 уточняющих вопросов, затем ТЗ; код на этапе ТЗ
не писался.

### 19.2 Интервью (23.11.2026)

| # | Тема | Ответ пользователя | Решение |
|---|---|---|---|
| 1 | Аудитория | B | Массовая аудитория читателей длинных текстов, русский язык MVP |
| 2 | Проблема | D | Плотный текст + сложный язык + нет структуры; содержание не сокращается |
| 3 | Сценарии | Все три | Копипаст (приоритет), ссылка, файлы |
| 4 | Функции | D + ползунок | R1 + R2 + R3 независимо, глубина 1…5 |
| 5 | Объёмы | 100 000 знаков | Вход до 100 000; выход: экран, копирование, скачивание, diff |
| 5.1 | Форматы | Все | TXT, PDF, Markdown обязательны; DOCX, HTML — по возможности |
| 5.2 | Редактор | Да | Встроенный редактор результата с сохранением правок |
| 5.3 | Параллельный вид | Сразу | Diff в MVP |
| 6 | Скорость/бюджет | B/C, бесплатно | До ~60 сек sync, длинные — очередь; бесплатные LLM/self-host |
| 7 | Безопасность | Аккаунты + история + ПДн | Consent gate, отзыв согласия → удаление |
| 7.1 | Предпроверка | Да | Блокировать незаконное/чужой авторский текст; научные статьи разрешены |
| 8 | Дизайн | По design.md | Дизайн-код версии 1.0 |
| 9 | Мобильная версия | Адаптив | Перестройка diff, компактные настройки, крупные тач-цели |
| 10 | Контекст | Вести context.md | Этот файл |

### 19.3 Второй раунд: PDF и OCR (23.11.2026)

| # | Тема | Ответ | Решение |
|---|---|---|---|
| P1 | Типы PDF | И текстовые, и сканы | Текстовый слой — напрямую; скан — Tesseract; смешанные — постранично |
| P2 | Качество/скорость | Асинхронно + предупреждение | Скан всегда в очередь, предупреждение OCR, автооткрытие в редакторе |
| P3 | Структура | Максимально сохранить | Таблицы → Markdown, колонки по порядку чтения, колонтитулы вырезать, сноски списком |
| P4 | Языки/лимиты | rus+eng; 100 000 или 50 страниц | Tesseract `rus+eng`, лимит PDF 100 000 знаков ИЛИ 50 страниц |

### 19.4 Третий раунд: GigaChat (25.11.2026)

| Тема | Решение |
|---|---|
| Провайдер | GigaChat API (Сбер), бесплатные токены физлицам, русский язык |
| Авторизация | `GIGACHAT_CRED` **или** `GIGACHAT_CLIENT_ID` + `GIGACHAT_CLIENT_SECRET` |
| Токен | 30 минут, кэш, refresh за 60 сек и при 401, `RqUID` на каждый запрос |
| Адреса | OAuth `ngw.devices.sberbank.ru:9443`, API `api.giga.chat/v1` |
| Сертификат | PEM НУЦ Минцифры, TLS не отключать |
| Параллелизм | 1 поток, serial-очередь, backoff на 429/502/503/504 |
| Безопасность | Секреты только в `.env`, redaction в ошибках, `/healthz` без значений |
| Fallback | Без ключа/при ошибке — движок правил, причина в `llm.fallbackReason` |
| ProxyAPI | Платный OpenAI-совместимый запасной вариант |

### 19.5 Четвёртый раунд: интерфейс и VDS (25.11.2026)

- Настройки и ползунок перенесены в правую колонку от поля ввода; интерфейс уплотнён.
- Исправлено наложение «БЫЛО / СТАЛО» на текст в diff (удалён sticky-заголовок).
- Добавлен комплект деплоя на VDS; позже упрощён до Docker Compose + Nginx Proxy Manager.
- Поднята версия SW-кэша, `/sw.js` отдаётся без кэша.

---

## 20. Журнал изменений

- **23.11.2026** — интервью (10 тем), созданы `TZ.md`, `context.md`, заготовка `design.md`.
- **23.11.2026** — второй раунд: PDF + Tesseract OCR (`rus+eng`, лимит 100К/50 стр.,
  сохранение структуры, async, предупреждение OCR). Обновлены `TZ.md` (4.1.1, 4.3.1, 5).
- **24.11.2026** — создан `PROMPT.md`.
- **24.11.2026** — заполнен `design.md` v1.0: Teal `#0F766E`, Amber `#C2701A`, Ink `#1B1E23`,
  Manrope + Literata, шкала 8 px, крупные кнопки, компоненты, экраны, a11y, tone of voice.
- **25.11.2026** — закрыты PWA и eval-выборка (18/18), добавлены `scripts/check.js`,
  `.gitignore`, README/architecture/decisions.
- **25.11.2026** — подключён GigaChat: провайдер, токен-кэш, serial-очередь, сертификат,
  безопасный `.env`, `npm run certs`, 7 тестов, fallback на правила.
- **25.11.2026** — реальная проверка GigaChat: найден устаревший `GIGACHAT_CRED`, поле очищено,
  работает пара Client ID + Secret; OAuth и `chat/completions` прошли, integrity OK.
- **25.11.2026** — `/app` стал двухколоночным, интерфейс уплотнён; добавлен `deploy/`
  (Docker, systemd, nginx, certbot, бэкапы); опубликовано в приватный GitHub.
- **25.11.2026** — исправлено наложение заголовков diff на текст; `sw.js` без кэша,
  версия кэша `chelotext-v2`.
- **25.11.2026** — этот файл переписан как полное руководство для следующих ИИ-агентов.
- **25.11.2026** — `deploy/` упрощён до `Dockerfile` + `docker-compose.yml` + `README.md`:
  удалены nginx-конфиг, systemd-юнит, `deploy.sh` и production-шаблон `.env`; TLS и домен
  настраиваются в Nginx Proxy Manager, данные — в volume `chelotext-data`, образ собирается
  только с production-зависимостями.
