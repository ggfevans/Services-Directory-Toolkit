// Smoke test: loads the unpacked extension into the locally installed Google Chrome and checks each
// feature against a live ArcGIS Server (Esri's public sample server by default).
//
//   npm run test:smoke
//   MSE_TEST_SERVER=https://host/arcgis/rest/services npm run test:smoke
//
// Branded Chrome ignores --load-extension, so the extension is loaded over CDP (Extensions.loadUnpacked),
// which needs --enable-unsafe-extension-debugging and Developer mode in the throwaway profile.
import { chromium } from "@playwright/test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const BASE = process.env.MSE_TEST_SERVER || "https://sampleserver6.arcgisonline.com/arcgis/rest/services";
const REST_PAGE = /^https?:\/\/[^/]+\/.+\/rest\/services(\/.*)?$/;

// Test-only copy with the "tabs" permission, so the harness can read tab URLs when checking the action state.
const EXT = mkdtempSync(join(tmpdir(), "mse-ext-"));
const PROFILE = mkdtempSync(join(tmpdir(), "mse-profile-"));
cpSync(SRC, EXT, { recursive: true });
const manifest = JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8"));
manifest.permissions.push("tabs");
writeFileSync(join(EXT, "manifest.json"), JSON.stringify(manifest));

// How long each check waits for the live server and extension callbacks before failing.
const TIMEOUT = 30000;

// Polls fn until predicate(value) holds or the timeout passes; returns the last value either way.
const poll = async (fn, predicate, timeout = TIMEOUT) => {
  const deadline = Date.now() + timeout;
  let value = await fn();
  while (!predicate(value) && Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 250));
    value = await fn();
  }
  return value;
};

const results = [];
// ok: true = PASS, false = FAIL, null = SKIP (the condition under test could not be set up).
const record = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok === null ? "SKIP" : ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: "chrome",
  headless: false,
  args: ["--enable-unsafe-extension-debugging"],
  // Playwright passes --disable-extensions by default, which would unload the extension.
  ignoreDefaultArgs: ["--disable-extensions"]
});

