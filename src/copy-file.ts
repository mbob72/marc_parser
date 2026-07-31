import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { resolve } from "node:path";
import { Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Iso2709MarcParser } from "./marc-parser.js";
import { MarcParserValidator } from "./marc-parser-validator.js";
import type { MarcRecordContext } from "./marc-record-processor.js";
import { MarcRecordSplitter } from "./marc-record-splitter.js";
import type { MarcRecord } from "./marc-record.js";
import {
  MarcRecordValidator,
  type MarcValidationResult,
} from "./marc-validator.js";

const DEFAULT_ENCODING = "utf-8";
const CHUNK_SIZE = 64 * 1024;

const { decoder, fieldDecoder, inputPath, outputPath } = parseArgs();
const marcParser = new Iso2709MarcParser();
const marcValidator = new MarcRecordValidator();
const parserValidator = new MarcParserValidator();
const recordSplitter = new MarcRecordSplitter({
  async process(record, context): Promise<void> {
    await parserValidator.process(record, context);

    const parsedRecord = marcParser.parse(record);
    await logFields(parsedRecord, context, fieldDecoder);
    await logValidationResult(
      marcValidator.validate(parsedRecord),
      context,
    );
  },
});

const logRecords = new Transform({
  transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    void writeToConsole(decoder.decode(chunk, { stream: true })).then(
      () => callback(null, chunk),
      (error: unknown) => callback(toError(error)),
    );
  },

  flush(callback: TransformCallback): void {
    void writeToConsole(decoder.decode()).then(
      () => callback(),
      (error: unknown) => callback(toError(error)),
    );
  },
});

const inputStream = createReadStream(inputPath, {
  highWaterMark: CHUNK_SIZE,
});

try {
  await once(inputStream, "open");

  await pipeline(
    inputStream,
    recordSplitter,
    logRecords,
    createWriteStream(outputPath),
  );
} catch (error) {
  console.error(`\nОшибка обработки: ${toError(error).message}`);
  process.exitCode = 1;
}

interface Arguments {
  decoder: TextDecoder;
  fieldDecoder: TextDecoder;
  inputPath: string;
  outputPath: string;
}

function parseArgs(): Arguments {
  const [, , inputArgument, outputArgument, encoding = DEFAULT_ENCODING] =
    process.argv;

  if (!inputArgument || !outputArgument) {
    console.error(
      "Использование: node dist/copy-file.js <входной-файл> <выходной-файл> [кодировка]",
    );
    process.exit(1);
  }

  const inputPath = resolve(inputArgument);
  const outputPath = resolve(outputArgument);

  if (inputPath === outputPath) {
    console.error("Входной и выходной файлы должны отличаться.");
    process.exit(1);
  }

  return {
    decoder: createTextDecoder(encoding),
    fieldDecoder: createTextDecoder(encoding),
    inputPath,
    outputPath,
  };
}

function createTextDecoder(encoding: string): TextDecoder {
  try {
    return new TextDecoder(encoding);
  } catch {
    console.error(`Кодировка ${JSON.stringify(encoding)} не поддерживается.`);
    process.exit(1);
  }
}

async function writeToConsole(text: string): Promise<void> {
  if (text.length > 0 && !process.stdout.write(text)) {
    await once(process.stdout, "drain");
  }
}

async function logFields(
  record: MarcRecord,
  context: MarcRecordContext,
  decoder: TextDecoder,
): Promise<void> {
  for (const field of record.fields) {
    const content = field.raw.subarray(0, -1);
    const text = decoder.decode(content);

    await writeToConsole(
      `\nЗапись ${context.recordIndex + 1}, тег ${field.tag}: ${JSON.stringify(text)}\n`,
    );

    if (field.kind === "data") {
      await writeToConsole(
        `  Индикаторы: ${JSON.stringify(field.indicators)}\n`,
      );

      for (const subfield of field.subfields) {
        const value = decoder.decode(subfield.value);

        await writeToConsole(
          `  Подполе ${JSON.stringify(subfield.code)}: ${JSON.stringify(value)}\n`,
        );
      }
    }
  }
}

async function logValidationResult(
  result: MarcValidationResult,
  context: MarcRecordContext,
): Promise<void> {
  if (result.valid) {
    await writeToConsole(
      `  Валидация записи ${context.recordIndex + 1}: ошибок нет.\n`,
    );
    return;
  }

  for (const error of result.errors) {
    await writeToConsole(
      `  Ошибка валидации записи ${context.recordIndex + 1} ` +
        `[${error.rule}]: ${error.message}\n`,
    );
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
