import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile, stat, statfs } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { from as copyFrom } from "pg-copy-streams";
import type { Client } from "pg";
import { databaseClient } from "./database.js";
import { copyRow } from "./copy.js";
import {
  emitEvent,
  fileDigest,
  hasNul,
  readSourceManifest,
  sourceLines,
} from "./copy-packages.js";
import { AlephSequentialRecordSplitter } from "../aleph-sequential-record-splitter.js";
import { AlephSequentialMarcParser } from "../aleph-sequential-parser.js";
import { Iso2709MarcParser } from "../marc-parser.js";
import {
  MarcJsonSerializer,
  type MarcJsonRecord,
} from "../marc-json-serializer.js";

type StageManifest = Awaited<ReturnType<typeof readSourceManifest>> & {
  encoding: string;
  inputFormat: "aleph-sequential" | "iso2709";
  counts: {
    exported: number;
    processed: number;
    deleted: number;
    rejected: number;
    parsingErrors: number;
  };
};
type SourceRecord = MarcJsonRecord & {
  source: { recordIndex: number; byteOffset: number; byteLength: number };
};
type Diagnostic = {
  kind: string;
  recordIndex: number;
  byteOffset: number;
  byteLength?: number;
  recordId?: string;
  errors?: unknown[];
  message?: string;
};
type StageReporter = (event: string, details: object) => Promise<void>;

/** Создаёт самостоятельное хранилище БЗ; несовместимая старая таблица не изменяется молча.
 * DOC-PREVIEW:/docs/bib-staging.md#schema
 */
export async function initializeBibRecords(client: Client) {
  const old = await client.query(
    "SELECT to_regclass('import.bib_records') IS NOT NULL present",
  );
  if (old.rows[0].present) {
    const column = await client.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema='import' AND table_name='bib_records' AND column_name='accepted'",
    );
    if (!column.rowCount)
      throw Error(
        "Legacy import.bib_records requires an explicit schema migration",
      );
  }
  await client.query(`CREATE SCHEMA IF NOT EXISTS import;
    CREATE TABLE IF NOT EXISTS import.bib_sources(sha256 text PRIMARY KEY,path text NOT NULL);
    CREATE TABLE IF NOT EXISTS import.bib_records(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      library_code varchar(6) NOT NULL,
      system_number integer,
      leader varchar(25) NOT NULL,
      format varchar(5) NOT NULL,
      fields jsonb NOT NULL,
      hidden boolean NOT NULL DEFAULT false,
      meta jsonb,
      created_at timestamp NOT NULL DEFAULT current_timestamp,
      updated_at timestamp,
      source_sha256 text NOT NULL REFERENCES import.bib_sources(sha256),
      source_record_index bigint NOT NULL CHECK(source_record_index>=0),
      byte_offset bigint NOT NULL CHECK(byte_offset>=0),
      byte_length bigint NOT NULL CHECK(byte_length>0),
      accepted boolean NOT NULL,
      rejection_code text,
      rejection_reasons text[] NOT NULL DEFAULT '{}',
      UNIQUE(source_sha256,byte_offset),
      CHECK(accepted=(rejection_code IS NULL)),
      CHECK(NOT accepted OR system_number>0),
      CHECK(NOT accepted OR system_number IS NOT NULL));
    CREATE UNIQUE INDEX IF NOT EXISTS bib_records_identity ON import.bib_records(library_code,system_number) WHERE accepted;
    CREATE TABLE IF NOT EXISTS import.bib_record_batches(
      source_sha256 text NOT NULL REFERENCES import.bib_sources(sha256),
      file text NOT NULL,sha256 text NOT NULL,records integer NOT NULL,
      accepted integer NOT NULL,rejected integer NOT NULL,
      completed_at timestamptz NOT NULL DEFAULT current_timestamp,
      PRIMARY KEY(source_sha256,file));
    CREATE TABLE IF NOT EXISTS import.bib_record_runs(
      source_sha256 text PRIMARY KEY REFERENCES import.bib_sources(sha256),library_code varchar(6) NOT NULL,
      processed bigint NOT NULL,deleted bigint NOT NULL,exported bigint NOT NULL,
      source_rejected bigint NOT NULL,parsing_errors bigint NOT NULL,
      completed_at timestamptz NOT NULL DEFAULT current_timestamp);`);
}

/** Проверяет подготовленную форму и выдаёт COPY-строку без полной JSON-копии записи.
 * DOC-PREVIEW:/docs/bib-staging.md#copy
 */
