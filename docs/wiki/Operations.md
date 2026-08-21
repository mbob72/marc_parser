# Эксплуатация асинхронного сервиса

Полный сценарий запуска и ручной end-to-end проверки находится в
[Docker-инструкции](../Docker.md). Эта страница объясняет эксплуатационную
модель и точки диагностики.

## Состав Compose

| Сервис | Роль | Порт с хоста |
| --- | --- | --- |
| `api` | HTTP API | `3000` |
| `worker` | Consumer и конвертация | — |
| `postgres` | Состояние jobs | — |
| `rabbitmq` | Основная и dead-letter очереди | Management UI `15672` |
| `minio` | Входы и результаты | S3 `9000`, Console `9001` |

Базовый запуск:

```bash
docker compose up --build -d
docker compose ps
```

## Конфигурация

Все значения читаются в [`service-config.ts`](../../src/service-config.ts).

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Адрес API |
| `PORT` | `3000` | Порт API |
| `DATABASE_URL` | локальный PostgreSQL | Connection string |
| `RABBITMQ_URL` | локальный RabbitMQ | AMQP connection string |
| `RABBITMQ_QUEUE` | `marc.convert` | Имя основной queue |
| `WORKER_CONCURRENCY` | `2` | Prefetch и число одновременных deliveries на worker |
| `JOB_MAX_ATTEMPTS` | `3` | Максимум попыток job |
| `MINIO_ENDPOINT` | `localhost` | Host S3-compatible storage |
| `MINIO_PORT` | `9000` | Порт storage |
| `MINIO_USE_SSL` | `false` | TLS для storage |
| `MINIO_ACCESS_KEY` | `marc` | Access key |
| `MINIO_SECRET_KEY` | `marc-secret` | Secret key |
| `MINIO_BUCKET` | `marc-jobs` | Bucket входов и результатов |
| `MAX_UPLOAD_BYTES` | `5368709120` | Лимит multipart-файла |

Положительные числовые значения проверяются при старте. `MINIO_USE_SSL`
принимает только строки `true` и `false`.

## Масштабирование

Вертикальная настройка одного worker — `WORKER_CONCURRENCY`. Горизонтальное
масштабирование в Compose:

```bash
docker compose up -d --scale worker=4
```

RabbitMQ распределяет сообщения между consumers. MinIO и PostgreSQL остаются
общими. При выборе concurrency нужно учитывать не только CPU, но и временное
дисковое пространство: каждое активное задание хранит локальные копии входа и
выхода.

## Диагностика

Проверять систему удобно от края к центру:

1. `GET /health` подтверждает API и PostgreSQL.
2. `GET /jobs/<id>` показывает последний статус и текст ошибки.
3. RabbitMQ Management или `rabbitmqctl list_queues` показывает ready,
   unacknowledged и dead-letter сообщения.
4. MinIO Console подтверждает наличие `inputs/...` и `outputs/...`.
5. `docker compose logs api worker` показывает process-level ошибки.

Полезные команды:

```bash
docker compose logs --tail=100 api worker
docker compose exec -T rabbitmq \
  rabbitmqctl list_queues name messages_ready messages_unacknowledged
docker compose exec -T postgres \
  psql -U marc -d marc_parser -c \
  "SELECT id, status, error, updated_at FROM conversion_jobs ORDER BY updated_at DESC LIMIT 20;"
```

## Интерпретация симптомов

| Симптом | Где смотреть | Типичная причина |
| --- | --- | --- |
| API unhealthy | API logs, PostgreSQL | Неверный `DATABASE_URL`, БД не готова |
| Job долго `queued` | Worker logs, ready queue | Нет consumer, worker не подключился |
| Job долго `processing` | Worker logs, unacked messages, disk | Большой файл, зависший I/O, нехватка temp space |
| Job снова `queued` с `error` | Worker logs | Промежуточная попытка завершилась ошибкой |
| Job `failed` | `error`, dead-letter queue | Исчерпаны попытки или не опубликована первая попытка |
| Result endpoint отвечает `409` | Job status | Job ещё не `completed` |

## Production checklist

- передавать credentials через secrets, не использовать значения Compose;
- поставить API за TLS и аутентификацией;
- не публиковать PostgreSQL, MinIO и RabbitMQ Management в интернет;
- ограничить сеть между компонентами;
- мониторить глубину queue, долю failed jobs, latency, temp disk и объём bucket;
- настроить резервное копирование PostgreSQL и нужных объектов;
- определить TTL/retention для входов, результатов и jobs;
- продумать backoff для retries и обработку poison messages;
- перед изменением схемы внедрить версионируемые миграции;
- проверить graceful shutdown под нагрузкой и политику повторной доставки.
