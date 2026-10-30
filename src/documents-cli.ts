import { parseArgs, parseEnv } from "node:util";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { databaseClient } from "./documents/database.js";
import { requireDocuments, requireIdentities } from "./documents/schema.js";
import { prepareDocuments } from "./documents/prepare.js";
import { prepareCopy } from "./documents/copy-packages.js";
import { loadCopy } from "./documents/load-copy.js";
import { stageBibRecords } from "./documents/stage.js";
import { verifyReady } from "./documents/ready.js";
import { saveJson } from "./runtime/control.js";
import {
  publishBibliographicRecords,
  validatePublicationOptions,
} from "./documents/publish.js";

/** Публикация берёт уже разобранные БЗ из БД; старые файловые опции здесь не
 * принимаются. Исполнитель владеет журналом и подключениями, CLI — сигналами.
 * DOC-PREVIEW:/docs/bib-publication.md#commands */
export async function documentsPublishMain(
  args: string[],
  publish: typeof publishBibliographicRecords = publishBibliographicRecords,
) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "target-schema": { type: "string" },
      "resume-publication": { type: "string" },
      "batch-size": { type: "string" },
      image: {
        type: "string",
        default: process.env.DOCUMENTS_IMAGE ?? "unknown",
      },
      report: { type: "string" },
      env: { type: "string", default: ".env" },
    },
  });
  if (positionals.length || !values.report)
    throw Error("documents publish requires --report");
  if (
    values["batch-size"] !== undefined &&
    !/^[1-9]\d*$/.test(values["batch-size"])
  )
    throw Error("Invalid --batch-size");
  const options = {
    targetSchema: values["target-schema"],
    resumePublication: values["resume-publication"],
    batchSize:
      values["batch-size"] === undefined
        ? undefined
        : Number(values["batch-size"]),
    image: values.image,
    report: resolve(values.report),
  };
  validatePublicationOptions(options);
  // Только DB_*: прочие параметры файла не меняют окружение публикации.
  const env = parseEnv(await readFile(values.env, "utf8"));
  for (const [key, value] of Object.entries(env))
    if (key.startsWith("DB_")) process.env[key] = value;
  const controller = new AbortController();
  const stop = () => controller.abort(Error("Publication stopped by signal"));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    const result = await publish({
      ...options,
      signal: controller.signal,
      progress: (event) => console.error(JSON.stringify(event)),
    });
    controller.signal.throwIfAborted();
    if (result !== undefined) console.log(JSON.stringify(result));
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
  }
}

/**
 * CLI связывает подготовку, COPY, загрузку и проверку; .env загружается только для БД.
 * DOC-PREVIEW:/docs/documents-import.md#commands · DOC-PREVIEW:/docs/container-commands.md#documents · DOC-PREVIEW:/docs/documents-server-run.md#run
 */
