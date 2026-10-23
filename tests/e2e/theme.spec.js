// The theme check (SDT.theme, #13): in-page additions follow the host page's background, and the
// popup and the options page follow the system. The content script runs in an isolated world, so
// these tests watch what it does to the DOM: the attributes on <html>, and the token values that
// sdt.css then gives <html>, which the page can read.
import { test, expect, FAKE_ORIGIN, REST_ROOT } from "./fixtures.js";

const PRINT_TASK = `${REST_ROOT}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/execute`;
const LIGHT_BG = "#ffffff";
const DARK_BG = "#1b2020";

/** The value sdt.css gives a token on <html>. */
const token = (page, name) => page.evaluate((property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(), name);

const theme = (page) => page.evaluate(() => document.documentElement.getAttribute("data-sdt-theme"));

/**
 * Opens a page that loads nothing automatically, waits for the theme check's first write, then lets
 * any rechecks from the page's own loading settle.
 */
const openQuietPage = async (page, url = PRINT_TASK) => {
  await page.goto(url);
  await expect(page.locator("html")).toHaveAttribute("data-sdt-theme", /^(light|dark)$/);
  await page.waitForTimeout(700);
};

/** Starts recording every write to <html>'s data-sdt-theme and data-sdt-contrast, as the page sees them. */
const recordWrites = (page) => page.evaluate(() => {
  window.themeWrites = [];
  new MutationObserver((records) => {
    for (const record of records) {
      window.themeWrites.push(`${record.attributeName}=${document.documentElement.getAttribute(record.attributeName)}`);
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-sdt-theme", "data-sdt-contrast"] });
});

const writes = (page) => page.evaluate(() => window.themeWrites);

test("a light page gets the light palette", async ({ page }) => {
  await openQuietPage(page);
  expect(await theme(page)).toBe("light");
  await expect(page.locator("html")).not.toHaveAttribute("data-sdt-contrast", /.*/);
  expect(await token(page, "--sdt-bg")).toBe(LIGHT_BG);
});

test("a light page keeps the light palette when the system is dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openQuietPage(page);
  expect(await theme(page)).toBe("light");
  expect(await token(page, "--sdt-bg")).toBe(LIGHT_BG);
});

test.describe("on the dark fixture page", () => {
  test.use({ hostStyle: "dark" });

  test("<html> gets data-sdt-theme=\"dark\" and the dark palette", async ({ page }) => {
    await openQuietPage(page, REST_ROOT);
    expect(await theme(page)).toBe("dark");
    expect(await token(page, "--sdt-bg")).toBe(DARK_BG);
    expect(await token(page, "--sdt-fg-muted")).toBe("#a7b2b1");
  });
});

test("a dark class on <body> switches the palette, with exactly one recheck", async ({ page }) => {
  await openQuietPage(page);
  await recordWrites(page);
  await page.evaluate(() => document.body.classList.add("dark"));
  await expect.poll(() => theme(page)).toBe("dark");
  expect(await token(page, "--sdt-bg")).toBe(DARK_BG);
  // Long enough for two more checks, if the first had triggered another.
  await page.waitForTimeout(1500);
  expect(await writes(page)).toEqual(["data-sdt-theme=dark"]);
});

test("several changes within 500 ms are checked together, once", async ({ page }) => {
  await openQuietPage(page);
  await recordWrites(page);
  // Each of these alone would flip the palette. Checked one by one, they would write dark, light, dark.
  await page.evaluate(async () => {
    const pause = () => new Promise((resolve) => setTimeout(resolve, 50));
    document.body.classList.add("dark");
    await pause();
    document.body.classList.remove("dark");
    await pause();
    document.body.classList.add("dark");
  });
  await page.waitForTimeout(1500);
  expect(await writes(page)).toEqual(["data-sdt-theme=dark"]);
});

test("the check never reacts to its own writes, even when the page restyles itself on them", async ({ page }) => {
  await openQuietPage(page);
  // A page whose background depends on the check's own attribute. A check that reacted to its own
  // write would flip between light and dark every 500 ms here.
  await page.addStyleTag({ content: "html[data-sdt-theme=\"dark\"] body.dark { background: #ffffff; }" });
  await page.waitForTimeout(700);
  await recordWrites(page);
  await page.evaluate(() => document.body.classList.add("dark"));
  await page.waitForTimeout(2500);
  expect(await writes(page)).toEqual(["data-sdt-theme=dark"]);
});

test("a stylesheet added to <head> triggers a recheck, as Dark Reader's would", async ({ page }) => {
  await openQuietPage(page);
  await page.addStyleTag({ content: "body { background: #16191d; }" });
  await expect.poll(() => theme(page)).toBe("dark");
});

test("a stylesheet that finishes loading after the 500 ms check still triggers a recheck", async ({ page, fakeServer }) => {
  fakeServer.override(/^\/late-dark\.css$/, async () => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return { status: 200, contentType: "text/css", body: "body { background: #16191d; }" };
  });
  await openQuietPage(page);
  await page.evaluate((href) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }, `${FAKE_ORIGIN}/late-dark.css`);
  // The insertion's own check, 500 ms later, still sees the light background.
  await page.waitForTimeout(900);
  expect(await theme(page)).toBe("light");
  await expect.poll(() => theme(page), { timeout: 5000 }).toBe("dark");
});

test("a mid-grey page gets data-sdt-contrast=\"more\", and muted text takes the text colour", async ({ page }) => {
  await openQuietPage(page);
  expect(await token(page, "--sdt-fg-muted")).toBe("#4f5a59");
  await page.evaluate(() => document.body.classList.add("grey"));
  await expect(page.locator("html")).toHaveAttribute("data-sdt-contrast", "more");
  expect(await theme(page)).toBe("light");
  expect(await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return [style.getPropertyValue("--sdt-fg-muted").trim(), style.getPropertyValue("--sdt-fg").trim()];
  })).toEqual(["#1c2121", "#1c2121"]);
  await page.evaluate(() => document.body.classList.remove("grey"));
  await expect(page.locator("html")).not.toHaveAttribute("data-sdt-contrast", /.*/);
});

test("JSON views and pages that aren't Services Directory pages get no theme check", async ({ page }) => {
  for (const url of [`${REST_ROOT}?f=pjson`, "https://arcgis.test/docs/rest/services/overview"]) {
    await page.goto(url);
    await page.waitForTimeout(700);
    expect(await theme(page), url).toBeNull();
  }
});

test("the options page and the popup follow the system's colour scheme", async ({ page, extensionId, openPopupTab }) => {
  const popup = await openPopupTab(`${REST_ROOT}/Parcels/MapServer`);
  for (const view of [page, popup]) {
    if (view === page) {
      await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
    }
    await view.emulateMedia({ colorScheme: "light" });
    expect(await token(view, "--sdt-bg")).toBe(LIGHT_BG);
    await view.emulateMedia({ colorScheme: "dark" });
    expect(await token(view, "--sdt-bg")).toBe(DARK_BG);
    expect(await theme(view)).toBe("system");
  }
});
