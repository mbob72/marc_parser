import { readFile, open } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { from as copyFrom } from "pg-copy-streams";
import { databaseClient } from "./database.js";
import { emitEvent, fileDigest, uncompressed } from "./copy-packages.js";
import type { CopyManifest } from "./copy-packages.js";
import { mergeCopy } from "./merge-copy.js";
import { initializeImport, requireDocuments } from "./schema.js";

/** Разрешает только безопасные имена и целочисленные размеры; проверяет общий record count. */
// DOC-PREVIEW:/docs/documents-code.md#manifest
export async function readCopyManifest(input: string): Promise<CopyManifest> {
  const m = JSON.parse(
    await readFile(join(input, "manifest.json"), "utf8"),
  ) as CopyManifest;
  if (
    typeof (m.libraryCode ?? "RSL01") !== "string" ||
    !/^[A-Z0-9]{1,6}$/.test(m.libraryCode ?? "RSL01") ||
    m.complete !== true ||
    m.sample !== false ||
    m.version !== 1 ||
    !/^[a-f0-9]{64}$/.test(m.archiveSha256) ||
    !Array.isArray(m.batches) ||
    m.batches.length === 0 ||
    JSON.stringify(m.columns) !==
      JSON.stringify(["line", "system_number", "leader", "format", "fields"])
  )
    throw Error("Complete non-sample COPY manifest required");
  const names = new Set<string>();
  const files = new Set<string>();
  for (const b of m.batches) {
    if (
      !/^part-\d+\.documents\.copy\.tsv\.gz$/.test(b.file) ||
      !/^part-\d+\.aleph\.ndjson\.gz$/.test(b.sourceFile) ||
      names.has(b.sourceFile) ||
      files.has(b.file) ||
      ![b.sha256, b.copySha256, b.sourceSha256].every((h) =>
        /^[a-f0-9]{64}$/.test(h),
      ) ||
      ![b.records, b.bytes, b.copyBytes].every(
        (n) => Number.isSafeInteger(n) && n > 0,
      )
    )
      throw Error("Invalid COPY batch");
    names.add(b.sourceFile);
    files.add(b.file);
  }
  if (
    !Number.isSafeInteger(m.records) ||
    m.records < 1 ||
    m.batches.reduce((sum, b) => sum + b.records, 0) !== m.records
  )
    throw Error("COPY manifest record count mismatch");
  return m;
}

export interface LoadCopyOptions {
  input: string;
  report: string;
  startBatch?: number;
  maxBatches?: number;
  dryRun?: boolean;
}

