// What the extension sends: the request budget and the token rules (store-readiness spec, section
// 4.3, and token support spec, section 5.3). fakeServer.calls records each request's query string
// and form body separately, so the tests can tell where a token went.
import { test, expect, FAKE_ORIGIN, html, json, ONLINE_ORIGIN, ONLINE_REST_ROOT, ONLINE_TOKENS, REST_ROOT, SERVER_TOKENS } from "./fixtures.js";
import { catalog } from "../fixtures/catalog.js";
import { folderPage } from "../fixtures/pages.js";
import { axeViolations } from "./axe.js";

const ROOT_PAGE = /^\/arcgis\/rest\/services$/;

// The services root opened with ?token= (TR-22).
const withToken = (root, token) => `${root}?token=${token}`;

/** The services root, with extra list items (HTML) at the top of its services list. */
const rootWith = (extraItems) => folderPage({
  folder: "",
  folders: catalog.folders,
  services: catalog.services.filter((service) => !service.name.includes("/")),
  version: catalog.currentVersion
}).replace("<b>Services: </b>\n<ul>\n", `<b>Services: </b>\n<ul>\n${extraItems}`);

const BAD_GATEWAY = () => ({ status: 502, contentType: "text/html", body: "<html><body>Bad Gateway</body></html>" });

/** A service's row on a folder page: the list item that holds the link to it. */
const serviceRow = (page, path) => page.locator("li", { has: page.locator(`a[href$="/rest/services/${path}"]`) });

const ONLINE_LINKS =`<li><a href="${ONLINE_REST_ROOT}/Parcels/FeatureServer">Online parcels</a> (FeatureServer)</li>
<li><a href="${ONLINE_REST_ROOT}/Parcels/MapServer">Online parcels map</a> (MapServer)</li>
`;

test("links to another server get no automatic requests", async ({ page, fakeServer }) => {
  fakeServer.override(ROOT_PAGE, () => html(rootWith(ONLINE_LINKS)));
  await page.goto(REST_ROOT);
  await expect(page.locator("details.sdt-details")).toHaveCount(3);
  await page.waitForTimeout(500);
  expect(fakeServer.calls.filter((call) => call.origin !== FAKE_ORIGIN)).toEqual([]);
});

test("a page with 60 service links sends 50 requests, and the bar says why the other rows are empty", async ({ page, fakeServer, bulkRoot }) => {
  bulkRoot(60);
  await page.goto(REST_ROOT);
  await expect(page.locator(".sdt-statusbar").getByRole("status")).toHaveText("Paused after 50 automatic requests. 10 services not loaded yet.");
  await expect(page.locator("details.sdt-details")).toHaveCount(50);
  expect(fakeServer.calls.filter((call) => /\/Bulk\d+\/MapServer$/.test(call.path))).toHaveLength(50);
});

test("one failed service request shows an error on its row, and the other rows load (INJ-2)", async ({ page, fakeServer, expectedErrors }) => {
  fakeServer.override(/^\/arcgis\/rest\/services\/Parcels\/MapServer\?f=json$/, BAD_GATEWAY);
  expectedErrors.push(/status of 502/);
  await page.goto(REST_ROOT);
  // Visible on the row, not tucked into a collapsed details block.
  await expect(serviceRow(page, "Parcels/MapServer").getByText(/HTTP 502/)).toBeVisible();
  for (const path of ["Parcels/FeatureServer", "Elevation/ImageServer"]) {
    await expect(serviceRow(page, path).locator("details.sdt-details")).toHaveCount(1);
  }
  await expect.poll(() => page.evaluate(() => document.body.className)).not.toMatch(/sdt-loading-/);
});

