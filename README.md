# Services Directory Toolkit

A Chrome extension that adds diagnostic and query tools to the ArcGIS Server REST Services Directory, the HTML pages under `.../rest/services`.

Services Directory Toolkit is an independent continuation of [Map Services Enhanced](https://github.com/raykendo/Map-Services-Enhanced) by Ken Doman. It is not affiliated with or endorsed by Ken Doman or Esri. ArcGIS is a trademark of Esri.

## Origins

Ken Doman wrote Map Services Enhanced between 2016 and 2020 to bundle the bookmarklets from his [ESRI REST Diagnostics](https://github.com/raykendo/ESRI_REST_Diagnostics) project into a single Chrome extension. Its last Chrome Web Store release, 1.4.0, uses Manifest V2, which current Chrome no longer loads. This repository keeps the full history of Ken's code and continues it from version 2.0.0 under a new name.

Changes made on top of Ken's last commit:

- Moved to Manifest V3. The toolbar button now turns on only on ArcGIS REST pages.
- Replaced the Grunt build, which no longer installs, with npm scripts and ESLint 10.
- Fixed error reporting, which crashed on any HTTP 400 from a service.
- Fixed print task pages, where inputs the extension should hide stayed visible.
- Added a smoke test that checks every feature against Esri's public sample server.

## Purpose

ArcGIS Server publishes a REST endpoint that applications use to request and edit geographic data. The HTML pages it generates give you a lightweight way to inspect and test services.

Sometimes you need more than one page shows. Collecting data from several map services means visiting each link, going back, and visiting the next one, and remembering field names and properties is a hassle. Depending on which Services Directory page you're on, the extension adds controls that collect that information for you.

## Features

- Search REST endpoints for map layers, field names, and other service properties.
- View metadata on multiple services without visiting each one.
- Count the features in each map layer.
- Color-code map service spatial references for easy comparison.
- Count results for each field and domain in a map service layer.
- Build SQL queries with a click.
- Simplify map export service testing.
- Shorten query page URLs that carry long lists of unneeded parameters.
- Preview map images when hovering over service links.

## Install

Services Directory Toolkit runs in Chrome 93 or later and other Chromium browsers. To run it from source:

1. Clone this repository.
2. Open `chrome://extensions` and turn on Developer mode.
3. Click **Load unpacked** and select the `src/` folder.

## Development

Requires Node 20.19 or later. Run `npm install` first.

- `npm run lint` checks the code with ESLint.
- `npm run build` runs the linter, then packages `src/` into `build/services-directory-toolkit-<version>.zip`. The versions in `package.json` and `src/manifest.json` must match.
- `npm run test:smoke` loads the extension into Google Chrome and checks each feature against Esri's public sample server. Set `MSE_TEST_SERVER` to test a different server. It opens a visible Chrome window for about a minute.

Before a release, check the minimum Chrome version by hand: install Chrome for Testing 120 (`npx @puppeteer/browsers install chrome@120`), load `src/` unpacked, and try the services root, a layer page, a query page and the popup.

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md). Please don't open a public issue for it.

## License

MIT. See [LICENSE](LICENSE), which keeps Ken Doman's original copyright notice.
