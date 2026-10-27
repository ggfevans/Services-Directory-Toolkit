# Phase 5 part 1: request chains and status bar (#45, #14) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On service and layer pages, a failed request costs one row and the rest carry on. Automatic work stays inside the 50-request budget, with a Load more button for the rest. A status bar under the page's `<h2>` replaces the corner ring and reports busy, done, budget-reached and pushback states.

**Architecture:** A new lib file, `src/src/lib/status.js` (`SDT.status`), holds one progress model per isolated world. `inject.js` opens a job for its rows, sends each request through `job.fetch`, reports every row once, and registers a Load more callback. `status.js` subscribes and renders the `.sdt-statusbar` from `docs/design/mockups/`. The limiter gains `extend(n)`, which Load more uses. Field and domain counts are deleted; part 3 (#17) brings them back behind Count values.

**Tech Stack:** Plain JS (Manifest V3 classic scripts), `node --test` with `node:vm`, `@playwright/test`, `@axe-core/playwright`, ESLint 10. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-26-phase-5-chains-and-status-bar-design.md`, which refines `docs/superpowers/specs/2026-10-09-store-readiness-design.md` ("Phase 5", section 4, and Appendix A) and `docs/design/2026-10-ui-design-review.md` (sections 6.3 and 10.2). Read both, `CLAUDE.md`, and the comments at the top of `tests/e2e/fixtures.js`, `tests/fixtures/fake-arcgis.js` and `tests/unit/helpers/sdt.js`.

**Branch:** `phase-5/chains-and-status-bar`, which already holds the design commit. This plan is the next commit. One pull request against `main`. Its body closes #14, and says it is part of #45 without a closing keyword (#45 stays open for parts 2 and 3).

## Global Constraints

- Node `^22.13.0 || >=24`. No new npm dependencies.
- Every lib file is a classic script that adds one namespace to `globalThis.SDT` and declares no top-level names. `status.js` (the lib) loads right after `net.js` in every content-script group and in `page_action.html`.
- Content scripts add listeners, timers and `chrome.*` callbacks only through `SDT.guard`. They never write HTML strings, and never call `fetch` or `XMLHttpRequest`.
- Budget (spec 4.3): `SDT.net.BUDGET` is `{ max: 50, concurrency: 4 }`. A 429 or 503 stops automatic work on the page for good.
- Every injected class starts with `sdt`. Canadian spelling in docs and commit messages; the code keeps its existing identifiers.
- Status bar copy, exact (design review 6.3; the singular forms and the failure suffix are the builder's call, in the design doc):
  - Busy: `Loading details: {settled} of {total} {noun}` plus `, {failed} failed` when `failed > 0`. `settled` is `done + failed`.
  - Done: `Loaded details for {done} {noun} in {requests} requests`. When `failed > 0`, it continues `. {failed} failed.`
  - Budget reached: `Paused after {requests} automatic requests. {skipped} {noun} not loaded yet.`, with a button labelled `Load {min(skipped, 50)} more {noun}`.
  - Pushback: `The server asked for fewer requests (HTTP {status}). Automatic requests stopped on this page.`
  - Busy from `<body>` classes only (map previews, Query Helper): `Loading`.
  - `{noun}` is "layers" on `service` pages and "services" on the root and folder pages. A count of 1 uses "layer", "service" and "request".
- The status message updates at most once a second (`THROTTLE_MS = 1000`), and the last state always lands.
- Each pull request lists the Appendix A IDs it closes or advances, and how it resolved each one.

## Review Focus

1. **Load more pressed twice quickly.** The second press must send nothing. The button is disabled from the click until the batch settles. Test in Task 6.
2. **Pushback during a Load more batch.** The bar switches to the error tone, the button goes away, and no row stays busy. Test in Task 7.
3. **A page with no `<h2>`.** The bar goes first in `<body>` and still overlaps nothing. Test in Task 6.
4. **Leaving mid-load, then coming back through the back/forward cache.** No row stays busy, `<body>` has no `sdt-loading-` class, and the bar doesn't say "Loading" forever. Test in Task 7.
5. **A service that answers HTTP 200 with an ArcGIS `{ "error": { "code": 499 } }` body.** The row fails with the server's message, and the other rows load. Test in Task 5.

---

### Task 1: Limiter `extend(n)`

**Files:**
- Modify: `src/src/lib/net.js` (`createLimiter`, about lines 152–220)
- Test: `tests/unit/limiter.test.js`

**Interfaces:**
- Produces: `limiter.extend(n: number): void`, which raises the limiter's accepted cap by `n`. It does nothing once the limiter has stopped (429 or 503) or been aborted (`pagehide`). `stats()` now also returns `max` (the current cap).

- [ ] **Step 1: Write the failing tests** in `limiter.test.js`:
  - `extend raises the cap: with max 2, a third request is refused with type "limit"; after extend(2), the next two are accepted and a fifth is refused`
  - `extend after a 429 changes nothing: the next request settles with type "stopped"`
  - `extend after pagehide changes nothing: the next request settles with type "aborted"`
  - `stats().max reports the cap: 50 by default, 100 after extend(50)`
- [ ] **Step 2: Run** `node --test tests/unit/limiter.test.js`. Expected: the four new tests FAIL (`extend is not a function`).
- [ ] **Step 3: Implement** it: keep `max` in `state`, make the accept check read `state.max`, and have `extend` return early when `state.stopped || controller.signal.aborted`.
- [ ] **Step 4: Run** `node --test tests/unit/limiter.test.js`. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "Let the limiter's budget be extended, except after pushback or pagehide"`

### Task 2: `SDT.status`, the progress model

**Files:**
- Create: `src/src/lib/status.js`
- Modify: `src/manifest.json` (every content-script `js` list: `src/lib/status.js` right after `src/lib/net.js`), `src/src/page_action/page_action.html` (the same position)
- Test: `tests/unit/status.test.js` (new). `tests/unit/manifest.test.js` and `tests/unit/build.test.js` pick up the load order on their own; run them.

**Interfaces:**
- Consumes: `SDT.net.pageLimiter()`, `limiter.extend(n)`, `limiter.stats()` and `SDT.net.isSkipped(result)` from Task 1, plus `SDT.guard.wrap`.
- Produces:
  - `SDT.status.job(kind: "services" | "layers", total: number) → Job`. A page has at most one job; a second call returns the same job with `total` added.
  - The `Job`:
    - `Job.fetch(url, options) → Promise<{data}|{error}>` goes through the page limiter. It adds 1 to `requests` whenever the limiter accepts the request: that is, unless the result's `error.type` is `"limit"`, `"stopped"`, `"aborted"` or `"destination"` and nothing was sent. Count before the await: compare `stats().accepted` before and after the call.
    - `Job.done()`, `Job.failed()` and `Job.skipped()` report one row each.
    - `Job.retrying(n)` moves `n` rows from skipped back to pending, before Load more re-runs them.
    - `Job.onLoadMore(fn: () => Promise<void>)` registers the callback.
  - `SDT.status.snapshot() → { busy, kind, total, done, failed, skipped, requests, stopped, max, canLoadMore }`:
    - `busy` is true while `done + failed + skipped < total`.
    - `stopped` is the limiter's `stats().stopped` (a status number or `null`).
    - `canLoadMore` is true when `skipped > 0`, there's no `stopped`, and a callback is registered.
  - `SDT.status.subscribe(fn: (snapshot) => void) → unsubscribe`. It calls `fn` after every change, through `SDT.guard.wrap`.
  - `SDT.status.loadMore() → Promise<void>` calls `extend(SDT.net.BUDGET.max)`, then the callback. It does nothing when `canLoadMore` is false or a Load more is already running.
  - `SDT.status.message(snapshot) → { tone: undefined | "ok" | "warn" | "error", text: string, action: string | null }` is a pure function of the snapshot and produces the copy in Global Constraints. It returns `null` when `total === 0` and nothing has been reported.
  - State lives in `SDT.state.status`, created on first use.

- [ ] **Step 1: Write the failing tests** in `status.test.js`. Load the lib with the `tests/unit/helpers/sdt.js` loader, and give it a fake limiter through `SDT.state.pageLimiter` (`createLimiter` with an injected `fetchJson`). Compare values with `plain()`.
  - `a job of 3 rows is busy until all 3 report`
  - `message: busy "Loading details: 2 of 8 services, 1 failed"` (`done` 1, `failed` 1, `total` 8)
  - `message: done "Loaded details for 8 services in 9 requests" with tone "ok"`
  - `message: done with failures "Loaded details for 7 services in 8 requests. 1 failed."`
  - `message: budget "Paused after 50 automatic requests. 8 layers not loaded yet." with tone "warn" and action "Load 8 more layers"`
  - `message: budget with 60 skipped offers "Load 50 more services"`
  - `message: pushback names HTTP 503, tone "error", action null`
  - `message: one row says "1 service" and "1 request"`
  - `message: no job and nothing reported returns null`
  - `job.fetch counts accepted requests only: a refused "limit" result adds nothing`
  - `loadMore extends the limiter by 50, then calls the callback once, even when called twice before it settles`
  - `loadMore does nothing after pushback`
  - `subscribe is called after each report, and unsubscribe stops it`
  - `running the file twice keeps the same state` (lib files may run twice)
- [ ] **Step 2: Run** `node --test tests/unit/status.test.js`. Expected: FAIL (`SDT.status` is undefined).
- [ ] **Step 3: Implement** `src/src/lib/status.js` to the interfaces above, and add it to the manifest groups and `page_action.html`.
- [ ] **Step 4: Run** `npm run test:unit && npm run lint`. Expected: PASS. The manifest, build and extension-file tests accept the new load order.
- [ ] **Step 5: Commit**: `git commit -m "Add SDT.status: the page's progress model for the status bar"`

### Task 3: The entity-literal lint rule (TOOL-7)

**Files:**
- Modify: `eslint.config.js` (add to the rules for `src/`), `src/src/inject/inject.js:100` (`&nbsp;`) and `:199` (`&copy;`), `tests/e2e/known-bugs.spec.js` (INJ-11)
- Test: `tests/unit/lint-rules.test.js`

**Interfaces:**
- Produces: a `no-restricted-syntax` entry. Its selector matches a `Literal` or `TemplateElement` whose value matches `/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);/i`. The message: `Write the character itself, or a \u escape, not an HTML entity (TOOL-7).`

- [ ] **Step 1: Write the failing tests** in `lint-rules.test.js`, in the file's existing style:
  - `"&copy; 2026"` in a string is flagged
  - `` `a&nbsp;b` `` in a template is flagged
  - `"&#169;"` and `"&#xA9;"` are flagged
  - `"a & b"`, `"R&D"` and `"?a=1&b=2"` are not flagged
- [ ] **Step 2: Run** `node --test tests/unit/lint-rules.test.js`. Expected: the new cases FAIL.
- [ ] **Step 3: Add the rule.** Replace the two literals in `inject.js` with `©` and ` `. In `known-bugs.spec.js`, turn INJ-11's `knownBug(` into `test(`, and move the case to the spec file that covers metadata (`pages.spec.js`), with a comment that part 2 finishes INJ-11 (server HTML as text).
- [ ] **Step 4: Run** `npm run lint && node --test tests/unit/lint-rules.test.js && npx playwright test -g "&copy;"`. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "Ban HTML entity literals in strings under src/ (TOOL-7)"`

### Task 4: Remove the field and domain counts; clean up `inject.js`

**Files:**
- Modify: `src/src/inject/inject.js`, `src/src/inject/inject.css`, `tests/e2e/known-bugs.spec.js` (INJ-2)
- Test: `tests/e2e/pages.spec.js`

**Interfaces:**
- Produces:
  - `getColor(item)` and `getCompColor(item)` keep their signatures but store colours in a `Map` (`COLOURS`), so a key such as `__proto__` or `constructor` gets a colour like any other (SEC-8).
  - The removed names, which no other task may use: `checkForNulls`, `checkDomains`, `countFields`, `getFieldList`, `getPreviousLabel`, `responseTime`, `COUNT_FIELD_VALUES`, `COUNT_DOMAIN_VALUES`, `LOADING_NULLS_CSS` and `LOADING_DOMAINS_CSS`.
  - `notifyLoading(value, cssClass)` uses `document.body.classList`.

- [ ] **Step 1: Write the failing tests** in `pages.spec.js`:
  - `a layer page sends no automatic field or domain count queries`: open `${REST_ROOT}/Parcels/MapServer/0`, wait for no `sdt-loading-` class, and expect no `fakeServer.calls` to `/query` with a `where` param.
  - `a service whose spatial reference wkid is "__proto__" still gets its badge (SEC-8)`: override one service's JSON with `spatialReference: { wkid: "__proto__" }`, and expect its row to show the badge and the other rows to load.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/pages.spec.js`. Expected: both FAIL.
- [ ] **Step 3: Implement.**
  - Delete the names listed above, and the call to `countFields(url)` in `onLoad`.
  - Change `COLORHASH` to a `Map`.
  - Fix the CSS typos and redundant prefixes left in `inject.css` (INJ-19): run `npx stylelint` if it's configured, otherwise check by eye against `sdt.css`, and list each change in the commit body.
  - In `known-bugs.spec.js`, make INJ-2's case `test.fixme` and update its comment: "Part 3 (#17) brings field counts back behind Count values; rewrite this case for that flow then."
- [ ] **Step 4: Run** `npm run lint && npm test`. Expected: PASS. The old field-count browser tests, if any, are deleted with their feature; list them in the commit body.
- [ ] **Step 5: Commit**: `git commit -m "Remove automatic field and domain counts until Count values; keep colours in a Map"`

### Task 5: Row chains through `SDT.status`, with per-row errors and shape counts

**Files:**
- Modify: `src/src/inject/inject.js` (`getLayerCount`, `collectMetaData`, and `onLoad`), `tests/fixtures/catalog.js` (only if no FeatureServer layer has `geometryField`)
- Test: `tests/e2e/pages.spec.js`, `tests/e2e/requests.spec.js`

**Interfaces:**
- Consumes: `SDT.status.job`, `Job.fetch`, `Job.done`, `Job.failed`, `Job.skipped`, `Job.retrying` and `Job.onLoadMore` (Task 2), and `SDT.url.build`.
- Produces:
  - `getLayerCount(url, data, row) → Promise<"done" | "failed" | "skipped">`. It appends to `row.list` (a `<ul>` it creates once) and records each finished count in `row.counted: Set<"total" | "shape">`.
    - The shape field is the field of type `esriFieldTypeGeometry`, else `data.geometryField?.name`. FeatureServer layers are no longer excluded (INJ-15).
    - The params are `{ where: "<field> IS NOT NULL", returnGeometry: "false", returnCountOnly: "true", f: "json" }`, with the field name as the server gave it.
  - `loadRow(row) → Promise<void>` sends the requests the row is missing: service JSON if `!row.data`, then each count not in `row.counted`. It reports exactly one of `done`, `failed` or `skipped` to the job, in `finally`, and removes any earlier "Not loaded" note first.
  - `row`: `{ anchor, parent, url, data: object | null, counted: Set, list: HTMLUListElement | null }`.
  - `kind` is `"layers"` when `SDT.page.classify` returns `"service"`, and `"services"` otherwise.
  - The Load more callback runs `loadRow` on every row whose last outcome was `"skipped"`, after `job.retrying(n)`.

- [ ] **Step 1: Write the failing tests:**
  - `pages.spec.js`: `a FeatureServer layer row shows "Features with shapes" (INJ-15)`
  - `requests.spec.js`: `one failed service request shows an error on its row, and the other rows load (INJ-2)`. Override one root service with `BAD_GATEWAY`, add `expectedErrors.push(/status of 502/)`, and expect that row to contain `HTTP 502`, every other row to have a `.sdt-datablock`, and no `sdt-loading-` class on `<body>`.
  - `requests.spec.js`: `a service that answers 200 with an ArcGIS error body fails its row with the server's message` (Review Focus 5). Respond `json({ error: { code: 499, message: "Token Required" } })`, and expect the row to contain `Token Required` and the others to load.
  - `requests.spec.js`: `count queries send the where clause as a param, not spliced into the URL (INJ-5)`. Every count call's `query.where` ends in ` IS NOT NULL`, and its path is exactly `.../query`.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/pages.spec.js tests/e2e/requests.spec.js`. Expected: the four new tests FAIL.
- [ ] **Step 3: Implement** the interfaces above. Every request in the row chain goes through `job.fetch`. When a result is not skipped, a failure shows the existing error line with `result.error.message` (from `SDT.net.legacyResponse`'s ArcGIS error, when there is one). The busy class clears in a `finally` around the whole `collectMetaData`.
- [ ] **Step 4: Run** `npm run lint && npm test`. Expected: PASS. The existing `a page with 60 service links sends 50 requests…` test still passes unchanged.
- [ ] **Step 5: Commit**: `git commit -m "Run each row's requests through SDT.status, so a failure costs one row (INJ-2, INJ-5, INJ-15)"`

### Task 6: The status bar replaces the corner ring (#14)

**Files:**
- Modify: `src/src/inject/status.js` (rewrite `ring`, `watch` and `start`), `src/src/inject/inject.css` (delete every `.sdt-indicator*` rule)
- Create: `tests/e2e/status-bar.spec.js`
- Delete: `tests/e2e/indicator.spec.js`. Its cases move into the new file, rewritten for the bar.

**Interfaces:**
- Consumes: `SDT.status.subscribe`, `SDT.status.snapshot`, `SDT.status.message` and `SDT.status.loadMore` (Task 2), `SDT.icon("glyph")`, `SDT.icon("check" | "warn" | "error")`, and `SDT.guard.listen`.
- Produces this DOM, which follows the mockups: `<div class="sdt sdt-statusbar" [data-tone]>`, containing `<span class="sdt-statusbar__name">` (the glyph with `aria-hidden`, then "SD Toolkit"), then `<p class="sdt-status" role="status">` (the spinner `<span class="sdt-spinner" aria-hidden="true">` while busy, else the tone icon, then the text). With an action, `<span class="sdt-statusbar__actions"><button class="sdt-button" type="button">` follows. It's inserted after the first `h2` in `<body>`, or as `<body>`'s first child.
  - The bar is created on the first non-null `message()` or the first `sdt-loading-` class on `<body>`, and never before, so a page with nothing to report has no bar.
  - The only listener is the button's `click`, through `SDT.guard.listen`. It disables the button until `loadMore()` settles.

- [ ] **Step 1: Write the failing tests** in `status-bar.spec.js`:
  - `the services root shows a busy bar under the h2, then "Loaded details for N services in N requests"`: N comes from the catalog's root services, and the requests from `fakeServer.calls`.
  - `a page with nothing to load shows no bar` (a layer page)
  - `the message changes at most once a second, and its last state always lands`, ported from `indicator.spec.js`
  - `under reduced motion the spinner doesn't animate`, ported
  - `the bar has no event listeners, and its only button is Load more` (SEC-1, ADV-3), ported, checked with CDP `DOMDebugger.getEventListeners` and tagged `@cdp`
  - `the bar overlaps no page content at 1280 × 800 and 800 × 600`: the bar's bounding box doesn't intersect the `h2` or the next sibling's box
  - `on a page with no h2 the bar is body's first child and overlaps nothing` (Review Focus 3): `fakeServer.override` the root with the `<h2>` removed
  - `axe passes on the bar in light and dark, on a light and a dark host page`: `axeViolations(page, { include: ".sdt-statusbar" })`, plus `hostPage: true` under `test.use({ hostStyle: "dark" })`
  - `Load more is reachable with Tab and works with Enter, and a second press while loading sends nothing` (Review Focus 1). Use the 60-row fixture from `requests.spec.js`, moved into a shared helper in `tests/e2e/fixtures.js` as `bulkRoot(count)`. After Enter, Enter again: exactly 60 Bulk calls in total.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/status-bar.spec.js`. Expected: FAIL (no `.sdt-statusbar`).
- [ ] **Step 3: Implement** `status.js`. Keep `enableAction`, `whenActive`, the `pageshow` re-send, and `SDT.theme.watch(document)` last. Keep the throttle logic: the text written comes from `SDT.status.message(snapshot)`, or "Loading" when only `<body>` classes are busy. Delete the `.sdt-indicator*` CSS. Delete `indicator.spec.js`.
- [ ] **Step 4: Run** `npm run lint && npm test`. Expected: PASS, including `guard-entry-points.test.js` with the context gone.
- [ ] **Step 5: Commit**: `git commit -m "Replace the corner ring with the status bar under the page heading (#14)"`

### Task 7: Budget and pushback, end to end

**Files:**
- Test: `tests/e2e/requests.spec.js`
- Modify: whatever the failures show. This task is expected to be mostly tests; anything it changes in `src/` goes in the commit body.

**Interfaces:**
- Consumes: `bulkRoot(count)` from Task 6, and `fakeServer.override` with handlers that answer late or never.

- [ ] **Step 1: Write the tests:**
  - `60 rows send exactly 50, the bar offers "Load 10 more services", and one click sends exactly 10 more`. Afterwards there are no `Not loaded` notes, and the bar says `Loaded details for 60 services in 60 requests`.
  - `120 rows: Load more sends 50, then offers "Load 20 more services"`
  - `a row cut off mid-chain gets only its missing count on Load more`. Use 49 one-request rows, then one layer row with fields: its JSON is request 50 and its counts are refused. Load more sends exactly 2 `/query` calls for that row and no second JSON request.
  - `no more than 4 requests are in flight`. Use a late override, so every Bulk JSON answers after 300 ms, and record the peak concurrency from the override's start and end timestamps. The peak is 4.
  - `HTTP 429 stops automatic requests and the bar shows the pushback message` and `HTTP 503 does the same`. Have the fifth Bulk answer with the status. Expect no Bulk calls after the ones already in flight, `data-tone="error"`, the exact copy, and no button.
  - `pushback during a Load more batch removes the button and leaves no row busy` (Review Focus 2)
  - `pagehide cancels pending requests`. Use never-answering overrides, navigate to another fixture page, and expect no new Bulk calls after the navigation.
  - `back/forward restore after leaving mid-load leaves no row busy and no sdt-loading- class` (Review Focus 4). Navigate away and then `page.goBack()`. If Chromium skips the bfcache, the page reloads and loads again; accept either, and assert the end state.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/requests.spec.js`. Expected: each test passes or shows a real gap. Fix the gaps in `src/` and keep the tests as written.
- [ ] **Step 3: Run** `SHOW_KNOWN_BUGS=1 npx playwright test tests/e2e/known-bugs.spec.js`. Expected: each remaining known bug fails on its last assertion, not in its setup.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "Prove the request budget, Load more and pushback end to end"`

### Task 8: Docs, register and build check

**Files:**
- Modify: `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `.coderabbit.yaml`, `docs/superpowers/specs/2026-10-09-store-readiness-design.md` (Appendix A: SEC-5's fix column becomes "Fix (same origin and limiter in 2, Load more in 5)"; the Phase 5 section notes the three-part split), `docs/superpowers/specs/2026-10-26-phase-5-chains-and-status-bar-design.md` (`status: implemented`)

- [ ] **Step 1: Update the docs** to match the code:
  - The status indicator becomes the status bar (in CLAUDE.md, `status.js`'s bullet and "Architecture").
  - `SDT.status` joins the namespace list, in load order after `SDT.net`.
  - Field and coded-value counts are removed until Count values (#17). Rewrite the "Field and coded-value counts have no setting…" line.
  - The "Not loaded…" interim text stays until part 2.
  - `indicator.spec.js` becomes `status-bar.spec.js` wherever it's named.
- [ ] **Step 2: Run** `npm run build`, unzip the zip into an empty folder, and run `EXT_PATH=<folder> npx playwright test`. Expected: the build succeeds and the suite passes against the zip.
- [ ] **Step 3: Commit**: `git commit -m "Describe the status bar, SDT.status and the removed field counts in the docs"`
- [ ] **Step 4: Open the pull request.** List Appendix A as in the design doc's "Findings this part closes or advances", with how each one was resolved. Write `Closes #14` and "Part of #45 (part 1 of 3)". Write no closing keyword for #45, #15, #16 or #17.
