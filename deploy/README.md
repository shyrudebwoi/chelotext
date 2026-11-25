# Деплой Челотекста через Docker Compose

Минимальный комплект: `Dockerfile` + `docker-compose.yml`. Всё остальное — на вашей стороне:
Docker, домен, HTTPS и проксирование через Nginx Proxy Manager (NPM).

Приложение работает в одном контейнере, слушает HTTP-порт **3000**, данные лежат в Docker volume.
Никаких nginx-конфигов, certbot и systemd-юнитов здесь нет.

---

## Что нужно на сервере

- Docker Engine с плагином Compose (`docker compose version`).
- Git и доступ к приватному репозиторию `shyrudebwoi/chelotext`.
- Свободный порт `3000` (или задайте другой хост-порт через `APP_PORT`).
- Работающий Nginx Proxy Manager, который будет отдавать домен и TLS.

---

## 1. Код и окружение

```bash
git clone git@github.com:shyrudebwoi/chelotext.git /opt/chelotext
cd /opt/chelotext

cp .env.example .env
chmod 600 .env
nano .env
```

В `.env` заполните **только** доступ к GigaChat — один из вариантов:

```dotenv
GIGACHAT_CLIENT_ID=...
GIGACHAT_CLIENT_SECRET=...
# либо
GIGACHAT_CRED=...
```

`NODE_ENV`, `HOST`, `PORT`, `SECURE_COOKIES` и `TRUST_PROXY` из `.env` переопределяются
в `docker-compose.yml`, поэтому менять их не нужно. Остальные значения шаблона рабочие.

---

## 2. Сертификат НУЦ Минцифры

GigaChat использует сертификат, которого нет в стандартном наборе. Проверку TLS отключать нельзя,
поэтому скачайте корневой PEM на хост — контейнер смонтирует его read-only:

```bash
mkdir -p certs
curl -fsSL https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt \
  -o certs/russian_trusted_root_ca.crt
ls -l certs/russian_trusted_root_ca.crt
```

---

## 3. Запуск

Из корня репозитория:

```bash
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml ps
curl -s http://127.0.0.1:3000/healthz
```

В ответе `/healthz` должно быть:

```json
{"ok":true,"llm":{"provider":"gigachat","enabled":true,"configured":true,"credentialSource":"client id + client secret"},...}
```

`configured:false` — ключ не подхватился: проверьте `.env` и пересоздайте контейнер
(`docker compose -f deploy/docker-compose.yml up -d --force-recreate`).

Первый запуск собирает образ: ставятся только production-зависимости (`npm ci --omit=dev`),
это может занять несколько минут.

---

## 4. Nginx Proxy Manager

Создайте **Proxy Host**:

| Поле | Значение |
|---|---|
| Domain Names | ваш домен, например `chelotext.example.com` |
| Scheme | `http` |
| Forward Hostname / IP | IP хоста в Docker-сети — обычно `172.17.0.1` |
| Forward Port | `3000` (или ваш `APP_PORT`) |
| Block Common Exploits | включить |

Во вкладке **SSL** выберите «Request a new SSL Certificate», включите **Force SSL**
(и HTTP/2, если хотите). WebSockets приложению не нужны.

Если NPM запущен не в контейнере, а на хосте, укажите `127.0.0.1`. Если NPM в контейнере и
`172.17.0.1` не подходит, используйте `host.docker.internal` (на Linux добавьте NPM
`extra_hosts: ["host.docker.internal:host-gateway"]`) или подключите оба контейнера к одной сети.

Проверьте `https://chelotext.example.com/healthz`.

> Порт `3000` опубликован на все интерфейсы, чтобы NPM мог до него достучаться. Если сервер
> смотрит в интернет, закройте `3000` файрволом (цепочка `DOCKER-USER`) — наружу должен
> смотреть только NPM на 80/443.

---

## 5. Обновление

```bash
cd /opt/chelotext
git pull
docker compose -f deploy/docker-compose.yml up -d --build
```

После изменения `.env`:

```bash
docker compose -f deploy/docker-compose.yml up -d --force-recreate
```

Логи и перезапуск:

```bash
docker compose -f deploy/docker-compose.yml logs -f app
docker compose -f deploy/docker-compose.yml restart app
```

---

## 6. Данные и бэкап

SQLite, секрет сессий и языковые данные OCR лежат в volume `chelotext-data`.
`docker compose down` данные **не удаляет**; `down -v` — удаляет.

Бэкап:

```bash
docker run --rm \
  -v chelotext-data:/data \
  -v "$PWD":/backup \
  alpine tar czf /backup/chelotext-data-$(date +%F).tar.gz -C /data .
```

Восстановление (контейнер должен быть остановлен):

```bash
docker compose -f deploy/docker-compose.yml stop app
docker run --rm \
  -v chelotext-data:/data \
  -v "$PWD":/backup \
  alpine sh -c 'rm -rf /data/* && tar xzf /backup/chelotext-data-YYYY-MM-DD.tar.gz -C /data'
docker compose -f deploy/docker-compose.yml start app
```

---

## 7. Если что-то не работает

| Симптом | Что проверить |
|---|---|
| `configured:false` в `/healthz` | ключ в `.env`, нет кавычек/пробелов вокруг `=`, контейнер пересоздан |
| `401 credentials doesn't match db data` | ключ устарел или от другого проекта: используйте пару Client ID + Secret либо перевыпустите ключ |
| `certificate verify failed` | нет `certs/russian_trusted_root_ca.crt` или он не смонтирован; повторите шаг 2 |
| NPM отдаёт `502 Bad Gateway` | контейнер не запущен или NPM не видит порт: `docker compose ... ps`, `docker compose ... logs app`, проверьте `172.17.0.1:3000` |
| `413 Request Entity Too Large` | в NPM → Advanced добавьте `client_max_body_size 26m;` (лимит приложения — 25 МБ) |
| Не сохраняется вход | сайт открыт по HTTP или NPM не передаёт `X-Forwarded-Proto`; включите Force SSL |
| Порт `3000` занят | задайте другой хост-порт: `APP_PORT=3100 docker compose ... up -d` и укажите `3100` в NPM |

Секреты остаются только в `.env` на сервере: они не попадают ни в git, ни в образ
(`.gitignore`, `.dockerignore`). Подробности по GigaChat — в [../api/README.md](../api/README.md).
