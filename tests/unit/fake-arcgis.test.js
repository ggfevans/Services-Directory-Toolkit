import { test } from "node:test";
import assert from "node:assert/strict";
import {
  arcgisError, createFakeArcGIS, FAKE_ORIGIN, HOST_STYLES, html, json, ONLINE_ORG, ONLINE_ORIGIN, ONLINE_REST_PATH, ONLINE_TOKENS,
  PORTAL_ORIGIN, SERVER_TOKENS, whereMatcher
} from "../fixtures/fake-arcgis.js";
import { createPages, loginPage, messagePage, tokensPage } from "../fixtures/pages.js";

// A stand-in for a Playwright Request. headers() returns what allHeaders() would, cookies included.
const request = (path, { method = "GET", body, cookie, origin = FAKE_ORIGIN, headers = {} } = {}) => ({
  url: () => `${origin}${path}`,
  method: () => method,
  headers: () => ({
    ...(body === undefined ? {} : { "content-type": "application/x-www-form-urlencoded" }),
    ...(cookie === undefined ? {} : { cookie }),
    ...headers
  }),
  postData: () => body ?? null
});

const get = (server, path) => server.respond(request(path));
const getJson = (server, path) => JSON.parse(get(server, path).body);

test("the root lists its folders and top-level services", () => {
  const root = getJson(createFakeArcGIS(), "/arcgis/rest/services?f=json");
  assert.deepEqual(root.folders, ["Transport", "Utilities"]);
  assert.deepEqual(root.services, [
    { name: "Parcels", type: "MapServer" },
    { name: "Parcels", type: "FeatureServer" },
    { name: "Elevation", type: "ImageServer" }
  ]);
});

test("a folder lists its services with folder-qualified names", () => {
  const folder = getJson(createFakeArcGIS(), "/arcgis/rest/services/Transport?f=json");
  assert.deepEqual(folder, {
    currentVersion: 11.3,
    folders: [],
    services: [{ name: "Transport/Roads", type: "MapServer" }, { name: "Transport/RouteTools", type: "GPServer" }]
  });
});

test("service and layer JSON leave out fixture-only data", () => {
  const server = createFakeArcGIS();
  const service = get(server, "/arcgis/rest/services/Parcels/MapServer?f=json");
  const layer = get(server, "/arcgis/rest/services/Parcels/MapServer/0?f=json");
  assert.equal(service.contentType, "application/json; charset=utf-8");
  assert.deepEqual(JSON.parse(service.body).layers.map((l) => l.name), ["Parcels", "Addresses"]);
  assert.equal(service.body.includes("_rows") || layer.body.includes("_rows"), false);
  assert.equal(JSON.parse(layer.body).fields.length, 6);
});

test("f=pjson is served as plain text, as ArcGIS Server does", () => {
  const response = get(createFakeArcGIS(), "/arcgis/rest/services/Parcels/MapServer/0?f=pjson");
  assert.equal(response.contentType, "text/plain; charset=utf-8");
  assert.equal(JSON.parse(response.body).name, "Parcels");
});

test("a layer page lists one Fields: item per field", () => {
  const html = get(createFakeArcGIS(), "/arcgis/rest/services/Parcels/MapServer/0").body;
  const fieldsList = html.split("<b>Fields: </b>")[1].split("</ul>")[0];
  assert.equal(fieldsList.match(/<li>/g).length, 6);
  assert.match(fieldsList, /OWNER_NAME<i>/);
});

test("count queries evaluate the where clauses the extension sends", () => {
  const server = createFakeArcGIS();
  const count = (where) => getJson(server, `/arcgis/rest/services/Parcels/MapServer/0/query?where=${encodeURIComponent(where)}&returnCountOnly=true&f=json`).count;
  assert.equal(count("1=1"), 3);
  assert.equal(count("not OBJECTID is null"), 3);
  assert.equal(count("not SHAPE is null"), 2);
  assert.equal(count("not OWNER_NAME is null"), 2);
  assert.equal(count("not OWNER_NAME is null and OWNER_NAME <>''"), 1);
  assert.equal(count("LAND_USE = 'R'"), 2);
  assert.equal(count("OBJECTID = 2"), 1);
});

