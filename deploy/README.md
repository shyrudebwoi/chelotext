# Деплой Челотекста на VDS

Этот комплект разворачивает **тот же самый код**, что работает локально: один Express-процесс, SQLite внутри `data/`, in-process очередь, GigaChat с проверкой TLS. Никаких PostgreSQL, Redis и Celery не нужно.

Есть два варианта — выбирайте один:

| Вариант | Что ставим | Когда выбирать |
|---|---|---|
| **Docker Compose** (рекомендуется) | Docker + compose plugin, nginx на хосте | хотите воспроизводимое окружение и простые обновления |
| **systemd** | Node 22+, nginx на хосте | Docker на VDS ставить не хотите |

В обоих случаях приложение слушает только `127.0.0.1:3000`, а наружу его публикует nginx с HTTPS.

---

## 0. Что должно быть на сервере

- Ubuntu 22.04/24.04 (инструкция рассчитана на неё), **1 CPU / 1–2 ГБ RAM** минимум. OCR на слабых машинах медленный, но рабочий.
- Домен, указывающий на VDS (например `chelotext.example.com`), и открытые порты 80/443.
- Приватный репозиторий `https://github.com/shyrudebwoi/chelotext` и доступ к нему.

**Доступ к приватному репозиторию.** Самый безопасный вариант — deploy key:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/chelotext_deploy -N ''
cat ~/.ssh/chelotext_deploy.pub      # скопируй в Settings → Deploy keys репозитория
```

Добавьте ключ в `~/.ssh/config`:

```text
Host github-chelotext
  HostName github.com
  User git
  IdentityFile ~/.ssh/chelotext_deploy
  IdentitiesOnly yes
```

И склонируйте через алиас (переменную `REPO` в скрипте можно не менять):

```bash
git clone git@github-chelotext:shyrudebwoi/chelotext.git /opt/chelotext
```

Альтернатива — Personal Access Token со scope `repo`, но тогда токен сохранится в `~/.git-credentials` (permissions `600`) и его нужно будет отозвать при утечке. **Не кладите токен в репозиторий и не передавайте его в чат.**

---

## 1. Первичная установка

### Вариант A — Docker Compose

```bash
# Docker и compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER" && newgrp docker

# Код (см. п. 0 про доступ к репозиторию)
sudo git clone git@github-chelotext:shyrudebwoi/chelotext.git /opt/chelotext
sudo chown -R "$USER":"$USER" /opt/chelotext

# Окружение: только ключи GigaChat остаётся заполнить вручную
cp /opt/chelotext/deploy/.env.production.example /opt/chelotext/.env
nano /opt/chelotext/.env        # GIGACHAT_CRED  ИЛИ  GIGACHAT_CLIENT_ID + GIGACHAT_CLIENT_SECRET

cd /opt/chelotext
./deploy/deploy.sh install
```

Скрипт сам скачает корневой сертификат НУЦ Минцифры в `certs/`, соберёт образ и поднимет контейнер с `restart: unless-stopped`.

### Вариант B — systemd

```bash
sudo apt update
sudo apt install -y git curl nginx certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

sudo git clone git@github-chelotext:shyrudebwoi/chelotext.git /opt/chelotext
sudo chown -R "$USER":"$USER" /opt/chelotext

cp /opt/chelotext/deploy/.env.production.example /opt/chelotext/.env
nano /opt/chelotext/.env        # впиши доступ к GigaChat

# В systemd-варианте приложение доступно только локально
sudo sed -i 's/^HOST=0.0.0.0$/HOST=127.0.0.1/' /opt/chelotext/.env

