// The rows of a Services Directory page: badges, the Details disclosure and the row states (design
// review 6.4 and 6.5, Phase 5 part 2).
import { test, expect, html, json, REST_ROOT } from "./fixtures.js";
import { catalog } from "../fixtures/catalog.js";
import { layerPage } from "../fixtures/pages.js";

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
