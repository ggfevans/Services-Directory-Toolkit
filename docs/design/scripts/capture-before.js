/* global process, console, document, window, chrome */
// Captures the "before" screenshots of the extension's current UI for the design review.
//
// Run from anywhere with `node docs/design/scripts/capture-before.js`. It loads src/ into Playwright's
// bundled Chromium (headless), answers every page request from the fake ArcGIS Server in
// tests/fixtures/fake-arcgis.js, and writes PNGs to docs/design/images/before-*.png. Requests to any
// other host are aborted, so nothing leaves the machine.
import { chromium } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { createFakeArcGIS, FAKE_ORIGIN, REST_ROOT } from "../../../tests/fixtures/fake-arcgis.js";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const EXTENSION_PATH = join(REPO, "src");
const IMAGES = join(REPO, "docs/design/images");
const HOST_CSS = join(REPO, "docs/design/mockups/host-standin.css");

const MAX_WIDTH = 1280;
const DESKTOP = { width: 1280, height: 800 };

// Problems recorded across every session, printed at the end.
const offHost = [];
const unmatched = [];
const fakeServerProblems = [];

// An invented 300x200 map image for the hover preview: no real data and no logos.
const PREVIEW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200">
  <rect width="300" height="200" fill="#eef1e4"/>
  <g fill="#d9e4c4" stroke="#6b7f4e" stroke-width="1.5" stroke-linejoin="round">
    <polygon points="14,16 92,12 98,70 20,78"/>
    <polygon points="112,14 186,18 180,66 108,62"/>
    <polygon points="200,22 284,16 288,84 196,80"/>
    <polygon points="16,98 104,104 98,176 24,170"/>
    <polygon points="124,92 194,98 200,170 130,178 118,130"/>
    <polygon points="214,104 286,100 282,168 210,172"/>
  </g>
  <g fill="none" stroke="#f6f3e6" stroke-width="7" stroke-linecap="round">
    <polyline points="0,86 70,90 150,80 300,92"/>
    <polyline points="106,0 110,86 118,200"/>
  </g>
  <g fill="none" stroke="#b9a56a" stroke-width="1.2" stroke-linecap="round">
    <polyline points="0,86 70,90 150,80 300,92"/>
    <polyline points="106,0 110,86 118,200"/>
  </g>
  <text x="150" y="196" font-family="Verdana, sans-serif" font-size="10" text-anchor="middle" fill="#46503a">Example County</text>
</svg>
`;

// What the fake server does not already answer: the host page's stylesheet and the map image requests.
const addOverrides = (fakeServer) => {
  fakeServer.override(/^\/arcgis\/rest\/static\/main\.css/, () => ({
    status: 200,
    contentType: "text/css; charset=utf-8",
    body: readFileSync(HOST_CSS, "utf8")
  }));
  const exportResponse = () => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      href: `${FAKE_ORIGIN}/arcgis/rest/directories/arcgisoutput/preview.svg`,
      width: 300,
      height: 200,
      extent: {},
      scale: 0
    })
  });
  fakeServer.override(/\/MapServer\/export\?/, exportResponse);
  fakeServer.override(/\/ImageServer\/exportImage\?/, exportResponse);
  fakeServer.override(/\/directories\/arcgisoutput\/preview\.svg/, () => ({
    status: 200,
    contentType: "image/svg+xml",
    body: PREVIEW_SVG
  }));
};

// MV3 may restart an idle service worker. The handle survives, but a call in flight fails once.
const inWorker = async (worker, fn, arg) => {
  try {
    return await worker.evaluate(fn, arg);
  } catch (error) {
    if (!/Service worker restarted/.test(error.message)) {
      throw error;
    }
    return worker.evaluate(fn, arg);
  }
};

// Runs `work` in a fresh Chromium profile with the extension loaded and a fresh fake server behind it.
// `options` adds launch options such as colorScheme.
const withSession = async (options, work) => {
  const fakeServer = createFakeArcGIS();
  addOverrides(fakeServer);
  const profile = mkdtempSync(join(tmpdir(), "sdt-before-"));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      // Playwright's default headless shell can't load extensions; the full Chromium build can.
      channel: "chromium",
      headless: true,
      viewport: DESKTOP,
      deviceScaleFactor: 1,
      ...options,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`
      ]
    });
    // http(s) only: the extension's own chrome-extension:// files load untouched.
    await context.route(/^https?:\/\//, async (route) => {
      const request = route.request();
      if (new URL(request.url()).origin !== FAKE_ORIGIN) {
        offHost.push(request.url());
        await route.abort("blockedbyclient");
        return;
      }
      const response = fakeServer.respond(request);
      if (response) {
        await route.fulfill(response);
      } else {
        unmatched.push(`${request.method()} ${request.url()}`);
        await route.fulfill({ status: 404, contentType: "text/plain", body: "No fixture for this URL" });
      }
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    await work({ context, worker, extensionId: new URL(worker.url()).host });
  } finally {
    await context?.close();
    fakeServerProblems.push(...fakeServer.problems);
    rmSync(profile, { recursive: true, force: true });
  }
};

