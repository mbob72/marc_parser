import { parseArgs } from "node:util";
import { mkdir, copyFile, cp } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Создаёт новый комплект ручной сборки по разрешённому списку, без .env и выгрузок.
 * DOC-PREVIEW:/docs/documents-deployment.md#manual-build
 */
const { values } = parseArgs({ options: { output: { type: "string" } } });
if (!values.output) throw Error("--output required");
const root = fileURLToPath(new URL("..", import.meta.url));
const output = resolve(values.output);
await mkdir(output);
for (const name of [
  "Dockerfile",
  ".dockerignore",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
])
  await copyFile(join(root, name), join(output, name));
for (const name of ["src", "docker"])
  await cp(join(root, name), join(output, name), { recursive: true });
console.log(JSON.stringify({ output, containsSecrets: false }));
