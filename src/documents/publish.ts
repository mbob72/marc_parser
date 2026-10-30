import type { Client } from "pg";
import { randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { databaseClient } from "./database.js";
import {
  documentColumns,
  ensurePublicationJournal,
  ensurePublicationTarget,
  quotePublicationSchema,
} from "./publish-schema.js";
import {
  createPublicationResourceGate,
  type PublicationResourceSample,
} from "./publish-resources.js";

export type PublicationOptions = {
  targetSchema?: string;
  image: string;
  batchSize?: number;
  resumePublication?: string;
  report: string;
  signal?: AbortSignal;
  progress?: (event: Record<string, unknown>) => void;
  sampleResources?: () => Promise<PublicationResourceSample>;
  createClient?: () => Client;
};

/** Единый допуск CLI и управляющего сокета до файлов, DDL и подключения.
 * При resume отсутствие batchSize/targetSchema означает наследование checkpoint.
 * DOC-PREVIEW:/docs/bib-publication.md#commands */
export function validatePublicationOptions(o: PublicationOptions): void {
  if (!o || typeof o !== "object") throw Error("Publication options required");
  if (typeof o.image !== "string" || !o.image.trim() || o.image === "unknown")
    throw Error("Pinned publication image required");
  if (typeof o.report !== "string" || !o.report.trim())
    throw Error("Publication report path required");
  if (
    o.resumePublication !== undefined &&
    (typeof o.resumePublication !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        o.resumePublication,
      ))
  )
    throw Error("Publication session UUID required");
  if (o.targetSchema !== undefined) {
    if (typeof o.targetSchema !== "string")
      throw Error("Isolated publication schema required");
    quotePublicationSchema(o.targetSchema);
  } else if (!o.resumePublication)
    throw Error("Publication target schema required");
  if (
    o.batchSize !== undefined &&
    (!Number.isSafeInteger(o.batchSize) ||
      o.batchSize < 1 ||
      o.batchSize > 100000)
  )
    throw Error("Publication batchSize must be an integer from 1 to 100000");
  o.signal?.throwIfAborted();
}

type Cursor = { library: string; number: number };
type Counts = Record<string, string>;
type SourceManifest = {
  runs: Record<string, unknown>[];
  batches: Record<string, unknown>[];
  actual: Record<string, unknown>[];
  byLibrary: Counts;
  accepted: string;
};
type Session = {
  id: string;
  target_schema: string;
  image: string;
  batch_size: number;
  status: "loading" | "verifying" | "completed" | "failed";
  source_manifest: SourceManifest;
  target_manifest: unknown;
  cursor_library: string;
  cursor_number: number;
  verify_library: string;
  verify_number: number;
  counters: { loaded?: string; batches?: number };
  verification: {
    verified?: string;
    batches?: number;
    completed?: boolean;
    byLibrary?: Counts;
  };
  started_at: Date;
  finished_at: Date | null;
};
const canonical = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sha = /^[0-9a-f]{64}$/i;
const integer = (v: unknown) => typeof v === "string" && /^\d+$/.test(v);

/** Читает только метаданные завершённых исходников и SQL-счётчики; MARC/JSON
 * остаются в PostgreSQL. Включает пустые итоги RSL02/RSL60 без создания БЗ.
 * DOC-PREVIEW:/docs/bib-publication.md#source */