// Writes a PNG and prints its pixel size.
const save = (name, buffer) => {
  writeFileSync(join(IMAGES, name), buffer);
  // A PNG stores its width and height as the first two integers after the 8-byte signature
  // and the 8-byte IHDR chunk header.
  const size = `${buffer.readUInt32BE(16)}x${buffer.readUInt32BE(20)}`;
  console.log(`${name.padEnd(30)} ${size.padEnd(10)} ${Math.round(buffer.length / 1024)} KB`);
};

const viewportShot = async (page, name) => save(name, await page.screenshot());

// The whole scrollable page, cut off at maxHeight when it is taller.
const fullPageShot = async (page, name, maxHeight) => {
  const { width, height } = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight
  }));
  const clip = height > maxHeight ? { x: 0, y: 0, width: Math.min(width, MAX_WIDTH), height: maxHeight } : undefined;
  save(name, await page.screenshot({ fullPage: true, clip }));
};

// A new page at the given viewport size that opens `url`.
const openPage = async (context, url, viewport = DESKTOP) => {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  if (url) {
    await page.goto(url);
  }
  return page;
};

// Waits for the services root to show its three service blocks and for the extension to stop loading.
const waitForRootReady = async (page) => {
  await page.waitForFunction(() => document.querySelectorAll(".datablock").length === 3 && !/loading-/.test(document.body.className));
  const gear = page.locator("img.status-icon");
  await gear.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("img.status-icon").naturalWidth > 0);
};

// Clicks the first service's "Click to show details..." toggle and waits for it to open.
const expandFirstBlock = async (page) => {
  await page.locator(".datablock").first().click();
  await page.waitForFunction(() => !document.querySelector(".datablock").classList.contains("collapsed"));
};

// The services root, with the details of one service expanded.
const captureRoot = async ({ context }) => {
  const page = await openPage(context, REST_ROOT);
  await waitForRootReady(page);
  await viewportShot(page, "before-root.png");

  await expandFirstBlock(page);
  // The "Services:" label and the list under it, including the expanded block.
  const area = await page.evaluate(() => {
    const label = [...document.querySelectorAll("b")].find((b) => /^Services:/.test(b.textContent.trim()));
    const list = label.nextElementSibling;
    const [a, b] = [label.getBoundingClientRect(), list.getBoundingClientRect()];
    return {
      x: Math.max(0, Math.min(a.left, b.left) - 8),
      y: Math.max(0, window.scrollY + a.top - 8),
      right: Math.max(a.right, b.right),
      bottom: window.scrollY + b.bottom
    };
  });
  save("before-root-details-open.png", await page.screenshot({
    fullPage: true,
    clip: {
      x: area.x,
      y: area.y,
      width: Math.min(area.right - area.x + 8, MAX_WIDTH - area.x),
      height: Math.min(area.bottom - area.y + 8, 900)
    }
  }));
  await page.close();
};

// The same page under a dark colour scheme: the stand-in page goes dark, the extension's blocks don't.
const captureRootDark = async ({ context }) => {
  const page = await openPage(context, REST_ROOT);
  await waitForRootReady(page);
  await expandFirstBlock(page);
  await viewportShot(page, "before-root-dark.png");
  await page.close();
};

// A service page with its per-layer feature counts.
const captureServiceCounts = async ({ context }) => {
  const page = await openPage(context, `${REST_ROOT}/Parcels/MapServer`);
  await page.waitForFunction(() => {
    const count = (prefix) => [...document.querySelectorAll("b")].filter((b) => b.textContent.startsWith(prefix)).length;
    return count("Number of features:") === 2 && count("Features with shapes:") === 2 && !/loading-/.test(document.body.className);
  });
  await fullPageShot(page, "before-service-counts.png", 1400);
  await page.close();
};

