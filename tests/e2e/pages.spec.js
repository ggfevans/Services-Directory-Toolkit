// What the extension does today on each kind of page. These tests pass on the current code; a
// later phase that changes a behaviour on purpose updates the matching test.
import { test, expect, FAKE_ORIGIN, REST_ROOT, toolkitStarted } from "./fixtures.js";

// Labels the content scripts write in <b> elements, such as "Number of features: ".
const label = (page, text) => page.locator("b", { hasText: new RegExp(`^${text}`) });

// The list item for a layer on a service page: the one that holds the layer's link. The extension nests
// "Number of features: N" and "Features with shapes: N" items inside it.
const layerItem = (page, name) => page.locator("li", { has: page.getByRole("link", { name, exact: true }) });

// A nested list item whose text matches, such as "Number of features: 3".
const item = (parent, pattern) => parent.locator("li", { hasText: pattern });

test("the services root shows the status bar, spatial reference badges and service details", async ({ page }) => {
  await page.goto(REST_ROOT);
  await expect(page.locator(".sdt-statusbar")).toBeVisible();
  await expect(page.getByRole("link", { name: "3857" })).toHaveCount(2);
  await expect(page.getByRole("link", { name: "4326" })).toHaveCount(1);
  await expect(page.locator(".sdt-datablock")).toHaveCount(3);
  for (const description of [
    "Parcel boundaries and site addresses for an invented county.",
    "Editable parcel boundaries for an invented county.",
    "An invented elevation surface."
  ]) {
    await expect(page.locator(".sdt-datablock", { hasText: `Service Description: ${description}` })).toHaveCount(1);
  }
});

// Part 2 (#16) finishes INJ-11, which also shows server HTML as text. This case covers the entity literal.
test("INJ-11: service details label the copyright text without a literal &copy;", async ({ page }) => {
  await page.goto(REST_ROOT);
  await expect(page.getByText("Example County GIS").first()).toBeAttached();
  await expect(page.getByText("&copy;")).toHaveCount(0);
});

test("a MapServer page shows details and feature counts for each layer", async ({ page }) => {
  await page.goto(`${REST_ROOT}/Parcels/MapServer`);
  await expect(page.locator(".sdt-datablock")).toHaveCount(2);
  await expect(label(page, "Number of features:")).toHaveCount(2);
  await expect(label(page, "Features with shapes:")).toHaveCount(2);
  await expect(page.locator(".sdt-datablock", { hasText: "Display Field: OWNER_NAME" })).toHaveCount(1);
  await expect(page.locator(".sdt-datablock", { hasText: "Display Field: ADDRESS" })).toHaveCount(1);
  const counts = { Parcels: { features: 3, shapes: 2 }, Addresses: { features: 2, shapes: 2 } };
  for (const [name, { features, shapes }] of Object.entries(counts)) {
    await expect(item(layerItem(page, name), new RegExp(`^Number of features: ${features}$`))).toHaveCount(1);
    await expect(item(layerItem(page, name), new RegExp(`^Features with shapes: ${shapes}$`))).toHaveCount(1);
  }
});

// A FeatureServer layer names its shape field in geometryField, not in fields, so INJ-15's old
// FeatureServer exclusion left these rows without the shape count.
test("a FeatureServer layer row shows \"Features with shapes\" (INJ-15)", async ({ page }) => {
  await page.goto(`${REST_ROOT}/Parcels/FeatureServer`);
  await expect(page.locator(".sdt-datablock")).toHaveCount(2);
  const counts = { Parcels: { features: 3, shapes: 2 }, Addresses: { features: 2, shapes: 2 } };
  for (const [name, { features, shapes }] of Object.entries(counts)) {
    await expect(item(layerItem(page, name), new RegExp(`^Number of features: ${features}$`))).toHaveCount(1);
    await expect(item(layerItem(page, name), new RegExp(`^Features with shapes: ${shapes}$`))).toHaveCount(1);
  }
  await expect(page.getByText("No visible shape field available.")).toHaveCount(0);
});

test("a layer page sends no automatic field or domain count queries", async ({ page, fakeServer }) => {
  await page.goto(`${REST_ROOT}/Parcels/MapServer/0`);
  await expect(toolkitStarted(page)).toBeAttached();
  await expect.poll(() => page.evaluate(() => document.body.className)).not.toMatch(/sdt-loading-/);
  await page.waitForTimeout(500);
  expect(fakeServer.calls.filter((call) => /\/query$/.test(call.path) && (call.query.where || call.body.where))).toEqual([]);
  await expect(label(page, "Features with values:")).toHaveCount(0);
});

