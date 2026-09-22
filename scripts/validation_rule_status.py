"""Add current rule status without changing historical error counts or rows."""
import re

START = '<!-- vf-g5-deprecated:start -->'
END = '<!-- vf-g5-deprecated:end -->'
NOTICE = (
    '**VF-G5 — deprecated с 22.09.2026.** В новых проверках недопустимый код '
    'подполя даёт только SF-G4. VF-G5 в прежних выгрузках сохранён как '
    'исторический дубликат SF-G4; старые количества и реестры не пересчитывались. '
    'Упоминания пары ниже описывают поведение на момент соответствующего прогона.'
)


def annotate_rule_status(text):
    text = re.sub(re.escape(START) + r'.*?' + re.escape(END) + r'\n\n',
                  '', text, flags=re.S)
    if not re.search(r'VF[-\u2011]G5', text):
        return text
    first, separator, rest = text.partition('\n\n')
    if not separator:
        raise ValueError('Expected a Markdown title followed by a blank line')
    return first + '\n\n' + START + '\n' + NOTICE + '\n' + END + '\n\n' + rest


IMPORT_START = '<!-- rsl-import-policy:start -->'
IMPORT_END = '<!-- rsl-import-policy:end -->'
IMPORT_NOTICE = (
    '**Исторический прогон 17.09.2026. Правила изменены 22.09.2026:** '
    'Leader/19 `a`, `b`, `c` разрешены; записи с `DEL$a=Y` пропускаются до '
    'валидации, остальные буквенные поля исключаются (LDR/FMT переходят в '
    '`leader`/`format`). Leader/18 не изменён. Пропуски учитываются в '
    '`skippedDeletedRecords`. Приведённые ниже количества, примеры и ссылки '
    'относятся к прежнему прогону и не пересчитывались; описание прежнего '
    'поведения не является инструкцией для нового импорта.'
)


def annotate_historical_status(text):
    text = re.sub(re.escape(IMPORT_START) + r'.*?' + re.escape(IMPORT_END) + r'\n\n',
                  '', text, flags=re.S)
    text = annotate_rule_status(text)
    first, separator, rest = text.partition('\n\n')
    if not separator:
        raise ValueError('Expected a Markdown title followed by a blank line')
    return first + '\n\n' + IMPORT_START + '\n' + IMPORT_NOTICE + '\n' + IMPORT_END + '\n\n' + rest
