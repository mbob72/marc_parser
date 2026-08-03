import { Client } from "minio";
import type { Readable } from "node:stream";
import type { ServiceConfig } from "./service-config.js";

export class ObjectStore {
  private readonly client: Client;
  private readonly bucket: string;

  constructor(config: ServiceConfig["minio"]) {
    this.client = new Client({
      endPoint: config.endPoint,
      port: config.port,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    });
    this.bucket = config.bucket;
  }

  async initialize(): Promise<void> {
    if (!(await this.client.bucketExists(this.bucket))) {
      try {
        await this.client.makeBucket(this.bucket);
      } catch (error) {
        if (!(await this.client.bucketExists(this.bucket))) {
          throw error;
        }
      }
    }
  }

  async put(
    objectKey: string,
    stream: Readable,
    metadata?: Record<string, string>,
    size?: number,
  ): Promise<void> {
    await this.client.putObject(
      this.bucket,
      objectKey,
      stream,
      size,
      metadata,
    );
  }

  async get(objectKey: string): Promise<Readable> {
    return this.client.getObject(this.bucket, objectKey);
  }

  async remove(objectKey: string): Promise<void> {
    await this.client.removeObject(this.bucket, objectKey);
  }
}
