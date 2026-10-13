# Общая доставка и запуск исполнителя

CI публикует `ghcr.io/mbob72/marc_parser:documents-main`; единственный серверный контейнер
[abis-deploy-watch](https://github.com/mbob72/abis-deploy-watch) скачивает образ.
Встроенный deploy удалён. Доставка не запускает worker и задания, старые версии автоматически не удаляются.

<a id="server"></a>
## Проверить доставку и выбрать версию

На сервере `bobryshevmy@10.251.232.53`:

```bash
docker exec abis-deploy-watch python3 /app/watch.py status
```

Запись `documents` должна иметь `phase=ready`, ожидаемый `revision` и `digests`.
`imageId` — доступный образ; `worker.imageId` — фактически запущенный исполнитель.
Для внеочередной доставки используйте `python3 /app/watch.py update` в общем контейнере.
При занятом lock дождитесь очередного прохода; интервал ожидания после прохода — 60 секунд.

<a id="worker-start"></a>
## Явно поднять worker

Скопируйте полный digest из записи проекта, задайте серверные пути и UID/GID
через переменные DOCUMENTS_IMAGE, DOCUMENTS_WORK, DOCUMENTS_SOURCE,
DOCUMENTS_DB_ENV, DOCUMENTS_UID и DOCUMENTS_GID. IMAGE должен быть полной ссылкой Registry@sha256.

```bash
export DOCUMENTS_IMAGE='<полная ссылка на доставленный digest>'
docker image inspect "$DOCUMENTS_IMAGE" --format '{{.Id}}'
docker compose -f compose.documents.yaml up -d --no-build documents
docker exec marc-documents-worker node /app/dist/documents-worker-cli.js status
```

Compose использует только локальный образ (`pull_policy: never`), монтирует /work,
/source read-only, /run/db.env read-only и сокет PostgreSQL. Docker socket и Registry
credentials worker не получает. Подробности: [compose.documents.yaml](../compose.documents.yaml).
Нужна локальная копия Compose-файла и настроенные переменные; сам образ уже доставлен.

Перед заменой существующего worker выполните `worker drain`, дождитесь `busy=false`,
сохраните task.id и итог задачи. Затем остановите и удалите только этот worker;
после этого создайте контейнер выбранной версии. Не выполняйте compose up поверх занятого worker.
Запуск сервера worker не начинает импорт. Для отката выберите ранее сохранённый digest,
проверьте его через image inspect и выполните ту же последовательность.

<a id="migration"></a>
## Переход со старого контроллера

Проверьте ready общего сервиса, затем наличие старого контроллера через docker ps -a.
Если он существует, остановите и удалите только `marc-documents-deploy`.
Его образ и каталоги не удаляйте автоматически: они могут быть нужны работающему worker.
У общего сервиса нет команд start/versions/retention; они заменены явным выбором digest и Docker/Compose.

<a id="registry-auth"></a>
## Registry и CI

Серверный Registry login независим от временного токена CI. Для закрытого Registry
нужен read-only токен с доступом к этому проекту. Разные проектные токены одного Registry
хранятся в отдельных Docker profiles общего наблюдателя; пароль не помещается в Git и projects.json.
Настройка сервиса и профилей — в [README abis-deploy-watch](https://github.com/mbob72/abis-deploy-watch#profiles).

13.10.2026 общая доставка проверена на сервере для documents, bib-relations и auth-docs-relations.
Изменение локального кода вступает в опубликованный образ после успешного CI.

## Сборка и публикация

> Основной сценарий доставки теперь описан в [общем сервисе](shared-delivery.md).

# Контейнер документов: сборка, доставка и запуск

**После деплоя начните с [основного сценария работы на сервере](documents-server-run.md):**
выбор доставленного образа → замена worker → парсинг Z00 → загрузка → проверка результата.
[Справочник команд контейнера](container-commands.md). Ниже — настройка образа, CI и доставки.

Контейнер `marc-documents-worker` предназначен для работы рядом с `bib-relations-worker`, обращается
к той же PostgreSQL и использует отдельный `/work`. Доставка образа, запуск исполнителя
и запуск импорта — три отдельных действия. [Импорт](documents-import.md) · [Код](documents-code.md).

<a id="image-build"></a>

<details>
<summary><strong>Состав образа</strong><br>
Node 24; target=documents для импорта, default/service для прежнего API.<br>
В образе dist и production dependencies, пользователь node.<br>
.env, архивы, отчёты и рабочие каталоги исключены из build context.</summary>

[Dockerfile](../Dockerfile#L4) выполняет npm ci, TypeScript build и prune.
`.dockerignore` использует разрешённый список: Dockerfile, package/lock, tsconfig, src, docker.
В runtime передаются dist, node_modules и package.json. OCI labels хранят SHA, URL исходников
и время выпуска. NODE_IMAGE по умолчанию `node:24-bookworm-slim`; при необходимости
можно явно выбрать зеркало через `--build-arg NODE_IMAGE=...`.

```bash
docker build --target documents -t marc-documents:local .
docker run --rm marc-documents:local help
```

Существующий compose.yaml продолжает собирать API-образ по target default.
Новый compose.documents.yaml запускает только сервер документов; отдельные RabbitMQ,
MinIO или PostgreSQL для этого конвейера не требуются.

</details>

<a id="entrypoint"></a>

<details>
<summary><strong>Маршруты команд контейнера</strong><br>
documents → documents-cli; worker → documents-worker-cli.<br>
Без аргументов — help; неизвестный маршрут — exit code 2.<br>
Для docker exec указывайте node и путь CLI: entrypoint повторно не вызывается.</summary>

[documents-entrypoint.sh](../docker/documents-entrypoint.sh#L5) делает exec без фоновой
оболочки, поэтому Node получает сигналы PID 1. Worker при остановке передаёт SIGTERM
задаче, затем через 30 секунд SIGKILL, если она не завершилась. Остановленный load сохраняет
COMMIT ранних пакетов; незавершённая транзакция откатывается при закрытии соединения.

```bash
docker exec marc-documents-worker node /app/dist/documents-worker-cli.js status
docker exec marc-documents-worker node /app/dist/documents-cli.js check-db --env /run/db.env
```

</details>

<a id="setup"></a>

<details>
<summary><strong>Первый запуск на сервере</strong><br>
/work — постоянный рабочий каталог, /source — выгрузки только для чтения.<br>
/run/db.env — существующий конфиг БД с правами 600; пароль не в образе.<br>
Worker запускается с UID/GID пользователя сервера, без Docker socket.</summary>

Пример для сервера БЗ–БЗ. Сначала подготовьте каталоги; db.env можно скопировать
из серверной конфигурации проекта связей. Не заменяйте его демонстрационными значениями
.env.example. Путь DB_HOST должен работать внутри контейнера.

```bash
WORK="$HOME/marc-documents-work"
SOURCE="$HOME/aleph-source"
mkdir -p "$WORK/control" "$WORK/reports" "$SOURCE"
# Скопируйте существующий конфиг подключения в $WORK/db.env.
chmod 600 "$WORK/db.env"

docker run -d --name marc-documents-worker \
  --user "$(id -u):$(id -g)" --restart unless-stopped --stop-timeout 45 \
  --cpus 1 --memory 1g --log-opt max-size=10m --log-opt max-file=3 \
  -v "$WORK:/work" -v "$SOURCE:/source:ro" \
  -v "$WORK/db.env:/run/db.env:ro" \
  -v /var/run/postgresql:/var/run/postgresql \
  marc-documents:local worker server --image marc-documents:local
```

Для Compose задайте DOCUMENTS_UID, DOCUMENTS_GID, DOCUMENTS_WORK, DOCUMENTS_SOURCE,
DOCUMENTS_DB_ENV как переменные окружения shell, затем:

```bash
docker compose -f compose.documents.yaml up --build -d
```

Внутри Compose контейнер можно адресовать через `docker compose ... exec documents ...`;
его фактическое имя зависит от Compose project. Не запускайте одновременно Compose и
общий сервис доставки для всех проектов. Перед первым load check-db проверит схему;
если document_ids ещё не существует, check-db отказывает, а load создаёт его транзакционно.
public.documents должен существовать в любом случае.

</details>

<a id="worker-tasks"></a>

<details>
<summary><strong>Задания и продолжение</strong><br>
worker start по умолчанию stage=run; одновременно одна задача.<br>
start возвращает task.id и report, завершение проверяется отдельным status.<br>
После сбоя load получает прежний copy-каталог и новый отчёт.</summary>

[worker CLI](../src/documents-worker-cli.ts#L7) связывается с `/work/control/worker.sock`:
server/start/status/stop/drain/resume. Настройки сервера: work=/work, source=/source,
env=/run/db.env, image=unknown. start принимает stage=prepare/load/ready/check-db/run,
input, dry-run и для prepare/run — member/library/encoding/format/validation-policy/batch-size.

```bash
docker exec marc-documents-worker node /app/dist/documents-worker-cli.js start \
  --stage run --input /source/rsl01_z00.dat.tar.gz --member rsl01_z00.dat

docker exec marc-documents-worker node /app/dist/documents-worker-cli.js status
```

Задача создаёт уникальный `/work/reports/<task-id>`; run пишет в нём source/, copy/,
load.ndjson, ready.json. Лог — соседний `<task-id>.log`. Все пути выдаются в status.
status не проверяет БД, только доступность исполнителя и результат задачи.

Возобновление после обрыва load (замените TASK_ID на полученный report):

```bash
docker exec marc-documents-worker node /app/dist/documents-worker-cli.js start \
  --stage load --input /work/reports/TASK_ID/copy
```

Load/ready читают каталог под /work; prepare/run — обычный файл под /source.
Realpath исключает выход за mount через симлинк. stage=prepare формирует только NDJSON;
prepare-copy выполняется синхронным documents CLI либо внутри run.

`drain` запрещает новые задачи, текущая продолжается; `resume` снова разрешает start;
`stop` отменяет только текущую задачу. Состояние и история JSON сохраняются в control;
при рестарте незавершённая задача получает interrupted, сама не перезапускается.
Для нового образа остановите worker после завершения/drain, изучите сохранённое состояние,
удалите только его контейнер и запустите выбранную версию. Рабочий каталог сохраняется.

</details>

<a id="sequence"></a>

<details>
<summary><strong>Общий запуск: documents перед Z103</strong><br>
Сценарий ждёт свой task.id, затем свежий ready и только потом стартует связи.<br>
Сбой/конфликт/изменение task.id останавливает последовательность.<br>
Прямой запуск bib-to-bib остаётся отдельной командой оператора.</summary>

[run-documents-before-relations.mjs](../scripts/run-documents-before-relations.mjs#L10)
запускается на сервере с Node 24 и доступом к Docker. Оба worker должны уже работать,
пути input относятся к mount соответствующего контейнера.

```bash
node scripts/run-documents-before-relations.mjs \
  --input /source/rsl01_z00.dat.tar.gz --member rsl01_z00.dat \
  --relations-input /source/rsl01_z103.dat
```

Для готовых COPY-пакетов или восстановления:

```bash
node scripts/run-documents-before-relations.mjs \
  --packages /work/reports/TASK_ID/copy \
  --relations-input /source/rsl01_z103.dat
```

Имена контейнеров переопределяются через --documents-container/--relations-container.
По умолчанию validation-policy=reject; preserve нужно указать при исходной подготовке.
Сценарий вызывает docker exec с явным Node CLI, ждёт status каждые две секунды,
проверяет завершение именно созданного задания. После load/run отдельно запускается ready;
после его успеха — relations worker start --stage run. Сценарий ждёт также завершения связей.
Пути отчётов/ошибок выдаются worker. При остановке самого сценария серверные задания
могут продолжать работу; перед повтором проверьте status, при необходимости worker stop.

Сценарий обеспечивает порядок при его использовании. Он не модифицирует соседний проект
и не блокирует прямой запуск импортёра Z103 другой командой. Ready отражает состояние БД
в момент проверки; изменение БД между ним и анализом связей обнаруживается собственными
проверками импортёра связей, абсолютной общей транзакции двух конвейеров нет.

</details>

<a id="ci"></a>
<a id="ci-trigger"></a>
<a id="ci-verify"></a>
<a id="ci-publish"></a>

<details>
<summary><strong>GitHub Actions: сборка при push в main</strong><br>
Push main → проверки с PostgreSQL → GHCR documents-SHA → documents-main.<br>
После публикации abis-deploy-watch скачивает documents-main.<br>
Registry login хранится на сервере; CI не подключается по VPN/SSH.</summary>

[documents.yml](../.github/workflows/documents.yml#L6) запускается при push main
или workflow_dispatch для main. verify выполняет npm ci, check и format:documents:check
в Node 24 с одноразовой PostgreSQL 17; TEST_DATABASE_URL включает интеграционные тесты.
При ошибке verify публикация не выполняется. Обычный Checks продолжает проверять PR;
release.yml по v*-тегам продолжает выпускать отдельные исполняемые файлы.

[publish](../.github/workflows/documents.yml#L47) получает packages:write и временный
GITHUB_TOKEN. Buildx собирает target=documents, linux/amd64 и публикует
`ghcr.io/mbob72/marc_parser:documents-<полный SHA>`. Метки OCI содержат revision/source/created;
build cache сохраняется в GitHub Actions. Сборка и публикация ограничены 20 минутами,
проверки — 15 минутами. .env, source и отчёты в build context не входят.

[Подвижный тег](../.github/workflows/documents.yml#L89) `documents-main` обновляется
на digest только после проверки, что SHA сборки совпадает с текущим HEAD main.
Это предотвращает откат тега при ручном повторе старого pipeline. Concurrency
documents-main исключает одновременную публикацию; работающий pipeline не отменяется.
GitHub может заменить ожидающий pipeline более новым: доставка каждого промежуточного
коммита при частых push не гарантирована. Новый push после проверки HEAD может появиться
до обновления тега; следующий успешный pipeline доставит его позднее.

Успех publish означает публикацию образа. Общий серверный abis-deploy-watch
скачивает documents-main; результат подтверждается phase=ready и revision.
Worker и импорт запускаются отдельно. VPN/SSH job и встроенный deploy удалены.

</details>

Серверная проверка 13.10.2026: старые marc-documents-deploy и bib-relations-deploy
отсутствуют, удаление контейнеров не потребовалось. Общий сервис ready для всех трёх
парсеров. MARC-worker работает с прежним image ID; его задача не прерывалась.
