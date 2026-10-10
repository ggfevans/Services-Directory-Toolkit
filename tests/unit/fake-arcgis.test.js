import { test } from "node:test";
import assert from "node:assert/strict";
import { arcgisError, createFakeArcGIS, FAKE_ORIGIN, html, json, whereMatcher } from "../fixtures/fake-arcgis.js";

// A stand-in for a Playwright Request.
const request = (path, { method = "GET", body } = {}) => ({
  url: () => `${FAKE_ORIGIN}${path}`,
  method: () => method,
  headers: () => (body === undefined ? {} : { "content-type": "application/x-www-form-urlencoded" }),
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
  assert.deepEqual(folder, { currentVersion: 11.3, folders: [], services: [{ name: "Transport/Roads", type: "MapServer" }] });
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

test("static assets, the non-REST page and unknown paths", () => {
  const server = createFakeArcGIS();
  assert.equal(get(server, "/arcgis/rest/static/main.css").status, 200);
  assert.equal(get(server, "/favicon.ico").status, 204);
  assert.match(get(server, "/other/page").body, /not a Services Directory/i);
  assert.equal(get(server, "/arcgis/rest/services/NoSuchService/MapServer"), null);
  assert.equal(get(server, "/arcgis/rest/services/Parcels/MapServer/9"), null);
  assert.equal(get(server, "/somewhere/else"), null);
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
