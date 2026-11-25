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

Для приватного репозитория заранее настройте SSH-ключ (deploy key) или используйте
Personal Access Token. Токен не коммитьте и не передавайте в чат.

В `.env` заполните **только** доступ к GigaChat — один из вариантов:

```dotenv
GIGACHAT_CLIENT_ID=...
GIGACHAT_CLIENT_SECRET=...
# либо
GIGACHAT_CRED=...
```

`NODE_ENV`, `HOST`, `PORT`, `SECURE_COOKIES` и `TRUST_PROXY` из `.env` переопределяются
в `docker-compose.yml`, поэтому менять их не нужно. Остальные значения шаблона рабочие.

### Бот ВКонтакте (необязательно)

Чтобы подключить бота сообщества, добавьте в тот же `.env`:

```dotenv
VK_BOT_ENABLED=true
VK_BOT_GROUP_ID=123456789
VK_BOT_TOKEN=...
VK_BOT_ADMIN_IDS=11111111,22222222
```

Ключ создаётся в сообществе: **Управление → Работа с API → Ключи доступа** с правом
**«Сообщения сообщества»**; на вкладке **Long Poll API** включите событие `message_new`.
Вписывайте ключ только в `.env` на сервере — не в чат и не в git. После правки:

```bash
docker compose -f deploy/docker-compose.yml up -d --force-recreate
docker compose -f deploy/docker-compose.yml logs -f app   # ждём «VK-бот: Long Poll запущен»
```

