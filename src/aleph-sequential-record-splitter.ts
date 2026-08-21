import { Transform, type TransformCallback } from "node:stream";
import type {
  MarcRecordContext,
  MarcRecordProcessor,
} from "./marc-record-processor.js";

const RECORD_IDENTIFIER_LENGTH = 9;
const RECORD_PREFIX_LENGTH = 10;
const FIELD_LENGTH_SIZE = 4;
const MIN_FIELD_LENGTH = 6;
const TAB = 0x09;
const CR = 0x0d;
const LF = 0x0a;

/**
 * Splits an Aleph sequential byte stream into logical records.
 *
 * A field length is authoritative, so an LF contained inside a field value is
 * consumed as data. LF or CRLF is recognized as a record separator only when
 * the parser is positioned between two complete fields.
 */
export class AlephSequentialRecordSplitter extends Transform {
  private pending: Buffer = Buffer.alloc(0);
  private recordIndex = 0;
  private byteOffset = 0;

  constructor(private readonly processor?: MarcRecordProcessor) {
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
    void this.flushPending().then(
      () => callback(),
      (error: unknown) => callback(toError(error)),
    );
  }

  private async processChunk(chunk: Buffer): Promise<void> {
    this.pending =
      this.pending.length === 0
        ? chunk
        : Buffer.concat([this.pending, chunk]);

    while (true) {
      const recordLength = this.findRecordLength(false);
      if (recordLength === undefined) {
        return;
      }

      await this.emitRecord(recordLength);
    }
  }

  private async flushPending(): Promise<void> {
    if (this.pending.length === 0) {
      return;
    }

    const recordLength = this.findRecordLength(true);
    if (recordLength === undefined || recordLength !== this.pending.length) {
      throw this.unexpectedEndError();
    }

    await this.emitRecord(recordLength);
  }

  private findRecordLength(endOfStream: boolean): number | undefined {
    if (this.pending.length < RECORD_PREFIX_LENGTH) {
      if (endOfStream) {
        throw this.unexpectedEndError();
      }
      return undefined;
    }

    const identifier = this.pending
      .subarray(0, RECORD_IDENTIFIER_LENGTH)
      .toString("ascii");
    if (!/^[0-9]{9}$/.test(identifier) || this.pending[9] !== TAB) {
      throw new Error(
        `Некорректный префикс Aleph-записи по смещению ${this.byteOffset}.`,
      );
    }

    let offset = RECORD_PREFIX_LENGTH;
    while (true) {
      if (offset === this.pending.length) {
        return endOfStream ? offset : undefined;
      }

      if (this.pending[offset] === LF) {
        return offset + 1;
      }

      if (this.pending[offset] === CR) {
        if (offset + 1 === this.pending.length) {
          if (endOfStream) {
            throw this.unexpectedEndError();
          }
          return undefined;
        }
        if (this.pending[offset + 1] !== LF) {
          throw new Error(
            `Ожидался LF после CR в Aleph-записи по смещению ${this.byteOffset + offset}.`,
          );
        }
        return offset + 2;
      }

      if (this.pending.length - offset < FIELD_LENGTH_SIZE) {
        if (endOfStream) {
          throw this.unexpectedEndError();
        }
        return undefined;
      }

      const rawLength = this.pending
        .subarray(offset, offset + FIELD_LENGTH_SIZE)
        .toString("ascii");
      if (!/^[0-9]{4}$/.test(rawLength)) {
        throw new Error(
          `Некорректная длина Aleph-поля по смещению ${this.byteOffset + offset}: ` +
            `${JSON.stringify(rawLength)}.`,
        );
      }

      const fieldLength = Number(rawLength);
      if (fieldLength < MIN_FIELD_LENGTH) {
        throw new Error(
          `Длина Aleph-поля по смещению ${this.byteOffset + offset} равна ` +
            `${fieldLength}; минимум ${MIN_FIELD_LENGTH} байт.`,
        );
      }

      const fieldEnd = offset + FIELD_LENGTH_SIZE + fieldLength;
      if (fieldEnd > this.pending.length) {
        if (endOfStream) {
          throw this.unexpectedEndError();
        }
        return undefined;
      }
      offset = fieldEnd;
    }
  }

  private async emitRecord(recordLength: number): Promise<void> {
    const record = this.pending.subarray(0, recordLength);
    const context: MarcRecordContext = {
      recordIndex: this.recordIndex,
      byteOffset: this.byteOffset,
    };

    await this.processor?.process(record, context);
    this.push(record);
    this.pending = this.pending.subarray(recordLength);
    this.recordIndex += 1;
    this.byteOffset += recordLength;
  }

  private unexpectedEndError(): Error {
    return new Error(
      `Неожиданный конец файла: осталось ${this.pending.length} байт ` +
        "незавершённой Aleph-записи.",
    );
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
