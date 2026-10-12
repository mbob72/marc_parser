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
import { Docker, retentionPlan } from "../src/runtime/docker.ts";
import { createDeployer } from "../src/runtime/deployer.ts";
import { registryDigest } from "../src/runtime/registry.ts";

test("публичный GHCR выдаёт digest через анонимный Bearer; Basic не уходит чужому хосту", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const calls: { url: string; authorization: string | null }[] = [];
  let foreignRealm = false;
  globalThis.fetch = (async (url, init) => {
    const authorization = new Headers(init?.headers).get("Authorization");
    calls.push({ url: String(url), authorization });
    if (String(url).includes("/token?")) {
      assert.equal(authorization, null);
      return new Response(JSON.stringify({ token: "public-token" }));
    }
    if (authorization === "Bearer public-token")
      return new Response(null, {
        headers: { "docker-content-digest": "sha256:" + "a".repeat(64) },
      });
    return new Response(null, {
      status: 401,
      headers: {
        "www-authenticate": `Bearer realm="https://${foreignRealm ? "foreign.example" : "ghcr.io"}/token",service="ghcr.io"`,
      },
    });
  }) as typeof fetch;
  assert.equal(
    await registryDigest("ghcr.io", "mbob72/marc_parser", "documents-main"),
    "sha256:" + "a".repeat(64),
  );
  assert.equal(calls.length, 3);
  assert.match(calls[1]!.url, /scope=repository%3Ambob72%2Fmarc_parser%3Apull/);
  foreignRealm = true;
  await assert.rejects(
    registryDigest("ghcr.io", "mbob72/marc_parser", "documents-main", "secret"),
    /Untrusted Registry auth realm/,
  );
  assert.equal(calls.length, 4);
  assert.equal(calls[3]!.authorization, null);
});

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

test("retention защищает используемые образы и оставляет место перед pull", () => {
  const images = [1, 2, 3, 4].map((n) => ({
    Id: String(n),
    Created: n,
    RepoTags: null,
    RepoDigests: null,
  }));
  assert.deepEqual(
    retentionPlan(images, new Set(["1"]), 3).remove.map((i) => i.Id),
    ["2"],
  );
  assert.equal(
    retentionPlan(images, new Set(["1", "2", "3"]), 2).blocked,
    true,
  );
});

test("deploy анонимно доставляет digest, не читает секреты и не заменяет worker; start использует локальный образ", async (t) => {
  const root = await mkdtemp("/tmp/marc-deploy-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = "registry.example/marc";
  const image = repo + "@sha256:" + "a".repeat(64);
  class FakeDocker extends Docker {
    calls: { method: string; path: string; body?: any; auth?: string }[] = [];
    available = false;
    exists = false;
    async call(
      method: string,
      path: string,
      body?: any,
      auth?: string,
    ): Promise<any> {
      this.calls.push({ method, path, body, auth });
      if (path === "/images/json")
        return this.available
          ? [
              {
                Id: "new",
                Created: 2,
                RepoTags: [repo + ":documents-test"],
                RepoDigests: [image],
              },
            ]
          : [];
      if (path === "/containers/json?all=1") return [];
      if (path.startsWith("/images/create")) {
        this.available = true;
        return;
      }
      if (path.startsWith("/containers/create")) {
        this.exists = true;
        return { Id: "worker" };
      }
    }
    async inspectImage() {
      return this.available ? { Id: "new", Config: { Labels: {} } } : undefined;
    }
    async inspectContainer() {
      return this.exists
        ? { Image: "new", State: { Running: true } }
        : undefined;
    }
  }
  const docker = new FakeDocker();
  const deploy = await createDeployer(
    {
      registry: "registry.example",
      repository: "marc",
      tag: "documents-main",
      control: root,
      configFile: "unused",
      anonymous: true,
      workDir: "/host/work",
      sourceDir: "/host/source",
      envFile: "/host/db.env",
      uid: 1001,
      gid: 1001,
      workerName: "marc-documents-worker",
      cpu: 1,
      memory: 536870912,
    },
    {
      docker,
      credentials: async () => {
        throw Error("Anonymous mode must not read credentials");
      },
      digest: async (basic) => {
        assert.equal(basic, undefined);
        return "sha256:" + "a".repeat(64);
      },
    },
  );
  await deploy.update();
  assert.equal(deploy.state().phase, "ready");
  assert.equal(
    docker.calls.find((c) => c.path.startsWith("/images/create"))?.auth,
    undefined,
  );
  assert.equal(
    docker.calls.some((c) => c.path.startsWith("/containers/create")),
    false,
  );
  const before = docker.calls.filter((c) =>
    c.path.startsWith("/images/create"),
  ).length;
  await deploy.start();
  const creation = docker.calls.find((c) =>
    c.path.startsWith("/containers/create"),
  )!;
  assert.match(creation.path, /marc-documents-worker/);
  assert.deepEqual(creation.body.Cmd, ["worker", "server", "--image", image]);
  assert.equal(creation.body.User, "1001:1001");
  assert.equal(
    docker.calls.filter((c) => c.path.startsWith("/images/create")).length,
    before,
  );
  await assert.rejects(deploy.start(), /already exists/);
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
