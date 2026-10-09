import { before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { referencedFiles } from "../../scripts/lib/extension-files.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const ZIP = join(ROOT, "build", `${pkg.name}-${pkg.version}.zip`);

before(() => {
  // Run from another directory to prove the script resolves paths from its own location.
  execFileSync(process.execPath, [join(ROOT, "scripts/build.js")], { cwd: tmpdir(), stdio: "pipe" });
});

test("the zip holds exactly the files the extension references, plus LICENSE", () => {
  const entries = execFileSync("unzip", ["-Z1", ZIP], { encoding: "utf8" }).trim().split("\n").sort();
  const expected = [...referencedFiles(join(ROOT, "src")).files, "LICENSE"].sort();
  assert.deepEqual(entries, expected);
});

test("the zipped LICENSE is the repository LICENSE", () => {
  const zipped = execFileSync("unzip", ["-p", ZIP, "LICENSE"], { encoding: "utf8" });
  assert.equal(zipped, readFileSync(join(ROOT, "LICENSE"), "utf8"));
});