test("a service that answers 200 with an ArcGIS error body fails its row with the server's message", async ({ page, fakeServer }) => {
  fakeServer.override(/^\/arcgis\/rest\/services\/Parcels\/MapServer\?f=json$/, () => json({ error: { code: 499, message: "Token Required", details: [] } }));
  await page.goto(REST_ROOT);
  await expect(serviceRow(page, "Parcels/MapServer").getByText(/Token Required/)).toBeVisible();
  for (const path of ["Parcels/FeatureServer", "Elevation/ImageServer"]) {
    await expect(serviceRow(page, path).locator("details.sdt-details")).toHaveCount(1);
  }
  await expect.poll(() => page.evaluate(() => document.body.className)).not.toMatch(/sdt-loading-/);
});

test("count queries send the where clause as a param, not spliced into the URL (INJ-5)", async ({ page, fakeServer }) => {
  await page.goto(`${REST_ROOT}/Parcels/MapServer`);
  await expect(page.locator(".sdt-count", { hasText: "with shapes" })).toHaveCount(2);
  const counts = fakeServer.calls.filter((call) => call.query.returnCountOnly === "true");
  expect(counts).toHaveLength(4);
  for (const call of counts) {
    expect(call.path).toMatch(/^\/arcgis\/rest\/services\/Parcels\/MapServer\/\d+\/query$/);
    expect(call.query.where).toMatch(/^\w+ IS NOT NULL$/);
  }
  expect(counts.map((call) => call.query.where).sort()).toEqual(["OBJECTID IS NOT NULL", "OBJECTID IS NOT NULL", "SHAPE IS NOT NULL", "SHAPE IS NOT NULL"]);
});

test("a page opened with ?token= sends the token in each metadata request's POST body, not its URL", async ({ page, fakeServer }) => {
  const token = SERVER_TOKENS.jsmith;
  await page.goto(`${REST_ROOT}/Utilities?token=${token}`);
  // Valves and Mains are secured: their details appear only if the token reached the server.
  await expect(page.locator("details.sdt-details", { hasText: "Water valves for an invented utility." })).toHaveCount(1);
  await expect(page.locator("details.sdt-details", { hasText: "Water mains for an invented utility." })).toHaveCount(1);
  const metadata = fakeServer.calls.filter((call) => /\/(MapServer|FeatureServer)$/.test(call.path));
  expect(metadata).toHaveLength(2);
  for (const call of metadata) {
    expect(call.origin).toBe(FAKE_ORIGIN);
    expect(call.method).toBe("POST");
    expect(call.query).toEqual({});
    expect(call.body).toEqual({ f: "json", token });
  }
});

test("on ArcGIS Online, links that carry the page's token get metadata, with the token only in the body (TOK-3)", async ({ page, fakeServer }) => {
  const token = ONLINE_TOKENS.jsmith;
  await page.goto(withToken(ONLINE_REST_ROOT, token));
  await expect(page.locator("details.sdt-details")).toHaveCount(2);
  await expect(page.locator("details.sdt-details", { hasText: "Fire hydrants for an invented city." })).toHaveCount(1);
  const metadata = fakeServer.calls.filter((call) => call.origin === ONLINE_ORIGIN && /\/FeatureServer$/.test(call.path));
  expect(metadata).toHaveLength(2);
  for (const call of metadata) {
    expect(call.method).toBe("POST");
    expect(call.query).toEqual({});
    expect(call.body).toEqual({ f: "json", token });
  }
});

test("a request that carries the token stops at a 307, and nothing reaches the redirect's target (TOK-1)", async ({ page, fakeServer }) => {
  const token = SERVER_TOKENS.jsmith;
  fakeServer.override(/^\/arcgis\/rest\/services\/Parcels\/MapServer$/, () => ({ status: 307, headers: { location: `${ONLINE_ORIGIN}/landing` }, body: "" }));
  await page.goto(withToken(REST_ROOT, token));
  const row = page.locator("li").filter({ hasText: /^\s*Parcels \(MapServer\)/ });
  await expect(row).toContainText("redirect");
  const redirected = fakeServer.calls.filter((call) => call.path === "/arcgis/rest/services/Parcels/MapServer");
  expect(redirected).toHaveLength(1);
  expect(redirected[0].body).toEqual({ f: "json", token });
  // If the browser had followed the 307, the harness would also record its target as not routed.
  expect(fakeServer.calls.filter((call) => call.origin !== FAKE_ORIGIN)).toEqual([]);
});

