import type {
  MarcDataField,
  MarcRecord,
  MarcSubfield,
} from "./marc-record.js";

export type MarcValidationRule =
  | "RS-G3"
  | "DR-E2"
  | "VF-G3"
  | "LD-02"
  | "VF-G5"
  | "DF-G3"
  | "DF-G2"
  | "IN-G3"
  | "SF-G4";

export interface MarcValidationError {
  readonly rule: MarcValidationRule;
  readonly message: string;
  readonly fieldIndex?: number;
  readonly tag?: string;
  readonly subfieldIndex?: number;
}

export interface MarcValidationResult {
  readonly valid: boolean;
  readonly errors: readonly MarcValidationError[];
}

export interface MarcValidator {
  validate(record: MarcRecord): MarcValidationResult;
}

const MAX_RECORD_LENGTH = 99_999;
const MAX_FIELD_LENGTH = 9_999;
const REQUIRED_INDICATOR_COUNT = 2;
const VALID_TAG = /^(?:[0-9]{3}|[A-Z]{3}|[a-z]{3})$/;
const VALID_INDICATOR = /^[a-z0-9 #]$/;
const VALID_SUBFIELD_CODE = /^[a-z0-9]$/;

export class MarcRecordValidator implements MarcValidator {
  validate(record: MarcRecord): MarcValidationResult {
    const errors: MarcValidationError[] = [];

    validateRecordLength(record, errors);
    validateLeader(record, errors);
    validateDirectory(record, errors);
    validateFields(record, errors);

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

function validateRecordLength(
  record: MarcRecord,
  errors: MarcValidationError[],
): void {
  if (record.byteLength > MAX_RECORD_LENGTH) {
    errors.push({
      rule: "RS-G3",
      message: `Длина записи ${record.byteLength} превышает ${MAX_RECORD_LENGTH}.`,
    });
  }
}

function validateLeader(
  record: MarcRecord,
  errors: MarcValidationError[],
): void {
  const expectedLength = String(record.byteLength).padStart(5, "0");

  if (
    !/^\d{5}$/.test(record.leader.recordLength) ||
    record.leader.recordLength !== expectedLength
  ) {
    errors.push({
      rule: "LD-02",
      message:
        `Leader/00-04 содержит ${JSON.stringify(record.leader.recordLength)}, ` +
        `ожидалось ${JSON.stringify(expectedLength)}.`,
    });
  }
}

function validateDirectory(
  record: MarcRecord,
  errors: MarcValidationError[],
): void {
  record.directory.forEach((entry, fieldIndex) => {
    if (!VALID_TAG.test(entry.tag)) {
      errors.push({
        rule: "DR-E2",
        fieldIndex,
        tag: entry.tag,
        message: `Некорректный тег ${JSON.stringify(entry.tag)}.`,
      });
    }
  });
}

function validateFields(
  record: MarcRecord,
  errors: MarcValidationError[],
): void {
  record.fields.forEach((field, fieldIndex) => {
    if (field.raw.length > MAX_FIELD_LENGTH) {
      errors.push({
        rule: "VF-G3",
        fieldIndex,
        tag: field.tag,
        message:
          `Длина поля ${field.tag} равна ${field.raw.length} ` +
          `и превышает ${MAX_FIELD_LENGTH}.`,
      });
    }

    if (field.kind === "data") {
      validateDataField(field, fieldIndex, errors);
    }
  });
}

function validateDataField(
  field: MarcDataField,
  fieldIndex: number,
  errors: MarcValidationError[],
): void {
  if (field.indicators.length !== REQUIRED_INDICATOR_COUNT) {
    errors.push({
      rule: "DF-G2",
      fieldIndex,
      tag: field.tag,
      message:
        `Поле ${field.tag} содержит ${field.indicators.length} индикатор(а), ` +
        `ожидалось ${REQUIRED_INDICATOR_COUNT}.`,
    });
  }

  field.indicators.forEach((indicator, indicatorIndex) => {
    if (!VALID_INDICATOR.test(indicator)) {
      errors.push({
        rule: "IN-G3",
        fieldIndex,
        tag: field.tag,
        message:
          `Индикатор ${indicatorIndex + 1} поля ${field.tag} ` +
          `имеет недопустимое значение ${JSON.stringify(indicator)}.`,
      });
    }
  });

  if (!field.subfields.some(({ code }) => code.length === 1)) {
    errors.push({
      rule: "DF-G3",
      fieldIndex,
      tag: field.tag,
      message: `Поле ${field.tag} не содержит кода подполя.`,
    });
  }

  field.subfields.forEach((subfield, subfieldIndex) => {
    validateSubfieldCode(
      field,
      subfield,
      fieldIndex,
      subfieldIndex,
      errors,
    );
  });
}

function validateSubfieldCode(
  field: MarcDataField,
  subfield: MarcSubfield,
  fieldIndex: number,
  subfieldIndex: number,
  errors: MarcValidationError[],
): void {
  if (VALID_SUBFIELD_CODE.test(subfield.code)) {
    return;
  }

  const message =
    `Подполе ${subfieldIndex + 1} поля ${field.tag} имеет ` +
    `недопустимый код ${JSON.stringify(subfield.code)}.`;

  errors.push({
    rule: "VF-G5",
    fieldIndex,
    tag: field.tag,
    subfieldIndex,
    message,
  });
  errors.push({
    rule: "SF-G4",
    fieldIndex,
    tag: field.tag,
    subfieldIndex,
    message,
  });
}
