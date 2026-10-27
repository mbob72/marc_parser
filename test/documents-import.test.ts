import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { prepareDocuments } from "../src/documents/prepare.ts";
import { prepareCopy, hasNul } from "../src/documents/copy-packages.ts";
import { loadCopy, readCopyManifest } from "../src/documents/load-copy.ts";
import { verifyReady } from "../src/documents/ready.ts";
import { requireDocuments } from "../src/documents/schema.ts";

const fixture = new URL("./fixtures/aleph-sequential-real.dat", import.meta.url)
  .pathname;
const defaults = {
  libraryCode: "RSL01",
  encoding: "utf-8",
  format: "aleph-sequential" as const,
  batchSize: 2,
  validationPolicy: "reject" as const,
};

test("подготовка реальных MARC сохраняет происхождение и SHA, COPY учитывает все пакеты", async (t) => {
  const work = await mkdtemp(join(tmpdir(), "marc-documents-"));
  t.after(() => rm(work, { recursive: true, force: true }));
  const source = join(work, "source");
  const result = await prepareDocuments({
    ...defaults,
    input: fixture,
    output: source,
  });
  assert.equal(result.counts.exported, 3);
  assert.equal(result.batches.length, 2);
  const lines = gunzipSync(
    await readFile(join(source, result.batches[0]!.file)),
  ).toString();
  const record = JSON.parse(lines.split("\n")[0]!);
  assert.equal(record.source.recordIndex, 0);
  assert.equal(record.source.byteOffset, 0);
  assert.equal(
    createHash("sha256").update(lines).digest("hex"),
    result.batches[0]!.sha256,
  );
  const copy = await prepareCopy(source, join(work, "copy"), undefined, 0);
  assert.equal(copy.records, 3);
  assert.equal(
    (await readCopyManifest(join(work, "copy"))).libraryCode,
    "RSL01",
  );
  await assert.rejects(
    prepareDocuments({ ...defaults, input: fixture, output: source }),
    /EEXIST/,
  );
});

test("выбор archive member читает только нужный Z00; повреждённые границы не дают manifest", async (t) => {
  const work = await mkdtemp(join(tmpdir(), "marc-documents-"));
  t.after(() => rm(work, { recursive: true, force: true }));
  const archive = join(work, "source.tar.gz");
  execFileSync("tar", [
    "-czf",
    archive,
    "-C",
    join(fixture, ".."),
    "aleph-sequential-real.dat",
  ]);
  await assert.rejects(
    prepareDocuments({
      ...defaults,
      input: archive,
      output: join(work, "ok"),
      member: "aleph-sequential-real.dat",
    }),
    /Extract the archive/,
  );
  const broken = join(work, "broken.dat");
  await writeFile(broken, "000000001\tbroken");
  await assert.rejects(
    prepareDocuments({
      ...defaults,
      input: broken,
      output: join(work, "failed"),
    }),
  );
  await assert.rejects(
    readFile(join(work, "failed", "manifest.json")),
    /ENOENT/,
  );
  assert.ok(
    JSON.parse(await readFile(join(work, "failed", "failed.json"), "utf8"))
      .message,
  );
});

test("политика validation reject/preserve явная; NUL не допускается даже в ключе JSON", async (t) => {
  const work = await mkdtemp(join(tmpdir(), "marc-documents-"));
  t.after(() => rm(work, { recursive: true, force: true }));
  const altered = await readFile(fixture);
  const offset = altered.indexOf(Buffer.from("$$aNew-York"));
  assert.ok(offset >= 0);
  altered[offset + 2] = 0x1c;
  const input = join(work, "invalid.dat");
  await writeFile(input, altered);
  const rejected = await prepareDocuments({
    ...defaults,
    input,
    output: join(work, "reject"),
  });
  const kept = await prepareDocuments({
    ...defaults,
    validationPolicy: "preserve",
    input,
    output: join(work, "preserve"),
  });
  assert.equal(rejected.counts.validationRecords, 1);
  assert.equal(rejected.counts.rejected, 1);
  assert.equal(rejected.counts.exported, 2);
  assert.equal(kept.counts.exported, 3);
  assert.equal(hasNul({ "bad\0key": "x" }), true);
  assert.equal(hasNul({ text: "\\u0000" }), false);
});

