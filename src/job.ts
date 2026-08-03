import type { MarcProcessingSummary } from "./marc-processing-logger.js";

export const JOB_STATUSES = [
  "queued",
  "processing",
  "completed",
  "failed",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];
export type JobSummary = Omit<MarcProcessingSummary, "outputPath">;

export interface ConversionJob {
  readonly id: string;
  readonly status: JobStatus;
  readonly originalFilename: string;
  readonly encoding: string;
  readonly inputObjectKey: string;
  readonly inputBytes: number;
  readonly outputObjectKey: string | null;
  readonly outputFilename: string | null;
  readonly summary: JobSummary | null;
  readonly error: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ConversionJobMessage {
  readonly jobId: string;
  readonly attempt: number;
}
