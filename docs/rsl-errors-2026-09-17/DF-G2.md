# DF-G2

Всего срабатываний: **629**. Полный список приведён в частях ниже, без выборки.

## Полный реестр

Скачайте нужную часть и распакуйте: `gzip -dk имя.tsv.gz`. Откройте полученный TSV в Sublime Text. Первая строка — названия колонок. Столбцы `file`, `recordId`, `byteOffset` однозначно указывают источник. Индексы полей, индикаторов и подполей начинаются с нуля. CSV-кавычки сохраняют табуляции и переносы внутри сообщения.

- [Часть 1](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/DF-G2-0001.tsv.gz) — срабатывания 1–629.

## Примеры и точное извлечение

### rsl03_z00.dat, запись 1204651, ID 001204621

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/archives/rsl03_z00.tar.gz). byteOffset: `1019842606`.

Поле 080 содержит 0 индикатор(а), ожидалось 2.

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl03_z00.dat 1019842606 /tmp/001204621-1019842606.dat
subl /tmp/001204621-1019842606.dat
```

### rsl03_z00.dat, запись 1204651, ID 001204621

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/archives/rsl03_z00.tar.gz). byteOffset: `1019842606`.

Поле 337 содержит 1 индикатор(а), ожидалось 2.

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl03_z00.dat 1019842606 /tmp/001204621-1019842606.dat
subl /tmp/001204621-1019842606.dat
```

### rsl03_z00.dat, запись 1204652, ID 001204622

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/archives/rsl03_z00.tar.gz). byteOffset: `1019843519`.

Поле 080 содержит 0 индикатор(а), ожидалось 2.

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl03_z00.dat 1019843519 /tmp/001204622-1019843519.dat
subl /tmp/001204622-1019843519.dat
```

### rsl03_z00.dat, запись 1204653, ID 001204623

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/archives/rsl03_z00.tar.gz). byteOffset: `1019845097`.

Поле 080 содержит 0 индикатор(а), ожидалось 2.

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl03_z00.dat 1019845097 /tmp/001204623-1019845097.dat
subl /tmp/001204623-1019845097.dat
```

### rsl03_z00.dat, запись 1204654, ID 001204624

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/archives/rsl03_z00.tar.gz). byteOffset: `1019846197`.

Поле 080 содержит 0 индикатор(а), ожидалось 2.

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl03_z00.dat 1019846197 /tmp/001204624-1019846197.dat
subl /tmp/001204624-1019846197.dat
```

