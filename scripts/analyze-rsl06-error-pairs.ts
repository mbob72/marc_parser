import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import { resolve } from "node:path";
import { AlephSequentialRecordSplitter } from "../src/aleph-sequential-record-splitter.js";
import { AlephSequentialMarcParser } from "../src/aleph-sequential-parser.js";
import type {
  MarcRecordContext,
  MarcRecordProcessor,
} from "../src/marc-record-processor.js";
import type { MarcRecord } from "../src/marc-record.js";
import type { MarcValidationError } from "../src/marc-validator.js";
import { MarcRecordValidator } from "../src/marc-validator.js";

const DEFAULT_INPUT = "fixture/rsl06_z00.dat";
const DEFAULT_REPORT = "docs/rsl06-ld02-error-pairs.md";
const EXPECTED = {
  records: 101_991,
  validationErrorRecords: 106,
  parsingErrorRecords: 0,
  leader19Errors: 106,
  leader19A: 43,
  leader19C: 63,
  exactPairs: 27,
} as const;

interface InvalidRecord {
  readonly recordNumber: number;
  readonly byteOffset: number;
  readonly recordId: string;
  readonly leader: string;
  readonly leader19: string;
  readonly error: MarcValidationError;
  readonly source: Buffer;
}

interface Analysis {
  readonly records: number;
  readonly validationErrorRecords: number;
  readonly parsingErrorRecords: number;
  readonly validationRuleHits: number;
  readonly invalidRecords: readonly InvalidRecord[];
  readonly parsingErrors: readonly string[];
}

interface CliOptions {
  readonly inputPath: string;
  readonly outputPath?: string;
}

class Rsl06Analyzer implements MarcRecordProcessor {
  private readonly parser = new AlephSequentialMarcParser();
  private readonly validator = new MarcRecordValidator();

  records = 0;
  validationErrorRecords = 0;
  parsingErrorRecords = 0;
  validationRuleHits = 0;
  readonly invalidRecords: InvalidRecord[] = [];
  readonly parsingErrors: string[] = [];

  process(source: Buffer, context: MarcRecordContext): void {
    this.records += 1;

    let record: MarcRecord;
    try {
      record = this.parser.parse(source);
    } catch (error) {
      this.parsingErrorRecords += 1;
      this.parsingErrors.push(
        `Запись ${context.recordIndex + 1}, смещение ${context.byteOffset}: ${toError(error).message}`,
      );
      return;
    }

    const result = this.validator.validate(record);
    this.validationRuleHits += result.errors.length;
    if (result.valid) {
      return;
    }

    this.validationErrorRecords += 1;
    const leader19Error = result.errors.find(
      ({ rule, message }) =>
        rule === "LD-02" && message.startsWith("Leader/19 "),
    );
    if (!leader19Error) {
      throw new Error(
        `Запись ${context.recordIndex + 1} имеет неожиданную ошибку валидации: ` +
          result.errors.map(({ rule, message }) => `[${rule}] ${message}`).join("; "),
      );
    }
    if (result.errors.length !== 1) {
      throw new Error(
        `Запись ${context.recordIndex + 1} имеет дополнительные ошибки валидации: ` +
          result.errors.map(({ rule, message }) => `[${rule}] ${message}`).join("; "),
      );
    }

    this.invalidRecords.push({
      recordNumber: context.recordIndex + 1,
      byteOffset: context.byteOffset,
      recordId: record.sourceRecordId ?? "<unknown>",
      leader: record.leader.raw,
      leader19: record.leader.multipartResourceRecordLevel,
      error: leader19Error,
      source: Buffer.from(source),
    });
  }

  result(): Analysis {
    return {
      records: this.records,
      validationErrorRecords: this.validationErrorRecords,
      parsingErrorRecords: this.parsingErrorRecords,
      validationRuleHits: this.validationRuleHits,
      invalidRecords: this.invalidRecords,
      parsingErrors: this.parsingErrors,
    };
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const analysis = await analyze(options.inputPath);
  const runs = consecutiveRuns(analysis.invalidRecords);
  const pairs = runs.filter(({ length }) => length === 2);
  verifyExpectedResults(analysis, pairs);

  if (options.outputPath) {
    const report = renderReport(analysis, runs, pairs);
    await writeFile(options.outputPath, report, "utf8");
  }

  printSummary(analysis, runs, pairs, options.outputPath);
}

async function analyze(inputPath: string): Promise<Analysis> {
  const analyzer = new Rsl06Analyzer();
  const splitter = new AlephSequentialRecordSplitter(analyzer);
  const sink = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

  await pipeline(createReadStream(inputPath), splitter, sink);
  return analyzer.result();
}

function parseArgs(args: readonly string[]): CliOptions {
  let inputPath = DEFAULT_INPUT;
  let outputPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") {
      continue;
    }
    if (argument === "--input") {
      inputPath = requiredValue(args, ++index, "--input");
      continue;
    }
    if (argument === "--output") {
      outputPath = requiredValue(args, ++index, "--output");
      continue;
    }
    if (argument === "-h" || argument === "--help") {
      console.log(
        [
          "Использование:",
          "  npx tsx scripts/analyze-rsl06-error-pairs.ts --check",
          `  npx tsx scripts/analyze-rsl06-error-pairs.ts --output ${DEFAULT_REPORT}`,
          "",
          `Вход по умолчанию: ${DEFAULT_INPUT}`,
        ].join("\n"),
      );
      process.exit(0);
    }
    throw new Error(`Неизвестный аргумент ${JSON.stringify(argument)}.`);
  }

  return {
    inputPath: resolve(inputPath),
    outputPath: outputPath ? resolve(outputPath) : undefined,
  };
}