test("+ in a query string decodes to a space, as browsers send it", () => {
  const server = createFakeArcGIS();
  const body = getJson(server, "/arcgis/rest/services/Parcels/MapServer/0/query?where=not+OBJECTID+is+null&returnCountOnly=true&f=json");
  assert.deepEqual(body, { count: 3 });
});

test("distinct-value queries return each value once, in a stable order", () => {
  const server = createFakeArcGIS();
  const body = getJson(server, "/arcgis/rest/services/Parcels/MapServer/0/query?where=1%3D1&outFields=LAND_USE&orderByFields=LAND_USE&returnDistinctValues=true&f=json");
  assert.deepEqual(body.features, [{ attributes: { LAND_USE: "C" } }, { attributes: { LAND_USE: "R" } }]);
  assert.deepEqual(body.fields.map((f) => f.name), ["LAND_USE"]);
});

test("an unsupported where clause returns an ArcGIS error and is recorded as a problem", () => {
  const server = createFakeArcGIS();
  const body = getJson(server, "/arcgis/rest/services/Parcels/MapServer/0/query?where=ACRES%20%3E%201&f=json");
  assert.equal(body.error.code, 400);
  assert.equal(server.problems.length, 1);
  assert.match(server.problems[0], /ACRES > 1/);
});

test("the print task and its execute page", () => {
  const server = createFakeArcGIS();
  const task = getJson(server, "/arcgis/rest/services/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task?f=json");
  assert.deepEqual(task.parameters.map((p) => p.name), ["Web_Map_as_JSON", "Format", "Layout_Template", "Output_File"]);
  const page = get(server, "/arcgis/rest/services/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/execute").body;
  assert.match(page, /<textarea id="Web_Map_as_JSON" name="Web_Map_as_JSON"/);
  assert.equal(page.includes("name=\"Output_File\""), false);
});

test("an asynchronous task has a submitJob page and no execute page", () => {
  const server = createFakeArcGIS();
  const task = "/arcgis/rest/services/Transport/RouteTools/GPServer/Summarize%20Routes";
  const page = get(server, `${task}/submitJob`).body;
  assert.match(page, /<title>Submit Job: Summarize Routes<\/title>/);
  assert.match(page, /action="\/arcgis\/rest\/services\/Transport\/RouteTools\/GPServer\/Summarize%20Routes\/submitJob"/);
  assert.match(page, /<textarea id="Distance_Units" name="Distance_Units"/);
  assert.equal(getJson(server, `${task}/submitJob?f=json`).jobStatus, "esriJobSubmitted");
  assert.equal(get(server, `${task}/execute`), null);
  // And a synchronous task has no submitJob page.
  assert.equal(get(server, "/arcgis/rest/services/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/submitJob"), null);
});

test("a FeatureServer's queryDomains page and JSON", () => {
  const server = createFakeArcGIS();
  const page = get(server, "/arcgis/rest/services/Parcels/FeatureServer/queryDomains").body;
  assert.match(page, /<h2>Query Domains: Parcels \(FeatureServer\)<\/h2>/);
  assert.deepEqual(getJson(server, "/arcgis/rest/services/Parcels/FeatureServer/queryDomains?f=json").domains.map((domain) => domain.name), ["LandUse"]);
  assert.equal(get(server, "/arcgis/rest/services/Parcels/MapServer/queryDomains"), null);
});

test("a page outside ArcGIS Server whose path holds /rest/services", () => {
  assert.match(get(createFakeArcGIS(), "/docs/rest/services/overview").body, /not a Services Directory page/);
});

