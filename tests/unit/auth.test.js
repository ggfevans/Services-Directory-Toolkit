import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLib, plain } from "./helpers/sdt.js";

const { auth } = loadLib().SDT;
const ENTERPRISE = "https://gis.example.org/server";

test("the scope is the origin plus the path before the first whole-segment rest/services", () => {
  assert.equal(auth.scopeOf(`${ENTERPRISE}/rest/services/Parcels/MapServer/0`), ENTERPRISE);
  assert.equal(auth.scopeOf("https://gis.example.org/rest/services"), "https://gis.example.org");
  assert.equal(auth.scopeOf("https://gis.example.org:6443/arcgis/rest/services?f=json#top"), "https://gis.example.org:6443/arcgis");
  assert.equal(auth.scopeOf("http://gis.example.org/arcgis/rest/services"), "http://gis.example.org/arcgis");
});

test("instance paths that differ only in case share one scope", () => {
  const scopes = ["https://GIS.Example.org/Server/rest/services", `${ENTERPRISE}/REST/Services/A/MapServer`, `${ENTERPRISE}/rest/services`];
  assert.deepEqual(new Set(scopes.map((url) => auth.scopeOf(url))), new Set([ENTERPRISE]));
});

test("ArcGIS Online org IDs that differ only in case are two scopes", () => {
  const upper = auth.scopeOf("https://services3.arcgis.com/Ab12Cd/arcgis/rest/services/P/FeatureServer");
  const lower = auth.scopeOf("https://services3.arcgis.com/ab12cd/arcgis/rest/services/P/FeatureServer");
  assert.equal(upper, "https://services3.arcgis.com/Ab12Cd/arcgis");
  assert.equal(lower, "https://services3.arcgis.com/ab12cd/arcgis");
  assert.equal(auth.scopeOf("https://services3.arcgis.com/Ab12Cd/ArcGIS/rest/services"), upper);
});

test("on a tiles host the org ID is the second segment and keeps its case", () => {
  assert.equal(auth.scopeOf("https://tiles.arcgis.com/Tiles/Ab12Cd/ArcGIS/rest/services/Base/MapServer"), "https://tiles.arcgis.com/tiles/Ab12Cd/arcgis");
  assert.notEqual(auth.scopeOf("https://tiles.arcgis.com/tiles/ab12cd/arcgis/rest/services"), "https://tiles.arcgis.com/tiles/Ab12Cd/arcgis");
});

test("other arcgis.com hosts are Enterprise scopes, lower-cased", () => {
  assert.equal(auth.scopeOf("https://elevation.arcgis.com/ArcGIS/rest/services"), "https://elevation.arcgis.com/arcgis");
});

test("%2e%2e segments are resolved before the check", () => {
  assert.equal(auth.scopeOf("https://gis.example.org/x/%2e%2e/server/rest/services"), ENTERPRISE);
  assert.equal(auth.scopeOf(`${ENTERPRISE}/rest/services/%2e%2e/%2E%2e/admin`), null);
});

test("an instance path that still holds %2f, %2e, %25 or %5c after parsing has no scope", () => {
  for (const segment of ["a%2fb", "a%2Fb", "a%2Eb", "a%2eb", "%252e%252e", "a%25b", "a%5cb", "a%5Cb"]) {
    assert.equal(auth.scopeOf(`https://gis.example.org/${segment}/rest/services`), null, segment);
  }
  // A backslash new URL turns into a slash is just a separator.
  assert.equal(auth.scopeOf("https://gis.example.org\\server\\rest\\services"), ENTERPRISE);
});

test("encoded characters after rest/services don't affect the scope", () => {
  assert.equal(auth.scopeOf(`${ENTERPRISE}/rest/services/Export%20Web%20Map%2FTask/GPServer`), ENTERPRISE);
});

test("/restricted/rest/services scopes to /restricted", () => {
  assert.equal(auth.scopeOf("https://gis.example.org/restricted/rest/services/A/MapServer"), "https://gis.example.org/restricted");
});

test("/admin, /tokens and /manager stay outside every scope", () => {
  for (const url of [
    "https://gis.example.org/server/admin",
    "https://gis.example.org/server/admin/services",
    "https://gis.example.org/server/tokens/generateToken",
    "https://gis.example.org/server/manager",
    "https://gis.example.org/server/Admin/rest/services",
    "https://gis.example.org/server/rest/admin"
  ]) {
    assert.equal(auth.scopeOf(url), null, url);
  }
});

test("rest/services must be whole segments of the pathname", () => {
  assert.equal(auth.scopeOf("https://gis.example.org/arcgis/rest/servicesX"), null);
  assert.equal(auth.scopeOf("https://gis.example.org/arcgis/myrest/services"), null);
  assert.equal(auth.scopeOf("https://gis.example.org/evil.html?x=/rest/services/"), null);
  assert.equal(auth.scopeOf("https://gis.example.org/evil.html#/arcgis/rest/services"), null);
});

test("URLs that aren't http(s) or don't parse have no scope", () => {
  assert.equal(auth.scopeOf("ftp://gis.example.org/arcgis/rest/services"), null);
  assert.equal(auth.scopeOf("chrome-extension://abc/arcgis/rest/services"), null);
  assert.equal(auth.scopeOf("not a url"), null);
});

test("splitRest returns the instance and the tail", () => {
  assert.deepEqual(plain(auth.splitRest("/a/b/REST/services/F/S/MapServer/")), { instance: ["a", "b"], tail: ["F", "S", "MapServer"] });
  assert.equal(auth.splitRest("/a/rest"), null);
});

test("pageToken reads a non-empty token from a page with a scope", () => {
  const page = (search) => ({ search, href: `${ENTERPRISE}/rest/services${search}` });
  assert.deepEqual(plain(auth.pageToken(page("?f=html&token=abc.1"))), { value: "abc.1", scope: ENTERPRISE });
  assert.equal(auth.pageToken(page("?token=")), null);
  assert.equal(auth.pageToken(page("?f=html")), null);
  assert.equal(auth.pageToken({ search: "?token=abc", href: "https://gis.example.org/evil.html?token=abc" }), null);
});
