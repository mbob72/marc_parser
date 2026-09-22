import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { convertMarcFile } from "../src/marc-file-converter.ts";
import { convertMarcJsonFile } from "../src/marc-json-file-converter.ts";
import { NullMarcProcessingLogger } from "../src/marc-processing-logger.ts";

const leader = "00000nam a2200000 i 4500";
type Field = { tag: string; value: string; indicators?: string; marker?: string };
const fmt: Field = { tag: "FMT", value: "BK" };
const ldr: Field = { tag: "LDR", value: leader };
const title: Field = { tag: "245", indicators: " 0", value: "$$aЗаглавие" };

function aleph(fields: Field[]): Buffer {
  return Buffer.from("000000123\t" + fields.map(f => {
    const raw = f.tag + (f.indicators ?? "  ") + (f.marker ?? "L") + f.value;
    return String(Buffer.byteLength(raw)).padStart(4, "0") + raw;
  }).join("") + "\n");
}

function iso(fields: Field[], rawLeader = leader): Buffer {
  const values = fields.map(f => Buffer.from(
    (f.tag === "FMT" || f.tag.startsWith("00") ? "" : (f.indicators ?? "  ")) +
    f.value.replaceAll("$$", "\x1f") + "\x1e"));
  let offset = 0;
  const directory = fields.map((f, i) => {
    const result = f.tag + String(values[i]!.length).padStart(4, "0") + String(offset).padStart(5, "0");
    offset += values[i]!.length;
    return result;
  }).join("");
  const base = 24 + directory.length + 1;
  const header = Buffer.from(rawLeader);
  header.write(String(base + offset + 1).padStart(5, "0"), 0);
  header.write(String(base).padStart(5, "0"), 12);
  return Buffer.concat([header, Buffer.from(directory + "\x1e"), ...values, Buffer.from([0x1d])]);
}

async function directory(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), "marc-import-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

async function convert(t: TestContext, data: Buffer, format: "iso2709" | "aleph-sequential") {
  const dir = await directory(t);
  const inputPath = join(dir, "input.dat");
  await writeFile(inputPath, data);
  const summary = await convertMarcFile({ inputPath, outputPath: join(dir, "out"), encoding: "utf-8", inputFormat: format, chunkSize: 7 });
  const output = await readFile(summary.outputPath, "utf8");
  return { summary, dir, output, rows: output.trim() ? output.trim().split("\n").map(s => JSON.parse(s)) : [] };
}

test("Aleph: DEL$a=Y precedes absent, short and duplicate LDR; offsets count skipped records", async t => {
  const deleted = [
    aleph([{ tag: "DEL", value: "$$aY" }, { ...title, marker: "X" }]),
    aleph([{ ...ldr, value: "bad", marker: "X" }, { tag: "DEL", value: "$$aY$$bN" }]),
    aleph([ldr, ldr, { tag: "DEL", value: "$$aN" }, { tag: "DEL", value: "$$aY" }]),
  ];
  const valid = aleph([fmt, ldr, title]);
  const invalid = aleph([fmt, ldr, { ...title, indicators: "A0" }]);
  const data = Buffer.concat([...deleted, valid, invalid]);
  const { summary, rows } = await convert(t, data, "aleph-sequential");
  assert.equal(rows.length, 2);
  assert.equal(summary.recordsProcessed, 5);
  assert.equal(summary.skippedDeletedRecords, 3);
  assert.equal(summary.validRecords, 1);
  assert.equal(summary.recordsWithValidationErrors, 1);
  assert.equal(summary.recordsWithParsingErrors, 0);
  assert.equal(summary.inputBytes, data.length);
  assert.ok(summary.validationErrorsPath);
  const reports = (await readFile(summary.validationErrorsPath, "utf8")).trim().split("\n").map(s => JSON.parse(s));
  assert.equal(reports.length, 1);
  assert.equal(reports[0].recordIndex, 4);
  assert.equal(reports[0].byteOffset, Buffer.concat([...deleted, valid]).length);
  assert.deepEqual(reports[0].errors.map((e: { rule: string }) => e.rule), ["IN-G3"]);
});

