import type {
  MarcDirectoryEntry,
  MarcLeader,
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

    return {
      byteLength: record.length,
      leader,
      directory: parseDirectory(record, leader),
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
): MarcDirectoryEntry[] {
  const baseAddressOfData = parseDecimal(
    leader.baseAddressOfData,
    "baseAddressOfData",
  );

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

function parseDecimal(value: string, name: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `${name} должно содержать только цифры: ${JSON.stringify(value)}.`,
    );
  }

  return Number(value);
}
