"""Resume the main archive with validated parallel HTTP ranges."""
import concurrent.futures
import pathlib
import subprocess
root=pathlib.Path('data/rsl-2026-09-28/archives')
path=root/'rsl01_z00.dat.tar.gz.partial'
size=3782119309
chunk=8000000
start=path.stat().st_size

def fetch(offset):
    end=min(offset+chunk,size)-1
    part=root/f'rsl01.range-{offset:010d}'
    if part.exists() and part.stat().st_size == end-offset+1:
        return part
    subprocess.run(['curl','-fsS','--retry','10','--retry-all-errors','--max-time','1800','--range',f'{offset}-{end}','--header','If-Match: "6ab76e96-e16e8f8d"','-o',str(part),'https://mrsadman.ru/ac34d2e7ff814daf/rsl01_z00.dat.tar.gz'],check=True)
    assert part.stat().st_size==end-offset+1
    return part
with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool, path.open('ab') as output:
    for part in pool.map(fetch,range(start,size,chunk)):
        with part.open('rb') as source:
            while block:=source.read(1024*1024): output.write(block)
        output.flush(); part.unlink()
        print(output.tell(),size,flush=True)
assert path.stat().st_size==size
