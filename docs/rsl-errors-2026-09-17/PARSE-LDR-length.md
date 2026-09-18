# PARSE-LDR-length

Всего срабатываний: **23789**. Полный список приведён в частях ниже, без выборки.

## Полный реестр

Скачайте нужную часть и распакуйте: `gzip -dk имя.tsv.gz`. Откройте полученный TSV в Sublime Text. Первая строка — названия колонок. Столбцы `file`, `recordId`, `byteOffset` однозначно указывают источник. Индексы полей, индикаторов и подполей начинаются с нуля. CSV-кавычки сохраняют табуляции и переносы внутри сообщения.

- [Часть 1](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/PARSE-LDR-length-0001.tsv.gz) — срабатывания 1–10000.
- [Часть 2](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/PARSE-LDR-length-0002.tsv.gz) — срабатывания 10001–20000.
- [Часть 3](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/PARSE-LDR-length-0003.tsv.gz) — срабатывания 20001–23789.

## Примеры и точное извлечение

### rsl01_z00.dat, запись 314513, ID 006679194

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `449688106`.

Error: Поле LDR Aleph-записи содержит 22 байт; ожидалось 24.

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 449688106 /tmp/006679194-449688106.dat
subl /tmp/006679194-449688106.dat
```

### rsl01_z00.dat, запись 319773, ID 006679264

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `453070781`.

Error: Поле LDR Aleph-записи содержит 22 байт; ожидалось 24.

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 453070781 /tmp/006679264-453070781.dat
subl /tmp/006679264-453070781.dat
```

### rsl01_z00.dat, запись 769857, ID 010241271

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `1053418216`.

Error: Поле LDR Aleph-записи содержит 23 байт; ожидалось 24.

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 1053418216 /tmp/010241271-1053418216.dat
subl /tmp/010241271-1053418216.dat
```

### rsl01_z00.dat, запись 783018, ID 010241272

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `1074432058`.

Error: Поле LDR Aleph-записи содержит 23 байт; ожидалось 24.

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 1074432058 /tmp/010241272-1074432058.dat
subl /tmp/010241272-1074432058.dat
```

### rsl01_z00.dat, запись 822829, ID 006564030

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `1133655526`.

Error: Поле LDR Aleph-записи содержит 22 байт; ожидалось 24.

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 1133655526 /tmp/006564030-1133655526.dat
subl /tmp/006564030-1133655526.dat
```

