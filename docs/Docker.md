# Запуск и проверка MARC Parser в Docker

Эта инструкция описывает локальный запуск асинхронного сервиса конвертации
MARC 21 / ISO 2709 в MARC-JSON/NDJSON и обратно, а также проверку полного пути
файла через API, очередь и worker.

## Состав сервиса

`docker compose` запускает пять контейнеров:

| Сервис | Назначение | Доступ с хоста |
| --- | --- | --- |
| `api` | Принимает файлы и возвращает статусы заданий | `http://localhost:3000` |
| `worker` | Конвертирует ISO ↔ MARC-JSON | Не публикуется |
| `rabbitmq` | Хранит очередь заданий | `http://localhost:15672` |
| `minio` | Хранит входные файлы и результаты | `http://localhost:9001` |
| `postgres` | Хранит статусы и статистику заданий | Не публикуется |

Файл передаётся в MinIO, а в RabbitMQ отправляется только идентификатор
задания. После обработки worker сохраняет результат в MinIO и обновляет статус в
PostgreSQL.

## Требования

- Docker Desktop или Docker Engine;
- Docker Compose v2 (`docker compose`);
- `curl`;
- `jq` для удобного чтения JSON и выполнения примеров ниже.

Все команды нужно выполнять из корня репозитория.

## Запуск

Собрать образ приложения и запустить сервисы в фоне:

```bash
docker compose up --build -d
```

При первом запуске Docker скачивает базовые образы, поэтому команда может
выполняться несколько минут.

Проверить контейнеры:

```bash
docker compose ps
```

Контейнеры `api`, `postgres`, `rabbitmq` и `minio` должны иметь состояние
`healthy`, а `worker` — состояние `Up`.

Если API ещё запускается, дождаться его готовности можно так:

```bash
until curl -fsS http://localhost:3000/health >/dev/null; do
  sleep 1
done
```

Проверить health endpoint:

```bash
curl -fsS http://localhost:3000/health | jq
```

Ожидаемый ответ:

```json
{
  "status": "ok"
}
```

## Полная проверка конвертации

В репозитории есть fixture размером около 1 MB. Отправить его в API:

```bash
curl -fsS \
  -F file=@fixture/nlm-catplus-20251201-1mb.mrc \
  -F encoding=utf-8 \
  -F direction=iso-to-json \
  -F format=iso2709 \
  http://localhost:3000/jobs \
  | tee /tmp/marc-job.json \
  | jq
```

API отвечает кодом `202 Accepted`. Начальное состояние задания обычно
`queued`:

```json
{
  "jobId": "59d9dbe3-9179-47a3-ac79-66e46458b8f8",
  "status": "queued",
  "filename": "nlm-catplus-20251201-1mb.mrc",
  "encoding": "utf-8",
  "direction": "iso-to-json",
  "format": "iso2709",
  "inputBytes": 1011909
}
```

Сохранить идентификатор задания:

```bash
job_id=$(jq -r '.jobId' /tmp/marc-job.json)
echo "$job_id"
```

Проверить состояние:

```bash
curl -fsS "http://localhost:3000/jobs/$job_id" | jq
```

Для небольшого fixture обработка обычно заканчивается сразу. Если статус ещё
`queued` или `processing`, повторить запрос через секунду. Успешный ответ
содержит:

```json
{
  "status": "completed",
  "summary": {
    "inputBytes": 1011909,
    "validRecords": 655,
    "recordsProcessed": 655,
    "validationErrors": 0,
    "recordsWithParsingErrors": 0,
    "recordsWithValidationErrors": 0
  }
}
```

Скачать результат:

```bash
curl -fsS \
  -o result.iso.json \
  "http://localhost:3000/jobs/$job_id/result"
```

Проверить синтаксис каждой строки NDJSON:

```bash
jq -c . result.iso.json >/dev/null
```

Команда ничего не выводит и завершается с кодом `0`, если JSON корректен.

Проверить количество записей:

```bash
wc -l < result.iso.json
```

Для `nlm-catplus-20251201-1mb.mrc` ожидается:

```text
655
```

### Проверка JSON → исходный контейнер

Использовать полученный NDJSON как вход обратного задания:

```bash
curl -fsS \
  -F file=@result.iso.json \
  -F encoding=utf-8 \
  -F direction=json-to-iso \
  http://localhost:3000/jobs \
  | tee /tmp/marc-reverse-job.json \
  | jq
```

После статуса `completed` скачать `/jobs/<jobId>/result`. Для
`result.iso.json` имя результата имеет расширение `.mrc`, а ответ — MIME
`application/marc`. Имя `result.aleph.json` выбирает результат `.dat` с MIME
`application/octet-stream`; JSON без маркера `.iso`/`.aleph` отклоняется.

