# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Services Directory Toolkit is a Chrome extension (Manifest V3, Chromium browsers only) that adds diagnostic and query tools to the HTML pages served by ArcGIS Server REST endpoints (`.../rest/services/...`). It packages the bookmarklets from [ESRI REST Diagnostics](https://github.com/raykendo/ESRI_REST_Diagnostics) into one tool. The code is plain vanilla JS with no framework, no bundler, and no runtime dependencies.

It is an independent continuation of Ken Doman's [Map Services Enhanced](https://github.com/raykendo/Map-Services-Enhanced), which stopped at 1.4.0 on Manifest V2. The `upstream` remote points at the original, and its full history is in this repo. The old name should appear only where it credits the original: the README, the manifest and `package.json` descriptions, and the options page footer. Keep Ken's line in `LICENSE`, which the build adds to the zip. Work before the first store release follows `docs/superpowers/specs/2026-10-09-store-readiness-design.md`.

## Commands

Requires Node 22.13+ or 24 (`.nvmrc` pins 24). Run `npm install` first, and `npx playwright install --no-shell chromium` once for the browser tests.

- `npm run lint`: ESLint 10 (flat config in `eslint.config.js`) over the repo, with warnings treated as errors. Formatting rules come from `@stylistic` (2-space indent, double quotes, semicolons). Code under `src/` may not write HTML strings (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`).
- `npm test`: unit tests (`node --test`, in `tests/unit/`), then the browser tests.
- `npm run test:e2e`: the browser tests (Playwright, in `tests/e2e/`). Each test starts headless Chromium with the extension from `src/` (or `EXT_PATH`). `tests/fixtures/fake-arcgis.js` answers the requests to `https://arcgis.test` that it has fixtures for, and any other request to that host gets a 404 and fails the test. A test also fails on a request to another host, a request the fake server can't interpret (such as a where clause it doesn't support, or an override that returns no status), an override that never matched a request, a dialog, and any console error or uncaught exception. A test can allow a console error through `expectedErrors`, and clears the other violations with `harness.forgive()` after asserting that the right list caught them. The checks have two limits. Playwright doesn't route the network requests of the real toolbar popup, because it has no Page, so popup logic is tested through `openPopupTab`. And errors during service worker startup, or during the popup's initial load, happen before the error hooks are in and go unseen. Playwright's default headless shell can't load extensions, so the fixtures use `channel: "chromium"`; `CHROME_PATH` runs the suite in another Chromium build through `executablePath`. Set `HEADED=1` to watch. CI runs the suite against the unzipped build, with `EXT_PATH=dist`. `tests/e2e/known-bugs.spec.js` holds bugs that are expected to fail until their fix lands; `SHOW_KNOWN_BUGS=1` runs them as normal tests.
- `npm run build`: lint, then zip into `build/<package name>-<version>.zip`. Only files the extension references ship (see `scripts/lib/extension-files.js`), plus the root `LICENSE`. The build fails on a missing or unreferenced file, a `chrome.runtime.getURL` call without a string literal, or a version mismatch between `package.json` and `src/manifest.json`.
- `npm run test:live`: checks that each feature appears (presence only, no values) on Esri's public sample server (override with `SDT_TEST_SERVER`) in the installed Google Chrome, headless unless `HEADED=1`. It isn't part of CI. Branded Chrome ignores `--load-extension`, so `tests/live/smoke.js` loads the extension over CDP (`Extensions.loadUnpacked`), which needs `--enable-unsafe-extension-debugging`, Developer mode in the throwaway profile, and `ignoreDefaultArgs: ["--disable-extensions"]`.
- To try the extension by hand, open `chrome://extensions`, turn on Developer mode, and use "Load unpacked" on `src/`.

Test data in `tests/fixtures/` is synthetic. Don't commit responses captured from Esri's servers: their terms don't allow redistribution.

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

Each script is wrapped in a bare `{ ... }` block and defines its own copies of helpers such as `ajax` and `loadElement`. This is deliberate: all of an extension's content scripts in a frame share one isolated world, even across `content_scripts` groups, and the blocks keep their `const` declarations from colliding. There is no shared module. If you change a helper, the change applies only to that file's copy.

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
