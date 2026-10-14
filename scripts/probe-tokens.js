// Probes how an ArcGIS Server, Portal or ArcGIS Online handles tokens, for the token support design
// (docs/superpowers/specs/2026-10-13-token-support-design.md, section 9). Run it by hand before each
// release, on servers you can sign in to. It isn't part of CI.
//
// It only reads: a few spaced-out requests to rest/services, rest/info, rest/self, the login form
// and the token endpoint, under 100 in all, and nothing under /admin. It never prints, logs or saves
// a token or a password. A token is recorded as its length, and a username only as whether it
// matches PROBE_USER.
//
// Settings, from the environment:
// - PROBE_BASE (required): the server root before /rest, such as https://gis.example.org/server
// - PROBE_SECURED (required): a secured service under rest/services, such as Folder/Service/MapServer
// - PROBE_USER and PROBE_PASS: sign in through a standalone server's login form
// - PROBE_MANUAL_LOGIN=1: open a browser at the server's Login link and wait while you sign in by
//   hand, for federated or SSO servers. The script never sees the password, and skips the checks
//   that need one.
// - PROBE_OUT: output path prefix (default probe-output/<host>-<time>, which git ignores)
// - HEADED=1: show the browser
//
// It writes <PROBE_OUT>.json and <PROBE_OUT>.md. Neither contains a token or a password.

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { redirectModeFor, runHeadless, sameOrigin, sameOriginHeaders } from "./lib/probe-safety.js";

// This file is an ES module, so it loads the JSON it records with createRequire.
const requireHere = createRequire(import.meta.url);

// The page.evaluate callbacks below run in the browser, where document exists.
/* global document */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE = (process.env.PROBE_BASE || "").replace(/\/+$/, "");
const SECURED = (process.env.PROBE_SECURED || "").replace(/^\/+|\/+$/g, "");
const USER = process.env.PROBE_USER || "";
const PASS = process.env.PROBE_PASS || "";
const MANUAL = process.env.PROBE_MANUAL_LOGIN === "1";
const HEADED = process.env.HEADED === "1";

if (!BASE || !SECURED) {
  console.error("PROBE_BASE and PROBE_SECURED are required. See the comment at the top of scripts/probe-tokens.js.");
  process.exit(2);
}
if (!MANUAL && (!USER || !PASS)) {
  console.error(
    "Set PROBE_USER and PROBE_PASS, or PROBE_MANUAL_LOGIN=1. See the comment at the top of scripts/probe-tokens.js.",
  );
  process.exit(2);
}

const host = new URL(BASE).host;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const OUT = process.env.PROBE_OUT || `probe-output/${host}-${stamp}`;
mkdirSync(dirname(OUT), { recursive: true });

// Secured service "leaf" name (first path segment under rest/services), used to
// decide whether a listing exposes the secured service.
const securedLeaf = SECURED.split("/")[0];
const securedPathFrag = `/rest/services/${SECURED}`;

// ---------------------------------------------------------------------------
// Secret-safe helpers
// ---------------------------------------------------------------------------

/** Record a token/secret as presence + length only; never its value. */
function tok(v) {
  return { present: typeof v === "string" && v.length > 0, length: typeof v === "string" ? v.length : 0 };
}

