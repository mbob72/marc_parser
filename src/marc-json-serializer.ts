import type { MarcField, MarcRecord } from "./marc-record.js";
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

  serialize(record: MarcRecord): MarcJsonRecord {
    const format = record.fields.find(({ tag }) => tag.toUpperCase() === "FMT");
    return {
      ...(record.sourceRecordId === undefined ? {} : { recordId: record.sourceRecordId }),
      leader: record.leader.raw,
      format: format ? this.decoder.decode(format.raw.subarray(0, -1)) : "",
      fields: record.fields
        .filter(({ tag }) => tag.toUpperCase() !== "FMT")
        .map((field) => this.serializeField(field)),
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
