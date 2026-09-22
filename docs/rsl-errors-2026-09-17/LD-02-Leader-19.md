# LD-02-Leader-19

Всего срабатываний: **5083166**. Полный список приведён в частях ниже, без выборки.

<!-- error-description:start -->
## Что означает «Код Leader/19 запрещён текущим профилем РГБ»

Текущий валидатор выдаёт LD-02, если Leader/19 содержит `a`, `b` или `c`. Проверка относится к профилю РГБ, реализованному в проекте, и не является универсальной проверкой допустимости MARC.

## Влияние на обработку

Это нарушение валидации после успешного парсинга. Само по себе оно не останавливает JSON-сериализацию; конвертер сохраняет результат и пишет ошибку в отдельный отчёт. Успешная сериализация не доказывает побайтную обратимость и не подтверждает правильность каталожных данных.

## Как найти дефект

Найдите поле LDR; двадцатый байт его значения после шестибайтового заголовка — Leader/19. Не используйте номер символа в общей строке DAT: до поля могут находиться многобайтовые UTF-8-значения.

## Что решить продуктовой команде

Это основной источник массовых срабатываний. В первую очередь подтвердить ограничение профиля и его применимость к выгрузке. Не заменять a/b/c на пробел только ради чистого отчёта.

Выводы относятся к текущему коду и данному набору выгрузок. Для rsl10/rsl11 применён тот же валидатор; отдельная полнота проверки MARC Authority не заявляется.

## Распределение по базам

| База | Срабатываний |
|---|---:|
| rsl01_z00.dat | 5082300 |
| rsl02_z00.dat | 756 |
| rsl06_z00.dat | 106 |
| rsl07_z00.dat | 4 |

Количество — срабатывания этого типа, не число уникальных записей. В одной записи могут быть несколько нарушений.

## Частые варианты сообщения

| Сообщение | Срабатываний |
|---|---:|
| Leader/19 содержит недопустимый для схемы РГБ код "c". | 4118487 |
| Leader/19 содержит недопустимый для схемы РГБ код "b". | 578273 |
| Leader/19 содержит недопустимый для схемы РГБ код "a". | 386406 |

Показаны до десяти наиболее частых формулировок; полный набор находок остаётся в TSV-реестре.

## Разбор исходных значений

### rsl01_z00.dat: 002381350

Leader/19 содержит недопустимый для схемы РГБ код "c".

Запись №71; byteOffset `99397`.

Исходные поля ниже показаны без нормализации ^; JSON-кавычки делают управляющие символы видимыми. Смещение поля указывает на начало четырёх цифр длины.

```text
fieldByteOffset=99419; length=0030; raw="LDR  L00923nad^a2200277^ic4500"
```

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 99397 /tmp/002381350-99397.dat
subl /tmp/002381350-99397.dat
```

### rsl01_z00.dat: 010690292

Leader/19 содержит недопустимый для схемы РГБ код "b".

Запись №16545; byteOffset `20338624`.

Исходные поля ниже показаны без нормализации ^; JSON-кавычки делают управляющие символы видимыми. Смещение поля указывает на начало четырёх цифр длины.

```text
fieldByteOffset=20338646; length=0030; raw="LDR  L^^^^^nab^a22^^^^^^ib4500"
```

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 20338624 /tmp/010690292-20338624.dat
subl /tmp/010690292-20338624.dat
```

### rsl01_z00.dat: 003531223

Leader/19 содержит недопустимый для схемы РГБ код "a".

Запись №4; byteOffset `6610`.

Исходные поля ниже показаны без нормализации ^; JSON-кавычки делают управляющие символы видимыми. Смещение поля указывает на начало четырёх цифр длины.

