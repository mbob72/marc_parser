import { Transform, type TransformCallback } from "node:stream";
import type {
  MarcRecordContext,
  MarcRecordProcessor,
} from "./marc-record-processor.js";

const RECORD_LENGTH_SIZE = 5;
const MIN_RECORD_LENGTH = 25;

export class MarcRecordSplitter extends Transform {
  private pending: Buffer = Buffer.alloc(0);
  private recordIndex = 0;
  private byteOffset = 0;

  constructor(private readonly processor: MarcRecordProcessor) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    void this.processChunk(chunk).then(
      () => callback(),
      (error: unknown) => callback(toError(error)),
    );
  }

  override _flush(callback: TransformCallback): void {
    if (this.pending.length === 0) {
      callback();
      return;
    }

    callback(
      new Error(
        `Неожиданный конец файла: осталось ${this.pending.length} байт незавершённой MARC-записи.`,
      ),
    );
  }

  private async processChunk(chunk: Buffer): Promise<void> {
    this.pending =
      this.pending.length === 0
        ? chunk
        : Buffer.concat([this.pending, chunk]);

    while (this.pending.length >= RECORD_LENGTH_SIZE) {
      const recordLength = this.readRecordLength();

      if (this.pending.length < recordLength) {
        return;
      }

      const record = this.pending.subarray(0, recordLength);
      const context: MarcRecordContext = {
        recordIndex: this.recordIndex,
        byteOffset: this.byteOffset,
      };

      await this.processor.process(record, context);
      this.push(record);

      this.pending = this.pending.subarray(recordLength);
      this.recordIndex += 1;
      this.byteOffset += recordLength;
    }
  }

  private readRecordLength(): number {
    const rawLength = this.pending
      .subarray(0, RECORD_LENGTH_SIZE)
      .toString("ascii");

    if (!/^[0-9]{5}$/.test(rawLength)) {
      throw new Error(
        `Некорректная длина MARC-записи по смещению ${this.byteOffset}: ${JSON.stringify(rawLength)}.`,
      );
    }

    const recordLength = Number(rawLength);

    if (recordLength < MIN_RECORD_LENGTH) {
      throw new Error(
        `Длина MARC-записи по смещению ${this.byteOffset} равна ${recordLength}; минимум ${MIN_RECORD_LENGTH} байт.`,
      );
    }

    return recordLength;
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
