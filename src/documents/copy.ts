/** COPY CSV различает SQL NULL, пустую строку и буквальный обратный слеш. */
// DOC-PREVIEW:/docs/documents-code.md#copy-row
export function copyRow(values: (string | number | null)[]): string {
  return (
    values
      .map((v) =>
        v === null ? "\\N" : '"' + String(v).replaceAll('"', '""') + '"',
      )
      .join("\t") + "\n"
  );
}