test(
  "PostgreSQL: UUID, rollback, повтор, продолжение, конфликт и проверка готовности",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    assert.match(url.pathname, /test/i, "Нужна отдельная тестовая БД");
    const client = new Client({ connectionString: url.href });
    await client.connect();

    const work = await mkdtemp(join(tmpdir(), "marc-documents-pg-"));
    t.after(() => rm(work, { recursive: true, force: true }));
    // databaseClient загрузчика использует тот же тестовый адрес, не пользовательскую .env.
    const envBefore = { ...process.env };
    Object.assign(process.env, {
      DB_TYPE: "postgres",
      DB_HOST: url.hostname,
      DB_PORT: url.port || "5432",
      DB_NAME: url.pathname.slice(1),
      DB_USER: decodeURIComponent(url.username),
      DB_PASS: decodeURIComponent(url.password) || "test",
    });
    t.after(() => {
      for (const key of Object.keys(process.env))
        if (key.startsWith("DB_")) delete process.env[key];
      Object.assign(process.env, envBefore);
    });
    const reset = async () => {
      await client.query(`DROP SCHEMA IF EXISTS import CASCADE; DROP TABLE IF EXISTS public.documents;
      CREATE TABLE public.documents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),library_code varchar(6),system_number serial NOT NULL,leader varchar(25) NOT NULL,format varchar(5) NOT NULL,fields jsonb NOT NULL,hidden boolean NOT NULL DEFAULT false,created_at timestamp NOT NULL DEFAULT current_timestamp)`);
    };
    await reset();
    t.after(async () => {
      await client.query(
        "DROP SCHEMA IF EXISTS import CASCADE; DROP TABLE IF EXISTS public.documents",
      );
      await client.end();
    });
    await prepareDocuments({
      ...defaults,
      input: fixture,
      output: join(work, "source"),
    });
    await prepareCopy(join(work, "source"), join(work, "copy"), undefined, 0);
    const input = join(work, "copy");
    const load = (
      name: string,
      options: Partial<Parameters<typeof loadCopy>[0]> = {},
    ) => loadCopy({ input, report: join(work, name + ".ndjson"), ...options });
    await t.test(
      "dry-run не оставляет документов, UUID и журнала",
      async () => {
        await load("dry", { dryRun: true });
        assert.equal(
          (await client.query("SELECT count(*)::int n FROM public.documents"))
            .rows[0].n,
          0,
        );
        assert.equal(
          (await client.query("SELECT to_regclass('import.bib_ids') name"))
            .rows[0].name,
          null,
        );
      },
    );
    await t.test(
      "готовый UUID справочника сохраняется, limited возобновляется",
      async () => {
        await client.query(
          "CREATE SCHEMA import; CREATE TABLE import.bib_ids(library_code text NOT NULL,system_number bigint NOT NULL,id uuid NOT NULL,PRIMARY KEY(library_code,system_number),UNIQUE(id)); INSERT INTO import.bib_ids VALUES('RSL01',1,'11111111-1111-4111-8111-111111111111')",
        );
        await load("partial", { maxBatches: 1 });
        await assert.rejects(verifyReady(input), /Batch not ready/);
        await load("continue");
        assert.equal(
          (
            await client.query(
              "SELECT id FROM public.documents WHERE system_number=1",
            )
          ).rows[0].id,
          "11111111-1111-4111-8111-111111111111",
        );
        assert.equal((await verifyReady(input)).records, 3);
        const ids = (
          await client.query("SELECT id FROM public.documents ORDER BY id")
        ).rows;
        await load("repeat");
        assert.deepEqual(
          (await client.query("SELECT id FROM public.documents ORDER BY id"))
            .rows,
          ids,
        );
      },
    );
    await t.test(
      "ready выявляет изменение документов после COMMIT",
      async () => {
        await client.query(
          "UPDATE public.documents SET format='MX' WHERE system_number=1",
        );
        await assert.rejects(verifyReady(input), /mismatch/);
        await client.query(
          "UPDATE public.documents SET format='BK' WHERE system_number=1",
        );
      },
    );
    await t.test("неверный SHA откатывает пакет и журнал", async () => {
      await reset();
      const manifestPath = join(input, "manifest.json");
      const original = await readFile(manifestPath, "utf8");
      const manifest = JSON.parse(original);
      manifest.batches[0].copySha256 = "0".repeat(64);
      await writeFile(manifestPath, JSON.stringify(manifest));
      await assert.rejects(load("bad-sha"), /verification failed/);
      assert.equal(
        (await client.query("SELECT count(*)::int n FROM public.documents"))
          .rows[0].n,
        0,
      );
      assert.equal(
        (await client.query("SELECT to_regclass('import.bib_batches') name"))
          .rows[0].name,
        null,
      );
      await writeFile(manifestPath, original);
    });
    await t.test(
      "конфликт фиксируется, UUID и исходный документ не меняются, повтор также отказывает",
      async () => {
        await client.query(
          "INSERT INTO public.documents(library_code,system_number,leader,format,fields) VALUES('RSL01',1,'conflicting leader','BK','[]')",
        );
        const existing = (
          await client.query(
            "SELECT id,leader FROM public.documents WHERE system_number=1",
          )
        ).rows[0];
        await assert.rejects(load("conflict"), /conflicts/);
        assert.deepEqual(
          (
            await client.query(
              "SELECT id,leader FROM public.documents WHERE system_number=1",
            )
          ).rows[0],
          existing,
        );
        assert.equal(
          (
            await client.query(
              "SELECT count(*)::int n FROM import.bib_errors WHERE code='existing_conflict'",
            )
          ).rows[0].n,
          1,
        );
        await assert.rejects(load("conflict-repeat"), /conflicts/);
        await assert.rejects(verifyReady(input), /Batch not ready/);
      },
    );
    await t.test("несовместимая схема отклоняется до загрузки", async () => {
      await client.query(
        "ALTER TABLE public.documents ADD COLUMN required_extra text NOT NULL DEFAULT 'x'; ALTER TABLE public.documents ALTER COLUMN required_extra DROP DEFAULT",
      );
      await assert.rejects(requireDocuments(client), /Missing default/);
    });
    await t.test("неоднозначный номер останавливает merge", async () => {
      await reset();
      await client.query(
        "INSERT INTO public.documents(library_code,system_number,leader,format,fields) VALUES('RSL01',1,'a','BK','[]'),('rsl01',1,'b','BK','[]')",
      );
      await assert.rejects(load("ambiguous"), /Ambiguous documents/);
      assert.equal(
        (await client.query("SELECT count(*)::int n FROM public.documents"))
          .rows[0].n,
        2,
      );
    });
    await t.test(
      "разные UUID документа и справочника не исправляются автоматически",
      async () => {
        await reset();
        await client.query(
          "INSERT INTO public.documents(id,library_code,system_number,leader,format,fields) VALUES('11111111-1111-4111-8111-111111111111','RSL01',1,'a','BK','[]'); CREATE SCHEMA import; CREATE TABLE import.bib_ids(library_code text NOT NULL,system_number bigint NOT NULL,id uuid NOT NULL,PRIMARY KEY(library_code,system_number),UNIQUE(id)); INSERT INTO import.bib_ids VALUES('RSL01',1,'22222222-2222-4222-8222-222222222222')",
        );
        await assert.rejects(load("uuid-mismatch"), /Existing UUID mismatch/);
        assert.equal(
          (await client.query("SELECT id FROM public.documents")).rows[0].id,
          "11111111-1111-4111-8111-111111111111",
        );
      },
    );
  },
);
