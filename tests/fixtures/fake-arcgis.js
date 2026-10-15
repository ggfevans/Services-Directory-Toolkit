// A fake ArcGIS Server for the browser tests, with stand-ins for ArcGIS Online. The Playwright
// fixture (tests/e2e/fixtures.js) routes every request for the origins in FAKE_ORIGINS through
// respond(), which answers from catalog.js and pages.js, or returns null when no fixture matches.
// A test can also add overrides, whose handlers may be async, so a test can serve a slow response
// or one that never arrives.
//
// - FAKE_ORIGIN (https://arcgis.test) is an Enterprise-style ArcGIS Server. A token parameter, in
//   the query string or a form body, wins over the agstoken cookie its login page sets, and an empty
//   token parameter makes a request anonymous. Both follow a probe of ArcGIS Server 10.9.1 (token
//   support spec, section 4). Anonymous listings leave secured services out.
// - ONLINE_ORIGIN is an ArcGIS Online hosted-services host. Its listings include secured services,
//   it has no sign-in of its own, and a page opened with ?token= copies the token into its links.
// - PORTAL_ORIGIN answers ArcGIS Online's community/self, the one request the toolkit sends outside
//   a token's scope.
import { catalog as defaultCatalog, ONLINE_ORG, ONLINE_TOKENS, onlineCatalog as defaultOnlineCatalog, SERVER_TOKENS, users } from "./catalog.js";
import { createPages, loginPage, messagePage, otherPage, REST_PATH, tokensPage } from "./pages.js";

export { ONLINE_ORG, ONLINE_TOKENS, SERVER_TOKENS };

export const FAKE_ORIGIN = "https://arcgis.test";
export const REST_ROOT = `${FAKE_ORIGIN}${REST_PATH}`;
export const ONLINE_ORIGIN = "https://services9.arcgis.com";
export const ONLINE_REST_PATH = `/${ONLINE_ORG}/arcgis/rest/services`;
export const ONLINE_REST_ROOT = `${ONLINE_ORIGIN}${ONLINE_REST_PATH}`;
export const PORTAL_ORIGIN = "https://www.arcgis.com";

// The origins the harness routes to this fake server. A request to any other host fails the test.
export const FAKE_ORIGINS = [FAKE_ORIGIN, ONLINE_ORIGIN, PORTAL_ORIGIN];

// ArcGIS Online writes its breadcrumbs with /ArcGIS/ and its other links with /arcgis/.
const ONLINE_SITE = { restPath: ONLINE_REST_PATH, crumbPath: `/${ONLINE_ORG}/ArcGIS/rest/services`, loginHref: null };

const SERVICE_TYPES = ["MapServer", "FeatureServer", "ImageServer", "GPServer"];
const ENTERPRISE_PAGES = createPages();
const FAVICON = { status: 204, contentType: "image/x-icon", body: "" };
const STYLESHEET = { status: 200, contentType: "text/css; charset=utf-8", body: "body { font-family: sans-serif; }\n" };
const INVALID_TOKEN = { code: 498, message: "Invalid Token" };
const TOKEN_REQUIRED = { code: 499, message: "Token Required" };
const FORBIDDEN = { code: 403, message: "You do not have permissions to access this resource or perform this operation." };

/** Why user (a username, or null) can't use service: TOKEN_REQUIRED, FORBIDDEN, or null when they can. */
const refusal = (service, user) => {
  if (!service._secured) {
    return null;
  }
  if (!user) {
    return TOKEN_REQUIRED;
  }
  return service._allowed && !service._allowed.includes(user) ? FORBIDDEN : null;
};

export const html = (body) => ({ status: 200, contentType: "text/html; charset=utf-8", body });

// ArcGIS Server sends f=json as application/json and f=pjson as indented plain text.
export const json = (data, format) => ({
  status: 200,
  contentType: format === "pjson" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
  // Keys starting with "_" hold fixture data that a real server would not send.
  body: JSON.stringify(data, (key, value) => (key.startsWith("_") ? undefined : value), format === "pjson" ? 2 : undefined)
});

