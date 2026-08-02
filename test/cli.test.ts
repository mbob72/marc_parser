import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { APP_VERSION } from "../src/version.ts";

const projectDirectory = fileURLToPath(new URL("..", import.meta.url));

test("--help выводит справку и завершается успешно", async () => {
  const result = await runCli("--help");

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Использование: marc-parser/);
  assert.equal(result.stderr, "");
});

test("--version выводит версию и завершается успешно", async () => {
  const result = await runCli("--version");

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), `marc-parser ${APP_VERSION}`);
  assert.equal(result.stderr, "");
});

test("ошибка аргументов завершается с кодом 2", async () => {
  const result = await runCli();

  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Требуются входной и выходной файлы/);
});

interface CliResult {
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

async function runCli(...args: readonly string[]): Promise<CliResult> {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", ...args],
    {
      cwd: projectDirectory,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];

  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });

  return {
    exitCode,
    stderr: Buffer.concat(stderr).toString("utf8"),
    stdout: Buffer.concat(stdout).toString("utf8"),
  };
}