for (const format of ["iso2709", "aleph-sequential"] as const) {
  const build = (fields: Field[]) => format === "iso2709" ? iso(fields) : aleph([ldr, ...fields]);
  test(`${format}: alphabetic fields excluded, FMT/leader preserved, numeric errors still reported`, async t => {
    const services = ["LKR", "DEL", "OWN", "UID", "AbC"].map(tag => ({ tag, value: "$$Aошибка", indicators: "?!", marker: "X" }));
    const { summary, rows } = await convert(t, build([fmt, ...services, title]), format);
    assert.equal(summary.validationErrors, 0);
    assert.equal(summary.validRecords, 1);
    assert.equal(summary.skippedDeletedRecords, 0);
    assert.equal(rows[0].format, "BK");
    assert.equal(rows[0].leader.length, 24);
    assert.deepEqual(rows[0].fields.map((f: { code: string }) => f.code), ["245"]);
    assert.equal(rows[0].fields[0].subfields[0].value, "Заглавие");
    assert.equal(rows[0].serviceFields, undefined);
    const reverse = await convertMarcJsonFile({ encoding: "utf-8", inputPath: summary.outputPath, outputPath: join((await directory(t)), "roundtrip") });
    const again = await convertMarcFile({ encoding: "utf-8", inputPath: reverse.outputPath, outputPath: join((await directory(t)), "again") });
    assert.equal(await readFile(again.outputPath, "utf8"), await readFile(summary.outputPath, "utf8"));
    const invalid = await convert(t, build([{ ...fmt, value: "UNKNOWN" }, ...services, { ...title, value: "$$Aошибка" }]), format);
    assert.ok(invalid.summary.validationErrorsPath);
    const errors = JSON.parse(await readFile(invalid.summary.validationErrorsPath, "utf8")).errors;
    assert.deepEqual(errors.map((e: { rule: string }) => e.rule).sort(), ["FMT", "SF-G4"]);
  });

  test(`${format}: deletion flag requires exact subfield a=Y`, async t => {
    const values = ["$$aN", "$$aYY", "$$ay", "$$AY", "$$aY ", "$$a Y", "$$bY"];
    const records = values.map(value => build([fmt, title, { tag: "DEL", value }]));
    const { summary, rows } = await convert(t, Buffer.concat(records), format);
    assert.equal(summary.skippedDeletedRecords, 0);
    assert.equal(summary.validRecords, values.length);
    assert.equal(rows.length, values.length);
  });

  test(`${format}: file with only deleted records yields empty JSON and removes stale error report`, async t => {
    const dir = await directory(t);
    const inputPath = join(dir, "input.dat");
    const outputPath = join(dir, "out");
    await writeFile(inputPath, build([fmt, { ...title, indicators: "A0" }]));
    const before = await convertMarcFile({ encoding: "utf-8", inputPath, outputPath, inputFormat: format });
    assert.ok(before.validationErrorsPath);
    await writeFile(inputPath, build([fmt, { tag: "DEL", value: "$$aY" }]));
    const after = await convertMarcFile({ encoding: "utf-8", inputPath, outputPath, inputFormat: format });
    assert.equal(after.skippedDeletedRecords, 1);
    assert.equal(after.validRecords, 0);
    assert.equal(after.validationErrors, 0);
    assert.equal(after.validationErrorsPath, undefined);
    assert.equal(await readFile(after.outputPath, "utf8"), "");
    await assert.rejects(readFile(before.validationErrorsPath), { code: "ENOENT" });
  });
}

test("ISO: deleted record bypasses semantic Leader and field validation", async t => {
  const badLeader = leader.slice(0, 18) + "ca" + leader.slice(20);
  const { summary, rows } = await convert(t, iso([fmt, { ...title, indicators: "A0", value: "$$Aошибка" }, { tag: "DEL", value: "$$aY" }], badLeader), "iso2709");
  assert.equal(summary.skippedDeletedRecords, 1);
  assert.equal(summary.validationErrors, 0);
  assert.deepEqual(rows, []);
});

test("Aleph: skipped records do not invoke validation logger", async t => {
  const dir = await directory(t);
  const path = join(dir, "in.dat");
  await writeFile(path, aleph([{ tag: "DEL", value: "$$aY" }]));
  const logger = new NullMarcProcessingLogger();
  logger.logValidationResult = () => { assert.fail("Deleted record was validated"); };
  logger.logParsingError = () => { assert.fail("Deleted record was parsed as MARC"); };
  await convertMarcFile({ encoding: "utf-8", inputPath: path, outputPath: join(dir, "out"), logger });
});
