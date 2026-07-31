import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { resolve } from "node:path";

const DEFAULT_ENCODING = "utf-8";
const CHUNK_SIZE = 64 * 1024;

const { writeToConsole, decoder, inputPath, outputPath } = parseArgs();

const logChunks = new Transform({
  async transform(chunk, _encoding, callback) {
    try {
      await writeToConsole(decoder.decode(chunk, { stream: true }));
      callback(null, chunk);
    } catch (error) {
      callback(error);
    }
  },

  async flush(callback) {
    try {
      await writeToConsole(decoder.decode());
      callback();
    } catch (error) {
      callback(error);
    }
  },
});

const inputStream = createReadStream(inputPath, {
  highWaterMark: CHUNK_SIZE,
});

try {
  await once(inputStream, "open");

  await pipeline(
    inputStream,
    logChunks,
    createWriteStream(outputPath),
  );
} catch (error) {
  console.error(
    `\nОшибка копирования: ${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
}

function parseArgs() {
  const [, , inputArgument, outputArgument, encoding = DEFAULT_ENCODING] =
    process.argv;

  if (!inputArgument || !outputArgument) {
    console.error(
      "Использование: node copy-file.mjs <входной-файл> <выходной-файл> [кодировка]",
    );
    process.exit(1);
  }

  const inputPath = resolve(inputArgument);
  const outputPath = resolve(outputArgument);

  if (inputPath === outputPath) {
    console.error("Входной и выходной файлы должны отличаться.");
    process.exit(1);
  }

  let decoder;

  try {
    decoder = new TextDecoder(encoding);
  } catch {
    console.error(`Кодировка ${JSON.stringify(encoding)} не поддерживается.`);
    process.exit(1);
  }

  async function writeToConsole(text) {
    if (text.length > 0 && !process.stdout.write(text)) {
      await once(process.stdout, "drain");
    }
  }

  return {
    writeToConsole,
    decoder,
    inputPath,
    outputPath,
  };
}
