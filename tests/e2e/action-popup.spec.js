import { test, expect, FAKE_ORIGIN, REST_ROOT } from "./fixtures.js";

const SERVICE_PAGE = `${REST_ROOT}/Parcels/MapServer`;
const OTHER_PAGE = `${FAKE_ORIGIN}/other/page`;

test("the toolbar button is enabled on Services Directory pages and disabled elsewhere", async ({ context, actionEnabled }) => {
  const rest = await context.newPage();
  await rest.goto(SERVICE_PAGE);
  const other = await context.newPage();
  await other.goto(OTHER_PAGE);
  await expect.poll(() => actionEnabled(rest)).toBe(true);
  await expect.poll(() => actionEnabled(other)).toBe(false);
});

test.describe("with the back/forward cache on", () => {
  // Playwright turns the back/forward cache off by default.
  test.use({ droppedDefaultArgs: ["--disable-back-forward-cache"] });

  test("the button is enabled again after Back restores a Services Directory page", async ({ page, actionEnabled }) => {
    await page.goto(SERVICE_PAGE);
    await expect.poll(() => actionEnabled(page)).toBe(true);
    await page.evaluate(() => {
      window.restoredFromCache = false;
      window.addEventListener("pageshow", (event) => {
        window.restoredFromCache = event.persisted;
      });
    });
    await page.goto(OTHER_PAGE);
    await expect.poll(() => actionEnabled(page)).toBe(false);
    // A page restored from the cache fires no load event, so wait only for the commit.
    await page.goBack({ waitUntil: "commit" });
    await expect.poll(() => page.evaluate(() => window.restoredFromCache)).toBe(true);
    await expect.poll(() => actionEnabled(page)).toBe(true);
  });
});

test("clicking the toolbar button opens the popup on a Services Directory page", { tag: "@cdp" }, async ({ page, actionEnabled, clickAction, popupView }) => {
  await page.goto(SERVICE_PAGE);
  await expect.poll(() => actionEnabled(page)).toBe(true);
  await clickAction(page);
  await popupView.waitForOpen();
});

test("clicking the toolbar button on another page opens nothing", { tag: "@cdp" }, async ({ page, actionEnabled, clickAction, popupView }) => {
  await page.goto(OTHER_PAGE);
  await expect.poll(() => actionEnabled(page)).toBe(false);
  await clickAction(page);
  // A refused click has no event to wait for, so give a popup time to appear.
  await page.waitForTimeout(1000);
  expect(await popupView.isOpen()).toBe(false);
});

test("the real popup reads the tab's URL, which needs activeTab", { tag: "@cdp" }, async ({ page, fakeServer, actionEnabled, clickAction, popupView }) => {
  await page.goto(`${SERVICE_PAGE}?f=html`);
  await expect.poll(() => actionEnabled(page)).toBe(true);
  await clickAction(page);
  await popupView.waitForOpen();

  // The URL shortener starts from the tab's URL and drops f=html.
  await expect.poll(() => popupView.page.evaluate(() =>
    chrome.extension.getViews({ type: "popup" })[0].document.getElementById("urlshortblank").value
  )).toMatch(/^https:\/\/arcgis\.test\/arcgis\/rest\/services\/Parcels\/MapServer\??$/);

  // REST search starts from the tab's URL too. The real popup's own requests bypass Playwright's
  // routing, so they never reach the fake server. Send them through this routed page instead.
  await popupView.page.evaluate(() => {
    const popup = chrome.extension.getViews({ type: "popup" })[0];
    popup.XMLHttpRequest = class {
      open(method, url) {
        this.method = method;
        this.url = url;
      }
      setRequestHeader() {}
      async send(body) {
        try {
          this.responseText = await (await fetch(this.url, { method: this.method, body })).text();
        } finally {
          this.readyState = 4;
          this.onreadystatechange();
        }
      }
    };
    popup.document.getElementById("searchblank").value = "Parcels";
    popup.document.getElementById("searchbtn").click();
  });
  await expect.poll(() => popupView.page.evaluate(() => {
    const popup = chrome.extension.getViews({ type: "popup" })[0].document;
    return popup.getElementById("searchbtn").textContent === "Search" && popup.querySelectorAll("#searchresults a").length > 0;
  })).toBe(true);
  // The search asked for the tab's URL without its query, as JSON.
  expect(fakeServer.requests).toContain("GET /arcgis/rest/services/Parcels/MapServer?f=json");
});

test("the popup page renders its search and URL tools", async ({ openPopupTab }) => {
  const popup = await openPopupTab(SERVICE_PAGE);
  await expect(popup.getByRole("button", { name: "Search" })).toBeVisible();
  // Hidden when the URL has nothing to remove, so the role query has to include hidden elements.
  const copy = popup.getByRole("button", { name: "Copy to Clipboard", includeHidden: true });
  await expect(copy).toBeAttached();
  await expect(copy).toBeHidden();
});
