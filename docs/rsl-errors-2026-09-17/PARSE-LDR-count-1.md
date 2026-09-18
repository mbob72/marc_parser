# PARSE-LDR-count — Отсутствующий или повторный LDR (1/1)

[Как найти запись в Sublime Text](../RSL-validation-2026-09-17.md#как-найти-проблемное-место-в-sublime-text)

Ссылки GitHub заработают после коммита и push владельцем. `main` должен содержать этот набор артефактов. Для локального просмотра путь фрагмента совпадает с путём после `blob/main/`. Все индексы полей/индикаторов/подполей начинаются с нуля; № записи начинается с единицы. Смещение — байты исходного распакованного DAT, а не символы или позиция в архиве.

| База / архив | recordId | № записи | byteOffset | Проблемное место | Сообщение | Фрагмент : строка | Отчёт |
|---|---|---:|---:|---|---|---|---|
| [rsl07_z00.dat](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/archives/rsl07_z00.tar.gz) | `000525445` | 518569 | 172845362 | LDR | Error: Aleph-запись должна содержать ровно одно поле LDR; найдено 0. | [Открыть :8](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/records/rsl07_z00/000525445-172845362.txt#L8) | [NDJSON :9](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/rsl07_z00.dat.diagnostic.errors.ndjson#L9) |
| [rsl10_z00.dat](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/archives/rsl10_z00.tar.gz) | `000167015` | 129641 | 64119704 | LDR | Error: Aleph-запись должна содержать ровно одно поле LDR; найдено 2. | [Открыть :13](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/records/rsl10_z00/000167015-64119704.txt#L13) | [NDJSON :9](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/rsl10_z00.dat.diagnostic.errors.ndjson#L9) |
| [rsl11_z00.dat](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/archives/rsl11_z00.tar.gz) | `000131560` | 124066 | 100430016 | LDR | Error: Aleph-запись должна содержать ровно одно поле LDR; найдено 2. | [Открыть :13](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/records/rsl11_z00/000131560-100430016.txt#L13) | [NDJSON :7](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/rsl11_z00.dat.diagnostic.errors.ndjson#L7) |
