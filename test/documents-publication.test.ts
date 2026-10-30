import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { initializeBibRecords } from "../src/documents/stage.ts";
import {
  publishBibliographicRecords,
  validatePublicationOptions,
} from "../src/documents/publish.ts";

const resources = async () => ({
  memoryAvailableBytes: 6n * 1024n ** 3n,
  diskAvailableBytes: 500n * 1024n ** 3n,
});
const uid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;

async function fixture(t: TestContext) {
  const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.connect();
  const name = `bib_pub_test_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = "/" + name;
  const client = new Client({ connectionString: url.href });
  await client.connect();
  const work = await mkdtemp(join(tmpdir(), "bib-publication-"));
  t.after(async () => {
    await client.end();
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
    await rm(work, { recursive: true, force: true });
  });
  await initializeBibRecords(client);
  const shas = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
  const libraries = ["RSL01", "RSL03", "RSL60"];
  for (const [i, sha] of shas.entries()) {
    await client.query("INSERT INTO import.bib_sources VALUES($1,$2)", [
      sha,
      `/source/rsl${i}.dat`,
    ]);
    await client.query(
      `INSERT INTO import.bib_record_runs
      (source_sha256,library_code,processed,deleted,exported,source_rejected,parsing_errors)
      VALUES($1,$2,$3,$4,$5,$6,0)`,
      [
        sha,
        libraries[i],
        i === 0 ? 7 : i === 1 ? 2 : 3,
        i === 0 ? 2 : i === 1 ? 0 : 3,
        i === 0 ? 4 : i === 1 ? 2 : 0,
        i === 0 ? 1 : 0,
      ],
    );
    if (i !== 2)
      await client.query(
        `INSERT INTO import.bib_record_batches
      (source_sha256,file,sha256,records,accepted,rejected) VALUES($1,'batch1',$2,$3,$4,$5)`,
        [
          sha,
          "d".repeat(64),
          i === 0 ? 5 : 2,
          i === 0 ? 4 : 2,
          i === 0 ? 1 : 0,
        ],
      );
  }
  for (const [i, value] of [9, 10, 11, 12, 9, 10].entries()) {
    await client.query(
      `INSERT INTO import.bib_records
      (id,library_code,system_number,leader,format,fields,hidden,meta,created_at,updated_at,
       source_sha256,source_record_index,byte_offset,byte_length,accepted)
      VALUES($1,$2,$3,$4,'BK',$5,$6,$7,'2026-10-28 10:30:12.123456',
        CASE WHEN $6 THEN timestamp '2026-10-29 11:20:10.987654' ELSE NULL END,$8,$9,$10,50,true)`,
      [
        uid(i + 1),
        i < 4 ? "RSL01" : "RSL03",
        value,
        "00000nam a2200000 i 4500",
        JSON.stringify([
          { tag: "245", subfields: [{ code: "a", value: `Книга ${i}` }] },
        ]),
        i === 1,
        i === 1
          ? JSON.stringify({ migration: "preserve", nested: [null, 0, true] })
          : null,
        i < 4 ? shas[0] : shas[1],
        i,
        i * 100,
      ],
    );
  }
  await client.query(
    `INSERT INTO import.bib_records
    (id,library_code,system_number,leader,format,fields,source_sha256,source_record_index,byte_offset,byte_length,accepted,rejection_code)
    VALUES($1,'RSL01',NULL,'bad','BK','[]',$2,100,10000,50,false,'validation')`,
    [uid(100), shas[0]],
  );
  let reportNo = 0;
  const createClient = () => new Client({ connectionString: url.href });
  const options = () => ({
    targetSchema: "public_26_10",
    image: "publication-image",
    batchSize: 2,
    report: join(work, `report-${++reportNo}.ndjson`),
    sampleResources: resources,
    createClient,
  });
  const publish = (extra: Record<string, unknown> = {}) =>
    publishBibliographicRecords({ ...options(), ...extra });
  return { client, work, createClient, options, publish, shas };
}

test("publication validates source selection, isolation, image and batch before I/O", () => {
  const good = {
    targetSchema: "public_26_10",
    image: "pinned",
    report: "/unused",
  };
  validatePublicationOptions(good);
  validatePublicationOptions({
    image: "pinned",
    report: "/unused",
    resumePublication: uid(1),
  });
  for (const invalid of [
    { targetSchema: undefined },
    { targetSchema: "public" },
    { targetSchema: "import" },
    { targetSchema: "x;drop" },
    { image: "unknown" },
    { image: "" },
    { report: "" },
    { resumePublication: "bad" },
    { batchSize: 0 },
    { batchSize: 100001 },
    { batchSize: 1.5 },
  ])
    assert.throws(() => validatePublicationOptions({ ...good, ...invalid }));
});

test(
  "PostgreSQL: publication preserves all ten native fields, UUIDs, NULLs and per-library numbers",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const f = await fixture(t);
    const options = f.options();
    const result = await publishBibliographicRecords(options);
    assert.equal(result.status, "completed");
    assert.equal(result.accepted, "6");
    assert.deepEqual(result.byLibrary, { RSL01: "4", RSL03: "2", RSL60: "0" });
    assert.deepEqual(result.counters, { loaded: "6", batches: 3 });
    assert.deepEqual(result.verification, {
      verified: "6",
      batches: 3,
      completed: true,
      byLibrary: { RSL01: "4", RSL03: "2", RSL60: "0" },
    });
    const differences = await f.client
      .query(`SELECT count(*)::int n FROM import.bib_records b
    FULL JOIN public_26_10.documents d ON d.id=b.id
    WHERE (b.accepted OR d.id IS NOT NULL) AND
      ROW(b.id,b.library_code,b.system_number,b.leader,b.format,b.fields,b.hidden,b.meta,b.created_at,b.updated_at)
      IS DISTINCT FROM ROW(d.id,d.library_code,d.system_number,d.leader,d.format,d.fields,d.hidden,d.meta,d.created_at,d.updated_at)`);
    assert.equal(differences.rows[0].n, 0);
    assert.equal(
      (
        await f.client.query(
          "SELECT count(*)::int n FROM public_26_10.documents WHERE system_number=9",
        )
      ).rows[0].n,
      2,
    );
    assert.equal(
      (
        await f.client.query(
          "SELECT count(*)::int n FROM public_26_10.documents WHERE id=$1",
          [uid(100)],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (await f.client.query("SELECT to_regclass('public.documents') relation"))
        .rows[0].relation,
      null,
    );
    assert.equal(
      (await f.client.query("SELECT to_regclass('import.bib_ids') relation"))
        .rows[0].relation,
      null,
    );
    assert.equal(
      (
        await f.client.query(
          "SELECT nextval('public_26_10.documents_system_number_seq')::int n",
        )
      ).rows[0].n,
      13,
    );
    const checkpoints = (
      await f.client
        .query(`SELECT phase,batch_no,cursor_library,cursor_number,rows::text
    FROM import.bib_publication_batches ORDER BY phase,batch_no`)
    ).rows;
    assert.deepEqual(
      checkpoints.map((r) => [
        r.phase,
        r.cursor_library,
        r.cursor_number,
        r.rows,
      ]),
      [
        ["loading", "RSL01", 10, "2"],
        ["loading", "RSL01", 12, "2"],
        ["loading", "RSL03", 10, "2"],
        ["verifying", "RSL01", 10, "2"],
        ["verifying", "RSL01", 12, "2"],
        ["verifying", "RSL03", 10, "2"],
      ],
    );
    const events = (await readFile(options.report, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(events[0].event, "publication_start");
    assert.equal(events.at(-1).event, "publication_finished");
    assert.equal(
      events.filter((e) => e.event === "publication_batch_committed").length,
      6,
    );
    assert.ok(events.every((e) => Number.isFinite(Date.parse(e.time))));
    for (const event of events.filter(
      (e) => e.event === "publication_batch_committed",
    ))
      for (const key of [
        "pageMs",
        "insertMs",
        "verifyMs",
        "checkpointMs",
        "commitMs",
        "elapsedMs",
      ])
        assert.ok(event[key] >= 0, key);
    assert.equal((await stat(options.report)).mode & 0o777, 0o600);
    const before = (
      await f.client.query("SELECT * FROM import.bib_publications")
    ).rows[0];
    const replay = await f.publish({
      targetSchema: undefined,
      batchSize: undefined,
      resumePublication: result.publicationId,
    });
    assert.equal(replay.status, "completed");
    assert.deepEqual(
      (await f.client.query("SELECT * FROM import.bib_publications")).rows[0],
      before,
    );
    assert.equal(
      (
        await f.client.query(
          "SELECT count(*)::int n FROM import.bib_publication_batches",
        )
      ).rows[0].n,
      6,
    );
  },
);

test(
  "PostgreSQL: failed post-insert verification rolls back only its batch and resume preserves committed UUIDs",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const f = await fixture(t);
    let checks = 0;
    const createClient = () => {
      const c = f.createClient(),
        query = c.query.bind(c);
      c.query = (async (...args: unknown[]) => {
        if (
          typeof args[0] === "string" &&
          args[0].includes("count(*) FILTER(WHERE d.id IS NULL")
        ) {
          checks++;
          if (checks === 2)
            await query(
              "UPDATE public_26_10.documents SET meta='{\"wrong\":true}' WHERE system_number=11",
            );
        }
        return query(...(args as Parameters<typeof query>));
      }) as typeof c.query;
      return c;
    };
    await assert.rejects(
      f.publish({ createClient }),
      /full-field verification failed/,
    );
    const saved = (
      await f.client.query("SELECT * FROM import.bib_publications")
    ).rows[0];
    assert.equal(saved.status, "failed");
    assert.deepEqual(saved.counters, { loaded: "2", batches: 1 });
    assert.equal(saved.cursor_number, 10);
    assert.equal(
      (
        await f.client.query(
          "SELECT count(*)::int n FROM public_26_10.documents",
        )
      ).rows[0].n,
      2,
    );
    assert.equal(
      (
        await f.client.query(
          "SELECT count(*)::int n FROM import.bib_publication_batches",
        )
      ).rows[0].n,
      1,
    );
    await assert.rejects(
      f.publish({ resumePublication: saved.id, image: "wrong-image" }),
      /changed on resume/,
    );
    const result = await f.publish({
      targetSchema: undefined,
      batchSize: undefined,
      resumePublication: saved.id,
    });
    assert.equal(result.status, "completed");
    assert.equal(
      (
        await f.client.query(
          "SELECT count(*)::int n FROM public_26_10.documents WHERE id=ANY($1::uuid[])",
          [[uid(1), uid(2)]],
        )
      ).rows[0].n,
      2,
    );
    assert.equal(
      (
        await f.client.query(
          "SELECT count(*)::int n FROM public_26_10.documents",
        )
      ).rows[0].n,
      6,
    );
    assert.equal(
      (
        await f.client.query(
          "SELECT count(*)::int n FROM import.bib_publication_batches WHERE phase='loading'",
        )
      ).rows[0].n,
      3,
    );
  },
);

test(
  "PostgreSQL: final verification phase compares full records and resumes its saved cursor",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const f = await fixture(t);
    let checks = 0;
    const createClient = () => {
      const c = f.createClient(),
        query = c.query.bind(c);
      c.query = (async (...args: unknown[]) => {
        if (
          typeof args[0] === "string" &&
          args[0].includes("count(*) FILTER(WHERE d.id IS NULL")
        ) {
          checks++;
          if (checks === 5)
            await query(
              "UPDATE public_26_10.documents SET hidden=true WHERE system_number=11",
            );
        }
        return query(...(args as Parameters<typeof query>));
      }) as typeof c.query;
      return c;
    };
    await assert.rejects(
      f.publish({ createClient }),
      /full-field verification failed/,
    );
    const saved = (
      await f.client.query("SELECT * FROM import.bib_publications")
    ).rows[0];
    assert.deepEqual(saved.counters, { loaded: "6", batches: 3 });
    assert.deepEqual(saved.verification, { verified: "2", batches: 1 });
    assert.equal(saved.verify_number, 10);
    const result = await f.publish({ resumePublication: saved.id });
    assert.equal(result.status, "completed");
    assert.equal(
      (
        await f.client.query(
          "SELECT count(*)::int n FROM import.bib_publication_batches",
        )
      ).rows[0].n,
      6,
    );
  },
);

test(
  "PostgreSQL: incomplete source metadata blocks all publication writes",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const f = await fixture(t);
    await f.client.query(
      "UPDATE import.bib_record_batches SET accepted=accepted-1,rejected=rejected+1 WHERE source_sha256=$1",
      [f.shas[0]],
    );
    await assert.rejects(
      f.publish(),
      /source\/batch\/actual SQL counts differ/,
    );
    assert.equal(
      (
        await f.client.query(
          "SELECT to_regclass('public_26_10.documents') relation",
        )
      ).rows[0].relation,
      null,
    );
  },
);

test(
  "PostgreSQL: global pipeline lock prevents a second publisher before journal or target writes",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const f = await fixture(t);
    await f.client.query(
      "SELECT pg_advisory_lock_shared(hashtext('import.pipeline'))",
    );
    await assert.rejects(f.publish(), /Another import.pipeline operation/);
    assert.equal(
      (
        await f.client.query(
          "SELECT to_regclass('public_26_10.documents') relation",
        )
      ).rows[0].relation,
      null,
    );
    assert.equal(
      (
        await f.client.query(
          "SELECT to_regclass('import.bib_publications') relation",
        )
      ).rows[0].relation,
      null,
    );
  },
);

test(
  "PostgreSQL: changed source SHA metadata rejects resume without replaying committed rows",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const f = await fixture(t);
    let stopped = false;
    await assert.rejects(
      f.publish({
        progress: (e: Record<string, unknown>) => {
          if (!stopped && e.event === "publication_batch_committed") {
            stopped = true;
            throw Error("stop after durable first batch");
          }
        },
      }),
      /stop after durable first batch/,
    );
    const saved = (
      await f.client.query("SELECT * FROM import.bib_publications")
    ).rows[0];
    await f.client.query(
      "UPDATE import.bib_record_batches SET sha256=$1 WHERE source_sha256=$2",
      ["e".repeat(64), f.shas[0]],
    );
    await assert.rejects(
      f.publish({ resumePublication: saved.id }),
      /source manifest changed/,
    );
    assert.equal(
      (
        await f.client.query(
          "SELECT count(*)::int n FROM public_26_10.documents",
        )
      ).rows[0].n,
      2,
    );
    assert.equal(
      (
        await f.client.query(
          "SELECT count(*)::int n FROM import.bib_publication_batches",
        )
      ).rows[0].n,
      1,
    );
  },
);

test(
  "PostgreSQL: critical RAM cancels active SQL, rolls back its rows and preserves the committed checkpoint",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const f = await fixture(t);
    let inserts = 0,
      sampling = 0,
      backendPid = 0;
    const createClient = () => {
      const c = f.createClient(),
        query = c.query.bind(c);
      c.query = (async (...args: unknown[]) => {
        const value = await query(...(args as Parameters<typeof query>));
        if (
          typeof args[0] === "string" &&
          args[0].startsWith('INSERT INTO "public_26_10".documents')
        ) {
          inserts++;
          if (inserts === 2) {
            backendPid = (await query("SELECT pg_backend_pid() pid")).rows[0]
              .pid;
            await query("SELECT pg_sleep(20)");
          }
        }
        return value;
      }) as typeof c.query;
      return c;
    };
    await assert.rejects(
      f.publish({
        createClient,
        sampleResources: async () => ({
          memoryAvailableBytes:
            ++sampling === 1 ? 6n * 1024n ** 3n : 1n * 1024n ** 3n,
          diskAvailableBytes: 500n * 1024n ** 3n,
        }),
      }),
      /resource gate stopped: memory/,
    );
    assert.equal(inserts, 2);
    assert.ok(backendPid > 0);
    let active = 1;
    // end() закрывает сокет; PostgreSQL проверяет разрыв во время длинного SQL
    // через client_connection_check_interval=1s, после чего освобождает транзакцию.
    for (let i = 0; i < 100 && active; i++) {
      active = (
        await f.client.query(
          "SELECT count(*)::int n FROM pg_stat_activity WHERE pid=$1",
          [backendPid],
        )
      ).rows[0].n;
      if (active) await delay(20);
    }
    assert.equal(active, 0);
    assert.equal(
      (
        await f.client.query(
          "SELECT count(*)::int n FROM public_26_10.documents",
        )
      ).rows[0].n,
      2,
    );
    const saved = (
      await f.client.query("SELECT * FROM import.bib_publications")
    ).rows[0];
    assert.deepEqual(saved.counters, { loaded: "2", batches: 1 });
    const result = await f.publish({ resumePublication: saved.id });
    assert.equal(result.status, "completed");
    assert.equal(
      (
        await f.client.query(
          "SELECT count(*)::int n FROM public_26_10.documents",
        )
      ).rows[0].n,
      6,
    );
  },
);

test(
  "PostgreSQL: missing accepted identity index rejects before target creation",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const f = await fixture(t);
    await f.client.query("DROP INDEX import.bib_records_identity");
    await assert.rejects(
      f.publish(),
      /source.*(unique|identity)|unique.*source/i,
    );
    assert.equal(
      (
        await f.client.query(
          "SELECT to_regclass('public_26_10.documents') relation",
        )
      ).rows[0].relation,
      null,
    );
  },
);
