import { hasDeletionFlag, keepImportedField } from "./marc-import-policy.js";
import type {
  MarcControlField,
  MarcDataField,
  MarcDirectoryEntry,
  MarcField,
  MarcLeader,
  MarcRawField,
  MarcRecord,
  MarcSubfield,
} from "./marc-record.js";

const LEADER_LENGTH = 24;
const TAG_LENGTH = 3;
const FIELD_TERMINATOR = 0x1e;
const SUBFIELD_DELIMITER = 0x1f;
const INDICATOR_COUNT = 2;

export interface MarcParser {
  /** Разбор со структурными проверками, без отбора полей по правилам импорта. */
  parse(record: Buffer): MarcRecord;
  /** Разбор с правилами импорта: DEL$a=Y → null, лишние служебные поля исключаются. */
  parseForImport?(record: Buffer): MarcRecord | null;
}

export class Iso2709MarcParser implements MarcParser {
  /** Разбирает все поля; ошибки структуры вызывают исключение. */
  parse(record: Buffer): MarcRecord {
    return this.parseRecord(record, false)!;
  }

  /** Применяет отбор записей и полей при импорте, затем разбирает оставшиеся поля. */
  parseForImport(record: Buffer): MarcRecord | null {
    return this.parseRecord(record, true);
  }

  /**
   * Leader → Directory → сырые поля → отбор при импорте → разбор и нормализация.
   * Оба режима проверяют структуру ISO 2709. Допустимость кодов, индикаторов
   * и значений по правилам MARC проверяет отдельно MarcRecordValidator.
   */
  private parseRecord(record: Buffer, importing: boolean): MarcRecord | null {
    // Leader — первые 24 байта: без полного заголовка нельзя определить границы данных.
    if (record.length < LEADER_LENGTH) {
      throw new Error(
        `Недостаточно данных для Leader: получено ${record.length} байт, требуется ${LEADER_LENGTH}.`,
      );
    }

    // Позиции Leader фиксированы; parseLeader выделяет их без проверки допустимых кодов.
    const rawLeader = record.subarray(0, LEADER_LENGTH).toString("ascii");
    const leader = parseLeader(rawLeader);
    if (parseDecimal(leader.recordLength, "recordLength") !== record.length) {
      throw new Error("Длина MARC-записи не соответствует Leader/00-04.");
    }
    if (record.at(-1) !== 0x1d) {
      throw new Error("MARC-запись не заканчивается разделителем 0x1D.");
    }
    const baseAddressOfData = parseDecimal(
      leader.baseAddressOfData,
      "baseAddressOfData",
    );
    const directory = parseDirectory(record, leader, baseAddressOfData);
    const rawFields = parseRawFields(record, directory, baseAddressOfData);

    // Только при импорте ищем служебное DEL (регистр тега не важен).
    // Убираем конечный 0x1E; hasDeletionFlag ищет точное подполе a=Y,
    // используя 0x1F как разделитель. Такая запись целиком пропускается.
    if (importing && rawFields.some(({ tag, raw }) =>
      tag.toUpperCase() === "DEL" &&
      hasDeletionFlag(raw.subarray(0, -1), Buffer.from([SUBFIELD_DELIMITER])))) {
      return null;
    }
    // retained — пары «поле + соответствующая статья Directory», оставшиеся после отбора.
    // map связывает их по индексу; filter в обычном parse оставляет всё,
    // а при импорте исключает трёхбуквенные служебные теги, кроме FMT.
    const retained = rawFields.map((field, index) => ({ field, entry: directory[index]! }))
      .filter(({ field }) => !importing || keepImportedField(field.tag));
    if (retained.length !== rawFields.length) {
      // Поля удалены: перестраиваем Directory, смещения и Leader для оставшихся данных.
      // Повторный parse идёт без фильтрации и выполняет общий разбор и нормализацию.
      let position = 0;
      const newDirectory = retained.map(({ field, entry }) => {
        const offset = String(position).padStart(Number(leader.lengthOfStartingCharacterPositionPortion), "0");
        position += field.raw.length;
        return Buffer.from(field.tag + entry.fieldLength + offset + entry.implementationDefined, "ascii");
      });
      const baseAddress = LEADER_LENGTH + newDirectory.reduce((n, entry) => n + entry.length, 0) + 1;
      const normalizedLeader = Buffer.from(rawLeader, "ascii");
      normalizedLeader.write(String(baseAddress + position + 1).padStart(5, "0"), 0, "ascii");
      normalizedLeader.write(String(baseAddress).padStart(5, "0"), 12, "ascii");
      return this.parse(Buffer.concat([
        normalizedLeader, ...newDirectory, Buffer.from([FIELD_TERMINATOR]),
        ...retained.map(({ field }) => field.raw), Buffer.from([0x1d]),
      ]));
    }

    const fields = retained.map(({ field }) => parseField(field));
    // TM2-2017: после успешного разбора пересчитываем Leader/00–04 и /12–16.
    // https://jira.rsl.ru/browse/TM2-2017
    // Адрес = 24 + размер Directory + его 0x1E; длина = адрес + поля с 0x1E + 0x1D.
    // Остальные позиции Leader сохраняем; исходный буфер не меняем.
    const baseAddress = LEADER_LENGTH + retained.reduce((size, { entry }) =>
      size + entry.raw.length, 0) + 1;
    const byteLength = baseAddress + fields.reduce((size, field) =>
      size + field.raw.length, 0) + 1;
    const normalizedLeader = String(byteLength).padStart(5, "0") +
      rawLeader.slice(5, 12) + String(baseAddress).padStart(5, "0") +
      rawLeader.slice(17);

    return {
      byteLength,
      leader: parseLeader(normalizedLeader),
      directory: retained.map(({ entry }) => entry),
      fields,
    };
  }
}