async function sourceManifest(client: Client): Promise<SourceManifest> {
  const runs = (
    await client.query(`SELECT r.source_sha256,r.library_code,r.processed::text,
    r.deleted::text,r.exported::text,r.source_rejected::text,r.parsing_errors::text,
    r.completed_at,s.path FROM import.bib_record_runs r
    JOIN import.bib_sources s ON s.sha256=r.source_sha256 ORDER BY r.source_sha256`)
  ).rows;
  if (!runs.length) throw Error("Completed BZ source runs required");
  const batches = (
    await client.query(`SELECT source_sha256,file,sha256,records::text,
    accepted::text,rejected::text,completed_at FROM import.bib_record_batches
    ORDER BY source_sha256,file`)
  ).rows;
  const actual = (
    await client.query(`SELECT b.source_sha256,b.library_code,
    count(*)::text records,count(*) FILTER(WHERE b.accepted)::text accepted,
    count(*) FILTER(WHERE NOT b.accepted)::text rejected
    FROM import.bib_records b GROUP BY b.source_sha256,b.library_code
    ORDER BY b.source_sha256,b.library_code`)
  ).rows;
  const runBySha = new Map(runs.map((r) => [r.source_sha256, r]));
  const sums = new Map<
    string,
    { records: bigint; accepted: bigint; rejected: bigint }
  >();
  for (const r of runs) {
    if (
      !sha.test(r.source_sha256) ||
      !r.completed_at ||
      typeof r.path !== "string" ||
      !r.path ||
      !/^[A-Z0-9]{1,6}$/.test(r.library_code) ||
      [
        r.processed,
        r.deleted,
        r.exported,
        r.source_rejected,
        r.parsing_errors,
      ].some((v) => !integer(v))
    )
      throw Error("Invalid completed BZ source metadata");
    sums.set(r.source_sha256, { records: 0n, accepted: 0n, rejected: 0n });
  }
  for (const b of batches) {
    const sum = sums.get(b.source_sha256);
    if (
      !sum ||
      !sha.test(b.sha256) ||
      typeof b.file !== "string" ||
      !b.file ||
      !b.completed_at ||
      [b.records, b.accepted, b.rejected].some((v) => !integer(v)) ||
      BigInt(b.records) !== BigInt(b.accepted) + BigInt(b.rejected)
    )
      throw Error("Incomplete or invalid BZ batch metadata");
    sum.records += BigInt(b.records);
    sum.accepted += BigInt(b.accepted);
    sum.rejected += BigInt(b.rejected);
  }
  const actualBySha = new Map(actual.map((a) => [a.source_sha256, a]));
  for (const a of actual) {
    const r = runBySha.get(a.source_sha256);
    if (
      !r ||
      r.library_code !== a.library_code ||
      actual.filter((v) => v.source_sha256 === a.source_sha256).length !== 1
    )
      throw Error("BZ rows without matching completed source run");
  }
  const byLibrary: Counts = {};
  let accepted = 0n;
  for (const r of runs) {
    const sum = sums.get(r.source_sha256)!;
    const a = actualBySha.get(r.source_sha256);
    if (
      sum.records !==
        BigInt(r.exported) +
          BigInt(r.source_rejected) +
          BigInt(r.parsing_errors) ||
      sum.records !== BigInt(a?.records ?? "0") ||
      sum.accepted !== BigInt(a?.accepted ?? "0") ||
      sum.rejected !== BigInt(a?.rejected ?? "0")
    )
      throw Error(
        "BZ source/batch/actual SQL counts differ: " + r.library_code,
      );
    accepted += sum.accepted;
    byLibrary[r.library_code] = (
      BigInt(byLibrary[r.library_code] ?? "0") + sum.accepted
    ).toString();
  }
  return canonical({
    runs,
    batches,
    actual,
    byLibrary,
    accepted: accepted.toString(),
  });
}

/** Переносит принятые БЗ напрямую из import, сохраняя десять полей documents.
 * Один keyset-пакет, его полная SQL-сверка и checkpoint имеют общий COMMIT.
 * Источники считаются неизменяемыми под общим import.pipeline lock; resume
 * продолжает сохранённую проверку, completed возвращает прежний результат.
 * DOC-PREVIEW:/docs/bib-publication.md#algorithm */
