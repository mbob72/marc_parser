import { join } from "node:path";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { from as copyFrom } from "pg-copy-streams";
import { databaseClient } from "./database.js";
import { requireDocuments, requireIdentities } from "./schema.js";
import { readCopyManifest } from "./load-copy.js";
import { fileDigest, uncompressed } from "./copy-packages.js";

/**
 * Повторно сверяет каждый пакет с реальными documents и UUID, не доверяя одному журналу.
 * Возврат разрешает следующий этап; ошибка или конфликты дают ненулевой exit code CLI.
 * DOC-PREVIEW:/docs/documents-import.md#ready
 */
export async function verifyReady(input: string) {
  const manifest = await readCopyManifest(input);
  const client = databaseClient();
  client.on("error", () => {});
  try {
    await client.connect();
    await client.query(
      "BEGIN; SET LOCAL lock_timeout='60s'; LOCK TABLE import.bib_ids,public.documents IN SHARE MODE",
    );
    await requireDocuments(client);
    await requireIdentities(client);
    // Сравнение идёт пакетами: COPY удерживает только текущий gzip и временную SQL-таблицу.
    for (const batch of manifest.batches) {
      const journal = await client.query(
        "SELECT sha,report FROM import.bib_batches WHERE archive_sha=$1 AND file=$2",
        [manifest.archiveSha256, batch.sourceFile],
      );
      const saved = journal.rows[0];
      if (
        !saved ||
        saved.sha !== batch.sourceSha256 ||
        Number(saved.report.conflicts) !== 0 ||
        (saved.report.libraryCode ?? "RSL01") !==
          (manifest.libraryCode ?? "RSL01")
      )
        throw Error("Batch not ready: " + batch.file);
      const path = join(input, batch.file);
      const digest = await fileDigest(path);
      if (digest.sha256 !== batch.sha256 || digest.bytes !== batch.bytes)
        throw Error("Gzip verification failed: " + batch.file);
      await client.query(
        "CREATE TEMP TABLE document_ready(line bigint,system_number integer PRIMARY KEY,leader text,format text,fields jsonb,byte_offset bigint,byte_length bigint) ON COMMIT DROP",
      );
      const hash = createHash("sha256");
      let bytes = 0;
      async function* chunks() {
        for await (const chunk of uncompressed(path)) {
          hash.update(chunk);
          bytes += chunk.length;
          // pipeline передаёт эти байты COPY и возобновляет генератор по backpressure.
          yield chunk;
        }
      }
      await pipeline(
        Readable.from(chunks()),
        client.query(
          copyFrom(
            String.raw`COPY document_ready FROM STDIN WITH(FORMAT csv,DELIMITER E'\t',NULL '\N')`,
          ),
        ),
      );
      if (bytes !== batch.copyBytes || hash.digest("hex") !== batch.copySha256)
        throw Error("COPY hash mismatch");
      const result = await client.query(
        `SELECT count(*)::int records,count(*) FILTER(WHERE matches<>1 OR total<>1)::int mismatches FROM (
        SELECT i.system_number,count(d.id) total,count(d.id) FILTER(WHERE d.id=x.id AND ROW(d.leader,d.format,d.fields) IS NOT DISTINCT FROM ROW(i.leader,i.format,i.fields)) matches FROM document_ready i
        LEFT JOIN import.bib_ids x ON x.library_code=$1 AND x.system_number=i.system_number
        LEFT JOIN public.documents d ON upper(d.library_code)=$1 AND d.system_number=i.system_number
        GROUP BY i.system_number) checks`,
        [manifest.libraryCode ?? "RSL01"],
      );
      if (
        result.rows[0].records !== batch.records ||
        result.rows[0].mismatches !== 0
      )
        throw Error("Document/UUID/content mismatch: " + batch.file);
      await client.query("DROP TABLE document_ready");
    }
    await client.query("ROLLBACK");
    return {
      ready: true,
      records: manifest.records,
      batches: manifest.batches.length,
      libraryCode: manifest.libraryCode ?? "RSL01",
      archiveSha256: manifest.archiveSha256,
      checkedAt: new Date().toISOString(),
    };
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}
