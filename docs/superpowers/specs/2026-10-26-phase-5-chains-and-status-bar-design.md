---
status: implemented
issues: [45, 14]
phase: 5
part: 1 of 3
---

# Phase 5, part 1: request chains and the status bar

Part 1 of the three pull requests that make up Phase 5 of the store-readiness spec (`2026-10-09-store-readiness-design.md`, "Phase 5"). It covers #45's request chains and clean-up, plus #14 (the status bar). Part 2 covers #15 (badges) and #16 (details). Part 3 covers #17 (Count values). Each part merges before the next one starts, because all three edit `src/src/inject/inject.js`.

## Intent

Service and layer pages should keep working when a request fails, and stay within the request budget (spec section 4.3). They should also say what the extension asked the server for, in a line that sits in the page flow instead of a corner ring. Admins should be able to see, from the page itself, how many requests ran, which rows were left out, and why.

## Goals

- Each service row's chain (details, then the per-layer counts) carries on when one request fails. The failed item shows an error line, and busy classes clear in `finally`.
- Per-layer counts stay automatic and inside the budget: the total from `returnCountOnly`, and features with shapes from `geometryField` or the shape field. FeatureServer layers get shape counts too (INJ-15).
- Query URLs are built with `SDT.url.build` and encoded params, never `String.replace` (INJ-5, SEC-6).
- The status bar (#14, design review section 6.3) replaces the corner ring. It has busy, done, budget-reached (with Load more) and pushback states, and shows no bar when there's nothing to report.
- An ESLint rule bans entity literals such as `&copy;` in strings under `src/` (TOOL-7).
- Clean-up: the colour map becomes a `Map` (SEC-8), and dead code goes. That means `responseTime`, `getPreviousLabel` and `getFieldList` once the field counts are gone, and the `sdt-indicator` CSS. CSS typos and redundant prefixes are fixed (INJ-18 and INJ-19, this part's share).

## Non-goals (later parts)

- Badge colours, the WKID hash, and the spatialreference.org link (#15, part 2).
- `<details>` markup, HTML descriptions turned into text, and Max Record Count (#16, part 2). INJ-11 stays a `knownBug`.
- Count values, statistics queries, matching counts by field name, and the all-zeros fallback (#17, part 3).
- The Find Helper. Phase 7 moves it out of `inject.js`. This part only keeps it working.

## Decisions (owner, 2026-10-26)

1. **Field and domain counts come out in this part.** `checkForNulls`, `checkDomains`, `countFields` and the `COUNT_FIELD_VALUES` and `COUNT_DOMAIN_VALUES` constants are deleted. Layer pages show no per-field counts on `main` until part 3 adds Count values. 2.0.0 is unpublished, so no user loses anything. This also stops field counts from using up the budget before the service details get any.
2. **Load more grants the next 50 requests**, still at most 4 at once. If rows are still left, the bar offers Load more again. A 429 or 503 still stops everything for the page, Load more included.
3. **"Done" counts every request the bar's own work sent**: the automatic requests plus any Load more batches. Clicks in the Find Helper and map previews aren't counted.
4. **The bar gets its numbers from a new lib namespace, `SDT.status`** (Approach A below).
5. **Three pull requests, not two.** This replaces the two-PR split that PR #65 recorded.
6. **A row is one item.** Each row's chain sends up to three requests: the service JSON, the total and the shape count. If any of them is refused by the budget or by pushback, the row counts as not loaded. Load more re-sends only that row's missing requests and never fetches again what the row already shows.
7. **Load more replaces lazy loading.** There's no `IntersectionObserver`: rows load in page order until the budget runs out, then Load more takes over. The register's SEC-5 entry changes from "lazy loading in 5" to "Load more in 5".

### Builder's calls (made during the builder check; the owner can override)

- **Entity literals.** The new lint rule would fail on `inject.js`'s `&copy;` and `&nbsp;`, so this part replaces them with the real characters (`©`, and ` ` where a non-breaking space is meant). INJ-11's `&copy;` case becomes `test()`. INJ-11 stays open for part 2, which turns server HTML into text.
- **What "done" counts.** `SDT.status` counts the requests each job sends itself, through a `job.fetch` wrapper around the page limiter. It doesn't use the limiter's `accepted` total, because the Find and Query Helpers' field loads also go through the limiter (decision 3).
- **The noun.** "layers" on a service page, and "services" on the root and folder pages, including folders that mix services and layers.

## Approaches considered

- **A. A new `SDT.status` lib (chosen).** It holds a shared model in the isolated world, the way `SDT.net.pageLimiter()` does. `inject.js` opens a job, reports each item, and passes over a Load more callback. `status.js` subscribes and renders. The model is pure state, so the `vm` harness can unit-test it. The `<body>` busy classes stay as the busy signal for `mapImages.js` and `queryTest.js`.
- **B. `inject.js` owns the bar.** Fewer moving parts. But query and print pages lose the busy line, and the bar's logic would sit in a 900-line content script with no unit tests.
- **C. CustomEvents or data attributes on `<body>`.** Loosely coupled, but the page's own scripts could read and spoof them, and every payload has to be serialised.

## Design

### `SDT.status` (`src/src/lib/status.js`)

A lib file loaded after `net.js` in every content-script group. Like the other lib files, it declares no top-level names. It holds one model per isolated world (`SDT.state.status`).

- `job(kind, total)` opens a job. `kind` is the noun for the bar's message ("services" or "layers"). The job has these methods:
  - `done()`, `failed()`, `skipped(reason)` report one item; `reason` is `"limit"` or `"stopped"`
  - `onLoadMore(fn)` hands over the callback the Load more button calls
  - `fetch(url, options)` wraps the page limiter's `fetchJson` and counts each request it accepts toward the job
  - `close()` ends the job
- `snapshot()` returns `{ busy, kind, total, done, failed, skipped, requests, stopped, canLoadMore }`. `requests` counts only the requests sent through `job.fetch`, Load more batches included.
- `subscribe(fn)` calls `fn(snapshot)` on every change, through `SDT.guard.wrap`.
- `loadMore()` calls `limiter.extend(SDT.net.BUDGET.max)`, clears the skipped count, and calls the job's callback.

### Limiter

`createLimiter` gains `extend(n)`, which raises `max` by `n`. After a 429 or 503 it does nothing, because `stopped` is permanent for the page. Unit tests in `tests/unit/limiter.test.js` cover it.

### `inject.js` chains

- `collectMetaData` opens `SDT.status.job("services", rows.length)`. Each row's `async` function wraps its chain (the service JSON, then `getLayerCount`) in `try … finally`. Every outcome reports exactly once:
  - `done`
  - `failed`, which shows an error line with `result.error.message`
  - `skipped`, which keeps the row and its anchor so Load more can retry it
- Each row keeps a record of which of its requests are done. Load more re-runs only the missing ones on skipped rows, and clears their "Not loaded" notes first (decision 6).
- In the 60-row budget test, every fixture row costs one request (services without `fields`), so "the next 10" holds. A separate test covers a row that the budget cuts off partway: Load more sends only its missing count.
- `getLayerCount` becomes `async` and returns the list instead of taking a callback. The shape field comes from `geometryField?.name` or the field of type `esriFieldTypeGeometry`. The FeatureServer exclusion goes (INJ-15). Queries use `params` objects; the `where` clause is built with field names as the server gave them, never by concatenating URLs.
- `notifyLoading` uses `classList.add` and `classList.remove`. Clearing the busy class happens in `finally`.

### Status bar (`status.js`)

- The ring and `sdt-indicator` are removed. The bar is `<div class="sdt-statusbar">`, containing the glyph (`SDT.icon("glyph")`, decorative), "SD Toolkit", and `<p role="status">` with the message. It's inserted after the page's first `<h2>`, or at the start of `<body>` when there's no `<h2>`.
- The bar is created on the first non-empty snapshot or the first busy class, so pages with nothing to do get no bar.
- Messages, from design review section 6.3:
  - Busy: "Loading details: 6 of 8 services, 1 failed"
  - Done: "Loaded details for 8 services in 9 requests"
  - Budget reached (`data-tone="warn"`): "Paused after 50 automatic requests. 8 services not loaded yet." with a native button, "Load 8 more services"
  - Pushback (`data-tone="error"`): "The server asked for fewer requests (HTTP 429). Automatic requests stopped on this page."
  - Busy from `<body>` classes only (`mapImages.js` or `queryTest.js`): "Loading"
- The message keeps Phase 3's throttle of one update a second, and the last state always lands. The spinner stops under `prefers-reduced-motion`. The bar has no click handler; only its Load more button does.
- Until part 2, the row text "Not loaded: request limit reached (50)" and "Not loaded: the server answered HTTP 503, so automatic requests stopped" stays next to each skipped row, as the spec's interim wording. The bar adds the summary and the action.

### Tests (written first)

- **Unit:**
  - `status.test.js`: the job lifecycle, the snapshot maths, and Load more resetting the skipped count
  - `limiter.test.js`: `extend`, and `extend` after a stop
  - `lint-rules.test.js`: the entity rule
- **Browser** (`requests.spec.js`, plus a new `status-bar.spec.js` that replaces `indicator.spec.js`):
  - Sixty rows send exactly 50 requests, the bar shows Load more, and one click sends the next 10.
  - A late-answering `fakeServer.override` shows at most 4 requests in flight.
  - A 429 and a 503 each stop automatic requests and show the pushback message.
  - `pagehide` cancels the pending requests.
  - One failed service request shows an error on its row, and the other rows load.
  - The bar's bounding box doesn't overlap page content at 1280 × 800 or 800 × 600.
  - The message is updated at most once a second.
  - The spinner doesn't animate under reduced motion.
  - axe passes on a light and a dark host page, and Load more works from the keyboard.
- **Known bugs:**
  - INJ-2's case tests the field counts that this part removes. It becomes `test.fixme`, with a comment pointing to part 3. A new `test()` covers this part's share of INJ-2: one failed service request doesn't stop the other rows.

### Docs

`README.md`, `CONTRIBUTING.md`, `CLAUDE.md` and `.coderabbit.yaml` must match the code by the end of this part. In particular, the status indicator description becomes the status bar, `SDT.status` joins the load-order list, and the field counts are described as removed until Count values.

## Findings this part closes or advances

Closed in full: INJ-5 and INJ-15. Closed for this part, and finished by part 2: SEC-8. TOOL-7: closed (the entity rule). Advanced: INJ-2 (service chains), INJ-4, INJ-11 (the `&copy;` label), INJ-18, INJ-19, SEC-5 (Load more; the register entry is updated), SEC-6, ADV-1, ADV-5 and OWN-4. #14 closes in full.

## Left to the builder

- The exact `SDT.status` method names, provided the snapshot fields above hold.
- Where `status.js` gets the limiter (`SDT.net.pageLimiter()`).
- The fixture for the 4-in-flight test, built on `fakeServer.override`.
