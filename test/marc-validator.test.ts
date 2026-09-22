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
  const indicatorError = result.errors.find(
    ({ rule }) => rule === "IN-G3",
  );

  assert.equal(result.valid, false);
  assert.equal(indicatorError?.indicatorIndex, 0);
  assert.deepEqual(
    rules,
    new Set([
      "RS-G3",
      "DR-E2",
      "VF-G3",
      "LD-02",
      "DF-G3",
      "DF-G2",
      "IN-G3",
      "SF-G4",
    ]),
  );
  assert.deepEqual(
    result.errors.filter(({ subfieldIndex }) => subfieldIndex !== undefined),
    [{
      rule: "SF-G4",
      fieldIndex: 0,
      tag: "245",
      subfieldIndex: 0,
      message: 'Подполе 1 поля 245 имеет недопустимый код "A".',
    }],
    "one invalid subfield produces exactly one SF-G4 error",
  );
});

test("сохраняет ограничение Leader/18, принимая a в Leader/19", async () => {
  const source = await readFile(recordUrl);
  const parsed = new Iso2709MarcParser().parse(source);
  const record: MarcRecord = {
    ...parsed,
    leader: {
      ...parsed.leader,
      raw: `${parsed.leader.raw.slice(0, 18)}ca${parsed.leader.raw.slice(20)}`,
      descriptiveCatalogingForm: "c",
      multipartResourceRecordLevel: "a",
    },
  };

  const result = new MarcRecordValidator().validate(record);

  assert.equal(result.valid, false);
  assert.equal(result.errors.filter(({ rule }) => rule === "LD-02").length, 1);
  assert.match(result.errors[0]?.message ?? "", /Leader\/18/);
});

for (const code of ["a", "b", "c", " ", "r"]) {
  test(`принимает Leader/19=${JSON.stringify(code)}`, async () => {
    const parsed = new Iso2709MarcParser().parse(await readFile(recordUrl));
    const result = new MarcRecordValidator().validate({
      ...parsed,
      leader: { ...parsed.leader,
        raw: parsed.leader.raw.slice(0, 19) + code + parsed.leader.raw.slice(20),
        multipartResourceRecordLevel: code,
      },
    });
    assert.deepEqual(result.errors, []);
  });
}
