# Phase 2: Shared Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `src/src/lib/`, the shared `SDT` helpers every later phase uses, and switch every script to them: shared DOM helpers and an extension-context guard (Part A), then the network helpers, the token scope, the page classifier and the request budget (Part B).

**Architecture:**
- Shared code lives in classic scripts in `src/src/lib/`. Each adds one namespace to `globalThis.SDT` and declares nothing at the top level, so a second evaluation is harmless.
- Every `content_scripts` group lists the lib files first, in one order, and `page_action.html` loads them with `<script>` tags before its own scripts. The options page and the service worker don't use `SDT` in this phase.
- The build fails when a script uses an `SDT` namespace that no earlier file in its group or page defines.
- Unit tests load the lib files in Node with `vm` and a stub `chrome`.
- Content scripts keep their bare `{ }` blocks. Their top level only declares names, and every entry point goes through `SDT.guard`, so a script cut off by an extension update stops without throwing.
- In Part B every request goes through `SDT.net.fetchJson`. Automatic requests also go through one limiter per page, which enforces the section 4.3 budget. A page's `?token=` goes only inside its scope, in a form POST body, and never across a redirect.

**Tech stack:** Node 24 (`^22.13.0 || >=24`), `node --test` with `node:vm`, `@playwright/test` 1.64.0, ESLint 10. No new dependencies.

**Specs:**
- `docs/superpowers/specs/2026-10-09-store-readiness-design.md`: section 3, section 4 (definition of done), section 5 (shared code mechanism), Phase 2, and Appendix A.
- `docs/superpowers/specs/2026-10-13-token-support-design.md`: sections 4, 5.1 to 5.3, and Appendix A (TR-2, TR-5 to TR-8, TR-14).
- Issue #44 (this phase). Tokens v1 (#52) builds on `SDT.auth.scopeOf`, `SDT.url.build` and `SDT.net.fetchJson`.

Read both specs, `CLAUDE.md`, and the comments at the top of `tests/e2e/fixtures.js` and `tests/fixtures/fake-arcgis.js` before starting.

**Branch:** `claude/confident-einstein-4pr58r`. Both pull requests come from this branch, in sequence:
1. **PR A** (Tasks A1 to A7). Open it against `main` when Part A is done. This plan file goes in its first commit.
2. **PR B** (Tasks B1 to B11). Start after PR A has merged: `git fetch origin && git merge origin/main`, then continue on the same branch and open PR B against `main`.

## Decisions

The owner made these on 2026-10-20.

1. **Two pull requests.** Part A holds the mechanism, the build check, the DOM helpers, the guard and the `loadElement` switch-over. Part B holds the rest. Each part ends with docs that match the code and a PR body that lists the finding IDs it closes and how.
2. **Encoded separators.** `SDT.auth.scopeOf(url)` returns `null` (no scope, so no token) when the instance path, after `new URL()` has parsed it, still contains `%2f` or `%2e` in any case. `/restricted/rest/services` scopes to `/restricted`. Part B updates section 5.1 of the token spec to say so.
3. **Rows past the cap.** Until Phase 5's Load more (#14), each row the 50-request budget leaves out shows an inline text note: `Not loaded: request limit reached (50)`, built with text nodes.
4. **12.1 markup.** The research note from 2026-10-20 found no difference at the text level and couldn't check element classes (see Task B5). The classifier therefore confirms a page with any one of three markers, and no 12.x fixture variant is added. Task B5 records the source and date in the store-readiness spec.

This plan also settles points the specs leave open. The owner can overrule any of them in review (see "Open points" at the end):

- **Server pushback note.** A row skipped after an HTTP 429 or 503 shows `Not loaded: the server answered HTTP 503, so automatic requests stopped` (with the status it got). It works like the cap note.
- **Hosted ArcGIS Online paths.** On `services*.arcgis.com` and `tiles*.arcgis.com` hosts, only the `arcgis` and `tiles` segments of the instance path are lower-cased. The org ID keeps its case. On a tiles host the org ID is the second segment (`/tiles/<orgId>/arcgis`).
- **Pages under a service that aren't layer, query, find or a GP form**, such as `layers`, `identify`, `queryDomains` or a GP task page, classify as `service`. The scripts treat them as today, and the Query Helper skips them (QRY-3).
- **JSON views and `other` pages** get no gear and no `enableAction` message, so the toolbar button stays disabled there. Phase 3's URL-pattern matrix keeps that rule.
- **Map previews** (hover) go through `fetchJson` but not the limiter, because a hover is a user action. They skip links to other servers and never send the page's token, which Phase 6 also requires.
- **`SDT.guard.onLoad`** replaces `inject.js`'s `readyState` polling in Part A, because the guard needs one guarded entry point. That closes INJ-17 in Phase 2, not Phase 5.

## How ArcGIS servers take a POST

`fetchJson` sends a request that carries a token as a form POST, with every parameter (`f=json` included) in the body. Esri documents GET and POST for REST resources and operations, and the ArcGIS API for JavaScript switches any request to POST when its URL gets long. The probe in `scripts/probe-tokens.js` (question Q5) POSTed `f=json` and `token` in a form body to `rest/self` and to a secured service's resource JSON on sampleserver6 (10.9.1), and both answered as signed in (token spec, section 4, "Portability"). That covers resource JSON (service, layer, `layers`) and `query`. It hasn't been checked on 11.x, 12.x or an ArcGIS Online hosted host: Esri's hosts were unreachable from the environment this plan was written in. A request without a token stays a GET, as today, so it keeps the browser cache and today's request URLs.

## Global Constraints

- **Environment.** The local Playwright browser isn't the pinned one. Run browser tests with:

  ```bash
  CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test --grep-invert @cdp
  ```

  Chromium 141 has no `Extensions.triggerAction`, so the four `@cdp` tests run only in CI. Don't run `playwright install`. The other checks are `npm run lint`, `npm run test:unit` and `node scripts/build.js`.
- **No HTML strings** under `src/` (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`). Build DOM with `SDT.dom.loadElement` and text nodes.
- **One isolated world.** All of an extension's content scripts in a frame share one isolated world, across `content_scripts` groups. Each content script and popup script stays wrapped in one bare `{ }` block, so its `const` names stay private. Shared state lives on `SDT`, never in a top-level name.
- **Lib files** (`src/src/lib/*.js`) start with `globalThis.SDT ??= {};`, assign one namespace (`SDT.<name> = { ... };`), and declare no top-level `const`, `let`, `function` or `class`. Code inside a namespace reads other namespaces at call time, through `SDT.<name>`.
- **Load order.** Every content-script group with `js` lists the lib files first, in this order: `src/lib/dom.js`, `src/lib/guard.js`, then (Part B) `src/lib/auth.js`, `src/lib/url.js`, `src/lib/net.js`, `src/lib/page.js`. `page_action.html` loads the same files in the same order. A lib file may use only the namespaces of files before it.
- **Every new file under `src/` must be referenced** in the same commit, or the build and `tests/unit/extension-files.test.js` fail ("not referenced").
- **Cross-realm values in unit tests.** Objects made inside a `vm` context have that context's prototypes, so `assert.deepEqual` from `node:assert/strict` never matches them. Compare `plain(value)` (from `tests/unit/helpers/sdt.js`) or primitives. Lib code must not use `instanceof` on values that can come from another realm; use `Array.isArray` and `typeof`.
- **ESLint `no-restricted-syntax`:** a later flat-config entry replaces the rule's whole option list for the files it matches. Every entry for a subfolder of `src/` must repeat `BASE_SELECTORS`.
- **Tokens.** A token never goes in a URL the extension builds, in the DOM or in a console message. Fixture tokens use only `[A-Za-z0-9._-]`.
- **Test data is synthetic.** Never commit HTML or JSON captured from an Esri server.
- **Known bugs.** A change that fixes a `knownBug()` case turns it into `test()` in the same commit. After the class-prefix sweep, run the known bugs with `SHOW_KNOWN_BUGS=1` and record where each fails.
- **Code style:** 2-space indent, double quotes, semicolons, `--max-warnings=0`. If lint flags only formatting in code copied from this plan, run `npx eslint --fix <file>`. Don't change the logic to satisfy it.
- **Commit messages:** imperative subject, plain-English body, ending with the attribution lines your session gives, at least:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

## Review Focus

The failure modes most likely to let a broken change pass:

1. **A token leaves its scope.** `build()` must attach a token only when `scopeOf(url)` equals the token's scope. Pinned by the `scopeOf` table (Task B1), the `build()` cases (Task B2), and the browser tests in Task B8 that assert on `fakeServer.calls` origins.
2. **A token in a URL.** A page link may carry `?token=`. `build()` deletes `token` from every base URL, and the browser tests assert `call.query` is `{}` for every token-bearing call (`toMatchObject({ query: {} })` would match anything, so the tests use `toEqual`).
3. **A followed redirect.** Pinned by the 307 test in Task B8. If Chrome follows the 307, the harness records the target as "not routed" and the test fails.
4. **A classifier that is wrong on real pages.** Too strict, and the extension stops working on 12.x pages whose classes changed. Too loose, and the scripts run on JSON views. The unit table in Task B5 covers markup without `.breadcrumbs`, and the JSON-view browser tests cover the other side.
5. **A content script that touches the page or `chrome` after its context is gone.** Pinned by the `vm` entry-point test (Task A5) and the lint rules (Task A6).
6. **A known bug that passes or fails for the wrong reason after the class sweep.** Task B6 re-runs them with `SHOW_KNOWN_BUGS=1`.
7. **The cap counted in the wrong place.** Every automatic request, from every content script, goes through the one `SDT.net.pageLimiter()`. Pinned by the 60-link browser test in Task B8.

## Public API

Everything a later phase may call. Lib files in `src/src/lib/`, in load order.

### `SDT.dom` (`dom.js`, Part A)

| Member | Returns | Notes |
|---|---|---|
| `loadElement(tag, attributes = {}, text)` | `Element` | Sets each attribute with `setAttribute(name, String(value))`. Adds a text node unless `text` is `undefined` or `null`, so `0` and `false` are kept (QRY-11). |
| `text(value)` | `Text` | `String(value)`, or `""` for `undefined` and `null` |
| `clear(node)` | `node` | Removes every child |

### `SDT.guard` (`guard.js`, Part A)

| Member | Returns | Notes |
|---|---|---|
| `alive()` | `boolean` | `Boolean(chrome.runtime.id)`. False once an extension update or reload has cut the script off, and false if reading it throws. |
| `isInvalidated(error)` | `boolean` | Matches Chrome's "Extension context invalidated" |
| `run(fn, ...args)` | `fn`'s result, or `undefined` | Calls `fn` only while alive. Swallows invalidation errors, thrown or rejected, and rethrows any other error. |
| `wrap(fn)` | `function` | A function that calls `run(fn)` with the same `this` and arguments |
| `listen(target, type, handler, options)` | `() => void` (removes the listener) | Adds a listener that runs `handler` through `run`. Once the context is gone, the next event removes it and calls nothing. |
| `onLoad(fn)` | `undefined` | Runs `fn` now if `document.readyState` is `"complete"`, otherwise on `window` `load`. Does nothing, and reads nothing, when not alive. |

### `SDT.auth` (`auth.js`, Part B)

| Member | Returns | Notes |
|---|---|---|
| `splitRest(pathname)` | `{ instance: string[], tail: string[] }` or `null` | Splits at the first whole-segment `rest/services`, in any case. Segments stay percent-encoded. `tail` drops empty segments. |
| `isHosted(hostname)` | `boolean` | `/^(?:services\|tiles)(?:qa\|dev)?\d*\.arcgis\.com$/i` |
| `scopeOf(url)` | `string` or `null` | See below |
| `pageToken(location)` | `{ value, scope }` or `null` | The page URL's `token` parameter and the page's scope. `null` when the token is missing or empty, or the page has no scope. Reads `location.search` and `location.href`. |

`scopeOf(url)` parses with `new URL` (which resolves `.`, `..`, `%2e` and `%2e%2e` segments) and reads only the pathname. It returns `null` for a URL that doesn't parse, isn't `http:` or `https:`, has no whole-segment `rest/services`, or has an instance-path segment that still contains `%2f` or `%2e` (decision 2), or that is `admin`, `tokens` or `manager` in any case. Otherwise it returns `<protocol>//<host><instance path>`, such as `https://gis.example.org/server`, with the instance path lower-cased. On a hosted ArcGIS Online host only the `arcgis` and `tiles` segments are lower-cased. Two URLs are in the same scope exactly when their `scopeOf` strings are equal.

### `SDT.url` (`url.js`, Part B)

| Member | Returns | Notes |
|---|---|---|
| `build(base, params = {}, token = null, { method = "GET" } = {})` | `{ url, method, body, carriesToken }` or `null` | See below |
| `stripForFilter(href)` | `string` | Drops the fragment and every `token` and `f` parameter (names in any case), and a trailing `?`. Returns the input as a string when it doesn't parse. (TOK-3) |
| `tidy(url)` | `string` | `url.href` without a trailing `?` |

`build()` takes the token as an argument and never reads `location` (TOK-2). It returns `null` unless `base` is an `http:`, `https:` or `chrome-extension:` URL. It always removes the fragment and any `token` parameter from `base`. Parameters with `undefined` or `null` values are dropped, and the rest become strings in insertion order.
- `carriesToken` is true when `token.value` is non-empty and `scopeOf(base) === token.scope`. An empty token is never sent.
- If `carriesToken`, or `method` is `"POST"`: `method` is `"POST"`, the URL loses every key in `params`, and `body` is a `URLSearchParams` of the params plus `token` when it carries one (TOK-4).
- Otherwise: `method` is `"GET"`, the params are `set` on the URL's query in order, and `body` is `null`.

### `SDT.net` (`net.js`, Part B)

| Member | Returns | Notes |
|---|---|---|
| `fetchJson(url, { params, token, method, timeoutMs = 20000, signal, credentials, referrerPolicy } = {})` | `Promise<{ data } \| { error }>` | Never rejects. See below. |
| `parseJson(text)` | `{ data }` or `{ error }` | `JSON.parse`, then one retry with `nanToNull` (INJ-12) |
| `nanToNull(text)` | `string` | Replaces each bare `NaN` or `-NaN` outside a JSON string with `null` |
| `legacyResponse(result)` | `object` or `null` | Transitional, for callers not yet rewritten: `data`; `{ error: <the ArcGIS error object> }` for an ArcGIS error; `null` for any other failure. Phases 5, 7 and 9 remove its callers. |
| `createLimiter({ max = 50, concurrency = 4, scope = null, target = null, fetchJson })` | `{ fetchJson(url, options), stats() }` | See below |
| `pageLimiter()` | the page's limiter | One per isolated world, shared by every content script: scope `scopeOf(location.href)`, target `window` |
| `isSkipped(result)` | `boolean` | True when `result.error.type` is `"limit"` or `"stopped"`. The caller shows `result.error.message` as the row's note. |
| `limitNote(max)` | `string` | `Not loaded: request limit reached (50)` |
| `stoppedNote(status)` | `string` | `Not loaded: the server answered HTTP 503, so automatic requests stopped` |
| `BUDGET` | `{ max: 50, concurrency: 4 }` | Section 4.3 |
| `TIMEOUT_MS` | `20000` | |

`fetchJson` builds the request with `SDT.url.build(url, params, token, { method })`. It sends no headers of its own, so a GET has no `X-Requested-With` or `Content-Type` (POP-9), and a POST's `URLSearchParams` body sets `application/x-www-form-urlencoded`. It leaves `credentials` at the browser default unless the caller passes one (TOK-5), and passes `referrerPolicy` through. A request that carries a token uses `redirect: "manual"` (TOK-1). The signal is `AbortSignal.timeout(timeoutMs)`, combined with the caller's `signal` through `AbortSignal.any`.

An error is `{ error: { type, message, url, status?, code?, arcgis? } }`. `url` is the request URL, which never holds a token. The types:

| `type` | When | Extra fields |
|---|---|---|
| `url` | `build()` returned `null`; nothing is sent | |
| `network` | `fetch` rejected | |
| `timeout` | the timeout fired | |
| `aborted` | the caller's signal fired | |
| `redirect` | a request that carries a token got a redirect (`response.type === "opaqueredirect"`) | |
| `http` | `!response.ok` | `status` |
| `parse` | the body isn't JSON, even after the NaN retry | |
| `arcgis` | the JSON is an object whose `error` is an object (ArcGIS sends 498, 499 and most errors as HTTP 200) | `code`, `arcgis` (the server's error object) |

The limiter's `fetchJson(url, options)` takes the same options and adds four error types. None of them sends a request.

| `type` | When | Counted |
|---|---|---|
| `destination` | `scopeOf(url)` isn't the limiter's scope, or the limiter has no scope | No |
| `limit` | 50 requests were already accepted. `message` is `limitNote(max)`. | No |
| `stopped` | a response had HTTP 429 or 503. That row, every queued row, every row in flight (aborted) and every later call get this. `message` is `stoppedNote(status)`, and `status` is set. | |
| `aborted` | `pagehide` fired on `target`: queued rows and later calls get this, and rows in flight are aborted | |

At most `concurrency` requests are in flight. `stats()` returns `{ accepted, active, peak, stopped }`.

### `SDT.page` (`page.js`, Part B)

| Member | Returns | Notes |
|---|---|---|
| `classify(location, document)` | `"root" \| "folder" \| "service" \| "layer" \| "query" \| "find" \| "gpTask" \| "jsonView" \| "other"` | Reads only `location.pathname` (TOK-6) |
| `serviceType(location)` | `"MapServer"`, `"ImageServer"` and so on, or `null` | The first service-type segment after `rest/services`, in Esri's casing |
| `typeOf(segment)` | a service type or `null` | Case-insensitive match against `SERVICE_TYPES` |
| `isServicesDirectory(document)` | `boolean` | Any one marker: a `.breadcrumbs` element; a `.titlecell` whose text has "ArcGIS REST Services Directory"; or a `document.title` or first `h2` that matches `HEADING` |
| `baseUrl(location)` | `string` | `location.origin + location.pathname` |
| `SERVICE_TYPES` | `string[]` | `MapServer`, `FeatureServer`, `ImageServer`, `GPServer`, `GeocodeServer`, `GeometryServer`, `GeoDataServer`, `GlobeServer`, `NAServer`, `SceneServer`, `StreamServer`, `VectorTileServer`, `MobileServer`, `SchematicsServer`, `KnowledgeGraphServer`, `UtilityNetworkServer`, `VersionManagementServer`, `NetworkDiagramServer`, `ParcelFabricServer`, `ValidationServer`, `WorkflowManagerServer` |
| `HEADING` | `RegExp` | `/^(?:Folder\|Layer\|Table\|Query\|Find\|Task\|Execute Task\|Submit Job)\b\|\([A-Za-z]+Server\)$/` |

`classify` works in this order:
1. No whole-segment `rest/services` in the pathname: `other`.
2. `document.contentType` is `application/json` or `text/plain`: `jsonView`.
3. `isServicesDirectory(document)` is false (a login page, an error page): `other`.
4. No service-type segment in the tail: `root` for an empty tail, `folder` otherwise.
5. With `after` as the lower-cased segments after the service type: none, `service`; last is `query`, `query`; just `find`, `find`; a `GPServer` with two segments ending `execute` or `submitjob`, `gpTask`; one all-digit segment, `layer`; anything else, `service`.

---

# Part A: mechanism, DOM helpers and the guard

Closes QRY-11 and the guard parts of BG-1 and SET-9, plus INJ-17 (see Decisions) and this phase's part of ADV-1.

### Task A1: Lib loader for unit tests, `SDT.dom`, and wiring

**Files:**
- Create: `src/src/lib/dom.js`
- Create: `tests/unit/helpers/sdt.js`, `tests/unit/helpers/fake-dom.js`
- Create: `tests/unit/dom.test.js`
- Modify: `src/manifest.json` (every `content_scripts` entry with `js`)
- Modify: `src/src/page_action/page_action.html`
- Modify: `tests/unit/manifest.test.js` (append)
- Modify: `eslint.config.js` (the `src/**/*.js` globals)

**Interfaces:**
- Produces: `SDT.dom` (see Public API); `loadLib`, `runFile`, `stubChrome`, `plain`, `LIB_FILES` and `SRC` from `tests/unit/helpers/sdt.js`; `fakeDocument()` from `tests/unit/helpers/fake-dom.js`.

- [ ] **Step 1: Write the test helpers**

Create `tests/unit/helpers/sdt.js`. `node --test` runs only `*.test.js`, so the helpers aren't run as tests.

```js
// Loads the extension's lib files (src/src/lib/) into a Node vm context, the way a content script
// group loads them, so unit tests can call SDT without a browser.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/** The extension root. Paths in the manifest are relative to it. */
export const SRC = fileURLToPath(new URL("../../../src/", import.meta.url));

const manifest = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));

