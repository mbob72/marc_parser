import type { Client } from "pg";

export const documentColumns = [
  "id",
  "library_code",
  "system_number",
  "leader",
  "format",
  "fields",
  "hidden",
  "meta",
  "created_at",
  "updated_at",
] as const;

const expectedTypes: Record<(typeof documentColumns)[number], string> = {
  id: "uuid",
  library_code: "character varying(6)",
  system_number: "integer",
  leader: "character varying(25)",
  format: "character varying(5)",
  fields: "jsonb",
  hidden: "boolean",
  meta: "jsonb",
  created_at: "timestamp without time zone",
  updated_at: "timestamp without time zone",
};
const nullable = new Set(["meta", "updated_at"]);

/** Допускает только отдельное пространство публикации; вызывающий не может
 * перенаправить DDL/INSERT в public, import или системный каталог.
 * DOC-PREVIEW:/docs/bib-publication.md#schema */
export function quotePublicationSchema(name: string): string {
  if (
    !/^[a-z][a-z0-9_]{0,62}$/.test(name) ||
    ["public", "import", "information_schema"].includes(name) ||
    name.startsWith("pg_")
  )
    throw Error("Isolated publication schema required");
  return `"${name}"`;
}

type Column = {
  name: string;
  type: string;
  not_null: boolean;
  default_value: string | null;
  identity: string;
  generated: string;
  collation: number;
};