test("hovering a link to another server sends nothing", async ({ page, fakeServer }) => {
  fakeServer.override(ROOT_PAGE, () => html(rootWith(ONLINE_LINKS)));
  await page.goto(REST_ROOT);
  await expect(page.locator("details.sdt-details")).toHaveCount(3);
  await page.getByRole("link", { name: "Online parcels map", exact: true }).hover();
  await page.waitForTimeout(500);
  expect(fakeServer.calls.filter((call) => call.origin !== FAKE_ORIGIN)).toEqual([]);
});

test("hovering a link on this server shows its map preview, without the page's token", async ({ page, fakeServer }) => {
  // A 1x1 transparent PNG, so the preview loads nothing from the network.
  const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=#preview";
  fakeServer.override(/^\/arcgis\/rest\/services\/Parcels\/MapServer\/\?f=json$/, () => json({ initialExtent: { xmin: 0, ymin: 0, xmax: 10, ymax: 10 } }));
  fakeServer.override(/^\/arcgis\/rest\/services\/Parcels\/MapServer\/export\?/, () => json({ href: image }));
  await page.goto(withToken(REST_ROOT, SERVER_TOKENS.jsmith));
  await expect(page.locator("details.sdt-details")).toHaveCount(3);
  await page.getByRole("link", { name: "Parcels", exact: true }).first().hover();
  await expect(page.locator("#mapimage")).toHaveAttribute("src", image);
  const previews = fakeServer.calls.filter((call) => /\/Parcels\/MapServer\/(export)?$/.test(call.path));
  expect(previews.map((call) => call.path)).toEqual(["/arcgis/rest/services/Parcels/MapServer/", "/arcgis/rest/services/Parcels/MapServer/export"]);
  for (const call of previews) {
    expect(call.method).toBe("GET");
    expect(call.body).toEqual({});
    expect(Object.keys(call.query)).not.toContain("token");
  }
  expect(previews[1].query).toEqual({ size: "300,200", format: "png32", f: "json", bbox: "0,0,10,10" });
});

// The request budget, Load more and server pushback, end to end (spec 4.3, design review 6.3).
const LAYER_PAGE = `${REST_ROOT}/Parcels/MapServer/0`;
const NO_VIOLATIONS = { light: [], dark: [] };
const BULK_JSON = /^\/arcgis\/rest\/services\/Bulk\d+\/MapServer\?f=json$/;
const bar = (page) => page.locator(".sdt-statusbar");
const message = (page) => bar(page).getByRole("status");
const bulkCalls = (fakeServer) => fakeServer.calls.filter((call) => /\/Bulk\d+\/MapServer$/.test(call.path));
const bulkService = () => json({
  currentVersion: catalog.currentVersion,
  serviceDescription: "An invented bulk service.",
  spatialReference: { wkid: 102100, latestWkid: 3857 },
  layers: []
});
// String() throws on this, because its toString isn't a function and valueOf gives back the object.
const UNPRINTABLE = { toString: null };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const never = () => new Promise(() => {});
const bodyClasses = (page) => page.evaluate(() => document.body.className);
/** The services root listing count Bulk MapServers, for a test that answers their JSON with its own override. */
const bulkListing = (fakeServer, count) => {
  const services = Array.from({ length: count }, (_, i) => ({ name: `Bulk${String(i + 1).padStart(2, "0")}`, type: "MapServer" }));
  fakeServer.override(ROOT_PAGE, () => html(folderPage({ folder: "", folders: [], services, version: catalog.currentVersion })));
  return services;
};
// The map preview panel sits over the top right of the page, where the bar's button is (IMG-3,
// Phase 6), so the tests press Load more from the keyboard, as a keyboard user does.
const pressLoadMore = (button) => button.press("Enter");
const pushbackCopy = (status) => `The server asked for fewer requests (HTTP ${status}). Automatic requests stopped on this page.`;

