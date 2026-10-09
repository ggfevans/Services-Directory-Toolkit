# Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic test harness, CI, stricter lint and a checked build, without changing what the extension does.

**Architecture:**
- Node's built-in test runner covers tooling and pure helpers.
- Playwright drives headless Chromium with the unpacked extension loaded. A fake ArcGIS Server, written as a plain function in `tests/fixtures/`, answers every request to `https://arcgis.test` through Playwright routing. Requests to any other host fail the test.
- The build zips only the files the extension references, using a file walker it shares with a unit test.

**Tech stack:**
- Node 24 (`^22.13.0 || >=24`), ESLint 10 flat config, `node --test`
- `@playwright/test` 1.64.0, pinned exactly, with Chromium from `npx playwright install --no-shell chromium`
- archiver 8
- GitHub Actions: `actions/checkout@v7`, `actions/setup-node@v7`, `actions/upload-artifact@v7`

**Spec:** `docs/superpowers/specs/2026-10-09-store-readiness-design.md` (section 6, Phase 1; requirements in section 4). Read both before starting.

## Global Constraints

- **Node:** `engines` is `^22.13.0 || >=24`, and `.nvmrc` contains `24`.
- **Chrome:** `minimum_chrome_version` is `"120"`.
- **Playwright:**
  - `@playwright/test` is pinned to exactly `1.64.0`.
  - Browser tests launch with `channel: "chromium"`, never Playwright's default headless shell, which cannot load extensions.
- **No behaviour change.** Phase 1 changes no extension behaviour. The only edits under `src/` are deleting unused files, `minimum_chrome_version`, and removing `default_locale`.
- **Test data is synthetic.** Never commit HTML or JSON captured from sampleserver6 or any Esri server.
- **Fake server:** origin `https://arcgis.test`, REST root `/arcgis/rest/services`.
- **Code style:**
  - 2-space indent, double quotes, semicolons.
  - Template literals only where they interpolate or span lines.
  - `npm run lint` runs with `--max-warnings=0`.
  - If lint flags only formatting in code copied from this plan, run `npx eslint --fix <file>`. Don't change the logic to satisfy it.
- **No HTML strings in extension code:** no `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write` under `src/`.
- **Commit messages:** imperative subject, plain-English body. End each with:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
- **Live check stays out of CI:** `tests/live/smoke.js` never runs in CI.

## Review Focus

The five failure modes most likely to let a broken test pass:

1. **A request to `https://arcgis.test` that no fixture answers.** The test must fail and name the URL; it must not pass on a 404. Pinned by a harness self-test in Task 5.
2. **A request to any other host.** The test must fail. Pinned in Task 5.
3. **An `alert`, `confirm` or `prompt`** from a page or the extension. The test must fail, because Playwright dismisses dialogs silently. Pinned in Task 5.
4. **An uncaught error or rejected promise in the service worker.** The test must fail. These reach no Playwright event by default. Pinned in Task 5.
5. **A known-bug test that fails in its setup, not on the bug.** It would hide a broken test until the fix phase. Task 8 adds `SHOW_KNOWN_BUGS=1` and a review step that records where each one fails.

---

### Task 1: Lint rules, Node version and Git ignores

**Files:**
- Create: `.nvmrc`
- Create: `tests/unit/lint-rules.test.js`
- Modify: `eslint.config.js` (whole file)
- Modify: `package.json` (`engines`, `scripts`)
- Modify: `.gitignore` (append)

**Interfaces:**
- Produces: `npm run lint` (warnings fail); `npm run test:unit`; `npm test` (unit tests only until Task 5).

- [ ] **Step 1: Write the failing lint tests**

Create `tests/unit/lint-rules.test.js`:

```js
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
  assert.deepEqual(await ruleIds("console.log(document.body.innerHTML);\n"), []);
});

test("insertAdjacentHTML and document.write are errors in extension code", async () => {
  assert.deepEqual(await ruleIds("document.body.insertAdjacentHTML(\"beforeend\", \"x\");\n"), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("document.write(\"x\");\n"), ["no-restricted-syntax"]);
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
```

- [ ] **Step 2: Add the `test:unit` script and run the tests to see them fail**

In `package.json`, replace the `scripts` block with:

```json
  "scripts": {
    "lint": "eslint . --max-warnings=0",
    "build": "npm run lint && node scripts/build.js",
    "test": "npm run test:unit",
    "test:unit": "node --test \"tests/unit/**/*.test.js\"",
    "test:smoke": "node tests/smoke.js"
  },
```

Run: `npm run test:unit`

Expected: FAIL. The `innerHTML`, `insertAdjacentHTML`, ignore and empty-pattern tests fail, and "reading innerHTML is allowed" and "do not apply outside src/" pass.

- [ ] **Step 3: Replace `eslint.config.js`**

```js
import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";

// Extension code builds DOM with loadElement and text nodes. HTML strings would let server data
// become markup.
const NO_HTML_STRINGS = "Build DOM nodes with loadElement and text nodes; don't write HTML strings.";

export default [
  {
    ignores: ["build/", "dist/", "node_modules/", "test-results/", "playwright-report/", "blob-report/"]
  },
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.webextensions
      }
    },
    rules: {
      "no-restricted-syntax": ["error",
        { selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]", message: NO_HTML_STRINGS },
        { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: NO_HTML_STRINGS },
        { selector: "CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln)$/]", message: NO_HTML_STRINGS }
      ]
    }
  },
  {
    files: ["*.js", "scripts/**/*.js", "tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node
    }
  },
  {
    // Node scripts whose page.evaluate callbacks run in the browser or an extension page.
    files: ["tests/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions
      }
    },
    rules: {
      // Playwright fixtures that need no other fixture take an empty object pattern.
      "no-empty-pattern": ["error", { allowObjectPatternsAsParameters: true }]
    }
  },
  {
    plugins: {
      "@stylistic": stylistic
    },
    rules: {
      "@stylistic/indent": ["error", 2],
      "@stylistic/quotes": ["warn", "double"],
      "@stylistic/semi": ["error", "always"]
    }
  }
];
```

- [ ] **Step 4: Set the Node version and ignore Playwright output**

Create `.nvmrc` containing the single line `24`.

In `package.json`, set:

```json
  "engines": {
    "node": "^22.13.0 || >=24"
  },
```

Append to `.gitignore`:

```
# Playwright output
test-results/
playwright-report/
blob-report/
```

`dist` is already ignored.

- [ ] **Step 5: Run the tests and lint**

Run: `npm run test:unit && npm run lint`

Expected: all 6 tests pass, and lint exits 0 with no warnings.

- [ ] **Step 6: Commit**

```bash
git add .nvmrc .gitignore eslint.config.js package.json tests/unit/lint-rules.test.js
git commit -F - <<'EOF'
Fail lint on warnings and ban HTML strings in extension code

Lint now treats warnings as errors and rejects innerHTML/outerHTML
assignment, insertAdjacentHTML and document.write under src/. Playwright
output folders and dist/ are ignored, and fixtures may take empty object
patterns. Node engines move to ^22.13.0 || >=24 with an .nvmrc, and unit
tests run with node --test.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Extension file walker and manifest housekeeping

**Files:**
- Create: `scripts/lib/extension-files.js`
- Create: `tests/unit/extension-files.test.js`
- Create: `tests/unit/manifest.test.js`
- Modify: `src/manifest.json`. Set `minimum_chrome_version` to `"120"` and delete the `default_locale` line.
- Delete: `src/_locales/` (whole directory), `src/config/options.json` (the unused top-level copy), and `src/LICENSE`.

**Interfaces:**
- Produces:
  - `listFiles(dir: string): string[]`: sorted POSIX paths relative to `dir`, skipping `.DS_Store`.
  - `referencedFiles(extDir: string): { files: string[], problems: string[] }`. `files` is sorted and relative to `extDir`. `problems` is empty when the extension is consistent.

- [ ] **Step 1: Write the failing walker tests**

Create `tests/unit/extension-files.test.js`:

```js
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
```

- [ ] **Step 2: Write the failing manifest tests**

Create `tests/unit/manifest.test.js`:

```js
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
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npm run test:unit`

Expected: FAIL.
- `extension-files.test.js` can't import `scripts/lib/extension-files.js` (`ERR_MODULE_NOT_FOUND`).
- `manifest.test.js` fails on the minimum version and on `default_locale`.

- [ ] **Step 4: Implement the walker**

Create `scripts/lib/extension-files.js`:

```js
// Works out which files under an extension directory the extension actually uses, so the build
// ships exactly those and fails on anything missing or unexplained.
import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";

/** Lists every file under dir as a sorted POSIX path relative to dir, skipping .DS_Store. */
export const listFiles = (dir, prefix = "") => readdirSync(join(dir, prefix), { withFileTypes: true })
  .flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      return listFiles(dir, path);
    }
    return entry.name === ".DS_Store" ? [] : [path];
  })
  .sort();

