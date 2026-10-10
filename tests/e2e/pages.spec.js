// What the extension does today on each kind of page. These tests pass on the current code; a
// later phase that changes a behaviour on purpose updates the matching test.
import { test, expect, REST_ROOT } from "./fixtures.js";

// Labels the content scripts write in <b> elements, such as "Number of features: ".
const label = (page, text) => page.locator("b", { hasText: new RegExp(`^${text}`) });

test("the services root shows the gear, spatial reference badges and service details", async ({ page }) => {
  await page.goto(REST_ROOT);
  const gear = page.locator("img.status-icon");
  await expect(gear).toBeVisible();
  await expect.poll(() => gear.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole("link", { name: "3857" })).toHaveCount(2);
  await expect(page.getByRole("link", { name: "4326" })).toHaveCount(1);
  await expect(page.locator(".datablock")).toHaveCount(3);
});

test("a MapServer page shows details and feature counts for each layer", async ({ page }) => {
  await page.goto(`${REST_ROOT}/Parcels/MapServer`);
  await expect(page.locator(".datablock")).toHaveCount(2);
  await expect(label(page, "Number of features:")).toHaveCount(2);
  await expect(label(page, "Features with shapes:")).toHaveCount(2);
});

test("a layer page counts values for every field and every coded value", async ({ page }) => {
  await page.goto(`${REST_ROOT}/Parcels/MapServer/0`);
  await expect(label(page, "Features with values:")).toHaveCount(6);
  await expect(label(page, "Features without empty values:")).toHaveCount(3);
  await expect(label(page, "Residential:")).toHaveCount(1);
  await expect(label(page, "Commercial:")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => document.body.className)).not.toMatch(/loading-/);
});

test("a query page gets the Query Helper with SQL and quick-fill buttons", async ({ page }) => {
  await page.goto(`${REST_ROOT}/Parcels/MapServer/0/query`);
  // status.js also lists "Query Helper" as a legend in the in-page settings form, so scope to the panel.
  await expect(page.locator(".sidepanel").getByText("Query Helper", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "LIKE", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Select All *", exact: true })).toBeVisible();
});

test("a print task's execute page gets dropdowns and the saved web map", async ({ page, seedStorage }) => {
  const webMap = "{\"operationalLayers\":[]}";
  await seedStorage({ defaultWebMapAsJSON: webMap });
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
