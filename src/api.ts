import multipart from "@fastify/multipart";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
} from "fastify";
import iconv from "iconv-lite";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import type { ConversionJob, ServiceMarcFormat } from "./job.js";
import {
  CONVERSION_DIRECTIONS,
  DEFAULT_SERVICE_MARC_FORMAT,
  SERVICE_MARC_FORMATS,
  type ConversionDirection,
} from "./job.js";
import { JobDatabase } from "./job-database.js";
import { JobGarbageCollector } from "./job-garbage-collector.js";
import { JobQueue } from "./job-queue.js";
import { ObjectStore } from "./object-store.js";
import { loadServiceConfig } from "./service-config.js";

interface ApiDependencies {
  readonly database: Pick<
    JobDatabase,
    "ping" | "createJob" | "getJob" | "markFailed"
  >;
  readonly queue: Pick<JobQueue, "publish">;
  readonly objectStore: Pick<ObjectStore, "put" | "get" | "remove">;
  readonly garbageCollector: Pick<
    JobGarbageCollector,
    "collect" | "deleteJob"
  >;
  readonly maxUploadBytes: number;
  readonly logger?: boolean;
}

const GARBAGE_COLLECTION_INTERVAL_MS = 12 * 60 * 60 * 1000;

class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export async function buildApi(
  dependencies: ApiDependencies,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: dependencies.logger ?? true });

  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: dependencies.maxUploadBytes,
      fields: 10,
      parts: 11,
    },
  });

  app.get("/health", async () => {
    await dependencies.database.ping();
    return { status: "ok" };
  });

  app.post("/maintenance/cleanup", async () => {
    return dependencies.garbageCollector.collect();
  });

  app.post("/jobs", async (request, reply) => {
    const jobId = randomUUID();
    const inputObjectKey = `inputs/${jobId}`;
    let encoding = "utf-8";
    let direction: ConversionDirection = "iso-to-json";
    let inputFormat: ServiceMarcFormat = DEFAULT_SERVICE_MARC_FORMAT;
    let originalFilename: string | null = null;
    let inputBytes = 0;
    let fileWasUploaded = false;
    let fileUploadStarted = false;
    let uploadDirectory: string | null = null;

    try {
      for await (const part of request.parts()) {
        if (part.type === "field") {
          if (part.fieldname === "encoding") {
            encoding = String(part.value);
          }
          if (part.fieldname === "direction") {
            direction = parseDirection(String(part.value));
          }
          if (part.fieldname === "format") {
            inputFormat = parseInputFormat(String(part.value));
          }
          continue;
        }

        if (part.fieldname !== "file" || fileWasUploaded) {
          part.file.resume();
          throw new ApiError(
            400,
            "Ожидается ровно один файл в поле file.",
          );
        }

        originalFilename = part.filename || "records.dat";
        fileUploadStarted = true;

        uploadDirectory = await mkdtemp(join(tmpdir(), `marc-upload-${jobId}-`));
        const uploadPath = join(uploadDirectory, "input.mrc");
        const byteCounter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            inputBytes += chunk.length;
            callback(null, chunk);
          },
        });
        await pipeline(
          part.file,
          byteCounter,
          createWriteStream(uploadPath, { flags: "wx" }),
        );

        if (part.file.truncated) {
          throw new ApiError(
            413,
            `Размер файла превышает лимит ${dependencies.maxUploadBytes} байт.`,
          );
        }

        await dependencies.objectStore.put(
          inputObjectKey,
          createReadStream(uploadPath),
          {
            "Content-Type": part.mimetype || "application/octet-stream",
          },
          inputBytes,
        );
        fileWasUploaded = true;
      }

      if (!fileWasUploaded || !originalFilename) {
        throw new ApiError(400, "Файл в поле file не передан.");
      }

      assertSupportedEncoding(encoding, direction);

      const job = await dependencies.database.createJob({
        id: jobId,
        originalFilename,
        encoding,
        direction,
        inputFormat,
        inputObjectKey,
        inputBytes,
      });

      try {
        await dependencies.queue.publish({ jobId, attempt: 1 });
      } catch (error) {
        const message = `Не удалось поставить задание в очередь: ${errorMessage(error)}`;
        await dependencies.database.markFailed(jobId, message);
        return reply.code(503).send({ jobId, status: "failed", error: message });
      }

      return reply.code(202).send(toPublicJob(job));
    } catch (error) {
      if (fileUploadStarted) {
        await dependencies.objectStore.remove(inputObjectKey).catch(() => {});
      }
      throw error;
    } finally {
      if (uploadDirectory) {
        await rm(uploadDirectory, { recursive: true, force: true });
      }
    }
  });

  app.get<{ Params: { jobId: string } }>(
    "/jobs/:jobId",
    async (request, reply) => {
      const job = await findJob(dependencies.database, request.params.jobId, reply);

      if (!job) {
        return;
      }

      return toPublicJob(job);
    },
  );

  app.delete<{ Params: { jobId: string } }>(
    "/jobs/:jobId",
    async (request, reply) => {
      if (!isUuid(request.params.jobId)) {
        return reply.code(400).send({ error: "Некорректный jobId." });
      }

      const result = await dependencies.garbageCollector.deleteJob(
        request.params.jobId,
      );

      if (result === "not-found") {
        return reply.code(404).send({ error: "Задание не найдено." });
      }
      if (result === "not-finished") {
        return reply.code(409).send({
          error: "Можно удалить только завершённое или упавшее задание.",
        });
      }

      return reply.code(204).send();
    },
  );

  app.get<{ Params: { jobId: string } }>(
    "/jobs/:jobId/result",
    async (request, reply) => {
      const job = await findJob(dependencies.database, request.params.jobId, reply);

      if (!job) {
        return;
      }

      if (job.status !== "completed" || !job.outputObjectKey) {
        return reply.code(409).send({
          error: "Результат ещё не готов.",
          status: job.status,
        });
      }

      const stream = await dependencies.objectStore.get(job.outputObjectKey);
      const filename = job.outputFilename ?? `${job.id}.json`;

      reply.header(
        "Content-Type",
        resultContentType(filename),
      );
      reply.header(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      );
      return reply.send(stream);
    },
  );

  app.setErrorHandler((error, _request, reply) => {
    const errorStatusCode = statusCodeFrom(error);
    const statusCode =
      error instanceof ApiError
        ? error.statusCode
        : (errorStatusCode ?? 500);

    if (statusCode >= 500) {
      app.log.error(error);
    }

    reply.code(statusCode).send({
      error:
        statusCode >= 500
          ? "Внутренняя ошибка сервера."
          : errorMessage(error),
    });
  });

  return app;
}

