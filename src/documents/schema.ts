import type { Client } from "pg";

type Column = {
  name: string;
  type: string;
  notNull: boolean;
  default: string | null;
  generated: string;
};
type Constraint = { kind: string; columns: string[] };

/** Каталог отражает типы, ограничения и права, даже если SELECT на таблицу запрещён. */
// DOC-PREVIEW:/docs/documents-code.md#schema
async function inspectTable(client: Client, name: string) {
  const result = await client.query(
    `SELECT c.relkind,
    has_schema_privilege(n.oid,'USAGE') usage,
    has_table_privilege(c.oid,'SELECT') can_select,
    has_table_privilege(c.oid,'INSERT') can_insert,
    (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'generated',a.attgenerated))
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) columns,
    (SELECT jsonb_agg(jsonb_build_object('kind',k.contype,'columns',(SELECT jsonb_agg(a.attname ORDER BY x.ordinality) FROM unnest(k.conkey) WITH ORDINALITY x(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=x.attnum))) FROM pg_constraint k WHERE k.conrelid=c.oid) constraints
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=to_regclass($1)`,
    [name],
  );
  const table = result.rows[0] as
    | {
        relkind: string;
        usage: boolean;
        can_select: boolean;
        can_insert: boolean;
        columns: Column[];
        constraints: Constraint[] | null;
      }
    | undefined;
  if (!table || !["r", "p"].includes(table.relkind))
    throw Error("Required table missing: " + name);
  if (!table.usage || !table.can_select || !table.can_insert)
    throw Error("USAGE/SELECT/INSERT required: " + name);
  return table;
}

/** Проверяет документы без DDL; несовместимая схема останавливает загрузку до COPY.
 * DOC-PREVIEW:/docs/documents-import.md#schema
 */
export async function requireDocuments(client: Client) {
  const table = await inspectTable(client, "public.documents");
  const expected: Record<string, string> = {
    id: "uuid",
    system_number: "integer",
    fields: "jsonb",
  };
  for (const [name, type] of Object.entries(expected)) {
    const column = table.columns.find((c) => c.name === name);
    if (!column || column.type !== type || column.generated)
      throw Error("Invalid documents." + name);
  }
  for (const [name, length] of [
    ["library_code", 6],
    ["leader", 25],
    ["format", 5],
  ] as const) {
    const column = table.columns.find((c) => c.name === name);
    const size = /^character varying\((\d+)\)$/.exec(column?.type ?? "");
    if (
      !column ||
      column.generated ||
      (column.type !== "text" && (!size || Number(size[1]) < length))
    )
      throw Error("Insufficient documents." + name);
  }
  const supplied = [
    "id",
    "system_number",
    "fields",
    "library_code",
    "leader",
    "format",
  ];
  for (const column of table.columns)
    if (
      !supplied.includes(column.name) &&
      column.notNull &&
      !column.default &&
      !column.generated
    )
      throw Error("Missing default: documents." + column.name);
  if (
    !(table.constraints ?? []).some(
      (c) =>
        ["p", "u"].includes(c.kind) &&
        c.columns.length === 1 &&
        c.columns[0] === "id",
    )
  )
    throw Error("documents requires unique id");
}

/** Контракт совпадает с requireDocumentIds проекта связей; UUID назначает только этот слой. */
// DOC-PREVIEW:/docs/documents-code.md#schema
export async function requireIdentities(client: Client) {
  const table = await inspectTable(client, "import.bib_ids");
  for (const [name, type] of [
    ["library_code", "text"],
    ["system_number", "bigint"],
    ["id", "uuid"],
  ]) {
    const column = table.columns.find((c) => c.name === name);
    if (!column || column.type !== type || !column.notNull || column.generated)
      throw Error("Invalid document_ids." + name);
  }
  const unique = (table.constraints ?? []).filter((c) =>
    ["p", "u"].includes(c.kind),
  );
  if (
    !unique.some((c) => c.columns.length === 1 && c.columns[0] === "id") ||
    !unique.some(
      (c) =>
        c.columns.length === 2 &&
        c.columns.includes("library_code") &&
        c.columns.includes("system_number"),
    )
  )
    throw Error("document_ids requires unique id and unique pair");
}

/** Создаёт только служебные таблицы, сохраняя существующий справочник. Вызывается внутри BEGIN. */
// DOC-PREVIEW:/docs/documents-code.md#schema
export async function initializeImport(client: Client) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS import;
    CREATE TABLE IF NOT EXISTS import.bib_ids(library_code text NOT NULL,system_number bigint NOT NULL,id uuid NOT NULL,PRIMARY KEY(library_code,system_number),UNIQUE(id));
    CREATE TABLE IF NOT EXISTS import.bib_batches(archive_sha text,file text,sha text,report jsonb,PRIMARY KEY(archive_sha,file));
    CREATE TABLE IF NOT EXISTS import.bib_errors(archive_sha text,file text,line bigint,code text,record text,PRIMARY KEY(archive_sha,file,line,code));`);
  await client.query(`CREATE TABLE IF NOT EXISTS import.bib_sources(sha256 text PRIMARY KEY,path text NOT NULL);
    CREATE TABLE IF NOT EXISTS import.bib_records(source_sha256 text NOT NULL REFERENCES import.bib_sources(sha256),library_code text NOT NULL,system_number bigint NOT NULL,id uuid NOT NULL,leader text NOT NULL,format text NOT NULL,byte_offset bigint NOT NULL CHECK(byte_offset>=0),byte_length bigint NOT NULL CHECK(byte_length>0),PRIMARY KEY(source_sha256,library_code,system_number));`);
  await requireIdentities(client);
}
