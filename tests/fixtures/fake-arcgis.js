// A fake ArcGIS Server for the browser tests. The Playwright fixture (tests/e2e/fixtures.js) routes
// every request for https://arcgis.test through respond(), which answers from catalog.js and
// pages.js, or returns null when no fixture matches. A test can also add overrides, whose handlers
// may be async, so a test can serve a slow response or one that never arrives.
import { catalog as defaultCatalog } from "./catalog.js";
import { executePage, findPage, folderPage, layerPage, otherPage, queryPage, REST_PATH, servicePage } from "./pages.js";

export const FAKE_ORIGIN = "https://arcgis.test";
export const REST_ROOT = `${FAKE_ORIGIN}${REST_PATH}`;

const SERVICE_TYPES = ["MapServer", "FeatureServer", "ImageServer", "GPServer"];

export const html = (body) => ({ status: 200, contentType: "text/html; charset=utf-8", body });

// ArcGIS Server sends f=json as application/json and f=pjson as indented plain text.
export const json = (data, format) => ({
  status: 200,
  contentType: format === "pjson" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
  // Keys starting with "_" hold fixture data that a real server would not send.
  body: JSON.stringify(data, (key, value) => (key.startsWith("_") ? undefined : value), format === "pjson" ? 2 : undefined)
});

// ArcGIS Server reports most request errors as HTTP 200 with an error object.
export const arcgisError = (message, format) => json({ error: { code: 400, message, details: [] } }, format);

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

const folder = (catalog, parts, format) => {
  const name = parts[0] || "";
  if (parts.length > 1 || (name && !catalog.folders.includes(name))) {
    return null;
  }
  const services = catalog.services.filter((s) => (name ? s.name.startsWith(`${name}/`) : !s.name.includes("/")));
  const folders = name ? [] : catalog.folders;
  if (format === "html") {
    return html(folderPage({ folder: name, folders, services, version: catalog.currentVersion }));
  }
  return json({ currentVersion: catalog.currentVersion, folders, services: services.map((s) => ({ name: s.name, type: s.type })) }, format);
};

const serviceResource = (catalog, service, rest, params, format, problems) => {
  const [first, second, ...extra] = rest;
  if (extra.length) {
    return null;
  }
  if (first === undefined) {
    return format === "html" ? html(servicePage(service)) : json(serviceJson(catalog, service), format);
  }
  if (first === "layers" && second === undefined && service.layers) {
    return json({ layers: service.layers, tables: [] }, format);
  }
  if (first === "find" && second === undefined && service.type === "MapServer") {
    return format === "html" ? html(findPage(service, params)) : json({ results: [] }, format);
  }
  const task = (service.tasks || []).find((t) => t.name === first);
  if (task) {
    if (second === undefined) {
      return format === "html" ? null : json(task.json, format);
    }
    if (second === "execute") {
      return format === "html" ? html(executePage(service, task, params)) : json({ results: [], messages: [] }, format);
    }
    return null;
  }
  const layer = /^\d+$/.test(first) ? (service.layers || []).find((l) => l.id === Number(first)) : undefined;
  if (!layer) {
    return null;
  }
  if (second === undefined) {
    return format === "html" ? html(layerPage(service, layer)) : json(layer, format);
  }
  if (second === "query") {
    return format === "html" ? html(queryPage(service, layer, params)) : queryLayer(layer, params, format, problems);
  }
  return null;
};

const route = (catalog, url, params, problems) => {
  const { pathname } = url;
  const format = params.get("f") || "html";
  if (pathname === "/favicon.ico") {
    return { status: 204, contentType: "image/x-icon", body: "" };
  }
  if (pathname === "/arcgis/rest/static/main.css") {
    return { status: 200, contentType: "text/css; charset=utf-8", body: "body { font-family: sans-serif; }\n" };
  }
  if (pathname === "/other/page") {
    return html(otherPage());
  }
  if (pathname !== REST_PATH && !pathname.startsWith(`${REST_PATH}/`)) {
    return null;
  }
  const parts = pathname.slice(REST_PATH.length).split("/").filter(Boolean).map(decodeURIComponent);
  const typeIndex = parts.findIndex((part) => SERVICE_TYPES.includes(part));
  if (typeIndex === -1) {
    return folder(catalog, parts, format);
  }
  const service = catalog.services.find((s) => s.name === parts.slice(0, typeIndex).join("/") && s.type === parts[typeIndex]);
  return service ? serviceResource(catalog, service, parts.slice(typeIndex + 1), params, format, problems) : null;
};

/**
 * Creates a fake server. respond(request) takes a Playwright Request and returns options for
 * route.fulfill(), or null when nothing matches. An override's handler may be async, and then
 * respond() returns its Promise.
 */
export const createFakeArcGIS = (catalog = defaultCatalog) => {
  const overrides = [];
  const requests = [];
  const problems = [];
  return {
    requests,
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
    respond(request) {
      const url = new URL(request.url());
      const params = new URLSearchParams(url.search);
      if (request.method() === "POST" && /x-www-form-urlencoded/.test(request.headers()["content-type"] || "")) {
        new URLSearchParams(request.postData() || "").forEach((value, key) => params.set(key, value));
      }
      requests.push(`${request.method()} ${url.pathname}${url.search}`);
      const override = overrides.find(({ pattern }) => pattern.test(`${url.pathname}${url.search}`));
      if (override) {
        override.used = true;
        return override.handler(url, params);
      }
      return route(catalog, url, params, problems);
    }
  };
};