// ArcGIS Server reports most request errors as HTTP 200 with an error object.
export const arcgisError = (message, format, code = 400) => json({ error: { code, message, details: [] } }, format);

/** Evaluates the where clauses the extension sends. Returns null for anything else. */
export const whereMatcher = (where) => {
  const clause = where.trim();
  let match;
  if (/^1\s*=\s*1$/.test(clause)) {
    return () => true;
  }
  if ((match = clause.match(/^not\s+(\w+)\s+is\s+null$/i))) {
    const [, field] = match;
    return (row) => row[field] != null;
  }
  if ((match = clause.match(/^not\s+(\w+)\s+is\s+null\s+and\s+(\w+)\s*<>\s*''$/i))) {
    const [, field, sameField] = match;
    return (row) => row[field] != null && row[sameField] !== "";
  }
  if ((match = clause.match(/^(\w+)\s*=\s*'([^']*)'$/))) {
    const [, field, value] = match;
    return (row) => row[field] === value;
  }
  if ((match = clause.match(/^(\w+)\s*=\s*(-?\d+(?:\.\d+)?)$/))) {
    const [, field, value] = match;
    return (row) => row[field] === Number(value);
  }
  return null;
};

const queryLayer = (layer, params, format, problems) => {
  const where = params.get("where");
  const matches = where ? whereMatcher(where) : null;
  if (!matches) {
    problems.push(`unsupported where clause "${where}" on layer ${layer.name}`);
    return arcgisError("Unable to complete operation.", format);
  }
  const rows = layer._rows.filter(matches);
  if (params.get("returnCountOnly") === "true") {
    return json({ count: rows.length }, format);
  }
  const requested = params.get("outFields") || "*";
  const names = requested === "*"
    ? layer.fields.filter((field) => field.type !== "esriFieldTypeGeometry").map((field) => field.name)
    : requested.split(",").map((name) => name.trim());
  let attributes = rows.map((row) => Object.fromEntries(names.map((name) => [name, row[name] ?? null])));
  if (params.get("returnDistinctValues") === "true") {
    const unique = new Map(attributes.map((item) => [JSON.stringify(item), item]));
    attributes = [...unique.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => item);
  }
  return json({
    displayFieldName: layer.displayField,
    fields: layer.fields.filter((field) => names.includes(field.name)),
    features: attributes.map((item) => ({ attributes: item }))
  }, format);
};

const layerSummary = ({ id, name, parentLayerId, defaultVisibility, subLayerIds, minScale, maxScale, type, geometryType }) =>
  ({ id, name, parentLayerId, defaultVisibility, subLayerIds, minScale, maxScale, type, geometryType });

const serviceJson = (catalog, service) => ({
  currentVersion: catalog.currentVersion,
  ...service.info,
  ...(service.layers ? { layers: service.layers.map(layerSummary), tables: [] } : {}),
  ...(service.tasks ? { tasks: service.tasks.map((task) => task.name) } : {})
});

// Lists the services the user may use. ArcGIS Server leaves the others out; ArcGIS Online, with
// listSecured, lists them all.
const folder = (catalog, parts, format, user, pages, listSecured = false) => {
  const name = parts[0] || "";
  if (parts.length > 1 || (name && !catalog.folders.includes(name))) {
    return null;
  }
  const services = catalog.services
    .filter((s) => (name ? s.name.startsWith(`${name}/`) : !s.name.includes("/")))
    .filter((s) => listSecured || refusal(s, user) === null);
  const folders = name ? [] : catalog.folders;
  if (format === "html") {
    return html(pages.folderPage({ folder: name, folders, services, version: catalog.currentVersion }));
  }
  return json({ currentVersion: catalog.currentVersion, folders, services: services.map((s) => ({ name: s.name, type: s.type })) }, format);
};