function requiredValue(
  args: readonly string[],
  index: number,
  option: string,
): string {
  const value = args[index];
  if (!value) {
    throw new Error(`После ${option} требуется путь.`);
  }
  return value;
}

function consecutiveRuns(
  records: readonly InvalidRecord[],
): InvalidRecord[][] {
  const runs: InvalidRecord[][] = [];

  for (const record of records) {
    const current = runs.at(-1);
    if (
      current &&
      current.at(-1)?.recordNumber === record.recordNumber - 1
    ) {
      current.push(record);
    } else {
      runs.push([record]);
    }
  }

  return runs;
}

function verifyExpectedResults(
  analysis: Analysis,
  pairs: readonly (readonly InvalidRecord[])[],
): void {
  const leader19A = analysis.invalidRecords.filter(
    ({ leader19 }) => leader19 === "a",
  ).length;
  const leader19C = analysis.invalidRecords.filter(
    ({ leader19 }) => leader19 === "c",
  ).length;

  const actual = {
    records: analysis.records,
    validationErrorRecords: analysis.validationErrorRecords,
    parsingErrorRecords: analysis.parsingErrorRecords,
    leader19Errors: analysis.invalidRecords.length,
    leader19A,
    leader19C,
    exactPairs: pairs.length,
  };

  for (const [name, expected] of Object.entries(EXPECTED)) {
    const value = actual[name as keyof typeof actual];
    if (value !== expected) {
      throw new Error(`${name}: ожидалось ${expected}, получено ${value}.`);
    }
  }
}

function renderReport(
  analysis: Analysis,
  runs: readonly (readonly InvalidRecord[])[],
  pairs: readonly (readonly InvalidRecord[])[],
): string {
  const lines: string[] = [
    "# 27 пар записей `rsl06_z00.dat` с ошибкой `LD-02`",
    "",
    "Отчёт сгенерирован потоковым разбором `fixture/rsl06_z00.dat` текущими",
    "`AlephSequentialMarcParser` и `MarcRecordValidator`. Парой считается",
    "максимальная последовательность ровно из двух соседних ошибочных записей;",
    "последовательности из трёх и более записей сюда не включены.",
    "",
    "## Сводка проверки",
    "",
    "| Показатель | Значение |",
    "| --- | ---: |",
    `| Всего записей | ${formatInteger(analysis.records)} |`,
    `| Записей с ошибкой валидации | ${analysis.validationErrorRecords} |`,
    `| Ошибок парсинга | ${analysis.parsingErrorRecords} |`,
    `| Ошибок \`LD-02\` в \`Leader/19\` | ${analysis.invalidRecords.length} |`,
    `| Максимальных последовательностей ошибок | ${runs.length} |`,
    `| Последовательностей ровно из двух записей | **${pairs.length}** |`,
    "",
    "Во всех 27 парах первая запись содержит `Leader/19 = a`, а вторая —",
    "`Leader/19 = c`. Обе записи успешно парсятся, но запрещены профилем РГБ.",
    "Нарушенное условие: [`LD-02`](./Правила%20валидации%20MARC%20записи.md#ld-02).",
    "",
    "## Проверка из Bash",
    "",
    "Команда `--check` повторно читает все 101 991 записи, применяет рабочие",
    "парсер и валидатор и завершается с ненулевым кодом при расхождении любого",
    "ожидаемого счётчика.",
    "",
    "```bash",
    "git lfs install",
    "git lfs pull --include=fixture/rsl06_z00.dat",
    "npm install",
    "npx tsx scripts/analyze-rsl06-error-pairs.ts --check",
    "```",
    "",
    "Ожидаемый вывод:",
    "",
    "```text",
    "records=101991",
    "validation_error_records=106",
    "parsing_error_records=0",
    "validation_rule_hits=106",
    "leader19_a=43",
    "leader19_c=63",
    "error_runs=53",
    "exact_two_record_runs=27",
    "```",
    "",
    "Для проверки воспроизводимости самого Markdown:",
    "",
    "```bash",
    "npx tsx scripts/analyze-rsl06-error-pairs.ts \\",
    `  --output ${DEFAULT_REPORT}`,
    `git diff --exit-code -- ${DEFAULT_REPORT}`,
    "```",
    "",
    "## Содержание пар",
    "",
    "В блоках ниже исходная Aleph-запись разбита переносами по границам полей",
    "для чтения. Эти переносы не являются частью исходной записи; исходный",
    "конец записи показан как `\\n`. Четыре цифры перед каждым полем — его",
    "байтовая длина из контейнера Aleph. Leader в заголовке блока показывает",
    "нормализованный результат парсера, а строка `LDR` внутри блока — исходное",
    "значение из файла до пересчёта структурных позиций.",
    "",
  ];

  pairs.forEach((pair, pairIndex) => {
    const first = pair[0];
    const second = pair[1];
    if (!first || !second) {
      throw new Error(`Неполная пара с индексом ${pairIndex}.`);
    }

    lines.push(
      `### Пара ${pairIndex + 1}: записи №${first.recordNumber}–${second.recordNumber}`,
      "",
      "| № записи | Z00 ID | Смещение | Leader/19 | Ошибка | Правило |",
      "| ---: | --- | ---: | :---: | --- | --- |",
      renderRecordRow(first),
      renderRecordRow(second),
      "",
      renderRecordContent(first),
      "",
      renderRecordContent(second),
      "",
    );
  });

  return `${lines.join("\n")}\n`;
}