/** The lib files in the order the manifest's content-script groups load them. */
export const LIB_FILES = manifest.content_scripts
  .find((group) => group.js)
  .js.filter((file) => file.startsWith("src/lib/"));

/** A chrome object with just enough for the lib: a runtime id, which the guard reads. */
export const stubChrome = ({ id = "sdt-test-extension" } = {}) => ({ runtime: { id } });

/**
 * Values made inside a vm context have that context's prototypes, which assert.deepEqual from
 * node:assert/strict never matches. plain() copies a JSON-safe value into this realm.
 */
export const plain = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/** Runs one file, given as a path relative to src/, in context. */
export const runFile = (context, file) => vm.runInContext(readFileSync(join(SRC, file), "utf8"), context, { filename: file });

/**
 * Creates a context with Node's URL, fetch-related and timer globals, plus globals, and runs the lib
 * files in it. Returns the context: context.SDT is the lib. Like vm.runInNewContext, but the
 * context stays reusable for later files.
 */
export const loadLib = ({ chrome = stubChrome(), globals = {}, files = LIB_FILES } = {}) => {
  const context = vm.createContext({
    chrome,
    console,
    URL,
    URLSearchParams,
    AbortController,
    AbortSignal,
    DOMException,
    setTimeout,
    clearTimeout,
    ...globals
  });
  for (const file of files) {
    runFile(context, file);
  }
  return context;
};
```

Create `tests/unit/helpers/fake-dom.js`:

```js
// The few document calls the lib's DOM helpers make, for unit tests in Node. It isn't a DOM.
class FakeNode {
  constructor(nodeType, nodeName) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.childNodes = [];
    this.attributes = {};
    this.parentNode = null;
    this.data = "";
  }

  get firstChild() {
    return this.childNodes[0] ?? null;
  }

  get lastChild() {
    return this.childNodes.at(-1) ?? null;
  }

  get textContent() {
    return this.nodeType === 3 ? this.data : this.childNodes.map((child) => child.textContent).join("");
  }

  appendChild(child) {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child) {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
}

export const fakeDocument = () => ({
  createElement: (tag) => new FakeNode(1, tag.toUpperCase()),
  createTextNode: (data) => Object.assign(new FakeNode(3, "#text"), { data: String(data) })
});
```

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/dom.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLib } from "./helpers/sdt.js";
import { fakeDocument } from "./helpers/fake-dom.js";

const dom = () => loadLib({ globals: { document: fakeDocument() } }).SDT.dom;

test("loadElement keeps 0 and false as text (QRY-11)", () => {
  assert.equal(dom().loadElement("option", { value: 0 }, 0).textContent, "0");
  assert.equal(dom().loadElement("b", {}, false).textContent, "false");
});

test("loadElement adds no text node for undefined or null", () => {
  assert.equal(dom().loadElement("b", {}).childNodes.length, 0);
  assert.equal(dom().loadElement("b", {}, null).childNodes.length, 0);
});

test("loadElement sets every attribute as a string, and takes no attributes", () => {
  assert.deepEqual(dom().loadElement("option", { value: 0, "class": "x" }, "a").attributes, { value: "0", "class": "x" });
  assert.deepEqual(dom().loadElement("div").attributes, {});
  assert.equal(dom().loadElement("div").nodeName, "DIV");
});

test("text makes a text node, empty for undefined and null", () => {
  assert.equal(dom().text(0).textContent, "0");
  assert.equal(dom().text(undefined).textContent, "");
  assert.equal(dom().text(null).textContent, "");
});

test("clear removes every child and returns the node", () => {
  const helpers = dom();
  const list = helpers.loadElement("ul");
  list.appendChild(helpers.loadElement("li", {}, "a"));
  list.appendChild(helpers.loadElement("li", {}, "b"));
  assert.equal(helpers.clear(list), list);
  assert.equal(list.childNodes.length, 0);
});
```

Append to `tests/unit/manifest.test.js`:

```js
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
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `node --test tests/unit/dom.test.js tests/unit/manifest.test.js`
Expected: FAIL. `dom.test.js` fails in `loadLib` with `Cannot read properties of undefined (reading 'js')` or with `dom()` returning undefined, and the two manifest tests fail with "no lib files".

- [ ] **Step 4: Write `src/src/lib/dom.js`**

```js
// SDT.dom: DOM helpers shared by the content scripts and the popup. Like every file in src/src/lib/,
// this is a classic script that adds one namespace to SDT and declares nothing at the top level, so
// running it twice is harmless (store-readiness spec, section 5).
globalThis.SDT ??= {};

SDT.dom = {
  /**
   * Creates an element. Each attribute is set as a string. The text, unless it is undefined or
   * null, becomes a text node, so 0 and false are kept.
   */
  loadElement(tag, attributes = {}, text) {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes ?? {})) {
      element.setAttribute(name, String(value));
    }
    if (text !== undefined && text !== null) {
      element.appendChild(document.createTextNode(String(text)));
    }
    return element;
  },

  /** A text node for value; empty for undefined and null. */
  text(value) {
    return document.createTextNode(value === undefined || value === null ? "" : String(value));
  },

  /** Removes every child of node, and returns node. */
  clear(node) {
    while (node.firstChild) {
      node.removeChild(node.lastChild);
    }
    return node;
  }
};
```

- [ ] **Step 5: Wire it in**

In `src/manifest.json`, make `"src/lib/dom.js"` the first entry of the `js` array in each of the three `content_scripts` entries that have one. In `src/src/page_action/page_action.html`, add `<script src="../lib/dom.js"></script>` on the line before `<script src="search.js"></script>`, with the same tab indent.

In `eslint.config.js`, in the `src/**/*.js` entry, add `SDT` to the globals:

```js
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        // The shared namespace from src/src/lib/ (store-readiness spec, section 5).
        SDT: "readonly"
      }
