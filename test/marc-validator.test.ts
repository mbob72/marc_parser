import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Iso2709MarcParser } from "../src/marc-parser.ts";
import type { MarcRecord } from "../src/marc-record.ts";
import { MarcRecordValidator } from "../src/marc-validator.ts";

const recordUrl = new URL(
  "../docs/015316815/015316815.mrc",
  import.meta.url,
);

test("принимает корректную MARC-запись", async () => {
  const source = await readFile(recordUrl);
  const record = new Iso2709MarcParser().parse(source);

  const result = new MarcRecordValidator().validate(record);

  assert.deepEqual(result, {
    valid: true,
    errors: [],
  });
});

test("принимает решётку как обозначение пустого индикатора", async () => {
  const source = await readFile(recordUrl);
  const parsedRecord = new Iso2709MarcParser().parse(source);
  const dataField = parsedRecord.fields.find(
    (field) => field.kind === "data",
  );

  assert.ok(dataField?.kind === "data");

  const record: MarcRecord = {
    ...parsedRecord,
    fields: [
      {
        ...dataField,
        indicators: ["#", "#"],
      },
    ],
  };

  const result = new MarcRecordValidator().validate(record);

  assert.equal(result.valid, true);
});

test("собирает нарушения всех правил", async () => {
  const source = await readFile(recordUrl);
  const parsedRecord = new Iso2709MarcParser().parse(source);
  const invalidRecord: MarcRecord = {
    ...parsedRecord,
    byteLength: 100_000,
    leader: {
      ...parsedRecord.leader,
      recordLength: "12A45",
    },
    directory: [
      {
        ...parsedRecord.directory[0]!,
        tag: "A1b",
      },
    ],
    fields: [
      {
        kind: "data",
        tag: "245",
        raw: Buffer.alloc(10_000),
        indicators: ["A"],
        subfields: [
          {
            code: "A",
            value: Buffer.alloc(0),
          },
        ],
      },
      {
        kind: "data",
        tag: "246",
        raw: Buffer.alloc(1),
        indicators: [" ", " "],
        subfields: [],
      },
    ],
  };

  const result = new MarcRecordValidator().validate(invalidRecord);
  const rules = new Set(result.errors.map(({ rule }) => rule));

  assert.equal(result.valid, false);
  assert.deepEqual(
    rules,
    new Set([
      "RS-G3",
      "DR-E2",
      "VF-G3",
      "LD-02",
      "VF-G5",
      "DF-G3",
      "DF-G2",
      "IN-G3",
      "SF-G4",
    ]),
  );
});
