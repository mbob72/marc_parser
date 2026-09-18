#!/usr/bin/env bash
set -eu
root=data/rsl-2026-09-17
out=artifacts/rsl-2026-09-17
for pair in 06:19218678 07:16960886 10:27041171 11:62112553 03:442770687 01:3768951687; do
  id=${pair%:*}
  expected=${pair#*:}
  archive="$root/archives/rsl${id}_z00.tar.gz"
  while [ ! -f "$archive" ] || [ "$(stat -f %z "$archive")" != "$expected" ]; do sleep 10; done
  tar -tzf "$archive" > "$out/rsl${id}-archive-members.txt"
  [ "$(cat "$out/rsl${id}-archive-members.txt")" = "rsl${id}_z00.dat" ] || exit 1
  tar -xzf "$archive" -C "$root/raw"
  node --import tsx scripts/audit-rsl.ts "$root/raw/rsl${id}_z00.dat" "$out" strict > "$out/rsl${id}-strict.log" || true
  node --import tsx scripts/audit-rsl.ts "$root/raw/rsl${id}_z00.dat" "$out" diagnostic > "$out/rsl${id}-diagnostic.log" || exit 1
  shasum -a 256 "$archive" "$root/raw/rsl${id}_z00.dat" > "$out/rsl${id}-sha256.txt"
done
split -b 1000000000 data/rsl-2026-09-17/archives/rsl01_z00.tar.gz data/rsl-2026-09-17/archives/rsl01_z00.tar.gz.part-
shasum -a 256 data/rsl-2026-09-17/archives/*.part-* > artifacts/rsl-2026-09-17/rsl01-parts-sha256.txt
python3 scripts/summarize-rsl.py
