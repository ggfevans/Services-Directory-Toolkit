// What the extension sends: the request budget and the token rules (store-readiness spec, section
// 4.3, and token support spec, section 5.3). fakeServer.calls records each request's query string
// and form body separately, so the tests can tell where a token went.
import { test, expect, FAKE_ORIGIN, html, json, ONLINE_ORIGIN, ONLINE_REST_ROOT, ONLINE_TOKENS, REST_ROOT, SERVER_TOKENS } from "./fixtures.js";
import { catalog } from "../fixtures/catalog.js";
import { folderPage } from "../fixtures/pages.js";

const ROOT_PAGE = /^\/arcgis\/rest\/services$/;
const LIMIT_NOTE = "Not loaded: request limit reached (50)";

// The manifest's patterns match path plus query, and none of them matches .../rest/services?token=,
// so the content scripts don't run there until Phase 3 adds a ?-query variant (MAN-2). These tests
// open the root with a trailing slash, which /rest/services/* matches.
const withToken = (root, token) => `${root}/?token=${token}`;

/** The services root, with extra list items (HTML) at the top of its services list. */
const rootWith = (extraItems) => folderPage({
  folder: "",
  folders: catalog.folders,
  services: catalog.services.filter((service) => !service.name.includes("/")),
  version: catalog.currentVersion
}).replace("<b>Services: </b>\n<ul>\n", `<b>Services: </b>\n<ul>\n${extraItems}`);

const ONLINE_LINKS = `<li><a href="${ONLINE_REST_ROOT}/Parcels/FeatureServer">Online parcels</a> (FeatureServer)</li>
<li><a href="${ONLINE_REST_ROOT}/Parcels/MapServer">Online parcels map</a> (MapServer)</li>
`;

test("links to another server get no automatic requests", async ({ page, fakeServer }) => {
  fakeServer.override(ROOT_PAGE, () => html(rootWith(ONLINE_LINKS)));
  await page.goto(REST_ROOT);
  await expect(page.locator(".sdt-datablock")).toHaveCount(3);
  await page.waitForTimeout(500);
  expect(fakeServer.calls.filter((call) => call.origin !== FAKE_ORIGIN)).toEqual([]);
});

test("a page with 60 service links sends 50 requests, and the other rows say why they're empty", async ({ page, fakeServer }) => {
  const bulk = Array.from({ length: 60 }, (_, i) => ({ name: `Bulk${String(i + 1).padStart(2, "0")}`, type: "MapServer" }));
  fakeServer.override(ROOT_PAGE, () => html(folderPage({ folder: "", folders: [], services: bulk, version: catalog.currentVersion })));
  fakeServer.override(/^\/arcgis\/rest\/services\/Bulk\d+\/MapServer\?f=json$/, () => json({
    currentVersion: catalog.currentVersion,
    serviceDescription: "An invented bulk service.",
    spatialReference: { wkid: 102100, latestWkid: 3857 },
    layers: []
  }));
  await page.goto(REST_ROOT);
  await expect(page.getByText(LIMIT_NOTE)).toHaveCount(10);
  await expect(page.locator(".sdt-datablock")).toHaveCount(50);
  expect(fakeServer.calls.filter((call) => /\/Bulk\d+\/MapServer$/.test(call.path))).toHaveLength(50);
  const lastRow = page.locator("li", { has: page.getByRole("link", { name: "Bulk60", exact: true }) });
  await expect(lastRow).toContainText(LIMIT_NOTE);
});

test("a page opened with ?token= sends the token in each metadata request's POST body, not its URL", async ({ page, fakeServer }) => {
  const token = SERVER_TOKENS.jsmith;
  await page.goto(`${REST_ROOT}/Utilities?token=${token}`);
  // Valves and Mains are secured: their details appear only if the token reached the server.
  await expect(page.locator(".sdt-datablock", { hasText: "Water valves for an invented utility." })).toHaveCount(1);
  await expect(page.locator(".sdt-datablock", { hasText: "Water mains for an invented utility." })).toHaveCount(1);
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
  await expect(page.locator(".sdt-datablock")).toHaveCount(2);
  await expect(page.locator(".sdt-datablock", { hasText: "Fire hydrants for an invented city." })).toHaveCount(1);
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
