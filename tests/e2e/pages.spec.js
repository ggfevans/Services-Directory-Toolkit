// What the extension does today on each kind of page. These tests pass on the current code; a
// later phase that changes a behaviour on purpose updates the matching test.
import { test, expect, FAKE_ORIGIN, REST_ROOT } from "./fixtures.js";

// Labels the content scripts write in <b> elements, such as "Number of features: ".
const label = (page, text) => page.locator("b", { hasText: new RegExp(`^${text}`) });

// The list item for a layer on a service page: the one that holds the layer's link. The extension nests
// "Number of features: N" and "Features with shapes: N" items inside it.
const layerItem = (page, name) => page.locator("li", { has: page.getByRole("link", { name, exact: true }) });

// The list item for a field on a layer page: the children of the list that follows the "Fields:" label.
// The extension nests the count items inside it.
const field = (page, name) => page
  .locator("xpath=//b[starts-with(normalize-space(.), 'Fields:')]/following-sibling::ul[1]/li")
  .filter({ hasText: new RegExp(`^\\s*${name}\\b`) });

// A nested list item whose text matches, such as "Features with values: 3 Response time: 12ms".
const item = (parent, pattern) => parent.locator("li", { hasText: pattern });

test("the services root shows the status indicator, spatial reference badges and service details", async ({ page }) => {
  await page.goto(REST_ROOT);
  await expect(page.getByRole("img", { name: "Services Directory Toolkit" })).toBeVisible();
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

test("a layer page counts values for every field and every coded value", async ({ page }) => {
  await page.goto(`${REST_ROOT}/Parcels/MapServer/0`);
  await expect(label(page, "Features with values:")).toHaveCount(6);
  await expect(label(page, "Features without empty values:")).toHaveCount(3);
  await expect(label(page, "Residential:")).toHaveCount(1);
  await expect(label(page, "Commercial:")).toHaveCount(1);
  const withValues = { OBJECTID: 3, SHAPE: 2, PARCEL_ID: 3, OWNER_NAME: 2, LAND_USE: 3, ACRES: 2 };
  for (const [name, count] of Object.entries(withValues)) {
    await expect(item(field(page, name), new RegExp(`^Features with values:\\s+${count}\\s`))).toHaveCount(1);
  }
  const withoutEmpty = { PARCEL_ID: 3, OWNER_NAME: 1, LAND_USE: 3 };
  for (const [name, count] of Object.entries(withoutEmpty)) {
    await expect(item(field(page, name), new RegExp(`^Features without empty values:\\s+${count}\\s`))).toHaveCount(1);
  }
  await expect(item(field(page, "LAND_USE"), /^Residential:\s+2\b/)).toHaveCount(1);
  await expect(item(field(page, "LAND_USE"), /^Commercial:\s+1\b/)).toHaveCount(1);
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
  await expect.poll(() => readStorage(["mapImageWidth"])).toEqual({ mapImageWidth: 321 });
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
  test(`a JSON view gets no requests, no indicator and no spinner: ${path}`, async ({ page, fakeServer, actionEnabled }) => {
    await page.goto(`${REST_ROOT}${path}`);
    // Nothing on a JSON view signals that the scripts are done, so give them a moment.
    await page.waitForTimeout(1000);
    expect(extensionRequests(fakeServer, page)).toEqual([]);
    await expect(page.getByRole("img", { name: "Services Directory Toolkit" })).toHaveCount(0);
    expect(await page.evaluate(() => document.body.className)).not.toMatch(/sdt-/);
    expect(await actionEnabled(page)).toBe(false);
  });
}

test("a page whose REST path is only in its query string gets nothing (TOK-6)", async ({ page, fakeServer, actionEnabled }) => {
  // The content-script patterns match this URL, because they also test the query string.
  await page.goto(`${FAKE_ORIGIN}/other/page?x=/arcgis/rest/services/`);
  await page.waitForTimeout(1000);
  await expect(page.getByRole("img", { name: "Services Directory Toolkit" })).toHaveCount(0);
  expect(await actionEnabled(page)).toBe(false);
  expect(extensionRequests(fakeServer)).toEqual([]);
});

test("the Query Helper says when it can't load the fields (QRY-5)", async ({ page, fakeServer, expectedErrors }) => {
  fakeServer.override(/^\/arcgis\/rest\/services\/Parcels\/MapServer\/0\?f=json$/, () => ({ status: 502, contentType: "text/html", body: "<html><body>Bad Gateway</body></html>" }));
  expectedErrors.push(/status of 502/);
  await page.goto(`${REST_ROOT}/Parcels/MapServer/0/query`);
  await expect(page.locator(".sdt-sidepanel")).toContainText("Could not load the fields: HTTP 502");
});
