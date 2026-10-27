import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, statfs } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { once } from "node:events";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { copyRow } from "./copy.js";

export interface SourceBatch {
  file: string;
  sha256: string;
  records: number;
}
export interface SourceManifest {
  input?: string;
  member?: string;
  complete: boolean;
  sample: boolean;
  archiveSha256: string;
  counts: { exported: number };
  libraryCode?: string;
  batches: SourceBatch[];
}
export interface CopyBatch {
  sourceFile: string;
  sourceSha256: string;
  records: number;
  file: string;
  sha256: string;
  bytes: number;
  copyBytes: number;
  copySha256: string;
  idsFile: string;
  idsSha256: string;
  idsBytes: number;
  idsCopyBytes: number;
  idsCopySha256: string;
}
export interface CopyManifest {
  sourceInput?: string;
  version: number;
  libraryCode?: string;
  complete: boolean;
  sample: boolean;
  archiveSha256: string;
  sourceDirectory: string;
  format: string;
  columns: string[];
  records: number;
  compressedBytes: number;
  batches: CopyBatch[];
}
// DOC-PREVIEW:/docs/documents-code.md#events
export const emitEvent = (event: string, details: object = {}): void => {
  process.stdout.write(
    JSON.stringify({ time: new Date().toISOString(), event, ...details }) +
      "\n",
  );
};

/** Хеширует файл потоково; большие gzip не загружаются целиком в память. */
// DOC-PREVIEW:/docs/documents-code.md#digest
export async function fileDigest(
  path: string,
): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest("hex"), bytes };
}

/** Проверяет рекурсивные строки JSON до преобразования в PostgreSQL JSONB. */
// DOC-PREVIEW:/docs/documents-code.md#nul
export function hasNul(value: unknown): boolean {
  if (typeof value === "string") return value.includes("\0");
  if (Array.isArray(value)) return value.some(hasNul);
  if (value && typeof value === "object")
    return Object.entries(value).some(
      ([key, item]) => hasNul(key) || hasNul(item),
    );
  return false;
}

/** Читает распакованные байты; ошибки чтения и gzip завершают также потребителя. */
// DOC-PREVIEW:/docs/documents-code.md#uncompressed
export async function* uncompressed(path: string): AsyncGenerator<Buffer> {
  const input = createReadStream(path);
  const gzip = createGunzip();
  let failure: unknown;
  const completion = pipeline(input, gzip).catch((error: unknown) => {
    failure = error;
  });
  try {
    for await (const chunk of gzip) yield chunk as Buffer;
    await completion;
    if (failure) throw failure;
  } finally {
    input.destroy();
    gzip.destroy();
    await completion;
  }
}

/** Выделяет JSONL без изменения исходных байтов для проверки SHA; ограничивает размер строки. */
// DOC-PREVIEW:/docs/documents-code.md#source-lines
async function* sourceLines(
  path: string,
  hash: ReturnType<typeof createHash>,
): AsyncGenerator<string> {
  let pending = Buffer.alloc(0);
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  for await (const chunk of uncompressed(path)) {
    hash.update(chunk);
    const data = Buffer.concat([pending, chunk]);
    let start = 0;
    let end: number;
    while ((end = data.indexOf(10, start)) !== -1) {
      if (end - start > 32 * 1024 * 1024)
        throw Error("JSONL line exceeds 32 MiB");
      yield decoder.decode(data.subarray(start, end));
      start = end + 1;
    }
    pending = Buffer.from(data.subarray(start));
    if (pending.length > 32 * 1024 * 1024)
      throw Error("JSONL line exceeds 32 MiB");
  }
  if (pending.length) yield decoder.decode(pending);
}

/** Сжимает блоки по 1 МиБ, вычисляет оба SHA и учитывает backpressure/ошибки диска. */
// DOC-PREVIEW:/docs/documents-code.md#writer
export function compressedWriter(path: string) {
  const gzip = createGzip({ level: 1 });
  const compressedHash = createHash("sha256");
  const copyHash = createHash("sha256");
  let bytes = 0;
  let copyBytes = 0;
  let failure: unknown;
  let pending: Buffer[] = [];
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      compressedHash.update(chunk);
      bytes += chunk.length;
      callback(null, chunk);
    },
  });
  const completion = pipeline(
    gzip,
    meter,
    createWriteStream(path, { flags: "wx" }),
  ).catch((error: unknown) => {
    failure = error;
  });
  async function flush() {
    if (failure) throw failure;
    if (!size) return;
    const block = Buffer.concat(pending, size);
    pending = [];
    size = 0;
    if (!gzip.write(block)) await once(gzip, "drain");
    if (failure) throw failure;
  }
  return {
    async write(data: string) {
      const buffer = Buffer.from(data);
      copyHash.update(buffer);
      copyBytes += buffer.length;
      pending.push(buffer);
      size += buffer.length;
      if (size >= 1048576) await flush();
    },
    async finish() {
      await flush();
      gzip.end();
      await completion;
      if (failure) throw failure;
      return {
        bytes,
        sha256: compressedHash.digest("hex"),
        copyBytes,
        copySha256: copyHash.digest("hex"),
      };
    },
    async abort() {
      gzip.destroy();
      await completion;
    },
  };
}