## Проверка очередей

Посмотреть количество готовых и обрабатываемых сообщений:

```bash
docker compose exec -T rabbitmq \
  rabbitmqctl list_queues name messages_ready messages_unacknowledged
```

После завершения всех заданий ожидается:

```text
name                 messages_ready  messages_unacknowledged
marc.convert         0               0
marc.convert.dead    0               0
```

Очередь `marc.convert.dead` получает сообщения, которые не удалось обработать
за `JOB_MAX_ATTEMPTS` попыток.

RabbitMQ Management доступен по адресу `http://localhost:15672`:

- логин: `marc`;
- пароль: `marc`.

## Проверка MinIO

MinIO Console доступна по адресу `http://localhost:9001`:

- логин: `marc`;
- пароль: `marc-secret`.

В bucket `marc-jobs` находятся:

- `inputs/<jobId>` — исходные файлы обоих направлений;
- `outputs/<jobId>.iso.json` — результаты ISO → NDJSON;
- `outputs/<jobId>.aleph.json` — результаты Aleph → NDJSON;
- `outputs/<jobId>.mrc` — результаты `.iso.json` → ISO;
- `outputs/<jobId>.dat` — результаты `.aleph.json` → Aleph sequential.

Записи заданий и оба связанных объекта хранятся сутки. API запускает сборщик
при старте и далее каждые 12 часов. Его можно запустить вне расписания:

```bash
curl -fsS -X POST http://localhost:3000/maintenance/cleanup | jq
```

Завершённое или упавшее задание можно удалить явно:

```bash
curl -i -X DELETE "http://localhost:3000/jobs/$job_id"
```

## Проверка PostgreSQL

Посмотреть последние задания:

```bash
docker compose exec -T postgres \
  psql -U marc -d marc_parser -c \
  "SELECT id, status, direction, input_format, original_filename, input_bytes, created_at
   FROM conversion_jobs
   ORDER BY created_at DESC
   LIMIT 10;"
```

## Логи и диагностика

Логи API и worker в реальном времени:

```bash
docker compose logs -f api worker
```

Последние 100 строк всех сервисов:

```bash
docker compose logs --tail=100
```

Логи отдельного сервиса:

```bash
docker compose logs --tail=100 api
docker compose logs --tail=100 worker
```

Если `GET /jobs/<jobId>/result` возвращает `409`, задание ещё не завершено.
Нужно проверить `GET /jobs/<jobId>` и дождаться статуса `completed`.

Если задание перешло в `failed`, поле `error` в ответе API содержит причину.
Дополнительная информация будет в логах worker.

### Ошибки загрузки Docker-образов

При `EOF`, timeout или ошибке обращения к registry сначала повторить:

```bash
docker compose pull
docker compose up --build -d
```

На macOS при неработающем IPv6-маршруте можно открыть Docker Desktop →
Settings → Network и выбрать:

- Default networking mode: `IPv4 only`;
- DNS resolution behavior: `Filter IPv6`.

После применения настроек нужно перезапустить Docker Desktop и снова выполнить
`docker compose up --build -d`.

### Занятые порты

По умолчанию используются порты `3000`, `9000`, `9001` и `15672`. Если один
из них занят, Docker покажет ошибку `port is already allocated`. Нужно
остановить использующий порт процесс либо изменить публикацию порта в
`compose.yaml`.

## Управление сервисами

Перезапустить API и worker:

```bash
docker compose restart api worker
```

Пересобрать приложение после изменения исходного кода:

```bash
docker compose up --build -d api worker
```

Увеличить число workers до четырёх контейнеров:

```bash
docker compose up -d --scale worker=4
```

Остановить и удалить контейнеры и сеть, сохранив данные:

```bash
docker compose down
```

Полностью удалить также данные PostgreSQL, RabbitMQ и MinIO:

```bash
docker compose down -v
```

Последняя команда необратимо удаляет локальные задания, очереди, входные файлы
и результаты.

## Настройки и безопасность

Перечень переменных окружения приведён в `.env.example`. Значения в
`compose.yaml` предназначены только для локальной разработки. Перед
развёртыванием в общей или production-среде необходимо:

- заменить все пароли;
- передавать секреты через Docker secrets или менеджер секретов;
- не публиковать MinIO и RabbitMQ Management в интернет;
- настроить TLS, аутентификацию API, лимиты хранения и резервное копирование;
- настроить очистку старых объектов из `inputs/` и `outputs/`.
