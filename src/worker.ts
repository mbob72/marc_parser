import type { ConsumeMessage } from "amqplib";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import type { ConversionJobMessage, JobSummary } from "./job.js";
import { JobDatabase } from "./job-database.js";
import { JobQueue } from "./job-queue.js";
import { convertMarcFile } from "./marc-file-converter.js";
import { convertMarcJsonFile } from "./marc-json-file-converter.js";
import { NullMarcProcessingLogger } from "./marc-processing-logger.js";
import { ObjectStore } from "./object-store.js";
import { loadServiceConfig } from "./service-config.js";

async function main(): Promise<void> {
  const config = loadServiceConfig();
  const database = new JobDatabase(config.postgresUrl);
  const objectStore = new ObjectStore(config.minio);
  let queue: JobQueue | null = null;

  try {
    await database.initialize();
    await objectStore.initialize();
    queue = await JobQueue.connect(config.rabbitmqUrl, config.queueName);

    const activeQueue = queue;
    await activeQueue.consume(
      config.workerConcurrency,
      async (message, rawMessage) => {
        await handleMessage(
          message,
          rawMessage,
          database,
          objectStore,
          activeQueue,
          config.maxAttempts,
        );
      },
    );

    console.log(
      `Worker запущен: queue=${config.queueName}, concurrency=${config.workerConcurrency}`,
    );

    const shutdown = async (): Promise<void> => {
      await activeQueue.close();
      await database.close();
    };

    process.once("SIGINT", () => void shutdown());
    process.once("SIGTERM", () => void shutdown());
  } catch (error) {
    console.error(error);
    await queue?.close().catch(() => {});
    await database.close().catch(() => {});
    process.exitCode = 1;
  }
}

export async function handleMessage(
  message: ConversionJobMessage,
  rawMessage: ConsumeMessage,
  database: Pick<
    JobDatabase,
    | "getJob"
    | "markProcessing"
    | "markQueuedForRetry"
    | "markCompleted"
    | "markFailed"
  >,
  objectStore: Pick<ObjectStore, "get" | "put">,
  queue: Pick<JobQueue, "publish" | "acknowledge" | "reject">,
  maxAttempts: number,
): Promise<void> {
  if (
    !isUuid(message.jobId) ||
    !Number.isSafeInteger(message.attempt) ||
    message.attempt < 1
  ) {
    queue.reject(rawMessage);
    return;
  }

  const job = await database.getJob(message.jobId);

  if (!job || job.status === "completed") {
    queue.acknowledge(rawMessage);
    return;
  }

  try {
    await database.markProcessing(job.id);
    const directory = await mkdtemp(join(tmpdir(), `marc-job-${job.id}-`));

    try {
      const inputPath = join(
        directory,
        job.direction === "json-to-iso" ? "input.json" : "input.mrc",
      );
      const requestedOutputPath = join(
        directory,
        job.direction === "json-to-iso" ? "result.mrc" : "result.json",
      );
      await pipeline(
        await objectStore.get(job.inputObjectKey),
        createWriteStream(inputPath, { flags: "wx" }),
      );

      const convert =
        job.direction === "json-to-iso"
          ? convertMarcJsonFile
          : convertMarcFile;
      const conversionSummary = await convert({
        encoding: job.encoding,
        inputPath,
        outputPath: requestedOutputPath,
        logger: new NullMarcProcessingLogger(),
      });
      const outputExtension =
        job.direction === "json-to-iso" ? ".mrc" : ".json";
      const outputObjectKey = `outputs/${job.id}${outputExtension}`;
      const outputFilename = createOutputFilename(
        job.originalFilename,
        outputExtension,
      );
      const outputStatistics = await stat(conversionSummary.outputPath);

      await objectStore.put(
        outputObjectKey,
        createReadStream(conversionSummary.outputPath),
        {
          "Content-Type":
            job.direction === "json-to-iso"
              ? "application/marc"
              : "application/x-ndjson; charset=utf-8",
        },
        outputStatistics.size,
      );

      const { outputPath: _outputPath, ...summary } = conversionSummary;
      await database.markCompleted(
        job.id,
        outputObjectKey,
        outputFilename,
        summary satisfies JobSummary,
      );
      queue.acknowledge(rawMessage);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } catch (error) {
    const reason = errorMessage(error);

    if (message.attempt < maxAttempts) {
      await database.markQueuedForRetry(job.id, reason);
      await queue.publish({
        jobId: job.id,
        attempt: message.attempt + 1,
      });
      queue.acknowledge(rawMessage);
      return;
    }

    await database.markFailed(job.id, reason);
    queue.reject(rawMessage);
  }
}

function createOutputFilename(
  inputFilename: string,
  outputExtension: ".json" | ".mrc",
): string {
  const safeBasename = basename(inputFilename).replace(/[\r\n"]/g, "_");
  const extension = extname(safeBasename);
  const stem = extension
    ? safeBasename.slice(0, -extension.length)
    : safeBasename;

  return `${stem || "result"}${outputExtension}`;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 10_000);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
