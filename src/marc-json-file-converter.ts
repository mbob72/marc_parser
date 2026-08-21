import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { MarcIsoSerializer } from "./marc-iso-serializer.js";
import { MarcJsonToIsoTransform } from "./marc-json-to-iso-transform.js";
import type {
  MarcProcessingLogger,
  MarcProcessingSummary,
} from "./marc-processing-logger.js";

export const ISO_EXTENSION = ".mrc";
const DEFAULT_CHUNK_SIZE = 64 * 1024;

export interface ConvertMarcJsonFileOptions {
  readonly encoding: string;
  readonly inputPath: string;
  readonly outputPath: string;
  readonly logger?: MarcProcessingLogger;
  readonly chunkSize?: number;
}

export async function convertMarcJsonFile(
  options: ConvertMarcJsonFileOptions,
): Promise<MarcProcessingSummary> {
  const {
    encoding,
    inputPath,
    outputPath,
    logger,
    chunkSize = DEFAULT_CHUNK_SIZE,
  } = options;
  const isoOutputPath = addIsoExtension(outputPath);

  if (inputPath === isoOutputPath) {
    throw new Error("Входной и выходной файлы должны отличаться.");
  }

  const temporaryOutputPath = createTemporaryOutputPath(isoOutputPath);
  const transform = new MarcJsonToIsoTransform(
    new MarcIsoSerializer(encoding),
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
      transform,
      createWriteStream(temporaryOutputPath, { flags: "wx" }),
    );
    await rename(temporaryOutputPath, isoOutputPath);
    outputWasRenamed = true;

    const summary: MarcProcessingSummary = {
      ...transform.statistics,
      durationMilliseconds: elapsedMilliseconds(startedAt),
      outputPath: isoOutputPath,
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

export function addIsoExtension(outputPath: string): string {
  const extension = extname(outputPath).toLowerCase();
  return extension === ".mrc" || extension === ".iso"
    ? outputPath
    : `${outputPath}${ISO_EXTENSION}`;
}

function createTemporaryOutputPath(outputPath: string): string {
  return join(
    dirname(outputPath),
    `.${basename(outputPath)}.${process.pid}-${randomUUID()}.tmp`,
  );
}

async function removeTemporaryFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
    ) {
      throw error;
    }
  }
}

function elapsedMilliseconds(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}
