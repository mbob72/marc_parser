import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { buildApi } from "../src/api.ts";
import type { ConversionJob, ConversionJobMessage } from "../src/job.ts";

test("POST /jobs сохраняет файл и публикует задание", async (context) => {
  const uploaded = new Map<string, Buffer>();
  const published: ConversionJobMessage[] = [];
  let currentJob: ConversionJob | null = null;
  const app = await buildApi({
    logger: false,
    maxUploadBytes: 1024,
    database: {
      async ping() {},
      async createJob(input) {
        currentJob = {
          id: input.id,
          status: "queued",
          originalFilename: input.originalFilename,
          encoding: input.encoding,
          direction: input.direction,
          inputObjectKey: input.inputObjectKey,
          inputBytes: input.inputBytes,
          outputObjectKey: null,
          outputFilename: null,
          summary: null,
          error: null,
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-01-01T00:00:00Z"),
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

function createMultipartBody(
  boundary: string,
  file: Buffer,
  encoding = "utf-8",
  direction?: string,
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
        `--${boundary}--`,
        "",
      ].join("\r\n"),
    ),
  ]);
}
