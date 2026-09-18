"""Build the reviewable Wiki Markdown from completed audit artifacts."""
import collections
import json
import pathlib

root = pathlib.Path('artifacts/rsl-2026-09-17')
files = sorted(root.glob('*.diagnostic.summary.json'))
lines = ['# Анализ выгрузок РГБ от 17 сентября 2026', '',
         'Источник: https://mrsadman.ru/ac34d2e7ff814dac/', '',
         f'Завершённых диагностических отчётов: **{len(files)} из 7**. '
         + ('Полный набор обработан.' if len(files) == 7 else '**Предварительный анализ; загрузка и обработка продолжаются.**'), '',
         '## Методика', '',
         'Использованы AlephSequentialRecordSplitter, AlephSequentialMarcParser, '
         'MarcRecordValidator и MarcJsonSerializer из проекта. Режим `strict` '
         'использует MarcJsonTransform и останавливается на первой структурной ошибке, '
         'как рабочий конвертер. Режим `diagnostic` продолжает после ошибки парсинга '
         'внутри записи, если splitter установил её границы; при ошибке splitter '
         'останавливается и помечает результат неполным. JSON каждой успешно разобранной '
         'записи действительно сериализуется, но не сохраняется на диск. '
         'Ошибки парсинга не считаются успешной сериализацией.', '',
         'В NDJSON номера `recordIndex` начинаются с нуля, `byteOffset` — смещение '
         'в байтах распакованного DAT; диагностический отчёт также содержит `recordId`. '
         'Отчёты strict описывают только префикс до первой ошибки. SHA-256, размер, '
         'Git revision, версия Node и время прогона находятся в summary JSON.', '',
         '## Результаты', '',
         '| База | Тип | Записей | С нарушениями валидации | Ошибки парсинга | Нарушений всего | Полный проход |',
         '|---|---|---:|---:|---:|---:|---|']
for path in files:
    s = json.loads(path.read_text())
    lines.append(f"| {s['file']} | {'Нормативная' if s['category'] == 'authority' else 'Библиографическая'} | {s['recordsProcessed']} | {s['recordsWithValidationErrors']} | {s['recordsWithParsingErrors']} | {s['validationErrors']} | {'Да' if s['complete'] else 'Нет'} |")
lines += ['', 'Число нарушений и число записей различаются: одна запись может нарушать '
          'несколько правил. Записи, которые парсер не разобрал, не прошли валидацию.', '',
          '## Ошибки по базам', '']
for path in files:
    s = json.loads(path.read_text())
    parse = collections.Counter()
    first = {}
    for line in path.with_name(path.name.replace('summary.json', 'errors.ndjson')).open():
        item = json.loads(line)
        if 'parsingError' in item:
            message = item['parsingError']
            parse[message] += 1
            first.setdefault(message, item)
    lines += [f"### {s['file']}", '',
              'Нарушения правил: ' + ', '.join(f'`{k}` — {v}' for k, v in s['rules'].items()) + '.', '']
    for message, count in parse.most_common():
        e = first[message]
        lines += [f"- **{count}**: {message} Пример: recordId `{e.get('recordId')}`, recordIndex `{e['recordIndex']}`, byteOffset `{e['byteOffset']}`."]
    lines.append('')
    strict = json.loads(path.with_name(path.name.replace('diagnostic', 'strict')).read_text())
    lines += [f"Обычная конвертация: {'завершена' if strict['complete'] else 'остановлена'}; успешно обработано {strict['recordsProcessed']} записей. " + strict.get('fatalError', ''), '']
lines += ['## Интерпретация для продуктовой команды', '',
          '1. **Блокеры конвертации.** Неправильная длина, отсутствие/повтор LDR '
          'и неподдерживаемый маркер вызывают исключения парсера. Даже одна такая '
          'запись блокирует выдачу полного результата рабочим конвертером. '
          'Нужно согласовать политику: отклонение файла или карантин отдельных '
          'записей с отчётом. Диагностический пропуск не является исправлением данных.',
          '2. **Профиль LD-02.** Текущий код запрещает Leader/18 `c`, `n` и '
          'Leader/19 `a`, `b`, `c` именно для схемы РГБ. Эти находки показывают '
          'несоответствие реализованному профилю; они сами по себе не доказывают '
          'ошибочность исходных MARC-данных. Продуктовой команде нужно подтвердить '
          'допустимые значения профиля перед массовой правкой данных.',
          '3. **Нормативные записи.** rsl10/rsl11 проверены тем же валидатором. '
          'Отдельного переключателя нормативного профиля в этом прогоне нет. '
          'Отсутствие ошибок не подтверждает полноту проверки MARC Authority; '
          'требуется согласовать отдельные требования к Leader, FMT и полям.',
          '4. **Поля и подполя.** IN-G3/DF-G2 относятся к индикаторам, '
          'DR-E2 — к тегам Directory, DF-G3 — к структуре подполей. '
          'VF-G5 и SF-G4 могут отмечать один и тот же недопустимый код подполя, '
          'поэтому сумму правил нельзя считать числом независимых дефектов.', '',
          '## Артефакты и воспроизведение', '',
          'Все полные реестры: `artifacts/rsl-2026-09-17/*.diagnostic.errors.ndjson`. '
          'Сводки: `*.diagnostic.summary.json`; поведение обычного конвертера: '
          '`*.strict.summary.json` и `*.strict.errors.ndjson`.', '',
          '```bash',
          'node --import tsx scripts/audit-rsl.ts data/rsl-2026-09-17/raw/rsl02_z00.dat /tmp/rsl-audit strict',
          'node --import tsx scripts/audit-rsl.ts data/rsl-2026-09-17/raw/rsl02_z00.dat /tmp/rsl-audit diagnostic',
          'python3 scripts/summarize-rsl.py', '```', '',
          'Для нового прогона используйте новую директорию: существующий реестр '
          'не перезаписывается. Исходники хранятся архивами/частями в LFS; '
          'восстановление описано в `data/rsl-2026-09-17/README.md`.', '',
          '## Публикация', '',
          'Это локальная Markdown-страница для GitHub Wiki с именем '
          '`RSL-validation-2026-09-17`. Коммит и push основного репозитория '
          'и отдельного Wiki-репозитория выполняет владелец. Удалённое '
          'сохранение исходников и очистка локальных копий пока не подтверждены.', '']
pathlib.Path('docs/RSL-validation-2026-09-17.md').write_text('\n'.join(lines))

# Rebuild type registers and source views alongside the overview.
import runpy
import sys
sys.dont_write_bytecode = True
runpy.run_path(str(pathlib.Path(__file__).with_name('group-rsl-errors.py')))
