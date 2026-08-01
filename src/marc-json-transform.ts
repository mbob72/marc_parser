import { Transform, type TransformCallback } from "node:stream";
import type { MarcParser } from "./marc-parser.js";
import type { MarcRecordContext } from "./marc-record-processor.js";
import type {
  MarcJsonRecord,
  MarcRecordSerializer,
} from "./marc-json-serializer.js";
import type {
  MarcValidationResult,
  MarcValidator,
} from "./marc-validator.js";

export type MarcValidationReporter = (
  result: MarcValidationResult,
  context: MarcRecordContext,
) => void | Promise<void>;

export class MarcJsonTransform extends Transform {
  private firstRecord: string | undefined;
  private recordIndex = 0;
  private byteOffset = 0;

  constructor(
    private readonly parser: MarcParser,
    private readonly validator: MarcValidator,
    private readonly serializer: MarcRecordSerializer<MarcJsonRecord>,
    private readonly reportValidation?: MarcValidationReporter,
  ) {
    super();
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
    const record = this.parser.parse(recordBuffer);
    const validationResult = this.validator.validate(record);

    await this.reportValidation?.(validationResult, context);

    const serializedRecord = JSON.stringify(
      this.serializer.serialize(record, validationResult.errors),
      null,
      2,
    );
    const output = this.appendRecord(serializedRecord);

    this.recordIndex += 1;
    this.byteOffset += recordBuffer.length;

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
