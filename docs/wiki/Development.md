# Разработка и тестирование

## Требования

- Node.js 24 или новее;
- npm;
- Docker и Docker Compose v2 — только для полного async-стека;
- Bun отдельно устанавливать не нужно: зафиксированная версия находится в
  `devDependencies`.

## Локальный цикл

```bash
npm ci
npm run check
```

`npm run check` сначала компилирует strict TypeScript в `dist`, затем запускает
все `test/*.test.ts` через встроенный Node test runner и `tsx`.

Полезные команды:

| Команда | Назначение |
| --- | --- |
| `npm run build` | TypeScript → ESM в `dist` |
| `npm test` | Все тесты |
| `npm run dev -- input.mrc output.json utf-8 --log` | CLI прямо из TypeScript |
| `npm start -- input.mrc output.json utf-8` | Скомпилированный CLI |
| `npm run build:binary` | Standalone-бинарник в `release/` |
| `npm run smoke:binary` | Проверка собранного бинарника |

## Стратегия тестов

| Область | Файлы | Что проверяется |
| --- | --- | --- |
| CLI | `cli.test.ts`, `version.test.ts` | help/version/exit code, синхронизация версии |
| Framing | `marc-record-splitter.test.ts` | Произвольные чанки и оборванный хвост |
| Parser | `marc-parser.test.ts` | Leader, Directory, поля, границы и терминаторы |
| Validation | `marc-validator.test.ts` | Корректная запись и полный набор правил |
| JSON | `marc-json-serializer.test.ts`, `marc-json-transform.test.ts` | Кодировки, деградация, один/несколько объектов, продолжение после parsing error |
| Файловая оркестрация | `marc-file-converter.test.ts` | Имена, temp/rename, сохранение старого результата при fatal error |
| Async-слой | `api.test.ts`, `worker.test.ts` | HTTP upload и полный успешный worker path на test doubles |
| Config/logging | `service-config.test.ts`, `marc-processing-logger.test.ts` | Env parsing и вывод |

Тесты API используют `Fastify.inject`, поэтому порт не открывается. Тесты
worker передают объекты, реализующие только нужные методы. Текущий набор не
поднимает PostgreSQL/RabbitMQ/MinIO автоматически; полный путь проверяется
вручную через Compose.

## Где добавлять тест

- Изменение алгоритма parsing — рядом в `marc-parser.test.ts`.
- Новое validation rule — validator test плюс serializer/transform test на
  отображение ошибки в JSON.
- Изменение атомарности или имени результата — converter test.
- Изменение HTTP-контракта — API test через `app.inject`.
- Изменение retry или порядка подтверждений — worker test с журналом вызовов.

Для бинарных MARC-входов предпочтительны небольшие programmatic fixtures в
тесте. Реальные большие файлы из `fixture/` нужны для smoke/performance, но не
для каждой unit-проверки.

## CI

Workflow [Checks](../../.github/workflows/checks.yml) запускается на push в
`main`, на pull request и вручную. Он использует Node.js 24, `npm ci` и
`npm run check`.

Перед публикацией ветки ожидается тот же локальный результат:

```bash
npm run check
```

## Release pipeline

Push тега `v*` запускает [release workflow](../../.github/workflows/release.yml):

1. тег сверяется с `package.json`;
2. build и tests выполняются в матрице Linux x64, Windows x64, macOS ARM64 и
   macOS x64;
3. Bun компилирует standalone executable;
4. executable проходит smoke-test;
5. создаются архивы, build provenance для public repository и `SHA256SUMS`;
6. GitHub Release создаётся или обновляется.

Версию нужно синхронно изменить в `package.json` и
[`src/version.ts`](../../src/version.ts), после чего создать аннотированный тег.

## Definition of done для изменения

- публичный контракт и error semantics определены;
- сохранено направление зависимостей к потоковому ядру;
- добавлены тесты на happy path и соответствующий класс ошибки;
- `npm run check` проходит;
- при изменении поведения обновлены README, профильная страница wiki и
  предметный документ в `docs`;
- изменения API/JSON, требующие миграции потребителей, явно отмечены как
  breaking.