```

`readonly` still allows `SDT.dom = ...`, which assigns a property, and `globalThis.SDT ??= {}`.

- [ ] **Step 6: Run the tests**

Run: `npm run lint && npm run test:unit`
Expected: PASS. `extension-files.test.js` still passes, because the manifest and the popup reference `dom.js`.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/plans/2026-10-20-phase-2-shared-core.md src/src/lib/dom.js src/manifest.json src/src/page_action/page_action.html eslint.config.js tests/unit/helpers tests/unit/dom.test.js tests/unit/manifest.test.js
git commit -F - <<'EOF'
Add src/src/lib/ with the shared DOM helpers

SDT.dom.loadElement keeps 0 and false as text (QRY-11). Every
content-script group and the popup load the lib first, and unit tests
load it in Node through vm. This commit also adds the Phase 2 plan.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task A2: Switch every `loadElement` copy to `SDT.dom`

**Files:**
- Modify: `src/src/inject/inject.js`, `status.js`, `mapImages.js`, `queryTest.js`, `printTask.js`
- Modify: `src/src/page_action/search.js`

**Interfaces:**
- Consumes: `SDT.dom.loadElement`, `SDT.dom.clear`.

No new test: the browser characterisation tests cover these elements, and Task A1's unit test covers QRY-11.

- [ ] **Step 1: Replace the copies**

In each file, delete the local `loadElement` arrow function and its JSDoc comment, and add this line as the first statement inside the file's `{` block (after `let active;` in `queryTest.js`):

```js
  const { loadElement } = SDT.dom;
```

In `inject.js` and `queryTest.js`, also delete the local `cleanElement` and use this line instead of the one above:

```js
  const { loadElement, clear: cleanElement } = SDT.dom;
```

The call sites stay as they are.

- [ ] **Step 2: Check nothing else defines them**

Run: `grep -nE "const (loadElement|cleanElement) =" src/src -r`
Expected: no output.

- [ ] **Step 3: Run the checks**

Run: `npm run lint && npm run test:unit && node scripts/build.js`, then the browser tests (Global Constraints command).
Expected: all pass. The known bugs are reported as expected failures.

- [ ] **Step 4: Commit**

```bash
git add src/src/inject src/src/page_action/search.js
git commit -F - <<'EOF'
Use the shared loadElement in every script

The six copies of loadElement and the two of cleanElement give way to
SDT.dom, so text 0 and false now show in the Query Helper's lists.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task A3: Build check for `SDT` load order

**Files:**
- Modify: `scripts/lib/extension-files.js`
- Modify: `tests/unit/extension-files.test.js` (append)
- Modify: `tests/unit/build.test.js` (append)

**Interfaces:**
- Produces: `sdtLoadOrderProblems(extDir, scripts, source) -> string[]`, exported from `scripts/lib/extension-files.js`. `referencedFiles` adds its problems for each content-script group (`content_scripts[<index>]`) and each extension page (the page's path). Message: `<source>: <script> uses SDT.<name> before a script that defines it`.

A script defines a namespace with a line that starts `SDT.<name> =` or `SDT.<name> ??=`, and uses one wherever `SDT.<name>` appears, comments included. Every namespace a script uses must be defined by that script or an earlier one in the same group or page.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/extension-files.test.js`:

```js
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
```

Append to `tests/unit/build.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/unit/extension-files.test.js tests/unit/build.test.js`
Expected: FAIL. The three "reports" cases get `[]`, and the build case gets status 0.

- [ ] **Step 3: Add the check**

In `scripts/lib/extension-files.js`, below `globToRegExp`, add:

```js
// SDT namespaces: a lib file defines one with "SDT.dom = {" (or ??=) at the start of a line, and a
// script uses one wherever "SDT.dom" appears.
const SDT_DEFINES = /^\s*SDT\.(\w+)\s*\?{0,2}=(?!=)/gm;
const SDT_USES = /\bSDT\.(\w+)/g;
const PAGE_SCRIPT = /<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;

/**
 * Checks one load order: a content-script group's js list, or an extension page's scripts. Every SDT
 * namespace a script uses must be defined by that script or an earlier one. Returns problem strings.
 */
export const sdtLoadOrderProblems = (extDir, scripts, source) => {
  const defined = new Set();
  const problems = [];
  for (const script of scripts) {
    let code;
    try {
      code = readFileSync(join(extDir, script), "utf8");
    } catch {
      continue; // A missing file is reported elsewhere.
    }
    const own = new Set([...code.matchAll(SDT_DEFINES)].map(([, name]) => name));
    const used = new Set([...code.matchAll(SDT_USES)].map(([, name]) => name));
    for (const name of used) {
      if (!own.has(name) && !defined.has(name)) {
        problems.push(`${source}: ${script} uses SDT.${name} before a script that defines it`);
      }
    }
    own.forEach((name) => defined.add(name));
  }
  return problems;
};
```

In `referencedFiles`, change the content-scripts loop to:

```js
  for (const [index, script] of (manifest.content_scripts || []).entries()) {
    [...(script.js || []), ...(script.css || [])].forEach((path) => add(path, "content_scripts"));
    problems.push(...sdtLoadOrderProblems(extDir, script.js || [], `content_scripts[${index}]`));
  }
```

In the pages loop, after the `HTML_REFERENCE` loop, add:

```js
    const scripts = [...html.matchAll(PAGE_SCRIPT)]
      .map(([, reference]) => reference)
      .filter((reference) => !/^[a-z][a-z0-9+.-]*:/i.test(reference))
      .map((reference) => posix.normalize(posix.join(posix.dirname(page), reference)));
    problems.push(...sdtLoadOrderProblems(extDir, scripts, page));
```

Update the JSDoc above `referencedFiles` so its `problems` sentence also names "scripts that use an SDT namespace before a file that defines it".

- [ ] **Step 4: Run the tests**

Run: `npm run lint && npm run test:unit`
Expected: PASS. The real `src/` has no problems: every group lists `dom.js` first.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/extension-files.js tests/unit/extension-files.test.js tests/unit/build.test.js
git commit -F - <<'EOF'
Fail the build when a script uses SDT before the lib loads

Each content-script group and extension page must load the file that
defines an SDT namespace before any script that uses it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task A4: `SDT.guard`

**Files:**
- Create: `src/src/lib/guard.js`
- Create: `tests/unit/guard.test.js`
- Modify: `src/manifest.json`, `src/src/page_action/page_action.html` (load `guard.js` after `dom.js`)

**Interfaces:**
- Produces: `SDT.guard` (see Public API).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/guard.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLib } from "./helpers/sdt.js";

const INVALIDATED = "Extension context invalidated.";

/** An event target that records listeners and can fire them with a given this. */
const eventTarget = () => {
  const listeners = [];
  return {
    listeners,
    addEventListener(type, listener, options) {
      listeners.push({ type, listener, options });
    },
    removeEventListener(type, listener) {
      const at = listeners.findIndex((entry) => entry.type === type && entry.listener === listener);
      if (at !== -1) {
        listeners.splice(at, 1);
      }
    },
    fire(type, thisArg, ...args) {
      [...listeners].filter((entry) => entry.type === type).forEach((entry) => entry.listener.apply(thisArg, args));
    }
  };
};

const setup = (globals = {}) => {
  const context = loadLib({ globals });
  return { context, guard: context.SDT.guard, cutOff: () => { context.chrome.runtime.id = undefined; } };
};

test("alive follows chrome.runtime.id, and is false when reading it throws", () => {
  const { guard, cutOff } = setup();
  assert.equal(guard.alive(), true);
  cutOff();
  assert.equal(guard.alive(), false);
  const throwing = loadLib({ chrome: { get runtime() { throw new Error(INVALIDATED); } } }).SDT.guard;
  assert.equal(throwing.alive(), false);
});

test("run calls the function only while alive", () => {
  const { guard, cutOff } = setup();
  let calls = 0;
  assert.equal(guard.run((n) => { calls += n; return "done"; }, 2), "done");
  cutOff();
  assert.equal(guard.run(() => { calls += 1; }), undefined);
  assert.equal(calls, 2);
});

test("run swallows invalidation errors and rethrows others", async () => {
  const { guard } = setup();
  assert.equal(guard.run(() => { throw new Error(INVALIDATED); }), undefined);
  assert.throws(() => guard.run(() => { throw new Error("boom"); }), /boom/);
  assert.equal(await guard.run(async () => { throw new Error(INVALIDATED); }), undefined);
  await assert.rejects(guard.run(async () => { throw new Error("boom"); }), /boom/);
});

test("wrap keeps this and the arguments", () => {
  const { guard } = setup();
  const owner = { name: "owner" };
  const wrapped = guard.wrap(function (a, b) { return `${this.name}:${a}${b}`; });
  assert.equal(wrapped.call(owner, 1, 2), "owner:12");
});

test("listen runs the handler with the target as this while alive, then removes itself", () => {
  const { guard, cutOff } = setup();
  const target = eventTarget();
  const seen = [];
  guard.listen(target, "click", function (event) { seen.push([this, event]); });
  target.fire("click", target, "first");
  assert.deepEqual(seen, [[target, "first"]]);
  cutOff();
  target.fire("click", target, "second");
  assert.equal(seen.length, 1);
  assert.equal(target.listeners.length, 0);
});

test("listen returns a function that removes the listener", () => {
  const { guard } = setup();
  const target = eventTarget();
  const unlisten = guard.listen(target, "click", () => {});
  unlisten();
  assert.equal(target.listeners.length, 0);
});

test("onLoad runs now on a loaded page, and on load otherwise", () => {
  const win = eventTarget();
  const loaded = setup({ document: { readyState: "complete" }, window: win });
  let calls = 0;
  loaded.guard.onLoad(() => { calls += 1; });
  assert.equal(calls, 1);

  const loading = setup({ document: { readyState: "interactive" }, window: win });
  loading.guard.onLoad(() => { calls += 1; });
  assert.equal(calls, 1);
  assert.deepEqual(win.listeners.map(({ type, options }) => [type, options.once]), [["load", true]]);
  win.fire("load", win);
  assert.equal(calls, 2);
});

test("onLoad reads nothing once the context is gone", () => {
  const trap = new Proxy({}, { get(_, key) { throw new Error(`read ${String(key)}`); } });
  const { guard, cutOff } = setup({ document: trap, window: trap });
  cutOff();
  assert.doesNotThrow(() => guard.onLoad(() => assert.fail("ran")));
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/unit/guard.test.js`
Expected: FAIL with `Cannot read properties of undefined (reading 'alive')`.

- [ ] **Step 3: Write `src/src/lib/guard.js`**

```js
// SDT.guard: keeps content scripts from failing after an extension update. Chrome then cuts off the
// old scripts: chrome.runtime.id reads undefined, and any chrome.* call throws "Extension context
// invalidated". Every entry point of a content script (its start, event listeners, timers and chrome
// callbacks) goes through run, wrap, listen or onLoad, so a cut-off script stops quietly.
globalThis.SDT ??= {};

SDT.guard = {
  /** True while this script's extension context is valid. */
  alive() {
    try {
      return Boolean(globalThis.chrome?.runtime?.id);
    } catch {
      return false;
    }
  },

  /** Whether error is Chrome's error for a call from a cut-off script. */
  isInvalidated(error) {
    return /Extension context invalidated/i.test(String(error?.message ?? error));
  },

  /** Calls fn(...args) while alive. Swallows invalidation errors, thrown or rejected; rethrows others. */
  run(fn, ...args) {
    if (!SDT.guard.alive()) {
      return undefined;
    }
    const swallow = (error) => {
      if (!SDT.guard.isInvalidated(error)) {
        throw error;
      }
      return undefined;
    };
    try {
      const result = fn(...args);
      return result && typeof result.then === "function" ? result.then(undefined, swallow) : result;
    } catch (error) {
      return swallow(error);
    }
  },

  /** A function that calls fn through run, with the same this and arguments. */
  wrap(fn) {
    return function (...args) {
      return SDT.guard.run(() => fn.apply(this, args));
    };
  },

  /**
   * Adds an event listener that calls handler through run. Once the context is gone, the next event
   * removes the listener. Returns a function that removes it.
   */
  listen(target, type, handler, options) {
    const listener = function (...args) {
      if (!SDT.guard.alive()) {
        target.removeEventListener(type, listener, options);
        return undefined;
      }
      return SDT.guard.run(() => handler.apply(this, args));
    };
    target.addEventListener(type, listener, options);
    return () => target.removeEventListener(type, listener, options);
  },

  /** Runs fn once the page has loaded: now, if it already has. */
  onLoad(fn) {
    if (!SDT.guard.alive()) {
      return;
    }
    if (document.readyState === "complete") {
      SDT.guard.run(fn);
    } else {
      SDT.guard.listen(window, "load", fn, { once: true });
    }
  }
};
```

- [ ] **Step 4: Wire it in**

In `src/manifest.json`, add `"src/lib/guard.js"` right after `"src/lib/dom.js"` in each of the three `js` arrays. In `page_action.html`, add `<script src="../lib/guard.js"></script>` after the `dom.js` line.

- [ ] **Step 5: Run the tests**

Run: `npm run lint && npm run test:unit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/src/lib/guard.js src/manifest.json src/src/page_action/page_action.html tests/unit/guard.test.js
git commit -F - <<'EOF'
Add SDT.guard for content scripts cut off by an update

alive(), run(), wrap(), listen() and onLoad() stop a content script's
entry points quietly once chrome.runtime.id is gone.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task A5: Guard every content-script entry point

**Files:**
- Create: `tests/unit/guard-entry-points.test.js`
- Modify: `src/src/inject/inject.js`, `status.js`, `mapImages.js`, `queryTest.js`, `printTask.js`

**Interfaces:**
- Consumes: `SDT.guard.run`, `wrap`, `listen`, `onLoad`.
- Produces: each content script's top level only declares names and ends with one `SDT.guard.onLoad(...)` or `SDT.guard.run(...)` call.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/guard-entry-points.test.js`:

```js
// A content script that Chrome has cut off (after an extension update) must stop without throwing
// and without touching the page or chrome. Each group's files run here with chrome.runtime.id
// undefined, and with every page global replaced by a trap that records any use and throws.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { runFile, SRC } from "./helpers/sdt.js";

const manifest = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));

const PAGE_GLOBALS = ["document", "window", "location", "history", "navigator", "fetch", "XMLHttpRequest",
  "setTimeout", "setInterval", "requestAnimationFrame", "alert"];

const trap = (name, touched) => new Proxy(function () {}, {
  get(_, key) {
    touched.push(`${name}.${String(key)}`);
    throw new Error(`${name}.${String(key)} was used`);
  },
  set(_, key) {
    touched.push(`${name}.${String(key)} =`);
    throw new Error(`${name}.${String(key)} was set`);
  },
  apply() {
    touched.push(`${name}()`);
    throw new Error(`${name}() was called`);
  },
  construct() {
    touched.push(`new ${name}()`);
    throw new Error(`new ${name}() was called`);
  }
});

// chrome as a cut-off script sees it: chrome.runtime.id is undefined, and anything else is a trap.
const cutOffChrome = (touched) => new Proxy({}, {
  get(_, key) {
    if (key === "runtime") {
      return new Proxy({}, {
        get(__, name) {
          if (name === "id") {
            return undefined;
          }
          touched.push(`chrome.runtime.${String(name)}`);
          throw new Error(`chrome.runtime.${String(name)} was used`);
        }
      });
    }
    touched.push(`chrome.${String(key)}`);
    throw new Error(`chrome.${String(key)} was used`);
  }
});

for (const [index, group] of manifest.content_scripts.entries()) {
  if (!group.js) {
    continue;
  }
  test(`content_scripts[${index}] does nothing once its extension context is gone`, () => {
    const touched = [];
    const context = vm.createContext({
      console,
      chrome: cutOffChrome(touched),
      ...Object.fromEntries(PAGE_GLOBALS.map((name) => [name, trap(name, touched)]))
    });
    for (const file of group.js) {
      assert.doesNotThrow(() => runFile(context, file), file);
    }
    assert.deepEqual(touched, []);
  });
}
```

- [ ] **Step 2: Run the test to see it fail**

Run: `node --test tests/unit/guard-entry-points.test.js`
Expected: FAIL in all three groups. The `inject.js` group fails on `setInterval()`, and the query and print groups on `document.readyState` and `window.location`.

- [ ] **Step 3: Restructure the scripts**

The rule for each file: the top level of the `{ }` block only declares names (`const`, `let`, functions, classes), and the last statement starts the script through the guard. Inside, every `addEventListener` becomes `SDT.guard.listen(target, type, handler)`, and every inline callback passed to a `chrome.*` call or to `setTimeout` is wrapped in `SDT.guard.wrap(...)`. The `x.onreadystatechange` callback in the four `ajax` copies (`inject.js`, `status.js`, `queryTest.js`, `printTask.js`) is an entry point too, so it becomes `x.onreadystatechange = SDT.guard.wrap(() => {...});` until Part B replaces `ajax`. Lint can't see that assignment, so this is by hand.

`inject.js`:
- Replace the `let readyStateCheckInterval = setInterval(() => { if (document.readyState === "complete") { clearInterval(readyStateCheckInterval); ...BODY... } }, 10);` statement with `SDT.guard.onLoad(() => { ...BODY... });`, keeping BODY as it is apart from removing one indent level, which the indent rule needs.
- `listenAll`: `[].forEach.call(node.querySelectorAll(selector), (el) => SDT.guard.listen(el, evt, callback));`
- `showMetadata`: `SDT.guard.listen(div, "click", () => { toggleCollapse(div); });`
- `SidePanel`: `SDT.guard.listen(clearBtn, "click", clearActive);`
- `FieldSelector.buildRenderer`: `SDT.guard.listen(this.layerSelect, "change", this.updateFields.bind(this, dataItems));` and `SDT.guard.listen(this.fieldSelect, "change", this.updateValues.bind(this, this.url.replace(/\/\d*\/?$/, "")));`
- Both `chrome.storage.sync.get({...}, (items) => {...})` calls: `chrome.storage.sync.get({...}, SDT.guard.wrap((items) => {...}));`

`status.js`: move everything that runs at load into one `start` function, and keep the declarations above it.
- Delete the `enableAction();` call and the `window.addEventListener("pageshow", ...)` line below `const enableAction = ...`. Both move into `start`.
- Replace the lines from `const statusNode = loadElement("DIV", {` down to `statusNode.addEventListener("click", openOptionsForm);` with the block below. It repeats `enableAction` with its comment, so delete the old `const enableAction` line too:

  ```js
  // Enable the toolbar button for this tab (see src/src/bg/background.js). Re-send when the page is
  // restored from the back/forward cache, because Chrome clears the tab's action state on navigation.
  const enableAction = () => chrome.runtime.sendMessage({ type: "enableAction" });

  // The gear and its in-page form. Phase 3 removes the form.
  let statusNode = null;

  const openOptionsForm = () => {
    if (!statusNode) {
      return;
    }
    if (!/open/i.test(statusNode.className)) {
      statusNode.className += " open";
    }
  };

  const closeOptionsForm = () => {
    if (!statusNode) {
      return;
    }
    if (/open/i.test(statusNode.className)) {
      statusNode.className = statusNode.className.replace(" open", "");
    }
  };
  ```

  The `ajax` copy stays above these until Part B.
- In `OptionsForm`, change the three listeners to `SDT.guard.listen(saveButton, "click", evt => {...}, {capture: true});`, `SDT.guard.listen(cancelButton, "click", evt => {...});`, and wrap each of the five `chrome.storage.sync.get(storageItem, items => {...})` callbacks, the `chrome.storage.sync.set(dataToSave, () => {...})` callback and the `setTimeout(() => {...})` callback in `SDT.guard.wrap(...)`.
- Replace the last two statements (`new OptionsForm(statusNode);` and `document.body.appendChild(statusNode);`) with:

  ```js
  const start = () => {
    enableAction();
    SDT.guard.listen(window, "pageshow", (evt) => evt.persisted && enableAction());
    statusNode = loadElement("DIV", { "class": "status" });
    const settingsImg = loadElement("IMG", { "class": "status-icon" });
    statusNode.appendChild(settingsImg);
    settingsImg.src = chrome.runtime.getURL("src/images/settings.svg");
    SDT.guard.listen(statusNode, "click", openOptionsForm);
    new OptionsForm(statusNode);
    document.body.appendChild(statusNode);
  };

  SDT.guard.run(start);
  ```

  `showSettingsImg` goes; its `getURL` literal now sits in `start`, where the build still finds it.

`mapImages.js`:
- `setup`: `SDT.guard.listen(tag, "mouseover", hoverGetMap);`
- Wrap both `chrome.storage.sync.get` callbacks in `SDT.guard.wrap(...)`.
- Replace the closing `if (document.readyState === "complete") { onPageLoaded(); } else { window.addEventListener("load", onPageLoaded); }` with `SDT.guard.onLoad(onPageLoaded);`.

`queryTest.js`:
- `listenAll`: `[].forEach.call(node.querySelectorAll(selector), (el) => { SDT.guard.listen(el, evt, callback); });`
- `insertQuickFillinButton`: `SDT.guard.listen(quickBtn, "click", quickFormFillin.bind(this, formData, !!clickSubmit));`
- `addStatisticsControl`: `SDT.guard.listen(btn, "click", addStatistic.bind(this, stat.toLowerCase()));`
- `SidePanel`: `SDT.guard.listen(clearBtn, "click", clearActive);`
- `FieldSelector.buildRenderer`: the two `change` listeners, as in `inject.js`.
- Wrap the two `chrome.storage.sync.get` callbacks.
- Replace the closing `readyState` check with `SDT.guard.onLoad(onPageLoaded);`.

`printTask.js`:
- Delete the top-level `let url = window.location.href.split("?")[0];`.
- `swapInChoice`: `SDT.guard.listen(select, "change", () => {...});`
- Wrap the `chrome.storage.sync.get` callback in `updateGPForm`.
- Replace the last statement with:

  ```js
  SDT.guard.run(() => {
    const url = window.location.href.split("?")[0];
    ajax(url.replace(/\/(execute|submitjob)\/?$/i, "") + "?f=json", updateGPForm);
  });
  ```

- [ ] **Step 4: Check that no bare entry point is left**

Run: `grep -nE "addEventListener|setInterval|document\.readyState" src/src/inject/*.js`
Expected: no output. (`x.readyState` in the `ajax` copies is the XHR's state, and stays until Part B.)

- [ ] **Step 5: Run the checks**

Run: `npm run lint && npm run test:unit && node scripts/build.js`, then the browser tests.
Expected: all pass. The entry-point test passes for all three groups.

- [ ] **Step 6: Commit**

```bash
git add src/src/inject tests/unit/guard-entry-points.test.js
git commit -F - <<'EOF'
Start every content script through SDT.guard

Each script's top level now only declares names. Its start, listeners,
timers and chrome callbacks go through the guard, so a script cut off
by an extension update stops without errors (BG-1). inject.js waits for
load with onLoad instead of polling readyState (INJ-17).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task A6: Lint rules for blocks, guarded entry points and lib files

**Files:**
- Modify: `eslint.config.js`
- Modify: `tests/unit/lint-rules.test.js`

**Interfaces:**
- Produces: in `src/src/inject/**`, an error for a top-level statement that isn't a block, for any `addEventListener` call, for `setTimeout`/`setInterval` whose first argument isn't `SDT.guard.wrap(...)`, and for an inline function passed to a `chrome.*` call. In `src/src/page_action/**`, the block rule. In `src/src/lib/**`, an error for a top-level `const`, `let`, `var`, `function` or `class`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/lint-rules.test.js`, change the default `filePath` of `ruleIds` to `"src/src/example.js"`. The base rules cover every file under `src/`, and the existing cases then don't trip the new block rule. Then append:

```js
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/unit/lint-rules.test.js`
Expected: FAIL. The new "error" cases get `[]`.

- [ ] **Step 3: Add the rules**

In `eslint.config.js`, move the seven existing selectors into a constant and add the new groups:

```js
const BASE_SELECTORS = [
  // ...the seven selector objects now in the src/**/*.js entry, unchanged...
];

// All of an extension's content scripts in a frame share one isolated world, and so do a page's
// scripts. One bare block per file keeps each file's const names private.
const ONE_BLOCK = "Wrap the whole file in one bare { } block: scripts that share a world would see each other's top-level names.";
const BLOCK_SELECTORS = [{ selector: "Program > :not(BlockStatement)", message: ONE_BLOCK }];

// A content script outlives its extension after an update (see src/src/lib/guard.js).
const GUARDED = "Content scripts can outlive their extension. Use SDT.guard.listen, SDT.guard.wrap or SDT.guard.onLoad.";
const GUARD_SELECTORS = [
  { selector: "CallExpression[callee.property.name='addEventListener']", message: GUARDED },
  { selector: "CallExpression[callee.name=/^set(Timeout|Interval)$/]:not([arguments.0.callee.property.name='wrap'])", message: GUARDED },
  {
    selector: "CallExpression:matches([callee.object.object.name='chrome'], [callee.object.object.object.name='chrome']) > :matches(ArrowFunctionExpression, FunctionExpression)",
    message: GUARDED
  }
];

// Lib files are classic scripts that may run twice in one world (store-readiness spec, section 5).
const LIB_FILE = "Lib files may run twice. Add to the SDT namespace instead of declaring top-level names.";
const LIB_SELECTORS = [{ selector: "Program > :matches(VariableDeclaration, FunctionDeclaration, ClassDeclaration)", message: LIB_FILE }];
```

Set the `src/**/*.js` entry's rule to `"no-restricted-syntax": ["error", ...BASE_SELECTORS]`, and add these entries right after it. Each repeats `BASE_SELECTORS`, because a later entry replaces the rule's option list:

```js
  {
    files: ["src/src/inject/**/*.js"],
    rules: { "no-restricted-syntax": ["error", ...BASE_SELECTORS, ...BLOCK_SELECTORS, ...GUARD_SELECTORS] }
  },
  {
    files: ["src/src/page_action/**/*.js"],
    rules: { "no-restricted-syntax": ["error", ...BASE_SELECTORS, ...BLOCK_SELECTORS] }
  },
  {
    files: ["src/src/lib/**/*.js"],
    rules: { "no-restricted-syntax": ["error", ...BASE_SELECTORS, ...LIB_SELECTORS] }
  },
```

- [ ] **Step 4: Run the checks**

Run: `npm run lint && npm run test:unit`
Expected: PASS. The code under `src/` already follows the rules after Task A5. If lint flags a call that Task A5 missed, fix the call the way Task A5 describes.

- [ ] **Step 5: Commit**

```bash
git add eslint.config.js tests/unit/lint-rules.test.js
git commit -F - <<'EOF'
Lint content scripts for guarded entry points and bare blocks

Content scripts must add listeners, timers and chrome callbacks through
SDT.guard, every content and popup script stays one bare block, and lib
files declare no top-level names.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task A7: Part A docs and PR A

**Files:**
- Modify: `CLAUDE.md`, `CONTRIBUTING.md`, `.coderabbit.yaml`
- `README.md` needs no change in Part A: nothing a user sees changes, apart from QRY-11. Check it again before opening the PR.

- [ ] **Step 1: Update `CLAUDE.md`**

- In "Commands", in the `npm run build` bullet, after "a version mismatch between `package.json` and `src/manifest.json`", add: ", or a content-script group or extension page that loads a script using an `SDT` namespace before the lib file that defines it".
- In "Commands", in the `npm test` bullet, add a sentence: "Unit tests for `src/src/lib/` load the lib files into a `vm` context with a stub `chrome` (`tests/unit/helpers/sdt.js`); compare values made there with `plain()`, because they have that context's prototypes."
- In "Architecture", replace the paragraph that starts "Each script is wrapped in a bare `{ ... }` block" with:

  ```markdown
  Each script is wrapped in a bare `{ ... }` block, which lint enforces. This is deliberate: all of an extension's content scripts in a frame share one isolated world, even across `content_scripts` groups, and the blocks keep their `const` declarations from colliding. Shared code lives in `src/src/lib/` (spec section 5). Each lib file is a classic script that adds one namespace to `globalThis.SDT` and declares nothing at the top level, so running it twice is harmless. Every `content_scripts` group lists the lib files first, in one order, and `page_action.html` loads them first too; the build fails if a script uses an `SDT` namespace before the file that defines it. `SDT.dom` holds `loadElement` and the text helpers. Until Part B of Phase 2 each script still has its own `ajax` copy.

  After an extension update, Chrome cuts off the old content scripts: `chrome.runtime.id` reads undefined and `chrome.*` calls throw. So a content script's top level only declares names and ends with `SDT.guard.onLoad(start)` or `SDT.guard.run(start)`, and every listener, timer and `chrome.*` callback goes through `SDT.guard.listen` or `SDT.guard.wrap`. Lint enforces this, and `tests/unit/guard-entry-points.test.js` runs each group with the context gone.
  ```

  As written, the paragraphs say "which lint enforces for content and popup scripts" (lint doesn't check the options page or the service worker), name `SDT.dom`'s `text` and `clear` and `SDT.guard`, keep the note that a change to an `ajax` copy applies only to that file, add XHR callbacks to the guarded entry points, and say lint checks listeners, timers and inline `chrome.*` callbacks under `src/src/inject/`.
- In "Commands", in the `npm run lint` bullet, add the block, guard and lib-file rules.
- In "Architecture", in the Background paragraph, change "`mapImages.js` and `queryTest.js` start from a `window` `load` listener" to "`inject.js`, `mapImages.js` and `queryTest.js` start from `SDT.guard.onLoad`".
- Change the last line, "Code under `src/` builds DOM with `loadElement` and text nodes", to "Code under `src/` builds DOM with `SDT.dom.loadElement` and text nodes".

- In the store-readiness spec, move INJ-17 to Phase 2 in Appendix A, drop the `readyState` line from Phase 5's clean-up list, and mention it under Phase 2's extension-context guard.

- [ ] **Step 2: Update `CONTRIBUTING.md`**

After the `npm test` bullet, add:

```markdown
- Shared code goes in `src/src/lib/`, as classic scripts that add to the `SDT` namespace. Add a new lib file to every `content_scripts` group and to `page_action.html`, after the files it uses. Unit tests load the lib in Node through `vm` (see `tests/unit/helpers/sdt.js`).
```

- [ ] **Step 3: Update `.coderabbit.yaml`**

Add these path instructions after the `src/**/*.js` entry:

```yaml
    - path: "src/src/lib/**"
      instructions: |
        Shared classic scripts. Each starts with globalThis.SDT ??= {} and assigns one SDT namespace;
        flag top-level const, let, function or class declarations. A lib file may use only the SDT
        namespaces of files loaded before it: the manifest's content_scripts groups and
        page_action.html list them in one order, which the build checks.
    - path: "src/src/inject/**"
      instructions: |
        Content scripts can outlive their extension after an update. Flag addEventListener calls,
        timers and chrome.* callbacks that don't go through SDT.guard, and top-level code that runs
        before SDT.guard.onLoad or SDT.guard.run.
```

- [ ] **Step 4: Final verification**

Run: `npm run lint && npm run test:unit && node scripts/build.js`, then the browser tests, then `git status --short`.
Expected: everything passes, the known bugs are expected failures, and only the docs are uncommitted.

- [ ] **Step 5: Commit, push and open PR A**

```bash
git add CLAUDE.md CONTRIBUTING.md .coderabbit.yaml
git commit -F - <<'EOF'
Describe the shared lib and the guard in the docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git push -u origin claude/confident-einstein-4pr58r
```

Open the PR against `main` with the title "Phase 2, part A: shared lib, DOM helpers and the extension-context guard". The body says "Part of #44" and lists:
- QRY-11: `SDT.dom.loadElement` keeps `0` and `false` (unit test in `tests/unit/dom.test.js`), and every script uses it.
- BG-1, guard part: `SDT.guard`, and the `vm` entry-point test that runs each content-script group with `chrome.runtime.id` undefined. `default_state` stays with Phase 3.
- SET-9, guard part: the in-page form's save now stops quietly after an update. The form goes in Phase 3.
- INJ-17: `readyState` polling replaced by `SDT.guard.onLoad` (moved from Phase 5; see the plan's Decisions).
- ADV-1, this phase's part: `CLAUDE.md`, `CONTRIBUTING.md` and `.coderabbit.yaml` describe the lib. `README.md` has nothing user-facing to change.
- The section 5 mechanism: lib files, load order, the `vm` loader and the build check, with its `build.test.js` case.
- What stays for PR B: every `ajax` copy, the network helpers, the classifier and the class prefix.

End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)` and your session line. Then run `gh pr checks --watch`. The `chrome-120` job may fail without blocking.

---

# Part B: network helpers, token scope, classifier and switch-over

Start after PR A has merged (`git fetch origin && git merge origin/main`).

Closes INJ-1, INJ-12, INJ-16, QRY-17, POP-9, SEC-11, ADV-6, TOK-1, TOK-2, TOK-4, TOK-5 and TOK-6. Closes this phase's part of INJ-2, INJ-4, INJ-18, INJ-19, PRT-1, QRY-3, QRY-5, QRY-10, QRY-15, QRY-18, SEC-5, ADV-1, ADV-5, TOK-3 and POP-6 (token part). Token spec: TR-2, TR-6, TR-8, the pathname half of TR-5, and this phase's part of TR-7 and TR-14.

### Task B1: `SDT.auth`: the token scope

**Files:**
- Create: `src/src/lib/auth.js`
- Create: `tests/unit/auth.test.js`
- Modify: `src/manifest.json`, `page_action.html` (load `auth.js` after `guard.js`)
- Modify: `docs/superpowers/specs/2026-10-13-token-support-design.md` (section 5.1)

**Interfaces:**
- Produces: `SDT.auth.splitRest`, `isHosted`, `scopeOf`, `pageToken` (see Public API).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/auth.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLib, plain } from "./helpers/sdt.js";

const { auth } = loadLib().SDT;
const ENTERPRISE = "https://gis.example.org/server";

test("the scope is the origin plus the path before the first whole-segment rest/services", () => {
  assert.equal(auth.scopeOf(`${ENTERPRISE}/rest/services/Parcels/MapServer/0`), ENTERPRISE);
  assert.equal(auth.scopeOf("https://gis.example.org/rest/services"), "https://gis.example.org");
  assert.equal(auth.scopeOf("https://gis.example.org:6443/arcgis/rest/services?f=json#top"), "https://gis.example.org:6443/arcgis");
  assert.equal(auth.scopeOf("http://gis.example.org/arcgis/rest/services"), "http://gis.example.org/arcgis");
});

test("instance paths that differ only in case share one scope", () => {
  const scopes = ["https://GIS.Example.org/Server/rest/services", `${ENTERPRISE}/REST/Services/A/MapServer`, `${ENTERPRISE}/rest/services`];
  assert.deepEqual(new Set(scopes.map((url) => auth.scopeOf(url))), new Set([ENTERPRISE]));
});

test("ArcGIS Online org IDs that differ only in case are two scopes", () => {
  const upper = auth.scopeOf("https://services3.arcgis.com/Ab12Cd/arcgis/rest/services/P/FeatureServer");
  const lower = auth.scopeOf("https://services3.arcgis.com/ab12cd/arcgis/rest/services/P/FeatureServer");
  assert.equal(upper, "https://services3.arcgis.com/Ab12Cd/arcgis");
  assert.equal(lower, "https://services3.arcgis.com/ab12cd/arcgis");
  assert.equal(auth.scopeOf("https://services3.arcgis.com/Ab12Cd/ArcGIS/rest/services"), upper);
});

test("on a tiles host the org ID is the second segment and keeps its case", () => {
  assert.equal(auth.scopeOf("https://tiles.arcgis.com/Tiles/Ab12Cd/ArcGIS/rest/services/Base/MapServer"), "https://tiles.arcgis.com/tiles/Ab12Cd/arcgis");
  assert.notEqual(auth.scopeOf("https://tiles.arcgis.com/tiles/ab12cd/arcgis/rest/services"), "https://tiles.arcgis.com/tiles/Ab12Cd/arcgis");
});

test("other arcgis.com hosts are Enterprise scopes, lower-cased", () => {
  assert.equal(auth.scopeOf("https://elevation.arcgis.com/ArcGIS/rest/services"), "https://elevation.arcgis.com/arcgis");
});

test("%2e%2e segments are resolved before the check", () => {
  assert.equal(auth.scopeOf("https://gis.example.org/x/%2e%2e/server/rest/services"), ENTERPRISE);
  assert.equal(auth.scopeOf(`${ENTERPRISE}/rest/services/%2e%2e/%2E%2e/admin`), null);
});

test("an instance path that still holds %2f or %2e after parsing has no scope", () => {
  assert.equal(auth.scopeOf("https://gis.example.org/a%2fb/rest/services"), null);
  assert.equal(auth.scopeOf("https://gis.example.org/a%2Eb/rest/services"), null);
  assert.equal(auth.scopeOf("https://gis.example.org/a%2Fb/rest/services"), null);
});

test("/restricted/rest/services scopes to /restricted", () => {
  assert.equal(auth.scopeOf("https://gis.example.org/restricted/rest/services/A/MapServer"), "https://gis.example.org/restricted");
});

test("/admin, /tokens and /manager stay outside every scope", () => {
  for (const url of [
    "https://gis.example.org/server/admin",
    "https://gis.example.org/server/admin/services",
    "https://gis.example.org/server/tokens/generateToken",
    "https://gis.example.org/server/manager",
    "https://gis.example.org/server/Admin/rest/services",
    "https://gis.example.org/server/rest/admin"
  ]) {
    assert.equal(auth.scopeOf(url), null, url);
  }
});

test("rest/services must be whole segments of the pathname", () => {
  assert.equal(auth.scopeOf("https://gis.example.org/arcgis/rest/servicesX"), null);
  assert.equal(auth.scopeOf("https://gis.example.org/arcgis/myrest/services"), null);
  assert.equal(auth.scopeOf("https://gis.example.org/evil.html?x=/rest/services/"), null);
  assert.equal(auth.scopeOf("https://gis.example.org/evil.html#/arcgis/rest/services"), null);
});

test("URLs that aren't http(s) or don't parse have no scope", () => {
  assert.equal(auth.scopeOf("ftp://gis.example.org/arcgis/rest/services"), null);
  assert.equal(auth.scopeOf("chrome-extension://abc/arcgis/rest/services"), null);
  assert.equal(auth.scopeOf("not a url"), null);
});

test("splitRest returns the instance and the tail", () => {
  assert.deepEqual(plain(auth.splitRest("/a/b/REST/services/F/S/MapServer/")), { instance: ["a", "b"], tail: ["F", "S", "MapServer"] });
  assert.equal(auth.splitRest("/a/rest"), null);
});

test("pageToken reads a non-empty token from a page with a scope", () => {
  const page = (search) => ({ search, href: `${ENTERPRISE}/rest/services${search}` });
  assert.deepEqual(plain(auth.pageToken(page("?f=html&token=abc.1"))), { value: "abc.1", scope: ENTERPRISE });
  assert.equal(auth.pageToken(page("?token=")), null);
  assert.equal(auth.pageToken(page("?f=html")), null);
  assert.equal(auth.pageToken({ search: "?token=abc", href: "https://gis.example.org/evil.html?token=abc" }), null);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/unit/auth.test.js`
Expected: FAIL with `Cannot read properties of undefined (reading 'scopeOf')`.

- [ ] **Step 3: Write `src/src/lib/auth.js`**

```js
// SDT.auth: the token scope (token support spec, section 5.1). A page's token goes only to URLs in
// the page's scope: the origin plus the path before the first whole-segment rest/services.
globalThis.SDT ??= {};

SDT.auth = {
  // Instance-path segments that never take a token: the Administrator Directory, the token
  // service and Manager.
  OUTSIDE: ["admin", "tokens", "manager"],

  /** True for ArcGIS Online's hosted services and tiles hosts, where an org ID is case-sensitive. */
  isHosted(hostname) {
    return /^(?:services|tiles)(?:qa|dev)?\d*\.arcgis\.com$/i.test(hostname);
  },

  /**
   * Splits a pathname at its first whole-segment rest/services, in any case. Returns the segments
   * before it and the non-empty ones after it, still percent-encoded, or null.
   */
  splitRest(pathname) {
    const segments = String(pathname).split("/").slice(1);
    for (let i = 0; i < segments.length - 1; i++) {
      if (segments[i].toLowerCase() === "rest" && segments[i + 1].toLowerCase() === "services") {
        return { instance: segments.slice(0, i), tail: segments.slice(i + 2).filter(Boolean) };
      }
    }
    return null;
  },

  /**
   * The scope of url as a string, such as "https://gis.example.org/server", or null. Reads only the
   * parsed pathname. Two URLs share a scope exactly when their strings are equal.
   */
  scopeOf(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    const split = SDT.auth.splitRest(parsed.pathname);
    if (!split) {
      return null;
    }
    // new URL has resolved dot segments, %2e ones included. An encoded slash or dot that survives
    // could mean something else to the server, so such a path gets no scope.
    if (split.instance.some((segment) => /%2[ef]/i.test(segment))) {
      return null;
    }
    if (split.instance.some((segment) => SDT.auth.OUTSIDE.includes(segment.toLowerCase()))) {
      return null;
    }
    // Instance paths match in any case, except an ArcGIS Online org ID.
    const hosted = SDT.auth.isHosted(parsed.hostname);
    const path = split.instance.map((segment) => (!hosted || /^(?:arcgis|tiles)$/i.test(segment) ? segment.toLowerCase() : segment));
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path.map((segment) => `/${segment}`).join("")}`;
  },

  /** The page URL's token and the page's scope, or null. An empty token is never used. */
  pageToken(location) {
    const value = new URLSearchParams(location.search).get("token");
    const scope = value ? SDT.auth.scopeOf(location.href) : null;
    return value && scope ? { value, scope } : null;
  }
};
```

- [ ] **Step 4: Wire it in, and update the token spec**

Add `"src/lib/auth.js"` after `"src/lib/guard.js"` in each of the three `js` arrays, and `<script src="../lib/auth.js"></script>` after the `guard.js` line in `page_action.html`.

In `docs/superpowers/specs/2026-10-13-token-support-design.md`, section 5.1, replace the third bullet ("lower-cases the host and the instance path, but not an ArcGIS Online org ID") with:

```markdown
- lower-cases the host and the instance path. On a hosted ArcGIS Online host it lower-cases only the `arcgis` and `tiles` segments, so the org ID keeps its case (`/<orgId>/arcgis` on services hosts, `/tiles/<orgId>/arcgis` on tiles hosts)
```

Replace the paragraph after the bullets ("A path such as `/restricted/rest/services` scopes to ... Issue #44 settles how encoded slashes and double-encoded dots that survive `new URL` are handled.") with:

```markdown
A path such as `/restricted/rest/services` scopes to `/restricted`, as Phase 2 of the store-readiness spec says. `new URL` resolves `%2e`-encoded dot segments. If the instance path still contains `%2f` or `%2e` in any case after parsing, `scopeOf` returns null, so no token is attached (owner's decision on issue #44, 2026-10-20).
```

- [ ] **Step 5: Run the tests**

Run: `npm run lint && npm run test:unit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/src/lib/auth.js src/manifest.json src/src/page_action/page_action.html tests/unit/auth.test.js docs/superpowers/specs/2026-10-13-token-support-design.md
git commit -F - <<'EOF'
Add SDT.auth.scopeOf, the token scope

The scope comes from the parsed pathname, up to the first whole-segment
rest/services. Host and instance path match in any case except an
ArcGIS Online org ID. Paths under admin, tokens or manager, and
instance paths that keep an encoded slash or dot, have no scope.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task B2: `SDT.url`: the URL builder and the link-href stripper

**Files:**
- Create: `src/src/lib/url.js`
- Create: `tests/unit/url.test.js`
- Modify: `src/manifest.json`, `page_action.html` (load `url.js` after `auth.js`)

**Interfaces:**
- Consumes: `SDT.auth.scopeOf`.
- Produces: `SDT.url.build`, `stripForFilter`, `tidy` (see Public API).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/url.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLib } from "./helpers/sdt.js";

const { url } = loadLib().SDT;
const SCOPE = "https://gis.example.org/server";
const BASE = `${SCOPE}/rest/services/Parcels/MapServer`;
const TOKEN = { value: "tok.en-1", scope: SCOPE };

const summary = (request) => request && { url: request.url, method: request.method, body: request.body?.toString() ?? null, carriesToken: request.carriesToken };

test("without a token, params go in the query string in order", () => {
  assert.deepEqual(summary(url.build(`${BASE}/0/query`, { where: "not OBJECTID is null", returnGeometry: false, returnCountOnly: true, f: "json" })), {
    url: `${BASE}/0/query?where=not+OBJECTID+is+null&returnGeometry=false&returnCountOnly=true&f=json`,
    method: "GET",
    body: null,
    carriesToken: false
  });
});

test("a token inside the scope goes in a POST body with the params, and the URL keeps neither", () => {
  assert.deepEqual(summary(url.build(`${BASE}?f=html#frag`, { f: "json" }, TOKEN)), {
    url: BASE,
    method: "POST",
    body: "f=json&token=tok.en-1",
    carriesToken: true
  });
});

test("the token goes to an instance path in another case: it is the same scope", () => {
  assert.equal(url.build("https://GIS.example.org/Server/rest/services/A/MapServer", { f: "json" }, TOKEN).carriesToken, true);
});

test("a token never goes outside its scope", () => {
  for (const base of [
    "https://other.example.org/server/rest/services/A/MapServer",
    "http://gis.example.org/server/rest/services/A/MapServer",
    "https://gis.example.org/portal/rest/services/A/MapServer",
    "https://gis.example.org/server/admin/services",
    `${SCOPE}/rest/services/%2e%2e/%2e%2e/admin/x`
  ]) {
    const request = url.build(base, { f: "json" }, TOKEN);
    assert.equal(request.carriesToken, false, base);
    assert.equal(request.method, "GET", base);
    assert.doesNotMatch(request.url, /token/, base);
  }
});

test("an empty token is never sent", () => {
  const request = url.build(BASE, { f: "json" }, { value: "", scope: SCOPE });
  assert.deepEqual(summary(request), { url: `${BASE}?f=json`, method: "GET", body: null, carriesToken: false });
});

test("a token already in the base URL is dropped, not forwarded", () => {
  assert.equal(url.build(`${BASE}?token=from-a-link`, { f: "json" }).url, `${BASE}?f=json`);
  assert.equal(url.build(`${BASE}?token=from-a-link`, { f: "json" }, TOKEN).body.toString(), "f=json&token=tok.en-1");
});

test("method POST without a token puts the params in the body", () => {
  assert.deepEqual(summary(url.build(BASE, { f: "json" }, null, { method: "POST" })), { url: BASE, method: "POST", body: "f=json", carriesToken: false });
});

test("undefined and null params are dropped", () => {
  assert.equal(url.build(BASE, { f: "json", where: undefined, outFields: null }).url, `${BASE}?f=json`);
});

test("only http(s) and the extension's own URLs can be built", () => {
  assert.equal(url.build("chrome-extension://abc/src/config/options.json").url, "chrome-extension://abc/src/config/options.json");
  assert.equal(url.build("ftp://gis.example.org/x"), null);
  assert.equal(url.build("javascript:alert(1)"), null);
  assert.equal(url.build("not a url"), null);
});

test("stripForFilter drops token, f and the fragment, so the link filters can match (TOK-3)", () => {
  assert.equal(url.stripForFilter(`${BASE}?token=abc`), BASE);
  assert.equal(url.stripForFilter(`${BASE}/0?f=pjson&token=abc#x`), `${BASE}/0`);
  assert.equal(url.stripForFilter(`${BASE}?F=json&Token=abc`), BASE);
  assert.equal(url.stripForFilter(`${BASE}?foo=1&token=abc`), `${BASE}?foo=1`);
  assert.equal(url.stripForFilter(BASE), BASE);
  assert.equal(url.stripForFilter("not a url"), "not a url");
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/unit/url.test.js`
Expected: FAIL with `Cannot read properties of undefined (reading 'build')`.

- [ ] **Step 3: Write `src/src/lib/url.js`**

```js
// SDT.url: builds request URLs, and cleans link hrefs for the link filters. The builder takes the
// token as an argument and never reads location, so a later feature can supply a token from
// elsewhere. It attaches the token only inside the token's scope, and only in a POST body.
globalThis.SDT ??= {};

SDT.url = {
  PROTOCOLS: ["http:", "https:", "chrome-extension:"],

  /** url.href without a trailing "?", which some URL implementations leave after deleting the last parameter. */
  tidy(url) {
    const href = url.href;
    return href.endsWith("?") ? href.slice(0, -1) : href;
  },

  /**
   * Builds a request. token is { value, scope } or null. Returns { url, method, body, carriesToken },
   * or null when base isn't an http(s) or extension URL. A token in base itself is always dropped.
   */
  build(base, params = {}, token = null, { method = "GET" } = {}) {
    let url;
    try {
      url = new URL(base);
    } catch {
      return null;
    }
    if (!SDT.url.PROTOCOLS.includes(url.protocol)) {
      return null;
    }
    url.hash = "";
    url.searchParams.delete("token");
    const entries = Object.entries(params ?? {})
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)]);
    const carriesToken = Boolean(token && token.value && token.scope) && SDT.auth.scopeOf(url.href) === token.scope;
    if (carriesToken || method === "POST") {
      entries.forEach(([key]) => url.searchParams.delete(key));
      const body = new URLSearchParams(entries);
      if (carriesToken) {
        body.set("token", token.value);
      }
      return { url: SDT.url.tidy(url), method: "POST", body, carriesToken };
    }
    entries.forEach(([key, value]) => url.searchParams.set(key, value));
    return { url: SDT.url.tidy(url), method: "GET", body: null, carriesToken: false };
  },

  /** href without its fragment or any token and f parameters, for the link filters (TOK-3). */
  stripForFilter(href) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return String(href ?? "");
    }
    url.hash = "";
    [...url.searchParams.keys()]
      .filter((key) => /^(?:token|f)$/i.test(key))
      .forEach((key) => url.searchParams.delete(key));
    return SDT.url.tidy(url);
  }
};
```

- [ ] **Step 4: Wire it in**

Add `"src/lib/url.js"` after `"src/lib/auth.js"` in the three `js` arrays, and `<script src="../lib/url.js"></script>` after the `auth.js` line in `page_action.html`.

- [ ] **Step 5: Run the tests**

Run: `npm run lint && npm run test:unit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/src/lib/url.js src/manifest.json src/src/page_action/page_action.html tests/unit/url.test.js
git commit -F - <<'EOF'
Add SDT.url.build and SDT.url.stripForFilter

