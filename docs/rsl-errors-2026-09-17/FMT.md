# FMT

Всего срабатываний: **2**. Полный список приведён в частях ниже, без выборки.

## Полный реестр

Скачайте нужную часть и распакуйте: `gzip -dk имя.tsv.gz`. Откройте полученный TSV в Sublime Text. Первая строка — названия колонок. Столбцы `file`, `recordId`, `byteOffset` однозначно указывают источник. Индексы полей, индикаторов и подполей начинаются с нуля. CSV-кавычки сохраняют табуляции и переносы внутри сообщения.

- [Часть 1](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/FMT-0001.tsv.gz) — срабатывания 1–2.

## Примеры и точное извлечение

### rsl01_z00.dat, запись 5125216, ID 005528040

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `7301067144`.

Неизвестное значение FMT: "HO".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 7301067144 /tmp/005528040-7301067144.dat
subl /tmp/005528040-7301067144.dat
```

### rsl01_z00.dat, запись 10993794, ID 011621204

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `16149766202`.

Неизвестное значение FMT: "AD".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 16149766202 /tmp/011621204-16149766202.dat
subl /tmp/011621204-16149766202.dat
```