const serviceResource = (catalog, service, rest, params, format, problems, pages) => {
  const [first, second, ...extra] = rest;
  if (extra.length) {
    return null;
  }
  if (first === undefined) {
    return format === "html" ? html(pages.servicePage(service)) : json(serviceJson(catalog, service), format);
  }
  if (first === "layers" && second === undefined && service.layers) {
    return json({ layers: service.layers, tables: [] }, format);
  }
  if (first === "find" && second === undefined && service.type === "MapServer") {
    return format === "html" ? html(pages.findPage(service, params)) : json({ results: [] }, format);
  }
  const task = (service.tasks || []).find((t) => t.name === first);
  if (task) {
    if (second === undefined) {
      return format === "html" ? null : json(task.json, format);
    }
    if (second === "execute") {
      return format === "html" ? html(pages.executePage(service, task, params)) : json({ results: [], messages: [] }, format);
    }
    return null;
  }
  const layer = /^\d+$/.test(first) ? (service.layers || []).find((l) => l.id === Number(first)) : undefined;
  if (!layer) {
    return null;
  }
  if (second === undefined) {
    return format === "html" ? html(pages.layerPage(service, layer)) : json(layer, format);
  }
  if (second === "query") {
    return format === "html" ? html(pages.queryPage(service, layer, params)) : queryLayer(layer, params, format, problems);
  }
  return null;
};

/** Parses a Cookie request header into an object. */
const parseCookies = (header = "") => Object.fromEntries(header
  .split(";")
  .map((pair) => pair.trim())
  .filter(Boolean)
  .map((pair) => {
    const at = pair.indexOf("=");
    return at === -1 ? [pair, ""] : [pair.slice(0, at), pair.slice(at + 1)];
  }));

/**
 * Who a request runs as: { user } with a username, or with null when anonymous, or { invalid: true }
 * for a token the site doesn't know. tokens maps each token the site accepts to a username.
 */
const identify = (tokens, params, cookies) => {
  if (params.has("token")) {
    const token = params.get("token");
    if (token === "") {
      return { user: null };
    }
    return Object.hasOwn(tokens, token) ? { user: tokens[token] } : { invalid: true };
  }
  const cookie = cookies.agstoken;
  return { user: cookie && Object.hasOwn(tokens, cookie) ? tokens[cookie] : null };
};

const loginRedirect = (url) => ({
  status: 302,
  headers: { location: `${url.origin}/arcgis/rest/login?redirect=${encodeURIComponent(`${url.pathname}${url.search}`)}` },
  contentType: "text/html; charset=utf-8",
  body: ""
});

const serverInfo = (catalog) => ({
  currentVersion: catalog.currentVersion,
  authInfo: { isTokenBasedSecurity: true, tokenServicesUrl: `${FAKE_ORIGIN}/arcgis/tokens/`, shortLivedTokenValidity: 60 }
});

const serverSelf = (username) => {
  const { roles, privilege } = users[username];
  return { username, roles, privilege };
};

