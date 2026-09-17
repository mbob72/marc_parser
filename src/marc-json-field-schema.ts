import { z } from "zod";
import type { MarcJsonField } from "./marc-json-serializer.js";

const tagSchema = z.string().regex(/^[\x00-\x7f]{3}$/)
  .refine((code) => code.toUpperCase() !== "FMT", "FMT не передаётся в fields.");
const fieldHeaderSchema = z.object({ code: tagSchema });
const indicatorSchema = z.string().regex(/^[\x00-\x7f]$/);

/** Check the original object before parsing can discard unknown properties. */
function withoutProperties(keys: readonly string[]) {
  return z.unknown().superRefine((value, context) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return;
    }
    for (const key of keys) {
      if (key in value) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `Свойство ${key} запрещено для этого вида поля.`,
        });
      }
    }
  });
}

export const marcJsonControlFieldSchema = withoutProperties([
  "ind1", "ind2", "subfields",
]).pipe(z.looseObject({
  code: tagSchema.refine((code) => code.startsWith("00")),
  value: z.string(),
}));

export const marcJsonDataFieldSchema = withoutProperties(["value"]).pipe(
  z.looseObject({
    code: tagSchema.refine((code) => !code.startsWith("00")),
    ind1: indicatorSchema,
    ind2: indicatorSchema,
    subfields: z.array(z.looseObject({
      code: z.string().regex(/^[\x00-\x7f]$/),
      value: z.string(),
    })),
  }),
);

/** Reverse-conversion field validation with an indexed error path. */
export function parseMarcJsonField(value: unknown, index: number): MarcJsonField {
  const header = fieldHeaderSchema.safeParse(value);
  if (!header.success) {
    throw new Error(`Некорректный объект или code у fields[${index}].`);
  }

  // The tag determines the kind, even when the object contains mixed properties.
  const schema = header.data.code.startsWith("00")
    ? marcJsonControlFieldSchema
    : marcJsonDataFieldSchema;
  const result = schema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues.map((issue) => {
      const path = issue.path.reduce<string>(
        (path, part) => typeof part === "number"
          ? `${path}[${part}]`
          : `${path}.${String(part)}`,
        `fields[${index}]`,
      );
      return `${path}: ${issue.message}`;
    });
    throw new Error(details.join("; "));
  }
  return result.data;
}