// <script src> and <link href> in extension pages.
const HTML_REFERENCE = /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
const GET_URL_CALL = /chrome\.runtime\.getURL\(([^)]*)\)/g;
const STRING_LITERAL = /^\s*(["'`])([^"'`$]+)\1\s*$/;

const globToRegExp = (glob) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);

/**
 * Finds the files an extension uses:
 * - everything the manifest names
 * - everything its HTML pages load
 * - every path passed to chrome.runtime.getURL as a string literal
 * - the _locales folder, if default_locale is set
 *
 * Returns { files, problems }. Both use paths relative to extDir. problems lists missing files,
 * files nothing references, and getURL calls that can't be checked.
 */
export const referencedFiles = (extDir) => {
  const manifest = JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf8"));
  const existing = listFiles(extDir);
  const files = new Set(["manifest.json"]);
  const problems = [];

  const add = (path, source) => {
    const file = posix.normalize(path.replace(/^\//, ""));
    if (!existing.includes(file)) {
      problems.push(`${source} references missing file ${file}`);
    }
    files.add(file);
  };

  Object.values(manifest.icons || {}).forEach((path) => add(path, "manifest icons"));
  const defaultIcon = manifest.action?.default_icon;
  if (typeof defaultIcon === "string") {
    add(defaultIcon, "action.default_icon");
  } else {
    Object.values(defaultIcon || {}).forEach((path) => add(path, "action.default_icon"));
  }
  if (manifest.background?.service_worker) {
    add(manifest.background.service_worker, "background.service_worker");
  }
  for (const script of manifest.content_scripts || []) {
    [...(script.js || []), ...(script.css || [])].forEach((path) => add(path, "content_scripts"));
  }

  const pages = [manifest.options_page, manifest.options_ui?.page, manifest.action?.default_popup].filter(Boolean);
  for (const page of pages) {
    add(page, "manifest");
    if (!existing.includes(page)) {
      continue;
    }
    const html = readFileSync(join(extDir, page), "utf8");
    for (const [, reference] of html.matchAll(HTML_REFERENCE)) {
      if (!/^[a-z][a-z0-9+.-]*:/i.test(reference)) {
        add(posix.join(posix.dirname(page), reference), page);
      }
    }
  }

  for (const entry of manifest.web_accessible_resources || []) {
    for (const glob of entry.resources) {
      const matches = existing.filter((file) => globToRegExp(glob).test(file));
      if (!matches.length) {
        problems.push(`web_accessible_resources pattern ${glob} matches no files`);
      }
      matches.forEach((file) => files.add(file));
    }
  }

  if (manifest.default_locale) {
    existing.filter((file) => file.startsWith("_locales/")).forEach((file) => files.add(file));
  }

  for (const script of [...files].filter((file) => file.endsWith(".js") && existing.includes(file))) {
    const code = readFileSync(join(extDir, script), "utf8");
    for (const [, argument] of code.matchAll(GET_URL_CALL)) {
      const literal = argument.match(STRING_LITERAL);
      if (literal) {
        add(literal[2], script);
      } else {
        problems.push(`${script}: chrome.runtime.getURL needs a string literal, got "${argument.trim()}"`);
      }
    }
  }

  for (const file of existing) {
    if (!files.has(file)) {
      problems.push(`${file}: not referenced by the manifest, an extension page or a chrome.runtime.getURL call`);
    }
  }

  return { files: [...files].sort(), problems };
};
```

- [ ] **Step 5: Run the tests**

Run: `npm run test:unit`

Expected: the walker tests on temporary extensions pass. Still FAIL:
- "the extension in src/ references every file it contains" reports `LICENSE` and `config/options.json` as not referenced. `_locales` is still allowed while `default_locale` is set.
- The two manifest tests.

- [ ] **Step 6: Do the housekeeping**

Run:

```bash
git rm -r -q src/_locales src/config/options.json src/LICENSE
```

In `src/manifest.json`:
- change `"minimum_chrome_version": "93",` to `"minimum_chrome_version": "120",`
- delete the line `"default_locale": "en",`

Nothing reads `chrome.i18n` or `__MSG_` strings. The build adds the root `LICENSE` to the zip in Task 3.

- [ ] **Step 7: Run the tests and lint**

Run: `npm run test:unit && npm run lint`

Expected: all tests pass, and lint is clean.

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/extension-files.js tests/unit/extension-files.test.js tests/unit/manifest.test.js src/manifest.json
git commit -F - <<'EOF'
List the files the extension uses, and drop unused ones

scripts/lib/extension-files.js works out which files the extension
needs from the manifest, its HTML pages and literal getURL calls, and
reports missing or unreferenced files. Using it on src/ removed the
extensionizr locale boilerplate (with default_locale), the divergent
copy of options.json and the duplicate LICENSE. The minimum Chrome
version is now 120.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Build only the referenced files

**Files:**
- Modify: `scripts/build.js` (whole file)
- Create: `tests/unit/build.test.js`

**Interfaces:**
- Consumes: `referencedFiles(extDir)` from Task 2.
- Produces: `node scripts/build.js` writes `build/<package name>-<version>.zip`. It works from any working directory, and it exits 1 on a version mismatch or any `problems`.

- [ ] **Step 1: Write the failing build test**

Create `tests/unit/build.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to see it fail**

Run: `node --test tests/unit/build.test.js`

Expected: FAIL. The current script reads `package.json` relative to the working directory, so it crashes with `ENOENT` when run from the temp directory.

- [ ] **Step 3: Replace `scripts/build.js`**

```js
// Packages the extension into build/<package name>-<version>.zip for the Chrome Web Store.
// Only files the extension references are zipped (see scripts/lib/extension-files.js), plus the
// repository LICENSE, which the MIT licence requires to ship with copies of the code.
import { createWriteStream, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ZipArchive } from "archiver";
import { referencedFiles } from "./lib/extension-files.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));

if (pkg.version !== manifest.version) {
  console.error(`Version mismatch: package.json is ${pkg.version}, src/manifest.json is ${manifest.version}`);
  process.exit(1);
}

const { files, problems } = referencedFiles(SRC);
if (problems.length) {
  console.error(`Build failed:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

mkdirSync(join(ROOT, "build"), { recursive: true });
const outFile = join(ROOT, "build", `${pkg.name}-${pkg.version}.zip`);
const output = createWriteStream(outFile);
const archive = new ZipArchive({ zlib: { level: 9 } });

const fail = (err) => {
  console.error(`Build failed: ${err.message}`);
  output.destroy();
  rmSync(outFile, { force: true });
  process.exit(1);
};

output.on("close", () => console.log(`Wrote ${relative(ROOT, outFile)} (${archive.pointer()} bytes)`));
// archiver reports skipped files (e.g. ENOENT) as warnings; treat them as failures so the zip is never incomplete.
archive.on("warning", fail);
archive.on("error", fail);

archive.pipe(output);
for (const file of files) {
  archive.file(join(SRC, file), { name: file });
}
archive.file(join(ROOT, "LICENSE"), { name: "LICENSE" });
archive.finalize();
```

- [ ] **Step 4: Run the tests and the build**

Run: `npm run test:unit && npm run build`

Expected:
- All unit tests pass.
- The build prints `Wrote build/services-directory-toolkit-2.0.0.zip (… bytes)`.
- `unzip -Z1 build/services-directory-toolkit-2.0.0.zip` lists no `_locales/`, `config/options.json` or `src/LICENSE`, and does list `LICENSE`.

- [ ] **Step 5: Commit**

```bash
git add scripts/build.js tests/unit/build.test.js
git commit -F - <<'EOF'
Zip only the files the extension references

The build now packages the files referencedFiles() finds plus the root
LICENSE, fails on missing or unreferenced files and non-literal getURL
calls, and resolves paths from the script so it works from any
directory.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Fake ArcGIS Server

**Files:**
- Create: `tests/fixtures/catalog.js`: the synthetic services, layers and rows
- Create: `tests/fixtures/pages.js`: HTML pages shaped like the Services Directory
- Create: `tests/fixtures/fake-arcgis.js`: the router
- Create: `tests/unit/fake-arcgis.test.js`

**Interfaces:**
- Produces, from `tests/fixtures/fake-arcgis.js`:
  - `FAKE_ORIGIN = "https://arcgis.test"`
  - `REST_ROOT = "https://arcgis.test/arcgis/rest/services"`
  - `whereMatcher(where: string): ((row) => boolean) | null`
  - `createFakeArcGIS(catalog?)` returns `{ requests: string[], problems: string[], override(pattern: RegExp, handler: (url: URL, params: URLSearchParams) => Response), respond(request): Response | null }`.
    - `request` is a Playwright `Request`, or any object with `url()`, `method()`, `headers()` and `postData()`.
    - `Response` is `{ status: number, contentType: string, body: string }`, which `route.fulfill` accepts as-is.
    - `requests` entries look like `"GET /arcgis/rest/services/Parcels/MapServer?f=json"`.
    - An override pattern is tested against `pathname + search` exactly as the browser sent them, still percent-encoded and with `+` for spaces.
- Produces, from `tests/fixtures/pages.js`: `REST_PATH = "/arcgis/rest/services"`.

The catalog contains:

| Path | Contents |
|---|---|
| root | folders `Transport` and `Utilities`; services `Parcels` (MapServer and FeatureServer) and `Elevation` (ImageServer) |
| `Parcels/MapServer`, `Parcels/FeatureServer` | layer 0 `Parcels` (6 fields, including coded-value domain `LAND_USE`, 3 rows) and layer 1 `Addresses` (4 fields, 2 rows) |
| `Transport/Roads/MapServer` | layer 0 `Roads 2019` |
| `Utilities/PrintingTools/GPServer` | task `Export Web Map Task`, with the standard print parameters `Web_Map_as_JSON`, `Format`, `Layout_Template` and `Output_File` |

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/fake-arcgis.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeArcGIS, FAKE_ORIGIN, whereMatcher } from "../fixtures/fake-arcgis.js";

// A stand-in for a Playwright Request.
const request = (path, { method = "GET", body } = {}) => ({
  url: () => `${FAKE_ORIGIN}${path}`,
  method: () => method,
  headers: () => (body === undefined ? {} : { "content-type": "application/x-www-form-urlencoded" }),
  postData: () => body ?? null
});

const get = (server, path) => server.respond(request(path));
const getJson = (server, path) => JSON.parse(get(server, path).body);

test("the root lists its folders and top-level services", () => {
  const root = getJson(createFakeArcGIS(), "/arcgis/rest/services?f=json");
  assert.deepEqual(root.folders, ["Transport", "Utilities"]);
  assert.deepEqual(root.services, [
    { name: "Parcels", type: "MapServer" },
    { name: "Parcels", type: "FeatureServer" },
    { name: "Elevation", type: "ImageServer" }
  ]);
});

test("a folder lists its services with folder-qualified names", () => {
  const folder = getJson(createFakeArcGIS(), "/arcgis/rest/services/Transport?f=json");
  assert.deepEqual(folder, { currentVersion: 11.3, folders: [], services: [{ name: "Transport/Roads", type: "MapServer" }] });
});

test("service and layer JSON leave out fixture-only data", () => {
  const server = createFakeArcGIS();
  const service = get(server, "/arcgis/rest/services/Parcels/MapServer?f=json");
  const layer = get(server, "/arcgis/rest/services/Parcels/MapServer/0?f=json");
  assert.equal(service.contentType, "application/json; charset=utf-8");
  assert.deepEqual(JSON.parse(service.body).layers.map((l) => l.name), ["Parcels", "Addresses"]);
  assert.equal(service.body.includes("_rows") || layer.body.includes("_rows"), false);
  assert.equal(JSON.parse(layer.body).fields.length, 6);
});

test("f=pjson is served as plain text, as ArcGIS Server does", () => {
  const response = get(createFakeArcGIS(), "/arcgis/rest/services/Parcels/MapServer/0?f=pjson");
  assert.equal(response.contentType, "text/plain; charset=utf-8");
  assert.equal(JSON.parse(response.body).name, "Parcels");
});

test("a layer page lists one Fields: item per field", () => {
  const html = get(createFakeArcGIS(), "/arcgis/rest/services/Parcels/MapServer/0").body;
  const fieldsList = html.split("<b>Fields: </b>")[1].split("</ul>")[0];
  assert.equal(fieldsList.match(/<li>/g).length, 6);
  assert.match(fieldsList, /OWNER_NAME<i>/);
});

test("count queries evaluate the where clauses the extension sends", () => {
  const server = createFakeArcGIS();
  const count = (where) => getJson(server, `/arcgis/rest/services/Parcels/MapServer/0/query?where=${encodeURIComponent(where)}&returnCountOnly=true&f=json`).count;
  assert.equal(count("1=1"), 3);
  assert.equal(count("not OBJECTID is null"), 3);
  assert.equal(count("not SHAPE is null"), 2);
  assert.equal(count("not OWNER_NAME is null"), 2);
  assert.equal(count("not OWNER_NAME is null and OWNER_NAME <>''"), 1);
  assert.equal(count("LAND_USE = 'R'"), 2);
  assert.equal(count("OBJECTID = 2"), 1);
});

test("+ in a query string decodes to a space, as browsers send it", () => {
  const server = createFakeArcGIS();
  const body = getJson(server, "/arcgis/rest/services/Parcels/MapServer/0/query?where=not+OBJECTID+is+null&returnCountOnly=true&f=json");
  assert.deepEqual(body, { count: 3 });
});

test("distinct-value queries return each value once, in a stable order", () => {
  const server = createFakeArcGIS();
  const body = getJson(server, "/arcgis/rest/services/Parcels/MapServer/0/query?where=1%3D1&outFields=LAND_USE&orderByFields=LAND_USE&returnDistinctValues=true&f=json");
  assert.deepEqual(body.features, [{ attributes: { LAND_USE: "C" } }, { attributes: { LAND_USE: "R" } }]);
  assert.deepEqual(body.fields.map((f) => f.name), ["LAND_USE"]);
});

test("an unsupported where clause returns an ArcGIS error and is recorded as a problem", () => {
  const server = createFakeArcGIS();
  const body = getJson(server, "/arcgis/rest/services/Parcels/MapServer/0/query?where=ACRES%20%3E%201&f=json");
  assert.equal(body.error.code, 400);
  assert.equal(server.problems.length, 1);
  assert.match(server.problems[0], /ACRES > 1/);
});

test("the print task and its execute page", () => {
  const server = createFakeArcGIS();
  const task = getJson(server, "/arcgis/rest/services/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task?f=json");
  assert.deepEqual(task.parameters.map((p) => p.name), ["Web_Map_as_JSON", "Format", "Layout_Template", "Output_File"]);
  const page = get(server, "/arcgis/rest/services/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/execute").body;
  assert.match(page, /<textarea id="Web_Map_as_JSON" name="Web_Map_as_JSON"/);
  assert.equal(page.includes("name=\"Output_File\""), false);
});

test("static assets, the non-REST page and unknown paths", () => {
  const server = createFakeArcGIS();
  assert.equal(get(server, "/arcgis/rest/static/main.css").status, 200);
  assert.equal(get(server, "/favicon.ico").status, 204);
  assert.match(get(server, "/other/page").body, /not a Services Directory/i);
  assert.equal(get(server, "/arcgis/rest/services/NoSuchService/MapServer"), null);
  assert.equal(get(server, "/arcgis/rest/services/Parcels/MapServer/9"), null);
  assert.equal(get(server, "/somewhere/else"), null);
});

test("overrides take precedence, and every request is recorded", () => {
  const server = createFakeArcGIS();
  server.override(/\/Transport\?f=json$/, () => ({ status: 502, contentType: "text/html", body: "Bad Gateway" }));
  assert.equal(get(server, "/arcgis/rest/services/Transport?f=json").status, 502);
  assert.deepEqual(server.requests, ["GET /arcgis/rest/services/Transport?f=json"]);
});

test("form posts are read like query strings", () => {
  const server = createFakeArcGIS();
  const response = server.respond(request("/arcgis/rest/services/Parcels/MapServer/0/query", { method: "POST", body: "where=1%3D1&returnCountOnly=true&f=json" }));
  assert.deepEqual(JSON.parse(response.body), { count: 3 });
});

test("whereMatcher returns null for clauses it does not support", () => {
  assert.equal(whereMatcher("ACRES > 1"), null);
  assert.equal(whereMatcher(" 1 = 1 ")({}), true);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/unit/fake-arcgis.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `tests/fixtures/fake-arcgis.js`.

- [ ] **Step 3: Write the catalog**

Create `tests/fixtures/catalog.js`:

```js
// Synthetic ArcGIS Server content for the browser tests. Every name and value is invented; the
// shapes follow the ArcGIS REST API so the extension sees what a real server would send.
// Don't paste responses captured from a real server into this file: Esri's terms don't allow
// redistributing them.
//
// Keys that start with "_" are fixture data the fake server uses but never sends.

const WEB_MERCATOR = { wkid: 102100, latestWkid: 3857 };
const EXTENT = { xmin: -13660000, ymin: 5700000, xmax: -13620000, ymax: 5730000, spatialReference: WEB_MERCATOR };
const GEOGRAPHIC_EXTENT = { xmin: -122.7, ymin: 45.4, xmax: -122.3, ymax: 45.7, spatialReference: { wkid: 4326, latestWkid: 4326 } };

const layerDefaults = {
  description: "",
  copyrightText: "",
  defaultVisibility: true,
  parentLayerId: -1,
  subLayerIds: null,
  minScale: 0,
  maxScale: 0,
  type: "Feature Layer",
  extent: EXTENT,
  maxRecordCount: 1000,
  supportedQueryFormats: "JSON, geoJSON",
  supportsStatistics: true,
  supportsAdvancedQueries: true,
  advancedQueryCapabilities: { supportsStatistics: true, supportsOrderBy: true, supportsDistinct: true, supportsPagination: true }
};

const parcels = {
  ...layerDefaults,
  id: 0,
  name: "Parcels",
  geometryType: "esriGeometryPolygon",
  displayField: "OWNER_NAME",
  fields: [
    { name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID", domain: null },
    { name: "SHAPE", type: "esriFieldTypeGeometry", alias: "Shape", domain: null },
    { name: "PARCEL_ID", type: "esriFieldTypeString", alias: "Parcel ID", length: 20, domain: null },
    { name: "OWNER_NAME", type: "esriFieldTypeString", alias: "Owner", length: 50, domain: null },
    {
      name: "LAND_USE",
      type: "esriFieldTypeString",
      alias: "Land use",
      length: 2,
      domain: { type: "codedValue", name: "LandUse", codedValues: [{ name: "Residential", code: "R" }, { name: "Commercial", code: "C" }] }
    },
    { name: "ACRES", type: "esriFieldTypeDouble", alias: "Acres", domain: null }
  ],
  // SHAPE is true when the feature has a geometry and null when it doesn't.
  _rows: [
    { OBJECTID: 1, SHAPE: true, PARCEL_ID: "P-001", OWNER_NAME: "A. Example", LAND_USE: "R", ACRES: 0.25 },
    { OBJECTID: 2, SHAPE: true, PARCEL_ID: "P-002", OWNER_NAME: "", LAND_USE: "C", ACRES: 1.5 },
    { OBJECTID: 3, SHAPE: null, PARCEL_ID: "P-003", OWNER_NAME: null, LAND_USE: "R", ACRES: null }
  ]
};

const addresses = {
  ...layerDefaults,
  id: 1,
  name: "Addresses",
  geometryType: "esriGeometryPoint",
  displayField: "ADDRESS",
  fields: [
    { name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID", domain: null },
    { name: "SHAPE", type: "esriFieldTypeGeometry", alias: "Shape", domain: null },
    { name: "ADDRESS", type: "esriFieldTypeString", alias: "Address", length: 60, domain: null },
    { name: "PARCEL_ID", type: "esriFieldTypeString", alias: "Parcel ID", length: 20, domain: null }
  ],
  _rows: [
    { OBJECTID: 1, SHAPE: true, ADDRESS: "1 Example Street", PARCEL_ID: "P-001" },
    { OBJECTID: 2, SHAPE: true, ADDRESS: "2 Example Street", PARCEL_ID: "P-002" }
  ]
};

const roads = {
  ...layerDefaults,
  id: 0,
  name: "Roads 2019",
  geometryType: "esriGeometryPolyline",
  displayField: "ROAD_NAME",
  fields: [
    { name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID", domain: null },
    { name: "SHAPE", type: "esriFieldTypeGeometry", alias: "Shape", domain: null },
    { name: "ROAD_NAME", type: "esriFieldTypeString", alias: "Road name", length: 50, domain: null }
  ],
  _rows: [
    { OBJECTID: 1, SHAPE: true, ROAD_NAME: "Example Avenue" },
    { OBJECTID: 2, SHAPE: true, ROAD_NAME: "Sample Road" }
  ]
};

const exportWebMapTask = {
  name: "Export Web Map Task",
  json: {
    name: "ExportWebMapTask",
    displayName: "Export Web Map Task",
    description: "Prints a web map.",
    category: "",
    executionType: "esriExecutionTypeSynchronous",
    parameters: [
      { name: "Web_Map_as_JSON", dataType: "GPString", displayName: "Web Map as JSON", direction: "esriGPParameterDirectionInput", defaultValue: "", parameterType: "esriGPParameterTypeRequired" },
      { name: "Format", dataType: "GPString", displayName: "Format", direction: "esriGPParameterDirectionInput", defaultValue: "PDF", parameterType: "esriGPParameterTypeOptional", choiceList: ["PDF", "PNG32", "JPG"] },
      { name: "Layout_Template", dataType: "GPString", displayName: "Layout Template", direction: "esriGPParameterDirectionInput", defaultValue: "MAP_ONLY", parameterType: "esriGPParameterTypeOptional", choiceList: ["A4 Landscape", "A4 Portrait", "MAP_ONLY"] },
      { name: "Output_File", dataType: "GPDataFile", displayName: "Output File", direction: "esriGPParameterDirectionOutput", defaultValue: null, parameterType: "esriGPParameterTypeRequired" }
    ]
  }
};

const documentInfo = (title, keywords) => ({ Title: title, Author: "", Comments: "", Subject: "", Category: "", Keywords: keywords });

export const catalog = {
  currentVersion: 11.3,
  folders: ["Transport", "Utilities"],
  services: [
    {
      name: "Parcels",
      type: "MapServer",
      layers: [parcels, addresses],
      info: {
        serviceDescription: "Parcel boundaries and site addresses for an invented county.",
        mapName: "Parcels map",
        description: "",
        copyrightText: "Example County GIS",
        spatialReference: WEB_MERCATOR,
        singleFusedMapCache: false,
        initialExtent: EXTENT,
        fullExtent: EXTENT,
        units: "esriMeters",
        documentInfo: documentInfo("Parcels", "parcels,addresses"),
        capabilities: "Map,Query,Data",
        supportedQueryFormats: "JSON, geoJSON, PBF",
        maxRecordCount: 1000,
        maxImageHeight: 4096,
        maxImageWidth: 4096
      }
    },
    {
      name: "Parcels",
      type: "FeatureServer",
      layers: [parcels, addresses],
      info: {
        serviceDescription: "Editable parcel boundaries for an invented county.",
        description: "",
        copyrightText: "Example County GIS",
        hasVersionedData: false,
        supportsDisconnectedEditing: false,
        maxRecordCount: 1000,
        supportedQueryFormats: "JSON",
        capabilities: "Query",
        spatialReference: WEB_MERCATOR,
        initialExtent: EXTENT,
        fullExtent: EXTENT,
        allowGeometryUpdates: true,
        units: "esriMeters"
      }
    },
    {
      name: "Elevation",
      type: "ImageServer",
      info: {
        serviceDescription: "An invented elevation surface.",
        name: "Elevation",
        description: "",
        copyrightText: "",
        extent: GEOGRAPHIC_EXTENT,
        initialExtent: GEOGRAPHIC_EXTENT,
        fullExtent: GEOGRAPHIC_EXTENT,
        pixelSizeX: 0.0001,
        pixelSizeY: 0.0001,
        bandCount: 1,
        pixelType: "F32",
        spatialReference: { wkid: 4326, latestWkid: 4326 },
        fields: [],
        maxImageHeight: 4100,
        maxImageWidth: 15000,
        capabilities: "Image,Metadata"
      }
    },
    {
      name: "Transport/Roads",
      type: "MapServer",
      layers: [roads],
      info: {
        serviceDescription: "Road centrelines for an invented county.",
        mapName: "Roads",
        description: "",
        copyrightText: "",
        spatialReference: WEB_MERCATOR,
        singleFusedMapCache: true,
        initialExtent: EXTENT,
        fullExtent: EXTENT,
        units: "esriMeters",
        documentInfo: documentInfo("Roads", "roads"),
        capabilities: "Map,Query",
        supportedQueryFormats: "JSON",
        maxRecordCount: 2000
      }
    },
    {
      name: "Utilities/PrintingTools",
      type: "GPServer",
      tasks: [exportWebMapTask],
      info: {
        serviceDescription: "Prints web maps.",
        executionType: "esriExecutionTypeSynchronous",
        resultMapServerName: "",
        maximumRecords: 1000
      }
    }
  ]
};
```

- [ ] **Step 4: Write the page builders**

Create `tests/fixtures/pages.js`:

```js
// HTML pages shaped like the ArcGIS Server 10.9 and 11.x Services Directory. The structure is what
// the extension's content scripts read; the content is invented. That structure covers the table
// classes, the td.breadcrumbs links, the "<b>Label:</b>" lists, and the form names and controls.

export const REST_PATH = "/arcgis/rest/services";

const esc = (value) => String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]);

// Breadcrumb links: Home > services > each [text, path below REST_PATH] pair.
const crumbs = (...items) => [["Home", ""], ["services", ""], ...items]
  .map(([text, path]) => `<a href="${REST_PATH}${esc(path)}">${esc(text)}</a>`)
  .join("\n  &gt; ");

const shell = ({ title, breadcrumbs, body }) => `<html lang="en">
<head>
<title>${esc(title)}</title>
<link href="/arcgis/rest/static/main.css" rel="stylesheet" type="text/css"/>
</head>
<body>
<table width="100%" class="userTable">
<tr>
<td class="titlecell">ArcGIS REST Services Directory</td>
<td align="right"><a href="/arcgis/rest/login">Login</a></td>
</tr>
</table>
<table width="100%" class="navTable">
<tr valign="top">
<td class="breadcrumbs">
${breadcrumbs}
</td>
<td align="right"><a href="${REST_PATH}?f=help" target="_blank">API Reference</a></td>
</tr>
</table>
<table>
<tr><td class="apiref"><a href="?f=pjson" target="_blank">JSON</a></td></tr>
</table>
<h2>${esc(title)}</h2>
<div class="rbody">
${body}
</div>
</body>
</html>
`;

const servicePath = (service) => `/${service.name}/${service.type}`;
const serviceCrumb = (service) => [`${service.name.split("/").pop()} (${service.type})`, servicePath(service)];

const textRow = (name, label, params) => `<tr valign="top">
<td><label for="${name}">${label}:</label></td>
<td><input type="text" id="${name}" name="${name}" value="${esc(params.get(name))}" size="75"/></td>
</tr>`;

const textareaRow = (name, label, params) => `<tr valign="top">
<td><label for="${name}">${esc(label)}:</label></td>
<td><textarea id="${name}" name="${name}" rows="5" cols="55">${esc(params.get(name))}</textarea></td>
</tr>`;

const radioRow = (name, label, params, fallback) => {
  const value = params.get(name) ?? fallback;
  const checked = (option) => (value === option ? " checked=\"true\"" : "");
  return `<tr>
<td>${label}:</td>
<td>
  <label><input type="radio" name="${name}" value="true"${checked("true")} /> True &nbsp;</label>
  <label><input type="radio" name="${name}" value="false"${checked("false")} /> False</label>
</td>
</tr>`;
};

const formatRow = `<tr>
<td><label for="f">Format:</label></td>
<td><select id="f" name="f"><option value="html">HTML</option><option value="pjson">JSON</option></select></td>
</tr>`;

const submitRow = (verb) => `<tr>
<td colspan="2" align="left">
<input type="submit" value="${verb} (GET)" />
<input type="submit" onclick="this.form.method = 'post';" value="${verb} (POST)" />
</td>
</tr>`;

export const folderPage = ({ folder, folders, services, version }) => shell({
  title: `Folder: /${folder}`,
  breadcrumbs: folder ? crumbs([folder, `/${folder}`]) : crumbs(),
  body: `<b>Current Version: </b>${version}<br/><br/>
${folders.length ? `<b>Folders: </b>
<ul>
${folders.map((name) => `<li><a href="${REST_PATH}/${name}">${esc(name)}</a></li>`).join("\n")}
</ul>` : ""}
<b>Services: </b>
<ul>
${services.map((s) => `<li><a href="${REST_PATH}${servicePath(s)}">${esc(s.name.split("/").pop())}</a> (${s.type})</li>`).join("\n")}
</ul>`
});

export const servicePage = (service) => {
  const base = `${REST_PATH}${servicePath(service)}`;
  const layers = service.layers || [];
  return shell({
    title: `${service.name} (${service.type})`,
    breadcrumbs: crumbs(serviceCrumb(service)),
    body: `<b>Service Description: </b> ${esc(service.info.serviceDescription)}<br/><br/>
${layers.length ? `<a href="${base}/layers">All Layers and Tables</a><br/><br/>
<b>Layers: </b>
<ul>
${layers.map((layer) => `<li><a href="${base}/${layer.id}">${esc(layer.name)}</a> (${layer.id})</li>`).join("\n")}
</ul>` : ""}
${service.tasks ? `<b>Tasks: </b>
<ul>
${service.tasks.map((task) => `<li><a href="${base}/${encodeURIComponent(task.name)}">${esc(task.name)}</a></li>`).join("\n")}
</ul>` : ""}
<b>Copyright Text: </b> ${esc(service.info.copyrightText)}<br/><br/>`
  });
};

export const layerPage = (service, layer) => {
  const base = `${REST_PATH}${servicePath(service)}/${layer.id}`;
  return shell({
    title: `Layer: ${layer.name} (ID: ${layer.id})`,
    breadcrumbs: crumbs(serviceCrumb(service), [layer.name, `${servicePath(service)}/${layer.id}`]),
    body: `<b>Name:</b> ${esc(layer.name)}<br/><br/>
<b>Display Field:</b> ${esc(layer.displayField)}<br/><br/>
<b>Type: </b> ${esc(layer.type)}<br/><br/>
<b>Geometry Type:</b> ${esc(layer.geometryType)}<br/><br/>
<b>Fields: </b>
<ul>
${layer.fields.map((field) => `<li>
    ${esc(field.name)}<i>
(
type: ${field.type}, alias: ${esc(field.alias)}${field.length ? `, length: ${field.length}` : ""}
)
</i></li>`).join("\n")}
</ul>
<b>Supported Operations: </b> <a href="${base}/query">Query</a>`
  });
};

export const queryPage = (service, layer, params) => shell({
  title: `Query: ${layer.name} (ID: ${layer.id})`,
  breadcrumbs: crumbs(serviceCrumb(service), [layer.name, `${servicePath(service)}/${layer.id}`], ["query", `${servicePath(service)}/${layer.id}/query`]),
  body: `<form name="sdform" action="${REST_PATH}${servicePath(service)}/${layer.id}/query">
<table class="formTable">
${textRow("where", "Where", params)}
${textRow("text", "Text", params)}
${textRow("objectIds", "Object IDs", params)}
${textRow("outFields", "Out Fields", params)}
${radioRow("returnGeometry", "Return Geometry", params, "true")}
${radioRow("returnIdsOnly", "Return IDs Only", params, "false")}
${radioRow("returnCountOnly", "Return Count Only", params, "false")}
${textRow("orderByFields", "Order By Fields", params)}
${textRow("groupByFieldsForStatistics", "Group By Fields (For Statistics)", params)}
${textareaRow("outStatistics", "Output Statistics", params)}
${radioRow("returnDistinctValues", "Return Distinct Values", params, "false")}
${formatRow}
${submitRow("Query")}
</table>
</form>`
});

export const findPage = (service, params) => shell({
  title: `Find: ${service.name} (${service.type})`,
  breadcrumbs: crumbs(serviceCrumb(service), ["find", `${servicePath(service)}/find`]),
  body: `<form name="sdform" action="${REST_PATH}${servicePath(service)}/find">
<table class="formTable">
${textRow("searchText", "Search Text", params)}
${radioRow("contains", "Contains", params, "true")}
${textRow("searchFields", "Search Fields", params)}
${textRow("sr", "Spatial Reference", params)}
${textRow("layers", "Layers", params)}
${textRow("layerDefs", "Layer Definitions", params)}
${radioRow("returnGeometry", "Return Geometry", params, "true")}
${formatRow}
${submitRow("Find")}
</table>
</form>`
});

export const executePage = (service, task, params) => shell({
  title: `Execute Task: ${task.name}`,
  breadcrumbs: crumbs(serviceCrumb(service), [task.name, `${servicePath(service)}/${encodeURIComponent(task.name)}`], ["execute", `${servicePath(service)}/${encodeURIComponent(task.name)}/execute`]),
  body: `<form name="sdform" action="${REST_PATH}${servicePath(service)}/${encodeURIComponent(task.name)}/execute">
<table class="formTable">
${task.json.parameters
  .filter((parameter) => parameter.direction === "esriGPParameterDirectionInput")
  .map((parameter) => textareaRow(parameter.name, parameter.displayName, params))
  .join("\n")}
<tr><td colspan="2"><b>Options:</b></td></tr>
${textRow("env:outSR", "Output Spatial Reference", params)}
${radioRow("returnZ", "ReturnZ", params, "false")}
${formatRow}
${submitRow("Execute Task")}
</table>
</form>`
});

export const otherPage = () => `<html lang="en">
<head><title>Not a Services Directory page</title></head>
<body><p>An ordinary page on the same host. It is not a Services Directory page.</p></body>
</html>
`;
```

- [ ] **Step 5: Write the router**

Create `tests/fixtures/fake-arcgis.js`:

```js
// A fake ArcGIS Server for the browser tests. The Playwright fixture (tests/e2e/fixtures.js) routes
// every request for https://arcgis.test through respond(), which answers from catalog.js and
// pages.js, or returns null when no fixture matches.
import { catalog as defaultCatalog } from "./catalog.js";
import { executePage, findPage, folderPage, layerPage, otherPage, queryPage, REST_PATH, servicePage } from "./pages.js";

export const FAKE_ORIGIN = "https://arcgis.test";
export const REST_ROOT = `${FAKE_ORIGIN}${REST_PATH}`;

const SERVICE_TYPES = ["MapServer", "FeatureServer", "ImageServer", "GPServer"];

const html = (body) => ({ status: 200, contentType: "text/html; charset=utf-8", body });

// ArcGIS Server sends f=json as application/json and f=pjson as indented plain text.
const json = (data, format) => ({
  status: 200,
  contentType: format === "pjson" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
  // Keys starting with "_" hold fixture data that a real server would not send.
  body: JSON.stringify(data, (key, value) => (key.startsWith("_") ? undefined : value), format === "pjson" ? 2 : undefined)
});

// ArcGIS Server reports most request errors as HTTP 200 with an error object.
const arcgisError = (message, format) => json({ error: { code: 400, message, details: [] } }, format);

/** Evaluates the where clauses the extension sends. Returns null for anything else. */
export const whereMatcher = (where) => {
  const clause = where.trim();
  let match;
  if (/^1\s*=\s*1$/.test(clause)) {
    return () => true;
  }
  if ((match = clause.match(/^not\s+(\w+)\s+is\s+null$/i))) {
    const [, field] = match;
    return (row) => row[field] != null;
  }
  if ((match = clause.match(/^not\s+(\w+)\s+is\s+null\s+and\s+(\w+)\s*<>\s*''$/i))) {
    const [, field, sameField] = match;
    return (row) => row[field] != null && row[sameField] !== "";
  }
  if ((match = clause.match(/^(\w+)\s*=\s*'([^']*)'$/))) {
    const [, field, value] = match;
    return (row) => row[field] === value;
  }
  if ((match = clause.match(/^(\w+)\s*=\s*(-?\d+(?:\.\d+)?)$/))) {
    const [, field, value] = match;
    return (row) => row[field] === Number(value);
  }
  return null;
};

const queryLayer = (layer, params, format, problems) => {
  const where = params.get("where");
  const matches = where ? whereMatcher(where) : null;
  if (!matches) {
    problems.push(`unsupported where clause "${where}" on layer ${layer.name}`);
    return arcgisError("Unable to complete operation.", format);
  }
  const rows = layer._rows.filter(matches);
  if (params.get("returnCountOnly") === "true") {
    return json({ count: rows.length }, format);
  }
  const requested = params.get("outFields") || "*";
  const names = requested === "*"
    ? layer.fields.filter((field) => field.type !== "esriFieldTypeGeometry").map((field) => field.name)
    : requested.split(",").map((name) => name.trim());
  let attributes = rows.map((row) => Object.fromEntries(names.map((name) => [name, row[name] ?? null])));
  if (params.get("returnDistinctValues") === "true") {
    const unique = new Map(attributes.map((item) => [JSON.stringify(item), item]));
    attributes = [...unique.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => item);
  }
  return json({
    displayFieldName: layer.displayField,
    fields: layer.fields.filter((field) => names.includes(field.name)),
    features: attributes.map((item) => ({ attributes: item }))
  }, format);
};

const layerSummary = ({ id, name, parentLayerId, defaultVisibility, subLayerIds, minScale, maxScale, type, geometryType }) =>
  ({ id, name, parentLayerId, defaultVisibility, subLayerIds, minScale, maxScale, type, geometryType });

const serviceJson = (catalog, service) => ({
  currentVersion: catalog.currentVersion,
  ...service.info,
  ...(service.layers ? { layers: service.layers.map(layerSummary), tables: [] } : {}),
  ...(service.tasks ? { tasks: service.tasks.map((task) => task.name) } : {})
});

const folder = (catalog, parts, format) => {
  const name = parts[0] || "";
  if (parts.length > 1 || (name && !catalog.folders.includes(name))) {
    return null;
  }
  const services = catalog.services.filter((s) => (name ? s.name.startsWith(`${name}/`) : !s.name.includes("/")));
  const folders = name ? [] : catalog.folders;
  if (format === "html") {
    return html(folderPage({ folder: name, folders, services, version: catalog.currentVersion }));
  }
  return json({ currentVersion: catalog.currentVersion, folders, services: services.map((s) => ({ name: s.name, type: s.type })) }, format);
};

const serviceResource = (catalog, service, rest, params, format, problems) => {
  const [first, second, ...extra] = rest;
  if (extra.length) {
    return null;
  }
  if (first === undefined) {
    return format === "html" ? html(servicePage(service)) : json(serviceJson(catalog, service), format);
  }
  if (first === "layers" && second === undefined && service.layers) {
    return json({ layers: service.layers, tables: [] }, format);
  }
  if (first === "find" && second === undefined && service.type === "MapServer") {
    return format === "html" ? html(findPage(service, params)) : json({ results: [] }, format);
  }
  const task = (service.tasks || []).find((t) => t.name === first);
  if (task) {
    if (second === undefined) {
      return format === "html" ? null : json(task.json, format);
    }
    if (second === "execute") {
      return format === "html" ? html(executePage(service, task, params)) : json({ results: [], messages: [] }, format);
    }
    return null;
  }
  const layer = /^\d+$/.test(first) ? (service.layers || []).find((l) => l.id === Number(first)) : undefined;
  if (!layer) {
    return null;
  }
  if (second === undefined) {
    return format === "html" ? html(layerPage(service, layer)) : json(layer, format);
  }
  if (second === "query") {
    return format === "html" ? html(queryPage(service, layer, params)) : queryLayer(layer, params, format, problems);
  }
  return null;
};

const route = (catalog, url, params, problems) => {
  const { pathname } = url;
  const format = params.get("f") || "html";
  if (pathname === "/favicon.ico") {
    return { status: 204, contentType: "image/x-icon", body: "" };
  }
  if (pathname === "/arcgis/rest/static/main.css") {
    return { status: 200, contentType: "text/css; charset=utf-8", body: "body { font-family: sans-serif; }\n" };
  }
  if (pathname === "/other/page") {
    return html(otherPage());
  }
  if (pathname !== REST_PATH && !pathname.startsWith(`${REST_PATH}/`)) {
    return null;
  }
  const parts = pathname.slice(REST_PATH.length).split("/").filter(Boolean).map(decodeURIComponent);
  const typeIndex = parts.findIndex((part) => SERVICE_TYPES.includes(part));
  if (typeIndex === -1) {
    return folder(catalog, parts, format);
  }
  const service = catalog.services.find((s) => s.name === parts.slice(0, typeIndex).join("/") && s.type === parts[typeIndex]);
  return service ? serviceResource(catalog, service, parts.slice(typeIndex + 1), params, format, problems) : null;
};

/**
 * Creates a fake server. respond(request) takes a Playwright Request and returns options for
 * route.fulfill(), or null when nothing matches.
 */
export const createFakeArcGIS = (catalog = defaultCatalog) => {
  const overrides = [];
  const requests = [];
  const problems = [];
  return {
    requests,
    problems,
    /** Answers requests whose path and query (as sent, still encoded) match pattern with handler(url, params). */
    override(pattern, handler) {
      overrides.push({ pattern, handler });
    },
    respond(request) {
      const url = new URL(request.url());
      const params = new URLSearchParams(url.search);
      if (request.method() === "POST" && /x-www-form-urlencoded/.test(request.headers()["content-type"] || "")) {
        new URLSearchParams(request.postData() || "").forEach((value, key) => params.set(key, value));
      }
      requests.push(`${request.method()} ${url.pathname}${url.search}`);
      const override = overrides.find(({ pattern }) => pattern.test(`${url.pathname}${url.search}`));
      return override ? override.handler(url, params) : route(catalog, url, params, problems);
    }
  };
};
```

- [ ] **Step 6: Run the tests and lint**

Run: `node --test tests/unit/fake-arcgis.test.js && npm run lint`

Expected: all 14 tests pass, and lint is clean.

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures tests/unit/fake-arcgis.test.js
git commit -F - <<'EOF'
Add a fake ArcGIS Server for the browser tests

tests/fixtures holds synthetic services, layers and rows, HTML pages
shaped like the 10.9/11.x Services Directory, and a router that answers
the JSON, count, distinct-value, print and page requests the extension
makes. Unknown paths return null and unsupported where clauses are
recorded, so a test can fail loudly instead of passing on a 404.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Playwright harness and its self-tests

**Files:**
- Modify: `package.json`. Replace the `playwright` devDependency with `@playwright/test` 1.64.0, pinned exactly, and update the `test` and `test:e2e` scripts.
- Modify: `tests/smoke.js:9`. It now imports `chromium` from `@playwright/test`.
- Create: `playwright.config.js`
- Create: `tests/e2e/fixtures.js`
- Create: `tests/e2e/harness.spec.js`

**Interfaces:**
- Consumes: `createFakeArcGIS`, `FAKE_ORIGIN` and `REST_ROOT` from Task 4.
- Produces, from `tests/e2e/fixtures.js`: `test`, `expect`, `FAKE_ORIGIN`, `REST_ROOT` and `EXTENSION_PATH`. The fixtures:

  | Fixture | What it provides |
  |---|---|
  | `context` | fresh persistent context with the extension loaded and routing, error and dialog checks installed |
  | `page` | Playwright's built-in page, opened from `context` |
  | `fakeServer` | the server object from Task 4 |
  | `expectedErrors` | an array of RegExp; push to allow a console error |
  | `serviceWorker` | auto fixture; installs the error hooks |
  | `extensionId` | string |
  | `seedStorage(items)` | `Promise<void>`; writes `chrome.storage.sync` |
  | `readStorage(keys?)` | `Promise<object>` |
  | `openPopupTab(tabUrl)` | `Promise<Page>`, the popup page in a tab with `chrome.tabs.query` stubbed |
  | `actionEnabled(page)` | `Promise<boolean>` |
  | `clickAction(page)` | `Promise<void>`; a real toolbar click through CDP |
  | `popupView` | `{ page, waitForOpen(), isOpen() }` |

  Options, set with `test.use()`: `extraLaunchArgs` (array) and `droppedDefaultArgs` (array).

  Environment variables:

  | Variable | Effect |
  |---|---|
  | `EXT_PATH` | extension directory; defaults to `src` |
  | `HEADED=1` | shows the browser |
  | `CHROME_PATH` | runs the tests in another Chromium build, through `executablePath` |

- [ ] **Step 1: Install Playwright Test and the browser**

```bash
npm uninstall playwright
npm install --save-dev --save-exact @playwright/test@1.64.0
npx playwright install --no-shell chromium
```

In `tests/smoke.js`, change line 9 to:

```js
import { chromium } from "@playwright/test";
```

In `package.json` `scripts`, set:

```json
    "test": "npm run test:unit && npm run test:e2e",
    "test:e2e": "playwright test",
```

- [ ] **Step 2: Write the config and the harness self-tests**

Create `playwright.config.js`:

```js
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  // Each test launches its own browser with the extension (see tests/e2e/fixtures.js).
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]]
});
```

Create `tests/e2e/harness.spec.js`:

```js
import { test, expect, FAKE_ORIGIN, REST_ROOT } from "./fixtures.js";

test("the extension loads with no manifest errors", async ({ page, extensionId }) => {
  await page.goto("chrome://extensions");
  const info = await page.evaluate((id) => new Promise((resolve) => chrome.developerPrivate.getExtensionInfo(id, resolve)), extensionId);
  expect(info.state).toBe("ENABLED");
  expect(info.manifestErrors).toEqual([]);
});

test("content scripts run on a Services Directory page served by the fake server", async ({ page }) => {
  await page.goto(REST_ROOT);
  await expect(page.locator("img.status-icon")).toBeAttached();
});

// Each test below breaks one of the fixture's rules on purpose, so each is expected to fail. If one
// of them starts passing, the fixture has stopped catching that kind of problem.
test.describe("the fixture fails a test that", () => {
  test.fail("requests a URL the fake server has no fixture for", async ({ page }) => {
    await page.goto(`${REST_ROOT}/NoSuchService/MapServer`);
  });

  test.fail("requests another host", async ({ page }) => {
    await page.goto(`${FAKE_ORIGIN}/other/page`);
    await page.evaluate(() => fetch("https://elsewhere.test/").catch(() => {}));
  });

  test.fail("opens a dialog", async ({ page }) => {
    await page.goto(`${FAKE_ORIGIN}/other/page`);
    await page.evaluate(() => alert("hello"));
  });

  test.fail("throws in the service worker", async ({ serviceWorker }) => {
    await serviceWorker.evaluate(() => {
      setTimeout(() => {
        throw new Error("boom");
      }, 0);
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  test.fail("has an unhandled promise rejection in the service worker", async ({ serviceWorker }) => {
    await serviceWorker.evaluate(() => {
      Promise.reject(new Error("rejected"));
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
  });
});
```

- [ ] **Step 3: Run the self-tests to see them fail**

Run: `npx playwright test tests/e2e/harness.spec.js`

Expected: FAIL. The spec can't import `./fixtures.js`.

- [ ] **Step 4: Write the fixtures**

Create `tests/e2e/fixtures.js`:

```js
// Playwright fixtures for testing the extension against a fake ArcGIS Server.
//
// Each test gets a fresh Chromium profile with the extension loaded. All http(s) traffic goes
// through Playwright routing. https://arcgis.test is answered by tests/fixtures/fake-arcgis.js,
// and every other host is blocked.
//
// A test fails if it does any of these, unless it declares that it expects to:
// - requests another host
// - makes a request the fake server can't answer
// - logs a console error
// - throws
// - opens a dialog
import { test as base, chromium, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFakeArcGIS, FAKE_ORIGIN, REST_ROOT } from "../fixtures/fake-arcgis.js";

export { expect, FAKE_ORIGIN, REST_ROOT };

const REPO = fileURLToPath(new URL("../..", import.meta.url));

// CI runs the suite against the unzipped build (EXT_PATH=dist), so it tests what ships.
export const EXTENSION_PATH = resolve(REPO, process.env.EXT_PATH || "src");

// MV3 may restart an idle service worker. The handle survives, but a call in flight fails once.
const inWorker = async (worker, fn, arg) => {
  try {
    return await worker.evaluate(fn, arg);
  } catch (error) {
    if (!/Service worker restarted/.test(error.message)) {
      throw error;
    }
    return worker.evaluate(fn, arg);
  }
};

export const test = base.extend({
  // Extra Chromium arguments, and Playwright default arguments to drop. Set with test.use().
  extraLaunchArgs: [[], { option: true }],
  droppedDefaultArgs: [[], { option: true }],

  fakeServer: async ({}, use) => {
    await use(createFakeArcGIS());
  },

  // Console errors a test expects, such as the browser's own report of an HTTP 502 it injected.
  expectedErrors: async ({}, use) => {
    await use([]);
  },

  context: async ({ extraLaunchArgs, droppedDefaultArgs, fakeServer, expectedErrors }, use, testInfo) => {
    const profile = mkdtempSync(join(tmpdir(), "sdt-profile-"));
    const context = await chromium.launchPersistentContext(profile, {
      // Playwright's default headless shell can't load extensions; the full Chromium build can.
      // CHROME_PATH runs the suite in another build, such as Chrome for Testing 120.
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chromium" }),
      headless: !process.env.HEADED,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        // Lets clickAction use the CDP Extensions domain.
        "--enable-unsafe-extension-debugging",
        ...extraLaunchArgs
      ],
      ignoreDefaultArgs: droppedDefaultArgs
    });

    const errors = [];
    const dialogs = [];
    const offHost = [];
    const unmatched = [];
    context.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(`${message.text()} [${message.location().url}]`);
      }
    });
    context.on("weberror", (webError) => errors.push(`Uncaught: ${webError.error().message}`));
    context.on("dialog", async (dialog) => {
      dialogs.push(`${dialog.type()}: ${dialog.message()}`);
      await dialog.dismiss();
    });

    // http(s) only: the extension's own chrome-extension:// files must load untouched.
    await context.route(/^https?:\/\//, async (route) => {
      const request = route.request();
      if (new URL(request.url()).origin !== FAKE_ORIGIN) {
        offHost.push(request.url());
        await route.abort("blockedbyclient");
        return;
      }
      const response = fakeServer.respond(request);
      if (response) {
        await route.fulfill(response);
      } else {
        unmatched.push(`${request.method()} ${request.url()}`);
        await route.fulfill({ status: 404, contentType: "text/plain", body: "No fixture for this URL" });
      }
    });

    await context.tracing.start({ screenshots: true, snapshots: true });

    await use(context);

    if (testInfo.status === testInfo.expectedStatus) {
      await context.tracing.stop();
    } else {
      const trace = testInfo.outputPath("trace.zip");
      await context.tracing.stop({ path: trace });
      await testInfo.attach("trace", { path: trace, contentType: "application/zip" });
    }
    await context.close();
    rmSync(profile, { recursive: true, force: true });

    const unexpectedErrors = errors.filter((error) => !expectedErrors.some((pattern) => pattern.test(error)));
    expect(offHost, "requests to hosts other than the fake ArcGIS Server").toEqual([]);
    expect(unmatched, "requests the fake ArcGIS Server has no fixture for").toEqual([]);
    expect(fakeServer.problems, "requests the fake ArcGIS Server could not interpret").toEqual([]);
    expect(dialogs, "dialogs").toEqual([]);
    expect(unexpectedErrors, "console errors and uncaught exceptions").toEqual([]);
  },

  // The extension's service worker. It is automatic so that every test gets the error hooks.
  serviceWorker: [async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    // Uncaught service-worker errors reach no Playwright event on their own. Re-log them as console
    // errors so the context fixture sees them.
    await inWorker(worker, () => {
      self.addEventListener("error", (event) => console.error(`Service worker error: ${event.message}`));
      self.addEventListener("unhandledrejection", (event) => console.error(`Service worker unhandled rejection: ${event.reason}`));
    });
    await use(worker);
  }, { auto: true }],

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },

  // Writes chrome.storage.sync items. Call it before opening the page that should read them.
  seedStorage: async ({ serviceWorker }, use) => {
    await use((items) => inWorker(serviceWorker, (values) => chrome.storage.sync.set(values), items));
  },

  readStorage: async ({ serviceWorker }, use) => {
    await use((keys = null) => inWorker(serviceWorker, (names) => chrome.storage.sync.get(names), keys));
  },

  // Opens the popup page in a normal tab, with chrome.tabs.query answering as if tabUrl were the
  // active tab. For popup logic; the real popup needs clickAction.
  openPopupTab: async ({ context, extensionId }, use) => {
    await use(async (tabUrl) => {
      const page = await context.newPage();
      await page.addInitScript((url) => {
        const tabs = [{ id: 1, index: 0, windowId: 1, active: true, url }];
        chrome.tabs.query = (queryInfo, callback) => {
          if (callback) {
            callback(tabs);
            return undefined;
          }
          return Promise.resolve(tabs);
        };
      }, tabUrl);
      await page.goto(`chrome-extension://${extensionId}/src/page_action/page_action.html`);
      return page;
    });
  },

  // Whether the toolbar button is enabled for the page's tab. Brings the page to the front first,
  // because the service worker finds the tab as the active tab of the last focused window.
  actionEnabled: async ({ serviceWorker }, use) => {
    await use(async (page) => {
      await page.bringToFront();
      return inWorker(serviceWorker, async () => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        return chrome.action.isEnabled(tab.id);
      });
    });
  },

  // Clicks the toolbar button on the page's tab the way a user does, which also grants activeTab.
  // chrome.action.openPopup() grants nothing, so it can't stand in for a click.
  clickAction: async ({ context, extensionId }, use) => {
    const cdp = await context.browser().newBrowserCDPSession();
    await use(async (page) => {
      await page.bringToFront();
      const { targetInfos } = await cdp.send("Target.getTargets", { filter: [{ type: "tab" }] });
      const target = targetInfos.find((info) => info.url === page.url());
      if (!target) {
        throw new Error(`No tab target for ${page.url()}`);
      }
      await cdp.send("Extensions.triggerAction", { id: extensionId, targetId: target.targetId });
    });
    await cdp.detach();
  },

  // A background extension tab that can reach the real popup through chrome.extension.getViews.
  // It opens before the toolbar click, because bringing any tab to the front closes the popup.
  popupView: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
    await use({
      page,
      // Poll on a timer: animation frames, the default, don't run in a background tab.
      waitForOpen: () => page.waitForFunction(() => chrome.extension.getViews({ type: "popup" }).length > 0, undefined, { polling: 100 }),
      isOpen: () => page.evaluate(() => chrome.extension.getViews({ type: "popup" }).length > 0)
    });
  }
});
```

- [ ] **Step 5: Run the self-tests**

Run: `npx playwright test tests/e2e/harness.spec.js`

Expected: 7 passed. The two normal tests pass, and the five `test.fail` tests are reported as expected failures.

To confirm each expected failure fails for the right reason, list the errors from the JSON report. Reporters don't print the errors of tests that fail as expected.

```bash
REPORT="$(mktemp)"
npx playwright test tests/e2e/harness.spec.js --reporter=json > "$REPORT"
node -e 'const report = require(process.argv[1]); const walk = (suite) => [...(suite.specs || []).flatMap((spec) => spec.tests.flatMap((t) => t.results.flatMap((r) => r.errors.map((e) => `${spec.title}: ${e.message.split("\n")[0]}`)))), ...(suite.suites || []).flatMap(walk)]; console.log(report.suites.flatMap(walk).join("\n"));' "$REPORT"
rm "$REPORT"
```

Expected, one line per self-test:

| Self-test | Error must mention |
|---|---|
| no fixture | "requests the fake ArcGIS Server has no fixture for" |
| other host | "requests to hosts other than the fake ArcGIS Server" |
| dialog | "dialogs" |
| service worker throw | "Service worker error: boom", under "console errors and uncaught exceptions" |
| service worker rejection | "Service worker unhandled rejection", under the same heading |

- [ ] **Step 6: Run everything and commit**

Run: `npm test && npm run lint`

Expected: unit and e2e tests pass, and lint is clean.

```bash
git add package.json package-lock.json playwright.config.js tests/e2e tests/smoke.js
git commit -F - <<'EOF'
Add a Playwright harness that loads the extension headless

