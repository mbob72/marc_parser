import { MarcIsoSerializer } from "./marc-iso-serializer.js";
import type {
  MarcDataField,
  MarcField,
  MarcRecord,
} from "./marc-record.js";
import { Iso2709MarcParser } from "./marc-parser.js";

const FIELD_HEADER_LENGTH = 6;
const MAX_FIELD_LENGTH = 9_999;
const CARET = 0x5e;
const SPACE = 0x20;

/** Serializes MARC-JSON to the canonical Aleph sequential Z00 container. */
export class MarcAlephSequentialSerializer {
  private readonly isoSerializer: MarcIsoSerializer;
  private readonly isoParser = new Iso2709MarcParser();

  constructor(encoding: string) {
    this.isoSerializer = new MarcIsoSerializer(encoding);
  }

  serialize(value: unknown): Buffer {
    const recordId = resolveRecordId(value);
    const record = this.isoParser.parse(this.isoSerializer.serialize(value));
    const format = record.fields.find(({ tag }) => tag === "FMT");
    if (!format || format.kind !== "control") {
      throw new Error("После сериализации отсутствует служебное поле FMT.");
    }

    return Buffer.concat([
      Buffer.from(`${recordId}\t`, "ascii"),
      serializeControlField(format, false),
      serializeLeader(record),
      ...record.fields
        .filter(({ tag }) => tag !== "FMT")
        .map(serializeField),
      Buffer.from("\n", "ascii"),
    ]);
  }
}

function resolveRecordId(value: unknown): string {
  if (!isObject(value)) {
    throw new Error("MARC-JSON запись должна быть JSON-объектом.");
  }

  if (
    typeof value.recordId === "string" &&
    /^[0-9]{9}$/.test(value.recordId)
  ) {
    return value.recordId;
  }

  if (Array.isArray(value.fields)) {
    const control001 = value.fields.find(
      (field) =>
        isObject(field) &&
        field.code === "001" &&
        typeof field.value === "string",
    );
    if (
      isObject(control001) &&
      typeof control001.value === "string" &&
      /^[0-9]{1,9}$/.test(control001.value)
    ) {
      return control001.value.padStart(9, "0");
    }
  }

  throw new Error(
    "Для Aleph sequential требуется девятизначный recordId или числовое поле 001.",
  );
}

function serializeLeader(record: MarcRecord): Buffer {
  return frameField(
    "LDR",
    "  ",
    replaceSpacesWithCarets(Buffer.from(record.leader.raw, "ascii")),
  );
}

function serializeField(field: MarcField): Buffer {
  if (field.kind === "control") {
    return serializeControlField(field, true);
  }

  return serializeDataField(field);
}

function serializeControlField(
  field: Extract<MarcField, { kind: "control" }>,
  replaceSpaces: boolean,
): Buffer {
  return frameField(
    field.tag,
    "  ",
    replaceSpaces ? replaceSpacesWithCarets(field.value) : field.value,
  );
}

function serializeDataField(field: MarcDataField): Buffer {
  const indicators = field.indicators.join("").padEnd(2, " ").slice(0, 2);
  const value = Buffer.concat(
    field.subfields.map(({ code, value: subfieldValue }) =>
      Buffer.concat([
        Buffer.from(`$$${code}`, "ascii"),
        subfieldValue,
      ]),
    ),
  );

  return frameField(field.tag, indicators, value);
}

function frameField(tag: string, indicators: string, value: Buffer): Buffer {
  const body = Buffer.concat([
    Buffer.from(`${tag}${indicators}L`, "ascii"),
    value,
  ]);
  if (body.length < FIELD_HEADER_LENGTH || body.length > MAX_FIELD_LENGTH) {
    throw new Error(
      `Aleph-поле ${tag} имеет длину ${body.length}; допустимо от ` +
        `${FIELD_HEADER_LENGTH} до ${MAX_FIELD_LENGTH} байт.`,
    );
  }

  return Buffer.concat([
    Buffer.from(String(body.length).padStart(4, "0"), "ascii"),
    body,
  ]);
}

function replaceSpacesWithCarets(value: Buffer): Buffer {
  const result = Buffer.from(value);
  for (let index = 0; index < result.length; index += 1) {
    if (result[index] === SPACE) {
      result[index] = CARET;
    }
  }
  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
