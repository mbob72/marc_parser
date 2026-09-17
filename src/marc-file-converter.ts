import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { AlephSequentialMarcParser } from "./aleph-sequential-parser.js";
import { AlephSequentialRecordSplitter } from "./aleph-sequential-record-splitter.js";
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

export const JSON_EXTENSION = ".json";

const DEFAULT_CHUNK_SIZE = 64 * 1024;

export interface ConvertMarcFileOptions {
  readonly encoding: string;
  readonly inputPath: string;
  readonly outputPath: string;
  readonly logger?: MarcProcessingLogger;
  readonly chunkSize?: number;
  readonly inputFormat?: MarcInputFormat;
}

export type MarcInputFormat = "auto" | "iso2709" | "aleph-sequential";

export async function convertMarcFile(
  options: ConvertMarcFileOptions,
): Promise<MarcProcessingSummary> {
  const {
    encoding,
    inputPath,
    outputPath,
    logger,
    chunkSize = DEFAULT_CHUNK_SIZE,
    inputFormat = "auto",
  } = options;
  const resolvedInputFormat = await resolveInputFormat(inputPath, inputFormat);
  const jsonOutputPath = addSourceFormatJsonExtension(
    outputPath,
    resolvedInputFormat,
  );
  const validationErrorsPath = `${jsonOutputPath}.validation-errors.ndjson`;

  if (
    inputPath === jsonOutputPath ||
    inputPath === validationErrorsPath
  ) {
    throw new Error("Входной и выходной файлы должны отличаться.");
  }

  const serializer = new MarcJsonSerializer(encoding);
  const temporaryOutputPath = createTemporaryOutputPath(jsonOutputPath);
  const temporaryErrorsPath = createTemporaryOutputPath(validationErrorsPath);
  const errorsFile = await open(temporaryErrorsPath, "wx");
  let errorCount = 0;
  const reportLogger: MarcProcessingLogger = {
    async logValidationResult(result, context) {
      if (!result.valid) {
        await errorsFile.writeFile(JSON.stringify({ ...context, errors: result.errors }) + "\n");
        errorCount += result.errors.length;
      }
      await logger?.logValidationResult(result, context);
    },
    logParsingError: (error, context) => logger?.logParsingError(error, context),
    logSummary: (summary) => logger?.logSummary(summary),
    logFatalError: (error) => logger?.logFatalError(error),
  };
  const jsonTransform = new MarcJsonTransform(
    resolvedInputFormat === "aleph-sequential"
      ? new AlephSequentialMarcParser()
      : new Iso2709MarcParser(),
    new MarcRecordValidator(encoding),
    serializer,
    reportLogger,
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
      resolvedInputFormat === "aleph-sequential"
        ? new AlephSequentialRecordSplitter()
        : new MarcRecordSplitter(new MarcParserValidator()),
      jsonTransform,
      createWriteStream(temporaryOutputPath, { flags: "wx" }),
    );

    const statistics = jsonTransform.statistics;
    const finalOutputPath = jsonOutputPath;
    await errorsFile.close();
    if (errorCount > 0) {
      await rename(temporaryErrorsPath, validationErrorsPath);
    } else {
      await removeTemporaryFile(temporaryErrorsPath);
      await removeTemporaryFile(validationErrorsPath);
    }

    await rename(temporaryOutputPath, finalOutputPath);
    outputWasRenamed = true;

    const summary: MarcProcessingSummary = {
      ...statistics,
      durationMilliseconds: elapsedMilliseconds(startedAt),
      outputPath: finalOutputPath,
      ...(errorCount > 0 ? { validationErrorsPath } : {}),
    };

    await logger?.logSummary(summary);

    return summary;
  } catch (error) {
    await errorsFile.close();
    await removeTemporaryFile(temporaryErrorsPath);
    if (!outputWasRenamed) {
      await removeTemporaryFile(temporaryOutputPath);
    }

    throw error;
  }
}

async function resolveInputFormat(
  inputPath: string,
  requestedFormat: MarcInputFormat,
): Promise<Exclude<MarcInputFormat, "auto">> {
  if (requestedFormat !== "auto") {
    return requestedFormat;
  }

  const handle = await open(inputPath, "r");
  try {
    const prefix = Buffer.alloc(10);
    const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
    const value = prefix.subarray(0, bytesRead).toString("ascii");

    return /^[0-9]{9}\t/.test(value) ? "aleph-sequential" : "iso2709";
  } finally {
    await handle.close();
  }
}

export function addJsonExtension(outputPath: string): string {
  return outputPath.toLowerCase().endsWith(JSON_EXTENSION)
    ? outputPath
    : `${outputPath}${JSON_EXTENSION}`;
}

export function addSourceFormatJsonExtension(
  outputPath: string,
  inputFormat: Exclude<MarcInputFormat, "auto">,
): string {
  const withJsonExtension = addJsonExtension(outputPath);
  const withoutJsonExtension = withJsonExtension.slice(
    0,
    -JSON_EXTENSION.length,
  );
  const withoutOldMarker = withoutJsonExtension.replace(/\.(?:iso|aleph)$/i, "");
  const marker = inputFormat === "aleph-sequential" ? "aleph" : "iso";

  return `${withoutOldMarker}.${marker}${JSON_EXTENSION}`;
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
