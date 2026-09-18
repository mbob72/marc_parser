"""Stream complete type registers into small gzip TSV chunks, without millions of files."""
import collections
import csv
import gzip
import json
import pathlib
import re

ROOT = pathlib.Path('artifacts/rsl-2026-09-17')
OUT = ROOT / 'by-type'
OUT.mkdir(exist_ok=True)
BASE = 'https://github.com/mbob72/marc_parser/blob/main/'
counts = collections.Counter()
writers = {}
handles = {}
chunks = collections.defaultdict(list)
examples = collections.defaultdict(list)
HEAD = ['file', 'recordId', 'recordNumber', 'recordIndex', 'byteOffset', 'fieldIndex', 'tag', 'indicatorIndex', 'subfieldIndex', 'message', 'reportLine']


def kind(error):
    if 'rule' in error:
        rule = error['rule']
        match = re.search(r'Leader/(\d+(?:-\d+)?)', error['message'])
        return rule + ('-Leader-' + match[1] if rule == 'LD-02' and match else '')
    message = error['message']
    if 'Поле LDR' in message and 'байт' in message: return 'PARSE-LDR-length'
    if 'ровно одно поле LDR' in message: return 'PARSE-LDR-count'
    if 'неподдерживаемый маркер' in message: return 'PARSE-field-marker'
    return 'PARSE-other'


try:
    for summary_path in sorted(ROOT.glob('*.diagnostic.summary.json')):
        summary = json.loads(summary_path.read_text())
        report = summary_path.with_name(summary_path.name.replace('summary.json', 'errors.ndjson'))
        with report.open() as source:
            for number, line in enumerate(source, 1):
                item = json.loads(line)
                errors = item.get('errors', [{'message': item.get('parsingError', '')}])
                for error in errors:
                    group = kind(error)
                    if counts[group] % 10000 == 0:
                        if group in handles: handles[group].close()
                        part = OUT / f'{group}-{len(chunks[group])+1:04d}.tsv.gz'
                        handles[group] = gzip.open(part, 'wt', encoding='utf-8', newline='')
                        writers[group] = csv.writer(handles[group], delimiter='\t')
                        writers[group].writerow(HEAD)
                        chunks[group].append(str(part))
                    row = [summary['file'], item.get('recordId', ''), item['recordIndex']+1, item['recordIndex'], item['byteOffset'],
                           *[error.get(key, '') for key in ['fieldIndex', 'tag', 'indicatorIndex', 'subfieldIndex']], error['message'], number]
                    writers[group].writerow(row)
                    counts[group] += 1
                    if len(examples[group]) < 5: examples[group].append(row)
        print(summary['file'], 'grouped', flush=True)
finally:
    for handle in handles.values(): handle.close()

DOCS = pathlib.Path('docs/rsl-errors-2026-09-17')
DOCS.mkdir(exist_ok=True)
intro = ['## Полные реестры по типам ошибок', '',
         'Все срабатывания сохранены в TSV, разделённых по типам и по 10 000 строк. '
         'Файлы сжаты gzip без потерь; ни одна ошибка не исключена. '
         'Каждая строка содержит файл, recordId, номер записи, байтовое смещение, поле, индикатор/подполе и сообщение. '
         'VF-G5 и SF-G4 могут относиться к одному дефекту.', '',
         '| Тип | Срабатываний | Частей реестра |', '|---|---:|---:|']
for group in sorted(counts):
    page = DOCS / f'{group}.md'
    intro.append(f'| [{group}]({BASE}{page}) | {counts[group]} | {len(chunks[group])} |')
    lines = [f'# {group}', '', f'Всего срабатываний: **{counts[group]}**. Полный список приведён в частях ниже, без выборки.', '',
             '## Полный реестр', '',
             'Скачайте нужную часть и распакуйте: `gzip -dk имя.tsv.gz`. Откройте полученный TSV в Sublime Text. '
             'Первая строка — названия колонок. Столбцы `file`, `recordId`, `byteOffset` однозначно указывают источник. '
             'Индексы полей, индикаторов и подполей начинаются с нуля. CSV-кавычки сохраняют табуляции и переносы внутри сообщения.', '']
    lines += [f'- [Часть {i+1}]({BASE}{path}) — срабатывания {i*10000+1}–{min((i+1)*10000,counts[group])}.' for i,path in enumerate(chunks[group])]
    lines += ['', '## Примеры и точное извлечение', '']
    for row in examples[group]:
        name,rid,record_number,index,offset,*_ = row
        archive = f'data/rsl-2026-09-17/archives/{name.removesuffix(".dat")}.tar.gz'
        if name.startswith('rsl01'): archive = 'data/rsl-2026-09-17/README.md'
        lines += [f'### {name}, запись {record_number}, ID {rid}', '',
                  f'[Исходный архив / восстановление]({BASE}{archive}). byteOffset: `{offset}`.', '', row[-2], '',
                  '```bash', f'python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/{name} {offset} /tmp/{rid}-{offset}.dat',
                  f'subl /tmp/{rid}-{offset}.dat', '```', '']
    page.write_text('\n'.join(lines)+'\n')
intro += ['', '## Как найти проблемное место в Sublime Text', '',
          '1. Откройте страницу нужного типа, скачайте и распакуйте часть TSV-реестра. Все ошибки перечислены; примеры на странице — только для иллюстрации.',
          '2. В TSV выберите запись по `file` и `recordId`. Восстановите исходный DAT из '
          '[архивов LFS](' + BASE + 'data/rsl-2026-09-17/README.md) и сверьте контрольную сумму. '
          'Для rsl01 нужно собрать части архива. GitHub-ссылки заработают после коммита и push владельцем.',
          '3. В исходном DAT используйте Find с регулярным выражением `^000001817\\t`, подставив нужный ID. '
          'Номер записи не равен строке редактора: внутри полей бывают переносы. Байтовое смещение не равно позиции символа UTF-8.',
          '4. Для файла на 22 ГБ удобнее извлечь только нужную запись по `byteOffset`: команда ниже читает длины полей и сохраняет оригинальные байты. '
          'При повторяющемся ID используйте именно смещение. Найдите поле по `tag` и индексу; `fieldIndex` исключает LDR. '
          'Для Leader/19 отсчитайте двадцатый байт значения LDR после шестибайтового заголовка поля.', '',
          '```bash',
          'python3 scripts/rsl_record.py data/rsl-2026-09-17/raw/rsl02_z00.dat 899249 /tmp/000001817.dat',
          'subl /tmp/000001817.dat', '```', '',
          'Ранее подготовленные небольшие текстовые фрагменты для rsl02/rsl06/rsl07/rsl10/rsl11 остаются доступны. '
          'Для миллионов ошибок rsl01 используется полный компактный реестр и извлечение по смещению, без миллионов отдельных файлов. '
          '[Документация командной строки Sublime](https://www.sublimetext.com/docs/command_line.html).', '']
path = pathlib.Path('docs/RSL-validation-2026-09-17.md')
text = path.read_text().replace('## Интерпретация для продуктовой команды', '\n'.join(intro)+'\n## Интерпретация для продуктовой команды')
path.write_text(text)
wiki = pathlib.Path('/tmp/marc-parser-wiki-rsl-20260917')
if wiki.is_dir(): (wiki / path.name).write_text(text)
(ROOT/'by-type-manifest.json').write_text(json.dumps({'counts':counts, 'chunks':chunks},ensure_ascii=False,indent=2)+'\n')
print('Grouped occurrences:',sum(counts.values()),flush=True)