Each test gets a fresh Chromium profile with the extension and a fake
ArcGIS Server at https://arcgis.test. Tests fail on requests to other
hosts, requests with no fixture, console errors, uncaught errors
(including in the service worker) and dialogs. Self-tests prove each
of those checks fires. Playwright Test 1.64.0 replaces the playwright
package.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Characterisation tests for pages and options

**Files:**
- Create: `tests/e2e/pages.spec.js`

**Interfaces:**
- Consumes: from Task 5, `test`, `expect`, `REST_ROOT`, `seedStorage`, `readStorage` and `extensionId`.

These tests describe today's behaviour and must pass on today's code. Later phases change some of it on purpose, and update these tests when they do.

- [ ] **Step 1: Write the tests**

Create `tests/e2e/pages.spec.js`:

```js
// What the extension does today on each kind of page. These tests pass on the current code; a
// later phase that changes a behaviour on purpose updates the matching test.
import { test, expect, REST_ROOT } from "./fixtures.js";

// Labels the content scripts write in <b> elements, such as "Number of features: ".
const label = (page, text) => page.locator("b", { hasText: new RegExp(`^${text}`) });

test("the services root shows the gear, spatial reference badges and service details", async ({ page }) => {
  await page.goto(REST_ROOT);
  const gear = page.locator("img.status-icon");
  await expect(gear).toBeVisible();
  await expect.poll(() => gear.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole("link", { name: "3857" })).toHaveCount(2);
  await expect(page.getByRole("link", { name: "4326" })).toHaveCount(1);
  await expect(page.locator(".datablock")).toHaveCount(3);
});

test("a MapServer page shows details and feature counts for each layer", async ({ page }) => {
  await page.goto(`${REST_ROOT}/Parcels/MapServer`);
  await expect(page.locator(".datablock")).toHaveCount(2);
  await expect(label(page, "Number of features:")).toHaveCount(2);
  await expect(label(page, "Features with shapes:")).toHaveCount(2);
});

test("a layer page counts values for every field and every coded value", async ({ page }) => {
  await page.goto(`${REST_ROOT}/Parcels/MapServer/0`);
  await expect(label(page, "Features with values:")).toHaveCount(6);
  await expect(label(page, "Features without empty values:")).toHaveCount(3);
  await expect(label(page, "Residential:")).toHaveCount(1);
  await expect(label(page, "Commercial:")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => document.body.className)).not.toMatch(/loading-/);
});

test("a query page gets the Query Helper with SQL and quick-fill buttons", async ({ page }) => {
  await page.goto(`${REST_ROOT}/Parcels/MapServer/0/query`);
  await expect(page.getByText("Query Helper", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "LIKE", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Select All *", exact: true })).toBeVisible();
});

test("a print task's execute page gets dropdowns and the saved web map", async ({ page, seedStorage }) => {
  const webMap = "{\"operationalLayers\":[]}";
  await seedStorage({ defaultWebMapAsJSON: webMap });
  await page.goto(`${REST_ROOT}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/execute`);
  await expect(page.locator("select:has(option[value='PNG32'])")).toHaveCount(1);
  await expect(page.locator("select:has(option[value='A4 Portrait'])")).toHaveCount(1);
  await expect(page.locator("textarea[name='Web_Map_as_JSON']")).toHaveValue(webMap);
});

test("the options page shows the defaults and saves changes", async ({ page, extensionId, readStorage }) => {
  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  await expect(page.locator("#mapimagewidth")).toHaveValue("300");
  await page.locator("#mapimagewidth").fill("321");
  await page.locator("#save").click();
  await expect.poll(() => readStorage(["mapImageWidth"])).toEqual({ mapImageWidth: 321 });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx playwright test tests/e2e/pages.spec.js`

