"""Check gzip CRC and length once each new download completes."""
import hashlib
import json
import subprocess
import time
from pathlib import Path
out=Path('artifacts/rsl-2026-09-28')
root=Path('data/rsl-2026-09-28/archives')
sizes={'01':3782119309,'02':2261749,'03':444585091,'06':19218682,'07':16960916,'10':27100591,'11':62250563}
verified={}
while len(verified)<7:
    for base,size in sizes.items():
        name='rsl'+base+'_z00.dat.tar.gz'
        if name in verified: continue
        path=root/name
        if not path.exists() or path.stat().st_size!=size: continue
        subprocess.run(['gzip','-t',str(path)],check=True)
        with path.open('rb') as source: digest=hashlib.file_digest(source,'sha256').hexdigest()
        verified[name]=dict(bytes=size,sha256=digest,gzipCRC='passed')
        target=out/'archive-verification.json'
        temporary=target.with_suffix('.json.tmp-verify')
        temporary.write_text(json.dumps(verified,indent=2)+'\n'); temporary.replace(target)
        print(name,'CRC and size OK',flush=True)
    if len(verified)<7: time.sleep(10)
