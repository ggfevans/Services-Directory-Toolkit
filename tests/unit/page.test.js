import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLib } from "./helpers/sdt.js";

const { page } = loadLib().SDT;

// A location that throws on anything but pathname, which proves the classifier reads only that (TOK-6).
const onlyPathname = (pathname) => new Proxy({}, {
  get(_, key) {
    if (key === "pathname") {
      return pathname;
    }
    throw new Error(`read location.${String(key)}`);
  }
});

// A document with the given content type and markers.
const doc = ({ contentType = "text/html", breadcrumbs = true, titleCell = "", h2 = "", title = "" } = {}) => ({
  contentType,
  title,
  querySelector(selector) {
    if (selector === ".breadcrumbs") {
      return breadcrumbs ? { textContent: "Home > services" } : null;
    }
    if (selector === ".titlecell") {
      return titleCell ? { textContent: titleCell } : null;
    }
    if (selector === "h2") {
      return h2 ? { textContent: h2 } : null;
    }
    return null;
  }
});

const ROOT = "/arcgis/rest/services";

test("classifies each Services Directory page type from the pathname", () => {
  const cases = {
    [ROOT]: "root",
    [`${ROOT}/`]: "root",
    "/ArcGIS/REST/Services": "root",
    [`${ROOT}/Transport`]: "folder",
    [`${ROOT}/Transport/Roads/MapServer`]: "service",
    [`${ROOT}/Parcels/mapserver/`]: "service",
    [`${ROOT}/Parcels/MapServer/0`]: "layer",
    [`${ROOT}/Parcels/MapServer/0/query`]: "query",
    [`${ROOT}/Parcels/FeatureServer/query`]: "query",
    [`${ROOT}/Elevation/ImageServer/query`]: "query",
    [`${ROOT}/Parcels/MapServer/find`]: "find",
    [`${ROOT}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/execute`]: "gpTask",
    [`${ROOT}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/submitJob`]: "gpTask",
    [`${ROOT}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task`]: "service",
    [`${ROOT}/Parcels/MapServer/layers`]: "service",
    [`${ROOT}/Parcels/FeatureServer/0/queryDomains`]: "service",
    "/Fk3Org9xQ/ArcGIS/rest/services/Parcels/FeatureServer": "service"
  };
  for (const [pathname, type] of Object.entries(cases)) {
    assert.equal(page.classify(onlyPathname(pathname), doc()), type, pathname);
  }
});

test("a JSON view is jsonView whatever its markup", () => {
  for (const contentType of ["application/json", "text/plain"]) {
    assert.equal(page.classify(onlyPathname(`${ROOT}/Parcels/MapServer/0`), doc({ contentType, breadcrumbs: false })), "jsonView");
  }
});

test("a page whose pathname has no rest/services is other, whatever its query string (TOK-6)", () => {
  // The query string ?x=/rest/services/ is in the URL, but classify never reads it.
  assert.equal(page.classify(onlyPathname("/evil.html"), doc()), "other");
  assert.equal(page.classify(onlyPathname("/arcgis/rest/servicesX/A/MapServer"), doc()), "other");
  assert.equal(page.classify(onlyPathname("/arcgis/myrest/services"), doc()), "other");
});

test("an HTML page without Services Directory markers is other", () => {
  assert.equal(page.classify(onlyPathname(`${ROOT}/Utilities/Valves/MapServer`), doc({ breadcrumbs: false, title: "ArcGIS Server Login" })), "other");
});

test("any one marker is enough, so markup without .breadcrumbs still works", () => {
  const path = onlyPathname(`${ROOT}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/execute`);
  assert.equal(page.classify(path, doc({ breadcrumbs: false, titleCell: "ArcGIS REST Services Directory" })), "gpTask");
  assert.equal(page.classify(path, doc({ breadcrumbs: false, title: "Execute Task (Export Web Map Task)" })), "gpTask");
  assert.equal(page.classify(onlyPathname(ROOT), doc({ breadcrumbs: false, h2: "Folder: /" })), "root");
  assert.equal(page.classify(onlyPathname(`${ROOT}/Parcels/MapServer`), doc({ breadcrumbs: false, h2: "Parcels (MapServer)" })), "service");
});

test("serviceType gives Esri's casing, and baseUrl drops the query and fragment", () => {
  assert.equal(page.serviceType(onlyPathname(`${ROOT}/A/mapserver/0`)), "MapServer");
  assert.equal(page.serviceType(onlyPathname(`${ROOT}/Elevation/ImageServer`)), "ImageServer");
  assert.equal(page.serviceType(onlyPathname(ROOT)), null);
  assert.equal(page.baseUrl({ origin: "https://arcgis.test", pathname: `${ROOT}/A/MapServer` }), `https://arcgis.test${ROOT}/A/MapServer`);
});
