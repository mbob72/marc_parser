import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  readFile,
} from "node:fs/promises";
import { join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { startWorker } from "../src/runtime/worker.ts";
import { request } from "../src/runtime/control.ts";

test("worker сериализует start, сохраняет отмену и проверяет реальные пути пакетов", async (t) => {
  const root = await mkdtemp("/tmp/marc-worker-");
  const work = join(root, "work"),
    source = join(root, "source");
  await mkdir(work);
  await mkdir(source);
  const file = join(source, "input.dat");
  await writeFile(file, "fixture");
  await symlink(source, join(work, "escape"));
  let starts = 0;
  const worker = await startWorker({
    work,
    source,
    env: "/run/db.env",
    image: "test",
    launch: (_args, fd) => {
      starts++;
      return spawn(process.execPath, ["-e", "setTimeout(()=>{},10000)"], {
        stdio: ["ignore", fd, fd],
      });
    },
  });
  t.after(async () => {
    await worker.close();
    await rm(root, { recursive: true, force: true });
  });
  const socket = join(work, "control/worker.sock");
  await assert.rejects(
    request(socket, {
      command: "start",
      stage: "load",
      input: join(work, "escape"),
    }),
    /selected mount/,
  );
  await assert.rejects(
    request(socket, { command: "start", input: file, member: 42 }),
    /Invalid member/,
  );
  assert.equal(worker.state().task, undefined);
  const result = await Promise.allSettled([
    request(socket, { command: "start", input: file }),
    request(socket, { command: "start", input: file }),
  ]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(starts, 1);
  await request(socket, { command: "drain" });
  await assert.rejects(
    request(socket, { command: "start", input: file }),
    /draining/,
  );
  await request(socket, { command: "stop" });
  for (let i = 0; i < 100 && worker.state().busy; i++) await delay(20);
  assert.equal(worker.state().busy, false);
  assert.equal(worker.state().task?.status, "cancelled");
  const saved = JSON.parse(
    await readFile(join(work, "control/worker.json"), "utf8"),
  );
  assert.equal(saved.task.image, "test");
});

test("сценарий запускает Z103 только после load и ready; ошибка документов запрещает старт связей", async (t) => {
  const root = await mkdtemp("/tmp/marc-sequence-");
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "docker"),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args=process.argv.slice(2);
fs.appendFileSync(process.env.STUB_LOG,JSON.stringify(args)+'\\n');
const container=args[1], operation=args[4];
let state={};try{state=JSON.parse(fs.readFileSync(process.env.STUB_STATE))}catch{}
if(operation==='start') {
 const stage=args[args.indexOf('--stage')+1];
 state[container]={id:container+'-'+stage,status:process.env.STUB_FAIL && container==='marc-documents-worker'?'failed':'completed',report:'/work/report',log:'/work/report.log'};
 fs.writeFileSync(process.env.STUB_STATE,JSON.stringify(state));
}
console.log(JSON.stringify({busy:false,task:state[container]}));
`,
    { mode: 0o755 },
  );
  const script = new URL(
    "../scripts/run-documents-before-relations.mjs",
    import.meta.url,
  ).pathname;
  const args = [
    script,
    "--packages",
    "/work/copy",
    "--relations-input",
    "/source/z103.dat",
  ];
  const env = {
    ...process.env,
    PATH: root + ":" + process.env.PATH,
    STUB_LOG: join(root, "calls"),
    STUB_STATE: join(root, "state"),
  };
  execFileSync(process.execPath, args, { env });
  const calls = (await readFile(env.STUB_LOG, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
  const starts = calls.filter((args) => args[4] === "start");
  assert.deepEqual(
    starts.map((args) => [args[1], args[args.indexOf("--stage") + 1]]),
    [
      ["marc-documents-worker", "load"],
      ["marc-documents-worker", "ready"],
      ["bib-relations-worker", "run"],
    ],
  );
  assert.equal(starts[0]![3], "/app/dist/documents-worker-cli.js");
  assert.equal(starts[2]![3], "/app/dist/worker-cli.js");
  await writeFile(env.STUB_LOG, "");
  assert.throws(() =>
    execFileSync(process.execPath, args, {
      env: { ...env, STUB_FAIL: "1" },
      stdio: "pipe",
    }),
  );
  const failedCalls = (await readFile(env.STUB_LOG, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
  assert.equal(
    failedCalls.some((args) => args[1] === "bib-relations-worker"),
    false,
  );
});
