"""Restore selected RSL sources from the local LFS cache and audit without JSON serialization."""
import argparse
import hashlib
import io
import json
import shutil
import subprocess
import tarfile
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASES = ['rsl06', 'rsl07', 'rsl10', 'rsl11', 'rsl03', 'rsl01']


def stamp():
    return datetime.now(timezone.utc).isoformat()


def sha(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


class Parts(io.RawIOBase):
    def __init__(self, paths):
        self.paths = iter(paths)
        self.current = None

    def readable(self):
        return True

    def readinto(self, buffer):
        while True:
            if self.current is None:
                path = next(self.paths, None)
                if path is None:
                    return 0
                self.current = path.open('rb')
            count = self.current.readinto(buffer)
            if count:
                return count
            self.current.close()
            self.current = None

    def close(self):
        if self.current:
            self.current.close()
        super().close()


def cached_parts(base):
    archives = ROOT / 'data/rsl-2026-09-17/archives'
    pointers = (sorted(archives.glob(base + '_z00.tar.gz.part-*')) if base == 'rsl01'
                else [archives / (base + '_z00.tar.gz')])
    if not pointers:
        raise RuntimeError('No archive pointers: ' + base)
    result = []
    for pointer in pointers:
        lines = pointer.read_text().splitlines()
        oid = next(line.split(':', 1)[1] for line in lines if line.startswith('oid sha256:'))
        size = next(int(line.split()[1]) for line in lines if line.startswith('size '))
        obj = ROOT / '.git/lfs/objects' / oid[:2] / oid[2:4] / oid
        if obj.stat().st_size != size or sha(obj) != oid:
            raise RuntimeError('LFS integrity failure: ' + str(pointer))
        result.append(obj)
    return result


def restore(base):
    name = base + '_z00.dat'
    expected = json.loads((ROOT / 'artifacts/rsl-2026-09-17' / (name + '.diagnostic.summary.json')).read_text())
    raw = ROOT / 'data/rsl-2026-09-17/raw' / name
    raw.parent.mkdir(exist_ok=True)
    if raw.exists():
        if raw.stat().st_size == expected['fileBytes'] and sha(raw) == expected['sha256']:
            return raw
        raise RuntimeError('Existing raw source differs: ' + str(raw))
    parts = cached_parts(base)
    temporary = raw.with_suffix('.dat.tmp-restore')
    digest = hashlib.sha256()
    with io.BufferedReader(Parts(parts)) as archive, tarfile.open(fileobj=archive, mode='r|gz') as tar:
        found = False
        for member in tar:
            if member.name != name or not member.isfile() or found or member.size != expected['fileBytes']:
                raise RuntimeError('Unexpected archive member: ' + member.name)
            found = True
            with tar.extractfile(member) as source, temporary.open('xb') as target:
                while chunk := source.read(1024 * 1024):
                    digest.update(chunk)
                    target.write(chunk)
        if not found or digest.hexdigest() != expected['sha256']:
            raise RuntimeError('Source checksum mismatch: ' + name)
    temporary.rename(raw)
    return raw


def wait_for_archive(base):
    archives = ROOT / 'data/rsl-2026-09-17/archives'
    pointers = sorted(archives.glob(base + '_z00.tar.gz.part-*')) if base == 'rsl01' else [archives / (base + '_z00.tar.gz')]
    while True:
        ready = True
        for pointer in pointers:
            lines = pointer.read_text().splitlines()
            oid = next(line.split(':', 1)[1] for line in lines if line.startswith('oid sha256:'))
            size = next(int(line.split()[1]) for line in lines if line.startswith('size '))
            obj = ROOT / '.git/lfs/objects' / oid[:2] / oid[2:4] / oid
            ready = ready and obj.exists() and obj.stat().st_size == size
        if ready:
            return
        time.sleep(10)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    paths = sorted((ROOT / 'src').glob('*.ts')) + [ROOT / 'scripts/audit-rsl.ts', Path(__file__).resolve()]
    manifest = dict(startedAt=stamp(), bases=BASES, excluded=['rsl02'], mode='errors-only',
                    revision=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                    sourceHashes={str(p.relative_to(ROOT)): sha(p) for p in paths}, completed=[])
    (out / 'implementation.patch').write_bytes(subprocess.check_output(['git', 'diff', 'HEAD', '--', 'src', 'scripts/audit-rsl.ts'], cwd=ROOT))
    shutil.copyfile(ROOT / 'scripts/audit-rsl.ts', out / 'audit-rsl.ts.txt')
    shutil.copyfile(Path(__file__), out / 'run-rsl-errors-audit.py.txt')

    def save():
        (out / 'run-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')

    save()
    try:
        for base in BASES:
            manifest['current'] = base
            manifest['stage'] = 'waiting-for-download'
            save()
            wait_for_archive(base)
            manifest['stage'] = 'restore'
            save()
            print(stamp(), base, 'restoring', flush=True)
            source = restore(base)
            manifest['stage'] = 'audit'
            save()
            print(stamp(), base, 'auditing', flush=True)
            with (out / (base + '.audit.log')).open('w') as log:
                subprocess.run(['node', '--import', 'tsx', 'scripts/audit-rsl.ts', str(source), str(out), 'errors-only'],
                               cwd=ROOT, stdout=log, stderr=log, check=True)
            summary = json.loads((out / (source.name + '.errors-only.summary.json')).read_text())
            old = json.loads((ROOT / 'artifacts/rsl-2026-09-17' / (source.name + '.diagnostic.summary.json')).read_text())
            assert summary['complete'] and summary['sha256'] == old['sha256']
            assert summary['recordsProcessed'] == old['recordsProcessed']
            assert not summary['serializationPerformed'] and summary['serializedBytes'] == 0
            assert summary['recordsProcessed'] == sum(summary[k] for k in ['validRecords', 'recordsWithValidationErrors', 'recordsWithParsingErrors', 'skippedDeletedRecords'])
            manifest['completed'].append(base)
            save()
            print(stamp(), base, 'complete', summary['recordsProcessed'], 'records;', summary['validationErrors'], 'validation errors;', summary['recordsWithParsingErrors'], 'parse errors', flush=True)
        manifest.update(stage='report')
        save()
        subprocess.run(['python3', 'scripts/report-rsl-errors.py', str(out)], cwd=ROOT, check=True)
        manifest.update(stage='complete', completedAt=stamp())
    except BaseException as error:
        manifest.update(stage='failed', error=str(error), stoppedAt=stamp())
        raise
    finally:
        save()


if __name__ == '__main__':
    main()