function stageRow(
  record: SourceRecord,
  rejectionCode: string | null = null,
  reasons: string[] = [],
): string {
  const { source } = record;
  if (
    !source ||
    !Number.isSafeInteger(source.recordIndex) ||
    source.recordIndex < 0 ||
    !Number.isSafeInteger(source.byteOffset) ||
    source.byteOffset < 0 ||
    !Number.isSafeInteger(source.byteLength) ||
    source.byteLength < 1 ||
    typeof record.leader !== "string" ||
    record.leader.length > 25 ||
    typeof record.format !== "string" ||
    record.format.length > 5 ||
    !Array.isArray(record.fields)
  )
    throw Error("Invalid prepared BZ shape or source address");
  const number =
    typeof record.recordId === "string" &&
    /^\d{9}$/.test(record.recordId) &&
    Number(record.recordId) > 0
      ? Number(record.recordId)
      : null;
  if (!rejectionCode && (!number || hasNul(record)))
    throw Error("Invalid accepted BZ identity or PostgreSQL NUL");
  if (hasNul(record))
    throw Error(
      "Rejected BZ contains PostgreSQL NUL: manual recovery required",
    );
  return copyRow([
    source.recordIndex,
    number,
    record.leader,
    record.format,
    JSON.stringify(record.fields),
    source.byteOffset,
    source.byteLength,
    rejectionCode,
    JSON.stringify(reasons),
  ]);
}

/** Старые diagnostics не содержат длину: читает только одну запись по известному смещению.
 * SHA всего DAT проверяет вызывающий слой один раз; полный повторный разбор не запускается.
 * DOC-PREVIEW:/docs/bib-staging.md#rejections
 */
async function rejectedBytes(
  path: string,
  diagnostic: Diagnostic,
  format: StageManifest["inputFormat"],
): Promise<Buffer> {
  if (!Number.isSafeInteger(diagnostic.byteOffset) || diagnostic.byteOffset < 0)
    throw Error("Invalid diagnostic byte offset");
  if (diagnostic.byteLength !== undefined) {
    if (
      !Number.isSafeInteger(diagnostic.byteLength) ||
      diagnostic.byteLength <= 0 ||
      diagnostic.byteLength > 16 * 1024 ** 2
    )
      throw Error("Invalid diagnostic byte length");
    const handle = await open(path, "r");
    try {
      const result = Buffer.alloc(diagnostic.byteLength);
      let read = 0;
      while (read < result.length) {
        const part = await handle.read(
          result,
          read,
          result.length - read,
          diagnostic.byteOffset + read,
        );
        if (!part.bytesRead) throw Error("Incomplete rejected source record");
        read += part.bytesRead;
      }
      return result;
    } finally {
      await handle.close();
    }
  }
  if (format !== "aleph-sequential")
    throw Error("Legacy ISO rejection has no byte length");
  const found = Error("record-framed");
  let result: Buffer | undefined;
  try {
    await pipeline(
      createReadStream(path, {
        start: diagnostic.byteOffset,
        end: diagnostic.byteOffset + 16 * 1024 ** 2 - 1,
      }),
      new AlephSequentialRecordSplitter({
        async process(bytes) {
          result = Buffer.from(bytes);
          throw found;
        },
      }),
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
    );
  } catch (error) {
    if (error !== found) throw error;
  }
  if (!result) throw Error("Cannot frame rejected source record");
  return result;
}

/** Выдаёт только отклонённые записи, связывая validation и outcome по исходному индексу.
 * DOC-PREVIEW:/docs/bib-staging.md#rejections
 */
