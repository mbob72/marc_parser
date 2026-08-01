import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import test from "node:test";
import {
  MarcJsonSerializer,
  UNRECOGNIZED_VALUE,
} from "../src/marc-json-serializer.ts";
import { MarcJsonTransform } from "../src/marc-json-transform.ts";
import { Iso2709MarcParser } from "../src/marc-parser.ts";
import {
  MarcRecordValidator,
  type MarcValidationError,
  type MarcValidationResult,
  type MarcValidator,
} from "../src/marc-validator.ts";

const recordUrl = new URL(
  "../docs/015316815/015316815.mrc",
  import.meta.url,
);

test("записывает одну MARC-запись как JSON-объект", async () => {
  const record = await readFile(recordUrl);

  const output = await transformRecords([record]);
  const json = JSON.parse(output);

  assert.equal(Array.isArray(json), false);
  assert.equal(json.leader, "01590cam a2200217 u 4500");
});

test("записывает несколько MARC-записей как JSON-массив", async () => {
  const record = await readFile(recordUrl);

  const output = await transformRecords([record, record]);
  const json = JSON.parse(output);

  assert.equal(Array.isArray(json), true);
  assert.equal(json.length, 2);
  assert.equal(json[0]?.fields[0]?.code, "001");
});

test("передаёт все ошибки в лог и заменяет повреждённые части", async () => {
  const record = await readFile(recordUrl);
  const errors: readonly MarcValidationError[] = [
    {
      rule: "LD-02",
      message: "Некорректная длина в Leader.",
    },
    {
      rule: "DR-E2",
      message: "Некорректный тег.",
      fieldIndex: 0,
      tag: "001",
    },
  ];
  const validator: MarcValidator = {
    validate(): MarcValidationResult {
      return { valid: false, errors };
    },
  };
  let reportedErrors: readonly MarcValidationError[] = [];
  const transform = new MarcJsonTransform(
    new Iso2709MarcParser(),
    validator,
    new MarcJsonSerializer("utf-8"),
    (result) => {
      reportedErrors = result.errors;
    },
  );

  const output = await collectOutput(Readable.from([record]).pipe(transform));
  const json = JSON.parse(output);

  assert.deepEqual(reportedErrors, errors);
  assert.equal(json.leader, UNRECOGNIZED_VALUE);
  assert.equal(json.fields[0]?.code, UNRECOGNIZED_VALUE);
});

async function transformRecords(records: readonly Buffer[]): Promise<string> {
  const transform = new MarcJsonTransform(
    new Iso2709MarcParser(),
    new MarcRecordValidator(),
    new MarcJsonSerializer("utf-8"),
  );

  return collectOutput(Readable.from(records).pipe(transform));
}

async function collectOutput(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}
