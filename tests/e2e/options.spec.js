// The options page (Phase 4): one control per SDT.settings key, validated with SDT.settings.parse and
// saved with SDT.writer.save, which writes only what changed and reports Chrome's errors.
import { test, expect } from "./fixtures.js";
import { axeViolations } from "./axe.js";

const SAVED = "Saved. Changes apply when you reload a page.";
const NO_VIOLATIONS = { light: [], dark: [] };
const DEFAULTS = {
  autoMetadata: true,
  autoFeatureCounts: true,
  showMapImages: true,
  mapImageWidth: 300,
  mapImageHeight: 200,
  queryHelperSelectAll: "get",
  defaultWhereClause: "",
  defaultWebMapAsJSON: ""
};
// A JSON object whose text is exactly bytes long.
const webMapOf = (bytes) => `{"a":"${"x".repeat(bytes - 8)}"}`;

/** Opens the options page and waits until it shows the stored values. */
const openOptions = async (page, extensionId) => {
  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  await expect(page.getByLabel("Preview image width (px)")).not.toHaveValue("");
};

/** Records each chrome.storage set and remove the options page makes, as "<area>.<method> <keys>". */
const recordWrites = (page) => page.addInitScript(() => {
  window.sdtWrites = [];
  for (const area of ["sync", "local"]) {
    for (const method of ["set", "remove"]) {
      const original = chrome.storage[area][method].bind(chrome.storage[area]);
      chrome.storage[area][method] = (items, ...rest) => {
        const keys = typeof items === "string" ? [items] : Array.isArray(items) ? items : Object.keys(items);
        window.sdtWrites.push(`${area}.${method} ${[...keys].sort().join(",")}`);
        return original(items, ...rest);
      };
    }
  }
});
const writes = (page) => page.evaluate(() => window.sdtWrites);

/** What each control shows, by setting key. */
const shown = (page) => page.evaluate(() => {
  const form = document.getElementById("settings");
  return Object.fromEntries(window.SDT.settings.schema.map(({ key, type }) => [key, type === "boolean" ? form.elements[key].checked : form.elements[key].value]));
});

