# Store readiness: fixes, tests and tooling

- **Date:** 2026-10-09
- **Status:** approved by the owner on 2026-10-09
- **Scope:** everything needed before the first Chrome Web Store release of Services Directory Toolkit 2.0.0

This is the single spec for the work. Each phase in section 6 gets its own short implementation plan and its own pull request against `main`.

## 1. Context

Services Directory Toolkit is a Manifest V3 Chrome extension. It adds diagnostic and query tools to ArcGIS Server REST Services Directory pages (`.../rest/services...`). It continues Ken Doman's Map Services Enhanced (MIT; last store release 1.4.0 in 2020, Manifest V2). The extension has never been published under the new name.

The extension supports every ArcGIS Enterprise and ArcGIS Server version that Esri hasn't retired, plus ArcGIS Online (issue #9). Esri's life cycle for ArcGIS Enterprise on Windows and Linux decides the list: versions in General Availability, Extended Support or Mature Support count, and a version drops out on its Esri retirement date. On 10 October 2026 that is 12.1, the current release, back to 10.9.1. ArcGIS Enterprise on Kubernetes is outside the testing scope, and its separate life cycle doesn't change the list.

Tests cover these versions by Services Directory markup, one fixture variant per markup family. The fixtures model 10.9 and 11.x pages, Phase 2 adds a 12.x variant if 12.1's markup differs, and later phases add ArcGIS Online. Public sample servers such as sampleserver6 run 10.9.1, so the live check can't reach 12.x, and 12.x behaviour has to be checked by other means.

The code is about 2,600 lines of plain JavaScript, with no framework, bundler or runtime dependencies:

- **Content scripts** (`src/src/inject/`):
  - `inject.js`: service and layer details, spatial reference badges, counts, and the Find Helper
  - `status.js`: gear icon and in-page settings form
  - `mapImages.js`: hover previews
  - `queryTest.js`: Query Helper
  - `printTask.js`: geoprocessing execute and submitJob pages
- **Popup** (`src/src/page_action/`): REST search and the URL shortener.
- **Options page and service worker.**

Six review agents produced about 115 findings, and the owner then had three adversarial agents review the draft design. Appendix A is the findings register: every finding, the phase that resolves it, and how it is resolved.

## 2. Goals

1. The first store submission passes review, with no blocker or high finding left open.
2. Every finding in Appendix A is fixed, or closed as won't-fix or moot with a recorded reason.
3. Every fix that changes behaviour is covered by an automated test that failed before the fix and passes after it.
4. CI runs lint, unit tests, browser tests and the build on every pull request, against the zip that ships.

## 3. Decisions

| Topic | Decision | Reason |
|---|---|---|
| Delivery | One spec (this document); a short plan and pull request per phase; a store track in parallel | Lower overhead for one maintainer and about 2,600 lines |
| Shared code | Shared classic scripts in `src/src/lib/` load first in every content-script group and extension page and expose one global, `SDT` | Five copies of `ajax` and two copies of the field picker have drifted; one copy gets fixed once |
| In-page settings form | Removed. The gear becomes a status indicator in Phase 3 and a status bar under the page heading in Phase 5. The popup gets an Options link in Phase 3, which Phase 9 turns into three quick switches, All settings and Reload page. | Page scripts can drive the form and can fire the gear's click (both verified) |
| UI design | Phases 5 to 9 follow the UI design review for issue #7, `docs/design/2026-10-ui-design-review.md`: one shared stylesheet, a teal accent, system type, and monospace for identifiers and numbers. The owner accepted its eleven recommendations on 2026-10-09. | The UI was inconsistent and settings sat behind an in-page gear (OWN-4) |
| Theme | In-page additions match the host page's computed background through `SDT.theme`. The popup and options page follow `prefers-color-scheme`. 2.0.0 has no theme setting. | Most Services Directory pages are white, so in-page additions that followed a dark system theme would put dark panels on a white page |
| Site access | Keep the URL-pattern content scripts and add a page-type check | Broad access is justified because ArcGIS Server runs on any host. The check is a correctness filter, not a security control. |
| Minimum Chrome | 120 | Covers every API the phases need. Only Windows 7, 8.1 and Server 2012 R2 (stuck at Chrome 109) and macOS 10.13/10.14 (stuck at 116) are excluded. Edge also honours `minimum_chrome_version`. |
| `activeTab` | Keep | Verified: content-script patterns let the popup's requests through without CORS but do not reveal `tab.url`. Only a toolbar click's activeTab grant does. |
| Feature counts | Per-layer counts stay automatic. Per-field and per-domain-value counts run on demand from a "Count values" button. | One page on Esri's own server triggers 1,352 automatic requests today. A combined statistics query returns all zeros when the shape field is included (verified). |
| Stored defaults in pages | The default where clause and the print web map are inserted by an "Insert default" button, never automatically. The button's handler ignores clicks with `event.isTrusted === false`. The print web map lives in `storage.local` and starts empty. | Anything filled into the page can be read by the page's own scripts, and a page script can call `.click()` on the button. Print web maps often contain internal URLs or tokens. |
| Test data | Hand-written synthetic fixtures modelled on the ArcGIS REST format | Esri's terms of use grant no right to redistribute sample-server content |
| Find Helper | Fixed and kept | Apart from two bugs it works, and it fills in the `layers` parameter that find requires |
| Version | 2.0.0. The listing says it is a new extension and that settings do not carry over from Map Services Enhanced. | Never published; the new listing has a new extension ID |

### Facts verified during review

These were established by experiment and the design depends on them.

- **Isolated world.** All of an extension's content scripts in a frame share one isolated world, across `content_scripts` groups. A file listed in two groups runs once. Page scripts cannot reach that world's globals.
- **Loading the extension headless:**
  - Playwright 1.64 loads the unpacked extension with `channel: "chromium"` (Chrome for Testing 156) and `--load-extension`.
  - The default `chromium-headless-shell` does not load extensions.
  - Branded Chrome ignores `--load-extension`.
- **Routing.**
  - `context.route` intercepts top-level navigations, content-script requests and extension-page requests to a fake host such as `https://arcgis.test`.
  - A catch-all `**/*` route also intercepts `chrome-extension://` requests, so it has to let those through.
- **Sync storage quota.** `chrome.storage.sync` allows 120 writes a minute, so tests that seed storage need a fresh browser context each.
- **Real popup in tests.**
  - The CDP command `Extensions.triggerAction` (with `--enable-unsafe-extension-debugging`) runs the same code path as a toolbar click and grants activeTab.
  - `chrome.action.openPopup()` grants nothing.
