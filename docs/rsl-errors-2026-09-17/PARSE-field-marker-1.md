# PARSE-field-marker — Неподдерживаемый маркер Aleph-поля (1/1)

[Как найти запись в Sublime Text](../RSL-validation-2026-09-17.md#как-найти-проблемное-место-в-sublime-text)

Ссылки GitHub заработают после коммита и push владельцем. `main` должен содержать этот набор артефактов. Для локального просмотра путь фрагмента совпадает с путём после `blob/main/`. Все индексы полей/индикаторов/подполей начинаются с нуля; № записи начинается с единицы. Смещение — байты исходного распакованного DAT, а не символы или позиция в архиве.

| База / архив | recordId | № записи | byteOffset | Проблемное место | Сообщение | Фрагмент : строка | Отчёт |
|---|---|---:|---:|---|---|---|---|
| [rsl06_z00.dat](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/archives/rsl06_z00.tar.gz) | `000125997` | 61621 | 58232378 | record | Error: Aleph-поле содержит неподдерживаемый маркер " ". | [Открыть :27](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/records/rsl06_z00/000125997-58232378.txt#L27) | [NDJSON :107](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/rsl06_z00.dat.diagnostic.errors.ndjson#L107) |
