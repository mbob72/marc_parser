import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MarcIsoSerializer } from "../src/marc-iso-serializer.ts";
import { MarcJsonSerializer } from "../src/marc-json-serializer.ts";
import { Iso2709MarcParser } from "../src/marc-parser.ts";
import { MarcRecordValidator } from "../src/marc-validator.ts";

const jsonRecordUrl = new URL(
  "../docs/015316815/015316815.json",
  import.meta.url,
);

test("собирает валидную ISO 2709 запись и сохраняет формат через FMT", async () => {
  const json = JSON.parse(await readFile(jsonRecordUrl, "utf8"));
  const iso = new MarcIsoSerializer("utf-8").serialize(json);
  const record = new Iso2709MarcParser().parse(iso);
  const validation = new MarcRecordValidator().validate(record);
  const roundTrip = new MarcJsonSerializer("utf-8").serialize(record);

  assert.equal(Number(record.leader.recordLength), iso.length);
  assert.equal(Number(record.leader.baseAddressOfData), 24 + record.fields.length * 12 + 1);
  assert.equal(record.fields[0]?.tag, "FMT");
  assert.deepEqual(validation, { valid: true, errors: [] });
  assert.deepEqual(roundTrip.fields, json.fields);
  assert.equal(roundTrip.format, json.format);
  assert.equal(roundTrip.leader.slice(5, 12), json.leader.slice(5, 12));
  assert.equal(roundTrip.leader.slice(17), json.leader.slice(17));
});

test("кодирует значения ISO 2709 в Windows-1251", () => {
  const json = {
    leader: "00000nam a2200000 i 4500",
    format: "BK",
    fields: [
      {
        code: "245",
        ind1: "0",
        ind2: "0",
        subfields: [{ code: "a", value: "Книга" }],
      },
    ],
  };
  const iso = new MarcIsoSerializer("windows-1251").serialize(json);
  const record = new Iso2709MarcParser().parse(iso);
  const roundTrip = new MarcJsonSerializer("windows-1251").serialize(record);

  assert.deepEqual(roundTrip.fields, json.fields);
  assert.equal(roundTrip.format, json.format);
});

test("сохраняет реальные Aleph-форматы нормативных и сериальных записей", () => {
  for (const format of ["AN", "AU", "SE"]) {
    const iso = new MarcIsoSerializer("utf-8").serialize({
      leader: "00000nam a2200000 i 4500",
      format,
      fields: [],
    });
    const record = new Iso2709MarcParser().parse(iso);
    const roundTrip = new MarcJsonSerializer("utf-8").serialize(record);

    assert.equal(roundTrip.format, format);
  }
});

test("отклоняет заглушки, которые нельзя представить в ISO 2709", () => {
  assert.throws(
    () =>
      new MarcIsoSerializer("utf-8").serialize({
        leader: "<unrecognized>",
        format: "<unrecognized>",
        fields: [],
      }),
    /leader/,
  );
});

test("не заменяет неподдерживаемые кодировкой символы вопросительными знаками", () => {
  assert.throws(
    () =>
      new MarcIsoSerializer("windows-1251").serialize({
        leader: "00000nam a2200000 i 4500",
        format: "BK",
        fields: [
          {
            code: "245",
            ind1: "0",
            ind2: "0",
            subfields: [{ code: "a", value: "漢字" }],
          },
        ],
      }),
    /нельзя представить/,
  );
});

test("отклоняет отсутствующие в схеме РГБ коды Leader", () => {
  assert.throws(
    () =>
      new MarcIsoSerializer("utf-8").serialize({
        leader: "00000nam a2200000 ca4500",
        format: "BK",
        fields: [],
      }),
    /Leader\/18/,
  );
});