async function readColumns(client: Client, oid: number): Promise<Column[]> {
  return (
    await client.query(
      `SELECT a.attname::text name,format_type(a.atttypid,a.atttypmod) type,
      a.attnotnull not_null,pg_get_expr(d.adbin,d.adrelid) default_value,
      a.attidentity identity,a.attgenerated generated,a.attcollation::int collation
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,
      [oid],
    )
  ).rows;
}

/** Проверяет действительную форму источника до создания целевых объектов.
 * Служебные колонки исходного разбора не входят в публикацию и сохраняются в import.
 * DOC-PREVIEW:/docs/bib-publication.md#schema */
async function requirePublicationSource(client: Client): Promise<void> {
  const source = (
    await client.query(
      `SELECT c.oid::int oid,c.relkind,c.relrowsecurity,c.relforcerowsecurity,
      has_schema_privilege(n.oid,'USAGE') can_use,has_table_privilege(c.oid,'SELECT') can_read
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='import' AND c.relname='bib_records'`,
    )
  ).rows[0];
  if (
    !source ||
    source.relkind !== "r" ||
    source.relrowsecurity ||
    source.relforcerowsecurity ||
    !source.can_use ||
    !source.can_read
  )
    throw Error("Readable ordinary import.bib_records without RLS required");
  const columns = await readColumns(client, source.oid);
  for (const name of documentColumns) {
    const c = columns.find((c) => c.name === name);
    if (
      !c ||
      c.type !== expectedTypes[name] ||
      c.generated ||
      c.identity ||
      ![0, 100].includes(c.collation)
    )
      throw Error(`Unsupported source import.bib_records.${name}`);
  }
  const accepted = columns.find((c) => c.name === "accepted");
  if (!accepted || accepted.type !== "boolean" || !accepted.not_null)
    throw Error("Typed import.bib_records.accepted required");
  // Курсор публикации идёт по паре библиотеки и номера: её уникальность должна
  // гарантироваться индексом до первых INSERT, а не обнаруживаться поздним COUNT.
  const keys = (
    await client.query(
      `SELECT
      EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=$1 AND c.contype='p' AND NOT c.condeferrable
        AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(num,ord)
          JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num ORDER BY k.ord)=ARRAY['id']) uuid_pk,
      EXISTS(SELECT 1 FROM pg_index i JOIN pg_class ix ON ix.oid=i.indexrelid JOIN pg_am am ON am.oid=ix.relam
        WHERE i.indrelid=$1 AND i.indisunique AND i.indisvalid AND i.indisready AND i.indexprs IS NULL
        AND am.amname='btree' AND pg_get_expr(i.indpred,i.indrelid)='accepted'
        AND ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(num,ord)
          JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num WHERE k.ord<=i.indnkeyatts ORDER BY k.ord)=ARRAY['library_code','system_number']) accepted_identity`,
      [source.oid],
    )
  ).rows[0];
  if (!keys.uuid_pk || !keys.accepted_identity)
    throw Error(
      "Source UUID primary key and accepted library/number unique index required",
    );
}

/** Создаёт отсутствующую изолированную цель и проверяет её фактический DDL.
 * Существующие несовместимые таблицы не исправляются автоматически. Один SQL-блок
 * создания атомарен; внешний advisory-lock и жизненный цикл соединения принадлежат publisher.
 * DOC-PREVIEW:/docs/bib-publication.md#schema */
export async function ensurePublicationTarget(
  client: Client,
  schema: string,
): Promise<{ manifest: unknown }> {
  const quoted = quotePublicationSchema(schema);
  await requirePublicationSource(client);
  const exists = (
    await client.query("SELECT to_regclass($1) IS NOT NULL present", [
      `${quoted}.documents`,
    ])
  ).rows[0].present;
  if (!exists) {
    // INCLUDING DEFAULTS перенёс бы ссылку на public sequence; здесь она собственная.
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoted};
      CREATE SEQUENCE ${quoted}.documents_system_number_seq AS integer;
      CREATE TABLE ${quoted}.documents(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        library_code varchar(6) NOT NULL,
        system_number integer NOT NULL DEFAULT nextval('${quoted}.documents_system_number_seq'::regclass),
        leader varchar(25) NOT NULL,
        format varchar(5) NOT NULL,
        fields jsonb NOT NULL,
        hidden boolean NOT NULL DEFAULT false,
        meta jsonb,
        created_at timestamp NOT NULL DEFAULT current_timestamp,
        updated_at timestamp,
        UNIQUE(library_code,system_number));
      ALTER SEQUENCE ${quoted}.documents_system_number_seq OWNED BY ${quoted}.documents.system_number;
      CREATE INDEX documents_system_number_index ON ${quoted}.documents(system_number);`);
  }
  const table = (
    await client.query(
      `SELECT c.oid::int oid,n.oid::int schema_oid,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,c.relhasrules,
      has_schema_privilege(n.oid,'USAGE') can_use,has_table_privilege(c.oid,'SELECT') can_read,
      has_table_privilege(c.oid,'INSERT') can_insert
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname='documents'`,
      [schema],
    )
  ).rows[0];
  if (
    !table ||
    table.relkind !== "r" ||
    table.relpersistence !== "p" ||
    table.relrowsecurity ||
    table.relforcerowsecurity ||
    table.relhasrules ||
    !table.can_use ||
    !table.can_read ||
    !table.can_insert
  )
    throw Error("Unsupported publication documents table, RLS or privileges");
  const columns = await readColumns(client, table.oid);
  if (columns.length !== documentColumns.length)
    throw Error("Publication documents requires exactly ten columns");
  for (const name of documentColumns) {
    const c = columns.find((c) => c.name === name);
    if (
      !c ||
      c.type !== expectedTypes[name] ||
      c.generated ||
      c.identity ||
      c.not_null === nullable.has(name) ||
      ![0, 100].includes(c.collation)
    )
      throw Error(`Unsupported publication documents.${name}`);
  }
  const constraints = (
    await client.query(
      `SELECT c.oid::int oid,c.conname::text name,c.contype kind,c.convalidated validated,
      c.condeferrable deferrable,c.condeferred deferred,pg_get_constraintdef(c.oid,true) definition,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(num,ord)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num ORDER BY k.ord) columns
      FROM pg_constraint c WHERE c.conrelid=$1 ORDER BY c.oid`,
      [table.oid],
    )
  ).rows;
  const isKey = (names: string[], expected: string[]) =>
    names.length === expected.length &&
    expected.every((n) => names.includes(n));
  if (
    constraints.some(
      (c) =>
        !c.validated ||
        c.deferrable ||
        c.deferred ||
        !(
          (c.kind === "p" && isKey(c.columns, ["id"])) ||
          (c.kind === "u" &&
            isKey(c.columns, ["library_code", "system_number"])) ||
          c.kind === "n"
        ),
    ) ||
    !constraints.some((c) => c.kind === "p" && isKey(c.columns, ["id"])) ||
    !constraints.some(
      (c) =>
        c.kind === "u" && isKey(c.columns, ["library_code", "system_number"]),
    )
  )
    throw Error(
      "Unsupported publication constraints; UUID PK and library/number UNIQUE required",
    );
  if (
    (
      await client.query(
        "SELECT 1 FROM pg_trigger WHERE tgrelid=$1 AND NOT tgisinternal LIMIT 1",
        [table.oid],
      )
    ).rowCount
  )
    throw Error("Publication documents must not have custom triggers");
  const indexes = (
    await client.query(
      `SELECT i.indexrelid::int oid,c.relname::text name,pg_get_indexdef(i.indexrelid) definition,
      am.amname::text method,i.indisunique is_unique,i.indisvalid valid,i.indisready ready,
      pg_get_expr(i.indpred,i.indrelid) predicate,pg_get_expr(i.indexprs,i.indrelid) expression,
      ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(num,ord)
        JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num
        WHERE k.ord<=i.indnkeyatts ORDER BY k.ord) columns
      FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam
      WHERE i.indrelid=$1 ORDER BY i.indexrelid`,
      [table.oid],
    )
  ).rows;
  for (const index of indexes)
    if (
      !index.valid ||
      !index.ready ||
      index.expression ||
      index.predicate ||
      index.method !== "btree" ||
      (index.is_unique &&
        !isKey(index.columns, ["id"]) &&
        !isKey(index.columns, ["library_code", "system_number"]))
    )
      throw Error(`Unsupported publication index: ${index.name}`);
  const sequenceName = (
    await client.query(
      "SELECT pg_get_serial_sequence($1,'system_number') name",
      [`${quoted}.documents`],
    )
  ).rows[0].name;
  if (!sequenceName)
    throw Error("Publication documents requires its own number sequence");
  const sequence = (
    await client.query(
      `SELECT c.oid::int oid,n.nspname::text schema,c.relname::text name,
      format_type(s.seqtypid,NULL) type,s.seqstart::text start,s.seqincrement::text increment,
      s.seqmin::text min,s.seqmax::text max,s.seqcache::text cache,s.seqcycle cycle,
      has_sequence_privilege(c.oid,'USAGE') can_use,has_sequence_privilege(c.oid,'UPDATE') can_update
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_sequence s ON s.seqrelid=c.oid
      WHERE c.oid=$1::regclass`,
      [sequenceName],
    )
  ).rows[0];
  const systemNumber = columns.find((c) => c.name === "system_number")!;
  const ownDefault = (
    await client.query(
      `SELECT EXISTS(SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
      JOIN pg_depend dep ON dep.classid='pg_attrdef'::regclass AND dep.objid=d.oid AND dep.refclassid='pg_class'::regclass
      WHERE d.adrelid=$1 AND a.attname='system_number' AND dep.refobjid=$2) ok`,
      [table.oid, sequence.oid],
    )
  ).rows[0].ok;
  if (
    sequence.schema !== schema ||
    sequence.name !== "documents_system_number_seq" ||
    sequence.type !== "integer" ||
    sequence.increment !== "1" ||
    BigInt(sequence.min) < 1n ||
    sequence.cycle ||
    !sequence.can_use ||
    !sequence.can_update ||
    !ownDefault ||
    !/^nextval\('[^']+'::regclass\)$/.test(systemNumber.default_value ?? "")
  )
    throw Error("Unsupported publication number sequence/default");
  return {
    manifest: {
      schema,
      schemaOid: table.schema_oid,
      tableOid: table.oid,
      columns,
      constraints,
      indexes,
      sequence,
    },
  };
}

