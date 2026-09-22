import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { buildApi, resultContentType } from "../src/api.ts";
import type { ConversionJob, ConversionJobMessage } from "../src/job.ts";

test("POST /jobs сохраняет файл и публикует задание", async (context) => {
  const uploaded = new Map<string, Buffer>();
  const published: ConversionJobMessage[] = [];
  let currentJob: ConversionJob | null = null;
  const app = await buildApi({
    logger: false,
    maxUploadBytes: 1024,
    garbageCollector: noopGarbageCollector(),
    database: {
      async ping() {},
      async createJob(input) {
        currentJob = {
          id: input.id,
          status: "queued",
          originalFilename: input.originalFilename,
          encoding: input.encoding,
          direction: input.direction,
          inputFormat: input.inputFormat,
          inputObjectKey: input.inputObjectKey,
          inputBytes: input.inputBytes,
          outputObjectKey: null,
          outputFilename: null,
          summary: null,
          error: null,
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-01-01T00:00:00Z"),
          expiresAt: new Date("2026-01-02T00:00:00Z"),
        };
        return currentJob;
      },
      async getJob() {
        return currentJob;
      },
      async markFailed() {},
    },
    queue: {
      async publish(message) {
        published.push(message);
      },
    },
    objectStore: {
      async put(key, stream) {
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(Buffer.from(chunk));
        }
        uploaded.set(key, Buffer.concat(chunks));
      },
      async get() {
        return Readable.from("[]");
      },
      async remove(key) {
        uploaded.delete(key);
      },
    },
  });
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/jobs",
    headers: {
      "content-type": "multipart/form-data; boundary=marc-boundary",
    },
    payload: createMultipartBody("marc-boundary", Buffer.from("record")),
  });

  assert.equal(response.statusCode, 202);
  const body = response.json();
  assert.equal(body.status, "queued");
  assert.equal(body.filename, "records.mrc");
  assert.equal(body.encoding, "utf-8");
  assert.equal(body.direction, "iso-to-json");
  assert.equal(body.format, "aleph-sequential");
  assert.equal(body.inputBytes, 6);
  assert.match(body.jobId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(published, [{ jobId: body.jobId, attempt: 1 }]);
  assert.deepEqual(
    [...uploaded.entries()],
    [[`inputs/${body.jobId}`, Buffer.from("record")]],
  );
});

test("POST /jobs удаляет загрузку при неподдерживаемой кодировке", async (context) => {
  const removed: string[] = [];
  const app = await buildApi({
    logger: false,
    maxUploadBytes: 1024,
    garbageCollector: noopGarbageCollector(),
    database: {
      async ping() {},
      async createJob() {
        throw new Error("createJob не должен вызываться");
      },
      async getJob() {
        return null;
      },
      async markFailed() {},
    },
    queue: { async publish() {} },
    objectStore: {
      async put(_key, stream) {
        for await (const _chunk of stream) {
          // Consume the upload exactly as an object store would.
        }
      },
      async get() {
        return Readable.from("[]");
      },
      async remove(key) {
        removed.push(key);
      },
    },
  });
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/jobs",
    headers: {
      "content-type": "multipart/form-data; boundary=marc-boundary",
    },
    payload: createMultipartBody(
      "marc-boundary",
      Buffer.from("record"),
      "definitely-not-an-encoding",
    ),
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /не поддерживается/);
  assert.equal(removed.length, 1);
});

