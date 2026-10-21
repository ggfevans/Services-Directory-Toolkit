# Phase 3: Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the manifest, the service worker, the gear and the popup's entry points their final form: URL patterns that cover the root with a query, `submitJob` and only exact `query` operations; a toolbar button that starts disabled and listens only to the active top frame of a tab; a status indicator in place of the gear and its in-page settings form; no web-accessible resources; an Options link in the popup; and `short_name` "SD Toolkit".

**Architecture:**
- The service worker is a classic worker. It loads a new lib file, `src/src/lib/sender.js` (`SDT.sender`), with `importScripts`, and acts on `enableAction` only when `SDT.sender.accepts(sender, chrome.runtime.id)`. The build counts files loaded with `importScripts` as referenced and checks their `SDT` load order.
- `status.js` builds the indicator with `document.createElementNS`, watches `<body>`'s `sdt-loading-*` classes with a guarded `MutationObserver`, and keeps a visually hidden `role="status"` line, throttled to one change a second. The indicator has `pointer-events: none` and no listeners.
- Nothing in a content script writes to `chrome.storage` any more, and lint keeps it that way (spec section 4.4).
- The build refuses a `web_accessible_resources` key.
- Tests: a URL-pattern matrix in Node (the patterns themselves) and in the browser (what runs), unit tests for the sender check and the service worker in a `vm` context, and the first axe-core runs (`@axe-core/playwright`), in light and dark.

**Tech stack:** Node 24 (`^22.13.0 || >=24`), `node --test` with `node:vm`, `@playwright/test` 1.64.0, ESLint 10, and one new devDependency, `@axe-core/playwright` 4.14.0 (pinned exactly, like Playwright).

