import { hasDeletionFlag, keepImportedField } from "./marc-import-policy.js";
import type {
  MarcControlField,
  MarcDataField,
  MarcDirectoryEntry,
  MarcField,
  MarcLeader,
  MarcRawField,
  MarcRecord,
  MarcSubfield,
} from "./marc-record.js";

const LEADER_LENGTH = 24;
const TAG_LENGTH = 3;
const FIELD_TERMINATOR = 0x1e;
const SUBFIELD_DELIMITER = 0x1f;
const INDICATOR_COUNT = 2;

export interface MarcParser {
  parse(record: Buffer): MarcRecord;
  /** Apply import policy before field parsing/validation; null means DEL$a=Y. */
  parseForImport?(record: Buffer): MarcRecord | null;
}

export class Iso2709MarcParser implements MarcParser {
  parse(record: Buffer): MarcRecord {
    return this.parseRecord(record, false)!;
  }

  parseForImport(record: Buffer): MarcRecord | null {
    return this.parseRecord(record, true);
  }

  private parseRecord(record: Buffer, importing: boolean): MarcRecord | null {
    if (record.length < LEADER_LENGTH) {
      throw new Error(
        `Недостаточно данных для Leader: получено ${record.length} байт, требуется ${LEADER_LENGTH}.`,
      );
    }

    const rawLeader = record.subarray(0, LEADER_LENGTH).toString("ascii");
    const leader = parseLeader(rawLeader);
    if (parseDecimal(leader.recordLength, "recordLength") !== record.length) {
      throw new Error("Длина MARC-записи не соответствует Leader/00-04.");
    }
    if (record.at(-1) !== 0x1d) {
      throw new Error("MARC-запись не заканчивается разделителем 0x1D.");
    }
    const baseAddressOfData = parseDecimal(
      leader.baseAddressOfData,
      "baseAddressOfData",
    );
    const directory = parseDirectory(record, leader, baseAddressOfData);
    const rawFields = parseRawFields(record, directory, baseAddressOfData);

    if (importing && rawFields.some(({ tag, raw }) =>
      tag.toUpperCase() === "DEL" &&
      hasDeletionFlag(raw.subarray(0, -1), Buffer.from([SUBFIELD_DELIMITER])))) {
      return null;
    }
    const retained = rawFields.map((field, index) => ({ field, entry: directory[index]! }))
      .filter(({ field }) => !importing || keepImportedField(field.tag));
    if (retained.length !== rawFields.length) {
      // Rebuild structural positions so the filtered JSON survives a round trip.
      let position = 0;
      const newDirectory = retained.map(({ field, entry }) => {
        const offset = String(position).padStart(Number(leader.lengthOfStartingCharacterPositionPortion), "0");
        position += field.raw.length;
        return Buffer.from(field.tag + entry.fieldLength + offset + entry.implementationDefined, "ascii");
      });
      const baseAddress = LEADER_LENGTH + newDirectory.reduce((n, entry) => n + entry.length, 0) + 1;
      const normalizedLeader = Buffer.from(rawLeader, "ascii");
      normalizedLeader.write(String(baseAddress + position + 1).padStart(5, "0"), 0, "ascii");
      normalizedLeader.write(String(baseAddress).padStart(5, "0"), 12, "ascii");
      return this.parse(Buffer.concat([
        normalizedLeader, ...newDirectory, Buffer.from([FIELD_TERMINATOR]),
        ...retained.map(({ field }) => field.raw), Buffer.from([0x1d]),
      ]));
    }

    return {
      byteLength: record.length,
      leader,
      directory: retained.map(({ entry }) => entry),
      fields: retained.map(({ field }) => parseField(field)),
    };
  }
}

function parseLeader(raw: string): MarcLeader {
  return {
    raw,
    recordLength: raw.slice(0, 5),
    recordStatus: raw.slice(5, 6),
    typeOfRecord: raw.slice(6, 7),
    bibliographicLevel: raw.slice(7, 8),
    typeOfControl: raw.slice(8, 9),
    characterCodingScheme: raw.slice(9, 10),
    indicatorCount: raw.slice(10, 11),
    subfieldCodeCount: raw.slice(11, 12),
    baseAddressOfData: raw.slice(12, 17),
    encodingLevel: raw.slice(17, 18),
    descriptiveCatalogingForm: raw.slice(18, 19),
    multipartResourceRecordLevel: raw.slice(19, 20),
    lengthOfFieldPortion: raw.slice(20, 21),
    lengthOfStartingCharacterPositionPortion: raw.slice(21, 22),
    lengthOfImplementationDefinedPortion: raw.slice(22, 23),
    undefinedEntryMapCharacter: raw.slice(23, 24),
  };
}

