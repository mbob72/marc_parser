import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test, { type TestContext } from "node:test";
import { AlephSequentialMarcParser } from "../src/aleph-sequential-parser.ts";
import { AlephSequentialRecordSplitter } from "../src/aleph-sequential-record-splitter.ts";
import { convertMarcFile } from "../src/marc-file-converter.ts";
import { convertMarcJsonFile } from "../src/marc-json-file-converter.ts";
import type { MarcJsonDataField } from "../src/marc-json-serializer.ts";

const realRecordsUrl = new URL(
  "./fixtures/aleph-sequential-real.dat",
  import.meta.url,
);

test("автоматически конвертирует реальные записи rsl06, rsl07 и rsl10", async (context) => {
  const directory = await createTemporaryDirectory(context);
  const outputPath = join(directory, "records.json");

  const summary = await convertMarcFile({
    encoding: "utf-8",
    inputPath: realRecordsUrl.pathname,
    outputPath,
    chunkSize: 7,
  });
  assert.equal(summary.outputPath, join(directory, "records.aleph.json"));
  const records = (await readFile(summary.outputPath, "utf8"))
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.equal(summary.recordsProcessed, 3);
  assert.equal(summary.validRecords, 3);
  assert.equal(summary.recordsWithParsingErrors, 0);
  assert.deepEqual(records.map(({ recordId }) => recordId), [
    "000000001",
    "000361888",
    "000080996",
  ]);
  assert.deepEqual(records.map(({ format }) => format), ["BK", "SE", "AU"]);
  assert.deepEqual(records.map(({ leader }) => leader.slice(5, 12)), [
    "nam a22",
    "nas a22",
    "nz  a22",
  ]);
  assert.equal(findSubfield(records[0], "245", "a"), "New-York фильм-сказка testvera");
  assert.equal(findSubfield(records[1], "245", "a"), "Край Смоленский. 2019");
  assert.equal(
    findSubfield(records[2], "110", "a"),
    "American astronautical society (New York)",
  );
});

test("Aleph → JSON → Aleph → JSON сохраняет три реальные записи", async (context) => {
  const directory = await createTemporaryDirectory(context);
  const firstJson = await convertMarcFile({
    encoding: "utf-8",
    inputPath: realRecordsUrl.pathname,
    outputPath: join(directory, "first.json"),
    chunkSize: 13,
  });
  const restored = await convertMarcJsonFile({
    encoding: "utf-8",
    inputPath: firstJson.outputPath,
    outputPath: join(directory, "restored"),
    chunkSize: 11,
  });
  const secondJson = await convertMarcFile({
    encoding: "utf-8",
    inputPath: restored.outputPath,
    outputPath: join(directory, "second.json"),
    chunkSize: 17,
  });

  assert.equal(restored.outputPath, join(directory, "restored.dat"));
  assert.deepEqual(
    await readNdjson(secondJson.outputPath),
    await readNdjson(firstJson.outputPath),
  );
});

test("разбирает формат AU нормативной записи из FMT", async () => {
  const source = await readFile(realRecordsUrl);
  const thirdRecord = source.subarray(source.indexOf("000080996\t", 0, "ascii"));
  const parsed = new AlephSequentialMarcParser().parse(thirdRecord);
  const formatField = parsed.fields.find(({ tag }) => tag === "FMT");

  assert.equal(formatField?.kind, "control");
  assert.equal(
    formatField?.kind === "control"
      ? formatField.value.toString("ascii")
      : "",
    "AU",
  );
});

test("не делит запись по переводу строки внутри Aleph-поля", async () => {
  const record = buildAlephRecord("000000042", [
    { tag: "FMT", indicators: "  ", value: "BK" },
    { tag: "LDR", indicators: "  ", value: "^^^^^nam^a22^^^^^^i^4500" },
    { tag: "245", indicators: " 0", value: "$$aПервая строка\nвторая строка" },
  ]);
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < record.length; offset += 3) {
    chunks.push(record.subarray(offset, offset + 3));
  }

  const output: Buffer[] = [];
  for await (const chunk of Readable.from(chunks).pipe(
    new AlephSequentialRecordSplitter(),
  )) {
    output.push(Buffer.from(chunk));
  }

  assert.equal(output.length, 1);
  assert.deepEqual(output[0], record);
  const parsed = new AlephSequentialMarcParser().parse(output[0]!);
  const field = parsed.fields.find(({ tag }) => tag === "245");
  assert.ok(field?.kind === "data");
  assert.equal(field.subfields[0]?.value.toString("utf8"), "Первая строка\nвторая строка");
});

interface AlephTestField {
  readonly tag: string;
  readonly indicators: string;
  readonly value: string;
}

function buildAlephRecord(
  identifier: string,
  fields: readonly AlephTestField[],
): Buffer {
  const encodedFields = fields.map(({ tag, indicators, value }) => {
    const body = Buffer.from(`${tag}${indicators}L${value}`, "utf8");
    return Buffer.concat([
      Buffer.from(String(body.length).padStart(4, "0"), "ascii"),
      body,
    ]);
  });

  return Buffer.concat([
    Buffer.from(`${identifier}\t`, "ascii"),
    ...encodedFields,
    Buffer.from("\n", "ascii"),
  ]);
}

function findSubfield(
  record: { fields: readonly MarcJsonDataField[] },
  fieldCode: string,
  subfieldCode: string,
): string | undefined {
  const field = record.fields.find(({ code }) => code === fieldCode);
  return field?.subfields.find(({ code }) => code === subfieldCode)?.value;
}

async function readNdjson(path: string): Promise<unknown[]> {
  return (await readFile(path, "utf8"))
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
}

async function createTemporaryDirectory(
  context: TestContext,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "marc-parser-aleph-test-"));
  context.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}