async function* rejectionRows(
  input: string,
  manifest: StageManifest,
  log: StageReporter,
): AsyncGenerator<string> {
  const path = manifest.input!;
  const hashStarted = Date.now();
  await log("bib_rejection_source_sha_start", { source: path });
  const before = await stat(path);
  if ((await fileDigest(path)).sha256 !== manifest.archiveSha256)
    throw Error("Rejected source SHA mismatch");
  await log("bib_rejection_source_sha_finished", {
    source: path,
    elapsedMs: Date.now() - hashStarted,
  });
  const recoveryStarted = Date.now();
  const parser =
    manifest.inputFormat === "aleph-sequential"
      ? new AlephSequentialMarcParser()
      : new Iso2709MarcParser();
  const serializer = new MarcJsonSerializer(manifest.encoding);
  const stream = createReadStream(join(input, "diagnostics.ndjson"));
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let validation: Diagnostic | undefined;
  let recovered = 0;
  try {
    for await (const line of lines) {
      const diagnostic = JSON.parse(line) as Diagnostic;
      if (diagnostic.kind === "validation") {
        validation = diagnostic;
        continue;
      }
      if (
        ![
          "validation_rejected",
          "invalid_identity",
          "postgres_nul",
          "parse",
        ].includes(diagnostic.kind)
      )
        continue;
      const bytes = await rejectedBytes(path, diagnostic, manifest.inputFormat);
      let record: MarcJsonRecord;
      if (diagnostic.kind === "parse")
        record = {
          recordId: diagnostic.recordId,
          leader: "",
          format: "",
          fields: [],
        };
      else {
        const parsed = parser.parseForImport(bytes);
        if (!parsed) throw Error("Rejected record unexpectedly has DEL flag");
        record = serializer.serialize(parsed);
        if (diagnostic.recordId && record.recordId !== diagnostic.recordId)
          throw Error("Rejected record identity mismatch");
      }
      const reasons =
        validation?.recordIndex === diagnostic.recordIndex
          ? (validation.errors ?? []).map((error) => JSON.stringify(error))
          : [diagnostic.message ?? diagnostic.kind];
      yield stageRow(
        {
          ...record,
          source: {
            recordIndex: diagnostic.recordIndex,
            byteOffset: diagnostic.byteOffset,
            byteLength: bytes.length,
          },
        },
        diagnostic.kind,
        reasons,
      );
      recovered++;
    }
    if (recovered !== manifest.counts.rejected + manifest.counts.parsingErrors)
      throw Error("Rejected diagnostic count mismatch");
    const after = await stat(path);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ino !== after.ino
    )
      throw Error("Source changed during rejection recovery");
    await log("bib_rejection_recovery_finished", {
      source: path,
      records: recovered,
      elapsedMs: Date.now() - recoveryStarted,
    });
  } finally {
    lines.close();
    stream.destroy();
  }
}

/** Загружает один DAT из готовых пакетов; журнал и строки каждого пакета коммитятся вместе.
 * DOC-PREVIEW:/docs/bib-staging.md#stage
 */
