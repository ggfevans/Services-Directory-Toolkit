// The URL-pattern matrix (store-readiness spec, Phase 3): what the extension does on each kind of URL
// the fake server can serve. A Services Directory page gets the status indicator and an enabled
// toolbar button, and its own helper where it has one. A JSON view, or a page that only has
// /rest/services in its path, gets nothing. tests/unit/url-patterns.test.js checks the patterns
// themselves against many more URLs.
import { test, expect, FAKE_ORIGIN, REST_ROOT, SERVER_TOKENS } from "./fixtures.js";

const NAME = "Services Directory Toolkit";
const TOKEN = SERVER_TOKENS.jsmith;

// helper: the extension's own addition on that page, if any: "query" for the Query Helper, "gp" for
// the print script's dropdowns.
const CASES = [
  { title: "the services root", url: REST_ROOT, sd: true },
  { title: "the services root with ?f=html (MAN-2)", url: `${REST_ROOT}?f=html`, sd: true },
  { title: "the services root with ?token= (TR-22)", url: `${REST_ROOT}?token=${TOKEN}`, sd: true },
  { title: "a folder with ?token=", url: `${REST_ROOT}/Utilities?token=${TOKEN}`, sd: true },
  { title: "a service", url: `${REST_ROOT}/Parcels/MapServer`, sd: true },
  { title: "a layer", url: `${REST_ROOT}/Parcels/MapServer/0`, sd: true },
  { title: "a query form", url: `${REST_ROOT}/Parcels/MapServer/0/query`, sd: true, helper: "query" },
  { title: "a queryDomains form, which isn't a query (QRY-3)", url: `${REST_ROOT}/Parcels/FeatureServer/queryDomains`, sd: true },
  { title: "a GP execute form", url: `${REST_ROOT}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/execute`, sd: true, helper: "gp" },
  { title: "a GP submitJob form (PRT-2)", url: `${REST_ROOT}/Transport/RouteTools/GPServer/Summarize%20Routes/submitJob`, sd: true, helper: "gp" },
  { title: "a page outside ArcGIS Server with /rest/services in its path", url: `${FAKE_ORIGIN}/docs/rest/services/overview`, sd: false },
  { title: "the services root as JSON", url: `${REST_ROOT}?f=json`, sd: false },
  { title: "a layer as JSON", url: `${REST_ROOT}/Parcels/MapServer/0?f=pjson`, sd: false }
];

const queryHelper = (page) => page.getByText("Query Helper", { exact: true });
// The print script turns each choice list into a dropdown: Format on the print task, Distance Units
// on the route task.
const gpDropdown = (page) => page.locator("select:has(option[value='PNG32']), select:has(option[value='Kilometers'])");

for (const { title, url, sd, helper } of CASES) {
  test(`URL patterns: ${title}`, async ({ page, actionEnabled }) => {
    await page.goto(url);
    const ring = page.getByRole("img", { name: NAME });
    if (sd) {
      await expect(ring).toBeVisible();
      await expect.poll(() => actionEnabled(page)).toBe(true);
    } else {
      // Nothing signals that the scripts have decided to do nothing, so give them a moment.
      await page.waitForTimeout(1000);
      await expect(ring).toHaveCount(0);
      expect(await actionEnabled(page)).toBe(false);
    }
    await expect(queryHelper(page)).toHaveCount(helper === "query" ? 1 : 0);
    await expect(gpDropdown(page)).toHaveCount(helper === "gp" ? 1 : 0);
  });
}

test("the services root opened with ?token= sends the token in each metadata request's body (TR-22)", async ({ page, fakeServer }) => {
  await page.goto(`${REST_ROOT}?token=${TOKEN}`);
  await expect(page.locator(".sdt-datablock")).toHaveCount(3);
  const metadata = fakeServer.calls.filter((call) => /\/(MapServer|FeatureServer|ImageServer)$/.test(call.path));
  expect(metadata).toHaveLength(3);
  for (const call of metadata) {
    expect(call.method).toBe("POST");
    expect(call.query).toEqual({});
    expect(call.body).toEqual({ f: "json", token: TOKEN });
  }
});