/** Разбивает 24 ASCII-байта Leader по фиксированным позициям (отсчёт с нуля). */
function parseLeader(raw: string): MarcLeader {
  return {
    raw,
    // 00–04: полная длина ISO-записи в байтах, включая разделители.
    recordLength: raw.slice(0, 5),
    // 05: статус записи (например, новая или изменённая).
    recordStatus: raw.slice(5, 6),
    // 06: тип материала/записи.
    typeOfRecord: raw.slice(6, 7),
    // 07: библиографический уровень (монография, сериальное издание и т. п.).
    bibliographicLevel: raw.slice(7, 8),
    // 08: тип контроля (например, архивный).
    typeOfControl: raw.slice(8, 9),
    // 09: схема кодирования символов.
    characterCodingScheme: raw.slice(9, 10),
    // 10: количество байтов индикаторов в поле данных.
    indicatorCount: raw.slice(10, 11),
    // 11: длина идентификатора подполя вместе с разделителем (обычно 2).
    subfieldCodeCount: raw.slice(11, 12),
    // 12–16: смещение первого поля от начала записи в байтах.
    baseAddressOfData: raw.slice(12, 17),
    // 17: уровень полноты библиографического описания.
    encodingLevel: raw.slice(17, 18),
    // 18: форма/правила описательной каталогизации.
    descriptiveCatalogingForm: raw.slice(18, 19),
    // 19: уровень записи многочастного ресурса.
    multipartResourceRecordLevel: raw.slice(19, 20),
    // 20: число цифр длины поля в статье Directory (обычно 4).
    lengthOfFieldPortion: raw.slice(20, 21),
    // 21: число цифр смещения поля в статье Directory (обычно 5).
    lengthOfStartingCharacterPositionPortion: raw.slice(21, 22),
    // 22: длина дополнительной части статьи Directory (обычно 0).
    lengthOfImplementationDefinedPortion: raw.slice(22, 23),
    // 23: неопределённая позиция карты Directory; в MARC 21 — 0.
    undefinedEntryMapCharacter: raw.slice(23, 24),
  };
}

