"""Download immutable HTTP ranges; publish archive only after all ranges succeed."""
import concurrent.futures
import pathlib
import subprocess
import os

root = pathlib.Path('data/rsl-2026-09-17/archives')
url = 'https://mrsadman.ru/ac34d2e7ff814dac/rsl01_z00.tar.gz'
size = 3768951687
chunk = 125000000
parts = list(range(0, size, chunk))

def fetch(start):
    end = min(start + chunk, size) - 1
    path = root / f'rsl01.range-{start:010d}'
    if path.exists() and path.stat().st_size == end - start + 1:
        return path
    subprocess.run(['curl', '-fsS', '--retry', '5', '--range', f'{start}-{end}',
                    '--header', 'If-Match: "6aab97e4-e0a5a387"', '-o', str(path), url], check=True)
    if path.stat().st_size != end - start + 1:
        raise RuntimeError(f'Incorrect range size: {path}')
    print(f'Completed {start}-{end}', flush=True)
    return path

with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    paths = list(pool.map(fetch, parts))
target = root / 'rsl01_z00.tar.gz.partial'
with target.open('wb') as output:
    for path in paths:
        with path.open('rb') as source:
            while block := source.read(1024 * 1024):
                output.write(block)
os.replace(target, root / 'rsl01_z00.tar.gz')
# Temporary HTTP chunks only; final original archive is retained.
for path in paths:
    path.unlink()
print('Archive assembled', flush=True)
