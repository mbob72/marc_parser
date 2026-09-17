import assert from "node:assert/strict";
import test from "node:test";
import { MarcIsoSerializer } from "../src/marc-iso-serializer.ts";
import { MarcAlephSequentialSerializer } from "../src/marc-aleph-sequential-serializer.ts";
import { parseMarcJsonField } from "../src/marc-json-field-schema.ts";

const control = { code: "001", value: "123" };
const data = {
  code: "245", ind1: "0", ind2: "0",
  subfields: [{ code: "a", value: "Книга" }],
};

for (const Serializer of [MarcIsoSerializer, MarcAlephSequentialSerializer]) {
  test(`${Serializer.name}: отклоняет запрещённые свойства, включая undefined`, () => {
    const serializer = new Serializer("utf-8");
    for (const [field, key, example] of [
      [control, "ind1", " "],
      [control, "ind2", " "],
      [control, "subfields", []],
      [data, "value", "лишнее значение"],
    ] as const) {
      for (const value of [example, null, undefined]) {
        assert.throws(() => serializer.serialize({
          leader: "00000nam a2200000 i 4500",
          format: "BK",
          recordId: "000000123",
          fields: [control, { ...field, [key]: value }],
        }), (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes(`fields[1].${key}`));
          assert.match(error.message, /запрещено/);
          return true;
        });
      }
    }
  });
}

test("принимает обе формы и сохраняет сторонние метаданные", () => {
  for (const field of [control, data, { ...data, code: "ABC" }]) {
    const input = { ...field, label: "метаданные редактора" };
    assert.deepEqual(parseMarcJsonField(input, 0), input);
  }
});

test("отклоняет неполные поля и неверные значения с путём ошибки", () => {
  for (const [field, path] of [
    [null, "fields[2]"],
    [{ code: "FMT", value: "BK" }, "fields[2]"],
    [{ code: "001" }, "fields[2].value"],
    [{ ...data, ind1: undefined }, "fields[2].ind1"],
    [{ ...data, ind2: "AA" }, "fields[2].ind2"],
    [{ ...data, ind1: "<unrecognized>" }, "fields[2].ind1"],
    [{ ...data, subfields: [{ code: "a", value: 12 }] }, "fields[2].subfields[0].value"],
  ] as const) {
    assert.throws(() => parseMarcJsonField(field, 2), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(path), error.message);
      return true;
    });
  }
});


test("принимает структурно представимые поля с ошибками валидации", () => {
  for (const field of [
    { code: "00A", value: "123" },
    { ...data, code: "A1b", ind1: "A", subfields: [] },
    { ...data, subfields: [{ code: "A", value: "x" }] },
  ]) {
    assert.deepEqual(parseMarcJsonField(field, 0), field);
  }
});
