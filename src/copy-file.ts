import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { MarcJsonSerializer } from "./marc-json-serializer.js";
import { MarcJsonTransform } from "./marc-json-transform.js";
import { Iso2709MarcParser } from "./marc-parser.js";
import { MarcParserValidator } from "./marc-parser-validator.js";
import type { MarcRecordContext } from "./marc-record-processor.js";
import { MarcRecordSplitter } from "./marc-record-splitter.js";
import {
  MarcRecordValidator,
  type MarcValidationResult,
} from "./marc-validator.js";

const DEFAULT_ENCODING = "utf-8";
const CHUNK_SIZE = 64 * 1024;

const { encoding, inputPath, outputPath } = parseArgs();
const marcParser = new Iso2709MarcParser();
const marcValidator = new MarcRecordValidator();
const parserValidator = new MarcParserValidator();
const recordSplitter = new MarcRecordSplitter(parserValidator);
const jsonSerializer = new MarcJsonSerializer(encoding);
const jsonTransform = new MarcJsonTransform(
  marcParser,
  marcValidator,
  jsonSerializer,
  logValidationResult,
);

const inputStream = createReadStream(inputPath, {
  highWaterMark: CHUNK_SIZE,
});

try {
  await once(inputStream, "open");

  await pipeline(
    inputStream,
    recordSplitter,
    jsonTransform,
    createWriteStream(outputPath),
  );
} catch (error) {
  console.error(`\nОшибка обработки: ${toError(error).message}`);
  process.exitCode = 1;
}

interface Arguments {
  encoding: string;
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

  validateEncoding(encoding);

  return {
    encoding,
    inputPath,
    outputPath,
  };
}

function validateEncoding(encoding: string): void {
  try {
    new TextDecoder(encoding);
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
