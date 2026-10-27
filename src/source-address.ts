import { open } from "node:fs/promises";
import { createHash } from "node:crypto";

const verified = new Map<string, string>();
const signature = (s: import("node:fs").BigIntStats) =>
  [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(":");
/** Читает точные исходные байты после проверки SHA и неизменности файла.
 * Смещение с нуля; длина в байтах. Ошибка адреса/хеша/I/O прерывает вызывающий этап.
 * DOC-PREVIEW:/docs/import-storage.md#addresses
 */
export async function readSourceRecord({
  path,
  sha256,
  byteOffset,
  byteLength,
}: {
  path: string;
  sha256: string;
  byteOffset: number;
  byteLength: number;
}) {
  if (
    typeof path !== "string" ||
    !/^[a-f0-9]{64}$/.test(sha256 ?? "") ||
    !Number.isSafeInteger(byteOffset) ||
    byteOffset < 0 ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    byteLength > 16 * 1024 * 1024 ||
    !Number.isSafeInteger(byteOffset + byteLength)
  )
    throw Error("Invalid source address");
  const file = await open(path, "r");
  try {
    const before = await file.stat({ bigint: true });
    if (
      !before.isFile() ||
      BigInt(byteOffset) + BigInt(byteLength) > before.size
    )
      throw Error("Source address outside file");
    const key = path + ":" + signature(before);
    let hash = verified.get(key);
    if (!hash) {
      const digest = createHash("sha256");
      for await (const chunk of file.createReadStream({
        autoClose: false,
        start: 0,
      }))
        digest.update(chunk);
      hash = digest.digest("hex");
      if (signature(await file.stat({ bigint: true })) !== signature(before))
        throw Error("Source changed during verification");
      verified.set(key, hash);
    }
    if (hash !== sha256) throw Error("Source SHA-256 mismatch");
    const bytes = Buffer.alloc(byteLength);
    let read = 0;
    while (read < byteLength) {
      const result = await file.read(
        bytes,
        read,
        byteLength - read,
        byteOffset + read,
      );
      if (!result.bytesRead) throw Error("Unexpected source EOF");
      read += result.bytesRead;
    }
    if (signature(await file.stat({ bigint: true })) !== signature(before))
      throw Error("Source changed during read");
    return bytes;
  } finally {
    await file.close();
  }
}
