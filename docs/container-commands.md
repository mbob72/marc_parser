# Команды контейнера: действие, параметры и результат

Справочник внешнего интерфейса образа `documents`. Готовые команды для текущего сервера —
в [основном сценарии оператора](documents-server-run.md). [Правила импорта](documents-import.md) ·
[Устройство кода](documents-code.md) · [Доставка](documents-deployment.md).

Как и в проекте БЗ–БЗ, здесь различаются команды Docker, CLI импорта, worker и общий сервис доставки.
Имена этапов относятся к Z00 и документам; `relations`, `analyze` и `apply` в этом entrypoint отсутствуют.

[Вызов](#invoke) · [documents](#documents) · [worker](#worker) ·
[Команды Docker](#docker) · [Результат и ошибки](#outcome).

<a id="invoke"></a>

<details>
<summary><strong>Как вызвать команду</strong><br>
docker run передаёт arguments в entrypoint: documents / worker / help.<br>
docker exec запускает программу напрямую; укажите node и путь CLI.<br>
Синхронный documents ждёт результат; worker start только принимает задание.</summary>

Маршруты задаёт [entrypoint](../docker/documents-entrypoint.sh#L5):

| Маршрут при создании контейнера | Программа | Назначение |
|---|---|---|
| `documents …` | `/app/dist/documents-cli.js` | Подготовка и импорт Z00 |
| `worker …` | `/app/dist/documents-worker-cli.js` | Сервер и управление заданиями |
| `help` или отсутствие команды | documents CLI `help` | Справка импорта |

В SSH-сессии после выбора DOCUMENTS_IMAGE по [квитанции доставки](documents-server-run.md#image):

```bash
docker run --rm --pull never "$DOCUMENTS_IMAGE" help
```

Уже работающий контейнер:

```bash
docker exec marc-documents-worker node /app/dist/documents-cli.js help
```

Единого `--help` у CLI нет. `docker exec … worker status` не вызывает entrypoint:
нужна полная команда `docker exec … node /app/dist/documents-worker-cli.js status`.
Пути CLI относятся к контейнеру; shell `$HOME` в аргументах Docker раскрывается на сервере.
Сопоставление путей — в [таблице mounts](documents-server-run.md#files).

Синхронный documents CLI запускает отдельный процесс, обходит очередь worker и не отражается
в worker status. Во время активной задачи используйте его только для независимых проверок;
этапы импорта запускайте последовательно после `busy: false`.

</details>

<a id="documents"></a>

<details>
<summary><strong>documents: подготовка, загрузка и сверка</strong><br>
run выполняет prepare → prepare-copy → load → ready.<br>
По умолчанию RSL01, aleph-sequential, utf-8, 50 000 БЗ, reject, dry-run=false.<br>
Прямой CLI требует явных путей результатов; worker назначает их сам.</summary>

[Аргументы и маршруты CLI](../src/documents-cli.ts#L17), [контракты данных](documents-import.md#commands).
Ниже arguments дописываются после `docker exec marc-documents-worker node /app/dist/documents-cli.js`.

| Подкоманда | Обязательные аргументы | Что меняет и возвращает |
|---|---|---|
| `help` | Нет | Печатает команды и значения по умолчанию |
| `check-db` | Для этой установки `--env /run/db.env` | Проверяет подключение, схему и права; JSON в stdout, записи не загружает |
| `prepare` | `--input FILE --output NEW_DIR` | Создаёт gzip NDJSON, диагностику, progress и manifest; без БД |
| `prepare-copy` | `--input SOURCE_DIR --output NEW_DIR` | Проверяет готовый NDJSON-набор и создаёт COPY-пакеты; без БД |
| `stage` | `--input SOURCE_DIR_OR_PLAN_JSON --report NEW_FILE` | [Самостоятельная загрузка БЗ в import.bib_records](bib-staging.md), с fields и причинами отказов; без public и bib_ids |
| `load` | `--input COPY_DIR --report NEW_FILE` | Транзакционная загрузка по пакетам, JSONL-отчёт и события stdout |
| `ready` | `--input COPY_DIR` | Сверяет весь набор с БД, печатает JSON; целевые данные не меняет |
| `run` | `--input FILE --output NEW_DIR` | Все этапы; source/, copy/, load.ndjson, при успехе реального импорта ready.json |

| Опция | По умолчанию | Где применяется и что означает |
|---|---|---|
| `--env FILE` | `.env` | check-db/load/ready/run читают только DB_*; при docker exec здесь нужен `/run/db.env` |
| `--member NAME` | Не задано | prepare/run: точное имя файла внутри tar.gz |
| `--library CODE` | `RSL01` | prepare/run: 1–6 заглавных букв/цифр |
| `--format FORMAT` | `aleph-sequential` | prepare/run: также `iso2709`; автоопределения нет |
| `--encoding NAME` | `utf-8` | prepare/run: кодировка исходной записи |
| `--batch-size N` | `50000` | prepare/run: число экспортированных БЗ в пакете |
| `--validation-policy POLICY` | `reject` | prepare/run: reject исключает ошибки MARC; preserve сохраняет без исправления |
| `--dry-run` | `false` | load/run: откат каждого пакета, run не вызывает ready |
| `--start-batch N` | `1` | Только отдельный load: начало с номера N, нумерация с 1 |
| `--max-batches N` | Все оставшиеся | Только отдельный load: ограничение числа выбранных пакетов |
| `--reserve-bytes N` | `2147483648` | prepare-copy и COPY-этап run: минимальный остаток места перед пакетом |

Полный успешный load с ограничением пакетов не означает готовности набора: нужен ready всех пакетов.
CLI разбирает общий набор опций, но неподходящая этапу опция может не влиять на него:
например, `run --max-batches` не ограничивает загрузку, `ready --dry-run` не отменяет проверку.
Указывайте параметры согласно таблице.

Пример восстановления COPY после успешной подготовки: замените ID на исходный task.id,
а `recovered-copy` — на новое, ещё не существующее имя каталога:

```bash
docker exec marc-documents-worker node /app/dist/documents-cli.js prepare-copy \
  --input /work/reports/ID/source \
  --output /work/recovered-copy
```

Команда синхронная и может выполняться долго. После её успеха передайте `/work/recovered-copy`
в worker load, затем worker ready. Повторный парсинг не возобновляется с частичного пакета;
правила повторной загрузки — в [контракте COPY](documents-import.md#load).
Параметры `--limit` и автоматическое исправление MARC этот CLI не предоставляет.

</details>

<a id="worker"></a>

<details>
<summary><strong>worker: исполнение и контроль задания</strong><br>
server ждёт команды; start запускает одну задачу; stage по умолчанию run.<br>
stop отменяет задачу, drain запрещает новые, resume снова разрешает их.<br>
status показывает последнюю задачу; БД и актуальность образа не проверяет.</summary>

[CLI](../src/documents-worker-cli.ts#L7) → Unix-сокет `/work/control/worker.sock` →
[startWorker](../src/runtime/worker.ts#L32) → дочерний documents CLI.
[Ответственность и жизненный цикл](documents-code.md#worker).

| Подкоманда | Действие и результат |
|---|---|
| `server` | Длительно работающий процесс; восстанавливает последнюю задачу, создаёт сокет; импорт автоматически не запускает |
| `start` | Принимает одну задачу и сразу возвращает JSON; окончание отслеживается отдельно |
| `status` | Возвращает image/accepting/busy/task; не обращается к PostgreSQL |
| `stop` | Посылает задаче SIGTERM, через 30 секунд при необходимости SIGKILL; сам worker остаётся |
| `drain` | Запрещает новые start, не прерывая текущую задачу |
| `resume` | Разрешает новые start; прерванную задачу не возобновляет |

| Параметры server | По умолчанию | Назначение |
|---|---|---|
| `--work` | `/work` | control/, reports/, сокет; клиентские команды должны использовать тот же work |
| `--source` | `/source` | Корень разрешённых входных файлов prepare/run |
| `--env` | `/run/db.env` | Конфигурация БД, передаваемая дочернему CLI |
| `--image` | `unknown` | Подпись версии в состоянии и задачах, а не выбор Docker-образа |

Этапы `start`:

| `--stage` | `--input` | Результат относительно `/work/reports` |
|---|---|---|
| `run` (по умолчанию) | Файл под `/source` | `ID/source`, `ID/copy`, `ID/load.ndjson`, `ID/ready.json`, `ID.log` |
| `prepare` | Файл под `/source` | `ID/` сразу содержит NDJSON и manifest; без вложенного source/, плюс `ID.log` |
| `load` | Готовый COPY-каталог под `/work` | `ID.ndjson` и `ID.log`; `task.report` — префикс |
| `ready` | Готовый COPY-каталог под `/work` | JSON результата в `ID.log`; ready.json не создаётся |
| `check-db` | Не нужен | JSON проверки в `ID.log` |

Для prepare/run доступны `--member`, `--library`, `--encoding`, `--format`,
`--validation-policy`, `--batch-size` с default из documents CLI. `--dry-run` влияет на load/run.
`--output`, `--report`, `--start-batch`, `--max-batches`, `--reserve-bytes` worker start не принимает.
У start `--env` не меняет конфигурацию сервера: путь задан при server.
Проверка realpath запрещает выход input за соответствующий mount через симлинк.

Пример реальной загрузки — [основной сценарий](documents-server-run.md#run). Проверка состояния:

```bash
docker exec marc-documents-worker node /app/dist/documents-worker-cli.js status
```

Task содержит id, stage, input (если нужен), dryRun, image, startedAt, status, log, report;
после завершения — finishedAt, exitCode, signal. Отдельная история — `/work/control/ID.json`.
Новый start меняет последнюю task, поэтому сохраняйте ID и сверяйте его при наблюдении.
Подробности файлов и счётчиков — в [наблюдении](documents-server-run.md#monitor).

</details>



<a id="docker"></a>

<details>
<summary><strong>Docker: контейнер, образ и ресурсы</strong><br>
docker run создаёт контейнер, docker start запускает существующий с прежним образом.<br>
docker stop останавливает весь контейнер; worker stop — только задачу.<br>
docker logs — журнал worker, отчёт импорта находится в /work/reports.</summary>

| Команда на сервере | Назначение |
|---|---|
| `docker ps -a` | Список работающих и остановленных контейнеров |
| `docker image inspect "$DOCUMENTS_IMAGE"` | Проверка доставленного образа, ID и меток |
| `docker inspect marc-documents-worker` | Реальный образ, mounts, состояние контейнера |
| `docker run … IMAGE worker server …` | Создание worker; полный вызов в сценарии оператора |
| `docker start marc-documents-worker` | Запуск существующего остановленного контейнера; версия не обновляется |
| `docker exec marc-documents-worker node …` | Отдельная команда в работающем контейнере |
| `docker stats --no-stream marc-documents-worker` | Текущая нагрузка, память и накопленный I/O |
| `docker logs --tail 50 marc-documents-worker` | Запуск worker и ошибки его управляющего процесса |
| `docker stop --time 45 marc-documents-worker` | SIGTERM и до 45 секунд на остановку всего контейнера |
| `docker rm marc-documents-worker` | Удаление остановленного контейнера; серверные bind mounts сохраняются |

Многоточия обозначают схему вызова, не готовую команду. Полный `docker run`, порядок замены
и mounts — в [сценарии сервера](documents-server-run.md#replace).

</details>

<a id="outcome"></a>

<details>
<summary><strong>Как понимать успех и ошибку</strong><br>
Успех worker start — принятие задачи, а не успешная загрузка.<br>
completed/exitCode=0 — успех дочернего CLI; результат зависит от stage и dryRun.<br>
check-db ready=true проверяет схему; отдельный ready проверяет документы.</summary>

| Сигнал | Значение и действие |
|---|---|
| `busy: true`, `task.status: running` | Есть активный дочерний процесс; смотрите его лог и файлы прогресса |
| `completed`, `exitCode: 0` | Успешно завершился выбранный этап; для реального run проверьте ready.json |
| `failed`, ненулевой exitCode | Ошибка CLI/данных/SQL/I/O; причина в логе, ранние COMMIT могли сохраниться |
| `cancelled`, signal | Дочерний процесс завершился по сигналу; это не подтверждение отката всех пакетов |
| `interrupted` | После рестарта восстановлена прежняя незавершённая задача; автоматического повторного старта нет |
| `accepting: false` | Drain или ошибка сохранения состояния; изучите причину до resume |
| Ошибка управляющей команды | Задание может быть не принято: проверьте status; неправильный input/busy/drain отвергаются |

Documents CLI и worker CLI выставляют exit code 1 при обработанном исключении;
неизвестный маршрут entrypoint — 2. В контейнерном импорте отклонённые MARC-записи
не означают отдельный exit code 2: качество набора оценивается по counts/diagnostics.
Неполный импорт после ошибки не равен отсутствию изменений в БД.
Действия после сбоя — в [восстановлении](documents-server-run.md#recovery).

</details>
