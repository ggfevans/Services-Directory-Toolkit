// The status bar that replaces the corner ring (#14, design review section 6.3): one line in the page
// flow under the page's first <h2>, with a throttled role="status" message, a spinner that stops under
// reduced motion, and no listener except its Load more button's.
import { test, expect, html, json, REST_ROOT } from "./fixtures.js";
import { catalog } from "../fixtures/catalog.js";
import { folderPage } from "../fixtures/pages.js";
import { axeViolations } from "./axe.js";

const ROOT_PAGE = /^\/arcgis\/rest\/services$/;
const LAYER_PAGE = `${REST_ROOT}/Parcels/MapServer/0`;
const PRINT_TASK = `${REST_ROOT}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/execute`;
const NO_VIOLATIONS = { light: [], dark: [] };

// The services on the root page that get automatic requests: map, feature and image services.
const ROOT_SERVICES = catalog.services.filter((service) => !service.name.includes("/") && /^(Map|Feature|Image)Server$/.test(service.type));

const bar = (page) => page.locator(".sdt-statusbar");
const message = (page) => bar(page).getByRole("status");

/** The extension's own requests: every one asks for f=json, in its query string or its form body. */
const extensionCalls = (fakeServer) => fakeServer.calls.filter((call) => call.query.f === "json" || call.body.f === "json");
const bulkCalls = (fakeServer) => fakeServer.calls.filter((call) => /\/Bulk\d+\/MapServer$/.test(call.path));

/** Holds the root page's request for the Parcels MapServer until release() is called. */
const holdParcels = (fakeServer) => {
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  fakeServer.override(/^\/arcgis\/rest\/services\/Parcels\/MapServer\?f=json$/, async () => {
    await held;
    return json({ currentVersion: 11.3, serviceDescription: "Held back by the test.", spatialReference: { wkid: 102100, latestWkid: 3857 }, layers: [] });
  });
  return () => release();
};

const animation = (locator) => locator.evaluate((element) => getComputedStyle(element).animationName);

/** True when two bounding boxes share any area. */
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Fails unless the bar's box shares no area with its previous and next element siblings. */
const expectNoOverlap = async (page) => {
  const boxes = await bar(page).evaluate((element) => [element, element.previousElementSibling, element.nextElementSibling]
    .map((node) => (node ? node.getBoundingClientRect().toJSON() : null)));
  const [own, ...neighbours] = boxes;
  expect(own.height).toBeGreaterThan(0);
  for (const box of neighbours.filter(Boolean)) {
    expect(overlaps(own, box)).toBe(false);
  }
};

test("the services root shows a busy bar under the h2, then \"Loaded details for N services in N requests\"", async ({ page, fakeServer }) => {
  const release = holdParcels(fakeServer);
  await page.goto(REST_ROOT);
  await expect(bar(page)).toBeVisible();
  expect(await bar(page).evaluate((element) => element.previousElementSibling === document.body.querySelector("h2"))).toBe(true);
  await expect(bar(page).locator(".sdt-statusbar__name")).toHaveText("SD Toolkit");
  await expect(bar(page).locator(".sdt-statusbar__name .sdt-glyph")).toHaveAttribute("aria-hidden", "true");
  await expect(message(page)).toHaveText(`Loading details: ${ROOT_SERVICES.length - 1} of ${ROOT_SERVICES.length} services`);
  await expect(message(page).locator(".sdt-spinner")).toHaveAttribute("aria-hidden", "true");
  expect(await animation(message(page).locator(".sdt-spinner"))).toBe("sdt-spin");
  release();
  await expect(message(page)).toHaveText(/^Loaded details for/);
  const requests = extensionCalls(fakeServer).length;
  expect(requests).toBe(ROOT_SERVICES.length);
  await expect(message(page)).toHaveText(`Loaded details for ${ROOT_SERVICES.length} services in ${requests} requests`);
  await expect(message(page).locator(".sdt-spinner")).toHaveCount(0);
  await expect(message(page).locator(".sdt-icon")).toHaveCount(1);
  await expect(bar(page).getByRole("button")).toHaveCount(0);
});

test("a page with nothing to load shows no bar", async ({ page, fakeServer }) => {
  await page.goto(LAYER_PAGE);
  // status.js sets the theme last of all, so this attribute says it has run.
  await expect(page.locator("html[data-sdt-theme]")).toBeAttached();
  await page.waitForTimeout(1500);
  // The fixtures prove the page has nothing to report: the extension sent no request.
  expect(extensionCalls(fakeServer)).toEqual([]);
  await expect(bar(page)).toHaveCount(0);
});

