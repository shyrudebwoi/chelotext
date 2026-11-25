# GigaChat API: авторизация

Источники (сверено 24.11.2026):
- https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/gigachat-api
- https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/post-token
- https://developers.sber.ru/docs/ru/gigachat/quickstart/ind-using-api
- https://developers.sber.ru/docs/ru/gigachat/certificates

## Как устроен доступ

1. В личном кабинете выдаётся **ключ авторизации** (Authorization key). Он долгоживущий, это главный секрет.
2. Приложение обменивает ключ авторизации на **токен доступа** (Access token). Токен живёт **30 минут**.
3. Все запросы к модели отправляются с токеном доступа в заголовке `Authorization: Bearer <токен>`.

## Где взять ключ авторизации

1. Откройте проект **GigaChat API** в личном кабинете Studio.
2. В левой панели выберите **Настройки API**.
3. Нажмите **Получить ключ**.
4. Сохраните значения **Authorization Key**, **Client ID**, **Client Secret**.

Важно:
- Ключ авторизации и Client Secret показываются **один раз** и в кабинете не хранятся.
- Ключ авторизации - это Base64 от строки `Client ID:Client Secret`. Если есть готовый ключ, кодировать самому ничего не нужно.
- Кнопка **Получить ключ** активна только у ролей Владелец и Администратор.
- Если ключ утерян или утёк, нажмите **Получить новый ключ**. Старый ключ можно оставить действовать ещё до 250 минут.

## Адреса

| Назначение | Адрес |
|---|---|
| Получение токена | `https://ngw.devices.sberbank.ru:9443/api/v2/oauth` |
| Запросы к API (с 17.07.2026) | `https://api.giga.chat` |
| Старый адрес API | `https://gigachat.devices.sberbank.ru/` |

Старый адрес работает только для тех, кто подключился до 17.07.2026, и его со временем отключат. Новые проекты используют `https://api.giga.chat`.

## Получение токена доступа

**POST** `https://ngw.devices.sberbank.ru:9443/api/v2/oauth`

Заголовки:

| Заголовок | Значение |
|---|---|
| `Content-Type` | `application/x-www-form-urlencoded` |
| `Accept` | `application/json` |
| `RqUID` | Уникальный идентификатор запроса в формате uuid4. Генерируется заново на каждый запрос |
| `Authorization` | `Basic <ключ_авторизации>` |

Тело запроса (form): `scope=<версия API>`

| scope | Для кого |
|---|---|
| `GIGACHAT_API_PERS` | Физические лица (учебные проекты) |
| `GIGACHAT_API_B2B` | ИП и юрлица по предоплате (платные пакеты) |
| `GIGACHAT_API_CORP` | ИП и юрлица по постоплате (pay-as-you-go) |

Ответ:

```json
{
  "access_token": "eyJhbGci...",
  "expires_at": 1706026848841
}
```

- `expires_at` - время окончания действия токена, unix timestamp **в миллисекундах**.
- Запрашивать токен можно не чаще 10 раз в секунду. Получайте новый токен, только когда старый истекает, а не перед каждым запросом.

Пример на Python (библиотека `requests`):

```python
import os
import time
import uuid

import requests

OAUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
CA_BUNDLE = "certs/ca_bundle.pem"  # см. раздел «Сертификаты Минцифры»

_token = None
_token_expires_at = 0.0  # секунды


def get_access_token() -> str:
    global _token, _token_expires_at
    # Берём новый токен за минуту до истечения старого
    if _token and time.time() < _token_expires_at - 60:
        return _token
    resp = requests.post(
        OAUTH_URL,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "RqUID": str(uuid.uuid4()),
            "Authorization": f"Basic {os.environ['GIGACHAT_CRED']}",
        },
        data={"scope": os.environ.get("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")},
        verify=CA_BUNDLE,
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    _token = data["access_token"]
    _token_expires_at = data["expires_at"] / 1000
    return _token
```

## Авторизация запросов к API

Передавайте токен в заголовке `Authorization`. При запросах на `https://api.giga.chat` также передавайте заголовок `User-Agent` с любым значением: без него приходит ошибка 403.

Проверка ключа и токена - запрос списка моделей:

```sh
curl -L -X GET 'https://api.giga.chat/v1/models' \
  -H 'Accept: application/json' \
  -H 'User-Agent: my-app' \
  -H 'Authorization: Bearer <токен_доступа>'
```

## Сертификаты Минцифры

Для обмена данными с GigaChat API нужен корневой сертификат НУЦ Минцифры. Без него запрос токена падает с ошибкой:

```
[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: self-signed certificate in certificate chain
```

**Не отключайте проверку сертификатов** (`verify=False`). Правильно - добавить сертификат.

Способ из документации (bash, macOS/Linux): дописать сертификат в набор certifi текущего окружения.

```sh
curl -k "https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt" -w "\n" >> $(python -m certifi)
```

После создания нового виртуального окружения команду нужно повторить.

Способ для Windows и любого окружения: свой файл доверенных сертификатов в папке проекта.

1. Скачайте корневой сертификат с https://www.gosuslugi.ru/crt (или по прямой ссылке выше) и сохраните как `certs/russian_trusted_root_ca.crt`.
2. Соберите общий файл: стандартные сертификаты certifi плюс сертификат Минцифры.

```python
from pathlib import Path

import certifi

bundle = Path("certs/ca_bundle.pem")
if not bundle.exists():
    bundle.write_text(
        Path(certifi.where()).read_text(encoding="utf-8")
        + "\n"
        + Path("certs/russian_trusted_root_ca.crt").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
```

3. Передавайте `verify="certs/ca_bundle.pem"` во все запросы к GigaChat.

Установка сертификата в Windows через Госуслуги нужна браузеру. Библиотека `requests` берёт сертификаты из certifi, а не из хранилища Windows, поэтому для Python-кода нужен один из способов выше.

## Альтернатива: официальный SDK

```python
from gigachat import GigaChat  # pip install gigachat

giga = GigaChat(
    base_url="https://api.giga.chat/v1",
    credentials="<ключ_авторизации>",  # в коде брать из переменной окружения
    scope="GIGACHAT_API_PERS",
    ca_bundle_file="certs/russian_trusted_root_ca.crt",
)
print(giga.get_models())
```

SDK сам получает и обновляет токен.
