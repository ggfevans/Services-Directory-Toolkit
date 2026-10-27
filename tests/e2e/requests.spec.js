// What the extension sends: the request budget and the token rules (store-readiness spec, section
// 4.3, and token support spec, section 5.3). fakeServer.calls records each request's query string
// and form body separately, so the tests can tell where a token went.
import { test, expect, FAKE_ORIGIN, html, json, ONLINE_ORIGIN, ONLINE_REST_ROOT, ONLINE_TOKENS, REST_ROOT, SERVER_TOKENS } from "./fixtures.js";
import { catalog } from "../fixtures/catalog.js";
import { folderPage } from "../fixtures/pages.js";

const ROOT_PAGE = /^\/arcgis\/rest\/services$/;
const LIMIT_NOTE = "Not loaded: request limit reached (50)";

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
  await expect(page.locator(".sdt-datablock")).toHaveCount(3);
  await page.waitForTimeout(500);
  expect(fakeServer.calls.filter((call) => call.origin !== FAKE_ORIGIN)).toEqual([]);
});

test("a page with 60 service links sends 50 requests, and the other rows say why they're empty", async ({ page, fakeServer, bulkRoot }) => {
  bulkRoot(60);
  await page.goto(REST_ROOT);
  await expect(page.getByText(LIMIT_NOTE)).toHaveCount(10);
  await expect(page.locator(".sdt-datablock")).toHaveCount(50);
  expect(fakeServer.calls.filter((call) => /\/Bulk\d+\/MapServer$/.test(call.path))).toHaveLength(50);
  const lastRow = page.locator("li", { has: page.getByRole("link", { name: "Bulk60", exact: true }) });
  await expect(lastRow).toContainText(LIMIT_NOTE);
});

test("one failed service request shows an error on its row, and the other rows load (INJ-2)", async ({ page, fakeServer, expectedErrors }) => {
  fakeServer.override(/^\/arcgis\/rest\/services\/Parcels\/MapServer\?f=json$/, BAD_GATEWAY);
  expectedErrors.push(/status of 502/);
  await page.goto(REST_ROOT);
  // Visible on the row, not tucked into a collapsed details block.
  await expect(serviceRow(page, "Parcels/MapServer").getByText(/HTTP 502/)).toBeVisible();
  for (const path of ["Parcels/FeatureServer", "Elevation/ImageServer"]) {
    await expect(serviceRow(page, path).locator(".sdt-datablock")).toHaveCount(1);
  }
  await expect.poll(() => page.evaluate(() => document.body.className)).not.toMatch(/sdt-loading-/);
});

test("a service that answers 200 with an ArcGIS error body fails its row with the server's message", async ({ page, fakeServer }) => {
  fakeServer.override(/^\/arcgis\/rest\/services\/Parcels\/MapServer\?f=json$/, () => json({ error: { code: 499, message: "Token Required", details: [] } }));
  await page.goto(REST_ROOT);
  await expect(serviceRow(page, "Parcels/MapServer").getByText(/Token Required/)).toBeVisible();
  for (const path of ["Parcels/FeatureServer", "Elevation/ImageServer"]) {
    await expect(serviceRow(page, path).locator(".sdt-datablock")).toHaveCount(1);
  }
  await expect.poll(() => page.evaluate(() => document.body.className)).not.toMatch(/sdt-loading-/);
});

test("count queries send the where clause as a param, not spliced into the URL (INJ-5)", async ({ page, fakeServer }) => {
  await page.goto(`${REST_ROOT}/Parcels/MapServer`);
  await expect(page.locator("b", { hasText: /^Features with shapes:/ })).toHaveCount(2);
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

test("hovering a link to another server sends nothing", async ({ page, fakeServer }) => {
  fakeServer.override(ROOT_PAGE, () => html(rootWith(ONLINE_LINKS)));
  await page.goto(REST_ROOT);
  await expect(page.locator(".sdt-datablock")).toHaveCount(3);
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
  await expect(page.locator(".sdt-datablock")).toHaveCount(3);
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
