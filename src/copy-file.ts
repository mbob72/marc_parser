import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { resolve } from "node:path";
import { Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MarcParserValidator } from "./marc-parser-validator.js";
import { MarcRecordSplitter } from "./marc-record-splitter.js";

const DEFAULT_ENCODING = "utf-8";
const CHUNK_SIZE = 64 * 1024;

const { decoder, inputPath, outputPath } = parseArgs();
const parserValidator = new MarcParserValidator();
const recordSplitter = new MarcRecordSplitter(parserValidator);

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

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
