import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const [binaryArgument, inputArgument = "fixture/nlm-catplus-20251201-1mb.mrc"] =
  process.argv.slice(2);

if (!binaryArgument) {
  console.error(
    "Использование: node scripts/smoke-test.mjs <бинарник> [MARC-файл]",
  );
  process.exitCode = 2;
} else {
  await smokeTest(resolve(binaryArgument), resolve(inputArgument));
}

async function smokeTest(binaryPath, inputPath) {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "marc-parser-smoke-"),
  );
  const outputPath = join(temporaryDirectory, "result");
  const jsonOutputPath = `${outputPath}.json`;

  try {
    const version = await run(binaryPath, ["--version"], false);
    assert.match(version.stdout, /^marc-parser \d+\.\d+\.\d+\s*$/);

    const conversion = await run(binaryPath, [
      inputPath,
      outputPath,
      "utf-8",
    ]);
    const records = (await readFile(jsonOutputPath, "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));

    assert.equal(records.length, 655, "Ожидалось 655 MARC-записей.");
    assert.match(conversion.stdout, /Обработано записей: 655/);

    console.log(
      `Smoke-тест пройден: ${basename(binaryPath)}, записей: ${records.length}.`,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function run(command, args, inheritStderr = true) {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];

  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));

  const exitCode = await new Promise((resolveExitCode, reject) => {
    child.once("error", reject);
    child.once("close", resolveExitCode);
  });
  const stdoutText = Buffer.concat(stdout).toString("utf8");
  const stderrText = Buffer.concat(stderr).toString("utf8");

  if (inheritStderr && stderrText.length > 0) {
    process.stderr.write(stderrText);
  }

  assert.equal(
    exitCode,
    0,
    `Команда ${basename(command)} завершилась с кодом ${exitCode}.\n${stderrText}`,
  );

  return { stderr: stderrText, stdout: stdoutText };
}