/** Проверяет исходный manifest до создания нового выходного каталога. */
// DOC-PREVIEW:/docs/documents-code.md#manifest
export async function readSourceManifest(
  input: string,
): Promise<SourceManifest> {
  const source = JSON.parse(
    await readFile(join(input, "manifest.json"), "utf8"),
  ) as SourceManifest;
  if (
    source.complete !== true ||
    source.sample !== false ||
    typeof (source.libraryCode ?? "RSL01") !== "string" ||
    !/^[A-Z0-9]{1,6}$/.test(source.libraryCode ?? "RSL01") ||
    !/^[a-f0-9]{64}$/.test(source.archiveSha256) ||
    !Array.isArray(source.batches) ||
    !Number.isSafeInteger(source.counts?.exported)
  )
    throw Error("Complete non-sample input required");
  if (typeof source.input !== "string" || source.member)
    throw Error("Uncompressed source file required: prepare again");
  const names = new Set<string>();
  for (const b of source.batches) {
    if (
      typeof b.file !== "string" ||
      basename(b.file) !== b.file ||
      !/^part-\d+\.aleph\.ndjson\.gz$/.test(b.file) ||
      !/^[a-f0-9]{64}$/.test(b.sha256) ||
      !Number.isSafeInteger(b.records) ||
      b.records < 1 ||
      names.has(b.file)
    )
      throw Error("Invalid source batch");
    names.add(b.file);
  }
  if (
    source.batches.reduce((sum, b) => sum + b.records, 0) !==
    source.counts.exported
  )
    throw Error("Source total count mismatch");
  return source;
}

/** Формат совместим с Python-пакетами; manifest публикуется только после проверки выбранных данных. */
// DOC-PREVIEW:/docs/documents-code.md#copy-prepare
// DOC-PREVIEW:/docs/import-storage.md#code
export async function prepareCopy(
  input: string,
  output: string,
  limit?: number,
  reserveBytes = 2 * 1024 ** 3,
): Promise<CopyManifest> {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
    throw Error("Invalid batches");
  if (!Number.isSafeInteger(reserveBytes) || reserveBytes < 0)
    throw Error("Invalid disk reserve");
  const source = await readSourceManifest(input);
  await mkdir(output);
  const batches: CopyBatch[] = [];
  let total = 0;
  for (const batch of source.batches.slice(0, limit)) {
    const disk = await statfs(output);
    if (disk.bavail * disk.bsize < reserveBytes)
      throw Error("Less than reserved disk space free");
    const stem = batch.file.replace(/\.aleph\.ndjson\.gz$/, "");
    const file = stem + ".documents.copy.tsv.gz";
    const idsFile = stem + ".ids.copy.tsv.gz";
    const writer = compressedWriter(join(output, file + ".partial"));
    const ids = compressedWriter(join(output, idsFile + ".partial"));
    const hash = createHash("sha256");
    let records = 0;
    try {
      for await (const line of sourceLines(join(input, batch.file), hash)) {
        const r = JSON.parse(line) as {
          recordId: unknown;
          leader: unknown;
          format: unknown;
          fields: unknown;
          source?: { byteOffset: number; byteLength: number };
        };
        records++;
        if (
          typeof r.recordId !== "string" ||
          !/^\d{9}$/.test(r.recordId) ||
          Number(r.recordId) === 0
        )
          throw Error(`Invalid identity: ${batch.file}:${records}`);
        if (
          typeof r.leader !== "string" ||
          r.leader.length > 25 ||
          typeof r.format !== "string" ||
          r.format.length > 5 ||
          !Array.isArray(r.fields)
        )
          throw Error(`Invalid shape: ${batch.file}:${records}`);
        if (hasNul(r)) throw Error(`PostgreSQL NUL: ${batch.file}:${records}`);
        if (
          !r.source ||
          !Number.isSafeInteger(r.source.byteOffset) ||
          r.source.byteOffset < 0 ||
          !Number.isSafeInteger(r.source.byteLength) ||
          r.source.byteLength <= 0
        )
          throw Error("Source byte address missing: prepare again");
        await writer.write(
          copyRow([
            records,
            Number(r.recordId),
            r.leader,
            r.format,
            JSON.stringify(r.fields),
            r.source.byteOffset,
            r.source.byteLength,
          ]),
        );
        await ids.write(Number(r.recordId) + "\n");
      }
      const data = await writer.finish();
      const idData = await ids.finish();
      if (records !== batch.records || hash.digest("hex") !== batch.sha256)
        throw Error(`Source verification failed: ${batch.file}`);
      await rename(join(output, file + ".partial"), join(output, file));
      await rename(join(output, idsFile + ".partial"), join(output, idsFile));
      const result = {
        sourceFile: batch.file,
        sourceSha256: batch.sha256,
        records,
        file,
        ...data,
        idsFile,
        idsSha256: idData.sha256,
        idsBytes: idData.bytes,
        idsCopyBytes: idData.copyBytes,
        idsCopySha256: idData.copySha256,
      };
      batches.push(result);
      total += records;
      emitEvent("batch_prepared", { batch: batches.length, ...result });
    } catch (error) {
      await Promise.allSettled([writer.abort(), ids.abort()]);
      throw error;
    }
  }
  const complete = batches.length === source.batches.length;
  const manifest: CopyManifest = {
    version: 1,
    libraryCode: source.libraryCode ?? "RSL01",
    complete,
    sample: !complete,
    archiveSha256: source.archiveSha256,
    sourceDirectory: resolve(input),
    sourceInput: source.input,
    format: "COPY CSV TSV; quoted values; UTF-8; NULL \\N",
    columns: [
      "line",
      "system_number",
      "leader",
      "format",
      "fields",
      "byte_offset",
      "byte_length",
    ],
    records: total,
    compressedBytes: batches.reduce((sum, b) => sum + b.bytes + b.idsBytes, 0),
    batches,
  };
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    join(output, "manifest.json.partial"),
    JSON.stringify(manifest, null, 2) + "\n",
    {
      flag: "wx",
    },
  );
  await rename(
    join(output, "manifest.json.partial"),
    join(output, "manifest.json"),
  );
  emitEvent("complete", {
    complete,
    records: total,
    compressedBytes: manifest.compressedBytes,
  });
  return manifest;
}