function parseDirectory(
  record: Buffer,
  leader: MarcLeader,
  baseAddressOfData: number,
): MarcDirectoryEntry[] {
  if (baseAddressOfData <= LEADER_LENGTH || baseAddressOfData > record.length) {
    throw new Error(
      `Некорректный baseAddressOfData: ${baseAddressOfData}.`,
    );
  }

  const directoryEnd = baseAddressOfData - 1;

  if (record[directoryEnd] !== FIELD_TERMINATOR) {
    throw new Error(
      `Directory не заканчивается разделителем 0x1E по позиции ${directoryEnd}.`,
    );
  }

  const fieldLengthSize = parseDecimal(
    leader.lengthOfFieldPortion,
    "lengthOfFieldPortion",
  );
  const startingPositionSize = parseDecimal(
    leader.lengthOfStartingCharacterPositionPortion,
    "lengthOfStartingCharacterPositionPortion",
  );
  const implementationDefinedSize = parseDecimal(
    leader.lengthOfImplementationDefinedPortion,
    "lengthOfImplementationDefinedPortion",
  );
  const entryLength =
    TAG_LENGTH +
    fieldLengthSize +
    startingPositionSize +
    implementationDefinedSize;
  const rawDirectory = record.subarray(LEADER_LENGTH, directoryEnd);

  if (rawDirectory.length % entryLength !== 0) {
    throw new Error(
      `Длина Directory ${rawDirectory.length} не кратна длине записи ${entryLength}.`,
    );
  }

  const entries: MarcDirectoryEntry[] = [];

  for (let offset = 0; offset < rawDirectory.length; offset += entryLength) {
    const raw = rawDirectory
      .subarray(offset, offset + entryLength)
      .toString("ascii");
    const fieldLengthEnd = TAG_LENGTH + fieldLengthSize;
    const startingPositionEnd = fieldLengthEnd + startingPositionSize;

    entries.push({
      raw,
      tag: raw.slice(0, TAG_LENGTH),
      fieldLength: raw.slice(TAG_LENGTH, fieldLengthEnd),
      startingCharacterPosition: raw.slice(
        fieldLengthEnd,
        startingPositionEnd,
      ),
      implementationDefined: raw.slice(startingPositionEnd),
    });
  }

  return entries;
}

function parseRawFields(
  record: Buffer,
  directory: readonly MarcDirectoryEntry[],
  baseAddressOfData: number,
): MarcRawField[] {
  const ranges: { start: number; end: number }[] = [];
  const fields = directory.map((entry) => {
    const fieldLength = parseDecimal(
      entry.fieldLength,
      `Длина поля ${entry.tag}`,
    );
    const startingCharacterPosition = parseDecimal(
      entry.startingCharacterPosition,
      `Начальная позиция поля ${entry.tag}`,
    );

    if (fieldLength === 0) {
      throw new Error(`Длина поля ${entry.tag} не может быть равна нулю.`);
    }

    const fieldStart = baseAddressOfData + startingCharacterPosition;
    const fieldEnd = fieldStart + fieldLength;

    if (fieldStart >= record.length || fieldEnd > record.length - 1) {
      throw new Error(
        `Поле ${entry.tag} выходит за границы MARC-записи: ` +
          `позиция ${fieldStart}, длина ${fieldLength}.`,
      );
    }

    if (record[fieldEnd - 1] !== FIELD_TERMINATOR) {
      throw new Error(
        `Поле ${entry.tag} не заканчивается разделителем 0x1E по позиции ${fieldEnd - 1}.`,
      );
    }

    ranges.push({ start: fieldStart, end: fieldEnd });
    return {
      tag: entry.tag,
      raw: record.subarray(fieldStart, fieldEnd),
    };
  });
  let position = baseAddressOfData;
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    if (range.start !== position) {
      throw new Error("Границы полей Directory содержат пропуск или пересечение.");
    }
    position = range.end;
  }
  if (position !== record.length - 1) {
    throw new Error("Размер области полей не соответствует длине записи.");
  }
  return fields;
}

function parseField(field: MarcRawField): MarcField {
  const content = field.raw.subarray(0, -1);

  if (isControlField(field.tag)) {
    const controlField: MarcControlField = {
      ...field,
      kind: "control",
      value: content,
    };

    return controlField;
  }

  return parseDataField(field, content);
}

function isControlField(tag: string): boolean {
  // FMT is an Aleph/RSL service field. It has no indicators or subfields and
  // carries the record format (BK, CR, ...), so structurally it is handled in
  // the same way as a MARC control field.
  return tag.startsWith("00") || tag.toUpperCase() === "FMT";
}

function parseDataField(field: MarcRawField, content: Buffer): MarcDataField {
  const firstSubfieldPosition = content.indexOf(SUBFIELD_DELIMITER);
  const indicatorEnd = Math.min(
    firstSubfieldPosition === -1 ? content.length : firstSubfieldPosition,
    INDICATOR_COUNT,
  );
  const indicators = Array.from(
    content.subarray(0, indicatorEnd),
    (byte) => String.fromCharCode(byte),
  );

  return {
    ...field,
    kind: "data",
    indicators,
    subfields: parseSubfields(content),
  };
}

function parseSubfields(content: Buffer): MarcSubfield[] {
  const subfields: MarcSubfield[] = [];
  let delimiterPosition = content.indexOf(SUBFIELD_DELIMITER);

  while (delimiterPosition !== -1) {
    const nextDelimiterPosition = content.indexOf(
      SUBFIELD_DELIMITER,
      delimiterPosition + 1,
    );
    const subfieldEnd =
      nextDelimiterPosition === -1 ? content.length : nextDelimiterPosition;
    const rawSubfield = content.subarray(
      delimiterPosition + 1,
      subfieldEnd,
    );

    subfields.push({
      code: rawSubfield.subarray(0, 1).toString("latin1"),
      value: rawSubfield.subarray(1),
    });

    delimiterPosition = nextDelimiterPosition;
  }

  return subfields;
}

function parseDecimal(value: string, name: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `${name} должно содержать только цифры: ${JSON.stringify(value)}.`,
    );
  }

  return Number(value);
}
