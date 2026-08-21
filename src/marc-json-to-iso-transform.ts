import { StringDecoder } from "node:string_decoder";
import { Transform, type TransformCallback } from "node:stream";
import type { MarcProcessingStatistics } from "./marc-processing-logger.js";

export interface MarcBinarySerializer {
  serialize(value: unknown): Buffer;
}

/** Converts one compact MARC-JSON object per line to a binary MARC container. */
export class MarcJsonToIsoTransform extends Transform {
  private readonly decoder = new StringDecoder("utf8");
  private pending = "";
  private lineNumber = 0;
  private recordsProcessed = 0;
  private inputBytes = 0;

  constructor(private readonly serializer: MarcBinarySerializer) {
    super();
  }

  get statistics(): MarcProcessingStatistics {
    return {
      recordsProcessed: this.recordsProcessed,
      validRecords: this.recordsProcessed,
      recordsWithValidationErrors: 0,
      recordsWithParsingErrors: 0,
      validationErrors: 0,
      inputBytes: this.inputBytes,
    };
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    try {
      this.inputBytes += chunk.length;
      this.pending += this.decoder.write(chunk);
      this.processCompleteLines();
      callback();
    } catch (error) {
      callback(toError(error));
    }
  }

  override _flush(callback: TransformCallback): void {
    try {
      this.pending += this.decoder.end();
      if (this.pending.trim().length > 0) {
        this.processLine(this.pending.replace(/\r$/, ""));
      }
      callback();
    } catch (error) {
      callback(toError(error));
    }
  }

  private processCompleteLines(): void {
    let newline = this.pending.indexOf("\n");
    while (newline !== -1) {
      const line = this.pending.slice(0, newline).replace(/\r$/, "");
      this.pending = this.pending.slice(newline + 1);
      this.processLine(line);
      newline = this.pending.indexOf("\n");
    }
  }

  private processLine(line: string): void {
    this.lineNumber += 1;
    if (line.trim().length === 0) {
      return;
    }

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `Строка ${this.lineNumber}: некорректный JSON: ${toError(error).message}`,
      );
    }

    try {
      this.push(this.serializer.serialize(value));
    } catch (error) {
      throw new Error(`Строка ${this.lineNumber}: ${toError(error).message}`);
    }
    this.recordsProcessed += 1;
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
