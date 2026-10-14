import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { redirectModeFor, runHeadless, sameOrigin, sameOriginHeaders } from "../../scripts/lib/probe-safety.js";

const PROBE = new URL("../../scripts/probe-tokens.js", import.meta.url);

test("credentials go only to the origin of the server under test", () => {
  const base = "https://gis.example.org/server";
  assert.equal(sameOrigin("https://gis.example.org/server/tokens/", base), true);
  assert.equal(sameOrigin("https://portal.example.org/sharing/rest/generateToken", base), false);
  assert.equal(sameOrigin("http://gis.example.org/server/tokens/", base), false);
  assert.equal(sameOrigin("https://gis.example.org:6443/arcgis/tokens/", base), false);
  assert.equal(sameOrigin("not a url", base), false);
});

test("a request carrying a token or a password never follows a redirect", () => {
  assert.equal(redirectModeFor({ token: "t" }), "manual");
  assert.equal(redirectModeFor({ params: { username: "u", password: "p" } }), "manual");
  assert.equal(redirectModeFor({ token: "t", redirect: "follow" }), "manual");
  assert.equal(redirectModeFor({ params: { f: "json" } }), "follow");
  assert.equal(redirectModeFor({ redirect: "manual" }), "manual");
});

test("manual sign-in always shows the browser", () => {
  assert.equal(runHeadless({ headed: false, manual: true }), false);
  assert.equal(runHeadless({ headed: true, manual: false }), false);
  assert.equal(runHeadless({ headed: false, manual: false }), true);
});

// A stand-in for a Playwright Route that records what the handler did with it.
const fakeRoute = (url, headers = {}) => {
  const calls = [];
  return {
    calls,
    request: () => ({ url: () => url, headers: () => headers }),
    continue: async (options) => {
      calls.push(["continue", options]);
    },
    fetch: async (options) => {
      calls.push(["fetch", options]);
      return { status: 302 };
    },
    fulfill: async (options) => {
      calls.push(["fulfill", options]);
    }
  };
};

test("the auth header goes only to the server under test, and never through a redirect", async () => {
  const handler = sameOriginHeaders("https://gis.example.org/server", { "x-esri-authorization": "Bearer t" });
  const own = fakeRoute("https://gis.example.org/server/rest/services", { accept: "text/html" });
  await handler(own);
  assert.deepEqual(own.calls, [
    ["fetch", { headers: { accept: "text/html", "x-esri-authorization": "Bearer t" }, maxRedirects: 0 }],
    ["fulfill", { response: { status: 302 } }]
  ]);
  const other = fakeRoute("https://idp.example.com/login");
  await handler(other);
  assert.deepEqual(other.calls, [["continue", undefined]]);
});

test("the probe applies these rules", () => {
  const source = readFileSync(PROBE, "utf8");
  assert.equal(source.includes("setExtraHTTPHeaders"), false);
  assert.match(source, /headless: runHeadless\(\{ headed: HEADED, manual: MANUAL \}\)/);
  assert.match(source, /!sameOrigin\(tokenServicesUrl, BASE\)/);
  assert.match(source, /redirectModeFor\(\{ token, params, redirect: requestedRedirect \}\)/);
  assert.match(source, /sameOriginHeaders\(BASE, \{ "x-esri-authorization": `Bearer \$\{hdrToken\}` \}\)/);
});