/** Потоковый COPY в ту же БД: нет psql/tempfile; пакет и прежний document_batches фиксируются атомарно. */
// DOC-PREVIEW:/docs/documents-import.md#load
export async function loadCopy(options: LoadCopyOptions): Promise<void> {
  const m = await readCopyManifest(options.input);
  const start = options.startBatch ?? 1;
  const max = options.maxBatches ?? Infinity;
  if (
    !Number.isSafeInteger(start) ||
    start < 1 ||
    start > m.batches.length ||
    (max !== Infinity && (!Number.isSafeInteger(max) || max < 1))
  )
    throw Error("Invalid batch selection");
  const client = databaseClient();
  const report = await open(options.report, "wx");
  let activeCopy: ReturnType<typeof copyFrom> | undefined;
  let connectionError: Error | undefined;
  let phase = "connect",
    file: string | undefined,
    bytes = 0;
  const timer = setInterval(
    () => emitEvent("waiting", { phase, file, bytes }),
    10000,
  );
  timer.unref();
  client.on("error", (error: Error) => {
    connectionError = error;
    activeCopy?.destroy(error);
    emitEvent("connection_error", { message: error.message });
  });
  try {
    emitEvent("start", {
      phase,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
    });
    await client.connect();
    await client.query(
      "SET lock_timeout='60s'; SELECT pg_advisory_lock_shared(hashtext('z103_import.pipeline')); SELECT pg_advisory_lock(hashtext('z103_import.documents.loader'));",
    );
    await requireDocuments(client);
    let inserted = 0,
      identical = 0,
      conflicts = 0,
      skipped = 0;
    const selected = m.batches.slice(
      start - 1,
      max === Infinity ? undefined : start - 1 + max,
    );
    for (const batch of selected) {
      file = batch.sourceFile;
      phase = "verify";
      bytes = 0;
      emitEvent("batch_start", { file, records: batch.records });
      await client.query("BEGIN");
      await initializeImport(client);
      const saved = await client.query(
        "SELECT sha,report FROM z103_import.document_batches WHERE archive_sha=$1 AND file=$2",
        [m.archiveSha256, file],
      );
      if (saved.rowCount) {
        if (saved.rows[0].sha !== batch.sourceSha256)
          throw Error("Journal hash mismatch");
        if (
          (saved.rows[0].report.libraryCode ?? "RSL01") !==
          (m.libraryCode ?? "RSL01")
        )
          throw Error("Journal library mismatch");
        conflicts += Number(saved.rows[0].report.conflicts ?? 0);
        await client.query("ROLLBACK");
        skipped++;
        emitEvent("batch_skipped", { file });
        continue;
      }
      const path = join(options.input, batch.file);
      const digest = await fileDigest(path);
      if (digest.bytes !== batch.bytes || digest.sha256 !== batch.sha256)
        throw Error(`Gzip verification failed: ${batch.file}`);
      await client.query(
        "CREATE TEMP TABLE document_incoming(line bigint,system_number integer PRIMARY KEY,leader text,format text,fields jsonb) ON COMMIT DROP",
      );
      const hash = createHash("sha256");
      phase = "copy";
      const started = Date.now();
      async function* chunks() {
        for await (const chunk of uncompressed(path)) {
          hash.update(chunk);
          bytes += chunk.length;
          yield chunk;
        }
      }
      activeCopy = client.query(
        copyFrom(
          String.raw`COPY document_incoming FROM STDIN WITH (FORMAT csv, DELIMITER E'\t', NULL '\N')`,
        ),
      );
      try {
        await pipeline(Readable.from(chunks()), activeCopy);
      } finally {
        activeCopy = undefined;
      }
      if (bytes !== batch.copyBytes || hash.digest("hex") !== batch.copySha256)
        throw Error(`Uncompressed COPY verification failed: ${batch.file}`);
      const count = await client.query(
        "SELECT count(*)::int AS n FROM document_incoming",
      );
      if (count.rows[0].n !== batch.records) throw Error("COPY count mismatch");
      emitEvent("copy_done", { file, bytes, copyMs: Date.now() - started });
      phase = "merge";
      await mergeCopy(client, m, batch);
      const result = (await client.query("SELECT * FROM batch_result"))
        .rows[0] as {
        inserted: string;
        identical: string;
        conflicts: string;
      };
      await client.query(options.dryRun ? "ROLLBACK" : "COMMIT");
      inserted += Number(result.inserted);
      identical += Number(result.identical);
      conflicts += Number(result.conflicts);
      const entry = {
        event: options.dryRun ? "batch_rolled_back" : "batch_committed",
        file,
        bytes,
        ...result,
        elapsedMs: Date.now() - started,
      };
      await report.writeFile(JSON.stringify(entry) + "\n");
      emitEvent(entry.event, entry);
    }
    if (!options.dryRun) {
      const sequence = (
        await client.query(
          "SELECT pg_get_serial_sequence('public.documents','system_number') name",
        )
      ).rows[0].name as string | null;
      if (sequence) {
        await client.query(
          "BEGIN; LOCK TABLE public.documents IN SHARE ROW EXCLUSIVE MODE",
        );
        await client.query(
          "SELECT setval($1::regclass,GREATEST((SELECT max(system_number) FROM public.documents),nextval($1::regclass)),true)",
          [sequence],
        );
        await client.query("COMMIT");
      }
    }
    const entry = {
      event: "finished",
      inserted,
      identical,
      conflicts,
      skipped,
      selectedBatches: selected.length,
      dryRun: Boolean(options.dryRun),
    };
    await report.writeFile(JSON.stringify(entry) + "\n");
    emitEvent("finished", entry);
    if (conflicts > 0) throw Error("Existing document conflicts: " + conflicts);
  } catch (error) {
    emitEvent("failed", {
      phase,
      file,
      message: error instanceof Error ? error.message : String(error),
      recovery:
        "Restart with a new report; committed batches are in document_batches",
    });
    throw error;
  } finally {
    clearInterval(timer);
    if (!connectionError) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
    await report.close();
  }
}
