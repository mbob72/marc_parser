import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { prepareDocuments } from "../src/documents/prepare.ts";
import { stageBibRecords } from "../src/documents/stage.ts";

const fixture = new URL("./fixtures/aleph-sequential-real.dat", import.meta.url)
  .pathname;

test(
  "PostgreSQL: самостоятельная загрузка БЗ, отказы, SHA, dry-run и продолжение",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const adminUrl = new URL(process.env.TEST_DATABASE_URL!);
    assert.match(adminUrl.pathname, /test/i);
    const admin = new Client({ connectionString: adminUrl.href });
    await admin.connect();
    const name = "bib_stage_test_" + process.pid;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(adminUrl);
    url.pathname = "/" + name;
    const client = new Client({ connectionString: url.href });
    await client.connect();
    const work = await mkdtemp(join(tmpdir(), "bib-stage-"));
    const envBefore = { ...process.env };
    Object.assign(process.env, {
      DB_TYPE: "postgres",
      DB_HOST: url.hostname,
      DB_PORT: url.port || "5432",
      DB_NAME: name,
      DB_USER: decodeURIComponent(url.username),
      DB_PASS: decodeURIComponent(url.password) || "test",
    });
    t.after(async () => {
      for (const key of Object.keys(process.env))
        if (key.startsWith("DB_")) delete process.env[key];
      Object.assign(process.env, envBefore);
      await client.end();
      await admin.query(`DROP DATABASE ${name}`);
      await admin.end();
      await rm(work, { recursive: true, force: true });
    });
    let sequence = 0;
    async function prepare(label: string, input = fixture) {
      const output = join(work, label);
      await prepareDocuments({
        input,
        output,
        libraryCode: "RSL01",
        encoding: "utf-8",
        format: "aleph-sequential",
        batchSize: 2,
        validationPolicy: "reject",
      });
      return output;
    }
    const stage = (input: string, dryRun = false) =>
      stageBibRecords({
        input,
        report: join(work, `report-${++sequence}.ndjson`),
        dryRun,
      });
    const reset = () => client.query("DROP SCHEMA IF EXISTS import CASCADE");
    const source = await prepare("prepared");

    await t.test("dry-run не создаёт таблицы и UUID", async () => {
      await stage(source, true);
      assert.equal(
        (await client.query("SELECT to_regclass('import.bib_records') t"))
          .rows[0].t,
        null,
      );
    });
    await t.test(
      "fields и все колонки documents есть, public и bib_ids не создаются; UUID сохраняются при повторе",
      async () => {
        await stage(source);
        const events = (
          await readFile(join(work, `report-${sequence}.ndjson`), "utf8")
        )
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        assert.equal(events[0].event, "bib_stage_start");
        assert.equal(events.at(-1).event, "bib_stage_finished");
        for (const event of events)
          assert.ok(Number.isFinite(Date.parse(event.time)));
        for (const event of events.filter((e) =>
          [
            "bib_stage_finished",
            "bib_source_finished",
            "bib_batch_committed",
          ].includes(e.event),
        )) {
          assert.ok(event.elapsedMs >= 0);
          assert.ok(
            Date.parse(event.finishedAt) >= Date.parse(event.startedAt),
          );
        }
        for (const event of events.filter(
          (e) => e.event === "bib_batch_committed",
        )) {
          assert.ok(
            event.copyMs >= 0 && event.mergeMs >= 0 && event.commitMs >= 0,
          );
          assert.ok(event.recordsPerSecond > 0);
        }
        const first = (
          await client.query(
            "SELECT * FROM import.bib_records ORDER BY source_record_index",
          )
        ).rows;
        assert.equal(first.length, 3);
        assert.ok(
          first.every(
            (r) =>
              r.accepted &&
              r.id &&
              Array.isArray(r.fields) &&
              r.fields.length > 0 &&
              r.byte_length > 0 &&
              r.meta === null &&
              r.updated_at === null &&
              r.hidden === false &&
              r.created_at instanceof Date,
          ),
        );
        const columns = (
          await client.query(
            "SELECT column_name FROM information_schema.columns WHERE table_schema='import' AND table_name='bib_records'",
          )
        ).rows.map((r) => r.column_name);
        for (const column of [
          "id",
          "library_code",
          "system_number",
          "leader",
          "format",
          "fields",
          "hidden",
          "meta",
          "created_at",
          "updated_at",
          "source_record_index",
          "byte_offset",
          "byte_length",
          "accepted",
          "rejection_code",
          "rejection_reasons",
        ])
          assert.ok(columns.includes(column), column);
        for (const column of [
          "raw",
          "payload",
          "normalized",
          "original_record",
        ])
          assert.ok(!columns.includes(column));
        assert.equal(
          (
            await client.query(
              "SELECT to_regclass('public.documents') d,to_regclass('import.bib_ids') ids",
            )
          ).rows[0].d,
          null,
        );
        assert.equal(
          (await client.query("SELECT to_regclass('import.bib_ids') ids"))
            .rows[0].ids,
          null,
        );
        await stage(source);
        assert.deepEqual(
          (
            await client.query(
              "SELECT * FROM import.bib_records ORDER BY source_record_index",
            )
          ).rows,
          first,
        );
        assert.equal(
          (
            await client.query(
              "SELECT count(*)::int n FROM import.bib_record_runs",
            )
          ).rows[0].n,
          1,
        );
      },
    );
    await t.test(
      "ошибка SHA откатывает текущий пакет; рестарт сохраняет UUID завершённого",
      async () => {
        await reset();
        const m = JSON.parse(
          await readFile(join(source, "manifest.json"), "utf8"),
        );
        const path = join(source, m.batches[1].file);
        const before = await readFile(path);
        // Валидный gzip с иным содержимым доходит до проверки потока, не ломая первый пакет.
        const { gzipSync, gunzipSync } = await import("node:zlib");
        await writeFile(
          path,
          gzipSync(
            gunzipSync(before).toString().replace("New-York", "New York"),
          ),
        );
        // Последний пакет может не содержать New-York: SHA manifest изменяем заведомо.
        const original = m.batches[1].sha256;
        m.batches[1].sha256 = "a".repeat(64);
        await writeFile(join(source, "manifest.json"), JSON.stringify(m));
        await assert.rejects(stage(source), /SHA mismatch/);
        const saved = (
          await client.query(
            "SELECT id FROM import.bib_records ORDER BY source_record_index",
          )
        ).rows;
        assert.equal(saved.length, 2);
        assert.equal(
          (
            await client.query(
              "SELECT count(*)::int n FROM import.bib_record_runs",
            )
          ).rows[0].n,
          0,
        );
        await writeFile(path, before);
        m.batches[1].sha256 = original;
        await writeFile(join(source, "manifest.json"), JSON.stringify(m));
        await stage(source);
        assert.deepEqual(
          (
            await client.query(
              "SELECT id FROM import.bib_records ORDER BY source_record_index LIMIT 2",
            )
          ).rows,
          saved,
        );
        assert.equal(
          (await client.query("SELECT count(*)::int n FROM import.bib_records"))
            .rows[0].n,
          3,
        );
      },
    );
    await t.test(
      "34-подобный отказ восстанавливается по старому offset без длины, причины и MARC остаются в БД",
      async () => {
        await reset();
        const altered = await readFile(fixture);
        const offset = altered.indexOf(Buffer.from("$$aNew-York"));
        assert.ok(offset >= 0);
        altered[offset + 2] = 0x1c;
        const input = join(work, "invalid.dat");
        await writeFile(input, altered);
        const source = await prepare("invalid", input);
        const diagnostics = join(source, "diagnostics.ndjson");
        await writeFile(
          diagnostics,
          (await readFile(diagnostics, "utf8"))
            .trim()
            .split("\n")
            .map((line) => {
              const d = JSON.parse(line);
              delete d.byteLength;
              return JSON.stringify(d);
            })
            .join("\n") + "\n",
        );
        await stage(source);
        const rows = (
          await client.query(
            "SELECT * FROM import.bib_records ORDER BY source_record_index",
          )
        ).rows;
        assert.equal(rows.length, 3);
        const rejected = rows.filter((r) => !r.accepted);
        assert.equal(rejected.length, 1);
        assert.equal(rejected[0].rejection_code, "validation_rejected");
        assert.ok(rejected[0].rejection_reasons.length > 0);
        assert.ok(rejected[0].fields.length > 0);
        assert.ok(rejected[0].byte_length > 0);
        assert.equal(
          (
            await client.query(
              "SELECT count(*)::int n FROM import.bib_records WHERE accepted",
            )
          ).rows[0].n,
          2,
        );
      },
    );
    await t.test(
      "повторные ключи внутри и между пакетами сохраняются с причиной отклонения",
      async () => {
        await reset();
        const input = join(work, "duplicate.dat");
        const bytes = await readFile(fixture);
        await writeFile(input, Buffer.concat([bytes, bytes]));
        const source = await prepare("duplicates", input);
        await stage(source);
        assert.deepEqual(
          (
            await client.query(
              "SELECT accepted,rejection_code,count(*)::int n FROM import.bib_records GROUP BY accepted,rejection_code ORDER BY accepted DESC",
            )
          ).rows,
          [
            { accepted: true, rejection_code: null, n: 3 },
            { accepted: false, rejection_code: "duplicate_identity", n: 3 },
          ],
        );
      },
    );
    await t.test(
      "пустые пакеты DEL-only отмечаются завершёнными без вымышленных БЗ",
      async () => {
        await reset();
        const emptyInput = join(work, "empty.dat");
        await writeFile(emptyInput, "");
        const source = await prepare("empty", emptyInput);
        const path = join(source, "manifest.json");
        const manifest = JSON.parse(await readFile(path, "utf8"));
        manifest.counts.processed = 10;
        manifest.counts.deleted = 10;
        await writeFile(path, JSON.stringify(manifest));
        const plan = join(work, "plan.json");
        await writeFile(plan, JSON.stringify({ sources: [source] }));
        await stage(plan);
        assert.equal(
          (await client.query("SELECT count(*)::int n FROM import.bib_records"))
            .rows[0].n,
          0,
        );
        assert.equal(
          (
            await client.query(
              "SELECT deleted::int FROM import.bib_record_runs",
            )
          ).rows[0].deleted,
          10,
        );
      },
    );
  },
);