// getColor kept colours in a plain object, so a spatial reference named like a prototype property
// returned Object.prototype and threw, which left the other rows without their details.
test("a service whose spatial reference wkid is \"__proto__\" still gets its badge (SEC-8)", async ({ page, fakeServer }) => {
  fakeServer.override(/^\/arcgis\/rest\/services\/Parcels\/MapServer\?f=json$/, () => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ serviceDescription: "Odd service.", spatialReference: { wkid: "__proto__" } })
  }));
  await page.goto(REST_ROOT);
  await expect(page.getByRole("link", { name: "__proto__" })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "3857" })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "4326" })).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => document.body.className)).not.toMatch(/sdt-loading-/);
});

test("a query page gets the Query Helper with SQL and quick-fill buttons", async ({ page }) => {
  await page.goto(`${REST_ROOT}/Parcels/MapServer/0/query`);
  await expect(page.getByText("Query Helper", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "LIKE", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Select All *", exact: true })).toBeVisible();
});

test("a print task's execute page gets dropdowns and the saved web map", async ({ page, seedStorage }) => {
  const webMap = "{\"operationalLayers\":[]}";
  await seedStorage({ defaultWebMapAsJSON: webMap }, "local");
  await page.goto(`${REST_ROOT}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/execute`);
  await expect(page.locator("select:has(option[value='PNG32'])")).toHaveCount(1);
  await expect(page.locator("select:has(option[value='A4 Portrait'])")).toHaveCount(1);
  await expect(page.locator("textarea[name='Web_Map_as_JSON']")).toHaveValue(webMap);
});

test("the options page shows the defaults and saves changes", async ({ page, extensionId, readStorage }) => {
  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  await expect(page.locator("#mapimagewidth")).toHaveValue("300");
  await page.locator("#mapimagewidth").fill("321");
  await page.locator("#save").click();
  await expect(page.getByRole("status")).toHaveText("Saved. Changes apply when you reload a page.");
  expect(await readStorage(["mapImageWidth"])).toEqual({ mapImageWidth: 321 });
});

// The extension's own requests: those with f=json, in the query string or in a form body. On a page
// opened with ?f=json, the page's own load is such a request too, so pass the page to leave out that
// one call. A second identical call would still be the extension's.
const extensionRequests = (fakeServer, page) => {
  const opened = page ? new URL(page.url()) : null;
  let pageLoad = opened ? fakeServer.calls.find((call) => call.method === "GET"
    && `${call.origin}${call.path}` === `${opened.origin}${opened.pathname}`
    && new URLSearchParams(call.query).toString() === opened.searchParams.toString()) : null;
  return fakeServer.calls.filter((call) => {
    if (call === pageLoad) {
      pageLoad = null;
      return false;
    }
    return call.query.f === "json" || call.body.f === "json";
  });
};

for (const path of ["?f=json", "/Parcels/MapServer?f=pjson", "/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task?f=pjson"]) {
  test(`a JSON view gets no requests, no status bar and no spinner: ${path}`, async ({ page, fakeServer, actionEnabled }) => {
    await page.goto(`${REST_ROOT}${path}`);
    // Nothing on a JSON view signals that the scripts are done, so give them a moment.
    await page.waitForTimeout(1000);
    expect(extensionRequests(fakeServer, page)).toEqual([]);
    await expect(toolkitStarted(page)).toHaveCount(0);
    await expect(page.locator(".sdt-statusbar")).toHaveCount(0);
    expect(await page.evaluate(() => document.body.className)).not.toMatch(/sdt-/);
    expect(await actionEnabled(page)).toBe(false);
  });
}

test("a page whose REST path is only in its query string gets nothing (TOK-6)", async ({ page, fakeServer, actionEnabled }) => {
  // The content-script patterns match this URL, because they also test the query string.
  await page.goto(`${FAKE_ORIGIN}/other/page?x=/arcgis/rest/services/`);
  await page.waitForTimeout(1000);
  await expect(toolkitStarted(page)).toHaveCount(0);
  await expect(page.locator(".sdt-statusbar")).toHaveCount(0);
  expect(await actionEnabled(page)).toBe(false);
  expect(extensionRequests(fakeServer)).toEqual([]);
});

test("the Query Helper says when it can't load the fields (QRY-5)", async ({ page, fakeServer, expectedErrors }) => {
  fakeServer.override(/^\/arcgis\/rest\/services\/Parcels\/MapServer\/0\?f=json$/, () => ({ status: 502, contentType: "text/html", body: "<html><body>Bad Gateway</body></html>" }));
  expectedErrors.push(/status of 502/);
  await page.goto(`${REST_ROOT}/Parcels/MapServer/0/query`);
  await expect(page.locator(".sdt-sidepanel")).toContainText("Could not load the fields: HTTP 502");
});
