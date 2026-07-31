import type {
  MarcRecordContext,
  MarcRecordProcessor,
} from "./marc-record-processor.js";

const RECORD_TERMINATOR = 0x1d;

/**
 * Начальная реализация обработчика. Пока проверяет только границы записи;
 * разбор Leader, Directory и полей будет добавлен следующими шагами.
 */
export class MarcParserValidator implements MarcRecordProcessor {
  process(record: Buffer, context: MarcRecordContext): void {
    const declaredLength = Number(record.subarray(0, 5).toString("ascii"));

    if (declaredLength !== record.length) {
      throw new Error(
        `Запись ${context.recordIndex + 1}: объявлена длина ${declaredLength}, получено ${record.length} байт.`,
      );
    }

    if (record.at(-1) !== RECORD_TERMINATOR) {
      throw new Error(
        `Запись ${context.recordIndex + 1} не заканчивается разделителем 0x1D.`,
      );
    }
  }
}
