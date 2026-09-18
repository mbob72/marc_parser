# IN-G3

Всего срабатываний: **9886**. Полный список приведён в частях ниже, без выборки.

## Полный реестр

Скачайте нужную часть и распакуйте: `gzip -dk имя.tsv.gz`. Откройте полученный TSV в Sublime Text. Первая строка — названия колонок. Столбцы `file`, `recordId`, `byteOffset` однозначно указывают источник. Индексы полей, индикаторов и подполей начинаются с нуля. CSV-кавычки сохраняют табуляции и переносы внутри сообщения.

- [Часть 1](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/IN-G3-0001.tsv.gz) — срабатывания 1–9886.

## Примеры и точное извлечение

### rsl01_z00.dat, запись 1388611, ID 001424231

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `1933085327`.

Индикатор 1 поля LVL имеет недопустимое значение "X".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 1933085327 /tmp/001424231-1933085327.dat
subl /tmp/001424231-1933085327.dat
```

### rsl01_z00.dat, запись 1388611, ID 001424231

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `1933085327`.

Индикатор 2 поля LVL имеет недопустимое значение "X".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 1933085327 /tmp/001424231-1933085327.dat
subl /tmp/001424231-1933085327.dat
```

### rsl01_z00.dat, запись 4331313, ID 004684743

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `6105118587`.

Индикатор 1 поля LVL имеет недопустимое значение "X".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 6105118587 /tmp/004684743-6105118587.dat
subl /tmp/004684743-6105118587.dat
```

### rsl01_z00.dat, запись 4331313, ID 004684743

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `6105118587`.

Индикатор 2 поля LVL имеет недопустимое значение "X".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 6105118587 /tmp/004684743-6105118587.dat
subl /tmp/004684743-6105118587.dat
```

### rsl01_z00.dat, запись 4396489, ID 003437904

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `6213696760`.

Индикатор 1 поля Z30 имеет недопустимое значение "-".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 6213696760 /tmp/003437904-6213696760.dat
subl /tmp/003437904-6213696760.dat
```

