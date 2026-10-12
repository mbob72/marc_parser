import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  access,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  profileForRunner,
  settings,
  shellQuote,
} from "../scripts/deploy-documents-vpn.mjs";

const profile =
  "client\nremote 195.74.82.60 1195 udp4\nauth-user-pass\n<ca>\nfixture\n</ca>\n";
const revision = "a".repeat(40);
const digest = "sha256:" + "b".repeat(64);
const fixture = {
  VPN_PROFILE: profile,
  VPN_USERNAME: "fixture-user",
  VPN_PASSWORD: "fixture-password",
  DEPLOY_SSH_KEY: "fixture-key",
  DEPLOY_KNOWN_HOSTS: "fixture-host-key",
  DEPLOY_HOST: "10.251.232.53",
  DEPLOY_USER: "bobryshevmy",
  DEPLOY_IMAGE: "ghcr.io/mbob72/marc_parser",
  DEPLOY_DIGEST: digest,
  DEPLOY_REVISION: revision,
  GHCR_USERNAME: "mbob72",
  GHCR_TOKEN: "fixture-token",
};

test("профиль CI сохраняет inline-ключи, запрещает hooks и не принимает подстановки в SSH arguments", () => {
  assert.match(profileForRunner(profile), /<ca>\nfixture\n<\/ca>/);
  assert.doesNotMatch(profileForRunner(profile), /auth-user-pass/);
  assert.throws(
    () => profileForRunner(profile + "up secret-hook\n"),
    /Unsupported VPN directive/,
  );
  assert.throws(
    () => settings({ ...fixture, DEPLOY_IMAGE: "image;command" }),
    /Invalid DEPLOY_IMAGE/,
  );
  assert.throws(
    () => settings({ ...fixture, VPN_PASSWORD: "one\ntwo" }),
    /Invalid VPN_PASSWORD/,
  );
  assert.throws(
    () => settings({ ...fixture, VPN_USERNAME: "" }),
    /Missing VPN_USERNAME/,
  );
  const quoted = spawnSync(
    "bash",
    ["-c", "printf '%s' " + shellQuote("a'b$(exit 1)\nline")],
    { encoding: "utf8" },
  );
  assert.equal(quoted.status, 0);
  assert.equal(quoted.stdout, "a'b$(exit 1)\nline");
});

test("доставка очищает VPN и временные secrets после успеха, SSH-ошибки и отказа VPN", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "marc-vpn-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  await mkdir(bin);
  await writeFile(
    join(bin, "sudo"),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[1] === 'openvpn') {
  const value = flag => args[args.indexOf(flag) + 1];
  const path = require('node:path').dirname(value('--config'));
  fs.writeFileSync(process.env.TEST_DIR_FILE, path);
  for (const file of ['profile.ovpn','auth.txt','ssh-key','known_hosts']) {
    if ((fs.statSync(path + '/' + file).mode & 0o777) !== 0o600) process.exit(20);
  }
  if (process.env.VPN_PASSWORD || process.env.GHCR_TOKEN) process.exit(21);
  if (!args.includes('--route-nopull') || value('--route') !== '10.251.232.53') process.exit(22);
  fs.writeFileSync(value('--log'), process.env.TEST_FAIL_VPN ? 'AUTH_FAILED' : 'Initialization Sequence Completed');
  fs.writeFileSync(value('--writepid'), '12345');
} else if (args[1] === 'kill') fs.writeFileSync(process.env.TEST_KILLED_FILE, 'stopped');
else process.exit(23);
`,
    { mode: 0o755 },
  );
  await writeFile(
    join(bin, "ssh"),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const input = fs.readFileSync(0, 'utf8');
if (input !== 'fixture-token\\n' || args.join(' ').includes('fixture-token')) process.exit(24);
if (!args.includes('StrictHostKeyChecking=yes')) process.exit(25);
fs.writeFileSync(process.env.TEST_SSH_FILE, 'delivered');
process.exit(process.env.TEST_FAIL_SSH ? 7 : 0);
`,
    { mode: 0o755 },
  );
  for (const failure of ["none", "ssh", "vpn"]) {
    const env = {
      ...process.env,
      ...fixture,
      PATH: bin + ":" + process.env.PATH,
      TEST_DIR_FILE: join(root, failure + ".dir"),
      TEST_KILLED_FILE: join(root, failure + ".killed"),
      TEST_SSH_FILE: join(root, failure + ".ssh"),
      TEST_FAIL_SSH: failure === "ssh" ? "1" : "",
      TEST_FAIL_VPN: failure === "vpn" ? "1" : "",
    };
    const result = spawnSync(
      process.execPath,
      [resolve("scripts/deploy-documents-vpn.mjs")],
      { env, encoding: "utf8" },
    );
    assert.equal(result.status, failure === "none" ? 0 : 1, result.stderr);
    assert.equal(await readFile(env.TEST_KILLED_FILE, "utf8"), "stopped");
    await assert.rejects(access(await readFile(env.TEST_DIR_FILE, "utf8")));
    if (failure === "vpn") await assert.rejects(access(env.TEST_SSH_FILE));
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /fixture-token|fixture-password|fixture-key/,
    );
  }
});

test("SSH pull проверяет revision, сохраняет квитанцию только при успехе и удаляет временный login", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "marc-ssh-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "flock"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await writeFile(
    join(bin, "docker"),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify(args) + '\\n');
if (args.includes('login')) {
  if (fs.readFileSync(0, 'utf8') !== 'fixture-token\\n') process.exit(2);
  fs.writeFileSync(process.env.TEST_AUTH_DIR, args[1]);
} else if (args.includes('pull')) { if (process.env.TEST_FAIL === 'pull') process.exit(3); }
else if (args.includes('inspect')) {
  console.log(args.at(-1) === '{{.Id}}' ? 'sha256:' + 'c'.repeat(64) : (process.env.TEST_FAIL === 'revision' ? 'wrong' : '${revision}'));
} else if (args[0] !== 'tag') process.exit(4);
`,
    { mode: 0o755 },
  );
  for (const failure of ["none", "pull", "revision"]) {
    const accountDir = join(root, failure);
    await mkdir(accountDir);
    const env = {
      ...process.env,
      DOCUMENTS_DELIVERY_DIR: join(accountDir, "marc-documents-work/delivery"),
      PATH: bin + ":" + process.env.PATH,
      TEST_FAIL: failure,
      TEST_CALLS: join(root, failure + ".calls"),
      TEST_AUTH_DIR: join(root, failure + ".auth"),
    };
    const result = spawnSync(
      "bash",
      [
        resolve("scripts/deliver-documents-image.sh"),
        fixture.DEPLOY_IMAGE,
        digest,
        revision,
        "mbob72",
      ],
      { env, input: "fixture-token\n", encoding: "utf8" },
    );
    assert.equal(result.status === 0, failure === "none", result.stderr);
    await assert.rejects(access(await readFile(env.TEST_AUTH_DIR, "utf8")));
    const receipt = join(
      accountDir,
      "marc-documents-work/delivery/latest.json",
    );
    if (failure === "none")
      assert.equal(JSON.parse(await readFile(receipt, "utf8")).digest, digest);
    else await assert.rejects(access(receipt));
    const calls = await readFile(env.TEST_CALLS, "utf8");
    assert.doesNotMatch(calls, /fixture-token|"run"|"stop"|"rm"/);
    assert.match(calls, new RegExp(digest));
  }
});
