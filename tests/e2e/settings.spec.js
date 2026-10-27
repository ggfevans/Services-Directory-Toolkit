// Content scripts read settings through SDT.settings.read (Phase 4): validated values, with the
// schema's defaults for anything missing or invalid, from the storage area each setting lives in.
import { test, expect, json, REST_ROOT, toolkitStarted } from "./fixtures.js";

const QUERY = `${REST_ROOT}/Parcels/MapServer/0/query`;
const PRINT = `${REST_ROOT}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/execute`;
// A 1x1 transparent PNG, so a preview loads nothing from the network.
const IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=#preview";

test.describe("content scripts read validated settings", () => {
  test("a fresh profile leaves the where box and the web map empty", async ({ page }) => {
    await page.goto(QUERY);
    await expect(page.getByRole("button", { name: "Select All *", exact: true })).toBeVisible();
    await expect(page.locator("input[name=where]")).toHaveValue("");
    await page.goto(PRINT);
    await expect(page.locator("select:has(option[value='PNG32'])")).toHaveCount(1);
    await expect(page.locator("textarea[name='Web_Map_as_JSON']")).toHaveValue("");
  });

  test("the Query Helper fills in the stored where clause", async ({ page, seedStorage }) => {
    await seedStorage({ defaultWhereClause: "ACRES > 1" });
    await page.goto(QUERY);
    await expect(page.locator("input[name=where]")).toHaveValue("ACRES > 1");
  });

  for (const [stored, method] of [[undefined, "GET"], ["post", "POST"], ["nothing", null], ["donothing", null], ["sideways", "GET"]]) {
    test(`Select All with queryHelperSelectAll ${JSON.stringify(stored)} ${method ? `runs the query with ${method}` : "only fills the form"}`, async ({ page, fakeServer, seedStorage }) => {
      if (stored !== undefined) {
        await seedStorage({ queryHelperSelectAll: stored });
      }
      await page.goto(QUERY);
      await page.getByRole("button", { name: "Select All *", exact: true }).click();
      const submitted = () => fakeServer.calls
        .filter((call) => call.path.endsWith("/Parcels/MapServer/0/query") && (call.query.where ?? call.body.where) === "1=1")
        .map((call) => call.method);
      if (method) {
        await expect.poll(submitted).toEqual([method]);
      } else {
        await expect(page.locator("input[name=where]")).toHaveValue("1=1");
        await page.waitForTimeout(1000);
        expect(submitted()).toEqual([]);
      }
    });
  }

  test("with service details off, the root page asks for none", async ({ page, fakeServer, seedStorage }) => {
    await seedStorage({ autoMetadata: false });
    await page.goto(REST_ROOT);
    // status.js runs last in the content-script group, after inject.js has started.
    await expect(toolkitStarted(page)).toBeAttached();
    await page.waitForTimeout(1000);
    await expect(page.locator(".sdt-datablock")).toHaveCount(0);
    expect(fakeServer.calls.filter((call) => call.query.f === "json" || call.body.f === "json")).toEqual([]);
  });

  test("a stored autoMetadata that isn't true or false reads as the default, on", async ({ page, seedStorage }) => {
    await seedStorage({ autoMetadata: 0 });
    await page.goto(REST_ROOT);
    await expect(page.locator(".sdt-datablock")).toHaveCount(3);
  });

  test("with feature counts off, a MapServer page shows details but no counts", async ({ page, seedStorage }) => {
    await seedStorage({ autoFeatureCounts: false });
    await page.goto(`${REST_ROOT}/Parcels/MapServer`);
    await expect(page.locator(".sdt-datablock")).toHaveCount(2);
    await expect(page.locator(".sdt-statusbar").getByRole("status")).toHaveText(/^Loaded details for/);
    await expect(page.locator("b", { hasText: /^Number of features:/ })).toHaveCount(0);
  });

  for (const [stored, size] of [[{ mapImageWidth: 640, mapImageHeight: 480 }, "640,480"], [{ mapImageWidth: 5000, mapImageHeight: "200px" }, "300,200"]]) {
    test(`map previews with a stored size of ${JSON.stringify(stored)} ask for ${size} (SEC-3)`, async ({ page, fakeServer, seedStorage }) => {
      await seedStorage(stored);
      fakeServer.override(/^\/arcgis\/rest\/services\/Parcels\/MapServer\/\?f=json$/, () => json({ initialExtent: { xmin: 0, ymin: 0, xmax: 10, ymax: 10 } }));
      fakeServer.override(/^\/arcgis\/rest\/services\/Parcels\/MapServer\/export\?/, () => json({ href: IMAGE }));
      await page.goto(REST_ROOT);
      await expect(page.locator(".sdt-datablock")).toHaveCount(3);
      await page.getByRole("link", { name: "Parcels", exact: true }).first().hover();
      await expect(page.locator("#mapimage")).toHaveAttribute("src", IMAGE);
      expect(fakeServer.calls.find((call) => call.path.endsWith("/Parcels/MapServer/export")).query.size).toBe(size);
    });
  }

  test("the print page fills the web map from local storage, never from sync (PRT-3, SEC-2)", async ({ page, seedStorage }) => {
    await seedStorage({ defaultWebMapAsJSON: "{\"from\":\"sync\"}" });
    await seedStorage({ defaultWebMapAsJSON: "{\"from\":\"local\"}" }, "local");
    await page.goto(PRINT);
    await expect(page.locator("textarea[name='Web_Map_as_JSON']")).toHaveValue("{\"from\":\"local\"}");
  });

  test("the print page ignores a stored web map that isn't a JSON object", async ({ page, seedStorage }) => {
    await seedStorage({ defaultWebMapAsJSON: "[\"not\", \"a\", \"web map\"]" }, "local");
    await page.goto(PRINT);
    await expect(page.locator("select:has(option[value='PNG32'])")).toHaveCount(1);
    await expect(page.locator("textarea[name='Web_Map_as_JSON']")).toHaveValue("");
  });
});