/**
 * Directory — справочник между Leader и областью данных, заканчивается 0x1E.
 * Статья: тег (3 байта) + длина поля с 0x1E + смещение от baseAddressOfData
 * + дополнительная часть. Ширины последних трёх частей заданы Leader/20–22.
 * Обычно это 3 + 4 + 5 + 0 = 12 байт; например, 001001000000 — поле 001,
 * длина 10 байт, смещение 0. Здесь проверяем границы и размер справочника.
 */
function parseDirectory(
  record: Buffer,
  leader: MarcLeader,
  baseAddressOfData: number,
): MarcDirectoryEntry[] {
  if (baseAddressOfData <= LEADER_LENGTH || baseAddressOfData > record.length) {
    throw new Error(
      `Некорректный baseAddressOfData: ${baseAddressOfData}.`,
    );
  }

  const directoryEnd = baseAddressOfData - 1;

  if (record[directoryEnd] !== FIELD_TERMINATOR) {
    throw new Error(
      `Directory не заканчивается разделителем 0x1E по позиции ${directoryEnd}.`,
    );
  }

  const fieldLengthSize = parseDecimal(
    leader.lengthOfFieldPortion,
    "lengthOfFieldPortion",
  );
  const startingPositionSize = parseDecimal(
    leader.lengthOfStartingCharacterPositionPortion,
    "lengthOfStartingCharacterPositionPortion",
  );
  const implementationDefinedSize = parseDecimal(
    leader.lengthOfImplementationDefinedPortion,
    "lengthOfImplementationDefinedPortion",
  );
  const entryLength =
    TAG_LENGTH +
    fieldLengthSize +
    startingPositionSize +
    implementationDefinedSize;
  const rawDirectory = record.subarray(LEADER_LENGTH, directoryEnd);

  if (rawDirectory.length % entryLength !== 0) {
    throw new Error(
      `Длина Directory ${rawDirectory.length} не кратна длине записи ${entryLength}.`,
    );
  }

  const entries: MarcDirectoryEntry[] = [];

  for (let offset = 0; offset < rawDirectory.length; offset += entryLength) {
    const raw = rawDirectory
      .subarray(offset, offset + entryLength)
      .toString("ascii");
    const fieldLengthEnd = TAG_LENGTH + fieldLengthSize;
    const startingPositionEnd = fieldLengthEnd + startingPositionSize;

    entries.push({
      raw,
      tag: raw.slice(0, TAG_LENGTH),
      fieldLength: raw.slice(TAG_LENGTH, fieldLengthEnd),
      startingCharacterPosition: raw.slice(
        fieldLengthEnd,
        startingPositionEnd,
      ),
      implementationDefined: raw.slice(startingPositionEnd),
    });
  }

  return entries;
}

/**
 * Извлекает байтовые срезы полей по Directory: начало = базовый адрес + смещение.
 * Проверяет длины, границы, конечные 0x1E и полное покрытие области данных
 * без пропусков и пересечений. Содержимое полей пока не интерпретируется.
 */
function parseRawFields(
  record: Buffer,
  directory: readonly MarcDirectoryEntry[],
  baseAddressOfData: number,
): MarcRawField[] {
  const ranges: { start: number; end: number }[] = [];
  const fields = directory.map((entry) => {
    const fieldLength = parseDecimal(
      entry.fieldLength,
      `Длина поля ${entry.tag}`,
    );
    const startingCharacterPosition = parseDecimal(
      entry.startingCharacterPosition,
      `Начальная позиция поля ${entry.tag}`,
    );

    if (fieldLength === 0) {
      throw new Error(`Длина поля ${entry.tag} не может быть равна нулю.`);
    }

    const fieldStart = baseAddressOfData + startingCharacterPosition;
    const fieldEnd = fieldStart + fieldLength;

    if (fieldStart >= record.length || fieldEnd > record.length - 1) {
      throw new Error(
        `Поле ${entry.tag} выходит за границы MARC-записи: ` +
          `позиция ${fieldStart}, длина ${fieldLength}.`,
      );
    }

    if (record[fieldEnd - 1] !== FIELD_TERMINATOR) {
      throw new Error(
        `Поле ${entry.tag} не заканчивается разделителем 0x1E по позиции ${fieldEnd - 1}.`,
      );
    }

    ranges.push({ start: fieldStart, end: fieldEnd });
    return {
      tag: entry.tag,
      raw: record.subarray(fieldStart, fieldEnd),
    };
  });
  let position = baseAddressOfData;
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    if (range.start !== position) {
      throw new Error("Границы полей Directory содержат пропуск или пересечение.");
    }
    position = range.end;
  }
  if (position !== record.length - 1) {
    throw new Error("Размер области полей не соответствует длине записи.");
  }
  return fields;
}

