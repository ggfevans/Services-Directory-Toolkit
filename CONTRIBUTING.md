# Contributing

Requires Node 22 (22.13 or later) or Node 24 or later, and `.nvmrc` pins 24. Run `npm install`, then `npx playwright install --no-shell chromium` once for the browser tests.

- `npm run lint` checks the code with ESLint. Warnings fail.
- `npm test` runs the unit tests, then the browser tests. The browser tests load the extension into headless Chromium against a fake ArcGIS Server, so they need no network. Set `HEADED=1` to watch them.
- `npm run build` runs the linter, then packages the files the extension uses into `build/services-directory-toolkit-<version>.zip`. The versions in `package.json` and `src/manifest.json` must match.
- `npm run test:live` checks that each feature appears (it doesn't check values) on Esri's public sample server, in your installed Google Chrome. Set `SDT_TEST_SERVER` to test a different server.

CI also runs the browser tests on Chrome for Testing 120 as a non-blocking check. Chrome for Testing 120 crashes at startup on macOS 27, so it can't be run locally there. Before a release, check the minimum Chrome version by hand: install Chrome for Testing 120 (`npx @puppeteer/browsers install chrome@120 --path ~/chrome-for-testing`), load `src/` unpacked, and try the services root, a layer page, a query page and the popup.
