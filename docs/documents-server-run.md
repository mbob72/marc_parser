# Импорт документов: работа на сервере через Docker

Для среза 26.10 используйте [самостоятельную загрузку готовых БЗ в import.bib_records](bib-staging.md#stage).
Она не загружает public. Описанный далее маршрут load/ready относится к прежнему сценарию.

Это основной сценарий оператора: после доставки образа запустить worker, обработать
выгрузку **RSL01 Z00**, наполнить `public.documents` и `z103_import.document_ids`, проверить результат.
[Команды контейнера](container-commands.md) · [Доставка и настройка CI](documents-deployment.md) ·
[Правила импорта](documents-import.md) · [Ответственность кода](documents-code.md).

Порядок: **push main → Actions публикует образ → abis-deploy-watch скачивает образ → оператор запускает контейнер →
оператор запускает задание → подготовка → COPY → загрузка → сверка БД**.
Доставка образа не запускает и не заменяет worker. Запуск worker не начинает импорт.

Команды ниже выполняются по одной, с проверкой ответа перед следующим шагом.
Если импорт уже выполняется, переходите сразу к [наблюдению](#monitor), сохранив его task.id.

[Подключение](#login) · [Файлы](#files) · [Последний образ](#image) ·
[Замена контейнера](#replace) · [Запуск](#launch) · [Импорт](#run) ·
[Прогресс](#monitor) · [Результат](#result) · [Восстановление](#recovery).

<a id="login"></a>

<details>
<summary><strong>1. Подключитесь к серверу</strong><br>
SSH выполняется на вашем компьютере, остальные команды — на сервере.<br>
Нужны доступ к внутренней сети и право работать с Docker.<br>
Node.js и копия репозитория на сервере для этого сценария не нужны.</summary>

В локальном терминале:

```bash
ssh -i ~/.ssh/id_ed25519_gitlab_rgb bobryshevmy@10.251.232.53
```

В открытой SSH-сессии проверьте контейнеры:

```bash
docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
```

Ниже используется контейнер `marc-documents-worker`. Другие контейнеры на сервере
относятся к другим сервисам и не участвуют в его замене.

</details>

<a id="files"></a>

<details>
<summary><strong>2. Проверьте исходник и рабочие каталоги</strong><br>
В примере используется распакованный rsl01_z00.dat из выгрузки 2026-10-09.<br>
/source и /run/db.env подключены только для чтения; /work — для записи.<br>
Промежуточные пакеты и отчёты сохраняются после удаления контейнера.</summary>

| Назначение              | На сервере                                          | В контейнере                     |
| ----------------------- | --------------------------------------------------- | -------------------------------- |
| Выгрузка Z00            | `~/aleph-downloads-20261009/unpacked/rsl01_z00.dat` | `/source/unpacked/rsl01_z00.dat` |
| Рабочие данные          | `~/marc-documents-work`                             | `/work`                          |
| Конфигурация PostgreSQL | `~/marc-documents-config/db.env`                    | `/run/db.env`                    |
| Сокет PostgreSQL        | `/var/run/postgresql`                               | `/var/run/postgresql`            |

Дата в пути — конкретная имеющаяся выгрузка, а не автоматический выбор самой новой.
При следующей выгрузке замените каталог в проверках и mount `/source` при запуске контейнера.
Размер распакованного файла в этом примере — 22 994 648 798 байт; перед импортом
скачивание и распаковка должны быть полностью завершены.

```bash
stat -c '%s bytes  %n' "$HOME/aleph-downloads-20261009/unpacked/rsl01_z00.dat"
```

Проверьте свободное место:

```bash
df -h "$HOME/marc-documents-work"
```

Место требуется для `source/`, `copy/`, диагностики, а также таблиц PostgreSQL и WAL.
Свободное место на `/work` не характеризует отдельный диск БД, если PostgreSQL находится на другом разделе.
Не меняйте исходник во время обработки. В этой установке db.env уже скопирован из проекта БЗ–БЗ;
для нового сервера настройте его по [инструкции](documents-deployment.md#setup).

```bash
test -r "$HOME/marc-documents-config/db.env" && echo 'db.env доступен для чтения'
```

Содержимое db.env выводить не требуется. Имена параметров и требования к схеме —
в [контракте PostgreSQL](documents-import.md#schema).

</details>

<a id="image"></a>

<details>
<summary><strong>3. Выберите доставленный образ</strong><br>
Общий наблюдатель сохраняет digest, revision и imageId.<br>
Проверьте phase=ready записи documents и ожидаемый revision.<br>
Выберите неизменяемый digest перед заменой worker.</summary>

```bash
docker exec abis-deploy-watch python3 /app/watch.py status
DOCUMENTS_IMAGE='<полная ссылка из digests записи documents>'
docker image inspect "$DOCUMENTS_IMAGE" --format 'imageId={{.Id}} revision={{index .Config.Labels "org.opencontainers.image.revision"}}'
```

Сверьте метки с состоянием наблюдателя. Настройка — [общая доставка](shared-delivery.md).

</details>

<a id="replace"></a>

<details>
<summary><strong>4. Завершите работу старого контейнера, если он существует</strong><br>
Сначала status: при busy=true дождитесь задачи или явно отмените её.<br>
drain запрещает новые задачи; текущая продолжает выполняться.<br>
stop --time 45 останавливает контейнер; rm удаляет его, сохраняя bind mounts.</summary>

Если контейнера ещё нет, переходите к шагу 5. Если он уже остановлен, переходите к `docker rm`.
Для работающего контейнера:

```bash
docker exec marc-documents-worker node /app/dist/documents-worker-cli.js status
```

Перед плановой заменой запретите приём новых заданий:

```bash
docker exec marc-documents-worker node /app/dist/documents-worker-cli.js drain
```

Повторяйте `status` до `busy: false`, изучите итог последней задачи. Остановка контейнера
с активной задачей прерывает импорт. При осознанной отмене используйте [восстановление](#recovery).
После завершения задачи:

```bash
docker stop --time 45 marc-documents-worker
```

Docker посылает SIGTERM, ждёт до 45 секунд и при необходимости применяет SIGKILL.
Worker передаёт сигнал дочерней задаче и даёт ей до 30 секунд. Затем удалите контейнер:

```bash
docker rm marc-documents-worker
```

Удаляются настройки и файловая система контейнера. Каталоги `/work`, `/source`, db.env
и данные PostgreSQL расположены на сервере и сохраняются. `docker start` прежнего
контейнера запустил бы прежнюю версию, поэтому для нового образа нужен новый `docker run`.

</details>

<a id="launch"></a>

<details>
<summary><strong>5. Запустите worker из выбранного образа и проверьте БД</strong><br>
Один CPU, 1 ГиБ памяти, restart=unless-stopped, stop-timeout=45 секунд.<br>
--pull never использует уже доставленный образ; worker server ожидает команды.<br>
check-db проверяет соединение, схему и права, но не полноту документов.</summary>

Выполните в той же SSH-сессии, где задан DOCUMENTS_IMAGE:

```bash
docker run -d \
  --name marc-documents-worker \
  --pull never \
  --user "$(id -u):$(id -g)" \
  --restart unless-stopped \
  --stop-timeout 45 \
  --cpus 1 \
  --memory 1g \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  -v "$HOME/marc-documents-work:/work" \
  -v "$HOME/aleph-downloads-20261009:/source:ro" \
  -v "$HOME/marc-documents-config/db.env:/run/db.env:ro" \
  -v /var/run/postgresql:/var/run/postgresql \
  "$DOCUMENTS_IMAGE" \
  worker server --image "$DOCUMENTS_IMAGE"
```

Ответ — ID созданного контейнера. Проверка готовности самого worker:

```bash
docker exec marc-documents-worker node /app/dist/documents-worker-cli.js status
```

Ожидаются `accepting: true`, `busy: false`. Поле task может содержать прежнюю задачу из `/work/control`.
Сразу после запуска сокет ещё может создаваться: повторите проверку через несколько секунд.
Если контейнер завершился, прочитайте `docker logs --tail 50 marc-documents-worker`.

Проверка PostgreSQL:

```bash
docker exec marc-documents-worker node /app/dist/documents-cli.js check-db --env /run/db.env
```

Успешный ответ: `ready: true`, `target: public.documents`, `identities: z103_import.document_ids`.
Это проверка доступа и контракта таблиц; содержимое выгрузки с БД здесь не сравнивается.
Проверка предполагает существующий справочник, как на этом сервере; особенности начального
создания описаны в [контракте схемы](documents-import.md#schema).

`--image` у worker — подпись версии в отчёте. Реальный образ контейнера можно отдельно увидеть
через `docker inspect marc-documents-worker --format '{{.Config.Image}} {{.Image}}'`.
Маршрутизация запуска — [entrypoint](../docker/documents-entrypoint.sh#L5).

</details>

<a id="run"></a>

<details>
<summary><strong>6. Запустите полный импорт RSL01 Z00</strong><br>
run = prepare → prepare-copy → load → ready; dry-run по умолчанию false.<br>
RSL01, aleph-sequential, utf-8, пакет 50 000 записей, validation-policy=reject.<br>
start возвращается сразу; результат узнаём по task.id, status и отчётам.</summary>

```bash
docker exec marc-documents-worker node /app/dist/documents-worker-cli.js start \
  --stage run \
  --input /source/unpacked/rsl01_z00.dat
```

Это **реальная запись в БД**. Записи с DEL пропускаются; ошибки разбора и отклонённые
по валидации записи попадают в диагностику. `reject` исключает записи с ошибками MARC.
Если задача требует сохранять такие записи, политика `--validation-policy preserve` выбирается
до запуска; она не исправляет MARC и не отменяет проверки идентификатора и NUL.
Исключение записи из выгрузки не удаляет уже существующий документ в БД.
Правила и счётчики — в [описании подготовки](documents-import.md#prepare).

Сохраните `task.id` из ответа. Он определяет лог и каталог результатов именно этого запуска.
Для примера в текущем сеансе 12.10.2026 ID был `2026-10-12T14-29-53-668Z-45d44db6`;
при новом запуске подставьте новый ID:

```bash
DOCUMENTS_TASK_ID='2026-10-12T14-29-53-668Z-45d44db6'
```

`busy: true`, `task.status: running` означают принятую задачу. SSH можно закрыть:
дочерний CLI работает в контейнере независимо от терминала. После повторного входа
восстановите переменную task.id. Повторный `start` при занятом worker отвергается.
Поле `stage` останется `run` на всех внутренних этапах: это выбранная команда, не индикатор этапа.
Последовательность реализована в [documentsMain](../src/documents-cli.ts#L186).

Альтернатива для архива — тот же `start --stage run`, но с
`--input /source/rsl01_z00.dat.tar.gz --member rsl01_z00.dat` вместо пути распакованного файла.
Запускайте один выбранный вариант. Для предварительной проверки добавьте `--dry-run`:
файлы будут подготовлены, каждая транзакция load откатится, ready.json не появится.
После такого запуска реальная загрузка готового copy-каталога выполняется отдельным `load`,
затем `ready`, как в [восстановлении](#recovery).

</details>

<a id="monitor"></a>

<details>
<summary><strong>7. Следите за задачей, файлами и ресурсами</strong><br>
status показывает результат процесса; progress.json — завершённые NDJSON-пакеты.<br>
Лог задачи находится в reports/ID.log; docker logs показывает сам worker.<br>
Процента и ETA всего конвейера нет; счётчики подготовки не означают вставку в БД.</summary>

Состояние задачи:

```bash
docker exec marc-documents-worker node /app/dist/documents-worker-cli.js status
```

Проверьте, что task.id совпадает с вашим. Последние события и ошибки:

```bash
tail -n 30 "$HOME/marc-documents-work/reports/$DOCUMENTS_TASK_ID.log"
```

В начале исходник целиком читается для SHA256, затем начинается разбор. В этот период лог
может быть пустым. Во время разбора события пишутся после завершения пакетов; пустой лог
сам по себе не подтверждает ни зависание, ни успешную работу. [Публикация прогресса](../src/documents/prepare.ts#L79).

Счётчики без длинного списка пакетов (переменная передаётся аргументом, а не вставляется в JavaScript):

```bash
docker exec marc-documents-worker node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(JSON.stringify(p.counts,null,2));' \
  "/work/reports/$DOCUMENTS_TASK_ID/source/progress.json"
```

До первого завершённого пакета progress.json может отсутствовать. `processed` — прочитанные БЗ,
`deleted` — помеченные удалёнными, `parsingErrors` — ошибки разбора, `validationRecords` —
записи с ошибками валидации, `rejected` — отклонённые после разбора, `exported` — записанные
в NDJSON. validationRecords пересекается с другими счётчиками. Финальные значения читайте
из `source/manifest.json`: progress.json не является итоговым отчётом всего импорта.

Файлы и занимаемое место:

```bash
du -ah "$HOME/marc-documents-work/reports/$DOCUMENTS_TASK_ID" | tail -n 20
```

| След                                                    | Что происходит                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| `source/part-*.aleph.ndjson.gz.partial`                 | Записывается текущий пакет                                          |
| `source/part-*.aleph.ndjson.gz`, `source/progress.json` | Завершены пакеты подготовки                                         |
| `source/manifest.json`                                  | Подготовка исходника завершена                                      |
| `copy/manifest.json`                                    | Все COPY-пакеты готовы                                              |
| `load.ndjson`, события `batch_committed`                | Пакеты фиксируются в БД; `batch_skipped` в логе — ранее загруженные |
| `ready.json`                                            | Полная сверка выгруженного набора с БД прошла                       |

Наличие отдельного файла не заменяет итог задачи. Для реальной нагрузки:

```bash
docker stats --no-stream marc-documents-worker
```

CPU около 100% соответствует одному выделенному ядру; MEM сравнивается с лимитом 1 ГиБ.
BLOCK I/O — накопленные операции чтения/записи, не процент исходника: файл и пакеты читаются
несколько раз. Периодически повторяйте `df -h "$HOME/marc-documents-work"`.
Финальный ready повторно читает все COPY-пакеты и сравнивает их с БД; он может идти долго
и удерживает SHARE-блокировки таблиц. `running` без новых строк лога на этом этапе допустим.

</details>

<a id="result"></a>

<details>
<summary><strong>8. Подтвердите завершение и готовность документов</strong><br>
Для реального run нужны completed, exitCode=0 и ready.json с ready=true.<br>
Сводка source показывает качество выгрузки; load — вставки, повторы и конфликты.<br>
Готовность относится к экспортированному набору; запуск БЗ–БЗ — отдельное действие.</summary>

Повторите `worker status` из шага 7. У вашей задачи должны быть `status: completed`,
`exitCode: 0`, `busy: false`. Затем прочитайте результат сверки:

```bash
cat "$HOME/marc-documents-work/reports/$DOCUMENTS_TASK_ID/ready.json"
```

Ожидаются `ready: true`, `records`, `batches`, `libraryCode`, `archiveSha256`, `checkedAt`.
`records` — размер проверенного набора, а не количество вновь вставленных или всех БЗ в таблице.
Проверка сверяет журнал загрузки, содержимое и UUID в обеих таблицах —
[verifyReady](../src/documents/ready.ts#L16).

Прочитайте итог подготовки:

```bash
docker exec marc-documents-worker node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(JSON.stringify({complete:p.complete,counts:p.counts,batches:p.batches.length},null,2));' \
  "/work/reports/$DOCUMENTS_TASK_ID/source/manifest.json"
```

И итог загрузки:

```bash
tail -n 5 "$HOME/marc-documents-work/reports/$DOCUMENTS_TASK_ID/load.ndjson"
```

Последнее событие `finished` содержит суммы новых операций, `skipped`, `selectedBatches`,
`dryRun`. Ранее зафиксированные пакеты входят в skipped, их inserted/identical повторно не суммируются.
Пустая диагностика означает отсутствие записанной диагностики, а не отсутствие всех возможных
проблем выгрузки; при отклонениях изучите `source/diagnostics.ndjson` и [политику импорта](documents-import.md#prepare).

Ready подтверждает состояние экспортированного набора на checkedAt. Исключённые записи в него
не входят; наличие всех номеров конкретного Z103 проверяет импортёр связей. Сценарий
[documents перед Z103](documents-deployment.md#sequence) требует работающих обоих worker
и выполняет свежую проверку перед связями. Уже выполненный run не нужно повторять: этот сценарий
можно вызвать с `--packages /work/reports/ID/copy`. Сам по себе текущий run связей не запускает.

</details>

<a id="recovery"></a>

<details>
<summary><strong>Остановка, ошибка и продолжение</strong><br>
worker stop отменяет задачу, Docker stop — весь контейнер.<br>
Завершённые транзакции load сохраняются; повтор пропускает их по журналу.<br>
Парсинг с середины не возобновляется; для load нужен полный copy/manifest.json.</summary>

Для осознанной отмены текущего задания:

```bash
docker exec marc-documents-worker node /app/dist/documents-worker-cli.js stop
```

Команда возвращается до завершения процесса. Проверяйте status до `busy: false`.
При failed/cancelled/interrupted сначала прочитайте лог своей задачи. При неожиданном
завершении контейнера проверьте также:

```bash
docker inspect marc-documents-worker --format '{{json .State}}'
```

`OOMKilled` указывает на остановку контейнера из-за памяти; при гибели только дочернего процесса
ориентируйтесь также на task.signal и системную диагностику. Автоматического продолжения
задачи после перезапуска worker нет. Сохранённое running становится interrupted.

| Где остановились                                | Как продолжать после устранения причины                                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Нет полного `source/manifest.json`              | Новый `worker start --stage run` с исходником; создаст новый каталог и разберёт файл заново                                |
| Source готов, COPY не завершён                  | Синхронный `documents prepare-copy` в новый каталог, затем worker load и ready; [команды](container-commands.md#documents) |
| Есть полный `copy/manifest.json`, сбой загрузки | Worker load на прежнем copy-каталоге; успешные COMMIT сохраняются                                                          |
| Load завершён, сбой ready                       | После устранения причины отдельный worker ready на том же copy-каталоге                                                    |
| Конфликт содержимого или UUID                   | Изучить лог и журнал; повтор не разрешает конфликт и не перезаписывает БЗ                                                  |

Продолжение загрузки (DOCUMENTS_TASK_ID — ID исходного run с готовым copy):

```bash
docker exec marc-documents-worker node /app/dist/documents-worker-cli.js start \
  --stage load --input "/work/reports/$DOCUMENTS_TASK_ID/copy"
```

Запишите **новый** task.id отдельно: у load лог `/work/reports/NEW_ID.log`,
отчёт `/work/reports/NEW_ID.ndjson`; поле task.report — префикс, отдельного каталога здесь нет.
Дождитесь completed/exitCode=0, затем выполните проверку:

```bash
docker exec marc-documents-worker node /app/dist/documents-worker-cli.js start \
  --stage ready --input "/work/reports/$DOCUMENTS_TASK_ID/copy"
```

Дождитесь её completed/exitCode=0 и прочитайте лог **нового ready task.id**:
результат ready выводится туда в JSON. Отдельная команда ready не создаёт ready.json
в каталоге старого run. Конфликты фиксируются в `z103_import.document_issues` и запрещают
успешный итог; их обработка требует отдельного решения, описанного в [контракте загрузки](documents-import.md#load).

Логи задач и рабочие файлы автоматически не ротируются; Docker log-opt ограничивает только
лог контейнера. Удалять рабочие пакеты следует после проверки результата и принятого решения
об их хранении: они нужны для ready и восстановления.

</details>

Публикация уже разобранных БЗ: [documents publish — import.bib_records → отдельная documents](bib-publication.md).