Expected: 6 passed. These describe existing behaviour, so there is no red step.

If one fails, the fixture data is wrong. Fix `tests/fixtures/` and leave the extension alone. Run with `HEADED=1` to watch, or open the trace with `npx playwright show-trace test-results/<test>/trace.zip`.

- [ ] **Step 3: Check that the tests can fail**

Temporarily change `toHaveCount(6)` in the layer-page test to `toHaveCount(7)`.

Run: `npx playwright test tests/e2e/pages.spec.js -g "layer page"`

Expected: FAIL on that line.

Revert the change.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/pages.spec.js
git commit -F - <<'EOF'
Pin today's page behaviour with browser tests

Covers the gear icon, spatial reference badges and service details on
the root, per-layer counts on a MapServer page, field and coded-value
counts on a layer page, the Query Helper, print dropdowns and the saved
web map, and saving on the options page.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Characterisation tests for the toolbar button and popup

**Files:**
- Create: `tests/e2e/action-popup.spec.js`

**Interfaces:**
- Consumes: from Task 5, `actionEnabled`, `clickAction`, `popupView`, `openPopupTab` and the `droppedDefaultArgs` option.

- [ ] **Step 1: Write the tests**

Create `tests/e2e/action-popup.spec.js`:

```js
import { test, expect, FAKE_ORIGIN, REST_ROOT } from "./fixtures.js";

const SERVICE_PAGE = `${REST_ROOT}/Parcels/MapServer`;
const OTHER_PAGE = `${FAKE_ORIGIN}/other/page`;

test("the toolbar button is enabled on Services Directory pages and disabled elsewhere", async ({ context, actionEnabled }) => {
  const rest = await context.newPage();
  await rest.goto(SERVICE_PAGE);
  const other = await context.newPage();
  await other.goto(OTHER_PAGE);
  await expect.poll(() => actionEnabled(rest)).toBe(true);
  await expect.poll(() => actionEnabled(other)).toBe(false);
});

test.describe("with the back/forward cache on", () => {
  // Playwright turns the back/forward cache off by default.
  test.use({ droppedDefaultArgs: ["--disable-back-forward-cache"] });

  test("the button is enabled again after Back restores a Services Directory page", async ({ page, actionEnabled }) => {
    await page.goto(SERVICE_PAGE);
    await expect.poll(() => actionEnabled(page)).toBe(true);
    await page.evaluate(() => {
      window.restoredFromCache = false;
      window.addEventListener("pageshow", (event) => {
        window.restoredFromCache = event.persisted;
      });
    });
    await page.goto(OTHER_PAGE);
    await expect.poll(() => actionEnabled(page)).toBe(false);
    // A page restored from the cache fires no load event, so wait only for the commit.
    await page.goBack({ waitUntil: "commit" });
    await expect.poll(() => page.evaluate(() => window.restoredFromCache)).toBe(true);
    await expect.poll(() => actionEnabled(page)).toBe(true);
  });
});

test("clicking the toolbar button opens the popup on a Services Directory page", { tag: "@cdp" }, async ({ page, actionEnabled, clickAction, popupView }) => {
  await page.goto(SERVICE_PAGE);
  await expect.poll(() => actionEnabled(page)).toBe(true);
  await clickAction(page);
  await popupView.waitForOpen();
});

test("clicking the toolbar button on another page opens nothing", { tag: "@cdp" }, async ({ page, actionEnabled, clickAction, popupView }) => {
  await page.goto(OTHER_PAGE);
  await expect.poll(() => actionEnabled(page)).toBe(false);
  await clickAction(page);
  // A refused click has no event to wait for, so give a popup time to appear.
  await page.waitForTimeout(1000);
  expect(await popupView.isOpen()).toBe(false);
});

test("the real popup reads the tab's URL, which needs activeTab", { tag: "@cdp" }, async ({ page, actionEnabled, clickAction, popupView }) => {
  await page.goto(`${SERVICE_PAGE}?f=html`);
  await expect.poll(() => actionEnabled(page)).toBe(true);
  await clickAction(page);
  await popupView.waitForOpen();

  // The URL shortener starts from the tab's URL and drops f=html.
  await expect.poll(() => popupView.page.evaluate(() =>
    chrome.extension.getViews({ type: "popup" })[0].document.getElementById("urlshortblank").value
  )).toMatch(/^https:\/\/arcgis\.test\/arcgis\/rest\/services\/Parcels\/MapServer\??$/);

  // REST search starts from the tab's URL too.
  await popupView.page.evaluate(() => {
    const popup = chrome.extension.getViews({ type: "popup" })[0].document;
    popup.getElementById("searchblank").value = "Parcels";
    popup.getElementById("searchbtn").click();
  });
  await expect.poll(() => popupView.page.evaluate(() => {
    const popup = chrome.extension.getViews({ type: "popup" })[0].document;
    return popup.getElementById("searchbtn").textContent === "Search" && popup.querySelectorAll("#searchresults a").length > 0;
  })).toBe(true);
});

test("the popup page renders its search and URL tools", async ({ openPopupTab }) => {
  const popup = await openPopupTab(SERVICE_PAGE);
  await expect(popup.getByRole("button", { name: "Search" })).toBeVisible();
  // Hidden when the URL has nothing to remove.
  await expect(popup.getByRole("button", { name: "Copy to Clipboard" })).toBeAttached();
});
```

