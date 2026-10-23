// scripts/check-contrast.js passes on the shipped tokens and fails when one is changed to a failing value.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(ROOT, "scripts/check-contrast.js");
const CSS = readFileSync(join(ROOT, "src/src/lib/sdt.css"), "utf8");

const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

/** Runs the script on a copy of sdt.css with one replacement, which must occur exactly once. */
const runOnCopy = (t, from, to) => {
  assert.equal(CSS.split(from).length, 2, `"${from}" occurs once in sdt.css`);
  const dir = mkdtempSync(join(tmpdir(), "sdt-contrast-"));
  t.after(() => rmSync(dir, { recursive: true }));
  const file = join(dir, "sdt.css");
  writeFileSync(file, CSS.replace(from, to));
  return run(file, "--quiet");
};

test("the shipped tokens pass: 116 checks, none failing", () => {
  const result = run("--quiet");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^116 checks, 0 failures\.$/m);
});

test("a light token changed to a failing value fails the check", (t) => {
  const result = runOnCopy(t, "--sdt-fg-muted: #4f5a59;", "--sdt-fg-muted: #9aa5a4;");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^FAIL light: fg-muted on bg is \d\.\d\d:1, needs 4\.5:1/m);
  assert.doesNotMatch(result.stderr, /FAIL dark/);
});

test("a dark token changed to a failing value fails the check", (t) => {
  // The first dark block is the one the script reads: :root[data-sdt-theme="dark"].
  const result = runOnCopy(t, "--sdt-accent: #4fc3b8;\n  --sdt-accent-hover", "--sdt-accent: #2a6b66;\n  --sdt-accent-hover");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^FAIL dark: accent on bg is \d\.\d\d:1, needs 4\.5:1/m);
});

test("a missing colour token fails the check", (t) => {
  const result = runOnCopy(t, "  --sdt-focus: #1a5fb4;\n", "");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^FAIL light: no --sdt-focus colour token/m);
});
