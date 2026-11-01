# Phase 5 part 2: badges, details and row states (#15, #16) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each service or layer row becomes one line: a stable spatial reference badge, inline counts, a keyboard-usable Details disclosure in plain text, and loading, error-with-Retry and plain not-loaded states.

**Architecture:** A new lib, `src/src/lib/row.js` (`SDT.row`), holds the pure logic. `inject.js` keeps one row model and a `render(row)` that rebuilds the row's annotation and disclosure from it. The limiter gains a per-request `userAction` flag for Retry, and `SDT.status` gains `retryingFailed` and `canRetry`.

**Tech Stack:** Plain JS (Manifest V3 classic scripts), `node --test` with `node:vm`, `@playwright/test`, `@axe-core/playwright`, ESLint 10. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-01-phase-5-badges-and-details-design.md`, with `docs/design/2026-10-ui-design-review.md` sections 6.4, 6.5, 6.6, 10.3 and 10.4, and the row markup in `docs/design/mockups/services-root.html` and `service-layers.html`.

**Branch:** `phase-5/badges-and-details`, which holds the design commit. One pull request against `main`. Its body closes #15 and #16, and says part of #45 with no closing keyword on #45 or #17.

## Global Constraints

- Node `^22.13.0 || >=24`. No new npm dependencies.
- Every lib file is a classic script that adds one namespace to `globalThis.SDT` and declares no top-level names. `row.js` loads right after `status.js` in every content-script group and in `page_action.html`.
- Content scripts add listeners, timers and `chrome.*` callbacks only through `SDT.guard`, and build DOM with `SDT.dom.loadElement`, `createElementNS` helpers and text nodes, never HTML strings.
- Budget: `SDT.net.BUDGET` is `{ max: 50, concurrency: 4 }`. A 429 or 503 stops automatic work on the page for good.
- Every injected class starts with `sdt`. Canadian spelling in docs and commit messages.
- Row copy, exact:
  - Loading: `Loading details`. Counting: `Counting features`.
  - Failed: `Details unavailable: {reason}`, with Retry and hidden ` details for {name}`.
  - Count failed: `Shape count failed: {reason}` or `Feature count failed: {reason}`, with Retry and hidden ` shape count for {name}` or ` feature count for {name}`.
  - Unsupported count: `Shape count not supported by this data source` or `Feature count not supported by this data source`.
  - Counts: `<b>3</b> features`, `<b>2</b> with shapes`, `rows` for tables, `1 feature` in the singular.
  - Zero: warn badge, hidden `Warning: `, `0 features` (`0 rows` for tables).
  - No spatial reference, in the details: `No spatial reference`.
- Badge link: `https://spatialreference.org/ref/?search={encoded}`, hidden text `Spatial reference `, then the value.
- `{name}` is the row link's text. `{reason}` is `SDT.row.failureText(result)`.

## Review Focus

1. **A row re-renders while its Details is open.** Load more or Retry adds a count to a row the user has open. The disclosure stays open, and focus inside the row isn't lost. Test in Task 4.
2. **A long unbroken string in a description, or a very long WKT.** The page doesn't scroll sideways at 800 px, and the WKT badge stays truncated. Test in Task 3.
3. **Unusual `spatialReference` values:** `{}`, `{ wkid: 0 }`, `{ wkid: "__proto__" }`. No throw; the first two show no badge, and the last gets a badge. Test in Task 2.
4. **Retry on one row while others are skipped.** Load more hides while the Retry runs and comes back after it. Test in Task 5.
5. **Copyright text that holds its own entity,** such as `&copy; 2026 Example County`. It shows `© 2026 Example County` once, under the term "Copyright". Test in Task 3.

---

### Task 1: Limiter `userAction` and `SDT.status` retry support

**Files:**
- Modify: `src/src/lib/net.js` (`createLimiter`), `src/src/lib/status.js`
- Test: `tests/unit/limiter.test.js`, `tests/unit/status.test.js`

**Interfaces:**
- Produces:
  - `limiter.fetchJson(url, { userAction: true, ... })` skips only the cap check. The request still counts in `accepted`, and `userAction` is stripped before `SDT.net.fetchJson`, like `onSend`.
  - `limiter.grant(n)`: `state.max = Math.max(state.max, state.accepted + n)`.
  - `limiter.extend` removed, with its tests.
  - `job.fetch(url, options)` passes `userAction` through.
  - `job.retryingFailed(n: number)`: moves `n` rows from failed to pending, then notifies.
  - `SDT.status.canRetry() → boolean`: a job exists and the limiter is neither stopped nor aborted.

