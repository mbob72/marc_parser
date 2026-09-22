"""Link existing error pages to reviewed sources; works without the deleted raw DATs."""
from pathlib import Path
from urllib.parse import quote
import argparse
import json
from validation_rule_status import annotate_historical_status as annotate_rule_status
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs/rsl-errors-2026-09-17'
SOURCE = 'docs/rsl-rule-sources/DevRGB-170826-1001-43/'
REVISION = '8a67485d0337460020dd8d2084db81b321e0d010'
RULES = 'docs/Правила валидации MARC записи.md'
ALGORITHM = 'docs/Алгоритм двусторонней конвертации MARC РГБ.md'
FORMAT = 'docs/Вычисление поля format.md'


def reference(path, text, label):
    revision = 'main' if path.startswith(SOURCE) else REVISION
    content = ((ROOT / path).read_text() if revision == 'main' else
               subprocess.check_output(['git', 'show', f'{revision}:{path}'], cwd=ROOT).decode())
    assert content.count(text) == 1, (path, text)
    start = content[:content.index(text)].count('\n') + 1
    end = start + text.count('\n')
    fragment = f'L{start}' if start == end else f'L{start}-L{end}'
    lines = f'строка {start}' if start == end else f'строки {start}–{end}'
    url = f'https://github.com/mbob72/marc_parser/blob/{revision}/{quote(path)}?plain=1#{fragment}'
    return f'[{label}, {lines}]({url})'


def pdf(page, text):
    path = SOURCE + f'page-{page:03}.md'
    image = 'https://github.com/mbob72/marc_parser/blob/main/' + SOURCE + f'page-{page:03}.png'
    return f'[PDF, страница {page}]({image}); ' + reference(path, text, 'точная выдержка')


def project(path, text, label='Документ проекта'):
    return reference(path, text, label)