const route = (catalog, url, params, cookies, problems) => {
  // ArcGIS Server matches the instance name in any case, so /ArcGIS/rest/services works too.
  const pathname = url.pathname.replace(/^\/arcgis(?=\/|$)/i, "/arcgis");
  const format = params.get("f") || "html";
  if (pathname === "/favicon.ico") {
    return FAVICON;
  }
  if (pathname === "/arcgis/rest/static/main.css") {
    return STYLESHEET;
  }
  if (pathname === "/other/page") {
    return html(otherPage());
  }
  if (pathname === "/arcgis/rest/login") {
    return html(loginPage());
  }
  if (pathname === "/arcgis/tokens" || pathname === "/arcgis/tokens/") {
    return html(tokensPage());
  }
  // rest/info ignores tokens, so it answers even when the token is bad.
  if (pathname === "/arcgis/rest/info") {
    return json(serverInfo(catalog), format);
  }
  const who = identify(catalog._tokens, params, cookies);
  // A bad token gets its error only on a path with a fixture, so the harness still sees the others as unmatched.
  const invalid = format === "html" ? loginRedirect(url) : arcgisError(INVALID_TOKEN.message, format, INVALID_TOKEN.code);
  if (pathname === "/arcgis/rest/self") {
    if (who.invalid) {
      return invalid;
    }
    return json({ user: who.user ? serverSelf(who.user) : {} }, format);
  }
  if (pathname !== REST_PATH && !pathname.startsWith(`${REST_PATH}/`)) {
    return null;
  }
  const parts = pathname.slice(REST_PATH.length).split("/").filter(Boolean).map(decodeURIComponent);
  const typeIndex = parts.findIndex((part) => SERVICE_TYPES.includes(part));
  if (typeIndex === -1) {
    const listing = folder(catalog, parts, format, who.user, ENTERPRISE_PAGES);
    return listing && who.invalid ? invalid : listing;
  }
  const service = catalog.services.find((s) => s.name === parts.slice(0, typeIndex).join("/") && s.type === parts[typeIndex]);
  if (!service) {
    return null;
  }
  if (who.invalid) {
    // A throwaway problems list: this call only checks that the path has a fixture.
    return serviceResource(catalog, service, parts.slice(typeIndex + 1), params, format, [], ENTERPRISE_PAGES) ? invalid : null;
  }
  const refused = refusal(service, who.user);
  if (refused) {
    if (format !== "html") {
      return arcgisError(refused.message, format, refused.code);
    }
    return refused === TOKEN_REQUIRED ? loginRedirect(url) : { status: 403, contentType: "text/html; charset=utf-8", body: messagePage(refused.message) };
  }
  return serviceResource(catalog, service, parts.slice(typeIndex + 1), params, format, problems, ENTERPRISE_PAGES);
};

const onlineInfo = (online) => ({
  currentVersion: online.currentVersion,
  owningSystemUrl: PORTAL_ORIGIN,
  owningTenant: ONLINE_ORG,
  authInfo: { isTokenBasedSecurity: true, tokenServicesUrl: `${PORTAL_ORIGIN}/sharing/rest/generateToken` }
});

const onlineRoute = (online, url, params, problems) => {
  if (url.pathname === "/favicon.ico") {
    return FAVICON;
  }
  if (url.pathname === "/arcgis/rest/static/main.css") {
    return STYLESHEET;
  }
  const [org, instance, rest, ...tail] = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const format = params.get("f") || "html";
  if (org !== ONLINE_ORG) {
    // The org ID is case-sensitive: in another case it is an invalid URL.
    return org?.toLowerCase() === ONLINE_ORG.toLowerCase() ? arcgisError("Invalid URL", format) : null;
  }
  if (instance?.toLowerCase() !== "arcgis" || rest !== "rest") {
    return null;
  }
  if (tail.length === 1 && tail[0] === "info") {
    return json(onlineInfo(online), format);
  }
  // Hosted services have no sign-in of their own, so a cookie counts for nothing here.
  const who = identify(online._tokens, params, {});
  // As in route, a bad token gets its error only on a path with a fixture.
  const invalid = format === "html" ? html(messagePage("Invalid token")) : arcgisError("Invalid token", format);
  if (tail.length === 1 && tail[0] === "self") {
    return who.invalid ? invalid : arcgisError("Unable to get user info.", format);
  }
  if (tail[0] !== "services") {
    return null;
  }
  const token = params.get("token");
  const pages = createPages(token ? { ...ONLINE_SITE, linkQuery: `token=${encodeURIComponent(token)}` } : ONLINE_SITE);
  const parts = tail.slice(1);
  const typeIndex = parts.findIndex((part) => SERVICE_TYPES.includes(part));
  if (typeIndex === -1) {
    const listing = folder(online, parts, format, who.user, pages, true);
    return listing && who.invalid ? invalid : listing;
  }
  const service = online.services.find((s) => s.name === parts.slice(0, typeIndex).join("/") && s.type === parts[typeIndex]);
  if (!service) {
    return null;
  }
  if (who.invalid) {
    return serviceResource(online, service, parts.slice(typeIndex + 1), params, format, [], pages) ? invalid : null;
  }
  const refused = refusal(service, who.user);
  if (refused) {
    return format === "html" ? html(messagePage(refused.message)) : arcgisError(refused.message, format, refused.code);
  }
  return serviceResource(online, service, parts.slice(typeIndex + 1), params, format, problems, pages);
};