test("POST /jobs передаёт направление JSON → ISO в задание", async (context) => {
  let createdDirection: string | null = null;
  const app = await buildApi({
    logger: false,
    maxUploadBytes: 1024,
    garbageCollector: noopGarbageCollector(),
    database: {
      async ping() {},
      async createJob(input) {
        createdDirection = input.direction;
        return {
          ...input,
          status: "queued" as const,
          outputObjectKey: null,
          outputFilename: null,
          summary: null,
          error: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        };
      },
      async getJob() {
        return null;
      },
      async markFailed() {},
    },
    queue: { async publish() {} },
    objectStore: {
      async put(_key, stream) {
        for await (const _chunk of stream) {
          // Consume upload.
        }
      },
      async get() {
        return Readable.from("");
      },
      async remove() {},
    },
  });
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/jobs",
    headers: {
      "content-type": "multipart/form-data; boundary=marc-boundary",
    },
    payload: createMultipartBody(
      "marc-boundary",
      Buffer.from("{}\n"),
      "utf-8",
      "json-to-iso",
    ),
  });

  assert.equal(response.statusCode, 202);
  assert.equal(response.json().direction, "json-to-iso");
  assert.equal(createdDirection, "json-to-iso");
});

test("POST /jobs принимает явный формат ISO 2709", async (context) => {
  let createdFormat: string | null = null;
  const app = await buildApi({
    logger: false,
    maxUploadBytes: 1024,
    garbageCollector: noopGarbageCollector(),
    database: {
      async ping() {},
      async createJob(input) {
        createdFormat = input.inputFormat;
        return {
          ...input,
          status: "queued" as const,
          outputObjectKey: null,
          outputFilename: null,
          summary: null,
          error: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        };
      },
      async getJob() { return null; },
      async markFailed() {},
    },
    queue: { async publish() {} },
    objectStore: {
      async put(_key, stream) { for await (const _chunk of stream) {} },
      async get() { return Readable.from(""); },
      async remove() {},
    },
  });
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/jobs",
    headers: { "content-type": "multipart/form-data; boundary=marc-boundary" },
    payload: createMultipartBody(
      "marc-boundary",
      Buffer.from("record"),
      "utf-8",
      undefined,
      "iso2709",
    ),
  });

  assert.equal(response.statusCode, 202);
  assert.equal(response.json().format, "iso2709");
  assert.equal(createdFormat, "iso2709");
});

test("выбирает MIME результата по контейнеру", () => {
  assert.equal(
    resultContentType("records.aleph.json"),
    "application/x-ndjson; charset=utf-8",
  );
  assert.equal(resultContentType("records.mrc"), "application/marc");
  assert.equal(resultContentType("records.dat"), "application/octet-stream");
});

test("POST /maintenance/cleanup запускает сборщик", async (context) => {
  let cleanupWasCalled = false;
  const app = await buildApi({
    logger: false,
    maxUploadBytes: 1024,
    database: unavailableDatabase(),
    queue: { async publish() {} },
    objectStore: unavailableObjectStore(),
    garbageCollector: {
      async collect() {
        cleanupWasCalled = true;
        return { scanned: 3, deleted: 2, failed: 1 };
      },
      async deleteJob() { return "not-found"; },
    },
  });
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/maintenance/cleanup",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(cleanupWasCalled, true);
  assert.deepEqual(response.json(), { scanned: 3, deleted: 2, failed: 1 });
});

test("DELETE /jobs/:jobId удаляет завершённое задание", async (context) => {
  const deleted: string[] = [];
  const app = await buildApi({
    logger: false,
    maxUploadBytes: 1024,
    database: unavailableDatabase(),
    queue: { async publish() {} },
    objectStore: unavailableObjectStore(),
    garbageCollector: {
      async collect() { return { scanned: 0, deleted: 0, failed: 0 }; },
      async deleteJob(id) {
        deleted.push(id);
        return id === "efef4d3d-41ce-4d67-9b79-0db6d46170da"
          ? "not-finished"
          : "deleted";
      },
    },
  });
  context.after(() => app.close());

  const response = await app.inject({
    method: "DELETE",
    url: "/jobs/5de1669a-1aa1-4e0d-8f9e-7bc71afccaa7",
  });

  assert.equal(response.statusCode, 204);
  assert.deepEqual(deleted, ["5de1669a-1aa1-4e0d-8f9e-7bc71afccaa7"]);

  const processingResponse = await app.inject({
    method: "DELETE",
    url: "/jobs/efef4d3d-41ce-4d67-9b79-0db6d46170da",
  });
  assert.equal(processingResponse.statusCode, 409);
});

