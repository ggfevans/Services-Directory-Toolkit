import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLib, plain } from "./helpers/sdt.js";

const SCOPE = "https://gis.example.org/server";
const BASE = `${SCOPE}/rest/services/Parcels/MapServer`;
const TOKEN = { value: "tok.en-1", scope: SCOPE };

const reply = (text, { status = 200, type = "basic" } = {}) => ({ type, status, ok: status >= 200 && status < 300, text: async () => text });

/** Loads the lib with a fetch that records each call and answers with respond(url, init). */
const withFetch = (respond = () => reply("{}")) => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return { calls, net: loadLib({ globals: { fetch } }).SDT.net };
};

test("a GET sends the params in the URL, and no headers, credentials or redirect mode", async () => {
  const { calls, net } = withFetch(() => reply("{\"name\":\"Parcels\"}"));
  assert.deepEqual(plain(await net.fetchJson(BASE, { params: { f: "json" } })), { data: { name: "Parcels" } });
  assert.equal(calls[0].url, `${BASE}?f=json`);
  assert.equal(calls[0].init.method, "GET");
  for (const key of ["headers", "body", "credentials", "redirect", "referrerPolicy"]) {
    assert.equal(Object.hasOwn(calls[0].init, key), false, key);
  }
});

test("a token inside the scope goes in a form POST body, with redirect manual and default credentials", async () => {
  const { calls, net } = withFetch();
  await net.fetchJson(BASE, { params: { f: "json" }, token: TOKEN });
  assert.equal(calls[0].url, BASE);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.body.toString(), "f=json&token=tok.en-1");
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(Object.hasOwn(calls[0].init, "credentials"), false);
});

test("a token outside the scope, or an empty one, is not sent", async () => {
  const { calls, net } = withFetch();
  await net.fetchJson("https://other.example.org/server/rest/services/A/MapServer", { params: { f: "json" }, token: TOKEN });
  await net.fetchJson(BASE, { params: { f: "json" }, token: { value: "", scope: SCOPE } });
  for (const call of calls) {
    assert.equal(call.init.method, "GET");
    assert.doesNotMatch(call.url, /token/);
    assert.equal(call.init.body, undefined);
  }
});

test("a redirect on a request that carries a token is an error, and its URL has no token", async () => {
  const { net } = withFetch(() => ({ type: "opaqueredirect", status: 0, ok: false, text: async () => "" }));
  const { error } = plain(await net.fetchJson(BASE, { params: { f: "json" }, token: TOKEN }));
  assert.equal(error.type, "redirect");
  assert.equal(error.url, BASE);
  assert.match(error.message, /redirect/i);
});

test("an HTTP error status is an error", async () => {
  const { net } = withFetch(() => reply("<html>Bad Gateway</html>", { status: 502 }));
  assert.deepEqual(plain(await net.fetchJson(BASE)).error, { type: "http", message: "HTTP 502", url: BASE, status: 502 });
});

test("an ArcGIS error body is an error, even at HTTP 200", async () => {
  const body = { error: { code: 498, message: "Invalid Token", details: [] } };
  const { net } = withFetch(() => reply(JSON.stringify(body)));
  assert.deepEqual(plain(await net.fetchJson(BASE)).error, { type: "arcgis", message: "Invalid Token", url: BASE, code: 498, arcgis: body.error });
});

test("bare NaN outside strings becomes null, and NaN inside strings is kept (INJ-12)", async () => {
  const { net } = withFetch(() => reply("{\"a\":NaN,\"b\":\"x: NaN,\",\"c\":[NaN, -NaN],\"d\":\"say \\\"NaN\\\"\"}"));
  assert.deepEqual(plain(await net.fetchJson(BASE)), { data: { a: null, b: "x: NaN,", c: [null, null], d: "say \"NaN\"" } });
  assert.equal(net.nanToNull("{\"a\":\": NaN,\"}"), "{\"a\":\": NaN,\"}");
});

test("a body that isn't JSON is an error", async () => {
  const { net } = withFetch(() => reply("<html><body>Login</body></html>"));
  assert.equal(plain(await net.fetchJson(BASE)).error.type, "parse");
});

test("a network failure, a timeout and an abort are errors", async () => {
  const failing = withFetch(() => Promise.reject(new TypeError("Failed to fetch")));
  assert.equal(plain(await failing.net.fetchJson(BASE)).error.type, "network");

  const hanging = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  const slow = withFetch(hanging);
  // Node unrefs AbortSignal.timeout's timer, so hold the event loop open until it fires.
  const keepAlive = setTimeout(() => {}, 5000);
  assert.equal(plain(await slow.net.fetchJson(BASE, { timeoutMs: 20 })).error.type, "timeout");
  clearTimeout(keepAlive);

  const controller = new AbortController();
  const pending = slow.net.fetchJson(BASE, { signal: controller.signal });
  controller.abort();
  assert.equal(plain(await pending).error.type, "aborted");
});

test("credentials and referrerPolicy overrides are passed through", async () => {
  const { calls, net } = withFetch();
  await net.fetchJson(BASE, { credentials: "omit", referrerPolicy: "no-referrer" });
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(calls[0].init.referrerPolicy, "no-referrer");
});

test("a URL that can't be built is an error, and nothing is sent", async () => {
  const { calls, net } = withFetch();
  assert.equal(plain(await net.fetchJson("javascript:alert(1)")).error.type, "url");
  assert.equal(calls.length, 0);
});

test("legacyResponse gives today's callers data, an ArcGIS error as { error }, or null", () => {
  const { net } = withFetch();
  assert.deepEqual(plain(net.legacyResponse({ data: { a: 1 } })), { a: 1 });
  assert.deepEqual(plain(net.legacyResponse({ error: { type: "arcgis", arcgis: { code: 400 } } })), { error: { code: 400 } });
  assert.equal(net.legacyResponse({ error: { type: "http", status: 502 } }), null);
});

test("an error never repeats a token from the URL it was given", async () => {
  const { calls, net } = withFetch();
  const { error } = plain(await net.fetchJson("ftp://gis.example.org/x?token=abc"));
  assert.equal(error.type, "url");
  assert.doesNotMatch(JSON.stringify(error), /abc/);
  assert.equal(calls.length, 0);
});

test("an answer that arrives after the extension context is gone never settles", async () => {
  const chrome = { runtime: { id: "sdt-test-extension" } };
  let answer;
  const fetch = () => new Promise((resolve) => {
    answer = resolve;
  });
  const { SDT } = loadLib({ chrome, globals: { fetch } });
  let settled = false;
  SDT.net.fetchJson(BASE, { params: { f: "json" } }).then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  chrome.runtime.id = undefined;
  answer(reply("{\"name\":\"Parcels\"}"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(settled, false);
});