// A layer page with field value counts and coded value counts.
const captureLayerCounts = async ({ context }) => {
  const page = await openPage(context, `${REST_ROOT}/Parcels/MapServer/0`);
  await page.waitForFunction(() => {
    const count = (prefix) => [...document.querySelectorAll("b")].filter((b) => b.textContent.startsWith(prefix)).length;
    // The domain counts ("Residential:") arrive after the field counts and clear their own loading class.
    return count("Features with values:") === 6 && count("Features without empty values:") === 3
      && count("Residential:") === 1 && !/loading-/.test(document.body.className);
  });
  await fullPageShot(page, "before-layer-counts.png", 1600);
  await page.close();
};

// The hover preview panel, fixed to the top-right corner of the page.
const captureMapPreview = async ({ context }) => {
  const page = await openPage(context, REST_ROOT);
  await waitForRootReady(page);
  await page.locator(".map-image-panel").waitFor();
  // There is a FeatureServer link with the same text; the preview is for the MapServer one.
  await page.getByRole("link", { name: "Parcels", exact: true }).and(page.locator("a[href$='/Parcels/MapServer']")).hover();
  await page.waitForFunction(() => {
    const image = document.getElementById("mapimage");
    return !image.src.startsWith("data:") && image.naturalWidth > 0 && !/loading-/.test(document.body.className);
  });
  await viewportShot(page, "before-map-preview.png");
  await page.close();
};

// The settings gear at rest, then the in-page settings form it opens.
const captureGearAndSettings = async ({ context }) => {
  const page = await openPage(context, REST_ROOT);
  await waitForRootReady(page);
  // The bottom-right 360x240 px of the viewport.
  save("before-gear.png", await page.screenshot({
    clip: { x: DESKTOP.width - 360, y: DESKTOP.height - 240, width: 360, height: 240 }
  }));

  await page.locator(".status").click();
  await page.waitForFunction(() => document.querySelector(".status").classList.contains("open")
    && document.querySelectorAll(".status legend").length >= 5
    // The form fills its checkboxes from storage after it renders.
    && document.querySelectorAll(".status input[type=checkbox]:checked").length > 0);
  await page.locator(".status fieldset").first().waitFor({ state: "visible" });
  // Last resort: the panel grows over a 0.8 s CSS transition.
  await page.waitForTimeout(900);
  await viewportShot(page, "before-settings-form.png");
  await page.close();
};

// The Query Helper on a layer's query page: with a field picked at full size, then at 800x600 with
// no field picked. Both focus the statistics box so the statistic buttons show.
const captureQueryHelper = async ({ context }) => {
  const url = `${REST_ROOT}/Parcels/MapServer/0/query`;
  const ready = async (page) => {
    await page.locator(".sidepanel").waitFor();
    await page.getByRole("button", { name: "Select All *", exact: true }).waitFor();
  };

  const page = await openPage(context, url);
  await ready(page);
  // With one layer the layer select is hidden, so the second select is the field list.
  await page.locator(".sidepanel select").nth(1).selectOption({ label: "Owner" });
  await page.waitForFunction(() => {
    const values = document.querySelectorAll(".sidepanel select")[2];
    return values && values.options.length > 0 && ![...values.options].some((option) => option.textContent === "Loading...")
      && !/loading-/.test(document.body.className);
  });
  // Focusing the statistics box reveals the statistic buttons.
  await page.locator("textarea[name=outStatistics]").focus();
  await viewportShot(page, "before-query-helper.png");
  await page.close();

  const small = await openPage(context, url, { width: 800, height: 600 });
  await ready(small);
  await small.locator("textarea[name=outStatistics]").focus();
  await viewportShot(small, "before-query-helper-800.png");
  await small.close();
};

// The Find Helper on a MapServer's find page.
const captureFindHelper = async ({ context }) => {
  const page = await openPage(context, `${REST_ROOT}/Parcels/MapServer/find`);
  await page.locator(".sidepanel").waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".sidepanel select").length === 3
    // The helper fills the page's Layers box once it has read the layer list.
    && document.querySelector("input[name=layers]").value !== ""
    && !/loading-/.test(document.body.className));
  await viewportShot(page, "before-find-helper.png");
  await page.close();
};

