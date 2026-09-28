"""Verify downloaded archives, extract safely, audit all bases and report errors."""
import collections
import csv
import hashlib
import json
import subprocess
import tarfile
import time
from datetime import datetime, timezone
from pathlib import Path
from importlib.machinery import SourceFileLoader

ROOT = Path(__file__).resolve().parents[1]
DATE = '2026-09-28'
URL = 'https://mrsadman.ru/ac34d2e7ff814daf/'
DATA = ROOT / 'data' / ('rsl-' + DATE)
OUT = ROOT / 'artifacts' / ('rsl-' + DATE)
SIZES = {'02': 2261749, '06': 19218682, '07': 16960916, '10': 27100591,
         '11': 62250563, '03': 444585091, '01': 3782119309}
report = SourceFileLoader('report_errors', str(ROOT / 'scripts/report-rsl-errors.py')).load_module()


summaries = [json.loads(p.read_text()) for p in sorted(OUT.glob('*.errors-only.summary.json'))]
counts = collections.Counter()
by_file = collections.defaultdict(collections.Counter)
handles = {}; writers = {}; examples = collections.defaultdict(list)
(OUT/'by-type').mkdir(exist_ok=True)
try:
    for s in summaries:
        n_validation = n_parse = n_records = 0
        with (DATA/'raw'/s['file']).open('rb') as source:
            for line_number, line in enumerate((OUT/(s['file']+'.errors-only.errors.ndjson')).open(), 1):
                item = json.loads(line)
                raw, fields = report.read_record(source, item['byteOffset'])
                assert raw[:9].decode() == item['recordId']
                if 'parsingError' in item:
                    errors = [{'message':item['parsingError']}]; n_parse += 1
                else:
                    errors=item['errors']; n_records += 1; n_validation += len(errors)
                for error in errors:
                    group=report.group_of(error)
                    loc=report.location(fields,error)
                    row=dict(file=s['file'],recordId=item['recordId'],recordNumber=item['recordIndex']+1,
                             recordIndex=item['recordIndex'],byteOffset=item['byteOffset'],reportLine=line_number,**error,**loc)
                    if group not in writers:
                        handle=(OUT/'by-type'/(group+'.tsv')).open('w',newline='')
                        handles[group]=handle
                        writers[group]=csv.DictWriter(handle,report.HEAD,delimiter='\t',extrasaction='ignore')
                        writers[group].writeheader()
                    writers[group].writerow(row); counts[group]+=1; by_file[group][s['file']]+=1
                    if len(examples[group])<3:
                        directory=OUT/'records'/s['file'].removesuffix('.dat'); directory.mkdir(exist_ok=True,parents=True)
                        path=directory/(item['recordId']+'-'+str(item['byteOffset'])+'.txt')
                        path.with_suffix('.dat').write_bytes(raw)
                        path.write_text('\n'.join([f"{s['file']} recordId={item['recordId']} byteOffset={item['byteOffset']}",error['message'],'']+[f'{i}: byteOffset={offset} | {report.visible(value)}' for i,(offset,length,value) in enumerate(fields,1)])+'\n')
                        examples[group].append((row,path))
        assert (n_validation,n_parse,n_records)==(s['validationErrors'],s['recordsWithParsingErrors'],s['recordsWithValidationErrors'])
finally:
    for handle in handles.values(): handle.close()
