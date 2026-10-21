import { test, expect, FAKE_ORIGIN, REST_ROOT, SERVER_TOKENS } from "./fixtures.js";

const SERVICE_PAGE = `${REST_ROOT}/Parcels/MapServer`;
const OTHER_PAGE = `${FAKE_ORIGIN}/other/page`;

test("the toolbar button is enabled on Services Directory pages and disabled elsewhere", async ({ context, actionEnabled }) => {
  const rest = await context.newPage();
  await rest.goto(SERVICE_PAGE);
  const other = await context.newPage();
  await other.goto(OTHER_PAGE);
  // The content scripts run on a JSON view, but leave the button disabled there.
  const jsonView = await context.newPage();
  await jsonView.goto(`${SERVICE_PAGE}?f=pjson`);
  await expect.poll(() => actionEnabled(rest)).toBe(true);
  await expect.poll(() => actionEnabled(other)).toBe(false);
  expect(await actionEnabled(jsonView)).toBe(false);
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
    // The popup uses fetch (SDT.net.fetchJson). Pass each request to this routed page's fetch. A
    // signal or a body from the popup's realm can't cross over, so rebuild the body as a string and
    // leave the signal behind, and return a Response from the popup's realm.
    popup.fetch = async (url, init = {}) => {
      const response = await fetch(String(url), {
        method: init.method,
        body: init.body ? String(init.body) : undefined,
        headers: init.body ? { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" } : undefined,
        redirect: init.redirect,
        credentials: init.credentials,
        referrerPolicy: init.referrerPolicy
      });
      return new popup.Response(await response.text(), { status: response.status, statusText: response.statusText });
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

test("the URL shortener drops query defaults only from query URLs", async ({ openPopupTab }) => {
  const envelope = "geometry=0,0,10,10&geometryType=esriGeometryEnvelope";
  // On identify, geometryType defaults to esriGeometryPoint, so an envelope has to stay.
  const identify = await openPopupTab(`${SERVICE_PAGE}/identify?${envelope}&tolerance=2&f=html`);
  await expect(identify.locator("#urlshortblank")).toHaveValue(`${SERVICE_PAGE}/identify?${envelope}&tolerance=2`);
  // On query, esriGeometryEnvelope is the default, so it goes.
  const query = await openPopupTab(`${SERVICE_PAGE}/0/query?${envelope}&where=1%3D1&f=html`);
  await expect(query.locator("#urlshortblank")).toHaveValue(`${SERVICE_PAGE}/0/query?geometry=0,0,10,10&where=1%3D1`);
});

test("the popup search sends the tab's token in the POST body, never in a URL (POP-6)", async ({ openPopupTab, fakeServer }) => {
  const token = SERVER_TOKENS.jsmith;
  const popup = await openPopupTab(`${REST_ROOT}/Utilities?token=${token}`);
  await popup.locator("#searchblank").fill("Valves");
  await popup.locator("#searchbtn").click();
  await expect(popup.locator("#searchbtn")).toHaveText("Search");
  // Valves is secured: an anonymous listing leaves it out.
  await expect(popup.locator("#searchresults a")).not.toHaveCount(0);
  const crawl = fakeServer.calls.filter((call) => call.query.f === "json" || call.body.f === "json");
  expect(crawl.length).toBeGreaterThan(0);
  for (const call of crawl) {
    expect(call.method).toBe("POST");
    expect(call.query).toEqual({});
    expect(call.body.token).toBe(token);
  }
});
