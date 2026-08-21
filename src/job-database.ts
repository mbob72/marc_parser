import { Pool } from "pg";
import type {
  ConversionDirection,
  ConversionJob,
  JobStatus,
  JobSummary,
} from "./job.js";

interface JobRow {
  readonly id: string;
  readonly status: JobStatus;
  readonly original_filename: string;
  readonly encoding: string;
  readonly direction: ConversionDirection;
  readonly input_object_key: string;
  readonly input_bytes: string;
  readonly output_object_key: string | null;
  readonly output_filename: string | null;
  readonly summary: JobSummary | null;
  readonly error: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface CreateJobInput {
  readonly id: string;
  readonly originalFilename: string;
  readonly encoding: string;
  readonly direction: ConversionDirection;
  readonly inputObjectKey: string;
  readonly inputBytes: number;
}

export class JobDatabase {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS conversion_jobs (
        id uuid PRIMARY KEY,
        status text NOT NULL CHECK (
          status IN ('queued', 'processing', 'completed', 'failed')
        ),
        original_filename text NOT NULL,
        encoding text NOT NULL,
        direction text NOT NULL DEFAULT 'iso-to-json' CHECK (
          direction IN ('iso-to-json', 'json-to-iso')
        ),
        input_object_key text NOT NULL,
        input_bytes bigint NOT NULL,
        output_object_key text,
        output_filename text,
        summary jsonb,
        error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await this.pool.query(`
      ALTER TABLE conversion_jobs
      ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'iso-to-json'
    `);
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async createJob(input: CreateJobInput): Promise<ConversionJob> {
    const result = await this.pool.query<JobRow>(
      `
        INSERT INTO conversion_jobs (
          id,
          status,
          original_filename,
          encoding,
          direction,
          input_object_key,
          input_bytes
        )
        VALUES ($1, 'queued', $2, $3, $4, $5, $6)
        RETURNING *
      `,
      [
        input.id,
        input.originalFilename,
        input.encoding,
        input.direction,
        input.inputObjectKey,
        input.inputBytes,
      ],
    );

    return mapRequiredRow(result.rows[0]);
  }

  async getJob(id: string): Promise<ConversionJob | null> {
    const result = await this.pool.query<JobRow>(
      "SELECT * FROM conversion_jobs WHERE id = $1",
      [id],
    );

    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async markProcessing(id: string): Promise<void> {
    await this.pool.query(
      `
        UPDATE conversion_jobs
        SET status = 'processing', error = NULL, updated_at = now()
        WHERE id = $1
      `,
      [id],
    );
  }

  async markQueuedForRetry(id: string, error: string): Promise<void> {
    await this.pool.query(
      `
        UPDATE conversion_jobs
        SET status = 'queued', error = $2, updated_at = now()
        WHERE id = $1
      `,
      [id, error],
    );
  }

  async markCompleted(
    id: string,
    outputObjectKey: string,
    outputFilename: string,
    summary: JobSummary,
  ): Promise<void> {
    await this.pool.query(
      `
        UPDATE conversion_jobs
        SET
          status = 'completed',
          output_object_key = $2,
          output_filename = $3,
          summary = $4,
          error = NULL,
          updated_at = now()
        WHERE id = $1
      `,
      [id, outputObjectKey, outputFilename, JSON.stringify(summary)],
    );
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.pool.query(
      `
        UPDATE conversion_jobs
        SET status = 'failed', error = $2, updated_at = now()
        WHERE id = $1
      `,
      [id, error],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function mapRequiredRow(row: JobRow | undefined): ConversionJob {
  if (!row) {
    throw new Error("PostgreSQL не вернул созданное задание.");
  }

  return mapRow(row);
}

function mapRow(row: JobRow): ConversionJob {
  return {
    id: row.id,
    status: row.status,
    originalFilename: row.original_filename,
    encoding: row.encoding,
    direction: row.direction,
    inputObjectKey: row.input_object_key,
    inputBytes: Number(row.input_bytes),
    outputObjectKey: row.output_object_key,
    outputFilename: row.output_filename,
    summary: row.summary,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
