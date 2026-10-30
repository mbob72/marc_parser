# Публикация готовых БЗ в public_26_10.documents

`documents publish` переносит `import.bib_records WHERE accepted` в отдельную
прикладную таблицу, сохраняя UUID и все десять полей `documents`. Сырые DAT и
подготовленные файлы заново не читаются; `bib_ids` не создаётся.

Маршрут: worker принимает publish → CLI валидирует аргументы и DB env → publisher
проверяет завершённые источники → создаёт отсутствующую цель → INSERT SELECT по
пакетам с checkpoint → независимая пакетная сверка → completed.
Следующая загрузка ЕХ/связей начинается отдельно, после этого completed.

[Команды](#commands) · [источники](#source) · [целевая схема](#schema) ·
[алгоритм и повтор](#algorithm) · [память](#resources) · [журнал](#reports).

<a id="commands"></a>

<details>
<summary><strong>Запуск и продолжение</strong><br>
--target-schema задаёт отдельную цель; public/import/pg_* запрещены<br>
--batch-size 100000 по умолчанию; 1–100000 строк на COMMIT<br>
--resume-publication UUID продолжает с тем же образом, целью и размером пакета</summary>

Сначала подтвердите доставленный revision/digest и установите этот образ worker
по [сценарию сервера](documents-server-run.md). После idle/drain заменяется только
MARC worker; доставка образа сама по себе публикацию не запускает.

```sh
docker exec marc-documents-worker marc-documents worker status
docker exec marc-documents-worker marc-documents worker start \
  --stage publish --target-schema public_26_10 --batch-size 100000
```

start возвращает принятую task. Это не окончание переноса. Общий результат виден
в worker status и SQL `import.bib_publications`; промежуточные строки видны после
каждого COMMIT. Работа worker не зависит от SSH.

```sh
docker exec marc-documents-worker marc-documents worker start \
  --stage publish --resume-publication PUBLICATION_UUID
```

Resume наследует цель и размер пакета, если опции не переданы. Образ всегда должен
совпадать с сохранённым. Новый запуск для уже занятой цели требует явного resume;
подтверждённый completed возвращает сохранённый результат без новой записи/аудита.

Одноразовый CLI: `marc-documents documents publish --target-schema public_26_10
--env /run/db.env --image PINNED_IMAGE --report /work/reports/UNIQUE.ndjson`.
Файл отчёта должен быть новым. Неподходящие UUID/namespace/числа/unknown image и
legacy опции input/dry-run/library/member отклоняются до выполнения SQL.
Из env читаются только DB_*, чужие переменные окружения не изменяются.

</details>

<a id="source"></a>

<details>
<summary><strong>Допуск источников</strong><br>
Принятые БЗ берутся из постоянной bib_records, причины отказов остаются в import<br>
Завершённые runs, пакеты и реальные SQL-числа должны совпасть<br>
MARC JSONB fields переносится как штатная колонка, без дополнительных копий записи</summary>

Проверяется наличие завершённых `bib_record_runs`, SHA/библиотеки/числа/пакеты,
суммы `bib_record_batches` и фактическое количество accepted/rejected по источнику.
Метаданные вместе с малыми сводками закрепляются в source_manifest. Возобновление
требует точного совпадения manifest. Ключ источника `(library_code,system_number)`
уникален среди accepted; UUID имеет PK. Штатная таблица staging уже имеет эти индексы.

Срез 26.10: ожидается 17 195 741 принятая БЗ, 34 отказа сохраняются в import.
RSL02 не даёт принятых строк. RSL60 — HOL; в bib_records его строк нет, пустой run
не создаёт документа. Это ожидаемые числа из [завершённого staging](bib-staging.md),
не объявление этой публикации завершённой.

Переносятся без преобразования:

| Поле                        | Значение в target.documents                                                   |
| --------------------------- | ----------------------------------------------------------------------------- |
| id                          | UUID той же записи из bib_records                                             |
| library_code, system_number | Собственные библиотека и номер БЗ; одинаковый номер разных библиотек допустим |
| leader, format, fields      | Готовая структура MARC, включая упорядоченные поля                            |
| hidden, meta                | Исходные boolean/JSONB/SQL NULL, без подстановок                              |
| created_at, updated_at      | Исходные timestamp, включая NULL updated_at                                   |

Адреса DAT, SHA и причины отказов остаются в import. Все десять передаваемых полей
сверяются SQL-оператором ROW IS DISTINCT FROM с корректной семантикой SQL NULL.

</details>

<a id="schema"></a>

<details>
<summary><strong>Создание и проверка цели</strong><br>
Создаётся только отсутствующая изолированная documents, с десятью колонками<br>
UUID PK и UNIQUE(library_code,system_number); собственной sequence принадлежит default<br>
Существующая несовместимая цель не исправляется автоматически</summary>

Перед DDL проверяется фактическая форма bib_records. При отсутствии цели создаются
namespace, documents и её собственная integer sequence. Значения system_number
вставляются явно из источника; default не вызывает public sequence. В конце своя
sequence выставляется выше имеющегося максимума. Глобальный UNIQUE(system_number)
не используется: это потеряло бы разные библиотеки с одним номером.

Для существующей цели проверяются десять типов/NULL, права, постоянное хранение,
PK/уникальный ключ/индексы/sequence и отсутствие неподдержанных CHECK/FK/триггеров,
RLS и rules. Перед первым INSERT цель должна быть пустой. При resume допускается
собственная уже записанная часть; manifest DDL обязан совпасть. Текущее значение
sequence исключено из manifest. Основные public-таблицы не изменяются.

</details>

<a id="algorithm"></a>

<details>
<summary><strong>Один ограниченный пакет и один COMMIT</strong><br>
Ключи accepted по library_code/system_number → прямой INSERT SELECT десяти полей<br>
Полная сверка полей и checkpoint фиксируются атомарно с данными<br>
После загрузки выполняется отдельный возобновляемый проход verification</summary>

Один Client владеет exclusive `import.pipeline`, исключая другие штатные изменения
источников/публикации. Первый SELECT читает до batch-size индексных ключей после
сохранённого курсора и возвращает только количество и верхнюю границу. INSERT
читает тела MARC прямо из источника в этом диапазоне. Проверка использует тот же
диапазон и lookup target по UUID; широких TEMP/JSON payload и массивов ключей в
Node нет. ORDER BY квалифицирован исходными колонками, номера сортируются численно.

В транзакции: диапазон → INSERT (только loading) → сравнение десяти полей → строка
пакета/общий checkpoint → COMMIT. Сбой откатывает этот пакет целиком. После потери
ответа COMMIT продолжение читает сохранённый checkpoint; ON CONFLICT DO NOTHING
не скрывает несовпадения. Готовые пакеты повторно не вставляются.

При EOF loading количество загруженных должно совпасть с accepted. Затем отдельная
фаза verifying снова читает источник пакетами и сверяет target. Её курсор также
фиксируется на каждом пакете и продолжается при resume. Финальные числа цели по
библиотекам сверяются независимо с manifest и полным числом verified. Только после
успеха статус completed. Внешние ручные изменения источника/цели во время операции
не поддержаны; completed resume не является новым полным аудитом.

Ошибка формы источника/цели, сумм, полей, конфликт ключа, SQL или защитная остановка
даёт ненулевой exit и диагностику; при живом подключении сохраняется failed.
После защитного разрыва SQL-статус может остаться loading/verifying: факт остановки
проверяйте по worker и publication_failed, а продолжение — по атомарному checkpoint. Запуски после исправления требуют
явного resume. Повторного разбора DAT или назначения новых UUID здесь нет.

</details>

<a id="resources"></a>

<details>
<summary><strong>Память и независимая отмена SQL</strong><br>
work_mem32MB, hash multiplier2, gather0; серверные defaults не меняются<br>
Ниже3ГиБ MemAvailable — пауза перед пакетом/SQL; ниже2ГиБ — отмена<br>
Диск рабочего каталога: резерв150ГиБ; замер каждые2s</summary>

Guard читает /proc/meminfo и statfs рабочего каталога. Ошибка замера или критическое
значение закрывает активное PG-подключение. client_connection_check_interval=1s
помогает PostgreSQL заметить разрыв во время длинного SQL; statement_timeout15мин,
lock_timeout5с. Потеря соединения откатывает незавершённый пакет.

work_mem относится к отдельной операции, а не ко всей памяти PostgreSQL. Постоянные
таблицы, WAL и checkpoint остаются на диске; RAM используется текущими операторами
и общими кешами. Пауза/guard не являются жёстким ограничителем мгновенного пика.

</details>

<a id="reports"></a>

<details>
<summary><strong>Журнал времени и промежуточный результат</strong><br>
bib_publications — manifest и два курсора; batches — атомарные пакеты/фазы<br>
NDJSON содержит границы, строки, elapsed и внутренние времена SQL<br>
Завершение переноса и завершение проверки различаются</summary>

`import.bib_publications`: id, target_schema UNIQUE, image/batch_size/status,
source_manifest/target_manifest, cursor_library/number, verify_library/number,
counters/verification/error, started_at/finished_at.
`import.bib_publication_batches`: publication_id+phase+batch_no PK, верхний ключ,
rows, elapsed_ms, created_at. JSONB здесь — небольшое служебное состояние/manifest,
без копии тел MARC.

NDJSON создаётся приватным wx0600, записи последовательны и sync. События:
publication_start, publication_source_ready, publication_batch_started,
publication_batch_committed, publication_finished либо publication_failed;
resource_sample/pause/resume/critical. Фиксируются pageMs/insertMs/verifyMs,
checkpointMs/commitMs/elapsedMs, границы и накопленные числа. Время текущего запуска
отделено от общего elapsed сессии с учётом пауз между попытками.

```sql
SELECT id,status,target_schema,counters,verification,started_at,finished_at,error
FROM import.bib_publications ORDER BY started_at DESC;
SELECT phase,batch_no,rows,elapsed_ms,cursor_library,cursor_number
FROM import.bib_publication_batches WHERE publication_id='PUBLICATION_UUID'
ORDER BY phase,batch_no;
```

До завершения очередного COMMIT его строки извне не видны. После переноса доступны
все принятые документы с теми же UUID; ЕХ и связи запускаются отдельным этапом.

</details>

<a id="code"></a>

<details>
<summary><strong>Ответственность кода и проверки</strong><br>CLI/socket → publisher → target/source contract → batch loading/verifying<br>Каждый await возвращает проверенный результат либо ошибку; checkpoint общий с данными</summary>

| Определение                                                                                               | Обязанность и сценарий потребителя                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [documentsPublishMain](../src/documents-cli.ts#L21)                                                       | Отдельно разбирает publish-опции, проверяет до env, импортирует только DB_*, связывает сигналы, выводит результат; finally снимает listeners.                                                    |
| [worker publish](../src/runtime/worker.ts#L141)                                                           | Повторяет допуск JSON-клиента до task/log, использует образ worker, создаёт задачу без input и передаёт CLI параметры/отчёт. start асинхронный.                                                  |
| [validatePublicationOptions](../src/documents/publish.ts#L33)                                             | Проверяет target/resume/image/report и числа до IO. Отсутствующие target/batch при resume наследуются.                                                                                           |
| [sourceManifest / canonical](../src/documents/publish.ts#L101)                                            | Читает завершённые runs/пакеты и реальные SQL-сводки, проверяет суммы и соответствие SHA/библиотеки. canonical сериализует даты перед сравнением с JSONB manifest.                               |
| [publishBibliographicRecords](../src/documents/publish.ts#L206)                                           | Владеет Client, global lock, report, guard и сессией; связывает целевую схему, два прохода и финальную сверку; возвращает report либо отклоняет Promise.                                         |
| [log / ready / abortConnection / result](../src/documents/publish.ts#L215)                                | log последовательно пишет и sync NDJSON; ошибка отменяет controller. ready ждёт безопасных ресурсов. abortConnection закрывает активный SQL. result отделяет elapsed сессии от текущего запуска. |
| [batch](../src/documents/publish.ts#L390)                                                                 | На входе phase; читает верхнюю границу и count ключей, выполняет INSERT только loading, native ROW-сверку и checkpoint в одной транзакции; EOF возвращает false, ошибка откатывает пакет.        |
| [quotePublicationSchema / readColumns / requirePublicationSource](../src/documents/publish-schema.ts#L33) | Ограничивает namespace, читает catalog, требует типизированный источник с UUID PK и частичным unique identity до target DDL.                                                                     |
| [ensurePublicationTarget](../src/documents/publish-schema.ts#L128)                                        | Создаёт только отсутствующую documents/own sequence/индексы, проверяет фактический контракт и возвращает структурный manifest. Существующий несовместимый target не переделывает.                |
| [ensurePublicationJournal](../src/documents/publish-schema.ts#L320)                                       | Создаёт постоянные служебные таблицы публикации и пакетов; не копирует тела MARC и не меняет legacy журналы.                                                                                     |
| [createPublicationResourceGate / sampleHost / tick](../src/documents/publish-resources.ts#L54)            | Создаёт независимый ресурсный монитор, ready и close. Замеры не перекрываются; soft ждёт, critical/error отменяет signal; close чистит таймер/ожидания/listeners.                                |

Проверки: [реальная PostgreSQL](../test/documents-publication.test.ts#L22), [CLI и socket](../test/documents-publication-cli.test.ts#L56), [ресурсный gate](../test/documents-publication-resources.test.ts#L22). Полный локальный набор: 148 успешных тестов без пропусков.

</details>
