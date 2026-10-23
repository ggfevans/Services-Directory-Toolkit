import { before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

test("the zip ships the shared stylesheet (#13)", () => {
  const entries = execFileSync("unzip", ["-Z1", ZIP], { encoding: "utf8" }).trim().split("\n");
  assert.ok(entries.includes("src/lib/sdt.css"));
});

test("the zipped LICENSE is the repository LICENSE", () => {
  const zipped = execFileSync("unzip", ["-p", ZIP, "LICENSE"], { encoding: "utf8" });
  assert.equal(zipped, readFileSync(join(ROOT, "LICENSE"), "utf8"));
});

test("the build fails and writes no zip when src/ has a file nothing references", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "sdt-build-"));
  t.after(() => rmSync(tmp, { recursive: true }));

  cpSync(join(ROOT, "scripts"), join(tmp, "scripts"), { recursive: true });
  cpSync(join(ROOT, "src"), join(tmp, "src"), { recursive: true });
  cpSync(join(ROOT, "package.json"), join(tmp, "package.json"));
  cpSync(join(ROOT, "LICENSE"), join(tmp, "LICENSE"));
  symlinkSync(join(ROOT, "node_modules"), join(tmp, "node_modules"), "dir");

  writeFileSync(join(tmp, "src", "stray.txt"), "unreferenced file");

  const result = spawnSync(process.execPath, [join(tmp, "scripts/build.js")], {
    cwd: tmpdir(),
    encoding: "utf8",
  });

  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /stray\.txt: not referenced/);
  assert.strictEqual(existsSync(join(tmp, "build", `${pkg.name}-${pkg.version}.zip`)), false);
});

test("the build fails when package.json and the manifest versions differ", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "sdt-build-"));
  t.after(() => rmSync(tmp, { recursive: true }));

  cpSync(join(ROOT, "scripts"), join(tmp, "scripts"), { recursive: true });
  cpSync(join(ROOT, "src"), join(tmp, "src"), { recursive: true });
  cpSync(join(ROOT, "LICENSE"), join(tmp, "LICENSE"));
  symlinkSync(join(ROOT, "node_modules"), join(tmp, "node_modules"), "dir");

  const modifiedPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  modifiedPkg.version = "0.0.0-mismatch";
  writeFileSync(join(tmp, "package.json"), JSON.stringify(modifiedPkg));

  const result = spawnSync(process.execPath, [join(tmp, "scripts/build.js")], {
    cwd: tmpdir(),
    encoding: "utf8",
  });

  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /Version mismatch/);
});

test("the build fails when a content-script group loads a script that uses SDT before the lib", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "sdt-build-"));
  t.after(() => rmSync(tmp, { recursive: true }));

  cpSync(join(ROOT, "scripts"), join(tmp, "scripts"), { recursive: true });
  cpSync(join(ROOT, "src"), join(tmp, "src"), { recursive: true });
  cpSync(join(ROOT, "package.json"), join(tmp, "package.json"));
  cpSync(join(ROOT, "LICENSE"), join(tmp, "LICENSE"));
  symlinkSync(join(ROOT, "node_modules"), join(tmp, "node_modules"), "dir");

  // Move the lib files to the end of inject.js's group.
  const manifestPath = join(tmp, "src", "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const group = manifest.content_scripts.find((entry) => entry.js?.includes("src/inject/inject.js"));
  group.js = [...group.js.filter((file) => !file.startsWith("src/lib/")), ...group.js.filter((file) => file.startsWith("src/lib/"))];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const result = spawnSync(process.execPath, [join(tmp, "scripts/build.js")], { cwd: tmpdir(), encoding: "utf8" });

  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /content_scripts\[\d\]: src\/inject\/inject\.js uses SDT\.dom before a script that defines it/);
  assert.strictEqual(existsSync(join(tmp, "build", `${pkg.name}-${pkg.version}.zip`)), false);
});

test("the zipped manifest declares no web-accessible resources (MAN-1, SEC-4, SET-8)", () => {
  const zipped = JSON.parse(execFileSync("unzip", ["-p", ZIP, "manifest.json"], { encoding: "utf8" }));
  assert.equal(Object.hasOwn(zipped, "web_accessible_resources"), false);
});

test("the build fails when the manifest declares web-accessible resources", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "sdt-build-"));
  t.after(() => rmSync(tmp, { recursive: true }));

  cpSync(join(ROOT, "scripts"), join(tmp, "scripts"), { recursive: true });
  cpSync(join(ROOT, "src"), join(tmp, "src"), { recursive: true });
  cpSync(join(ROOT, "package.json"), join(tmp, "package.json"));
  cpSync(join(ROOT, "LICENSE"), join(tmp, "LICENSE"));
  symlinkSync(join(ROOT, "node_modules"), join(tmp, "node_modules"), "dir");

  const manifestPath = join(tmp, "src", "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.web_accessible_resources = [{ resources: ["icons/*"], matches: ["*://*/*"] }];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const result = spawnSync(process.execPath, [join(tmp, "scripts/build.js")], { cwd: tmpdir(), encoding: "utf8" });

  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /web_accessible_resources: not allowed/);
  assert.strictEqual(existsSync(join(tmp, "build", `${pkg.name}-${pkg.version}.zip`)), false);
});