/** Создаёт небольшой журнал публикации: граница и счётчики пакета сохраняются
 * вызывающим publisher в том же COMMIT, что и целевые строки.
 * DOC-PREVIEW:/docs/bib-publication.md#schema */
export async function ensurePublicationJournal(client: Client): Promise<void> {
  await client.query(`CREATE SCHEMA IF NOT EXISTS import;
    CREATE TABLE IF NOT EXISTS import.bib_publications(
      id uuid PRIMARY KEY,
      target_schema text NOT NULL UNIQUE,
      image text NOT NULL,
      batch_size integer NOT NULL CHECK(batch_size BETWEEN 1 AND 100000),
      status text NOT NULL CHECK(status IN ('loading','verifying','completed','failed')),
      cursor_library text NOT NULL DEFAULT '',cursor_number integer NOT NULL DEFAULT 0,
      verify_library text NOT NULL DEFAULT '',verify_number integer NOT NULL DEFAULT 0,
      source_manifest jsonb NOT NULL,target_manifest jsonb NOT NULL,
      counters jsonb NOT NULL DEFAULT '{}',verification jsonb NOT NULL DEFAULT '{}',
      error text,started_at timestamptz NOT NULL DEFAULT clock_timestamp(),finished_at timestamptz);
    CREATE TABLE IF NOT EXISTS import.bib_publication_batches(
      publication_id uuid NOT NULL REFERENCES import.bib_publications(id),
      phase text NOT NULL CHECK(phase IN ('loading','verifying')),
      batch_no integer NOT NULL CHECK(batch_no>0),
      cursor_library text NOT NULL,cursor_number integer NOT NULL,
      rows bigint NOT NULL CHECK(rows>=0),elapsed_ms bigint NOT NULL CHECK(elapsed_ms>=0),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(publication_id,phase,batch_no));`);
}
