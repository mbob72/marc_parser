import { Transform, type TransformCallback } from "node:stream";
import type { MarcParser } from "./marc-parser.js";
import type {
  MarcProcessingLogger,
  MarcProcessingStatistics,
} from "./marc-processing-logger.js";
import type { MarcRecordContext } from "./marc-record-processor.js";
import type {
  MarcJsonRecord,
  MarcRecordSerializer,
} from "./marc-json-serializer.js";
import type { MarcValidator } from "./marc-validator.js";

export class MarcJsonTransform extends Transform {
  private firstRecord: string | undefined;
  private recordIndex = 0;
  private byteOffset = 0;
  private validRecords = 0;
  private recordsWithValidationErrors = 0;
  private recordsWithParsingErrors = 0;
  private validationErrors = 0;

  constructor(
    private readonly parser: MarcParser,
    private readonly validator: MarcValidator,
    private readonly serializer: MarcRecordSerializer<MarcJsonRecord>,
    private readonly logger?: MarcProcessingLogger,
  ) {
    super();
  }

  get statistics(): MarcProcessingStatistics {
    return {
      recordsProcessed: this.recordIndex,
      validRecords: this.validRecords,
      recordsWithValidationErrors: this.recordsWithValidationErrors,
      recordsWithParsingErrors: this.recordsWithParsingErrors,
      validationErrors: this.validationErrors,
      inputBytes: this.byteOffset,
    };
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    void this.convertRecord(chunk).then(
      (output) => callback(null, output),
      (error: unknown) => callback(toError(error)),
    );
  }

  override _flush(callback: TransformCallback): void {
    if (this.recordIndex === 0) {
      callback(null, "[]\n");
      return;
    }

    if (this.recordIndex === 1) {
      callback(null, `${this.firstRecord}\n`);
      return;
    }

    callback(null, "\n]\n");
  }

  private async convertRecord(recordBuffer: Buffer): Promise<string | undefined> {
    const context: MarcRecordContext = {
      recordIndex: this.recordIndex,
      byteOffset: this.byteOffset,
    };
    let record;

    try {
      record = this.parser.parse(recordBuffer);
    } catch (error) {
      await this.logger?.logParsingError(toError(error), context);

      const serializedRecord = JSON.stringify(
        this.serializer.serializeUnrecognized(),
        null,
        2,
      );

      this.recordsWithParsingErrors += 1;

      return this.finishRecord(serializedRecord, recordBuffer.length);
    }

    const validationResult = this.validator.validate(record);

    await this.logger?.logValidationResult(validationResult, context);

    const serializedRecord = JSON.stringify(
      this.serializer.serialize(record, validationResult.errors),
      null,
      2,
    );
    if (validationResult.valid) {
      this.validRecords += 1;
    } else {
      this.recordsWithValidationErrors += 1;
      this.validationErrors += validationResult.errors.length;
    }

    return this.finishRecord(serializedRecord, recordBuffer.length);
  }

  private finishRecord(
    serializedRecord: string,
    recordByteLength: number,
  ): string | undefined {
    const output = this.appendRecord(serializedRecord);

    this.recordIndex += 1;
    this.byteOffset += recordByteLength;

    return output;
  }

  private appendRecord(record: string): string | undefined {
    if (this.firstRecord === undefined) {
      this.firstRecord = record;
      return undefined;
    }

    if (this.recordIndex === 1) {
      return `[\n${indent(this.firstRecord)},\n${indent(record)}`;
    }

    return `,\n${indent(record)}`;
  }
}

function indent(value: string): string {
  return value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
