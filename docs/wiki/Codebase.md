# Карта исходного кода

## Точки входа

| Файл | Запуск | Назначение |
| --- | --- | --- |
| [`src/cli.ts`](../../src/cli.ts) | `npm run dev -- ...` или `node dist/cli.js` | Разбирает CLI-аргументы, выбирает logger, запускает локальную конвертацию |
| [`src/api.ts`](../../src/api.ts) | `npm run start:api` | Создаёт Fastify, принимает загрузки, создаёт и читает задания |
| [`src/worker.ts`](../../src/worker.ts) | `npm run start:worker` | Подписывается на очередь, конвертирует объект и управляет retry/ack |

Все три файла защищают `main()` проверкой `import.meta.url`, поэтому их можно
импортировать в тестах без автоматического запуска процесса.

## Потоковое ядро

### `marc-file-converter.ts`

Публичный прикладной API — `convertMarcFile(options)`. Модуль:

- нормализует путь результата;
- не допускает совпадения входного и выходного пути;
- собирает parser/validator/serializer/streams;
- пишет в уникальный временный файл;
- выбирает обычное имя или `pErrors_...`;
- возвращает `MarcProcessingSummary`.

Если нужен новый способ запуска конвертации, следует вызывать этот API, а не
копировать сборку pipeline.

### `marc-record-splitter.ts` и `marc-parser-validator.ts`

Splitter отвечает только за границы записей между произвольными входными
чанками. Проверка конкретной полной записи вынесена за интерфейс
[`MarcRecordProcessor`](../../src/marc-record-processor.ts), что позволяет
подменять её в unit-тестах.

### `marc-json-transform.ts`

Это координатор обработки записи и построения корневого JSON. Parser,
validator, serializer и logger передаются в constructor через небольшие
интерфейсы. Такая инъекция зависимостей — основной seam для тестирования.

## MARC-домен

| Модуль | Что содержит |
| --- | --- |
| [`marc-record.ts`](../../src/marc-record.ts) | TypeScript-типы Leader, Directory, raw/control/data fields и subfields |
| [`marc-parser.ts`](../../src/marc-parser.ts) | Бинарный разбор ISO 2709: Leader → Directory → raw fields → typed fields |
| [`marc-validator.ts`](../../src/marc-validator.ts) | Коды правил, структура ошибки и сбор всех нарушений одной записи |
| [`marc-json-serializer.ts`](../../src/marc-json-serializer.ts) | Публичная JSON-модель, декодирование значений, `format`, деградация повреждённых частей |

### Граница parser/validator

Parser проверяет условия, без которых нельзя безопасно построить модель:
числовые смещения, границы, терминаторы и форму Directory. Validator проверяет
семантические правила уже построенной модели и возвращает массив ошибок вместо
исключения.

Это различие важно сохранять. Новая проверка должна быть исключением parser,
только если продолжение разбора небезопасно или неоднозначно; в остальных
случаях ей место в validator.

### Выходная модель

```ts
interface MarcJsonRecord {
  leader: string;
  format: "BK" | "CF" | "CR" | "MP" | "MU" | "MX" | "VM" | "<unrecognized>";
  fields: Array<
    | { code: string; value: string }
    | {
        code: string;
        ind1: string;
        ind2: string;
        subfields: Array<{ code: string; value: string }>;
      }
  >;
}
```

Точное вычисление `format` описано отдельно: [Вычисление поля
format](../%D0%92%D1%8B%D1%87%D0%B8%D1%81%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5%20%D0%BF%D0%BE%D0%BB%D1%8F%20format.md).

## Асинхронный сервис

| Модуль | Граница |
| --- | --- |
| [`job.ts`](../../src/job.ts) | Общие типы job, статусы и сообщение очереди |
| [`job-database.ts`](../../src/job-database.ts) | SQL-схема и переходы статусов PostgreSQL |
| [`job-queue.ts`](../../src/job-queue.ts) | Соединение AMQP, topology, publish/consume/ack/reject |
| [`object-store.ts`](../../src/object-store.ts) | Минимальная обёртка MinIO для bucket и объектов |
| [`service-config.ts`](../../src/service-config.ts) | Единственная точка чтения и проверки env |

API и worker зависят от `Pick<...>` методов этих классов, а не от полных
реализаций. Благодаря этому тесты передают лёгкие in-memory doubles без
PostgreSQL, RabbitMQ и MinIO.

## Наблюдаемость

[`marc-processing-logger.ts`](../../src/marc-processing-logger.ts) задаёт
контракт событий обработки и две реализации:

- `ConsoleMarcProcessingLogger` используется CLI, пишет ошибки и summary, а с
  `--log` также успешные записи;
- `NullMarcProcessingLogger` используется worker, потому что итоговая
  статистика сохраняется в job.

Fastify использует встроенный structured logger. Worker пишет lifecycle и
необработанные consumer errors в stdout/stderr.

## Как безопасно расширять код

### Добавить правило валидации

1. Добавить код в `MarcValidationRule`.
2. Реализовать проверку в `marc-validator.ts`, сохранив контекст индексов.
3. Решить в serializer, какую часть JSON заменять на `"<unrecognized>"`.
4. Добавить тест validator и serializer/transform.
5. Обновить документ правил в `docs`.

### Изменить JSON-контракт

Обновить типы и сериализацию, затем fixture assertions в
`marc-json-serializer.test.ts` и потоковые ожидания. Это пользовательский
контракт, поэтому изменение следует считать breaking, если старый JSON больше
не принимается потребителями.

### Добавить API endpoint

Регистрировать route в `buildApi`, держать бизнес-зависимости в
`ApiDependencies` и покрывать endpoint через `app.inject`. Создание реальных
соединений должно оставаться в `main`, чтобы импорт модуля не имел side effects.

### Изменить обработку задания

Переходы статусов и порядок ack/publish должны меняться вместе с тестами
`worker.test.ts`. Сообщение подтверждается только после сохранения результата и
статуса либо после успешной публикации следующей попытки.

## Прочие каталоги

| Путь | Назначение |
| --- | --- |
| [`test`](../../test) | Unit и component-тесты на встроенном Node test runner |
| [`scripts`](../../scripts) | Проверка версии, сборка Bun-бинарника, smoke-test |
| [`fixture`](../../fixture) | Реальные MARC-файлы для ручной и smoke-проверки |
| [`.github/workflows`](../../.github/workflows) | CI на push/PR и release pipeline по тегу |
| [`docs`](../) | Предметные правила и эксплуатационные инструкции |
