import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLib } from "./helpers/sdt.js";

const { url } = loadLib().SDT;
const SCOPE = "https://gis.example.org/server";
const BASE = `${SCOPE}/rest/services/Parcels/MapServer`;
const TOKEN = { value: "tok.en-1", scope: SCOPE };

const summary = (request) => request && { url: request.url, method: request.method, body: request.body?.toString() ?? null, carriesToken: request.carriesToken };

test("without a token, params go in the query string in order", () => {
  assert.deepEqual(summary(url.build(`${BASE}/0/query`, { where: "not OBJECTID is null", returnGeometry: false, returnCountOnly: true, f: "json" })), {
    url: `${BASE}/0/query?where=not+OBJECTID+is+null&returnGeometry=false&returnCountOnly=true&f=json`,
    method: "GET",
    body: null,
    carriesToken: false
  });
});

test("a token inside the scope goes in a POST body with the params, and the URL keeps neither", () => {
  assert.deepEqual(summary(url.build(`${BASE}?f=html#frag`, { f: "json" }, TOKEN)), {
    url: BASE,
    method: "POST",
    body: "f=json&token=tok.en-1",
    carriesToken: true
  });
});

test("the token goes to an instance path in another case: it is the same scope", () => {
  assert.equal(url.build("https://GIS.example.org/Server/rest/services/A/MapServer", { f: "json" }, TOKEN).carriesToken, true);
});

test("a token never goes outside its scope", () => {
  for (const base of [
    "https://other.example.org/server/rest/services/A/MapServer",
    "http://gis.example.org/server/rest/services/A/MapServer",
    "https://gis.example.org/portal/rest/services/A/MapServer",
    "https://gis.example.org/server/admin/services",
    `${SCOPE}/rest/services/%2e%2e/%2e%2e/admin/x`
  ]) {
    const request = url.build(base, { f: "json" }, TOKEN);
    assert.equal(request.carriesToken, false, base);
    assert.equal(request.method, "GET", base);
    assert.doesNotMatch(request.url, /token/, base);
  }
});

test("an empty token is never sent", () => {
  const request = url.build(BASE, { f: "json" }, { value: "", scope: SCOPE });
  assert.deepEqual(summary(request), { url: `${BASE}?f=json`, method: "GET", body: null, carriesToken: false });
});

test("a token already in the base URL is dropped, not forwarded", () => {
  assert.equal(url.build(`${BASE}?token=from-a-link`, { f: "json" }).url, `${BASE}?f=json`);
  assert.equal(url.build(`${BASE}?token=from-a-link`, { f: "json" }, TOKEN).body.toString(), "f=json&token=tok.en-1");
});

test("a token in the base URL is dropped whatever its case", () => {
  for (const name of ["Token", "TOKEN"]) {
    assert.equal(url.build(`${BASE}?${name}=from-a-link`, { f: "json" }).url, `${BASE}?f=json`, name);
    const request = url.build(`${BASE}?${name}=from-a-link`, { f: "json" }, TOKEN);
    assert.equal(request.url, BASE, name);
    assert.equal(request.body.toString(), "f=json&token=tok.en-1", name);
  }
});

test("a param replaces a base parameter of the same name in any case", () => {
  assert.equal(url.build(`${BASE}?F=html&keep=1`, { f: "json" }).url, `${BASE}?keep=1&f=json`);
  const request = url.build(`${BASE}?F=html&keep=1`, { f: "json" }, TOKEN);
  assert.equal(request.url, `${BASE}?keep=1`);
  assert.equal(request.body.toString(), "f=json&token=tok.en-1");
});

test("method POST without a token puts the params in the body", () => {
  assert.deepEqual(summary(url.build(BASE, { f: "json" }, null, { method: "POST" })), { url: BASE, method: "POST", body: "f=json", carriesToken: false });
});

test("undefined and null params are dropped", () => {
  assert.equal(url.build(BASE, { f: "json", where: undefined, outFields: null }).url, `${BASE}?f=json`);
});

test("only http(s) and the extension's own URLs can be built", () => {
  assert.equal(url.build("chrome-extension://abc/src/config/options.json").url, "chrome-extension://abc/src/config/options.json");
  assert.equal(url.build("ftp://gis.example.org/x"), null);
  assert.equal(url.build("javascript:alert(1)"), null);
  assert.equal(url.build("not a url"), null);
});

test("stripForFilter drops token, f and the fragment, so the link filters can match (TOK-3)", () => {
  assert.equal(url.stripForFilter(`${BASE}?token=abc`), BASE);
  assert.equal(url.stripForFilter(`${BASE}/0?f=pjson&token=abc#x`), `${BASE}/0`);
  assert.equal(url.stripForFilter(`${BASE}?F=json&Token=abc`), BASE);
  assert.equal(url.stripForFilter(`${BASE}?foo=1&token=abc`), `${BASE}?foo=1`);
  assert.equal(url.stripForFilter(BASE), BASE);
  assert.equal(url.stripForFilter("not a url"), "not a url");
});