export function resultContentType(filename: string): string {
  const normalized = filename.toLowerCase();
  if (normalized.endsWith(".json")) {
    return "application/x-ndjson; charset=utf-8";
  }
  return normalized.endsWith(".dat")
    ? "application/octet-stream"
    : "application/marc";
}

async function findJob(
  database: Pick<JobDatabase, "getJob">,
  jobId: string,
  reply: FastifyReply,
): Promise<ConversionJob | null> {
  if (!isUuid(jobId)) {
    void reply.code(400).send({ error: "Некорректный jobId." });
    return null;
  }

  const job = await database.getJob(jobId);

  if (!job) {
    void reply.code(404).send({ error: "Задание не найдено." });
    return null;
  }

  return job;
}

function toPublicJob(job: ConversionJob): Record<string, unknown> {
  return {
    jobId: job.id,
    status: job.status,
    filename: job.originalFilename,
    encoding: job.encoding,
    direction: job.direction,
    format: job.inputFormat,
    inputBytes: job.inputBytes,
    summary: job.summary,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    expiresAt: job.expiresAt,
    ...(job.status === "completed"
      ? { resultUrl: `/jobs/${job.id}/result` }
      : {}),
  };
}

function parseDirection(value: string): ConversionDirection {
  if (
    CONVERSION_DIRECTIONS.includes(value as ConversionDirection)
  ) {
    return value as ConversionDirection;
  }
  throw new ApiError(
    400,
    `Направление ${JSON.stringify(value)} не поддерживается.`,
  );
}

function parseInputFormat(value: string): ServiceMarcFormat {
  if (SERVICE_MARC_FORMATS.includes(value as ServiceMarcFormat)) {
    return value as ServiceMarcFormat;
  }
  throw new ApiError(
    400,
    `Формат ${JSON.stringify(value)} не поддерживается. Ожидается aleph-sequential или iso2709.`,
  );
}

function assertSupportedEncoding(
  encoding: string,
  direction: ConversionDirection,
): void {
  if (direction === "json-to-iso" && !iconv.encodingExists(encoding)) {
    throw new ApiError(
      400,
      `Кодировка ${JSON.stringify(encoding)} не поддерживается.`,
    );
  }

  try {
    new TextDecoder(encoding);
  } catch {
    throw new ApiError(
      400,
      `Кодировка ${JSON.stringify(encoding)} не поддерживается.`,
    );
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function statusCodeFrom(error: unknown): number | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  ) {
    return error.statusCode;
  }

  return null;
}

async function main(): Promise<void> {
  const config = loadServiceConfig();
  const database = new JobDatabase(config.postgresUrl);
  const objectStore = new ObjectStore(config.minio);
  const garbageCollector = new JobGarbageCollector(database, objectStore);
  let queue: JobQueue | null = null;
  let app: FastifyInstance | null = null;
  let garbageCollectionTimer: NodeJS.Timeout | null = null;

  try {
    await database.initialize();
    await objectStore.initialize();
    queue = await JobQueue.connect(config.rabbitmqUrl, config.queueName);
    app = await buildApi({
      database,
      queue,
      objectStore,
      garbageCollector,
      maxUploadBytes: config.maxUploadBytes,
    });

    const collectGarbage = async (): Promise<void> => {
      try {
        const result = await garbageCollector.collect();
        app?.log.info(result, "Сборка мусора завершена");
      } catch (error) {
        app?.log.error(error, "Не удалось выполнить сборку мусора");
      }
    };
    await collectGarbage();
    garbageCollectionTimer = setInterval(
      () => void collectGarbage(),
      GARBAGE_COLLECTION_INTERVAL_MS,
    );
    garbageCollectionTimer.unref();

    const shutdown = async (): Promise<void> => {
      if (garbageCollectionTimer) {
        clearInterval(garbageCollectionTimer);
      }
      await app?.close();
      await queue?.close();
      await database.close();
    };

    process.once("SIGINT", () => void shutdown());
    process.once("SIGTERM", () => void shutdown());

    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    console.error(error);
    await app?.close().catch(() => {});
    await queue?.close().catch(() => {});
    await database.close().catch(() => {});
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
