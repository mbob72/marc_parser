import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readSourceRecord } from "../src/source-address.ts";
test("байтовый адрес: UTF-8, CRLF, EOF, SHA и изменение исходника", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "source-address-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "source.dat");
  const raw = Buffer.from("БЗ\r\nЕХ😀");
  await writeFile(path, raw);
  const sha256 = createHash("sha256").update(raw).digest("hex");
  const byteOffset = Buffer.byteLength("БЗ\r\n");
  const address = {
    path,
    sha256,
    byteOffset,
    byteLength: raw.length - byteOffset,
  };
  assert.deepEqual(await readSourceRecord(address), Buffer.from("ЕХ😀"));
  await assert.rejects(
    readSourceRecord({ ...address, byteOffset: -1 }),
    /Invalid source address/,
  );
  await assert.rejects(
    readSourceRecord({ ...address, byteLength: raw.length }),
    /outside file/,
  );
  await assert.rejects(
    readSourceRecord({ ...address, sha256: "0".repeat(64) }),
    /SHA-256/,
  );
  await writeFile(path, Buffer.alloc(raw.length, 65));
  await assert.rejects(readSourceRecord(address), /SHA-256/);
});
