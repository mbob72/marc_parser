import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MarcJsonSerializer,
  UNRECOGNIZED_VALUE,
} from "../src/marc-json-serializer.ts";
import { Iso2709MarcParser } from "../src/marc-parser.ts";
import type { MarcRecord } from "../src/marc-record.ts";
import { MarcRecordValidator } from "../src/marc-validator.ts";

const marcRecordUrl = new URL(
  "../docs/015316815/015316815.mrc",
  import.meta.url,
);
const jsonRecordUrl = new URL(
  "../docs/015316815/015316815.json",
  import.meta.url,
);
const windows1251RecordsUrl = new URL("../docs/2023.iso", import.meta.url);

test("преобразует MARC-запись в эталонную JSON-структуру", async () => {
  const [source, expectedJson] = await Promise.all([
    readFile(marcRecordUrl),
    readFile(jsonRecordUrl, "utf8"),
  ]);
  const record = new Iso2709MarcParser().parse(source);

  const actual = new MarcJsonSerializer("utf-8").serialize(record);

  assert.deepEqual(actual, {
    ...JSON.parse(expectedJson),
    format: UNRECOGNIZED_VALUE,
  });
});

test("берёт format из служебного поля FMT и не выводит FMT в fields", async () => {
  const source = await readFile(marcRecordUrl);
  const parsed = new Iso2709MarcParser().parse(source);
  const formatField = {
    kind: "control" as const,
    tag: "FMT",
    raw: Buffer.from("BK\x1e", "ascii"),
    value: Buffer.from("BK", "ascii"),
  };
  const record: MarcRecord = {
    ...parsed,
    fields: [formatField, ...parsed.fields],
  };

  const actual = new MarcJsonSerializer("utf-8").serialize(record);

  assert.equal(actual.format, "BK");
  assert.equal(actual.fields.some(({ code }) => code === "FMT"), false);
});

test("декодирует значения из Windows-1251", async () => {
  const source = await readFile(windows1251RecordsUrl);
  const recordLength = Number(source.subarray(0, 5).toString("ascii"));
  const record = new Iso2709MarcParser().parse(
    source.subarray(0, recordLength),
  );

  const json = new MarcJsonSerializer("windows-1251").serialize(record);
  const field = json.fields.find(({ code }) => code === "200");

  assert.ok(field && "subfields" in field);
  assert.equal(field.subfields[0]?.value, "Царствование Елисаветы Петровны");
});

test("заменяет некорректные части записи значением по умолчанию", async () => {
  const source = await readFile(marcRecordUrl);
  const parsedRecord = new Iso2709MarcParser().parse(source);
  const controlField = parsedRecord.fields[0]!;
  const dataField = parsedRecord.fields.find(
    (field) => field.kind === "data",
  );

  assert.equal(controlField.kind, "control");
  assert.ok(dataField?.kind === "data");

  const invalidRecord: MarcRecord = {
    ...parsedRecord,
    leader: {
      ...parsedRecord.leader,
      recordLength: "12A45",
    },
    directory: [
      {
        ...parsedRecord.directory[0]!,
        tag: "A1b",
      },
      parsedRecord.directory.find(({ tag }) => tag === dataField.tag)!,
    ],
    fields: [
      {
        ...controlField,
        tag: "A1b",
      },
      {
        ...dataField,
        indicators: ["A"],
        subfields: [
          {
            code: "A",
            value: Buffer.from("сохранённое значение"),
          },
        ],
      },
    ],
  };
  const validation = new MarcRecordValidator().validate(invalidRecord);

  const json = new MarcJsonSerializer("utf-8").serialize(
    invalidRecord,
    validation.errors,
  );

  assert.equal(validation.valid, false);
  assert.equal(json.leader, UNRECOGNIZED_VALUE);
  assert.equal(json.fields[0]?.code, UNRECOGNIZED_VALUE);

  const jsonDataField = json.fields[1];
  assert.ok(jsonDataField && "subfields" in jsonDataField);
  assert.equal(jsonDataField.ind1, UNRECOGNIZED_VALUE);
  assert.equal(jsonDataField.ind2, UNRECOGNIZED_VALUE);
  assert.deepEqual(jsonDataField.subfields, [
    {
      code: UNRECOGNIZED_VALUE,
      value: "сохранённое значение",
    },
  ]);
});

test("добавляет заглушку для поля данных без подполей", async () => {
  const source = await readFile(marcRecordUrl);
  const parsedRecord = new Iso2709MarcParser().parse(source);
  const dataField = parsedRecord.fields.find(
    (field) => field.kind === "data",
  );

  assert.ok(dataField?.kind === "data");

  const invalidRecord: MarcRecord = {
    ...parsedRecord,
    directory: [
      parsedRecord.directory.find(({ tag }) => tag === dataField.tag)!,
    ],
    fields: [
      {
        ...dataField,
        subfields: [],
      },
    ],
  };
  const validation = new MarcRecordValidator().validate(invalidRecord);

  const json = new MarcJsonSerializer("utf-8").serialize(
    invalidRecord,
    validation.errors,
  );
  const jsonDataField = json.fields[0];

  assert.ok(jsonDataField && "subfields" in jsonDataField);
  assert.deepEqual(jsonDataField.subfields, [
    {
      code: UNRECOGNIZED_VALUE,
      value: UNRECOGNIZED_VALUE,
    },
  ]);
});