def catalog():
    leader = pdf(30, 'Длина маркера фиксирована и состоит из 24 позиций символов. Это первое поле записи.')
    data = pdf(30, 'они содержат две позиции индикатора в начале каждого поля и двухсимвольный код подполя перед каждым элементом данных внутри поля.')
    subfields = pdf(30, 'Идентификаторы обозначаются маленькими буквами латинского алфавита или цифрами.')
    return {
        'LD-02-Leader-18': ('Положение схемы РГБ', [pdf(19, 'для позиции 18 нет кодов c, n')],
            'PDF фиксирует отсутствие кодов в схеме. Применение этого ограничения к конкретным библиографическим и нормативным выгрузкам требует подтверждения профиля; это не общий запрет MARC.'),
        'LD-02-Leader-19': ('Историческое ограничение; a/b/c разрешены 22.09.2026', [pdf(19, 'для позиции 19 нет кодов a, b, c'), pdf(33, '> b - Part with independent title\n> c - Part with dependent title')],
            'На странице 19 коды a/b/c отсутствуют в схеме, но строка № 12 таблицы на странице 33 перечисляет b/c. Валидатор прогона следовал странице 19. С 22.09.2026 a/b/c разрешены решением владельца требований; 5 083 166 срабатываний нельзя автоматически считать доказанными дефектами исходных записей.'),
        'DF-G2': ('Подтверждено структурой MARC', [data],
            'Две позиции индикатора подтверждены. Код проверяет уже разобранную модель, поэтому повреждение разделителей может изменить число распознанных индикаторов.'),
        'DF-G3': ('Подтверждено структурой MARC', [data, subfields],
            'Источник описывает подполе перед элементом данных; проверка требует хотя бы один односимвольный идентификатор. Требование наличия именно подполя a этим правилом не вводится.'),
        'IN-G3': ('Подтверждено с оговоркой о #', [pdf(30, 'Значения индикаторов могут быть представлены цифрами или маленькими буквами латинского алфавита. Пробел (ASCII SPACE), обозначаемый в настоящем документе символом #, используется, если позиция индикатора не определена.')],
            'PDF различает байт SPACE и экранное обозначение #. Приём буквального # валидатором — соглашение текстового представления. Общая регулярка не проверяет разрешённые значения индикатора конкретного тега. Ссылка прежнего отчёта на страницу 39 избыточна: там описано поле 008, а прямое основание для индикаторов находится на странице 30.'),
        'SF-G4': ('Подтверждено структурой MARC', [subfields],
            'PDF описывает двухсимвольный код как разделитель и идентификатор. Валидатор проверяет только односимвольный идентификатор. В историческом прогоне одна проверка создавала SF-G4 и VF-G5. С 22.09.2026 VF-G5 deprecated, новые проверки создают только SF-G4.'),
        'VF-G5': ('Deprecated: исторический дубликат SF-G4', [subfields],
            'Deprecated с 22.09.2026: новые проверки используют только SF-G4. Исторические сообщения VF-G5 сохранены без пересчёта; пара VF-G5/SF-G4 отражала один дефект, а не два независимых нарушения требования.'),
        'DR-E2': ('PDF и расширение проекта', [pdf(30, '00-02 Метка поля: состоит из 3-х символов; соответствующее поле переменной длинны'), pdf(30, 'состоящей из трёх цифр'), project(RULES, 'Тег (код поля) - состоит из трёх ASCII символов, идентифицирует связанное поле. Может быть цифровым или буквенным (латиница, прописные или строчные, но не смешанно).')],
            'PDF описывает трёхзначные цифровые метки. Допуск трёх букв и запрет смешанного регистра заданы документом проекта, а не приведённой страницей PDF. Служебные поля FMT/OWN/CAT/SYS на странице 84 демонстрируют расширение Aleph, но не доказывают всю регулярку.'),
        'FMT': ('Закрытый словарь задан проектом', [pdf(84, 'FMT - формат бибзаписи'), pdf(28, 'семь форматов: BK, CR, CF, MP, MU, VM, MX'), pdf(29, 'В спецификации отсутствует указание на код формата авторитетных записей'), project(FORMAT, '3. Допустимы `AN`, `AU`, `BK`, `CF`, `CR`, `MP`, `MU`, `MX`, `SE`, `VM`.\n   Коды `AN`, `AU` и `SE` добавлены после проверки реальных выгрузок\n   `rsl06`, `rsl07`, `rsl10`; в частности, нормативная база `rsl10`\n   преимущественно использует `AU`.')],
            'Страница 84 подтверждает назначение поля, но не полный список допустимых значений. Страница 29 разрешает собственное обозначение авторитетного формата. Ошибка означает отсутствие значения в словаре программы; нормативная недопустимость такого значения не доказана.'),
        'PARSE-LDR-length': ('Структура MARC и байтовый контракт', [leader, project(ALGORITHM, 'В Aleph sequential отдельное поле `LDR` преобразуется в 24-байтовый Leader.')],
            'PDF формулирует длину как 24 позиции символов. Контракт и парсер требуют 24 байта; многобайтовый символ UTF-8 не занимает одну байтовую позицию.'),
        'PARSE-LDR-count': ('Требование построения модели', [leader, project(ALGORITHM, 'В Aleph sequential отдельное поле `LDR` преобразуется в 24-байтовый Leader.')],
            'PDF описывает один первый маркер MARC-записи. Требование ровно одного поля LDR в контейнере Aleph — условие текущего парсера; прямого правила контейнера в PDF не найдено. Политику для дубликатов и служебных записей нужно согласовать.'),
        'PARSE-field-marker': ('Контракт реализации Aleph', [project(ALGORITHM, 'где `NNNNNNNNN` — номер записи; `LLLL` — четыре ASCII-цифры длины следующего\nполя в байтах; `TTT` — тег; `II` — два индикатора; `L` — маркер поля; `value`\n— данные. Длина включает `TTTIILvalue`, но не собственные четыре цифры.')],
            'Проект описывает контейнер по реальным выгрузкам; сам контейнер в PDF не описан. Требование только ASCII L подтверждено кодом, но внешнего документа с запретом других маркеров не найдено.'),
    }


def implementation(group):
    if group == 'PARSE-field-marker':
        path, text = 'src/aleph-sequential-parser.ts', 'if (marker !== "L") {'
    elif group == 'PARSE-LDR-count':
        path, text = 'src/aleph-sequential-parser.ts', 'if (leaderFields.length !== 1) {'
    elif group == 'PARSE-LDR-length':
        path, text = 'src/aleph-sequential-parser.ts', 'if (leader.length !== 24) {'
    else:
        path = 'src/marc-validator.ts'
        text = {
            'LD-02-Leader-18': 'if (["c", "n"].includes(record.leader.descriptiveCatalogingForm)) {',
            'LD-02-Leader-19': 'if (["a", "b", "c"].includes(record.leader.multipartResourceRecordLevel)) {',
            'DF-G2': 'if (field.indicators.length !== REQUIRED_INDICATOR_COUNT) {',
            'DF-G3': 'if (!field.subfields.some(({ code }) => code.length === 1)) {',
            'IN-G3': 'const VALID_INDICATOR = /^[a-z0-9 #]$/;',
            'DR-E2': 'const VALID_TAG = /^(?:[0-9]{3}|[A-Z]{3}|[a-z]{3})$/;',
            'FMT': 'if (!isMarcJsonFormat(value)) {',
            'SF-G4': 'const VALID_SUBFIELD_CODE = /^[a-z0-9]$/;',
            'VF-G5': 'const VALID_SUBFIELD_CODE = /^[a-z0-9]$/;',
        }[group]
    return reference(path, text, 'Реализация в проверенной версии')