- [ ] **Step 1: Write the failing tests** in `limiter.test.js`:
  - `userAction skips the cap: with max 1 and 1 accepted, a userAction request is sent and accepted becomes 2`
  - `userAction does not skip scope: a request to another server is refused with type "destination"`
  - `userAction waits its turn: with concurrency 1, the second request isn't sent until the first settles`
  - `userAction after a 429 settles with type "stopped"`, and `after pagehide settles with type "aborted"`
  - `userAction is not passed to fetchJson`
  - `grant never lowers the cap: with 10 accepted and max 50, grant(3) leaves max at 50`
  and in `status.test.js`:
  - `retryingFailed moves a failed row back to pending, so busy is true and failed goes down`
  - `canRetry is false with no job, after a 429, and after pagehide; true otherwise`
  - `job.fetch with userAction is sent past the cap and counts in requests`
- [ ] **Step 2: Run** `node --test tests/unit/limiter.test.js tests/unit/status.test.js`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the interfaces. Remove `extend` and its tests.
- [ ] **Step 4: Run** `npm run lint && npm run test:unit`. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "Let a click's requests past the budget, and add retry support to SDT.status"`

### Task 2: `SDT.row`, the pure row logic

**Files:**
- Create: `src/src/lib/row.js`, `tests/unit/row.test.js`
- Modify: `src/manifest.json` (every content-script `js` list: `src/lib/row.js` right after `src/lib/status.js`), `src/src/page_action/page_action.html`

**Interfaces:**
- Produces, on `SDT.row`, exactly as the design's "`SDT.row`" section defines them: `paletteIndex(sr)`, `spatialReference(data)`, `badge(sr)`, `cacheLabel(data)`, `summary(data)`, `details(data, toText)`, `text(html)`, `failureText(result)`.
- `details` also takes over `unCamelCase`. It returns `[{ group, items: [{ term, value, mono? }] }]`, and `{ group, sentence }` for Also true. Empty groups are left out.

- [ ] **Step 1: Write the failing tests** in `row.test.js`, using the `tests/unit/helpers/sdt.js` loader and `plain()`:
  - `paletteIndex pins: 3857 is 2, 4326 is 0, { wkid: 102100, latestWkid: 3857 } is 2, and a bare { wkid: 102100 } is 1`
  - `spatialReference prefers data.spatialReference, then extent.spatialReference, then null`
  - `badge for a WKID has the https link with an encoded value`: `{ wkid: "a b" }` gives `...?search=a%20b`
  - `badge for WKT only is "WKT " plus 24 characters plus "…", with the full text in title`
  - `badge is null for null, {} and { wkid: 0 }`, and `{ wkid: "__proto__" }` gets a badge (Review Focus 3)
  - `cacheLabel: true is Tiled, false is Dynamic, missing is null`
  - `summary: "2 layers, max 1,000 records"; "1 layer, max 1,000 records"; "Polygon, 6 fields"; "Table, 9 fields"; "" when nothing applies`
  - `details shows Max Record Count without documentInfo, and when it is 0` (INJ-13)
  - `details prints an extent as "1, 2, 3, 4" with mono set`
  - `details joins true flags into one sentence and leaves out defaultVisibility, isDataVersioned and singleFusedMapCache`
  - `details applies toText to descriptions and copyright`
  - `details says "No spatial reference", and shows the full WKT when there's no WKID`
  - `details leaves out empty groups`
  - `details covers every field showMetadata shows`: a table of the fields, each asserting a term appears
  - `failureText prefers the ArcGIS message, then result.error.message`
- [ ] **Step 2: Run** `node --test tests/unit/row.test.js`. Expected: FAIL (`SDT.row` is undefined).
- [ ] **Step 3: Implement** `row.js`, and add it to the manifest groups and `page_action.html`.
- [ ] **Step 4: Run** `npm run lint && npm run test:unit`. Expected: PASS, with the manifest and build tests accepting the load order.
- [ ] **Step 5: Commit**: `git commit -m "Add SDT.row: the palette, details and summary logic for a row"`

### Task 3: Rows render badges and details from one model

**Files:**
- Modify: `src/src/inject/inject.js`, `src/src/inject/inject.css`, `tests/unit/sdt-css.test.js`, `tests/e2e/requests.spec.js`, `tests/e2e/pages.spec.js`, `tests/fixtures/catalog.js` and `tests/fixtures/fake-arcgis.js` (only for the new fixtures)
- Create: `tests/e2e/rows.spec.js`

**Interfaces:**
- Consumes: `SDT.row` (Task 2), `SDT.icon`.
- Produces in `inject.js`:
  - the row model: `{ anchor, parent, url, name, data, outcome, loading: boolean, error: string | null, counts: { total?, shape? }, annot, details }`
  - `render(row)`: rebuilds `row.annot`'s children from the model, and creates `row.details` once