The builder attaches a token only inside its scope, in a POST body,
never sends an empty one, and drops any token already in the URL. The
stripper removes token, f and the fragment from a link before the link
filters test it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task B3: `SDT.net.fetchJson`

**Files:**
- Create: `src/src/lib/net.js`
- Create: `tests/unit/net.test.js`
- Modify: `src/manifest.json`, `page_action.html` (load `net.js` after `url.js`)

**Interfaces:**
- Consumes: `SDT.url.build`.
- Produces: `SDT.net.fetchJson`, `parseJson`, `nanToNull`, `legacyResponse`, `TIMEOUT_MS` (see Public API). Task B4 adds the limiter to the same file.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/net.test.js`. The fetch stub returns plain objects, because Node can't build an `opaqueredirect` `Response`.

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLib, plain } from "./helpers/sdt.js";

const SCOPE = "https://gis.example.org/server";
const BASE = `${SCOPE}/rest/services/Parcels/MapServer`;
const TOKEN = { value: "tok.en-1", scope: SCOPE };

const reply = (text, { status = 200, type = "basic" } = {}) => ({ type, status, ok: status >= 200 && status < 300, text: async () => text });

/** Loads the lib with a fetch that records each call and answers with respond(url, init). */
const withFetch = (respond = () => reply("{}")) => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return { calls, net: loadLib({ globals: { fetch } }).SDT.net };
};

test("a GET sends the params in the URL, and no headers, credentials or redirect mode", async () => {
  const { calls, net } = withFetch(() => reply("{\"name\":\"Parcels\"}"));
  assert.deepEqual(plain(await net.fetchJson(BASE, { params: { f: "json" } })), { data: { name: "Parcels" } });
  assert.equal(calls[0].url, `${BASE}?f=json`);
  assert.equal(calls[0].init.method, "GET");
  for (const key of ["headers", "body", "credentials", "redirect", "referrerPolicy"]) {
    assert.equal(Object.hasOwn(calls[0].init, key), false, key);
  }
});

test("a token inside the scope goes in a form POST body, with redirect manual and default credentials", async () => {
  const { calls, net } = withFetch();
  await net.fetchJson(BASE, { params: { f: "json" }, token: TOKEN });
  assert.equal(calls[0].url, BASE);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.body.toString(), "f=json&token=tok.en-1");
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(Object.hasOwn(calls[0].init, "credentials"), false);
});

test("a token outside the scope, or an empty one, is not sent", async () => {
  const { calls, net } = withFetch();
  await net.fetchJson("https://other.example.org/server/rest/services/A/MapServer", { params: { f: "json" }, token: TOKEN });
  await net.fetchJson(BASE, { params: { f: "json" }, token: { value: "", scope: SCOPE } });
  for (const call of calls) {
    assert.equal(call.init.method, "GET");
    assert.doesNotMatch(call.url, /token/);
    assert.equal(call.init.body, undefined);
  }
});

test("a redirect on a request that carries a token is an error, and its URL has no token", async () => {
  const { net } = withFetch(() => ({ type: "opaqueredirect", status: 0, ok: false, text: async () => "" }));
  const { error } = plain(await net.fetchJson(BASE, { params: { f: "json" }, token: TOKEN }));
  assert.equal(error.type, "redirect");
  assert.equal(error.url, BASE);
  assert.match(error.message, /redirect/i);
});

test("an HTTP error status is an error", async () => {
  const { net } = withFetch(() => reply("<html>Bad Gateway</html>", { status: 502 }));
  assert.deepEqual(plain(await net.fetchJson(BASE)).error, { type: "http", message: "HTTP 502", url: BASE, status: 502 });
});

test("an ArcGIS error body is an error, even at HTTP 200", async () => {
  const body = { error: { code: 498, message: "Invalid Token", details: [] } };
  const { net } = withFetch(() => reply(JSON.stringify(body)));
  assert.deepEqual(plain(await net.fetchJson(BASE)).error, { type: "arcgis", message: "Invalid Token", url: BASE, code: 498, arcgis: body.error });
});

test("bare NaN outside strings becomes null, and NaN inside strings is kept (INJ-12)", async () => {
  const { net } = withFetch(() => reply("{\"a\":NaN,\"b\":\"x: NaN,\",\"c\":[NaN, -NaN],\"d\":\"say \\\"NaN\\\"\"}"));
  assert.deepEqual(plain(await net.fetchJson(BASE)), { data: { a: null, b: "x: NaN,", c: [null, null], d: "say \"NaN\"" } });
  assert.equal(net.nanToNull("{\"a\":\": NaN,\"}"), "{\"a\":\": NaN,\"}");
});

test("a body that isn't JSON is an error", async () => {
  const { net } = withFetch(() => reply("<html><body>Login</body></html>"));
  assert.equal(plain(await net.fetchJson(BASE)).error.type, "parse");
});

test("a network failure, a timeout and an abort are errors", async () => {
  const failing = withFetch(() => Promise.reject(new TypeError("Failed to fetch")));
  assert.equal(plain(await failing.net.fetchJson(BASE)).error.type, "network");

  const hanging = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  const slow = withFetch(hanging);
  assert.equal(plain(await slow.net.fetchJson(BASE, { timeoutMs: 20 })).error.type, "timeout");

  const controller = new AbortController();
  const pending = slow.net.fetchJson(BASE, { signal: controller.signal });
  controller.abort();
  assert.equal(plain(await pending).error.type, "aborted");
});

test("credentials and referrerPolicy overrides are passed through", async () => {
  const { calls, net } = withFetch();
  await net.fetchJson(BASE, { credentials: "omit", referrerPolicy: "no-referrer" });
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(calls[0].init.referrerPolicy, "no-referrer");
});

test("a URL that can't be built is an error, and nothing is sent", async () => {
  const { calls, net } = withFetch();
  assert.equal(plain(await net.fetchJson("javascript:alert(1)")).error.type, "url");
  assert.equal(calls.length, 0);
});

test("legacyResponse gives today's callers data, an ArcGIS error as { error }, or null", () => {
  const { net } = withFetch();
  assert.deepEqual(plain(net.legacyResponse({ data: { a: 1 } })), { a: 1 });
  assert.deepEqual(plain(net.legacyResponse({ error: { type: "arcgis", arcgis: { code: 400 } } })), { error: { code: 400 } });
  assert.equal(net.legacyResponse({ error: { type: "http", status: 502 } }), null);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/unit/net.test.js`
