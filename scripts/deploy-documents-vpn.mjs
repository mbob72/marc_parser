import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

/** Проверяет конфигурацию CI до записи секретов и подключения к сети. */
// DOC-PREVIEW:/docs/documents-deployment.md#vpn-script
export function settings(env) {
  const names = [
    "VPN_PROFILE",
    "VPN_USERNAME",
    "VPN_PASSWORD",
    "DEPLOY_SSH_KEY",
    "DEPLOY_KNOWN_HOSTS",
    "DEPLOY_HOST",
    "DEPLOY_USER",
    "DEPLOY_IMAGE",
    "DEPLOY_DIGEST",
    "DEPLOY_REVISION",
    "GHCR_USERNAME",
    "GHCR_TOKEN",
  ];
  const values = {};
  for (const name of names) {
    if (!env[name]?.trim()) throw Error("Missing " + name);
    values[name] = env[name];
  }
  const patterns = {
    DEPLOY_HOST: /^10\.251\.232\.53$/,
    DEPLOY_USER: /^[a-z_][a-z0-9_-]*$/,
    DEPLOY_IMAGE: /^ghcr\.io\/[a-z0-9_-]+\/[a-z0-9_.-]+$/,
    DEPLOY_DIGEST: /^sha256:[a-f0-9]{64}$/,
    DEPLOY_REVISION: /^[a-f0-9]{40}$/,
    GHCR_USERNAME: /^[a-zA-Z0-9_-]+(?:\[bot\])?$/,
    VPN_USERNAME: /^[^\r\n\0]+$/,
    VPN_PASSWORD: /^[^\r\n\0]+$/,
    GHCR_TOKEN: /^[^\r\n\0]+$/,
  };
  for (const [name, pattern] of Object.entries(patterns))
    if (!pattern.test(values[name])) throw Error("Invalid " + name);
  values.VPN_PROFILE = profileForRunner(values.VPN_PROFILE);
  return values;
}

/** Принимает inline-профиль; исключает локальные пути, hooks и настройки маршрутов из секрета. */
// DOC-PREVIEW:/docs/documents-deployment.md#vpn-script
export function profileForRunner(profile) {
  const allowed = new Set([
    "client",
    "tls-client",
    "persist-key",
    "persist-tun",
    "data-ciphers",
    "data-ciphers-fallback",
    "cipher",
    "auth",
    "remote",
    "proto",
    "nobind",
    "verify-x509-name",
    "remote-cert-tls",
    "explicit-exit-notify",
    "key-direction",
    "resolv-retry",
    "verb",
    "mute",
    "auth-nocache",
  ]);
  const blocks = new Set(["ca", "cert", "key", "tls-auth", "tls-crypt"]);
  const result = [];
  let block;
  let remote = false;
  for (const line of profile.replaceAll("\r\n", "\n").split("\n")) {
    const trimmed = line.trim();
    if (block) {
      result.push(line);
      if (trimmed === `</${block}>`) block = undefined;
      continue;
    }
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";"))
      continue;
    const opening = /^<([a-z-]+)>$/.exec(trimmed);
    if (opening) {
      if (!blocks.has(opening[1])) throw Error("Unsupported VPN inline block");
      block = opening[1];
      result.push(line);
      continue;
    }
    const name = trimmed.split(/\s+/)[0];
    // Устройство и auth-файл задаёт CLI; пути из экспортированного Connect-профиля не используются.
    if (["dev", "dev-type", "auth-user-pass"].includes(name)) continue;
    if (!allowed.has(name)) throw Error("Unsupported VPN directive in profile");
    if (name === "remote") {
      if (trimmed !== "remote 195.74.82.60 1195 udp4")
        throw Error("Unexpected VPN endpoint");
      remote = true;
    }
    result.push(line);
  }
  if (block || !remote) throw Error("Incomplete VPN profile");
  return result.join("\n") + "\n";
}

/** Запускает команду без shell; секреты передаются только stdin/защищёнными файлами. */
// DOC-PREVIEW:/docs/documents-deployment.md#vpn-script
function command(file, args, { input, signal, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      signal,
      stdio: [
        "pipe",
        quiet ? "ignore" : "inherit",
        quiet ? "ignore" : "inherit",
      ],
    });
    child.once("error", reject);
    child.stdin.on("error", () => {});
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(Error(`${file} exited with code ${code}`)),
    );
    child.stdin.end(input);
  });
}

