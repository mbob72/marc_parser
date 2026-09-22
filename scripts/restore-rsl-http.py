"""Restore the six selected archives into LFS cache with verified ranged HTTP reads."""
import argparse
import concurrent.futures
import hashlib
import json
import os
import shutil
from pathlib import Path
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
BASES = ['rsl06', 'rsl07', 'rsl10', 'rsl11', 'rsl03', 'rsl01']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workers', type=int, default=8)
    parser.add_argument('--resume-dir', type=Path)
    args = parser.parse_args()
    source = ROOT / 'data/rsl-2026-09-17/archives'
    jobs = []
    objects = []
    chunk_size = 8 * 1024 * 1024
    temporary = args.resume_dir or Path(tempfile.mkdtemp(prefix='rsl-http-restore-'))
    if not temporary.is_dir():
        raise RuntimeError('Resume directory does not exist')
    print('Temporary range directory:', temporary, flush=True)
    for base in BASES:
        pointers = sorted(source.glob(base + '_z00.tar.gz.part-*')) if base == 'rsl01' else [source / (base + '_z00.tar.gz')]
        offset = 0
        entries = []
        for pointer in pointers:
            lines = pointer.read_text().splitlines()
            oid = next(line.split(':', 1)[1] for line in lines if line.startswith('oid sha256:'))
            size = next(int(line.split()[1]) for line in lines if line.startswith('size '))
            target = ROOT / '.git/lfs/objects' / oid[:2] / oid[2:4] / oid
            obj = dict(base=base, oid=oid, size=size, offset=offset, target=target, chunks=[])
            entries.append(obj)
            offset += size
        for obj in entries:
            if obj['target'].exists():
                with obj['target'].open('rb') as handle:
                    if hashlib.file_digest(handle, 'sha256').hexdigest() != obj['oid']:
                        raise RuntimeError('Cached object has unexpected checksum')
                continue
            for local in range(0, obj['size'], chunk_size):
                start = obj['offset'] + local
                end = obj['offset'] + min(local + chunk_size, obj['size']) - 1
                dest = temporary / (obj['oid'] + '-' + str(local))
                job = dict(base=base, start=start, end=end, total=offset, dest=dest, obj=obj)
                obj['chunks'].append(dest)
                jobs.append(job)
            obj['remaining'] = len(obj['chunks'])
            objects.append(obj)

    def fetch(job):
        url = 'https://mrsadman.ru/ac34d2e7ff814dac/' + job['base'] + '_z00.tar.gz'
        headers = job['dest'].with_suffix('.headers')
        size = job['end'] - job['start'] + 1
        original_header = f'content-range: bytes {job["start"]}-{job["end"]}/{job["total"]}'
        if job['dest'].exists() and headers.exists():
            if original_header not in headers.read_text().lower():
                raise RuntimeError('Cannot resume an unverified HTTP range')
            headers.unlink()
        piece = job['dest'].with_suffix('.next')
        for attempt in range(12):
            have = job['dest'].stat().st_size if job['dest'].exists() else 0
            if have == size:
                return job
            if have > size:
                raise RuntimeError('Range exceeds expected size')
            start = job['start'] + have
            wanted = f'content-range: bytes {start}-{job["end"]}/{job["total"]}'
            result = subprocess.run(['curl', '--fail', '--silent', '--show-error', '--connect-timeout', '30', '--max-time', '600',
                                     '--range', f'{start}-{job["end"]}', '--max-filesize', str(size - have),
                                     '--dump-header', str(headers), '--output', str(piece), url], capture_output=True, text=True)
            if piece.exists() and headers.exists() and wanted in headers.read_text().lower():
                if piece.stat().st_size > size - have:
                    raise RuntimeError('Response exceeds requested range')
                with piece.open('rb') as incoming, job['dest'].open('ab') as saved:
                    shutil.copyfileobj(incoming, saved)
            piece.unlink(missing_ok=True)
            headers.unlink(missing_ok=True)
            if job['dest'].exists() and job['dest'].stat().st_size == size:
                return job
            print(job['base'], 'range', job['start'], 'retry', attempt + 1, result.stderr.strip()[:200], flush=True)
            time.sleep(min(2 ** attempt, 30))
        raise RuntimeError('Unable to restore range ' + str(job['start']) + ' of ' + job['base'])

    completed = 0
    total = sum(obj['size'] for obj in objects)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(fetch, job) for job in jobs]
        for future in concurrent.futures.as_completed(futures):
            job = future.result()
            completed += job['end'] - job['start'] + 1
            print(json.dumps(dict(downloadedBytes=completed, totalBytes=total, file=job['base'])), flush=True)
            obj = job['obj']
            obj['remaining'] -= 1
            if obj['remaining']:
                continue
            target = obj['target']
            target.parent.mkdir(parents=True, exist_ok=True)
            pending = target.with_name(target.name + '.tmp-rsl-restore')
            digest = hashlib.sha256()
            with pending.open('xb') as output:
                for path in obj['chunks']:
                    with path.open('rb') as source_chunk:
                        while chunk := source_chunk.read(1024 * 1024):
                            digest.update(chunk)
                            output.write(chunk)
            if pending.stat().st_size != obj['size'] or digest.hexdigest() != obj['oid']:
                raise RuntimeError('Downloaded archive does not match Git LFS SHA-256: ' + obj['base'])
            os.replace(pending, target)
            for path in obj['chunks']: path.unlink()
            print(obj['base'], 'LFS object verified', obj['oid'], flush=True)
    temporary.rmdir()


if __name__ == '__main__':
    main()