test("60 rows send exactly 50, the bar offers \"Load 10 more services\", and one click sends exactly 10 more", async ({ page, fakeServer, bulkRoot }) => {
  bulkRoot(60);
  await page.goto(REST_ROOT);
  const button = bar(page).getByRole("button", { name: "Load 10 more services" });
  await expect(button).toBeVisible();
  expect(bulkCalls(fakeServer)).toHaveLength(50);
  await pressLoadMore(button);
  await expect(message(page)).toHaveText("Loaded details for 60 services in 60 requests");
  await page.waitForTimeout(300);
  expect(bulkCalls(fakeServer)).toHaveLength(60);
  expect(new Set(bulkCalls(fakeServer).map((call) => call.path)).size).toBe(60);
  await expect(page.getByText(/Not loaded/)).toHaveCount(0);
  await expect(page.locator("details.sdt-details")).toHaveCount(60);
  await expect(bar(page).getByRole("button")).toHaveCount(0);
});

test("120 rows: Load more sends 50, then offers \"Load 20 more services\"", async ({ page, fakeServer, bulkRoot }) => {
  bulkRoot(120);
  await page.goto(REST_ROOT);
  await pressLoadMore(bar(page).getByRole("button", { name: "Load 50 more services" }));
  const next = bar(page).getByRole("button", { name: "Load 20 more services" });
  await expect(next).toBeVisible();
  await expect(message(page)).toHaveText("Paused after 100 automatic requests. 20 services not loaded yet.");
  expect(bulkCalls(fakeServer)).toHaveLength(100);
  await pressLoadMore(next);
  await expect(message(page)).toHaveText("Loaded details for 120 services in 120 requests");
  expect(bulkCalls(fakeServer)).toHaveLength(120);
});

test("a row cut off mid-chain gets only its missing count on Load more", async ({ page, fakeServer }) => {
  // 49 one-request rows, then a layer row: its JSON is request 50, and the budget refuses its counts.
  const services = Array.from({ length: 49 }, (_, i) => ({ name: `Bulk${String(i + 1).padStart(2, "0")}`, type: "MapServer" }));
  services.push({ name: "Parcels", type: "MapServer/0" });
  fakeServer.override(ROOT_PAGE, () => html(folderPage({ folder: "", folders: [], services, version: catalog.currentVersion })));
  fakeServer.override(BULK_JSON, bulkService);
  await page.goto(REST_ROOT);
  const button = bar(page).getByRole("button", { name: "Load 1 more service" });
  await expect(button).toBeVisible();
  const layerJson = () => fakeServer.calls.filter((call) => call.path === "/arcgis/rest/services/Parcels/MapServer/0");
  const counts = () => fakeServer.calls.filter((call) => call.path === "/arcgis/rest/services/Parcels/MapServer/0/query");
  expect(layerJson()).toHaveLength(1);
  expect(counts()).toHaveLength(0);
  const layerRow = page.locator("li", { has: page.locator("a[href$=\"/Parcels/MapServer/0\"]") });
  await expect(message(page)).toHaveText("Paused after 50 automatic requests. 1 service not loaded yet.");
  await expect(layerRow.locator("details.sdt-details")).toHaveCount(1);
  await expect(layerRow.getByText(/Not loaded/)).toHaveCount(0);
  await pressLoadMore(button);
  await expect(message(page)).toHaveText("Loaded details for 50 services in 52 requests");
  await expect(layerRow.locator(".sdt-count")).toHaveText(["3 features", "2 with shapes"]);
  await page.waitForTimeout(300);
  expect(counts()).toHaveLength(2);
  expect(layerJson()).toHaveLength(1);
  await expect(page.getByText(/Not loaded/)).toHaveCount(0);
});

