"""Unpack growing gzip downloads, checking each archive to its final byte."""
import concurrent.futures
import io
import json
import tarfile
import time
from pathlib import Path
root=Path('data/rsl-2026-09-28')
sizes={'06':19218682,'07':16960916,'10':27100591,'11':62250563,'03':444585091,'01':3782119309}
class Growing(io.RawIOBase):
    def __init__(self,path,size): self.f=path.open('rb'); self.size=size; self.pos=0
    def readable(self): return True
    def readinto(self,b):
        while self.pos<self.size:
            n=self.f.readinto(memoryview(b)[:min(len(b),self.size-self.pos)])
            if n: self.pos+=n; return n
            time.sleep(1)
        return 0
    def close(self): self.f.close(); super().close()
def unpack(pair):
    base,size=pair; name='rsl'+base+'_z00.dat'
    path=root/'archives'/(name+'.tar.gz.partial')
    if not path.exists(): path=path.with_suffix('')
    raw=root/'raw'/name
    tmp=raw.with_suffix('.dat.unpacking')
    with Growing(path,size) as growing, io.BufferedReader(growing) as src, tarfile.open(fileobj=src,mode='r|gz') as tar:
        seen=False
        for member in tar:
            assert member.name in (name,'./'+name) and member.isfile() and not seen,member.name
            seen=True
            with tar.extractfile(member) as source,tmp.open('xb') as target:
                while chunk:=source.read(1024*1024): target.write(chunk)
        assert seen
        while src.read(1024*1024): pass
    tmp.rename(raw)
    raw.with_suffix('.dat.ready').write_text(str(raw.stat().st_size))
    print(name,'unpacked',raw.stat().st_size,flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    list(pool.map(unpack,sizes.items()))
