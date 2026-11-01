---
status: approved
issues: [45, 15, 16]
phase: 5
part: 2 of 3
---

# Phase 5, part 2: spatial reference badges, details and row states

Part 2 of the three pull requests that make up Phase 5. Part 1 (#66) delivered the request chains, `SDT.status` and the status bar. This part covers #15 (badges) and #16 (details), and moves the per-layer counts from #17 into the row. Part 3 keeps Count values. It builds on `docs/superpowers/specs/2026-10-26-phase-5-chains-and-status-bar-design.md`, and on the design review's sections 6.4, 6.5 and 6.6.

## Intent

A list of 80 services should scan as 80 lines. Each row reads: the service link, a stable spatial reference badge, its cache or count badges, and a Details disclosure. Everything the extension reports about a service sits behind a control that works from the keyboard, as plain text. A row that fails says why and offers Retry, and a row that wasn't loaded stays plain, because the status bar already explains it.

## Goals

- **Badges (#15, INJ-8, INJ-14, SEC-7, SEC-8):** colour from an FNV-1a hash of the WKID, one of the eight tested sets, the same on every page. The link is `https://` with an encoded value and the accessible name "Spatial reference N". WKT-only references get a neutral truncated badge. "Dynamic" or "Tiled" appears only when `singleFusedMapCache` exists.
- **Details (#16, INJ-9, INJ-11, INJ-13):** a native `<details>` at the end of the row, with a short summary, a grouped definition list, plain text from server HTML, and Max Record Count whenever it exists. Clicking inside the body never closes it.
- **Row states:** loading, error with Retry, and not loaded (plain).
- **Per-layer counts inline (design review 6.6):** "**3** features **2** with shapes", "rows" for tables, the warning badge for zero features, and per-count errors with Retry.
- **Clean-up:** `.sdt-datablock`, `.sdt-collapsed`, `.sdt-note`, `.sdt-metadata-error`, `toggleCollapse`, `getColor`, `getCompColor`, `li`, `addSubList` and `reportError` go, if nothing else uses them. `limiter.extend` goes, because nothing calls it.

## Non-goals

- Count values, per-field and coded-value counts, statistics queries and matching counts by field name (#17, part 3). INJ-2's `test.fixme` stays.
- The in-row "Load 8 more layers" button that `docs/design/mockups/service-layers.html` shows on one row. The bar already has that action (see Builder's calls).
- Map previews (Phase 6) and the Find Helper's own limiter copy (Phase 7).

## Decisions (owner, 2026-11-01)

1. **Per-layer counts move into this part.** They sit on the same row line, so part 3 no longer touches the row.
2. **Retry goes through the page limiter.** It's exempt from the 50 cap, because a click starts it, but 4 at once, scope, pushback and `pagehide` still apply, and the bar's count stays true. No Retry is offered after pushback.
3. **The bar's totals update after a Retry.** A row that succeeds moves from failed to done, and the requests go up.
4. **One new lib, `SDT.row`,** holds the pure logic. `inject.js` keeps the DOM building and the chain.
5. **Server HTML becomes text through `DOMParser`.**

## Approaches considered

- **A. One lib, `SDT.row` (chosen).** All the pure logic in one namespace, testable in the `vm` harness, and `inject.js` shrinks. The file covers two issues, but they describe one row.
- **B. Two libs, `SDT.badge` and `SDT.details`.** Maps cleanly to the issues, but adds two namespaces for about 150 lines.
- **C. Keep it in `inject.js`.** Fewest files, but only the palette hash could be unit-tested, which is the one test #15 demands.
- **HTML to text:** `DOMParser` (chosen) gives an inert document: no scripts run and no images load, and all entities decode. A regex strip mishandles odd HTML and misses numeric entities.

## Design

### `SDT.row` (`src/src/lib/row.js`)

A lib file loaded after `status.js` in every content-script group and in `page_action.html`. Pure functions, no DOM except `text`:

- `paletteIndex(sr) → 0..7`: FNV-1a (32-bit, offset `0x811c9dc5`, prime `0x01000193`, `Math.imul`, `>>> 0`) of `String(sr.latestWkid || sr.wkid)`, modulo 8. Pinned: 3857 → 2 and 4326 → 0. `{ wkid: 102100, latestWkid: 3857 }` → 2. A bare `{ wkid: 102100 }` hashes 102100, which gives 1.
- `spatialReference(data) → object | null`: `data.spatialReference`, else `data.extent?.spatialReference`, else `null`. Layers use `extent.spatialReference` (spec).
- `badge(sr) → { kind, text, title?, href?, index? } | null`:
  - WKID: `{ kind: "wkid", text: "3857", href: "https://spatialreference.org/ref/?search=3857", index }`, with the value through `encodeURIComponent`
  - WKT only (`latestWkt` or `wkt`): `{ kind: "wkt", text: "WKT " + first 24 characters + "…", title: full text }`
  - neither, or `sr` null: `null`, meaning no badge
- `cacheLabel(data) → "Tiled" | "Dynamic" | null`: only when `singleFusedMapCache` is a boolean on the data.
- `summary(data) → string`: services "2 layers, max 1,000 records"; layers "Polygon, 6 fields"; tables "Table, 9 fields". Numbers use `toLocaleString("en-CA")`. Parts that aren't present are left out, and an empty result gives `""`.
- `details(data, toText) → [{ group, items: [{ term, value, mono? }] } | { group, sentence }]`: groups **Service** (or **Layer**), **Extent** and **Also true**, in the mockups' order. Every field `showMetadata` shows today has a row, plus "Spatial reference", which reads "No spatial reference" when there's none, and the full WKT when there's no WKID. Extents print as four numbers in `xmin, ymin, xmax, ymax` order, `mono`. **Also true** is one sentence of the true flags, through today's `unCamelCase`, without the flags that already have a row (`defaultVisibility`, `isDataVersioned`, and `singleFusedMapCache`). Max Record Count shows whenever it exists (INJ-13). `toText` is applied to every server string that can hold HTML: descriptions and copyright. Group labels are plain text, not headings.
- `text(html) → string`: `new DOMParser().parseFromString(html, "text/html").body.textContent`, trimmed, with runs of whitespace collapsed. It never inserts anything into the page. `details` takes it as an argument, so the `vm` tests pass a stub; the browser suite covers the real one.
- `failureText(result) → string`: the ArcGIS error's `message`, else `result.error.message`.

### Status and limiter

- `limiter.fetchJson` takes `options.userAction: true`, which skips only the cap check. Scope, concurrency, pushback and `pagehide` still apply. The request still counts in `accepted`. It is stripped from the options before `SDT.net.fetchJson`, like `onSend`. A per-request flag replaces granting, because a Retry's count requests reach the limiter only after its JSON answers, so two overlapping grants wouldn't add up.
- `limiter.grant(n)` becomes `state.max = Math.max(state.max, state.accepted + n)`, for Load more only, so it can never lower the cap.
- `limiter.extend` is removed, with its tests and the `CLAUDE.md` mention.
- `SDT.net.limitNote`, `stoppedNote`, and their row text stay only as the refusal's `message`. No row shows them now.
- `job.retryingFailed(n)` moves `n` rows from failed to pending, as `retrying` does for skipped ones.
- `job.fetch(url, options)` passes `options.userAction` through to the limiter.
- `SDT.status.canRetry() → boolean`: a job exists and the limiter is neither stopped nor aborted.

### Rows (`inject.js`)

Each row is `<a>Name</a> (MapServer)`, then `<span class="sdt sdt-annot">`, then `<details class="sdt sdt-details sdt-details--inline">`, following the mockups. `showSpatialReferenceData`, `showMetadata` and `reportError` are replaced by small render functions over `SDT.row`.

| Row state | What it shows |
|---|---|
| Loading | In the annot: spinner and "Loading details" (`.sdt-status`) |
| Counting | Badges, then spinner and "Counting features" |
| Loaded | Badge, cache badge or counts, and Details |
| Failed | `.sdt-status[data-tone="error"]` "Details unavailable: {reason}" and a quiet Retry button with hidden " details for {name}" |
| Count failed | The counts that worked, then "Shape count failed: {reason}" or "Feature count failed: {reason}", and Retry with hidden " shape count for {name}" or " feature count for {name}" |
| Not loaded | Plain: no note, no spinner |

- **Counts:** `<span class="sdt-count"><b>3</b> features</span>`, "rows" for tables, "1 feature" in the singular. Zero is `.sdt-badge--warn` with the warn icon, hidden "Warning: " and "0 features".
- **Retry:** only a row whose outcome is `"failed"` offers it. It calls `job.retryingFailed(1)` and re-sends only what's missing, with `userAction: true` on every request. A row that has a skipped request is `"skipped"`, and Load more re-sends its missing requests, failed ones included. The button stays focusable while it runs (`aria-disabled`). Focus then moves to the row's `<summary>` when there is one, to the new Retry button if it failed again, or otherwise to the row's link.
- **After pushback:** a subscriber to `SDT.status` removes every Retry button once `snapshot().stopped` is set, and moves focus to the bar's message if a Retry had it.
- **Busy class:** `notifyLoading` counts starts and stops per class, so a Retry that finishes while a batch runs can't clear the batch's class. A Retry sets it like any batch. The hidden status line stays silent on a page with a job, so the bar reports it.
- **Row model:** a row keeps `data`, `outcome`, and `counts: { total, shape }`, each `{ value }`, `{ error }` or `{ unsupported: true }`. Nothing outside `inject.js` reads a row. `render(row)` rebuilds the annot and the disclosure from this, so `list`, `notes` and `counted` go.
- **Settings:** with `autoMetadata` off there's no job, and rows stay plain, as today. With `autoFeatureCounts` off, a row has no counts and never reaches the Counting or Count failed states.
- **Scope:** only link rows change. A layer or table page's own content is untouched until part 3.
- **Noun:** "layers" on `service` and `layer` pages. This closes the copy gap from part 1.
- **Row order:** the annot's children are rebuilt from the row's state, so the counts keep their order after Load more. This closes the part 1 note about count order.

## Tests (written first)

- **Unit:** `tests/unit/row.test.js` (palette pins, `badge` for each kind, encoding, `cacheLabel`, `summary`, `details` groups, Max Record Count without `documentInfo`, extent format, the Also true sentence); `limiter.test.js` (`grant` never lowers the cap; `userAction` skips the cap but not scope, concurrency, pushback or `pagehide`, and is stripped from the options); `status.test.js` (`retryingFailed`, `canRetry`).
- **Browser:**
  - INJ-11's second half: server HTML and entities show as text, with a real `DOMParser`, and a `<script>` or `<img onerror>` in a description doesn't run or load.
  - Keyboard: Tab reaches each summary, Enter and Space toggle it, and `aria-expanded` follows.
  - Clicking and selecting text inside the body leaves it open.
  - WKT-only, no spatial reference, Tiled, Dynamic, and no `singleFusedMapCache`.
  - `https://` link and accessible name "Spatial reference 3857".
  - Retry: a 502 then success gives a done bar with no "failed" and the right request count; Retry after the budget is spent sends only the row's requests; two overlapping Retries on rows with no JSON both finish; a count Retry sends one request; Retry fails again with focus on the new button; no Retry after a 429.
  - Zero features shows the warning badge; a table says "rows".
  - axe and keyboard-only tests on badges, details, counts and Retry, on a light and a dark host page.
- **Migration:** assertions on `.sdt-datablock` and the "Not loaded" row text move to `details.sdt-details` and the bar. The tests that use `spatialReference: null` to make a row throw need a new trigger, because that is now a legal "no badge" case.

## Docs

`README.md`, `CONTRIBUTING.md`, `CLAUDE.md` and `.coderabbit.yaml` must match the code, including the load order (`status`, then `row`). The store-readiness spec's 4.3 interim "Not loaded" wording goes, and the register moves the per-layer counts note. `tests/unit/sdt-css.test.js` exempts `inject.js` once it's written for the shared stylesheet, if the Find Helper's classes allow it.

## Findings this part closes or advances

Closed: INJ-8, INJ-9, INJ-11, INJ-13, INJ-14 and SEC-8. Advanced: SEC-7 (the spatialreference.org link), INJ-18, INJ-19, OWN-4 and ADV-1. #15 and #16 close in full. #17 stays open for Count values, and the PR must not use a closing keyword on it.

## Builder's calls (the owner can override)

- **HTTP 400 on a count** becomes a muted note, with no Retry, and the row counts as done: "Shape count not supported by this data source" or "Feature count not supported by this data source". It applies to HTTP status 400, ArcGIS error code 400 and the shapefile code -2147220985, the two `reportError` matches today. The other count is unaffected. Part 1 parked this: a known server limit isn't a failure.
- **Retry is exempt from the cap** (see Status and limiter). This changes how decision 2 is met, not what it decided: the budget governs automatic requests, and a click is a user action.
- **No in-row Load more.** The bar's button is the only one, because two controls for one action add a tab stop per page and nothing else.
- **A bare `wkid: 102100`** keeps its own hash, as the design formula says. Servers send `latestWkid: 3857` with it.

## Left to the builder

- Exact function names inside `inject.js`.
- The order of rows inside each details group, following the mockups where they show one.
- Fixtures for WKT-only, Tiled and zero-feature rows, on the fake server.