- Removed: `showSpatialReferenceData`, `showMetadata`, `getColor`, `getCompColor`, `COLOURS`, `toggleCollapse`, `skippedNote`, `unCamelCase`, `li`, `addSubList`, and the `.sdt-datablock`, `.sdt-collapsed`, `.sdt-note` CSS. `reportError` goes in Task 4. Keep `li` or `addSubList` only if counts still need them until Task 4, and remove them there.

- [ ] **Step 1: Write the failing tests** in `rows.spec.js`:
  - `a service row reads link, badge, cache badge, Details on one line`: the badge's accessible name is `Spatial reference 3857`, and its `href` is the https link
  - `the same WKID gets the same colour class on the root and on a folder page, across a reload`
  - `a WKT-only service shows a truncated neutral badge, with the full text in title and in the details`
  - `a service with no spatial reference shows no badge, and its details say "No spatial reference"`
  - `Dynamic and Tiled appear only when singleFusedMapCache exists`
  - `a layer row's badge comes from extent.spatialReference`
  - `Tab reaches each summary, Enter and Space toggle it, and aria-expanded follows`
  - `clicking and selecting text inside the open body leaves it open`
  - `server HTML shows as text, and entities as characters` (INJ-11): `<b>Roads</b> &amp; rails` reads `Roads & rails`
  - `a <script> or <img onerror> in a description neither runs nor loads`: no request for the image, and no global set
  - `copyright "&copy; 2026 Example County" shows "© 2026 Example County" once, under the term Copyright` (Review Focus 5)
  - `a long unbroken description and a very long WKT cause no sideways scroll at 800 px` (Review Focus 2)
  - `a row the budget left out stays plain: no note, no spinner, no details`
  - `while a row loads it shows "Loading details" with a spinner`, using a late override
  - `the bar and rows say "layers" on a layer page with sub-layer rows`
- [ ] **Step 2: Run** `npx playwright test tests/e2e/rows.spec.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Build rows to the mockups' markup. The `<details>` is `class="sdt sdt-details sdt-details--inline"`, with the summary `Details <span class="sdt-details__meta">{summary}</span>`.
  - Build the disclosure's groups with `.sdt-details__body`, `.sdt-details__group` and `.sdt-dl`, passing `SDT.row.text` to `details`.
  - Change the noun to "layers" on `service` and `layer` pages.
  - Make `notifyLoading` count starts and stops per class.
  - Add `src/inject/inject.js` to `BUILT_FOR_SDT_CSS` in `sdt-css.test.js`, after checking `sdt-sidepanel`, `sdt-titlepanel` and `sdt-hidden` aren't styled by `sdt.css`.
  - Move assertions on `.sdt-datablock` to `details.sdt-details`, and those on the "Not loaded" row text to the bar. In the tests that used `spatialReference: null` to make a row throw, use another trigger, such as an `extent` of the wrong type, or whatever makes `render` throw, and say which in the commit body.
- [ ] **Step 4: Run** `npm run lint && npm test`. Expected: PASS. Then `SHOW_KNOWN_BUGS=1 npx playwright test tests/e2e/known-bugs.spec.js`: each known bug still fails on its last assertion.
- [ ] **Step 5: Commit**: `git commit -m "Show each row as one line with a tested badge and a real disclosure (#15, #16)"`

### Task 4: Inline counts and unsupported counts

**Files:**
- Modify: `src/src/inject/inject.js`, `src/src/inject/inject.css` (`.sdt-metadata-error`)
- Test: `tests/e2e/rows.spec.js`, `tests/e2e/requests.spec.js`

**Interfaces:**
- Consumes: `render(row)` and the row model (Task 3).
- Produces: `row.counts.total` and `row.counts.shape`, each `{ value: number }`, `{ error: string }` or `{ unsupported: true }`. `getLayerCount(url, data, row) → Promise<"done" | "failed" | "skipped">` sends only the counts with no `value` or `unsupported`.
- Removed: `reportError`, `failure`, `rowList`, `li`, `addSubList` and `.sdt-metadata-error`.

- [ ] **Step 1: Write the failing tests:**
  - `a layer row shows "3 features" and "2 with shapes" inline, in order`
  - `a table row says rows, and one feature says "1 feature"`
  - `zero features shows the warning badge, with the icon and hidden "Warning: "`
  - `while counts run the row says "Counting features"`
  - `an HTTP 400 and an ArcGIS code 400 on the shape count show the muted note, offer no Retry, and the row counts as done`
  - `the shapefile code -2147220985 does the same, and the feature count stays`
  - `a feature count 400 says "Feature count not supported by this data source"`
  - `an HTTP 500 on the shape count shows "Shape count failed: HTTP 500" beside the feature count`
  - `a count body of literal null shows "Feature count failed: The server's answer was not a count."`
  - `a row cut off mid-chain shows the total, and Load more adds the shape count after it`
  - `Load more adding a count leaves an open Details open, and focus stays on its summary` (Review Focus 1)
  - `with autoFeatureCounts off, a layer row has no counts and no "Counting features"`
- [ ] **Step 2: Run** `npx playwright test tests/e2e/rows.spec.js`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Detect "unsupported" from HTTP status 400, ArcGIS code 400, or `-2147220985`. Row outcomes: any skipped request makes it `"skipped"`, then any `{ error }` makes it `"failed"`, otherwise `"done"`. `render` must not replace `row.details`.
- [ ] **Step 4: Run** `npm run lint && npm test`. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "Show counts inline, and treat a data source's limits as a note"`

