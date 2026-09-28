import json
import subprocess
import time
from pathlib import Path
out=Path('artifacts/rsl-2026-09-28')
previous=None
while True:
    files=sorted(out.glob('*.errors-only.summary.json'))
    signature=[(p.name,p.stat().st_size) for p in files]
    if signature!=previous:
        try:
            if all(json.loads(p.read_text())['complete'] for p in files):
                subprocess.run(['python3','scripts/report-rsl-new-batch.py'],check=True)
                previous=signature
        except (json.JSONDecodeError,subprocess.CalledProcessError): pass
    if len(files)==7 and previous==signature: break
    time.sleep(10)