export async function publishBibliographicRecords(
  o: PublicationOptions,
): Promise<Record<string, unknown>> {
  validatePublicationOptions(o);
  const started = Date.now();
  const report = await open(o.report, "wx", 0o600);
  let writes = Promise.resolve();
  let writeError: unknown;
  const controller = new AbortController();
  const log = (event: string, fields: Record<string, unknown> = {}) => {
    const entry = { event, time: new Date().toISOString(), ...fields };
    try {
      o.progress?.(entry);
    } catch (error) {
      controller.abort(error);
      return Promise.reject(error);
    }
    writes = writes.then(async () => {
      await report.write(JSON.stringify(entry) + "\n");
      await report.sync();
    });
    writes.catch((error: unknown) => {
      writeError ??= error;
      controller.abort(error);
    });
    return writes;
  };
  const externalAbort = () => controller.abort(o.signal?.reason);
  o.signal?.addEventListener("abort", externalAbort, { once: true });
  if (o.signal?.aborted) externalAbort();
  let client: Client | undefined, session: Session | undefined;
  let connectionClosed = false;
  let loggingResources = false;
  const initialResourceEvents: Record<string, unknown>[] = [];
  const gate = createPublicationResourceGate({
    signal: controller.signal,
    sample: o.sampleResources,
    workDir: dirname(resolve(o.report)),
    progress: (e) => {
      if (loggingResources) void log(String(e.event), e).catch(() => {});
      else initialResourceEvents.push(e);
    },
  });
  const abortConnection = () => {
    connectionClosed = true;
    void client?.end().catch(() => {});
  };
  gate.signal.addEventListener("abort", abortConnection, { once: true });
  const ready = async () => {
    await gate.ready();
    gate.signal.throwIfAborted();
    if (writeError) throw writeError;
  };
  const result = () => ({
    publicationId: session!.id,
    targetSchema: session!.target_schema,
    image: session!.image,
    batchSize: session!.batch_size,
    status: session!.status,
    counters: session!.counters,
    verification: session!.verification,
    accepted: session!.source_manifest.accepted,
    byLibrary: session!.source_manifest.byLibrary,
    startedAt: session!.started_at,
    finishedAt: session!.finished_at,
    elapsedMs: session!.finished_at
      ? session!.finished_at.getTime() - session!.started_at.getTime()
      : Date.now() - session!.started_at.getTime(),
    attemptElapsedMs: Date.now() - started,
  });
  try {
    await log("publication_start", {
      image: o.image,
      targetSchema: o.targetSchema,
      resumePublication: o.resumePublication,
      batchSize: o.batchSize,
    });
    loggingResources = true;
    for (const event of initialResourceEvents)
      await log(String(event.event), event);
    initialResourceEvents.length = 0;
    await ready();
    client = (o.createClient ?? databaseClient)();
    client.on("error", (error) => controller.abort(error));
    await client.connect();
    await client.query(`SET application_name='marc-bib-publication'; SET lock_timeout='5s';
      SET statement_timeout='15min'; SET client_connection_check_interval='1s';
      SET work_mem='32MB'; SET hash_mem_multiplier=2; SET max_parallel_workers_per_gather=0;
      SET temp_buffers='8MB'; SET TIME ZONE 'UTC'`);
    if (
      !(
        await client.query(
          "SELECT pg_try_advisory_lock(hashtext('import.pipeline')) locked",
        )
      ).rows[0].locked
    )
      throw Error("Another import.pipeline operation is active");
    await ready();
    const source = await sourceManifest(client);
    await ensurePublicationJournal(client);
    if (o.resumePublication) {
      session = (
        await client.query(
          "SELECT * FROM import.bib_publications WHERE id=$1",
          [o.resumePublication],
        )
      ).rows[0];
      if (!session) throw Error("Publication session not found");
      if (
        session.image !== o.image ||
        (o.batchSize !== undefined && session.batch_size !== o.batchSize) ||
        (o.targetSchema !== undefined &&
          session.target_schema !== o.targetSchema)
      )
        throw Error(
          "Publication image, schema or batch size changed on resume",
        );
      if (!isDeepStrictEqual(source, session.source_manifest))
        throw Error("Publication source manifest changed");
    }
    const schema = session?.target_schema ?? o.targetSchema!;
    const target = await ensurePublicationTarget(client, schema);
    if (session) {
      if (
        !isDeepStrictEqual(canonical(target.manifest), session.target_manifest)
      )
        throw Error("Publication target schema manifest changed");
      if (session.status === "completed") {
        await log("publication_finished", {
          ...result(),
          resumedCompleted: true,
        });
        return result();
      }
    } else {
      const quoted = quotePublicationSchema(schema);
      if (
        (
          await client.query(
            "SELECT 1 FROM import.bib_publications WHERE target_schema=$1",
            [schema],
          )
        ).rowCount
      )
        throw Error("Existing publication requires resumePublication");
      if (
        (await client.query(`SELECT 1 FROM ${quoted}.documents LIMIT 1`))
          .rowCount
      )
        throw Error("Initial publication target must be empty");
      session = (
        await client.query(
          `INSERT INTO import.bib_publications
        (id,target_schema,image,batch_size,status,source_manifest,target_manifest,counters,verification,started_at)
        VALUES($1,$2,$3,$4,'loading',$5,$6,$7,$8,$9) RETURNING *`,
          [
            randomUUID(),
            schema,
            o.image,
            o.batchSize ?? 100000,
            source,
            canonical(target.manifest),
            { loaded: "0", batches: 0 },
            { verified: "0", batches: 0 },
            new Date(started),
          ],
        )
      ).rows[0];
    }
    const quoted = quotePublicationSchema(schema);
    const columns = documentColumns.map((c) => `"${c}"`).join(",");
    const row = (alias: string) =>
      `ROW(${documentColumns.map((c) => `${alias}."${c}"`).join(",")})`;
    await log("publication_source_ready", {
      publicationId: session!.id,
      accepted: source.accepted,
      byLibrary: source.byLibrary,
      sourceRuns: source.runs.length,
      sourceBatches: source.batches.length,
      elapsedMs: Date.now() - started,
    });
    // Сначала читаем только ограниченную страницу индексных ключей. Тела MARC
    // INSERT и сверка читают непосредственно из источника в этих границах:
    // ни временных JSONB-копий, ни UUID-массивов между Node и PostgreSQL нет.
    const batch = async (phase: "loading" | "verifying"): Promise<boolean> => {
      await ready();
      const begin = Date.now();
      const cursor: Cursor =
        phase === "loading"
          ? { library: session!.cursor_library, number: session!.cursor_number }
          : {
              library: session!.verify_library,
              number: session!.verify_number,
            };
      await client!.query("BEGIN");
      try {
        await client!.query("SET CONSTRAINTS ALL IMMEDIATE");
        const page = (
          await client!.query(
            `WITH keys AS MATERIALIZED (
          SELECT s.library_code,s.system_number FROM import.bib_records s WHERE s.accepted AND
          (s.library_code,s.system_number)>($1::varchar,$2::integer)
          ORDER BY s.library_code,s.system_number LIMIT $3)
          SELECT count(*)::text rows,
          (SELECT p.library_code FROM keys p ORDER BY p.library_code DESC,p.system_number DESC LIMIT 1) library,
          (SELECT p.system_number FROM keys p ORDER BY p.library_code DESC,p.system_number DESC LIMIT 1) number
          FROM keys`,
            [cursor.library, cursor.number, session!.batch_size],
          )
        ).rows[0];
        if (page.rows === "0") {
          await client!.query("ROLLBACK");
          return false;
        }
        const pageMs = Date.now() - begin;
        await log("publication_batch_started", {
          publicationId: session!.id,
          phase,
          cursor,
          rows: page.rows,
        });
        await ready();
        const insertBegin = Date.now();
        const bounds = [
          cursor.library,
          cursor.number,
          page.library,
          page.number,
        ];
        const range = `(s.library_code,s.system_number)>($1::varchar,$2::integer)
          AND (s.library_code,s.system_number)<=($3::varchar,$4::integer)`;
        if (phase === "loading") {
          const inserted = await client!.query(
            `INSERT INTO ${quoted}.documents(${columns})
            SELECT ${documentColumns.map((c) => `s."${c}"`).join(",")} FROM import.bib_records s
            WHERE s.accepted AND ${range} ORDER BY s.library_code,s.system_number`,
            bounds,
          );
          if (BigInt(inserted.rowCount ?? 0) !== BigInt(page.rows))
            throw Error("Publication INSERT count mismatch");
        }
        const insertMs = Date.now() - insertBegin;
        await ready();
        const verifyBegin = Date.now();
        const check = (
          await client!.query(
            `SELECT count(*)::text rows,
          count(*) FILTER(WHERE d.id IS NULL OR ${row("s")} IS DISTINCT FROM ${row("d")})::text invalid
          FROM import.bib_records s LEFT JOIN LATERAL
            (SELECT ${columns} FROM ${quoted}.documents t WHERE t.id=s.id LIMIT 1) d ON true
          WHERE s.accepted AND ${range}`,
            bounds,
          )
        ).rows[0];
        if (check.rows !== page.rows || check.invalid !== "0")
          throw Error("Publication full-field verification failed");
        const verifyMs = Date.now() - verifyBegin;
        const n =
          (phase === "loading"
            ? session!.counters.batches
            : session!.verification.batches) ?? 0;
        const counters = { ...session!.counters },
          verification = { ...session!.verification };
        if (phase === "loading") {
          counters.loaded = (
            BigInt(counters.loaded ?? "0") + BigInt(page.rows)
          ).toString();
          counters.batches = n + 1;
        } else {
          verification.verified = (
            BigInt(verification.verified ?? "0") + BigInt(page.rows)
          ).toString();
          verification.batches = n + 1;
        }
        const checkpointBegin = Date.now();
        await client!.query(
          `INSERT INTO import.bib_publication_batches
          (publication_id,phase,batch_no,cursor_library,cursor_number,rows,elapsed_ms) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            session!.id,
            phase,
            n + 1,
            page.library,
            page.number,
            page.rows,
            Date.now() - begin,
          ],
        );
        await client!.query(
          phase === "loading"
            ? `UPDATE import.bib_publications SET status='loading',cursor_library=$2,cursor_number=$3,counters=$4,error=NULL WHERE id=$1`
            : `UPDATE import.bib_publications SET status='verifying',verify_library=$2,verify_number=$3,verification=$4,error=NULL WHERE id=$1`,
          [
            session!.id,
            page.library,
            page.number,
            phase === "loading" ? counters : verification,
          ],
        );
        const checkpointMs = Date.now() - checkpointBegin;
        await ready();
        const commitBegin = Date.now();
        await client!.query("COMMIT");
        const commitMs = Date.now() - commitBegin;
        session!.counters = counters;
        session!.verification = verification;
        session!.status = phase;
        if (phase === "loading") {
          session!.cursor_library = page.library;
          session!.cursor_number = page.number;
        } else {
          session!.verify_library = page.library;
          session!.verify_number = page.number;
        }
        await log("publication_batch_committed", {
          publicationId: session!.id,
          phase,
          batch: n + 1,
          rows: page.rows,
          cursorLibrary: page.library,
          cursorNumber: page.number,
          pageMs,
          insertMs,
          verifyMs,
          checkpointMs,
          commitMs,
          elapsedMs: Date.now() - begin,
          loaded: counters.loaded,
          verified: verification.verified,
        });
        return true;
      } catch (error) {
        await client!.query("ROLLBACK").catch(() => {});
        throw error;
      }
    };
    // Сбой сохраняет phase в checkpoint/counters; повторная загрузка записанных
    // пакетов не выполняется. Ручные конкурентные изменения данных не поддержаны.
    while (await batch("loading")) {
      /* committed keyset */
    }
    if (session!.counters.loaded !== source.accepted)
      throw Error("Publication loaded/source count mismatch");
    await client.query(
      "UPDATE import.bib_publications SET status='verifying',error=NULL WHERE id=$1",
      [session!.id],
    );
    session!.status = "verifying";
    await log("publication_verification_start", {
      publicationId: session!.id,
      loaded: session!.counters.loaded,
    });
    while (await batch("verifying")) {
      /* committed verification keyset */
    }
    await ready();
    const finalBegin = Date.now();
    const finalSource = await sourceManifest(client);
    if (!isDeepStrictEqual(source, finalSource))
      throw Error("Publication source changed during load");
    await client.query("BEGIN");
    try {
      const totals = (
        await client.query(`SELECT d.library_code,count(*)::text rows,max(d.system_number)::text maximum
        FROM ${quoted}.documents d GROUP BY d.library_code ORDER BY d.library_code`)
      ).rows;
      const actual: Counts = Object.fromEntries(
        totals.map((r) => [r.library_code, r.rows]),
      );
      const expected = Object.fromEntries(
        Object.entries(source.byLibrary).filter(([, n]) => n !== "0"),
      );
      if (
        !isDeepStrictEqual(actual, expected) ||
        session!.verification.verified !== source.accepted
      )
        throw Error("Publication final per-library coverage mismatch");
      let maximum = 0n;
      for (const r of totals)
        if (BigInt(r.maximum) > maximum) maximum = BigInt(r.maximum);
      if (maximum >= 2147483647n)
        throw Error("Publication number sequence exhausted");
      const sequence = (
        await client.query(
          "SELECT pg_get_serial_sequence($1,'system_number') name",
          [`${quoted}.documents`],
        )
      ).rows[0].name;
      await client.query("SELECT setval($1::regclass,$2::bigint,$3)", [
        sequence,
        maximum === 0n ? "1" : maximum.toString(),
        maximum > 0n,
      ]);
      const verification = {
        ...session!.verification,
        completed: true,
        byLibrary: source.byLibrary,
      };
      const finished = (
        await client.query(
          `UPDATE import.bib_publications SET status='completed',verification=$2,
        error=NULL,finished_at=clock_timestamp() WHERE id=$1 RETURNING *`,
          [session!.id, verification],
        )
      ).rows[0];
      await ready();
      await client.query("COMMIT");
      session = finished;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
    await log("publication_finished", {
      ...result(),
      finalVerificationMs: Date.now() - finalBegin,
    });
    return result();
  } catch (error) {
    const failure = gate.signal.aborted ? (gate.signal.reason ?? error) : error;
    await client?.query("ROLLBACK").catch(() => {});
    if (session && !connectionClosed && session.status !== "completed")
      await client
        ?.query(
          "UPDATE import.bib_publications SET status='failed',error=$2 WHERE id=$1",
          [session.id, String(failure)],
        )
        .catch(() => {});
    await log("publication_failed", {
      publicationId: session?.id,
      error: String(failure),
      elapsedMs: Date.now() - started,
      cursorLibrary: session?.cursor_library,
      cursorNumber: session?.cursor_number,
    }).catch(() => {});
    throw failure;
  } finally {
    await gate.close();
    gate.signal.removeEventListener("abort", abortConnection);
    o.signal?.removeEventListener("abort", externalAbort);
    await client?.end().catch(() => {});
    await writes.catch(() => {});
    await report.close();
  }
}