test("static assets, the non-REST page and unknown paths", () => {
  const server = createFakeArcGIS();
  assert.equal(get(server, "/arcgis/rest/static/main.css").status, 200);
  assert.equal(get(server, "/favicon.ico").status, 204);
  assert.match(get(server, "/other/page").body, /not a Services Directory/i);
  assert.equal(get(server, "/arcgis/rest/services/NoSuchService/MapServer"), null);
  assert.equal(get(server, "/arcgis/rest/services/Parcels/MapServer/9"), null);
  assert.equal(get(server, "/somewhere/else"), null);
});

test("the pages' stylesheet is light by default, and dark when the server is created with hostStyle dark", () => {
  const light = get(createFakeArcGIS(), "/arcgis/rest/static/main.css");
  assert.equal(light.contentType, "text/css; charset=utf-8");
  assert.equal(light.body, HOST_STYLES.light);
  assert.match(light.body, /^body\.dark \{ background: #16191d;/m);
  assert.match(light.body, /^body\.grey \{ background: #808080;/m);
  const dark = createFakeArcGIS(undefined, undefined, { hostStyle: "dark" });
  assert.equal(get(dark, "/arcgis/rest/static/main.css").body, HOST_STYLES.dark);
  assert.equal(dark.respond(request("/arcgis/rest/static/main.css", { origin: ONLINE_ORIGIN })).body, HOST_STYLES.dark);
  assert.match(HOST_STYLES.dark, /^body \{[^}]*background: #16191d;/m);
});

test("an unknown host style is refused when the server is created", () => {
  assert.throws(() => createFakeArcGIS(undefined, undefined, { hostStyle: "sepia" }), /unknown host style sepia/);
});

test("overrides take precedence, and every request is recorded", () => {
  const server = createFakeArcGIS();
  server.override(/\/Transport\?f=json$/, () => ({ status: 502, contentType: "text/html", body: "Bad Gateway" }));
  assert.equal(get(server, "/arcgis/rest/services/Transport?f=json").status, 502);
  assert.deepEqual(server.requests, ["GET /arcgis/rest/services/Transport?f=json"]);
});

test("an override pattern with the g or y flag is refused, because test() would then skip matches", () => {
  const server = createFakeArcGIS();
  assert.throws(() => server.override(/\/page$/g, () => html("x")), /g or y flag/);
  assert.throws(() => server.override(/\/page$/y, () => html("x")), /g or y flag/);
});

test("an override that returns a Promise is passed through for the caller to await", async () => {
  const server = createFakeArcGIS();
  server.override(/\/slow$/, async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { status: 503, contentType: "text/plain", body: "Late" };
  });
  const pending = get(server, "/slow");
  assert.ok(pending instanceof Promise);
  assert.deepEqual(await pending, { status: 503, contentType: "text/plain", body: "Late" });
  assert.equal(get(server, "/favicon.ico").status, 204);
});

test("an override's result is returned as it is, even without a status", () => {
  const server = createFakeArcGIS();
  server.override(/\/odd$/, () => undefined);
  assert.equal(get(server, "/odd"), undefined);
});

test("unusedOverrides lists the patterns that have not matched a request", () => {
  const server = createFakeArcGIS();
  assert.deepEqual(server.unusedOverrides(), []);
  server.override(/\/first$/, () => html("first"));
  server.override(/^\/second\?f=json$/, () => html("second"));
  assert.deepEqual(server.unusedOverrides(), ["/\\/first$/", "/^\\/second\\?f=json$/"]);
  get(server, "/second?f=json");
  assert.deepEqual(server.unusedOverrides(), ["/\\/first$/"]);
});

test("an override that an earlier override shadows counts as unused", () => {
  const server = createFakeArcGIS();
  server.override(/\/page$/, () => html("early"));
  server.override(/\/page$/, () => html("late"));
  assert.equal(get(server, "/page").body, "early");
  assert.deepEqual(server.unusedOverrides(), ["/\\/page$/"]);
});

test("markOverridesUsed clears the list, and only for the overrides added so far", () => {
  const server = createFakeArcGIS();
  server.override(/\/one$/, () => html("one"));
  server.markOverridesUsed();
  assert.deepEqual(server.unusedOverrides(), []);
  server.override(/\/two$/, () => html("two"));
  assert.deepEqual(server.unusedOverrides(), ["/\\/two$/"]);
});

test("the body helpers set the content types ArcGIS Server uses", () => {
  assert.deepEqual(html("<p>Hi</p>"), { status: 200, contentType: "text/html; charset=utf-8", body: "<p>Hi</p>" });
  assert.deepEqual(json({ a: 1 }), { status: 200, contentType: "application/json; charset=utf-8", body: "{\"a\":1}" });
  const pjson = json({ a: 1 }, "pjson");
  assert.equal(pjson.contentType, "text/plain; charset=utf-8");
  assert.equal(pjson.body, "{\n  \"a\": 1\n}");
  assert.equal(json({ _hidden: 1, shown: 2 }).body, "{\"shown\":2}");
});

test("arcgisError is an HTTP 200 with an error object", () => {
  const response = arcgisError("Unable to complete operation.");
  assert.equal(response.status, 200);
  assert.equal(response.contentType, "application/json; charset=utf-8");
  assert.deepEqual(JSON.parse(response.body), { error: { code: 400, message: "Unable to complete operation.", details: [] } });
  assert.equal(arcgisError("Oops", "pjson").contentType, "text/plain; charset=utf-8");
});

test("form posts are read like query strings", () => {
  const server = createFakeArcGIS();
  const response = server.respond(request("/arcgis/rest/services/Parcels/MapServer/0/query", { method: "POST", body: "where=1%3D1&returnCountOnly=true&f=json" }));
  assert.deepEqual(JSON.parse(response.body), { count: 3 });
});

test("whereMatcher returns null for clauses it does not support", () => {
  assert.equal(whereMatcher("ACRES > 1"), null);
  assert.equal(whereMatcher(" 1 = 1 ")({}), true);
});

test("createPages builds pages for another site, with its own roots and link query", () => {
  const pages = createPages({
    restPath: "/Org1/arcgis/rest/services",
    crumbPath: "/Org1/ArcGIS/rest/services",
    loginHref: null,
    linkQuery: "token=abc"
  });
  const root = pages.folderPage({ folder: "", folders: [], services: [{ name: "Parcels", type: "FeatureServer" }], version: 12.1 });
  assert.ok(root.includes("<a href=\"/Org1/arcgis/rest/services/Parcels/FeatureServer?token=abc\">Parcels</a>"));
  assert.ok(root.includes("<a href=\"/Org1/ArcGIS/rest/services?token=abc\">Home</a>"));
  assert.ok(root.includes("<a href=\"?f=pjson&amp;token=abc\" target=\"_blank\">JSON</a>"));
  assert.equal(root.includes(">Login<"), false);
});

test("the default site's pages link as before", () => {
  const root = createPages().folderPage({ folder: "", folders: ["Transport"], services: [{ name: "Parcels", type: "MapServer" }], version: 11.3 });
  assert.ok(root.includes("<a href=\"/arcgis/rest/login\">Login</a>"));
  assert.ok(root.includes("<a href=\"/arcgis/rest/services/Transport\">Transport</a>"));
  assert.ok(root.includes("<a href=\"/arcgis/rest/services/Parcels/MapServer\">Parcels</a>"));
  assert.ok(root.includes("<a href=\"?f=pjson\" target=\"_blank\">JSON</a>"));
});

test("the login, token and message pages", () => {
  assert.match(loginPage(), /<form name="loginForm" method="post" action="\/arcgis\/rest\/login">/);
  assert.match(tokensPage(), /<form name="tokenForm" method="post" action="\/arcgis\/tokens\/generateToken">/);
  assert.match(messagePage("Token Required"), /<p>Token Required<\/p>/);
  assert.match(messagePage("<b>"), /<p>&lt;b&gt;<\/p>/);
});

const signedIn = (username) => `agstoken=${SERVER_TOKENS[username]}`;
const respondJson = (server, path, options) => JSON.parse(server.respond(request(path, options)).body);

test("rest/info reports token security and the token page, and ignores tokens", () => {
  const info = getJson(createFakeArcGIS(), "/arcgis/rest/info?f=json&token=bogus");
  assert.equal(info.currentVersion, 11.3);
  assert.deepEqual(info.authInfo, { isTokenBasedSecurity: true, tokenServicesUrl: "https://arcgis.test/arcgis/tokens/", shortLivedTokenValidity: 60 });
});

test("rest/self names the signed-in user, or no one", () => {
  const server = createFakeArcGIS();
  assert.deepEqual(respondJson(server, "/arcgis/rest/self?f=json"), { user: {} });
  assert.deepEqual(respondJson(server, "/arcgis/rest/self?f=json", { cookie: signedIn("jsmith") }), {
    user: { username: "jsmith", roles: ["Administrators"], privilege: "ADMINISTER" }
  });
});

test("a token parameter wins over the cookie, and an empty one makes the request anonymous", () => {
  const server = createFakeArcGIS();
  const cookie = signedIn("jsmith");
  assert.equal(respondJson(server, `/arcgis/rest/self?f=json&token=${SERVER_TOKENS.viewer1}`, { cookie }).user.username, "viewer1");
  assert.equal(respondJson(server, "/arcgis/rest/self", { method: "POST", body: `f=json&token=${SERVER_TOKENS.viewer1}`, cookie }).user.username, "viewer1");
  assert.deepEqual(respondJson(server, "/arcgis/rest/self?f=json&token=", { cookie }), { user: {} });
});

test("an unknown cookie counts as signed out", () => {
  assert.deepEqual(respondJson(createFakeArcGIS(), "/arcgis/rest/self?f=json", { cookie: "agstoken=stale" }), { user: {} });
});

test("a bad token gets 498 on JSON requests and the login page on HTML ones", () => {
  const server = createFakeArcGIS();
  assert.deepEqual(getJson(server, "/arcgis/rest/services?f=json&token=bogus"), { error: { code: 498, message: "Invalid Token", details: [] } });
  const page = get(server, "/arcgis/rest/services?token=bogus");
  assert.equal(page.status, 302);
  assert.equal(page.headers.location, "https://arcgis.test/arcgis/rest/login?redirect=%2Farcgis%2Frest%2Fservices%3Ftoken%3Dbogus");
  // A path without a fixture stays unmatched, so the harness can report it.
  assert.equal(get(server, "/arcgis/rest/services/NoSuchFolder?f=json&token=bogus"), null);
  assert.equal(get(server, "/arcgis/rest/services/Transport/Roads/MapServer/99?f=json&token=bogus"), null);
  assert.match(get(server, "/arcgis/rest/login?redirect=x").body, /name="loginForm"/);
});

test("the instance name matches in any case", () => {
  const folder = getJson(createFakeArcGIS(), "/ArcGIS/rest/services/Transport?f=json");
  assert.deepEqual(folder.services.map((service) => service.name), ["Transport/Roads", "Transport/RouteTools"]);
});

test("the token page is served at tokenServicesUrl", () => {
  assert.match(get(createFakeArcGIS(), "/arcgis/tokens/").body, /name="tokenForm"/);
});

test("calls keeps the query string, the form body and the cookies apart", () => {
  const server = createFakeArcGIS();
  server.respond(request("/arcgis/rest/self?f=json", { method: "POST", body: "token=t1", cookie: "agstoken=c1; other=x" }));
  assert.deepEqual(server.calls, [{
    method: "POST",
    origin: "https://arcgis.test",
    path: "/arcgis/rest/self",
    query: { f: "json" },
    body: { token: "t1" },
    cookies: { agstoken: "c1", other: "x" }
  }]);
});

test("arcgisError takes a code", () => {
  assert.deepEqual(JSON.parse(arcgisError("Token Required", "json", 499).body), { error: { code: 499, message: "Token Required", details: [] } });
});

test("anonymous listings leave secured services out, as ArcGIS Server does", () => {
  const server = createFakeArcGIS();
  assert.deepEqual(getJson(server, "/arcgis/rest/services/Utilities?f=json").services, [{ name: "Utilities/PrintingTools", type: "GPServer" }]);
  const page = get(server, "/arcgis/rest/services/Utilities").body;
  assert.equal(page.includes("Valves") || page.includes("Mains"), false);
});

test("a signed-in user sees the secured services they may use", () => {
  const server = createFakeArcGIS();
  const names = (username) => respondJson(server, "/arcgis/rest/services/Utilities?f=json", { cookie: signedIn(username) }).services.map((s) => s.name);
  assert.deepEqual(names("jsmith"), ["Utilities/PrintingTools", "Utilities/Valves", "Utilities/Mains"]);
  assert.deepEqual(names("viewer1"), ["Utilities/PrintingTools", "Utilities/Valves"]);
});

test("a secured service needs a token: 499 for JSON, the login page for HTML", () => {
  const server = createFakeArcGIS();
  assert.deepEqual(getJson(server, "/arcgis/rest/services/Utilities/Valves/MapServer?f=json"), { error: { code: 499, message: "Token Required", details: [] } });
  assert.equal(getJson(server, "/arcgis/rest/services/Utilities/Valves/MapServer/0?f=json").error.code, 499);
  const page = get(server, "/arcgis/rest/services/Utilities/Valves/MapServer");
  assert.equal(page.status, 302);
  assert.equal(page.headers.location, "https://arcgis.test/arcgis/rest/login?redirect=%2Farcgis%2Frest%2Fservices%2FUtilities%2FValves%2FMapServer");
});

test("a user without access to a secured service gets 403", () => {
  const server = createFakeArcGIS();
  const mains = (username, f) => server.respond(request(`/arcgis/rest/services/Utilities/Mains/FeatureServer${f ? `?f=${f}` : ""}`, { cookie: signedIn(username) }));
  assert.equal(JSON.parse(mains("viewer1", "json").body).error.code, 403);
  assert.equal(mains("viewer1").status, 403);
  assert.equal(JSON.parse(mains("jsmith", "json").body).serviceDescription, "Water mains for an invented utility. Administrators only.");
});

test("a token in a form body opens a secured layer's queries", () => {
  const body = `where=1%3D1&returnCountOnly=true&f=json&token=${SERVER_TOKENS.jsmith}`;
  const count = respondJson(createFakeArcGIS(), "/arcgis/rest/services/Utilities/Valves/MapServer/0/query", { method: "POST", body });
  assert.deepEqual(count, { count: 2 });
});

const online = (server, path, options = {}) => server.respond(request(path, { ...options, origin: ONLINE_ORIGIN }));
const onlineJson = (server, path, options) => JSON.parse(online(server, path, options).body);

test("the ArcGIS Online stand-in lists secured services and refuses them without a token", () => {
  const server = createFakeArcGIS();
  assert.deepEqual(onlineJson(server, `${ONLINE_REST_PATH}?f=json`).services, [{ name: "Parcels", type: "FeatureServer" }, { name: "Hydrants", type: "FeatureServer" }]);
  assert.deepEqual(onlineJson(server, `${ONLINE_REST_PATH}/Hydrants/FeatureServer?f=json`), { error: { code: 499, message: "Token Required", details: [] } });
  assert.equal(onlineJson(server, `${ONLINE_REST_PATH}/Hydrants/FeatureServer?f=json&token=${ONLINE_TOKENS.jsmith}`).layers[0].name, "Hydrants");
});

test("ArcGIS Online answers a bad token with 400, and takes no server token or cookie", () => {
  const server = createFakeArcGIS();
  const invalid = { error: { code: 400, message: "Invalid token", details: [] } };
  assert.deepEqual(onlineJson(server, `${ONLINE_REST_PATH}?f=json&token=bogus`), invalid);
  assert.deepEqual(onlineJson(server, `${ONLINE_REST_PATH}?f=json&token=${SERVER_TOKENS.jsmith}`), invalid);
  assert.equal(online(server, `${ONLINE_REST_PATH}/NoSuchService/FeatureServer?f=json&token=bogus`), null);
  const withCookie = onlineJson(server, `${ONLINE_REST_PATH}/Hydrants/FeatureServer?f=json`, { cookie: `agstoken=${ONLINE_TOKENS.jsmith}` });
  assert.equal(withCookie.error.code, 499);
});

test("ArcGIS Online's rest/info names its portal, and rest/self can't say who you are", () => {
  const server = createFakeArcGIS();
  const info = onlineJson(server, `/${ONLINE_ORG}/arcgis/rest/info?f=json`);
  assert.equal(info.owningSystemUrl, PORTAL_ORIGIN);
  assert.equal(info.owningTenant, ONLINE_ORG);
  assert.equal(info.authInfo.tokenServicesUrl, `${PORTAL_ORIGIN}/sharing/rest/generateToken`);
  assert.deepEqual(onlineJson(server, `/${ONLINE_ORG}/arcgis/rest/self?f=json`), { error: { code: 400, message: "Unable to get user info.", details: [] } });
});

test("an ArcGIS Online page opened with ?token= copies the token into its links", () => {
  const token = ONLINE_TOKENS.jsmith;
  const page = online(createFakeArcGIS(), `${ONLINE_REST_PATH}?token=${token}`).body;
  assert.ok(page.includes(`<a href="${ONLINE_REST_PATH}/Hydrants/FeatureServer?token=${token}">Hydrants</a>`));
  assert.ok(page.includes(`<a href="/${ONLINE_ORG}/ArcGIS/rest/services?token=${token}">Home</a>`));
  assert.ok(page.includes(`<a href="?f=pjson&amp;token=${token}" target="_blank">JSON</a>`));
  assert.equal(page.includes(">Login<"), false);
});

test("the org ID is case-sensitive and the instance name isn't", () => {
  const server = createFakeArcGIS();
  assert.deepEqual(onlineJson(server, `/${ONLINE_ORG.toLowerCase()}/arcgis/rest/services?f=json`), { error: { code: 400, message: "Invalid URL", details: [] } });
  assert.equal(onlineJson(server, `/${ONLINE_ORG}/ArcGIS/rest/services?f=json`).services.length, 2);
});

test("community/self names the user of an ArcGIS Online token, with CORS", () => {
  const server = createFakeArcGIS();
  const self = (body) => server.respond(request("/sharing/rest/community/self", { method: "POST", body, origin: PORTAL_ORIGIN, headers: { origin: ONLINE_ORIGIN } }));
  const known = self(`f=json&token=${ONLINE_TOKENS.jsmith}`);
  assert.deepEqual(JSON.parse(known.body), { username: "jsmith", role: "org_admin", orgId: ONLINE_ORG });
  assert.equal(known.headers["access-control-allow-origin"], ONLINE_ORIGIN);
  assert.equal(JSON.parse(self("f=json&token=bogus").body).error.code, 498);
  assert.equal(JSON.parse(self("f=json").body).error.messageCode, "COM_0019");
});

test("requests to the stand-ins are logged with their origin", () => {
  const server = createFakeArcGIS();
  online(server, `${ONLINE_REST_PATH}?f=json`);
  get(server, "/arcgis/rest/services?f=json");
  assert.deepEqual(server.requests, [`GET ${ONLINE_ORIGIN}${ONLINE_REST_PATH}?f=json`, "GET /arcgis/rest/services?f=json"]);
});