function renderRecordRow(record: InvalidRecord): string {
  return (
    `| ${record.recordNumber} | \`${record.recordId}\` | ` +
    `${record.byteOffset} | \`${record.leader19}\` | ` +
    `${escapeTable(record.error.message)} | ` +
    "[`LD-02`](./Правила%20валидации%20MARC%20записи.md#ld-02) |"
  );
}

function renderRecordContent(record: InvalidRecord): string {
  return [
    "<details>",
    `<summary>Содержание записи №${record.recordNumber} — Z00 <code>${record.recordId}</code>, Leader <code>${escapeHtml(record.leader)}</code></summary>`,
    "",
    "~~~text",
    ...formatAlephSource(record.source),
    "~~~",
    "</details>",
  ].join("\n");
}

function formatAlephSource(source: Buffer): string[] {
  const record = removeLineEnding(source);
  const lines = [`${record.subarray(0, 9).toString("ascii")}\\t`];
  let offset = 10;

  while (offset < record.length) {
    const rawLength = record.subarray(offset, offset + 4).toString("ascii");
    const fieldLength = Number(rawLength);
    if (!/^\d{4}$/.test(rawLength) || fieldLength < 6) {
      throw new Error(`Некорректная длина поля ${JSON.stringify(rawLength)}.`);
    }
    const fieldEnd = offset + 4 + fieldLength;
    if (fieldEnd > record.length) {
      throw new Error(`Поле длиной ${fieldLength} выходит за границы записи.`);
    }
    lines.push(
      `${rawLength}${escapeControls(record.subarray(offset + 4, fieldEnd).toString("utf8"))}`,
    );
    offset = fieldEnd;
  }

  lines.push("\\n");
  return lines;
}

function removeLineEnding(source: Buffer): Buffer {
  if (source.at(-1) !== 0x0a) {
    return source;
  }
  const withoutLf = source.subarray(0, -1);
  return withoutLf.at(-1) === 0x0d
    ? withoutLf.subarray(0, -1)
    : withoutLf;
}

function escapeControls(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, (character) => {
    if (character === "\t") return "\\t";
    if (character === "\n") return "\\n";
    if (character === "\r") return "\\r";
    return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });
}

function escapeTable(value: string): string {
  return value.replaceAll("|", "\\|");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function printSummary(
  analysis: Analysis,
  runs: readonly (readonly InvalidRecord[])[],
  pairs: readonly (readonly InvalidRecord[])[],
  outputPath?: string,
): void {
  const leader19A = analysis.invalidRecords.filter(
    ({ leader19 }) => leader19 === "a",
  ).length;
  const leader19C = analysis.invalidRecords.filter(
    ({ leader19 }) => leader19 === "c",
  ).length;

  console.log(`records=${analysis.records}`);
  console.log(`validation_error_records=${analysis.validationErrorRecords}`);
  console.log(`parsing_error_records=${analysis.parsingErrorRecords}`);
  console.log(`validation_rule_hits=${analysis.validationRuleHits}`);
  console.log(`leader19_a=${leader19A}`);
  console.log(`leader19_c=${leader19C}`);
  console.log(`error_runs=${runs.length}`);
  console.log(`exact_two_record_runs=${pairs.length}`);
  if (outputPath) {
    console.log(`report=${outputPath}`);
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

void main().catch((error: unknown) => {
  console.error(toError(error).message);
  process.exitCode = 1;
});
