import iconv from "iconv-lite";
import {
  isMarcJsonFormat,
  UNRECOGNIZED_VALUE,
  type MarcJsonDataField,
  type MarcJsonField,
  type MarcJsonRecord,
} from "./marc-json-serializer.js";

const LEADER_LENGTH = 24;
const DIRECTORY_ENTRY_LENGTH = 12;
const FIELD_TERMINATOR = 0x1e;
const RECORD_TERMINATOR = 0x1d;
const SUBFIELD_DELIMITER = 0x1f;
const MAX_RECORD_LENGTH = 99_999;
const MAX_FIELD_LENGTH = 9_999;
const VALID_TAG = /^(?:[0-9]{3}|[A-Za-z]{3})$/;
const VALID_CODE = /^[a-z0-9]$/;
const VALID_INDICATOR = /^[a-z0-9 #]$/;

/** Serializes the RSL MARC-JSON record model to an ISO 2709 record. */
export class MarcIsoSerializer {
  constructor(private readonly encoding: string) {
    if (!iconv.encodingExists(encoding)) {
      throw new Error(
        `Кодировка ${JSON.stringify(encoding)} не поддерживается для записи ISO 2709.`,
      );
    }
  }

  serialize(value: unknown): Buffer {
    const record = parseJsonRecord(value);
    const fields = [
      serializeFormatField(record.format),
      ...record.fields.map((field, index) =>
        serializeField(field, index, this.encoding),
      ),
    ];
    const baseAddress =
      LEADER_LENGTH + fields.length * DIRECTORY_ENTRY_LENGTH + 1;
    let position = 0;
    const directory = Buffer.concat(
      fields.map(({ tag, data }) => {
        assertFits(data.length, MAX_FIELD_LENGTH, `Поле ${tag}`);
        const entry = Buffer.from(
          `${tag}${decimal(data.length, 4, `длина поля ${tag}`)}` +
            `${decimal(position, 5, `позиция поля ${tag}`)}`,
          "ascii",
        );
        position += data.length;
        return entry;
      }),
    );
    const recordLength = baseAddress + position + 1;

    assertFits(recordLength, MAX_RECORD_LENGTH, "MARC-запись");

    const leader = buildLeader(record.leader, recordLength, baseAddress);

    return Buffer.concat([
      leader,
      directory,
      Buffer.from([FIELD_TERMINATOR]),
      ...fields.map(({ data }) => data),
      Buffer.from([RECORD_TERMINATOR]),
    ]);
  }
}

interface SerializedField {
  readonly tag: string;
  readonly data: Buffer;
}

function parseJsonRecord(value: unknown): MarcJsonRecord {
  if (!isObject(value)) {
    throw new Error("MARC-JSON запись должна быть JSON-объектом.");
  }

  if (
    typeof value.leader !== "string" ||
    value.leader === UNRECOGNIZED_VALUE ||
    value.leader.length !== LEADER_LENGTH ||
    !isAscii(value.leader)
  ) {
    throw new Error("Поле leader должно содержать ровно 24 ASCII-символа.");
  }

  if (["c", "n"].includes(value.leader[18]!)) {
    throw new Error(
      `Leader/18 содержит недопустимый для схемы РГБ код ` +
        `${JSON.stringify(value.leader[18])}.`,
    );
  }

  if (["a", "b", "c"].includes(value.leader[19]!)) {
    throw new Error(
      `Leader/19 содержит недопустимый для схемы РГБ код ` +
        `${JSON.stringify(value.leader[19])}.`,
    );
  }

  if (typeof value.format !== "string" || !isMarcJsonFormat(value.format)) {
    throw new Error(
      "Поле format должно иметь значение BK, CF, CR, MP, MU, MX или VM.",
    );
  }

  if (!Array.isArray(value.fields)) {
    throw new Error("Поле fields должно быть массивом.");
  }

  return value as unknown as MarcJsonRecord;
}

function serializeFormatField(format: string): SerializedField {
  return {
    tag: "FMT",
    data: Buffer.concat([
      Buffer.from(format, "ascii"),
      Buffer.from([FIELD_TERMINATOR]),
    ]),
  };
}

function serializeField(
  field: MarcJsonField,
  index: number,
  encoding: string,
): SerializedField {
  if (!isObject(field)) {
    throw new Error(`Поле fields[${index}] должно быть объектом.`);
  }

  if (
    typeof field.code !== "string" ||
    field.code === UNRECOGNIZED_VALUE ||
    !VALID_TAG.test(field.code) ||
    field.code.toUpperCase() === "FMT"
  ) {
    throw new Error(`Некорректный code у fields[${index}].`);
  }

  if ("value" in field) {
    if (!field.code.startsWith("00") || typeof field.value !== "string") {
      throw new Error(
        `Контрольное поле fields[${index}] должно иметь код 00X и строковое value.`,
      );
    }

    return {
      tag: field.code,
      data: terminate(
        encodeValue(field.value, encoding, `fields[${index}].value`),
      ),
    };
  }

  return serializeDataField(field as MarcJsonDataField, index, encoding);
}

function serializeDataField(
  field: MarcJsonDataField,
  index: number,
  encoding: string,
): SerializedField {
  const ind1 = parseIndicator(field.ind1, index, "ind1");
  const ind2 = parseIndicator(field.ind2, index, "ind2");

  if (field.code.startsWith("00")) {
    throw new Error(
      `Поле данных fields[${index}] не может иметь контрольный код ${field.code}.`,
    );
  }

  if (!Array.isArray(field.subfields) || field.subfields.length === 0) {
    throw new Error(`fields[${index}].subfields должен быть непустым массивом.`);
  }

  const subfields = field.subfields.map((subfield, subfieldIndex) => {
    if (
      !isObject(subfield) ||
      typeof subfield.code !== "string" ||
      subfield.code === UNRECOGNIZED_VALUE ||
      !VALID_CODE.test(subfield.code) ||
      typeof subfield.value !== "string"
    ) {
      throw new Error(
        `Некорректное подполе fields[${index}].subfields[${subfieldIndex}].`,
      );
    }

    return Buffer.concat([
      Buffer.from([SUBFIELD_DELIMITER]),
      Buffer.from(subfield.code, "ascii"),
      encodeValue(
        subfield.value,
        encoding,
        `fields[${index}].subfields[${subfieldIndex}].value`,
      ),
    ]);
  });

  return {
    tag: field.code,
    data: terminate(
      Buffer.concat([Buffer.from(`${ind1}${ind2}`, "ascii"), ...subfields]),
    ),
  };
}

function parseIndicator(
  value: unknown,
  fieldIndex: number,
  name: "ind1" | "ind2",
): string {
  if (
    typeof value !== "string" ||
    value === UNRECOGNIZED_VALUE ||
    !VALID_INDICATOR.test(value)
  ) {
    throw new Error(`Некорректный ${name} у fields[${fieldIndex}].`);
  }

  // In the RSL documentation # is the display notation for an undefined
  // indicator; ISO 2709 stores it as ASCII SPACE (PDF pp. 30 and 39).
  return value === "#" ? " " : value;
}

function buildLeader(
  source: string,
  recordLength: number,
  baseAddress: number,
): Buffer {
  const leader = Buffer.from(source, "ascii");
  leader.write(decimal(recordLength, 5, "длина записи"), 0, "ascii");
  leader.write(decimal(baseAddress, 5, "базовый адрес данных"), 12, "ascii");
  leader.write("4500", 20, "ascii");
  return leader;
}

function terminate(value: Buffer): Buffer {
  return Buffer.concat([value, Buffer.from([FIELD_TERMINATOR])]);
}

function encodeValue(
  value: string,
  encoding: string,
  path: string,
): Buffer {
  const encoded = iconv.encode(value, encoding);
  if (iconv.decode(encoded, encoding) !== value) {
    throw new Error(
      `${path} содержит символы, которые нельзя представить в кодировке ` +
        `${JSON.stringify(encoding)}.`,
    );
  }
  return encoded;
}

function decimal(value: number, width: number, name: string): string {
  const result = String(value);
  if (result.length > width) {
    throw new Error(`${name} ${value} не помещается в ${width} цифр.`);
  }
  return result.padStart(width, "0");
}

function assertFits(value: number, maximum: number, name: string): void {
  if (value > maximum) {
    throw new Error(`${name} имеет длину ${value}; максимум ${maximum}.`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAscii(value: string): boolean {
  return Buffer.byteLength(value, "ascii") === value.length &&
    [...value].every((character) => character.charCodeAt(0) <= 0x7f);
}
