export interface MarcLeader {
  /** Все 24 байта Leader в исходном виде. */
  readonly raw: string;
  /** Позиции 00-04. */
  readonly recordLength: string;
  /** Позиция 05. */
  readonly recordStatus: string;
  /** Позиция 06. */
  readonly typeOfRecord: string;
  /** Позиция 07. */
  readonly bibliographicLevel: string;
  /** Позиция 08. */
  readonly typeOfControl: string;
  /** Позиция 09. */
  readonly characterCodingScheme: string;
  /** Позиция 10. */
  readonly indicatorCount: string;
  /** Позиция 11. */
  readonly subfieldCodeCount: string;
  /** Позиции 12-16. */
  readonly baseAddressOfData: string;
  /** Позиция 17. */
  readonly encodingLevel: string;
  /** Позиция 18. */
  readonly descriptiveCatalogingForm: string;
  /** Позиция 19. */
  readonly multipartResourceRecordLevel: string;
  /** Позиция 20. */
  readonly lengthOfFieldPortion: string;
  /** Позиция 21. */
  readonly lengthOfStartingCharacterPositionPortion: string;
  /** Позиция 22. */
  readonly lengthOfImplementationDefinedPortion: string;
  /** Позиция 23. */
  readonly undefinedEntryMapCharacter: string;
}

export interface MarcDirectoryEntry {
  /** Полная запись Directory в исходном виде. */
  readonly raw: string;
  /** Трёхбайтовый тег связанного переменного поля. */
  readonly tag: string;
  /** Длина поля вместе с завершающим байтом 0x1E. */
  readonly fieldLength: string;
  /** Смещение поля относительно baseAddressOfData. */
  readonly startingCharacterPosition: string;
  /** Часть записи Directory, размер которой задан Leader/22. */
  readonly implementationDefined: string;
}

export interface MarcRawField {
  readonly tag: string;
  /** Поле целиком, включая завершающий байт 0x1E. */
  readonly raw: Buffer;
}

export interface MarcRecord {
  readonly byteLength: number;
  readonly leader: MarcLeader;
  readonly directory: readonly MarcDirectoryEntry[];
  readonly fields: readonly MarcRawField[];
}
