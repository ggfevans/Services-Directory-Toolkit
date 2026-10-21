// Which content-script groups each URL gets, from the manifest's match patterns (MAN-2, PRT-2, QRY-3,
// TR-22). matches() follows Chrome's rules for the patterns the manifest uses: the scheme * means
// http or https, the host * means any host, and the path pattern is matched against the URL's path
// and query string together, with * matching any characters, / and ? included. A probe extension
// with these patterns, loaded in Chromium 141 and in Chrome for Testing 120 (2026-10-21), got the
// groups below for the same kinds of URL in both. The browser tests in
// tests/e2e/url-patterns.spec.js check what runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SRC } from "./helpers/sdt.js";

const manifest = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));

const matches = (pattern, href) => {
  const [, scheme, host, path] = pattern.match(/^(\*|https?):\/\/([^/]+)(\/.*)$/);
  assert.equal(host, "*", `${pattern}: only the host * is modelled`);
  const url = new URL(href);
  const schemes = scheme === "*" ? ["http:", "https:"] : [`${scheme}:`];
  const glob = new RegExp(`^${path.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return schemes.includes(url.protocol) && glob.test(`${url.pathname}${url.search}`);
};

/** The content-script group that loads file, by its last script, or the CSS-only group for "css". */
const group = (file) => manifest.content_scripts.find((entry) => (file === "css" ? !entry.js : entry.js?.at(-1) === file));
const GROUPS = { main: group("src/inject/mapImages.js"), query: group("src/inject/queryTest.js"), gp: group("src/inject/printTask.js") };

const groupsFor = (href) => Object.entries(GROUPS)
  .filter(([, entry]) => entry.matches.some((pattern) => matches(pattern, href)))
  .map(([name]) => name);

const ROOT = "https://gis.example.org/arcgis/rest/services";
const TASK = `${ROOT}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task`;

const CASES = {
  // The services root, with and without an instance path, a trailing slash or a query (MAN-2, TR-22).
  [ROOT]: ["main"],
  [`${ROOT}/`]: ["main"],
  [`${ROOT}?f=html`]: ["main"],
  [`${ROOT}?token=abc`]: ["main"],
  [`${ROOT}/?token=abc`]: ["main"],
  "https://gis.example.org/rest/services": ["main"],
  "https://gis.example.org/rest/services?f=html": ["main"],
  "https://gis.example.org/a/b/rest/services": ["main"],
  "http://gis.example.org/arcgis/rest/services": ["main"],
  // Folders, services and layers, with a query.
  [`${ROOT}/Utilities?token=abc`]: ["main"],
  [`${ROOT}/Parcels/MapServer`]: ["main"],
  "https://gis.example.org/rest/services/Parcels/MapServer": ["main"],
  [`${ROOT}/Parcels/MapServer/0?f=html`]: ["main"],
  "https://services9.arcgis.com/Fk3Org9xQ/arcgis/rest/services/Parcels/FeatureServer": ["main"],
  // The query operation only, and not the other operations whose names start with query (QRY-3).
  [`${ROOT}/Parcels/MapServer/0/query`]: ["main", "query"],
  [`${ROOT}/Parcels/MapServer/0/query?where=1%3D1&f=html`]: ["main", "query"],
  [`${ROOT}/Parcels/FeatureServer/query`]: ["main", "query"],
  "https://gis.example.org/rest/services/Parcels/MapServer/0/query": ["main", "query"],
  [`${ROOT}/Parcels/MapServer/0/queryDomains`]: ["main"],
  [`${ROOT}/Parcels/FeatureServer/queryDomains?layers=0`]: ["main"],
  [`${ROOT}/Parcels/MapServer/0/queryRelatedRecords`]: ["main"],
  // A trailing slash, which the classifier ignores, as main's patterns before Phase 3 did.
  [`${ROOT}/Parcels/MapServer/0/query/`]: ["main", "query"],
  [`${ROOT}/Parcels/MapServer/0/query/?where=1%3D1&f=html`]: ["main", "query"],
  "https://gis.example.org/rest/services/Parcels/MapServer/0/query/": ["main", "query"],
  [`${ROOT}/Parcels/MapServer/0/query/extra`]: ["main"],
  // GP forms, in Esri's casing (PRT-2), and nothing else under a task.
  [`${TASK}/execute`]: ["main", "gp"],
  [`${TASK}/execute?f=html`]: ["main", "gp"],
  [`${ROOT}/Transport/RouteTools/GPServer/Summarize%20Routes/submitJob`]: ["main", "gp"],
  [`${ROOT}/Transport/RouteTools/GPServer/Summarize%20Routes/submitJob?f=html`]: ["main", "gp"],
  "https://gis.example.org/rest/services/PrintingTools/GPServer/Export%20Web%20Map%20Task/execute": ["main", "gp"],
  [`${TASK}/execute/`]: ["main", "gp"],
  [`${TASK}/execute/?f=html`]: ["main", "gp"],
  [`${ROOT}/Transport/RouteTools/GPServer/Summarize%20Routes/submitJob/`]: ["main", "gp"],
  "https://gis.example.org/rest/services/Transport/RouteTools/GPServer/Summarize%20Routes/submitJob/?f=html": ["main", "gp"],
  [`${ROOT}/Transport/RouteTools/GPServer/Summarize%20Routes/submitjob`]: ["main"],
  [`${ROOT}/Transport/RouteTools/GPServer/Summarize%20Routes/jobs/j0123456789`]: ["main"],
  [`${TASK}/executeNow`]: ["main"],
  [`${TASK}`]: ["main"],
  // Not Services Directory paths. Patterns are case-sensitive, so /REST/services gets nothing.
  "https://gis.example.org/arcgis/rest/servicesX": [],
  "https://gis.example.org/arcgis/REST/services": [],
  "https://gis.example.org/arcgis/rest": [],
  "https://gis.example.org/other/page": [],
  // Patterns also match the query string, and other sites' paths: the classifier sorts these out.
  "https://gis.example.org/docs/rest/services/overview": ["main"],
  "https://gis.example.org/other/page?x=/arcgis/rest/services/": ["main"],
  "https://gis.example.org/evil.html?x=/rest/services": ["main"]
};

for (const [href, expected] of Object.entries(CASES)) {
  test(`content-script groups for ${href}`, () => {
    assert.deepEqual(groupsFor(href), expected);
  });
}

test("the stylesheet goes wherever the main scripts go", () => {
  assert.deepEqual(group("css").matches, GROUPS.main.matches);
});

test("no pattern is listed twice in a group", () => {
  for (const entry of manifest.content_scripts) {
    assert.equal(new Set(entry.matches).size, entry.matches.length);
  }
});
