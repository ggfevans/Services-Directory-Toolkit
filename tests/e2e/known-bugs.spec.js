// Bugs from the 2026-10-09 review that already reproduce. Each test describes the behaviour after
// the fix and is expected to fail until then. The phase that fixes a bug turns its knownBug() call
// into test(). See Appendix A of docs/superpowers/specs/2026-10-09-store-readiness-design.md.
//
// SHOW_KNOWN_BUGS=1 runs them as normal tests, to check that each fails on its last assertion and
// not in its setup.
import { test, expect, REST_ROOT } from "./fixtures.js";

const knownBug = (id, title, body) => {
  if (process.env.SHOW_KNOWN_BUGS) {
    test(`${id}: ${title}`, body);
  } else {
    test.fail(`${id}: ${title}`, body);
  }
};

const BAD_GATEWAY = () => ({ status: 502, contentType: "text/html", body: "<html><body>Bad Gateway</body></html>" });
const PRINT_TASK = `${REST_ROOT}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task`;

knownBug("INJ-1", "a layer's JSON view gets no requests and no spinner", async ({ page, fakeServer }) => {
  await page.goto(`${REST_ROOT}/Parcels/MapServer/0?f=pjson`);
  // Nothing on a JSON view signals that the scripts are done, so give them a moment.
  await page.waitForTimeout(1000);
  expect(fakeServer.requests.filter((request) => request.includes("f=json"))).toEqual([]);
  expect(await page.evaluate(() => document.body.className)).not.toMatch(/loading-/);
});

knownBug("INJ-2", "one failed count query does not stop the counts for the other fields", async ({ page, fakeServer, expectedErrors }) => {
  fakeServer.override(/where=not\+PARCEL_ID\+is\+null&/, BAD_GATEWAY);
  expectedErrors.push(/status of 502/);
  await page.goto(`${REST_ROOT}/Parcels/MapServer/0`);
  const fields = page.locator("b", { hasText: /^Fields:/ }).locator("xpath=following-sibling::ul[1]/li");
  await expect(fields).toHaveCount(6);
  for (const field of await fields.all()) {
    await expect(field).toContainText(/Features with values:|Error/);
  }
  await expect.poll(() => page.evaluate(() => document.body.className)).not.toMatch(/loading-/);
});

knownBug("INJ-3", "the Find Helper inserts the raw value even when no form field had focus", async ({ page }) => {
  await page.goto(`${REST_ROOT}/Parcels/MapServer/find`);
  const lists = page.locator(".sidepanel select");
  await lists.nth(0).selectOption("0");
  await lists.nth(1).selectOption("OWNER_NAME");
  const value = lists.nth(2).locator("option", { hasText: "A. Example" });
  await expect(value).toBeAttached();
  await value.dblclick();
  await expect(page.locator("#searchText")).toHaveValue("A. Example");
});

knownBug("INJ-11", "service details label the copyright text without a literal &copy;", async ({ page }) => {
  await page.goto(REST_ROOT);
  await expect(page.getByText("Example County GIS").first()).toBeAttached();
  await expect(page.getByText("&copy;")).toHaveCount(0);
});

knownBug("PRT-1", "a geoprocessing JSON result gets no requests and no dialog", async ({ page, fakeServer }) => {
  await page.goto(`${PRINT_TASK}/execute?f=pjson&Format=PDF`);
  await page.waitForTimeout(1000);
  expect(fakeServer.requests.filter((request) => request.includes("f=json"))).toEqual([]);
});

knownBug("QRY-1", "quick-fill buttons keep the visible True/False choice matching what is submitted", async ({ page, seedStorage }) => {
  // Fill the form without submitting it.
  await seedStorage({ queryHelperSelectAll: "donothing" });
  await page.goto(`${REST_ROOT}/Parcels/MapServer/0/query`);
  await page.getByRole("button", { name: "Select All *", exact: true }).click();
  await page.getByRole("button", { name: "Select All but Geometry *", exact: true }).click();
  const returnGeometry = await page.evaluate(() => {
    const form = document.forms.sdform;
    return {
      shown: form.querySelector("input[name=returnGeometry]:checked").parentElement.textContent.trim(),
      submitted: new FormData(form).get("returnGeometry")
    };
  });
  expect(returnGeometry).toEqual({ shown: "False", submitted: "false" });
});

knownBug("SET-1", "the options page loads normally when \"nothing\" is stored", async ({ page, extensionId, seedStorage }) => {
  await seedStorage({ queryHelperSelectAll: "nothing" });
  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  await expect(page.locator("#mapimagewidth")).toHaveValue("300");
  await expect(page.locator("#showmapimages")).toBeChecked();
  await expect(page.locator("#qhnothing")).toBeChecked();
});

knownBug("SET-3", "a blank number is rejected, not saved", async ({ page, extensionId, readStorage }) => {
  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  await expect(page.locator("#mapimagewidth")).toHaveValue("300");
  await page.locator("#mapimagewidth").fill("");
  await page.locator("#save").click();
  await expect(page.locator("#mapimagewidth")).toHaveAttribute("aria-invalid", "true");
  expect(await readStorage(["mapImageWidth"])).toEqual({});
});

knownBug("POP-1", "a location that fails does not stop the search", async ({ openPopupTab, fakeServer, expectedErrors }) => {
  fakeServer.override(/^\/arcgis\/rest\/services\/Transport\?f=json$/, BAD_GATEWAY);
  expectedErrors.push(/status of 502/);
  const popup = await openPopupTab(REST_ROOT);
  await popup.locator("#searchblank").fill("Roads");
  await popup.locator("#searchbtn").click();
  await expect(popup.locator("#searchbtn")).toHaveText("Search");
  await expect(popup.locator("#searchbtn")).toBeEnabled();
  expect(fakeServer.requests).toContain("GET /arcgis/rest/services/Utilities?f=json");
});

knownBug("POP-2", "text that is not a valid regular expression does not lock the search button", async ({ openPopupTab }) => {
  const popup = await openPopupTab(REST_ROOT);
  await popup.locator("#searchblank").fill("(");
  await popup.locator("#searchbtn").click();
  await expect(popup.locator("#searchbtn")).toBeEnabled();
  await expect(popup.locator("#searchbtn")).toHaveText("Search");
});

knownBug("POP-3", "a number-only search finds names that contain the number", async ({ openPopupTab }) => {
  const popup = await openPopupTab(`${REST_ROOT}/Transport/Roads/MapServer`);
  await popup.locator("#searchblank").fill("2019");
  await popup.locator("#searchbtn").click();
  await expect(popup.locator("#searchbtn")).toHaveText("Search");
  await expect(popup.locator("#searchresults a")).not.toHaveCount(0);
});
