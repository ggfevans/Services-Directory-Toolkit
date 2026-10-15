import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loginFormSafe, originOf, redirectModeFor, runHeadless, sameOrigin, sameOriginHeaders, urlTokenStaysHome } from "../../scripts/lib/probe-safety.js";

const PROBE = new URL("../../scripts/probe-tokens.js", import.meta.url);

test("credentials go only to the origin of the server under test", () => {
  const base = "https://gis.example.org/server";
  assert.equal(sameOrigin("https://gis.example.org/server/tokens/", base), true);
  assert.equal(sameOrigin("https://portal.example.org/sharing/rest/generateToken", base), false);
  assert.equal(sameOrigin("http://gis.example.org/server/tokens/", base), false);
  assert.equal(sameOrigin("https://gis.example.org:6443/arcgis/tokens/", base), false);
  assert.equal(sameOrigin("not a url", base), false);
});

test("a login form gets the password only when the page and its action are on the server's origin", () => {
  const base = "https://gis.example.org/server";
  const own = "https://gis.example.org/server/rest/login";
  assert.equal(loginFormSafe({ pageUrl: own, formAction: own }, base), true);
  // Redirected to a portal or an identity provider
  assert.equal(loginFormSafe({ pageUrl: "https://portal.example.org/sharing/oauth2/signin", formAction: "https://portal.example.org/sharing/oauth2/signin" }, base), false);
  // On the server, but the form posts elsewhere
  assert.equal(loginFormSafe({ pageUrl: own, formAction: "https://idp.example.com/login" }, base), false);
  // Elsewhere, but the form posts to the server
  assert.equal(loginFormSafe({ pageUrl: "https://idp.example.com/login", formAction: own }, base), false);
  // A password field outside any form
  assert.equal(loginFormSafe({ pageUrl: own, formAction: null }, base), false);
  assert.equal(originOf("https://idp.example.com/login?x=1"), "https://idp.example.com");
  assert.equal(originOf(null), "no address");
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
    },
    abort: async () => {
      calls.push(["abort"]);
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

test("a ?token= URL stays on the server under test, even through a redirect", async () => {
  const handler = urlTokenStaysHome("https://gis.example.org/server");
  const own = fakeRoute("https://gis.example.org/server/rest/services?token=t");
  await handler(own);
  assert.deepEqual(own.calls, [["continue", undefined]]);
  // A federated server's redirect to its portal that keeps the query string
  const portal = fakeRoute("https://portal.example.org/sharing/rest/oauth2/authorize?token=t&f=json");
  await handler(portal);
  assert.deepEqual(portal.calls, [["abort"]]);
  // An http:// redirect on the same host is another origin
  const http = fakeRoute("http://gis.example.org/server/rest/services?f=json&TOKEN=t");
  await handler(http);
  assert.deepEqual(http.calls, [["abort"]]);
  // Requests to other origins without a token go out unchanged
  const css = fakeRoute("https://js.arcgis.com/4.30/esri/themes/light/main.css");
  await handler(css);
  assert.deepEqual(css.calls, [["continue", undefined]]);
});

test("the probe applies these rules", () => {
  const source = readFileSync(PROBE, "utf8");
  assert.equal(source.includes("setExtraHTTPHeaders"), false);
  assert.match(source, /headless: runHeadless\(\{ headed: HEADED, manual: MANUAL \}\)/);
  assert.match(source, /!sameOrigin\(tokenServicesUrl, BASE\)/);
  assert.match(source, /if \(!loginFormSafe\(\{ pageUrl, formAction: target\.formAction \}, BASE\)\) \{/);
  assert.match(source, /const pageUrl = page\.url\(\);/);
  assert.equal(source.match(/page\.fill\([^)]*PASS\)/g).length, 1, "the password is filled in one place, signIn");
  assert.match(source, /redirectModeFor\(\{ token, params, redirect: requestedRedirect \}\)/);
  assert.match(source, /sameOriginHeaders\(BASE, \{ "x-esri-authorization": `Bearer \$\{hdrToken\}` \}\)/);
  assert.match(source, /await ctx4\.route\("\*\*\/\*", urlTokenStaysHome\(BASE\)\);\n\s+const p4 = await ctx4\.newPage\(\);/);
});