- **Service-worker errors.** Uncaught errors in the service worker reach no Playwright event unless the test installs `error` and `unhandledrejection` listeners in the worker.
- **Today's code** emits no console messages on the main paths: root, service, layer, query, print, options and popup.
- **Web-accessible resources.** Removing `web_accessible_resources` stops a content-script `<img src=getURL(...)>` from loading, while `fetch` of the same file still works.
- **Host access from content-script patterns:**
  - Chrome turns the content-script `matches` into host access per origin, so the extension's pages can make cross-origin requests to every site. The path part of each pattern is dropped (Chromium `cors_util.cc` keeps only scheme, host and port).
  - The path does still limit where the content scripts run.
  - These patterns don't expose `tab.url`. That needs `activeTab`.

## 4. Requirements for every phase

These are part of each phase's definition of done.

### 4.1 Tests

- A fix that changes behaviour starts with a failing test.
- Known bugs that already reproduce are added in Phase 1 as Playwright `test.fail()` cases. The phase that fixes a bug turns its case into a normal passing test.
- Exempt from the failing-test rule, and covered by review or lint instead: dead-code removal, CSS typos, artwork, and policy and listing text.
- Behaviour that a browser test can't drive, such as a prerendered page, still gets a failing test. Put the decision in a pure function in `src/src/lib/` and unit-test that function with `node --test`.
- Tests find elements by role or text where possible. Class names change during this work.

### 4.2 Accessibility

- UI added by the extension meets WCAG 2.2 AA. That covers injected panels, badges, details and controls, plus the options page and the popup.
- `@axe-core/playwright` reports zero violations with the `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa` tags, scoped to the extension's own elements on host pages. It runs in both the light and dark colour schemes.
- Keyboard-only tests cover each interactive feature the phase touches.
- Animation respects `prefers-reduced-motion`.

### 4.3 Request budget

Automatic requests are those the extension sends without a user action. They are limited as follows:

- **Total:** at most 50 automatic requests per page view. Past that, the remaining rows show a "Load more" control.
- **Concurrency:** at most 4 requests in flight at once.
- **Destination:** only the page's own origin and its `/rest/services` root. Links to other servers get no automatic requests.
- **Cancellation:** pending requests are cancelled on `pagehide`.
- **Server pushback:** an HTTP 429 or 503 stops automatic work on that page and shows a notice.
- **Token:** a `token` from the page URL is forwarded only to that same origin and REST root.

### 4.4 Security rules

