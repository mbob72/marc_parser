export interface MarcRecordContext {
  recordIndex: number;
  byteOffset: number;
}

/**
 * Зависимость, которой RecordSplitter передаёт одну полную MARC-запись.
 * Реализация не должна изменять содержимое record.
 */
export interface MarcRecordProcessor {
  process(
    record: Buffer,
    context: MarcRecordContext,
  ): void | Promise<void>;
}
