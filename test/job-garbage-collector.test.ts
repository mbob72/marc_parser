import assert from "node:assert/strict";
import test from "node:test";
import type { ConversionJob, JobStatus } from "../src/job.ts";
import { JobGarbageCollector } from "../src/job-garbage-collector.ts";

const JOB_ID = "5de1669a-1aa1-4e0d-8f9e-7bc71afccaa7";

test("сборщик удаляет объекты и записи просроченных заданий", async () => {
  const jobs = [createJob(JOB_ID, "completed")];
  const removedObjects: string[] = [];
  const deletedJobs: string[] = [];
  const collector = new JobGarbageCollector(
    {
      async getJob() { return jobs[0]!; },
      async getExpiredJobs() { return jobs; },
      async deleteFinishedJob(id) {
        deletedJobs.push(id);
        return true;
      },
    },
    {
      async remove(key) { removedObjects.push(key); },
    },
  );

  const result = await collector.collect(new Date("2026-01-03T00:00:00Z"));

  assert.deepEqual(result, { scanned: 1, deleted: 1, failed: 0 });
  assert.deepEqual(removedObjects, [
    `inputs/${JOB_ID}`,
    `outputs/${JOB_ID}.json`,
  ]);
  assert.deepEqual(deletedJobs, [JOB_ID]);
});

test("сборщик оставляет запись для повторной попытки при ошибке MinIO", async () => {
  const job = createJob(JOB_ID, "failed");
  let databaseDeleteWasCalled = false;
  const collector = new JobGarbageCollector(
    {
      async getJob() { return job; },
      async getExpiredJobs() { return [job]; },
      async deleteFinishedJob() {
        databaseDeleteWasCalled = true;
        return true;
      },
    },
    {
      async remove() { throw new Error("MinIO недоступен"); },
    },
  );

  assert.deepEqual(await collector.collect(), {
    scanned: 1,
    deleted: 0,
    failed: 1,
  });
  assert.equal(databaseDeleteWasCalled, false);
});

test("явное удаление не затрагивает выполняющееся задание", async () => {
  const job = createJob(JOB_ID, "processing");
  let objectRemoveWasCalled = false;
  const collector = new JobGarbageCollector(
    {
      async getJob() { return job; },
      async getExpiredJobs() { return []; },
      async deleteFinishedJob() { return true; },
    },
    {
      async remove() { objectRemoveWasCalled = true; },
    },
  );

  assert.equal(await collector.deleteJob(JOB_ID), "not-finished");
  assert.equal(objectRemoveWasCalled, false);
});

function createJob(id: string, status: JobStatus): ConversionJob {
  return {
    id,
    status,
    originalFilename: "records.mrc",
    encoding: "utf-8",
    direction: "iso-to-json",
    inputFormat: "iso2709",
    inputObjectKey: `inputs/${id}`,
    inputBytes: 42,
    outputObjectKey: `outputs/${id}.json`,
    outputFilename: "records.iso.json",
    summary: null,
    error: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:01:00Z"),
    expiresAt: new Date("2026-01-02T00:00:00Z"),
  };
}
