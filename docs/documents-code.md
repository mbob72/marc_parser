# Ответственность кода импорта документов

[Основной сценарий на сервере](documents-server-run.md) · [Команды контейнера](container-commands.md).

[Команды и контракты данных](documents-import.md) · [Docker и доставка](documents-deployment.md).
Новые модули не заменяют MARC-ядро. CLI выбирает этап; worker запускает CLI как отдельный
процесс; общий abis-deploy-watch доставляет образы.

Нормальная передача управления: `documentsMain` ждёт `prepareDocuments`, затем `prepareCopy`,
`loadCopy`, `verifyReady`. Splitter ждёт process каждой БЗ. Писатели ждут backpressure.
Ошибка данных может дать diagnostic и следующую БЗ; ошибка I/O/границ/SQL отклоняет await.
Все source/copy пакеты остаются на диске для проверки и восстановления.

<a id="database"></a>

<details>
<summary><strong>Подключение и CLI</strong><br>
databaseClient создаёт неподключённый Client с timeout 15 секунд.<br>
documentsMain отвечает за аргументы, загрузку DB_* и последовательность этапов.<br>
Каждый владелец Client закрывает его в finally; пароль не выводится.</summary>

[databaseClient](../src/documents/database.ts#L5) проверяет DB_TYPE, обязательные
DB_HOST/PORT/NAME/USER/PASS и порт. Возвращает pg.Client: connect/end — обязанность
check-db/loadCopy/verifyReady. Keepalive включён, application_name=marc-documents.
Отсутствие параметров/неверный порт — синхронное исключение до сетевого доступа;
ошибку connect принимает await вызывающего кода.

[documentsMain](../src/documents-cli.ts#L17) принимает argv, parseArgs отвергает неизвестные
опции; проверяет команду, обязательные пути и enum format/policy. Возвращает Promise<void>.
check-db создаёт/закрывает Client; prepare/prepare-copy не читают .env;
load/ready/run читают только DB_* через parseEnv. Run создаёт новый корневой output,
передаёт вложенные пути этапам, публикует ready.json только после успешного verifyReady.
Верхний catch выводит String(error), устанавливает process.exitCode=1;
запуск help не читает файлы и БД. CLI не исполняется при импорте модуля тестом.

</details>

<a id="prepare"></a>

<details>
<summary><strong>prepareDocuments и callbacks</strong><br>
Один callback process на БЗ; await сериализует parser/validator/запись gzip.<br>
closeBatch завершает пакет и публикует progress; manifest только после EOF.<br>
Ошибка конкретного parse пропускается; ошибка потока запрещает complete manifest.</summary>

[prepareDocuments](../src/documents/prepare.ts#L38) получает PrepareOptions;
возвращает source manifest. До обработки проверяет library/batchSize/file, создаёт новый
каталог и diagnostic fd. Parser/validator/serializer — существующие модули этого проекта.

`processor.process(bytes,context)` увеличивает processed, вызывает parseForImport.
Его catch охватывает только parse: сохраняет parse message/rawBase64, увеличивает parsingErrors
и возвращает управление splitter. null — deleted; иначе validate, serialize, diagnostic
для validation. Identity/NUL/reject решают экспорт; остальные ошибки уходят в pipeline.
Писатель создаётся лениво для очередного пакета, write ожидается, records/exported увеличиваются;
на batchSize вызывается closeBatch. Это место передачи управления splitter, а не независимый
цикл чтения. Пакет не держит массив всех БЗ в памяти.

`closeBatch()` принимает состояние текущего writer, ждёт finish, rename, добавляет batch
metadata; обнуляет writer и пишет progress.json, emitEvent. Ошибка завершения оставляет
.partial, не добавляет успешный manifest. Callback пустого Writable потребляет выдачу
splitter: обработка уже выполнена в processor; повторного учёта записей здесь нет.

Tar callbacks ограничивают stderr последними 4000 символами, error/close завершают tarDone;
его catch сохраняет tarFailure, чтобы не было unhandled rejection во время pipeline.
После pipeline tarDone обязательно ожидается и ошибка проверяется. При сбое tar получает
SIGTERM, writer abort ожидается, failed.json сохраняет counts/message, diagnostic fd закрывается.
При успехе mtime/size сверяются, final manifest содержит version/complete/sample/libraryCode,
archiveSha256/input/member/parserVersion/encoding/inputFormat/validationPolicy/counts/batches.
ParserVersion — версия приложения, не SHA Git; при CI точный SHA находится в OCI labels.

Счётчики, ранние выходы, сохранность удалённых БЗ и ограничения подготовки описаны в
[политике обработки](documents-import.md#prepare).

</details>

<a id="events"></a>
<a id="digest"></a>
<a id="nul"></a>

<details>
<summary><strong>emitEvent, fileDigest, hasNul</strong><br>
События — одна строка JSON в stdout с UTC time/event.<br>
SHA считается потоково без чтения всего файла в память.<br>
NUL проверяется в строках, массивах, ключах и значениях объектов.</summary>

[emitEvent](../src/documents/copy-packages.ts#L53) принимает event/details и пишет JSONL.
Используют prepare/copy/load; функция не ждёт stdout drain, поэтому частота ограничена
уровнем пакетов/heartbeat. Машинные timestamps — UTC ISO, не локальное время сервера.

[fileDigest](../src/documents/copy-packages.ts#L62) принимает path,
возвращает sha256/bytes. Цикл for await получает чанки createReadStream, обновляет hash/count,
завершается на EOF; ошибка чтения отклоняет Promise, SHA не возвращается.
Потребители — подготовка исходника, load и ready проверки gzip.

[hasNul](../src/documents/copy-packages.ts#L76) принимает JSON-подобное значение,
возвращает boolean; рекурсивные callbacks some останавливаются на первом NUL.
Буквальная строка обратного слеша `\\u0000` не равна NUL. Циклические объекты не
поддерживаются; реальные потребители передают сериализуемые/JSON.parse объекты.

</details>

<a id="uncompressed"></a>
<a id="source-lines"></a>

<details>
<summary><strong>Распаковка и генераторы</strong><br>
uncompressed выдаёт байтовые чанки gunzip; sourceLines выдаёт JSON-строки.<br>
Потребитель ждёт обработку текущей выдачи, затем запрашивает следующую.<br>
Ошибка gzip/UTF-8/лимита строки останавливает весь текущий этап.</summary>

[uncompressed](../src/documents/copy-packages.ts#L88) создаёт input и gunzip,
запускает pipeline и сохраняет его ошибку. For await выдаёт каждый распакованный Buffer.
Потребители: sourceLines, load chunks и ready chunks. При продолжении генератора читается
следующий chunk; gunzip может заранее заполнить внутренний буфер. В finally оба потока
destroy и completion ожидается, в том числе при досрочном возврате потребителя.
Ошибки input/gzip доходят до потребителя; здесь не создаются файлы на диске.

[sourceLines](../src/documents/copy-packages.ts#L108) принимает gzip path/hash;
каждый chunk обновляет SHA исходных несжатых JSON-байтов. Pending хранит хвост строки;
внутренний while ищет LF, fatal UTF-8 decoder декодирует целую строку, limit 32 MiB
ограничивает как завершённую строку, так и pending. Потребитель prepareCopy делает
JSON.parse, проверки и две записи; после его await генератор продолжает поиск LF.
Последний pending без LF выдаётся обычной строкой, не финальным маркером.
EOF не выдаёт отдельное значение; hash.digest вызывается prepareCopy после завершения.

| Точка yield | Потребитель | Что происходит до следующего запроса |
|---|---|---|
| uncompressed: chunk gunzip | sourceLines | Hash, выделение одной или нескольких строк |
| uncompressed: chunk gunzip | load/ready chunks | Hash/bytes, дальнейшая выдача COPY |
| sourceLines: строка до LF | prepareCopy | JSON.parse, validation shape, CSV/write |
| sourceLines: pending на EOF | prepareCopy | Та же обработка последней строки |
| load/ready chunks: Buffer | Readable.from → COPY pipeline | COPY принимает байты с backpressure |

</details>

<a id="writer"></a>
<a id="copy-row"></a>

<details>
<summary><strong>compressedWriter и COPY CSV</strong><br>
write собирает блок около 1 MiB; gzip level=1 и два SHA.<br>
finish ждёт завершения pipeline; abort освобождает потоки.<br>
copyRow сохраняет NULL, кавычки, табуляции и переводы строк.</summary>

[compressedWriter](../src/documents/copy-packages.ts#L134) создаёт gzip, meter Transform
и файл flags=wx; возвращает lifecycle write/finish/abort. Вызывающий слой отвечает
за rename .partial и вызов abort при ошибке. Pipeline catch сохраняет failure.
Meter callback считает сжатые bytes/hash и передаёт chunk без изменения.
`flush` объединяет накопленные Buffer, очищает pending/size, ждёт drain при backpressure,
проверяет failure. Блок может быть больше 1 MiB, если последняя строка крупная.
`write` считает несжатые bytes/hash, добавляет Buffer, при пороге ждёт flush.
`finish` flush, gzip.end, await completion, возвращает bytes/sha256/copyBytes/copySha256.
`abort` destroy gzip и ждёт completion. После finish/abort повторное write не поддерживается.
Ошибки диска/gzip отклоняют await; partial файл автоматически не удаляется.

[copyRow](../src/documents/copy.ts#L3) получает массив string/number/null,
возвращает одну строку COPY CSV с TAB delimiter и LF terminator. NULL — некавыченный
`\N`, остальные значения полностью quoted, `"` удваивается. JSON fields передаются строкой;
экранирование CSV отличается от COPY text, поэтому load использует FORMAT csv.
Встроенный LF внутри quoted value не является границей SQL-строки.

</details>

<a id="manifest"></a>
<a id="copy-prepare"></a>

<details>
<summary><strong>Manifest и prepareCopy</strong><br>
readSourceManifest проверяет источник; readCopyManifest — загрузочный контракт v1.<br>
prepareCopy проверяет source SHA/count и создаёт documents/ids gzip-пакеты.<br>
Загрузчик читает documents-пакеты; ids-пакеты сохранены для совместимости.</summary>

[readSourceManifest](../src/documents/copy-packages.ts#L196) читает manifest.json,
проверяет complete=true/sample=false, библиотеку, archiveSha256, batches, exported integer;
имена только part-N.aleph.ndjson.gz, SHA/records и уникальность имён.
Сумма batch.records должна совпадать с counts.exported. Не проверяет содержимое файлов:
это ответственность prepareCopy. Ошибка — исключение до mkdir output.

[readCopyManifest](../src/documents/load-copy.ts#L15) проверяет version=1,
полный несэмплированный непустой набор, columns строго line/system_number/leader/format/fields;
библиотеку, archiveSha256, имена source/documents files, source/compressed/uncompressed SHA,
положительные безопасные records/bytes/copyBytes и суммарные records.
Потребители load/ready. ids metadata не проверяется/не читается ими; оно используется
только как дополнительный совместимый артефакт. Manifest не является криптографической
подписью: SHA выявляет повреждение пакетов относительно доверенного manifest.

[prepareCopy](../src/documents/copy-packages.ts#L236) получает input/output,
optional limit и reserveBytes. Проверяет параметры, source manifest, создаёт новый output.
Внешний for последовательно обрабатывает source batches; перед каждым — statfs reserve.
Для текущего пакета два writer и source hash, records; внутренний for await читает JSON,
проверяет identity/shape/NUL, ждёт CSV writer и ids writer. Затем finish обоих,
SHA/count source, rename, metadata/event. Ошибка abort обоих через allSettled и throw;
полный manifest не публикуется, завершённые файлы могут остаться.

SourceBatch: file/sha256/records (SHA несжатых JSON). CopyBatch добавляет file/bytes/sha256
сжатого COPY, copyBytes/copySha256 несжатого, idsFile и аналогичные hashes/sizes.
SourceManifest/CopyManifest — контракты производителей и потребителей, не сами validators.
Limit создаёт sample=true/complete=false; load/ready его отвергают. CLI limit для
prepareCopy не выставляет: он обрабатывает весь source. Публикация manifest через .partial
и rename означает завершённый набор; не незавершённый progress.

</details>

<a id="schema"></a>
<a id="merge"></a>

<details>
<summary><strong>Каталог БД и merge</strong><br>
Schema-функции проверяют контракт до COPY, public.documents не создают.<br>
mergeCopy принимает client открытой транзакции и metadata пакета.<br>
UUID, inserts, конфликты и batch journal записываются этой же транзакцией.</summary>

[inspectTable](../src/documents/schema.ts#L14) получает Client/name,
читает pg_catalog с параметром to_regclass; собирает columns и constraints,
проверяет relkind и USAGE/SELECT/INSERT. Возвращает metadata, не соединяется/не закрывает Client.
[requireDocuments](../src/documents/schema.ts#L46) проверяет supplied columns,
длины и extra defaults; [requireIdentities](../src/documents/schema.ts#L101)
проверяет типы/NOT NULL и unique constraints. Циклы перечисляют ожидаемые колонки,
останавливаются на первом несовместимом контракте, без автоматической миграции.
[initializeImport](../src/documents/schema.ts#L129) выполняет CREATE IF NOT EXISTS
служебных таблиц и requireIdentities; вызывается load после BEGIN, DDL также откатывается
при dry-run/ошибке. Совместимость существующих journal columns выясняется последующим SQL.

[mergeCopy](../src/documents/merge-copy.ts#L6) записывает metadata через параметры
в temp import_context, без интерполяции входных строк. Затем SQL ANALYZE, advisory/table locks,
проверка неоднозначных документов/UUID. CREATE missing ids, вычисление batch_result,
запись issues для отличающихся leader/format/fields, вставка отсутствующих documents
с UUID ids, финальный журнал. Возвращает Promise<void>; не делает BEGIN/COMMIT и не
пишет локальные отчёты. Обязанности вызывающего load: валидный manifest, COPY table,
транзакция, чтение batch_result и commit/rollback. Ошибка SQL отклоняет await,
транзакцию откатывает load finally. Детали [загрузки и восстановления](documents-import.md#load).

[loadCopy](../src/documents/load-copy.ts#L70) владеет Client, report fd, timer и COPY.
Read manifest/проверка диапазона — до подключения; report wx — до connect.
Connection error callback сохраняет ошибку, destroy активного COPY, event.
Waiting timer раз в 10 секунд выдаёт phase/file/bytes, unref не удерживает процесс.
Цикл пакетов проверяет journal; пропуск откатывает пустую транзакцию и учитывает conflicts.
Для нового пакета chunks generator ждёт gunzip, считает bytes/hash, yield отдаёт COPY pipeline.
После COPY — count, merge, batch_result, COMMIT/ROLLBACK и запись отчёта.
После цикла обновляет serial sequence под lock, пишет finished и отказывает при conflicts>0.
Finally снимает timer, пытается ROLLBACK, закрывает Client/report; session locks освобождаются
при закрытии Client. Потеря соединения не вызывает бесконечных retries.

[verifyReady](../src/documents/ready.ts#L16) — отдельный владелец Client:
весь набор в одной транзакции, temp table на пакет, matching запрос, DROP temp.
Не создаёт служебную схему и требует journal. Ошибка приводит к ROLLBACK/end,
готовый результат возвращается только после проверки всех пакетов.

</details>

<a id="control"></a>
<a id="worker"></a>
<a id="worker-cli"></a>

<details>
<summary><strong>Unix-сокет и жизненный цикл worker</strong><br>
request/serve ограничивают JSON-протокол и время ожидания.<br>
Worker сериализует команды и хранит task/status/log/report.<br>
Дочерний CLI получает сигналы отмены; рестарт не повторяет interrupted задачу.</summary>

[saveJson](../src/runtime/control.ts#L8) получает path/value, writeFile temporary
с mode=600, rename. Вызывающий слой создаёт parent directory. Ошибка сериализации/диска
отклоняет Promise; fsync/гарантии power-loss отсутствуют.
[request](../src/runtime/control.ts#L18) создаёт Unix connection, отправляет JSON+LF,
собирает response до LF, проверяет ok/result либо отклоняет error. Data/timeout/error/end
callbacks ограничивают 64 KiB, 10 секунд и незавершённый ответ; Client socket закрывается.
[serve](../src/runtime/control.ts#L51) проверяет отсутствие активного server, удаляет
только stale socket, listen/chmod600. Connection data callback принимает одну строку;
queue сериализует handle(message), ответ {ok,result} или {ok:false,error}.
Returned close ждёт server.close и удаляет socket. Это локальный доступ по правам файла,
не сетевой HTTP API и не механизм авторизации PostgreSQL.

[startWorker](../src/runtime/worker.ts#L32) принимает work/source/env/image/optional launch
(test dependency). mkdir control/reports, проверка активного socket, чтение предыдущего
worker.json; running → interrupted с finishedAt. Task поля:
id/stage/input/dryRun/image/startedAt/finishedAt/exitCode/signal/status/log/report.
Image записывается из настройки, фактический Docker image ID отдельно показывает docker inspect.

Вложенный exclusive сериализует операции через Promise chain и сохраняет возможность
новой команды после отказа предыдущей. state создаёт snapshot; persist ждёт saveJson
текущего состояния и истории task. Handle callbacks status/drain/resume/stop/start
изменяют только lifecycle; start валидирует stage, dryRun, realpath и тип input,
формирует args, открывает log600, сохраняет running, затем spawn CLI с fd для stdout/stderr.
Одновременно только один child. Close callback фиксирует failed/cancelled/completed,
закрывает log, пишет историю, снимает cancellation timer, сбрасывает child и persist.
Ошибка сохранения состояния запрещает новые задачи и выдаёт worker_state_error.
Возвращаемый close прекращает приём, сигналит child, ждёт done и закрывает server.

[worker CLI main](../src/documents-worker-cli.ts#L7) разбирает server/команду;
server ждёт startWorker, публикует worker_ready и регистрирует SIGTERM/SIGINT stop callback
с защитой от повторного закрытия. Остальные команды ждут request и печатают JSON.
Ошибки → stderr и exitCode1. Настройки CLI и операционный сценарий:
[worker start/status/stop](documents-deployment.md#worker-start).

</details>

<a id="packaging-sequence"></a>

<details>
<summary><strong>Ручная сборка и последовательный импорт</strong><br>
Упаковщик копирует код по allowlist без конфигурации БД.<br>
Сценарий ждёт результат документов и проверку ready перед запуском связей.<br>
Образы доставляет общий abis-deploy-watch.</summary>

[упаковщик](../scripts/package-documents-container.mjs#L10) создаёт новый output,
копирует allowlist файлов и src/docker, не .env. [Сценарий двух конвейеров](../scripts/run-documents-before-relations.mjs#L10)
имеет exec (spawn Docker, bounded JSON output, ошибка exit/parse) и waitTask
(проверка task.id/status, delay между запросами); все этапы ожидаются по порядку.
Он запускает только известные Node CLI с массивом аргументов, без shell-интерполяции.

</details>