function noopGarbageCollector() {
  return {
    async collect() {
      return { scanned: 0, deleted: 0, failed: 0 };
    },
    async deleteJob() {
      return "not-found" as const;
    },
  };
}

function unavailableDatabase() {
  return {
    async ping() {},
    async createJob(): Promise<never> { throw new Error("Недоступно в тесте"); },
    async getJob() { return null; },
    async markFailed() {},
  };
}

function unavailableObjectStore() {
  return {
    async put(): Promise<never> { throw new Error("Недоступно в тесте"); },
    async get(): Promise<never> { throw new Error("Недоступно в тесте"); },
    async remove(): Promise<never> { throw new Error("Недоступно в тесте"); },
  };
}

function createMultipartBody(
  boundary: string,
  file: Buffer,
  encoding = "utf-8",
  direction?: string,
  format?: string,
): Buffer {
  return Buffer.concat([
    Buffer.from(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="records.mrc"',
        "Content-Type: application/octet-stream",
        "",
        "",
      ].join("\r\n"),
    ),
    file,
    Buffer.from(
      [
        "",
        `--${boundary}`,
        'Content-Disposition: form-data; name="encoding"',
        "",
        encoding,
        ...(direction
          ? [
              `--${boundary}`,
              'Content-Disposition: form-data; name="direction"',
              "",
              direction,
            ]
          : []),
        ...(format
          ? [
              `--${boundary}`,
              'Content-Disposition: form-data; name="format"',
              "",
              format,
            ]
          : []),
        `--${boundary}--`,
        "",
      ].join("\r\n"),
    ),
  ]);
}

test("API выдаёт отчёт валидации только для завершённого задания с ошибками", async (context) => {
  const id = "5de1669a-1aa1-4e0d-8f9e-7bc71afccaa7";
  const key = `outputs/${id}.validation-errors.ndjson`;
  const report = '{"recordIndex":0,"byteOffset":0,"errors":[]}\n';
  let job: ConversionJob = {
    id, status: "completed", originalFilename: "input.mrc", encoding: "utf-8",
    direction: "iso-to-json", inputFormat: "iso2709", inputObjectKey: "input",
    inputBytes: 1, outputObjectKey: "output", outputFilename: "result.iso.json",
    summary: { skippedDeletedRecords: 0, recordsProcessed: 1, validRecords: 0, recordsWithValidationErrors: 1,
      recordsWithParsingErrors: 0, validationErrors: 1, inputBytes: 1,
      durationMilliseconds: 1, validationErrorsObjectKey: key },
    error: null, createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date(),
  };
  const app = await buildApi({
    logger: false, maxUploadBytes: 1024, garbageCollector: noopGarbageCollector(),
    database: { ...unavailableDatabase(), async getJob() { return job; } },
    queue: { async publish() {} },
    objectStore: { ...unavailableObjectStore(), async get(actualKey: string) {
      assert.equal(actualKey, key);
      return Readable.from(report);
    } },
  });
  context.after(() => app.close());
  const status = await app.inject({ method: "GET", url: `/jobs/${id}` });
  assert.equal(status.json().validationErrorsUrl, `/jobs/${id}/validation-errors`);
  const response = await app.inject({ method: "GET", url: `/jobs/${id}/validation-errors` });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, report);
  job = { ...job, summary: null };
  assert.equal((await app.inject({ method: "GET", url: `/jobs/${id}/validation-errors` })).statusCode, 404);
  job = { ...job, status: "processing" };
  assert.equal((await app.inject({ method: "GET", url: `/jobs/${id}/validation-errors` })).statusCode, 409);
});
