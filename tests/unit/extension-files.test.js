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

const withLib = (overrides) => ({
  ...FILES,
  "lib/dom.js": "globalThis.SDT ??= {};\nSDT.dom = {};\n",
  "lib/net.js": "globalThis.SDT ??= {};\nSDT.net = { get: () => SDT.dom };\n",
  // cs.js keeps its getURL call, so img/gear.svg stays referenced.
  "cs.js": "chrome.runtime.getURL(\"img/gear.svg\");\nSDT.dom.loadElement(\"b\");\n",
  ...overrides
});
const manifestWith = (js) => JSON.stringify({ ...MANIFEST, content_scripts: [{ matches: ["*://*/*"], js, css: ["cs.css"] }] });

test("a content script may use SDT once a lib file earlier in its group defines it", (t) => {
  const dir = makeExtension(t, withLib({ "manifest.json": manifestWith(["lib/dom.js", "lib/net.js", "cs.js"]) }));
  assert.deepEqual(referencedFiles(dir).problems, []);
});

test("reports a content script that uses SDT before the lib file that defines it", (t) => {
  const dir = makeExtension(t, withLib({ "manifest.json": manifestWith(["cs.js", "lib/dom.js", "lib/net.js"]) }));
  assert.deepEqual(referencedFiles(dir).problems, ["content_scripts[0]: cs.js uses SDT.dom before a script that defines it"]);
});

test("reports a lib file that uses a namespace a later lib file defines", (t) => {
  const dir = makeExtension(t, withLib({ "manifest.json": manifestWith(["lib/net.js", "lib/dom.js", "cs.js"]) }));
  assert.deepEqual(referencedFiles(dir).problems, ["content_scripts[0]: lib/net.js uses SDT.dom before a script that defines it"]);
});

test("reports an extension page that loads a script using SDT before the lib", (t) => {
  const page = "<script src=\"popup.js\"></script><script src=\"../lib/dom.js\"></script><link rel=\"stylesheet\" href=\"popup.css\">";
  const dir = makeExtension(t, withLib({
    "manifest.json": manifestWith(["lib/dom.js", "lib/net.js", "cs.js"]),
    "popup/popup.html": page,
    "popup/popup.js": "SDT.dom.loadElement(\"b\");\n"
  }));
  assert.deepEqual(referencedFiles(dir).problems, ["popup/popup.html: popup/popup.js uses SDT.dom before a script that defines it"]);
});

// A service worker at bg/bg.js, in place of bg.js, that loads lib/sender.js with importScripts, as
// src/src/bg/background.js does.
const withWorker = (worker) => {
  const files = withLib({ "lib/sender.js": "globalThis.SDT ??= {};\nSDT.sender = {};\n" });
  delete files["bg.js"];
  return {
    ...files,
    "manifest.json": JSON.stringify({ ...JSON.parse(manifestWith(["lib/dom.js", "lib/net.js", "cs.js"])), background: { service_worker: "bg/bg.js" } }),
    "bg/bg.js": worker
  };
};

test("files the service worker loads with importScripts count as referenced", (t) => {
  const dir = makeExtension(t, withWorker("importScripts(\"../lib/sender.js\");\n{\n  SDT.sender.accepts();\n}\n"));
  const { files, problems } = referencedFiles(dir);
  assert.deepEqual(problems, []);
  assert.ok(files.includes("lib/sender.js"), files.join("\n"));
});

test("an importScripts path that starts with / resolves against the extension root", (t) => {
  const dir = makeExtension(t, withWorker("importScripts(\"/lib/sender.js\");\nSDT.sender.accepts();\n"));
  assert.deepEqual(referencedFiles(dir).problems, []);
});

test("reports a file the service worker imports that does not exist", (t) => {
  const dir = makeExtension(t, withWorker("importScripts(\"../lib/sender.js\", \"../lib/missing.js\");\nSDT.sender.accepts();\n"));
  assert.deepEqual(referencedFiles(dir).problems, ["bg/bg.js references missing file lib/missing.js"]);
});

test("reports an importScripts argument that is not a string literal", (t) => {
  const dir = makeExtension(t, withWorker("importScripts(\"../lib/sender.js\", base + \"x.js\");\nSDT.sender.accepts();\n"));
  assert.deepEqual(referencedFiles(dir).problems, ["bg/bg.js: importScripts needs string literals, got \"base + \"x.js\"\""]);
});

test("reports a service worker that uses SDT before importing the file that defines it", (t) => {
  const dir = makeExtension(t, withWorker("importScripts(\"../lib/sender.js\");\nSDT.dom.loadElement(\"b\");\n"));
  assert.deepEqual(referencedFiles(dir).problems, ["background.service_worker: bg/bg.js uses SDT.dom before a script that defines it"]);
});

test("reports web_accessible_resources, which let any page detect the extension (MAN-1)", (t) => {
  const manifest = { ...MANIFEST, web_accessible_resources: [{ resources: ["img/*"], matches: ["*://*/*"] }] };
  const dir = makeExtension(t, { ...FILES, "manifest.json": JSON.stringify(manifest) });
  assert.deepEqual(referencedFiles(dir).problems, [
    "web_accessible_resources: not allowed, because any page could load these files and detect the extension (MAN-1)"
  ]);
});