Expected: FAIL with `Cannot read properties of undefined (reading 'fetchJson')`.

- [ ] **Step 3: Write `src/src/lib/net.js`**

```js
// SDT.net: every request the extension sends goes through fetchJson. It checks the HTTP status,
// treats an ArcGIS {"error"} body as an error, times out, keeps the browser's default credentials,
// and always resolves to { data } or { error }. A request that carries a token is a form POST with
// redirect: "manual", so the token never sits in a URL and never follows a redirect.
globalThis.SDT ??= {};

SDT.net = {
  TIMEOUT_MS: 20000,

  /** Replaces each bare NaN or -NaN outside a JSON string with null. */
  nanToNull(text) {
    let out = "";
    let inString = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        out += c;
        if (c === "\\") {
          out += text[i + 1] ?? "";
          i += 1;
        } else if (c === "\"") {
          inString = false;
        }
      } else if (c === "\"") {
        inString = true;
        out += c;
      } else if (c === "-" && text.startsWith("NaN", i + 1)) {
        out += "null";
        i += 3;
      } else if (text.startsWith("NaN", i)) {
        out += "null";
        i += 2;
      } else {
        out += c;
      }
    }
    return out;
  },

  /** JSON.parse, with one retry that maps bare NaN to null. Returns { data } or { error }. */
  parseJson(text) {
    try {
      return { data: JSON.parse(text) };
    } catch {
      // ArcGIS Server sometimes writes NaN where a number belongs. Try again without it.
    }
    try {
      return { data: JSON.parse(SDT.net.nanToNull(text)) };
    } catch {
      return { error: { type: "parse", message: "The server's answer isn't valid JSON." } };
    }
  },

  /**
   * Sends one request and resolves to { data } or { error }; it never rejects. See the Public API in
   * docs/superpowers/plans/2026-10-20-phase-2-shared-core.md for the error types.
   */
  async fetchJson(url, { params = {}, token = null, method = "GET", timeoutMs = SDT.net.TIMEOUT_MS, signal, credentials, referrerPolicy } = {}) {
    const request = SDT.url.build(url, params, token, { method });
    if (!request) {
      return { error: { type: "url", message: "Not an http(s) URL.", url: String(url) } };
    }
    const fail = (type, message, extra = {}) => ({ error: { type, message, url: request.url, ...extra } });
    const timeout = AbortSignal.timeout(timeoutMs);
    const init = { method: request.method, signal: signal ? AbortSignal.any([signal, timeout]) : timeout };
    if (request.body) {
      init.body = request.body;
    }
    if (request.carriesToken) {
      init.redirect = "manual";
    }
    if (credentials) {
      init.credentials = credentials;
    }
    if (referrerPolicy) {
      init.referrerPolicy = referrerPolicy;
    }
    const failure = () => {
      if (timeout.aborted) {
        return fail("timeout", `No answer within ${timeoutMs / 1000} s.`);
      }
      if (signal?.aborted) {
        return fail("aborted", "The request was cancelled.");
      }
      return fail("network", "The request failed before the server answered.");
    };
    let response;
    let text;
    try {
      response = await fetch(request.url, init);
      if (response.type === "opaqueredirect") {
        return fail("redirect", "The server answered with a redirect, which the toolkit doesn't follow for a request that carries a token.");
      }
      if (!response.ok) {
        return fail("http", `HTTP ${response.status}`, { status: response.status });
      }
      text = await response.text();
    } catch {
      return failure();
    }
    const parsed = SDT.net.parseJson(text);
    if (parsed.error) {
      return fail("parse", parsed.error.message);
    }
    const { data } = parsed;
    if (data && typeof data === "object" && !Array.isArray(data) && data.error && typeof data.error === "object") {
      return fail("arcgis", String(data.error.message ?? "The server reported an error."), { code: data.error.code, arcgis: data.error });
    }
    return { data };
  },

  /**
   * Transitional, for callers written for the old ajax helper: data, an ArcGIS error as { error },
   * or null for any other failure. Phases 5, 7 and 9 rewrite its callers to handle { error }.
   */
  legacyResponse(result) {
    if (!result.error) {
      return result.data;
    }
    return result.error.arcgis ? { error: result.error.arcgis } : null;
  }
};
```

- [ ] **Step 4: Wire it in**

Add `"src/lib/net.js"` after `"src/lib/url.js"` in the three `js` arrays, and `<script src="../lib/net.js"></script>` after the `url.js` line in `page_action.html`.

- [ ] **Step 5: Run the tests**

Run: `npm run lint && npm run test:unit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/src/lib/net.js src/manifest.json src/src/page_action/page_action.html tests/unit/net.test.js
git commit -F - <<'EOF'
Add SDT.net.fetchJson

It checks the status, treats an ArcGIS error body as an error, maps
bare NaN to null only outside strings (INJ-12), times out, sends no
headers of its own on GET (POP-9) and keeps default credentials
(TOK-5). A token goes in a form POST body (TOK-4), and a request that
carries one doesn't follow redirects (TOK-1).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task B4: The request limiter

**Files:**
- Modify: `src/src/lib/net.js`
- Create: `tests/unit/limiter.test.js`

**Interfaces:**
- Consumes: `SDT.auth.scopeOf`, `SDT.net.fetchJson`.
- Produces: `SDT.net.createLimiter`, `pageLimiter`, `isSkipped`, `limitNote`, `stoppedNote`, `BUDGET` (see Public API).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/limiter.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLib, plain } from "./helpers/sdt.js";

const { net } = loadLib().SDT;
const SCOPE = "https://gis.example.org/server";
const at = (i) => `${SCOPE}/rest/services/S${i}/MapServer`;
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** A fetchJson stand-in whose requests stay open until the test finishes them, or their signal aborts. */
const fakeFetch = () => {
  const open = [];
  let active = 0;
  let peak = 0;
  let sent = 0;
  const fetchJson = (url, options) => new Promise((resolve) => {
    sent += 1;
    active += 1;
    peak = Math.max(peak, active);
    const job = {
      url,
      options,
      finish(result) {
        if (open.includes(job)) {
          open.splice(open.indexOf(job), 1);
          active -= 1;
          resolve(result);
        }
      }
    };
    options.signal.addEventListener("abort", () => job.finish({ error: { type: "aborted", message: "cancelled", url } }));
    open.push(job);
  });
  return { open, fetchJson, peak: () => peak, sent: () => sent };
};

const pageTarget = () => {
  const listeners = {};
  return {
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    fire(type) {
      (listeners[type] ?? []).forEach((fn) => fn());
    }
  };
};

const OK = { data: {} };

test("accepts 50 requests, and each one past that resolves with the note at once", async () => {
  const fake = fakeFetch();
  const limiter = net.createLimiter({ scope: SCOPE, fetchJson: fake.fetchJson });
  const results = Array.from({ length: 60 }, (_, i) => limiter.fetchJson(at(i)));
  for (let i = 50; i < 60; i++) {
    assert.deepEqual(plain(await results[i]).error, { type: "limit", message: "Not loaded: request limit reached (50)", url: at(i), max: 50 });
  }
  while (fake.open.length) {
    fake.open[0].finish(OK);
    await flush();
  }
  assert.equal(fake.sent(), 50);
  assert.equal(plain(limiter.stats()).accepted, 50);
});

test("never has more than 4 requests in flight", async () => {
  const fake = fakeFetch();
  const limiter = net.createLimiter({ scope: SCOPE, fetchJson: fake.fetchJson });
  const results = Array.from({ length: 20 }, (_, i) => limiter.fetchJson(at(i)));
  await flush();
  assert.equal(fake.open.length, 4);
  while (fake.open.length) {
    fake.open[0].finish(OK);
    await flush();
    assert.ok(fake.open.length <= 4);
  }
  await Promise.all(results);
  assert.equal(fake.peak(), 4);
  assert.equal(fake.sent(), 20);
});

test("pagehide cancels the requests in flight and the queue, and later calls send nothing", async () => {
  const fake = fakeFetch();
  const target = pageTarget();
  const limiter = net.createLimiter({ scope: SCOPE, target, fetchJson: fake.fetchJson });
  const results = Array.from({ length: 6 }, (_, i) => limiter.fetchJson(at(i)));
  await flush();
  const signals = fake.open.map((job) => job.options.signal);
  target.fire("pagehide");
  assert.ok(signals.every((signal) => signal.aborted));
  for (const result of results) {
    assert.equal(plain(await result).error.type, "aborted");
  }
  assert.equal(plain(await limiter.fetchJson(at(9))).error.type, "aborted");
  assert.equal(fake.sent(), 4);
});

for (const status of [429, 503]) {
  test(`an HTTP ${status} stops automatic work: the rest resolve as stopped`, async () => {
    const fake = fakeFetch();
    const limiter = net.createLimiter({ scope: SCOPE, fetchJson: fake.fetchJson });
    const results = Array.from({ length: 6 }, (_, i) => limiter.fetchJson(at(i)));
    await flush();
    fake.open[0].finish({ error: { type: "http", status, message: `HTTP ${status}`, url: at(0) } });
    const note = `Not loaded: the server answered HTTP ${status}, so automatic requests stopped`;
    for (const [i, result] of results.entries()) {
      assert.deepEqual(plain(await result).error, { type: "stopped", message: note, url: at(i), status });
    }
    assert.equal(plain(await limiter.fetchJson(at(9))).error.type, "stopped");
    assert.equal(fake.sent(), 4);
    assert.equal(plain(limiter.stats()).stopped, status);
  });
}

test("a URL outside the scope is refused, sends nothing and isn't counted", async () => {
  const fake = fakeFetch();
  const limiter = net.createLimiter({ scope: SCOPE, fetchJson: fake.fetchJson });
  assert.equal(plain(await limiter.fetchJson("https://services9.arcgis.com/Org/arcgis/rest/services/A/FeatureServer")).error.type, "destination");
  assert.equal(plain(await net.createLimiter({ fetchJson: fake.fetchJson }).fetchJson(at(1))).error.type, "destination");
  assert.equal(fake.sent(), 0);
  assert.equal(plain(limiter.stats()).accepted, 0);
});

test("the caller's own signal still cancels its request", async () => {
  const fake = fakeFetch();
  const limiter = net.createLimiter({ scope: SCOPE, fetchJson: fake.fetchJson });
  const controller = new AbortController();
  const result = limiter.fetchJson(at(1), { signal: controller.signal });
  await flush();
  controller.abort();
  assert.equal(plain(await result).error.type, "aborted");
});

test("isSkipped is true for the limit and for stopped work only", () => {
  assert.equal(net.isSkipped({ error: { type: "limit" } }), true);
  assert.equal(net.isSkipped({ error: { type: "stopped" } }), true);
  assert.equal(net.isSkipped({ error: { type: "http", status: 502 } }), false);
  assert.equal(net.isSkipped({ data: {} }), false);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/unit/limiter.test.js`
Expected: FAIL with `net.createLimiter is not a function`.

- [ ] **Step 3: Add the limiter to `src/src/lib/net.js`**

Add these members to the `SDT.net` object, after `legacyResponse`:

```js
  // Section 4.3 of the store-readiness spec: automatic requests per page view, and at once.
  BUDGET: { max: 50, concurrency: 4 },

  limitNote(max) {
    return `Not loaded: request limit reached (${max})`;
  },

  stoppedNote(status) {
    return `Not loaded: the server answered HTTP ${status}, so automatic requests stopped`;
  },

  /** True when a row was left out by the budget or after server pushback; show result.error.message. */
  isSkipped(result) {
    return result?.error?.type === "limit" || result?.error?.type === "stopped";
  },

  /**
   * A queue for automatic requests. It sends only to URLs in scope, accepts at most max, keeps at
   * most concurrency in flight, cancels everything on target's pagehide, and stops for good after an
   * HTTP 429 or 503. fetchJson(url, options) takes SDT.net.fetchJson's options and never rejects.
   */
  createLimiter({ max = SDT.net.BUDGET.max, concurrency = SDT.net.BUDGET.concurrency, scope = null, target = null, fetchJson = (url, options) => SDT.net.fetchJson(url, options) } = {}) {
    const controller = new AbortController();
    const queue = [];
    const state = { accepted: 0, active: 0, peak: 0, stopped: null };
    const refusal = (type, message, url, extra = {}) => ({ error: { type, message, url: String(url), ...extra } });
    const halted = (url) => (state.stopped
      ? refusal("stopped", SDT.net.stoppedNote(state.stopped), url, { status: state.stopped })
      : refusal("aborted", "Not loaded: the page was left.", url));
    const halt = () => {
      controller.abort();
      while (queue.length) {
        const job = queue.shift();
        job.resolve(halted(job.url));
      }
    };
    const finish = (job, result) => {
      state.active -= 1;
      const status = result?.error?.status;
      if ((status === 429 || status === 503) && !state.stopped) {
        state.stopped = status;
        halt();
      }
      job.resolve(state.stopped && result?.error ? halted(job.url) : result);
      pump();
    };
    const pump = () => {
      while (state.active < concurrency && queue.length) {
        const job = queue.shift();
        state.active += 1;
        state.peak = Math.max(state.peak, state.active);
        const signal = job.options.signal ? AbortSignal.any([job.options.signal, controller.signal]) : controller.signal;
        Promise.resolve(fetchJson(job.url, { ...job.options, signal })).then(
          (result) => finish(job, result),
          () => finish(job, refusal("network", "The request failed before the server answered.", job.url))
        );
      }
    };
    if (target) {
      target.addEventListener("pagehide", halt);
    }
    return {
      fetchJson(url, options = {}) {
        if (state.stopped || controller.signal.aborted) {
          return Promise.resolve(halted(url));
        }
        if (!scope || SDT.auth.scopeOf(url) !== scope) {
          return Promise.resolve(refusal("destination", "Not requested: the link is on another server.", url));
        }
        if (state.accepted >= max) {
          return Promise.resolve(refusal("limit", SDT.net.limitNote(max), url, { max }));
        }
        state.accepted += 1;
        return new Promise((resolve) => {
          queue.push({ url, options, resolve });
          pump();
        });
      },
      stats() {
        return { ...state };
      }
    };
  },

  /** The page's limiter, shared by every content script in the isolated world. */
  pageLimiter() {
    SDT.state ??= {};
    SDT.state.pageLimiter ??= SDT.net.createLimiter({ scope: SDT.auth.scopeOf(location.href), target: window });
    return SDT.state.pageLimiter;
  }
```

`finish` maps any error that arrives after a stop, such as the aborts of the other requests in flight, to the stopped note. A row that succeeded before the stop keeps its data.

- [ ] **Step 4: Run the tests**

Run: `npm run lint && npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/src/lib/net.js tests/unit/limiter.test.js
git commit -F - <<'EOF'
Add the request limiter for automatic requests

At most 50 requests per page view and 4 in flight, only inside the
page's scope, cancelled on pagehide, and stopped after an HTTP 429 or
503. Rows it leaves out get a note to show.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task B5: The 12.1 markup check and `SDT.page`

**Files:**
- Create: `src/src/lib/page.js`
- Create: `tests/unit/page.test.js`
- Modify: `src/manifest.json`, `page_action.html` (load `page.js` after `net.js`)
- Modify: `docs/superpowers/specs/2026-10-09-store-readiness-design.md` (Phase 2 section)

**Interfaces:**
- Consumes: `SDT.auth.splitRest`.
- Produces: `SDT.page.classify`, `serviceType`, `typeOf`, `isServicesDirectory`, `baseUrl`, `SERVICE_TYPES`, `HEADING` (see Public API).

**What the 12.1 check found.** A research pass on 2026-10-20 wrote its notes to `/tmp/claude-0/-home-user-Services-Directory-Toolkit/f9dcf4a1-1d81-5af2-8357-dcb323d3fadb/scratchpad/12x-markup.md`. Read it if it still exists. In summary:
- **Source.** A search engine's index of public 12.0, 12.1 and ArcGIS Online Services Directory pages: EPA's `edg.epa.gov`, `gispub.epa.gov` and `geodata.epa.gov`, Esri's `utility.arcgisonline.com` (12.1), UNHCR, the Colorado School of Mines, and ArcGIS Online `services9` and `services1` orgs (reporting version 12). Also the summaries of Esri's 12.1 What's new pages. Esri's hosts refused the connection, so no 12.1 HTML was read.
- **Text level: no difference.** Titles and headings (`Folder: /`, `Layer: X (ID: n)`, `Task: X`, `Execute Task`), "Current Version" and the field labels match the 10.9 and 11.x fixtures. No release note mentions a redesigned Services Directory.
- **Not verified:** the element classes `inject.js` and `mapImages.js` rely on (`td.breadcrumbs`, `td.titlecell`, the `<b>Fields: </b>` list).
- **JSON views** are served as `application/json` (`f=json`) and `text/plain` (`f=pjson`), and Chrome renders them as text documents.
- **Fixtures.** The 12.1 index shows the execute page title as `Execute Task (Export Web Map Task)`, where the fixture has `Execute Task: Export Web Map Task`. That may be wrong for every version, not only 12.x. There is no GP task-page fixture.

So the classifier decides from the pathname and `document.contentType`, and confirms with any one of three markers (Public API, `isServicesDirectory`). No 12.x fixture variant is added. If someone later finds that 12.1 drops `.breadcrumbs` and the title cell, the heading marker still classifies its pages.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/page.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLib } from "./helpers/sdt.js";

const { page } = loadLib().SDT;

// A location that throws on anything but pathname, which proves the classifier reads only that (TOK-6).
const onlyPathname = (pathname) => new Proxy({}, {
  get(_, key) {
    if (key === "pathname") {
      return pathname;
    }
    throw new Error(`read location.${String(key)}`);
  }
});

// A document with the given content type and markers.
const doc = ({ contentType = "text/html", breadcrumbs = true, titleCell = "", h2 = "", title = "" } = {}) => ({
  contentType,
  title,
  querySelector(selector) {
    if (selector === ".breadcrumbs") {
      return breadcrumbs ? { textContent: "Home > services" } : null;
    }
    if (selector === ".titlecell") {
      return titleCell ? { textContent: titleCell } : null;
    }
    if (selector === "h2") {
      return h2 ? { textContent: h2 } : null;
    }
    return null;
  }
});

const ROOT = "/arcgis/rest/services";

test("classifies each Services Directory page type from the pathname", () => {
  const cases = {
    [ROOT]: "root",
    [`${ROOT}/`]: "root",
    "/ArcGIS/REST/Services": "root",
    [`${ROOT}/Transport`]: "folder",
    [`${ROOT}/Transport/Roads/MapServer`]: "service",
    [`${ROOT}/Parcels/mapserver/`]: "service",
    [`${ROOT}/Parcels/MapServer/0`]: "layer",
    [`${ROOT}/Parcels/MapServer/0/query`]: "query",
    [`${ROOT}/Parcels/FeatureServer/query`]: "query",
    [`${ROOT}/Elevation/ImageServer/query`]: "query",
    [`${ROOT}/Parcels/MapServer/find`]: "find",
    [`${ROOT}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/execute`]: "gpTask",
    [`${ROOT}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/submitJob`]: "gpTask",
    [`${ROOT}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task`]: "service",
    [`${ROOT}/Parcels/MapServer/layers`]: "service",
    [`${ROOT}/Parcels/FeatureServer/0/queryDomains`]: "service",
    "/Fk3Org9xQ/ArcGIS/rest/services/Parcels/FeatureServer": "service"
  };
  for (const [pathname, type] of Object.entries(cases)) {
    assert.equal(page.classify(onlyPathname(pathname), doc()), type, pathname);
  }
});

test("a JSON view is jsonView whatever its markup", () => {
  for (const contentType of ["application/json", "text/plain"]) {
    assert.equal(page.classify(onlyPathname(`${ROOT}/Parcels/MapServer/0`), doc({ contentType, breadcrumbs: false })), "jsonView");
  }
});

test("a page whose pathname has no rest/services is other, whatever its query string (TOK-6)", () => {
  // The query string ?x=/rest/services/ is in the URL, but classify never reads it.
  assert.equal(page.classify(onlyPathname("/evil.html"), doc()), "other");
  assert.equal(page.classify(onlyPathname("/arcgis/rest/servicesX/A/MapServer"), doc()), "other");
  assert.equal(page.classify(onlyPathname("/arcgis/myrest/services"), doc()), "other");
});

test("an HTML page without Services Directory markers is other", () => {
  assert.equal(page.classify(onlyPathname(`${ROOT}/Utilities/Valves/MapServer`), doc({ breadcrumbs: false, title: "ArcGIS Server Login" })), "other");
});

test("any one marker is enough, so markup without .breadcrumbs still works", () => {
  const path = onlyPathname(`${ROOT}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/execute`);
  assert.equal(page.classify(path, doc({ breadcrumbs: false, titleCell: "ArcGIS REST Services Directory" })), "gpTask");
  assert.equal(page.classify(path, doc({ breadcrumbs: false, title: "Execute Task (Export Web Map Task)" })), "gpTask");
  assert.equal(page.classify(onlyPathname(ROOT), doc({ breadcrumbs: false, h2: "Folder: /" })), "root");
  assert.equal(page.classify(onlyPathname(`${ROOT}/Parcels/MapServer`), doc({ breadcrumbs: false, h2: "Parcels (MapServer)" })), "service");
});

test("serviceType gives Esri's casing, and baseUrl drops the query and fragment", () => {
  assert.equal(page.serviceType(onlyPathname(`${ROOT}/A/mapserver/0`)), "MapServer");
  assert.equal(page.serviceType(onlyPathname(`${ROOT}/Elevation/ImageServer`)), "ImageServer");
  assert.equal(page.serviceType(onlyPathname(ROOT)), null);
  assert.equal(page.baseUrl({ origin: "https://arcgis.test", pathname: `${ROOT}/A/MapServer` }), `https://arcgis.test${ROOT}/A/MapServer`);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/unit/page.test.js`