**Specs:**
- `docs/superpowers/specs/2026-10-09-store-readiness-design.md`: section 3, section 4 (definition of done), section 5 (shared code), "Phase 3: Shell", and Appendix A.
- `docs/superpowers/specs/2026-10-13-token-support-design.md`: Appendix A, TR-22.
- `docs/design/2026-10-ui-design-review.md`: sections 2.2, 5.4, 6.3, 7 and 10.2 (#14 turns this phase's indicator into the status bar).
- Issue #32 (this phase).

Read the specs, `CLAUDE.md`, and the comments at the top of `tests/e2e/fixtures.js` and `tests/fixtures/fake-arcgis.js` before starting.

**Branch:** `claude/awesome-albattani-5hnlf1`. One pull request against `main`. This plan file is its first commit. The phase is M-size, and its parts depend on each other: the storage lint rule can only land once the form is gone, the build can only refuse `web_accessible_resources` once the gear no longer loads `settings.svg`, and the URL-pattern matrix and the axe tests find pages by the indicator. Splitting it would mean merging tests that rely on code from the other half.

## Decisions

The owner made these on 2026-10-21.

1. **URL patterns**, in Esri's casing, with no lower-case variants. Patterns are case-sensitive and match the path and the query string together, and `*` matches across `/` and `?` (checked by experiment, below).
   - The main group and the CSS group: `*://*/rest/services`, `*://*/rest/services?*`, `*://*/rest/services/*`, `*://*/*/rest/services`, `*://*/*/rest/services?*`, `*://*/*/rest/services/*`.
   - The Query Helper group, exact `query` operations only (QRY-3's pattern part): `*://*/rest/services/*/query`, `*://*/rest/services/*/query?*`, and the same two with `*://*/*/rest/...`.
   - The GP group (PRT-2): `.../rest/services/*/GPServer/*/execute`, `.../execute?*`, `.../submitJob` and `.../submitJob?*`, with and without the instance-path prefix: eight patterns.
   - The classifier check stays at the top of every script. The toolbar button is enabled only when `SDT.page.classify` says the page is a Services Directory page, which `status.js` already does.
   - The `CLAUDE.md` note that the root opened with `?token=` gets no content scripts until Phase 3 (MAN-2) goes, and tests that opened the root as `.../rest/services/?token=` open `.../rest/services?token=`.
2. **Status indicator.**
   - A 24 px inline SVG ring built with `document.createElementNS`, fixed in the bottom-right corner, with `role="img"` and the accessible name "Services Directory Toolkit".
   - `pointer-events: none`, so it never takes a click, and no click handler at all.
   - A visually hidden `role="status"` element reads "SD Toolkit: loading" while any `sdt-loading-*` class is on `<body>`, and "SD Toolkit: finished loading" when they have all cleared. It is empty until the first busy state, and changes at most once a second, with a throttle that always lets the last state land.
   - It spins only while busy, and not under `prefers-reduced-motion`.
   - The `MutationObserver` callback and the timers go through `SDT.guard.wrap`. The elements are held by reference, never looked up by id.
   - Removed: the in-page settings form, its CSS, `src/src/config/options.json`, `src/src/images/settings.svg`, and `web_accessible_resources` entirely.
3. **Popup Options link.** A link labelled "Options" at the foot of the popup, after REST Search. Its `href` points at the options page, and its click handler prevents the default and calls `chrome.runtime.openOptionsPage()`. Phase 9 (#24) moves it under a Settings heading as "All settings".
4. **axe.** Issue #13 (the shared axe helper and a dark host fixture) is still open, so this phase adds `@axe-core/playwright` 4.14.0 as a devDependency and a minimal helper, `tests/e2e/axe.js`. It runs the tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa`, scoped to the extension's own elements on host pages and to the whole document on the popup, after `page.emulateMedia({ colorScheme: "light" })` and again after `"dark"`. #13 later extends it with the dark host fixture. A keyboard-only test checks that every popup control, the Options link included, is reachable and works from the keyboard, and that the indicator never takes focus.
5. **Icons.** The Track S artwork (#50) doesn't exist yet. The manifest's toolbar icon as a size dictionary, and the icon part of MAN-4, move to #55. The PR says so. `short_name` becomes "SD Toolkit" (CWS-4, and MAN-4's name part).

This plan also settles points the specs leave open. The owner can overrule any of them in review (see "Open points"):

- **`SDT.sender` in `src/src/lib/sender.js`.** The name says what the file checks, like `SDT.page` and `SDT.auth`. Only the service worker loads it, with `importScripts("../lib/sender.js")`, so it is in no content-script group. `problem(sender, extensionId)` returns the reason a message is refused (`"another extension"`, `"no tab"`, `"not the top frame"`, `"document not active"`) or `null`, so each unit test checks that a case fails for its own reason, and `accepts()` wraps it.
- **A missing `documentLifecycle` is refused.** Chrome has sent `sender.documentLifecycle` since version 106, and the manifest's minimum is 120. Chrome for Testing 120 and Chromium 141 both send `"active"` for a content script's message at load and after a back/forward cache restore (verified, below). Failing closed costs nothing on any Chrome the extension installs on. The values Chrome documents are `"prerender"`, `"active"`, `"cached"` and `"pending_deletion"`.
- **The button after prerendering.** With the sender check, a prerendered page's `enableAction` is refused, so nothing would enable the button once the page is shown. `SDT.guard.whenActive(fn)` runs `fn` now, or on `prerenderingchange` while `document.prerendering` is true, and `status.js` sends `enableAction` through it. It is unit-tested; BG-2 has no browser test, as the register says.
- **A failed `chrome.action.enable()`** (usually a tab that closed first) is caught and logged with `console.debug`, which the harness doesn't count as an error (BG-3).
- **The build refuses `web_accessible_resources`**, and a unit test checks the zipped manifest has none. The build's glob support for that key goes.
- **The harness's "no manifest errors" test turns on Developer mode and reloads the extension first.** Chrome records an unrecognised manifest key only in Developer mode, so the test passed whatever the manifest held (verified, below).
- **Fixtures.** The fake server gains an asynchronous GP service, `Transport/RouteTools`, whose task "Summarize Routes" has a `submitJob` form; a FeatureServer `queryDomains` page and its JSON; and `/docs/rest/services/overview`, a page outside ArcGIS Server whose path holds `/rest/services`. All synthetic.
- **The indicator's look**, until Phase 5's shared style: an opaque white disc with a `#7b8786` edge, a `#d3dad9` track and a `#0d6b66` quarter arc (the design review's light tokens), so it keeps its contrast on any page. Idle, the arc is still. Under reduced motion, busy shows two opposite quarters instead of a spin, as design review section 5.4 describes. Classes follow the review's pattern: `sdt-indicator`, `sdt-indicator__ring`, `sdt-indicator__disc`, `sdt-indicator__track`, `sdt-indicator__arc`, `sdt-indicator--busy`, and `sdt-visually-hidden` for the status line.
- **The first status message also waits a second** after the indicator appears. A live region announces changes, not what it holds when it is inserted.
- **Popup fixes for axe.** Today's popup fails three WCAG rules (verified, below). This phase adds `lang="en"`, an `aria-label` on the URL field and a 24 px minimum height for buttons and the Options link. The rest of the popup's accessibility stays with POP-8 in Phase 9.

## Facts verified for this plan (2026-10-21)

A probe extension with the Decision 1 patterns, `action.default_state: "disabled"` and no `chrome.action.disable()` call was loaded in Chromium 141.0.7390.37 (the local Playwright build) and in Chrome for Testing 120.0.6099.109 (downloaded from `storage.googleapis.com/chrome-for-testing-public`), with every request routed to a stub page.

- **`default_state`.** Both browsers honour it: on a page no script touched, `chrome.action.isEnabled(tabId)` and `chrome.action.isEnabled()` are `false`. Neither reports a manifest error or an install warning for it.
- **Patterns.** Both browsers ran the same groups on all 32 probe URLs, and Task 7's unit table is built from those results. Among them:
  - `.../rest/services?token=abc`, `.../rest/services?f=html`, `/rest/services` with no instance path, and `/a/b/rest/services` get the main group.
  - `.../0/query?where=...` gets the Query Helper group; `.../0/query/`, `.../0/queryDomains` and `.../0/queryRelatedRecords` don't.
  - `.../GPServer/Task/submitJob?f=html` gets the GP group; `.../submitjob` (lower case), `.../jobs/j1` and `.../executeX` don't.
  - `/arcgis/REST/services` and `/arcgis/rest/servicesX` get nothing.
  - `/other/page?x=/arcgis/rest/services/` and `/evil.html?x=/rest/services` get the main group. The classifier turns them away.
- **Senders.** In both browsers a content script's message carries `id`, `url`, `origin`, `frameId: 0`, `documentId`, `documentLifecycle: "active"` and `tab`, at load and from a `pageshow` with `persisted` after a back/forward cache restore. Content scripts don't run in iframes (`all_frames` is false), so the frame check is a second line of defence.
- **Manifest errors.** `chrome.developerPrivate.getExtensionInfo` reports an unrecognised top-level key, such as `"bogus_key"`, as a manifest error only after Developer mode is turned on and the extension reloaded, in both browsers. An unknown key inside `action` is never reported. So today's harness test can't fail, and a typo inside `action` can only be caught by a unit test on the manifest.
- **Listeners.** CDP `DOMDebugger.getEventListeners` with `depth: -1` lists listeners from every world: on today's gear it reports three `click` listeners (the gear, Save and Cancel), all added in the extension's isolated world.
- **Today's popup and axe.** axe-core 4.14 with the five tags reports `html-has-lang`, `label` (`#urlshortblank`) and `target-size` (`#copybtn`, 147.5 × 23 px), in light and in dark.
- **This plan's code**, applied to a scratch copy of `main`: lint clean, 245 unit tests pass, and the browser suite without `@cdp` passes, 92 tests with the known bugs as expected failures, against the unzipped build in Chromium 141 and against `src/` in Chrome for Testing 120. `SHOW_KNOWN_BUGS=1` fails each known bug on the same line as on `main`.

## Global Constraints

- **Environment.** The local Playwright browser isn't the pinned one. Run browser tests with:

  ```bash
  CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test --grep-invert @cdp
  ```

  Chromium 141 has no `Extensions.triggerAction`, so the four `@cdp` tests in `tests/e2e/action-popup.spec.js` run only in CI. Nothing in this plan changes what they use (`#urlshortblank`, `#searchblank`, `#searchbtn`, `#searchresults`, the `popupView` helper page). Don't run `playwright install`. The other checks are `npm run lint`, `npm run test:unit` and `node scripts/build.js`.
- **Dependencies.** Task 8 runs `npm install --save-dev --save-exact @axe-core/playwright@4.14.0`, which updates `package.json` and `package-lock.json`; the npm registry is reachable. Nothing else changes either file.
- **No HTML strings** under `src/`. Build DOM with `SDT.dom.loadElement`, `document.createElementNS` and text nodes.
- **One isolated world.** Content and popup scripts stay wrapped in one bare `{ }` block. A content script's top level only declares names and ends with one `SDT.guard.onLoad(...)` or `SDT.guard.run(...)` call. Listeners, timers, observers and `chrome.*` callbacks go through `SDT.guard.listen` or `SDT.guard.wrap`.
- **Lib files** start with `globalThis.SDT ??= {};`, assign one namespace, and declare no top-level names. `sender.js` is a lib file, though no content-script group lists it.
- **Every new file under `src/` must be referenced** in the same commit, or `tests/unit/extension-files.test.js` and the build fail ("not referenced").
- **Cross-realm values.** Compare values made in a `vm` context with `plain()` or as primitives.
- **ESLint `no-restricted-syntax`:** a later flat-config entry replaces the rule's whole option list for the files it matches, so the `src/src/inject/**` entry keeps every list it has and adds the new one.
- **Content scripts never write to `chrome.storage`** (spec section 4.4). From Task 6, lint enforces it.
- **Elements by reference.** The indicator's nodes are held in variables. Tests find them by role and name.
- **Test data is synthetic.** Never commit HTML or JSON captured from an Esri server.
- **Known bugs.** None of this phase's findings has a `knownBug()` case. Task 10 re-runs them with `SHOW_KNOWN_BUGS=1`, because Task 4 removes the form's "Query Helper" legend and Task 7 adds a GP service to the `Transport` folder that the popup search can crawl.
- **Code style:** 2-space indent, double quotes, semicolons, `--max-warnings=0`. If lint flags only formatting in code copied from this plan, run `npx eslint --fix <file>`. Don't change the logic to satisfy it.
- **Commit messages:** imperative subject, plain-English body, ending with the attribution lines your session gives. The examples below leave them out.

## Review Focus

The failure modes most likely to let a broken change pass:

1. **A pattern that misses a page, or runs a helper where it shouldn't.** Pinned by the 40-case unit matrix (Task 7), whose `matches()` was checked against both browsers, and by the browser matrix over the fake server. The unit matrix must fail on today's manifest (Task 7, Step 2 lists the cases).
2. **A sender check so strict that the button never turns on.** Pinned by the browser tests that read `chrome.action.isEnabled`: the URL-pattern matrix, `action-popup.spec.js` and its back/forward cache test. The check's inputs were read from both browsers (Facts).
3. **A worker that can't load `sender.js` from the zip.** `importScripts` failing stops the worker from starting, and errors during worker startup reach no hook. The fixture then waits for a `serviceworker` event that never comes, so every browser test times out: loud, but slow to diagnose. Task 1 makes the build count the file, and CI tests the unzipped build.
4. **An indicator that takes clicks or keeps a handler.** Pinned by the CDP listener test and `elementFromPoint` (Task 4), and by the dispatched-click test.
5. **A throttle that drops the last state.** Pinned by the toggle test in Task 4, which checks the gaps between changes and the final text.
6. **axe scoped to nothing.** `AxeBuilder.include` with a selector that matches nothing makes axe throw, so a renamed indicator fails rather than passing empty. Keep the `include` selector in step with the class.
7. **A manifest typo inside `action`.** Chrome never reports it (Facts), so the manifest unit test (Task 2) is the only guard for `default_state`.

## Public API

What this phase adds that later phases may use.

### `SDT.sender` (`src/src/lib/sender.js`, service worker only)

| Member | Returns | Notes |
|---|---|---|
| `problem(sender, extensionId)` | `"another extension" \| "no tab" \| "not the top frame" \| "document not active" \| null` | Checked in that order. `null` means act on the message. `sender.id` must be a string equal to `extensionId`; `sender.tab.id` a non-negative integer; `sender.frameId` exactly `0`; `sender.documentLifecycle` exactly `"active"`. |
| `accepts(sender, extensionId)` | `boolean` | `problem(...) === null` |

### `SDT.guard.whenActive` (`src/src/lib/guard.js`)

| Member | Returns | Notes |
|---|---|---|
| `whenActive(fn)` | `undefined` | Runs `fn` through `run` now, or through `listen(document, "prerenderingchange", fn, { once: true })` while `document.prerendering` is true. Does nothing, and reads nothing, when not alive. |

### The indicator (for #14)

`status.js` appends one `div.sdt-indicator` to `<body>` on every page that `SDT.page.classify` doesn't call `jsonView` or `other`. It holds an `svg.sdt-indicator__ring` (`role="img"`, `aria-label="Services Directory Toolkit"`) and a `span.sdt-visually-hidden` with `role="status"`. The class `sdt-indicator--busy` is on the `div` while any `sdt-loading-*` class is on `<body>`. Status texts: `""`, `"SD Toolkit: loading"`, `"SD Toolkit: finished loading"`.

### Build (`scripts/lib/extension-files.js`)

| Export | Notes |
|---|---|
| `importedScripts(worker, code, problems) -> string[]` | The paths a classic worker loads with `importScripts`, in call order, relative to the extension root. A path resolves against the worker's own location, and one starting `/` against the root. An argument that isn't a string literal adds `<worker>: importScripts needs string literals, got "<argument>"`. |

`referencedFiles` adds each imported file (a missing one is `<worker> references missing file <path>`), checks `[...imports, worker]` with `sdtLoadOrderProblems` under the source `background.service_worker`, and reports any `web_accessible_resources` key as `web_accessible_resources: not allowed, because any page could load these files and detect the extension (MAN-1)`.

### Tests

| Where | What |
|---|---|
| `tests/e2e/axe.js` | `axeViolations(page, { include }) -> Promise<{ light: string[], dark: string[] }>`, plus `WCAG_TAGS` and `COLOR_SCHEMES`. Each string is `<rule>: <target>, <target>`. |
| `tests/fixtures/pages.js` | `executePage(service, task, params, operation = "execute")` also renders `submitJob` forms; new `queryDomainsPage(service, params)` and `docsPage()` |
| `tests/fixtures/catalog.js` | `Transport/RouteTools` (GPServer, asynchronous), task "Summarize Routes" with a `Distance_Units` choice list |

---

## Task 1: Count the files the service worker imports

**Files:**
- Modify: `scripts/lib/extension-files.js`
- Modify: `tests/unit/extension-files.test.js` (append)

**Interfaces:**
- Produces: `importedScripts` (see Public API), and the worker's imports in `referencedFiles`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/extension-files.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/unit/extension-files.test.js`
Expected: FAIL, the five new cases. The worker's imports aren't counted, so `lib/sender.js` is reported as "not referenced", and the last three get the wrong problem list.

- [ ] **Step 3: Parse `importScripts`**

In `scripts/lib/extension-files.js`, after the `PAGE_SCRIPT` constant, add:

```js
// importScripts(...) in a classic service worker. Each argument must be a string literal.
const IMPORT_SCRIPTS_CALL = /\bimportScripts\(([^)]*)\)/g;

/** Splits an argument list at the commas outside quotes, so a comma inside a path stays in it. */
const splitArguments = (argumentList) => {
  const parts = [""];
  let quote = null;
  for (const char of argumentList) {
    if (quote) {
      quote = char === quote ? null : quote;
    } else if (char === "\"" || char === "'" || char === "`") {
      quote = char;
    } else if (char === ",") {
      parts.push("");
      continue;
    }
    parts[parts.length - 1] += char;
  }
  return parts;
};

/**
 * The files a classic service worker loads with importScripts, in call order, as paths relative to
 * the extension root. A path resolves against the worker's own location, and a leading / against the
 * root. Adds a problem for an argument that isn't a string literal.
 */
export const importedScripts = (worker, code, problems) => {
  const files = [];
  for (const [, argumentList] of code.matchAll(IMPORT_SCRIPTS_CALL)) {
    for (const argument of splitArguments(argumentList).filter((part) => part.trim())) {
      const literal = argument.match(STRING_LITERAL);
      if (!literal) {
        problems.push(`${worker}: importScripts needs string literals, got "${argument.trim()}"`);
        continue;
      }
      const reference = literal[2];
      files.push(reference.startsWith("/")
        ? posix.normalize(reference.slice(1))
        : posix.normalize(posix.join(posix.dirname(worker), reference)));
    }
  }
  return files;
};
```

In `referencedFiles`, replace:

```js
  if (manifest.background?.service_worker) {
    add(manifest.background.service_worker, "background.service_worker");
  }
```

with:

```js
  const worker = manifest.background?.service_worker && posix.normalize(manifest.background.service_worker.replace(/^\//, ""));
  if (worker) {
    add(worker, "background.service_worker");
    if (existing.includes(worker)) {
      const imports = importedScripts(worker, readFileSync(join(extDir, worker), "utf8"), problems);
      imports.forEach((path) => add(path, worker));
      problems.push(...sdtLoadOrderProblems(extDir, [...imports, worker], "background.service_worker"));
    }
  }
```

In the JSDoc above `referencedFiles`, add the bullet `* - every file the service worker loads with importScripts` after `* - everything its HTML pages load`, and change "getURL calls that can't be checked" to "getURL and importScripts calls that can't be checked".

- [ ] **Step 4: Run the tests**

Run: `npm run lint && npm run test:unit`
Expected: PASS. Today's `background.js` calls no `importScripts`, so nothing else changes.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-10-21-phase-3-shell.md scripts/lib/extension-files.js tests/unit/extension-files.test.js
git commit -F - <<'EOF'
Count the files the service worker imports in the build

The build ships each file the service worker loads with importScripts,
fails on a missing one or a non-literal path, and checks their SDT load
order. This commit also adds the Phase 3 plan.
EOF
```

(If the plan file is already committed on the branch, leave it out of `git add`.)

---

## Task 2: `SDT.sender` and the service worker

**Files:**
- Create: `src/src/lib/sender.js`
- Create: `tests/unit/sender.test.js`, `tests/unit/background.test.js`
- Modify: `src/src/bg/background.js`
- Modify: `src/manifest.json` (`action.default_state`)
- Modify: `eslint.config.js` (service-worker globals)
- Modify: `tests/unit/manifest.test.js` (append)
- Modify: `tests/e2e/harness.spec.js` (the manifest-errors test)

**Interfaces:**
- Consumes: Task 1's `importScripts` support.
- Produces: `SDT.sender` (see Public API). The worker acts on `enableAction` only from accepted senders and catches `enable()` failures.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/sender.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLib } from "./helpers/sdt.js";

const ID = "sdt-test-extension";
const { sender } = loadLib({ files: ["src/lib/sender.js"] }).SDT;

// What Chrome 120 and later pass to onMessage for a message from this extension's content script in
// the top frame of an open tab.
const fromTopFrame = (overrides = {}) => ({
  id: ID,
  url: "https://arcgis.test/arcgis/rest/services",
  origin: "https://arcgis.test",
  frameId: 0,
  documentId: "8C1B0F1F3A5E4D2C9B7A6E5D4C3B2A10",
  documentLifecycle: "active",
  tab: { id: 42, url: "https://arcgis.test/arcgis/rest/services", active: true },
  ...overrides
});

test("accepts a message from the active top frame of a tab", () => {
  assert.equal(sender.problem(fromTopFrame(), ID), null);
  assert.equal(sender.accepts(fromTopFrame(), ID), true);
});

test("rejects a message from another extension, or with no sender id", () => {
  assert.equal(sender.problem(fromTopFrame({ id: "another-extension" }), ID), "another extension");
  assert.equal(sender.problem(fromTopFrame({ id: undefined }), ID), "another extension");
  assert.equal(sender.problem(undefined, ID), "another extension");
  // A missing extension id must not match a sender with no id either.
  assert.equal(sender.problem(fromTopFrame({ id: undefined }), undefined), "another extension");
});

test("rejects a message with no tab, such as one from an extension page", () => {
  assert.equal(sender.problem(fromTopFrame({ tab: undefined }), ID), "no tab");
  assert.equal(sender.problem(fromTopFrame({ tab: { id: -1 } }), ID), "no tab");
  assert.equal(sender.problem(fromTopFrame({ tab: {} }), ID), "no tab");
});

test("rejects a message from a frame other than the top one", () => {
  assert.equal(sender.problem(fromTopFrame({ frameId: 3 }), ID), "not the top frame");
  assert.equal(sender.problem(fromTopFrame({ frameId: undefined }), ID), "not the top frame");
});

test("rejects a message from a document that is prerendering, cached or being deleted (BG-2)", () => {
  for (const documentLifecycle of ["prerender", "cached", "pending_deletion"]) {
    assert.equal(sender.problem(fromTopFrame({ documentLifecycle }), ID), "document not active", documentLifecycle);
  }
});

test("rejects a message with no documentLifecycle, which every supported Chrome sends", () => {
  assert.equal(sender.problem(fromTopFrame({ documentLifecycle: undefined }), ID), "document not active");
});
```

Create `tests/unit/background.test.js`:

```js
// Runs the service worker (src/src/bg/background.js) in a vm context with a stub chrome, so the
// message handler can be called with any sender, which a browser test can't forge.
import { test } from "node:test";
import assert from "node:assert/strict";
import { posix } from "node:path";
import vm from "node:vm";
import { runFile } from "./helpers/sdt.js";

const ID = "sdt-test-extension";
const WORKER = "src/bg/background.js";

/** Loads the worker. Returns the listeners it added and the chrome.action calls it made. */
const loadWorker = ({ enable = async () => {}, disable = async () => {} } = {}) => {
  const listeners = {};
  const calls = [];
  const debug = [];
  const event = (name) => ({ addListener: (listener) => { listeners[name] = listener; } });
  const chrome = {
    runtime: { id: ID, onInstalled: event("onInstalled"), onStartup: event("onStartup"), onMessage: event("onMessage") },
    action: {
      disable: (...args) => {
        calls.push(["disable", ...args]);
        return disable(...args);
      },
      enable: (...args) => {
        calls.push(["enable", ...args]);
        return enable(...args);
      }
    }
  };
  const context = vm.createContext({ chrome, console: { ...console, debug: (...args) => debug.push(args) } });
  // importScripts resolves each path against the worker's own location, as Chrome does.
  context.importScripts = (...paths) => paths.forEach((path) => runFile(context, posix.join(posix.dirname(WORKER), path)));
  runFile(context, WORKER);
  return { listeners, calls, debug, context };
};

const topFrame = { id: ID, frameId: 0, documentLifecycle: "active", tab: { id: 7 } };

test("the worker loads the sender check with importScripts", () => {
  assert.equal(typeof loadWorker().context.SDT.sender.accepts, "function");
});

test("install and browser start disable the toolbar button for every tab", () => {
  const { listeners, calls } = loadWorker();
  listeners.onInstalled();
  listeners.onStartup();
  assert.deepEqual(calls, [["disable"], ["disable"]]);
});

test("enableAction from the active top frame of a tab enables the button for that tab", () => {
  const { listeners, calls } = loadWorker();
  listeners.onMessage({ type: "enableAction" }, topFrame);
  assert.deepEqual(calls, [["enable", 7]]);
});

test("enableAction from a sender the check rejects changes nothing (BG-2, BG-3)", () => {
  const { listeners, calls } = loadWorker();
  for (const sender of [
    { ...topFrame, id: "another-extension" },
    { ...topFrame, frameId: 2 },
    { ...topFrame, documentLifecycle: "prerender" },
    { ...topFrame, documentLifecycle: "cached" },
    { ...topFrame, documentLifecycle: "pending_deletion" },
    { ...topFrame, documentLifecycle: undefined },
    { ...topFrame, tab: undefined }
  ]) {
    listeners.onMessage({ type: "enableAction" }, sender);
  }
  assert.deepEqual(calls, []);
});

test("other messages change nothing", () => {
  const { listeners, calls } = loadWorker();
  listeners.onMessage({ type: "disableAction" }, topFrame);
  listeners.onMessage(null, topFrame);
  assert.deepEqual(calls, []);
});

test("a failed enable() is caught and logged at debug level, not left unhandled (BG-3)", async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const { listeners, debug } = loadWorker({ enable: async (tabId) => { throw new Error(`No tab with id: ${tabId}.`); } });
    listeners.onMessage({ type: "enableAction" }, topFrame);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
    assert.equal(debug.length, 1);
    assert.match(String(debug[0][1]), /No tab with id: 7/);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});
```

Append to `tests/unit/manifest.test.js`:

```js
test("the toolbar button starts disabled, before the service worker runs (BG-1)", () => {
  assert.equal(manifest.action.default_state, "disabled");
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/unit/sender.test.js tests/unit/background.test.js tests/unit/manifest.test.js`
Expected: FAIL. `sender.test.js` fails to load (`ENOENT` for `src/lib/sender.js`). In `background.test.js`, "loads the sender check", "rejects" (the other extension, other frame, prerender and cached senders all call `enable`) and "a failed enable()" (an unhandled rejection) fail. The manifest case gets `undefined`.

- [ ] **Step 3: Write `src/src/lib/sender.js`**

```js
// SDT.sender: which runtime messages the service worker acts on (BG-2, BG-3). A message counts only
// when it comes from this extension, from the top frame of a tab, and from a document that is
// active: not prerendering, not in the back/forward cache and not being deleted. Chrome has sent
// sender.documentLifecycle since version 106, so a message without it is refused. The service worker
// loads this file with importScripts.
globalThis.SDT ??= {};

SDT.sender = {
  /** Why the service worker should ignore a message from sender, or null to act on it. */
  problem(sender, extensionId) {
    if (!sender || typeof sender.id !== "string" || sender.id !== extensionId) {
      return "another extension";
    }
    if (!Number.isInteger(sender.tab?.id) || sender.tab.id < 0) {
      return "no tab";
    }
    if (sender.frameId !== 0) {
      return "not the top frame";
    }
    if (sender.documentLifecycle !== "active") {
      return "document not active";
    }
    return null;
  },

  /** Whether the service worker should act on a message from sender. */
  accepts(sender, extensionId) {
    return SDT.sender.problem(sender, extensionId) === null;
  }
};
```

- [ ] **Step 4: Rewrite `src/src/bg/background.js`**

```js
// The sender check (src/src/lib/sender.js). A path here resolves against this file's location.
importScripts("../lib/sender.js");

{
  // The toolbar button is disabled by default (action.default_state in manifest.json, and these
  // calls as a fallback) and enabled per tab by status.js, a content script that sends enableAction
  // only on Services Directory pages. Chrome clears per-tab action state on navigation, so leaving
  // the page disables the button again.
  const disableByDefault = () => chrome.action.disable().catch((error) => {
    console.debug("Services Directory Toolkit: could not disable the toolbar button", error);
  });

  chrome.runtime.onInstalled.addListener(disableByDefault);
  chrome.runtime.onStartup.addListener(disableByDefault);

  chrome.runtime.onMessage.addListener((message, sender) => {
    // Only this extension's content script, in the top frame of a tab, in an active document: not a
    // prerendered page or one in the back/forward cache (BG-2).
    if (message?.type !== "enableAction" || !SDT.sender.accepts(sender, chrome.runtime.id)) {
      return;
    }
    // The tab can close before this runs. That is not an error worth reporting (BG-3).
    chrome.action.enable(sender.tab.id).catch((error) => {
      console.debug("Services Directory Toolkit: could not enable the toolbar button", error);
    });
  });
}
```

`importScripts` stays outside the block: it has to run before the block uses `SDT`, and the build's load-order check reads the worker as `[sender.js, background.js]`.

- [ ] **Step 5: Wire it in**

In `src/manifest.json`, add `"default_state": "disabled"` to `action`, after `default_title`:

```json
  "action": {
    "default_icon": "icons/icon19.png",
    "default_title": "Services Directory Toolkit",
    "default_state": "disabled",
    "default_popup": "src/page_action/page_action.html"
  },
```

In `eslint.config.js`, add this entry right after the `src/**/*.js` entry. Flat config merges `languageOptions.globals`, so `SDT` and the WebExtension globals stay:

```js
  {
    // The service worker is a classic worker script: it has importScripts, and no DOM.
    files: ["src/src/bg/**/*.js"],
    languageOptions: { globals: globals.serviceworker }
  },
```

- [ ] **Step 6: Make the manifest-errors test able to fail**

In `tests/e2e/harness.spec.js`, replace the first test with:

```js
test("the extension loads with no manifest errors", async ({ page, extensionId }) => {
  await page.goto("chrome://extensions");
  // Chrome records manifest warnings, such as an unrecognised key, only in Developer mode, so turn it
  // on and reload the extension first. Unknown keys inside a known key, such as action, aren't reported.
  await page.evaluate(() => new Promise((resolve) => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, resolve)));
  await page.evaluate((id) => new Promise((resolve) => chrome.developerPrivate.reload(id, { failQuietly: true }, resolve)), extensionId);
  await expect.poll(() => page.evaluate((id) => new Promise((resolve) => chrome.developerPrivate.getExtensionInfo(id, resolve)), extensionId)
    .then((info) => info.state)).toBe("ENABLED");
  const info = await page.evaluate((id) => new Promise((resolve) => chrome.developerPrivate.getExtensionInfo(id, resolve)), extensionId);
  expect(info.manifestErrors.map((error) => error.message)).toEqual([]);
  expect(info.installWarnings).toEqual([]);
});
```

To see that it can fail, add `"bogus_key": 1` to `src/manifest.json`, run `CHROME_PATH=... npx playwright test tests/e2e/harness.spec.js -g "manifest errors"`, check it fails with `"Unrecognized manifest key 'bogus_key'."`, and remove the key again.

- [ ] **Step 7: Run the checks**

Run: `npm run lint && npm run test:unit && node scripts/build.js`, then the browser tests (Global Constraints command).
Expected: all pass. `unzip -l build/*.zip` lists `src/lib/sender.js`. In the browser tests, the toolbar-button tests in `action-popup.spec.js` (Services Directory page, other page, JSON view, back/forward cache restore) still pass, which shows the check accepts real senders.

- [ ] **Step 8: Commit**

```bash
git add src/src/lib/sender.js src/src/bg/background.js src/manifest.json eslint.config.js tests/unit/sender.test.js tests/unit/background.test.js tests/unit/manifest.test.js tests/e2e/harness.spec.js
git commit -F - <<'EOF'
Check who sent enableAction, and start the button disabled

The service worker enables the toolbar button only for this extension's
content script in the active top frame of a tab, so prerendered pages,
cached pages and frames can't turn it on (BG-2, BG-3). The check is a
pure function in src/src/lib/sender.js, loaded with importScripts. A
failed enable() is caught, and action.default_state starts the button
disabled before the worker runs (BG-1). The harness's manifest check now
turns on Developer mode, without which Chrome reports nothing.
EOF
```

---

## Task 3: `SDT.guard.whenActive`

**Files:**
- Modify: `src/src/lib/guard.js`
- Modify: `tests/unit/guard.test.js` (append)

**Interfaces:**
- Produces: `SDT.guard.whenActive(fn)` (see Public API). Task 4's `status.js` sends `enableAction` through it.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/guard.test.js` (it already has `eventTarget` and `setup`):

```js
test("whenActive runs now on a page that isn't prerendering", () => {
  const doc = Object.assign(eventTarget(), { prerendering: false });
  const { guard } = setup({ document: doc });
  let calls = 0;
  guard.whenActive(() => { calls += 1; });
  assert.equal(calls, 1);
  assert.equal(doc.listeners.length, 0);
});

test("whenActive waits until a prerendered page is shown (BG-2)", () => {
  const doc = Object.assign(eventTarget(), { prerendering: true });
  const { guard } = setup({ document: doc });
  let calls = 0;
  guard.whenActive(() => { calls += 1; });
  assert.equal(calls, 0);
  assert.deepEqual(doc.listeners.map(({ type, options }) => [type, options.once]), [["prerenderingchange", true]]);
  doc.prerendering = false;
  doc.fire("prerenderingchange", doc);
  assert.equal(calls, 1);
});

test("whenActive reads nothing once the context is gone", () => {
  const trap = new Proxy({}, { get(_, key) { throw new Error(`read ${String(key)}`); } });
  const { guard, cutOff } = setup({ document: trap });
  cutOff();
  assert.doesNotThrow(() => guard.whenActive(() => assert.fail("ran")));
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/unit/guard.test.js`
Expected: FAIL, the three new cases, with `guard.whenActive is not a function`.

- [ ] **Step 3: Add `whenActive`**

In `src/src/lib/guard.js`, add after `onLoad` (put a comma after `onLoad`'s closing brace):

```js
  /**
   * Runs fn now, or, on a page that Chrome is prerendering, once the user is shown it. Chrome clears
   * a tab's action state when the prerendered page takes over the tab, and the service worker
   * ignores messages from a document that isn't active (BG-2).
   */
  whenActive(fn) {
    if (!SDT.guard.alive()) {
      return;
    }
    if (document.prerendering) {
      SDT.guard.listen(document, "prerenderingchange", fn, { once: true });
    } else {
      SDT.guard.run(fn);
    }
  }
```

- [ ] **Step 4: Run the tests**

Run: `npm run lint && npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/src/lib/guard.js tests/unit/guard.test.js
git commit -F - <<'EOF'
Add SDT.guard.whenActive for prerendered pages

It runs a function now, or once a prerendered page is shown, so a
message the service worker would refuse from a prerendering document is
sent again when the page becomes active.
EOF
```

---

## Task 4: The status indicator replaces the gear and the in-page form

**Files:**
- Modify: `src/src/inject/status.js` (rewrite)
- Modify: `src/src/inject/inject.css`
- Delete: `src/src/config/options.json`, `src/src/images/settings.svg`
- Modify: `src/manifest.json` (remove `web_accessible_resources`)
- Create: `tests/e2e/indicator.spec.js`
- Modify: `tests/e2e/pages.spec.js`, `tests/e2e/harness.spec.js`, `tests/live/smoke.js`

**Interfaces:**
- Consumes: `SDT.guard.whenActive`, `SDT.guard.wrap`, `SDT.guard.listen`, `SDT.dom.loadElement`, `SDT.page.classify`.
- Produces: the indicator (see Public API). Closes SEC-1, SET-5, SET-6, SET-9 and ADV-3 (form and click handler gone) and ADV-11, and this phase's part of INJ-19 and SET-7.

- [ ] **Step 1: Write the failing tests**

Create `tests/e2e/indicator.spec.js`:

```js
// The status indicator that replaces the gear (store-readiness spec, Phase 3): a ring in the corner
// with an accessible name, a throttled status line, no click handler, and no spin under reduced motion.
import { test, expect, json, REST_ROOT } from "./fixtures.js";

const NAME = "Services Directory Toolkit";
const LOADING = "SD Toolkit: loading";
const DONE = "SD Toolkit: finished loading";
const PRINT_TASK = `${REST_ROOT}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/execute`;

/** Holds the root page's request for the Parcels MapServer until release() is called. */
const holdParcels = (fakeServer) => {
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  fakeServer.override(/^\/arcgis\/rest\/services\/Parcels\/MapServer\?f=json$/, async () => {
    await held;
    return json({ currentVersion: 11.3, serviceDescription: "Held back by the test.", spatialReference: { wkid: 102100, latestWkid: 3857 }, layers: [] });
  });
  return () => release();
};

const animation = (ring) => ring.evaluate((element) => getComputedStyle(element).animationName);

test("the indicator is a named image that spins and says loading while the page is busy", async ({ page, fakeServer }) => {
  const release = holdParcels(fakeServer);
  await page.goto(REST_ROOT);
  const ring = page.getByRole("img", { name: NAME });
  await expect(ring).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(LOADING);
  expect(await animation(ring)).toBe("sdt-spin");
  release();
  await expect(page.getByRole("status")).toHaveText(DONE);
  expect(await animation(ring)).toBe("none");
});

test("the status line stays empty on a page with nothing to load", async ({ page }) => {
  await page.goto(PRINT_TASK);
  await expect(page.getByRole("img", { name: NAME })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.getByRole("status")).toHaveText("");
});

test("the status line changes at most once a second, and its last state always lands", async ({ page }) => {
  await page.goto(PRINT_TASK);
  await expect(page.getByRole("img", { name: NAME })).toBeVisible();
  // Toggle a busy class on <body> every 100 ms for 2.5 s, and record each change to the status line.
  const changes = await page.evaluate(async () => {
    const status = document.querySelector("[role=status]");
    const seen = [];
    new MutationObserver(() => seen.push({ at: performance.now(), text: status.textContent }))
      .observe(status, { childList: true, characterData: true, subtree: true });
    for (let i = 0; i < 25; i++) {
      document.body.classList.toggle("sdt-loading-test");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    document.body.classList.remove("sdt-loading-test");
    await new Promise((resolve) => setTimeout(resolve, 2100));
    return seen;
  });
  expect(changes.length).toBeGreaterThan(1);
  for (let i = 1; i < changes.length; i++) {
    expect(changes[i].at - changes[i - 1].at).toBeGreaterThanOrEqual(990);
  }
  expect(changes.at(-1).text).toBe(DONE);
});

test("under reduced motion the ring doesn't spin while busy", async ({ page, fakeServer }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const release = holdParcels(fakeServer);
  await page.goto(REST_ROOT);
  await expect(page.getByRole("status")).toHaveText(LOADING);
  expect(await animation(page.getByRole("img", { name: NAME }))).toBe("none");
  release();
  await expect(page.getByRole("status")).toHaveText(DONE);
});

test("the indicator has no event listeners and lets clicks through to the page (SEC-1, ADV-3)", async ({ page }) => {
  await page.goto(REST_ROOT);
  const ring = page.getByRole("img", { name: NAME });
  await expect(ring).toBeVisible();
  // CDP lists the listeners of every world, the extension's isolated world included.
  const cdp = await page.context().newCDPSession(page);
  const { result } = await cdp.send("Runtime.evaluate", { expression: "document.querySelector(\"[aria-label='Services Directory Toolkit']\").parentElement" });
  const { listeners } = await cdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId, depth: -1, pierce: true });
  expect(listeners).toEqual([]);
  // The point under the ring belongs to the page.
  const box = await ring.boundingBox();
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[role=img]") ?? null, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(hit).toBeNull();
});

test("clicks the page dispatches on the indicator reach no extension handler", async ({ page, context, seedStorage, readStorage }) => {
  await seedStorage({ autoMetadata: true, showMapImages: false });
  await page.goto(REST_ROOT);
  const ring = page.getByRole("img", { name: NAME });
  await expect(ring).toBeVisible();
  const before = { storage: await readStorage(), html: await ring.evaluate((element) => element.parentElement.outerHTML), pages: context.pages().length };
  // A page script can click any element, including through the extension's own nodes.
  await page.evaluate(() => {
    const target = document.querySelector("[aria-label='Services Directory Toolkit']");
    for (const element of [target, target.parentElement, ...target.querySelectorAll("*")]) {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    }
    target.parentElement.click();
  });
  const box = await ring.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(500);
  expect(await readStorage()).toEqual(before.storage);
  expect(await ring.evaluate((element) => element.parentElement.outerHTML)).toBe(before.html);
  expect(context.pages()).toHaveLength(before.pages);
});
```

In `tests/e2e/pages.spec.js`:
- Rename the first test to "the services root shows the status indicator, spatial reference badges and service details", and replace its three gear lines (`const gear = ...`, `toBeVisible`, the `naturalWidth` poll) with:

  ```js
  await expect(page.getByRole("img", { name: "Services Directory Toolkit" })).toBeVisible();
  ```
- In the query-page test, delete the comment about the settings form's legend and replace the scoped locator with `await expect(page.getByText("Query Helper", { exact: true })).toBeVisible();`. The legend is gone, so the text is unique.
- Rename the JSON-view tests to "a JSON view gets no requests, no indicator and no spinner", and in them and in the TOK-6 test replace `page.locator(".sdt-status-icon")` with `page.getByRole("img", { name: "Services Directory Toolkit" })`.

In `tests/e2e/harness.spec.js`, replace both `page.locator("img.sdt-status-icon")` with `page.getByRole("img", { name: "Services Directory Toolkit" })`.

In `tests/live/smoke.js`, replace the status-icon line with:

```js
  record("services root: status indicator injected", (await count(root.getByRole("img", { name: "Services Directory Toolkit" }))) > 0);
```

- [ ] **Step 2: Run the tests to see them fail**

Run: the browser tests for `tests/e2e/indicator.spec.js tests/e2e/pages.spec.js tests/e2e/harness.spec.js`.
Expected: FAIL. Every indicator test and the changed `pages.spec.js` and harness cases fail with "element(s) not found" for the named image: the gear has no role or name. (Against the old gear, the CDP query finds three `click` listeners; see Facts.)

- [ ] **Step 3: Rewrite `src/src/inject/status.js`**

```js
{
  // The status indicator: a small ring in the bottom-right corner that spins while the extension's
  // scripts are busy, and a status line for screen readers. Busy means a class starting sdt-loading-
  // is on <body>, which inject.js, mapImages.js and queryTest.js set. The indicator takes no clicks
  // and has no click handler (SEC-1, ADV-3); settings live on the options page. Phase 5 moves it
  // into the page as the status bar (#14).
  const SVG = "http://www.w3.org/2000/svg";
  const NAME = "Services Directory Toolkit";
  const LOADING = "SD Toolkit: loading";
  const DONE = "SD Toolkit: finished loading";
  // The status line changes at most once a second, so screen readers aren't flooded (WCAG 4.1.3).
  const THROTTLE_MS = 1000;
  const isBusy = (className) => /(?:^|\s)sdt-loading-/.test(className ?? "");

  // Enable the toolbar button for this tab (see src/src/bg/background.js). Re-send when the page is
  // restored from the back/forward cache, or shown after prerendering, because Chrome clears the
  // tab's action state on navigation, and the service worker ignores messages from documents that
  // aren't active.
  const enableAction = () => chrome.runtime.sendMessage({ type: "enableAction" });

  /** An SVG element with the given attributes. */
  const svgElement = (tag, attributes) => {
    const element = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, String(value));
    }
    return element;
  };

  /** The ring: an opaque disc, a grey track and a teal arc from twelve o'clock (see inject.css). */
  const ring = () => {
    const svg = svgElement("svg", { "class": "sdt-indicator__ring", role: "img", "aria-label": NAME, viewBox: "0 0 24 24", width: 24, height: 24 });
    svg.appendChild(svgElement("circle", { "class": "sdt-indicator__disc", cx: 12, cy: 12, r: 11.5 }));
    svg.appendChild(svgElement("circle", { "class": "sdt-indicator__track", cx: 12, cy: 12, r: 7, "stroke-width": 3 }));
    svg.appendChild(svgElement("circle", { "class": "sdt-indicator__arc", cx: 12, cy: 12, r: 7, "stroke-width": 3, transform: "rotate(-90 12 12)" }));
    return svg;
  };

  /**
   * Keeps the indicator in step with <body>'s busy classes. The spin follows at once; the status
   * line is empty until the first busy state, then says loading or finished, changing at most once a
   * second. A change inside the wait is applied when the wait ends, so the last state always lands.
   */
  const watch = (body, indicator, message) => {
    let seenBusy = false;
    // A live region announces changes, not what it holds when it appears, so the first message
    // also waits a second.
    let lastWrite = performance.now();
    let timer = null;

    const wanted = () => {
      if (isBusy(body.className)) {
        return LOADING;
      }
      return seenBusy ? DONE : "";
    };

    const write = () => {
      timer = null;
      const text = wanted();
      if (text !== message.textContent) {
        message.textContent = text;
        lastWrite = performance.now();
      }
    };

    const update = (records = []) => {
      const busy = isBusy(body.className);
      // A busy class added and removed between two callbacks still counts as busy.
      seenBusy ||= busy || records.some((record) => isBusy(record.oldValue));
      indicator.classList.toggle("sdt-indicator--busy", busy);
      if (timer !== null || wanted() === message.textContent) {
        return;
      }
      timer = setTimeout(SDT.guard.wrap(write), Math.max(0, lastWrite + THROTTLE_MS - performance.now()));
    };

    new MutationObserver(SDT.guard.wrap(update)).observe(body, { attributes: true, attributeFilter: ["class"], attributeOldValue: true });
    update();
  };

  const start = () => {
    // JSON views and pages that aren't Services Directory pages get nothing, not even the button.
    const type = SDT.page.classify(location, document);
    if (type === "jsonView" || type === "other") {
      return;
    }
    SDT.guard.whenActive(enableAction);
    SDT.guard.listen(window, "pageshow", (evt) => evt.persisted && enableAction());

    const indicator = SDT.dom.loadElement("div", { "class": "sdt-indicator" });
    const message = SDT.dom.loadElement("span", { "class": "sdt-visually-hidden", role: "status" });
    indicator.appendChild(ring());
    indicator.appendChild(message);
    document.body.appendChild(indicator);
    watch(document.body, indicator, message);
  };

  SDT.guard.run(start);
}
```

`inject.js` may already have set a busy class when `status.js` starts (its `onLoad` runs at once on a loaded page), so `watch` calls `update()` once itself.

- [ ] **Step 4: Replace the gear and form CSS**

In `src/src/inject/inject.css`:
1. In the rule that starts `.sdt-sidepanel button,`, delete the selectors `.sdt-status button[type=submit],` and `.sdt-status button[type=button]`, so it starts `.sdt-sidepanel button {`.
2. Delete the whole `.sdt-status button[type=reset] { ... }` rule.
3. Delete everything from `.sdt-status {` down to the end of `.sdt-status.sdt-open fieldset { ... }`: the status and open rules, both `sdt-spin` keyframes (with their `-webkit-` prefix), the `.sdt-loading-* .sdt-status-icon` rule, and the `.sdt-status-icon` rules. In its place, before `.sdt-map-image-panel {`, put:

```css
/* The status indicator (status.js). It never takes clicks, so the page under it stays usable. */
.sdt-indicator {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 2147483000;
    width: 24px;
    height: 24px;
    margin: 0;
    padding: 0;
    line-height: 0;
    pointer-events: none;
}

.sdt-indicator__ring {
    display: block;
    width: 24px;
    height: 24px;
}

/* An opaque disc, so the ring keeps its contrast on any page. */
.sdt-indicator__disc {
    fill: #ffffff;
    stroke: #7b8786;
    stroke-width: 1;
}

.sdt-indicator__track {
    fill: none;
    stroke: #d3dad9;
}

/* A quarter of the ring: the circumference is about 44. */
.sdt-indicator__arc {
    fill: none;
    stroke: #0d6b66;
    stroke-dasharray: 11 33;
}

.sdt-indicator--busy .sdt-indicator__ring {
    animation: sdt-spin 1s linear infinite;
}

@keyframes sdt-spin {
    to {
        transform: rotate(360deg);
    }
}

/* No spin under reduced motion: busy shows two opposite quarters instead. */
@media (prefers-reduced-motion: reduce) {
    .sdt-indicator--busy .sdt-indicator__ring {
        animation: none;
    }

    .sdt-indicator--busy .sdt-indicator__arc {
        stroke-dasharray: 11 11;
    }
}

/* Read by screen readers, not shown. */
.sdt-visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    border: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}
```

Afterwards, `grep -n "sdt-status\|sdt-open" src/src/inject/inject.css` prints nothing.

- [ ] **Step 5: Delete the form's files and the web-accessible resources**

```bash
git rm src/src/config/options.json src/src/images/settings.svg
```

In `src/manifest.json`, delete the whole `"web_accessible_resources": [...]` entry, and the comma after `permissions`' closing bracket. Nothing else loads either file: `grep -rn "getURL\|options.json\|settings.svg" src` prints nothing.

- [ ] **Step 6: Run the checks**

Run: `npm run lint && npm run test:unit && node scripts/build.js`, then the browser tests.
Expected: all pass. `guard-entry-points.test.js` still passes: `status.js`'s top level only declares names and calls `SDT.guard.run(start)`. The known bugs are reported as expected failures.

- [ ] **Step 7: Commit**

```bash
git add src/src/inject/status.js src/src/inject/inject.css src/manifest.json tests/e2e/indicator.spec.js tests/e2e/pages.spec.js tests/e2e/harness.spec.js tests/live/smoke.js
git commit -F - <<'EOF'
Replace the gear and its settings form with a status indicator

A 24 px ring in the corner spins while the scripts are busy and has an
accessible name and a throttled status line. It takes no clicks and has
no handlers, so pages can no longer open or drive the settings form
(SEC-1, ADV-3). The form, its CSS, options.json, settings.svg and the
web-accessible resources go (SET-5, SET-6, SET-8, SET-9).
EOF
```

---

## Task 5: The build refuses web-accessible resources

**Files:**
- Modify: `scripts/lib/extension-files.js`
- Modify: `tests/unit/extension-files.test.js`, `tests/unit/build.test.js`, `tests/unit/manifest.test.js` (append)

**Interfaces:**
- Produces: the `web_accessible_resources` problem in `referencedFiles` (see Public API). Closes MAN-1, SEC-4 and SET-8 with Task 4.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/extension-files.test.js`:

```js
test("reports web_accessible_resources, which let any page detect the extension (MAN-1)", (t) => {
  const manifest = { ...MANIFEST, web_accessible_resources: [{ resources: ["img/*"], matches: ["*://*/*"] }] };
  const dir = makeExtension(t, { ...FILES, "manifest.json": JSON.stringify(manifest) });
  assert.deepEqual(referencedFiles(dir).problems, [
    "web_accessible_resources: not allowed, because any page could load these files and detect the extension (MAN-1)"
  ]);
});
```

Append to `tests/unit/build.test.js`:

```js
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
```

Append to `tests/unit/manifest.test.js`:

```js
test("the manifest declares no web-accessible resources (MAN-1, SEC-4, SET-8)", () => {
  assert.equal(Object.hasOwn(manifest, "web_accessible_resources"), false);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/unit/extension-files.test.js tests/unit/build.test.js tests/unit/manifest.test.js`
Expected: FAIL, two cases: the `extension-files` case gets `[]`, and the build exits 0 with the key present. The zip and manifest cases already pass after Task 4.

- [ ] **Step 3: Refuse the key**

In `scripts/lib/extension-files.js`, replace the `for (const entry of manifest.web_accessible_resources || []) { ... }` loop with:

```js
  if (Object.hasOwn(manifest, "web_accessible_resources")) {
    problems.push("web_accessible_resources: not allowed, because any page could load these files and detect the extension (MAN-1)");
  }
```

Delete `globToRegExp`, which nothing uses now. Make the JSDoc's `problems` sentence read: "problems lists missing files, files nothing references, getURL and importScripts calls that can't be checked, scripts that use an SDT namespace before a file that defines it, and any web_accessible_resources key".

- [ ] **Step 4: Run the tests**

Run: `npm run lint && npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/extension-files.js tests/unit/extension-files.test.js tests/unit/build.test.js tests/unit/manifest.test.js
git commit -F - <<'EOF'
Fail the build on web-accessible resources

Any page can load a web-accessible file and so detect the extension
(MAN-1). The build now refuses the key, and a test checks that the
zipped manifest has none.
EOF
```

---

## Task 6: Lint: content scripts never write to `chrome.storage`

**Files:**
- Modify: `eslint.config.js`
- Modify: `tests/unit/lint-rules.test.js` (append)

**Interfaces:**
- Produces: an error under `src/src/inject/**` for a call to `set`, `remove` or `clear` on `<anything>.storage.<area>` (spec section 4.4).

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/lint-rules.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/unit/lint-rules.test.js`
Expected: FAIL, the first new case: each write gets `[]`.

- [ ] **Step 3: Add the rule**

In `eslint.config.js`, before the `LIB_FILE` constant, add:

```js
// Content scripts run on pages the extension doesn't control, so they only read settings. Settings
// change on the options page (store-readiness spec, section 4.4).
const STORAGE_WRITE = "Content scripts never write to chrome.storage. Change settings on the options page.";
const STORAGE_SELECTORS = [{
  selector: "CallExpression[callee.object.object.property.name='storage']:matches([callee.property.name=/^(set|remove|clear)$/], [callee.property.value=/^(set|remove|clear)$/])",
  message: STORAGE_WRITE
}];
```

Add `...STORAGE_SELECTORS` at the end of the `src/src/inject/**/*.js` entry's list, which keeps every list it has:

```js
    rules: { "no-restricted-syntax": ["error", ...BASE_SELECTORS, ...BLOCK_SELECTORS, ...GUARD_SELECTORS, ...NETWORK_SELECTORS, ...AWAIT_SELECTORS, ...STORAGE_SELECTORS] }
```

- [ ] **Step 4: Run the checks**

Run: `npm run lint && npm run test:unit`
Expected: PASS. No content script writes storage after Task 4. (Before Task 4, the rule flags the form's `chrome.storage.sync.set` in `status.js`.)

- [ ] **Step 5: Commit**

```bash
git add eslint.config.js tests/unit/lint-rules.test.js
git commit -F - <<'EOF'
Lint content scripts against writing to chrome.storage

With the in-page form gone, no content script writes settings, and the
rule from spec section 4.4 keeps it that way.
EOF
```

---

## Task 7: URL patterns and the matrix

**Files:**
- Modify: `src/manifest.json` (`content_scripts[].matches`)
- Modify: `tests/fixtures/catalog.js`, `tests/fixtures/pages.js`, `tests/fixtures/fake-arcgis.js`
- Modify: `tests/unit/fake-arcgis.test.js`
- Create: `tests/unit/url-patterns.test.js`, `tests/e2e/url-patterns.spec.js`
- Modify: `tests/e2e/requests.spec.js` (`withToken`)

**Interfaces:**
- Consumes: the indicator from Task 4, as the visible sign that the main scripts ran on a Services Directory page.
- Produces: Decision 1's patterns. Closes PRT-2 and MAN-2 (and TR-22), and this phase's part of QRY-3 and CWS-3.

- [ ] **Step 1: Add the fixtures**

In `tests/fixtures/catalog.js`, add this before `const documentInfo = ...`:

```js
// An asynchronous task: its form is submitJob, not execute.
const summarizeRoutesTask = {
  name: "Summarize Routes",
  json: {
    name: "SummarizeRoutes",
    displayName: "Summarize Routes",
    description: "Summarises an invented route.",
    category: "",
    executionType: "esriExecutionTypeAsynchronous",
    parameters: [
      { name: "Route_Name", dataType: "GPString", displayName: "Route Name", direction: "esriGPParameterDirectionInput", defaultValue: "", parameterType: "esriGPParameterTypeRequired" },
      { name: "Distance_Units", dataType: "GPString", displayName: "Distance Units", direction: "esriGPParameterDirectionInput", defaultValue: "Kilometers", parameterType: "esriGPParameterTypeOptional", choiceList: ["Meters", "Kilometers", "Miles"] },
      { name: "Summary", dataType: "GPString", displayName: "Summary", direction: "esriGPParameterDirectionOutput", defaultValue: null, parameterType: "esriGPParameterTypeRequired" }
    ]
  }
};
```

and this service right after `Transport/Roads` in `catalog.services`:

```js
    {
      name: "Transport/RouteTools",
      type: "GPServer",
      tasks: [summarizeRoutesTask],
      info: {
        serviceDescription: "Summarises invented routes.",
        executionType: "esriExecutionTypeAsynchronous",
        resultMapServerName: "",
        maximumRecords: 1000
      }
    },
```

In `tests/fixtures/pages.js`, replace `executePage` with a version that also renders `submitJob` forms, and add `queryDomainsPage` after it:

```js
  // A task's form: execute for a synchronous task, submitJob for an asynchronous one.
  const executePage = (service, task, params, operation = "execute") => {
    const taskPath = `${servicePath(service)}/${encodeURIComponent(task.name)}`;
    const verb = operation === "submitJob" ? "Submit Job" : "Execute Task";
    return shell({
      title: `${verb}: ${task.name}`,
      breadcrumbs: crumbs(serviceCrumb(service), [task.name, taskPath], [operation, `${taskPath}/${operation}`]),
      body: `<form name="sdform" action="${restPath}${taskPath}/${operation}">
<table class="formTable">
${task.json.parameters
  .filter((parameter) => parameter.direction === "esriGPParameterDirectionInput")
  .map((parameter) => textareaRow(parameter.name, parameter.displayName, params))
  .join("\n")}
<tr><td colspan="2"><b>Options:</b></td></tr>
${textRow("env:outSR", "Output Spatial Reference", params)}
${radioRow("returnZ", "ReturnZ", params, "false")}
${formatRow}
${submitRow(verb)}
</table>
</form>`
    });
  };

  const queryDomainsPage = (service, params) => shell({
    title: `Query Domains: ${service.name} (${service.type})`,
    breadcrumbs: crumbs(serviceCrumb(service), ["queryDomains", `${servicePath(service)}/queryDomains`]),
    body: `<form name="sdform" action="${restPath}${servicePath(service)}/queryDomains">
<table class="formTable">
${textRow("layers", "Layers", params)}
${formatRow}
${submitRow("Query Domains")}
</table>
</form>`
  });
```

Add `queryDomainsPage` to `createPages`' return object and to the named exports below it. Before the login page, add:

```js
// A page outside ArcGIS Server whose path holds /rest/services, such as a site's own API notes. The
// content-script patterns match it, and the scripts must leave it alone.
export const docsPage = () => `<html lang="en">
<head><title>Our REST services</title></head>
<body><h1>Our REST services</h1><p>Invented notes about a web site's own REST services. It is not a Services Directory page.</p></body>
</html>
`;
```

In `tests/fixtures/fake-arcgis.js`:
- Import `docsPage` from `./pages.js` with the other pages.
- In `route`, after the `/other/page` case, add:

  ```js
    if (pathname === "/docs/rest/services/overview") {
      return html(docsPage());
    }
  ```
- In `serviceResource`, after the `find` case, add:

  ```js
    if (first === "queryDomains" && second === undefined && service.type === "FeatureServer") {
      const domains = (service.layers || []).flatMap((layer) => layer.fields.map((field) => field.domain).filter(Boolean));
      return format === "html" ? html(pages.queryDomainsPage(service, params)) : json({ domains }, format);
    }
  ```
- In the task branch, replace the `if (second === "execute") { ... }` block with:

  ```js
      // A synchronous task has an execute form, and an asynchronous one a submitJob form.
      const operation = task.json.executionType === "esriExecutionTypeAsynchronous" ? "submitJob" : "execute";
      if (second === operation) {
        if (format === "html") {
          return html(pages.executePage(service, task, params, operation));
        }
        return json(operation === "execute" ? { results: [], messages: [] } : { jobId: "j0123456789", jobStatus: "esriJobSubmitted" }, format);
      }
  ```

In `tests/unit/fake-arcgis.test.js`, the `Transport` folder now lists two services. Change the folder test's expectation to:

```js
  assert.deepEqual(folder, {
    currentVersion: 11.3,
    folders: [],
    services: [{ name: "Transport/Roads", type: "MapServer" }, { name: "Transport/RouteTools", type: "GPServer" }]
  });
```

and the instance-name test's to `assert.deepEqual(folder.services.map((service) => service.name), ["Transport/Roads", "Transport/RouteTools"]);`. Before the "static assets" test, add:

```js
test("an asynchronous task has a submitJob page and no execute page", () => {
  const server = createFakeArcGIS();
  const task = "/arcgis/rest/services/Transport/RouteTools/GPServer/Summarize%20Routes";
  const page = get(server, `${task}/submitJob`).body;
  assert.match(page, /<title>Submit Job: Summarize Routes<\/title>/);
  assert.match(page, /action="\/arcgis\/rest\/services\/Transport\/RouteTools\/GPServer\/Summarize%20Routes\/submitJob"/);
  assert.match(page, /<textarea id="Distance_Units" name="Distance_Units"/);
  assert.equal(getJson(server, `${task}/submitJob?f=json`).jobStatus, "esriJobSubmitted");
  assert.equal(get(server, `${task}/execute`), null);
  // And a synchronous task has no submitJob page.
  assert.equal(get(server, "/arcgis/rest/services/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/submitJob"), null);
});

test("a FeatureServer's queryDomains page and JSON", () => {
  const server = createFakeArcGIS();
  const page = get(server, "/arcgis/rest/services/Parcels/FeatureServer/queryDomains").body;
  assert.match(page, /<h2>Query Domains: Parcels \(FeatureServer\)<\/h2>/);
  assert.deepEqual(getJson(server, "/arcgis/rest/services/Parcels/FeatureServer/queryDomains?f=json").domains.map((domain) => domain.name), ["LandUse"]);
  assert.equal(get(server, "/arcgis/rest/services/Parcels/MapServer/queryDomains"), null);
});

test("a page outside ArcGIS Server whose path holds /rest/services", () => {
  assert.match(get(createFakeArcGIS(), "/docs/rest/services/overview").body, /not a Services Directory page/);
});
```

Run: `node --test tests/unit/fake-arcgis.test.js`
Expected: PASS. The new GP service is in no root listing (the root's three `.sdt-datablock`s stay three), and the link filters in `inject.js` and `mapImages.js` skip `GPServer` links.

- [ ] **Step 2: Write the failing matrix tests**

Create `tests/unit/url-patterns.test.js`:

```js
// Which content-script groups each URL gets, from the manifest's match patterns (MAN-2, PRT-2, QRY-3,
// TR-22). matches() follows Chrome's rules for the patterns the manifest uses: the scheme * means
// http or https, the host * means any host, and the path pattern is matched against the URL's path
// and query string together, with * matching any characters, / and ? included. A probe extension
// with these patterns, loaded in Chromium 141 and in Chrome for Testing 120 (2026-10-21), got the
// groups below for the same kinds of URL in both. The browser tests in
// tests/e2e/url-patterns.spec.js check what runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SRC } from "./helpers/sdt.js";

const manifest = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));

