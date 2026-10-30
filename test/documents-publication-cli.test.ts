import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { documentsMain, documentsPublishMain } from "../src/documents-cli.ts";
import { startWorker } from "../src/runtime/worker.ts";
import { request } from "../src/runtime/control.ts";

const image = "registry.example/marc-documents@sha256:" + "a".repeat(64);
const publicationId = "11111111-1111-4111-8111-111111111111";

async function fixture(t: { after: (fn: () => unknown) => unknown }) {
  // Короткий путь укладывается в лимит Unix-сокета macOS.
  const root = await mkdtemp("/tmp/doc-pub-");
  const cleanups: Array<() => Promise<void>> = [];
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    await rm(root, { recursive: true, force: true });
  });
  const env = join(root, "db.env");
  await writeFile(env, "DB_TYPE=postgres\nPUBLICATION_NON_DB=from-file\n");
  return {
    root,
    env,
    report: join(root, "publish.ndjson"),
    cleanup: (fn: () => Promise<void>) => cleanups.push(fn),
  };
}
function publicationArgs(
  f: { env: string; report: string },
  extra: string[] = [],
) {
  return [
    "--target-schema",
    "public_26_10",
    "--image",
    image,
    "--report",
    f.report,
    "--env",
    f.env,
    ...extra,
  ];
}

// Подставной publisher проверяет границу CLI без подключения к БД и записи данных.
test("publish CLI принимает источник из БД, передаёт параметры и импортирует только DB_*", async (t) => {
  const f = await fixture(t);
  const before = process.env.DB_TYPE;
  const nonDb = process.env.PUBLICATION_NON_DB;
  t.after(() => {
    if (before === undefined) delete process.env.DB_TYPE;
    else process.env.DB_TYPE = before;
  });
  let called = false;
  await documentsPublishMain(
    publicationArgs(f, ["--batch-size", "100000"]),
    async (options) => {
      called = true;
      assert.equal(options.targetSchema, "public_26_10");
      assert.equal(options.image, image);
      assert.equal(options.batchSize, 100000);
      assert.equal(options.report, f.report);
      assert.equal(options.signal?.aborted, false);
      assert.equal(process.env.DB_TYPE, "postgres");
      assert.equal(process.env.PUBLICATION_NON_DB, nonDb);
      return undefined as never;
    },
  );
  assert.equal(called, true);
  await assert.rejects(stat(f.report), { code: "ENOENT" });
});

test("publish CLI разрешает наследовать схему и размер пакета при resume", async (t) => {
  const f = await fixture(t);
  await documentsPublishMain(
    [
      "--resume-publication",
      publicationId,
      "--image",
      image,
      "--report",
      f.report,
      "--env",
      f.env,
    ],
    async (options) => {
      assert.equal(options.resumePublication, publicationId);
      assert.equal(options.targetSchema, undefined);
      assert.equal(options.batchSize, undefined);
      return undefined as never;
    },
  );
});

test("publish отклоняет файловые и неподдерживаемые параметры до env и publisher", async (t) => {
  const f = await fixture(t);
  const missingEnv = { ...f, env: join(f.root, "absent.env") };
  let calls = 0;
  const invalid = [
    ["--input", "/source/raw.dat"],
    ["--output", "/work/out"],
    ["--member", "rsl01_z00.dat"],
    ["--library", "RSL01"],
    ["--dry-run"],
    ["--format", "iso2709"],
    ["--validation-policy", "reject"],
    ["--batch-size", "100001"],
    ["--batch-size", "0"],
    ["--batch-size", "1e2"],
    ["--batch-size", "1.5"],
    ["--resume-publication", "invalid"],
  ];
  for (const extra of invalid)
    await assert.rejects(
      documentsPublishMain(publicationArgs(missingEnv, extra), async () => {
        calls++;
        return undefined as never;
      }),
      (error: Error) => !error.message.includes("absent.env"),
    );
  for (const target of ["public", "import", "pg_temp", "public_26_10;DROP"])
    await assert.rejects(
      documentsPublishMain(
        publicationArgs(missingEnv).map((arg) =>
          arg === "public_26_10" ? target : arg,
        ),
      ),
      (error: Error) => !error.message.includes("absent.env"),
    );
  await assert.rejects(
    documentsPublishMain([
      "--image",
      "unknown",
      "--report",
      f.report,
      "--env",
      missingEnv.env,
    ]),
    (error: Error) => !error.message.includes("absent.env"),
  );
  await assert.rejects(
    documentsMain(["publish", "--input", "/source/raw.dat"]),
    /Unknown option/,
  );
  assert.equal(calls, 0);
  await assert.rejects(stat(f.report), { code: "ENOENT" });
});

