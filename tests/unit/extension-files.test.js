import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listFiles, referencedFiles } from "../../scripts/lib/extension-files.js";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

const MANIFEST = {
  manifest_version: 3,
  name: "Test",
  version: "1.0.0",
  icons: { 16: "icons/16.png" },
  action: { default_icon: "icons/16.png", default_popup: "popup/popup.html" },
  background: { service_worker: "bg.js" },
  content_scripts: [{ matches: ["*://*/*"], js: ["cs.js"], css: ["cs.css"] }]
};

const FILES = {
  "manifest.json": JSON.stringify(MANIFEST),
  "icons/16.png": "png",
  "popup/popup.html": "<link rel=\"stylesheet\" href=\"popup.css\"><script src=\"popup.js\"></script>",
  "popup/popup.css": "",
  "popup/popup.js": "",
  "bg.js": "",
  "cs.js": "chrome.runtime.getURL(\"img/gear.svg\");",
  "cs.css": "",
  "img/gear.svg": "<svg/>"
};

// Writes a throwaway extension from a { relativePath: contents } map and returns its directory.
const makeExtension = (t, files) => {
  const dir = mkdtempSync(join(tmpdir(), "sdt-ext-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), contents);
  }
  return dir;
};

test("collects files from the manifest, extension pages and literal getURL calls", (t) => {
  const { files, problems } = referencedFiles(makeExtension(t, FILES));
  assert.deepEqual(problems, []);
  assert.deepEqual(files, [
    "bg.js", "cs.css", "cs.js", "icons/16.png", "img/gear.svg", "manifest.json",
    "popup/popup.css", "popup/popup.html", "popup/popup.js"
  ]);
});

test("reports a referenced file that does not exist", (t) => {
  const dir = makeExtension(t, { ...FILES, "cs.js": "chrome.runtime.getURL(\"img/missing.svg\");" });
  const { problems } = referencedFiles(dir);
  assert.ok(problems.some((p) => p.includes("missing file img/missing.svg")), problems.join("\n"));
});

test("reports a file that nothing references", (t) => {
  const { problems } = referencedFiles(makeExtension(t, { ...FILES, "notes.txt": "x" }));
  assert.deepEqual(problems, ["notes.txt: not referenced by the manifest, an extension page or a chrome.runtime.getURL call"]);
});

test("an image an extension page shows counts as referenced", (t) => {
  const page = `${FILES["popup/popup.html"]}<img alt="" src="logo.png">`;
  const { files, problems } = referencedFiles(makeExtension(t, { ...FILES, "popup/popup.html": page, "popup/logo.png": "png" }));
  assert.deepEqual(problems, []);
  assert.ok(files.includes("popup/logo.png"), files.join("\n"));
});

test("reports a getURL call whose argument is not a string literal", (t) => {
  const dir = makeExtension(t, { ...FILES, "cs.js": "chrome.runtime.getURL(base + \"gear.svg\");" });
  const { problems } = referencedFiles(dir);
  assert.ok(problems.some((p) => p.includes("needs a string literal")), problems.join("\n"));
});

test("includes the _locales folder only when the manifest sets default_locale", (t) => {
  const localised = { ...FILES, "_locales/en/messages.json": "{}" };
  localised["manifest.json"] = JSON.stringify({ ...MANIFEST, default_locale: "en" });
  assert.ok(referencedFiles(makeExtension(t, localised)).files.includes("_locales/en/messages.json"));
});

test("listFiles skips .DS_Store", (t) => {
  assert.deepEqual(listFiles(makeExtension(t, { "a.js": "", ".DS_Store": "", "sub/.DS_Store": "", "sub/b.js": "" })), ["a.js", "sub/b.js"]);
});

test("the extension in src/ references every file it contains, and none are missing", () => {
  assert.deepEqual(referencedFiles(SRC).problems, []);
});
