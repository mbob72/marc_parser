import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { open, readFile, mkdir, realpath, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { request, saveJson, serve } from "./control.js";
import { validatePublicationOptions } from "../documents/publish.js";

type Task = {
  id: string;
  stage: string;
  input?: string;
  targetSchema?: string;
  resumePublication?: string;
  batchSize?: number;
  dryRun: boolean;
  image: string;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  status: string;
  log: string;
  report: string;
};
export type WorkerOptions = {
  work: string;
  source: string;
  env: string;
  image: string;
  launch?: (args: string[], fd: number) => ChildProcess;
};

/** Worker не обращается к Docker: запускает один CLI и сохраняет состояние задачи. */
// DOC-PREVIEW:/docs/documents-code.md#worker
export async function startWorker(options: WorkerOptions) {
  const control = join(options.work, "control");
  const reports = join(options.work, "reports");
  await mkdir(control, { recursive: true });
  await mkdir(reports, { recursive: true });
  try {
    await request(join(control, "worker.sock"), { command: "status" });
    throw Error("Worker already running");
  } catch (error) {
    if (
      !["ENOENT", "ECONNREFUSED"].includes(
        String((error as NodeJS.ErrnoException).code),
      )
    )
      throw error;
  }
  const stateFile = join(control, "worker.json");
  let accepting = true;
  let child: ChildProcess | undefined;
  let cancellation: NodeJS.Timeout | undefined;
  let task: Task | undefined;
  let done: Promise<void> = Promise.resolve();
  let operations = Promise.resolve();
  const exclusive = <T>(operation: () => Promise<T>) => {
    const result = operations.then(operation);
    operations = result.then(
      () => {},
      () => {},
    );
    return result;
  };
  const state = () => ({
    image: options.image,
    accepting,
    busy: Boolean(child),
    task,
  });
  const persist = async () => {
    await saveJson(stateFile, state());
    if (task) await saveJson(join(control, task.id + ".json"), task);
  };
  try {
    const previous = JSON.parse(await readFile(stateFile, "utf8"));
    if (previous.task) {
      task = previous.task;
      if (task!.status === "running") {
        task!.status = "interrupted";
        task!.finishedAt = new Date().toISOString();
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await persist();
  const server = await serve(join(control, "worker.sock"), (message) =>
    exclusive(async () => {
      if (message.command === "status") return state();
      if (message.command === "drain") {
        accepting = false;
        await persist();
        return state();
      }
      if (message.command === "resume") {
        accepting = true;
        await persist();
        return state();
      }
      if (message.command === "stop") {
        if (child) {
          const currentChild = child;
          currentChild.kill("SIGTERM");
          if (cancellation) clearTimeout(cancellation);
          cancellation = setTimeout(() => currentChild.kill("SIGKILL"), 30000);
          cancellation.unref();
        }
        return state();
      }
      if (message.command !== "start") throw Error("Unknown worker command");
      if (!accepting) throw Error("Worker is draining for deployment");
      if (child) throw Error("Worker already has an active task");
      const stage = message.stage ?? "run";
      if (
        ![
          "prepare",
          "stage",
          "publish",
          "load",
          "ready",
          "check-db",
          "run",
        ].includes(stage)
      )
        throw Error("Invalid stage");
      if (message.dryRun !== undefined && typeof message.dryRun !== "boolean")
        throw Error("Invalid dryRun");
      let publication:
        | {
            targetSchema?: string;
            resumePublication?: string;
            batchSize?: number;
          }
        | undefined;
      // Допуск публикации предшествует созданию задачи и файлов: источник уже в
      // БД, образ берётся из конфигурации worker, а не из сообщения клиента.
      // DOC-PREVIEW:/docs/bib-publication.md#commands
      if (stage === "publish") {
        for (const key of [
          "input",
          "output",
          "member",
          "library",
          "encoding",
          "format",
          "validation-policy",
          "dryRun",
          "dry-run",
          "start-batch",
          "max-batches",
          "reserve-bytes",
        ])
          if (message[key] !== undefined)
            throw Error("publish does not accept " + key);
        if (
          message.batchSize !== undefined &&
          message["batch-size"] !== undefined
        )
          throw Error("Specify batchSize only once");
        const rawBatch = message.batchSize ?? message["batch-size"];
        if (
          rawBatch !== undefined &&
          typeof rawBatch !== "number" &&
          (typeof rawBatch !== "string" || !/^[1-9]\d*$/.test(rawBatch))
        )
          throw Error("Invalid batchSize");
        publication = {
          targetSchema: message.targetSchema,
          resumePublication: message.resumePublication,
          batchSize:
            rawBatch === undefined
              ? message.resumePublication === undefined
                ? 100000
                : undefined
              : Number(rawBatch),
        };
        validatePublicationOptions({
          ...publication,
          image: options.image,
          report: join(reports, "publication.ndjson"),
        });
      } else if (
        message.targetSchema !== undefined ||
        message.resumePublication !== undefined ||
        message.batchSize !== undefined
      )
        throw Error("Publication options require publish stage");
      let input: string | undefined;
      if (["run", "prepare", "stage", "load", "ready"].includes(stage)) {
        if (typeof message.input !== "string") throw Error("Input required");
        input = resolve(message.input);
        const root = ["stage", "load", "ready"].includes(stage)
          ? options.work
          : options.source;
        if (!input.startsWith(resolve(root) + "/"))
          throw Error("Input must be under selected mount");
        const physical = await realpath(input);
        if (
          !physical.startsWith((await realpath(root)) + "/") ||
          !(stage === "stage"
            ? (await stat(physical)).isDirectory() ||
              (await stat(physical)).isFile()
            : ["load", "ready"].includes(stage)
              ? (await stat(physical)).isDirectory()
              : (await stat(physical)).isFile())
        )
          throw Error("Invalid input under selected mount");
      }
      const id =
        new Date().toISOString().replace(/[:.]/g, "-") +
        "-" +
        randomUUID().slice(0, 8);
      const report = join(reports, id);
      const args = [stage, "--env", options.env];
      if (publication) {
        args.push("--image", options.image, "--report", report + ".ndjson");
        if (publication.targetSchema !== undefined)
          args.push("--target-schema", publication.targetSchema);
        if (publication.resumePublication !== undefined)
          args.push("--resume-publication", publication.resumePublication);
        if (publication.batchSize !== undefined)
          args.push("--batch-size", String(publication.batchSize));
      }
      if (input) args.push("--input", input);
      if (["prepare", "run"].includes(stage)) {
        args.push("--output", report);
        for (const key of [
          "member",
          "library",
          "encoding",
          "format",
          "validation-policy",
          "batch-size",
        ] as const) {
          if (message[key] !== undefined) {
            if (typeof message[key] !== "string") throw Error("Invalid " + key);
            args.push("--" + key, message[key]);
          }
        }
      }
      if (["stage", "load"].includes(stage))
        args.push("--report", report + ".ndjson");
      task = {
        id,
        stage,
        input,
        ...publication,
        dryRun: message.dryRun ?? false,
        image: options.image,
        startedAt: new Date().toISOString(),
        status: "running",
        log: report + ".log",
        report,
      };
      if (task.dryRun) args.push("--dry-run");
      const log = await open(task.log, "wx", 0o600);
      try {
        // Сначала durable-состояние, затем процесс: после аварии задача помечается interrupted.
        await persist();
        child = options.launch
          ? options.launch(args, log.fd)
          : spawn(process.execPath, ["/app/dist/documents-cli.js", ...args], {
              stdio: ["ignore", log.fd, log.fd],
            });
        const current = task;
        let launchError: string | undefined;
        child.on("error", (error) => {
          launchError = error.message;
        });
        done = new Promise<void>((resolveDone) => {
          child!.once("close", (code, signal) => {
            void exclusive(async () => {
              current.finishedAt = new Date().toISOString();
              current.exitCode = code;
              current.signal = signal;
              current.status = launchError
                ? "failed"
                : signal
                  ? "cancelled"
                  : code === 0
                    ? "completed"
                    : "failed";
              await log.close();
              // busy сбрасывается только после сохранения итогового состояния и закрытия лога.
              await saveJson(join(control, current.id + ".json"), current);
              if (cancellation) clearTimeout(cancellation);
              child = undefined;
              await persist();
            })
              .catch((error) => {
                accepting = false;
                console.error(
                  JSON.stringify({
                    event: "worker_state_error",
                    message: String(error),
                  }),
                );
              })
              .finally(resolveDone);
          });
        });
        await persist();
        return state();
      } catch (error) {
        await log.close();
        if (child) {
          child.kill("SIGTERM");
          accepting = false;
        } else {
          task.status = "failed";
          await persist();
        }
        throw error;
      }
    }),
  );
  return {
    state,
    async close() {
      await exclusive(async () => {
        accepting = false;
        if (child) {
          const currentChild = child;
          currentChild.kill("SIGTERM");
          if (cancellation) clearTimeout(cancellation);
          cancellation = setTimeout(() => currentChild.kill("SIGKILL"), 30000);
          cancellation.unref();
        }
      });
      await done;
      await server.close();
    },
  };
}
