import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

/**
 * Оператор запускает этот сценарий на сервере: documents → ready → relations.
 * Вызовы идут через worker, поэтому два задания одного исполнителя не пересекаются.
 * DOC-PREVIEW:/docs/documents-deployment.md#sequence
 */
const { values } = parseArgs({
  options: {
    "documents-container": { type: "string", default: "marc-documents-worker" },
    "relations-container": { type: "string", default: "bib-relations-worker" },
    input: { type: "string" },
    packages: { type: "string" },
    member: { type: "string" },
    "relations-input": { type: "string" },
    "validation-policy": { type: "string", default: "reject" },
  },
});
if (
  (!values.input && !values.packages) ||
  (values.input && values.packages) ||
  !values["relations-input"]
)
  throw Error(
    "Provide --input Z00 or --packages COPY_DIR, and --relations-input Z103",
  );

/** Ошибка Docker или CLI останавливает последовательность; stderr остаётся в терминале. */
function exec(container, args) {
  return new Promise((resolve, reject) => {
    const cli =
      container === values["documents-container"]
        ? "/app/dist/documents-worker-cli.js"
        : "/app/dist/worker-cli.js";
    const child = spawn(
      "docker",
      ["exec", container, "node", cli, ...args.slice(1)],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    let text = "";
    child.stdout.on("data", (chunk) => {
      text += chunk;
      if (text.length > 65536) child.kill("SIGTERM");
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) reject(Error("Container command failed: " + container));
      else {
        try {
          resolve(JSON.parse(text));
        } catch (error) {
          reject(error);
        }
      }
    });
  });
}

/** Ожидает именно свой task.id; смена задачи или failed запрещают следующий этап. */
async function waitTask(container, id) {
  while (true) {
    const state = await exec(container, ["worker", "status"]);
    if (state.task?.id !== id) throw Error("Worker task changed: " + container);
    if (!state.busy) {
      if (state.task.status !== "completed")
        throw Error(
          "Task failed: " + state.task.id + "; inspect " + state.task.log,
        );
      return state.task;
    }
    await delay(2000);
  }
}

const args = [
  "worker",
  "start",
  "--stage",
  values.packages ? "load" : "run",
  "--input",
  values.packages ?? values.input,
];
if (!values.packages)
  args.push("--validation-policy", values["validation-policy"]);
if (values.member) args.push("--member", values.member);
const started = await exec(values["documents-container"], args);
const task = await waitTask(values["documents-container"], started.task.id);
const packages = values.packages ?? task.report + "/copy";
const readyStart = await exec(values["documents-container"], [
  "worker",
  "start",
  "--stage",
  "ready",
  "--input",
  packages,
]);
await waitTask(values["documents-container"], readyStart.task.id);
const relations = await exec(values["relations-container"], [
  "worker",
  "start",
  "--stage",
  "run",
  "--input",
  values["relations-input"],
]);
await waitTask(values["relations-container"], relations.task.id);
console.log(
  JSON.stringify({
    completed: true,
    documentsTask: task.id,
    relationsTask: relations.task.id,
  }),
);
