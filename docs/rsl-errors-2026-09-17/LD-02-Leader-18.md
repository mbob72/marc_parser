# LD-02-Leader-18

Всего срабатываний: **155**. Полный список приведён в частях ниже, без выборки.

## Полный реестр

Скачайте нужную часть и распакуйте: `gzip -dk имя.tsv.gz`. Откройте полученный TSV в Sublime Text. Первая строка — названия колонок. Столбцы `file`, `recordId`, `byteOffset` однозначно указывают источник. Индексы полей, индикаторов и подполей начинаются с нуля. CSV-кавычки сохраняют табуляции и переносы внутри сообщения.

- [Часть 1](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-18-0001.tsv.gz) — срабатывания 1–155.

## Примеры и точное извлечение

### rsl01_z00.dat, запись 4499260, ID 004949362

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `6341301547`.

Leader/18 содержит недопустимый для схемы РГБ код "c".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 6341301547 /tmp/004949362-6341301547.dat
subl /tmp/004949362-6341301547.dat
```

### rsl01_z00.dat, запись 4563878, ID 004936233

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `6456352176`.

Leader/18 содержит недопустимый для схемы РГБ код "c".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 6456352176 /tmp/004936233-6456352176.dat
subl /tmp/004936233-6456352176.dat
```

### rsl01_z00.dat, запись 4563971, ID 004936334

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `6456526318`.

Leader/18 содержит недопустимый для схемы РГБ код "c".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 6456526318 /tmp/004936334-6456526318.dat
subl /tmp/004936334-6456526318.dat
```

### rsl01_z00.dat, запись 4564011, ID 004936368

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `6456598782`.

Leader/18 содержит недопустимый для схемы РГБ код "c".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 6456598782 /tmp/004936368-6456598782.dat
subl /tmp/004936368-6456598782.dat
```

### rsl01_z00.dat, запись 4564198, ID 004936549

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `6456936246`.

Leader/18 содержит недопустимый для схемы РГБ код "c".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 6456936246 /tmp/004936549-6456936246.dat
subl /tmp/004936549-6456936246.dat
```