keys=['recordsProcessed','skippedDeletedRecords','validRecords','recordsWithValidationErrors','recordsWithParsingErrors','validationErrors']
totals={k:sum(s[k] for s in summaries) for k in keys}
assert sum(counts.values())==totals['validationErrors']+totals['recordsWithParsingErrors']
(OUT/'by-type-manifest.json').write_text(json.dumps(dict(totals=totals,counts=counts,byFile=by_file),ensure_ascii=False,indent=2)+'\n')
lines=[f'# Отчёт по новым архивам РГБ — {DATE}','',f'Источник: [{URL}]({URL}). Архивы опубликованы 26.09.2026. В набор входят семь баз, включая rsl02; таблица показывает только завершённые проверки.', '',
       f'**Предварительный отчёт: готовы {len(summaries)} из 7 баз.** Ожидаются: '+', '.join('rsl'+b for b in SIZES if 'rsl'+b+'_z00.dat' not in {s['file'] for s in summaries})+'. Проверенные результаты ниже. Режим `errors-only`: разбор и валидация без сериализации MARC-JSON. Ошибки отдельных записей не прерывают аудит. Обычная конвертация останавливается при структурной ошибке. Удалённые записи DEL$a=Y пропускаются до валидации.', '',
       '| База | Записей | DEL | Без ошибок | Записей с ошибками валидации | Ошибок парсинга | Нарушений валидации |', '|---|---:|---:|---:|---:|---:|---:|']
for s in summaries: lines.append('| '+s['file']+' | '+' | '.join(f'{s[k]:,}' for k in keys)+' |')
lines+=['| **Итого** | '+' | '.join(f'{totals[k]:,}' for k in keys)+' |','','Количество нарушений и количество записей с ошибками различаются: в одной записи возможны несколько нарушений.','','## Типы ошибок','','| Тип | Описание | Число | Реестр |','|---|---|---:|---|']
for group,n in sorted(counts.items()):
    lines.append(f'| {group} | {report.LABELS.get(group,group)} | {n:,} | [TSV](../artifacts/rsl-{DATE}/by-type/{group}.tsv) |')
lines+=['','## Примеры ошибок','']
for group,items in sorted(examples.items()):
    lines += [f'### {group}','']
    for row,path in items:
        lines.append(f"- `{row['file']}`, ID `{row['recordId']}`, byteOffset `{row['byteOffset']}`: {row['message']} [Исходная запись](../{path.relative_to(ROOT)}).")
    lines.append('')
lines+=['## Сравнение с 22.09.2026','','Сравнение шести общих баз; rsl02 в предыдущем прогоне отсутствовала. Изменились исходные выгрузки; разница итоговых чисел не равна количеству исправленных записей.','','| База | Изменился DAT (SHA-256) | Δ записей | Δ записей с ошибками валидации | Δ ошибок парсинга | Δ нарушений |','|---|---|---:|---:|---:|---:|']
for s in summaries:
    oldpath=ROOT/'artifacts/rsl-2026-09-22'/(s['file']+'.errors-only.summary.json')
    if not oldpath.exists(): continue
    old=json.loads(oldpath.read_text())
    delta=[s[k]-old[k] for k in ['recordsProcessed','recordsWithValidationErrors','recordsWithParsingErrors','validationErrors']]
    lines.append('| '+s['file']+' | '+('да' if s['sha256']!=old['sha256'] else 'нет')+' | '+' | '.join(f'{n:+,}' for n in delta)+' |')
lines+=['','## Воспроизводимость','',f'- [Манифест запуска](../artifacts/rsl-{DATE}/run-manifest.json): источник, SHA-256 архивов и кода, ревизия.',f'- [Сводка по типам](../artifacts/rsl-{DATE}/by-type-manifest.json).',f'- Каталог `artifacts/rsl-{DATE}` содержит полный NDJSON ошибок и сводки для каждого DAT.',f'- Архивы и распакованные DAT: `data/rsl-{DATE}/`.', '- В TSV индексы и байтовые смещения начинаются с нуля; recordNumber и sourceFieldNumber — с единицы.', '- Проверены реализованные правила проекта; отсутствие ошибок не означает соответствия всем требованиям MARC.','']
target=ROOT/'docs'/('RSL-validation-'+DATE+'.md')
if len(summaries)==7:
    lines=[line.replace('**Предварительный отчёт: готовы 7 из 7 баз.** Ожидаются: . Проверенные результаты ниже.', '**Полный проход завершён: проверены все 7 баз.**') for line in lines]
tmp=target.with_suffix('.md.tmp-report'); tmp.write_text('\n'.join(lines)); tmp.replace(target)
print('Report updated:',len(summaries),'of 7',totals,flush=True)
