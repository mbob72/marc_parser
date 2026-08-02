import { resolve } from "node:path";
import { convertMarcFile } from "./marc-file-converter.js";
import { ConsoleMarcProcessingLogger } from "./marc-processing-logger.js";
import { APP_VERSION } from "./version.js";

const APP_NAME = "marc-parser";
const DEFAULT_ENCODING = "utf-8";

const HELP = [
  `Использование: ${APP_NAME} <входной-файл> <выходной-файл> [кодировка] [--log]`,
  "",
  "Параметры:",
  "  --log        Выводить результат валидации каждой записи.",
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
    await convertMarcFile({
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
      readonly inputPath: string;
      readonly logEnabled: boolean;
      readonly outputPath: string;
    };

function parseArgs(args: readonly string[]): ParsedArguments {
  const positionalArguments: string[] = [];
  let logEnabled = false;

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

  try {
    new TextDecoder(encoding);
  } catch {
    return {
      kind: "usage-error",
      message: `Кодировка ${JSON.stringify(encoding)} не поддерживается.`,
    };
  }

  return {
    kind: "convert",
    encoding,
    inputPath: resolve(inputArgument),
    logEnabled,
    outputPath: resolve(outputArgument),
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