test("publish CLI отменяет publisher по SIGTERM и очищает обработчики после ошибки", async (t) => {
  const f = await fixture(t);
  const counts = [
    process.listenerCount("SIGTERM"),
    process.listenerCount("SIGINT"),
  ];
  await assert.rejects(
    documentsPublishMain(publicationArgs(f), async (options) => {
      process.emit("SIGTERM");
      assert.equal(options.signal?.aborted, true);
      options.signal?.throwIfAborted();
      return undefined as never;
    }),
    /stopped by signal/,
  );
  assert.deepEqual(
    [process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")],
    counts,
  );
});

test("worker publish сохраняет параметры, использует свой образ и не требует input", async (t) => {
  const f = await fixture(t);
  const work = join(f.root, "work"),
    source = join(f.root, "source");
  await mkdir(work);
  await mkdir(source);
  const launches: string[][] = [];
  const worker = await startWorker({
    work,
    source,
    env: f.env,
    image,
    launch: (args, fd) => {
      launches.push(args);
      return spawn(process.execPath, ["-e", "setTimeout(()=>{},10000)"], {
        stdio: ["ignore", fd, fd],
      });
    },
  });
  f.cleanup(() => worker.close());
  const socket = join(work, "control/worker.sock");
  for (const mixed of [
    { input: "/source/raw.dat" },
    { output: "/work/out" },
    { member: "raw.dat" },
    { library: "RSL01" },
    { dryRun: false },
    { format: "iso2709" },
    { batchSize: 100001 },
    { batchSize: 1.5 },
    { targetSchema: "public" },
    { resumePublication: "invalid" },
  ])
    await assert.rejects(
      request(socket, {
        command: "start",
        stage: "publish",
        targetSchema: "public_26_10",
        ...mixed,
      }),
    );
  assert.equal(worker.state().task, undefined);
  assert.equal(launches.length, 0);
  await request(socket, {
    command: "start",
    stage: "publish",
    targetSchema: "public_26_10",
    batchSize: 100000,
    image: "untrusted-request-image",
  });
  assert.equal(launches.length, 1);
  const args = launches[0]!;
  assert.equal(args[0], "publish");
  assert.equal(args[args.indexOf("--target-schema") + 1], "public_26_10");
  assert.equal(args[args.indexOf("--image") + 1], image);
  assert.equal(args[args.indexOf("--batch-size") + 1], "100000");
  assert.ok(args[args.indexOf("--report") + 1]!.endsWith(".ndjson"));
  assert.equal(args.includes("--input"), false);
  const saved = JSON.parse(
    await readFile(join(work, "control/worker.json"), "utf8"),
  );
  assert.equal(saved.task.targetSchema, "public_26_10");
  assert.equal(saved.task.batchSize, 100000);
  assert.equal(saved.task.image, image);
  await request(socket, { command: "stop" });
  for (let n = 0; n < 100 && worker.state().busy; n++) await delay(10);
  assert.equal(worker.state().busy, false);
  await request(socket, {
    command: "start",
    stage: "publish",
    resumePublication: publicationId,
  });
  const resumed = launches[1]!;
  assert.equal(
    resumed[resumed.indexOf("--resume-publication") + 1],
    publicationId,
  );
  assert.equal(resumed.includes("--target-schema"), false);
  assert.equal(resumed.includes("--batch-size"), false);
  assert.equal(worker.state().task?.resumePublication, publicationId);
});

test("worker проверяет pinned image из конфигурации до создания publish задачи", async (t) => {
  const f = await fixture(t);
  const work = join(f.root, "work"),
    source = join(f.root, "source");
  await mkdir(work);
  await mkdir(source);
  const worker = await startWorker({
    work,
    source,
    env: f.env,
    image: "unknown",
  });
  f.cleanup(() => worker.close());
  await assert.rejects(
    request(join(work, "control/worker.sock"), {
      command: "start",
      stage: "publish",
      targetSchema: "public_26_10",
      image,
    }),
  );
  assert.equal(worker.state().task, undefined);
});