Expected: FAIL with `Cannot read properties of undefined (reading 'classify')`.

- [ ] **Step 3: Write `src/src/lib/page.js`**

```js
// SDT.page: what kind of Services Directory page this is. The type comes from location.pathname and
// document.contentType, never from the query string, which content-script patterns also match
// (TOK-6). The markup only confirms the page: any one marker is enough, because 12.1's element
// classes haven't been checked (store-readiness spec, Phase 2).
globalThis.SDT ??= {};

SDT.page = {
  SERVICE_TYPES: ["MapServer", "FeatureServer", "ImageServer", "GPServer", "GeocodeServer", "GeometryServer",
    "GeoDataServer", "GlobeServer", "NAServer", "SceneServer", "StreamServer", "VectorTileServer", "MobileServer",
    "SchematicsServer", "KnowledgeGraphServer", "UtilityNetworkServer", "VersionManagementServer",
    "NetworkDiagramServer", "ParcelFabricServer", "ValidationServer", "WorkflowManagerServer"],

  JSON_TYPES: ["application/json", "text/plain"],

  // Headings and titles of Services Directory pages, in 10.9 to 12.1 and ArcGIS Online.
  HEADING: /^(?:Folder|Layer|Table|Query|Find|Task|Execute Task|Submit Job)\b|\([A-Za-z]+Server\)$/,

  /** The service type a path segment names, in Esri's casing, or null. */
  typeOf(segment) {
    const lower = String(segment).toLowerCase();
    return SDT.page.SERVICE_TYPES.find((type) => type.toLowerCase() === lower) ?? null;
  },

  /** Whether the document looks like a Services Directory page. */
  isServicesDirectory(document) {
    if (document.querySelector(".breadcrumbs")) {
      return true;
    }
    const titleCell = document.querySelector(".titlecell");
    if (titleCell && /ArcGIS REST Services Directory/i.test(titleCell.textContent)) {
      return true;
    }
    const heading = document.querySelector("h2");
    return [document.title, heading?.textContent].some((text) => SDT.page.HEADING.test(String(text ?? "").trim()));
  },

  /** root, folder, service, layer, query, find, gpTask, jsonView or other. */
  classify(location, document) {
    const split = SDT.auth.splitRest(location.pathname);
    if (!split) {
      return "other";
    }
    if (SDT.page.JSON_TYPES.includes(document.contentType)) {
      return "jsonView";
    }
    if (!SDT.page.isServicesDirectory(document)) {
      return "other";
    }
    const { tail } = split;
    const at = tail.findIndex((segment) => SDT.page.typeOf(segment));
    if (at === -1) {
      return tail.length === 0 ? "root" : "folder";
    }
    const after = tail.slice(at + 1).map((segment) => segment.toLowerCase());
    const last = after[after.length - 1];
    if (after.length === 0) {
      return "service";
    }
    if (last === "query") {
      return "query";
    }
    if (after.length === 1 && last === "find") {
      return "find";
    }
    if (SDT.page.typeOf(tail[at]) === "GPServer" && after.length === 2 && (last === "execute" || last === "submitjob")) {
      return "gpTask";
    }
    if (after.length === 1 && /^\d+$/.test(last)) {
      return "layer";
    }
    return "service";
  },

  /** The first service type in the path, in Esri's casing, or null. */
  serviceType(location) {
    const split = SDT.auth.splitRest(location.pathname);
    return split?.tail.map((segment) => SDT.page.typeOf(segment)).find(Boolean) ?? null;
  },

  /** The page URL without its query string and fragment. */
  baseUrl(location) {
    return `${location.origin}${location.pathname}`;
  }
};
```

- [ ] **Step 4: Wire it in, and record the 12.1 check**

Add `"src/lib/page.js"` after `"src/lib/net.js"` in the three `js` arrays, and `<script src="../lib/page.js"></script>` after the `net.js` line in `page_action.html`.

In the store-readiness spec, Phase 2, after the "`SDT` page classifier" bullets, add:

```markdown
**12.1 markup check (2026-10-20).** Source: a search engine's index of public 12.0, 12.1 and ArcGIS Online Services Directory pages (EPA, Esri's `utility.arcgisonline.com`, UNHCR, two ArcGIS Online orgs), and the summaries of Esri's 12.1 What's new pages. Esri's hosts were unreachable from the build environment, so no 12.1 HTML was read. Titles, headings and labels match the 10.9 and 11.x fixtures, and nothing points to a redesign. Element classes such as `td.breadcrumbs` and `td.titlecell` are unverified on 12.1. The classifier therefore takes the type from the pathname and `document.contentType`, and accepts a page with any one of three markers: a `.breadcrumbs` element, the title cell's text, or a Services Directory heading. No 12.x fixture variant was added. The `CONTRIBUTING.md` release check includes opening a 12.1 page to confirm the classes.
```

- [ ] **Step 5: Run the tests**

Run: `npm run lint && npm run test:unit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/src/lib/page.js src/manifest.json src/src/page_action/page_action.html tests/unit/page.test.js docs/superpowers/specs/2026-10-09-store-readiness-design.md
git commit -F - <<'EOF'
Add SDT.page.classify, the page classifier

It reads only location.pathname and the document's content type, and
confirms a Services Directory page with any one of three markers,
because 12.1's element classes are unverified. The spec records the
12.1 check.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task B6: The `sdt-` class prefix, and the known bugs re-checked

**Files:**
- Modify: `src/src/inject/inject.css`, `inject.js`, `status.js`, `mapImages.js`, `queryTest.js`, `printTask.js`
- Modify: `tests/e2e/pages.spec.js`, `harness.spec.js`, `known-bugs.spec.js`
- Modify: `tests/live/smoke.js`
- Modify: `docs/design/scripts/capture-before.js` (a comment)

Class names don't change behaviour, so this task has no failing test of its own (spec section 4.1). The browser tests change with the selectors.

- [ ] **Step 1: Rename the classes**

Rename each class the extension injects, in the scripts and in `inject.css`:

| Old | New |
|---|---|
| `datablock`, `collapsed` | `sdt-datablock`, `sdt-collapsed` |
| `error` | `sdt-error` |
| `sidepanel`, `titlepanel`, `buttonbox` | `sdt-sidepanel`, `sdt-titlepanel`, `sdt-buttonbox` |
| `sql`, `statistic` | `sdt-sql`, `sdt-statistic` |
| `hidden` | `sdt-hidden` |
| `status`, `status-icon`, `open` | `sdt-status`, `sdt-status-icon`, `sdt-open` |
| `map-image-panel`, `none` | `sdt-map-image-panel`, `sdt-none` |
| `loading-metadata`, `loading-nulls`, `loading-domains`, `loading-something`, `loading-querytest`, `loading-mapimage` | `sdt-loading-metadata` and so on |
| `@keyframes spin` | `@keyframes sdt-spin` |

Use `classList` where the code edits class strings:
- `inject.js` `toggleCollapse`: `div.classList.toggle("sdt-collapsed");`
- `status.js`: `statusNode.classList.add("sdt-open")` and `statusNode.classList.remove("sdt-open")` (the `/open/i` tests would also match a page's own classes).
- `printTask.js` `hideInput` and `showInput`: `node.classList.add("sdt-hidden")` and `node.classList.remove("sdt-hidden")`. The old regex also removed a `hidden` class the page itself had set.
- `queryTest.js`: `document.querySelectorAll(".sdt-statistic")`, and `listenAll(sidepanel.node, "button.sdt-sql", ...)`.

Don't rename `parentNode.className === "breadcrumbs"`: that reads the page's class. Ids such as `mapimage` stay until Phase 6 (ADV-10).

Run: `grep -nE "\"(datablock|collapsed|error|sidepanel|titlepanel|buttonbox|sql|statistic|hidden|status|status-icon|open|map-image-panel|none)\"|loading-[a-z]" src/src/inject/*.js | grep -v sdt-`
Expected: no output.

- [ ] **Step 2: Update the tests and the live check**

- `pages.spec.js`: `img.status-icon` to `img.sdt-status-icon`, `.datablock` to `.sdt-datablock`, `.sidepanel` to `.sdt-sidepanel`, and `/loading-/` to `/sdt-loading-/`.
- `harness.spec.js`: both `img.status-icon` selectors.
- `known-bugs.spec.js`: `/loading-/` to `/sdt-loading-/` (INJ-1 and INJ-2), and `.sidepanel select` to `.sdt-sidepanel select` (INJ-3).
- `tests/live/smoke.js`: `.status-icon`, `.datablock`, `.sidepanel` and `button.sql`.
- `docs/design/scripts/capture-before.js`: add a comment line under the first comment paragraph: `// It captures the UI before Phase 2's sdt- class prefix, so run it from a checkout of b3a1efa or earlier.`

- [ ] **Step 3: Make INJ-1 and PRT-1 check POST bodies too**

`fakeServer.requests` records only the method and URL, so a request with `f=json` in a form body would slip past today's INJ-1 and PRT-1 assertions. In `known-bugs.spec.js`, add below the `PRINT_TASK` constant:

```js
// The extension's own requests: those with f=json, in the query string or in a form body.
const extensionRequests = (fakeServer) => fakeServer.calls.filter((call) => call.query.f === "json" || call.body.f === "json");
```

In INJ-1 and PRT-1, replace `expect(fakeServer.requests.filter((request) => request.includes("f=json"))).toEqual([]);` with:

```js
  expect(extensionRequests(fakeServer)).toEqual([]);
```

- [ ] **Step 4: Run the suite, then the known bugs as normal tests**

Run the browser tests (Global Constraints command).
Expected: all pass, with the known bugs reported as expected failures.

Then run:

```bash
SHOW_KNOWN_BUGS=1 CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test tests/e2e/known-bugs.spec.js --grep-invert @cdp
```

Expected: every case fails, each on an assertion about its bug and not in its setup: no selector timeout before the bug's own check. INJ-1 fails on `extensionRequests` (the layer page's own `f=json` request), and PRT-1 on `extensionRequests` or on the "Invalid form." dialog. Record each case's failing line in a table for the PR B body. If a case now fails in its setup, fix its selector before going on.

- [ ] **Step 5: Commit**

```bash
git add src/src/inject tests/e2e tests/live/smoke.js docs/design/scripts/capture-before.js
git commit -F - <<'EOF'
Prefix every class the extension injects with sdt-

A page's own classes, such as error, hidden or open, no longer pick up
the extension's styles, and the extension no longer finds the page's
elements by those names (SEC-11, INJ-19). The INJ-1 and PRT-1 cases now
check form bodies for f=json as well as URLs.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task B7: Gate `status.js`, `printTask.js` and `queryTest.js`, and switch them to `fetchJson`

**Files:**
- Modify: `src/src/inject/status.js`, `printTask.js`, `queryTest.js`
- Modify: `tests/e2e/known-bugs.spec.js` (PRT-1 becomes `test()`), `tests/e2e/pages.spec.js` (append)

**Interfaces:**
- Consumes: `SDT.page.classify`, `SDT.page.baseUrl`, `SDT.auth.pageToken`, `SDT.net.fetchJson`, `SDT.net.pageLimiter`, `SDT.net.legacyResponse`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/e2e/pages.spec.js`. Add `FAKE_ORIGIN` to its import from `./fixtures.js`.

```js
// The extension's own requests: those with f=json, in the query string or in a form body.
const extensionRequests = (fakeServer) => fakeServer.calls.filter((call) => call.query.f === "json" || call.body.f === "json");

for (const path of ["?f=json", "/Parcels/MapServer?f=pjson", "/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task?f=pjson"]) {
  test(`a JSON view gets no requests, no gear and no spinner: ${path}`, async ({ page, fakeServer, actionEnabled }) => {
    await page.goto(`${REST_ROOT}${path}`);
    // Nothing on a JSON view signals that the scripts are done, so give them a moment.
    await page.waitForTimeout(1000);
    expect(extensionRequests(fakeServer)).toEqual([]);
    await expect(page.locator(".sdt-status-icon")).toHaveCount(0);
    expect(await page.evaluate(() => document.body.className)).not.toMatch(/sdt-/);
    expect(await actionEnabled(page)).toBe(false);
  });
}

test("a page whose REST path is only in its query string gets nothing (TOK-6)", async ({ page, fakeServer, actionEnabled }) => {
  // The content-script patterns match this URL, because they also test the query string.
  await page.goto(`${FAKE_ORIGIN}/other/page?x=/arcgis/rest/services/`);
  await page.waitForTimeout(1000);
  await expect(page.locator(".sdt-status-icon")).toHaveCount(0);
  expect(await actionEnabled(page)).toBe(false);
  expect(extensionRequests(fakeServer)).toEqual([]);
});

test("the Query Helper says when it can't load the fields (QRY-5)", async ({ page, fakeServer, expectedErrors }) => {
  fakeServer.override(/^\/arcgis\/rest\/services\/Parcels\/MapServer\/0\?f=json$/, () => ({ status: 502, contentType: "text/html", body: "<html><body>Bad Gateway</body></html>" }));
  expectedErrors.push(/status of 502/);
  await page.goto(`${REST_ROOT}/Parcels/MapServer/0/query`);
  await expect(page.locator(".sdt-sidepanel")).toContainText("Could not load the fields: HTTP 502");
});
```

In `known-bugs.spec.js`, change `knownBug("PRT-1", ...` to `test("PRT-1: a geoprocessing JSON result gets no requests and no dialog", ...`, keeping the body. The harness fails the test on the "Invalid form." dialog.

- [ ] **Step 2: Run the tests to see them fail**

Run: `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test tests/e2e/pages.spec.js tests/e2e/known-bugs.spec.js -g "JSON view|query string|can't load|PRT-1"`
Expected: FAIL. The JSON views and the TOK-6 page get a gear and an enabled button, the Query Helper shows no note, and PRT-1 records requests and a dialog.

- [ ] **Step 3: `status.js`**

- Delete the `ajax` copy.
- In `OptionsForm`, replace `let configUrl = chrome.runtime.getURL("src/config/options.json"); ajax(configUrl, response => this.renderForm(response));` with `this.load();`, and add a method:

  ```js
    async load() {
      const result = await SDT.net.fetchJson(chrome.runtime.getURL("src/config/options.json"));
      this.renderForm(SDT.net.legacyResponse(result) ?? {});
    }
  ```

- At the start of `start`:

  ```js
    // JSON views and pages that aren't Services Directory pages get nothing, not even the button.
    const type = SDT.page.classify(location, document);
    if (type === "jsonView" || type === "other") {
      return;
    }
  ```

- [ ] **Step 4: `printTask.js`**

Delete the `ajax` copy, and replace the final `SDT.guard.run(...)` with:

```js
  SDT.guard.run(async () => {
    if (SDT.page.classify(location, document) !== "gpTask") {
      return;
    }
    const url = SDT.page.baseUrl(location).replace(/\/(execute|submitjob)\/?$/i, "");
    const result = await SDT.net.pageLimiter().fetchJson(url, { params: { f: "json" }, token: SDT.auth.pageToken(location) });
    const response = SDT.net.legacyResponse(result);
    if (response !== null) {
      updateGPForm(response);
    }
  });
```

- [ ] **Step 5: `queryTest.js`**

- Delete the `ajax` copy.
- Replace `setActive` without the IE branches (QRY-10, SEC-11). The caret logic stays as today:

  ```js
  const setActive = (value) => {
    if (active === undefined) {
      return;
    }
    const oldVal = active.value;
    active.focus();
    let iCaretPos = "selectionStart" in active ? active.selectionStart : oldVal.length;
    // insert clicked text
    active.value = oldVal.substring(0, iCaretPos) + value + oldVal.substring(iCaretPos);
    // reset cursor position
    iCaretPos += value.length - (["()", "''"].indexOf(value) > -1);
    if ("selectionStart" in active) {
      active.setSelectionRange(iCaretPos, iCaretPos);
    }
  };
  ```

- `FieldSelector`: in the constructor, change `jsonUrl` to `url + (singleLayer ? "" : "/layers")` and replace the `ajax(jsonUrl, ...)` call with `this.load(jsonUrl, callback);`. Add:

  ```js
    /** Loads the layer JSON, an automatic request, and builds the lists from it. */
    async load(jsonUrl, callback) {
      const result = await SDT.net.pageLimiter().fetchJson(jsonUrl, { params: { f: "json" }, token: SDT.auth.pageToken(location) });
      const data = SDT.net.legacyResponse(result);
      if (data === null) {
        this.parentNode.appendChild(loadElement("P", {}, `Could not load the fields: ${result.error.message}`));
        return;
      }
      this.buildRenderer(callback, data);
    }
  ```

- `updateValues`: replace the `ajax(...)` call. A click starts it, so it doesn't use the limiter:

  ```js
      const result = await SDT.net.fetchJson(`${url}/${layerId}/query`, {
        params: { where: "1=1", returnGeometry: "false", outFields: val, orderByFields: val, returnDistinctValues: "true", f: "json" },
        token: SDT.auth.pageToken(location)
      });
      this._updateValuesCallback(SDT.net.legacyResponse(result));
  ```

  and make `updateValues` an `async` method.
- `onPageLoaded`:

  ```js
  const onPageLoaded = () => {
    // Only real query forms: not other operations, and not JSON results (QRY-3).
    if (SDT.page.classify(location, document) !== "query") {
      return;
    }
    queryHelper(SDT.page.baseUrl(location).replace(/\/query\/?$/i, ""));
  };
  ```

- QRY-18's part here: delete the commented-out list of SQL operators in `addSqlControl`, and change `var df` in `queryHelper` to `const df`.

- [ ] **Step 6: Run the checks**

Run: `npm run lint && npm run test:unit && node scripts/build.js`, then the browser tests.
Expected: all pass. The four new tests and PRT-1 pass, and the other known bugs are still expected failures.

- [ ] **Step 7: Commit**

```bash
git add src/src/inject/status.js src/src/inject/printTask.js src/src/inject/queryTest.js tests/e2e/pages.spec.js tests/e2e/known-bugs.spec.js
git commit -F - <<'EOF'
Run the gear, print and query scripts only on their own pages

