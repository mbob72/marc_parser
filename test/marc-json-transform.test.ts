import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import test from "node:test";
import {
  MarcJsonSerializer,
  UNRECOGNIZED_VALUE,
} from "../src/marc-json-serializer.ts";
import { MarcJsonTransform } from "../src/marc-json-transform.ts";
import {
  Iso2709MarcParser,
  type MarcParser,
} from "../src/marc-parser.ts";
import { NullMarcProcessingLogger } from "../src/marc-processing-logger.ts";
import type { MarcRecordContext } from "../src/marc-record-processor.ts";
import type { MarcRecord } from "../src/marc-record.ts";
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

test("записывает несколько MARC-записей как NDJSON", async () => {
  const record = await readFile(recordUrl);

  const output = await transformRecords([record, record]);
  const json = output.trimEnd().split("\n").map((line) => JSON.parse(line));

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
  const logger = new RecordingLogger();
  const transform = new MarcJsonTransform(
    new Iso2709MarcParser(),
    validator,
    new MarcJsonSerializer("utf-8"),
    logger,
  );

  const output = await collectOutput(Readable.from([record]).pipe(transform));
  const json = output.trimEnd().split("\n").map((line) => JSON.parse(line));

  assert.deepEqual(logger.validationErrors, errors);
  assert.equal(json[0]?.leader, UNRECOGNIZED_VALUE);
  assert.equal(json[0]?.fields[0]?.code, UNRECOGNIZED_VALUE);
});

test("заменяет структурно повреждённую запись и продолжает поток", async () => {
  const record = await readFile(recordUrl);
  const logger = new RecordingLogger();
  const transform = new MarcJsonTransform(
    new FailsSecondParser(),
    new MarcRecordValidator(),
    new MarcJsonSerializer("utf-8"),
    logger,
  );

  const output = await collectOutput(
    Readable.from([record, record]).pipe(transform),
  );
  const json = output.trimEnd().split("\n").map((line) => JSON.parse(line));

  assert.equal(json.length, 2);
  assert.equal(json[0]?.leader, "01590cam a2200217 u 4500");
  assert.deepEqual(json[1], {
    leader: UNRECOGNIZED_VALUE,
    format: UNRECOGNIZED_VALUE,
    fields: [],
  });
  assert.equal(logger.parsingErrors.length, 1);
  assert.equal(logger.parsingErrors[0]?.context.recordIndex, 1);
  assert.deepEqual(transform.statistics, {
    recordsProcessed: 2,
    validRecords: 1,
    recordsWithValidationErrors: 0,
    recordsWithParsingErrors: 1,
    validationErrors: 0,
    inputBytes: record.length * 2,
  });
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

class RecordingLogger extends NullMarcProcessingLogger {
  readonly parsingErrors: Array<{
    error: Error;
    context: MarcRecordContext;
  }> = [];
  validationErrors: readonly MarcValidationError[] = [];

  override logValidationResult(result: MarcValidationResult): void {
    this.validationErrors = result.errors;
  }

  override logParsingError(
    error: Error,
    context: MarcRecordContext,
  ): void {
    this.parsingErrors.push({ error, context });
  }
}

class FailsSecondParser implements MarcParser {
  private readonly parser = new Iso2709MarcParser();
  private recordIndex = 0;

  parse(record: Buffer): MarcRecord {
    const recordIndex = this.recordIndex;
    this.recordIndex += 1;

    if (recordIndex === 1) {
      throw new Error("Повреждённая Directory.");
    }

    return this.parser.parse(record);
  }
}
