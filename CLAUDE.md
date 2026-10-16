# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Services Directory Toolkit is a Chrome extension (Manifest V3, Chromium browsers only) that adds diagnostic and query tools to the HTML pages served by ArcGIS Server REST endpoints (`.../rest/services/...`). It packages the bookmarklets from [ESRI REST Diagnostics](https://github.com/raykendo/ESRI_REST_Diagnostics) into one tool. The code is plain vanilla JS with no framework, no bundler, and no runtime dependencies.

It is an independent continuation of Ken Doman's [Map Services Enhanced](https://github.com/raykendo/Map-Services-Enhanced), which stopped at 1.4.0 on Manifest V2. The `upstream` remote points at the original, and its full history is in this repo. The old name should appear only where it credits the original: the README, the manifest and `package.json` descriptions, and the options page footer. Keep Ken's line in `LICENSE`, which the build adds to the zip. Work before the first store release follows `docs/superpowers/specs/2026-10-09-store-readiness-design.md`.

## Working to the spec

Section 4 of the spec is the definition of done for every phase. A change in behaviour starts with a failing test, and `README.md`, `CONTRIBUTING.md`, this file and `.coderabbit.yaml` must match the code when the phase ends. Each pull request lists the IDs it closes from the spec's findings register (Appendix A), and how it resolved each one. CodeRabbit reads this file as its code guidelines (`knowledge_base` in `.coderabbit.yaml`) when it reviews a pull request.

`docs/superpowers/plans/` holds the implementation plan for each piece of work. `docs/design/` holds the UI design review for issue #7, with its mockups and screenshot scripts, and the spec records the decisions it settled. `docs/design/2026-10-calcite-spike.md` and `docs/design/2026-10-primer-spike.md` report spikes on Esri's Calcite and GitHub's Primer design systems, with their prototypes in `docs/design/calcite-spike/` and `docs/design/primer-spike/`. Neither is a dependency: their scripts take the packages from `CALCITE_PATH` and `PRIMER_PATH`. The bug report form (`.github/ISSUE_TEMPLATE/bug_report.yml`) links to the README's `#compatibility` anchor, so keep that heading's name.

## Commands

Requires Node 22.13 or a later 22.x, or Node 24 or later (`engines` is `^22.13.0 || >=24`, and `.nvmrc` pins 24). Run `npm install` first, and `npx playwright install --no-shell chromium` once for the browser tests.

- `npm run lint`: ESLint 10 (flat config in `eslint.config.js`) over the repo, with warnings treated as errors. Formatting rules come from `@stylistic` (2-space indent, double quotes, semicolons). Code under `src/` may not write HTML strings (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`).
- `npm test`: `npm run test:unit` (`node --test` over `tests/unit/`), then `npm run test:e2e` (Playwright, in `tests/e2e/`). See [Browser tests](#browser-tests).
- One unit test file: `node --test tests/unit/build.test.js`. One browser spec, or one test in it by title: `npx playwright test tests/e2e/pages.spec.js -g "options page"`. `--grep @cdp` picks the tests tagged `@cdp`.
- `npm run build`: lint, then zip into `build/<package name>-<version>.zip`. Only files the extension references ship (see `scripts/lib/extension-files.js`), plus the root `LICENSE`. The build fails on a missing or unreferenced file, a `chrome.runtime.getURL` call without a string literal, or a version mismatch between `package.json` and `src/manifest.json`. To test the zip the way CI does, run `node scripts/build.js` (the build without lint), unzip the zip into an empty folder, and run Playwright with `EXT_PATH` set to that folder.
- `npm run test:live`: checks that each feature appears (presence only, no values) on Esri's public sample server (override with `SDT_TEST_SERVER`) in the installed Google Chrome, headless unless `HEADED=1`. It isn't part of CI. Branded Chrome ignores `--load-extension`, so `tests/live/smoke.js` loads the extension over CDP (`Extensions.loadUnpacked`), which needs `--enable-unsafe-extension-debugging`, Developer mode in the throwaway profile, and `ignoreDefaultArgs: ["--disable-extensions"]`.
- `node scripts/probe-tokens.js`: probes how a server handles tokens, for the token work (settings in the comment at the top of the file). Run it by hand on servers you can sign in to, signing in by hand with `PROBE_MANUAL_LOGIN=1` on federated or SSO servers. It isn't part of CI, and git ignores its output in `probe-output/`.
- To try the extension by hand, open `chrome://extensions`, turn on Developer mode, and use "Load unpacked" on `src/`.

## Browser tests

Each test starts Chromium, headless unless `HEADED=1`, with the extension from `src/` (or `EXT_PATH`). Playwright's default headless shell can't load extensions, so the fixtures in `tests/e2e/fixtures.js` use `channel: "chromium"`; `CHROME_PATH` runs the suite in another Chromium build through `executablePath`.

`tests/fixtures/fake-arcgis.js` answers requests to three origins: `https://arcgis.test`, an Enterprise-style server that signs users in with an `agstoken` cookie or a token and hides secured services from anonymous listings, and two ArcGIS Online stand-ins, `https://services9.arcgis.com` and `https://www.arcgis.com`. The `signIn` fixture sets the server's sign-in cookie, and `openPopupTab` takes a Page to report its real tab id. The browser resolves no host names, and Playwright doesn't route a redirect's target, so following a redirect fails the test: browser tests can't open a secured page anonymously, and the unit tests cover its 302. The fixtures come from two files. `catalog.js` holds the services, layers and the rows that counts are computed from, and `pages.js` renders HTML shaped like the 10.9 and 11.x Services Directory. Catalog keys that start with `_` are fixture data the fake server never sends. `whereMatcher` lists the where clauses it can evaluate. A test can replace a response with `fakeServer.override(pattern, handler)`, and the handler may answer late or never. All of this data is synthetic. Don't commit responses captured from Esri's servers: their terms don't allow redistribution.

A request to one of those origins that has no fixture gets a 404 and fails the test. A test also fails on a request to another host, a request the fake server can't interpret (such as a where clause it doesn't support, or an override that returns no status), an override that never matched a request, a dialog, and any console error or uncaught exception. A test can allow a console error through `expectedErrors`, and clears the other violations with `harness.forgive()` after asserting that the right list caught them. The checks have two limits. Playwright doesn't route the network requests of the real toolbar popup, because it has no Page, so popup logic is tested through `openPopupTab`. And errors during service worker startup, or during the popup's initial load, happen before the error hooks are in and go unseen.

