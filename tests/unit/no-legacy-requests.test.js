// Every request goes through SDT.net (src/src/lib/net.js). No script keeps its own ajax copy or an
// IE-only branch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles } from "../../scripts/lib/extension-files.js";
import { SRC } from "./helpers/sdt.js";

const scripts = listFiles(SRC).filter((file) => file.endsWith(".js") && !file.startsWith("src/lib/"));

for (const [name, pattern] of [
  ["an ajax helper", /\bajax\s*=|\bfunction\s+ajax\b/],
  ["XMLHttpRequest", /XMLHttpRequest/],
  ["MSXML2", /MSXML2/],
  ["document.selection", /document\.selection/],
  ["createTextRange", /createTextRange/]
]) {
  test(`no script outside src/src/lib/ uses ${name}`, () => {
    const offenders = scripts.filter((file) => pattern.test(readFileSync(join(SRC, file), "utf8")));
    assert.deepEqual(offenders, []);
  });
}