- [ ] **Step 2: Run the tests**

Run: `npx playwright test tests/e2e/action-popup.spec.js`

Expected: 6 passed.

If a `@cdp` test fails with `No tab target`, log `targetInfos` inside `clickAction`. The tab target's `url` must equal `page.url()`; compare the two and fix the lookup.

- [ ] **Step 3: Prove the activeTab test depends on activeTab**

```bash
NO_ACTIVETAB="$(mktemp -d)/src"
cp -R src "$NO_ACTIVETAB"
node -e 'const fs = require("fs"); const f = process.argv[1]; const m = JSON.parse(fs.readFileSync(f)); m.permissions = m.permissions.filter((p) => p !== "activeTab"); fs.writeFileSync(f, JSON.stringify(m, null, 2));' "$NO_ACTIVETAB/manifest.json"
EXT_PATH="$NO_ACTIVETAB" npx playwright test tests/e2e/action-popup.spec.js -g "needs activeTab"
rm -rf "$(dirname "$NO_ACTIVETAB")"
```

Expected: FAIL. Without activeTab, `tab.url` is undefined, so the shortener never gets a value and the search throws. Put the failure message in the PR description as evidence.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/action-popup.spec.js
git commit -F - <<'EOF'
Pin the toolbar button and popup behaviour with browser tests

