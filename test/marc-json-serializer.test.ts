import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MarcJsonSerializer,
} from "../src/marc-json-serializer.ts";
import { AlephSequentialMarcParser } from "../src/aleph-sequential-parser.ts";
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
    format: "",
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

test("сохраняет некорректные значения без подмены", async () => {
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
  );

  assert.equal(validation.valid, false);
  assert.equal(json.leader.slice(5, 12), invalidRecord.leader.raw.slice(5, 12));
  assert.equal(json.leader.slice(17), invalidRecord.leader.raw.slice(17));
  assert.equal(json.fields[0]?.code, "A1b");

  const jsonDataField = json.fields[1];
  assert.ok(jsonDataField && "subfields" in jsonDataField);
  assert.equal(jsonDataField.ind1, "A");
  assert.equal(jsonDataField.ind2, "");
  assert.deepEqual(jsonDataField.subfields, [
    {
      code: "A",
      value: "сохранённое значение",
    },
  ]);
});

test("сохраняет пустой список подполей", async () => {
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
  );
  const jsonDataField = json.fields[0];

  assert.ok(jsonDataField && "subfields" in jsonDataField);
  assert.deepEqual(jsonDataField.subfields, []);
});

test("пересчитывает leader после переноса FMT в format", () => {
  const sourceFields = [
    ["LDR", "00000nam a2200000 i 4500"],
    ["FMT", "BK"],
    ["001", "000000042"],
    ["OWN", "RSL"],
  ];
  const source = Buffer.concat([
    Buffer.from("000000042\t"),
    ...sourceFields.map(([tag, value]) => {
      const body = Buffer.from(tag + "  L" + value, "utf8");
      return Buffer.concat([
        Buffer.from(String(body.length).padStart(4, "0")),
        body,
      ]);
    }),
  ]);
  const parsed = new AlephSequentialMarcParser().parseForImport(source);
  assert.ok(parsed);
  assert.equal(parsed.leader.raw.slice(0, 5), "00063");
  assert.equal(parsed.leader.raw.slice(12, 17), "00049");
  const json = new MarcJsonSerializer("utf-8").serialize(parsed);
  assert.equal(json.format, "BK");
  assert.deepEqual(json.fields, [{ code: "001", value: "000000042" }]);
  assert.equal(json.leader.slice(0, 5), "00048");
  assert.equal(json.leader.slice(12, 17), "00037");
  assert.equal(json.leader.slice(5, 12), parsed.leader.raw.slice(5, 12));
  assert.equal(json.leader.slice(17), parsed.leader.raw.slice(17));
});

// 24 + 12 + 1 + («Я» = 2 байта, 0x1E = 1) + 0x1D = 41.
test("считает UTF-8 после декодирования Windows-1251 даже без FMT", async () => {
  const source = await readFile(marcRecordUrl);
  const parsed = new Iso2709MarcParser().parse(source);
  const record: MarcRecord = { ...parsed, fields: [{
    kind: "control", tag: "001", value: Buffer.from([0xdf]),
    raw: Buffer.from([0xdf, 0x1e]),
  }] };
  const json = new MarcJsonSerializer("windows-1251").serialize(record);
  assert.deepEqual(json.fields, [{ code: "001", value: "Я" }]);
  assert.equal(json.leader.slice(0, 5), "00041");
  assert.equal(json.leader.slice(12, 17), "00037");
});

// Проверяем полный путь Aleph → итоговые поля, включая исключение FMT/OWN.
test("миграция совпадает с расчётом АБИС v3: длина 75, базовый адрес 49", () => {
  const sourceFields = [
    ["LDR", "  ", "00000nam a2200000 i 4500"],
    ["FMT", "  ", "BK"],
    ["001", "  ", "000000042"],
    ["245", "10", "$$aКнига"],
    ["OWN", "  ", "RSL"],
  ];
  const source = Buffer.concat([
    Buffer.from("000000042\t"),
    ...sourceFields.map(([tag, indicators, value]) => {
      const body = Buffer.from(tag + indicators + "L" + value, "utf8");
      return Buffer.concat([Buffer.from(String(body.length).padStart(4, "0")), body]);
    }),
  ]);
  const parsed = new AlephSequentialMarcParser().parseForImport(source);
  assert.ok(parsed);
  const json = new MarcJsonSerializer("utf-8").serialize(parsed);
  assert.equal(json.leader, "00075nam a2200049 i 4500");
  assert.equal(json.format, "BK");
  assert.deepEqual(json.fields.map(field => field.code), ["001", "245"]);
});
