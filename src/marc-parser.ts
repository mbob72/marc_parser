import type { MarcLeader, MarcRecord } from "./marc-record.js";

const LEADER_LENGTH = 24;

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

    return {
      byteLength: record.length,
      leader: parseLeader(rawLeader),
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