Covers the button state on REST and other pages, re-enabling after a
back/forward cache restore, the real popup opening or being refused
(clicked through CDP so activeTab is granted), and the popup reading
the tab URL. That last test fails without activeTab, which keeps the
permission justified.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Known bugs as expected failures

**Files:**
- Create: `tests/e2e/known-bugs.spec.js`

**Interfaces:**
- Consumes: from Task 5, `fakeServer.override`, `fakeServer.requests`, `expectedErrors`, `seedStorage`, `readStorage`, `openPopupTab` and `extensionId`.
- Produces: one test per bug, titled `"<finding ID>: <behaviour after the fix>"`. The phase that fixes a bug changes its `knownBug(...)` call to `test(...)`.

- [ ] **Step 1: Write the tests**

Create `tests/e2e/known-bugs.spec.js`:

```js
// Bugs from the 2026-10-09 review that already reproduce. Each test describes the behaviour after
// the fix and is expected to fail until then. The phase that fixes a bug turns its knownBug() call
// into test(). See Appendix A of docs/superpowers/specs/2026-10-09-store-readiness-design.md.
//
// SHOW_KNOWN_BUGS=1 runs them as normal tests, to check that each fails on its last assertion and
// not in its setup.
import { test, expect, REST_ROOT } from "./fixtures.js";

const knownBug = (id, title, body) => {
  if (process.env.SHOW_KNOWN_BUGS) {
    test(`${id}: ${title}`, body);
  } else {
    test.fail(`${id}: ${title}`, body);
  }
};

const BAD_GATEWAY = () => ({ status: 502, contentType: "text/html", body: "<html><body>Bad Gateway</body></html>" });
const PRINT_TASK = `${REST_ROOT}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task`;

knownBug("INJ-1", "a layer's JSON view gets no requests and no spinner", async ({ page, fakeServer }) => {
  await page.goto(`${REST_ROOT}/Parcels/MapServer/0?f=pjson`);
  // Nothing on a JSON view signals that the scripts are done, so give them a moment.
  await page.waitForTimeout(1000);
  expect(fakeServer.requests.filter((request) => request.includes("f=json"))).toEqual([]);
  expect(await page.evaluate(() => document.body.className)).not.toMatch(/loading-/);
});

knownBug("INJ-2", "one failed count query does not stop the counts for the other fields", async ({ page, fakeServer, expectedErrors }) => {
  fakeServer.override(/where=not\+PARCEL_ID\+is\+null&/, BAD_GATEWAY);
  expectedErrors.push(/status of 502/);
  await page.goto(`${REST_ROOT}/Parcels/MapServer/0`);
  const fields = page.locator("b", { hasText: /^Fields:/ }).locator("xpath=following-sibling::ul[1]/li");
  await expect(fields).toHaveCount(6);
  for (const field of await fields.all()) {
    await expect(field).toContainText(/Features with values:|Error/);
  }
  await expect.poll(() => page.evaluate(() => document.body.className)).not.toMatch(/loading-/);
});

knownBug("INJ-3", "the Find Helper inserts the raw value even when no form field had focus", async ({ page }) => {
  await page.goto(`${REST_ROOT}/Parcels/MapServer/find`);
  const lists = page.locator(".sidepanel select");
  await lists.nth(0).selectOption("0");
  await lists.nth(1).selectOption("OWNER_NAME");
  const value = lists.nth(2).locator("option", { hasText: "A. Example" });
  await expect(value).toBeAttached();
  await value.dblclick();
  await expect(page.locator("#searchText")).toHaveValue("A. Example");
});

knownBug("INJ-11", "service details label the copyright text without a literal &copy;", async ({ page }) => {
  await page.goto(REST_ROOT);
  await expect(page.getByText("Example County GIS").first()).toBeAttached();
  await expect(page.getByText("&copy;")).toHaveCount(0);
});

knownBug("PRT-1", "a geoprocessing JSON result gets no requests and no dialog", async ({ page, fakeServer }) => {
  await page.goto(`${PRINT_TASK}/execute?f=pjson&Format=PDF`);
  await page.waitForTimeout(1000);
  expect(fakeServer.requests.filter((request) => request.includes("f=json"))).toEqual([]);
});

knownBug("QRY-1", "quick-fill buttons keep the visible True/False choice matching what is submitted", async ({ page, seedStorage }) => {
  // Fill the form without submitting it.
  await seedStorage({ queryHelperSelectAll: "donothing" });
  await page.goto(`${REST_ROOT}/Parcels/MapServer/0/query`);
  await page.getByRole("button", { name: "Select All *", exact: true }).click();
  await page.getByRole("button", { name: "Select All but Geometry *", exact: true }).click();
  const returnGeometry = await page.evaluate(() => {
    const form = document.forms.sdform;
    return {
      shown: form.querySelector("input[name=returnGeometry]:checked").parentElement.textContent.trim(),
      submitted: new FormData(form).get("returnGeometry")
    };
  });
  expect(returnGeometry).toEqual({ shown: "False", submitted: "false" });
});

knownBug("SET-1", "the options page loads normally when \"nothing\" is stored", async ({ page, extensionId, seedStorage }) => {
  await seedStorage({ queryHelperSelectAll: "nothing" });
  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  await expect(page.locator("#mapimagewidth")).toHaveValue("300");
  await expect(page.locator("#showmapimages")).toBeChecked();
  await expect(page.locator("#qhnothing")).toBeChecked();
});

knownBug("SET-3", "a blank number is rejected, not saved", async ({ page, extensionId, readStorage }) => {
  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  await expect(page.locator("#mapimagewidth")).toHaveValue("300");
  await page.locator("#mapimagewidth").fill("");
  await page.locator("#save").click();
  await expect(page.locator("#mapimagewidth")).toHaveAttribute("aria-invalid", "true");
  expect(await readStorage(["mapImageWidth"])).toEqual({});
});

knownBug("POP-1", "a location that fails does not stop the search", async ({ openPopupTab, fakeServer, expectedErrors }) => {
  fakeServer.override(/^\/arcgis\/rest\/services\/Transport\?f=json$/, BAD_GATEWAY);
  expectedErrors.push(/status of 502/);
  const popup = await openPopupTab(REST_ROOT);
  await popup.locator("#searchblank").fill("Roads");
  await popup.locator("#searchbtn").click();
  await expect(popup.locator("#searchbtn")).toHaveText("Search");
  await expect(popup.locator("#searchbtn")).toBeEnabled();
  expect(fakeServer.requests).toContain("GET /arcgis/rest/services/Utilities?f=json");
});

knownBug("POP-2", "text that is not a valid regular expression does not lock the search button", async ({ openPopupTab }) => {
  const popup = await openPopupTab(REST_ROOT);
  await popup.locator("#searchblank").fill("(");
  await popup.locator("#searchbtn").click();
  await expect(popup.locator("#searchbtn")).toBeEnabled();
  await expect(popup.locator("#searchbtn")).toHaveText("Search");
});

knownBug("POP-3", "a number-only search finds names that contain the number", async ({ openPopupTab }) => {
  const popup = await openPopupTab(`${REST_ROOT}/Transport/Roads/MapServer`);
  await popup.locator("#searchblank").fill("2019");
  await popup.locator("#searchbtn").click();
  await expect(popup.locator("#searchbtn")).toHaveText("Search");
  await expect(popup.locator("#searchresults a")).not.toHaveCount(0);
});
```

