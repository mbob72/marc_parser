"""Build a grouped report for the errors-only RSL audit, preserving source offsets."""
import argparse
import collections
import csv
import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from rsl_record import read_record

ROOT = Path(__file__).resolve().parents[1]
BASES = {'rsl01', 'rsl03', 'rsl06', 'rsl07', 'rsl10', 'rsl11'}
LABELS = {
    'IN-G3': 'Недопустимый символ индикатора',
    'DF-G2': 'Неверное число индикаторов',
    'DF-G3': 'Нет подполя с односимвольным кодом',
    'SF-G4': 'Недопустимый код подполя',
    'DR-E2': 'Недопустимый тег поля',
    'FMT': 'Неизвестный формат',
    'LD-02-Leader-18': 'Код c/n в Leader/18',
    'LD-02-Leader-00-04': 'Длина записи в Leader не соответствует модели',
    'VF-G3': 'Превышена длина поля',
    'RS-G3': 'Превышена длина записи',
    'PARSE-LDR-count': 'Отсутствующий или повторный LDR',
    'PARSE-LDR-length': 'LDR не равен 24 байтам',
    'PARSE-field-marker': 'Неподдерживаемый маркер поля Aleph',
    'PARSE-other': 'Другая структурная ошибка записи',
}
HEAD = ['file', 'recordId', 'recordNumber', 'recordIndex', 'byteOffset', 'fieldIndex', 'tag',
        'sourceFieldNumber', 'fieldByteOffset', 'indicatorIndex', 'subfieldIndex', 'problemByteOffset',
        'reportLine', 'message']


def group_of(error):
    if 'rule' in error:
        match = re.search(r'Leader/(\d+(?:-\d+)?)', error['message'])
        return error['rule'] + ('-Leader-' + match[1] if error['rule'] == 'LD-02' and match else '')
    message = error['message']
    if 'Поле LDR' in message and 'байт' in message: return 'PARSE-LDR-length'
    if 'ровно одно поле LDR' in message: return 'PARSE-LDR-count'
    if 'неподдерживаемый маркер' in message: return 'PARSE-field-marker'
    return 'PARSE-other'


def visible(value):
    return ''.join(f'\\x{ord(c):02x}' if ord(c) < 32 or ord(c) == 127 else c for c in value.decode('utf8', errors='backslashreplace'))


def ascii_bytes(value):
    # Match Node Buffer.toString('ascii') used for Aleph tags and markers.
    return bytes(byte & 0x7f for byte in value)


