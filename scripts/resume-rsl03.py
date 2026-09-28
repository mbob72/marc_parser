import subprocess,time
from pathlib import Path
p=Path('data/rsl-2026-09-28/archives/rsl03_z00.dat.tar.gz.partial')
while p.stat().st_size<444585091:
    print('Resume at',p.stat().st_size,flush=True)
    result=subprocess.run(['curl','-fsSL','-C','-','--connect-timeout','30','--speed-limit','1000','--speed-time','120','-o',str(p),'https://mrsadman.ru/ac34d2e7ff814daf/rsl03_z00.dat.tar.gz'])
    if result.returncode: time.sleep(5)
print('Download complete',flush=True)
