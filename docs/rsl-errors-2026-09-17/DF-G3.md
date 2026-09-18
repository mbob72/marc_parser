# DF-G3

Всего срабатываний: **9410**. Полный список приведён в частях ниже, без выборки.

## Полный реестр

Скачайте нужную часть и распакуйте: `gzip -dk имя.tsv.gz`. Откройте полученный TSV в Sublime Text. Первая строка — названия колонок. Столбцы `file`, `recordId`, `byteOffset` однозначно указывают источник. Индексы полей, индикаторов и подполей начинаются с нуля. CSV-кавычки сохраняют табуляции и переносы внутри сообщения.

- [Часть 1](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/DF-G3-0001.tsv.gz) — срабатывания 1–9410.

## Примеры и точное извлечение

### rsl01_z00.dat, запись 429917, ID 000499416

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `558519749`.

Поле 044 не содержит кода подполя.

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 558519749 /tmp/000499416-558519749.dat
subl /tmp/000499416-558519749.dat
```

### rsl01_z00.dat, запись 445560, ID 000519618

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `578738405`.

Поле 044 не содержит кода подполя.

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 578738405 /tmp/000519618-578738405.dat
subl /tmp/000519618-578738405.dat
```

### rsl01_z00.dat, запись 464380, ID 000544002

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `603032096`.

Поле 044 не содержит кода подполя.

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 603032096 /tmp/000544002-603032096.dat
subl /tmp/000544002-603032096.dat
```

### rsl01_z00.dat, запись 521402, ID 000608007

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `692681153`.

Поле 246 не содержит кода подполя.

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 692681153 /tmp/000608007-692681153.dat
subl /tmp/000608007-692681153.dat
```

### rsl01_z00.dat, запись 936042, ID 000952914

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `1254135273`.

Поле 044 не содержит кода подполя.

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 1254135273 /tmp/000952914-1254135273.dat
subl /tmp/000952914-1254135273.dat
```

