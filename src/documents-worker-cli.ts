import { parseArgs } from "node:util";
import { request } from "./runtime/control.js";
import { startWorker } from "./runtime/worker.js";

/** server разворачивает исполнителя; остальные команды передают ему одну операцию. */
// DOC-PREVIEW:/docs/documents-code.md#worker-cli · DOC-PREVIEW:/docs/container-commands.md#worker
async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      work: { type: "string", default: "/work" },
      source: { type: "string", default: "/source" },
      env: { type: "string", default: "/run/db.env" },
      image: { type: "string", default: "unknown" },
      stage: { type: "string", default: "run" },
      input: { type: "string" },
      member: { type: "string" },
      library: { type: "string" },
      encoding: { type: "string" },
      format: { type: "string" },
      "validation-policy": { type: "string" },
      "batch-size": { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const [command] = positionals;
  if (positionals.length !== 1)
    throw Error("worker server|start|status|stop|drain|resume");
  if (command === "server") {
    const worker = await startWorker({
      work: values.work,
      source: values.source,
      env: values.env,
      image: values.image,
    });
    console.log(JSON.stringify({ event: "worker_ready", ...worker.state() }));
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void worker
        .close()
        .then(() => {
          process.exitCode = 0;
        })
        .catch((error) => {
          console.error(String(error));
          process.exitCode = 1;
        });
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
  } else {
    if (!["start", "status", "stop", "drain", "resume"].includes(command ?? ""))
      throw Error("Invalid worker command");
    console.log(
      JSON.stringify(
        await request(values.work + "/control/worker.sock", {
          command,
          stage: values.stage,
          input: values.input,
          dryRun: values["dry-run"],
          member: values.member,
          library: values.library,
          encoding: values.encoding,
          format: values.format,
          "validation-policy": values["validation-policy"],
          "batch-size": values["batch-size"],
        }),
      ),
    );
  }
}
main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