test("no more than 4 requests are in flight", async ({ page, fakeServer }) => {
  const spans = [];
  fakeServer.override(BULK_JSON, async () => {
    const span = { start: performance.now(), end: Infinity };
    spans.push(span);
    await pause(300);
    span.end = performance.now();
    return bulkService();
  });
  bulkListing(fakeServer, 12);
  await page.goto(REST_ROOT);
  await expect(message(page)).toHaveText("Loaded details for 12 services in 12 requests");
  expect(spans).toHaveLength(12);
  // The peak overlap: the most spans open at any span's start.
  const peak = Math.max(...spans.map(({ start }) => spans.filter((span) => span.start <= start && start < span.end).length));
  expect(peak).toBe(4);
});

for (const status of [429, 503]) {
  test(`HTTP ${status} stops automatic requests and the bar shows the pushback message`, async ({ page, fakeServer, expectedErrors }) => {
    expectedErrors.push(new RegExp(`status of ${status}`));
    // Bulk01 answers, so Bulk05 takes its place while Bulk02 to 04 are still in flight, and they
    // never answer. Bulk05 pushes back at once: nothing after it may be sent.
    fakeServer.override(/^\/arcgis\/rest\/services\/Bulk01\/MapServer\?f=json$/, bulkService);
    fakeServer.override(/^\/arcgis\/rest\/services\/Bulk0[2-4]\/MapServer\?f=json$/, never);
    fakeServer.override(/^\/arcgis\/rest\/services\/Bulk05\/MapServer\?f=json$/, () => ({ status, contentType: "text/plain", body: "Slow down" }));
    bulkListing(fakeServer, 12);
    await page.goto(REST_ROOT);
    await expect(message(page)).toHaveText(pushbackCopy(status));
    await expect(bar(page)).toHaveAttribute("data-tone", "error");
    await expect(bar(page).getByRole("button")).toHaveCount(0);
    await expect.poll(() => bodyClasses(page)).not.toMatch(/sdt-loading-/);
    await page.waitForTimeout(800);
    expect(bulkCalls(fakeServer).map((call) => call.path.split("/")[4]).sort()).toEqual(["Bulk01", "Bulk02", "Bulk03", "Bulk04", "Bulk05"]);
    // The rows in flight were cancelled, and the rest were never sent: they stay plain, and the bar says why.
    await expect(page.locator("details.sdt-details")).toHaveCount(1);
    await expect(page.locator(".sdt-spinner")).toHaveCount(0);
    await expect(page.getByText(/Not loaded/)).toHaveCount(0);
    await expect(message(page)).toHaveText(pushbackCopy(status));
    expect(await axeViolations(page, { include: ".sdt-statusbar", hostPage: true })).toEqual(NO_VIOLATIONS);
  });
}

test("pushback during a Load more batch removes the button and leaves no row busy", async ({ page, fakeServer, bulkRoot, expectedErrors, seedStorage }) => {
  expectedErrors.push(/status of 429/);
  // No map preview panel, so the pointer can reach the button (IMG-3).
  await seedStorage({ showMapImages: false });
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  // In the Load more batch, Bulk55 pushes back once the test has looked at the disabled button.
  fakeServer.override(/^\/arcgis\/rest\/services\/Bulk55\/MapServer\?f=json$/, async () => {
    await held;
    return { status: 429, contentType: "text/plain", body: "Slow down" };
  });
  fakeServer.override(/^\/arcgis\/rest\/services\/Bulk(5[1-46-9]|60)\/MapServer\?f=json$/, async () => {
    await held;
    await pause(300);
    return bulkService();
  });
  bulkRoot(60);
  await page.goto(REST_ROOT);
  const button = bar(page).getByRole("button", { name: "Load 10 more services" });
  await expect(button).toBeVisible();
  const background = () => button.evaluate((element) => getComputedStyle(element).backgroundColor);
  const idle = await background();
  await pressLoadMore(button);
  await expect(button).toHaveAttribute("aria-disabled", "true");
  // A button that does nothing doesn't look pressable: hovering it keeps its resting background.
  await button.hover();
  expect(await background()).toBe(idle);
  release();
  await expect(message(page)).toHaveText(pushbackCopy(429));
  const sent = bulkCalls(fakeServer).length;
  await expect(bar(page)).toHaveAttribute("data-tone", "error");
  await expect(bar(page).getByRole("button")).toHaveCount(0);
  await expect.poll(() => bodyClasses(page)).not.toMatch(/sdt-loading-/);
  // Every row of the batch settled: it loaded, or it stayed plain, because the bar says the server stopped them.
  await expect(page.locator(".sdt-spinner")).toHaveCount(0);
  await expect(page.getByText(/Not loaded/)).toHaveCount(0);
  // The button went away while it had focus: focus moved to the bar's message.
  expect(await page.evaluate(() => document.activeElement === document.querySelector(".sdt-statusbar [role=status]"))).toBe(true);
  // Nothing more went out after the pushback, and Bulk59 and 60 were never sent.
  await page.waitForTimeout(500);
  expect(bulkCalls(fakeServer)).toHaveLength(sent);
  expect(sent).toBeLessThan(60);
});

