# PARSE-field-marker

Всего срабатываний: **95**. Полный список приведён в частях ниже, без выборки.

## Полный реестр

Скачайте нужную часть и распакуйте: `gzip -dk имя.tsv.gz`. Откройте полученный TSV в Sublime Text. Первая строка — названия колонок. Столбцы `file`, `recordId`, `byteOffset` однозначно указывают источник. Индексы полей, индикаторов и подполей начинаются с нуля. CSV-кавычки сохраняют табуляции и переносы внутри сообщения.

- [Часть 1](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/PARSE-field-marker-0001.tsv.gz) — срабатывания 1–95.

## Примеры и точное извлечение

### rsl01_z00.dat, запись 1015172, ID 006572532

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `1374185384`.

Error: Aleph-поле содержит неподдерживаемый маркер " ".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 1374185384 /tmp/006572532-1374185384.dat
subl /tmp/006572532-1374185384.dat
```

### rsl01_z00.dat, запись 3488469, ID 003825830

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `4894347062`.

Error: Aleph-поле содержит неподдерживаемый маркер "S".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 4894347062 /tmp/003825830-4894347062.dat
subl /tmp/003825830-4894347062.dat
```

### rsl01_z00.dat, запись 6068409, ID 006552707

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `8457781983`.

Error: Aleph-поле содержит неподдерживаемый маркер "R".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 8457781983 /tmp/006552707-8457781983.dat
subl /tmp/006552707-8457781983.dat
```

### rsl01_z00.dat, запись 7360867, ID 007887508

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `10267595482`.

Error: Aleph-поле содержит неподдерживаемый маркер "l".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 10267595482 /tmp/007887508-10267595482.dat
subl /tmp/007887508-10267595482.dat
```

### rsl01_z00.dat, запись 7361826, ID 007888441

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `10269337948`.

Error: Aleph-поле содержит неподдерживаемый маркер "l".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 10269337948 /tmp/007888441-10269337948.dat
subl /tmp/007888441-10269337948.dat
```