status.js, printTask.js and queryTest.js check the page type first, so
JSON views, JSON results (PRT-1) and pages whose REST path is only in
the query string (TOK-6) get nothing. Their requests go through
fetchJson with the page's token, the Query Helper says when it can't
load the fields (QRY-5), and its IE-only branches are gone.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task B8: Switch `inject.js`: classifier, limiter, link stripper and token

**Files:**
- Modify: `src/src/inject/inject.js`
- Create: `tests/e2e/requests.spec.js`
- Modify: `tests/e2e/known-bugs.spec.js` (INJ-1 becomes `test()`)

**Interfaces:**
- Consumes: `SDT.page`, `SDT.auth`, `SDT.url.stripForFilter`, `SDT.net.pageLimiter`, `SDT.net.fetchJson`, `SDT.net.isSkipped`, `SDT.net.legacyResponse`.

- [ ] **Step 1: Write the failing tests**

Create `tests/e2e/requests.spec.js`:

```js
// What the extension sends: the request budget and the token rules (store-readiness spec, section
// 4.3, and token support spec, section 5.3). fakeServer.calls records each request's query string
// and form body separately, so the tests can tell where a token went.
import { test, expect, FAKE_ORIGIN, html, json, ONLINE_ORIGIN, ONLINE_REST_ROOT, ONLINE_TOKENS, REST_ROOT, SERVER_TOKENS } from "./fixtures.js";
import { catalog } from "../fixtures/catalog.js";
import { folderPage } from "../fixtures/pages.js";

const ROOT_PAGE = /^\/arcgis\/rest\/services$/;
const LIMIT_NOTE = "Not loaded: request limit reached (50)";

/** The services root, with extra list items (HTML) at the top of its services list. */
const rootWith = (extraItems) => folderPage({
  folder: "",
  folders: catalog.folders,
  services: catalog.services.filter((service) => !service.name.includes("/")),
  version: catalog.currentVersion
}).replace("<b>Services: </b>\n<ul>\n", `<b>Services: </b>\n<ul>\n${extraItems}`);

const ONLINE_LINKS = `<li><a href="${ONLINE_REST_ROOT}/Parcels/FeatureServer">Online parcels</a> (FeatureServer)</li>
<li><a href="${ONLINE_REST_ROOT}/Parcels/MapServer">Online parcels map</a> (MapServer)</li>
`;

test("links to another server get no automatic requests", async ({ page, fakeServer }) => {
  fakeServer.override(ROOT_PAGE, () => html(rootWith(ONLINE_LINKS)));
  await page.goto(REST_ROOT);
  await expect(page.locator(".sdt-datablock")).toHaveCount(3);
  await page.waitForTimeout(500);
  expect(fakeServer.calls.filter((call) => call.origin !== FAKE_ORIGIN)).toEqual([]);
});

test("a page with 60 service links sends 50 requests, and the other rows say why they're empty", async ({ page, fakeServer }) => {
  const bulk = Array.from({ length: 60 }, (_, i) => ({ name: `Bulk${String(i + 1).padStart(2, "0")}`, type: "MapServer" }));
  fakeServer.override(ROOT_PAGE, () => html(folderPage({ folder: "", folders: [], services: bulk, version: catalog.currentVersion })));
  fakeServer.override(/^\/arcgis\/rest\/services\/Bulk\d+\/MapServer\?f=json$/, () => json({
    currentVersion: catalog.currentVersion,
    serviceDescription: "An invented bulk service.",
    spatialReference: { wkid: 102100, latestWkid: 3857 },
    layers: []
  }));
  await page.goto(REST_ROOT);
  await expect(page.getByText(LIMIT_NOTE)).toHaveCount(10);
  await expect(page.locator(".sdt-datablock")).toHaveCount(50);
  expect(fakeServer.calls.filter((call) => /\/Bulk\d+\/MapServer$/.test(call.path))).toHaveLength(50);
  const lastRow = page.locator("li", { has: page.getByRole("link", { name: "Bulk60", exact: true }) });
  await expect(lastRow).toContainText(LIMIT_NOTE);
});

test("a page opened with ?token= sends the token in each metadata request's POST body, not its URL", async ({ page, fakeServer }) => {
  const token = SERVER_TOKENS.jsmith;
  await page.goto(`${REST_ROOT}/Utilities?token=${token}`);
  // Valves and Mains are secured: their details appear only if the token reached the server.
  await expect(page.locator(".sdt-datablock", { hasText: "Water valves for an invented utility." })).toHaveCount(1);
  await expect(page.locator(".sdt-datablock", { hasText: "Water mains for an invented utility." })).toHaveCount(1);
  const metadata = fakeServer.calls.filter((call) => /\/(MapServer|FeatureServer)$/.test(call.path));
  expect(metadata).toHaveLength(2);
  for (const call of metadata) {
    expect(call.origin).toBe(FAKE_ORIGIN);
    expect(call.method).toBe("POST");
    expect(call.query).toEqual({});
    expect(call.body).toEqual({ f: "json", token });
  }
});

test("on ArcGIS Online, links that carry the page's token get metadata, with the token only in the body (TOK-3)", async ({ page, fakeServer }) => {
  const token = ONLINE_TOKENS.jsmith;
  await page.goto(`${ONLINE_REST_ROOT}?token=${token}`);
  await expect(page.locator(".sdt-datablock")).toHaveCount(2);
  await expect(page.locator(".sdt-datablock", { hasText: "Fire hydrants for an invented city." })).toHaveCount(1);
  const metadata = fakeServer.calls.filter((call) => call.origin === ONLINE_ORIGIN && /\/FeatureServer$/.test(call.path));
  expect(metadata).toHaveLength(2);
  for (const call of metadata) {
    expect(call.method).toBe("POST");
    expect(call.query).toEqual({});
    expect(call.body).toEqual({ f: "json", token });
  }
});

test("a request that carries the token stops at a 307, and nothing reaches the redirect's target (TOK-1)", async ({ page, fakeServer }) => {
  const token = SERVER_TOKENS.jsmith;
  fakeServer.override(/^\/arcgis\/rest\/services\/Parcels\/MapServer$/, () => ({ status: 307, headers: { location: `${ONLINE_ORIGIN}/landing` }, body: "" }));
  await page.goto(`${REST_ROOT}?token=${token}`);
  const row = page.locator("li").filter({ hasText: /^\s*Parcels \(MapServer\)/ });
  await expect(row).toContainText("redirect");
  const redirected = fakeServer.calls.filter((call) => call.path === "/arcgis/rest/services/Parcels/MapServer");
  expect(redirected).toHaveLength(1);
  expect(redirected[0].body).toEqual({ f: "json", token });
  // If the browser had followed the 307, the harness would also record its target as not routed.
  expect(fakeServer.calls.filter((call) => call.origin !== FAKE_ORIGIN)).toEqual([]);
});
```

In `known-bugs.spec.js`, change `knownBug("INJ-1", ...` to `test("INJ-1: a layer's JSON view gets no requests and no spinner", ...`, keeping the body.

- [ ] **Step 2: Run the tests to see them fail**

Run: `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test tests/e2e/requests.spec.js tests/e2e/known-bugs.spec.js -g "INJ-1|requests|token|307|60 service"`
Expected: FAIL. The online link gets a request, all 60 bulk services are requested, the token pages get anonymous GETs (no secured details, no ArcGIS Online metadata), the 307 test sees a GET without the token, and INJ-1 records the layer page's `f=json` request.

- [ ] **Step 3: Rewrite the request code in `inject.js`**

- Delete the `ajax` copy.
- At the top of the block, after `let active = null;`, add:

  ```js
  // Set in the load handler: the page's token, and the limiter every automatic request goes through.
  let token = null;
  let limiter = null;

  // A row that the request budget left out, or that automatic work skipped after server pushback.
  const skippedNote = (error, tag) => loadElement(tag, { "class": "sdt-note" }, tag === "span" ? ` ${error.message}` : error.message);
  ```

