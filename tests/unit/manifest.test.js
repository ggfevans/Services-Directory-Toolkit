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

const LIB = "src/lib/";

test("every content-script group with scripts loads the same lib files first", () => {
  const groups = manifest.content_scripts.filter((group) => group.js);
  const libs = groups[0].js.filter((file) => file.startsWith(LIB));
  assert.ok(libs.length > 0, "no lib files");
  for (const [index, group] of groups.entries()) {
    assert.deepEqual(group.js.slice(0, libs.length), libs, `group ${index}`);
    assert.deepEqual(group.js.filter((file) => file.startsWith(LIB)), libs, `group ${index}`);
  }
});

test("the popup loads the lib files first, in the manifest's order", () => {
  const page = readFileSync(join(ROOT, "src/src/page_action/page_action.html"), "utf8");
  const scripts = [...page.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(([, src]) => src);
  const libs = manifest.content_scripts.find((group) => group.js).js
    .filter((file) => file.startsWith(LIB))
    .map((file) => `../lib/${file.slice(LIB.length)}`);
  assert.deepEqual(scripts.slice(0, libs.length), libs);
});

test("the toolbar button starts disabled, before the service worker runs (BG-1)", () => {
  assert.equal(manifest.action.default_state, "disabled");
});

test("the manifest declares no web-accessible resources (MAN-1, SEC-4, SET-8)", () => {
  assert.equal(Object.hasOwn(manifest, "web_accessible_resources"), false);
});
