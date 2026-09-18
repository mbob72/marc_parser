# DR-E2

Всего срабатываний: **26**. Полный список приведён в частях ниже, без выборки.

## Полный реестр

Скачайте нужную часть и распакуйте: `gzip -dk имя.tsv.gz`. Откройте полученный TSV в Sublime Text. Первая строка — названия колонок. Столбцы `file`, `recordId`, `byteOffset` однозначно указывают источник. Индексы полей, индикаторов и подполей начинаются с нуля. CSV-кавычки сохраняют табуляции и переносы внутри сообщения.

- [Часть 1](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/DR-E2-0001.tsv.gz) — срабатывания 1–26.

## Примеры и точное извлечение

### rsl01_z00.dat, запись 4396489, ID 003437904

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `6213696760`.

Некорректный тег "Z30".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 6213696760 /tmp/003437904-6213696760.dat
subl /tmp/003437904-6213696760.dat
```

### rsl03_z00.dat, запись 213293, ID 000212948

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/archives/rsl03_z00.tar.gz). byteOffset: `209992082`.

Некорректный тег "---".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl03_z00.dat 209992082 /tmp/000212948-209992082.dat
subl /tmp/000212948-209992082.dat
```

### rsl03_z00.dat, запись 500157, ID 000487578

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/archives/rsl03_z00.tar.gz). byteOffset: `450232587`.

Некорректный тег "49 ".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl03_z00.dat 450232587 /tmp/000487578-450232587.dat
subl /tmp/000487578-450232587.dat
```

### rsl03_z00.dat, запись 591372, ID 000590700

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/archives/rsl03_z00.tar.gz). byteOffset: `521062235`.

Некорректный тег "---".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl03_z00.dat 521062235 /tmp/000590700-521062235.dat
subl /tmp/000590700-521062235.dat
```

### rsl03_z00.dat, запись 891834, ID 000890237

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/archives/rsl03_z00.tar.gz). byteOffset: `767009826`.

Некорректный тег "\"50".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl03_z00.dat 767009826 /tmp/000890237-767009826.dat
subl /tmp/000890237-767009826.dat
```

