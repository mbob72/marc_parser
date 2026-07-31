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

test("разбирает записи Directory", async () => {
  const source = await readFile(recordUrl);
  const parser = new Iso2709MarcParser();

  const record = parser.parse(source);

  assert.equal(record.directory.length, 16);
  assert.deepEqual(record.directory[0], {
    raw: "001001000000",
    tag: "001",
    fieldLength: "0010",
    startingCharacterPosition: "00000",
    implementationDefined: "",
  });
  assert.deepEqual(record.directory.at(-1), {
    raw: "710014301229",
    tag: "710",
    fieldLength: "0143",
    startingCharacterPosition: "01229",
    implementationDefined: "",
  });
});

test("проверяет завершающий разделитель Directory", async () => {
  const source = Buffer.from(await readFile(recordUrl));
  const baseAddressOfData = Number(source.subarray(12, 17).toString("ascii"));
  source[baseAddressOfData - 1] = 0x20;

  const parser = new Iso2709MarcParser();

  assert.throws(
    () => parser.parse(source),
    /Directory не заканчивается разделителем 0x1E/,
  );
});

test("отклоняет данные короче Leader", () => {
  const parser = new Iso2709MarcParser();

  assert.throws(
    () => parser.parse(Buffer.alloc(23)),
    /Недостаточно данных для Leader/,
  );
});
