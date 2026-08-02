import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { APP_VERSION } from "../src/version.ts";

test("версия CLI совпадает с package.json", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.equal(APP_VERSION, packageJson.version);
});