export async function documentsMain(args = process.argv.slice(2)) {
  // Отдельный parser запрещает случайное смешение публикации с повторным чтением DAT.
  // DOC-PREVIEW:/docs/bib-publication.md#commands
  if (args[0] === "publish") return documentsPublishMain(args.slice(1));
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      input: { type: "string" },
      output: { type: "string" },
      report: { type: "string" },
      env: { type: "string", default: ".env" },
      member: { type: "string" },
      encoding: { type: "string", default: "utf-8" },
      format: { type: "string", default: "aleph-sequential" },
      library: { type: "string", default: "RSL01" },
      "batch-size": { type: "string", default: "50000" },
      "validation-policy": { type: "string", default: "reject" },
      "dry-run": { type: "boolean", default: false },
      "start-batch": { type: "string" },
      "max-batches": { type: "string" },
      "reserve-bytes": { type: "string", default: "2147483648" },
    },
  });
  const command = positionals[0];
  if (positionals.length !== 1)
    throw Error(
      "documents help|check-db|prepare|prepare-copy|stage|publish|load|ready|run",
    );
  if (command === "help") {
    console.log(
      "documents check-db | prepare --input Z00 --output DIR [--member rsl01_z00.dat] | stage --input NDJSON_DIR_OR_PLAN_JSON --report FILE [--dry-run] | publish --target-schema SCHEMA --image PINNED --report FILE [--batch-size 1..100000] [--resume-publication UUID] | prepare-copy --input NDJSON_DIR --output COPY_DIR | load --input COPY_DIR --report FILE [--dry-run] | ready --input COPY_DIR | run --input Z00 --output DIR [--member NAME] [--dry-run]\nDefaults: library=RSL01, format=aleph-sequential, encoding=utf-8, batch-size=50000 (publish=100000), validation-policy=reject, env=.env",
    );
    return;
  }
  if (
    ![
      "check-db",
      "prepare",
      "prepare-copy",
      "stage",
      "load",
      "ready",
      "run",
    ].includes(command!)
  )
    throw Error("Unknown documents command");
  if (["check-db", "stage", "load", "ready", "run"].includes(command!)) {
    // Только DB_*: остальные параметры .env не меняют окружение исполнителя.
    const env = parseEnv(await readFile(values.env, "utf8"));
    for (const [key, value] of Object.entries(env))
      if (key.startsWith("DB_")) process.env[key] = value;
  }
  if (command === "check-db") {
    const client = databaseClient();
    client.on("error", () => {});
    try {
      await client.connect();
      await requireDocuments(client);
      await requireIdentities(client);
      console.log(
        JSON.stringify({
          ready: true,
          target: "public.documents",
          identities: "import.bib_ids",
        }),
      );
    } finally {
      await client.end().catch(() => {});
    }
    return;
  }
  if (!values.input) throw Error("--input required");
  const input = resolve(values.input);
  if (command === "stage") {
    if (!values.report) throw Error("--report required");
    await stageBibRecords({
      input,
      report: resolve(values.report),
      dryRun: values["dry-run"],
    });
    return;
  }
  if (command === "load") {
    if (!values.report) throw Error("--report required");
    await loadCopy({
      input,
      report: resolve(values.report),
      dryRun: values["dry-run"],
      startBatch:
        values["start-batch"] === undefined
          ? undefined
          : Number(values["start-batch"]),
      maxBatches:
        values["max-batches"] === undefined
          ? undefined
          : Number(values["max-batches"]),
    });
    return;
  }
  if (command === "ready") {
    console.log(JSON.stringify(await verifyReady(input)));
    return;
  }
  if (!values.output) throw Error("--output required");
  const output = resolve(values.output);
  const reserve = Number(values["reserve-bytes"]);
  if (!Number.isSafeInteger(reserve) || reserve < 0)
    throw Error("Invalid disk reserve");
  if (command === "prepare-copy") {
    await prepareCopy(input, output, undefined, reserve);
    return;
  }
  if (
    !["aleph-sequential", "iso2709"].includes(values.format) ||
    !["reject", "preserve"].includes(values["validation-policy"])
  )
    throw Error("Invalid format/validation policy");
  if (command === "run") await mkdir(output);
  const sourceOutput = command === "run" ? join(output, "source") : output;
  await prepareDocuments({
    input,
    output: sourceOutput,
    libraryCode: values.library,
    encoding: values.encoding,
    format: values.format as "aleph-sequential" | "iso2709",
    member: values.member,
    batchSize: Number(values["batch-size"]),
    validationPolicy: values["validation-policy"] as "reject" | "preserve",
  });
  if (command === "prepare") return;
  const copyOutput = join(output, "copy");
  await prepareCopy(sourceOutput, copyOutput, undefined, reserve);
  await loadCopy({
    input: copyOutput,
    report: join(output, "load.ndjson"),
    dryRun: values["dry-run"],
  });
  if (!values["dry-run"])
    await saveJson(join(output, "ready.json"), await verifyReady(copyOutput));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  documentsMain().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