/** Отделяет конечный 0x1E и выбирает разбор контрольного поля или поля данных. */
function parseField(field: MarcRawField): MarcField {
  const content = field.raw.subarray(0, -1);

  if (isControlField(field.tag)) {
    // TM2-2017: в контрольных полях заменяем ^ (0x5E) на пробел (0x20).
    // https://jira.rsl.ru/browse/TM2-2017
    // Копия нужна только при замене: raw — срез исходного буфера, его нельзя менять.
    // raw и value остаются согласованы; конечный 0x1E и длина поля сохраняются.
    const raw = field.raw.includes(0x5e) ? Buffer.from(field.raw) : field.raw;
    for (let index = 0; index < raw.length - 1; index += 1) {
      if (raw[index] === 0x5e) raw[index] = 0x20;
    }
    const controlField: MarcControlField = {
      ...field,
      raw,
      kind: "control",
      value: raw.subarray(0, -1),
    };

    return controlField;
  }

  return parseDataField(field, content);
}

/** Контрольные 00X и служебное FMT содержат значение без индикаторов и подполей. */
function isControlField(tag: string): boolean {
  // FMT хранит формат записи РГБ/Aleph (BK, CR и т. п.).
  return tag.startsWith("00") || tag.toUpperCase() === "FMT";
}

/**
 * Читает до двух байтов индикаторов и подполя. Короткие/некорректные индикаторы
 * сохраняются для отдельной валидации; значения подполей остаются байтами.
 */
function parseDataField(field: MarcRawField, content: Buffer): MarcDataField {
  const firstSubfieldPosition = content.indexOf(SUBFIELD_DELIMITER);
  const indicatorEnd = Math.min(
    firstSubfieldPosition === -1 ? content.length : firstSubfieldPosition,
    INDICATOR_COUNT,
  );
  const indicators = Array.from(
    content.subarray(0, indicatorEnd),
    (byte) => String.fromCharCode(byte),
  );

  return {
    ...field,
    kind: "data",
    indicators,
    subfields: parseSubfields(content),
  };
}

/**
 * Делит содержимое по 0x1F: первый байт после разделителя — код подполя,
 * остальные до следующего 0x1F или конца — значение. Порядок и повторы сохраняются.
 * latin1 сохраняет значение байта кода; его допустимость проверяет валидатор.
 */
function parseSubfields(content: Buffer): MarcSubfield[] {
  const subfields: MarcSubfield[] = [];
  let delimiterPosition = content.indexOf(SUBFIELD_DELIMITER);

  while (delimiterPosition !== -1) {
    const nextDelimiterPosition = content.indexOf(
      SUBFIELD_DELIMITER,
      delimiterPosition + 1,
    );
    const subfieldEnd =
      nextDelimiterPosition === -1 ? content.length : nextDelimiterPosition;
    const rawSubfield = content.subarray(
      delimiterPosition + 1,
      subfieldEnd,
    );

    subfields.push({
      code: rawSubfield.subarray(0, 1).toString("latin1"),
      value: rawSubfield.subarray(1),
    });

    delimiterPosition = nextDelimiterPosition;
  }

  return subfields;
}

/** Читает непустую последовательность ASCII-цифр; иначе сообщает имя ошибочного элемента. */
function parseDecimal(value: string, name: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `${name} должно содержать только цифры: ${JSON.stringify(value)}.`,
    );
  }

  return Number(value);
}
