import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  const inputPath = join(directory, "records.iso.ndjson");
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
  const lines = (await readFile(toJson.outputPath, "utf8"))
    .trimEnd()
    .split("\n");

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
  const inputPath = join(directory, "records.iso.ndjson");
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

test("отклоняет JSON без маркера исходного контейнера в имени", async (context) => {
  const directory = await createTemporaryDirectory(context);
  const inputPath = join(directory, "records.json");
  await writeFile(inputPath, "{}\n");

  await assert.rejects(
    convertMarcJsonFile({
      encoding: "utf-8",
      inputPath,
      outputPath: join(directory, "records"),
    }),
    /\.iso\.json.*\.aleph\.json/,
  );
});

test("смешанное поле во второй строке отклоняется без замены результата", async (context) => {
  const directory = await createTemporaryDirectory(context);
  const record = JSON.parse(await readFile(jsonRecordUrl, "utf8"));
  const invalidRecord = {
    ...record,
    fields: [{ code: "001", value: "123", ind1: " " }],
  };
  const inputPath = join(directory, "mixed.iso.ndjson");
  const outputPath = join(directory, "mixed.mrc");
  await writeFile(inputPath, `${JSON.stringify(record)}\n${JSON.stringify(invalidRecord)}\n`);
  await writeFile(outputPath, "previous result");

  await assert.rejects(convertMarcJsonFile({
    encoding: "utf-8", inputPath, outputPath,
  }), /Строка 2: fields\[0\]\.ind1:.*запрещено/);
  assert.equal(await readFile(outputPath, "utf8"), "previous result");
});

async function createTemporaryDirectory(context: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "marc-json-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

for (const container of ["iso", "aleph"]) {
  test(`${container}: в обе стороны сохраняет неизвестные значения и создаёт отчёт`, async (context) => {
    const directory = await createTemporaryDirectory(context);
    const record = {
      leader: "00000nam a2200000 ca4500", format: "НЕИЗВЕСТНО", recordId: "000000123",
      fields: [
        { code: "A1b", ind1: "A", ind2: "!", subfields: [{ code: "A", value: "Книга" }] },
        { code: "245", ind1: " ", ind2: " ", subfields: [] },
      ],
    };
    const valid = { ...record, leader: "00000nam a2200000 i 4500", format: "BK", fields: [] };
    const inputPath = join(directory, `records.${container}.ndjson`);
    const line = JSON.stringify(record);
    await writeFile(inputPath, line + "\r\n" + JSON.stringify(valid) + "\n" + line);
    const reverse = await convertMarcJsonFile({
      encoding: "utf-8", inputPath, outputPath: join(directory, "result"), chunkSize: 7,
    });
    assert.equal(reverse.recordsProcessed, 3);
    assert.equal(reverse.validRecords, 1);
    assert.equal(reverse.recordsWithValidationErrors, 2);
    assert.ok(reverse.validationErrorsPath);
    const report = (await readFile(reverse.validationErrorsPath, "utf8")).trimEnd().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(report.map(r => r.recordIndex), [0, 2]);
    assert.equal(report[1].byteOffset, Buffer.byteLength(line + "\r\n" + JSON.stringify(valid) + "\n"));
    const rules = report[0].errors.map(e => e.rule);
    for (const rule of ["FMT", "LD-02", "DR-E2", "IN-G3", "SF-G4", "DF-G3"]) {
      assert.ok(rules.includes(rule), rule);
    }
    const forward = await convertMarcFile({
      encoding: "utf-8", inputPath: reverse.outputPath, outputPath: join(directory, "round-trip"),
    });
    const output = (await readFile(forward.outputPath, "utf8")).trimEnd().split("\n").map(line => JSON.parse(line));
    assert.equal(output[0].format, record.format);
    assert.deepEqual(output[0].fields, record.fields);
    assert.equal(forward.recordsWithValidationErrors, 2);
    assert.ok(forward.validationErrorsPath);

    await writeFile(inputPath, JSON.stringify(valid));
    const clean = await convertMarcJsonFile({ encoding: "utf-8", inputPath, outputPath: join(directory, "result") });
    assert.equal(clean.validationErrorsPath, undefined);
    await assert.rejects(readFile(reverse.validationErrorsPath), { code: "ENOENT" });
  });
}

test("структурная ошибка после ошибки валидации удаляет временный отчёт", async (context) => {
  const directory = await createTemporaryDirectory(context);
  const inputPath = join(directory, "records.iso.json");
  const outputPath = join(directory, "result.mrc");
  const record = { leader: "00000nam a2200000 ca4500", format: "UNKNOWN", fields: [] };
  await writeFile(inputPath, JSON.stringify(record) + "\n" + JSON.stringify({ ...record, fields: [
    { code: "245", ind1: "AA", ind2: " ", subfields: [] },
  ] }));
  await writeFile(outputPath, "previous");
  await assert.rejects(convertMarcJsonFile({ encoding: "utf-8", inputPath, outputPath }), /Строка 2/);
  assert.equal(await readFile(outputPath, "utf8"), "previous");
  assert.deepEqual((await readdir(directory)).sort(), ["records.iso.json", "result.mrc"]);
});

for (const container of ["iso", "aleph"]) {
  test(`${container}: управляющие символы в кодах дают ошибки валидации`, async (context) => {
    const directory = await createTemporaryDirectory(context);
    const inputPath = join(directory, `records.${container}.json`);
    const record = {
      leader: "00000nam a2200000 i 4500", format: "BK", recordId: "000000123",
      fields: [
        { code: "A\u0001b", ind1: "\u0002", ind2: " ", subfields: [
          { code: "\u001e", value: "сохранено" },
        ] },
      ],
    };
    const clean = { ...record, fields: [] };
    await writeFile(inputPath, JSON.stringify(record) + "\n" + JSON.stringify(clean));
    const reverse = await convertMarcJsonFile({
      encoding: "utf-8", inputPath, outputPath: join(directory, "result"),
    });
    assert.equal(reverse.recordsProcessed, 2);
    assert.equal(reverse.recordsWithValidationErrors, 1);
    assert.ok(reverse.validationErrorsPath);
    const report = JSON.parse(await readFile(reverse.validationErrorsPath, "utf8"));
    assert.deepEqual(report.errors.map(e => e.rule), ["DR-E2", "IN-G3", "SF-G4"]);

    const forward = await convertMarcFile({
      encoding: "utf-8", inputPath: reverse.outputPath, outputPath: join(directory, "restored"),
    });
    assert.equal(forward.recordsProcessed, 2);
    assert.equal(forward.recordsWithValidationErrors, 1);
    const restored = JSON.parse((await readFile(forward.outputPath, "utf8")).split("\n")[0]);
    assert.deepEqual(restored.fields, record.fields);
    assert.ok(forward.validationErrorsPath);
    const forwardReport = JSON.parse(await readFile(forward.validationErrorsPath, "utf8"));
    assert.deepEqual(forwardReport.errors.map(e => e.rule), ["DR-E2", "IN-G3", "SF-G4"]);
  });
}
