import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const bunPackageJsonPath = require.resolve("bun/package.json");
const bunPackageJson = JSON.parse(
  await readFile(bunPackageJsonPath, "utf8"),
);
const bunExecutable = resolveBunExecutable(
  bunPackageJsonPath,
  bunPackageJson,
);
const options = parseArgs(process.argv.slice(2));
const bunArguments = [
  "build",
  "src/cli.ts",
  "--compile",
  `--outfile=${options.outfile}`,
];

if (options.target) {
  bunArguments.push(`--target=${options.target}`);
}

const exitCode = await run(bunExecutable, bunArguments);
process.exitCode = exitCode;

function resolveBunExecutable(packageJsonPath, packageJson) {
  const relativeExecutable = packageJson.bin?.bun;

  if (typeof relativeExecutable !== "string") {
    throw new Error("Пакет bun не объявляет исполняемый файл bin.bun.");
  }

  return resolve(dirname(packageJsonPath), relativeExecutable);
}

function parseArgs(args) {
  let outfile = "release/marc-parser";
  let target;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--outfile") {
      outfile = requireValue(args, ++index, "--outfile");
      continue;
    }

    if (argument?.startsWith("--outfile=")) {
      outfile = argument.slice("--outfile=".length);
      continue;
    }

    if (argument === "--target") {
      target = requireValue(args, ++index, "--target");
      continue;
    }

    if (argument?.startsWith("--target=")) {
      target = argument.slice("--target=".length);
      continue;
    }

    throw new Error(`Неизвестный параметр сборки: ${argument}`);
  }

  return { outfile: resolve(outfile), target };
}

function requireValue(args, index, option) {
  const value = args[index];

  if (!value) {
    throw new Error(`Для ${option} требуется значение.`);
  }

  return value;
}

async function run(command, args) {
  const child = spawn(command, args, { stdio: "inherit" });

  return await new Promise((resolveExitCode, reject) => {
    child.once("error", (error) => {
      reject(
        new Error(
          `Не удалось запустить ${basename(command)}: ${error.message}`,
        ),
      );
    });
    child.once("close", resolveExitCode);
  });
}
