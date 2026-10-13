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

Серверная проверка 13.10.2026: старые marc-documents-deploy и bib-relations-deploy
отсутствуют, удаление контейнеров не потребовалось. Общий сервис ready для всех трёх
парсеров. MARC-worker работает с прежним image ID; его задача не прерывалась.
