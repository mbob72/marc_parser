import { Iso2709MarcParser, type MarcParser } from "./marc-parser.js";
import type { MarcRecord } from "./marc-record.js";

const RECORD_PREFIX_LENGTH = 10;
const FIELD_LENGTH_SIZE = 4;
const FIELD_HEADER_LENGTH = 6;
const FIELD_TERMINATOR = 0x1e;
const RECORD_TERMINATOR = 0x1d;
const SUBFIELD_DELIMITER = 0x1f;
const CARET = 0x5e;
const SPACE = 0x20;
const MAX_RECORD_LENGTH = 99_999;
const MAX_FIELD_LENGTH = 9_999;

interface AlephField {
  readonly tag: string;
  readonly indicators: Buffer;
  readonly value: Buffer;
}

interface IsoField {
  readonly tag: string;
  readonly data: Buffer;
}

/** Converts one Aleph sequential record to the common parsed MARC model. */
export class AlephSequentialMarcParser implements MarcParser {
  private readonly isoParser = new Iso2709MarcParser();

  parse(record: Buffer): MarcRecord {
    const sourceRecordId = removeLineEnding(record)
      .subarray(0, 9)
      .toString("ascii");
    return {
      ...this.isoParser.parse(buildIsoRecord(record)),
      sourceRecordId,
    };
  }
}

function buildIsoRecord(source: Buffer): Buffer {
  const record = removeLineEnding(source);
  validatePrefix(record);

  const alephFields = parseFields(record);
  const leaderFields = alephFields.filter(({ tag }) => tag === "LDR");
  if (leaderFields.length !== 1) {
    throw new Error(
      `Aleph-запись должна содержать ровно одно поле LDR; найдено ${leaderFields.length}.`,
    );
  }

  const leader = normalizeCarets(leaderFields[0]!.value);
  if (leader.length !== 24) {
    throw new Error(
      `Поле LDR Aleph-записи содержит ${leader.length} байт; ожидалось 24.`,
    );
  }

  const fields = alephFields
    .filter(({ tag }) => tag !== "LDR")
    .map(toIsoField);
  const baseAddress = 24 + fields.length * 12 + 1;
  let fieldPosition = 0;
  const directory = Buffer.concat(
    fields.map(({ tag, data }) => {
      if (data.length > MAX_FIELD_LENGTH) {
        throw new Error(
          `Поле ${tag} имеет длину ${data.length}; максимум ${MAX_FIELD_LENGTH} байт.`,
        );
      }
      const entry = Buffer.from(
        `${tag}${decimal(data.length, 4)}${decimal(fieldPosition, 5)}`,
        "ascii",
      );
      fieldPosition += data.length;
      return entry;
    }),
  );
  const recordLength = baseAddress + fieldPosition + 1;
  if (recordLength > MAX_RECORD_LENGTH) {
    throw new Error(
      `Aleph-запись после преобразования имеет длину ${recordLength}; ` +
        `максимум ${MAX_RECORD_LENGTH} байт.`,
    );
  }

  const normalizedLeader = Buffer.from(leader);
  normalizedLeader.write(decimal(recordLength, 5), 0, "ascii");
  normalizedLeader.write(decimal(baseAddress, 5), 12, "ascii");
  normalizedLeader.write("4500", 20, "ascii");

  return Buffer.concat([
    normalizedLeader,
    directory,
    Buffer.from([FIELD_TERMINATOR]),
    ...fields.map(({ data }) => data),
    Buffer.from([RECORD_TERMINATOR]),
  ]);
}

function removeLineEnding(source: Buffer): Buffer {
  if (source.at(-1) === 0x0a) {
    const withoutLf = source.subarray(0, -1);
    return withoutLf.at(-1) === 0x0d
      ? withoutLf.subarray(0, -1)
      : withoutLf;
  }
  return source;
}

function validatePrefix(record: Buffer): void {
  if (record.length < RECORD_PREFIX_LENGTH) {
    throw new Error("Aleph-запись короче десятибайтового префикса.");
  }

  const prefix = record.subarray(0, RECORD_PREFIX_LENGTH).toString("ascii");
  if (!/^[0-9]{9}\t$/.test(prefix)) {
    throw new Error(
      `Некорректный префикс Aleph-записи: ${JSON.stringify(prefix)}.`,
    );
  }
}

function parseFields(record: Buffer): AlephField[] {
  const fields: AlephField[] = [];
  let offset = RECORD_PREFIX_LENGTH;

  while (offset < record.length) {
    const rawLength = record
      .subarray(offset, offset + FIELD_LENGTH_SIZE)
      .toString("ascii");
    if (!/^[0-9]{4}$/.test(rawLength)) {
      throw new Error(
        `Некорректная длина Aleph-поля: ${JSON.stringify(rawLength)}.`,
      );
    }
    const length = Number(rawLength);
    const fieldStart = offset + FIELD_LENGTH_SIZE;
    const fieldEnd = fieldStart + length;
    if (length < FIELD_HEADER_LENGTH || fieldEnd > record.length) {
      throw new Error(`Aleph-поле длиной ${length} выходит за границы записи.`);
    }

    const rawField = record.subarray(fieldStart, fieldEnd);
    const marker = rawField.subarray(5, 6).toString("ascii");
    if (marker !== "L") {
      throw new Error(
        `Aleph-поле содержит неподдерживаемый маркер ${JSON.stringify(marker)}.`,
      );
    }

    fields.push({
      tag: rawField.subarray(0, 3).toString("ascii"),
      indicators: rawField.subarray(3, 5),
      value: rawField.subarray(FIELD_HEADER_LENGTH),
    });
    offset = fieldEnd;
  }

  return fields;
}

function toIsoField(field: AlephField): IsoField {
  const content = isControlField(field.tag)
    ? normalizeCarets(field.value)
    : Buffer.concat([
        normalizeCarets(field.indicators),
        convertSubfieldDelimiters(field.value),
      ]);

  return {
    tag: field.tag,
    data: Buffer.concat([content, Buffer.from([FIELD_TERMINATOR])]),
  };
}

function isControlField(tag: string): boolean {
  return tag.startsWith("00") || tag === "FMT";
}

function normalizeCarets(value: Buffer): Buffer {
  const normalized = Buffer.from(value);
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] === CARET) {
      normalized[index] = SPACE;
    }
  }
  return normalized;
}

function convertSubfieldDelimiters(value: Buffer): Buffer {
  const chunks: Buffer[] = [];
  let position = 0;
  let delimiter = value.indexOf("$$", position, "ascii");

  while (delimiter !== -1) {
    chunks.push(value.subarray(position, delimiter));
    chunks.push(Buffer.from([SUBFIELD_DELIMITER]));
    position = delimiter + 2;
    delimiter = value.indexOf("$$", position, "ascii");
  }
  chunks.push(value.subarray(position));

  return Buffer.concat(chunks);
}

function decimal(value: number, width: number): string {
  return String(value).padStart(width, "0");
}