### Task 5: Retry

**Files:**
- Modify: `src/src/inject/inject.js`
- Test: `tests/e2e/rows.spec.js`, `tests/e2e/requests.spec.js`

**Interfaces:**
- Consumes: `job.retryingFailed`, `job.fetch` with `userAction`, `SDT.status.canRetry`, `SDT.status.subscribe`, `SDT.status.snapshot` (Task 1).
- Produces: `loadRow(row, { userAction })`, and a `retry(row)` wired to each Retry button through `SDT.guard.listen`.

- [ ] **Step 1: Write the failing tests:**
  - `a 502 then success: Retry shows the row, and the bar says "Loaded details for N services in M requests" with no "failed"`, with M counting the Retry
  - `Retry sends only what is missing`: a row with JSON and a failed shape count sends one `/query`, and no JSON
  - `Retry after the budget is spent sends the row's requests`: 60 rows with one failed in the first 50; Bulk calls go up by 1 and nothing else
  - `two overlapping Retries on rows with no JSON both finish`
  - `Retry that fails again keeps focus on the new Retry button`
  - `Retry that succeeds moves focus to the row's summary`
  - `a second press while a Retry runs sends nothing, and the button stays focused`
  - `the Retry button's name is "Retry details for {name}"`
  - `a 429 removes every Retry button, and focus on one moves to the bar's message`
  - `no Retry is offered when canRetry is false`
  - `Load more hides while a Retry runs, and comes back after` (Review Focus 4)
- [ ] **Step 2: Run** `npx playwright test tests/e2e/rows.spec.js tests/e2e/requests.spec.js`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** The button uses `aria-disabled` while it runs, like Load more. A `SDT.status.subscribe` listener removes Retry buttons once `snapshot().stopped` is set. Retry runs through the same batch wrapper as Load more, so the busy class stays right.
- [ ] **Step 4: Run** `npm run lint && npm test`. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "Offer Retry on a failed row or count, through the limiter"`

### Task 6: Accessibility pass, docs and build check

**Files:**
- Modify: `tests/e2e/rows.spec.js`, `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `.coderabbit.yaml`, `docs/superpowers/specs/2026-10-09-store-readiness-design.md`, and this part's design doc (`status: implemented`)

- [ ] **Step 1: Write the tests** in `rows.spec.js`:
  - `axe passes on a loaded root page's rows, and on a service page with counts, in light and dark, on a light and a dark host page`, with `include: ".sdt-annot, .sdt-details"`
  - `axe passes on a failed row with Retry, a warning badge, and an open disclosure`
  - `every interactive part of a row is reachable by keyboard alone, in order: link, badge link, summary, Retry`
  - `the summary is at least 24 px tall`
- [ ] **Step 2: Run** `npx playwright test tests/e2e/rows.spec.js`. Fix what fails in `src/`, and list each change in the commit body.
- [ ] **Step 3: Update the docs** to match the code:
  - In `CLAUDE.md`: `SDT.row` in the namespace list after `SDT.status`; `userAction`; `grant`'s floor; `extend` gone; the row description; the "Not loaded" paragraph; the sdt-css exemption.
  - `.coderabbit.yaml`: the load order `dom, guard, auth, url, net, status, row, page, settings, theme, icon`.
  - Store-readiness spec: drop the interim "Not loaded" wording in 4.3, and note the counts move under Phase 5.
- [ ] **Step 4: Run** `npm run lint && npm test`, then `node scripts/build.js`, unzip into an empty `mktemp -d` folder, and run `EXT_PATH=<folder> npx playwright test`. Expected: PASS both ways.
- [ ] **Step 5: Commit**: `git commit -m "Describe badges, details, Retry and SDT.row in the docs"`
