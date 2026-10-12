import { parseArgs } from "node:util";
import { isAbsolute } from "node:path";
import { request, serve } from "./runtime/control.js";
import { createDeployer } from "./runtime/deployer.js";

/**
 * watch доставляет образы; start явно запускает локальную версию, status/versions читают Docker.
 * DOC-PREVIEW:/docs/documents-deployment.md#runtime
 */
async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      registry: { type: "string", default: "ghcr.io" },
      repository: {
        type: "string",
        default: undefined,
      },
      tag: { type: "string", default: "documents-main" },
      anonymous: { type: "boolean", default: false },
      version: { type: "string", default: "latest" },
      control: { type: "string", default: "/control" },
      "config-file": { type: "string", default: "/docker-config/config.json" },
      "work-dir": { type: "string" },
      "source-dir": { type: "string" },
      "env-file": { type: "string" },
      uid: { type: "string" },
      gid: { type: "string" },
      "worker-name": { type: "string", default: "marc-documents-worker" },
      cpu: { type: "string", default: "1" },
      memory: { type: "string", default: "536870912" },
      interval: { type: "string", default: "60" },
    },
  });
  const [command] = positionals;
  if (
    positionals.length !== 1 ||
    !["watch", "status", "update", "versions", "start"].includes(command ?? "")
  )
    throw Error(
      "deploy watch|status|update|versions|start [--version latest|previous|previous-2]",
    );
  const socket = values.control + "/deploy.sock";
  if (command !== "watch") {
    console.log(
      JSON.stringify(
        await request(socket, { command, version: values.version }),
      ),
    );
    return;
  }
  if (!values.repository)
    throw Error("--repository required: Registry path of this project");
  // Хостовые пути и настройки watch: DOC-PREVIEW:/docs/documents-deployment.md#setup
  for (const key of ["work-dir", "source-dir", "env-file"] as const)
    if (!values[key] || !isAbsolute(values[key]!) || values[key]!.includes(":"))
      throw Error("Invalid --" + key);
  const uid = Number(values.uid),
    gid = Number(values.gid),
    cpu = Number(values.cpu),
    memory = Number(values.memory),
    interval = Number(values.interval);
  if (
    !Number.isInteger(uid) ||
    uid < 1 ||
    !Number.isInteger(gid) ||
    gid < 1 ||
    !Number.isFinite(cpu) ||
    cpu <= 0 ||
    !Number.isInteger(memory) ||
    memory < 134217728 ||
    !Number.isInteger(interval) ||
    interval < 10
  )
    throw Error("Invalid resource/user/interval settings");
  if (
    !/^[a-z0-9.-]+(?::\d+)?$/.test(values.registry) ||
    !/^[a-z0-9/_-]+$/.test(values.repository) ||
    !/^[\w.-]+$/.test(values.tag) ||
    !/^[a-z0-9_-]+$/.test(values["worker-name"])
  )
    throw Error("Invalid registry/name");
  const deployer = await createDeployer({
    registry: values.registry,
    repository: values.repository,
    tag: values.tag,
    control: values.control,
    configFile: values["config-file"],
    anonymous: values.anonymous,
    workDir: values["work-dir"]!,
    sourceDir: values["source-dir"]!,
    envFile: values["env-file"]!,
    uid,
    gid,
    workerName: values["worker-name"],
    cpu,
    memory,
  });
  // Сокет, периодический опрос и ожидание при остановке: DOC-PREVIEW:/docs/documents-deployment.md#runtime
  const server = await serve(socket, async (message) => {
    if (message.command === "status") return deployer.status();
    if (message.command === "versions") return deployer.versions();
    if (message.command === "start") return deployer.start(message.version);
    if (message.command === "update") {
      void deployer.update();
      return { requested: true };
    }
    throw Error("Unknown deployment command");
  });
  const timer = setInterval(() => void deployer.update(), interval * 1000);
  void deployer.update();
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    void deployer
      .settled()
      .then(() => server.close())
      .catch((error) => {
        console.error(String(error));
        process.exitCode = 1;
      });
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