- [ ] **Step 2: Run them as expected failures**

Run: `npx playwright test tests/e2e/known-bugs.spec.js`

Expected: 11 passed, each reported as an expected failure.

- [ ] **Step 3: Check that each one fails on the bug**

Run: `SHOW_KNOWN_BUGS=1 npx playwright test tests/e2e/known-bugs.spec.js --reporter=list`

Expected: 11 failed. Check each failure against this table. If a test fails anywhere else, its setup is wrong: fix the test and leave the extension alone.

| Test | Must fail at |
|---|---|
| INJ-1 | `requests` contains `GET /arcgis/rest/services/Parcels/MapServer/0?f=json` |
| INJ-2 | the loop, at the `PARCEL_ID` item: the failed query shows neither a count nor an error, and later fields get nothing |
| INJ-3 | `toHaveValue("A. Example")`, and the teardown reports `Uncaught: Cannot read properties of null (reading 'value')` |
| INJ-11 | `getByText("&copy;")` count is not 0 |
| PRT-1 | `requests` contains the task's `?f=json`, and the teardown lists the dialog `alert: Invalid form.` |
| QRY-1 | `shown` is `"True"` |
| SET-1 | `toHaveValue("300")` gets `""`, and the teardown lists the "Error handling response" console error |
| SET-3 | no `aria-invalid` attribute |
| POP-1 | the button text stays "Scanning" |
| POP-2 | the button stays disabled, and the teardown lists the uncaught SyntaxError |
| POP-3 | `#searchresults a` count is 0 |

Record the table, with what you observed, in the PR description.

- [ ] **Step 4: Run the whole suite and commit**

Run: `npm test && npm run lint`

Expected: everything passes, and the known bugs show as expected failures.

```bash
git add tests/e2e/known-bugs.spec.js
git commit -F - <<'EOF'
Record the known bugs as expected-failure tests

Eleven bugs from the review already reproduce against the fake server.
Each test states the behaviour after the fix and is marked test.fail
until the phase that fixes it; SHOW_KNOWN_BUGS=1 shows where each one
fails.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: CI, Dependabot and the minimum-version check

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/dependabot.yml`
- Possibly modify: `README.md` (only if the Chrome 120 spike in Step 1 fails; see Step 2)

**Interfaces:**
- Consumes: from Task 5, the `EXT_PATH` and `CHROME_PATH` support in `tests/e2e/fixtures.js`. From Task 3, `node scripts/build.js`.

- [ ] **Step 1: Try the suite on Chrome for Testing 120 locally**

```bash
CFT_DIR="$(mktemp -d)"
# The installer prints "chrome@<version> <path>". The macOS path contains spaces, so strip the first word.
CHROME_120="$(npx --yes @puppeteer/browsers install chrome@120 --path "$CFT_DIR" | sed 's/^[^ ]* //')"
echo "$CHROME_120"
CHROME_PATH="$CHROME_120" npx playwright test --reporter=list
```

Write down which of these happened:
- **(a)** Everything passes, or only tests that rely on newer APIs fail.
- **(b)** The harness itself can't start: no service worker, or a launch error. If so, retry once with `HEADED=1`. Chrome 120's `--headless` may be the old headless mode, which can't load extensions.

When you're done, run `rm -rf "$CFT_DIR"`.

- [ ] **Step 2: Decide how to cover Chrome 120**

**If (a):** keep the `chrome-120` job in the workflow below. Exclude failing tests with `--grep-invert` on their tag, such as `@cdp`, and list them in the PR description.

**If (b), even with `HEADED=1`:** delete the `chrome-120` job from the workflow below. Then add this paragraph to the end of the "Development" section of `README.md`:

```markdown
Before a release, check the minimum Chrome version by hand: install Chrome for Testing 120 (`npx @puppeteer/browsers install chrome@120`), load `src/` unpacked, and try the services root, a layer page, a query page and the popup.
```

Record which case applied in the PR description.

