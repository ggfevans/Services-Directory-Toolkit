// axe-core and keyboard-only checks for the status bar and the popup (store-readiness spec, section
// 4.2). status-bar.spec.js runs axe on the bar in each tone, and on light and dark host pages.
import { test, expect, REST_ROOT } from "./fixtures.js";
import { axeViolations } from "./axe.js";

const NO_VIOLATIONS = { light: [], dark: [] };

test("axe finds nothing wrong with the popup, in light and dark", async ({ openPopupTab }) => {
  // f=html can be trimmed, so the URL tools show too.
  const popup = await openPopupTab(`${REST_ROOT}/Parcels/MapServer?f=html`);
  await expect(popup.getByRole("button", { name: "Copy to Clipboard" })).toBeVisible();
  expect(await axeViolations(popup)).toEqual(NO_VIOLATIONS);
});

test("without Load more, the keyboard never stops in the status bar", async ({ page }) => {
  await page.goto(REST_ROOT);
  await expect(page.locator(".sdt-statusbar").getByRole("status")).toHaveText(/^Loaded details for/);
  const links = await page.locator("a[href]").count();
  for (let i = 0; i <= links; i++) {
    await page.keyboard.press("Tab");
    const inBar = await page.evaluate(() => document.querySelector(".sdt-statusbar").contains(document.activeElement));
    expect(inBar).toBe(false);
  }
});

test("every popup control is reachable with Tab, in order, and Options opens with Enter", async ({ openPopupTab, context, extensionId }) => {
  const popup = await openPopupTab(`${REST_ROOT}/Parcels/MapServer?f=html`);
  await expect(popup.getByRole("button", { name: "Copy to Clipboard" })).toBeVisible();
  const order = [];
  for (let i = 0; i < 5; i++) {
    await popup.keyboard.press("Tab");
    order.push(await popup.evaluate(() => {
      const element = document.activeElement;
      return `${element.tagName.toLowerCase()} ${element.getAttribute("aria-label") || element.placeholder || element.textContent.trim()}`;
    }));
  }
  expect(order).toEqual([
    "input Shortened URL",
    "button Copy to Clipboard",
    "input Searches current folder and subdirectories",
    "button Search",
    "a Options"
  ]);
  const opened = context.waitForEvent("page");
  await popup.keyboard.press("Enter");
  await expect(await opened).toHaveURL(`chrome-extension://${extensionId}/src/options/options.html`);
  // The popup stays where it is: the link's own navigation is cancelled.
  expect(popup.url()).toBe(`chrome-extension://${extensionId}/src/page_action/page_action.html`);
});

test("the popup search runs from the keyboard", async ({ openPopupTab }) => {
  const popup = await openPopupTab(`${REST_ROOT}/Transport/Roads/MapServer`);
  await popup.getByPlaceholder("Searches current folder and subdirectories").focus();
  await popup.keyboard.type("Roads");
  await popup.keyboard.press("Tab");
  await popup.keyboard.press("Enter");
  await expect(popup.getByRole("button", { name: "Search" })).toBeEnabled();
  await expect(popup.locator("#searchresults a")).not.toHaveCount(0);
});
