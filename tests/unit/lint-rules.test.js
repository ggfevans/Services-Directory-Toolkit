import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const eslint = new ESLint({ cwd: ROOT });

// Lints a snippet as if it were the file at filePath and returns the IDs of the rules it breaks.
const ruleIds = async (code, filePath = "src/src/inject/example.js") => {
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
