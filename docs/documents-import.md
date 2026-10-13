# Подготовка и импорт документов перед БЗ–БЗ

**Запуск на сервере: [пошаговый сценарий Docker](documents-server-run.md).**
[Справочник команд контейнера](container-commands.md). Ниже — контракты этапов и данных;
примеры прямого Node CLI предназначены для разработки и отдельных операций.

Конвейер читает Z00/MARC, готовит проверяемые gzip-пакеты, наполняет `public.documents`
и `z103_import.document_ids` в одной PostgreSQL. UUID существующих документов и справочника
сохраняются. После загрузки `ready` сравнивает пакеты с реальной БД.

Маршрут: CLI → splitter → parser.parseForImport → validator → serializer → gzip NDJSON →
COPY-пакеты → временная SQL-таблица → UUID/документы/журнал → проверка готовности → импорт Z103.
[Контракты функций](documents-code.md) · [Контейнер и сервер](documents-deployment.md).

<a id="commands"></a>

<details>
<summary><strong>Команды и параметры</strong><br>
По умолчанию: RSL01, aleph-sequential, utf-8, пакет 50 000 БЗ.<br>
validation-policy=reject; .env нужен только check-db/load/ready/run.<br>
prepare и prepare-copy требуют новых каталогов; load требует нового файла отчёта.</summary>

