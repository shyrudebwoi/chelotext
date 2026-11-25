#!/usr/bin/env bash
# Развёртывание Челотекста на VDS.
#   ./deploy/deploy.sh install   — первичная установка
#   ./deploy/deploy.sh update    — подтянуть изменения и перезапустить
#   ./deploy/deploy.sh status    — проверить состояние
#   ./deploy/deploy.sh backup    — архив data/ (SQLite, сессии, OCR)
#
# Переменные окружения:
#   MODE=docker|systemd   (по умолчанию docker)
#   APP_DIR=/opt/chelotext
#   REPO=https://github.com/shyrudebwoi/chelotext.git
set -euo pipefail

MODE="${MODE:-docker}"
APP_DIR="${APP_DIR:-/opt/chelotext}"
REPO="${REPO:-https://github.com/shyrudebwoi/chelotext.git}"
ACTION="${1:-update}"

log() { printf '\n==> %s\n' "$*"; }
die() { printf '\nОШИБКА: %s\n' "$*" >&2; exit 1; }

fetch_cert() {
  local target="$APP_DIR/certs/russian_trusted_root_ca.crt"
  mkdir -p "$APP_DIR/certs"
  if [ -s "$target" ]; then
    log "Корневой сертификат уже есть: $target"
    return
  fi
  log "Скачиваем корневой сертификат НУЦ Минцифры"
  curl -fsSL --max-time 30 \
    https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt -o "$target"
  grep -q 'BEGIN CERTIFICATE' "$target" || die "По адресу сертификата пришёл не PEM. Скачай вручную с https://www.gosuslugi.ru/crt"
}

clone_or_pull() {
  if [ -d "$APP_DIR/.git" ]; then
    log "Обновляем репозиторий в $APP_DIR"
    git -C "$APP_DIR" pull --ff-only
  else
    log "Клонируем приватный репозиторий в $APP_DIR"
    mkdir -p "$(dirname "$APP_DIR")"
    git clone "$REPO" "$APP_DIR"
  fi
  [ -f "$APP_DIR/.env" ] || die "Нет $APP_DIR/.env. Скопируй deploy/.env.production.example в .env и впиши ключи GigaChat."
  grep -Eq '^(GIGACHAT_CRED|GIGACHAT_CLIENT_ID)=.+' "$APP_DIR/.env" \
    || die "Ключи GigaChat не заполнены. Без них приложение работает только на правилах."
}

docker_deploy() {
  command -v docker >/dev/null || die "Docker не установлен (или установи MODE=systemd)"
  docker compose version >/dev/null 2>&1 || die "Нужен docker compose plugin"
  log "Собираем и поднимаем контейнер"
  cd "$APP_DIR"
  docker compose -f deploy/docker-compose.yml up -d --build
  docker compose -f deploy/docker-compose.yml ps
}

systemd_deploy() {
  command -v npm >/dev/null || die "npm не найден. Установи Node 22+ (https://nodejs.org) или используй MODE=docker"
  log "Устанавливаем зависимости"
  cd "$APP_DIR"
  npm ci --omit=dev
  id -u chelotext >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin chelotext
  mkdir -p "$APP_DIR/data" "$APP_DIR/certs"
  chown -R chelotext:chelotext "$APP_DIR/data" "$APP_DIR/certs"
  log "Устанавливаем systemd-юнит"
  install -m 0644 "$APP_DIR/deploy/chelotext.service" /etc/systemd/system/chelotext.service
  systemctl daemon-reload
  systemctl enable chelotext
  systemctl restart chelotext
  systemctl --no-pager --full status chelotext || true
}

show_status() {
  if [ "$MODE" = docker ]; then
    cd "$APP_DIR"
    docker compose -f deploy/docker-compose.yml ps
  else
    systemctl --no-pager --full status chelotext || true
  fi
  log "/healthz:"
  curl -fsS --max-time 10 http://127.0.0.1:3000/healthz || die "Приложение не отвечает на :3000"
}

make_backup() {
  local stamp backup
  stamp="$(date +%Y%m%d-%H%M%S)"
  backup="/var/backups/chelotext-${stamp}.tar.gz"
  mkdir -p /var/backups
  log "Архивируем $APP_DIR/data → $backup"
  tar -czf "$backup" -C "$APP_DIR" data
  chmod 0600 "$backup"
  ls -lh "$backup"
}

case "$ACTION" in
  install|update)
    clone_or_pull
    fetch_cert
    if [ "$MODE" = docker ]; then docker_deploy; else systemd_deploy; fi
    show_status
    ;;
  status)
    show_status
    ;;
  backup)
    make_backup
    ;;
  *)
    die "Неизвестное действие: $ACTION (install|update|status|backup)"
    ;;
esac