const matches = (pattern, href) => {
  const [, scheme, host, path] = pattern.match(/^(\*|https?):\/\/([^/]+)(\/.*)$/);
  assert.equal(host, "*", `${pattern}: only the host * is modelled`);
  const url = new URL(href);
  const schemes = scheme === "*" ? ["http:", "https:"] : [`${scheme}:`];
  const glob = new RegExp(`^${path.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return schemes.includes(url.protocol) && glob.test(`${url.pathname}${url.search}`);
};

/** The content-script group that loads file, by its last script, or the CSS-only group for "css". */
const group = (file) => manifest.content_scripts.find((entry) => (file === "css" ? !entry.js : entry.js?.at(-1) === file));
const GROUPS = { main: group("src/inject/mapImages.js"), query: group("src/inject/queryTest.js"), gp: group("src/inject/printTask.js") };

const groupsFor = (href) => Object.entries(GROUPS)
  .filter(([, entry]) => entry.matches.some((pattern) => matches(pattern, href)))
  .map(([name]) => name);

const ROOT = "https://gis.example.org/arcgis/rest/services";
const TASK = `${ROOT}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task`;

const CASES = {
  // The services root, with and without an instance path, a trailing slash or a query (MAN-2, TR-22).
  [ROOT]: ["main"],
  [`${ROOT}/`]: ["main"],
  [`${ROOT}?f=html`]: ["main"],
  [`${ROOT}?token=abc`]: ["main"],
  [`${ROOT}/?token=abc`]: ["main"],
  "https://gis.example.org/rest/services": ["main"],
  "https://gis.example.org/rest/services?f=html": ["main"],
  "https://gis.example.org/a/b/rest/services": ["main"],
  "http://gis.example.org/arcgis/rest/services": ["main"],
  // Folders, services and layers, with a query.
  [`${ROOT}/Utilities?token=abc`]: ["main"],
  [`${ROOT}/Parcels/MapServer`]: ["main"],
  "https://gis.example.org/rest/services/Parcels/MapServer": ["main"],
  [`${ROOT}/Parcels/MapServer/0?f=html`]: ["main"],
  "https://services9.arcgis.com/Fk3Org9xQ/arcgis/rest/services/Parcels/FeatureServer": ["main"],
  // The query operation only, and not the other operations whose names start with query (QRY-3).
  [`${ROOT}/Parcels/MapServer/0/query`]: ["main", "query"],
  [`${ROOT}/Parcels/MapServer/0/query?where=1%3D1&f=html`]: ["main", "query"],
  [`${ROOT}/Parcels/FeatureServer/query`]: ["main", "query"],
  "https://gis.example.org/rest/services/Parcels/MapServer/0/query": ["main", "query"],
  [`${ROOT}/Parcels/MapServer/0/queryDomains`]: ["main"],
  [`${ROOT}/Parcels/FeatureServer/queryDomains?layers=0`]: ["main"],
  [`${ROOT}/Parcels/MapServer/0/queryRelatedRecords`]: ["main"],
  [`${ROOT}/Parcels/MapServer/0/query/`]: ["main"],
  // GP forms, in Esri's casing (PRT-2), and nothing else under a task.
  [`${TASK}/execute`]: ["main", "gp"],
  [`${TASK}/execute?f=html`]: ["main", "gp"],
  [`${ROOT}/Transport/RouteTools/GPServer/Summarize%20Routes/submitJob`]: ["main", "gp"],
  [`${ROOT}/Transport/RouteTools/GPServer/Summarize%20Routes/submitJob?f=html`]: ["main", "gp"],
  "https://gis.example.org/rest/services/PrintingTools/GPServer/Export%20Web%20Map%20Task/execute": ["main", "gp"],
  [`${ROOT}/Transport/RouteTools/GPServer/Summarize%20Routes/submitjob`]: ["main"],
  [`${ROOT}/Transport/RouteTools/GPServer/Summarize%20Routes/jobs/j0123456789`]: ["main"],
  [`${TASK}/executeNow`]: ["main"],
  [`${TASK}`]: ["main"],
  // Not Services Directory paths. Patterns are case-sensitive, so /REST/services gets nothing.
  "https://gis.example.org/arcgis/rest/servicesX": [],
  "https://gis.example.org/arcgis/REST/services": [],
  "https://gis.example.org/arcgis/rest": [],
  "https://gis.example.org/other/page": [],
  // Patterns also match the query string, and other sites' paths: the classifier sorts these out.
  "https://gis.example.org/docs/rest/services/overview": ["main"],
  "https://gis.example.org/other/page?x=/arcgis/rest/services/": ["main"],
  "https://gis.example.org/evil.html?x=/rest/services": ["main"]
};

for (const [href, expected] of Object.entries(CASES)) {
  test(`content-script groups for ${href}`, () => {
    assert.deepEqual(groupsFor(href), expected);
  });
}

test("the stylesheet goes wherever the main scripts go", () => {
  assert.deepEqual(group("css").matches, GROUPS.main.matches);
});

test("no pattern is listed twice in a group", () => {
  for (const entry of manifest.content_scripts) {
    assert.equal(new Set(entry.matches).size, entry.matches.length);
  }
});
```

Create `tests/e2e/url-patterns.spec.js`:

```js
// The URL-pattern matrix (store-readiness spec, Phase 3): what the extension does on each kind of URL
// the fake server can serve. A Services Directory page gets the status indicator and an enabled
// toolbar button, and its own helper where it has one. A JSON view, or a page that only has
// /rest/services in its path, gets nothing. tests/unit/url-patterns.test.js checks the patterns
// themselves against many more URLs.
import { test, expect, FAKE_ORIGIN, REST_ROOT, SERVER_TOKENS } from "./fixtures.js";

const NAME = "Services Directory Toolkit";
const TOKEN = SERVER_TOKENS.jsmith;

// helper: the extension's own addition on that page, if any: "query" for the Query Helper, "gp" for
// the print script's dropdowns.
const CASES = [
  { title: "the services root", url: REST_ROOT, sd: true },
  { title: "the services root with ?f=html (MAN-2)", url: `${REST_ROOT}?f=html`, sd: true },
  { title: "the services root with ?token= (TR-22)", url: `${REST_ROOT}?token=${TOKEN}`, sd: true },
  { title: "a folder with ?token=", url: `${REST_ROOT}/Utilities?token=${TOKEN}`, sd: true },
  { title: "a service", url: `${REST_ROOT}/Parcels/MapServer`, sd: true },
  { title: "a layer", url: `${REST_ROOT}/Parcels/MapServer/0`, sd: true },
  { title: "a query form", url: `${REST_ROOT}/Parcels/MapServer/0/query`, sd: true, helper: "query" },
  { title: "a queryDomains form, which isn't a query (QRY-3)", url: `${REST_ROOT}/Parcels/FeatureServer/queryDomains`, sd: true },
  { title: "a GP execute form", url: `${REST_ROOT}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/execute`, sd: true, helper: "gp" },
  { title: "a GP submitJob form (PRT-2)", url: `${REST_ROOT}/Transport/RouteTools/GPServer/Summarize%20Routes/submitJob`, sd: true, helper: "gp" },
  { title: "a page outside ArcGIS Server with /rest/services in its path", url: `${FAKE_ORIGIN}/docs/rest/services/overview`, sd: false },
  { title: "the services root as JSON", url: `${REST_ROOT}?f=json`, sd: false },
  { title: "a layer as JSON", url: `${REST_ROOT}/Parcels/MapServer/0?f=pjson`, sd: false }
];

const queryHelper = (page) => page.getByText("Query Helper", { exact: true });
// The print script turns each choice list into a dropdown: Format on the print task, Distance Units
// on the route task.
const gpDropdown = (page) => page.locator("select:has(option[value='PNG32']), select:has(option[value='Kilometers'])");

for (const { title, url, sd, helper } of CASES) {
  test(`URL patterns: ${title}`, async ({ page, actionEnabled }) => {
    await page.goto(url);
    const ring = page.getByRole("img", { name: NAME });
    if (sd) {
      await expect(ring).toBeVisible();
      await expect.poll(() => actionEnabled(page)).toBe(true);
    } else {
      // Nothing signals that the scripts have decided to do nothing, so give them a moment.
      await page.waitForTimeout(1000);
      await expect(ring).toHaveCount(0);
      expect(await actionEnabled(page)).toBe(false);
    }
    await expect(queryHelper(page)).toHaveCount(helper === "query" ? 1 : 0);
    await expect(gpDropdown(page)).toHaveCount(helper === "gp" ? 1 : 0);
  });
}

test("the services root opened with ?token= sends the token in each metadata request's body (TR-22)", async ({ page, fakeServer }) => {
  await page.goto(`${REST_ROOT}?token=${TOKEN}`);
  await expect(page.locator(".sdt-datablock")).toHaveCount(3);
  const metadata = fakeServer.calls.filter((call) => /\/(MapServer|FeatureServer|ImageServer)$/.test(call.path));
  expect(metadata).toHaveLength(3);
  for (const call of metadata) {
    expect(call.method).toBe("POST");
    expect(call.query).toEqual({});
    expect(call.body).toEqual({ f: "json", token: TOKEN });
  }
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `node --test tests/unit/url-patterns.test.js`, then the browser tests for `tests/e2e/url-patterns.spec.js`.
Expected: FAIL. In the unit matrix, 15 cases fail on today's patterns:
- the root with `?f=html` and with `?token=abc`; `/rest/services` with no instance path, with and without `?f=html`; and `/rest/services/Parcels/MapServer` (MAN-2, TR-22)
- `/rest/services/Parcels/MapServer/0/query` with no instance path
- `queryDomains` (both), `queryRelatedRecords` and `query/`, which today's `/query*` pattern lets in (QRY-3)
- both `submitJob` URLs, the `execute` URL with no instance path, and the lower-case `submitjob` and `executeNow`, which today's `*execute*` and `*submitjob*` patterns get wrong (PRT-2)

In the browser, "the services root with ?f=html", "the services root with ?token=", the `submitJob` form and the token test fail: no content script runs there.

- [ ] **Step 4: Change the patterns**

In `src/manifest.json`, set the `matches` of the CSS group and of the main group (the one ending `src/inject/mapImages.js`) to:

```json
      "matches": [
        "*://*/rest/services",
        "*://*/rest/services?*",
        "*://*/rest/services/*",
        "*://*/*/rest/services",
        "*://*/*/rest/services?*",
        "*://*/*/rest/services/*"
      ],
```

the Query Helper group's to:

```json
      "matches": [
        "*://*/rest/services/*/query",
        "*://*/rest/services/*/query?*",
        "*://*/*/rest/services/*/query",
        "*://*/*/rest/services/*/query?*"
      ],
```

and the GP group's to:

```json
      "matches": [
        "*://*/rest/services/*/GPServer/*/execute",
        "*://*/rest/services/*/GPServer/*/execute?*",
        "*://*/rest/services/*/GPServer/*/submitJob",
        "*://*/rest/services/*/GPServer/*/submitJob?*",
        "*://*/*/rest/services/*/GPServer/*/execute",
        "*://*/*/rest/services/*/GPServer/*/execute?*",
        "*://*/*/rest/services/*/GPServer/*/submitJob",
        "*://*/*/rest/services/*/GPServer/*/submitJob?*"
      ],
```

In `tests/e2e/requests.spec.js`, replace the comment and `withToken` with:

```js
// The services root opened with ?token= (TR-22).
const withToken = (root, token) => `${root}?token=${token}`;
```

- [ ] **Step 5: Run the checks**

Run: `npm run lint && npm run test:unit && node scripts/build.js`, then all the browser tests.
Expected: all pass. `requests.spec.js`'s token tests now open the root without the trailing slash. The known bugs are reported as expected failures.

- [ ] **Step 6: Commit**

```bash
git add src/manifest.json tests/fixtures tests/unit/fake-arcgis.test.js tests/unit/url-patterns.test.js tests/e2e/url-patterns.spec.js tests/e2e/requests.spec.js
git commit -F - <<'EOF'
Match the services root with a query, submitJob, and exact query

The content scripts now run on /rest/services with or without an
instance path or a query string (MAN-2, TR-22), on GP execute and
submitJob forms in Esri's casing (PRT-2), and the Query Helper's group
only on .../query (QRY-3). A unit matrix checks the patterns and a
browser matrix checks what runs, with new fixtures for submitJob,
queryDomains and a non-ArcGIS /rest/services page.
EOF
```

---

## Task 8: axe-core, and the popup's Options link

**Files:**
- Modify: `package.json`, `package-lock.json` (devDependency)
- Create: `tests/e2e/axe.js`, `tests/e2e/accessibility.spec.js`
- Create: `src/src/page_action/options_link.js`
- Modify: `src/src/page_action/page_action.html`, `src/src/page_action/page_action.css`
- Modify: `tests/e2e/action-popup.spec.js` (append)

**Interfaces:**
- Produces: `axeViolations` (see Public API); the popup's Options link. Closes this phase's part of SET-7 (the indicator) with Task 4.

- [ ] **Step 1: Add the dependency and the helper**

Run: `npm install --save-dev --save-exact @axe-core/playwright@4.14.0`
Expected: `package.json` gets `"@axe-core/playwright": "4.14.0"` in `devDependencies`, and `package-lock.json` adds it and `axe-core` 4.14.x. `npm audit` reports nothing new.

Create `tests/e2e/axe.js`:

```js
// Runs axe-core on a page in the light and the dark colour scheme (store-readiness spec, section 4.2).
// On host pages, scope it to the extension's own elements: the page's markup isn't ours to fix. Issue
// #13 extends this helper with a dark host page.
import AxeBuilder from "@axe-core/playwright";

export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
export const COLOR_SCHEMES = ["light", "dark"];

/**
 * Returns { light: [...], dark: [...] }, each a list of "rule: target, target" strings, empty when
 * axe finds nothing. include is a CSS selector for the elements to check, or omitted for the whole
 * page. axe fails when include matches nothing, so a renamed element can't pass by being missed.
 */
export const axeViolations = async (page, { include } = {}) => {
  const results = {};
  for (const colorScheme of COLOR_SCHEMES) {
    await page.emulateMedia({ colorScheme });
    const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
    if (include) {
      builder.include(include);
    }
    const { violations } = await builder.analyze();
    results[colorScheme] = violations.map(({ id, nodes }) => `${id}: ${nodes.map((node) => node.target.join(" ")).join(", ")}`);
  }
  return results;
};
```

- [ ] **Step 2: Write the failing tests**

Create `tests/e2e/accessibility.spec.js`:

```js
// axe-core and keyboard-only checks for what Phase 3 adds: the status indicator and the popup
// (store-readiness spec, section 4.2).
import { test, expect, REST_ROOT } from "./fixtures.js";
import { axeViolations } from "./axe.js";

const NAME = "Services Directory Toolkit";
const NO_VIOLATIONS = { light: [], dark: [] };

test("axe finds nothing wrong with the status indicator, in light and dark", async ({ page }) => {
  await page.goto(REST_ROOT);
  await expect(page.getByRole("status")).toHaveText("SD Toolkit: finished loading");
  expect(await axeViolations(page, { include: ".sdt-indicator" })).toEqual(NO_VIOLATIONS);
});

test("axe finds nothing wrong with the popup, in light and dark", async ({ openPopupTab }) => {
  // f=html can be trimmed, so the URL tools show too.
  const popup = await openPopupTab(`${REST_ROOT}/Parcels/MapServer?f=html`);
  await expect(popup.getByRole("button", { name: "Copy to Clipboard" })).toBeVisible();
  expect(await axeViolations(popup)).toEqual(NO_VIOLATIONS);
});

test("the keyboard never reaches the status indicator", async ({ page }) => {
  await page.goto(REST_ROOT);
  await expect(page.getByRole("img", { name: NAME })).toBeVisible();
  const links = await page.locator("a[href]").count();
  for (let i = 0; i <= links; i++) {
    await page.keyboard.press("Tab");
    // The indicator is the ring's parent element.
    const inIndicator = await page.evaluate((name) => document.querySelector(`[aria-label="${name}"]`).parentElement.contains(document.activeElement), NAME);
    expect(inIndicator).toBe(false);
  }
});

test("every popup control is reachable with Tab, in order, and Options opens with Enter", async ({ openPopupTab, context, extensionId }) => {
  const popup = await openPopupTab(`${REST_ROOT}/Parcels/MapServer?f=html`);
  await expect(popup.getByRole("button", { name: "Copy to Clipboard" })).toBeVisible();
  const order = [];
  for (let i = 0; i < 5; i++) {
    await popup.keyboard.press("Tab");
    order.push(await popup.evaluate(() => {
      const element = document.activeElement;
      return `${element.tagName.toLowerCase()} ${element.getAttribute("aria-label") || element.placeholder || element.textContent.trim()}`;
    }));
  }
  expect(order).toEqual([
    "input Shortened URL",
    "button Copy to Clipboard",
    "input Searches current folder and subdirectories",
    "button Search",
    "a Options"
  ]);
  const opened = context.waitForEvent("page");
  await popup.keyboard.press("Enter");
  await expect(await opened).toHaveURL(`chrome-extension://${extensionId}/src/options/options.html`);
  // The popup stays where it is: the link's own navigation is cancelled.
  expect(popup.url()).toBe(`chrome-extension://${extensionId}/src/page_action/page_action.html`);
});

test("the popup search runs from the keyboard", async ({ openPopupTab }) => {
  const popup = await openPopupTab(`${REST_ROOT}/Transport/Roads/MapServer`);
  await popup.getByPlaceholder("Searches current folder and subdirectories").focus();
  await popup.keyboard.type("Roads");
  await popup.keyboard.press("Tab");
  await popup.keyboard.press("Enter");
  await expect(popup.getByRole("button", { name: "Search" })).toBeEnabled();
  await expect(popup.locator("#searchresults a")).not.toHaveCount(0);
});
```

Append to `tests/e2e/action-popup.spec.js`:

```js
test("the popup's Options link opens the options page", async ({ openPopupTab, context, extensionId }) => {
  const popup = await openPopupTab(SERVICE_PAGE);
  const link = popup.getByRole("link", { name: "Options" });
  await expect(link).toHaveAttribute("href", "../options/options.html");
  const opened = context.waitForEvent("page");
  await link.click();
  await expect(await opened).toHaveURL(`chrome-extension://${extensionId}/src/options/options.html`);
  expect(popup.url()).toBe(`chrome-extension://${extensionId}/src/page_action/page_action.html`);
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: the browser tests for `tests/e2e/accessibility.spec.js tests/e2e/action-popup.spec.js`.
Expected: FAIL, three tests. The popup's axe run reports `html-has-lang: html`, `label: #urlshortblank` and `target-size: #copybtn` in both schemes; the Tab order starts with an unnamed `input` and has no Options link; and the Options link test finds no link. The indicator's axe run, the indicator keyboard test and the keyboard search pass already.

- [ ] **Step 4: Fix the popup and add the link**

In `src/src/page_action/page_action.html`:
- Change `<html>` to `<html lang="en">`.
- Give the URL field a name: `<input style="width: 100%;" type="text" id="urlshortblank" aria-label="Shortened URL" />`.
- After `</form>`, add `<p id="optionsfoot"><a id="optionslink" href="../options/options.html">Options</a></p>` (tab-indented like the other lines).
- After `<script src="url_shortener.js"></script>`, add `<script src="options_link.js"></script>`.

In `src/src/page_action/page_action.css`, add `min-height: 24px;` with the comment `/* At least 24 px tall, the WCAG 2.2 target size. */` as the first declaration of the `button` rule, and append:

```css
/* The Options link: a 24 px tall target (WCAG 2.2 target size). */
#optionsfoot {
  margin: 0.5em 0 0;
}
#optionslink {
  display: inline-block;
  min-height: 24px;
  line-height: 24px;
}
```

Create `src/src/page_action/options_link.js`:

```js
{
  // The Options link opens the options page in its own tab, or focuses it if it is already open. The
  // href keeps it a real link for keyboard and screen-reader users. Phase 9 replaces it with All
  // settings beside the quick switches (#24).
  document.getElementById("optionslink").addEventListener("click", (event) => {
    event.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}
```

- [ ] **Step 5: Run the checks**

Run: `npm run lint && npm run test:unit && node scripts/build.js`, then all the browser tests.
Expected: all pass. The zip includes `src/page_action/options_link.js`, which `page_action.html` references. The `@cdp` tests still find `#urlshortblank`, `#searchblank` and `#searchbtn`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tests/e2e/axe.js tests/e2e/accessibility.spec.js tests/e2e/action-popup.spec.js src/src/page_action
git commit -F - <<'EOF'
Add an Options link to the popup, and check it with axe

The popup gets an Options link that opens the options page, now that
the in-page form is gone. @axe-core/playwright runs the WCAG 2.2 AA tags
on the indicator and the popup, in light and dark, and keyboard tests
cover the popup's controls and keep the indicator out of the tab order.
The popup gets lang, a name for its URL field and 24 px targets.
EOF
```

---

## Task 9: `short_name`

**Files:**
- Modify: `src/manifest.json`
- Modify: `tests/unit/manifest.test.js` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/manifest.test.js`:

```js
test("short_name is SD Toolkit, within the 12 characters Chrome shows (CWS-4, MAN-4)", () => {
  assert.equal(manifest.short_name, "SD Toolkit");
  assert.ok(manifest.short_name.length <= 12);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/unit/manifest.test.js`
Expected: FAIL: `'Services Directory Toolkit' !== 'SD Toolkit'`.

- [ ] **Step 3: Change it**

In `src/manifest.json`, set `"short_name": "SD Toolkit"`. The toolbar icon stays `icons/icon19.png` until #55 (Decision 5).

- [ ] **Step 4: Run the checks and commit**

Run: `npm run lint && npm run test:unit`
Expected: PASS.

```bash
git add src/manifest.json tests/unit/manifest.test.js
git commit -F - <<'EOF'
Shorten short_name to SD Toolkit

Chrome shows at most 12 characters of short_name (CWS-4, MAN-4). The
toolbar icon dictionary waits for the Track S artwork in #55.
EOF
```

---

## Task 10: Docs, the specs, the known bugs, and the PR

**Files:**
- Modify: `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `.coderabbit.yaml`
- Modify: `docs/superpowers/specs/2026-10-09-store-readiness-design.md`, `docs/superpowers/specs/2026-10-13-token-support-design.md`

- [ ] **Step 1: Re-check the known bugs**

Run: `SHOW_KNOWN_BUGS=1 CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test tests/e2e/known-bugs.spec.js`
Expected: the eight `knownBug()` cases fail on these lines of `known-bugs.spec.js`, as on `main` before this phase: INJ-2 at 46, INJ-3 at 59, INJ-11 at 65, QRY-1 at 87, SET-1 at 93 (the options page breaks on a stored `nothing`, with a console error), SET-3 at 103, POP-2 at 122 (with a console error), POP-3 at 131. SET-1 and SET-3 stay Phase 4's. If a line differs, find out why before going on: a case that now fails in its setup no longer tests its bug.

- [ ] **Step 2: Update `CLAUDE.md`**

- **Commands, `npm run lint`:** change "content scripts must add listeners, timers and `chrome.*` callbacks through `SDT.guard`" to "content scripts must add listeners, timers and `chrome.*` callbacks through `SDT.guard` and may not call `chrome.storage.*.set`, `remove` or `clear`".
- **Commands, `npm run build`:** after "Only files the extension references ship (see `scripts/lib/extension-files.js`)", add ", including those the service worker loads with `importScripts`". Change the failure list to: "a missing or unreferenced file, a `chrome.runtime.getURL` or `importScripts` call without string literals, a `web_accessible_resources` key, a version mismatch between `package.json` and `src/manifest.json`, or a content-script group, extension page or service worker that loads a script using an `SDT` namespace before the lib file that defines it".
- **Browser tests:** after the sentence on the fixtures' two files, add: "They include an asynchronous GP task with a `submitJob` form (`Transport/RouteTools`), a FeatureServer `queryDomains` page, and `/docs/rest/services/overview`, a page outside ArcGIS Server whose path holds `/rest/services`." After the `requests.spec.js` sentence, add: "`tests/unit/url-patterns.test.js` and `tests/e2e/url-patterns.spec.js` are the URL-pattern matrix. `tests/e2e/axe.js`'s `axeViolations(page, { include })` runs axe-core with the WCAG 2.2 AA tags in the light and dark colour schemes; on host pages, pass `include` to scope it to the extension's elements. The harness's manifest check turns on Developer mode and reloads the extension, because Chrome reports unrecognised manifest keys only then, and never unknown keys inside `action`."
- **Layout:** replace the example sentence with: "For example, the manifest's `src/inject/inject.js` is **`src/src/inject/inject.js`**. `importScripts` paths resolve against the service worker's own file, so `background.js` loads `../lib/sender.js`."
- **Architecture, the content-script list:**
  - "`inject.js`, `status.js`, `mapImages.js` (and `inject.css`) run on every `rest/services` page" becomes "... run on `/rest/services`, with or without an instance path before it, a query string after it, or anything below it".
  - The `status.js` line becomes: "`status.js` shows the status indicator, a 24 px ring in the bottom-right corner that spins while any `sdt-loading-*` class is on `<body>`, with a visually hidden `role="status"` line that says "SD Toolkit: loading" and then "SD Toolkit: finished loading", at most once a second. It takes no clicks and has no listeners. It also enables the toolbar button. Settings are on the options page, which the popup's Options link opens."
  - "`queryTest.js` runs on `.../query` pages" becomes "runs on `.../query` operations, with or without a query string".
  - "`printTask.js` runs on `execute`/`submitjob` pages" becomes "runs on GP `execute` and `submitJob` pages, in Esri's casing".
- **Architecture, the namespaces paragraph:** after the list of namespaces, add: "`src/src/lib/sender.js` (`SDT.sender`, the service worker's sender check) is in no content-script group: the service worker loads it with `importScripts`, and the build checks that load order too. `SDT.guard.whenActive` runs a function now, or once a prerendered page is shown."
- **Architecture, the MAN-2 paragraph:** replace "The content-script patterns match the path and the query string together, and none of them matches ... Tests open it as `.../rest/services/?token=`." with: "The content-script patterns match the path and the query string together, and are case-sensitive, so they follow Esri's casing. They also match pages that aren't Services Directory pages, such as `/docs/rest/services/overview` or `/page?x=/rest/services`, which the classifier turns away. A Query Helper pattern ends in `/query` or `/query?*`, so `queryDomains` and `query/` don't get it, and the GP patterns name `GPServer/*/execute` and `GPServer/*/submitJob`."
- **Architecture, Background:** replace the paragraph's first two sentences with: "**Background** (`src/src/bg/background.js`) is a classic service worker that loads `src/src/lib/sender.js` with `importScripts`. The toolbar button starts disabled (`action.default_state: "disabled"`, with `chrome.action.disable()` on install and browser start as a fallback). `status.js` sends an `enableAction` message on Services Directory pages, through `SDT.guard.whenActive` (so a prerendered page sends it once shown) and again after a back/forward cache restore, but not on JSON views or other pages the patterns match. The service worker acts on it only when `SDT.sender.accepts(sender, chrome.runtime.id)`: this extension, a tab, its top frame and `documentLifecycle` `"active"`. It then enables the button for that tab, and logs a failed `enable()` with `console.debug`." Keep the rest of the paragraph.
- **Architecture, Page action popup:** after "`url_shortener.js` strips unneeded query parameters.", add: "`options_link.js` makes the Options link at the foot of the popup open the options page with `chrome.runtime.openOptionsPage()`." and change the next sentence's "Both read" to "The search and the shortener read".
- **Settings:** delete item 2 (`src/src/config/options.json`) and renumber. Replace the first "already disagree" bullet with: "For "do nothing", the options page stores `donothing`. The in-page form, removed in Phase 3, stored `nothing`, and the options page still breaks on a stored `nothing` (SET-1)." In the second bullet, change "while both settings UIs show a web map" to "while the options page shows a web map".

- [ ] **Step 3: Update `README.md`**

In "Changes made on top of Ken's last commit", add after the Manifest V3 bullet:

```markdown
- Replaced the gear and its in-page settings form with a small status indicator that takes no clicks. It spins while the extension loads data and tells screen readers when it has finished. Settings are on the options page, which the popup's new Options link opens.
- Ran on the services root when its URL has a query string, such as `?f=html` or `?token=`, and on geoprocessing `submitJob` pages. The Query Helper now appears only on query pages.
- Turned the toolbar button on only from the top frame of the page in the tab, not from frames, prerendered pages or pages in the back/forward cache.
- Removed the extension's web-accessible files, which let any site detect that it was installed.
```

- [ ] **Step 4: Update `CONTRIBUTING.md`**

At the end of the shared-code bullet, add: "The service worker loads the lib files it needs with `importScripts` (today only `src/src/lib/sender.js`); the build counts them and checks their order. Content scripts only read settings: lint rejects `chrome.storage.*.set`, `remove` and `clear` under `src/src/inject/`." After the `npm test` bullet, add:

```markdown
- UI the extension adds gets an axe-core check through `tests/e2e/axe.js`, in the light and dark colour schemes, scoped to the extension's own elements on host pages, and a keyboard-only test.
```

- [ ] **Step 5: Update `.coderabbit.yaml`**

- In the `src/src/lib/**` instructions, after "which the build checks.", add: "sender.js is the exception: only the service worker loads it, with importScripts."
- In the `src/src/inject/**` instructions, add: "Content scripts never write to chrome.storage (set, remove or clear); lint enforces it. The status indicator in status.js has no listeners and pointer-events: none; flag any handler added to it."
- In the `src/manifest.json` instructions, replace "The toolbar button is enabled by an enableAction message from status.js, not by declarativeContent rules; flag any attempt to reintroduce them." with "The toolbar button starts disabled (action.default_state) and is enabled by an enableAction message from status.js, which the service worker accepts only through SDT.sender; flag any declarativeContent rule. Flag web_accessible_resources, which the build refuses. Content-script patterns follow Esri's casing: the Query Helper group matches only .../query, and the GP group only GPServer/*/execute and GPServer/*/submitJob."
- Change the path `src/src/{options,config}/**` to `src/src/options/**`, and its instructions to "Settings defaults are repeated in places that must agree: options.html/options.js and each content script's chrome.storage.sync.get defaults. Flag keys, values or defaults that diverge."
- Add a path instruction:

  ```yaml
      - path: "src/src/bg/**"
        instructions: |
          Classic service worker. It acts on a runtime message only when
          SDT.sender.accepts(sender, chrome.runtime.id) is true, and catches rejected chrome.action
          promises. Flag a handler that skips the check or leaves a promise unhandled.
  ```

- [ ] **Step 6: Update the specs**

In `docs/superpowers/specs/2026-10-09-store-readiness-design.md`:
- Under "Facts verified during review", add:

  ```markdown
  - **Phase 3 checks (2026-10-21), in Chromium 141 and Chrome for Testing 120:**
    - `action.default_state: "disabled"` keeps the button disabled with no `chrome.action.disable()` call, and raises no manifest warning.
    - Both browsers run the same content-script groups for the Phase 3 patterns on every probed URL.
    - A content script's message carries `frameId: 0` and `documentLifecycle: "active"` at load and after a back/forward cache restore.
    - Chrome reports an unrecognised manifest key only in Developer mode, after a reload, and never an unknown key inside `action`.
    - CDP `DOMDebugger.getEventListeners` lists listeners added in an extension's isolated world.
  ```
- In Phase 3's "Manifest metadata", after "once the Track S artwork exists", add: "That waits for #55, because the artwork (#50) doesn't exist yet (owner, 2026-10-21)."

In `docs/superpowers/specs/2026-10-13-token-support-design.md`, change TR-22's resolution to "Already MAN-2; closed in Phase 3 by the `?`-query patterns".

- [ ] **Step 7: Final verification**

Run: `npm run lint && npm run test:unit && node scripts/build.js && rm -rf dist && unzip -q build/*.zip -d dist`, then the browser tests twice, with `EXT_PATH=dist` and without, then `git status --short`.
Expected: lint clean; 245 unit tests pass; the zip has no `src/config/` or `src/images/` and includes `src/lib/sender.js` and `src/page_action/options_link.js`; 92 browser tests pass in each run, with the known bugs as expected failures; only the docs are uncommitted. Delete `dist/` afterwards (git ignores it).

- [ ] **Step 8: Commit, push and open the PR**

```bash
git add README.md CONTRIBUTING.md CLAUDE.md .coderabbit.yaml docs/superpowers/specs
git commit -F - <<'EOF'
Describe the Phase 3 shell in the docs and specs
EOF
git push -u origin claude/awesome-albattani-5hnlf1
```

Open the PR against `main` with the title "Phase 3: shell (manifest, service worker, status indicator, popup Options link)". The body says "Closes #32" and lists:

- **Findings closed**, one line each, with the resolution in the "Finding IDs" table below.
- **TR-22** (token spec), closed as MAN-2: the root opened with `?token=` gets the content scripts, and the token goes in the POST body.
- **Departures from the spec and the issue:**
  - The toolbar icon size dictionary and MAN-4's icon part wait for #55, because the Track S artwork (#50) doesn't exist yet (owner, 2026-10-21). The issue's icon criterion stays open for #55.
  - #13's axe helper isn't merged, so this PR adds a minimal `tests/e2e/axe.js` that #13 extends.
  - `SDT.guard.whenActive` re-sends `enableAction` once a prerendered page is shown. The spec cut "prerender handling beyond the sender check", but the check alone would leave a prerendered page's button disabled.
  - The harness's manifest-errors test now turns on Developer mode, without which it couldn't fail.
- **Open risks:** the open points below that are still open, and that the `@cdp` tests ran only in CI.

End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)` and your session line. Then run `gh pr checks --watch`. The `chrome-120` job may fail without blocking; it passed locally on Chrome for Testing 120 while this plan was written.

---

## Acceptance criteria (issue #32)

| Criterion | Task | Test |
|---|---|---|
| The URL-pattern matrix test covers root, `?f=html`, `submitJob`, `queryDomains`, a non-ArcGIS `/rest/services` page and a JSON view | 7 | `tests/e2e/url-patterns.spec.js` (13 cases), with `tests/unit/url-patterns.test.js` for the patterns themselves |
| No web-accessible resources, checked by a build test | 4, 5 | `build.test.js`: the zipped manifest has none, and the build fails on one; `extension-files.test.js`; `manifest.test.js` |
| Page-dispatched clicks reach no extension handler | 4 | `indicator.spec.js`: dispatched clicks and a real click change nothing; CDP finds no listeners; `elementFromPoint` misses the ring |
| The sender check rejects another extension, a non-top frame, a prerendering or cached document, and no tab, and accepts the active top frame of a tab | 2 | `tests/unit/sender.test.js`, and `tests/unit/background.test.js` through the worker |
| The matrix covers the root and a folder opened with `?token=` (TR-22) | 7 | `url-patterns.spec.js` (both, plus the token-in-body test) and the unit matrix |
| ESLint rejects `chrome.storage.*.set`, `remove` and `clear` under `src/src/inject/` | 6 | `tests/unit/lint-rules.test.js` |
| The toolbar icon is a size dictionary with the Track S artwork | Deferred | #55 (Decision 5) |
| axe-core passes on the gear (now the status indicator) and the popup, light and dark, plus a keyboard-only test | 8 | `tests/e2e/accessibility.spec.js` |
| `README.md`, `CONTRIBUTING.md`, `CLAUDE.md` and `.coderabbit.yaml` match the code | 10 | Review |

## Finding IDs

| ID | Task | Resolution |
|---|---|---|
| PRT-2 | 7 | GP patterns name `GPServer/*/execute` and `GPServer/*/submitJob` in Esri's casing, with an optional query string; the matrices cover `submitJob`, lower-case `submitjob` and `executeNow` |
| MAN-1 | 4, 5 | `web_accessible_resources` removed; the build refuses the key |
| MAN-2 | 7 | Patterns for `/rest/services` with no instance path and with `?` queries; the button is enabled only on pages the classifier accepts (unchanged from Phase 2, pinned by the matrix) |
| BG-2 | 2, 3 | `SDT.sender` refuses `prerender`, `cached`, `pending_deletion` and a missing lifecycle (unit tests); `whenActive` re-sends once a prerendered page is shown |
| BG-3 | 2 | Sender checks for id, tab and top frame; `enable()` rejections caught and logged at debug level (unit test) |
| SEC-1 | 4 | Form removed, so pages can't drive it |
| SEC-4 | 4, 5 | Duplicate of MAN-1 |
| SET-5 | 4 | Moot: form removed |
| SET-6 | 4 | Moot: form removed |
| SET-8 | 4, 5 | Duplicate of MAN-1: `options.json` and `settings.svg` deleted, no web-accessible resources |
| SET-9 | 4 | Moot: form removed (the guard part closed in Phase 2) |
| CWS-4 | 9 | `short_name` "SD Toolkit" |
| ADV-3 | 4 | The indicator has no listeners and `pointer-events: none` (CDP and click tests) |
| ADV-11 | 4 | A designed indicator: named ring, throttled status line, spin only while busy, none under reduced motion |
| INJ-19, Phase 3 part | 4 | The form and gear CSS removed, and the `-webkit-` keyframes with them |
| QRY-3, Phase 3 part | 7 | The Query Helper group matches only `.../query` and `.../query?*`. ImageServer and service-level query stay with Phase 7 |
| SET-7, Phase 3 part | 4, 8 | The gear's accessibility: name, live status, reduced motion, axe and keyboard tests. The options page stays with Phase 4 |
| BG-1, Phase 3 part | 2 | `action.default_state: "disabled"`, with `disable()` on install and start as a fallback |
| MAN-4, Phase 3 part | 9 | `short_name`; toolbar icons in #55 and padding in Track S |
| CWS-3, Phase 3 part | 7 | Final patterns limited to `/rest/services` paths, with the classifier on top; the store justification stays with Track S |
| ADV-1, Phase 3 part | 10 | README's change list, CONTRIBUTING, CLAUDE.md and `.coderabbit.yaml` |
| TR-22 (token spec) | 7 | Closed as MAN-2 |

## Commands

| What | Command |
|---|---|
| Lint | `npm run lint` |
| Unit tests | `npm run test:unit`, or one file: `node --test tests/unit/sender.test.js` |
| Build without lint | `node scripts/build.js` |
| Browser tests | `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test --grep-invert @cdp` |
| One browser spec | add the file and `-g "<title>"` to the command above |
| Against the zip | `rm -rf dist && unzip -q build/*.zip -d dist`, then the browser command with `EXT_PATH=dist` |
| Known bugs as normal tests | prefix the browser command with `SHOW_KNOWN_BUGS=1` and add `tests/e2e/known-bugs.spec.js` |

## Open points

1. **Prerendered pages.** `SDT.guard.whenActive` goes a little past the spec, which cut "prerender handling beyond the sender check". Without it, the sender check would refuse a prerendered page's `enableAction` and nothing would send it again, so a page opened from the address bar's prerender could show a disabled button. It is unit-tested only: the register says BG-2 has no browser test, and whether Chrome clears the action state when a prerendered page takes over the tab wasn't checked. Sending twice is harmless either way. The owner may prefer to drop it and accept the gap.
2. **A missing `documentLifecycle` is refused.** Every Chrome from 106 sends it, and both 120 and 141 were checked. Accepting a missing field would only matter for a Chromium fork that leaves it out.
3. **`queryTest.js` never shows as busy.** Its `notifyLoading` builds the class list but never writes it back to `<body>`, so the indicator doesn't spin while the Query Helper loads its fields. This plan leaves it: the indicator works from the classes the scripts set, and Phase 7 rewrites the Query Helper (QRY-18). Fixing it now is one line.
4. **The indicator's colours don't follow the page.** It uses the design review's light tokens on an opaque disc, so it is visible on light and dark pages, but it doesn't switch to the dark palette. `SDT.theme` comes in Phase 5, and #13 adds the dark host fixture that axe needs to test it.
5. **#13 and `tests/e2e/axe.js`.** If #13 merges first, use its helper instead and keep this plan's tests. If this phase merges first, #13 extends this file rather than adding a second one.
6. **The JSON view of the root now gets the main group** (`*://*/rest/services?*` matches `?f=json`), so `inject.css` is injected into it and the scripts run their classifier and stop. That was already true of every JSON view below the root, and the matrix pins that nothing visible happens.
7. **Case.** Patterns are case-sensitive and follow Esri's casing (Decision 1), so `/ARCGIS/rest/services` works (the instance path is a `*`) but `/arcgis/REST/services` and a hand-typed `.../submitjob` get nothing. Services Directory pages never link that way.

## Changes made while implementing

Every code block above went in as written. These instructions changed, and the steps above now say what was done:

1. **Task 5, the `referencedFiles` JSDoc.** Adding ", and any web_accessible_resources key" to the end of the `problems` sentence, which already ended "and scripts that use an SDT namespace ...", gave it two "and"s. The sentence now lists the kinds of problem with one "and" before the last.
2. **Task 10, `CLAUDE.md`'s settings section.** Its second "already disagree" bullet said "both settings UIs show a web map". With the in-page form gone there is one settings UI, so it now says "the options page shows a web map".
3. **Task 10, `CLAUDE.md`'s popup paragraph.** It listed the popup's scripts as `search.js` and `url_shortener.js` ("Both read the active tab's URL"). It now also names `options_link.js`, which Task 8 adds, so the doc matches the code.

### After review of PR #62

4. **`disableByDefault` catches a rejected `chrome.action.disable()`** and logs it at debug level, as the enable handler does (CodeRabbit). `tests/unit/background.test.js` has a case for it, and its stub `disable` can reject.
5. **`importedScripts` splits arguments only at commas outside quotes** (`splitArguments`), so a path holding a comma isn't reported as a non-literal (CodeAnt). `tests/unit/extension-files.test.js` has a case for it.
6. **The indicator's throttle uses `performance.now()`**, which a system clock change can't move (CodeAnt).
7. **The worker-level sender test also refuses `pending_deletion` and a missing `documentLifecycle`** (CodeAnt). `tests/unit/sender.test.js` already covered both.