// A print task's execute page, with the saved web map filled in.
const capturePrint = async ({ context, worker }) => {
  const webMap = "{\"operationalLayers\":[],\"exportOptions\":{\"dpi\":96,\"outputSize\":[800,600]}}";
  await inWorker(worker, (value) => chrome.storage.sync.set({ defaultWebMapAsJSON: value }), webMap);
  const page = await openPage(context, `${REST_ROOT}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/execute`);
  await page.locator("select:has(option[value='PNG32'])").waitFor();
  await page.waitForFunction(() => document.querySelector("textarea[name='Web_Map_as_JSON']").value !== "");
  await viewportShot(page, "before-print.png");
  await page.close();
};

// Opens the popup page in a normal tab, with chrome.tabs.query answering as if tabUrl were the active
// tab. The real popup is about 436 px wide.
const openPopupTab = async (context, extensionId, tabUrl) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 440, height: 420 });
  await page.addInitScript((url) => {
    const tabs = [{ id: 1, index: 0, windowId: 1, active: true, url }];
    chrome.tabs.query = (queryInfo, callback) => {
      if (callback) {
        callback(tabs);
        return undefined;
      }
      return Promise.resolve(tabs);
    };
  }, tabUrl);
  await page.goto(`chrome-extension://${extensionId}/src/page_action/page_action.html`);
  await page.waitForFunction(() => document.getElementById("urlshortblank").value !== "");
  return page;
};

// The popup on a query page, then after a REST search.
const capturePopup = async ({ context, extensionId }) => {
  const queryTab = `${REST_ROOT}/Parcels/MapServer/0/query?where=1%3D1&text=&objectIds=&outFields=*&returnGeometry=true`
    + "&returnIdsOnly=false&returnCountOnly=false&orderByFields=&groupByFieldsForStatistics=&outStatistics="
    + "&returnDistinctValues=false&f=html";
  const page = await openPopupTab(context, extensionId, queryTab);
  await fullPageShot(page, "before-popup.png", 1000);
  await page.close();

  // The search crawls from the tab's URL without its query. A query page has no names to match (the
  // server answers a bare query request with an error), so search from the services root instead.
  const searchPage = await openPopupTab(context, extensionId, `${REST_ROOT}?f=html`);
  await searchPage.locator("#searchblank").fill("Parcels");
  await searchPage.locator("#searchbtn").click();
  await searchPage.waitForFunction(() => document.getElementById("searchbtn").textContent === "Search"
    && document.querySelectorAll("#searchresults a").length > 0);
  await fullPageShot(searchPage, "before-popup-search.png", 1000);
  await searchPage.close();
};

// The extension's options page.
const captureOptions = async ({ context, extensionId }) => {
  const page = await openPage(context, `chrome-extension://${extensionId}/src/options/options.html`, { width: 800, height: 900 });
  await page.waitForFunction(() => document.getElementById("mapimagewidth").value === "300");
  await fullPageShot(page, "before-options.png", 1800);
  await page.close();
};

const main = async () => {
  mkdirSync(IMAGES, { recursive: true });

  // One fresh profile per group, so no group sees another's storage or page state.
  await withSession({}, captureRoot);
  await withSession({ colorScheme: "dark" }, captureRootDark);
  await withSession({}, captureServiceCounts);
  await withSession({}, captureLayerCounts);
  await withSession({}, captureMapPreview);
  await withSession({}, captureGearAndSettings);
  await withSession({}, captureQueryHelper);
  await withSession({}, captureFindHelper);
  await withSession({}, capturePrint);
  await withSession({}, capturePopup);
  await withSession({}, captureOptions);

  if (unmatched.length) {
    console.log("\nRequests the fake server had no fixture for (answered 404):");
    [...new Set(unmatched)].forEach((request) => console.log(`  ${request}`));
  }
  if (fakeServerProblems.length) {
    console.log("\nRequests the fake server could not interpret:");
    [...new Set(fakeServerProblems)].forEach((problem) => console.log(`  ${problem}`));
  }
  if (offHost.length) {
    console.error("\nRequests to other hosts (aborted):");
    [...new Set(offHost)].forEach((request) => console.error(`  ${request}`));
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