const portalRoute = (online, url, params, headers) => {
  if (url.pathname !== "/sharing/rest/community/self") {
    return null;
  }
  const token = params.get("token");
  let response;
  if (!token) {
    response = json({ error: { code: 400, messageCode: "COM_0019", message: "You must be signed in to see this resource.", details: [] } });
  } else if (!Object.hasOwn(online._tokens, token)) {
    response = arcgisError("Invalid token.", "json", 498);
  } else {
    const username = online._tokens[token];
    response = json({ username, role: users[username].onlineRole, orgId: ONLINE_ORG });
  }
  // The toolkit's content scripts call this from another origin, so it answers with CORS.
  return { ...response, headers: { "access-control-allow-origin": headers.origin || "*" } };
};

/**
 * Creates a fake server. respond(request, headers) takes a Playwright Request and returns options
 * for route.fulfill(), or null when nothing matches. An override's handler may be async, and then
 * respond() returns its Promise.
 */
export const createFakeArcGIS = (catalog = defaultCatalog, online = defaultOnlineCatalog) => {
  const overrides = [];
  const requests = [];
  const calls = [];
  const problems = [];
  return {
    requests,
    calls,
    problems,
    /**
     * Answers requests whose path and query (as sent, still encoded) match pattern with
     * handler(url, params). The handler returns route.fulfill() options, or a Promise of them.
     */
    override(pattern, handler) {
      // test() on a g or y pattern starts at lastIndex, so it would miss every other request.
      if (pattern.global || pattern.sticky) {
        throw new TypeError(`override pattern ${pattern} must not use the g or y flag`);
      }
      overrides.push({ pattern, handler, used: false });
    },
    /** The patterns, as strings, of the overrides that have not matched a request yet. */
    unusedOverrides() {
      return overrides.filter(({ used }) => !used).map(({ pattern }) => String(pattern));
    },
    /** Counts every override added so far as used, for a test that adds one it doesn't mean to request. */
    markOverridesUsed() {
      overrides.forEach((override) => {
        override.used = true;
      });
    },
    /**
     * headers is every request header, cookies included. Playwright's request.headers() leaves
     * cookies out, so the harness passes await request.allHeaders().
     */
    respond(request, headers = request.headers()) {
      const url = new URL(request.url());
      const query = new URLSearchParams(url.search);
      const body = request.method() === "POST" && /x-www-form-urlencoded/.test(headers["content-type"] || "")
        ? new URLSearchParams(request.postData() || "")
        : new URLSearchParams();
      const params = new URLSearchParams(query);
      body.forEach((value, key) => params.set(key, value));
      const cookies = parseCookies(headers.cookie);
      const where = url.origin === FAKE_ORIGIN ? "" : url.origin;
      requests.push(`${request.method()} ${where}${url.pathname}${url.search}`);
      calls.push({
        method: request.method(),
        origin: url.origin,
        path: url.pathname,
        query: Object.fromEntries(query),
        body: Object.fromEntries(body),
        cookies
      });
      const override = overrides.find(({ pattern }) => pattern.test(`${url.pathname}${url.search}`));
      if (override) {
        override.used = true;
        return override.handler(url, params);
      }
      if (url.origin === FAKE_ORIGIN) {
        return route(catalog, url, params, cookies, problems);
      }
      if (url.origin === ONLINE_ORIGIN) {
        return onlineRoute(online, url, params, problems);
      }
      if (url.origin === PORTAL_ORIGIN) {
        return portalRoute(online, url, params, headers);
      }
      return null;
    }
  };
};