- [ ] **Step 3: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  test:
    name: Lint, unit tests, build, browser tests
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run test:unit
      # Playwright recommends downloading browsers on each run rather than caching them.
      - run: npx playwright install --with-deps --no-shell chromium
      - run: node scripts/build.js
      - run: unzip -q build/*.zip -d dist
      # Test the unzipped build, which is exactly what ships.
      - run: npx playwright test
        env:
          EXT_PATH: dist
      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: extension-zip
          path: build/*.zip
      - uses: actions/upload-artifact@v7
        if: failure()
        with:
          name: playwright-report
          path: |
            playwright-report/
            test-results/

  chrome-120:
    name: Browser tests on Chrome 120 (minimum version)
    runs-on: ubuntu-latest
    timeout-minutes: 20
    # Informational: Playwright supports only its own Chromium, so a failure here doesn't block.
    continue-on-error: true
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npx playwright install-deps chromium
      - id: chrome
        run: echo "path=$(npx --yes @puppeteer/browsers install chrome@120 --path "$RUNNER_TEMP/cft" | sed 's/^[^ ]* //')" >> "$GITHUB_OUTPUT"
      - run: npx playwright test
        env:
          CHROME_PATH: ${{ steps.chrome.outputs.path }}
```

If Step 1 found tests that need a newer Chrome, change the last `run:` to `npx playwright test --grep-invert @cdp`, or to whichever tag those tests carry.

Create `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: monthly
    groups:
      npm:
        patterns: ["*"]
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: monthly
    groups:
      actions:
        patterns: ["*"]
```

- [ ] **Step 4: Check the workflow steps locally**

Run each command from the `test` job in order:

```bash
rm -rf dist
npm ci && npm run lint && npm run test:unit
node scripts/build.js && unzip -q build/*.zip -d dist
EXT_PATH=dist npx playwright test
```

Expected: every step succeeds. The browser tests pass against `dist/`.

- [ ] **Step 5: Commit**

```bash
git add .github README.md
git commit -F - <<'EOF'
Run lint, tests and the build in CI against the shipped zip

The CI job lints, runs unit tests, builds, unzips the build and runs the
browser tests against it, uploading the zip and any failure traces.
A non-blocking job runs the browser tests on Chrome for Testing 120,
the minimum version. Dependabot proposes grouped npm and Actions
updates monthly.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

If Step 2 dropped the `chrome-120` job, edit the second paragraph of the message to say that the minimum-version check is manual and documented in the README.

---

### Task 10: Move the live check

**Files:**
- Move: `tests/smoke.js` to `tests/live/smoke.js`
- Modify: `tests/live/smoke.js` (lines 1-26 and the launch and `finally` blocks, shown below)
- Modify: `package.json` (`scripts`)

**Interfaces:**
- Produces: `npm run test:live`, which takes `SDT_TEST_SERVER` (falling back to `MSE_TEST_SERVER`) and `HEADED=1`.

- [ ] **Step 1: Move the file and update the script name**

```bash
git mv tests/smoke.js tests/live/smoke.js
```

In `package.json` `scripts`, replace `"test:smoke": "node tests/smoke.js"` with:

```json
    "test:live": "node tests/live/smoke.js"
```

- [ ] **Step 2: Replace the header, setup and launch**

Replace lines 1-26 of `tests/live/smoke.js`, everything before `// How long each check waits`, with:

```js
// Live check: loads the unpacked extension into the locally installed Google Chrome and checks each
// feature against a real ArcGIS Server (Esri's public sample server by default). It is not part of
// CI; the deterministic tests are in tests/e2e. Runs headless; set HEADED=1 to watch.
//
//   npm run test:live
//   SDT_TEST_SERVER=https://host/arcgis/rest/services npm run test:live
//
// Branded Chrome ignores --load-extension, so the extension is loaded over CDP (Extensions.loadUnpacked),
// which needs --enable-unsafe-extension-debugging and Developer mode in the throwaway profile.
import { chromium } from "@playwright/test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
const BASE = process.env.SDT_TEST_SERVER || process.env.MSE_TEST_SERVER || "https://sampleserver6.arcgisonline.com/arcgis/rest/services";
const REST_PAGE = /^https?:\/\/[^/]+\/.+\/rest\/services(\/.*)?$/;

```

Then find the `const ctx = await chromium.launchPersistentContext(...)` block and the `try {` that follows it. Replace them with the block below, so that setup and launch sit inside `try` and cleanup always runs:

```js
let EXT;
let PROFILE;
let ctx;

try {
  // Test-only copy with the "tabs" permission, so the harness can read tab URLs when checking the action state.
  EXT = mkdtempSync(join(tmpdir(), "sdt-ext-"));
  PROFILE = mkdtempSync(join(tmpdir(), "sdt-profile-"));
  cpSync(SRC, EXT, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8"));
  manifest.permissions.push("tabs");
  writeFileSync(join(EXT, "manifest.json"), JSON.stringify(manifest));

  ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: "chrome",
    headless: !process.env.HEADED,
    args: ["--enable-unsafe-extension-debugging"],
    // Playwright passes --disable-extensions by default, which would unload the extension.
    ignoreDefaultArgs: ["--disable-extensions"]
  });

```

Leave the body that follows, from `// 1. Load the extension.` onwards, as it is.

Replace the `finally` block with:

```js
} finally {
  await ctx?.close();
  for (const dir of [EXT, PROFILE]) {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const failed = results.filter((r) => r.ok === false).length;
  const skipped = results.filter((r) => r.ok === null).length;
  console.log(`\n${results.length - failed - skipped}/${results.length} passed${skipped ? `, ${skipped} skipped` : ""}`);
  process.exit(failed ? 1 : 0);
}
```

- [ ] **Step 3: Lint, and run the live check if the network allows**

Run: `npm run lint`

Expected: clean.

If the machine can reach sampleserver6 and the user isn't relying on the desktop, run `npm run test:live`. It is headless, so no window opens. Expected: it ends with `N/N passed`. The bfcache check may report SKIP. If the network is unavailable, say so in the PR description and don't count it as a failure.

- [ ] **Step 4: Commit**

```bash
git add package.json tests/live/smoke.js
git commit -F - <<'EOF'
Move the smoke test to tests/live and run it headless

npm run test:live replaces test:smoke. It reads SDT_TEST_SERVER (with
MSE_TEST_SERVER as a fallback), runs headless unless HEADED=1, and sets
up and launches inside try so the temp directories are always removed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 11: Documentation, CodeRabbit config and the pull request

**Files:**
- Modify: `CLAUDE.md` (lines 9, 11-19, 23, 35, 37, 41-48)
- Modify: `README.md` (the "Install" and "Development" sections)
- Modify: `.coderabbit.yaml` (lines 13, 19-35, plus one new path instruction)

- [ ] **Step 1: Update `CLAUDE.md`**

In line 9, replace `Keep Ken's line in both \`LICENSE\` files.` with:

```
Keep Ken's line in `LICENSE`, which the build adds to the zip. Work before the first store release follows `docs/superpowers/specs/2026-10-09-store-readiness-design.md`.
```

Replace lines 11-19 (the "Commands" section) with:

```markdown
## Commands

Requires Node 22.13+ or 24 (`.nvmrc` pins 24). Run `npm install` first, and `npx playwright install --no-shell chromium` once for the browser tests.

- `npm run lint`: ESLint 10 (flat config in `eslint.config.js`) over the repo, with warnings treated as errors. Formatting rules come from `@stylistic` (2-space indent, double quotes, semicolons). Code under `src/` may not write HTML strings (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`).
- `npm test`: unit tests (`node --test`, in `tests/unit/`), then the browser tests.
- `npm run test:e2e`: the browser tests (Playwright, in `tests/e2e/`). Each test starts headless Chromium with the extension from `src/` (or `EXT_PATH`), and `tests/fixtures/fake-arcgis.js` answers every request to `https://arcgis.test`. A test fails on any request to another host, any request the fake server can't answer, any console error, uncaught error or dialog, unless it declares it. Playwright's default headless shell can't load extensions, so the fixtures use `channel: "chromium"`. Set `HEADED=1` to watch. `tests/e2e/known-bugs.spec.js` holds bugs that are expected to fail until their fix lands; `SHOW_KNOWN_BUGS=1` runs them as normal tests.
- `npm run build`: lint, then zip into `build/<package name>-<version>.zip`. Only files the extension references ship (see `scripts/lib/extension-files.js`), plus the root `LICENSE`. The build fails on a missing or unreferenced file, a `chrome.runtime.getURL` call without a string literal, or a version mismatch between `package.json` and `src/manifest.json`.
- `npm run test:live`: checks each feature against Esri's public sample server (override with `SDT_TEST_SERVER`) in the installed Google Chrome, headless unless `HEADED=1`. It isn't part of CI. Branded Chrome ignores `--load-extension`, so `tests/live/smoke.js` loads the extension over CDP (`Extensions.loadUnpacked`), which needs `--enable-unsafe-extension-debugging`, Developer mode in the throwaway profile, and `ignoreDefaultArgs: ["--disable-extensions"]`.
- To try the extension by hand, open `chrome://extensions`, turn on Developer mode, and use "Load unpacked" on `src/`.

Test data in `tests/fixtures/` is synthetic. Don't commit responses captured from Esri's servers: their terms don't allow redistribution.
```

Replace line 23 (the "Layout" paragraph) with:

```markdown
The extension root is `src/`, which holds `manifest.json` and `icons`. The scripts sit one level deeper, in `src/src/`. Paths in the manifest and in `chrome.runtime.getURL(...)` resolve relative to `src/`. For example, `getURL("src/config/options.json")` loads **`src/src/config/options.json`**.
```

In line 35, replace `scripts in the same content-script group share one global scope` with:

```
all of an extension's content scripts in a frame share one isolated world, even across `content_scripts` groups
```

In line 37, replace `Both use \`chrome.tabs\` (the permissions are limited to \`activeTab\` and \`storage\`).` with:

```
Both read the active tab's URL with `chrome.tabs.query`, which works only because clicking the toolbar button grants `activeTab`. The content-script `matches` give extension pages cross-origin access to every host (Chrome ignores their paths for this), but they don't expose `tab.url`. Keep `activeTab`: the activeTab test in `tests/e2e/action-popup.spec.js` fails without it.
```

Replace lines 41-48 (the "Settings" paragraphs and the `innerHTML` note) with:

```markdown
**Settings** live in `chrome.storage.sync`, and their defaults are repeated in places that must agree:
1. `src/src/options/options.html` (the controls) and `options.js` (the defaults, in its `chrome.storage.sync.get` call): the Chrome options page
2. `src/src/config/options.json`: the declarative schema that `status.js` uses to render the in-page settings form
3. Each content script's `chrome.storage.sync.get({key: default}, ...)` call

The storage keys are `autoMetadata`, `autoFeatureCounts`, `autoFieldCounts`, `autoDomainCounts`, `defaultWebMapAsJSON`, `defaultWhereClause`, `queryHelperSelectAll`, `showMapImages`, `mapImageWidth`, and `mapImageHeight`. They already disagree:
- For "do nothing", `queryHelperSelectAll` is `donothing` on the options page but `nothing` in `src/src/config/options.json`.
- `printTask.js` defaults `defaultWebMapAsJSON` to `""`, while both settings UIs show a web map.

Phase 4 of the store-readiness spec replaces all of this with one schema.

Code under `src/` builds DOM with `loadElement` and text nodes, never HTML strings. Lint enforces this.
```

- [ ] **Step 2: Update `README.md`**

In the "Install" section, change `Chrome 93 or later` to `Chrome 120 or later`.

Replace the "Development" section's body, from "Requires Node" to the last bullet, with:

```markdown
Requires Node 22.13 or later (24 recommended; see `.nvmrc`). Run `npm install`, then `npx playwright install --no-shell chromium` once for the browser tests.

- `npm run lint` checks the code with ESLint. Warnings fail.
- `npm test` runs the unit tests, then the browser tests. The browser tests load the extension into headless Chromium against a fake ArcGIS Server, so they need no network. Set `HEADED=1` to watch them.
- `npm run build` runs the linter, then packages the files the extension uses into `build/services-directory-toolkit-<version>.zip`. The versions in `package.json` and `src/manifest.json` must match.
- `npm run test:live` checks each feature against Esri's public sample server in your installed Google Chrome. Set `SDT_TEST_SERVER` to test a different server.
```

If Task 9 added the Chrome 120 paragraph, keep it after these bullets.

- [ ] **Step 3: Update `.coderabbit.yaml`**

- Line 13: change `base_branches: ["master"]` to `base_branches: ["main"]`.
- In the `src/**/*.js` instructions, replace `Flag MV2-only APIs (chrome.extension.*, background pages, page_action).` with:

  ```
  Flag MV2-only APIs (chrome.extension.*, background pages, the page_action manifest
  key, chrome.pageAction). The src/src/page_action/ folder name is historical and fine.
  ```

- In the `src/manifest.json` instructions, replace the two sentences starting `The declarativeContent rule` with:

  ```
  The toolbar button is enabled by an enableAction message from status.js, not by
  declarativeContent rules; flag any attempt to reintroduce them.
  ```

- In the `src/src/{options,config}/**` instructions, replace `Settings are defined in three places that must agree: options.html/options.js,` with:

  ```
  Settings defaults are repeated in places that must agree: options.html/options.js,
  ```

- Add this path instruction after the `src/src/{options,config}/**` entry:

  ```yaml
      - path: "tests/fixtures/**"
        instructions: |
          Fixtures must be synthetic. Flag anything that looks copied from a real ArcGIS
          Server or Esri sample service: real service names, descriptions or captured
          responses.
  ```

- [ ] **Step 4: Final verification**

Run:

```bash
npm run lint && npm test && npm run build && git status --short
```

Expected:
- Lint is clean.
- Unit tests pass.
- Browser tests pass, with the known bugs reported as expected failures.
- The build writes the zip.
- `git status` shows only the documentation changes from this task.

- [ ] **Step 5: Commit, push and open the pull request**

```bash
git add CLAUDE.md README.md .coderabbit.yaml
git commit -F - <<'EOF'
Update docs and review config for the new test setup

CLAUDE.md and the README describe the new commands, the fake ArcGIS
Server, the synthetic-fixture rule, why activeTab stays, and the
settings drift that Phase 4 removes. CodeRabbit now targets main and no
longer asks reviewers to keep a declarativeContent rule in sync.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git push -u origin phase-1-foundation
```

Open the PR against `main`. The body needs to include:
- the finding IDs closed: TOOL-1 to TOOL-11, TOOL-13 to TOOL-15, MAN-3, MAN-5, CWS-5, PKG-1, SUP-1, SUP-2, the SET-10 locale and config parts, ADV-1, ADV-4 (the test), ADV-8 and ADV-9
- the activeTab evidence from Task 7 Step 3
- the known-bug table from Task 8 Step 3
- the Chrome 120 outcome from Task 9
- the live-check result from Task 10

If PR #4 (the spec) hasn't been merged yet, say that this branch includes its commit.

Write the body to a temporary file, end it with the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`, then:

```bash
PR_BODY="$(mktemp)"
# ...write the body into "$PR_BODY" with your editor or a heredoc...
gh pr create --repo ggfevans/Services-Directory-Toolkit --base main --head phase-1-foundation --title "Phase 1: test harness, CI, lint and build checks" --body-file "$PR_BODY"
gh pr checks --watch
rm "$PR_BODY"
```

Expected: the `test` job passes. The `chrome-120` job may fail without blocking. Fix any failure in `test` before asking for review.
