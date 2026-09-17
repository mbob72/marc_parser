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

      this.recordsWithParsingErrors += 1;
      throw error;
    }

    const validationResult = this.validator.validate(record);

    await this.logger?.logValidationResult(validationResult, context);

    const serializedRecord = JSON.stringify(
      this.serializer.serialize(record),
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
    this.recordIndex += 1;
    this.byteOffset += recordByteLength;

    return `${serializedRecord}\n`;
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