cd /opt/chelotext
MODE=systemd sudo -E ./deploy/deploy.sh install
```

Юнит `/etc/systemd/system/chelotext.service` уже настроен: `NODE_ENV=production`, `SECURE_COOKIES=true`, `TRUST_PROXY=true`, перезапуск при падении, запись только в `data/` и `certs/`.

> Если `.env` уже существует, `clone_or_pull` не перезаписывает его — смело обновляйте код поверх.

---

## 2. HTTPS и nginx

```bash
sudo cp /opt/chelotext/deploy/nginx/chelotext.conf /etc/nginx/sites-available/chelotext
sudo ln -sfn /etc/nginx/sites-available/chelotext /etc/nginx/sites-enabled/chelotext
sudo nano /etc/nginx/sites-available/chelotext   # замени example.com на свой домен (2 места + путь сертификата)
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d chelotext.example.com
sudo systemctl status certbot.timer
```

`client_max_body_size 26m` соответствует лимиту загрузки 25 МБ в приложении. Прокси передаёт `X-Forwarded-Proto`, поэтому `SECURE_COOKIES=true` работает корректно.

Откройте `https://chelotext.example.com/healthz` — ожидаемый ответ:

```json
{"ok":true,"llm":{"provider":"gigachat","model":"GigaChat-2","enabled":true,"configured":true,"credentialSource":"client id + client secret"},...}
```

`configured: false` означает, что ключ не подхватился: проверьте `.env` и перезапуск (`docker compose restart` или `systemctl restart chelotext`).

---

## 3. Обновление, статус, бэкап

```bash
cd /opt/chelotext

./deploy/deploy.sh update           # git pull → сертификат → пересборка/перезапуск
MODE=systemd sudo -E ./deploy/deploy.sh update

./deploy/deploy.sh status           # docker compose ps + /healthz
./deploy/deploy.sh backup           # /var/backups/chelotext-YYYYMMDD-HHMMSS.tar.gz
```

Ручной бэкап — это просто `tar` каталога `data/` (там SQLite, секрет сессий и языковые данные OCR). Восстановление: остановить приложение, распаковать архив обратно в `data/`, запустить.

В Docker volume `chelotext-data` живёт отдельно от контейнера, поэтому `docker compose down` **не удаляет** данные; `down -v` — удаляет.

---

## 4. Важное про безопасность

- `.env` содержит секреты GigaChat. Он не попадает ни в git, ни в Docker-образ (`.gitignore`, `.dockerignore`). Права: `chmod 600 /opt/chelotext/.env`.
- Проверку TLS **нельзя отключать**. Вместо этого используется корневой PEM НУЦ Минцифры (`certs/russian_trusted_root_ca.crt`).
- `/healthz` сообщает только *факт* наличия ключа и его источник, никогда само значение.
- С согласия пользователя текст уходит выбранному провайдеру (по умолчанию GigaChat). Для чувствительных текстов поставьте `LLM_PROVIDER=rules` или поднимите свой Ollama.
- `OPERATOR_NAME` / `OPERATOR_EMAIL` в `.env` — ваши реальные реквизиты, они видны на страницах согласия и в юридических разделах.

---

## 5. Устранение неполадок

| Симптом | Что проверить |
|---|---|
| `git clone` просит пароль | Deploy key не добавлен в репозиторий или не прописан в `~/.ssh/config`; проверьте `ssh -T git@github-chelotext` |
| `configured:false` в `/healthz` | ключ в `/opt/chelotext/.env`, нет кавычек и пробелов вокруг `=`, сервер перезапущен |
| `401 credentials doesn't match db data` | Authorization Key устарел: используйте пару `GIGACHAT_CLIENT_ID` + `GIGACHAT_CLIENT_SECRET` или перевыпустите ключ в Студии Сбера |
| `certificate verify failed` | `certs/russian_trusted_root_ca.crt` отсутствует или не смонтирован; повторите `./deploy/deploy.sh install` |
| `502 Bad Gateway` от nginx | контейнер/юнит не запущен: `docker compose ps` или `systemctl status chelotext`; посмотрите логи `docker compose logs -f app` / `journalctl -u chelotext -f` |
| `413 Request Entity Too Large` | увеличить `client_max_body_size` в nginx и `MAX_UPLOAD_BYTES` в `.env` согласованно |
| Cookie не сохраняется при входе | домен открывается по HTTP или `TRUST_PROXY` выключен; убедитесь, что `SECURE_COOKIES=true` и запросы идут через HTTPS |
| OCR не работает | в Docker языковые данные уже внутри образа; в systemd-варианте проверьте права на `data/` (владелец — `chelotext`) |

Подробности по GigaChat и кодам ошибок — в [../api/README.md](../api/README.md) и [../README.md](../README.md).
