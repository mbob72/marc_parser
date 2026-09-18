# VF-G5

Всего срабатываний: **178**. Полный список приведён в частях ниже, без выборки.

## Полный реестр

Скачайте нужную часть и распакуйте: `gzip -dk имя.tsv.gz`. Откройте полученный TSV в Sublime Text. Первая строка — названия колонок. Столбцы `file`, `recordId`, `byteOffset` однозначно указывают источник. Индексы полей, индикаторов и подполей начинаются с нуля. CSV-кавычки сохраняют табуляции и переносы внутри сообщения.

- [Часть 1](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/VF-G5-0001.tsv.gz) — срабатывания 1–178.

## Примеры и точное извлечение

### rsl03_z00.dat, запись 559686, ID 000559185

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/archives/rsl03_z00.tar.gz). byteOffset: `496194120`.

Подполе 1 поля 250 имеет недопустимый код "D".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl03_z00.dat 496194120 /tmp/000559185-496194120.dat
subl /tmp/000559185-496194120.dat
```

### rsl03_z00.dat, запись 580138, ID 000579674

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/archives/rsl03_z00.tar.gz). byteOffset: `511687608`.

Подполе 1 поля 020 имеет недопустимый код "D".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl03_z00.dat 511687608 /tmp/000579674-511687608.dat
subl /tmp/000579674-511687608.dat
```

### rsl03_z00.dat, запись 940060, ID 000938235

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/archives/rsl03_z00.tar.gz). byteOffset: `807826105`.

Подполе 2 поля 700 имеет недопустимый код "".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl03_z00.dat 807826105 /tmp/000938235-807826105.dat
subl /tmp/000938235-807826105.dat
```

### rsl03_z00.dat, запись 940060, ID 000938235

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/archives/rsl03_z00.tar.gz). byteOffset: `807826105`.

Подполе 3 поля 700 имеет недопустимый код "Ð".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl03_z00.dat 807826105 /tmp/000938235-807826105.dat
subl /tmp/000938235-807826105.dat
```

### rsl03_z00.dat, запись 944160, ID 000942326

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/archives/rsl03_z00.tar.gz). byteOffset: `811157909`.

Подполе 1 поля 100 имеет недопустимый код "Ð".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl03_z00.dat 811157909 /tmp/000942326-811157909.dat
subl /tmp/000942326-811157909.dat
```

