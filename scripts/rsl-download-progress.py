"""Live download dashboard; refresh every ten seconds. Ctrl+C closes only this view."""
import pathlib
import time
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ARCHIVES = ROOT / 'data/rsl-2026-09-17/archives'
REPORTS = ROOT / 'artifacts/rsl-2026-09-17'
SIZES = {'01': 3768951687, '02': 2261747, '03': 442770687,
         '06': 19218678, '07': 16960886, '10': 27041171, '11': 62112553}


def size(path):
    try:
        return path.stat().st_size
    except FileNotFoundError:
        return 0


def snapshot():
    result = {}
    for base, total in SIZES.items():
        downloaded = size(ARCHIVES / f'rsl{base}_z00.tar.gz')
        if base == '01' and downloaded < total:
            downloaded = max(downloaded, sum(size(p) for p in ARCHIVES.glob('rsl01.range-*')),
                             sum(size(p) for p in ARCHIVES.glob('rsl01_z00.tar.gz.part-*')))
        result[base] = min(downloaded, total)
    return result


def main():
    previous = snapshot()
    previous_time = time.monotonic()
    history = []
    speed = None
    while True:
        current = snapshot()
        now = time.monotonic()
        if now - previous_time >= 1:
            history.append((max(0, sum(current.values()) - sum(previous.values())), now - previous_time))
            history = history[-6:]
            speed = sum(x[0] for x in history) / sum(x[1] for x in history)
        downloaded, total = sum(current.values()), sum(SIZES.values())
        lines = ['ЗАГРУЗКА ВЫГРУЗОК РГБ', time.strftime('%H:%M:%S') + ' · обновление каждые 10 секунд', '']
        for base, expected in SIZES.items():
            amount = current[base]
            ratio = amount / expected
            bar = '█' * int(ratio * 28) + '░' * (28 - int(ratio * 28))
            state = 'скачан' if amount == expected else 'скачивается' if amount else 'ожидание'
            lines.append(f'rsl{base} [{bar}] {ratio:6.1%}  {amount / 1e6:8.1f} / {expected / 1e6:7.1f} МБ  {state}')
        lines += ['', f'Всего: {downloaded / 1e9:.2f} / {total / 1e9:.2f} ГБ ({downloaded / total:.1%})']
        if speed is not None:
            lines.append(f'Скорость за последнюю минуту: {speed / 1e6:.2f} МБ/с ({speed * 8 / 1e6:.2f} Мбит/с)')
            if speed > 0 and downloaded < total:
                minutes = (total - downloaded) / speed / 60
                lines.append(f'До конца загрузки: примерно {minutes:.0f} мин (без распаковки и анализа)')
            elif downloaded < total:
                lines.append('Нет прироста за период измерения; проверьте канал, если пауза затянется.')
        else:
            lines.append('Измеряю скорость…')
        finished = len(list(REPORTS.glob('*.diagnostic.summary.json')))
        lines += [f'Диагностических отчётов: {finished}/7', '',
                  'Ctrl+C закрывает только индикатор. Загрузка и анализ продолжатся.']
        if (REPORTS / 'completion.json').exists():
            lines.append('✓ Анализ и документация готовы. Коммит и push выполняет владелец.')
        sys.stdout.write('\033[2J\033[H' + '\n'.join(lines) + '\n')
        sys.stdout.flush()
        if downloaded == total and (REPORTS / 'completion.json').exists():
            break
        previous, previous_time = current, now
        time.sleep(10)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nИндикатор закрыт. Загрузка не остановлена.')
