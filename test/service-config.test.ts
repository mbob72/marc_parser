import assert from "node:assert/strict";
import test from "node:test";
import { loadServiceConfig } from "../src/service-config.ts";

test("service config читает числовые и логические параметры", () => {
  const config = loadServiceConfig({
    PORT: "8080",
    MINIO_PORT: "9443",
    MINIO_USE_SSL: "true",
    WORKER_CONCURRENCY: "4",
    JOB_MAX_ATTEMPTS: "5",
    MAX_UPLOAD_BYTES: "123456",
  });

  assert.equal(config.port, 8080);
  assert.equal(config.minio.port, 9443);
  assert.equal(config.minio.useSSL, true);
  assert.equal(config.workerConcurrency, 4);
  assert.equal(config.maxAttempts, 5);
  assert.equal(config.maxUploadBytes, 123456);
});

test("service config отклоняет некорректные параметры", () => {
  assert.throws(
    () => loadServiceConfig({ WORKER_CONCURRENCY: "0" }),
    /WORKER_CONCURRENCY/,
  );
  assert.throws(
    () => loadServiceConfig({ MINIO_USE_SSL: "yes" }),
    /MINIO_USE_SSL/,
  );
});
