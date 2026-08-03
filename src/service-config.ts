export interface ServiceConfig {
  readonly host: string;
  readonly port: number;
  readonly postgresUrl: string;
  readonly rabbitmqUrl: string;
  readonly queueName: string;
  readonly workerConcurrency: number;
  readonly maxAttempts: number;
  readonly minio: {
    readonly endPoint: string;
    readonly port: number;
    readonly useSSL: boolean;
    readonly accessKey: string;
    readonly secretKey: string;
    readonly bucket: string;
  };
  readonly maxUploadBytes: number;
}

export function loadServiceConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServiceConfig {
  return {
    host: environment.HOST ?? "0.0.0.0",
    port: readPositiveInteger(environment.PORT, 3000, "PORT"),
    postgresUrl:
      environment.DATABASE_URL ??
      "postgres://marc:marc@localhost:5432/marc_parser",
    rabbitmqUrl:
      environment.RABBITMQ_URL ?? "amqp://marc:marc@localhost:5672",
    queueName: environment.RABBITMQ_QUEUE ?? "marc.convert",
    workerConcurrency: readPositiveInteger(
      environment.WORKER_CONCURRENCY,
      2,
      "WORKER_CONCURRENCY",
    ),
    maxAttempts: readPositiveInteger(
      environment.JOB_MAX_ATTEMPTS,
      3,
      "JOB_MAX_ATTEMPTS",
    ),
    minio: {
      endPoint: environment.MINIO_ENDPOINT ?? "localhost",
      port: readPositiveInteger(
        environment.MINIO_PORT,
        9000,
        "MINIO_PORT",
      ),
      useSSL: readBoolean(environment.MINIO_USE_SSL, false),
      accessKey: environment.MINIO_ACCESS_KEY ?? "marc",
      secretKey: environment.MINIO_SECRET_KEY ?? "marc-secret",
      bucket: environment.MINIO_BUCKET ?? "marc-jobs",
    },
    maxUploadBytes: readPositiveInteger(
      environment.MAX_UPLOAD_BYTES,
      5 * 1024 * 1024 * 1024,
      "MAX_UPLOAD_BYTES",
    ),
  };
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} должен быть положительным целым числом.`);
  }

  return parsed;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error("MINIO_USE_SSL должен быть true или false.");
}
