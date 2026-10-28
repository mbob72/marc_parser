import { createReadStream } from "node:fs";
import { mkdir, open, rename, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AlephSequentialRecordSplitter } from "../aleph-sequential-record-splitter.js";
import { AlephSequentialMarcParser } from "../aleph-sequential-parser.js";
import { MarcRecordSplitter } from "../marc-record-splitter.js";
import { Iso2709MarcParser } from "../marc-parser.js";
import { MarcRecordValidator } from "../marc-validator.js";
import { MarcJsonSerializer } from "../marc-json-serializer.js";
import { APP_VERSION } from "../version.js";
import { saveJson } from "../runtime/control.js";
import {
  compressedWriter,
  emitEvent,
  fileDigest,
  hasNul,
} from "./copy-packages.js";

export interface PrepareOptions {
  input: string;
  output: string;
  libraryCode: string;
  encoding: string;
  format: "aleph-sequential" | "iso2709";
  member?: string;
  batchSize: number;
  validationPolicy: "reject" | "preserve";
}

/**
 * Подготовка ждёт обработку каждой записи splitter, а затем запись gzip-пакета.
 * Новому запуску нужен новый каталог; полный manifest публикуется после EOF.
 * DOC-PREVIEW:/docs/documents-import.md#prepare
 */
// DOC-PREVIEW:/docs/import-storage.md#code
export async function prepareDocuments(options: PrepareOptions) {
  if (!/^[A-Z0-9]{1,6}$/.test(options.libraryCode))
    throw Error("Invalid library code");
  if (!Number.isSafeInteger(options.batchSize) || options.batchSize < 1)
    throw Error("Invalid batch size");
  if (options.member)
    throw Error("Extract the archive before preparing byte-addressed records");
  const input = resolve(options.input);
  const output = resolve(options.output);
  const before = await stat(input);
  if (!before.isFile()) throw Error("Input must be a regular file");
  await mkdir(output);
  new TextDecoder(options.encoding);
  const diagnostics = await open(
    join(output, "diagnostics.ndjson"),
    "wx",
    0o600,
  );
  const counts = {
    processed: 0,
    deleted: 0,
    parsingErrors: 0,
    validationRecords: 0,
    rejected: 0,
    exported: 0,
  };
  const batches: { file: string; sha256: string; records: number }[] = [];
  const parser =
    options.format === "aleph-sequential"
      ? new AlephSequentialMarcParser()
      : new Iso2709MarcParser();
  const validator = new MarcRecordValidator(options.encoding);
  const serializer = new MarcJsonSerializer(options.encoding);
  let writer: ReturnType<typeof compressedWriter> | undefined;
  let file = "";
  let records = 0;
  let tar: ReturnType<typeof spawn> | undefined;
  let tarDone: Promise<void> | undefined;
  let tarFailure: unknown;
  let tarError = "";

  /** Завершает gzip до rename; progress не является разрешением на загрузку. */
  // DOC-PREVIEW:/docs/documents-code.md#prepare
  async function closeBatch() {
    if (!writer) return;
    const data = await writer.finish();
    await rename(join(output, file + ".partial"), join(output, file));
    batches.push({ file, records, sha256: data.copySha256 });
    writer = undefined;
    await saveJson(join(output, "progress.json"), { counts, batches });
    emitEvent("source_batch_prepared", {
      file,
      records,
      processed: counts.processed,
    });
  }

  const processor = {
    async process(
      bytes: Buffer,
      context: { recordIndex: number; byteOffset: number },
    ) {
      counts.processed++;
      let record;
      // Только ошибка разбора уже выделенной записи допускает продолжение.
      try {
        record = parser.parseForImport(bytes);
      } catch (error) {
        counts.parsingErrors++;
        await diagnostics.writeFile(
          JSON.stringify({
            ...context,
            kind: "parse",
            message: String(error),
            byteLength: bytes.length,
          }) + "\n",
        );
        return;
      }
      if (record === null) {
        counts.deleted++;
        return;
      }
      const validation = validator.validate(record);
      const json = serializer.serialize(record);
      if (!validation.valid) {
        counts.validationRecords++;
        await diagnostics.writeFile(
          JSON.stringify({
            ...context,
            byteLength: bytes.length,
            recordId: json.recordId,
            kind: "validation",
            errors: validation.errors,
          }) + "\n",
        );
      }
      const controls = json.fields.filter(
        (f) => f.code === "001" && "value" in f,
      );
      const identity =
        json.recordId ??
        (controls.length === 1 && "value" in controls[0]!
          ? controls[0]!.value
          : undefined);
      const issue =
        typeof identity !== "string" ||
        !/^\d{9}$/.test(identity) ||
        Number(identity) === 0
          ? "invalid_identity"
          : hasNul(json)
            ? "postgres_nul"
            : !validation.valid && options.validationPolicy === "reject"
              ? "validation_rejected"
              : undefined;
      if (issue) {
        counts.rejected++;
        await diagnostics.writeFile(
          JSON.stringify({
            ...context,
            byteLength: bytes.length,
            recordId: identity,
            kind: issue,
          }) + "\n",
        );
        return;
      }
      if (!writer) {
        file = `part-${String(batches.length + 1).padStart(5, "0")}.aleph.ndjson.gz`;
        writer = compressedWriter(join(output, file + ".partial"));
        records = 0;
      }
      // Контекст остаётся в подготовленных JSON; строка COPY связывает SQL с этим пакетом.
      await writer.write(
        JSON.stringify({
          ...json,
          recordId: identity,
          source: { ...context, byteLength: bytes.length },
        }) + "\n",
      );
      records++;
      counts.exported++;
      if (records === options.batchSize) await closeBatch();
    },
  };

  try {
    const digest = await fileDigest(input);
    let stream = createReadStream(input, { highWaterMark: 64 * 1024 });
    if (options.member) {
      stream.destroy();
      if (options.member.startsWith("-") || options.member.includes("\0"))
        throw Error("Invalid archive member");
      tar = spawn("tar", ["-xOzf", input, "--", options.member], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      tar.stderr!.on("data", (chunk) => {
        tarError = (tarError + chunk).slice(-4000);
      });
      tarDone = new Promise<void>((resolveDone, reject) => {
        tar!.once("error", reject);
        tar!.once("close", (code) =>
          code === 0 ? resolveDone() : reject(Error("tar failed: " + tarError)),
        );
      }).catch((error) => {
        tarFailure = error;
      });
      stream = tar.stdout! as typeof stream;
    }
    await pipeline(
      stream,
      options.format === "aleph-sequential"
        ? new AlephSequentialRecordSplitter(processor)
        : new MarcRecordSplitter(processor),
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
    );
    await tarDone;
    if (tarFailure) throw tarFailure;
    await closeBatch();
    const after = await stat(input);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw Error("Input changed during preparation");
    const manifest = {
      version: 1,
      complete: true,
      sample: false,
      libraryCode: options.libraryCode,
      archiveSha256: digest.sha256,
      input,
      member: options.member,
      parserVersion: APP_VERSION,
      encoding: options.encoding,
      inputFormat: options.format,
      validationPolicy: options.validationPolicy,
      counts,
      batches,
    };
    await saveJson(join(output, "manifest.json"), manifest);
    emitEvent("prepared", { counts, output });
    return manifest;
  } catch (error) {
    tar?.kill("SIGTERM");
    await tarDone;
    await writer?.abort();
    await saveJson(join(output, "failed.json"), {
      counts,
      message: String(error),
    });
    throw error;
  } finally {
    await diagnostics.close();
  }
}