def update(wiki=None):
    entries = catalog()
    counts = json.loads((ROOT/'artifacts/rsl-2026-09-17/by-type-manifest.json').read_text())['counts']
    assert set(entries) == set(counts)
    intro = ('Проверено 21.09.2026 по исходному `DevRGB-170826-1001-43.pdf` (208 страниц), документам проекта и Wiki версии '
             '`9bad47fbd51d77d8cb09f537b0f2190363c913a9`. Номера страниц физические. Ссылки на строки выделяют текст Markdown-выдержки или документа проекта, а не строки PDF. '
             'Изображение страницы позволяет проверить оригинал. [Паспорт PDF и контрольная сумма](https://github.com/mbob72/marc_parser/blob/main/'+SOURCE+'README.md).')
    overview = ['# Источники правил для выгрузок РГБ 17.09.2026', '', intro, '',
                '| Тип | Статус основания | Документ, страница и строки |', '|---|---|---|']
    for group in sorted(entries):
        status, sources, note = entries[group]
        overview.append(f'| [{group}](rsl-errors-2026-09-17/{group}.md) | {status} | '+ '<br>'.join(sources) + ' |')
        p = DOCS/f'{group}.md'
        text = p.read_text()
        section = '\n'.join(['## Основание проверки', '', f'**Статус: {status}.**', '', *('- '+s for s in sources), '', note, '',
                              implementation(group)+'. Это ссылка на код, а не замена документального основания.', '',
                              'Строки относятся к Markdown-выдержке или документу проекта. Ссылки на PDF ведут к изображению физической страницы.', ''])
        text, replaced = re.subn(r'## Основание проверки\n.*?(?=<!-- error-description:end -->)', section, text, flags=re.S)
        assert replaced == 1, group
        text = annotate_rule_status(text)
        p.write_text(text)
        if wiki: (wiki/f'RSL-errors-2026-09-17-{group}.md').write_text(text)
    overview += ['', '## Ограничения и расхождения', '']
    for group in sorted(entries):
        overview += [f'### {group}', '', entries[group][2], '']
    overview += ['## Что изменилось после проверки Wiki', '',
                 'В новом отчёте ранее были только ссылки на код. Теперь каждый из 12 типов связан с конкретными строками источника либо явно отмечен как ограничение реализации. ', '',
                 'В опубликованной Wiki RSL-conversion найдено устаревшее поведение: нормализация FMT, подстановка <unrecognized> и продолжение парсинга с заглушками. Актуальный документ проекта сохраняет исходные значения и останавливает обычную конвертацию при структурной ошибке. Страница Wiki подготовлена к синхронизации с ним.', '',
                 'Общие правила не доказывают полноту проверки нормативных записей. Источник содержит отдельные требования к НЗ (физическая страница 82); текущий прогон их целиком не реализует.', '']
    report = annotate_rule_status('\n'.join(overview))
    (ROOT/'docs/RSL-rule-sources-2026-09-17.md').write_text(report)
    p = ROOT/'docs/RSL-validation-2026-09-17.md'
    content = p.read_text()
    start, end = '<!-- rule-sources:start -->', '<!-- rule-sources:end -->'
    content = re.sub(re.escape(start)+r'.*?'+re.escape(end)+r'\n*', '', content, flags=re.S)
    section = '\n'.join([start, '## Документы-основания правил', '',
                         '[Все 12 типов: документ, физическая страница и строки](RSL-rule-sources-2026-09-17.md).', '',
                         'Проверка оригинального PDF выявила расхождение по Leader/19 между страницами 19 и 33. Буквенные теги, закрытый словарь FMT и ограничения контейнера Aleph имеют отдельные оговорки. Наличие срабатывания валидатора само по себе не подтверждает ошибочность данных.', end, '', ''])
    content = content.replace('## Методика', section+'## Методика', 1)
    content = annotate_rule_status(content)
    p.write_text(content)
    if wiki:
        for group in entries:
            report = report.replace(f'(rsl-errors-2026-09-17/{group}.md)', f'(RSL-errors-2026-09-17-{group})')
            content = content.replace(f'(rsl-errors-2026-09-17/{group}.md)', f'(RSL-errors-2026-09-17-{group})')
        content = content.replace('(RSL-rule-sources-2026-09-17.md)', '(RSL-rule-sources-2026-09-17)')
        (wiki/'RSL-rule-sources-2026-09-17.md').write_text(report)
        (wiki/'RSL-validation-2026-09-17.md').write_text(content)
    print(f'Linked {len(entries)} error types; raw DAT files were not needed.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--wiki-dir', type=Path)
    args = parser.parse_args()
    if args.wiki_dir and not args.wiki_dir.is_dir(): parser.error('Wiki directory does not exist')
    update(args.wiki_dir)