The main CI job runs the suite against the unzipped build, with `EXT_PATH=dist`. The non-blocking Chrome 120 job runs it against `src/` and skips the `@cdp` tests, because Chrome 120's DevTools protocol has no `Extensions.triggerAction`. Chrome 120 is the manifest's `minimum_chrome_version`, which `tests/unit/manifest.test.js` pins. Chrome for Testing 120 crashes at startup on macOS 27, so the suite can't run on it locally there. `CONTRIBUTING.md` describes the manual Chrome 120 check before a release.

`tests/e2e/known-bugs.spec.js` holds bugs from the findings register that reproduce today, as `knownBug()` cases that Playwright expects to fail. The change that fixes one turns its `knownBug()` into `test()`, unless the comment above the case says otherwise. `SHOW_KNOWN_BUGS=1` runs them as normal tests. Use it after renaming classes or changing the requests the extension sends, to check that each case still fails on its last assertion and not in its setup. Find elements by role or text where possible, because class names change during the store-readiness work.

## Layout

The extension root is `src/`, which holds `manifest.json` and `icons`. The scripts sit one level deeper, in `src/src/`. Paths in the manifest and in `chrome.runtime.getURL(...)` resolve relative to `src/`. For example, `getURL("src/config/options.json")` loads **`src/src/config/options.json`**.

## Architecture

**Content scripts** (`src/src/inject/`) do nearly all the work. The manifest injects them by URL pattern:
- `inject.js`, `status.js`, `mapImages.js` (and `inject.css`) run on every `rest/services` page:
  - `inject.js` is the main tool. It fetches service JSON, collects metadata, feature counts, and field/domain counts, and color-codes spatial references.
  - `status.js` renders the in-page status/settings icon and an options form.
  - `mapImages.js` shows map image previews when you hover over links.
- `queryTest.js` runs on `.../query` pages and handles the query builder, SQL helpers, and the "Select All" behavior.
- `printTask.js` runs on `execute`/`submitjob` pages and pre-fills the default `Web_Map_as_JSON`.

Each script is wrapped in a bare `{ ... }` block and defines its own copies of helpers such as `ajax` and `loadElement`. This is deliberate: all of an extension's content scripts in a frame share one isolated world, even across `content_scripts` groups, and the blocks keep their `const` declarations from colliding. There is no shared module until Phase 2 adds `src/src/lib/` (spec section 5). If you change a helper, the change applies only to that file's copy.

**Page action popup** (`src/src/page_action/`): `search.js` searches the REST endpoint tree of the active tab, and `url_shortener.js` strips unneeded query parameters. Both read the active tab's URL with `chrome.tabs.query`, which works only because clicking the toolbar button grants `activeTab`. The content-script `matches` give extension pages cross-origin access to every host (Chrome ignores their paths for this), but they don't expose `tab.url`. Keep `activeTab`: the activeTab test in `tests/e2e/action-popup.spec.js` fails without it.

**Background** (`src/src/bg/background.js`) is a service worker that keeps the toolbar button disabled by default. `status.js` runs on every REST page and sends an `enableAction` message, and the service worker then enables the button for that tab. Chrome clears per-tab action state on navigation, so the content-script `matches` in the manifest are the only URL rules. Don't reintroduce a `declarativeContent` `ShowAction` rule: in Chrome 154 it did not re-enable an action disabled with `chrome.action.disable()`. `mapImages.js` and `queryTest.js` start from a `window` `load` listener (MV2 used a `sendMessage` handshake).

**Settings** live in `chrome.storage.sync`, and their defaults are repeated in places that must agree:
1. `src/src/options/options.html` (the controls) and `options.js` (the defaults, in its `chrome.storage.sync.get` call): the Chrome options page
2. `src/src/config/options.json`: the declarative schema that `status.js` uses to render the in-page settings form
3. Each content script's `chrome.storage.sync.get({key: default}, ...)` call

The storage keys are `autoMetadata`, `autoFeatureCounts`, `autoFieldCounts`, `autoDomainCounts`, `defaultWebMapAsJSON`, `defaultWhereClause`, `queryHelperSelectAll`, `showMapImages`, `mapImageWidth`, and `mapImageHeight`. They already disagree:
- For "do nothing", `queryHelperSelectAll` is `donothing` on the options page but `nothing` in `src/src/config/options.json`.
- `printTask.js` defaults `defaultWebMapAsJSON` to `""`, while both settings UIs show a web map.

Phase 4 of the store-readiness spec replaces all of this with one schema.

Code under `src/` builds DOM with `loadElement` and text nodes, never HTML strings. Lint enforces this.
