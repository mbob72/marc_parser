import { resolve } from "node:path";
import iconv from "iconv-lite";
import { convertMarcFile } from "./marc-file-converter.js";
import { convertMarcJsonFile } from "./marc-json-file-converter.js";
import { ConsoleMarcProcessingLogger } from "./marc-processing-logger.js";
import { APP_VERSION } from "./version.js";

const APP_NAME = "marc-parser";
const DEFAULT_ENCODING = "utf-8";

const HELP = [
  `Использование: ${APP_NAME} <входной-файл> <выходной-файл> [кодировка] [--to-json|--to-iso] [--log]`,
  "",
  "Параметры:",
  "  --log        Выводить результат валидации каждой записи.",
  "  --to-json    Преобразовать ISO 2709 в MARC-JSON/NDJSON (по умолчанию).",
  "  --to-iso     Преобразовать MARC-JSON/NDJSON в ISO 2709.",
  "  -h, --help   Показать эту справку.",
  "  -v, --version  Показать версию программы.",
  "",
  `Кодировка по умолчанию: ${DEFAULT_ENCODING}.`,
].join("\n");

void main(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
});

async function main(args: readonly string[]): Promise<number> {
  const parsed = parseArgs(args);

  if (parsed.kind === "help") {
    console.log(HELP);
    return 0;
  }

  if (parsed.kind === "version") {
    console.log(`${APP_NAME} ${APP_VERSION}`);
    return 0;
  }

  if (parsed.kind === "usage-error") {
    console.error(`${parsed.message}\n\n${HELP}`);
    return 2;
  }

  const logger = new ConsoleMarcProcessingLogger({
    verbose: parsed.logEnabled,
  });

  try {
    const convert =
      parsed.direction === "json-to-iso"
        ? convertMarcJsonFile
        : convertMarcFile;
    await convert({
      encoding: parsed.encoding,
      inputPath: parsed.inputPath,
      outputPath: parsed.outputPath,
      logger,
    });

    return 0;
  } catch (error) {
    await logger.logFatalError(toError(error));
    return 1;
  }
}

type ParsedArguments =
  | { readonly kind: "help" }
  | { readonly kind: "version" }
  | { readonly kind: "usage-error"; readonly message: string }
  | {
      readonly kind: "convert";
      readonly encoding: string;
      readonly direction: ConversionDirection;
      readonly inputPath: string;
      readonly logEnabled: boolean;
      readonly outputPath: string;
    };

function parseArgs(args: readonly string[]): ParsedArguments {
  const positionalArguments: string[] = [];
  let logEnabled = false;
  let direction: ConversionDirection = "iso-to-json";

  for (const argument of args) {
    if (argument === "-h" || argument === "--help") {
      return { kind: "help" };
    }

    if (argument === "-v" || argument === "--version") {
      return { kind: "version" };
    }

    if (argument === "--log") {
      logEnabled = true;
      continue;
    }

    if (argument === "--to-json") {
      direction = "iso-to-json";
      continue;
    }

    if (argument === "--to-iso") {
      direction = "json-to-iso";
      continue;
    }

    if (argument.startsWith("-")) {
      return {
        kind: "usage-error",
        message: `Неизвестный параметр ${JSON.stringify(argument)}.`,
      };
    }

    positionalArguments.push(argument);
  }

  const [inputArgument, outputArgument, encoding = DEFAULT_ENCODING] =
    positionalArguments;

  if (!inputArgument || !outputArgument || positionalArguments.length > 3) {
    return {
      kind: "usage-error",
      message: "Требуются входной и выходной файлы.",
    };
  }

  if (!isSupportedEncoding(encoding, direction)) {
    return {
      kind: "usage-error",
      message: `Кодировка ${JSON.stringify(encoding)} не поддерживается.`,
    };
  }

  return {
    kind: "convert",
    encoding,
    direction,
    inputPath: resolve(inputArgument),
    logEnabled,
    outputPath: resolve(outputArgument),
  };
}

type ConversionDirection = "iso-to-json" | "json-to-iso";

function isSupportedEncoding(
  encoding: string,
  direction: ConversionDirection,
): boolean {
  if (direction === "json-to-iso" && !iconv.encodingExists(encoding)) {
    return false;
  }

  try {
    new TextDecoder(encoding);
    return true;
  } catch {
    return false;
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
