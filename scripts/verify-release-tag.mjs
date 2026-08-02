import { readFile } from "node:fs/promises";

const [tag] = process.argv.slice(2);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const expectedTag = `v${packageJson.version}`;

if (!tag) {
  console.error(
    "Использование: node scripts/verify-release-tag.mjs <git-тег>",
  );
  process.exitCode = 2;
} else if (tag !== expectedTag) {
  console.error(
    `Тег ${JSON.stringify(tag)} не совпадает с версией package.json. ` +
      `Ожидается ${JSON.stringify(expectedTag)}.`,
  );
  process.exitCode = 1;
} else {
  console.log(`Версия подтверждена: ${tag}.`);
}