- Content scripts never write to `chrome.storage`. A lint rule bans `chrome.storage.*.set`, `remove` and `clear` under `src/src/inject/`. The rule arrives in Phase 3, when the in-page form, the only content-script writer, is removed.
- No HTML strings go into the DOM (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`). A lint rule enforces this.
- URLs are built with `URL` and `URLSearchParams`. SQL literals come from one shared helper that quotes by field type.
- Stored settings are validated when read, and invalid values fall back to the default.
- Elements the extension creates are held by reference, not looked up by id. A page can supply an element with the same id.

### 4.5 Documentation and register

- `README.md`, `CLAUDE.md` and `.coderabbit.yaml` match the code at the end of each phase.
- Each pull request lists the finding IDs it closes and how each was resolved.

## 5. Shared code mechanism

Introduced in Phase 2.

- **Files.** Shared files live in `src/src/lib/`. Each file is a classic script that adds its functions to one namespace with `globalThis.SDT ??= {}`, without top-level `const` or `let` declarations. A second evaluation is therefore harmless.
- **Loading:**
  - Lib files come first in every `content_scripts[].js` array that uses them.
  - They load through `<script>` tags before the page scripts in `options.html` and `page_action.html`.
  - They load through `importScripts` in the service worker when it needs them.
- **Unit tests.** Node loads the lib files with `vm.runInNewContext` and a stub `chrome`, so pure logic gets fast tests without a browser.
- **Build check.** The build fails if a content-script group or extension page includes a script that references `SDT` but doesn't load the lib files before it.
- **Contents by phase:**

  | Phase | Adds |
  |---|---|
  | 2 | DOM helpers, network helpers (`fetchJson`, request limiter, URL builder, token scope), page classifier, extension-context guard |
  | 4 | Settings schema |
  | 7 | Field picker |

## 6. Phases

Phases run in order, except that the store track (S) runs alongside from the start.

A design review of the whole UI (issue #7) happens after Phase 4 and before Phase 5. It decides the look, the interaction model and how settings appear in the toolbar popup. Phases 5 to 9 then implement its outcome as well as the findings listed for them, and the Phase 9 screenshots show the reviewed UI.

### Track S: store assets and account

Not code; it runs in parallel with the phases.

- **Privacy policy**, hosted at a public URL and linked from the listing and README. It states:
  - the extension reads page content and URLs locally
  - it sends automatic requests to the viewed server with the user's cookies and token
  - settings are stored in Chrome storage, and synced if Chrome sync is on
  - there are no developer servers and no telemetry
  - how to turn automatic requests off
- **New icon artwork:** 16, 32, 48 and 128 px, with 96 px artwork inside the 128 px canvas. Toolbar sizes 16, 24 and 32 px. A 440 × 280 small promo tile.
- **Listing copy**, kept in `docs/store/listing.md`:
  - the first sentence says where the extension works
  - automatic requests are described prominently
  - "Not affiliated with or endorsed by Esri or Ken Doman. ArcGIS is a registered trademark of Esri."
- **Developer account** registration, 2-step verification and trader declaration.
- **Permission justifications:**
  - Host access: ArcGIS Server runs on arbitrary hosts, so the extension can't list them in advance. Chrome grants host access per origin, so the content-script patterns give access to every site. The `/rest/services` part of each pattern only limits where the content scripts run, and the scripts then do nothing unless the page is a Services Directory page.
  - `activeTab`: reads the active tab's URL when the user clicks the toolbar button, to shorten it and to start the REST search from it.
  - `storage`: saves settings.

Screenshots and the Privacy tab answers wait for Phase 9, when the UI is final.

### Phase 1: Foundation

**Goal.** A deterministic test harness, CI, stricter lint and a checked build, with no change to what the extension does.

**Test harness (`@playwright/test`, pinned to an exact version):**

- **Browser.**
  - Each test gets a fresh persistent context, launched with `channel: "chromium"` and headless unless `HEADED=1`.
  - Arguments: `--disable-extensions-except=<ext>`, `--load-extension=<ext>` and `--enable-unsafe-extension-debugging`.
  - `<ext>` is `EXT_PATH` if set, otherwise `src/`.
  - Install with `npx playwright install --no-shell chromium`.
- **Service worker.** One handle per test, from `context.serviceWorkers()` or the `serviceworker` event. An evaluate is retried only on "Service worker restarted". At startup the fixture installs `error` and `unhandledrejection` listeners in the worker that re-log to `console.error`.
- **Storage.** Tests seed `chrome.storage.sync` through the worker before navigating.
- **Routing.**
  - Fixtures are served at `https://arcgis.test/arcgis/rest/services/...`.
  - The fixture router matches on path plus normalised query parameters.
  - An unmatched request to the fake host fails the test and lists the URL.
  - A catch-all for other `http(s)` hosts aborts the request and fails the test.
  - `chrome-extension:` requests pass through.
  - Failure cases are per-test overrides: HTML error bodies, ArcGIS `{"error"}` bodies, and slow or hanging responses.
- **Error guard.** A test fails on:
  - any `weberror`
  - any console error from the extension or its worker
  - any unexpected dialog

  Tests declare the network error messages they expect. The browser logs its own console error for each intentional 4xx or 5xx response.
- **Fixtures.** Hand-written HTML and JSON with fake names, modelled on ArcGIS Server 10.9 and 11.x Services Directory markup:
  - root, folder, MapServer, FeatureServer, layer, query, find, and a GP execute page
  - a static CSS stub

  Later phases add variants they need, such as 12.x and ArcGIS Online markup and pages missing parts.
- **Popup, two ways:**
  - For logic tests, open `page_action.html` as a tab with `chrome.tabs.query` stubbed.
  - For the real popup, click the action through CDP `Extensions.triggerAction` and reach the popup with `chrome.extension.getViews({type: "popup"})` from an extension tab.
- **Toolbar action state.** Bring the page to the front, then read `chrome.tabs.query({active: true, lastFocusedWindow: true})` and `chrome.action.isEnabled` from the worker.
- **Back-forward cache test.** Launch with `ignoreDefaultArgs: ["--disable-back-forward-cache"]` and use `goBack({waitUntil: "commit"})`.

**First tests:**

- **Characterisation tests.** Every check in today's `tests/smoke.js`, ported to fixtures, passing on today's code:
  - the gear icon renders (`naturalWidth > 0`)
  - spatial reference badges, details blocks and field counts
  - the Query Helper panel and its SQL buttons
  - print dropdowns, and print pre-fill after a saved default
  - the options page saves
  - the popup renders
  - the action is enabled on REST pages and disabled elsewhere, including after a back-forward cache restore
  - the real popup opens on REST pages and is refused elsewhere

  Later phases update these tests where they change the behaviour on purpose.
- **activeTab regression test.** The real popup on a REST page shows the page URL in the shortener and completes a search. Run once against a copy without `activeTab` to prove the test fails.
- **Known bugs as `test.fail()`:**

  | Finding | Bug |
  |---|---|
  | INJ-1 | Layer JSON view crash |
  | INJ-2 | One 502 stalls the counts |
  | INJ-3 | Find Helper with no focused field |
  | INJ-11 | Literal `&copy;` |
  | PRT-1 | "Invalid form." alert on a GP JSON result |
  | QRY-1 | Quick-fill radio mismatch |
  | SET-1 | Options page with `nothing` stored |
  | SET-3 | A blank number drops the key |
  | POP-1 | Non-JSON response hangs the search |
  | POP-2 | Invalid regex hangs the search |
  | POP-3 | Number-only search |
- **Unit test.** Every file the manifest and its pages reference exists. It shares its file walker with the build.

**CI (`.github/workflows/ci.yml`, on pull requests and pushes to `main`):**

- The steps:
  1. Check out the code and set up Node from `.nvmrc`.
  2. `npm ci`, lint, unit tests.
  3. `npx playwright install --with-deps --no-shell chromium`, without caching the browser.
  4. Build, unzip to `dist/`, and run the browser tests with `EXT_PATH=dist`.
  5. Upload the zip, and on failure the Playwright report and traces.
- Reporters: `github` and `html`. One retry on CI. Traces retained on failure.
- A separate non-blocking job tries the browser tests on Chrome for Testing 120 through `executablePath`. If Playwright cannot drive 120, the plan records that and replaces the job with a manual check before release.
- `.github/dependabot.yml` covers npm and GitHub Actions, monthly, grouped.

**Lint:**

- `eslint . --max-warnings=0`.
- Ignore `test-results/`, `playwright-report/`, `blob-report/` and `dist/`.
- `no-restricted-syntax` under `src/` bans:
  - assignment to `innerHTML` or `outerHTML`
  - `insertAdjacentHTML`
  - `document.write`

**Build (`scripts/build.js`):**

- The zip contains:
  - files the manifest references (scripts, CSS, pages, icons, web-accessible resources)
  - files the extension's HTML pages reference with `<script>` and `<link>`
  - files named in literal `chrome.runtime.getURL("...")` calls
  - the repository root `LICENSE`
- A non-literal `getURL` argument fails the build. So does a referenced file that is missing, or a file under `src/` that nothing references.
- Paths resolve from `import.meta.url`.

**Housekeeping:**

- **Manifest:** `minimum_chrome_version` "120". Delete `src/_locales/` and `default_locale` together.
- **Files:** delete the unused `src/config/options.json`. Delete `src/LICENSE`, since the build adds the root `LICENSE`.
- **Node:** `engines` `^22.13.0 || >=24`, and `.nvmrc` with 24.
- **`.coderabbit.yaml`:**
  - set the base branch to `main`
  - remove the instruction to keep a `declarativeContent` rule in sync
  - point the `page_action` warning at the Manifest V2 key, not the directory name
- **`CLAUDE.md`:** correct the stale statements:
  - content scripts share one isolated world across groups
  - the smoke test checks presence only
  - content-script patterns grant cross-origin access, but not `tab.url`
  - settings live in more places than listed
  - defaults live in `options.js`, not `options.html`
- **`README.md`:** correct the development and testing sections.
- **`.gitignore`:** add the Playwright output folders and `dist/`.
- **Live check.** The live smoke test moves to `tests/live/smoke.js` (`npm run test:live`).
  - It imports from `@playwright/test`, runs headless by default, and reads `SDT_TEST_SERVER`, falling back to `MSE_TEST_SERVER`.
  - It creates directories and launches inside `try`, so cleanup always runs.
  - It is not part of CI.

**Acceptance:**

- `npm test` passes, with the known-bug cases reported as expected failures.
- CI is green on the pull request.
- The zip contains exactly the allowlisted files.
- The browser tests pass against the unzipped build.

### Phase 2: Shared core

**Goal.** Add the shared mechanism and the helpers every later phase uses, and switch every script to them.

**`SDT` DOM helpers:**
- `loadElement`, which keeps `0` and `false` as text.
- Text helpers.

**`SDT` network helpers:**
- **`fetchJson`:**
  - checks HTTP status and treats an ArcGIS `{"error"}` body as an error
  - parses JSON, with a retry that maps bare `NaN` values outside strings to `null`
  - times out
  - sends no `X-Requested-With` or `Content-type` on GET
  - always resolves to `{data}` or `{error}`
- **Request limiter:** enforces the section 4.3 budget.
- **URL builder:** carries the `token` from the page URL to the same origin and REST root only.

**`SDT` page classifier:**
- It returns root, folder, service, layer, query, find, gpTask, jsonView or other.
- It relies on markers common to 10.9, 11.x, 12.x (12.1 is current) and ArcGIS Online. Check the 12.1 Services Directory markup before choosing the markers, and add a 12.x fixture variant if it differs.
- On `jsonView` and `other` the scripts do nothing and show no spinner.

**Extension-context guard:** stops cleanly after an update cuts off old content scripts.

**Switch-over:**
- Every script replaces its `ajax` and `loadElement` copies with the shared ones.
- Every content script checks the page type before doing anything.
- Every class the extension injects gets an `sdt-` prefix.
- The IE-only branches (`document.selection`, `createTextRange`, `MSXML2.XMLHTTP.3.0`) are removed.

**Acceptance:**
- The INJ-1 and PRT-1 (JSON view) `test.fail()` cases pass.
- Unit tests cover `fetchJson`, the URL builder, the token scope and the classifier.
- Browser tests show:
  - no automatic requests to another origin
  - no spinner on JSON views
  - no `ajax` copies left in the code (checked by lint or grep)

### Phase 3: Shell

**Goal.** The manifest, the background script, the gear and the popup entry points take their final form.

**URL patterns.** All the patterns change in one place:
- add `*://*/rest/services`, `*://*/rest/services/*` and `?`-query variants such as `*://*/*/rest/services?*`
- match `GPServer/*/execute` and `GPServer/*/submitJob`, with Esri's casing
- match only exact `.../query` operations
- the action is enabled only when the page classifier says the page is a Services Directory page

**Background:**
- `action.default_state: "disabled"`, with the existing `onInstalled` and `onStartup` disable kept as a fallback.
- The message handler checks `sender.id`, `sender.tab`, `frameId === 0` and `documentLifecycle === "active"`. Those checks live in a pure function in `src/src/lib/`, which the service worker loads with `importScripts`.
- `enable()` failures are caught.

**Gear:**
- Becomes a status indicator: an inline SVG built with `createElementNS`.
- Has an accessible name and live status text, and respects reduced motion.
- No click handler.
- The loading spinner keeps working, driven by the busy states the scripts already set.
- Phase 5 moves it into the page flow as the status bar.

**Removals:**
- the in-page settings form, its CSS, `src/src/config/options.json` and `settings.svg`
- `web_accessible_resources`, entirely

**Popup:** add an Options link that calls `chrome.runtime.openOptionsPage()`. Phase 9 replaces it with All settings beside three quick switches.

**Manifest metadata:** `short_name` "SD Toolkit". The toolbar icon becomes a size dictionary once the Track S artwork exists.

**Acceptance:**
- The URL-pattern matrix test covers root, `?f=html`, `submitJob`, `queryDomains`, a non-ArcGIS `/rest/services` page and a JSON view.
- No web-accessible resources are present, checked by a build test.
- Page-dispatched clicks reach no extension handler.
- Unit tests show the sender check rejects:
  - a message from another extension
  - a message from a frame other than the top one
  - a message from a document that is prerendering or in the back/forward cache
  - a message with no tab

  It accepts a message from the active top frame of a tab.
- axe-core passes on the gear and popup.

### Phase 4: Settings

**Goal.** Define every setting once and make saving safe.

**Schema (`SDT.settings`):**
- Each entry has a key, type, default, allowed values, min and max, label, and storage area.
- Readers get validated values. Unknown values fall back to the default, so a stored `nothing` reads as `donothing`.
- There is no migration step, because the extension has never been published.

**Storage areas:**
- `defaultWebMapAsJSON` moves to `storage.local` and defaults to empty.
- The other keys stay in `storage.sync`.

**Options page:**
- Stays static HTML.
- A unit test checks every schema key has exactly one matching control with the same allowed values.
- On save, the page:
  1. validates numbers (integer and range) and the web-map JSON (parse and size)
  2. shows inline errors with `aria-invalid`
  3. writes only the keys that changed
  4. awaits the write and reports failure

  "Saved" appears only after the write succeeds.
- A note says changes apply when a page is reloaded.
- Meets WCAG 2.2 AA: `lang`, labels, and fieldsets with legends for radio groups.

**Readers.** Every content script reads settings through the schema. Inline default objects in `storage.sync.get` calls are banned by lint outside `src/src/lib/`.

**Acceptance:**
- The SET-1 and SET-3 `test.fail()` cases pass.
- A quota-exceeding save shows an error and writes nothing.
- A fresh profile reads schema defaults everywhere.

### Phase 5: Service and layer pages (`inject.js`, excluding the Find Helper)

**Failure handling.** Count and detail chains use `fetchJson` and the limiter. A failed item shows an error line and the chain continues. Busy states clear in `finally`.

**Shared style and theme:**
- `src/src/lib/sdt.css` holds the design review's tokens and components (section 4). It comes first in every content-script `css` list and is linked by the popup and the options page.
- `SDT.theme` sets `data-sdt-theme` on `<html>` from the page's computed background, and checks again when the page's styles change (design review section 5.2). The light-or-dark decision is a pure function of a colour, with a table-driven unit test.

**Status bar.** The Phase 3 indicator becomes a one-line status bar in the page flow, under the page's `<h2>` (design review section 6.3). It reports busy, done (with the number of requests made), budget reached (with a Load more button) and server pushback. Pages with nothing to report show no bar.

**Settings.** `autoFieldCounts` and `autoDomainCounts` leave the schema, the options page and every reader, because the Count values button replaces them. Nothing migrates, because 2.0.0 is unpublished.

**Per-layer counts** stay automatic, within the request budget:
- total features: `returnCountOnly`
- features with shapes: `geometryField` or the shape field

**Per-field and per-domain-value counts** run on demand from a "Count values" button.
- If the layer supports statistics:
  - one POST with a `count` entry per queryable field, excluding geometry, blob, raster and XML
  - one `groupByFieldsForStatistics` request per coded-value domain field
  - a sanity check against the total
- Otherwise, a capped per-field fallback.
- Empty-string counts use one extra request per string field, inside the same cap.

**Matching.** Counts attach to fields by name, not position.

**Details:**
- Shown in `<details>`/`<summary>`.
- Max Record Count shown whenever it exists.
- Server HTML descriptions converted to text, and entity literals replaced.
- An ESLint rule bans entity literals such as `&copy;` in strings.

**Badges:**
- Colour is one of eight tested colour sets, picked by an FNV-1a hash of `latestWkid`, or of `wkid` when there is no `latestWkid`. A WKID gets the same colour on every page. Every set meets 4.5:1 for text and 3:1 for borders in both palettes.
- Layers use `extent.spatialReference`.
- "tiled" and "dynamic" appear only when `singleFusedMapCache` exists.
- WKT is truncated, with the full text in `title`.
- The spatialreference.org link is `https://` with an encoded value.

**Clean-up:**
- the colour map uses `Map`
- `readyState` polling is replaced with a load listener
- dead code is removed
- CSS typos are fixed and redundant prefixes removed

**Acceptance:**
- The INJ-2 and INJ-11 `test.fail()` cases pass.
- Request-count tests prove the budget.
- The all-zeros statistics fixture is detected and falls back.
- axe-core and keyboard tests pass on the details, the status bar and the "Count values" control, on a light and a dark host page.
- The theme unit test passes.

### Phase 6: Map previews (`mapImages.js`)

**Requests:**
- Previews request `export` with `f=image` and use the URL directly as the image source. There's no JSON round trip and no stored export `href`.
- Only http(s) is allowed.
- The size is clamped to the service's `maxImageWidth` and `maxImageHeight`.

**Interaction:**
- A preview starts on `mouseenter` or `focus` after 250 ms.
- A new hover cancels the previous request, and a stale response never replaces the current image.

**Panel and labels:**
- The preview becomes a pop-up beside the hovered or focused link, replacing the fixed top-right panel. See issue #6 for placement, closing rules and acceptance criteria.
  - It opens to the right of the row's last annotation (the badges and the Details summary), centred vertically on the link, and flips left or above when there is no room. This refines #6, whose "right of the link text" would cover the row's badges.
  - It never covers the page header, the page's own links or the link itself.
  - It closes on Escape or when the pointer and focus leave, and it stays open while the pointer is over it (WCAG 2.2 SC 1.4.13).
  - Its alt text names the service.
- Previews for FeatureServer links appear only when a matching MapServer link is on the same page. Otherwise the dead branch is removed.
- Labels read "Preview image width/height (px)". Styles are set through `style` properties, not concatenated strings.

**Acceptance:**
- A delayed-response test shows the right image after fast hovering.
- A request-count test shows one export per hovered link.
- A keyboard-focus test passes, and axe-core passes.

### Phase 7: Query and Find pages

**Order of work:**
1. Move the Find Helper out of `inject.js` unchanged into its own content script, gated by the page classifier.
2. Build one shared field picker (`SDT.picker`) used by both helpers.

**Picker:**
- Labelled listboxes.
- Insert on Enter as well as double-click.
- No disabling of the focused list.
- Stale responses are ignored.
- Values are fetched with `resultRecordCount` where pagination is supported, with a note when more exist.
- The target field is chosen with a `focusin` listener on the form, falling back to `where` or `searchText`.
- Insertion uses `setRangeText`.

**Panels.** Both helpers dock at the right edge in a column the page gives up, so no field ends up under them (design review section 6.7). A Hide button collapses a panel to a strip. A panel starts open only when the form fits beside it, and in a window narrower than 40rem it goes into the page flow after the form.

**SQL literals.** A shared helper quotes values by field type: strings with doubled quotes, numbers bare, dates as `TIMESTAMP`, null as `NULL`. Find inserts raw text.

**Presets:**
- Apply over a reset baseline.
- Set radio groups through `checked`.
- "Select Distinct" sets `outFields` from the selected field.
- Submit buttons are found within the form, and the auto-submit label covers every button marked with an asterisk.

**Other behaviour:**
- The default where clause goes in through an "Insert default" button, whose handler ignores clicks with `event.isTrusted === false`.
- If outStatistics text is not valid JSON, entries are inserted at the caret, not replaced.
- ImageServer query and service-level FeatureServer query are classified and handled: fields from the service root, or no picker.

**Acceptance:**
- The INJ-3 and QRY-1 `test.fail()` cases pass.
- SQL-literal unit tests use a table of value and type cases.
- Preset sequence tests pass.
- A `.click()` on the Insert default button from a page script inserts nothing.
- axe-core and keyboard tests pass on both panels.

### Phase 8: Print and geoprocessing pages (`printTask.js`)

**Behaviour:**
- No `alert()`. Pages that are not GP forms are skipped by the classifier, and problems are logged with `console.debug`.
- Every choice list gets "Other...".
- A value missing from the list selects "Other..." and shows the input.
- Optional parameters get an empty option.
- `GPMultiValue` parameters are skipped.
- The new `<select>` takes over the page's `<label for>`. Choosing "Other..." moves focus to the input.

**Web map.** The print web map goes in through an "Insert default" button. It is read from `storage.local`. The button's handler ignores clicks with `event.isTrusted === false`.

**Acceptance:**
- No dialog appears on JSON results or `submitJob` pages.
- Choice-list tests cover the first parameter, a value missing from the list, and an empty default.
- The insert-default test passes, and a `.click()` on the button from a page script inserts nothing.

### Phase 9: Popup and release

**Search:**
- Plain-text, case-insensitive matching by default, with a "Regular expression" checkbox validated before the search starts.
- Crawl:
  - a visited set
  - same origin only
  - a cap of 2,000 locations
  - a timeout per request
  - the shared limiter
- Failed locations are counted and shown, with one `finally` that resets the UI.
- URLs are built with `URL` and encoded segments.
- Results:
  - links open once
  - duplicates are removed
  - `serviceDescription`, `copyrightText`, `tables.name` and GP tasks are searched too
- The form's `submit` is prevented, and the search field is `required`.

**URL trimming:**
- Renamed "Trim query URL".
- Uses `URL` and `URLSearchParams`, with the default-value list taken from the current query form.
- Copies with `navigator.clipboard.writeText` and reports failure.

**Settings in the popup** (design review section 6.2):
- Three switches for `autoMetadata`, `autoFeatureCounts` and `showMapImages`. Their labels, defaults and validation come from `SDT.settings`.
- Each switch saves when it changes, through the Phase 4 writer. On failure the switch flips back and the status line says why.
- The counts switch is disabled while service details are off, with the reason shown under its label.
- After a change, a Reload page button calls `chrome.tabs.reload` and closes the popup.
- All settings replaces the Options link and calls `chrome.runtime.openOptionsPage()`.

**Popup accessibility:** `lang`, labels, a `role="status"` line, and focus kept on the button.

**Release:**
- Wire the Track S icons into the manifest.
- **Screenshots and GIFs:** `npm run screenshots` generates the store screenshots and the README's screenshots and short GIFs into `docs/images/`.
  - A Playwright script produces them against the fake ArcGIS Server, so they can be regenerated after any UI change and contain no Esri content.
  - GIFs are recorded with Playwright's video recording.
  - The README shows a screenshot or GIF for each main feature.
- Fill in the Privacy tab.
- Write test instructions for the reviewer, with public sample URLs.
- Add a `CHANGELOG.md`.
- Re-check Esri's life cycle page for ArcGIS Enterprise on Windows and Linux, update the README's supported-version table and drop retired versions (#9). Kubernetes stays out of scope.
- Add a `version` npm script that keeps `package.json` and `src/manifest.json` in step.
- Add a tag-triggered release workflow that attaches the zip to a GitHub release.
- Run the live check against the exact zip before upload.
- Upload only after the performance and bug review (#8) has run on the merged Phase 9 code and every Critical and High finding is fixed. That review measures against the section 4.3 request budget and adds `npm run perf`.

**Acceptance:**
- The POP-1, POP-2 and POP-3 `test.fail()` cases pass.
- Crawl tests cover the cap, the visited set and a failed folder.
- URL-trimming table tests pass.
- A unit test checks that each popup switch's key exists in the schema and is a boolean.
- axe-core passes on the popup.
- The live check passes on the release zip.
- `npm run screenshots` regenerates every image in `docs/images/` from a clean checkout. Every image the README or store listing uses comes from it.

## 7. Non-goals

- New features beyond what the fixes need.
- A framework, bundler or TypeScript.
- Localisation: the extension is English only.
- Telemetry or remote error reporting.
- Migrating settings from Map Services Enhanced, which has a different extension ID.
- Opt-in access per server (see section 8).

## 8. Alternatives considered

- **Opt-in access per server:**
  - Static patterns for Esri-hosted domains, plus `optional_host_permissions` and `scripting.registerContentScripts` behind an "Enable on this server" click.
  - This removes the "all websites" install warning, at the cost of one click per internal server and a larger change.
  - Deferred. Revisit if the store review objects to broad access.
- **Hardened in-page settings form** (closed shadow root, trusted-click checks, a key allowlist). Rejected: more code to secure than the form is worth.
- **Recorded sample-server fixtures.** Rejected on licensing. A local capture script can be added later as a drift check, with its output kept out of git.
- **Per-file helper copies.** Rejected: the same fixes would land up to five times.
- **Cut as over-built:**
  - a compatibility lint plugin (it flags nothing and does not check `chrome.*` APIs)
  - byte-identical builds
  - a settings migration
  - live settings updates in open tabs
  - a search Stop button
  - prerender handling beyond the sender check

## Appendix A: Findings register

**Severity:** B = blocker for store release, H = high, M = medium, L = low, I = information.

**Resolution:** Fix; Won't fix (with reason); Moot (made irrelevant by a decision); Partly invalid (the review overstated part of it).

**ID prefixes:** ADV findings came from the adversarial review of the draft design. OWN items were added by the owner. Duplicates are cross-referenced.

### inject.js and inject.css

| ID | Sev | Summary | Phase | Resolution |
|---|---|---|---|---|
| INJ-1 | B | Layer and ImageServer JSON views throw and leave the spinner on | 2 | Fix (classifier) |
| INJ-2 | H | `ajax` ignores status and swallows errors; one bad response stalls every chain | 2, 5 | Fix (helper in 2, chains in 5) |
| INJ-3 | B | Find Helper throws with no focused field and inserts SQL-quoted text | 7 | Fix |
| INJ-4 | H | Per-field and per-code queries; unbounded concurrent layer counts | 2, 5 | Fix (limiter in 2; on-demand statistics in 5) |
| INJ-5 | M | Query URLs built with `String.replace`, unencoded and unescaped (also SEC-6) | 5 | Fix |
| INJ-6 | M | An empty `codedValues` array stops later domain counts | 5 | Fix |
| INJ-7 | M | Counts attached to fields by position | 5 | Fix |
| INJ-8 | M | Random badge colours; about half fail AA contrast | 5 | Fix |
| INJ-9 | M | Details toggle not keyboard or screen-reader operable | 5 | Fix |
| INJ-10 | M | Find Helper panel accessibility | 7 | Fix |
| INJ-11 | M | `&copy;`, `&nbsp;` and server HTML shown as literal text | 5 | Fix |
| INJ-12 | L | NaN pre-processing corrupts valid JSON | 2 | Fix (`fetchJson`) |
| INJ-13 | L | Max Record Count gated on `documentInfo` | 5 | Fix |
| INJ-14 | L | Badge and tiled/dynamic logic; http, unencoded spatialreference.org link | 5 | Fix |
| INJ-15 | L | FeatureServer layers never get shape counts | 5 | Fix |
| INJ-16 | L | Page `token` dropped (also QRY-17, part of POP-6) | 2 | Fix, scoped by ADV-6 |
| INJ-17 | L | `readyState` polling | 5 | Fix |
| INJ-18 | L | Dead code, including IE paths | 2, 5 | Fix (IE paths in 2) |
| INJ-19 | L | CSS typos, prefixes and generic class names | 2, 3, 5 | Fix (prefix sweep in 2, form and gear CSS in 3, the rest in 5) |

### queryTest.js and printTask.js

| ID | Sev | Summary | Phase | Resolution |
|---|---|---|---|---|
| PRT-1 | B | Modal "Invalid form." alert on JSON results; `alert()` used for non-errors | 2, 8 | Fix (classifier in 2, alerts removed in 8) |
| QRY-1 | H | Quick-fill writes `.value` on the unselected radio | 7 | Fix |
| QRY-2 | H | Picker quotes by `isNaN`; no escaping; dates and nulls wrong (also SEC-6) | 7 | Fix |
| PRT-2 | H | `submitjob` casing never matches; `execute` too broad | 3 | Fix |
| QRY-3 | M | `/query*` matches other operations and JSON results; ImageServer and service-level query unsupported | 2, 3, 7 | Fix |
| QRY-4 | M | Presets leave stale parameters | 7 | Fix |
| PRT-3 | M | Print default empty on fresh install | 4 | Moot: the web map is inserted on click, starts empty, and lives in local storage |
| QRY-5 | M | Query `ajax` errors swallowed; controls only built on success | 2, 7 | Fix |
| QRY-6 | M | Picker keyboard use | 7 | Fix |
| QRY-7 | M | Picker names and labels | 7 | Fix |
| PRT-4 | M | Choice-list initial selection; `undefined`; GPMultiValue | 8 | Fix |
| QRY-8 | M | Side panel has no max-height | 7 | Fix |
| QRY-9 | L | Insertion target from a one-time blur snapshot | 7 | Fix |
| PRT-5 | L | First GP parameter never gets "Other..." | 8 | Fix |
| QRY-10 | L | Insert ignores selection end; IE branches | 2, 7 | Fix |
| QRY-11 | L | `loadElement` drops text `0` and `false` | 2 | Fix |
| QRY-12 | L | Stale distinct-values responses | 7 | Fix |
| QRY-13 | L | "Up to 1000 examples" not enforced | 7 | Fix |
| QRY-14 | L | Select Distinct preset incomplete | 7 | Fix |
| QRY-15 | L | Auto-submit label, `nothing`/`donothing`, stale tab, submit buttons by index | 2, 4, 7 | Fix |
| QRY-16 | L | outStatistics text replaced when not valid JSON | 7 | Fix |
| PRT-6 | L | New `<select>` has no label; focus not moved on "Other..." | 8 | Fix |
| QRY-17 | L | `token` dropped (duplicate of INJ-16) | 2 | Fix |
| QRY-18 | L | Dead code | 2, 7 | Fix |

### Settings and map previews

| ID | Sev | Summary | Phase | Resolution |
|---|---|---|---|---|
| SET-1 | B | `nothing` versus `donothing` crashes the options page (also SEC-9) | 4 | Fix by validation; migration won't fix (never published) |
| SET-2 | H | Defaults defined in several places and drifted | 4 | Fix |
| SET-3 | H | Blank numbers saved as NaN; no range checks | 4 | Fix |
| SET-4 | H | Sync per-item quota, no JSON validation, no `lastError` handling | 4 | Fix |
| SET-5 | H | In-page form labels show raw HTML | 3 | Moot: form removed |
| SET-6 | M | In-page form never re-syncs; Cancel does not revert | 3 | Moot: form removed |
| SET-7 | M | Gear, panel and options page accessibility | 3, 4 | Fix |
| SET-8 | L | Web-accessible resources expose config and images (also MAN-1, SEC-4) | 3 | Fix |
| SET-9 | L | Save stuck after an extension update | 3 | Moot: form removed; context guard in 2 |
| SET-10 | L | Extensionizr leftovers; unused options.json ships (also PKG-1) | 1, 4 | Fix |
| SET-11 | L | Saved changes do not reach open tabs | 4 | Won't fix: the options page says changes apply on reload |
| IMG-1 | M | Preview cache never hits | 6 | Fix (`f=image`, browser cache) |
| IMG-2 | M | No hover delay or cancellation; stale previews | 6 | Fix |
| IMG-3 | M | Preview panel covers page links | 6 | Fix |
| IMG-4 | M | Size settings double as panel minimum; not clamped | 4, 6 | Fix (labels in 4) |
| IMG-5 | L | FeatureServer preview branch unreachable | 6 | Fix |
| IMG-6 | L | Listeners attached before the panel exists | 6 | Fix |
| IMG-7 | L | Previews mouse-only; generic alt text | 6 | Fix |

### Popup, background and manifest

| ID | Sev | Summary | Phase | Resolution |
|---|---|---|---|---|
| POP-1 | H | One bad response ends the crawl and leaves the button stuck | 9 | Fix |
| POP-2 | H | Invalid regex locks the button; regex is the default | 9 | Fix |
| POP-3 | H | Number-only searches never match | 9 | Fix |
| POP-4 | H | Crawl has no visited set, cap, timeout or limit | 9 | Fix; Stop button won't fix (closing the popup stops the crawl) |
| MAN-1 | M | Web-accessible resources let sites detect the extension (also SEC-4, SET-8) | 3 | Fix |
| MAN-2 | M | Patterns miss root and `?f=html`; any `/rest/services` page enables the action | 3 | Fix |
| BG-1 | M | Action state for already-open tabs, toggling and orphaned scripts | 2, 3 | Fix (`default_state` in 3, context guard in 2) |
| POP-5 | M | One click on a result can open two tabs | 9 | Fix |
| POP-6 | M | Crawl URL building breaks on hyphens, hashes and operation pages | 9 | Fix (token part in 2) |
| POP-7 | M | URL shortener leaves stray `?`, uses unanchored regexes and `execCommand` | 9 | Fix |
| POP-8 | M | Popup accessibility | 9 | Fix |
| BG-2 | M | Prerendered pages can leave the action in the wrong state | 3 | Fix (sender lifecycle check in a unit-tested pure function; no browser test) |
| POP-9 | L | `X-Requested-With` and `Content-type` on GET force preflights | 2 | Fix |
| MAN-3 | L | `_locales` is template boilerplate (also CWS-5) | 1 | Fix |
| POP-10 | L | Empty search submits the form and reloads the popup | 9 | Fix |
| BG-3 | L | No sender checks; `enable()` rejection unhandled | 3 | Fix |
| POP-11 | L | Some fields never searched; duplicate hits | 9 | Fix |
| MAN-4 | L | `short_name` too long; single toolbar icon; no icon padding (also CWS-4) | 3, S, 9 | Fix |
| MAN-5 | L | Minimum Chrome version untested | 1 | Fix (version 120, rationale, CI attempt on 120); compatibility lint won't fix |

### Security and store policy

| ID | Sev | Summary | Phase | Resolution |
|---|---|---|---|---|
| CWS-1 | B | No privacy policy | S | Fix |
| SEC-1 | H | Pages can drive the in-page settings form | 3 | Fix (form removed) |
| CWS-2 | H | Original extension's icons reused | S | Fix (new artwork) |
| SEC-2 | M | Stored settings auto-filled into page forms | 4, 7, 8 | Fix (insert on click; web map in local storage) |
| SEC-3 | M | Stored sizes concatenated into styles and URLs | 4, 6 | Fix |
| CWS-3 | M | Content-script patterns count as all-sites access | 3, S | Fix (patterns in 3, justification in S) |
| SEC-4 | M | Web-accessible resources (duplicate of MAN-1) | 3 | Fix |
| CWS-4 | M | `short_name` over 12 characters (duplicate of MAN-4) | 3 | Fix |
| SEC-5 | L | Automatic requests to any origin, unbounded | 2, 5 | Fix (same origin and limiter in 2, lazy loading in 5) |
| SEC-6 | L | Unencoded query building (duplicate of INJ-5, QRY-2) | 5, 7 | Fix |
| SEC-7 | L | Export `href` as image source; http basemap default; http spatialreference link | 5, 6 | Fix; basemap default moot (empty default) |
| SEC-8 | L | Prototype keys in the colour map stall metadata | 5 | Fix |
| SEC-9 | L | Selector built from a stored value (duplicate of SET-1) | 4 | Fix |
| SEC-10 | L | Popup search robustness (duplicate of POP-1 to POP-6) | 9 | Fix |
| SEC-11 | L | Generic class names; IE `document.selection` | 2 | Fix; partly invalid: page scripts can only reach `document.selection` by DOM clobbering, not directly |
| CWS-5 | L | `default_locale` in an unlocalised extension (duplicate of MAN-3) | 1 | Fix |
| PKG-1 | L | Unused `src/config/options.json` ships (duplicate of SET-10) | 1 | Fix |
| CWS-6 | L | Listing text: description spent on attribution; "URL Shortener" name | S, 9 | Fix |
| SUP-1 | L | `.coderabbit.yaml` targets `master` and has a stale instruction (duplicate of TOOL-8) | 1 | Fix |
| SUP-2 | I | npm audit clean; add Dependabot (duplicate of TOOL-15) | 1 | Fix |

### Tooling

| ID | Sev | Summary | Phase | Resolution |
|---|---|---|---|---|
| TOOL-1 | H | No deterministic test suite, `npm test` or CI | 1 | Fix |
| TOOL-2 | H | Smoke test is live-only and presence-only | 1 | Fix (fixtures, `test.fail()` cases, live check kept as an extra) |
| TOOL-3 | M | Smoke test flakiness | 1 | Fix |
| TOOL-4 | M | Failure messages give little detail | 1 | Fix |
| TOOL-5 | M | Temp directories and Chrome leak on launch failure | 1 | Fix |
| TOOL-6 | M | Headed branded Chrome only | 1 | Fix |
| TOOL-7 | M | Warnings never fail; no DOM-construction rule | 1, 5 | Fix (entity rule in 5) |
| TOOL-8 | M | `.coderabbit.yaml` stale (duplicate of SUP-1) | 1 | Fix |
| TOOL-9 | M | Stale statements in `CLAUDE.md` | 1 | Fix |
| TOOL-10 | M | Node 20 end of life; engines range; no `.nvmrc` | 1 | Fix |
| TOOL-11 | M | Build zips everything under `src/` | 1 | Fix |
| TOOL-12 | M | No release workflow, tags or changelog | 9 | Fix; byte-identical builds won't fix |
| TOOL-13 | L | Build paths relative to the working directory | 1 | Fix |
| TOOL-14 | L | `.gitignore` gaps; `MSE_` names | 1 | Fix |
| TOOL-15 | L | Minor dependency updates; no Dependabot | 1 | Fix |

### Added by the adversarial review

| ID | Sev | Summary | Phase | Resolution |
|---|---|---|---|---|
| ADV-1 | M | `README.md` development and testing sections out of date | 1 and each phase | Fix |
| ADV-2 | B | Store requires a 440 × 280 promo tile and at least one screenshot | S, 9 | Fix |
| ADV-3 | M | Page scripts can fire the gear's click | 3 | Fix (gear has no click handler) |
| ADV-4 | M | `activeTab` needs a justification and a regression test | 1, S | Fix |
| ADV-5 | H | No limit on automatic requests per page view (1,352 on one Esri page) | 2, 5 | Fix (section 4.3) |
| ADV-6 | M | Forwarding the page `token` must not reach other origins | 2 | Fix |
| ADV-7 | M | A combined statistics query returns all zeros when shape is included; long GET URLs fail on IIS | 5 | Fix (POST, excluded types, sanity check) |
| ADV-8 | M | Tests run against `src/`, not the zip that ships | 1 | Fix |
| ADV-9 | M | Service-worker errors invisible to tests; dialogs dismissed silently | 1 | Fix |
| ADV-10 | L | Extension elements looked up by id can be clobbered by the page | 6 | Fix |
| ADV-11 | L | The gear doubles as the loading spinner; no design covered it | 3 | Fix |

### Added by the owner

| ID | Sev | Summary | Phase | Resolution |
|---|---|---|---|---|
| OWN-1 | M | README has no screenshots or GIFs | 9 | Fix (generated by `npm run screenshots` with the store screenshots) |
| OWN-2 | M | No security policy | Separate PR (#5) | Fix (`SECURITY.md`, GitHub private vulnerability reporting) |
| OWN-3 | M | No code scanning | Separate PR (#5) | Fix (CodeQL workflow, `security-extended`, JavaScript and Actions) |
| OWN-4 | H | The UI is inconsistent and awkward to use; settings sit behind an in-page gear | Design review (#7) before Phase 5, then Phases 5 to 9 | Fix (UI design spec, shared style, settings in the toolbar popup) |
| OWN-5 | H | No measured check of performance or real-world bugs before release | Review (#8) after Phase 9, before upload | Fix (measured review, `npm run perf`, one issue per finding; Critical and High fixed before upload) |
| OWN-6 | M | Supported ArcGIS versions aren't documented | 9 and README (#9) | Fix (README Compatibility section following Esri's life cycle, bug report template, release-checklist step) |