[documentsMain](../src/documents-cli.ts#L17) разрешает ровно одну команду:

| Команда | Вход и результат | Работа с БД |
|---|---|---|
| `check-db` | Проверяет типы/права/ограничения documents и document_ids | Только каталог; справочник должен существовать |
| `prepare` | `--input FILE --output DIR`, optional `--member NAME` для tar.gz | Нет |
| `prepare-copy` | `--input SOURCE_DIR --output COPY_DIR` | Нет |
| `load` | `--input COPY_DIR --report FILE`, optional `--dry-run` | COPY и merge по пакету |
| `ready` | `--input COPY_DIR` | Сверка журнала, содержимого и UUID |
| `run` | `--input FILE --output NEW_DIR`, optional `--member NAME` | Все этапы по порядку |

Примеры из корня проекта, после `npm run build`:

```bash
node dist/documents-cli.js check-db --env .env
node dist/documents-cli.js prepare --input /data/rsl01_z00.dat --output /work/source-run
node dist/documents-cli.js prepare-copy --input /work/source-run --output /work/copy-run
node dist/documents-cli.js load --input /work/copy-run --report /work/dry.ndjson --dry-run
node dist/documents-cli.js load --input /work/copy-run --report /work/load.ndjson
node dist/documents-cli.js ready --input /work/copy-run
```

Для архива и полного конвейера:

```bash
node dist/documents-cli.js run --input /data/rsl01_z00.dat.tar.gz \
  --member rsl01_z00.dat --output /work/run-new --env .env
```

`--format iso2709` выбирает ISO; автоматического определения в серверном CLI нет.
Для ISO идентификатор берётся из единственного 001, для Aleph — из первой колонки Z00.
Нужны девять цифр и ненулевой номер. `--library` допускает 1–6 заглавных букв/цифр;
для конвейера связей БЗ–БЗ используется RSL01. `--encoding` применяется к MARC;
подготовленные JSON/COPY всегда UTF-8.

`--start-batch` — номер начиная с 1, `--max-batches` ограничивает число пакетов в `load`.
Успех ограниченной загрузки не означает готовность всех документов: нужен отдельный `ready`.
`--reserve-bytes` по умолчанию 2147483648; перед каждым COPY-пакетом проверяется свободное
место. Это нижний порог, а не оценка потребности всего импорта. `run` создаёт `source/`,
`copy/`, `load.ndjson` и, только после реального успешного импорта и сверки, `ready.json`.
Для возобновления используются готовые `copy/` и новый `--report`, а не повтор `run`
в прежний каталог. `--dry-run` откатывает каждый пакет; `ready.json` не создаётся.

</details>

<a id="prepare"></a>

<details>
<summary><strong>Путь записи и политика ошибок</strong><br>
DEL$a=Y пропускается; служебные буквенные поля исключаются ядром.<br>
reject исключает запись с ошибками MARC; preserve сохраняет её без исправления.<br>
Ошибка выделения границ останавливает подготовку, manifest не публикуется.</summary>

[prepareDocuments](../src/documents/prepare.ts#L38) использует существующие
splitter/parser/validator/serializer, без второй реализации MARC.
Файл сначала хешируется, затем читается потоково; для tar.gz `tar -xOzf` выдаёт
только выбранный `--member`, без распаковки полного Z00 на диск. `tar` должен присутствовать
в окружении (есть в стандартном Debian-образе Node). Код возврата tar проверяется.
Размер и mtime файла проверяются после обработки; это выявляет обычную подмену источника,
но не гарантирует неизменность при сохранении обоих атрибутов внешним процессом.

Обычный файл читается с highWaterMark 64 KiB; для tar источником является stdout
дочернего процесса со своей буферизацией. Границы чанка и БЗ не совпадают.
Splitter ждёт `process(bytes, context)` перед следующей записью. Контекст содержит
нулевой `recordIndex` и исходный `byteOffset`, включая удалённые/отклонённые записи.
Ветка parser `null` учитывает удаление без MARC-валидации. Ошибка разбора уже выделенной
записи записывается с rawBase64 и допускает следующую запись; ошибка самого splitter
останавливает поток, поскольку границы следующей записи неизвестны.

Проверка MARC выполняется до сериализации. При reject запись с ошибками не экспортируется;
при preserve ошибки остаются в diagnostics, запись экспортируется, если её форма совместима
с PostgreSQL. NUL в реальных строках/ключах JSON и недопустимый номер всегда исключаются.
Ошибки размеров leader/format и формы подготовленного JSON останавливают prepare-copy,
а не приводят к усечению данных. Отсутствующий 001 в Aleph не мешает использованию номера
первой колонки. Совпадение номера первой колонки с 001 отдельно не проверяется.

NDJSON содержит `recordId`, `leader`, `format`, `fields`, `source` с исходным контекстом.
COPY содержит `line` (номер JSON-строки пакета с 1), `system_number`, `leader`, `format`,
`fields`; `source` остаётся в NDJSON. SQL-ошибка локализуется по имени sourceFile и line,
затем исходный контекст берётся из той же строки NDJSON. Файл `.aleph.ndjson.gz` —
унаследованное имя формата пакетов; для ISO исходный формат указан в source manifest.

| Счётчик | Смысл |
|---|---|
| processed | Выделенные записи, для которых начался process |
| deleted | Пропущены по DEL |
| parsingErrors | Ошибка разбора выделенной записи; диагностируется и пропускается |
| validationRecords | Записи с ошибками MARC, в том числе экспортированные при preserve |
| rejected | Исключены по identity/NUL/reject; parsingErrors и deleted сюда не входят |
| exported | Строки опубликованных NDJSON-пакетов при успехе |

При успешной подготовке `processed = deleted + parsingErrors + rejected + exported`.
`validationRecords` пересекается с rejected/exported, его нельзя прибавлять к этим счётчикам.
Ошибка splitter не получает recordIndex из process: её текст содержит смещение, если ядро
его сообщает; общая причина и текущие counts сохраняются в `failed.json`.
Диагностика: kind=parse/validation/invalid_identity/postgres_nul/validation_rejected.
У parse есть message/rawBase64; у validation — errors с исходными кодами правил.

`progress.json` отражает завершённые пакеты. `.partial` остаётся следом незавершённого
пакета. `manifest.json` появляется только после EOF, проверки источника и завершения gzip.
Подготовка после сбоя начинается в новом каталоге; автоматического продолжения парсинга нет.
Исключённые записи не удаляют существующие документы из БД. Конвейер предназначен для
добавления документов из выгрузки; применение удалений и обновление конфликтов не реализованы.

</details>

<a id="schema"></a>

<details>
<summary><strong>Контракт PostgreSQL</strong><br>
public.documents создают миграции АБИС; загрузчик её не меняет.<br>
document_ids: text library_code, bigint system_number, uuid id — NOT NULL.<br>
Уникальны UUID и пара library_code/system_number; БД общая с импортом Z103.</summary>

[requireDocuments](../src/documents/schema.ts#L46) проверяет обычную/секционированную
table, USAGE/SELECT/INSERT; id uuid, system_number integer, fields jsonb;
library_code varchar≥6/text, leader varchar≥25/text, format varchar≥5/text.
UUID должен иметь ограничение PRIMARY KEY/UNIQUE. Поставляемые колонки не должны быть
generated. Остальные обязательные колонки требуют default либо generated.

`initializeImport` создаёт только схему и служебные таблицы, если их нет; существующий
справочник сохраняет. `requireIdentities` проверяет контракт связей и права чтения/вставки.
Права CREATE на служебную схему/таблицы нужны при их отсутствии; ограничения/права журналов
и права serial sequence проверяются непосредственно PostgreSQL при выполнении операций.
Требования к UUID-default documents нет: id передаётся явно.

БД берётся из `DB_TYPE`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS` файла `--env`.
Применяются только DB_*; остальные параметры этого файла не меняют окружение процесса.
DB_TYPE postgres/postgresql, порт 1–65535; host может быть каталогом Unix-сокета.
В контейнере localhost — сам контейнер; для серверной PostgreSQL предпочтительны серверный
сетевой адрес или socket `/var/run/postgresql`, подключённый bind mount.

</details>

<a id="load"></a>

<details>
<summary><strong>COPY, UUID и восстановление</strong><br>
Пакет, новые UUID, документы и журнал фиксируются одной транзакцией.<br>
Идентичные БЗ пропускаются; конфликт сохраняется, исходная БЗ не меняется.<br>
Повтор использует COMMIT-журнал; конфликт запрещает успешный итог.</summary>

[loadCopy](../src/documents/load-copy.ts#L70) принимает полный несэмплированный manifest v1.
Число записей, имена пакетов и SHA проверяются до работы. Перед COPY проверяются SHA/размер
сжатого файла; во время COPY — SHA/размер несжатых байтов; затем SQL-count пакета.
Ошибка любой проверки откатывает текущий пакет. Завершённые ранние пакеты сохраняются.

Temporary table `document_incoming` содержит PRIMARY KEY(system_number): повтор номера
внутри пакета останавливает COPY. Между пакетами равное содержимое сравнивается как уже
существующая БЗ; различающееся становится конфликтом. Глобального отклонения всех одинаковых
повторов нет. Существующий номер в documents с несколькими БЗ считается неоднозначным,
merge останавливается. Сравниваются только leader/format/fields; hidden/meta/timestamps
сохраняются и не входят в сравнение.

[mergeCopy](../src/documents/merge-copy.ts#L6) назначает UUID в порядке:
существующий document_ids → UUID существующей documents → gen_random_uuid для новой БЗ.
Несовпадение UUID между существующими таблицами останавливает пакет. После этого inserts
documents используют UUID справочника. Конфликтное содержимое сохраняется в
`document_issues(code=existing_conflict,record=JSON text)`; результат inserted/identical/conflicts
записывается в `document_batches`. При конфликте журнал всё равно фиксируется вместе
с бесконфликтными inserts; итоговая команда завершается с ошибкой. Повтор также видит
конфликт из журнала и не объявляет успех. Разрешение конфликта — отдельное решение,
автоматического удаления отметки или перезаписи документов нет.

Сохраняются прежние таблицы `document_batches(archive_sha,file,sha,report)` и
`document_issues(archive_sha,file,line,code,record)`. archive_sha — SHA исходного архива/файла,
file — имя NDJSON-пакета, sha — SHA его несжатых JSON-строк. Это позволяет использовать
прежние пакеты и журналы RSL01. Без libraryCode старый manifest трактуется как RSL01.
Наборы с одним archive_sha и одинаковыми именами пакетов, но другим SHA/library, отклоняются;
для независимых библиотек одного многокомпонентного архива нужен раздельный источник.

Загрузчик удерживает shared advisory lock `z103_import.pipeline` и exclusive
`z103_import.documents.loader`; merge — transaction advisory lock
`z103_import.document_ids.merge`, затем SHARE ROW EXCLUSIVE на ids и documents.
Эти table locks совместимы с контрактом импортёра связей, который берёт SHARE на ids.
Они защищают короткую часть merge; COPY идёт до них. Параллельные изменения АБИС могут
задержать merge (lock_timeout 60 секунд); они не превращаются в пропуски.

После реальной загрузки serial sequence поднимается до max(system_number) или текущего
nextval, под блокировкой documents. setval не является транзакционным откатом последовательности;
dry-run его не вызывает. Ошибка на этом финальном шаге не отменяет COMMIT ранних пакетов.
Следующий load с новым отчётом пропустит пакеты и повторит завершение.

JSONL-отчёт: batch_committed/batch_rolled_back с inserted/identical/conflicts/bytes/elapsedMs;
finished с суммами новых операций, skipped, selectedBatches, dryRun.
У пропущенных пакетов conflicts учитывается, inserted/identical повторно не суммируются.
Stdout также содержит batch_start/copy_done/batch_skipped/waiting/failed/connection_error.
Запись журнала БД после COMMIT — основание для восстановления, даже если локальный отчёт
не успел записаться. SQL/файловые ошибки дают exit code 1; схемные/UUID-ошибки не имеют
отдельной структурированной записи document_issues: причина остаётся в логе/failed event.

</details>

<a id="ready"></a>

<details>
<summary><strong>Готовность к импорту связей</strong><br>
Проверяются все пакеты: журнал без конфликтов, hashes/counts, содержимое и UUID.<br>
ready.json — результат проверки в момент checkedAt, не вечная гарантия.<br>
Сценарий запуска выполняет свежий ready перед стартом Z103.</summary>

[verifyReady](../src/documents/ready.ts#L16) читает каждый COPY-пакет в temp table,
проверяет hashes/bytes/counts и требует ровно одну соответствующую БЗ в documents,
совпадающую с UUID справочника и leader/format/fields. Все пакеты должны быть в журнале
с соответствующим source SHA, библиотекой и conflicts=0. Ограниченный load этого не заменяет.
Одна транзакция со SHARE locks на ids и documents удерживает согласованное состояние;
временные таблицы откатываются, рабочие данные не меняются. На большой базе проверка
повторно читает все COPY-пакеты и может надолго блокировать записи в обе таблицы.

Ready относится только к экспортированным записям набора. Исключённые по DEL, parse,
NUL или reject не включены. Полноту справочника для конкретного Z103 по-прежнему проверяет
анализ проекта связей: ready не читает Z103 и не обещает наличия всех его номеров.
Для сохранения записей с ошибками MARC нужно явно выбрать preserve ещё при подготовке.
Нулевой результат подготовки не считается пригодным набором для load.

</details>
