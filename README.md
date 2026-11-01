# Services Directory Toolkit

A Chrome extension that adds diagnostic and query tools to the ArcGIS Server REST Services Directory, the HTML pages under `.../rest/services`.

Services Directory Toolkit is an independent continuation of [Map Services Enhanced](https://github.com/raykendo/Map-Services-Enhanced) by Ken Doman. It is not affiliated with or endorsed by Ken Doman or Esri. ArcGIS is a trademark of Esri.

## Purpose

ArcGIS Server publishes a REST endpoint that applications use to request and edit geographic data. The HTML pages it generates give you a lightweight way to inspect and test services.

Sometimes you need more than one page shows. Collecting data from several map services means visiting each link, going back, and visiting the next one, and remembering field names and properties is a hassle. Depending on which Services Directory page you're on, the extension adds controls that collect that information for you.

## Features

- Search REST endpoints for map layers, field names, and other service properties.
- View metadata on multiple services without visiting each one.
- Count the features in each map layer.
- Color-code map service spatial references for easy comparison.
- See what the extension is doing in a status bar under the page heading, with a Load more button when the page has more services or layers than the extension requests on its own.
- Build SQL queries with a click.
- Simplify map export service testing.
- Shorten query page URLs that carry long lists of unneeded parameters.
- Preview map images when hovering over service links.

## Compatibility

Services Directory Toolkit supports ArcGIS Online and every ArcGIS Enterprise and ArcGIS Server version on Windows and Linux that Esri hasn't retired, as listed in Esri's [ArcGIS Enterprise life cycle](https://support.esri.com/en-us/products/arcgis-enterprise/life-cycle).

Unsupported means the extension may still work on a retired version, but a bug that happens only there won't be fixed.

The extension needs Chrome 120 or later, or another browser based on Chromium 120 or later, such as Microsoft Edge.

Known limitation: the map image preview panel is fixed to the window and can cover the Load more button while you hover a link with the mouse. Move the pointer away, or use the keyboard, which isn't affected. The panel gets a fix in Phase 6 (IMG-3).

## Install

To run Services Directory Toolkit from source:

1. Clone this repository.
2. Open `chrome://extensions` and turn on Developer mode.
3. Click **Load unpacked** and select the `src/` folder.

To work on the code, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md). Please don't open a public issue for it.

## Origins

Ken Doman wrote Map Services Enhanced between 2016 and 2020 to bundle the bookmarklets from his [ESRI REST Diagnostics](https://github.com/raykendo/ESRI_REST_Diagnostics) project into a single Chrome extension. Its last Chrome Web Store release, 1.4.0, uses Manifest V2, which current Chrome no longer loads. This repository keeps the full history of Ken's code and continues it from version 2.0.0 under a new name.

Changes made on top of Ken's last commit:

- Moved to Manifest V3. The toolbar button now turns on only on ArcGIS REST pages.
- Replaced the gear and its in-page settings form with a status bar under the page heading. It appears only when the extension has loaded or is loading details, says how many requests it made, offers Load more when it stops at 50 automatic requests, and tells you if the server asked for fewer requests. Screen readers hear the same messages. Settings are on the options page, which the popup's new Options link opens.
- Defined every setting once, with its default and allowed values, and checked what is stored when it is read. The options page no longer breaks on a value saved by the old in-page form, and refuses a blank or out-of-range preview size instead of saving it.
- Made the options page save only the settings you changed, check Chrome sync's size limits before saving, and say "Saved" only once the save has worked, or why it didn't. Errors appear under the fields they belong to.
- Kept the print task's saved web map on this computer instead of syncing it, and started it empty.
- Labelled every control on the options page, grouped the Select All choices, and added a note that changes apply when you reload a page.
- Ran on the services root when its URL has a query string, such as `?f=html` or `?token=`, and on geoprocessing `submitJob` pages. The Query Helper now appears only on query pages.
- Removed the automatic field and domain counts until a Count values button returns them on request.
- Turned the toolbar button on only from the top frame of the page in the tab, not from frames, prerendered pages or pages in the back/forward cache.
- Removed the extension's web-accessible files, which let any site detect that it was installed.
- Replaced the Grunt build, which no longer installs, with npm scripts and ESLint 10.
- Fixed error reporting, which crashed on any HTTP 400 from a service.
- Fixed print task pages, where inputs the extension should hide stayed visible.
- Added browser tests that run against a fake ArcGIS Server, and a live check that every feature still appears on Esri's public sample server.
- Limited automatic requests to the page's own server: at most 50 per page and 4 at a time. They stop if the server answers 429 or 503, and rows past the limit say they weren't loaded.
- Sent a `token` from the page URL only to the same server's REST services, in the request body rather than the URL, and never across a redirect. The popup's search does the same with the tab's token.
- Skipped JSON views and pages that aren't Services Directory pages, which used to show a stuck spinner or an "Invalid form." dialog.
- Prefixed the extension's CSS classes with `sdt-`, so they no longer clash with the page's own.
- Added a shared stylesheet with light and dark palettes that meet WCAG 2.2 AA contrast, checked on every change, and a check that matches the extension's colours to the page's own background, ready for the redesigned interface.

## License

MIT. See [LICENSE](LICENSE), which keeps Ken Doman's original copyright notice.