test("a Load more batch whose row throws re-enables the bar, with no unhandled rejection", async ({ page, fakeServer, bulkRoot }) => {
  // A description that can't become a string makes inject.js throw while it draws Bulk55's row, and the row reports failed.
  fakeServer.override(/^\/arcgis\/rest\/services\/Bulk55\/MapServer\?f=json$/, () => json({ currentVersion: catalog.currentVersion, description: UNPRINTABLE }));
  bulkRoot(60);
  await page.goto(REST_ROOT);
  await pressLoadMore(bar(page).getByRole("button", { name: "Load 10 more services" }));
  await expect(message(page)).toHaveText("Loaded details for 59 services in 60 requests. 1 failed.");
  await expect(bar(page).getByRole("button")).toHaveCount(0);
  await expect.poll(() => bodyClasses(page)).not.toMatch(/sdt-loading-/);
  // The harness fails the test on the unhandled rejection, which the console reports as an error.
  await page.waitForTimeout(300);
});

// A row whose JSON is unusable on the first automatic batch: no unhandled rejection, an error line on
// that row, the other rows load, and the bar settles in the done state.
for (const [title, body] of [
  ["a description that can't become a string", () => json({ currentVersion: catalog.currentVersion, description: UNPRINTABLE })],
  ["a literal null body", () => ({ status: 200, headers: { "content-type": "application/json" }, body: "null" })]
]) {
  test(`the first batch survives a row with ${title}: it shows an error line and the bar finishes`, async ({ page, fakeServer, bulkRoot }) => {
    fakeServer.override(/^\/arcgis\/rest\/services\/Bulk03\/MapServer\?f=json$/, body);
    bulkRoot(6);
    await page.goto(REST_ROOT);
    await expect(message(page)).toHaveText("Loaded details for 5 services in 6 requests. 1 failed.");
    await expect.poll(() => bodyClasses(page)).not.toMatch(/sdt-loading-/);
    await expect(page.getByText(/Could not show this row|not a service description/)).toHaveCount(1);
    await expect(page.locator("details.sdt-details")).toHaveCount(5);
    // The harness fails the test on an unhandled rejection, which the console reports as an error.
    await page.waitForTimeout(300);
  });
}

// A row whose total-count query answers literal null is a failed count: an error line, not a silent
// success that Load more would never retry.
test("a count whose body is literal null shows an error line and fails the row", async ({ page, fakeServer, bulkRoot }) => {
  fakeServer.override(/^\/arcgis\/rest\/services\/Bulk03\/MapServer\?f=json$/, () => json({
    currentVersion: catalog.currentVersion,
    objectIdField: "OBJECTID",
    fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }]
  }));
  fakeServer.override(/^\/arcgis\/rest\/services\/Bulk03\/MapServer\/query\?/, () => ({ status: 200, headers: { "content-type": "application/json" }, body: "null" }));
  bulkRoot(6);
  await page.goto(REST_ROOT);
  await expect(message(page)).toHaveText("Loaded details for 5 services in 7 requests. 1 failed.");
  await expect.poll(() => bodyClasses(page)).not.toMatch(/sdt-loading-/);
  await expect(page.getByText(/not a count/)).toHaveCount(1);
  await expect(page.locator("details.sdt-details")).toHaveCount(6);
  await page.waitForTimeout(300);
});

