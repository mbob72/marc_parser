import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { convertMarcFile } from "../src/marc-file-converter.ts";
import { convertMarcJsonFile } from "../src/marc-json-file-converter.ts";
import { NullMarcProcessingLogger } from "../src/marc-processing-logger.ts";

const jsonRecordUrl = new URL(
  "../docs/015316815/015316815.json",
  import.meta.url,
);

test("конвертирует несколько строк NDJSON в несколько ISO-записей", async (context) => {
  const directory = await createTemporaryDirectory(context);
  const record = JSON.stringify(JSON.parse(await readFile(jsonRecordUrl, "utf8")));
  const inputPath = join(directory, "records.ndjson");
  const isoPath = join(directory, "records.mrc");
  const jsonPath = join(directory, "round-trip.json");
  await writeFile(inputPath, `${record}\n${record}\n`);

  const toIso = await convertMarcJsonFile({
    encoding: "utf-8",
    inputPath,
    outputPath: isoPath,
    logger: new NullMarcProcessingLogger(),
    chunkSize: 7,
  });
  const toJson = await convertMarcFile({
    encoding: "utf-8",
    inputPath: isoPath,
    outputPath: jsonPath,
    logger: new NullMarcProcessingLogger(),
    chunkSize: 11,
  });
  const lines = (await readFile(jsonPath, "utf8")).trimEnd().split("\n");

  assert.equal(toIso.recordsProcessed, 2);
  assert.equal(toJson.recordsProcessed, 2);
  const original = JSON.parse(record);
  const results = lines.map((line) => JSON.parse(line));
  assert.deepEqual(
    results.map(({ leader: _leader, ...value }) => value),
    [original, original].map(({ leader: _leader, ...value }) => value),
  );
});

test("ошибка во второй строке не заменяет существующий ISO-файл", async (context) => {
  const directory = await createTemporaryDirectory(context);
  const record = JSON.stringify(JSON.parse(await readFile(jsonRecordUrl, "utf8")));
  const inputPath = join(directory, "records.ndjson");
  const outputPath = join(directory, "records.mrc");
  await writeFile(inputPath, `${record}\n{bad json}\n`);
  await writeFile(outputPath, "previous result");

  await assert.rejects(
    convertMarcJsonFile({
      encoding: "utf-8",
      inputPath,
      outputPath,
    }),
    /Строка 2/,
  );
  assert.equal(await readFile(outputPath, "utf8"), "previous result");
});

async function createTemporaryDirectory(context: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "marc-json-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