/** Экранирует один аргумент для удалённого shell, запускаемого SSH. */
// DOC-PREVIEW:/docs/documents-deployment.md#vpn-script
export function shellQuote(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

/** Ждёт подтверждения OpenVPN до SSH; raw log никогда не отправляется в журнал Actions. */
// DOC-PREVIEW:/docs/documents-deployment.md#vpn-script
async function waitVpn(file, signal) {
  for (let attempt = 0; attempt < 120; attempt++) {
    signal.throwIfAborted();
    const log = await readFile(file, "utf8").catch(() => "");
    if (/AUTH_FAILED|Exiting due to fatal error/.test(log))
      throw Error("VPN authentication or configuration failed");
    if (log.includes("Initialization Sequence Completed")) return;
    await delay(1000, undefined, { signal });
  }
  throw Error("VPN connection timeout (120 seconds)");
}

/** Жизненный цикл job: временные secrets → VPN → SSH pull → cleanup при успехе/ошибке/сигнале. */
// DOC-PREVIEW:/docs/documents-deployment.md#vpn-script
export async function deploy(env = process.env) {
  const values = settings(env);
  // Дочерние процессы не наследуют секреты Actions из окружения Node.
  for (const name of [
    "VPN_PROFILE",
    "VPN_USERNAME",
    "VPN_PASSWORD",
    "DEPLOY_SSH_KEY",
    "DEPLOY_KNOWN_HOSTS",
    "GHCR_TOKEN",
  ])
    delete process.env[name];
  const root = await mkdtemp(join(tmpdir(), "marc-documents-deploy-"));
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    const files = {
      "profile.ovpn": values.VPN_PROFILE,
      "auth.txt": values.VPN_USERNAME + "\n" + values.VPN_PASSWORD + "\n",
      "ssh-key": values.DEPLOY_SSH_KEY.trimEnd() + "\n",
      known_hosts: values.DEPLOY_KNOWN_HOSTS.trimEnd() + "\n",
      "vpn.log": "",
      "vpn.pid": "",
    };
    for (const [name, content] of Object.entries(files))
      await writeFile(join(root, name), content, { mode: 0o600 });
    await command(
      "sudo",
      [
        "-n",
        "openvpn",
        "--config",
        join(root, "profile.ovpn"),
        "--dev",
        "tun",
        "--auth-user-pass",
        join(root, "auth.txt"),
        "--auth-nocache",
        "--route-nopull",
        "--route",
        values.DEPLOY_HOST,
        "255.255.255.255",
        "--verb",
        "3",
        "--daemon",
        "marc-documents-vpn",
        "--writepid",
        join(root, "vpn.pid"),
        "--log",
        join(root, "vpn.log"),
      ],
      { signal: abort.signal, quiet: true },
    );
    await waitVpn(join(root, "vpn.log"), abort.signal);
    console.log("VPN connected; delivering image by digest");
    const script = await readFile(
      new URL("./deliver-documents-image.sh", import.meta.url),
      "utf8",
    );
    const remote = [
      "bash",
      "-c",
      script,
      "--",
      values.DEPLOY_IMAGE,
      values.DEPLOY_DIGEST,
      values.DEPLOY_REVISION,
      values.GHCR_USERNAME,
    ]
      .map(shellQuote)
      .join(" ");
    await command(
      "ssh",
      [
        "-i",
        join(root, "ssh-key"),
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "UserKnownHostsFile=" + join(root, "known_hosts"),
        "-o",
        "ConnectTimeout=15",
        "-o",
        "ServerAliveInterval=15",
        "-o",
        "ServerAliveCountMax=3",
        values.DEPLOY_USER + "@" + values.DEPLOY_HOST,
        remote,
      ],
      { input: values.GHCR_TOKEN + "\n", signal: abort.signal },
    );
  } finally {
    try {
      const pid = await readFile(join(root, "vpn.pid"), "utf8").catch(() => "");
      if (/^[1-9][0-9]*\s*$/.test(pid))
        await command("sudo", ["-n", "kill", "-TERM", "--", pid.trim()], {
          quiet: true,
        });
    } finally {
      await rm(root, { recursive: true, force: true });
      process.removeListener("SIGTERM", stop);
      process.removeListener("SIGINT", stop);
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  deploy().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
