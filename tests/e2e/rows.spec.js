// The rows of a Services Directory page: badges, the Details disclosure and the row states (design
// review 6.4 and 6.5, Phase 5 part 2).
import { test, expect, html, json, REST_ROOT } from "./fixtures.js";
import { catalog } from "../fixtures/catalog.js";
import { folderPage, layerPage } from "../fixtures/pages.js";
import { axeViolations } from "./axe.js";

const PARCELS_JSON = /^\/arcgis\/rest\/services\/Parcels\/MapServer\?f=json$/;
const LONG_WKT = `PROJCS["Example_Local_Grid",GEOGCS["GCS_Example",DATUM["D_Example",SPHEROID["Example",6378137,298.25]]],${"PARAMETER[\"Scale\",1],".repeat(200)}UNIT["Meter",1]]`;

/** A service's row: the list item that holds the link to it. */
const serviceRow = (page, path) => page.locator("li", { has: page.locator(`a[href$="/rest/services/${path}"]`) });
const rowFor = (page, name) => page.locator("li", { has: page.getByRole("link", { name, exact: true }) });
const disclosure = (row) => row.locator("details.sdt-details");
const badge = (row) => row.locator(".sdt-badge--sr");
/** The cache badge: an sdt-badge that isn't the spatial reference. */
const cacheBadge = (row) => row.locator(".sdt-badge:not(.sdt-badge--sr)");
/** The value beside a term in the row's details. */
const detail = (row, term) => row.locator(`dt:text-is("${term}") + dd`);
const colourClasses = (locator) => locator.evaluate((element) => [...element.classList].filter((name) => /^sdt-badge--sr\d$/.test(name)));
const message = (page) => page.locator(".sdt-statusbar").getByRole("status");

/** What Chrome's accessibility tree says about the summary of the first details on the page. */
const expanded = async (page) => {
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "details.sdt-details > summary" });
  const { nodes } = await cdp.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
  const value = nodes[0].properties.find((property) => property.name === "expanded")?.value.value;
  await cdp.detach();
  return value;
};

test("a service row reads link, badge, cache badge, Details on one line", async ({ page }) => {
  await page.goto(REST_ROOT);
  const row = serviceRow(page, "Parcels/MapServer");
  const link = page.getByRole("link", { name: "Parcels", exact: true }).first();
  const sr = row.getByRole("link", { name: "Spatial reference 3857", exact: true });
  await expect(sr).toHaveAttribute("href", "https://spatialreference.org/ref/?search=3857");
  await expect(cacheBadge(row)).toHaveText("Dynamic");
  const summary = disclosure(row).locator("summary");
  await expect(summary.locator(".sdt-details__meta")).toHaveText("2 layers, max 1,000 records");
  await expect(summary).toContainText(/^Details/);
  const boxes = await Promise.all([link, sr, cacheBadge(row), summary].map((locator) => locator.boundingBox()));
  const middle = boxes[0].y + boxes[0].height / 2;
  boxes.forEach((box, i) => {
    expect(box.y, `item ${i} starts above the link's middle`).toBeLessThan(middle);
    expect(box.y + box.height, `item ${i} ends below the link's middle`).toBeGreaterThan(middle);
    if (i > 0) {
      expect(box.x, `item ${i} follows the one before it`).toBeGreaterThan(boxes[i - 1].x);
    }
  });
});

test("the same WKID gets the same colour class on the root and on a folder page, across a reload", async ({ page }) => {
  await page.goto(REST_ROOT);
  const onRoot = badge(serviceRow(page, "Parcels/MapServer"));
  await expect(onRoot).toBeVisible();
  expect(await colourClasses(onRoot)).toEqual(["sdt-badge--sr2"]);
  await page.reload();
  await expect(onRoot).toBeVisible();
  expect(await colourClasses(onRoot)).toEqual(["sdt-badge--sr2"]);
  await page.goto(`${REST_ROOT}/Transport`);
  const inFolder = badge(serviceRow(page, "Transport/Roads/MapServer"));
  await expect(inFolder).toBeVisible();
  expect(await colourClasses(inFolder)).toEqual(["sdt-badge--sr2"]);
});

test("a WKT-only service shows a truncated neutral badge, with the full text in title and in the details", async ({ page, fakeServer }) => {
  fakeServer.override(PARCELS_JSON, () => json({ serviceDescription: "Local grid.", spatialReference: { wkt: LONG_WKT } }));
  await page.goto(REST_ROOT);
  const row = serviceRow(page, "Parcels/MapServer");
  await expect(badge(row)).toHaveText(`Spatial reference WKT ${LONG_WKT.slice(0, 24)}…`);
  await expect(badge(row)).toHaveAttribute("title", LONG_WKT);
  expect(await badge(row).evaluate((element) => element.tagName)).toBe("SPAN");
  expect(await colourClasses(badge(row))).toEqual([]);
  await expect(detail(row, "Spatial reference")).toHaveText(LONG_WKT);
});

test("a service with no spatial reference shows no badge, and its details say \"No spatial reference\"", async ({ page, fakeServer }) => {
  fakeServer.override(PARCELS_JSON, () => json({ serviceDescription: "Nowhere.", spatialReference: null }));
  await page.goto(REST_ROOT);
  const row = serviceRow(page, "Parcels/MapServer");
  await expect(detail(row, "Spatial reference")).toHaveText("No spatial reference");
  await expect(badge(row)).toHaveCount(0);
});

test("Dynamic and Tiled appear only when singleFusedMapCache exists", async ({ page }) => {
  await page.goto(REST_ROOT);
  await expect(cacheBadge(serviceRow(page, "Parcels/MapServer"))).toHaveText("Dynamic");
  const noCacheField = serviceRow(page, "Parcels/FeatureServer");
  await expect(disclosure(noCacheField)).toHaveCount(1);
  await expect(cacheBadge(noCacheField)).toHaveCount(0);
  await page.goto(`${REST_ROOT}/Transport`);
  await expect(cacheBadge(serviceRow(page, "Transport/Roads/MapServer"))).toHaveText("Tiled");
});

test("a layer row's badge comes from extent.spatialReference", async ({ page }) => {
  await page.goto(`${REST_ROOT}/Parcels/MapServer`);
  const row = serviceRow(page, "Parcels/MapServer/0");
  await expect(row.getByRole("link", { name: "Spatial reference 3857", exact: true })).toHaveCount(1);
  await expect(disclosure(row).locator(".sdt-details__meta")).toHaveText("Polygon, 6 fields");
});

