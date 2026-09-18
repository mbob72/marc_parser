# DF-G2 — Неверное число индикаторов (1/1)

[Как найти запись в Sublime Text](../RSL-validation-2026-09-17.md#как-найти-проблемное-место-в-sublime-text)

Ссылки GitHub заработают после коммита и push владельцем. `main` должен содержать этот набор артефактов. Для локального просмотра путь фрагмента совпадает с путём после `blob/main/`. Все индексы полей/индикаторов/подполей начинаются с нуля; № записи начинается с единицы. Смещение — байты исходного распакованного DAT, а не символы или позиция в архиве.

| База / архив | recordId | № записи | byteOffset | Проблемное место | Сообщение | Фрагмент : строка | Отчёт |
|---|---|---:|---:|---|---|---|---|
| [rsl10_z00.dat](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/archives/rsl10_z00.tar.gz) | `000212087` | 210844 | 107453213 | 667; fieldIndex=11 | Поле 667 содержит 0 индикатор(а), ожидалось 2. | [Открыть :26](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/records/rsl10_z00/000212087-107453213.txt#L26) | [NDJSON :13](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/rsl10_z00.dat.diagnostic.errors.ndjson#L13) |
| [rsl11_z00.dat](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/archives/rsl11_z00.tar.gz) | `000268162` | 263841 | 246714061 | 400; fieldIndex=6 | Поле 400 содержит 1 индикатор(а), ожидалось 2. | [Открыть :21](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/records/rsl11_z00/000268162-246714061.txt#L21) | [NDJSON :47](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/rsl11_z00.dat.diagnostic.errors.ndjson#L47) |
