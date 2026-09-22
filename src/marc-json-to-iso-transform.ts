import { Iso2709MarcParser, type MarcParser } from "./marc-parser.js";
import { MarcRecordValidator, type MarcValidator } from "./marc-validator.js";
import { StringDecoder } from "node:string_decoder";
import { Transform, type TransformCallback } from "node:stream";
import type { MarcProcessingLogger, MarcProcessingStatistics } from "./marc-processing-logger.js";

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

  private recordsWithValidationErrors = 0;
  private validationErrors = 0;
  private byteOffset = 0;

  constructor(
    private readonly serializer: MarcBinarySerializer,
    private readonly logger?: MarcProcessingLogger,
    private readonly parser: MarcParser = new Iso2709MarcParser(),
    private readonly validator: MarcValidator = new MarcRecordValidator(),
  ) {
    super();
  }

  get statistics(): MarcProcessingStatistics {
    return {
      recordsProcessed: this.recordsProcessed,
      validRecords: this.recordsProcessed - this.recordsWithValidationErrors,
      recordsWithValidationErrors: this.recordsWithValidationErrors,
      recordsWithParsingErrors: 0,
      validationErrors: this.validationErrors,
      skippedDeletedRecords: 0,
      inputBytes: this.inputBytes,
    };
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.inputBytes += chunk.length;
    this.pending += this.decoder.write(chunk);
    void this.processCompleteLines().then(() => callback(), error => callback(toError(error)));
  }

  override _flush(callback: TransformCallback): void {
    this.pending += this.decoder.end();
    void this.processLine(this.pending).then(() => callback(), error => callback(toError(error)));
  }

  private async processCompleteLines(): Promise<void> {
    let newline = this.pending.indexOf("\n");
    while (newline !== -1) {
      const line = this.pending.slice(0, newline + 1);
      this.pending = this.pending.slice(newline + 1);
      await this.processLine(line);
      newline = this.pending.indexOf("\n");
    }
  }

  private async processLine(line: string): Promise<void> {
    const byteOffset = this.byteOffset;
    this.byteOffset += Buffer.byteLength(line, "utf8");
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
      const output = this.serializer.serialize(value);
      const result = this.validator.validate(this.parser.parse(output));
      await this.logger?.logValidationResult(result, {
        recordIndex: this.recordsProcessed, byteOffset,
      });
      if (!result.valid) {
        this.recordsWithValidationErrors += 1;
        this.validationErrors += result.errors.length;
      }
      this.push(output);
    } catch (error) {
      throw new Error(`Строка ${this.lineNumber}: ${toError(error).message}`);
    }
    this.recordsProcessed += 1;
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
