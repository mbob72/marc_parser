import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { MarcAlephSequentialSerializer } from "./marc-aleph-sequential-serializer.js";
import { MarcIsoSerializer } from "./marc-iso-serializer.js";
import { MarcJsonToIsoTransform } from "./marc-json-to-iso-transform.js";
import type {
  MarcProcessingLogger,
  MarcProcessingSummary,
} from "./marc-processing-logger.js";

export const ISO_EXTENSION = ".mrc";
export const ALEPH_EXTENSION = ".dat";
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
  const resolvedOutputFormat = resolveOutputFormat(inputPath);
  const binaryOutputPath =
    resolvedOutputFormat === "aleph-sequential"
      ? addAlephExtension(outputPath)
      : addIsoExtension(outputPath);

  if (inputPath === binaryOutputPath) {
    throw new Error("Входной и выходной файлы должны отличаться.");
  }

  const temporaryOutputPath = createTemporaryOutputPath(binaryOutputPath);
  const transform = new MarcJsonToIsoTransform(
    resolvedOutputFormat === "aleph-sequential"
      ? new MarcAlephSequentialSerializer(encoding)
      : new MarcIsoSerializer(encoding),
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
    await rename(temporaryOutputPath, binaryOutputPath);
    outputWasRenamed = true;

    const summary: MarcProcessingSummary = {
      ...transform.statistics,
      durationMilliseconds: elapsedMilliseconds(startedAt),
      outputPath: binaryOutputPath,
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
  if (extension === ".mrc" || extension === ".iso") {
    return outputPath;
  }
  return extension === ALEPH_EXTENSION
    ? `${outputPath.slice(0, -extension.length)}${ISO_EXTENSION}`
    : `${outputPath}${ISO_EXTENSION}`;
}

export function addAlephExtension(outputPath: string): string {
  const extension = extname(outputPath).toLowerCase();
  if (extension === ALEPH_EXTENSION) {
    return outputPath;
  }
  return extension === ".mrc" || extension === ".iso"
    ? `${outputPath.slice(0, -extension.length)}${ALEPH_EXTENSION}`
    : `${outputPath}${ALEPH_EXTENSION}`;
}

function resolveOutputFormat(inputPath: string): "iso2709" | "aleph-sequential" {
  const filename = basename(inputPath).toLowerCase();
  if (/\.aleph\.(?:json|ndjson)$/.test(filename)) {
    return "aleph-sequential";
  }
  if (/\.iso\.(?:json|ndjson)$/.test(filename)) {
    return "iso2709";
  }

  throw new Error(
    "Имя входного JSON должно заканчиваться на .iso.json, .iso.ndjson, " +
      ".aleph.json или .aleph.ndjson.",
  );
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
