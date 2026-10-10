import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(ROOT, "src/manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

test("the minimum Chrome version is 120", () => {
  assert.equal(manifest.minimum_chrome_version, "120");
});

test("the extension is not localised: no default_locale and no _locales folder", () => {
  assert.equal(manifest.default_locale, undefined);
  assert.equal(existsSync(join(ROOT, "src/_locales")), false);
});

test("package.json and the manifest have the same version", () => {
  assert.equal(manifest.version, pkg.version);
});
