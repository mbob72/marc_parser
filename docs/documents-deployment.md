# Контейнер документов: сборка, доставка и запуск

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
documents → documents-cli; worker → documents-worker-cli; deploy → documents-deploy-cli.<br>
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
контроллер доставки для одного worker. Перед первым load check-db проверит схему;
если document_ids ещё не существует, check-db отказывает, а load создаёт его транзакционно.
public.documents должен существовать в любом случае.

</details>

<a id="worker-start"></a>

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
После публикации deploy поднимает OpenVPN и выполняет SSH pull по digest.<br>
Пароль БД остаётся на сервере; VPN/SSH secrets доступны только заданию deploy.</summary>

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

Publish выдаёт outputs image/digest/current. [Deploy](../.github/workflows/documents.yml#L107)
имеет needs:publish и выполняется только для main с current=true. После установки OpenVPN
повторно проверяется HEAD main; устаревшая сборка пропускает доставку. Далее job получает
секреты environment documents-production и временный GITHUB_TOKEN с packages:read.
Токен передаётся серверу по stdin SSH и используется во временном Docker config только
на время pull. Постоянный PAT и публичная видимость пакета не требуются: пакет должен
разрешать Actions-доступ этому репозиторию. При первой публикации OCI source связывает
пакет с репозиторием; для ранее существующего пакета проверьте Manage Actions access.
[Права GitHub Packages](https://docs.github.com/en/packages/managing-github-packages-using-github-actions-workflows/publishing-and-installing-a-package-with-github-actions).

Успех publish означает публикацию, успех deploy — скачивание образа и запись
серверной квитанции. Worker и импорт автоматически не перезапускаются.
Тег documents-main используется для просмотра; deploy всегда получает неизменяемый
digest из своей publish-job. Постоянный опрос и контейнер-контроллер не участвуют.
При отказе VPN/SSH/pull job завершается ошибкой; исправьте причину и повторите failed job.

</details>

<a id="vpn-deploy"></a>
<a id="vpn-secrets"></a>

<details>
<summary><strong>OpenVPN и SSH: настройка доставки</strong><br>
Обычный логин/пароль; профиль подключения передаётся через Environment Secrets.<br>
VPN поднимается на GitHub Runner только для доступа к 10.251.232.53.<br>
Таймаут подключения 120 секунд; всё задание deploy ограничено 15 минутами.</summary>

В Settings → Environments создайте `documents-production`, разрешите deployment только
из main и добавьте secrets из таблицы. Environment approval можно включить отдельно,
но оно остановит полностью автоматическую доставку до подтверждения каждой job.
Профиль и SSH-ключ не помещайте в .env приложения или Git; GitHub не получает доступ к БД.

| Environment secret | Значение |
| --- | --- |
| DOCUMENTS_VPN_PROFILE | Содержимое найденного vpn1-UDP4-1195-bobryshevmyu-connect-config.ovpn вместе с inline-блоками |
| DOCUMENTS_VPN_USERNAME | Логин OpenVPN |
| DOCUMENTS_PASSWORD | Обычный пароль OpenVPN, без OTP |
| DOCUMENTS_SSH_KEY | Приватный SSH-ключ с доступом bobryshevmy к серверу; для BatchMode нужен ключ без интерактивной passphrase |
| DOCUMENTS_SSH_KNOWN_HOSTS | Проверенная запись known_hosts для 10.251.232.53; ключ хоста сверяется заранее через доверенное подключение |

Адрес VPN в найденном профиле — 195.74.82.60:1195 UDP; маршрут назначения — только
10.251.232.53/32. `--route-nopull` исключает pushed routes и DNS; GitHub/GHCR остаются
доступны через обычную сеть Runner. Экспорт Connect не задаёт dev: CLI добавляет `--dev tun`.
Профиль использует встроенные ca/cert/key/tls-auth и проверку сертификата сервера.
Скрипт не отключает TLS-проверку и StrictHostKeyChecking SSH.

В job используется Node 24, OpenVPN из apt Ubuntu, SSH; npm dependencies для deploy
не устанавливаются. Серверу нужны Bash, Docker CLI/daemon и flock (util-linux),
доступ пользователя к Docker и исходящий HTTPS к ghcr.io. VPN endpoint должен
принимать подключения GitHub Runner; сертификат/пароль должны оставаться действительными.
Повторное использование личного VPN-профиля может прервать личный сеанс, если VPN-сервер
не допускает одновременные подключения одного клиента; для CI подходит отдельный профиль.

</details>

<a id="vpn-check"></a>

<details>
<summary><strong>Отдельная проверка секретов и подключения</strong><br>
Documents VPN connection check использует пять secrets из documents-production.<br>
OpenVPN → SSH с проверкой host key → VPN_SSH_CHECK_OK → отключение и очистка.<br>
Образ не скачивается, код приложения не выполняется, БД не открывается.</summary>

[documents-vpn-check.yml](../.github/workflows/documents-vpn-check.yml#L6) поддерживает
ручной workflow_dispatch после появления файла в main и push в временную ветку
codex/vpn-check-*. Он не делает checkout, permissions пусты. Задание ограничено
шестью минутами, VPN ждёт до 120 секунд. Проверка не требует публикации основной
реализации: во временную ветку можно поместить только этот workflow.

[Connect VPN and verify SSH](../.github/workflows/documents-vpn-check.yml#L27) создаёт
временный каталог; вложенный Python проверяет наличие secrets и формат username/password,
пишет профиль, auth, SSH-ключ, known_hosts и пустые log/pid с правами 600. Значения затем
удаляются из окружения дочерних процессов. OpenVPN получает inline-профиль непосредственно
из secret; маршрутизация задаётся теми же CLI-параметрами, что при доставке. Этот probe
проверяет подключение, а совместимость с allowlist основного скрипта проверяется отдельно.

Цикл раз в секунду проверяет признаки отказа авторизации/fatal до признака готовности.
Успех VPN выводит VPN connection established; единственная удалённая команда SSH —
printf VPN_SSH_CHECK_OK. Поэтому второй маркер подтверждает также приватный маршрут,
SSH-ключ и known_hosts. AUTH_FAILED, timeout или ошибка SSH дают ненулевой код job.
Raw VPN log не выводится и не публикуется artifact. Shell-функция cleanup через trap EXIT
посылает TERM числовому PID и удаляет временный каталог; INT/TERM вызывают выход и trap.
При SIGKILL/отказе VM очистка не гарантируется, Runner затем утилизируется GitHub.

На 12 октября список GitHub Environment содержит DOCUMENTS_PASSWORD (фактическое имя
секрета пароля); оба workflow используют это имя. Остальные четыре имени соответствуют
таблице выше. API подтверждает только имена: содержимое секретов прочитать обратно нельзя.
Настройки environment на момент проверки не ограничивали ветки и не требовали review.
Подготовка workflow локально не означает успешного реального соединения: требуется
разрешённая публикация диагностического файла и результат Actions run.

</details>

<a id="vpn-script"></a>

<details>
<summary><strong>Жизненный цикл скрипта на Runner</strong><br>
Проверка параметров → файлы 600 → OpenVPN → SSH → остановка VPN и удаление файлов.<br>
Профиль, пароль и SSH-ключ не выводятся в лог; raw OpenVPN log удаляется.<br>
SIGINT/SIGTERM прерывают ожидание и SSH; finally выполняет очистку.</summary>

Потребитель — [шаг Connect VPN and deliver](../.github/workflows/documents.yml#L132),
который запускает [deploy](../scripts/deploy-documents-vpn.mjs#L151).

| Функция | Контракт и передача управления |
| --- | --- |
| [settings](../scripts/deploy-documents-vpn.mjs#L10) | env → проверенные значения; требует все secrets, проверяет host/image/digest/SHA/имена и отсутствие переводов строк в auth. До сети и записи файлов вызывает profileForRunner; Missing/Invalid останавливают job |
| [profileForRunner](../scripts/deploy-documents-vpn.mjs#L49) | profile → нормализованный текст. Перебирает строки, сохраняет состояние inline-блока и признак remote; копирует сертификаты/ключ, пропускает комментарии и dev/auth-user-pass, допускает только известные директивы. Hooks, внешние config-файлы, другой endpoint и незакрытый блок дают отказ |
| [command](../scripts/deploy-documents-vpn.mjs#L108) | executable/args/input/signal → Promise завершения. spawn без локального shell; input идёт stdin. error/ненулевой close отклоняют Promise, stdin error не создаёт необработанное исключение. quiet скрывает сообщения OpenVPN, вывод SSH остаётся в Actions |
| [shellQuote](../scripts/deploy-documents-vpn.mjs#L131) | строка → один POSIX shell argument; используется для кода Bash и уже проверенных параметров SSH. Токен не включается в команду |
| [waitVpn](../scripts/deploy-documents-vpn.mjs#L137) | log/signal → успешное подключение или ошибка. До 120 итераций читает лог, ищет AUTH_FAILED/fatal до маркера Initialization Sequence Completed, ждёт секунду. Abort прекращает ожидание, timeout запрещает SSH |
| [deploy](../scripts/deploy-documents-vpn.mjs#L151) | env → Promise доставки; после settings удаляет secrets из наследуемого окружения. Создаёт отдельный temp-каталог, последовательно пишет файлы 600, ждёт command(OpenVPN), waitVpn, command(SSH). GHCR token передаёт SSH только stdin. finally читает числовой PID, посылает TERM через sudo, удаляет temp и обработчики сигналов |

Локальные callbacks stop и обработчик CLI: stop отменяет общий AbortController;
catch CLI печатает только сообщение ошибки и выставляет exitCode=1. Подробные секретные
логи не прикладываются к artifacts. При жёстком SIGKILL или потере Runner finally
не гарантирован; временная VM утилизируется GitHub. Удалённый SSH-сеанс может завершить
pull позднее разрыва связи — проверьте квитанцию перед повтором; повторный pull безопасен.

</details>

<a id="ssh-delivery"></a>

<details>
<summary><strong>Одноразовое скачивание на сервере</strong><br>
docker pull image@digest → проверка OCI revision → локальный тег → latest.json.<br>
Короткоживущий job token передаётся stdin, Docker config удаляется при выходе.<br>
Контейнеры не заменяются, старые образы автоматически не удаляются.</summary>

[deliver-documents-image.sh](../scripts/deliver-documents-image.sh#L4) вызывается Bash
внутри SSH-сеанса. Аргументы — image/digest/revision/registry user; stdin — GITHUB_TOKEN.
Сценарий повторно проверяет форматы аргументов, создаёт `$HOME/marc-documents-work/delivery`,
берёт flock на delivery.lock с ожиданием до 30 секунд. DOCUMENTS_DELIVERY_DIR позволяет
явно выбрать другой каталог, в том числе изолировать файловые побочные эффекты в тестах.

[Login/pull](../scripts/deliver-documents-image.sh#L31) используют отдельный mktemp Docker
config, umask 077; существующий `$HOME/.docker/config.json` не изменяется. Затем проверяются
OCI revision и формат image ID. Успех создаёт `image:documents-SHA` и атомарно заменяет
delivery/latest.json с image/digest/revision/imageId/deliveredAt, та же JSON-квитанция
выводится в Actions. Ошибка до rename оставляет прежнюю квитанцию; уже скачанные слои
могут остаться в Docker. Функция [cleanup](../scripts/deliver-documents-image.sh#L22)
удаляет auth-каталог и незавершённую квитанцию; trap EXIT вызывается и при ошибке,
INT/TERM/HUP завершают сценарий с ненулевым кодом. SIGKILL/отказ хоста могут оставить
временный каталог; job token в нём перестанет действовать после завершения job.

```bash
cat "$HOME/marc-documents-work/delivery/latest.json"
docker image inspect ghcr.io/mbob72/marc_parser:documents-SHA
docker exec marc-documents-worker node /app/dist/documents-worker-cli.js status
```

Скачивание не запускает импорт и не меняет работающий worker. Выбор момента обновления
worker остаётся отдельной операцией после завершения его задания. Старые образы
при этой схеме сохраняются до отдельной очистки; лимит трёх версий описанного ниже
альтернативного контроллера к SSH-доставке не применяется.

</details>

<a id="server"></a>
<a id="registry-auth"></a>

<details>
<summary><strong>Альтернативный контроллер: не используется в GitHub Actions</strong><br>
Опрос HTTPS Registry каждые 60 секунд; download по digest.<br>
Доставка не запускает задачи и не заменяет работающий worker.<br>
Docker socket есть только у контроллера; публичный GHCR не требует секретов.</summary>

[deploy CLI](../src/documents-deploy-cli.ts#L10) требует --repository; для текущего
проекта это mbob72/marc_parser. registry по умолчанию ghcr.io, tag documents-main.
С --anonymous контроллер не читает Docker config и не отправляет Basic credentials.
Публичный GHCR выдаёт Bearer token анонимному клиенту с scope repository:...:pull.
Без --anonymous контроллер читает сохранённый Docker login config.json
(`auths[registry].auth`), не запускает docker login и не поддерживает credential helpers.
Auth realm должен использовать HTTPS, тот же host и стандартный порт; redirects отключены.

Текущий workflow использует OpenVPN/SSH и не запускает этот контроллер. Код сохранён
как отдельный механизм доставки; установка постоянного контейнера с Docker socket
в текущем сценарии не требуется. Для --anonymous пакет должен быть Public.

Пример после доставки первого образа:

```bash
REGISTRY=ghcr.io
REPOSITORY=mbob72/marc_parser
BOOTSTRAP_IMAGE="$REGISTRY/$REPOSITORY:documents-main"
WORK="$HOME/marc-documents-work"
SOURCE="$HOME/aleph-downloads-20261009"
DB_ENV="$HOME/marc-documents-config/db.env"
mkdir -p "$HOME/marc-documents-deploy-control"

docker run -d --name marc-documents-deploy --user 0:0 --restart unless-stopped \
  --log-opt max-size=10m --log-opt max-file=3 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$HOME/marc-documents-deploy-control:/control" \
  "$BOOTSTRAP_IMAGE" deploy watch --anonymous --registry "$REGISTRY" --repository "$REPOSITORY" \
  --work-dir "$WORK" --source-dir "$SOURCE" --env-file "$DB_ENV" \
  --uid "$(id -u)" --gid "$(id -g)" --memory 1073741824

docker exec marc-documents-deploy node /app/dist/documents-deploy-cli.js status
docker exec marc-documents-deploy node /app/dist/documents-deploy-cli.js versions
docker exec marc-documents-deploy node /app/dist/documents-deploy-cli.js start
```

Для нового server worker требуются отсутствующее имя контейнера, абсолютные host paths,
UID/GID≥1; cpu default=1, memory default=536870912 (пример выше выбирает 1 GiB).
Не используйте Compose worker с тем же именем. start не выполняет pull;
`--version previous`/`previous-2` выбирает уже доставленный локальный image ID.
Созданный, но не запущенный из-за ошибки контейнер сохраняется для диагностики.

</details>

<a id="runtime"></a>
<a id="retention"></a>
<a id="docker-api"></a>

<details>
<summary><strong>Версии и диагностика доставки</strong><br>
Хранится до трёх image ID; активные и остановленные контейнеры защищают образ.<br>
Перед pull резервируется место: иначе retention_blocked.<br>
deploy status проверяет Docker, worker status — Unix-сокет; это разные проверки.</summary>

[createDeployer](../src/runtime/deployer.ts#L35) сериализует update/start.
Версии упорядочены по Created с tie-break по Id, а не по времени download.
Owned — documents-* tags и digest этого repository; для других приложений используйте
другой repository. Cleanup снимает только собственные tags, без force;
чужие aliases могут мешать соблюдению лимита и остановить доставку.
При ошибке update сохраняется phase=error, работающий worker не затрагивается.
start отказывает при уже существующем контейнере (даже остановленном).

Docker API v1.45 читается через `/var/run/docker.sock`; HTTP timeout 120 секунд,
ответ ограничен 8 MiB, pull JSONL читается потоково. Управляющий Unix-сокет:
одна JSON-команда, один ответ, timeout 10 секунд, максимум 64 KiB; права 600.
Если клиент потерял ответ start, проверьте status перед повтором: действие могло выполниться.

```bash
docker logs --tail 100 marc-documents-deploy
docker logs --tail 100 marc-documents-worker
docker exec marc-documents-worker node /app/dist/documents-worker-cli.js status
```

Логи длительной обработки находятся в host WORK/reports, а не только docker logs.
JSON состояния публикуется через temporary file + rename; это атомарная замена файла,
не гарантия сохранности при отказе диска/потере питания. Авторитет восстановления load —
журнал транзакций PostgreSQL. Control каталог не содержит конфигурацию пароля БД.

</details>

<a id="manual-build"></a>

<details>
<summary><strong>Ручная доставка без CI</strong><br>
Упаковщик включает только исходники сборки, не .env и не выгрузки.<br>
Сборка target=documents выполняется на сервере отдельно от импорта.<br>
Bootstrap контроллера можно сделать из такого локального image.</summary>

[package-documents-container.mjs](../scripts/package-documents-container.mjs#L10)
требует новый каталог:

```bash
node scripts/package-documents-container.mjs --output /tmp/marc-documents-kit
tar -C /tmp/marc-documents-kit -czf /tmp/marc-documents-kit.tar.gz .
scp -i "$HOME/.ssh/id_ed25519_gitlab_rgb" -o IdentitiesOnly=yes \
  /tmp/marc-documents-kit.tar.gz bobryshevmy@10.251.232.53:~/
```

Подключение к серверу использует существующий Ed25519-ключ пользователя:

```bash
ssh -i "$HOME/.ssh/id_ed25519_gitlab_rgb" -o IdentitiesOnly=yes bobryshevmy@10.251.232.53
```

В SSH-сессии сервера:

```bash
mkdir -p "$HOME/marc-documents-kit"
tar -C "$HOME/marc-documents-kit" -xzf "$HOME/marc-documents-kit.tar.gz"
docker build --target documents -t marc-documents:local "$HOME/marc-documents-kit"
```

Далее используйте setup и worker start выше. Сам комплект не содержит source Z00/Z103,
Node modules или собранный dist: npm ci/build выполняются в контейнере, нужен доступ
к npm registry и базовому образу. Подготовленный комплект не является деплоем на сервер.

</details>

<a id="verification"></a>

<details>
<summary><strong>Проверки реализации 12 октября 2026</strong><br>
115 тестов прошли, включая PostgreSQL, runtime и порядок двух конвейеров.<br>
Контейнерный run: три БЗ, два пакета, совпавшие UUID и успешный ready.<br>
На сервере запущен Linux amd64 worker; check-db завершился с exit code 0.<br>
Рабочая БД использовалась только для проверки схемы, массовая загрузка не запускалась.</summary>

Проверены build, Prettier, diff whitespace, ссылки код↔документация и Compose config.
Интеграционные тесты используют отдельную временную PostgreSQL 17: dry-run, продолжение,
повтор без смены UUID, существующий справочник, SHA rollback, конфликты содержимого/UUID,
неоднозначные номера и несовместимая схема. Runtime-тесты проверяют сериализацию start,
drain/stop, реальные пути, invalid args, доставку без замены worker и порядок
load → ready → Z103, включая запрет Z103 при отказе первого этапа.

Dockerfile собран с NODE_IMAGE=marc-parser:local (имеющаяся локальная база Node 24.19.0):
внешний Registry задерживал получение стандартного node:24-bookworm-slim. Runtime
проверен на отдельной Docker-сети с одноразовой PostgreSQL, тремя реальными fixture-БЗ,
полным run и заданием ready через worker. Это проверка Linux ARM64-образа на Mac.

Подключение к bobryshevmy@10.251.232.53 настроено на существующий ключ
~/.ssh/id_ed25519_gitlab_rgb (Ed25519); аутентификация и установка подтверждены.
На сервере образ собран из стандартного `node:24-bookworm-slim`, Node 24.21.0,
архитектура Linux amd64. Контрольная сумма переданного комплекта проверена до сборки.

| Объект | Фактическое значение |
| --- | --- |
| Контейнер | `marc-documents-worker` |
| Образ | `marc-documents:20261012-191012a58786` |
| Image ID | `sha256:d9d5ba7e24f40cecc072ba5238b3eed15b1b772e46ab9e6f73ba0f605d1f2a02` |
| SHA-256 комплекта | `191012a58786561f77740d8971a6bbadaf5ea7d17c8cc3914a01bd392e8498c7` |
| Исходники сборки | `/home/bobryshevmy/marc-documents-kit-20261012` |
| `/work` | `/home/bobryshevmy/marc-documents-work` |
| `/source`, только чтение | `/home/bobryshevmy/aleph-downloads-20261009` |
| `/run/db.env`, только чтение | `/home/bobryshevmy/marc-documents-config/db.env`, права `600` |
| UID:GID / ресурсы | `1002:1003`, 1 CPU, 1 GiB RAM |
| Перезапуск / остановка | `unless-stopped`, 45 секунд |

Конфиг скопирован из `bib-import-config/db.env`, PostgreSQL socket примонтирован
из `/var/run/postgresql`. Пароль отсутствует в образе и документации.
OCI revision равен `working-tree-191012a58786`: сборка содержит незакоммиченные
изменения и не выдаётся за опубликованный Git-коммит.

Задание `2026-10-12T12-26-06-579Z-b0b05c21` выполнило stage=check-db,
status=completed, exitCode=0. Его лог:
`/home/bobryshevmy/marc-documents-work/reports/2026-10-12T12-26-06-579Z-b0b05c21.log`.
Результат — `{"ready":true,"target":"public.documents","identities":"z103_import.document_ids"}`.
Этот check-db подтверждает подключение, схему и необходимые права; полноту данных
проверяет отдельный stage=ready с конкретным COPY-каталогом.

При установке обнаружен завершённый контейнер связей `z103-import-20261009`,
а постоянно работающий `bib-relations-worker` отсутствовал. Поэтому перед запуском
[общего сценария](#sequence) требуется развернуть worker проекта связей;
завершённый одноразовый контейнер не обслуживает управляющие команды.
Повторная загрузка рабочего архива и запуск связей при установке не выполнялись.

Для origin GitHub подготовлен workflow documents.yml: main → GHCR → OpenVPN → SSH pull.
Первая доставка требует Environment Secrets и push изменений. Ручная сборка и запуск worker подтверждены.
Коммит и push не выполнялись; доставка образа из Actions ещё не подтверждена.

Дополнительно проверены actionlint для documents.yml, TypeScript build, Prettier и
пять runtime-тестов, включая анонимный Bearer GHCR, запрет передачи Basic другому
auth-host, пропуск чтения credentials и отсутствие X-Registry-Auth при анонимном pull.
Образ контроллера собран на сервере: `marc-documents:20261012-b63232017019`,
image ID `sha256:fef92d9ee88e992218176f7b1477d749fa47337260ea2c2c5fc868981ef89974`.
Запуск постоянного контроллера требует явно согласованного доступа к Docker socket;
на момент этой проверки контроллер не запущен.

После перехода на VPN/SSH прошли три дополнительных теста: проверка профиля/аргументов,
очистка Runner после успеха/SSH error/VPN auth failure, квитанция и удаление временного
Docker login после успеха/pull error/revision mismatch. Они подменяют внешние команды
и не подтверждают реальное VPN-подключение из GitHub. Найденный локальный .ovpn принят
нормализатором; содержимое не выводилось. Проверены actionlint и Bash syntax.
Реальный deploy не запускался: пользователь оставил изменения локально, секреты
GitHub не создавались. Существующее VPN-подключение пользователя не изменялось.

</details>
