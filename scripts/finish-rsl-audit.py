"""Wait for the existing audit, verify its artifacts, update Wiki, then speak."""
import json
import os
import pathlib
import re
import subprocess
import sys
import time

pid = int(sys.argv[1])
root = pathlib.Path('artifacts/rsl-2026-09-17')
while True:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        break
    time.sleep(15)

expected = [f'rsl{i}_z00.dat' for i in ('01', '02', '03', '06', '07', '10', '11')]
occurrences = 0
for name in expected:
    summary = json.loads((root / f'{name}.diagnostic.summary.json').read_text())
    if not summary['complete'] or summary['inputBytes'] != summary['fileBytes']:
        raise RuntimeError(f'Incomplete diagnostic audit: {name}')
    occurrences += summary['validationErrors'] + summary['recordsWithParsingErrors']
    report = root / f'{name}.diagnostic.errors.ndjson'
    actual = 0
    with report.open() as lines:
        for line in lines:
            item = json.loads(line)
            actual += len(item.get('errors', [])) + int('parsingError' in item)
    if actual != summary['validationErrors'] + summary['recordsWithParsingErrors']:
        raise RuntimeError(f'Report counters mismatch: {name}')

manifest = json.loads((root / 'by-type-manifest.json').read_text())
import csv
import gzip
links = 0
for group, chunks in manifest['chunks'].items():
    count = 0
    for chunk in chunks:
        with gzip.open(chunk, 'rt', encoding='utf-8', newline='') as source:
            reader = csv.DictReader(source, delimiter='\t')
            for item in reader:
                if item['file'] not in expected or not item['recordId'] or int(item['byteOffset']) < 0:
                    raise RuntimeError(f'Invalid register entry: {chunk}')
                count += 1
    if count != manifest['counts'][group]:
        raise RuntimeError(f'Count mismatch: {group}')
    links += count
if links != occurrences:
    raise RuntimeError(f'Grouped register mismatch: {links} rows for {occurrences} errors')
for checksums in sorted(root.glob('*sha256.txt')):
    subprocess.run(['shasum', '-a', '256', '-c', str(checksums)], check=True)
wiki = pathlib.Path('/tmp/marc-parser-wiki-rsl-20260917/RSL-validation-2026-09-17.md')
expected_wiki = pathlib.Path('docs/RSL-validation-2026-09-17.md').read_text()
expected_wiki = expected_wiki.replace('(RSL-rule-sources-2026-09-17.md)', '(RSL-rule-sources-2026-09-17)')
for group in manifest['counts']:
    expected_wiki = expected_wiki.replace(f'(rsl-errors-2026-09-17/{group}.md)', f'(RSL-errors-2026-09-17-{group})')
if wiki.read_text() != expected_wiki:
    raise RuntimeError('Local Wiki copy differs from documentation')
(root / 'completion.json').write_text(json.dumps({
    'complete': True, 'files': expected, 'errorOccurrences': occurrences,
    'verifiedRegisterRows': links, 'wiki': str(wiki),
    'committed': False, 'pushed': False, 'localSourcesDeleted': False,
}, ensure_ascii=False, indent=2) + '\n')
subprocess.run(['/usr/bin/say', '-v', 'Milena', 'Миша, я закончил, возвращайся к работе!'], check=True)
print('All audits, registers, checksums and local Wiki verified; spoken notification sent.', flush=True)