Команды бота и формат отчёта — в [../README.md](../README.md#бот-вконтакте).

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

## 5. Передеплой после изменений в GitHub

### 0. Перед обновлением — проверьте диск

Из-за заполненного диска SQLite не может открыть WAL: контейнер уходит в `Restarting (1)`,
а в логах появляется `disk I/O error` / `SQLITE_IOERR_SHMSIZE` (`errcode: 4874`).

```bash
df -h / /var/lib/docker
```

Нужно хотя бы ~500 МБ свободно: последние 5% файловой системы зарезервированы под root,
а приложение работает от uid `10001` и эти резервы не видит. Если места мало — чистите
**без удаления volume**:

```bash
docker builder prune -f          # build-cache после --build — обычно самый большой
docker image prune -f            # только dangling-образы
docker container prune -f        # только остановленные контейнеры
journalctl --vacuum-size=200M
apt-get clean
```

⚠️ Никогда не добавляйте `docker system prune -a --volumes` и `docker volume prune`:
вместе с мусором удалится `chelotext-data` — база, секрет сессий и данные OCR.

Чтобы диск не заполнялся снова, ограничьте логи Docker в `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
```

После правки выполните `systemctl restart docker` — контейнеры с `restart: unless-stopped`
поднимутся сами. Watchtower тоже может копить слои: если он не должен обновлять приложение,
добавьте в `docker-compose.yml` метку `com.centurylinklabs.watchtower.enable: "false"`.

### 1. Подтянуть код

```bash
cd /opt/chelotext               # или ваш путь, например /proj/chelotext
git status --short              # локальных правок быть не должно
git pull --ff-only
git log -1 --oneline            # убедились, что приехал нужный коммит
```

`.env`, `certs/` и `chelotext-data` в git не попадают и при `git pull` не трогаются.

### 2. Пересобрать и пересоздать

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

Если менялся `.env` или нужно заново применить те же значения — добавьте `--force-recreate`:

```bash
docker compose -f deploy/docker-compose.yml up -d --build --force-recreate
```

Если контейнер перед этим был остановлен и удалён (`docker rm` / `container prune`),
используйте именно `up -d` — команда `docker compose start app` в этом случае ничего не найдёт.

Если `up` падает с `Conflict. The container name "/..._chelotext" is already in use` —
мешает старый контейнер из другого Compose-проекта или деплой-инструмента. `--remove-orphans`
здесь не поможет: удалите только его:

```bash
docker ps -a --filter "name=chelotext"
docker rm -f <CONTAINER_ID>
docker compose -f deploy/docker-compose.yml up -d --build
```

Данные при этом сохраняются: SQLite лежит в именованном volume `chelotext-data`.

### 3. Проверить результат

```bash
docker compose -f deploy/docker-compose.yml ps
docker compose -f deploy/docker-compose.yml logs -f --tail=50 app
curl -fsS http://127.0.0.1:3000/healthz
```

Успех: `Up ... (healthy)`, в логах `Челотекст запущен` и `VK-бот: Long Poll запущен`,
в `/healthz` — `configured:true`, а домен через NPM не отдаёт `502`.
Статус `health: starting` сразу после старта — нормально (`start_period: 20s`, `interval: 30s`).

### Откат

```bash
git log --oneline -5
git checkout <предыдущий-sha>
docker compose -f deploy/docker-compose.yml up -d --build --force-recreate
```

### Логи и перезапуск

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
# образ chelotext:latest уже есть на сервере — alpine не скачиваем
docker run --rm -u root \
  -v chelotext-data:/data \
  -v "$PWD":/backup \
  chelotext:latest tar czf /backup/chelotext-data-$(date +%F).tar.gz -C /data .
```

Восстановление (контейнер должен быть остановлен):

```bash
docker compose -f deploy/docker-compose.yml stop app
docker run --rm -u root \
  -v chelotext-data:/data \
  -v "$PWD":/backup \
  chelotext:latest sh -c 'rm -rf /data/* && tar xzf /backup/chelotext-data-YYYY-MM-DD.tar.gz -C /data'
docker compose -f deploy/docker-compose.yml start app
```

---

## 7. Если что-то не работает

| Симптом | Что проверить |
|---|---|
| `KeyError: 'ContainerConfig'` при `docker-compose ... up` | используется старый `docker-compose` v1 (1.29.2) с Docker Engine 25+. Перейдите на плагин v2: команда `docker compose` (через пробел), см. ниже |
| `configured:false` в `/healthz` | ключ в `.env`, нет кавычек/пробелов вокруг `=`, контейнер пересоздан |
| `401 credentials doesn't match db data` | ключ устарел или от другого проекта: используйте пару Client ID + Secret либо перевыпустите ключ |
| `certificate verify failed` | нет `certs/russian_trusted_root_ca.crt` или он не смонтирован; повторите шаг 2 |
| NPM отдаёт `502 Bad Gateway` | контейнер не запущен или NPM не видит порт: `docker compose ... ps`, `docker compose ... logs app`, проверьте `172.17.0.1:3000` |
| `413 Request Entity Too Large` | в NPM → Advanced добавьте `client_max_body_size 26m;` (лимит приложения — 25 МБ) |
| Не сохраняется вход | сайт открыт по HTTP или NPM не передаёт `X-Forwarded-Proto`; включите Force SSL |
| Порт `3000` занят | задайте другой хост-порт: `APP_PORT=3100 docker compose ... up -d` и укажите `3100` в NPM |
| `Conflict. The container name "/..._chelotext" is already in use` | старый контейнер из другого проекта/deploy-инструмента: `docker ps -a --filter name=chelotext`, затем `docker rm -f <ID>`; `--remove-orphans` не поможет |
| `disk I/O error`, `errcode: 4874`, `Restarting (1)` | диск заполнен: `df -h /`; чистите `docker builder prune -f`, `docker image prune -f`, `journalctl --vacuum-size=200M`; volume не трогайте |
| `docker compose start app` → «no such container» | контейнер был удалён (`rm` / `prune`): используйте `docker compose -f deploy/docker-compose.yml up -d` |

### Старый `docker-compose` v1

Команда `docker-compose` (с дефисом) — это устаревший Python-скрипт 1.29.2. При пересоздании
контейнера он читает поле `ContainerConfig` в метаданных образа, которое убрано в новых версиях
Docker Engine. Отсюда `KeyError: 'ContainerConfig'`. Образ при этом собирается успешно — падает
именно шаг `Recreating`.

Правильное решение — плагин Compose v2 (команда `docker compose` через пробел). Если его ещё нет,
поставьте бинарник напрямую (без изменения apt-репозиториев):

```bash
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
docker compose version

cd /opt/chelotext
docker compose -f deploy/docker-compose.yml up -d --force-recreate
```

Если плагин поставить нельзя, временный обход для v1 — удалить старый контейнер вручную,
чтобы composer'у не пришлось его пересоздавать (volume с данными при этом сохраняется):

```bash
docker stop chelotext && docker rm chelotext
docker-compose -f deploy/docker-compose.yml up -d
```

Секреты остаются только в `.env` на сервере: они не попадают ни в git, ни в образ
(`.gitignore`, `.dockerignore`). Подробности по GigaChat — в [../api/README.md](../api/README.md).
