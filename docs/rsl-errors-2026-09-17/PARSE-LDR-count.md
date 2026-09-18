# PARSE-LDR-count

Всего срабатываний: **2259**. Полный список приведён в частях ниже, без выборки.

## Полный реестр

Скачайте нужную часть и распакуйте: `gzip -dk имя.tsv.gz`. Откройте полученный TSV в Sublime Text. Первая строка — названия колонок. Столбцы `file`, `recordId`, `byteOffset` однозначно указывают источник. Индексы полей, индикаторов и подполей начинаются с нуля. CSV-кавычки сохраняют табуляции и переносы внутри сообщения.

- [Часть 1](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/PARSE-LDR-count-0001.tsv.gz) — срабатывания 1–2259.

## Примеры и точное извлечение

### rsl01_z00.dat, запись 5842, ID 000006428

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `7823886`.

Error: Aleph-запись должна содержать ровно одно поле LDR; найдено 2.

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 7823886 /tmp/000006428-7823886.dat
subl /tmp/000006428-7823886.dat
```

### rsl01_z00.dat, запись 342854, ID 006572685

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `468850275`.

Error: Aleph-запись должна содержать ровно одно поле LDR; найдено 2.

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 468850275 /tmp/006572685-468850275.dat
subl /tmp/006572685-468850275.dat
```

### rsl01_z00.dat, запись 345160, ID 006582900

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `470498927`.

Error: Aleph-запись должна содержать ровно одно поле LDR; найдено 3.

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 470498927 /tmp/006582900-470498927.dat
subl /tmp/006582900-470498927.dat
```

### rsl01_z00.dat, запись 351081, ID 006580610

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `474624168`.

Error: Aleph-запись должна содержать ровно одно поле LDR; найдено 2.

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 474624168 /tmp/006580610-474624168.dat
subl /tmp/006580610-474624168.dat
```

### rsl01_z00.dat, запись 351447, ID 006554973

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `474869420`.

Error: Aleph-запись должна содержать ровно одно поле LDR; найдено 2.

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 474869420 /tmp/006554973-474869420.dat
subl /tmp/006554973-474869420.dat
```

