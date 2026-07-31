import type {
  MarcDirectoryEntry,
  MarcLeader,
  MarcRawField,
  MarcRecord,
} from "./marc-record.js";

const LEADER_LENGTH = 24;
const TAG_LENGTH = 3;
const FIELD_TERMINATOR = 0x1e;

export interface MarcParser {
  parse(record: Buffer): MarcRecord;
}

export class Iso2709MarcParser implements MarcParser {
  parse(record: Buffer): MarcRecord {
    if (record.length < LEADER_LENGTH) {
      throw new Error(
        `Недостаточно данных для Leader: получено ${record.length} байт, требуется ${LEADER_LENGTH}.`,
      );
    }

    const rawLeader = record.subarray(0, LEADER_LENGTH).toString("ascii");
    const leader = parseLeader(rawLeader);
    const baseAddressOfData = parseDecimal(
      leader.baseAddressOfData,
      "baseAddressOfData",
    );
    const directory = parseDirectory(record, leader, baseAddressOfData);

    return {
      byteLength: record.length,
      leader,
      directory,
      fields: parseRawFields(record, directory, baseAddressOfData),
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
  return directory.map((entry) => {
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

    if (fieldStart >= record.length || fieldEnd > record.length) {
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

    return {
      tag: entry.tag,
      raw: record.subarray(fieldStart, fieldEnd),
    };
  });
}

function parseDecimal(value: string, name: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `${name} должно содержать только цифры: ${JSON.stringify(value)}.`,
    );
  }

  return Number(value);
}
