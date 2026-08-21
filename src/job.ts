import type { MarcProcessingSummary } from "./marc-processing-logger.js";

export const JOB_STATUSES = [
  "queued",
  "processing",
  "completed",
  "failed",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];
export const CONVERSION_DIRECTIONS = ["iso-to-json", "json-to-iso"] as const;
export type ConversionDirection = (typeof CONVERSION_DIRECTIONS)[number];
export const SERVICE_MARC_FORMATS = ["aleph-sequential", "iso2709"] as const;
export type ServiceMarcFormat = (typeof SERVICE_MARC_FORMATS)[number];
export const DEFAULT_SERVICE_MARC_FORMAT: ServiceMarcFormat =
  "aleph-sequential";
export type JobSummary = Omit<MarcProcessingSummary, "outputPath">;

export interface ConversionJob {
  readonly id: string;
  readonly status: JobStatus;
  readonly originalFilename: string;
  readonly encoding: string;
  readonly direction: ConversionDirection;
  readonly inputFormat: ServiceMarcFormat;
  readonly inputObjectKey: string;
  readonly inputBytes: number;
  readonly outputObjectKey: string | null;
  readonly outputFilename: string | null;
  readonly summary: JobSummary | null;
  readonly error: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly expiresAt: Date;
}

export interface ConversionJobMessage {
  readonly jobId: string;
  readonly attempt: number;
}
