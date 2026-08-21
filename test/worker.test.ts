import assert from "node:assert/strict";
import type { ConsumeMessage } from "amqplib";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import test from "node:test";
import type { ConversionJob, JobSummary } from "../src/job.ts";
import { MarcJsonSerializer } from "../src/marc-json-serializer.ts";
import { Iso2709MarcParser } from "../src/marc-parser.ts";
import { handleMessage } from "../src/worker.ts";

const JOB_ID = "5de1669a-1aa1-4e0d-8f9e-7bc71afccaa7";

test("worker конвертирует объект, сохраняет результат и подтверждает job", async () => {
  const source = await readFile(
    new URL("../docs/015316815/015316815.mrc", import.meta.url),
  );
  const outputs = new Map<string, Buffer>();
  const acknowledged: ConsumeMessage[] = [];
  let processingWasMarked = false;
  let completed: {
    outputObjectKey: string;
    outputFilename: string;
    summary: JobSummary;
  } | null = null;
  const job: ConversionJob = {
    id: JOB_ID,
    status: "queued",
    originalFilename: "records.mrc",
    encoding: "utf-8",
    direction: "iso-to-json",
    inputObjectKey: `inputs/${JOB_ID}.mrc`,
    inputBytes: source.length,
    outputObjectKey: null,
    outputFilename: null,
    summary: null,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const rawMessage = {} as ConsumeMessage;

  await handleMessage(
    { jobId: JOB_ID, attempt: 1 },
    rawMessage,
    {
      async getJob() {
        return job;
      },
      async markProcessing() {
        processingWasMarked = true;
      },
      async markQueuedForRetry() {
        throw new Error("retry не ожидался");
      },
      async markCompleted(
        _id,
        outputObjectKey,
        outputFilename,
        summary,
      ) {
        completed = { outputObjectKey, outputFilename, summary };
      },
      async markFailed() {
        throw new Error("failure не ожидался");
      },
    },
    {
      async get(key) {
        assert.equal(key, job.inputObjectKey);
        return Readable.from(source);
      },
      async put(key, stream) {
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(Buffer.from(chunk));
        }
        outputs.set(key, Buffer.concat(chunks));
      },
    },
    {
      async publish() {
        throw new Error("retry publish не ожидался");
      },
      acknowledge(message) {
        acknowledged.push(message);
      },
      reject() {
        throw new Error("reject не ожидался");
      },
    },
    3,
  );

  assert.equal(processingWasMarked, true);
  assert.deepEqual(acknowledged, [rawMessage]);
  assert.ok(completed);
  assert.equal(completed.outputObjectKey, `outputs/${JOB_ID}.json`);
  assert.equal(completed.outputFilename, "records.json");
  assert.equal(completed.summary.recordsProcessed, 1);
  assert.equal(completed.summary.recordsWithParsingErrors, 0);

  const result = outputs.get(`outputs/${JOB_ID}.json`);
  assert.ok(result);
  assert.equal(JSON.parse(result.toString()).leader, "01590cam a2200217 u 4500");
});

test("worker конвертирует NDJSON в ISO 2709 и сохраняет .mrc", async () => {
  const json = JSON.parse(
    await readFile(
      new URL("../docs/015316815/015316815.json", import.meta.url),
      "utf8",
    ),
  );
  const source = Buffer.from(`${JSON.stringify(json)}\n`);
  const outputs = new Map<string, Buffer>();
  let completedFilename: string | null = null;
  const job: ConversionJob = {
    id: JOB_ID,
    status: "queued",
    originalFilename: "records.ndjson",
    encoding: "utf-8",
    direction: "json-to-iso",
    inputObjectKey: `inputs/${JOB_ID}`,
    inputBytes: source.length,
    outputObjectKey: null,
    outputFilename: null,
    summary: null,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const rawMessage = {} as ConsumeMessage;

  await handleMessage(
    { jobId: JOB_ID, attempt: 1 },
    rawMessage,
    {
      async getJob() {
        return job;
      },
      async markProcessing() {},
      async markQueuedForRetry() {
        throw new Error("retry не ожидался");
      },
      async markCompleted(_id, _key, outputFilename) {
        completedFilename = outputFilename;
      },
      async markFailed() {
        throw new Error("failure не ожидался");
      },
    },
    {
      async get() {
        return Readable.from(source);
      },
      async put(key, stream) {
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(Buffer.from(chunk));
        }
        outputs.set(key, Buffer.concat(chunks));
      },
    },
    {
      async publish() {
        throw new Error("retry publish не ожидался");
      },
      acknowledge() {},
      reject() {
        throw new Error("reject не ожидался");
      },
    },
    3,
  );

  assert.equal(completedFilename, "records.mrc");
  const iso = outputs.get(`outputs/${JOB_ID}.mrc`);
  assert.ok(iso);
  const record = new Iso2709MarcParser().parse(iso);
  const roundTrip = new MarcJsonSerializer("utf-8").serialize(record);
  assert.equal(record.fields[0]?.tag, "FMT");
  assert.equal(roundTrip.format, "BK");
  assert.deepEqual(roundTrip.fields, json.fields);
});