async function stageSource(
  client: Client,
  input: string,
  log: StageReporter,
  dryRun: boolean,
) {
  const sourceStarted = Date.now();
  const manifest = (await readSourceManifest(input)) as StageManifest;
  const library = manifest.libraryCode ?? "RSL01";
  for (const key of [
    "processed",
    "deleted",
    "exported",
    "rejected",
    "parsingErrors",
  ] as const)
    if (!Number.isSafeInteger(manifest.counts[key]) || manifest.counts[key] < 0)
      throw Error("Incomplete source counts: " + key);
  if (
    manifest.counts.processed !==
    manifest.counts.deleted +
      manifest.counts.exported +
      manifest.counts.rejected +
      manifest.counts.parsingErrors
  )
    throw Error("Source outcome counts mismatch");
  const batches = [...manifest.batches];
  if (manifest.counts.rejected + manifest.counts.parsingErrors > 0)
    batches.push({
      file: "diagnostics.ndjson",
      sha256: (await fileDigest(join(input, "diagnostics.ndjson"))).sha256,
      records: manifest.counts.rejected + manifest.counts.parsingErrors,
    });
  await log("bib_source_start", {
    library,
    input,
    records: manifest.counts.exported,
    startedAt: new Date(sourceStarted).toISOString(),
  });
  for (const batch of batches) {
    const batchStarted = Date.now();
    await log("bib_batch_start", {
      library,
      file: batch.file,
      records: batch.records,
      startedAt: new Date(batchStarted).toISOString(),
    });
    const disk = await statfs(input);
    if (disk.bavail * disk.bsize < 2 * 1024 ** 3)
      throw Error("Less than reserved 2 GiB free for BZ staging");
    await client.query("BEGIN");
    try {
      await initializeBibRecords(client);
      await client.query(
        "INSERT INTO import.bib_sources(sha256,path) VALUES($1,$2) ON CONFLICT(sha256) DO NOTHING",
        [manifest.archiveSha256, manifest.input],
      );
      const saved = await client.query(
        "SELECT sha256 FROM import.bib_record_batches WHERE source_sha256=$1 AND file=$2",
        [manifest.archiveSha256, batch.file],
      );
      if (saved.rowCount) {
        if (saved.rows[0].sha256 !== batch.sha256)
          throw Error("Committed BZ batch SHA mismatch");
        await client.query("ROLLBACK");
        await log("bib_batch_skipped", {
          library,
          file: batch.file,
          elapsedMs: Date.now() - batchStarted,
        });
        continue;
      }
      await client.query(
        "CREATE TEMP TABLE bib_incoming(source_record_index bigint,system_number integer,leader text,format text,fields jsonb,byte_offset bigint PRIMARY KEY,byte_length bigint,rejection_code text,reasons_json jsonb) ON COMMIT DROP",
      );
      const hash = createHash("sha256");
      let count = 0;
      async function* rows() {
        let pending = "";
        if (batch.file === "diagnostics.ndjson") {
          for await (const row of rejectionRows(input, manifest, log)) {
            count++;
            pending += row;
            if (Buffer.byteLength(pending) >= 65536) {
              yield pending;
              pending = "";
            }
          }
        } else {
          for await (const line of sourceLines(join(input, batch.file), hash)) {
            count++;
            pending += stageRow(JSON.parse(line) as SourceRecord);
            if (Buffer.byteLength(pending) >= 65536) {
              yield pending;
              pending = "";
            }
          }
          if (hash.digest("hex") !== batch.sha256)
            throw Error("Prepared BZ batch SHA mismatch");
        }
        if (count !== batch.records)
          throw Error("Prepared BZ batch count mismatch");
        if (pending) yield pending;
      }
      const copyStarted = Date.now();
      const copy = client.query(
        copyFrom(
          String.raw`COPY bib_incoming FROM STDIN WITH (FORMAT csv, DELIMITER E'\t', NULL '\N')`,
        ),
      );
      const failCopy = (error: Error) => copy.destroy(error);
      client.on("error", failCopy);
      try {
        await pipeline(Readable.from(rows()), copy);
      } finally {
        client.off("error", failCopy);
      }
      if (
        batch.file === "diagnostics.ndjson" &&
        (await fileDigest(join(input, batch.file))).sha256 !== batch.sha256
      )
        throw Error("Diagnostic SHA changed during recovery");
      const copyMs = Date.now() - copyStarted;
      await log("bib_copy_finished", {
        library,
        file: batch.file,
        records: count,
        elapsedMs: copyMs,
      });
      const mergeStarted = Date.now();
      await client.query("ANALYZE bib_incoming");
      const result = await client.query(
        `WITH ranked AS (
        SELECT i.*,row_number() OVER(PARTITION BY system_number ORDER BY source_record_index) occurrence FROM bib_incoming i),
        classified AS (SELECT i.*,CASE WHEN i.rejection_code IS NOT NULL THEN i.rejection_code WHEN i.occurrence>1 OR EXISTS(SELECT 1 FROM import.bib_records b WHERE b.accepted AND b.library_code=$1 AND b.system_number=i.system_number) THEN 'duplicate_identity' ELSE NULL END code FROM ranked i),
        added AS (INSERT INTO import.bib_records(library_code,system_number,leader,format,fields,source_sha256,source_record_index,byte_offset,byte_length,accepted,rejection_code,rejection_reasons)
        SELECT $1,system_number,leader,format,fields,$2,source_record_index,byte_offset,byte_length,code IS NULL,code,
        CASE WHEN code='duplicate_identity' THEN ARRAY['Повтор библиотеки и системного номера; первое принятое вхождение сохранено'] ELSE ARRAY(SELECT jsonb_array_elements_text(reasons_json)) END FROM classified RETURNING accepted)
        SELECT count(*)::int records,count(*) FILTER(WHERE accepted)::int accepted,count(*) FILTER(WHERE NOT accepted)::int rejected FROM added`,
        [library, manifest.archiveSha256],
      );
      const counts = result.rows[0];
      if (counts.records !== batch.records)
        throw Error("Inserted BZ batch count mismatch");
      const mergeMs = Date.now() - mergeStarted;
      await log("bib_merge_finished", {
        library,
        file: batch.file,
        ...counts,
        elapsedMs: mergeMs,
      });
      const commitStarted = Date.now();
      await client.query(
        "INSERT INTO import.bib_record_batches(source_sha256,file,sha256,records,accepted,rejected) VALUES($1,$2,$3,$4,$5,$6)",
        [
          manifest.archiveSha256,
          batch.file,
          batch.sha256,
          counts.records,
          counts.accepted,
          counts.rejected,
        ],
      );
      await client.query(dryRun ? "ROLLBACK" : "COMMIT");
      const entry = {
        library,
        file: batch.file,
        ...counts,
        startedAt: new Date(batchStarted).toISOString(),
        finishedAt: new Date().toISOString(),
        elapsedMs: Date.now() - batchStarted,
        copyMs,
        mergeMs,
        commitMs: Date.now() - commitStarted,
        recordsPerSecond: Math.round(
          (counts.records * 1000) / Math.max(1, Date.now() - batchStarted),
        ),
      };
      await log(
        dryRun ? "bib_batch_rolled_back" : "bib_batch_committed",
        entry,
      );
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  }
  if (!dryRun) {
    await client.query("BEGIN");
    try {
      await initializeBibRecords(client);
      await client.query(
        "INSERT INTO import.bib_sources(sha256,path) VALUES($1,$2) ON CONFLICT(sha256) DO NOTHING",
        [manifest.archiveSha256, manifest.input],
      );
      const loaded = await client.query(
        "SELECT COALESCE(sum(records),0)::bigint n FROM import.bib_record_batches WHERE source_sha256=$1",
        [manifest.archiveSha256],
      );
      if (
        Number(loaded.rows[0].n) !==
        manifest.counts.exported +
          manifest.counts.rejected +
          manifest.counts.parsingErrors
      )
        throw Error("Incomplete BZ source load");
      await client.query(
        "INSERT INTO import.bib_record_runs(source_sha256,library_code,processed,deleted,exported,source_rejected,parsing_errors) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(source_sha256) DO NOTHING",
        [
          manifest.archiveSha256,
          library,
          manifest.counts.processed,
          manifest.counts.deleted,
          manifest.counts.exported,
          manifest.counts.rejected,
          manifest.counts.parsingErrors,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  }
  await log("bib_source_finished", {
    library,
    counts: manifest.counts,
    dryRun,
    startedAt: new Date(sourceStarted).toISOString(),
    finishedAt: new Date().toISOString(),
    elapsedMs: Date.now() - sourceStarted,
  });
}

/** Один worker последовательно исполняет каталог prepare либо JSON-план {sources:[каталоги]}.
 * Соединение и транзакция закрываются при любой ошибке; рестарт пропускает только committed-пакеты.
 * DOC-PREVIEW:/docs/bib-staging.md#stage
 */
export async function stageBibRecords(options: {
  input: string;
  report: string;
  dryRun?: boolean;
}) {
  const stageStarted = Date.now();
  const input = resolve(options.input);
  const sources = (await stat(input)).isDirectory()
    ? [input]
    : (JSON.parse(await readFile(input, "utf8")) as { sources: unknown })
        .sources;
  if (
    !Array.isArray(sources) ||
    !sources.length ||
    sources.some(
      (source) => typeof source !== "string" || !source.startsWith("/"),
    ) ||
    new Set(sources).size !== sources.length
  )
    throw Error("Invalid BZ staging plan");
  // Проверяем все manifest до первого изменения БД; содержимое пакета проверяется в транзакции COPY.
  for (const source of sources) await readSourceManifest(source);
  const report = await open(options.report, "wx", 0o600);
  // JSONL является постоянным журналом этапов; stdout дублирует его в лог worker.
  const log: StageReporter = async (event, details) => {
    const entry = { time: new Date().toISOString(), event, ...details };
    await report.writeFile(JSON.stringify(entry) + "\n");
    emitEvent(event, entry);
  };
  const client = databaseClient();
  const timer = setInterval(() => emitEvent("bib_stage_waiting"), 10000);
  timer.unref();
  let copyError: Error | undefined;
  client.on("error", (error) => {
    copyError = error;
  });
  try {
    await log("bib_stage_start", {
      input,
      sources: sources.length,
      startedAt: new Date(stageStarted).toISOString(),
    });
    await client.connect();
    await client.query(
      "SET lock_timeout='60s'; SET statement_timeout='30min'; SET client_connection_check_interval='5s'; SET max_parallel_workers_per_gather=0; SELECT pg_advisory_lock_shared(hashtext('import.pipeline')); SELECT pg_advisory_lock(hashtext('import.documents.loader'))",
    );
    for (const source of sources) {
      if (copyError) throw copyError;
      await stageSource(client, source, log, Boolean(options.dryRun));
    }
    await log("bib_stage_finished", {
      sources: sources.length,
      dryRun: Boolean(options.dryRun),
      startedAt: new Date(stageStarted).toISOString(),
      finishedAt: new Date().toISOString(),
      elapsedMs: Date.now() - stageStarted,
    });
  } catch (error) {
    await log("bib_stage_failed", {
      message: String(error),
      elapsedMs: Date.now() - stageStarted,
    }).catch(() => {});
    throw error;
  } finally {
    clearInterval(timer);
    await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
    await report.close();
  }
}
