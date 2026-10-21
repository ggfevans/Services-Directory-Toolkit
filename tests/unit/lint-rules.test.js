import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const eslint = new ESLint({ cwd: ROOT });

// Lints a snippet as if it were the file at filePath and returns the IDs of the rules it breaks.
const ruleIds = async (code, filePath = "src/src/example.js") => {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((message) => message.ruleId);
};

test("assigning innerHTML or outerHTML in extension code is an error", async () => {
  assert.deepEqual(await ruleIds("document.body.innerHTML = \"<b>x</b>\";\n"), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("document.body.outerHTML += \"x\";\n"), ["no-restricted-syntax"]);
});

test("reading innerHTML is allowed", async () => {
  assert.deepEqual(await ruleIds("console.log(\"%s\", document.body.innerHTML);\n"), []);
});

test("a console call whose first argument is not a string literal is an error in extension code", async () => {
  assert.deepEqual(await ruleIds("console.warn(location.href, 1);\n"), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("console.log(\"from: \" + location.href);\n"), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("console.error(`from ${location.href}`);\n"), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("console[\"info\"](new Error(\"x\"));\n"), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("window.console.log(location.href);\n"), ["no-restricted-syntax"]);
});

test("a console call that starts with a string literal is allowed", async () => {
  assert.deepEqual(await ruleIds("console.warn(\"could not parse %s\", location.href);\n"), []);
  assert.deepEqual(await ruleIds("console.log();\n"), []);
  assert.deepEqual(await ruleIds("window.console.log(\"from %s\", location.href);\n"), []);
});

test("the console rule does not apply outside src/", async () => {
  assert.deepEqual(await ruleIds("console.log(location.href);\n", "tests/e2e/example.js"), []);
});

test("insertAdjacentHTML and document.write are errors in extension code", async () => {
  assert.deepEqual(await ruleIds("document.body.insertAdjacentHTML(\"beforeend\", \"x\");\n"), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("document.write(\"x\");\n"), ["no-restricted-syntax"]);
});

test("computed access with a string key is caught too", async () => {
  assert.deepEqual(await ruleIds("document.body[\"innerHTML\"] = \"x\";\n"), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("document.body[\"outerHTML\"] += \"x\";\n"), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("document.body[\"insertAdjacentHTML\"](\"beforeend\", \"x\");\n"), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("document[\"write\"](\"x\");\n"), ["no-restricted-syntax"]);
});

test("the HTML-string rules do not apply outside src/", async () => {
  assert.deepEqual(await ruleIds("document.body.innerHTML = \"x\";\n", "tests/e2e/example.js"), []);
});

test("Playwright output and the unzipped build are not linted", async () => {
  for (const dir of ["playwright-report", "test-results", "blob-report", "dist"]) {
    assert.equal(await eslint.isPathIgnored(`${dir}/trace/index.js`), true, dir);
  }
});

test("Playwright fixtures in tests/ may take an empty object pattern", async () => {
  assert.deepEqual(await ruleIds("export const f = async ({}, use) => use(1);\n", "tests/e2e/example.js"), []);
});

const INJECT = "src/src/inject/example.js";

test("a content script or popup script is one bare block", async () => {
  assert.deepEqual(await ruleIds("console.log(\"x\");\n", INJECT), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("console.log(\"x\");\n", "src/src/page_action/example.js"), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("{\n  console.log(\"x\");\n}\n", INJECT), []);
});

test("content scripts add listeners and timers through SDT.guard", async () => {
  assert.deepEqual(await ruleIds("{\n  window.addEventListener(\"load\", () => {});\n}\n", INJECT), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("{\n  SDT.guard.listen(window, \"load\", () => {});\n}\n", INJECT), []);
  assert.deepEqual(await ruleIds("{\n  setTimeout(() => {}, 1);\n}\n", INJECT), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("{\n  setTimeout(SDT.guard.wrap(() => {}), 1);\n}\n", INJECT), []);
  assert.deepEqual(await ruleIds("{\n  window.setTimeout(() => {}, 1);\n}\n", INJECT), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("{\n  setTimeout(SDT.dom.wrap(() => {}), 1);\n}\n", INJECT), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("{\n  window.setTimeout(SDT.guard.wrap(() => {}), 1);\n}\n", INJECT), []);
});

test("content scripts wrap chrome callbacks in SDT.guard.wrap", async () => {
  assert.deepEqual(await ruleIds("{\n  chrome.storage.sync.get({ a: 1 }, (items) => items);\n}\n", INJECT), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("{\n  chrome.storage.sync.get({ a: 1 }, SDT.guard.wrap((items) => items));\n}\n", INJECT), []);
});

test("content scripts still get the base rules", async () => {
  assert.deepEqual(await ruleIds("{\n  document.body.innerHTML = \"x\";\n}\n", INJECT), ["no-restricted-syntax"]);
});

test("a lib file declares no top-level names", async () => {
  const LIB = "src/src/lib/example.js";
  assert.deepEqual(await ruleIds("const a = 1;\nSDT.a = a;\n", LIB), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("function f() {}\nf();\n", LIB), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("class A {}\nSDT.a = new A();\n", LIB), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("globalThis.SDT ??= {};\nSDT.example = { a: 1 };\n", LIB), []);
});
test("scripts send requests through SDT.net, not fetch or XMLHttpRequest", async () => {
  assert.deepEqual(await ruleIds("{\n  fetch(\"/x\");\n}\n", INJECT), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("{\n  fetch(\"/x\");\n}\n", "src/src/page_action/example.js"), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("{\n  new XMLHttpRequest();\n}\n", INJECT), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("{\n  window.fetch(\"/x\");\n}\n", INJECT), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("{\n  new window.XMLHttpRequest();\n}\n", "src/src/page_action/example.js"), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("{\n  SDT.net.fetchJson(\"/x\");\n}\n", INJECT), []);
});

test("content scripts use await, not inline promise callbacks", async () => {
  assert.deepEqual(await ruleIds("{\n  SDT.net.fetchJson(\"/x\").then((r) => r);\n}\n", INJECT), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("{\n  SDT.net.fetchJson(\"/x\").catch(function () {});\n}\n", INJECT), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("{\n  SDT.guard.run(async () => {\n    await SDT.net.fetchJson(\"/x\");\n  });\n}\n", INJECT), []);
});

test("content scripts never write to chrome.storage (spec section 4.4)", async () => {
  for (const call of [
    "chrome.storage.sync.set({ a: 1 })",
    "chrome.storage.local.remove(\"a\")",
    "chrome.storage.session.clear()",
    "chrome.storage.sync[\"set\"]({ a: 1 })",
    "globalThis.chrome.storage.local.set({ a: 1 })"
  ]) {
    assert.deepEqual(await ruleIds(`{\n  ${call};\n}\n`, INJECT), ["no-restricted-syntax"], call);
  }
  assert.deepEqual(await ruleIds("{\n  chrome.storage.sync.get({ a: 1 }, SDT.guard.wrap((items) => items));\n}\n", INJECT), []);
});

test("the options page may write to chrome.storage", async () => {
  assert.deepEqual(await ruleIds("chrome.storage.sync.set({ a: 1 });\n", "src/src/options/example.js"), []);
});
