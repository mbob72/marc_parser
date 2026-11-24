import type { MarcField, MarcRecord } from "./marc-record.js";
import { isAlphabeticTag } from "./marc-import-policy.js";
export type KnownMarcJsonFormat =
  | "AN"
  | "AU"
  | "BK"
  | "CF"
  | "CR"
  | "MP"
  | "MU"
  | "MX"
  | "SE"
  | "VM";

/** Known codes are suggested by the IDE; unknown source values are preserved. */
export type MarcJsonFormat = KnownMarcJsonFormat | (string & {});

export interface MarcJsonSubfield {
  readonly code: string;
  readonly value: string;
}

export interface MarcJsonControlField {
  readonly code: string;
  readonly value: string;
}

export interface MarcJsonDataField {
  readonly code: string;
  readonly ind1: string;
  readonly ind2: string;
  readonly subfields: readonly MarcJsonSubfield[];
}

export type MarcJsonField = MarcJsonControlField | MarcJsonDataField;

export interface MarcJsonRecord {
  readonly leader: string;
  readonly format: MarcJsonFormat;
  readonly fields: readonly MarcJsonField[];
  /** Первая девятизначная колонка Aleph sequential. */
  readonly recordId?: string;
}

export interface MarcRecordSerializer<T> {
  serialize(record: MarcRecord): T;
}

export class MarcJsonSerializer implements MarcRecordSerializer<MarcJsonRecord> {
  private readonly decoder: TextDecoder;

  constructor(encoding: string) {
    this.decoder = new TextDecoder(encoding);
  }

  // DOC-PREVIEW:/docs/RSL-import-policy.md#output-leader
  serialize(record: MarcRecord): MarcJsonRecord {
    const retained = record.fields.filter(({ tag }) => !isAlphabeticTag(tag));
    const fields = retained.map((field) => this.serializeField(field));
    // Размеры относятся к итоговым MARC-полям в UTF-8, а не к исходному DAT
    // или тексту JSON. FMT уже исключён; каждый повтор поля учитывается отдельно.
    const baseAddress = 24 + 12 * fields.length + 1;
    const recordLength = baseAddress + fields.reduce((size, field) => {
      const contentLength = "value" in field
        ? Buffer.byteLength(field.value, "utf8")
        : 2 + // Как в АБИС v3: два индикатора по одному байту.
          field.subfields.reduce((length, subfield) =>
            length + 2 + Buffer.byteLength(subfield.value, "utf8"), 0);
      return size + contentLength + 1; // Завершение каждого поля 0x1E.
    }, 0) + 1; // Завершение записи 0x1D.
    const leader = String(recordLength).padStart(5, "0") +
      record.leader.raw.slice(5, 12) + String(baseAddress).padStart(5, "0") +
      record.leader.raw.slice(17);
    const format = record.fields.find(({ tag }) => tag.toUpperCase() === "FMT");
    return {
      ...(record.sourceRecordId === undefined ? {} : { recordId: record.sourceRecordId }),
      leader,
      format: format ? this.decoder.decode(format.raw.subarray(0, -1)) : "",
      fields,
    };
  }

  private serializeField(field: MarcField): MarcJsonField {
    if (field.kind === "control") {
      return { code: field.tag, value: this.decoder.decode(field.value) };
    }
    return {
      code: field.tag,
      ind1: field.indicators[0] ?? "",
      ind2: field.indicators[1] ?? "",
      subfields: field.subfields.map(({ code, value }) => ({
        code,
        value: this.decoder.decode(value),
      })),
    };
  }
}

export function isMarcJsonFormat(value: string): value is KnownMarcJsonFormat {
  return [
    "AN",
    "AU",
    "BK",
    "CF",
    "CR",
    "MP",
    "MU",
    "MX",
    "SE",
    "VM",
  ].includes(value);
}