def location(fields, error):
    retained = [(i, item) for i, item in enumerate(fields)
                if not re.fullmatch(rb'[a-zA-Z]{3}', ascii_bytes(item[2][:3])) or ascii_bytes(item[2][:3]).upper() == b'FMT']
    result = {}
    index = error.get('fieldIndex')
    selected = retained[index] if isinstance(index, int) and index < len(retained) else None
    if selected is None and (error.get('rule') == 'LD-02' or group_of(error) == 'PARSE-LDR-length'):
        selected = next(((i, item) for i, item in enumerate(fields) if ascii_bytes(item[2][:3]).upper() == b'LDR'), None)
    if selected is None and group_of(error) == 'PARSE-field-marker':
        selected = next(((i, item) for i, item in enumerate(fields)
                         if (not re.fullmatch(rb'[a-zA-Z]{3}', ascii_bytes(item[2][:3])) or ascii_bytes(item[2][:3]).upper() in (b'LDR', b'FMT'))
                         and ascii_bytes(item[2][5:6]) != b'L'), None)
    if selected is None: return result
    i, (start, _, value) = selected
    result.update(sourceFieldNumber=i + 1, fieldByteOffset=start)
    if 'indicatorIndex' in error:
        result['problemByteOffset'] = start + 7 + error['indicatorIndex']
    elif 'subfieldIndex' in error:
        # The MARC parser scans the entire data field, including its two
        # indicators. A corrupt 0x1F in an indicator creates a subfield too.
        content = bytearray(32 if byte == 94 else byte for byte in value[3:5])
        positions = [3, 4]
        cursor = 6
        while cursor < len(value):
            positions.append(cursor)
            if value[cursor:cursor + 2] == b'$$':
                content.append(31)
                cursor += 2
            else:
                content.append(value[cursor])
                cursor += 1
        delimiters = [i for i, byte in enumerate(content) if byte == 31]
        sub = error['subfieldIndex']
        if sub < len(delimiters):
            code_position = delimiters[sub] + 1
            source_position = positions[code_position] if code_position < len(positions) else len(value)
            result['problemByteOffset'] = start + 4 + source_position
    elif error.get('rule') == 'LD-02':
        match = re.search(r'Leader/(\d+)', error['message'])
        if match: result['problemByteOffset'] = start + 10 + int(match[1])
    elif group_of(error) == 'PARSE-field-marker':
        result['problemByteOffset'] = start + 9
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('artifacts', type=Path)
    parser.add_argument('--date', default='2026-09-22')
    parser.add_argument('--partial', action='store_true', help='Publish an explicitly incomplete report for finished bases only')
    args = parser.parse_args()
    out = args.artifacts.resolve()
    summaries = [json.loads(p.read_text()) for p in sorted(out.glob('*.errors-only.summary.json'))]
    present = {s['file'].split('_')[0] for s in summaries}
    assert present and present <= BASES, 'Unexpected or empty set of bases; exclude rsl02'
    assert args.partial or present == BASES, 'Require exactly six bases for a final report'
    assert all(s['complete'] and not s['serializationPerformed'] and not s['serializedBytes'] for s in summaries)
    docs = ROOT / 'docs' / ('rsl-errors-' + args.date)
    docs.mkdir(exist_ok=True)
    by_type = out / 'by-type'
    by_type.mkdir(exist_ok=True)
    counts = collections.Counter()
    by_file = collections.defaultdict(collections.Counter)
    messages = collections.defaultdict(collections.Counter)
    examples = collections.defaultdict(list)
    outputs = {}
    writers = {}
    raw_handles = {}
    summaries_by_name = {s['file']: s for s in summaries}

    def repo_link(path, from_docs=True):
        return ('../../' if from_docs else '../') + str(path.relative_to(ROOT))

    try:
        for s in summaries:
            name = s['file']
            path = ROOT / 'data/rsl-2026-09-17/raw' / name
            raw_handles[name] = path.open('rb')
            record_errors = validation_errors = parse_errors = 0
            for report_line, line in enumerate((out / (name + '.errors-only.errors.ndjson')).open(), 1):
                item = json.loads(line)
                raw, fields = read_record(raw_handles[name], item['byteOffset'])
                assert raw[:9].decode() == item['recordId']
                if 'parsingError' in item:
                    parse_errors += 1
                    errors = [{'message': item['parsingError']}]
                else:
                    record_errors += 1
                    errors = item['errors']
                    validation_errors += len(errors)
                for error in errors:
                    group = group_of(error)
                    assert group != 'VF-G5' and group != 'LD-02-Leader-19'
                    loc = location(fields, error)
                    if error.get('rule') in ('IN-G3', 'SF-G4'):
                        match = re.search(r'(?:код|значение) (.+)\.$', error['message'])
                        expected = json.loads(match[1])
                        if expected:
                            position = loc['problemByteOffset'] - item['byteOffset']
                            actual = raw[position:position + 1]
                            indicator_caret = (actual == b'^' and expected == ' ' and
                                               loc['problemByteOffset'] - loc['fieldByteOffset'] in (7, 8))
                            assert indicator_caret or actual == bytes([ord(expected)]), (name, item['recordId'], error, loc)
                    row = dict(file=name, recordId=item['recordId'], recordNumber=item['recordIndex'] + 1,
                               recordIndex=item['recordIndex'], byteOffset=item['byteOffset'], reportLine=report_line,
                               **error, **loc)
                    if group not in writers:
                        handle = (by_type / (group + '.tsv')).open('w', newline='')
                        outputs[group] = handle
                        writers[group] = csv.DictWriter(handle, HEAD, delimiter='\t', extrasaction='ignore')
                        writers[group].writeheader()
                    writers[group].writerow(row)
                    counts[group] += 1
                    by_file[group][name] += 1
                    messages[group][error['message']] += 1
                    if len(examples[group]) < 3:
                        record_dir = out / 'records' / name.removesuffix('.dat')
                        record_dir.mkdir(parents=True, exist_ok=True)
                        stem = f'{item["recordId"]}-{item["byteOffset"]}'
                        (record_dir / (stem + '.dat')).write_bytes(raw)
                        view = record_dir / (stem + '.txt')
                        lines = [f'file: {name}', f'recordId: {item["recordId"]}; recordIndex: {item["recordIndex"]}; byteOffset: {item["byteOffset"]}',
                                 'Исходная запись: одно поле на строку; управляющие символы показаны как \\xNN. Номера байтов — абсолютные, с нуля.', '']
                        for i, (offset, length, value) in enumerate(fields, 1):
                            lines.append(f'{i:03d} | byteOffset={offset} | length={length.decode()} | {visible(value[:6])} | {visible(value[6:])}')
                        view.write_text('\n'.join(lines) + '\n')
                        examples[group].append((row, view, 4 + loc['sourceFieldNumber'] if 'sourceFieldNumber' in loc else 1))
            assert (record_errors, validation_errors, parse_errors) == (s['recordsWithValidationErrors'], s['validationErrors'], s['recordsWithParsingErrors']), name
    finally:
        for handle in [*outputs.values(), *raw_handles.values()]: handle.close()

    totals = {k: sum(s[k] for s in summaries) for k in ['recordsProcessed', 'validRecords', 'skippedDeletedRecords', 'recordsWithValidationErrors', 'recordsWithParsingErrors', 'validationErrors', 'fileBytes']}
    assert sum(counts.values()) == totals['validationErrors'] + totals['recordsWithParsingErrors']
    old = [json.loads((ROOT / 'artifacts/rsl-2026-09-17' / (s['file'] + '.diagnostic.summary.json')).read_text()) for s in summaries]
    old_counts = {k: sum(s[k] for s in old) for k in ['recordsProcessed', 'recordsWithParsingErrors', 'recordsWithValidationErrors', 'validationErrors']}
    manifest = dict(date=args.date, complete=present == BASES, bases=sorted(present), pending=sorted(BASES - present), excluded=['rsl02'], totals=totals, historicalSameBases=old_counts, counts=dict(counts), byFile=dict(by_file),
                    reportGeneratorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    (out / 'report-rsl-errors.py.txt').write_bytes(Path(__file__).read_bytes())
    (out / 'by-type-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    status = ('**Полный проход выполнен для всех шести файлов.**' if present == BASES else
              f'**Предварительный отчёт: готовы {len(present)} из 6 баз.** Ожидаются: ' + ', '.join(sorted(BASES - present)) + '.')
    overview = [f'# Разбор ошибок РГБ: новый прогон {args.date}', '',
                'Шесть баз: rsl01, rsl03, rsl06, rsl07, rsl10, rsl11. **rsl02 исключена** из обработки и сравнения.', '',
                status + ' JSON MARC-записей не сериализовался и не сохранялся. '
                'Режим `errors-only` разбирает и валидирует записи; после ошибки парсинга продолжает, если границы записи установлены. '
                'Ошибка границ контейнера остановила бы проход и сделала отчёт неполным.', '',
                '[Действующая политика импорта](RSL-import-policy.md): DEL$a=Y исключает запись до валидации; буквенные поля отфильтрованы; '
                'LDR/FMT проверяются как leader/format; Leader/19 a/b/c допустимы, Leader/18 не изменён; код подполя проверяется только SF-G4.', '',
                '## Итоги', '',
                '| Файл | Всего записей | Пропущено DEL | Без ошибок | С ошибками валидации | Ошибки парсинга | Нарушений валидации | Время разбора |',
                '|---|---:|---:|---:|---:|---:|---:|---:|']
    for s in summaries:
        seconds = (datetime.fromisoformat(s['completedAt'].replace('Z', '+00:00')) - datetime.fromisoformat(s['startedAt'].replace('Z', '+00:00'))).total_seconds()
        overview.append(f'| {s["file"]} | {s["recordsProcessed"]:,} | {s["skippedDeletedRecords"]:,} | {s["validRecords"]:,} | {s["recordsWithValidationErrors"]:,} | {s["recordsWithParsingErrors"]:,} | {s["validationErrors"]:,} | {seconds / 60:.2f} мин |')
    overview += [f'| **Итого** | {totals["recordsProcessed"]:,} | {totals["skippedDeletedRecords"]:,} | {totals["validRecords"]:,} | {totals["recordsWithValidationErrors"]:,} | {totals["recordsWithParsingErrors"]:,} | {totals["validationErrors"]:,} | — |', '',
                 'Число нарушений не равно числу записей: в одной записи может быть несколько ошибок. Пропуски DEL не считаются ошибками или успешно проверенными записями.', '',
                 '## Типы ошибок', '', '| Тип | Значение | Срабатываний |', '|---|---|---:|']
    for group in sorted(counts):
        title = LABELS.get(group, group)
        overview.append(f'| [{group}](rsl-errors-{args.date}/{group}.md) | {title} | {counts[group]:,} |')
        page = [f'# {group}: {title}', '', status, '', f'Новый прогон {args.date}, без rsl02. Срабатываний: **{counts[group]:,}**.', '',
                f'[Полный TSV-реестр]({repo_link(by_type / (group + ".tsv"))}). Одна строка на каждое срабатывание; примеры ниже — только выборка.', '',
                '## Распределение по файлам', '', '| Файл | Срабатываний |', '|---|---:|']
        page += [f'| {name} | {n:,} |' for name, n in sorted(by_file[group].items())]
        page += ['', '## Сообщения', ''] + [f'- {n:,}: {message}' for message, n in messages[group].most_common()]
        historical = ROOT / 'docs/rsl-errors-2026-09-17' / (group + '.md')
        if historical.exists():
            page += ['', '## Основание правила', '', f'[Описание и точные ссылки на документ, страницы и строки](../rsl-errors-2026-09-17/{group}.md#основание-проверки). '
                     'Ссылка ведёт к историческому разбору основания; количества на той странице относятся к старому прогону. '
                     '[Изменения профиля](../RSL-import-policy.md) применены к этому прогону.']
        page += ['', '## Примеры и поиск в Sublime', '',
                 'Откройте текстовое представление записи, нажмите Ctrl+G (macOS: Control+G) и введите указанный номер строки. '
                 'Заголовок поля и его исходный абсолютный байтовый адрес показаны в начале строки. '
                 'Индикаторы находятся после трёх букв/цифр тега, подполе — после `$$`. Для пустого кода подполя '
                 '`problemByteOffset` показывает место отсутствующего кода после разделителя, а не существующий ошибочный символ. '
                 'В реестре `indicatorIndex`, `subfieldIndex`, `fieldIndex`, `recordIndex` и байтовые адреса начинаются с нуля; `sourceFieldNumber` и `recordNumber` — с единицы.', '']
        for row, view, line in examples[group]:
            page += [f'- `{row["file"]}`, recordId `{row["recordId"]}`, byteOffset `{row["byteOffset"]}`: '
                     f'[запись для Sublime]({repo_link(view)}), строка **{line}**; '
                     f'[исходные байты]({repo_link(view.with_suffix(".dat"))}). '
                     f'Поле `{row.get("tag", "LDR/структура")}`, subfieldIndex `{row.get("subfieldIndex", "—")}`, '
                     f'problemByteOffset `{row.get("problemByteOffset", "—")}`.']
        page += ['', 'Для любой другой строки реестра восстановите DAT из LFS и извлеките запись командой из корня репозитория:', '', '```bash',
                 'python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/ИМЯ_ФАЙЛА BYTE_OFFSET /tmp/problem.dat', '```', '',
                 '`fieldIndex` относится к модели после фильтрации, включая FMT. Для исходного файла используйте `sourceFieldNumber`, '
                 '`fieldByteOffset` и `problemByteOffset`. Для ошибки количества LDR проблемного единственного поля может не существовать.', '']
        (docs / (group + '.md')).write_text('\n'.join(page))
    overview += ['', '## Сравнение с прошлым прогоном', '',
                 'Сравниваются только базы, представленные в таблице итогов выше. Исходные SHA-256 и число записей совпадают с 17.09.2026. '
                 'Результаты изменились из-за правил обработки; данные не исправлялись.', '',
                 '| Показатель | 17.09.2026, без rsl02 | Новый прогон |', '|---|---:|---:|']
    for key, label in [('recordsProcessed', 'Записей'), ('recordsWithParsingErrors', 'Ошибки парсинга'), ('recordsWithValidationErrors', 'Записи с ошибками валидации'), ('validationErrors', 'Нарушения валидации')]:
        overview.append(f'| {label} | {old_counts[key]:,} | {totals[key]:,} |')
    old_rules, new_rules = collections.Counter(), collections.Counter()
    for summary in old:
        old_rules.update(summary['rules'])
    for summary in summaries:
        new_rules.update(summary['rules'])
    overview += ['', '### Нарушения по правилам', '', '| Правило | Прежний прогон тех же баз | Новый прогон |', '|---|---:|---:|']
    for rule in sorted(old_rules.keys() | new_rules.keys()):
        overview.append(f'| {rule} | {old_rules[rule]:,} | {new_rules[rule]:,} |')
    overview += ['', 'Разница общего числа ошибок не является числом исправленных записей. Разделить влияние каждого изменения '
                 '(DEL, буквенные поля, Leader/19, дубликат SF-G4) только по итоговым числам нельзя.', '',
                 '## Что разбирать в первую очередь', '',
                 f'Структурных ошибок записей осталось **{totals["recordsWithParsingErrors"]:,}**. В обычной прямой конвертации '
                 'первая такая ошибка остановит файл; этот диагностический прогон продолжает после неё. '
                 'Для этих записей сначала следует выяснить причины нарушения LDR/структуры контейнера, затем повторить валидацию.', '',
                 'Остальные типы относятся к уже разобранным, неудалённым записям после фильтрации служебных полей. '
                 'Проверяйте исходные значения по TSV и примерам; автоматической замены кодов, индикаторов или содержимого не выполнялось. '
                 'Позиция Leader/18 не ослаблена. Отсутствие ошибок означает прохождение реализованных правил, а не проверку всех требований MARC.', '',
                 'Некорректный разделитель `0x1F` внутри индикатора способен одновременно изменить число индикаторов '
                 'и создать дополнительное подполе. Поэтому несколько сообщений в одном поле могут иметь одну исходную причину. '
                 'Адреса `problemByteOffset` учитывают и такие разделители; при разборе SF-G4 проверяйте также заголовок поля.', '',
                 '## Артефакты и воспроизводимость', '',
                 f'- [Манифест запуска, версия и SHA-256 исходного кода]({repo_link(out / "run-manifest.json", False)}).',
                 f'- [Сводные количества и распределение по типам]({repo_link(out / "by-type-manifest.json", False)}).']
    for s in summaries:
        overview.append(f'- `{s["file"]}`: [ошибки NDJSON]({repo_link(out / (s["file"] + ".errors-only.errors.ndjson"), False)}), '
                        f'[сводка и SHA-256]({repo_link(out / (s["file"] + ".errors-only.summary.json"), False)}).')
    overview += ['', 'Старые артефакты не перезаписывались. Для нового прогона используйте отдельную директорию:', '', '```bash',
                 'git lfs fetch origin HEAD --include="data/rsl-2026-09-17/archives/**" --exclude="data/rsl-2026-09-17/archives/rsl02_z00.tar.gz"',
                 'python3 scripts/run-rsl-errors-audit.py artifacts/НОВЫЙ-ПРОГОН',
                 'python3 scripts/report-rsl-errors.py artifacts/НОВЫЙ-ПРОГОН --date ГГГГ-ММ-ДД', '```', '',
                 'Время в таблице включает чтение DAT, SHA-256, разбор, валидацию и запись ошибок; скачивание и распаковка туда не входят.', '']
    (ROOT / 'docs' / ('RSL-validation-' + args.date + '.md')).write_text('\n'.join(overview))
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
