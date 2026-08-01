import { once } from "node:events";
import { Writable } from "node:stream";
import type { MarcRecordContext } from "./marc-record-processor.js";
import type { MarcValidationResult } from "./marc-validator.js";

export interface MarcProcessingStatistics {
  readonly recordsProcessed: number;
  readonly validRecords: number;
  readonly recordsWithValidationErrors: number;
  readonly recordsWithParsingErrors: number;
  readonly validationErrors: number;
  readonly inputBytes: number;
}

export interface MarcProcessingSummary extends MarcProcessingStatistics {
  readonly durationMilliseconds: number;
  readonly outputPath: string;
}

export interface MarcProcessingLogger {
  logValidationResult(
    result: MarcValidationResult,
    context: MarcRecordContext,
  ): void | Promise<void>;

  logParsingError(
    error: Error,
    context: MarcRecordContext,
  ): void | Promise<void>;

  logSummary(summary: MarcProcessingSummary): void | Promise<void>;

  logFatalError(error: Error): void | Promise<void>;
}

export class NullMarcProcessingLogger implements MarcProcessingLogger {
  logValidationResult(
    _result: MarcValidationResult,
    _context: MarcRecordContext,
  ): void {}

  logParsingError(_error: Error, _context: MarcRecordContext): void {}

  logSummary(_summary: MarcProcessingSummary): void {}

  logFatalError(_error: Error): void {}
}

export interface ConsoleMarcProcessingLoggerOptions {
  readonly verbose?: boolean;
  readonly output?: Writable;
  readonly errorOutput?: Writable;
}

export class ConsoleMarcProcessingLogger implements MarcProcessingLogger {
  private readonly verbose: boolean;
  private readonly output: Writable;
  private readonly errorOutput: Writable;

  constructor(options: ConsoleMarcProcessingLoggerOptions = {}) {
    this.verbose = options.verbose ?? false;
    this.output = options.output ?? process.stdout;
    this.errorOutput = options.errorOutput ?? process.stderr;
  }

  async logValidationResult(
    result: MarcValidationResult,
    context: MarcRecordContext,
  ): Promise<void> {
    if (result.valid) {
      if (this.verbose) {
        await writeToStream(
          this.output,
          `Валидация записи ${context.recordIndex + 1}: ошибок нет.\n`,
        );
      }

      return;
    }

    for (const error of result.errors) {
      await writeToStream(
        this.errorOutput,
        `Ошибка валидации записи ${context.recordIndex + 1} ` +
          `[${error.rule}]: ${error.message}\n`,
      );
    }
  }

  async logParsingError(
    error: Error,
    context: MarcRecordContext,
  ): Promise<void> {
    await writeToStream(
      this.errorOutput,
      `Ошибка парсинга записи ${context.recordIndex + 1} ` +
        `по смещению ${context.byteOffset}: ${error.message}\n`,
    );
  }

  async logSummary(summary: MarcProcessingSummary): Promise<void> {
    const durationSeconds = summary.durationMilliseconds / 1_000;
    const recordsPerSecond =
      durationSeconds > 0
        ? summary.recordsProcessed / durationSeconds
        : summary.recordsProcessed;

    await writeToStream(
      this.output,
      [
        `Обработано записей: ${summary.recordsProcessed}`,
        `Корректных: ${summary.validRecords}`,
        `С ошибками валидации: ${summary.recordsWithValidationErrors}`,
        `С ошибками парсинга: ${summary.recordsWithParsingErrors}`,
        `Всего ошибок валидации: ${summary.validationErrors}`,
        `Время: ${durationSeconds.toFixed(3)} с`,
        `Скорость: ${recordsPerSecond.toFixed(0)} записей/с`,
        `Результат: ${summary.outputPath}`,
        "",
      ].join("\n"),
    );
  }

  async logFatalError(error: Error): Promise<void> {
    await writeToStream(
      this.errorOutput,
      `Ошибка обработки: ${error.message}\nВыходной файл не создан.\n`,
    );
  }
}

async function writeToStream(stream: Writable, text: string): Promise<void> {
  if (text.length > 0 && !stream.write(text)) {
    await once(stream, "drain");
  }
}
