/**
 * Public, transport-independent contract of the MARC transformation core.
 *
 * The file intentionally has no imports and may be copied into a legacy
 * TypeScript project. Runtime restrictions that TypeScript cannot express are
 * documented in `docs/Контракт типов ядра трансформации MARC.md`.
 */

export const MARC_TRANSFORM_CONTRACT_VERSION = "1.0.0" as const;

export const MARC_CONTAINER_FORMATS = [
  "iso2709",
  "aleph-sequential",
] as const;

export type MarcContainerFormat = (typeof MARC_CONTAINER_FORMATS)[number];

export type MarcInputFormat = "auto" | MarcContainerFormat;

export const MARC_JSON_FORMATS = [
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
] as const;

export type MarcJsonFormat = (typeof MARC_JSON_FORMATS)[number];

export const MARC_UNRECOGNIZED_VALUE = "<unrecognized>" as const;

export type MarcUnrecognizedValue = typeof MARC_UNRECOGNIZED_VALUE;

export interface MarcJsonSubfield {
  /** One lowercase Latin letter or digit in a serializable record. */
  readonly code: string;
  readonly value: string;
}

export interface MarcJsonControlField {
  /** A three-digit tag beginning with 00. */
  readonly code: string;
  readonly value: string;
  readonly ind1?: never;
  readonly ind2?: never;
  readonly subfields?: never;
}

export interface MarcJsonDataField {
  /** A three-character tag other than 00X and FMT. */
  readonly code: string;
  readonly ind1: string;
  readonly ind2: string;
  readonly subfields: readonly MarcJsonSubfield[];
  readonly value?: never;
}

export type MarcJsonField = MarcJsonControlField | MarcJsonDataField;

/**
 * One record emitted by the forward transformation.
 *
 * Invalid parts may contain MARC_UNRECOGNIZED_VALUE. A completely unparsed
 * record has the sentinel in `leader` and `format` and an empty `fields` array.
 */
export interface ParsedMarcJsonRecord {
  readonly leader: string;
  readonly format: MarcJsonFormat | MarcUnrecognizedValue;
  readonly fields: readonly MarcJsonField[];
  /** Nine-digit first column of an Aleph sequential Z00 record. */
  readonly recordId?: string;
}

/**
 * Record accepted by the reverse transformation.
 *
 * This type represents the structural contract. Callers must still validate
 * the string constraints described in the companion specification.
 */
export interface SerializableMarcJsonRecord {
  readonly leader: string;
  readonly format: MarcJsonFormat;
  readonly fields: readonly MarcJsonField[];
  readonly recordId?: string;
}

/** Canonical reverse-transformation input for ISO 2709. */
export interface IsoMarcJsonRecord extends SerializableMarcJsonRecord {
  readonly recordId?: string;
}

/** Canonical reverse-transformation input for Aleph sequential. */
export interface AlephMarcJsonRecord extends SerializableMarcJsonRecord {
  readonly recordId: string;
}

export interface MarcToJsonOptions {
  /** WHATWG encoding label, for example `utf-8` or `windows-1251`. */
  readonly encoding: string;
  readonly inputFormat?: MarcInputFormat;
}

export interface MarcFromJsonOptions {
  /** WHATWG/iconv encoding label supported by the implementation. */
  readonly encoding: string;
  readonly outputFormat: MarcContainerFormat;
}

export interface MarcRecordContext {
  /** Zero-based record number. */
  readonly recordIndex: number;
  /** Zero-based byte offset in the input container. */
  readonly byteOffset: number;
}

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
  readonly indicatorIndex?: number;
  readonly subfieldIndex?: number;
}

export interface MarcValidationResult {
  readonly valid: boolean;
  readonly errors: readonly MarcValidationError[];
}

export interface MarcProcessingStatistics {
  readonly recordsProcessed: number;
  readonly validRecords: number;
  readonly recordsWithValidationErrors: number;
  readonly recordsWithParsingErrors: number;
  readonly validationErrors: number;
  readonly inputBytes: number;
}

export function isMarcJsonFormat(value: string): value is MarcJsonFormat {
  return (MARC_JSON_FORMATS as readonly string[]).includes(value);
}

export function isMarcContainerFormat(
  value: string,
): value is MarcContainerFormat {
  return (MARC_CONTAINER_FORMATS as readonly string[]).includes(value);
}
