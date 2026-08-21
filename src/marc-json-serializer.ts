import type { MarcField, MarcRecord } from "./marc-record.js";
import type {
  MarcValidationError,
  MarcValidationRule,
} from "./marc-validator.js";

export const UNRECOGNIZED_VALUE = "<unrecognized>";

export type MarcJsonFormat =
  | "AN"
  | "AU"
  | "BK"
  | "CF"
  | "CR"
  | "MP"
  | "MU"
  | "MX"
  | "SE"
  | "VM"
  | typeof UNRECOGNIZED_VALUE;

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
  serialize(
    record: MarcRecord,
    errors?: readonly MarcValidationError[],
  ): T;

  serializeUnrecognized(): T;
}

export class MarcJsonSerializer
  implements MarcRecordSerializer<MarcJsonRecord>
{
  private readonly decoder: TextDecoder;

  constructor(encoding: string) {
    this.decoder = new TextDecoder(encoding);
  }

  serialize(
    record: MarcRecord,
    errors: readonly MarcValidationError[] = [],
  ): MarcJsonRecord {
    return {
      ...(record.sourceRecordId === undefined
        ? {}
        : { recordId: record.sourceRecordId }),
      leader: hasRule(errors, "LD-02")
        ? UNRECOGNIZED_VALUE
        : record.leader.raw,
      format: this.resolveFormat(record, errors),
      fields: record.fields.flatMap((field, fieldIndex) =>
        field.tag.toUpperCase() === "FMT"
          ? []
          : [this.serializeField(field, fieldIndex, errors)],
      ),
    };
  }

  private resolveFormat(
    record: MarcRecord,
    errors: readonly MarcValidationError[],
  ): MarcJsonFormat {
    const fieldIndex = record.fields.findIndex(
      ({ tag }) => tag.toUpperCase() === "FMT",
    );

    if (fieldIndex === -1) {
      return UNRECOGNIZED_VALUE;
    }

    const field = record.fields[fieldIndex];
    const fieldErrors = errors.filter(
      (error) => error.fieldIndex === fieldIndex,
    );

    if (!field || fieldErrors.length > 0) {
      return UNRECOGNIZED_VALUE;
    }

    const rawValue =
      field.kind === "control"
        ? this.decoder.decode(field.value)
        : field.subfields[0]
          ? this.decoder.decode(field.subfields[0].value)
          : "";
    const value = rawValue.trim().toUpperCase();

    if (isMarcJsonFormat(value)) {
      return value;
    }

    // Aleph exports encountered in practice may retain service-field
    // decorations around the value. Accept one unambiguous format token.
    const tokens = value.match(/(?:AN|AU|BK|CF|CR|MP|MU|MX|SE|VM)/g) ?? [];
    return tokens.length === 1 && isMarcJsonFormat(tokens[0]!)
      ? tokens[0]!
      : UNRECOGNIZED_VALUE;
  }

  serializeUnrecognized(): MarcJsonRecord {
    return {
      leader: UNRECOGNIZED_VALUE,
      format: UNRECOGNIZED_VALUE,
      fields: [],
    };
  }

  private serializeField(
    field: MarcField,
    fieldIndex: number,
    errors: readonly MarcValidationError[],
  ): MarcJsonField {
    const fieldErrors = errors.filter(
      (error) => error.fieldIndex === fieldIndex,
    );
    const code = hasRule(fieldErrors, "DR-E2")
      ? UNRECOGNIZED_VALUE
      : field.tag;

    if (field.kind === "control") {
      return {
        code,
        value: hasRule(fieldErrors, "VF-G3")
          ? UNRECOGNIZED_VALUE
          : this.decoder.decode(field.value),
      };
    }

    if (hasRule(fieldErrors, "VF-G3")) {
      return createUnrecognizedDataField(code);
    }

    const subfields = field.subfields.map(
      ({ code: subfieldCode, value }, subfieldIndex) => ({
        code: hasSubfieldError(fieldErrors, subfieldIndex)
          ? UNRECOGNIZED_VALUE
          : subfieldCode,
        value: this.decoder.decode(value),
      }),
    );

    return {
      code,
      ind1: serializeIndicator(field.indicators, 0, fieldErrors),
      ind2: serializeIndicator(field.indicators, 1, fieldErrors),
      subfields:
        subfields.length === 0 && hasRule(fieldErrors, "DF-G3")
          ? [createUnrecognizedSubfield()]
          : subfields,
    };
  }
}

function serializeIndicator(
  indicators: readonly string[],
  indicatorIndex: number,
  errors: readonly MarcValidationError[],
): string {
  const indicator = indicators[indicatorIndex];
  const invalid = errors.some(
    (error) =>
      error.rule === "IN-G3" && error.indicatorIndex === indicatorIndex,
  );

  return indicator === undefined || invalid
    ? UNRECOGNIZED_VALUE
    : indicator;
}

function hasSubfieldError(
  errors: readonly MarcValidationError[],
  subfieldIndex: number,
): boolean {
  return errors.some(
    (error) =>
      (error.rule === "VF-G5" || error.rule === "SF-G4") &&
      error.subfieldIndex === subfieldIndex,
  );
}

function hasRule(
  errors: readonly MarcValidationError[],
  rule: MarcValidationRule,
): boolean {
  return errors.some((error) => error.rule === rule);
}

function createUnrecognizedDataField(code: string): MarcJsonDataField {
  return {
    code,
    ind1: UNRECOGNIZED_VALUE,
    ind2: UNRECOGNIZED_VALUE,
    subfields: [createUnrecognizedSubfield()],
  };
}

function createUnrecognizedSubfield(): MarcJsonSubfield {
  return {
    code: UNRECOGNIZED_VALUE,
    value: UNRECOGNIZED_VALUE,
  };
}

export function isMarcJsonFormat(value: string): value is Exclude<
  MarcJsonFormat,
  typeof UNRECOGNIZED_VALUE
> {
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