test("the message changes at most once a second, and its last state always lands", async ({ page }) => {
  await page.goto(PRINT_TASK);
  await expect(page.locator("html[data-sdt-theme]")).toBeAttached();
  await expect(bar(page)).toHaveCount(0);
  // The first busy class on <body> creates the bar.
  await page.evaluate(() => document.body.classList.add("sdt-loading-test"));
  await expect(bar(page)).toBeVisible();
  // Toggle a busy class on <body> every 100 ms for 2.5 s, and record each change to the message.
  const changes = await page.evaluate(async () => {
    const status = document.querySelector(".sdt-statusbar [role=status]");
    const seen = [];
    new MutationObserver(() => seen.push({ at: performance.now(), text: status.textContent }))
      .observe(status, { childList: true, characterData: true, subtree: true });
    for (let i = 0; i < 25; i++) {
      document.body.classList.toggle("sdt-loading-test");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    document.body.classList.remove("sdt-loading-test");
    await new Promise((resolve) => setTimeout(resolve, 2100));
    return seen;
  });
  expect(changes.length).toBeGreaterThan(1);
  for (let i = 1; i < changes.length; i++) {
    expect(changes[i].at - changes[i - 1].at).toBeGreaterThanOrEqual(990);
  }
  expect(changes.map((change) => change.text)).toContain("Loading");
  expect(changes.at(-1).text).toBe("Finished loading");
});

test("under reduced motion the spinner doesn't animate", async ({ page, fakeServer }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const release = holdParcels(fakeServer);
  await page.goto(REST_ROOT);
  await expect(message(page)).toHaveText(/^Loading details:/);
  expect(await animation(message(page).locator(".sdt-spinner"))).toBe("none");
  release();
  await expect(message(page)).toHaveText(/^Loaded details for/);
});

test("the bar has no event listeners, and its only button is Load more (SEC-1, ADV-3) @cdp", async ({ page, bulkRoot }) => {
  bulkRoot(60);
  await page.goto(REST_ROOT);
  const button = bar(page).getByRole("button");
  await expect(button).toHaveText("Load 10 more services");
  await expect(button).toHaveCount(1);
  // CDP lists the listeners of every world, the extension's isolated world included.
  const cdp = await page.context().newCDPSession(page);
  const { result } = await cdp.send("Runtime.evaluate", { expression: "document.querySelector(\".sdt-statusbar\")" });
  const { listeners } = await cdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId, depth: -1, pierce: true });
  const { result: buttonObject } = await cdp.send("Runtime.evaluate", { expression: "document.querySelector(\".sdt-statusbar button\")" });
  const { node } = await cdp.send("DOM.describeNode", { objectId: buttonObject.objectId });
  expect(listeners.map((listener) => [listener.type, listener.backendNodeId])).toEqual([["click", node.backendNodeId]]);
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 800, height: 600 }]) {
  test(`the bar overlaps no page content at ${viewport.width} × ${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(REST_ROOT);
    await expect(message(page)).toHaveText(/^Loaded details for/);
    await expectNoOverlap(page);
  });
}

test("on a page with no h2 the bar is body's first child and overlaps nothing", async ({ page, fakeServer }) => {
  const root = folderPage({
    folder: "",
    folders: catalog.folders,
    services: catalog.services.filter((service) => !service.name.includes("/")),
    version: catalog.currentVersion
  }).replace(/<h2>[^<]*<\/h2>/, "");
  expect(root).not.toContain("<h2");
  fakeServer.override(ROOT_PAGE, () => html(root));
  await page.goto(REST_ROOT);
  await expect(message(page)).toHaveText(/^Loaded details for/);
  expect(await bar(page).evaluate((element) => element === document.body.firstElementChild)).toBe(true);
  await expectNoOverlap(page);
});

test("axe passes on the bar in light and dark, on a light host page, done and paused", async ({ page, bulkRoot }) => {
  await page.goto(REST_ROOT);
  await expect(message(page)).toHaveText(/^Loaded details for/);
  expect(await axeViolations(page, { include: ".sdt-statusbar", hostPage: true })).toEqual(NO_VIOLATIONS);
  bulkRoot(60);
  await page.goto(REST_ROOT);
  await expect(bar(page).getByRole("button")).toHaveText("Load 10 more services");
  expect(await axeViolations(page, { include: ".sdt-statusbar", hostPage: true })).toEqual(NO_VIOLATIONS);
});

test.describe("on a dark host page", () => {
  test.use({ hostStyle: "dark" });

  test("axe passes on the bar in light and dark", async ({ page }) => {
    await page.goto(REST_ROOT);
    await expect(message(page)).toHaveText(/^Loaded details for/);
    expect(await axeViolations(page, { include: ".sdt-statusbar" })).toEqual(NO_VIOLATIONS);
  });
});

test("Load more is reachable with Tab and works with Enter, and a second press while loading sends nothing", async ({ page, fakeServer, bulkRoot }) => {
  // The ten rows Load more sends answer only when the test says, so the second press lands mid-batch.
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  fakeServer.override(/^\/arcgis\/rest\/services\/Bulk(5[1-9]|60)\/MapServer\?f=json$/, async () => {
    await held;
    return json({ currentVersion: catalog.currentVersion, serviceDescription: "Held back by the test.", spatialReference: { wkid: 102100, latestWkid: 3857 }, layers: [] });
  });
  bulkRoot(60);
  await page.goto(REST_ROOT);
  const button = bar(page).getByRole("button", { name: "Load 10 more services" });
  await expect(button).toBeVisible();
  await expect(bar(page)).toHaveAttribute("data-tone", "warn");
  await expect(message(page)).toHaveText("Paused after 50 automatic requests. 10 services not loaded yet.");
  expect(bulkCalls(fakeServer)).toHaveLength(50);
  // The bar comes right after the heading in the page's order: from the heading, Tab reaches the button.
  await page.locator("h2").first().evaluate((heading) => {
    heading.tabIndex = -1;
    heading.focus();
  });
  await page.keyboard.press("Tab");
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(button).toBeDisabled();
  await expect.poll(() => bulkCalls(fakeServer).length).toBe(54);
  await page.keyboard.press("Enter");
  await button.dispatchEvent("click");
  await page.waitForTimeout(300);
  expect(bulkCalls(fakeServer)).toHaveLength(54);
  release();
  await expect(message(page)).toHaveText("Loaded details for 60 services in 60 requests");
  await page.waitForTimeout(500);
  expect(bulkCalls(fakeServer)).toHaveLength(60);
  await expect(bar(page).getByRole("button")).toHaveCount(0);
  await expect(bar(page)).toHaveAttribute("data-tone", "ok");
});
