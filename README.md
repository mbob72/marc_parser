# MARC Parser

Двусторонний консольный конвертер MARC 21 / ISO 2709 и MARC-JSON РГБ с
потоковой обработкой, валидацией записей и продолжением работы после локальных
ошибок парсинга. В направлении к JSON также автоматически распознаются
табличные выгрузки Aleph sequential РГБ (`Z00`: девятизначный номер записи,
табуляция и поля с префиксом длины).

## Использование

```text
marc-parser <входной-файл> <выходной-файл> [кодировка] [--to-json|--to-iso] [--log]
```

Пример:

```bash
marc-parser records.mrc records.json utf-8
marc-parser rsl06_z00.dat rsl06.json utf-8
```

Фактические имена результатов: `records.iso.json` и `rsl06.aleph.json`.
Маркер исходного контейнера обязателен для обратного преобразования.

Несколько записей записываются как NDJSON: один компактный JSON-объект на
строку, без внешнего массива. Обратное преобразование:

```bash
marc-parser records.iso.json restored.mrc utf-8 --to-iso
marc-parser rsl06.aleph.json restored.dat utf-8 --to-iso
```

В Aleph-JSON добавляется только девятизначный `recordId` из первой колонки
Z00; исходная строка или её base64-копия не дублируется. Если хотя бы одна
запись не разобрана, имя результата получает префикс `pErrors_`.

Доступные служебные параметры:

```text
--log          выводить результат валидации каждой записи
--to-json      ISO 2709/Aleph sequential → MARC-JSON/NDJSON (по умолчанию)
--to-iso       MARC-JSON/NDJSON → контейнер из маркера имени
-h, --help     показать справку
-v, --version  показать версию программы
```

## Разработка

Требуется Node.js 24 и npm.

```bash
npm ci
npm run check
```

Локальная сборка standalone-бинарника использует зафиксированную в
`devDependencies` версию Bun:

```bash
npm run build:binary
npm run smoke:binary
```

Готовый файл создаётся как `release/marc-parser`.

## Сервер с очередью

В репозитории есть асинхронный сервис конвертации:

- `api` потоково загружает MARC/ISO или Aleph sequential файл в MinIO и
  создаёт задание;
- RabbitMQ доставляет задания workers с подтверждением обработки;
- `worker` скачивает исходный файл, запускает тот же двусторонний потоковый
  конвертер и сохраняет результат в MinIO;
- PostgreSQL хранит статус, статистику и текст ошибки.

После исчерпания попыток сообщение попадает в очередь
`marc.convert.dead`, а статус задания становится `failed`.

Для локального запуска нужны Docker и Docker Compose:

```bash
docker compose up --build -d
docker compose ps
```

Полная пошаговая инструкция по запуску, проверке конвертации, работе с
очередями и диагностике: [docs/Docker.md](docs/Docker.md).

Алгоритм профиля РГБ, источник `format` из служебного `FMT`, правила NDJSON и
пересчёт ISO 2709 описаны в
[документе по двусторонней конвертации](docs/Алгоритм%20двусторонней%20конвертации%20MARC%20РГБ.md).
Полный реестр 143 записей с ошибками валидации приведён в
[отчёте по реальным выгрузкам](docs/Ошибки%20валидации%20реальных%20выгрузок.md).

API будет доступен на `http://localhost:3000`. Загрузить файл:

```bash
curl -F file=@rsl06_z00.dat -F encoding=utf-8 \
  http://localhost:3000/jobs
```

В сервисе по умолчанию выбран актуальный контейнер выгрузок РГБ —
`aleph-sequential`. Для входного ISO 2709 формат нужно указать явно:

```bash
curl -F file=@records.mrc -F encoding=utf-8 -F format=iso2709 \
  http://localhost:3000/jobs
```

Для обратного преобразования передайте маркированный JSON и направление:

```bash
curl -F file=@records.iso.json -F encoding=utf-8 \
  -F direction=json-to-iso http://localhost:3000/jobs
```

Файл `records.aleph.json` при том же `direction` возвращается как Aleph
sequential `.dat`. Немаркированные `*.json` намеренно отклоняются.

API сразу отвечает `202 Accepted` и возвращает `jobId`. Проверить статус:

```bash
curl http://localhost:3000/jobs/<jobId>
```

После перехода задания в `completed` скачать результат:

```bash
curl -OJ http://localhost:3000/jobs/<jobId>/result
```

Задание и связанные с ним объекты MinIO хранятся сутки. Сборщик запускается
при старте API и затем каждые 12 часов. Завершённое или упавшее задание можно
удалить раньше вручную:

```bash
curl -X DELETE http://localhost:3000/jobs/<jobId>
```

Внеплановый проход сборщика запускается отдельным методом:

```bash
curl -X POST http://localhost:3000/maintenance/cleanup
```

Метод возвращает числа просмотренных, удалённых и не удалённых из-за ошибок
заданий в полях `scanned`, `deleted` и `failed`.

Дополнительные локальные интерфейсы:

- RabbitMQ Management: `http://localhost:15672`, логин/пароль `marc`;
- MinIO Console: `http://localhost:9001`, логин `marc`, пароль
  `marc-secret`.

Перечень настроек приведён в `.env.example`. Учётные данные из `compose.yaml`
предназначены только для локальной разработки; при развёртывании их нужно
передавать через secrets. Число одновременно обрабатываемых заданий задаётся
через `WORKER_CONCURRENCY`, а число попыток — через `JOB_MAX_ATTEMPTS`.

Остановить сервисы:

```bash
docker compose down
```

Добавление `-v` удалит также локальные данные PostgreSQL, RabbitMQ и MinIO.

## Выпуск версии

Версия Git-тега должна совпадать с `version` в `package.json`. Например, для
версии `0.1.0`:

```bash
git tag -a v0.1.0 -m "MARC Parser 0.1.0"
git push origin v0.1.0
```

Тег запускает GitHub Actions workflow, который:

1. проверяет соответствие тега версии пакета;
2. запускает сборку и тесты на Linux, Windows и macOS;
3. собирает и проверяет четыре standalone-бинарника;
4. создаёт ZIP/TAR.GZ, SHA-256 checksums и build provenance;
5. публикует GitHub Release только после успешного завершения всех сборок.

macOS-бинарники пока имеют ad-hoc подпись, а Windows-бинарник не подписан
сертификатом издателя. Поэтому при первом запуске операционная система может
показать предупреждение безопасности. Скачивайте файлы только со страницы
Releases этого репозитория и сверяйте их с `SHA256SUMS`.