- Replace `getLayerCount` with:

  ```js
  const getLayerCount = (url, data, callback) => {
    const ul = document.createElement("ul");
    let oid, shape;

    if (data && Object.hasOwn(data, "objectIdField") && data.objectIdField) {
      oid = data.objectIdField;
    }
    if (data && Object.hasOwn(data, "fields") && data.fields.length) {
      data.fields.some((field) => {
        switch(field.type) {
          case "esriFieldTypeOID":
          case "":
            oid = field.name;
            break;
          case "esriFieldTypeGeometry":
            shape = field.name;
            break;
        }
        return oid && shape;
      });
    }

    const count = async (field, label, fieldType) => {
      const result = await limiter.fetchJson(`${url}/query`, {
        params: { where: `not ${field} is null`, returnGeometry: "false", returnCountOnly: "true", f: "json" },
        token
      });
      if (SDT.net.isSkipped(result)) {
        ul.appendChild(skippedNote(result.error, "li"));
        return;
      }
      const response = SDT.net.legacyResponse(result);
      if (response === null) {
        return; // INJ-2: Phase 5 shows an error line here.
      }
      if (response.count !== undefined && response.count !== null) {
        ul.appendChild(li(label, response.count));
      }
      if (Object.hasOwn(response, "error") && response.error) {
        ul.appendChild(reportError(response.error, { "type": fieldType }));
      }
    };

    if (oid) {
      count(oid, "Number of features", "esriFieldTypeOID");
    } else {
      ul.appendChild(li("No way to query features."));
    }
    if (shape) {
      count(shape, "Features with shapes", "esriFieldTypeGeometry");
    } else if (!/\/featureserver\//i.test(url) && (data.type && data.type !== "Table")) {
      ul.appendChild(li("No visible shape field available."));
    }

    callback(ul);
  };
  ```

  This drops the commented-out `globalIdField` block (INJ-18's dead code). The parameter order matches today's URLs, so INJ-2's override still matches.
- Replace `checkForNulls` with an `async` version that sends both requests through the limiter. A skipped row gets the note and the chain goes on. Any other failure still stops the chain, as today (INJ-2 stays a known bug until Phase 5):

  ```js
  const checkForNulls = async (url, fields, nodes) => {
    if (!fields.length) {
      notifyLoading(false, LOADING_NULLS_CSS);
      return;
    }
    const field = fields.shift(),
      node = nodes.shift(),
      resultList = document.createElement("ul");
    node.appendChild(resultList);
    const countRow = async (where, label) => {
      const timeCheck = Date.now();
      const result = await limiter.fetchJson(`${url}/query`, { params: { where, returnGeometry: "false", returnCountOnly: "true", f: "json" }, token });
      if (SDT.net.isSkipped(result)) {
        resultList.appendChild(skippedNote(result.error, "li"));
        return "skipped";
      }
      const response = SDT.net.legacyResponse(result);
      if (response === null) {
        return "failed"; // INJ-2: today's chain stops here; Phase 5 carries on with an error line.
      }
      const hasError = Object.hasOwn(response, "error") && !!response.error;
      let item = document.createElement("li");
      if (response.count !== undefined && response.count !== null) {
        item.appendChild(loadElement("b", {}, label));
        item.appendChild(document.createTextNode(` ${response.count} `));
        if (response.count === 0) {
          item.appendChild(loadElement("b", {"style": "color:#f00;"}, "!!! "));
        }
        item.appendChild(loadElement("i", {}, `Response time: ${responseTime(timeCheck)}`));
      } else if (hasError) {
        item = reportError(response.error, label === "Features with values:" ? field : undefined);
      }
      resultList.appendChild(item);
      return hasError ? "error" : "counted";
    };
    const first = await countRow(`not ${field.name} is null`, "Features with values:");
    if (first === "failed") {
      return;
    }
    if (first === "counted" && field.type === "esriFieldTypeString") {
      if (await countRow(`not ${field.name} is null and ${field.name} <> ''`, "Features without empty values:") === "failed") {
        return;
      }
    }
    checkForNulls(url, fields, nodes);
  };
  ```

- In `checkDomains`, replace the `params` string and the `ajax(url + params, (response) => {...})` call. Send `limiter.fetchJson(`${url}/query`, { params: { where: `${item.field} = ${value}`, returnGeometry: "false", returnCountOnly: "true", f: "json" }, token })`, make the function `async`, and handle the result the same way: a skipped row appends `skippedNote(result.error, "li")` to `tr` and carries on with the next code, and a `null` from `legacyResponse` returns, as today.
- In `FieldSelector`, make the same changes as in `queryTest.js` (Task B7 Step 5): the constructor calls `this.load(jsonUrl, callback)` through `SDT.net.pageLimiter()`, and `updateValues` calls `SDT.net.fetchJson` with the page token. In `updateValues`, use `token` from the block and `limiter` only in `load`.
- Replace `setActive` with the IE-free version from Task B7 Step 5.
- Replace the body of the `SDT.guard.onLoad(() => { ... })` handler with:

  ```js
    const type = SDT.page.classify(location, document);
    if (type === "jsonView" || type === "other") {
      return;
    }
    token = SDT.auth.pageToken(location);
    limiter = SDT.net.pageLimiter();
    const pageScope = SDT.auth.scopeOf(location.href);
    const url = SDT.page.baseUrl(location);

    // Links to services on this server, outside the breadcrumbs. Each href loses its token, f and
    // fragment before the test (TOK-3), and links to other servers get no requests (SEC-5).
    const tags = Array.prototype.slice.call(document.getElementsByTagName("a"), 0);
    const urls = tags
      .map((tag, i) => ({ i, url: SDT.url.stripForFilter(tag.href) }))
      .filter((item) => tags[item.i].parentNode.className !== "breadcrumbs"
        && SDT.auth.scopeOf(item.url) === pageScope
        && /(map|feature|image|mobile)server(\/\d*\/?)?$/i.test(item.url));

    /** Collects and shows each linked service's details, through the limiter. */
    const collectMetaData = async (items, canCountFeatures) => {
      await Promise.all(items.map(async (item) => {
        const parent = tags[item.i].parentNode;
        const result = await limiter.fetchJson(item.url, { params: { f: "json" }, token });
        if (SDT.net.isSkipped(result)) {
          parent.appendChild(skippedNote(result.error, "span"));
          return;
        }
        if (result.error?.type === "aborted") {
          return;
        }
        const response = SDT.net.legacyResponse(result) ?? { error: { message: result.error.message } };
        const spatialReferenceNode = showSpatialReferenceData(response),
          metadata = showMetadata(response);
        if (spatialReferenceNode !== null) {
          parent.appendChild(spatialReferenceNode);
        }
        if (metadata !== null) {
          parent.appendChild(metadata);
        }
        // if the service has fields, get the layer count
        if (response.fields && response.fields.length && canCountFeatures) {
          getLayerCount(item.url, response, (countList) => {
            parent.appendChild(countList);
          });
        }
      }));
      notifyLoading(false, LOADING_METADATA_CSS);
    };

    chrome.storage.sync.get({
      autoMetadata: true,
      autoFeatureCounts: true
    }, SDT.guard.wrap((items) => {
      if (urls.length && items.autoMetadata) {
        notifyLoading(true, LOADING_METADATA_CSS);
        collectMetaData(urls, items.autoFeatureCounts);
      }
    }));

    // Field and domain counts on layer pages and ImageServer pages.
    if (type === "layer" || (type === "service" && SDT.page.serviceType(location) === "ImageServer")) {
      countFields(url);
    }

    if (type === "find") {
      findHelper(url.replace(/\/find\/?$/i, ""));
    }
  ```

  Metadata requests now run through the limiter, up to four at once, instead of one after another. A failed one shows its error in its own row and no longer stops the others.
- Move today's field-count block (from `ajax(url + "?f=json", (results) => {` to its closing `});`) into a new top-level function. Keep its body, and change only the request and the callback's first lines:

  ```js
  /** Counts values for each field and coded value of the layer at url. */
  const countFields = async (url) => {
    const results = SDT.net.legacyResponse(await limiter.fetchJson(url, { params: { f: "json" }, token }));
    if (results && results.fields && results.fields.length > 0) {
      // ...today's body, unchanged, from "const fieldHTML = getFieldList();" on...
    }
  };
  ```

  Put it after `notifyLoading`, so the `LOADING_*` constants it uses are declared before any call.
- Delete the leftover `// todo:` comments at the end of the handler.

- [ ] **Step 4: Run the checks**

Run: `npm run lint && npm run test:unit && node scripts/build.js`, then the browser tests.
Expected: all pass. `requests.spec.js` and INJ-1 pass, the characterisation tests in `pages.spec.js` still pass, and INJ-2, INJ-3 and INJ-11 are still expected failures.

- [ ] **Step 5: Commit**

```bash
git add src/src/inject/inject.js tests/e2e/requests.spec.js tests/e2e/known-bugs.spec.js
git commit -F - <<'EOF'
Send inject.js's requests through the limiter, with the page's token

inject.js skips JSON views (INJ-1) and pages that aren't Services
Directory pages. Its automatic requests go through the page limiter:
links to other servers get none, at most 50 are sent, and rows past
the cap say so. A page's token goes in the POST body, only inside its
scope, and never across a redirect (INJ-16, ADV-6, TOK-1, TOK-2,
TOK-4). Links that carry token or f now pass the link filter (TOK-3).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task B9: Switch `mapImages.js`

**Files:**
- Modify: `src/src/inject/mapImages.js`
- Modify: `tests/e2e/requests.spec.js` (append)

**Interfaces:**
- Consumes: `SDT.page.classify`, `SDT.url.stripForFilter`, `SDT.auth.scopeOf`, `SDT.net.fetchJson`.

- [ ] **Step 1: Write the failing test**

Append to `tests/e2e/requests.spec.js`:

```js
test("hovering a link to another server sends nothing", async ({ page, fakeServer }) => {
  fakeServer.override(ROOT_PAGE, () => html(rootWith(ONLINE_LINKS)));
  await page.goto(REST_ROOT);
  await expect(page.locator(".sdt-datablock")).toHaveCount(3);
  await page.getByRole("link", { name: "Online parcels map", exact: true }).hover();
  await page.waitForTimeout(500);
  expect(fakeServer.calls.filter((call) => call.origin !== FAKE_ORIGIN)).toEqual([]);
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test tests/e2e/requests.spec.js -g "hovering"`
Expected: FAIL. The hover sends `GET https://services9.arcgis.com/.../Parcels/MapServer/?f=json`, which the explicit assertion and the harness's unmatched list both catch.

- [ ] **Step 3: Rewrite the requests**

- Delete `reqStatus` and `getJSON`.
- Replace `getMapBBOX` and `getMapImageUrl` with `async` functions on `SDT.net.fetchJson`. Hover previews send no token (Phase 6 keeps that rule) and don't use the limiter:

  ```js
  const getMapBBOX = async (url) => {
    const result = await SDT.net.fetchJson(url, { params: { f: "json" } });
    if (result.error) {
      throw new Error(result.error.message);
    }
    const data = result.data;
    let extent = [];
    if ("initialExtent" in data) {
      extent = [data.initialExtent.xmin, data.initialExtent.ymin, data.initialExtent.xmax, data.initialExtent.ymax];
    } else if ("fullExtent" in data) {
      extent = [data.fullExtent.xmin, data.fullExtent.ymin, data.fullExtent.xmax, data.fullExtent.ymax];
    }
    if (extent.length !== 4) {
      throw new Error(`Invalid extent length: ${extent.length}`);
    }
    return extent.join(",");
  };

  /** The export image URL for a service link. */
  const getMapImageUrl = async (url) => {
    if (url in IMAGE_LOOKUP) {
      return IMAGE_LOOKUP[url];
    }
    if (/[^/]$/.test(url)) {
      url = url + "/";
    }
    const bbox = await getMapBBOX(url);
    const size = `${WIDTH_HEIGHT.width},${WIDTH_HEIGHT.height}`;
    let request;
    if (/\/mapserver\/$/i.test(url)) {
      request = [`${url}export`, { size, format: "png32", f: "json", bbox }];
    } else if (/\/featureserver\/$/i.test(url)) {
      // try replacing feature server with map server
      request = [`${url.replace(/\/featureserver\/$/i, "/MapServer/")}export`, { size, format: "png32", f: "json", bbox }];
    } else if (/\/imageserver\/$/i.test(url)) {
      request = [`${url}exportImage`, { bbox, size, format: "jpgpng", f: "json" }];
    } else {
      throw new Error("Not a map or image service");
    }
    const result = await SDT.net.fetchJson(request[0], { params: request[1] });
    if (result.error || !("href" in result.data)) {
      throw new Error("No image in the answer");
    }
    IMAGE_LOOKUP[url] = result.data.href;
    return IMAGE_LOOKUP[url];
  };
  ```

  The cache keeps today's keys, which IMG-1 (Phase 6) fixes.
- Make `hoverGetMap` take the link's stripped URL:

  ```js
  const hoverGetMap = async (url) => {
    notifyLoading(true);
    try {
      const href = await getMapImageUrl(url);
      const mapImage = document.getElementById("mapimage");
      mapImage.setAttribute("src", href);
      mapImage.classList.remove("sdt-none");
    } catch {
      console.log("Services Directory Toolkit: no map image for %s", url);
      hoverHideMap();
    }
    notifyLoading(false);
  };
  ```

- In `setup`, build the list from stripped hrefs on the page's own server, and pass the URL to the listener:

  ```js
    const pageScope = SDT.auth.scopeOf(location.href);
    const tags = Array.prototype.slice.call(document.getElementsByTagName("a"), 0);
    const urls = tags
      .map((tag, i) => ({ i, url: SDT.url.stripForFilter(tag.href) }))
      .filter((item) => tags[item.i].parentNode.className !== "breadcrumbs"
        && SDT.auth.scopeOf(item.url) === pageScope
        && /(map|image)server\/?$/i.test(item.url));
  ```

  and `SDT.guard.listen(tags[item.i], "mouseover", () => hoverGetMap(item.url));`.
- At the start of `onPageLoaded`:

  ```js
    const type = SDT.page.classify(location, document);
    if (type === "jsonView" || type === "other") {
      return;
    }
  ```

- [ ] **Step 4: Run the checks**

Run: `npm run lint && npm run test:unit && node scripts/build.js`, then the browser tests.
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/src/inject/mapImages.js tests/e2e/requests.spec.js
git commit -F - <<'EOF'
Send map preview requests through fetchJson, to this server only

Previews skip links to other servers and JSON views, and test each
link without its token, f and fragment (TOK-3). They never send the
page's token, which Phase 6 keeps.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task B10: Switch the popup search, and check that no old request code is left

**Files:**
- Modify: `src/src/page_action/search.js`
- Modify: `tests/e2e/action-popup.spec.js` (the `@cdp` activeTab test's stub; one new test)
- Create: `tests/unit/no-legacy-requests.test.js`
- Modify: `eslint.config.js`, `tests/unit/lint-rules.test.js`

**Interfaces:**
- Consumes: `SDT.net.fetchJson`, `SDT.net.legacyResponse`, `SDT.auth.pageToken`, `SDT.page.baseUrl`.
- Produces: lint errors for `fetch(...)` and `XMLHttpRequest` in `src/src/inject/**` and `src/src/page_action/**`, and for an inline function passed to `.then`, `.catch` or `.finally` in `src/src/inject/**`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/e2e/action-popup.spec.js`. Add `SERVER_TOKENS` to its import from `./fixtures.js`.

```js
test("the popup search sends the tab's token in the POST body, never in a URL (POP-6)", async ({ openPopupTab, fakeServer }) => {
  const token = SERVER_TOKENS.jsmith;
  const popup = await openPopupTab(`${REST_ROOT}/Utilities?token=${token}`);
  await popup.locator("#searchblank").fill("Valves");
  await popup.locator("#searchbtn").click();
  await expect(popup.locator("#searchbtn")).toHaveText("Search");
  // Valves is secured: an anonymous listing leaves it out.
  await expect(popup.locator("#searchresults a")).not.toHaveCount(0);
  const crawl = fakeServer.calls.filter((call) => call.query.f === "json" || call.body.f === "json");
  expect(crawl.length).toBeGreaterThan(0);
  for (const call of crawl) {
    expect(call.method).toBe("POST");
    expect(call.query).toEqual({});
    expect(call.body.token).toBe(token);
  }
});
```

If `action-popup.spec.js` doesn't import `REST_ROOT`, add it too.

Create `tests/unit/no-legacy-requests.test.js`:

```js
// Every request goes through SDT.net (src/src/lib/net.js). No script keeps its own ajax copy or an
// IE-only branch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles } from "../../scripts/lib/extension-files.js";
import { SRC } from "./helpers/sdt.js";

const scripts = listFiles(SRC).filter((file) => file.endsWith(".js") && !file.startsWith("src/lib/"));

for (const [name, pattern] of [
  ["an ajax helper", /\bajax\s*=/],
  ["XMLHttpRequest", /XMLHttpRequest/],
  ["MSXML2", /MSXML2/],
  ["document.selection", /document\.selection/],
  ["createTextRange", /createTextRange/]
]) {
  test(`no script outside src/src/lib/ uses ${name}`, () => {
    const offenders = scripts.filter((file) => pattern.test(readFileSync(join(SRC, file), "utf8")));
    assert.deepEqual(offenders, []);
  });
}
```

Append to `tests/unit/lint-rules.test.js`:

```js
test("scripts send requests through SDT.net, not fetch or XMLHttpRequest", async () => {
  assert.deepEqual(await ruleIds("{\n  fetch(\"/x\");\n}\n", INJECT), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("{\n  fetch(\"/x\");\n}\n", "src/src/page_action/example.js"), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("{\n  new XMLHttpRequest();\n}\n", INJECT), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("{\n  SDT.net.fetchJson(\"/x\");\n}\n", INJECT), []);
});

test("content scripts use await, not inline promise callbacks", async () => {
  assert.deepEqual(await ruleIds("{\n  SDT.net.fetchJson(\"/x\").then((r) => r);\n}\n", INJECT), ["no-restricted-syntax"]);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/unit/no-legacy-requests.test.js tests/unit/lint-rules.test.js`, then `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test tests/e2e/action-popup.spec.js -g "POP-6"`.
Expected: FAIL. `search.js` still has its `ajax` copy, the lint cases get `[]`, and the popup crawls anonymously and finds nothing.

- [ ] **Step 3: Switch `search.js`**

- Delete the `ajax` copy.
- Replace `queryMe` with:

  ```js
  const queryMe = async (list, myTest, token) => {
    if (!list.length) { return; }
    const url = list.shift();
    const data = SDT.net.legacyResponse(await SDT.net.fetchJson(url, { params: { f: "json" }, token }));
    if (data === null) {
      return; // POP-1: Phase 9 counts the failure and carries on.
    }
    locs++;
    responseSearch(url, data, myTest);
    list = list.concat(subUrls(url, data));
    searchCount.firstChild.nodeValue = locs.toString();
    resultCount.firstChild.nodeValue = hits.toString();
    if (list.length) {
      queryMe(list, myTest, token);
    } else {
      btn.removeAttribute("disabled");
      btn.firstChild.nodeValue = "Search";
      Array.prototype.forEach.call(d.getElementsByTagName("a"), (ln) => {
        let location = ln.href;
        ln.addEventListener("click", () => {
          chrome.tabs.create({active: true, url: location});
        });
      });
    }
  };
  ```

- In the click handler, start from the tab's URL without its query, with the tab's token:

  ```js
        tabs.forEach((tab) => {
          const tabUrl = new URL(tab.url);
          queryMe([SDT.page.baseUrl(tabUrl)], myTest, SDT.auth.pageToken(tabUrl));
        });
  ```

  The popup is an extension page, so it sends no Referer. A token bound to a referrer gets 498 there, as the token spec says.

- [ ] **Step 4: Update the `@cdp` activeTab test's stub**

The real popup's requests aren't routed, so the test sends them through the helper page. In `tests/e2e/action-popup.spec.js`, in "the real popup reads the tab's URL, which needs activeTab", replace the `popup.XMLHttpRequest = class {...};` block with:

```js
    // The popup now uses fetch. Pass each request to the routed helper page. A signal or a body from
    // the popup's realm can't cross over, so rebuild the body and leave the signal behind.
    popup.fetch = (url, init = {}) => fetch(url, {
      method: init.method,
      body: init.body ? new URLSearchParams(String(init.body)) : undefined,
      redirect: init.redirect,
      credentials: init.credentials,
      referrerPolicy: init.referrerPolicy
    });
```

This test runs only in CI. Read the change twice, and check the CI run.

- [ ] **Step 5: Add the lint rules**

In `eslint.config.js`:

```js
const NETWORK = "Send requests with SDT.net.fetchJson (src/src/lib/net.js).";
const NETWORK_SELECTORS = [
  { selector: "CallExpression[callee.name='fetch']", message: NETWORK },
  { selector: "NewExpression[callee.name='XMLHttpRequest']", message: NETWORK },
  { selector: "NewExpression[callee.property.name='XMLHttpRequest']", message: NETWORK }
];
// A promise callback runs later, outside the guard. Use await inside a guarded function instead.
const AWAIT_SELECTORS = [
  { selector: "CallExpression[callee.property.name=/^(then|catch|finally)$/] > :matches(ArrowFunctionExpression, FunctionExpression)", message: GUARDED }
];
```

Add `...NETWORK_SELECTORS, ...AWAIT_SELECTORS` to the `src/src/inject/**` entry, and `...NETWORK_SELECTORS` to the `src/src/page_action/**` entry.

- [ ] **Step 6: Run the checks**

Run: `npm run lint && npm run test:unit && node scripts/build.js`, then the browser tests.
Expected: all pass. POP-1, POP-2 and POP-3 are still expected failures.

- [ ] **Step 7: Commit**

```bash
git add src/src/page_action/search.js tests/e2e/action-popup.spec.js tests/unit/no-legacy-requests.test.js eslint.config.js tests/unit/lint-rules.test.js
git commit -F - <<'EOF'
Send the popup search through fetchJson, with the tab's token

The crawl sends a token from the tab's URL in each POST body, only
inside the tab's scope (POP-6, token part). No script keeps an ajax
copy or an IE-only branch, which a unit test and lint now check.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task B11: Part B docs and PR B

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `CONTRIBUTING.md`, `.coderabbit.yaml`
- Modify: `docs/superpowers/specs/2026-10-09-store-readiness-design.md` (section 4.3)

- [ ] **Step 1: Update `CLAUDE.md`**

- In "Architecture", in the lib paragraph Task A7 wrote, replace "`SDT.dom` holds `loadElement` and the text helpers. Until Part B of Phase 2 each script still has its own `ajax` copy." with:

  ```markdown
  The namespaces: `SDT.dom` (`loadElement` and text helpers), `SDT.guard`, `SDT.auth` (`scopeOf`, the token scope, and `pageToken`), `SDT.url` (`build` and `stripForFilter`), `SDT.net` (`fetchJson` and the request limiter) and `SDT.page` (`classify`). Every request goes through `SDT.net.fetchJson`, which resolves to `{data}` or `{error}`, and lint bans `fetch` and `XMLHttpRequest` in the scripts. Automatic requests, the ones sent without a user action, also go through `SDT.net.pageLimiter()`, which enforces spec section 4.3: at most 50 per page view and 4 at once, only inside the page's scope, cancelled on `pagehide`, and stopped by an HTTP 429 or 503. A row it leaves out shows "Not loaded: request limit reached (50)" until Phase 5's Load more.

  A `token` in the page URL goes only to URLs in the page's scope (the origin plus the path before the first whole-segment `/rest/services`, case-folded except an ArcGIS Online org ID), in a form POST body, with `redirect: "manual"`. Requests without a token stay GETs. Links lose `token`, `f` and their fragment before the link filters test them. Map previews never send the token.

  Every content script starts with `SDT.page.classify(location, document)`, which reads only `location.pathname` and `document.contentType`. On a JSON view or a page that isn't a Services Directory page, the scripts do nothing, so the toolbar button stays disabled there too. Every class the extension injects starts with `sdt-`.
  ```

- In "Browser tests", after the sentence about `fakeServer.override`, add: "`fakeServer.requests` records only the method and URL. To check where a token or `f=json` went, use `fakeServer.calls`, which keeps each request's `query` and form `body` apart. `tests/e2e/requests.spec.js` covers the request budget and the token rules."
- In "Architecture", in the Page action popup paragraph, add: "The search sends the tab URL's token to the tab's scope, in POST bodies."

- [ ] **Step 2: Update `README.md`**

In "Changes made on top of Ken's last commit", add:

```markdown
- Limited automatic requests to the page's own server: at most 50 per page and 4 at a time. They stop if the server answers 429 or 503, and rows past the limit say they weren't loaded.
- Sent a `token` from the page URL only to the same server's REST services, in the request body rather than the URL, and never across a redirect.
- Skipped JSON views and pages that aren't Services Directory pages, which used to show a stuck spinner or an "Invalid form." dialog.
```

- [ ] **Step 3: Update `CONTRIBUTING.md`**

Add to the manual check before a release, after the Chrome 120 sentence: "Also open a 12.1 root, layer and execute page (Esri's `utility.arcgisonline.com` runs 12.1) and check in DevTools that `td.breadcrumbs`, `td.titlecell` and the `<b>Fields: </b>` list are still there. The spec's Phase 2 section records why."

- [ ] **Step 4: Update `.coderabbit.yaml`**

In the `src/**/*.js` instructions, add:

```yaml
        Requests go through SDT.net.fetchJson; automatic ones through SDT.net.pageLimiter().
        Flag fetch or XMLHttpRequest outside src/src/lib/, any token placed in a URL, and a
        token sent to a URL whose SDT.auth.scopeOf differs from the page's. Classes the
        extension injects start with sdt-.
```

In the `src/src/inject/**` instructions, add: "Each script checks SDT.page.classify before doing anything, and does nothing on jsonView and other."

- [ ] **Step 5: Record the budget decisions in the spec**

In the store-readiness spec, section 4.3, after the "Total" bullet, add:

```markdown
  Until Phase 5 adds Load more, each row left out shows the text "Not loaded: request limit reached (50)" (owner's decision on issue #44, 2026-10-20).
```

After the "Server pushback" bullet, add:

```markdown
  Until Phase 5's status bar, each row skipped after the pushback shows "Not loaded: the server answered HTTP 503, so automatic requests stopped", with the status the server sent.
```

- [ ] **Step 6: Final verification**

Run: `npm run lint && npm run test:unit && node scripts/build.js`, then the browser tests, then `git status --short`.
Expected: everything passes, and only this task's files are uncommitted. Then unzip the build into an empty folder and run the browser tests against it with `EXT_PATH` set to that folder, as CI does.

- [ ] **Step 7: Commit, push and open PR B**

```bash
git add CLAUDE.md README.md CONTRIBUTING.md .coderabbit.yaml docs/superpowers/specs/2026-10-09-store-readiness-design.md
git commit -F - <<'EOF'
Describe the network helpers, the classifier and the token rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git push
```

Open the PR against `main` with the title "Phase 2, part B: fetchJson, the request budget, the token scope and the page classifier". The body says "Closes #44" and includes:

- The findings closed, with how:
  - INJ-1: the classifier skips JSON views. The known-bug case is now a test.
  - INJ-12: `parseJson` maps NaN only outside strings.
  - INJ-16, QRY-17, ADV-6: the page token goes to its scope, in POST bodies.
  - POP-9: `fetchJson` sends no headers of its own.
  - SEC-11: the `sdt-` prefix, and `document.selection` removed.
  - TOK-1: `redirect: "manual"`, and the 307 browser test.
  - TOK-2: `scopeOf` and `build`, with the unit tables.
  - TOK-4: POST bodies.
  - TOK-5: default credentials.
  - TOK-6: the classifier reads only the pathname, and the query-string page test.
- This phase's part of these, with what is left:
  - INJ-2: `fetchJson` reports every failure. The count chains are Phase 5's.
  - INJ-4, ADV-5, SEC-5: the limiter. Lazy and on-demand counts are Phase 5's.
  - INJ-18, QRY-10, QRY-18: IE branches and dead code removed.
  - INJ-19: the prefix sweep.
  - PRT-1: the classifier; its known-bug case is now a test. Alerts are Phase 8's.
  - QRY-3: the classifier skips other operations and JSON results.
  - QRY-5: `fetchJson` errors reach the Query Helper, which says so.
  - QRY-15: list what this PR changed for it, and ask the owner (see "Open points").
  - TOK-3: `stripForFilter` in `inject.js` and `mapImages.js`.
  - POP-6: the popup forwards the tab's token.
  - ADV-1: the docs.
- Token spec: TR-2, TR-6, TR-8, the pathname half of TR-5, and this phase's part of TR-7 and TR-14.
- The known-bug table from Task B6 Step 4.
- The 12.1 markup check: source, date, the "no difference at the text level" result, and the unverified classes.
- That the `@cdp` activeTab test's stub changed, and that it runs only in CI.

End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)` and your session line, then run `gh pr checks --watch`.

## Commands

| What | Command |
|---|---|
| Lint | `npm run lint` |
| Unit tests | `npm run test:unit`, or one file: `node --test tests/unit/auth.test.js` |
| Build without lint | `node scripts/build.js` |
| Browser tests | `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test --grep-invert @cdp` |
| One browser spec | add the file and `-g "<title>"` to the command above |
| Known bugs as normal tests | prefix the browser command with `SHOW_KNOWN_BUGS=1` and add `tests/e2e/known-bugs.spec.js` |

## Open points

Each of these needs the owner's decision.

1. **INJ-17 moves to Phase 2.** `SDT.guard.onLoad` replaces the `readyState` polling in Part A, because the guard needs one guarded entry point. The alternative is a guarded interval that clears itself, which keeps INJ-17 for Phase 5.
2. **Server pushback note.** The wording "Not loaded: the server answered HTTP 503, so automatic requests stopped" is this plan's proposal. Only the cap note was decided.
3. **Other encodings in the instance path.** Decision 2 covers `%2f` and `%2e`. A double-encoded `%252e%252e` and an encoded backslash `%5c` also survive `new URL`, and a server that decodes twice, or treats `\` as `/`, could read them as dot segments or separators. Same-origin use gives a page nothing new (it can already read its own URL's token), but the owner may want `%25` and `%5c` added to the rule.
4. **Hosted ArcGIS Online paths.** Tiles hosts put the org ID second (`/tiles/<orgId>/arcgis`). The plan keeps every segment's case except `arcgis` and `tiles` on `services*` and `tiles*` hosts, and also counts `servicesqa`/`servicesdev` hosts as hosted. Section 5.1 of the token spec is updated to say so.
5. **The toolbar button on JSON views.** It is disabled from Phase 2, because `status.js` does nothing there. Phase 3's matrix test then pins it.
6. **12.1 element classes are unverified.** No 12.1 HTML could be read. Someone with network access should open a 12.1 page and check `td.breadcrumbs` and `td.titlecell`: the link filters' `parentNode.className === "breadcrumbs"` check is the most fragile marker in today's code. The 12.1 index also shows an execute page title of `Execute Task (X)`, where the fixture has `Execute Task: X`, and there is no GP task-page fixture.
7. **POST on 11.x, 12.x and ArcGIS Online.** POST with the token in the body is verified only on 10.9.1 (probe Q5). If a server refuses POST on resource endpoints, metadata on `?token=` pages fails there, while pages without a token aren't affected. Running the probe on an 11.x or 12.x server before PR B merges would settle it.
8. **QRY-15's Phase 2 part** isn't spelled out in the register ("Auto-submit label, `nothing`/`donothing`, stale tab, submit buttons by index | 2, 4, 7"). This plan's Query Helper changes are the classifier gate and the `sdt-` class on its controls. The owner should say whether that is Phase 2's part, or what is.
9. **Map previews outside the cap.** Hover requests skip the limiter, because a hover is a user action. Phase 6's request-count test then sets their limit (one export per hovered link).
