import { resolve } from "node:path";
import { convertMarcFile } from "./marc-file-converter.js";
import { ConsoleMarcProcessingLogger } from "./marc-processing-logger.js";

const DEFAULT_ENCODING = "utf-8";

const { encoding, inputPath, logEnabled, outputPath } = parseArgs();
const logger = new ConsoleMarcProcessingLogger({ verbose: logEnabled });

try {
  await convertMarcFile({
    encoding,
    inputPath,
    outputPath,
    logger,
  });
} catch (error) {
  await logger.logFatalError(toError(error));
  process.exitCode = 1;
}

interface Arguments {
  readonly encoding: string;
  readonly inputPath: string;
  readonly logEnabled: boolean;
  readonly outputPath: string;
}

function parseArgs(): Arguments {
  const positionalArguments: string[] = [];
  let logEnabled = false;

  for (const argument of process.argv.slice(2)) {
    if (argument === "--log") {
      logEnabled = true;
      continue;
    }

    if (argument.startsWith("--")) {
      exitWithUsage(`Неизвестный параметр ${JSON.stringify(argument)}.`);
    }

    positionalArguments.push(argument);
  }

  const [inputArgument, outputArgument, encoding = DEFAULT_ENCODING] =
    positionalArguments;

  if (
    !inputArgument ||
    !outputArgument ||
    positionalArguments.length > 3
  ) {
    exitWithUsage();
  }

  validateEncoding(encoding);

  return {
    encoding,
    inputPath: resolve(inputArgument),
    logEnabled,
    outputPath: resolve(outputArgument),
  };
}

function validateEncoding(encoding: string): void {
  try {
    new TextDecoder(encoding);
  } catch {
    exitWithUsage(
      `Кодировка ${JSON.stringify(encoding)} не поддерживается.`,
    );
  }
}

function exitWithUsage(message?: string): never {
  if (message) {
    console.error(message);
  }

  console.error(
    "Использование: node dist/copy-file.js " +
      "<входной-файл> <выходной-файл> [кодировка] [--log]",
  );
  process.exit(1);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