test("Tab reaches each summary, Enter and Space toggle it, and aria-expanded follows", async ({ page }) => {
  await page.goto(REST_ROOT);
  const rows = ["Parcels/MapServer", "Parcels/FeatureServer", "Elevation/ImageServer"].map((path) => serviceRow(page, path));
  for (const row of rows) {
    await expect(disclosure(row)).toHaveCount(1);
  }
  await rows[0].getByRole("link").first().focus();
  for (const row of rows) {
    await page.keyboard.press("Tab");
    await expect(badge(row)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(disclosure(row).locator("summary")).toBeFocused();
    await page.keyboard.press("Tab");
  }
  const first = disclosure(rows[0]);
  await first.locator("summary").focus();
  expect(await expanded(page)).toBe(false);
  await page.keyboard.press("Enter");
  await expect(first).toHaveAttribute("open", "");
  expect(await expanded(page)).toBe(true);
  await page.keyboard.press("Space");
  await expect(first).not.toHaveAttribute("open", "");
  expect(await expanded(page)).toBe(false);
});

test("clicking and selecting text inside the open body leaves it open", async ({ page }) => {
  await page.goto(REST_ROOT);
  const row = serviceRow(page, "Parcels/MapServer");
  await disclosure(row).locator("summary").click();
  const value = detail(row, "Service description");
  await expect(value).toBeVisible();
  await value.click();
  await expect(disclosure(row)).toHaveAttribute("open", "");
  await value.dblclick();
  expect(await page.evaluate(() => getSelection().toString().trim())).not.toBe("");
  await expect(disclosure(row)).toHaveAttribute("open", "");
  const body = await value.boundingBox();
  await page.mouse.move(body.x + 2, body.y + body.height / 2);
  await page.mouse.down();
  await page.mouse.move(body.x + 120, body.y + body.height / 2);
  await page.mouse.up();
  await expect(disclosure(row)).toHaveAttribute("open", "");
});

test("server HTML shows as text, and entities as characters", async ({ page, fakeServer }) => {
  fakeServer.override(PARCELS_JSON, () => json({ serviceDescription: "<b>Roads</b> &amp; rails", spatialReference: { wkid: 4326 } }));
  await page.goto(REST_ROOT);
  const row = serviceRow(page, "Parcels/MapServer");
  await expect(detail(row, "Service description")).toHaveText("Roads & rails");
  await expect(detail(row, "Service description").locator("b")).toHaveCount(0);
});

for (const [title, description, text] of [
  ["a script's source", "Intro<script>document.write(\"<b>x</b>\")</script> end", "Intro end"],
  ["a style sheet", "Intro<style>p{margin:0}</style> end", "Intro end"],
  ["adjacent blocks", "<div>Parcels</div><div>Updated weekly</div>", "Parcels Updated weekly"],
  ["a line break", "Line one<br>Line two", "Line one Line two"],
  ["list items", "<ul><li>A</li><li>B</li></ul>", "A B"],
  ["text right before a block", "Intro<div>more</div>", "Intro more"]
]) {
  test(`server HTML as text: ${title}`, async ({ page, fakeServer }) => {
    fakeServer.override(PARCELS_JSON, () => json({ serviceDescription: description, spatialReference: { wkid: 4326 } }));
    await page.goto(REST_ROOT);
    await expect(detail(serviceRow(page, "Parcels/MapServer"), "Service description")).toHaveText(text);
    expect(await detail(serviceRow(page, "Parcels/MapServer"), "Service description").textContent()).toBe(text);
  });
}

test("a <script> or <img onerror> in a description neither runs nor loads", async ({ page, fakeServer }) => {
  const image = "/arcgis/rest/static/injected.png";
  fakeServer.override(PARCELS_JSON, () => json({
    serviceDescription: `<script>window.sdtInjected = "script"</script><img src="${image}" onerror="window.sdtInjected = 'img'">Plain words`,
    spatialReference: { wkid: 4326 }
  }));
  await page.goto(REST_ROOT);
  const row = serviceRow(page, "Parcels/MapServer");
  await expect(detail(row, "Service description")).toHaveText("Plain words");
  await disclosure(row).locator("summary").click();
  await page.waitForTimeout(300);
  await expect(row.locator("img, script")).toHaveCount(0);
  expect(fakeServer.calls.filter((call) => call.path === image)).toEqual([]);
  expect(await page.evaluate(() => window.sdtInjected)).toBeUndefined();
});

test("copyright \"&copy; 2026 Example County\" shows \"© 2026 Example County\" once, under the term Copyright", async ({ page, fakeServer }) => {
  fakeServer.override(PARCELS_JSON, () => json({ copyrightText: "&copy; 2026 Example County", spatialReference: { wkid: 4326 } }));
  await page.goto(REST_ROOT);
  const row = serviceRow(page, "Parcels/MapServer");
  await expect(detail(row, "Copyright")).toHaveText("© 2026 Example County");
  await expect(row.locator("dt", { hasText: "Copyright" })).toHaveCount(1);
  expect((await disclosure(row).textContent()).match(/©/g)).toHaveLength(1);
});

test("a long unbroken description and a very long WKT cause no sideways scroll at 800 px", async ({ page, fakeServer }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  fakeServer.override(PARCELS_JSON, () => json({ serviceDescription: "x".repeat(3000), spatialReference: { wkt: LONG_WKT } }));
  await page.goto(REST_ROOT);
  const row = serviceRow(page, "Parcels/MapServer");
  await disclosure(row).locator("summary").click();
  await expect(detail(row, "Service description")).toBeVisible();
  await expect(detail(row, "Spatial reference")).toBeVisible();
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  expect((await badge(row).boundingBox()).width).toBeLessThan(400);
});

test("a row the budget left out stays plain: no note, no spinner, no details", async ({ page, bulkRoot }) => {
  bulkRoot(60);
  await page.goto(REST_ROOT);
  await expect(message(page)).toHaveText("Paused after 50 automatic requests. 10 services not loaded yet.");
  const row = rowFor(page, "Bulk60");
  await expect(row).toHaveText(/^\s*Bulk60 \(MapServer\)\s*$/);
  await expect(row.locator(".sdt-annot, .sdt-spinner, details")).toHaveCount(0);
  await expect(page.getByText(/Not loaded/)).toHaveCount(0);
  await expect(disclosure(rowFor(page, "Bulk50"))).toHaveCount(1);
});

test("while a row loads it shows \"Loading details\" with a spinner", async ({ page, fakeServer }) => {
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  fakeServer.override(PARCELS_JSON, async () => {
    await held;
    return json({ serviceDescription: "Held back by the test.", spatialReference: { wkid: 4326 } });
  });
  await page.goto(REST_ROOT);
  const row = serviceRow(page, "Parcels/MapServer");
  const status = row.locator(".sdt-annot .sdt-status");
  await expect(status).toHaveText("Loading details");
  await expect(status.locator(".sdt-spinner")).toBeVisible();
  await expect(disclosure(row)).toHaveCount(0);
  release();
  await expect(disclosure(row)).toHaveCount(1);
  await expect(status).toHaveCount(0);
  await expect(badge(row)).toHaveText("Spatial reference 4326");
});

test("the bar and rows say \"layers\" on a layer page with sub-layer rows", async ({ page, fakeServer }) => {
  const parcels = catalog.services.find((service) => service.name === "Parcels" && service.type === "MapServer");
  fakeServer.override(/^\/arcgis\/rest\/services\/Parcels\/MapServer\/0$/, () => html(layerPage(parcels, parcels.layers[0]).replace(
    "<b>Fields: </b>",
    "<b>Sub Layers: </b>\n<ul>\n<li><a href=\"/arcgis/rest/services/Parcels/MapServer/1\">Addresses</a></li>\n</ul>\n<b>Fields: </b>"
  )));
  await page.goto(`${REST_ROOT}/Parcels/MapServer/0`);
  await expect(message(page)).toHaveText("Loaded details for 1 layer in 3 requests");
  await expect(disclosure(serviceRow(page, "Parcels/MapServer/1"))).toHaveCount(1);
  await page.goto(`${REST_ROOT}/Parcels/MapServer`);
  await expect(message(page)).toHaveText("Loaded details for 2 layers in 6 requests");
});

// Per-layer counts (design review 6.6): one line with the row, with a data source's limits as a note.
const PARCELS_MAPSERVER = `${REST_ROOT}/Parcels/MapServer`;
const LAYER = "Parcels/MapServer/0";
const layerQuery = (field, id = 0) => new RegExp(`^/arcgis/rest/services/Parcels/MapServer/${id}/query\\?.*where=${field}`);
const layerJson = (id) => new RegExp(`^/arcgis/rest/services/Parcels/MapServer/${id}\\?f=json$`);
const countsOf = (row) => row.locator(".sdt-annot .sdt-count");
const warnBadge = (row) => row.locator(".sdt-annot .sdt-badge--warn");
const errorLine = (row) => row.locator(".sdt-annot .sdt-status[data-tone=\"error\"]");
const noteLine = (row) => row.locator(".sdt-annot .sdt-muted");
const nullBody = () => ({ status: 200, contentType: "application/json", body: "null" });
// Truthy with a length, so the row counts it, and not iterable, so counting throws after Details is drawn.
const NO_ITERABLE_FIELDS = { id: 0, name: "Parcels", type: "Feature Layer", spatialReference: { wkid: 4326 }, fields: { length: 1 } };
const countCalls = (fakeServer, where) => fakeServer.calls.filter((call) => call.path === `/arcgis/rest/services/${LAYER}/query` && call.query.where === where);

/** A services root of 48 one-request rows and one layer: the layer's total is request 50, and its shape count is refused. */
const cutOffRoot = (fakeServer) => {
  const services = Array.from({ length: 48 }, (_, i) => ({ name: `Bulk${String(i + 1).padStart(2, "0")}`, type: "MapServer" }));
  services.push({ name: "Parcels", type: "MapServer/0" });
  fakeServer.override(/^\/arcgis\/rest\/services$/, () => html(folderPage({ folder: "", folders: [], services, version: catalog.currentVersion })));
  fakeServer.override(/^\/arcgis\/rest\/services\/Bulk\d+\/MapServer\?f=json$/, () => json({ currentVersion: catalog.currentVersion, spatialReference: { wkid: 4326 } }));
};
const loadMore = (page) => page.locator(".sdt-statusbar").getByRole("button", { name: "Load 1 more service" });

test("a layer row shows \"3 features\" and \"2 with shapes\" inline, in order", async ({ page }) => {
  await page.goto(PARCELS_MAPSERVER);
  const row = serviceRow(page, LAYER);
  await expect(countsOf(row)).toHaveText(["3 features", "2 with shapes"]);
  await expect(countsOf(row).locator("b")).toHaveText(["3", "2"]);
  const children = await row.locator(".sdt-annot").evaluate((annot) => [...annot.children].map((child) => child.className));
  expect(children).toEqual(["sdt-badge sdt-badge--sr sdt-badge--sr2", "sdt-count", "sdt-count"]);
  await expect(row.locator("ul")).toHaveCount(0);
});

test("a large count is grouped the Canadian English way", async ({ page, fakeServer }) => {
  fakeServer.override(layerQuery("OBJECTID"), () => json({ count: 1234567 }));
  await page.goto(PARCELS_MAPSERVER);
  await expect(countsOf(serviceRow(page, LAYER)).first()).toHaveText("1,234,567 features");
});

test("a table row shows the neutral Table badge where the cache badge goes", async ({ page, fakeServer }) => {
  fakeServer.override(layerJson(1), () => json({ id: 1, name: "Addresses", type: "Table", objectIdField: "OBJECTID", fields: [{ name: "OBJECTID", type: "esriFieldTypeOID" }] }));
  fakeServer.override(layerQuery("OBJECTID", 1), () => json({ count: 58 }));
  await page.goto(PARCELS_MAPSERVER);
  const row = serviceRow(page, "Parcels/MapServer/1");
  await expect(countsOf(row)).toHaveText(["58 rows"]);
  await expect(cacheBadge(row)).toHaveText("Table");
  expect(await cacheBadge(row).getAttribute("class")).toBe("sdt-badge");
  const children = await row.locator(".sdt-annot").evaluate((annot) => [...annot.children].map((child) => child.className));
  expect(children).toEqual(["sdt-badge", "sdt-count"]);
});

test("a table row says rows, and one feature says \"1 feature\"", async ({ page, fakeServer }) => {
  fakeServer.override(layerJson(1), () => json({ id: 1, name: "Addresses", type: "Table", objectIdField: "OBJECTID", fields: [{ name: "OBJECTID", type: "esriFieldTypeOID" }] }));
  fakeServer.override(layerQuery("OBJECTID", 1), () => json({ count: 58 }));
  fakeServer.override(layerQuery("OBJECTID"), () => json({ count: 1 }));
  await page.goto(PARCELS_MAPSERVER);
  await expect(countsOf(serviceRow(page, "Parcels/MapServer/1"))).toHaveText(["58 rows"]);
  await expect(countsOf(serviceRow(page, LAYER)).first()).toHaveText("1 feature");
});

test("one table row says \"1 row\"", async ({ page, fakeServer }) => {
  fakeServer.override(layerJson(1), () => json({ id: 1, name: "Addresses", type: "Table", objectIdField: "OBJECTID", fields: [{ name: "OBJECTID", type: "esriFieldTypeOID" }] }));
  fakeServer.override(layerQuery("OBJECTID", 1), () => json({ count: 1 }));
  await page.goto(PARCELS_MAPSERVER);
  await expect(countsOf(serviceRow(page, "Parcels/MapServer/1"))).toHaveText(["1 row"]);
});

test("zero features shows the warning badge, with the icon and hidden \"Warning: \"", async ({ page, fakeServer }) => {
  fakeServer.override(layerQuery("OBJECTID"), () => json({ count: 0 }));
  fakeServer.override(layerQuery("SHAPE"), () => json({ count: 0 }));
  await page.goto(PARCELS_MAPSERVER);
  const row = serviceRow(page, LAYER);
  await expect(warnBadge(row)).toHaveText("Warning: 0 features");
  await expect(warnBadge(row).locator("svg.sdt-icon")).toHaveAttribute("aria-hidden", "true");
  await expect(warnBadge(row).locator(".sdt-visually-hidden")).toHaveText("Warning: ");
  // Only features get the warning: a shape count of zero is an ordinary count.
  await expect(countsOf(row)).toHaveText(["0 with shapes"]);
});

test("zero rows in a table shows the warning badge", async ({ page, fakeServer }) => {
  fakeServer.override(layerJson(1), () => json({ id: 1, name: "Addresses", type: "Table", objectIdField: "OBJECTID", fields: [{ name: "OBJECTID", type: "esriFieldTypeOID" }] }));
  fakeServer.override(layerQuery("OBJECTID", 1), () => json({ count: 0 }));
  await page.goto(PARCELS_MAPSERVER);
  await expect(warnBadge(serviceRow(page, "Parcels/MapServer/1"))).toHaveText("Warning: 0 rows");
});

test("while counts run the row says \"Counting features\"", async ({ page, fakeServer }) => {
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  fakeServer.override(layerQuery("OBJECTID"), async () => {
    await held;
    return json({ count: 3 });
  });
  await page.goto(PARCELS_MAPSERVER);
  const row = serviceRow(page, LAYER);
  const status = row.locator(".sdt-annot .sdt-status");
  await expect(status).toHaveText("Counting features");
  await expect(status.locator(".sdt-spinner")).toBeVisible();
  const children = await row.locator(".sdt-annot").evaluate((annot) => [...annot.children].map((child) => child.classList[0]));
  expect(children).toEqual(["sdt-badge", "sdt-status"]);
  release();
  await expect(status).toHaveCount(0);
  await expect(countsOf(row)).toHaveText(["3 features", "2 with shapes"]);
});

for (const [title, answer] of [
  ["an HTTP 400", () => ({ status: 400, contentType: "text/plain", body: "Bad request" })],
  ["an ArcGIS code 400", () => json({ error: { code: 400, message: "Unable to complete operation.", details: [] } })],
  ["an ArcGIS Code 400 with a capital", () => json({ error: { Code: 400, message: "Unable to complete operation." } })]
]) {
  test(`${title} on the shape count shows the muted note, offers no Retry, and the row counts as done`, async ({ page, fakeServer, expectedErrors }) => {
    expectedErrors.push(/status of 400/);
    fakeServer.override(layerQuery("SHAPE"), answer);
    await page.goto(PARCELS_MAPSERVER);
    const row = serviceRow(page, LAYER);
    await expect(noteLine(row)).toHaveText("Shape count not supported by this data source");
    await expect(countsOf(row)).toHaveText(["3 features"]);
    await expect(errorLine(row)).toHaveCount(0);
    await expect(row.getByRole("button")).toHaveCount(0);
    await expect(message(page)).toHaveText("Loaded details for 2 layers in 6 requests");
  });
}

test("the shapefile code -2147220985 does the same, and the feature count stays", async ({ page, fakeServer }) => {
  fakeServer.override(layerQuery("SHAPE"), () => json({ error: { code: -2147220985, message: "Unable to complete operation.", details: [] } }));
  await page.goto(PARCELS_MAPSERVER);
  const row = serviceRow(page, LAYER);
  await expect(noteLine(row)).toHaveText("Shape count not supported by this data source");
  await expect(countsOf(row)).toHaveText(["3 features"]);
  await expect(row.getByRole("button")).toHaveCount(0);
  await expect(message(page)).toHaveText("Loaded details for 2 layers in 6 requests");
});

test("a feature count 400 says \"Feature count not supported by this data source\"", async ({ page, fakeServer }) => {
  fakeServer.override(layerQuery("OBJECTID"), () => json({ error: { code: 400, message: "Unable to complete operation.", details: [] } }));
  await page.goto(PARCELS_MAPSERVER);
  const row = serviceRow(page, LAYER);
  await expect(noteLine(row)).toHaveText("Feature count not supported by this data source");
  await expect(countsOf(row)).toHaveText(["2 with shapes"]);
  await expect(warnBadge(row)).toHaveCount(0);
});

test("an HTTP 500 on the shape count shows \"Shape count failed: HTTP 500\" beside the feature count", async ({ page, fakeServer, expectedErrors }) => {
  expectedErrors.push(/status of 500/);
  fakeServer.override(layerQuery("SHAPE"), () => ({ status: 500, contentType: "text/plain", body: "Oops" }));
  await page.goto(PARCELS_MAPSERVER);
  const row = serviceRow(page, LAYER);
  await expect(errorLine(row)).toHaveText("Shape count failed: HTTP 500");
  await expect(errorLine(row).locator("svg.sdt-icon")).toHaveAttribute("aria-hidden", "true");
  await expect(countsOf(row)).toHaveText(["3 features"]);
  await expect(disclosure(row)).toHaveCount(1);
  const children = await row.locator(".sdt-annot").evaluate((annot) => [...annot.children].map((child) => child.classList[0]));
  expect(children).toEqual(["sdt-badge", "sdt-count", "sdt-status", "sdt-button"]);
  await expect(message(page)).toHaveText("Loaded details for 1 layer in 6 requests. 1 failed.");
});

for (const [title, answer] of [
  ["literal null", nullBody],
  ["an object with no count", () => json({ objectIds: [] })],
  ["a count that isn't a number", () => json({ count: "3" })]
]) {
  test(`a count body of ${title} shows "Feature count failed: The server's answer was not a count."`, async ({ page, fakeServer }) => {
    fakeServer.override(layerQuery("OBJECTID"), answer);
    await page.goto(PARCELS_MAPSERVER);
    const row = serviceRow(page, LAYER);
    await expect(errorLine(row)).toHaveText("Feature count failed: The server's answer was not a count.");
    await expect(countsOf(row)).toHaveText(["2 with shapes"]);
    await expect(message(page)).toHaveText("Loaded details for 1 layer in 6 requests. 1 failed.");
  });
}

test("a row whose JSON is an error shows \"Details unavailable\" in the annot, with the server's message", async ({ page, fakeServer }) => {
  fakeServer.override(PARCELS_JSON, () => json({ error: { code: 499, message: "Token Required", details: [] } }));
  await page.goto(REST_ROOT);
  const row = serviceRow(page, "Parcels/MapServer");
  await expect(errorLine(row)).toHaveText("Details unavailable: Token Required");
  await expect(errorLine(row).locator("svg.sdt-icon")).toHaveCount(1);
  await expect(disclosure(row)).toHaveCount(0);
});

for (const [title, answer] of [
  ["literal null", nullBody],
  ["an array", () => json([])]
]) {
  test(`a row whose JSON is ${title} says it was not a service description`, async ({ page, fakeServer }) => {
    fakeServer.override(PARCELS_JSON, answer);
    await page.goto(REST_ROOT);
    const row = serviceRow(page, "Parcels/MapServer");
    await expect(errorLine(row)).toHaveText("Details unavailable: The server's answer was not a service description.");
    await expect(disclosure(row)).toHaveCount(0);
  });
}

test("a row that can't be drawn says so in its annot, and keeps no half-drawn badge", async ({ page, fakeServer }) => {
  fakeServer.override(PARCELS_JSON, () => json({ description: { toString: null }, spatialReference: { wkid: 4326 } }));
  await page.goto(REST_ROOT);
  const row = serviceRow(page, "Parcels/MapServer");
  await expect(errorLine(row)).toHaveText("Details unavailable: Could not show this row's details.");
  await expect(badge(row)).toHaveCount(0);
  await expect(disclosure(row)).toHaveCount(0);
  // Its JSON is dropped, so there is something to re-send.
  await expect(row.locator(".sdt-annot").getByRole("button", { name: "Retry details for Parcels", exact: true })).toHaveCount(1);
});

test("a row that fails after its Details is drawn keeps them, with the error beside them", async ({ page, fakeServer }) => {
  fakeServer.override(layerJson(0), () => json(NO_ITERABLE_FIELDS));
  await page.goto(PARCELS_MAPSERVER);
  const row = serviceRow(page, LAYER);
  await expect(errorLine(row)).toHaveText("Details unavailable: Could not show this row's details.");
  await expect(disclosure(row)).toHaveCount(1);
  await expect(badge(row)).toHaveCount(1);
  await expect(row.locator(".sdt-spinner")).toHaveCount(0);
});

test("a null in a layer's fields gives the field notes, not a failed row", async ({ page, fakeServer }) => {
  fakeServer.override(layerJson(0), () => json({ id: 0, name: "Parcels", type: "Feature Layer", spatialReference: { wkid: 4326 }, fields: [null] }));
  await page.goto(PARCELS_MAPSERVER);
  const row = serviceRow(page, LAYER);
  await expect(noteLine(row)).toHaveText(["No way to query features.", "No visible shape field available."]);
  await expect(errorLine(row)).toHaveCount(0);
  await expect(disclosure(row)).toHaveCount(1);
});

test("a layer with no shape field and no object ID says so, in muted text, and sends no count", async ({ page, fakeServer }) => {
  fakeServer.override(layerJson(0), () => json({ id: 0, name: "Parcels", type: "Feature Layer", geometryType: "esriGeometryPolygon", fields: [{ name: "NAME", type: "esriFieldTypeString" }] }));
  await page.goto(PARCELS_MAPSERVER);
  const row = serviceRow(page, LAYER);
  await expect(noteLine(row)).toHaveText(["No way to query features.", "No visible shape field available."]);
  await expect(row.locator(".sdt-annot .sdt-status")).toHaveCount(0);
  expect(fakeServer.calls.filter((call) => call.path === `/arcgis/rest/services/${LAYER}/query`)).toEqual([]);
});

test("a table with no shape field has no shape note", async ({ page, fakeServer }) => {
  fakeServer.override(layerJson(1), () => json({ id: 1, name: "Addresses", type: "Table", objectIdField: "OBJECTID", fields: [{ name: "OBJECTID", type: "esriFieldTypeOID" }] }));
  fakeServer.override(layerQuery("OBJECTID", 1), () => json({ count: 58 }));
  await page.goto(PARCELS_MAPSERVER);
  const row = serviceRow(page, "Parcels/MapServer/1");
  await expect(countsOf(row)).toHaveText(["58 rows"]);
  await expect(noteLine(row)).toHaveCount(0);
});

test("a row cut off mid-chain shows the total, and Load more adds the shape count after it", async ({ page, fakeServer }) => {
  cutOffRoot(fakeServer);
  await page.goto(REST_ROOT);
  const row = serviceRow(page, LAYER);
  await expect(countsOf(row)).toHaveText(["3 features"]);
  await expect(loadMore(page)).toBeVisible();
  await expect(row.locator(".sdt-annot .sdt-status")).toHaveCount(0);
  await loadMore(page).press("Enter");
  await expect(countsOf(row)).toHaveText(["3 features", "2 with shapes"]);
  expect(countCalls(fakeServer, "OBJECTID IS NOT NULL")).toHaveLength(1);
  expect(countCalls(fakeServer, "SHAPE IS NOT NULL")).toHaveLength(1);
});

test("a skipped row's failed count goes again on Load more", async ({ page, fakeServer, expectedErrors }) => {
  expectedErrors.push(/status of 500/);
  cutOffRoot(fakeServer);
  let calls = 0;
  fakeServer.override(layerQuery("OBJECTID"), () => {
    calls += 1;
    return calls === 1 ? { status: 500, contentType: "text/plain", body: "Oops" } : json({ count: 3 });
  });
  await page.goto(REST_ROOT);
  const row = serviceRow(page, LAYER);
  await expect(errorLine(row)).toHaveText("Feature count failed: HTTP 500");
  // A row with a skipped request is Load more's: Retry is only for a row that failed outright.
  await expect(row.getByRole("button")).toHaveCount(0);
  await loadMore(page).press("Enter");
  await expect(countsOf(row)).toHaveText(["3 features", "2 with shapes"]);
  await expect(errorLine(row)).toHaveCount(0);
  expect(calls).toBe(2);
});

test("Load more adding a count leaves an open Details open, and focus stays on its summary", async ({ page, fakeServer }) => {
  cutOffRoot(fakeServer);
  await page.goto(REST_ROOT);
  const row = serviceRow(page, LAYER);
  await expect(countsOf(row)).toHaveText(["3 features"]);
  const details = disclosure(row);
  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
  await details.evaluate((element) => {
    element.dataset.sameNode = "yes";
  });
  await details.locator("summary").focus();
  // A click from a script, so the press doesn't move focus to the button.
  await loadMore(page).evaluate((button) => button.click());
  await expect(countsOf(row)).toHaveText(["3 features", "2 with shapes"]);
  await expect(details).toHaveAttribute("open", "");
  await expect(details).toHaveAttribute("data-same-node", "yes");
  await expect(details.locator("summary")).toBeFocused();
});

test("focus on a row's badge link stays there when a count arrives", async ({ page, fakeServer }) => {
  cutOffRoot(fakeServer);
  await page.goto(REST_ROOT);
  const row = serviceRow(page, LAYER);
  await expect(countsOf(row)).toHaveText(["3 features"]);
  await badge(row).focus();
  await loadMore(page).evaluate((button) => button.click());
  await expect(countsOf(row)).toHaveText(["3 features", "2 with shapes"]);
  await expect(badge(row)).toBeFocused();
});

test("with autoFeatureCounts off, a layer row has no counts and no \"Counting features\"", async ({ page, fakeServer, seedStorage }) => {
  await seedStorage({ autoFeatureCounts: false });
  await page.goto(PARCELS_MAPSERVER);
  const row = serviceRow(page, LAYER);
  await expect(disclosure(row)).toHaveCount(1);
  await expect(message(page)).toHaveText("Loaded details for 2 layers in 2 requests");
  await expect(countsOf(row)).toHaveCount(0);
  await expect(page.getByText("Counting features")).toHaveCount(0);
  await expect(warnBadge(row)).toHaveCount(0);
  expect(fakeServer.calls.filter((call) => call.query.returnCountOnly === "true")).toEqual([]);
});

// Retry (design review 6.5): on a failed row or count, through the limiter, with focus looked after.
const PARCELS_ROW = "Parcels/MapServer";
const BAD_GATEWAY = () => ({ status: 502, contentType: "text/html", body: "<html><body>Bad Gateway</body></html>" });
const OOPS = () => ({ status: 500, contentType: "text/plain", body: "Oops" });
const NOT_SUPPORTED = () => json({ error: { code: 400, message: "Unable to complete operation.", details: [] } });
const parcelsCalls = (fakeServer) => fakeServer.calls.filter((call) => call.path === `/arcgis/rest/services/${PARCELS_ROW}`);
const layerCalls = (fakeServer) => fakeServer.calls.filter((call) => call.path === `/arcgis/rest/services/${LAYER}`);
const retryButton = (row) => row.locator(".sdt-annot").getByRole("button");
const SERVICE = () => json({ serviceDescription: "Back again.", spatialReference: { wkid: 4326 } });

/** Answers the first call with first and every later one with later, as a promise the test can hold. */
const thenAnswer = (first, later) => {
  let calls = 0;
  let release = () => {};
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const handler = async () => {
    calls += 1;
    if (calls === 1) {
      return first();
    }
    await held;
    return later();
  };
  return { handler, release: () => release() };
};

test("the Retry button's name is \"Retry details for {name}\", and it follows the error line", async ({ page, fakeServer, expectedErrors }) => {
  expectedErrors.push(/status of 502/);
  fakeServer.override(PARCELS_JSON, BAD_GATEWAY);
  await page.goto(REST_ROOT);
  const row = serviceRow(page, PARCELS_ROW);
  await expect(errorLine(row)).toHaveText("Details unavailable: HTTP 502");
  const button = row.getByRole("button", { name: "Retry details for Parcels", exact: true });
  await expect(button).toHaveText("Retry details for Parcels");
  await expect(button.locator(".sdt-visually-hidden")).toHaveText(" details for Parcels", { useInnerText: false });
  expect(await button.getAttribute("class")).toBe("sdt-button sdt-button--quiet");
  expect(await button.getAttribute("type")).toBe("button");
  const children = await row.locator(".sdt-annot").evaluate((annot) => [...annot.children].map((child) => child.classList[0]));
  expect(children).toEqual(["sdt-status", "sdt-button"]);
});

test("a shape count that failed names its Retry for the shape count", async ({ page, fakeServer, expectedErrors }) => {
  expectedErrors.push(/status of 500/);
  fakeServer.override(layerQuery("SHAPE"), OOPS);
  await page.goto(PARCELS_MAPSERVER);
  await expect(serviceRow(page, LAYER).getByRole("button", { name: "Retry shape count for Parcels", exact: true })).toHaveCount(1);
});

test("two failed counts get one Retry, named for the feature count, and it re-sends both", async ({ page, fakeServer, expectedErrors }) => {
  expectedErrors.push(/status of 500/);
  const total = thenAnswer(OOPS, () => json({ count: 3 }));
  const shape = thenAnswer(OOPS, () => json({ count: 2 }));
  total.release();
  shape.release();
  fakeServer.override(layerQuery("OBJECTID"), total.handler);
  fakeServer.override(layerQuery("SHAPE"), shape.handler);
  await page.goto(PARCELS_MAPSERVER);
  const row = serviceRow(page, LAYER);
  await expect(errorLine(row)).toHaveText(["Feature count failed: HTTP 500", "Shape count failed: HTTP 500"]);
  await expect(retryButton(row)).toHaveCount(1);
  const button = row.getByRole("button", { name: "Retry feature count for Parcels", exact: true });
  await button.press("Enter");
  await expect(countsOf(row)).toHaveText(["3 features", "2 with shapes"]);
  await expect(retryButton(row)).toHaveCount(0);
  expect(countCalls(fakeServer, "OBJECTID IS NOT NULL")).toHaveLength(2);
  expect(countCalls(fakeServer, "SHAPE IS NOT NULL")).toHaveLength(2);
  await expect(message(page)).toHaveText("Loaded details for 2 layers in 8 requests");
});

test("a data source's limit beside a failed count reads \"1 failed\", and Retry sends only the failed count", async ({ page, fakeServer, expectedErrors }) => {
  expectedErrors.push(/status of 500/);
  fakeServer.override(layerQuery("SHAPE"), NOT_SUPPORTED);
  const total = thenAnswer(OOPS, () => json({ count: 3 }));
  total.release();
  fakeServer.override(layerQuery("OBJECTID"), total.handler);
  await page.goto(PARCELS_MAPSERVER);
  const row = serviceRow(page, LAYER);
  await expect(noteLine(row)).toHaveText("Shape count not supported by this data source");
  await expect(errorLine(row)).toHaveText("Feature count failed: HTTP 500");
  await expect(message(page)).toHaveText("Loaded details for 1 layer in 6 requests. 1 failed.");
  await row.getByRole("button", { name: "Retry feature count for Parcels", exact: true }).press("Enter");
  await expect(countsOf(row)).toHaveText(["3 features"]);
  await expect(noteLine(row)).toHaveText("Shape count not supported by this data source");
  await expect(retryButton(row)).toHaveCount(0);
  expect(countCalls(fakeServer, "SHAPE IS NOT NULL")).toHaveLength(1);
  expect(countCalls(fakeServer, "OBJECTID IS NOT NULL")).toHaveLength(2);
  await expect(message(page)).toHaveText("Loaded details for 2 layers in 7 requests");
});

test("a request a data source can't answer stays unsent on Load more, and the skipped count goes", async ({ page, fakeServer }) => {
  // The layer's total is request 50 and answers "not supported"; the budget refuses its shape count.
  cutOffRoot(fakeServer);
  fakeServer.override(layerQuery("OBJECTID"), NOT_SUPPORTED);
  await page.goto(REST_ROOT);
  const row = serviceRow(page, LAYER);
  await expect(noteLine(row)).toHaveText("Feature count not supported by this data source");
  await loadMore(page).press("Enter");
  await expect(countsOf(row)).toHaveText(["2 with shapes"]);
  await expect(noteLine(row)).toHaveText("Feature count not supported by this data source");
  expect(countCalls(fakeServer, "OBJECTID IS NOT NULL")).toHaveLength(1);
  expect(countCalls(fakeServer, "SHAPE IS NOT NULL")).toHaveLength(1);
});

test("a 502 then success: Retry shows the row, and the bar says \"Loaded details for N services in M requests\" with no \"failed\"", async ({ page, fakeServer, expectedErrors }) => {
  expectedErrors.push(/status of 502/);
  const answers = thenAnswer(BAD_GATEWAY, SERVICE);
  answers.release();
  fakeServer.override(PARCELS_JSON, answers.handler);
  await page.goto(REST_ROOT);
  const row = serviceRow(page, PARCELS_ROW);
  await expect(message(page)).toHaveText("Loaded details for 2 services in 3 requests. 1 failed.");
  await retryButton(row).press("Enter");
  await expect(disclosure(row)).toHaveCount(1);
  await expect(errorLine(row)).toHaveCount(0);
  await expect(retryButton(row)).toHaveCount(0);
  await expect(message(page)).toHaveText("Loaded details for 3 services in 4 requests");
});

test("Retry sends only what is missing", async ({ page, fakeServer, expectedErrors }) => {
  expectedErrors.push(/status of 500/);
  const shape = thenAnswer(OOPS, () => json({ count: 2 }));
  shape.release();
  fakeServer.override(layerQuery("SHAPE"), shape.handler);
  await page.goto(PARCELS_MAPSERVER);
  const row = serviceRow(page, LAYER);
  await expect(errorLine(row)).toHaveText("Shape count failed: HTTP 500");
  await retryButton(row).press("Enter");
  await expect(countsOf(row)).toHaveText(["3 features", "2 with shapes"]);
  await expect(errorLine(row)).toHaveCount(0);
  expect(countCalls(fakeServer, "SHAPE IS NOT NULL")).toHaveLength(2);
  expect(countCalls(fakeServer, "OBJECTID IS NOT NULL")).toHaveLength(1);
  expect(layerCalls(fakeServer)).toHaveLength(1);
  await expect(message(page)).toHaveText("Loaded details for 2 layers in 7 requests");
});

test("a row that failed with its Details drawn offers no Retry, because nothing is missing to re-send", async ({ page, fakeServer }) => {
  fakeServer.override(layerJson(0), () => json(NO_ITERABLE_FIELDS));
  await page.goto(PARCELS_MAPSERVER);
  const row = serviceRow(page, LAYER);
  await expect(errorLine(row)).toHaveText("Details unavailable: Could not show this row's details.");
  await expect(message(page)).toHaveText("Loaded details for 1 layer in 4 requests. 1 failed.");
  await expect(disclosure(row)).toHaveCount(1);
  await expect(retryButton(row)).toHaveCount(0);
});

test("a running Retry stays one node, connected and focused, through every redraw", async ({ page, fakeServer, expectedErrors }) => {
  expectedErrors.push(/status of 502/);
  const details = thenAnswer(BAD_GATEWAY, () => json({
    id: 0,
    name: "Parcels",
    type: "Feature Layer",
    objectIdField: "OBJECTID",
    spatialReference: { wkid: 4326 },
    fields: [{ name: "OBJECTID", type: "esriFieldTypeOID" }, { name: "SHAPE", type: "esriFieldTypeGeometry" }]
  }));
  let releaseShape;
  const shapeHeld = new Promise((resolve) => {
    releaseShape = resolve;
  });
  fakeServer.override(layerJson(0), details.handler);
  await page.goto(PARCELS_MAPSERVER);
  const row = serviceRow(page, LAYER);
  await expect(errorLine(row)).toHaveText("Details unavailable: HTTP 502");
  fakeServer.override(layerQuery("SHAPE"), async () => {
    await shapeHeld;
    return json({ count: 2 });
  });
  await page.evaluate(() => {
    window.sdtFocusins = 0;
    document.addEventListener("focusin", () => {
      window.sdtFocusins += 1;
    });
  });
  const button = await retryButton(row).elementHandle();
  await button.focus();
  await page.keyboard.press("Enter");
  const stillTheOne = () => button.evaluate((element) => ({ connected: element.isConnected, focused: element === document.activeElement, disabled: element.getAttribute("aria-disabled") }));
  await expect(row.locator(".sdt-annot .sdt-status")).toHaveText("Loading details");
  expect(await stillTheOne()).toEqual({ connected: true, focused: true, disabled: "true" });
  details.release();
  await expect(row.locator(".sdt-annot .sdt-status")).toHaveText("Counting features");
  expect(await stillTheOne()).toEqual({ connected: true, focused: true, disabled: "true" });
  const children = await row.locator(".sdt-annot").evaluate((annot) => [...annot.children].map((child) => child.classList[0]));
  expect(children).toEqual(["sdt-badge", "sdt-status", "sdt-button"]);
  await expect(retryButton(row)).toHaveText("Retry details for Parcels");
  expect(await page.evaluate(() => window.sdtFocusins)).toBe(1);
  releaseShape();
  await expect(disclosure(row).locator("summary")).toBeFocused();
});

test("Retry that fails again keeps focus on the new Retry button", async ({ page, fakeServer, expectedErrors }) => {
  expectedErrors.push(/status of 502/);
  fakeServer.override(PARCELS_JSON, BAD_GATEWAY);
  await page.goto(REST_ROOT);
  const row = serviceRow(page, PARCELS_ROW);
  const first = await retryButton(row).elementHandle();
  await retryButton(row).press("Enter");
  await expect.poll(() => parcelsCalls(fakeServer).length).toBe(2);
  await expect(retryButton(row)).not.toHaveAttribute("aria-disabled", "true");
  await expect(retryButton(row)).toBeFocused();
  expect(await first.evaluate((element) => element.isConnected)).toBe(false);
  await expect(errorLine(row)).toHaveText("Details unavailable: HTTP 502");
  await expect(message(page)).toHaveText("Loaded details for 2 services in 4 requests. 1 failed.");
});

test("Retry that succeeds moves focus to the row's summary", async ({ page, fakeServer, expectedErrors }) => {
  expectedErrors.push(/status of 502/);
  const answers = thenAnswer(BAD_GATEWAY, SERVICE);
  answers.release();
  fakeServer.override(PARCELS_JSON, answers.handler);
  await page.goto(REST_ROOT);
  const row = serviceRow(page, PARCELS_ROW);
  await retryButton(row).press("Enter");
  await expect(disclosure(row).locator("summary")).toBeFocused();
});

test("Retry that succeeds leaves focus alone if the user has moved on", async ({ page, fakeServer, expectedErrors }) => {
  expectedErrors.push(/status of 502/);
  const answers = thenAnswer(BAD_GATEWAY, SERVICE);
  fakeServer.override(PARCELS_JSON, answers.handler);
  await page.goto(REST_ROOT);
  const row = serviceRow(page, PARCELS_ROW);
  await retryButton(row).press("Enter");
  await expect(retryButton(row)).toHaveAttribute("aria-disabled", "true");
  const elsewhere = disclosure(serviceRow(page, "Parcels/FeatureServer")).locator("summary");
  await elsewhere.focus();
  answers.release();
  await expect(disclosure(row)).toHaveCount(1);
  await expect(retryButton(row)).toHaveCount(0);
  await expect(elsewhere).toBeFocused();
});

test("Retry cut off by leaving the page moves focus to the row's link, which has no summary", async ({ page, fakeServer, expectedErrors }) => {
  expectedErrors.push(/status of 502/);
  const answers = thenAnswer(BAD_GATEWAY, SERVICE);
  fakeServer.override(PARCELS_JSON, answers.handler);
  await page.goto(REST_ROOT);
  const row = serviceRow(page, PARCELS_ROW);
  await retryButton(row).press("Enter");
  await expect(retryButton(row)).toHaveAttribute("aria-disabled", "true");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await expect(retryButton(row)).toHaveCount(0);
  await expect(row.getByRole("link", { name: "Parcels", exact: true })).toBeFocused();
  answers.release();
});

test("a second press while a Retry runs sends nothing, and the button stays focused", async ({ page, fakeServer, expectedErrors }) => {
  expectedErrors.push(/status of 502/);
  const answers = thenAnswer(BAD_GATEWAY, SERVICE);
  fakeServer.override(PARCELS_JSON, answers.handler);
  await page.goto(REST_ROOT);
  const row = serviceRow(page, PARCELS_ROW);
  await retryButton(row).press("Enter");
  const running = row.getByRole("button", { name: "Retry details for Parcels", exact: true });
  await expect(running).toHaveAttribute("aria-disabled", "true");
  await expect(running).toBeFocused();
  await expect(row.locator(".sdt-annot .sdt-status")).toHaveText("Loading details");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  expect(parcelsCalls(fakeServer)).toHaveLength(2);
  await expect(running).toBeFocused();
  answers.release();
  await expect(disclosure(row).locator("summary")).toBeFocused();
  expect(parcelsCalls(fakeServer)).toHaveLength(2);
});

test("a running Retry on a count keeps focus through each redraw", async ({ page, fakeServer, expectedErrors }) => {
  expectedErrors.push(/status of 500/);
  const shape = thenAnswer(OOPS, () => json({ count: 2 }));
  fakeServer.override(layerQuery("SHAPE"), shape.handler);
  await page.goto(PARCELS_MAPSERVER);
  const row = serviceRow(page, LAYER);
  await retryButton(row).press("Enter");
  await expect(row.locator(".sdt-annot .sdt-status")).toHaveText("Counting features");
  const running = row.getByRole("button", { name: "Retry shape count for Parcels", exact: true });
  await expect(running).toHaveAttribute("aria-disabled", "true");
  await expect(running).toBeFocused();
  shape.release();
  await expect(disclosure(row).locator("summary")).toBeFocused();
});

test("a running Retry doesn't underline when hovered, because it does nothing", async ({ page, fakeServer, expectedErrors, seedStorage }) => {
  expectedErrors.push(/status of 502/);
  await seedStorage({ showMapImages: false });
  const answers = thenAnswer(BAD_GATEWAY, SERVICE);
  fakeServer.override(PARCELS_JSON, answers.handler);
  await page.goto(REST_ROOT);
  const row = serviceRow(page, PARCELS_ROW);
  await retryButton(row).press("Enter");
  await expect(retryButton(row)).toHaveAttribute("aria-disabled", "true");
  await retryButton(row).hover();
  expect(await retryButton(row).evaluate((element) => getComputedStyle(element).textDecorationLine)).toBe("none");
  answers.release();
  await expect(disclosure(row)).toHaveCount(1);
});

// Accessibility (design review 6.4 to 6.6): axe over the rows, keyboard order and target size.
const NO_VIOLATIONS = { light: [], dark: [] };
const ROW_PARTS = ".sdt-annot, .sdt-details";

/** A layer row that has the warning badge, a failed shape count with Retry, and an open Details. */
const failedLayerRow = async (page, fakeServer, expectedErrors) => {
  expectedErrors.push(/status of 500/);
  fakeServer.override(layerQuery("OBJECTID"), () => json({ count: 0 }));
  fakeServer.override(layerQuery("SHAPE"), OOPS);
  await page.goto(PARCELS_MAPSERVER);
  const row = serviceRow(page, LAYER);
  await expect(retryButton(row)).toHaveCount(1);
  return row;
};

test("axe passes on a loaded root page's rows, and on a service page with counts, in light and dark, on a light and a dark host page", async ({ page }) => {
  await page.goto(REST_ROOT);
  await expect(disclosure(page.locator("li")).first()).toHaveCount(1);
  await expect(page.locator(".sdt-details")).toHaveCount(3);
  expect(await axeViolations(page, { include: ROW_PARTS, hostPage: true })).toEqual(NO_VIOLATIONS);
  await page.goto(PARCELS_MAPSERVER);
  await expect(countsOf(serviceRow(page, LAYER))).toHaveCount(2);
  expect(await axeViolations(page, { include: ROW_PARTS, hostPage: true })).toEqual(NO_VIOLATIONS);
});

test("axe passes on a failed row with Retry, a warning badge, and an open disclosure", async ({ page, fakeServer, expectedErrors }) => {
  const row = await failedLayerRow(page, fakeServer, expectedErrors);
  await expect(warnBadge(row)).toHaveCount(1);
  await disclosure(row).locator("summary").click();
  await expect(disclosure(row)).toHaveAttribute("open", "");
  expect(await axeViolations(page, { include: ROW_PARTS, hostPage: true })).toEqual(NO_VIOLATIONS);
});

test("every interactive part of a row is reachable by keyboard alone, in order: link, badge link, Retry, summary", async ({ page, fakeServer, expectedErrors }) => {
  const row = await failedLayerRow(page, fakeServer, expectedErrors);
  const names = [];
  await row.getByRole("link").first().focus();
  for (let i = 0; i < 4; i += 1) {
    names.push(await page.evaluate(() => {
      const element = document.activeElement;
      return `${element.tagName.toLowerCase()}:${(element.textContent || "").trim().replace(/\s+/g, " ")}`;
    }));
    await page.keyboard.press("Tab");
  }
  expect(names[0]).toMatch(/^a:/);
  expect(names[1]).toMatch(/^a:.*\d/);
  expect(names[2]).toBe("button:Retry shape count for Parcels");
  expect(names[3]).toMatch(/^summary:Details/);
});

test("the summary is at least 24 px tall", async ({ page }) => {
  await page.goto(REST_ROOT);
  const summary = disclosure(serviceRow(page, "Parcels/MapServer")).locator("summary");
  await expect(summary).toBeVisible();
  const box = await summary.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(24);
});