try {
  // 1. Load the extension.
  const extensionsPage = await ctx.newPage();
  await extensionsPage.goto("chrome://extensions");
  await extensionsPage.evaluate(() => new Promise((res) => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, res)));
  const cdp = await ctx.browser().newBrowserCDPSession();
  const { id: extId } = await cdp.send("Extensions.loadUnpacked", { path: EXT });
  const extInfo = await poll(() => extensionsPage.evaluate((id) => new Promise((res) => chrome.developerPrivate.getExtensionInfo(id, (e) => res(e && {
    state: e.state,
    manifestErrors: e.manifestErrors.map((m) => m.message)
  }))), extId), (info) => info?.state === "ENABLED");
  record("extension loaded and enabled", extInfo?.state === "ENABLED" && extInfo.manifestErrors.length === 0, JSON.stringify(extInfo));
  const sw = ctx.serviceWorkers().find((w) => w.url().includes(extId))
    || await ctx.waitForEvent("serviceworker", { predicate: (w) => w.url().includes(extId), timeout: 15000 }).catch(() => null);
  record("service worker registered", Boolean(sw));

  const pageErrors = {};
  const open = async (label, url) => {
    const page = await ctx.newPage();
    pageErrors[label] = [];
    page.on("pageerror", (e) => pageErrors[label].push(e.message));
    page.on("console", (m) => m.type() === "error" && pageErrors[label].push(m.text()));
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    return page;
  };
  // Waits until at least one match exists (or the timeout passes), then returns the match count.
  // The count can still be rising (results load asynchronously), so only compare it with zero.
  const count = async (locator) => {
    await locator.first().waitFor({ state: "attached", timeout: TIMEOUT }).catch(() => {});
    return locator.count();
  };

  // 2. Options page. Saves a Web_Map_as_JSON default, which the print page check relies on.
  const optionsPage = await open("options page", `chrome-extension://${extId}/src/options/options.html`);
  record("options page: inputs rendered", (await count(optionsPage.locator("input"))) > 5);
  await optionsPage.locator("#mapimagewidth").fill("321");
  const WEB_MAP_JSON = "{\"operationalLayers\":[]}";
  await optionsPage.locator("#defaultwebmapasjson").fill(WEB_MAP_JSON);
  await optionsPage.locator("#save").click();
  const savedMatches = (items) => items.mapImageWidth === 321 && items.defaultWebMapAsJSON === WEB_MAP_JSON;
  const saved = await poll(
    () => optionsPage.evaluate(() => new Promise((res) => chrome.storage.sync.get(["mapImageWidth", "defaultWebMapAsJSON"], res))),
    savedMatches);
  record("options page: save writes chrome.storage", savedMatches(saved), JSON.stringify(saved));

  // 3. Content scripts on each page type.
  const other = await open("non-REST page", "https://example.com/");
  const root = await open("services root", BASE);
  record("services root: status icon injected", (await count(root.locator(".status-icon"))) > 0);
  const srLinks = await count(root.locator("a[href*='spatialreference.org']"));
  record("services root: spatial reference links rendered", srLinks > 0);

  const mapServer = await open("MapServer", `${BASE}/USA/MapServer`);
  const blocks = await count(mapServer.locator(".datablock"));
  record("MapServer: metadata blocks rendered", blocks > 0);

  const layer = await open("layer", `${BASE}/USA/MapServer/0`);
  const fieldCounts = await count(layer.getByText("Features with values:"));
  record("layer page: field value counts rendered", fieldCounts > 0);

  const query = await open("query page", `${BASE}/USA/MapServer/0/query`);
  record("query page: side panel rendered", (await count(query.locator(".sidepanel"))) > 0);
  const sqlButtons = await count(query.locator("button.sql"));
  record("query page: SQL buttons rendered", sqlButtons > 0);

  const print = await open("print page", `${BASE}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/execute`);
  const selects = await count(print.locator("select"));
  record("print page: choice lists swapped in", selects > 0);
  // printTask.js fills the field named Web_Map_as_JSON (a textarea or an input) with the saved default.
  const webMapField = print.locator("[name='Web_Map_as_JSON']").first();
  const webMapValue = await poll(() => webMapField.inputValue().catch(() => null), (v) => v === WEB_MAP_JSON);
  record("print page: Web_Map_as_JSON pre-filled with the saved default", webMapValue === WEB_MAP_JSON);

  // 4. Toolbar action is enabled on REST pages only.
  const expectedState = (url) => REST_PAGE.test(url.split(/[?#]/)[0]);
  const states = await poll(() => optionsPage.evaluate(async () => {
    const tabs = (await chrome.tabs.query({})).filter((t) => /^https?:/.test(t.url));
    return Promise.all(tabs.map(async (t) => ({ url: t.url, enabled: await chrome.action.isEnabled(t.id) })));
  }), (list) => list.length >= 6 && list.every((t) => t.enabled === expectedState(t.url)));
  record("action state read for every web tab", states.length >= 6, `${states.length} tabs`);
  for (const { url, enabled } of states) {
    const expected = expectedState(url);
    record(`action ${expected ? "enabled" : "disabled"}: ${url}`, enabled === expected);
  }

  // Same tab: REST page -> non-REST page -> Back (restored from the back/forward cache).
  const nav = await open("navigation tab", `${BASE}/USA/MapServer`);
  // Re-mark the tab on every poll: navigation resets document.title.
  const navEnabled = async () => {
    await nav.evaluate(() => { document.title = "__nav__"; }).catch(() => {});
    return optionsPage.evaluate(async () => {
      const [t] = (await chrome.tabs.query({})).filter((x) => x.title === "__nav__");
      return t ? chrome.action.isEnabled(t.id) : null;
    });
  };
  record("navigation: enabled on REST page", (await poll(navEnabled, (v) => v === true)) === true);
  // Page state survives a back/forward cache restore but not a reload, so this marker tells them apart.
  await nav.evaluate(() => {
    window.__msePageshow = [];
    window.addEventListener("pageshow", (evt) => window.__msePageshow.push(evt.persisted));
  });
  await nav.goto("https://example.com/", { waitUntil: "load" });
  record("navigation: disabled after leaving REST page", (await poll(navEnabled, (v) => v === false)) === false);
  await nav.goBack({ waitUntil: "load" });
  const backEnabled = (await poll(navEnabled, (v) => v === true)) === true;
  const fromCache = await nav.evaluate(() => window.__msePageshow?.at(-1) === true);
  record("navigation: enabled again after Back", backEnabled, fromCache ? "restored from bfcache" : "page was reloaded");
  // status.js re-sends on a persisted pageshow; that path only runs when Chrome restores from the bfcache.
  record("navigation: bfcache restore re-enables via pageshow", fromCache ? backEnabled : null,
    fromCache ? "" : "Chrome reloaded the page instead of restoring it from the bfcache");

  // The popup really opens on a REST tab, and Chrome refuses it elsewhere.
  const openPopupOn = async (page) => {
    await page.bringToFront();
    return optionsPage.evaluate(async () => {
      const [w] = await chrome.windows.getAll({ windowTypes: ["normal"] });
      await chrome.windows.update(w.id, { focused: true });
      try {
        await chrome.action.openPopup({ windowId: w.id });
        return "opened";
      } catch (e) {
        return e.message;
      }
    });
  };
  // Window focus can lag behind bringToFront (and after a popup closes), so retry "inactive window" results.
  const tryPopup = (page) => poll(() => openPopupOn(page), (result) => !/inactive window/.test(result), 10000);
  const restPopup = await tryPopup(root);
  record("popup opens on REST tab", restPopup === "opened", restPopup);
  // Close the open popup; it holds window focus, which would block the next openPopup call.
  const { targetInfos } = await cdp.send("Target.getTargets");
  for (const t of targetInfos.filter((x) => x.url.includes("page_action.html"))) {
    await cdp.send("Target.closeTarget", { targetId: t.targetId });
  }
  const otherPopup = await tryPopup(other);
  record("popup refused on non-REST tab", /does not have a popup/.test(otherPopup), otherPopup);

  // 5. Popup page.
  const popup = await open("popup", `chrome-extension://${extId}/src/page_action/page_action.html`);
  record("popup: renders", (await count(popup.locator("input, button"))) > 0);

  // 6. No errors.
  for (const [label, errors] of Object.entries(pageErrors)) {
    const relevant = errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
    record(`no JS errors: ${label}`, relevant.length === 0, relevant.slice(0, 3).join(" | "));
  }
  const runtimeErrors = await extensionsPage.evaluate((id) => new Promise((res) => chrome.developerPrivate.getExtensionInfo(id, (e) =>
    res(e ? e.runtimeErrors.map((x) => `${x.source}: ${x.message}`) : ["extension missing"]))), extId);
  record("no extension runtime errors", runtimeErrors.length === 0, runtimeErrors.slice(0, 5).join(" | "));
} catch (err) {
  record("test harness", false, err.stack);
} finally {
  await ctx.close();
  rmSync(EXT, { recursive: true, force: true });
  rmSync(PROFILE, { recursive: true, force: true });
  const failed = results.filter((r) => r.ok === false).length;
  const skipped = results.filter((r) => r.ok === null).length;
  console.log(`\n${results.length - failed - skipped}/${results.length} passed${skipped ? `, ${skipped} skipped` : ""}`);
  process.exit(failed ? 1 : 0);
}
