import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Iso2709MarcParser } from "../src/marc-parser.ts";

const recordUrl = new URL(
  "../docs/015316815/015316815.mrc",
  import.meta.url,
);

test("извлекает Leader из первых 24 байт MARC-записи", async () => {
  const source = await readFile(recordUrl);
  const parser = new Iso2709MarcParser();

  const record = parser.parse(source);

  assert.equal(record.byteLength, source.length);
  assert.deepEqual(record.leader, {
    raw: "01590cam a2200217 u 4500",
    recordLength: "01590",
    recordStatus: "c",
    typeOfRecord: "a",
    bibliographicLevel: "m",
    typeOfControl: " ",
    characterCodingScheme: "a",
    indicatorCount: "2",
    subfieldCodeCount: "2",
    baseAddressOfData: "00217",
    encodingLevel: " ",
    descriptiveCatalogingForm: "u",
    multipartResourceRecordLevel: " ",
    lengthOfFieldPortion: "4",
    lengthOfStartingCharacterPositionPortion: "5",
    lengthOfImplementationDefinedPortion: "0",
    undefinedEntryMapCharacter: "0",
  });
});

test("отклоняет данные короче Leader", () => {
  const parser = new Iso2709MarcParser();

  assert.throws(
    () => parser.parse(Buffer.alloc(23)),
    /Недостаточно данных для Leader/,
  );
});
