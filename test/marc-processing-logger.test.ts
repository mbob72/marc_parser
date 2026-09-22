import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { ConsoleMarcProcessingLogger } from "../src/marc-processing-logger.ts";
import type { MarcValidationResult } from "../src/marc-validator.ts";

const context = {
  recordIndex: 2,
  byteOffset: 1_024,
};

test("по умолчанию выводит ошибки и итог, но не успешные записи", async () => {
  const output = new CapturedStream();
  const errorOutput = new CapturedStream();
  const logger = new ConsoleMarcProcessingLogger({ output, errorOutput });

  await logger.logValidationResult({ valid: true, errors: [] }, context);
  await logger.logValidationResult(invalidResult(), context);
  await logger.logSummary({
    skippedDeletedRecords: 0, recordsProcessed: 3,
    validRecords: 2,
    recordsWithValidationErrors: 1,
    recordsWithParsingErrors: 0,
    validationErrors: 2,
    inputBytes: 2_048,
    durationMilliseconds: 100,
    outputPath: "/tmp/result.json",
  });

  assert.doesNotMatch(output.text, /Валидация записи 3/);
  assert.match(output.text, /Обработано записей: 3/);
  assert.match(output.text, /Результат: \/tmp\/result\.json/);
  assert.match(errorOutput.text, /\[LD-02\].*\n.*\[DR-E2\]/s);
});

test("в режиме --log выводит успешные записи", async () => {
  const output = new CapturedStream();
  const logger = new ConsoleMarcProcessingLogger({
    verbose: true,
    output,
    errorOutput: new CapturedStream(),
  });

  await logger.logValidationResult({ valid: true, errors: [] }, context);

  assert.equal(output.text, "Валидация записи 3: ошибок нет.\n");
});

function invalidResult(): MarcValidationResult {
  return {
    valid: false,
    errors: [
      {
        rule: "LD-02",
        message: "Ошибка Leader.",
      },
      {
        rule: "DR-E2",
        message: "Ошибка тега.",
        fieldIndex: 0,
      },
    ],
  };
}

class CapturedStream extends PassThrough {
  text = "";

  constructor() {
    super();
    this.on("data", (chunk: Buffer) => {
      this.text += chunk.toString("utf8");
    });
  }
}
