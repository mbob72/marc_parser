import { test } from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { createPublicationResourceGate } from "../src/documents/publish-resources.js";

const MIB = 1024n ** 2n;
const GIB = 1024n ** 3n;
const sample = (memoryMiB = 4096n, diskBytes = 200n * GIB) => ({
  memoryAvailableBytes: memoryMiB * MIB,
  diskAvailableBytes: diskBytes,
});
async function until(check) {
  for (let n = 0; n < 200; n++) {
    if (check()) return;
    await delay(5);
  }
  throw Error("resource condition did not occur");
}

// Тесты не читают /proc и не изменяют параметры PostgreSQL: ресурсный сэмплер подставлен.
test("resource gate waits for its first sample, pauses and resumes at the soft boundary", async (t) => {
  const events = [];
  let value = sample(2500n);
  let releaseFirst;
  const first = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let calls = 0;
  const gate = createPublicationResourceGate({
    intervalMs: 5,
    sample: async () => (++calls === 1 ? first : value),
    progress: (event) => events.push(event),
  });
  t.after(() => gate.close());
  let permitted = false;
  const ready = gate.ready().then(() => {
    permitted = true;
  });
  await delay(10);
  assert.equal(permitted, false);
  releaseFirst(value);
  await until(() => events.some((e) => e.event === "resource_pause"));
  assert.equal(permitted, false);
  assert.equal(gate.signal.aborted, false);
  value = sample(3072n);
  await ready;
  assert.equal(permitted, true);
  assert.deepEqual(
    events.filter((e) => e.event !== "resource_sample").map((e) => e.event),
    ["start", "resource_pause", "resource_resume"],
  );
  assert.equal(events[1].memoryAvailableBytes, (2500n * MIB).toString());
  assert.doesNotThrow(() => JSON.stringify(events));
});

test("independent samples abort on critical memory after ready already permitted SQL", async (t) => {
  let value = sample();
  const events = [];
  const gate = createPublicationResourceGate({
    intervalMs: 5,
    sample: async () => value,
    progress: (e) => events.push(e),
  });
  t.after(() => gate.close());
  await gate.ready();
  value = sample(2047n);
  await until(() => gate.signal.aborted);
  assert.match(gate.signal.reason.message, /memory/);
  await assert.rejects(gate.ready(), /memory/);
  assert.equal(events.filter((e) => e.event === "resource_critical").length, 1);
  assert.equal(events.at(-1).reason, "memory");
});

test("healthy samples continue recording whole-host metrics after ready", async (t) => {
  const events = [];
  const gate = createPublicationResourceGate({
    intervalMs: 5,
    sample: async () => sample(),
    progress: (event) => events.push(event),
  });
  t.after(() => gate.close());
  await gate.ready();
  await until(
    () => events.filter((e) => e.event === "resource_sample").length >= 3,
  );
  for (const event of events.filter((e) => e.event === "resource_sample")) {
    assert.equal(event.memoryAvailableBytes, (4096n * MIB).toString());
    assert.equal(event.diskAvailableBytes, (200n * GIB).toString());
  }
  assert.equal(gate.signal.aborted, false);
});

test("disk reserve is critical even when available memory is high", async (t) => {
  const events = [];
  const gate = createPublicationResourceGate({
    sample: async () => sample(4096n, 150n * GIB - 1n),
    progress: (e) => events.push(e),
  });
  t.after(() => gate.close());
  await assert.rejects(gate.ready(), /disk/);
  assert.equal(events.at(-1).reason, "disk");
});

test("equality with critical memory and disk reserve pauses without aborting", async (t) => {
  let value = sample(2048n, 150n * GIB);
  const events = [];
  const gate = createPublicationResourceGate({
    intervalMs: 5,
    sample: async () => value,
    progress: (e) => events.push(e),
  });
  t.after(() => gate.close());
  await until(() => events.some((e) => e.event === "resource_pause"));
  assert.equal(gate.signal.aborted, false);
  value = sample(3072n, 150n * GIB);
  await gate.ready();
  assert.equal(gate.signal.aborted, false);
});

test("sampling failure aborts waiting callers without disclosing the source error", async (t) => {
  const events = [];
  const gate = createPublicationResourceGate({
    sample: async () => {
      throw Error("private-password/private-path");
    },
    progress: (e) => events.push(e),
  });
  t.after(() => gate.close());
  await assert.rejects(gate.ready(), /sampling_error/);
  assert.equal(events.at(-1).reason, "sampling_error");
  assert.ok(!JSON.stringify(events).includes("private-password"));
  assert.ok(!gate.signal.reason.message.includes("private-password"));
});

test("external abort rejects waiters, stops future samples and removes its listener", async (t) => {
  const controller = new AbortController();
  let calls = 0;
  const gate = createPublicationResourceGate({
    signal: controller.signal,
    intervalMs: 5,
    sample: async () => {
      calls++;
      return sample(2500n);
    },
  });
  t.after(() => gate.close());
  const waiting = gate.ready();
  const rejection = assert.rejects(waiting, /operator stopped/);
  await until(() => calls > 0);
  controller.abort(Error("operator stopped"));
  await rejection;
  assert.equal(gate.signal.aborted, true);
  const atAbort = calls;
  await delay(25);
  assert.equal(calls, atAbort);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("close is immediate and idempotent while the sampler is unresolved", async () => {
  const controller = new AbortController();
  const gate = createPublicationResourceGate({
    signal: controller.signal,
    sample: async () => new Promise(() => {}),
  });
  const waiting = assert.rejects(gate.ready(), /closed/);
  await gate.close();
  await waiting;
  await gate.close();
  await assert.rejects(gate.ready(), /closed/);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  // Обычное close после завершения не превращает успешную загрузку в abort.
  assert.equal(gate.signal.aborted, false);
});

test("late sampler rejection after close cannot emit critical or reopen the gate", async () => {
  const events = [];
  let fail;
  const gate = createPublicationResourceGate({
    sample: () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    progress: (e) => events.push(e),
  });
  await gate.close();
  fail(Error("late failure"));
  await delay(5);
  assert.deepEqual(
    events.map((e) => e.event),
    ["start"],
  );
  assert.equal(gate.signal.aborted, false);
});

test("already aborted parent signal never starts the sampler", async () => {
  const controller = new AbortController();
  controller.abort(Error("already stopped"));
  let calls = 0;
  const gate = createPublicationResourceGate({
    signal: controller.signal,
    sample: async () => {
      calls++;
      return sample();
    },
  });
  await assert.rejects(gate.ready(), /already stopped/);
  assert.equal(calls, 0);
  await gate.close();
});

test("invalid options are rejected before the sampler or timer can run", () => {
  for (const value of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => createPublicationResourceGate({ intervalMs: value }),
      /positive safe integer/,
    );
  }
  assert.throws(
    () =>
      createPublicationResourceGate({
        softMemoryMiB: 1024,
        criticalMemoryMiB: 2048,
      }),
    /must not exceed/,
  );
  assert.throws(
    () => createPublicationResourceGate({ intervalMs: 60001 }),
    /must not exceed/,
  );
});

test("progress failure aborts safely before sampling without retaining external listeners", async () => {
  const controller = new AbortController();
  let calls = 0;
  const gate = createPublicationResourceGate({
    signal: controller.signal,
    sample: async () => {
      calls++;
      return sample();
    },
    progress: () => {
      throw Error("private-progress-detail");
    },
  });
  await assert.rejects(gate.ready(), /progress callback failed/);
  assert.equal(calls, 0);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  assert.ok(!gate.signal.reason.message.includes("private-progress-detail"));
  await gate.close();
});