test.describe("the options page", () => {
  test("a fresh profile shows every schema default", async ({ page, extensionId }) => {
    await openOptions(page, extensionId);
    expect(await page.evaluate(() => window.SDT.settings.defaults())).toEqual(DEFAULTS);
    expect(await shown(page)).toEqual({ ...DEFAULTS, mapImageWidth: "300", mapImageHeight: "200" });
  });

  test("says that changes apply when a page is reloaded (SET-11)", async ({ page, extensionId }) => {
    await openOptions(page, extensionId);
    await expect(page.getByText("Changes apply when you reload a page.", { exact: true })).toBeVisible();
  });

  test("writes only the settings that changed", async ({ page, extensionId, seedStorage, readStorage }) => {
    await seedStorage({ autoMetadata: false, mapImageHeight: 250 });
    await recordWrites(page);
    await openOptions(page, extensionId);
    await page.getByLabel("Preview image width (px)").fill("640");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText(SAVED);
    expect(await writes(page)).toEqual(["sync.set mapImageWidth"]);
    expect(await readStorage()).toEqual({ autoMetadata: false, mapImageHeight: 250, mapImageWidth: 640 });
    expect(await readStorage(null, "local")).toEqual({});
  });

  test("says so when nothing changed, and writes nothing", async ({ page, extensionId }) => {
    await recordWrites(page);
    await openOptions(page, extensionId);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("No changes to save.");
    expect(await writes(page)).toEqual([]);
  });

  test("keeps a setting another window changed, unless it was changed here too", async ({ page, extensionId, seedStorage, readStorage }) => {
    await recordWrites(page);
    await openOptions(page, extensionId);
    await seedStorage({ showMapImages: false, mapImageHeight: 400 });
    await page.getByLabel("Preview image width (px)").fill("640");
    await page.getByLabel("Preview image height (px)").fill("500");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText(SAVED);
    expect(await writes(page)).toEqual(["sync.set mapImageHeight,mapImageWidth"]);
    expect(await readStorage()).toEqual({ showMapImages: false, mapImageWidth: 640, mapImageHeight: 500 });
    // After saving, the page shows what is stored.
    await expect(page.getByLabel("Show map previews on hover")).not.toBeChecked();
  });

  test("repairs stored values that aren't valid (SET-1)", async ({ page, extensionId, seedStorage, readStorage }) => {
    await seedStorage({ queryHelperSelectAll: "nothing", mapImageWidth: "wide" });
    await recordWrites(page);
    await openOptions(page, extensionId);
    await expect(page.getByLabel("Fill the form only")).toBeChecked();
    await expect(page.getByLabel("Preview image width (px)")).toHaveValue("300");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText(SAVED);
    expect(await writes(page)).toEqual(["sync.set mapImageWidth,queryHelperSelectAll"]);
    expect(await readStorage()).toEqual({ queryHelperSelectAll: "donothing", mapImageWidth: 300 });
  });

  test("shows an error under each invalid field, and saves nothing (SET-3, SET-4)", async ({ page, extensionId, readStorage }) => {
    await recordWrites(page);
    await openOptions(page, extensionId);
    const width = page.getByLabel("Preview image width (px)");
    const height = page.getByLabel("Preview image height (px)");
    const webMap = page.getByLabel("Saved web map (JSON)");
    await width.fill("");
    await height.fill("2001");
    await webMap.fill("[1]");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("Not saved. Fix the 3 fields marked below.");
    for (const field of [width, height, webMap]) {
      await expect(field).toHaveAttribute("aria-invalid", "true");
    }
    await expect(width).toHaveAccessibleDescription("Enter a whole number from 50 to 2000.");
    await expect(height).toHaveAccessibleDescription("Enter a whole number from 50 to 2000.");
    await expect(webMap).toHaveAccessibleDescription(/Enter valid JSON for a web map object, or leave it empty\.$/);
    await expect(width).toBeFocused();
    expect(await writes(page)).toEqual([]);
    expect(await readStorage()).toEqual({});

    await width.fill("640");
    await height.fill("480");
    await webMap.fill("");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText(SAVED);
    for (const field of [width, height, webMap]) {
      await expect(field).not.toHaveAttribute("aria-invalid");
    }
    expect(await readStorage()).toEqual({ mapImageWidth: 640, mapImageHeight: 480 });
  });

  test("refuses a web map over 100 KB, giving its size", async ({ page, extensionId, readStorage }) => {
    await openOptions(page, extensionId);
    const webMap = page.getByLabel("Saved web map (JSON)");
    await webMap.fill(webMapOf(140 * 1024));
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("Not saved. Fix the field marked below.");
    await expect(webMap).toHaveAccessibleDescription(/This web map is 140 KB\. The limit is 100 KB\.$/);
    expect(await readStorage(null, "local")).toEqual({});
  });

  test("saves the web map to local storage, not sync", async ({ page, extensionId, readStorage }) => {
    await recordWrites(page);
    await openOptions(page, extensionId);
    await page.getByLabel("Saved web map (JSON)").fill("{\"operationalLayers\":[]}");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText(SAVED);
    expect(await writes(page)).toEqual(["local.set defaultWebMapAsJSON"]);
    expect(await readStorage(null, "local")).toEqual({ defaultWebMapAsJSON: "{\"operationalLayers\":[]}" });
    expect(await readStorage()).toEqual({});
  });

  test("refuses a where clause too long for Chrome sync, and writes nothing (SET-4)", async ({ page, extensionId, readStorage }) => {
    await recordWrites(page);
    await openOptions(page, extensionId);
    const where = page.getByLabel("Default where clause");
    await page.getByLabel("Preview image width (px)").fill("640");
    await where.fill("a".repeat(9000));
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("Not saved. Fix the field marked below.");
    await expect(where).toHaveAttribute("aria-invalid", "true");
    await expect(where).toHaveAccessibleDescription(/Too long to sync: this needs 9,020 bytes, and Chrome allows 8,192 per setting\.$/);
    await expect(where).toBeFocused();
    expect(await writes(page)).toEqual([]);
    expect(await readStorage()).toEqual({});
  });

  test("refuses a save that would take Chrome sync over its total quota, and writes nothing (SET-4)", async ({ page, extensionId, seedStorage, readStorage }) => {
    // 12 items of 8,006 bytes: 96,096 of sync's 102,400 bytes.
    const junk = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`junk${String(i).padStart(2, "0")}`, "x".repeat(8000)]));
    await seedStorage(junk);
    await recordWrites(page);
    await openOptions(page, extensionId);
    await page.getByLabel("Preview image width (px)").fill("640");
    await page.getByLabel("Default where clause").fill("a".repeat(7000));
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("Not saved: the synced settings would need 103,132 bytes, and Chrome allows 102,400. Nothing was changed.");
    expect(await writes(page)).toEqual([]);
    expect(await readStorage()).toEqual(junk);
  });

  test("when Chrome refuses the write, says why, and changes nothing (SET-4)", async ({ page, extensionId, serviceWorker, readStorage }) => {
    await recordWrites(page);
    await openOptions(page, extensionId);
    // Use up chrome.storage.sync's 120 writes a minute.
    await serviceWorker.evaluate(async () => {
      for (let i = 0; i < chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_MINUTE; i++) {
        await chrome.storage.sync.set({ filler: i });
      }
    });
    await page.getByLabel("Preview image width (px)").fill("640");
    await page.getByLabel("Saved web map (JSON)").fill("{\"operationalLayers\":[]}");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("Not saved: This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota. Nothing was changed.");
    // The web map went first, so it was put back.
    expect(await writes(page)).toEqual(["local.set defaultWebMapAsJSON", "sync.set mapImageWidth", "local.remove defaultWebMapAsJSON"]);
    expect(await readStorage(["mapImageWidth"])).toEqual({});
    expect(await readStorage(null, "local")).toEqual({});
  });

  test("shows \"Saved\" only once the write has finished", async ({ page, extensionId, readStorage }) => {
    // Hold every sync write until the test lets it go.
    await page.addInitScript(() => {
      const set = chrome.storage.sync.set.bind(chrome.storage.sync);
      chrome.storage.sync.set = (items) => new Promise((resolve) => {
        window.sdtFinishWrite = () => resolve(set(items));
      });
    });
    await openOptions(page, extensionId);
    await page.getByLabel("Preview image width (px)").fill("640");
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForFunction(() => typeof window.sdtFinishWrite === "function");
    await expect(page.getByRole("status")).toHaveText("");
    expect(await readStorage(["mapImageWidth"])).toEqual({});
    await page.evaluate(() => window.sdtFinishWrite());
    await expect(page.getByRole("status")).toHaveText(SAVED);
    expect(await readStorage(["mapImageWidth"])).toEqual({ mapImageWidth: 640 });
  });

  test("turns feature counts off while service details are off", async ({ page, extensionId }) => {
    await openOptions(page, extensionId);
    const counts = page.getByLabel("Count features in each layer");
    await expect(counts).toBeEnabled();
    await page.getByLabel("Load service details and spatial references").uncheck();
    await expect(counts).toBeDisabled();
    await expect(counts).toHaveAccessibleDescription("Needs \"Load service details and spatial references\".");
  });

  test("axe finds nothing wrong, in light and dark, with and without errors (SET-7)", async ({ page, extensionId }) => {
    await openOptions(page, extensionId);
    expect(await axeViolations(page)).toEqual(NO_VIOLATIONS);
    await page.getByLabel("Preview image width (px)").fill("");
    await page.getByLabel("Saved web map (JSON)").fill("[");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("Not saved. Fix the 2 fields marked below.");
    expect(await axeViolations(page)).toEqual(NO_VIOLATIONS);
  });

  test("works from the keyboard alone (SET-7)", async ({ page, extensionId, readStorage }) => {
    await openOptions(page, extensionId);
    const order = [];
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      order.push(await page.evaluate(() => {
        const element = document.activeElement;
        return element.labels?.[0]?.textContent.trim() ?? element.textContent.trim();
      }));
    }
    expect(order).toEqual([
      "Load service details and spatial references",
      "Count features in each layer",
      "Saved web map (JSON)",
      "Default where clause",
      "Run the query with GET",
      "Show map previews on hover",
      "Preview image width (px)",
      "Preview image height (px)",
      "Save",
      "Map Services Enhanced"
    ]);

    // Back to the radio group, then through the rest of the form.
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Shift+Tab");
    }
    await expect(page.getByLabel("Run the query with GET")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("640");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toHaveText(SAVED);
    expect(await readStorage()).toEqual({ queryHelperSelectAll: "post", showMapImages: false, mapImageWidth: 640 });

    // A failed save moves focus to the first field to fix.
    await page.keyboard.press("Tab");
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("5");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toHaveText("Not saved. Fix the field marked below.");
    await expect(page.getByLabel("Preview image height (px)")).toBeFocused();
  });
});