/** Redact any token=/password=/agstoken= value in a string before it is stored. */
function redact(s) {
  if (typeof s !== "string") return s;
  return s
    .replace(/(token=)[^&\s"']+/gi, "$1<REDACTED>")
    .replace(/(password=)[^&\s"']+/gi, "$1<REDACTED>")
    .replace(/(agstoken=)[^;,\s"']+/gi, "$1<REDACTED>")
    .replace(/("token"\s*:\s*")[^"]+/gi, "$1<REDACTED>");
}

const errorStrings = new Set();
function noteError(code, message) {
  if (message) errorStrings.add(`${code ?? ""}: ${redact(String(message))}`.trim());
}

// ---------------------------------------------------------------------------
// Request gate: throttle + count (keep the run under ~100 requests)
// ---------------------------------------------------------------------------

let requestCount = 0;
const REQUEST_BUDGET = 100;
const SPACING_MS = 700;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gate(label) {
  requestCount += 1;
  if (requestCount > REQUEST_BUDGET) {
    throw new Error(`Request budget (${REQUEST_BUDGET}) exceeded at "${label}".`);
  }
  await sleep(SPACING_MS);
}

// ---------------------------------------------------------------------------
// Node fetch helper (no browser; controls Referer/Origin, reads raw JSON)
// ---------------------------------------------------------------------------

/**
 * GET or POST to an ArcGIS endpoint from Node.
 * opts: { method, params (object -> form/query), referer, token, tokenMode
 *         ("body"|"query"|"none"), redirect }
 * A request that carries a token or a password never follows a redirect (probe-safety.js).
 * Returns { ok, status, json, error:{code,message}, textSnippet, location }.
 */
async function arc(url, opts = {}) {
  const {
    method = "GET",
    params = {},
    referer,
    token,
    tokenMode = "none",
    redirect: requestedRedirect,
  } = opts;
  const redirect = redirectModeFor({ token, params, redirect: requestedRedirect });
  await gate(url);

  const headers = {};
  if (referer) headers["Referer"] = referer;

  const allParams = { f: "json", ...params };
  if (tokenMode === "query" && token) allParams.token = token;
  if (tokenMode === "body" && token) allParams.token = token;

  let finalUrl = url;
  let body;
  if (method === "POST") {
    const bodyParams = { ...allParams };
    if (tokenMode === "query") delete bodyParams.token; // query token stays in URL
    body = new URLSearchParams(bodyParams);
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    if (tokenMode === "query" && token) {
      const u = new URL(url);
      u.searchParams.set("token", token);
      finalUrl = u.toString();
    }
  } else {
    const u = new URL(url);
    for (const [k, v] of Object.entries(allParams)) u.searchParams.set(k, v);
    finalUrl = u.toString();
  }

  const res = await fetch(finalUrl, { method, headers, body, redirect });
  const status = res.status;
  const location = res.headers.get("location");
  const text = await res.text();
  let json = null;
  let error = null;
  try {
    json = JSON.parse(text);
    if (json && json.error) {
      error = { code: json.error.code ?? null, message: json.error.message ?? null };
      noteError(error.code, error.message);
    }
  } catch {
    // non-JSON (HTML) response
  }
  return {
    ok: res.ok,
    status,
    location: redact(location),
    json,
    error,
    textSnippet: json ? null : redact(text.slice(0, 200)),
  };
}

/** Does a parsed listing JSON expose the secured leaf service? */
function listingHasSecured(json) {
  if (!json) return null;
  const services = Array.isArray(json.services) ? json.services : [];
  const folders = Array.isArray(json.folders) ? json.folders : [];
  const inServices = services.some(
    (s) => s && typeof s.name === "string" && s.name.split("/").pop() === securedLeaf,
  );
  const inFolders = folders.includes(securedLeaf);
  return { inServices, inFolders, exposed: inServices || inFolders };
}

// ---------------------------------------------------------------------------
// Results scaffold
// ---------------------------------------------------------------------------

const results = {
  meta: {
    base: BASE,
    host,
    securedPath: SECURED,
    mode: MANUAL ? "manual-login" : "auto-login",
    startedAt: new Date().toISOString(),
    playwrightVersion: requireHere("playwright/package.json").version,
    notes: [],
  },
  q1_restInfo: {},
  q2_anonymous: {},
  q3_login: {},
  q4_signedIn: {},
  q5_portability: {},
  q6_cookieVsToken: {},
  q7_generateToken: {},
  q8_authHeaderNav: {},
  q9_queryParamNav: {},
  q10_redirect: {},
  q11_errorStrings: [],
};

function skip(section, why) {
  results[section].skipped = why;
}

async function waitForEnter(promptText) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(promptText, () => {
      rl.close();
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  // --- Q1: rest/info ------------------------------------------------------
  try {
    const r = await arc(`${BASE}/rest/info`, { params: { f: "json" } });
    const auth = (r.json && r.json.authInfo) || {};
    results.q1_restInfo = {
      status: r.status,
      currentVersion: r.json?.currentVersion ?? null,
      fullVersion: r.json?.fullVersion ?? null,
      isTokenBasedSecurity: auth.isTokenBasedSecurity ?? null,
      tokenServicesUrlPresent: !!auth.tokenServicesUrl,
      tokenServicesUrl: auth.tokenServicesUrl ?? null, // a URL, not a secret
      shortLivedTokenValidity: auth.shortLivedTokenValidity ?? null,
      owningSystemUrlPresent: !!r.json?.owningSystemUrl,
      owningSystemUrl: r.json?.owningSystemUrl ?? null,
      error: r.error,
    };
  } catch (e) {
    results.q1_restInfo = { failed: redact(String(e.message)) };
  }

  const tokenServicesUrl = results.q1_restInfo.tokenServicesUrl;
  const owningSystemUrl = results.q1_restInfo.owningSystemUrl;
  const isFederated = !!owningSystemUrl;

  // --- Q2: anonymous baseline --------------------------------------------
  try {
    const rootJson = await arc(`${BASE}/rest/services`, { params: { f: "json" } });
    const rootHtmlRes = await (async () => {
      await gate(`${BASE}/rest/services (html)`);
      const res = await fetch(`${BASE}/rest/services`);
      const text = await res.text();
      return { status: res.status, hasSecuredLink: text.includes(securedPathFrag) };
    })();
    const securedJson = await arc(`${BASE}/${securedPathFrag.replace(/^\//, "")}`, {
      params: { f: "json" },
    });
    const securedHtml = await (async () => {
      await gate(`${BASE}${securedPathFrag} (html)`);
      const res = await fetch(`${BASE}${securedPathFrag}`, { redirect: "manual" });
      return { status: res.status, location: redact(res.headers.get("location")) };
    })();

    results.q2_anonymous = {
      rootJson: {
        status: rootJson.status,
        securedExposed: listingHasSecured(rootJson.json),
        error: rootJson.error,
      },
      rootHtml: rootHtmlRes,
      securedServiceJson: {
        status: securedJson.status,
        error: securedJson.error,
      },
      securedServiceHtml: securedHtml,
    };
  } catch (e) {
    results.q2_anonymous = { failed: redact(String(e.message)) };
  }

  // --- Browser: login, cookie attrs, signed-in fetches -------------------
  const browser = await chromium.launch({ channel: "chromium", headless: runHeadless({ headed: HEADED, manual: MANUAL }) });
  let agstoken = null; // held in memory only; never logged

  try {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: false });
    const page = await ctx.newPage();

    // --- Q3: login through the Services Directory ------------------------
    try {
      if (MANUAL) {
        // Headed: open the Login link / portal and wait for the agstoken cookie.
        await gate("open Login (manual)");
        await page.goto(`${BASE}/rest/login`, { waitUntil: "domcontentloaded" }).catch(() => {});
        console.log(
          "\n[manual] Sign in by hand in the opened browser window.\n" +
            "         Waiting for an 'agstoken' cookie, or press Enter here to continue.\n",
        );
        const enterPromise = waitForEnter("Press Enter when signed in (or to give up): ");
        let found = false;
        const deadline = Date.now() + 5 * 60 * 1000;
        while (Date.now() < deadline && !found) {
          const cookies = await ctx.cookies();
          if (cookies.some((c) => c.name === "agstoken" && c.value)) {
            found = true;
            break;
          }
          const raced = await Promise.race([sleep(1500).then(() => "tick"), enterPromise.then(() => "enter")]);
          if (raced === "enter") break;
        }
        results.q3_login.mode = "manual";
        results.q3_login.loggedIn = found;
      } else if (isFederated) {
        // Federated: follow the Login link, which goes through the portal.
        await gate("federated Login link");
        await page.goto(`${BASE}/rest/login`, { waitUntil: "domcontentloaded" });
        // The standalone form may still be shown; try portal OAuth username/password.
        // Fill whatever username/password fields are present on the resulting page.
        await page.waitForTimeout(1000);
        const filled = await page.evaluate(() => {
          const u = document.querySelector("input[name=\"username\"], #username, input[type=\"text\"]");
          const p = document.querySelector("input[name=\"password\"], #password, input[type=\"password\"]");
          return { u: !!u, p: !!p };
        });
        if (filled.u && filled.p) {
          await page.fill("input[name=\"username\"], #username, input[type=\"text\"]", USER).catch(() => {});
          await page.fill("input[name=\"password\"], #password, input[type=\"password\"]", PASS).catch(() => {});
          await Promise.all([
            page.waitForLoadState("domcontentloaded").catch(() => {}),
            page.click("input[type=\"submit\"], button[type=\"submit\"], button").catch(() => {}),
          ]);
          await page.waitForTimeout(1500);
        }
        const cookies = await ctx.cookies();
        results.q3_login.mode = "federated-auto";
        results.q3_login.loggedIn = cookies.some((c) => c.name === "agstoken" && c.value);
      } else {
        // Standalone: the rest/login form (page JS RSA-encrypts the password).
        await gate("standalone rest/login");
        await page.goto(`${BASE}/rest/login`, { waitUntil: "domcontentloaded" });
        await page.fill("#username", USER);
        await page.fill("#password", PASS);
        await Promise.all([
          page.waitForLoadState("domcontentloaded").catch(() => {}),
          page.click("input[type=\"submit\"]"),
        ]);
        await page.waitForTimeout(1200);
        const cookies = await ctx.cookies();
        results.q3_login.mode = "standalone-auto";
        results.q3_login.loggedIn = cookies.some((c) => c.name === "agstoken" && c.value);
      }

      // Record agstoken cookie attributes (value held only in memory).
      const cookies = await ctx.cookies();
      const ags = cookies.find((c) => c.name === "agstoken" && c.value);
      if (ags) {
        agstoken = ags.value; // never logged
        results.q3_login.agstokenCookie = {
          present: true,
          token: tok(ags.value),
          httpOnly: ags.httpOnly,
          secure: ags.secure,
          sameSite: ags.sameSite,
          path: ags.path,
          domain: ags.domain,
          session: ags.expires === -1,
          expires: ags.expires === -1 ? "session" : new Date(ags.expires * 1000).toISOString(),
        };
      } else {
        results.q3_login.agstokenCookie = { present: false };
      }

      // Does document.cookie on a rest/services page include agstoken?
      await gate("document.cookie check");
      await page.goto(`${BASE}/rest/services`, { waitUntil: "domcontentloaded" }).catch(() => {});
      const docCookieHasAgstoken = await page.evaluate(() => /(^|;\s*)agstoken=/.test(document.cookie));
      results.q3_login.documentCookieHasAgstoken = docCookieHasAgstoken;
    } catch (e) {
      results.q3_login.failed = redact(String(e.message));
    }

    // --- Q4: signed-in, same-origin fetch from the page ------------------
    try {
      if (agstoken || results.q3_login.loggedIn) {
        await gate("page rest/self");
        const self = await page.evaluate(async (base) => {
          const r = await fetch(`${base}/rest/self?f=json`, { credentials: "include" });
          const t = await r.text();
          try { return { status: r.status, json: JSON.parse(t) }; }
          catch { return { status: r.status, json: null }; }
        }, BASE);
        const user = self.json?.user || null;
        results.q4_signedIn.restSelf = {
          status: self.status,
          userFields: user ? Object.keys(user) : [],
          usernameMatchesProbeUser: user && user.username ? (user.username === USER) : null,
          role: user?.role ?? null,
          error: self.json?.error ?? null,
        };
        if (self.json?.error) noteError(self.json.error.code, self.json.error.message);

        await gate("page root listing (signed in)");
        const listing = await page.evaluate(async (base) => {
          const r = await fetch(`${base}/rest/services?f=json`, { credentials: "include" });
          const t = await r.text();
          try { return { status: r.status, json: JSON.parse(t) }; }
          catch { return { status: r.status, json: null }; }
        }, BASE);
        results.q4_signedIn.rootListing = {
          status: listing.status,
          securedExposed: listingHasSecured(listing.json),
        };
      } else {
        skip("q4_signedIn", "not logged in");
      }
    } catch (e) {
      results.q4_signedIn.failed = redact(String(e.message));
    }

    // --- Q6: X2 cookie vs token (signed-in page POST) --------------------
    try {
      if (agstoken || results.q3_login.loggedIn) {
        await gate("page rest/self token=bogus");
        const bogus = await page.evaluate(async (base) => {
          const r = await fetch(`${base}/rest/self?f=json`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "token=bogus",
          });
          const t = await r.text();
          try { return { status: r.status, json: JSON.parse(t) }; }
          catch { return { status: r.status, json: null }; }
        }, BASE);
        await gate("page rest/self token= (empty)");
        const empty = await page.evaluate(async (base) => {
          const r = await fetch(`${base}/rest/self?f=json`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "token=",
          });
          const t = await r.text();
          try { return { status: r.status, json: JSON.parse(t) }; }
          catch { return { status: r.status, json: null }; }
        }, BASE);
        const interp = (o) => {
          const u = o.json?.user;
          if (o.json?.error) { noteError(o.json.error.code, o.json.error.message); return { error: o.json.error }; }
          return {
            hasUser: !!(u && u.username),
            usernameMatchesProbeUser: u && u.username ? (u.username === USER) : null,
          };
        };
        results.q6_cookieVsToken = {
          bogusToken: { status: bogus.status, ...interp(bogus) },
          emptyToken: { status: empty.status, ...interp(empty) },
          interpretation:
            "If user is still returned with a bad/empty token, the cookie wins over the body token.",
        };
      } else {
        skip("q6_cookieVsToken", "not logged in");
      }
    } catch (e) {
      results.q6_cookieVsToken.failed = redact(String(e.message));
    }

    // --- Q7: generate tokens via tokenServicesUrl ------------------------
    let requestipToken = null;
    let refererToken = null;
    if (MANUAL) {
      skip("q7_generateToken", "manual mode: no password available for generateToken");
    } else if (!tokenServicesUrl) {
      skip("q7_generateToken", "no tokenServicesUrl in rest/info");
    } else if (isFederated) {
      skip(
        "q7_generateToken",
        "federated/AGOL: tokenServicesUrl points at the portal; standalone generateToken not applicable",
      );
    } else if (!sameOrigin(tokenServicesUrl, BASE)) {
      // The server chooses tokenServicesUrl, so the password goes only to PROBE_BASE's own origin.
      skip("q7_generateToken", "tokenServicesUrl is not on PROBE_BASE's origin; the probe sends a password only there");
    } else {
      try {
        const genUrl = tokenServicesUrl.replace(/\/+$/, "") + "/generateToken";
        // client=requestip
        const ipRes = await arc(genUrl, {
          method: "POST",
          params: { username: USER, password: PASS, client: "requestip", f: "json", expiration: "60" },
        });
        requestipToken = ipRes.json?.token || null;
        // client=referer
        const refRes = await arc(genUrl, {
          method: "POST",
          params: { username: USER, password: PASS, client: "referer", referer: BASE, f: "json", expiration: "60" },
        });
        refererToken = refRes.json?.token || null;

        results.q7_generateToken = {
          requestip: {
            status: ipRes.status,
            token: tok(requestipToken),
            expiresReturned: ipRes.json?.expires != null,
            error: ipRes.error,
          },
          referer: {
            status: refRes.status,
            token: tok(refererToken),
            expiresReturned: refRes.json?.expires != null,
            error: refRes.error,
          },
        };

        // referer token against rest/self from Node, 3 Referer variants.
        if (refererToken) {
          const noRef = await arc(`${BASE}/rest/self`, { method: "POST", token: refererToken, tokenMode: "body" });
          const rightRef = await arc(`${BASE}/rest/self`, {
            method: "POST", token: refererToken, tokenMode: "body", referer: BASE,
          });
          const wrongRef = await arc(`${BASE}/rest/self`, {
            method: "POST", token: refererToken, tokenMode: "body", referer: "https://wrong.example.org",
          });
          const sum = (r) => ({
            status: r.status,
            hasUser: !!(r.json?.user && r.json.user.username),
            usernameMatchesProbeUser: r.json?.user?.username ? (r.json.user.username === USER) : null,
            error: r.error,
          });
          results.q7_generateToken.refererTokenOnRestSelf = {
            noReferer: sum(noRef),
            rightReferer: sum(rightRef),
            wrongReferer: sum(wrongRef),
          };
        }
      } catch (e) {
        results.q7_generateToken.failed = redact(String(e.message));
      }
    }

    // --- Q5: X1 portability from Node, no cookie -------------------------
    // Prefer a generated requestip token; fall back to the agstoken value.
    try {
      const portToken = requestipToken || agstoken;
      const which = requestipToken ? "generated-requestip" : (agstoken ? "agstoken-cookie-value" : null);
      if (!portToken) {
        skip("q5_portability", "no token available (manual mode without agstoken)");
      } else {
        const selfUrl = `${BASE}/rest/self`;
        const securedUrl = `${BASE}${securedPathFrag}`;
        const sum = (r) => ({
          status: r.status,
          hasUser: !!(r.json?.user && r.json.user.username),
          hasService: !!(r.json && (r.json.serviceDescription !== undefined || r.json.mapName !== undefined || r.json.layers !== undefined || r.json.currentVersion !== undefined) && !r.json.error),
          error: r.error,
        });
        // (a) body token, no Referer
        const selfBodyNoRef = await arc(selfUrl, { method: "POST", token: portToken, tokenMode: "body" });
        const securedBodyNoRef = await arc(securedUrl, { method: "POST", token: portToken, tokenMode: "body" });
        // (b) body token, Referer = base/rest/services
        const ref = `${BASE}/rest/services`;
        const selfBodyRef = await arc(selfUrl, { method: "POST", token: portToken, tokenMode: "body", referer: ref });
        const securedBodyRef = await arc(securedUrl, { method: "POST", token: portToken, tokenMode: "body", referer: ref });
        // token as a query parameter (GET)
        const selfQuery = await arc(selfUrl, { method: "GET", token: portToken, tokenMode: "query" });
        const securedQuery = await arc(securedUrl, { method: "GET", token: portToken, tokenMode: "query" });

        results.q5_portability = {
          tokenUsed: which,
          bodyToken_noReferer: { restSelf: sum(selfBodyNoRef), securedService: sum(securedBodyNoRef) },
          bodyToken_withReferer: { restSelf: sum(selfBodyRef), securedService: sum(securedBodyRef) },
          queryToken: { restSelf: sum(selfQuery), securedService: sum(securedQuery) },
        };
      }
    } catch (e) {
      results.q5_portability.failed = redact(String(e.message));
    }

    // --- Q8: X3/X5 X-Esri-Authorization on navigation --------------------
    try {
      const hdrToken = requestipToken || agstoken;
      if (!hdrToken) {
        skip("q8_authHeaderNav", "no token available for the auth header");
      } else {
        // Valid header token
        // The header goes only to PROBE_BASE's origin, and never through a redirect (probe-safety.js).
        const ctx2 = await browser.newContext();
        await ctx2.route("**/*", sameOriginHeaders(BASE, { "x-esri-authorization": `Bearer ${hdrToken}` }));
        const p2 = await ctx2.newPage();
        await gate("auth-header root listing");
        const rootResp = await p2.goto(`${BASE}/rest/services`, { waitUntil: "domcontentloaded" }).catch(() => null);
        const rootSecuredListed = await p2.evaluate((frag) =>
          Array.from(document.querySelectorAll("a[href]")).some((a) => a.getAttribute("href").includes(frag)),
        securedPathFrag).catch(() => null);
        await gate("auth-header secured service");
        const secResp = await p2.goto(`${BASE}${securedPathFrag}`, { waitUntil: "domcontentloaded" }).catch(() => null);
        const secUrlAfter = p2.url();
        const secRendered = !/\/rest\/login/.test(secUrlAfter);
        await ctx2.close();

        // Invalid header token (navigate so the header is sent, then read the body)
        const ctx3 = await browser.newContext();
        await ctx3.route("**/*", sameOriginHeaders(BASE, { "x-esri-authorization": "Bearer bogus" }));
        const p3 = await ctx3.newPage();
        await gate("auth-header(invalid) secured json");
        const invResp = await p3.goto(`${BASE}${securedPathFrag}?f=json`, { waitUntil: "domcontentloaded" }).catch(() => null);
        let invJson = { status: invResp ? invResp.status() : null, json: null };
        if (invResp) {
          try { invJson.json = JSON.parse(await invResp.text()); } catch { /* not JSON: json stays null */ }
        }
        if (invJson.json?.error) noteError(invJson.json.error.code, invJson.json.error.message);
        await ctx3.close();

        results.q8_authHeaderNav = {
          tokenUsed: requestipToken ? "generated-requestip" : "agstoken-cookie-value",
          validHeader: {
            rootStatus: rootResp ? rootResp.status() : null,
            rootSecuredListed,
            securedStatus: secResp ? secResp.status() : null,
            securedUrlAfter: redact(secUrlAfter),
            securedRendered: secRendered,
          },
          invalidHeader: {
            securedJsonStatus: invJson.status,
            errorCode: invJson.json?.error?.code ?? null,
            note: "Expect the server to treat an invalid header token as anonymous (499/Token Required), not 498.",
          },
        };
      }
    } catch (e) {
      results.q8_authHeaderNav.failed = redact(String(e.message));
    }

    // --- Q9: X4 ?token= in the URL on navigation -------------------------
    try {
      const urlToken = requestipToken || agstoken;
      if (!urlToken) {
        skip("q9_queryParamNav", "no token available for the ?token= URL");
      } else {
        const ctx4 = await browser.newContext();
        const p4 = await ctx4.newPage();
        await gate("?token= root listing");
        const u = new URL(`${BASE}/rest/services`);
        u.searchParams.set("token", urlToken);
        const resp = await p4.goto(u.toString(), { waitUntil: "domcontentloaded" }).catch(() => null);
        const info = await p4.evaluate((frag) => {
          const anchors = Array.from(document.querySelectorAll("a[href]"));
          const securedListed = anchors.some((a) => a.getAttribute("href").includes(frag));
          const withToken = anchors.filter((a) => /[?&]token=/.test(a.getAttribute("href"))).length;
          return { securedListed, linksWithToken: withToken, totalLinks: anchors.length };
        }, securedPathFrag).catch(() => null);
        // Click through to the secured service (navigate directly with token).
        await gate("?token= secured service");
        const su = new URL(`${BASE}${securedPathFrag}`);
        su.searchParams.set("token", urlToken);
        const secResp = await p4.goto(su.toString(), { waitUntil: "domcontentloaded" }).catch(() => null);
        const secRendered = !/\/rest\/login/.test(p4.url());
        await ctx4.close();

        results.q9_queryParamNav = {
          tokenUsed: requestipToken ? "generated-requestip" : "agstoken-cookie-value",
          rootStatus: resp ? resp.status() : null,
          securedListed: info?.securedListed ?? null,
          linksCarryingToken: info?.linksWithToken ?? null,
          totalLinks: info?.totalLinks ?? null,
          securedStatus: secResp ? secResp.status() : null,
          securedRendered: secRendered,
        };
      }
    } catch (e) {
      results.q9_queryParamNav.failed = redact(String(e.message));
    }

    await ctx.close();
  } finally {
    await browser.close();
  }

  // --- Q10: redirect keeps query? (http:// form, no follow) --------------
  try {
    const httpBase = BASE.replace(/^https:/, "http:");
    await gate("http redirect check");
    const res = await fetch(`${httpBase}/rest/services?f=json&token=bogus`, { redirect: "manual" });
    const loc = res.headers.get("location");
    results.q10_redirect = {
      status: res.status,
      location: redact(loc),
      keepsQuery: loc ? /[?&]f=json/.test(loc) || /[?&]token=/.test(loc) : false,
      note: "Checks whether an http->https (or login) redirect preserves the query string (incl. token).",
    };
  } catch (e) {
    results.q10_redirect = { failed: redact(String(e.message)) };
  }

  // --- Q11: error strings collected --------------------------------------
  results.q11_errorStrings = Array.from(errorStrings).sort();

  results.meta.finishedAt = new Date().toISOString();
  results.meta.requestCount = requestCount;

  // ---------------------------------------------------------------------------
  // Write outputs
  // ---------------------------------------------------------------------------
  writeFileSync(`${OUT}.json`, JSON.stringify(results, null, 2));
  writeFileSync(`${OUT}.md`, renderMarkdown(results));
  console.log(`\nWrote ${OUT}.json and ${OUT}.md`);
  console.log(`Requests made: ${requestCount} (budget ${REQUEST_BUDGET}).`);
})().catch((e) => {
  console.error("Probe failed:", redact(String(e.stack || e.message)));
  // Still try to persist partial results.
  try {
    results.meta.aborted = redact(String(e.message));
    results.q11_errorStrings = Array.from(errorStrings).sort();
    writeFileSync(`${OUT}.json`, JSON.stringify(results, null, 2));
    writeFileSync(`${OUT}.md`, renderMarkdown(results));
    console.error(`Partial results written to ${OUT}.json / .md`);
  } catch { /* the partial results couldn't be written either; exit anyway */ }
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function renderMarkdown(r) {
  const j = (v) => "```json\n" + JSON.stringify(v, null, 2) + "\n```";
  return `# ArcGIS token probe results

- Server: \`${r.meta.base}\` (host \`${r.meta.host}\`)
- Secured service: \`${r.meta.securedPath}\`
- Mode: ${r.meta.mode}
- Playwright: ${r.meta.playwrightVersion}
- Started: ${r.meta.startedAt} / Finished: ${r.meta.finishedAt ?? "n/a"}
- Requests made: ${r.meta.requestCount ?? "n/a"}
${r.meta.aborted ? `- ABORTED: ${r.meta.aborted}` : ""}

No token value or password appears in this file: tokens are recorded as \`{present, length}\`, usernames as a boolean match against PROBE_USER.

## Q1. rest/info
${j(r.q1_restInfo)}

## Q2. Anonymous baseline
${j(r.q2_anonymous)}

## Q3. Login + agstoken cookie attributes
${j(r.q3_login)}

## Q4. Signed in (same-origin fetch from the page)
${j(r.q4_signedIn)}

## Q5. X1 portability (Node, no cookie)
${j(r.q5_portability)}

## Q6. X2 cookie vs body token (signed-in page)
${j(r.q6_cookieVsToken)}

## Q7. generateToken (requestip / referer)
${j(r.q7_generateToken)}

## Q8. X3/X5 X-Esri-Authorization header on navigation
${j(r.q8_authHeaderNav)}

## Q9. X4 ?token= in the URL on navigation
${j(r.q9_queryParamNav)}

## Q10. Redirect keeps query string?
${j(r.q10_redirect)}

## Q11. Error message variants seen (exact strings, redacted of any token)
${j(r.q11_errorStrings)}
`;
}