```text
fieldByteOffset=6632; length=0030; raw="LDR  L00577nac^a22001811ia4500"
```

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 6610 /tmp/003531223-6610.dat
subl /tmp/003531223-6610.dat
```

## Основание проверки

**Статус: Противоречие в источнике.**

- [PDF, страница 19](https://github.com/mbob72/marc_parser/blob/main/docs/rsl-rule-sources/DevRGB-170826-1001-43/page-019.png); [точная выдержка, строка 11](https://github.com/mbob72/marc_parser/blob/main/docs/rsl-rule-sources/DevRGB-170826-1001-43/page-019.md?plain=1#L11)
- [PDF, страница 33](https://github.com/mbob72/marc_parser/blob/main/docs/rsl-rule-sources/DevRGB-170826-1001-43/page-033.png); [точная выдержка, строки 13–14](https://github.com/mbob72/marc_parser/blob/main/docs/rsl-rule-sources/DevRGB-170826-1001-43/page-033.md?plain=1#L13-L14)

На странице 19 коды a/b/c отсутствуют в схеме, но строка № 12 таблицы на странице 33 перечисляет b/c. Текущий валидатор следует странице 19. Приоритет разделов и применимость профиля надо согласовать; 5 083 166 срабатываний нельзя автоматически считать доказанными дефектами исходных записей.

[Реализация в проверенной версии, строка 111](https://github.com/mbob72/marc_parser/blob/8a67485d0337460020dd8d2084db81b321e0d010/src/marc-validator.ts?plain=1#L111). Это ссылка на код, а не замена документального основания.

Строки относятся к Markdown-выдержке или документу проекта. Ссылки на PDF ведут к изображению физической страницы.
<!-- error-description:end -->

## Полный реестр

Скачайте нужную часть и распакуйте: `gzip -dk имя.tsv.gz`. Откройте полученный TSV в Sublime Text. Первая строка — названия колонок. Столбцы `file`, `recordId`, `byteOffset` однозначно указывают источник. Индексы полей, индикаторов и подполей начинаются с нуля. CSV-кавычки сохраняют табуляции и переносы внутри сообщения.

- [Часть 1](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0001.tsv.gz) — срабатывания 1–10000.
- [Часть 2](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0002.tsv.gz) — срабатывания 10001–20000.
- [Часть 3](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0003.tsv.gz) — срабатывания 20001–30000.
- [Часть 4](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0004.tsv.gz) — срабатывания 30001–40000.
- [Часть 5](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0005.tsv.gz) — срабатывания 40001–50000.
- [Часть 6](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0006.tsv.gz) — срабатывания 50001–60000.
- [Часть 7](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0007.tsv.gz) — срабатывания 60001–70000.
- [Часть 8](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0008.tsv.gz) — срабатывания 70001–80000.
- [Часть 9](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0009.tsv.gz) — срабатывания 80001–90000.
- [Часть 10](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0010.tsv.gz) — срабатывания 90001–100000.
- [Часть 11](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0011.tsv.gz) — срабатывания 100001–110000.
- [Часть 12](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0012.tsv.gz) — срабатывания 110001–120000.
- [Часть 13](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0013.tsv.gz) — срабатывания 120001–130000.
- [Часть 14](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0014.tsv.gz) — срабатывания 130001–140000.
- [Часть 15](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0015.tsv.gz) — срабатывания 140001–150000.
- [Часть 16](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0016.tsv.gz) — срабатывания 150001–160000.
- [Часть 17](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0017.tsv.gz) — срабатывания 160001–170000.
- [Часть 18](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0018.tsv.gz) — срабатывания 170001–180000.
- [Часть 19](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0019.tsv.gz) — срабатывания 180001–190000.
- [Часть 20](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0020.tsv.gz) — срабатывания 190001–200000.
- [Часть 21](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0021.tsv.gz) — срабатывания 200001–210000.
- [Часть 22](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0022.tsv.gz) — срабатывания 210001–220000.
- [Часть 23](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0023.tsv.gz) — срабатывания 220001–230000.
- [Часть 24](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0024.tsv.gz) — срабатывания 230001–240000.
- [Часть 25](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0025.tsv.gz) — срабатывания 240001–250000.
- [Часть 26](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0026.tsv.gz) — срабатывания 250001–260000.
- [Часть 27](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0027.tsv.gz) — срабатывания 260001–270000.
- [Часть 28](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0028.tsv.gz) — срабатывания 270001–280000.
- [Часть 29](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0029.tsv.gz) — срабатывания 280001–290000.
- [Часть 30](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0030.tsv.gz) — срабатывания 290001–300000.
- [Часть 31](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0031.tsv.gz) — срабатывания 300001–310000.
- [Часть 32](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0032.tsv.gz) — срабатывания 310001–320000.
- [Часть 33](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0033.tsv.gz) — срабатывания 320001–330000.
- [Часть 34](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0034.tsv.gz) — срабатывания 330001–340000.
- [Часть 35](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0035.tsv.gz) — срабатывания 340001–350000.
- [Часть 36](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0036.tsv.gz) — срабатывания 350001–360000.
- [Часть 37](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0037.tsv.gz) — срабатывания 360001–370000.
- [Часть 38](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0038.tsv.gz) — срабатывания 370001–380000.
- [Часть 39](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0039.tsv.gz) — срабатывания 380001–390000.
- [Часть 40](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0040.tsv.gz) — срабатывания 390001–400000.
- [Часть 41](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0041.tsv.gz) — срабатывания 400001–410000.
- [Часть 42](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0042.tsv.gz) — срабатывания 410001–420000.
- [Часть 43](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0043.tsv.gz) — срабатывания 420001–430000.
- [Часть 44](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0044.tsv.gz) — срабатывания 430001–440000.
- [Часть 45](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0045.tsv.gz) — срабатывания 440001–450000.
- [Часть 46](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0046.tsv.gz) — срабатывания 450001–460000.
- [Часть 47](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0047.tsv.gz) — срабатывания 460001–470000.
- [Часть 48](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0048.tsv.gz) — срабатывания 470001–480000.
- [Часть 49](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0049.tsv.gz) — срабатывания 480001–490000.
- [Часть 50](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0050.tsv.gz) — срабатывания 490001–500000.
- [Часть 51](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0051.tsv.gz) — срабатывания 500001–510000.
- [Часть 52](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0052.tsv.gz) — срабатывания 510001–520000.
- [Часть 53](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0053.tsv.gz) — срабатывания 520001–530000.
- [Часть 54](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0054.tsv.gz) — срабатывания 530001–540000.
- [Часть 55](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0055.tsv.gz) — срабатывания 540001–550000.
- [Часть 56](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0056.tsv.gz) — срабатывания 550001–560000.
- [Часть 57](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0057.tsv.gz) — срабатывания 560001–570000.
- [Часть 58](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0058.tsv.gz) — срабатывания 570001–580000.
- [Часть 59](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0059.tsv.gz) — срабатывания 580001–590000.
- [Часть 60](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0060.tsv.gz) — срабатывания 590001–600000.
- [Часть 61](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0061.tsv.gz) — срабатывания 600001–610000.
- [Часть 62](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0062.tsv.gz) — срабатывания 610001–620000.
- [Часть 63](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0063.tsv.gz) — срабатывания 620001–630000.
- [Часть 64](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0064.tsv.gz) — срабатывания 630001–640000.
- [Часть 65](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0065.tsv.gz) — срабатывания 640001–650000.
- [Часть 66](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0066.tsv.gz) — срабатывания 650001–660000.
- [Часть 67](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0067.tsv.gz) — срабатывания 660001–670000.
- [Часть 68](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0068.tsv.gz) — срабатывания 670001–680000.
- [Часть 69](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0069.tsv.gz) — срабатывания 680001–690000.
- [Часть 70](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0070.tsv.gz) — срабатывания 690001–700000.
- [Часть 71](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0071.tsv.gz) — срабатывания 700001–710000.
- [Часть 72](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0072.tsv.gz) — срабатывания 710001–720000.
- [Часть 73](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0073.tsv.gz) — срабатывания 720001–730000.
- [Часть 74](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0074.tsv.gz) — срабатывания 730001–740000.
- [Часть 75](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0075.tsv.gz) — срабатывания 740001–750000.
- [Часть 76](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0076.tsv.gz) — срабатывания 750001–760000.
- [Часть 77](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0077.tsv.gz) — срабатывания 760001–770000.
- [Часть 78](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0078.tsv.gz) — срабатывания 770001–780000.
- [Часть 79](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0079.tsv.gz) — срабатывания 780001–790000.
- [Часть 80](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0080.tsv.gz) — срабатывания 790001–800000.
- [Часть 81](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0081.tsv.gz) — срабатывания 800001–810000.
- [Часть 82](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0082.tsv.gz) — срабатывания 810001–820000.
- [Часть 83](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0083.tsv.gz) — срабатывания 820001–830000.
- [Часть 84](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0084.tsv.gz) — срабатывания 830001–840000.
- [Часть 85](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0085.tsv.gz) — срабатывания 840001–850000.
- [Часть 86](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0086.tsv.gz) — срабатывания 850001–860000.
- [Часть 87](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0087.tsv.gz) — срабатывания 860001–870000.
- [Часть 88](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0088.tsv.gz) — срабатывания 870001–880000.
- [Часть 89](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0089.tsv.gz) — срабатывания 880001–890000.
- [Часть 90](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0090.tsv.gz) — срабатывания 890001–900000.
- [Часть 91](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0091.tsv.gz) — срабатывания 900001–910000.
- [Часть 92](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0092.tsv.gz) — срабатывания 910001–920000.
- [Часть 93](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0093.tsv.gz) — срабатывания 920001–930000.
- [Часть 94](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0094.tsv.gz) — срабатывания 930001–940000.
- [Часть 95](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0095.tsv.gz) — срабатывания 940001–950000.
- [Часть 96](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0096.tsv.gz) — срабатывания 950001–960000.
- [Часть 97](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0097.tsv.gz) — срабатывания 960001–970000.
- [Часть 98](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0098.tsv.gz) — срабатывания 970001–980000.
- [Часть 99](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0099.tsv.gz) — срабатывания 980001–990000.
- [Часть 100](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0100.tsv.gz) — срабатывания 990001–1000000.
- [Часть 101](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0101.tsv.gz) — срабатывания 1000001–1010000.
- [Часть 102](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0102.tsv.gz) — срабатывания 1010001–1020000.
- [Часть 103](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0103.tsv.gz) — срабатывания 1020001–1030000.
- [Часть 104](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0104.tsv.gz) — срабатывания 1030001–1040000.
- [Часть 105](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0105.tsv.gz) — срабатывания 1040001–1050000.
- [Часть 106](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0106.tsv.gz) — срабатывания 1050001–1060000.
- [Часть 107](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0107.tsv.gz) — срабатывания 1060001–1070000.
- [Часть 108](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0108.tsv.gz) — срабатывания 1070001–1080000.
- [Часть 109](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0109.tsv.gz) — срабатывания 1080001–1090000.
- [Часть 110](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0110.tsv.gz) — срабатывания 1090001–1100000.
- [Часть 111](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0111.tsv.gz) — срабатывания 1100001–1110000.
- [Часть 112](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0112.tsv.gz) — срабатывания 1110001–1120000.
- [Часть 113](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0113.tsv.gz) — срабатывания 1120001–1130000.
- [Часть 114](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0114.tsv.gz) — срабатывания 1130001–1140000.
- [Часть 115](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0115.tsv.gz) — срабатывания 1140001–1150000.
- [Часть 116](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0116.tsv.gz) — срабатывания 1150001–1160000.
- [Часть 117](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0117.tsv.gz) — срабатывания 1160001–1170000.
- [Часть 118](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0118.tsv.gz) — срабатывания 1170001–1180000.
- [Часть 119](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0119.tsv.gz) — срабатывания 1180001–1190000.
- [Часть 120](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0120.tsv.gz) — срабатывания 1190001–1200000.
- [Часть 121](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0121.tsv.gz) — срабатывания 1200001–1210000.
- [Часть 122](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0122.tsv.gz) — срабатывания 1210001–1220000.
- [Часть 123](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0123.tsv.gz) — срабатывания 1220001–1230000.
- [Часть 124](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0124.tsv.gz) — срабатывания 1230001–1240000.
- [Часть 125](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0125.tsv.gz) — срабатывания 1240001–1250000.
- [Часть 126](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0126.tsv.gz) — срабатывания 1250001–1260000.
- [Часть 127](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0127.tsv.gz) — срабатывания 1260001–1270000.
- [Часть 128](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0128.tsv.gz) — срабатывания 1270001–1280000.
- [Часть 129](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0129.tsv.gz) — срабатывания 1280001–1290000.
- [Часть 130](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0130.tsv.gz) — срабатывания 1290001–1300000.
- [Часть 131](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0131.tsv.gz) — срабатывания 1300001–1310000.
- [Часть 132](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0132.tsv.gz) — срабатывания 1310001–1320000.
- [Часть 133](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0133.tsv.gz) — срабатывания 1320001–1330000.
- [Часть 134](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0134.tsv.gz) — срабатывания 1330001–1340000.
- [Часть 135](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0135.tsv.gz) — срабатывания 1340001–1350000.
- [Часть 136](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0136.tsv.gz) — срабатывания 1350001–1360000.
- [Часть 137](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0137.tsv.gz) — срабатывания 1360001–1370000.
- [Часть 138](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0138.tsv.gz) — срабатывания 1370001–1380000.
- [Часть 139](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0139.tsv.gz) — срабатывания 1380001–1390000.
- [Часть 140](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0140.tsv.gz) — срабатывания 1390001–1400000.
- [Часть 141](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0141.tsv.gz) — срабатывания 1400001–1410000.
- [Часть 142](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0142.tsv.gz) — срабатывания 1410001–1420000.
- [Часть 143](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0143.tsv.gz) — срабатывания 1420001–1430000.
- [Часть 144](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0144.tsv.gz) — срабатывания 1430001–1440000.
- [Часть 145](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0145.tsv.gz) — срабатывания 1440001–1450000.
- [Часть 146](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0146.tsv.gz) — срабатывания 1450001–1460000.
- [Часть 147](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0147.tsv.gz) — срабатывания 1460001–1470000.
- [Часть 148](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0148.tsv.gz) — срабатывания 1470001–1480000.
- [Часть 149](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0149.tsv.gz) — срабатывания 1480001–1490000.
- [Часть 150](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0150.tsv.gz) — срабатывания 1490001–1500000.
- [Часть 151](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0151.tsv.gz) — срабатывания 1500001–1510000.
- [Часть 152](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0152.tsv.gz) — срабатывания 1510001–1520000.
- [Часть 153](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0153.tsv.gz) — срабатывания 1520001–1530000.
- [Часть 154](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0154.tsv.gz) — срабатывания 1530001–1540000.
- [Часть 155](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0155.tsv.gz) — срабатывания 1540001–1550000.
- [Часть 156](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0156.tsv.gz) — срабатывания 1550001–1560000.
- [Часть 157](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0157.tsv.gz) — срабатывания 1560001–1570000.
- [Часть 158](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0158.tsv.gz) — срабатывания 1570001–1580000.
- [Часть 159](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0159.tsv.gz) — срабатывания 1580001–1590000.
- [Часть 160](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0160.tsv.gz) — срабатывания 1590001–1600000.
- [Часть 161](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0161.tsv.gz) — срабатывания 1600001–1610000.
- [Часть 162](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0162.tsv.gz) — срабатывания 1610001–1620000.
- [Часть 163](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0163.tsv.gz) — срабатывания 1620001–1630000.
- [Часть 164](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0164.tsv.gz) — срабатывания 1630001–1640000.
- [Часть 165](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0165.tsv.gz) — срабатывания 1640001–1650000.
- [Часть 166](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0166.tsv.gz) — срабатывания 1650001–1660000.
- [Часть 167](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0167.tsv.gz) — срабатывания 1660001–1670000.
- [Часть 168](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0168.tsv.gz) — срабатывания 1670001–1680000.
- [Часть 169](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0169.tsv.gz) — срабатывания 1680001–1690000.
- [Часть 170](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0170.tsv.gz) — срабатывания 1690001–1700000.
- [Часть 171](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0171.tsv.gz) — срабатывания 1700001–1710000.
- [Часть 172](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0172.tsv.gz) — срабатывания 1710001–1720000.
- [Часть 173](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0173.tsv.gz) — срабатывания 1720001–1730000.
- [Часть 174](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0174.tsv.gz) — срабатывания 1730001–1740000.
- [Часть 175](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0175.tsv.gz) — срабатывания 1740001–1750000.
- [Часть 176](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0176.tsv.gz) — срабатывания 1750001–1760000.
- [Часть 177](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0177.tsv.gz) — срабатывания 1760001–1770000.
- [Часть 178](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0178.tsv.gz) — срабатывания 1770001–1780000.
- [Часть 179](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0179.tsv.gz) — срабатывания 1780001–1790000.
- [Часть 180](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0180.tsv.gz) — срабатывания 1790001–1800000.
- [Часть 181](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0181.tsv.gz) — срабатывания 1800001–1810000.
- [Часть 182](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0182.tsv.gz) — срабатывания 1810001–1820000.
- [Часть 183](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0183.tsv.gz) — срабатывания 1820001–1830000.
- [Часть 184](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0184.tsv.gz) — срабатывания 1830001–1840000.
- [Часть 185](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0185.tsv.gz) — срабатывания 1840001–1850000.
- [Часть 186](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0186.tsv.gz) — срабатывания 1850001–1860000.
- [Часть 187](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0187.tsv.gz) — срабатывания 1860001–1870000.
- [Часть 188](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0188.tsv.gz) — срабатывания 1870001–1880000.
- [Часть 189](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0189.tsv.gz) — срабатывания 1880001–1890000.
- [Часть 190](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0190.tsv.gz) — срабатывания 1890001–1900000.
- [Часть 191](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0191.tsv.gz) — срабатывания 1900001–1910000.
- [Часть 192](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0192.tsv.gz) — срабатывания 1910001–1920000.
- [Часть 193](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0193.tsv.gz) — срабатывания 1920001–1930000.
- [Часть 194](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0194.tsv.gz) — срабатывания 1930001–1940000.
- [Часть 195](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0195.tsv.gz) — срабатывания 1940001–1950000.
- [Часть 196](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0196.tsv.gz) — срабатывания 1950001–1960000.
- [Часть 197](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0197.tsv.gz) — срабатывания 1960001–1970000.
- [Часть 198](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0198.tsv.gz) — срабатывания 1970001–1980000.
- [Часть 199](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0199.tsv.gz) — срабатывания 1980001–1990000.
- [Часть 200](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0200.tsv.gz) — срабатывания 1990001–2000000.
- [Часть 201](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0201.tsv.gz) — срабатывания 2000001–2010000.
- [Часть 202](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0202.tsv.gz) — срабатывания 2010001–2020000.
- [Часть 203](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0203.tsv.gz) — срабатывания 2020001–2030000.
- [Часть 204](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0204.tsv.gz) — срабатывания 2030001–2040000.
- [Часть 205](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0205.tsv.gz) — срабатывания 2040001–2050000.
- [Часть 206](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0206.tsv.gz) — срабатывания 2050001–2060000.
- [Часть 207](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0207.tsv.gz) — срабатывания 2060001–2070000.
- [Часть 208](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0208.tsv.gz) — срабатывания 2070001–2080000.
- [Часть 209](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0209.tsv.gz) — срабатывания 2080001–2090000.
- [Часть 210](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0210.tsv.gz) — срабатывания 2090001–2100000.
- [Часть 211](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0211.tsv.gz) — срабатывания 2100001–2110000.
- [Часть 212](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0212.tsv.gz) — срабатывания 2110001–2120000.
- [Часть 213](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0213.tsv.gz) — срабатывания 2120001–2130000.
- [Часть 214](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0214.tsv.gz) — срабатывания 2130001–2140000.
- [Часть 215](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0215.tsv.gz) — срабатывания 2140001–2150000.
- [Часть 216](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0216.tsv.gz) — срабатывания 2150001–2160000.
- [Часть 217](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0217.tsv.gz) — срабатывания 2160001–2170000.
- [Часть 218](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0218.tsv.gz) — срабатывания 2170001–2180000.
- [Часть 219](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0219.tsv.gz) — срабатывания 2180001–2190000.
- [Часть 220](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0220.tsv.gz) — срабатывания 2190001–2200000.
- [Часть 221](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0221.tsv.gz) — срабатывания 2200001–2210000.
- [Часть 222](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0222.tsv.gz) — срабатывания 2210001–2220000.
- [Часть 223](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0223.tsv.gz) — срабатывания 2220001–2230000.
- [Часть 224](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0224.tsv.gz) — срабатывания 2230001–2240000.
- [Часть 225](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0225.tsv.gz) — срабатывания 2240001–2250000.
- [Часть 226](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0226.tsv.gz) — срабатывания 2250001–2260000.
- [Часть 227](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0227.tsv.gz) — срабатывания 2260001–2270000.
- [Часть 228](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0228.tsv.gz) — срабатывания 2270001–2280000.
- [Часть 229](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0229.tsv.gz) — срабатывания 2280001–2290000.
- [Часть 230](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0230.tsv.gz) — срабатывания 2290001–2300000.
- [Часть 231](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0231.tsv.gz) — срабатывания 2300001–2310000.
- [Часть 232](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0232.tsv.gz) — срабатывания 2310001–2320000.
- [Часть 233](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0233.tsv.gz) — срабатывания 2320001–2330000.
- [Часть 234](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0234.tsv.gz) — срабатывания 2330001–2340000.
- [Часть 235](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0235.tsv.gz) — срабатывания 2340001–2350000.
- [Часть 236](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0236.tsv.gz) — срабатывания 2350001–2360000.
- [Часть 237](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0237.tsv.gz) — срабатывания 2360001–2370000.
- [Часть 238](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0238.tsv.gz) — срабатывания 2370001–2380000.
- [Часть 239](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0239.tsv.gz) — срабатывания 2380001–2390000.
- [Часть 240](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0240.tsv.gz) — срабатывания 2390001–2400000.
- [Часть 241](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0241.tsv.gz) — срабатывания 2400001–2410000.
- [Часть 242](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0242.tsv.gz) — срабатывания 2410001–2420000.
- [Часть 243](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0243.tsv.gz) — срабатывания 2420001–2430000.
- [Часть 244](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0244.tsv.gz) — срабатывания 2430001–2440000.
- [Часть 245](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0245.tsv.gz) — срабатывания 2440001–2450000.
- [Часть 246](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0246.tsv.gz) — срабатывания 2450001–2460000.
- [Часть 247](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0247.tsv.gz) — срабатывания 2460001–2470000.
- [Часть 248](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0248.tsv.gz) — срабатывания 2470001–2480000.
- [Часть 249](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0249.tsv.gz) — срабатывания 2480001–2490000.
- [Часть 250](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0250.tsv.gz) — срабатывания 2490001–2500000.
- [Часть 251](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0251.tsv.gz) — срабатывания 2500001–2510000.
- [Часть 252](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0252.tsv.gz) — срабатывания 2510001–2520000.
- [Часть 253](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0253.tsv.gz) — срабатывания 2520001–2530000.
- [Часть 254](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0254.tsv.gz) — срабатывания 2530001–2540000.
- [Часть 255](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0255.tsv.gz) — срабатывания 2540001–2550000.
- [Часть 256](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0256.tsv.gz) — срабатывания 2550001–2560000.
- [Часть 257](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0257.tsv.gz) — срабатывания 2560001–2570000.
- [Часть 258](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0258.tsv.gz) — срабатывания 2570001–2580000.
- [Часть 259](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0259.tsv.gz) — срабатывания 2580001–2590000.
- [Часть 260](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0260.tsv.gz) — срабатывания 2590001–2600000.
- [Часть 261](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0261.tsv.gz) — срабатывания 2600001–2610000.
- [Часть 262](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0262.tsv.gz) — срабатывания 2610001–2620000.
- [Часть 263](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0263.tsv.gz) — срабатывания 2620001–2630000.
- [Часть 264](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0264.tsv.gz) — срабатывания 2630001–2640000.
- [Часть 265](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0265.tsv.gz) — срабатывания 2640001–2650000.
- [Часть 266](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0266.tsv.gz) — срабатывания 2650001–2660000.
- [Часть 267](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0267.tsv.gz) — срабатывания 2660001–2670000.
- [Часть 268](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0268.tsv.gz) — срабатывания 2670001–2680000.
- [Часть 269](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0269.tsv.gz) — срабатывания 2680001–2690000.
- [Часть 270](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0270.tsv.gz) — срабатывания 2690001–2700000.
- [Часть 271](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0271.tsv.gz) — срабатывания 2700001–2710000.
- [Часть 272](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0272.tsv.gz) — срабатывания 2710001–2720000.
- [Часть 273](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0273.tsv.gz) — срабатывания 2720001–2730000.
- [Часть 274](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0274.tsv.gz) — срабатывания 2730001–2740000.
- [Часть 275](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0275.tsv.gz) — срабатывания 2740001–2750000.
- [Часть 276](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0276.tsv.gz) — срабатывания 2750001–2760000.
- [Часть 277](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0277.tsv.gz) — срабатывания 2760001–2770000.
- [Часть 278](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0278.tsv.gz) — срабатывания 2770001–2780000.
- [Часть 279](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0279.tsv.gz) — срабатывания 2780001–2790000.
- [Часть 280](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0280.tsv.gz) — срабатывания 2790001–2800000.
- [Часть 281](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0281.tsv.gz) — срабатывания 2800001–2810000.
- [Часть 282](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0282.tsv.gz) — срабатывания 2810001–2820000.
- [Часть 283](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0283.tsv.gz) — срабатывания 2820001–2830000.
- [Часть 284](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0284.tsv.gz) — срабатывания 2830001–2840000.
- [Часть 285](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0285.tsv.gz) — срабатывания 2840001–2850000.
- [Часть 286](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0286.tsv.gz) — срабатывания 2850001–2860000.
- [Часть 287](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0287.tsv.gz) — срабатывания 2860001–2870000.
- [Часть 288](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0288.tsv.gz) — срабатывания 2870001–2880000.
- [Часть 289](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0289.tsv.gz) — срабатывания 2880001–2890000.
- [Часть 290](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0290.tsv.gz) — срабатывания 2890001–2900000.
- [Часть 291](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0291.tsv.gz) — срабатывания 2900001–2910000.
- [Часть 292](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0292.tsv.gz) — срабатывания 2910001–2920000.
- [Часть 293](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0293.tsv.gz) — срабатывания 2920001–2930000.
- [Часть 294](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0294.tsv.gz) — срабатывания 2930001–2940000.
- [Часть 295](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0295.tsv.gz) — срабатывания 2940001–2950000.
- [Часть 296](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0296.tsv.gz) — срабатывания 2950001–2960000.
- [Часть 297](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0297.tsv.gz) — срабатывания 2960001–2970000.
- [Часть 298](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0298.tsv.gz) — срабатывания 2970001–2980000.
- [Часть 299](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0299.tsv.gz) — срабатывания 2980001–2990000.
- [Часть 300](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0300.tsv.gz) — срабатывания 2990001–3000000.
- [Часть 301](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0301.tsv.gz) — срабатывания 3000001–3010000.
- [Часть 302](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0302.tsv.gz) — срабатывания 3010001–3020000.
- [Часть 303](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0303.tsv.gz) — срабатывания 3020001–3030000.
- [Часть 304](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0304.tsv.gz) — срабатывания 3030001–3040000.
- [Часть 305](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0305.tsv.gz) — срабатывания 3040001–3050000.
- [Часть 306](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0306.tsv.gz) — срабатывания 3050001–3060000.
- [Часть 307](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0307.tsv.gz) — срабатывания 3060001–3070000.
- [Часть 308](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0308.tsv.gz) — срабатывания 3070001–3080000.
- [Часть 309](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0309.tsv.gz) — срабатывания 3080001–3090000.
- [Часть 310](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0310.tsv.gz) — срабатывания 3090001–3100000.
- [Часть 311](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0311.tsv.gz) — срабатывания 3100001–3110000.
- [Часть 312](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0312.tsv.gz) — срабатывания 3110001–3120000.
- [Часть 313](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0313.tsv.gz) — срабатывания 3120001–3130000.
- [Часть 314](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0314.tsv.gz) — срабатывания 3130001–3140000.
- [Часть 315](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0315.tsv.gz) — срабатывания 3140001–3150000.
- [Часть 316](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0316.tsv.gz) — срабатывания 3150001–3160000.
- [Часть 317](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0317.tsv.gz) — срабатывания 3160001–3170000.
- [Часть 318](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0318.tsv.gz) — срабатывания 3170001–3180000.
- [Часть 319](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0319.tsv.gz) — срабатывания 3180001–3190000.
- [Часть 320](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0320.tsv.gz) — срабатывания 3190001–3200000.
- [Часть 321](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0321.tsv.gz) — срабатывания 3200001–3210000.
- [Часть 322](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0322.tsv.gz) — срабатывания 3210001–3220000.
- [Часть 323](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0323.tsv.gz) — срабатывания 3220001–3230000.
- [Часть 324](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0324.tsv.gz) — срабатывания 3230001–3240000.
- [Часть 325](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0325.tsv.gz) — срабатывания 3240001–3250000.
- [Часть 326](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0326.tsv.gz) — срабатывания 3250001–3260000.
- [Часть 327](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0327.tsv.gz) — срабатывания 3260001–3270000.
- [Часть 328](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0328.tsv.gz) — срабатывания 3270001–3280000.
- [Часть 329](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0329.tsv.gz) — срабатывания 3280001–3290000.
- [Часть 330](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0330.tsv.gz) — срабатывания 3290001–3300000.
- [Часть 331](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0331.tsv.gz) — срабатывания 3300001–3310000.
- [Часть 332](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0332.tsv.gz) — срабатывания 3310001–3320000.
- [Часть 333](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0333.tsv.gz) — срабатывания 3320001–3330000.
- [Часть 334](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0334.tsv.gz) — срабатывания 3330001–3340000.
- [Часть 335](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0335.tsv.gz) — срабатывания 3340001–3350000.
- [Часть 336](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0336.tsv.gz) — срабатывания 3350001–3360000.
- [Часть 337](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0337.tsv.gz) — срабатывания 3360001–3370000.
- [Часть 338](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0338.tsv.gz) — срабатывания 3370001–3380000.
- [Часть 339](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0339.tsv.gz) — срабатывания 3380001–3390000.
- [Часть 340](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0340.tsv.gz) — срабатывания 3390001–3400000.
- [Часть 341](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0341.tsv.gz) — срабатывания 3400001–3410000.
- [Часть 342](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0342.tsv.gz) — срабатывания 3410001–3420000.
- [Часть 343](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0343.tsv.gz) — срабатывания 3420001–3430000.
- [Часть 344](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0344.tsv.gz) — срабатывания 3430001–3440000.
- [Часть 345](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0345.tsv.gz) — срабатывания 3440001–3450000.
- [Часть 346](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0346.tsv.gz) — срабатывания 3450001–3460000.
- [Часть 347](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0347.tsv.gz) — срабатывания 3460001–3470000.
- [Часть 348](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0348.tsv.gz) — срабатывания 3470001–3480000.
- [Часть 349](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0349.tsv.gz) — срабатывания 3480001–3490000.
- [Часть 350](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0350.tsv.gz) — срабатывания 3490001–3500000.
- [Часть 351](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0351.tsv.gz) — срабатывания 3500001–3510000.
- [Часть 352](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0352.tsv.gz) — срабатывания 3510001–3520000.
- [Часть 353](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0353.tsv.gz) — срабатывания 3520001–3530000.
- [Часть 354](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0354.tsv.gz) — срабатывания 3530001–3540000.
- [Часть 355](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0355.tsv.gz) — срабатывания 3540001–3550000.
- [Часть 356](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0356.tsv.gz) — срабатывания 3550001–3560000.
- [Часть 357](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0357.tsv.gz) — срабатывания 3560001–3570000.
- [Часть 358](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0358.tsv.gz) — срабатывания 3570001–3580000.
- [Часть 359](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0359.tsv.gz) — срабатывания 3580001–3590000.
- [Часть 360](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0360.tsv.gz) — срабатывания 3590001–3600000.
- [Часть 361](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0361.tsv.gz) — срабатывания 3600001–3610000.
- [Часть 362](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0362.tsv.gz) — срабатывания 3610001–3620000.
- [Часть 363](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0363.tsv.gz) — срабатывания 3620001–3630000.
- [Часть 364](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0364.tsv.gz) — срабатывания 3630001–3640000.
- [Часть 365](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0365.tsv.gz) — срабатывания 3640001–3650000.
- [Часть 366](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0366.tsv.gz) — срабатывания 3650001–3660000.
- [Часть 367](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0367.tsv.gz) — срабатывания 3660001–3670000.
- [Часть 368](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0368.tsv.gz) — срабатывания 3670001–3680000.
- [Часть 369](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0369.tsv.gz) — срабатывания 3680001–3690000.
- [Часть 370](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0370.tsv.gz) — срабатывания 3690001–3700000.
- [Часть 371](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0371.tsv.gz) — срабатывания 3700001–3710000.
- [Часть 372](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0372.tsv.gz) — срабатывания 3710001–3720000.
- [Часть 373](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0373.tsv.gz) — срабатывания 3720001–3730000.
- [Часть 374](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0374.tsv.gz) — срабатывания 3730001–3740000.
- [Часть 375](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0375.tsv.gz) — срабатывания 3740001–3750000.
- [Часть 376](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0376.tsv.gz) — срабатывания 3750001–3760000.
- [Часть 377](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0377.tsv.gz) — срабатывания 3760001–3770000.
- [Часть 378](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0378.tsv.gz) — срабатывания 3770001–3780000.
- [Часть 379](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0379.tsv.gz) — срабатывания 3780001–3790000.
- [Часть 380](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0380.tsv.gz) — срабатывания 3790001–3800000.
- [Часть 381](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0381.tsv.gz) — срабатывания 3800001–3810000.
- [Часть 382](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0382.tsv.gz) — срабатывания 3810001–3820000.
- [Часть 383](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0383.tsv.gz) — срабатывания 3820001–3830000.
- [Часть 384](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0384.tsv.gz) — срабатывания 3830001–3840000.
- [Часть 385](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0385.tsv.gz) — срабатывания 3840001–3850000.
- [Часть 386](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0386.tsv.gz) — срабатывания 3850001–3860000.
- [Часть 387](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0387.tsv.gz) — срабатывания 3860001–3870000.
- [Часть 388](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0388.tsv.gz) — срабатывания 3870001–3880000.
- [Часть 389](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0389.tsv.gz) — срабатывания 3880001–3890000.
- [Часть 390](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0390.tsv.gz) — срабатывания 3890001–3900000.
- [Часть 391](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0391.tsv.gz) — срабатывания 3900001–3910000.
- [Часть 392](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0392.tsv.gz) — срабатывания 3910001–3920000.
- [Часть 393](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0393.tsv.gz) — срабатывания 3920001–3930000.
- [Часть 394](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0394.tsv.gz) — срабатывания 3930001–3940000.
- [Часть 395](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0395.tsv.gz) — срабатывания 3940001–3950000.
- [Часть 396](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0396.tsv.gz) — срабатывания 3950001–3960000.
- [Часть 397](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0397.tsv.gz) — срабатывания 3960001–3970000.
- [Часть 398](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0398.tsv.gz) — срабатывания 3970001–3980000.
- [Часть 399](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0399.tsv.gz) — срабатывания 3980001–3990000.
- [Часть 400](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0400.tsv.gz) — срабатывания 3990001–4000000.
- [Часть 401](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0401.tsv.gz) — срабатывания 4000001–4010000.
- [Часть 402](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0402.tsv.gz) — срабатывания 4010001–4020000.
- [Часть 403](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0403.tsv.gz) — срабатывания 4020001–4030000.
- [Часть 404](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0404.tsv.gz) — срабатывания 4030001–4040000.
- [Часть 405](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0405.tsv.gz) — срабатывания 4040001–4050000.
- [Часть 406](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0406.tsv.gz) — срабатывания 4050001–4060000.
- [Часть 407](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0407.tsv.gz) — срабатывания 4060001–4070000.
- [Часть 408](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0408.tsv.gz) — срабатывания 4070001–4080000.
- [Часть 409](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0409.tsv.gz) — срабатывания 4080001–4090000.
- [Часть 410](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0410.tsv.gz) — срабатывания 4090001–4100000.
- [Часть 411](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0411.tsv.gz) — срабатывания 4100001–4110000.
- [Часть 412](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0412.tsv.gz) — срабатывания 4110001–4120000.
- [Часть 413](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0413.tsv.gz) — срабатывания 4120001–4130000.
- [Часть 414](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0414.tsv.gz) — срабатывания 4130001–4140000.
- [Часть 415](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0415.tsv.gz) — срабатывания 4140001–4150000.
- [Часть 416](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0416.tsv.gz) — срабатывания 4150001–4160000.
- [Часть 417](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0417.tsv.gz) — срабатывания 4160001–4170000.
- [Часть 418](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0418.tsv.gz) — срабатывания 4170001–4180000.
- [Часть 419](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0419.tsv.gz) — срабатывания 4180001–4190000.
- [Часть 420](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0420.tsv.gz) — срабатывания 4190001–4200000.
- [Часть 421](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0421.tsv.gz) — срабатывания 4200001–4210000.
- [Часть 422](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0422.tsv.gz) — срабатывания 4210001–4220000.
- [Часть 423](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0423.tsv.gz) — срабатывания 4220001–4230000.
- [Часть 424](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0424.tsv.gz) — срабатывания 4230001–4240000.
- [Часть 425](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0425.tsv.gz) — срабатывания 4240001–4250000.
- [Часть 426](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0426.tsv.gz) — срабатывания 4250001–4260000.
- [Часть 427](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0427.tsv.gz) — срабатывания 4260001–4270000.
- [Часть 428](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0428.tsv.gz) — срабатывания 4270001–4280000.
- [Часть 429](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0429.tsv.gz) — срабатывания 4280001–4290000.
- [Часть 430](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0430.tsv.gz) — срабатывания 4290001–4300000.
- [Часть 431](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0431.tsv.gz) — срабатывания 4300001–4310000.
- [Часть 432](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0432.tsv.gz) — срабатывания 4310001–4320000.
- [Часть 433](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0433.tsv.gz) — срабатывания 4320001–4330000.
- [Часть 434](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0434.tsv.gz) — срабатывания 4330001–4340000.
- [Часть 435](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0435.tsv.gz) — срабатывания 4340001–4350000.
- [Часть 436](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0436.tsv.gz) — срабатывания 4350001–4360000.
- [Часть 437](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0437.tsv.gz) — срабатывания 4360001–4370000.
- [Часть 438](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0438.tsv.gz) — срабатывания 4370001–4380000.
- [Часть 439](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0439.tsv.gz) — срабатывания 4380001–4390000.
- [Часть 440](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0440.tsv.gz) — срабатывания 4390001–4400000.
- [Часть 441](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0441.tsv.gz) — срабатывания 4400001–4410000.
- [Часть 442](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0442.tsv.gz) — срабатывания 4410001–4420000.
- [Часть 443](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0443.tsv.gz) — срабатывания 4420001–4430000.
- [Часть 444](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0444.tsv.gz) — срабатывания 4430001–4440000.
- [Часть 445](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0445.tsv.gz) — срабатывания 4440001–4450000.
- [Часть 446](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0446.tsv.gz) — срабатывания 4450001–4460000.
- [Часть 447](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0447.tsv.gz) — срабатывания 4460001–4470000.
- [Часть 448](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0448.tsv.gz) — срабатывания 4470001–4480000.
- [Часть 449](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0449.tsv.gz) — срабатывания 4480001–4490000.
- [Часть 450](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0450.tsv.gz) — срабатывания 4490001–4500000.
- [Часть 451](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0451.tsv.gz) — срабатывания 4500001–4510000.
- [Часть 452](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0452.tsv.gz) — срабатывания 4510001–4520000.
- [Часть 453](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0453.tsv.gz) — срабатывания 4520001–4530000.
- [Часть 454](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0454.tsv.gz) — срабатывания 4530001–4540000.
- [Часть 455](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0455.tsv.gz) — срабатывания 4540001–4550000.
- [Часть 456](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0456.tsv.gz) — срабатывания 4550001–4560000.
- [Часть 457](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0457.tsv.gz) — срабатывания 4560001–4570000.
- [Часть 458](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0458.tsv.gz) — срабатывания 4570001–4580000.
- [Часть 459](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0459.tsv.gz) — срабатывания 4580001–4590000.
- [Часть 460](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0460.tsv.gz) — срабатывания 4590001–4600000.
- [Часть 461](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0461.tsv.gz) — срабатывания 4600001–4610000.
- [Часть 462](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0462.tsv.gz) — срабатывания 4610001–4620000.
- [Часть 463](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0463.tsv.gz) — срабатывания 4620001–4630000.
- [Часть 464](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0464.tsv.gz) — срабатывания 4630001–4640000.
- [Часть 465](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0465.tsv.gz) — срабатывания 4640001–4650000.
- [Часть 466](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0466.tsv.gz) — срабатывания 4650001–4660000.
- [Часть 467](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0467.tsv.gz) — срабатывания 4660001–4670000.
- [Часть 468](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0468.tsv.gz) — срабатывания 4670001–4680000.
- [Часть 469](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0469.tsv.gz) — срабатывания 4680001–4690000.
- [Часть 470](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0470.tsv.gz) — срабатывания 4690001–4700000.
- [Часть 471](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0471.tsv.gz) — срабатывания 4700001–4710000.
- [Часть 472](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0472.tsv.gz) — срабатывания 4710001–4720000.
- [Часть 473](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0473.tsv.gz) — срабатывания 4720001–4730000.
- [Часть 474](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0474.tsv.gz) — срабатывания 4730001–4740000.
- [Часть 475](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0475.tsv.gz) — срабатывания 4740001–4750000.
- [Часть 476](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0476.tsv.gz) — срабатывания 4750001–4760000.
- [Часть 477](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0477.tsv.gz) — срабатывания 4760001–4770000.
- [Часть 478](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0478.tsv.gz) — срабатывания 4770001–4780000.
- [Часть 479](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0479.tsv.gz) — срабатывания 4780001–4790000.
- [Часть 480](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0480.tsv.gz) — срабатывания 4790001–4800000.
- [Часть 481](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0481.tsv.gz) — срабатывания 4800001–4810000.
- [Часть 482](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0482.tsv.gz) — срабатывания 4810001–4820000.
- [Часть 483](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0483.tsv.gz) — срабатывания 4820001–4830000.
- [Часть 484](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0484.tsv.gz) — срабатывания 4830001–4840000.
- [Часть 485](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0485.tsv.gz) — срабатывания 4840001–4850000.
- [Часть 486](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0486.tsv.gz) — срабатывания 4850001–4860000.
- [Часть 487](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0487.tsv.gz) — срабатывания 4860001–4870000.
- [Часть 488](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0488.tsv.gz) — срабатывания 4870001–4880000.
- [Часть 489](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0489.tsv.gz) — срабатывания 4880001–4890000.
- [Часть 490](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0490.tsv.gz) — срабатывания 4890001–4900000.
- [Часть 491](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0491.tsv.gz) — срабатывания 4900001–4910000.
- [Часть 492](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0492.tsv.gz) — срабатывания 4910001–4920000.
- [Часть 493](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0493.tsv.gz) — срабатывания 4920001–4930000.
- [Часть 494](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0494.tsv.gz) — срабатывания 4930001–4940000.
- [Часть 495](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0495.tsv.gz) — срабатывания 4940001–4950000.
- [Часть 496](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0496.tsv.gz) — срабатывания 4950001–4960000.
- [Часть 497](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0497.tsv.gz) — срабатывания 4960001–4970000.
- [Часть 498](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0498.tsv.gz) — срабатывания 4970001–4980000.
- [Часть 499](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0499.tsv.gz) — срабатывания 4980001–4990000.
- [Часть 500](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0500.tsv.gz) — срабатывания 4990001–5000000.
- [Часть 501](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0501.tsv.gz) — срабатывания 5000001–5010000.
- [Часть 502](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0502.tsv.gz) — срабатывания 5010001–5020000.
- [Часть 503](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0503.tsv.gz) — срабатывания 5020001–5030000.
- [Часть 504](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0504.tsv.gz) — срабатывания 5030001–5040000.
- [Часть 505](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0505.tsv.gz) — срабатывания 5040001–5050000.
- [Часть 506](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0506.tsv.gz) — срабатывания 5050001–5060000.
- [Часть 507](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0507.tsv.gz) — срабатывания 5060001–5070000.
- [Часть 508](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0508.tsv.gz) — срабатывания 5070001–5080000.
- [Часть 509](https://github.com/mbob72/marc_parser/blob/main/artifacts/rsl-2026-09-17/by-type/LD-02-Leader-19-0509.tsv.gz) — срабатывания 5080001–5083166.

## Примеры и точное извлечение

### rsl01_z00.dat, запись 4, ID 003531223

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `6610`.

Leader/19 содержит недопустимый для схемы РГБ код "a".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 6610 /tmp/003531223-6610.dat
subl /tmp/003531223-6610.dat
```

### rsl01_z00.dat, запись 8, ID 003531220

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `12253`.

Leader/19 содержит недопустимый для схемы РГБ код "a".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 12253 /tmp/003531220-12253.dat
subl /tmp/003531220-12253.dat
```

### rsl01_z00.dat, запись 9, ID 003531221

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `13252`.

Leader/19 содержит недопустимый для схемы РГБ код "a".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 13252 /tmp/003531221-13252.dat
subl /tmp/003531221-13252.dat
```

### rsl01_z00.dat, запись 10, ID 003531222

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `14177`.

Leader/19 содержит недопустимый для схемы РГБ код "a".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 14177 /tmp/003531222-14177.dat
subl /tmp/003531222-14177.dat
```

### rsl01_z00.dat, запись 45, ID 003531226

[Исходный архив / восстановление](https://github.com/mbob72/marc_parser/blob/main/data/rsl-2026-09-17/README.md). byteOffset: `65265`.

Leader/19 содержит недопустимый для схемы РГБ код "a".

```bash
python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl01_z00.dat 65265 /tmp/003531226-65265.dat
subl /tmp/003531226-65265.dat
```

