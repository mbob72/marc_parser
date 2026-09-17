import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  addJsonExtension,
  addSourceFormatJsonExtension,
  convertMarcFile,
} from "../src/marc-file-converter.ts";
import {
  type MarcJsonDataField,
} from "../src/marc-json-serializer.ts";
import { Iso2709MarcParser } from "../src/marc-parser.ts";
import { NullMarcProcessingLogger } from "../src/marc-processing-logger.ts";

const recordUrl = new URL(
  "../docs/015316815/015316815.mrc",
  import.meta.url,
);

test("validation error добавляет .json без префикса", async (context) => {
  const directory = await createTemporaryDirectory(context);
  const source = await readFile(recordUrl);
  const inputPath = join(directory, "validation-error.mrc");
  const requestedOutputPath = join(directory, "result.txt");
  const outputPath = `${requestedOutputPath}.iso.json`;

  await writeFile(inputPath, Buffer.concat([corruptFirstIndicator(source), source]));
  await writeFile(outputPath, "previous result");

  const summary = await convertMarcFile({
    encoding: "utf-8",
    inputPath,
    outputPath: requestedOutputPath,
    logger: new NullMarcProcessingLogger(),
  });
  const records = (await readFile(outputPath, "utf8")).trimEnd().split("\n").map(line => JSON.parse(line));
  assert.equal(records.length, 2);
  const json = records[0];
  const dataField = json.fields.find(
    (field: MarcJsonDataField) => "ind1" in field,
  );

  assert.equal(summary.outputPath, outputPath);
  assert.equal(summary.recordsWithValidationErrors, 1);
  assert.equal(summary.recordsWithParsingErrors, 0);
  assert.equal(dataField.ind1, "A");
  assert.ok(summary.validationErrorsPath);
  const report = JSON.parse(await readFile(summary.validationErrorsPath, "utf8"));
  assert.equal(report.recordIndex, 0);
  assert.equal(report.errors[0].rule, "IN-G3");
});

test("структурная ошибка прерывает конвертацию и сохраняет старый результат", async (context) => {
  const directory = await createTemporaryDirectory(context);
  const source = await readFile(recordUrl);
  const inputPath = join(directory, "parser-error.mrc");
  const outputPath = join(directory, "result.iso.json");
  await writeFile(inputPath, Buffer.concat([source, corruptBaseAddress(source), source]));
  await writeFile(outputPath, "previous result");
  await assert.rejects(convertMarcFile({
    encoding: "utf-8", inputPath, outputPath,
  }), /baseAddressOfData/);
  assert.equal(await readFile(outputPath, "utf8"), "previous result");
  assert.deepEqual((await readdir(directory)).sort(),
    [basename(inputPath), basename(outputPath)].sort());
});

test("фатальная framing error сохраняет старый результат", async (context) => {
  const directory = await createTemporaryDirectory(context);
  const source = await readFile(recordUrl);
  const inputPath = join(directory, "framing-error.mrc");
  const outputPath = join(directory, "result.iso.json");
  const corruptedSource = Buffer.from(source);

  corruptedSource.write("abcde", 0, "ascii");
  await writeFile(inputPath, corruptedSource);
  await writeFile(outputPath, "previous result");

  await assert.rejects(
    convertMarcFile({
      encoding: "utf-8",
      inputPath,
      outputPath,
      logger: new NullMarcProcessingLogger(),
    }),
    /Некорректная длина MARC-записи/,
  );

  assert.equal(await readFile(outputPath, "utf8"), "previous result");
  assert.deepEqual(
    (await readdir(directory)).sort(),
    [basename(inputPath), basename(outputPath)].sort(),
  );
});

test("добавляет расширение .json при необходимости", () => {
  assert.equal(addJsonExtension("/tmp/result"), "/tmp/result.json");
  assert.equal(
    addJsonExtension("/tmp/result.txt"),
    "/tmp/result.txt.json",
  );
  assert.equal(addJsonExtension("/tmp/result.json"), "/tmp/result.json");
  assert.equal(addJsonExtension("/tmp/result.JSON"), "/tmp/result.JSON");
});

test("добавляет в имя JSON маркер исходного контейнера", () => {
  assert.equal(
    addSourceFormatJsonExtension("/tmp/result.json", "iso2709"),
    "/tmp/result.iso.json",
  );
  assert.equal(
    addSourceFormatJsonExtension("/tmp/result.iso.json", "aleph-sequential"),
    "/tmp/result.aleph.json",
  );
});

async function createTemporaryDirectory(
  context: TestContext,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "marc-parser-test-"));

  context.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  return directory;
}

function corruptFirstIndicator(source: Buffer): Buffer {
  const corrupted = Buffer.from(source);
  const record = new Iso2709MarcParser().parse(source);
  const fieldIndex = record.fields.findIndex(
    (field) => field.kind === "data",
  );
  const directoryEntry = record.directory[fieldIndex];

  assert.ok(directoryEntry);

  const fieldPosition =
    Number(record.leader.baseAddressOfData) +
    Number(directoryEntry.startingCharacterPosition);
  corrupted[fieldPosition] = "A".charCodeAt(0);

  return corrupted;
}

function corruptBaseAddress(source: Buffer): Buffer {
  const corrupted = Buffer.from(source);
  corrupted.write("00000", 12, "ascii");
  return corrupted;
}

async function assertFileDoesNotExist(path: string): Promise<void> {
  await assert.rejects(
    access(path),
    (error: NodeJS.ErrnoException) => error.code === "ENOENT",
  );
}

test("успешный повторный запуск удаляет устаревший отчёт", async (context) => {
  const directory = await createTemporaryDirectory(context);
  const inputPath = join(directory, "input.mrc");
  const outputPath = join(directory, "result.iso.json");
  const source = await readFile(recordUrl);
  await writeFile(inputPath, corruptFirstIndicator(source));
  const first = await convertMarcFile({ encoding: "utf-8", inputPath, outputPath });
  assert.ok(first.validationErrorsPath);
  await writeFile(inputPath, source);
  const second = await convertMarcFile({ encoding: "utf-8", inputPath, outputPath });
  assert.equal(second.validationErrorsPath, undefined);
  await assertFileDoesNotExist(first.validationErrorsPath);
});