test("pagehide cancels pending requests", async ({ page, fakeServer }) => {
  // The Bulk requests answer only once the test releases them, after the pagehide.
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  fakeServer.override(BULK_JSON, async () => {
    await held;
    return bulkService();
  });
  bulkListing(fakeServer, 12);
  await page.goto(REST_ROOT);
  await expect(message(page)).toHaveText("Loading details: 0 of 12 services");
  await expect(message(page).locator(".sdt-spinner")).toBeVisible();
  expect(await axeViolations(page, { include: ".sdt-statusbar", hostPage: true })).toEqual(NO_VIOLATIONS);
  expect(bulkCalls(fakeServer)).toHaveLength(4);
  // Fire pagehide in the live document (the isolated world sees the same DOM events), so the page
  // stays to show what happened, then let the four requests in flight answer.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  release();
  await page.waitForTimeout(800);
  expect(bulkCalls(fakeServer)).toHaveLength(4);
  // The eight queued rows were never sent and the four in flight were cancelled: all twelve stay plain.
  await expect(page.locator(".sdt-annot")).toHaveCount(0);
  await expect(page.getByText(/Not loaded/)).toHaveCount(0);
  await expect(page.locator("details.sdt-details")).toHaveCount(0);
  await expect(message(page)).toHaveText("Loaded details for 0 services in 4 requests");
  expect(await bodyClasses(page)).not.toMatch(/sdt-loading-/);
});

test.describe("with the back/forward cache on", () => {
  // Playwright turns the back/forward cache off by default.
  test.use({ droppedDefaultArgs: ["--disable-back-forward-cache"] });

  test("back/forward restore after leaving mid-load leaves no row busy and no sdt-loading- class", async ({ page, fakeServer }, testInfo) => {
    // The first view's requests never answer, so the page is left mid-load; after that they answer.
    let hold = true;
    fakeServer.override(BULK_JSON, async () => {
      if (hold) {
        await never();
      }
      return bulkService();
    });
    bulkListing(fakeServer, 12);
    await page.goto(REST_ROOT);
    await expect(message(page)).toHaveText("Loading details: 0 of 12 services");
    await expect.poll(() => bulkCalls(fakeServer).length).toBe(4);
    await page.evaluate(() => {
      window.restoredFromCache = false;
      window.addEventListener("pageshow", (event) => {
        window.restoredFromCache = event.persisted;
      });
    });
    await page.goto(LAYER_PAGE);
    hold = false;
    // A page restored from the cache fires no load event, so wait only for the commit.
    await page.goBack({ waitUntil: "commit" });
    await page.waitForFunction(() => document.readyState === "complete");
    // A restored page keeps its first navigation entry, so the pageshow flag is what tells.
    const restored = await page.evaluate(() => window.restoredFromCache === true);
    testInfo.annotations.push({ type: "bfcache", description: restored ? "restored from the back/forward cache" : "reloaded" });
    if (restored) {
      // A restore is a new page view: the twelve rows the page left get Load more, with a fresh budget.
      const button = bar(page).getByRole("button", { name: "Load 12 more services" });
      await expect(button).toBeVisible();
      await expect(message(page)).toHaveText("Paused after 4 automatic requests. 12 services not loaded yet.");
      expect(await bodyClasses(page)).not.toMatch(/sdt-loading-/);
      expect(bulkCalls(fakeServer)).toHaveLength(4);
      await pressLoadMore(button);
      await expect(message(page)).toHaveText("Loaded details for 12 services in 16 requests");
      expect(bulkCalls(fakeServer)).toHaveLength(16);
    } else {
      await expect(message(page)).toHaveText("Loaded details for 12 services in 12 requests");
    }
    await expect(page.getByText(/Not loaded/)).toHaveCount(0);
    await expect(page.locator("details.sdt-details")).toHaveCount(12);
    expect(await bodyClasses(page)).not.toMatch(/sdt-loading-/);
  });
});
