import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { MarcJsonSerializer } from "./marc-json-serializer.js";
import { MarcJsonTransform } from "./marc-json-transform.js";
import { Iso2709MarcParser } from "./marc-parser.js";
import { MarcParserValidator } from "./marc-parser-validator.js";
import type {
  MarcProcessingLogger,
  MarcProcessingSummary,
} from "./marc-processing-logger.js";
import { MarcRecordSplitter } from "./marc-record-splitter.js";
import { MarcRecordValidator } from "./marc-validator.js";

export const PARSING_ERRORS_PREFIX = "pErrors_";
export const JSON_EXTENSION = ".json";

const DEFAULT_CHUNK_SIZE = 64 * 1024;

export interface ConvertMarcFileOptions {
  readonly encoding: string;
  readonly inputPath: string;
  readonly outputPath: string;
  readonly logger?: MarcProcessingLogger;
  readonly chunkSize?: number;
}

export async function convertMarcFile(
  options: ConvertMarcFileOptions,
): Promise<MarcProcessingSummary> {
  const {
    encoding,
    inputPath,
    outputPath,
    logger,
    chunkSize = DEFAULT_CHUNK_SIZE,
  } = options;
  const jsonOutputPath = addJsonExtension(outputPath);
  const parsingErrorsOutputPath = addParsingErrorsPrefix(jsonOutputPath);

  if (
    inputPath === jsonOutputPath ||
    inputPath === parsingErrorsOutputPath
  ) {
    throw new Error("Входной и выходной файлы должны отличаться.");
  }

  const temporaryOutputPath = createTemporaryOutputPath(jsonOutputPath);
  const jsonTransform = new MarcJsonTransform(
    new Iso2709MarcParser(),
    new MarcRecordValidator(),
    new MarcJsonSerializer(encoding),
    logger,
  );
  const inputStream = createReadStream(inputPath, {
    highWaterMark: chunkSize,
  });
  const startedAt = process.hrtime.bigint();
  let outputWasRenamed = false;

  try {
    await once(inputStream, "open");

    await pipeline(
      inputStream,
      new MarcRecordSplitter(new MarcParserValidator()),
      jsonTransform,
      createWriteStream(temporaryOutputPath, { flags: "wx" }),
    );

    const statistics = jsonTransform.statistics;
    const finalOutputPath =
      statistics.recordsWithParsingErrors > 0
        ? parsingErrorsOutputPath
        : jsonOutputPath;

    await rename(temporaryOutputPath, finalOutputPath);
    outputWasRenamed = true;

    const summary: MarcProcessingSummary = {
      ...statistics,
      durationMilliseconds: elapsedMilliseconds(startedAt),
      outputPath: finalOutputPath,
    };

    await logger?.logSummary(summary);

    return summary;
  } catch (error) {
    if (!outputWasRenamed) {
      await removeTemporaryFile(temporaryOutputPath);
    }

    throw error;
  }
}

export function addJsonExtension(outputPath: string): string {
  return outputPath.toLowerCase().endsWith(JSON_EXTENSION)
    ? outputPath
    : `${outputPath}${JSON_EXTENSION}`;
}

export function addParsingErrorsPrefix(outputPath: string): string {
  const outputDirectory = dirname(outputPath);
  const outputFilename = basename(outputPath);

  if (outputFilename.startsWith(PARSING_ERRORS_PREFIX)) {
    return outputPath;
  }

  return join(outputDirectory, `${PARSING_ERRORS_PREFIX}${outputFilename}`);
}

function createTemporaryOutputPath(outputPath: string): string {
  const outputDirectory = dirname(outputPath);
  const outputFilename = basename(outputPath);

  return join(
    outputDirectory,
    `.${outputFilename}.${process.pid}-${randomUUID()}.tmp`,
  );
}

async function removeTemporaryFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function elapsedMilliseconds(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}
