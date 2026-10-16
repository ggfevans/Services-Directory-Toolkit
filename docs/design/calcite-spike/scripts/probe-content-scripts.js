// Calcite spike: can Calcite components run from an MV3 content script on a Services Directory page?
//
//   CALCITE_PATH=/path/to/node_modules/@esri/calcite-components node docs/design/calcite-spike/scripts/probe-content-scripts.js
//
// Calcite is not a dependency of this repository. Install it anywhere (npm install --ignore-scripts
// @esri/calcite-components) and point CALCITE_PATH at the package folder. The script writes a probe
// extension to a temporary folder, copies Calcite's CDN build into it, loads it in Playwright's
// Chromium, and opens a fake Services Directory page at https://arcgis.test twice: once with no
// Content-Security-Policy and once with a strict one. It prints one JSON report. CHROME_PATH runs it
// in another Chromium build.
//
// The probe extension has three parts:
// - isolated.js, a normal content script in the isolated world, which checks customElements and tries
//   to load Calcite there, then builds Calcite elements in the page and drives them
// - main.js, a content script in the MAIN world (manifest "world": "MAIN"), which loads Calcite's
//   loader with a dynamic import() from the extension
// - popup.html, an extension page that loads Calcite as a module script, the way the toolbar popup would
/* global process, console, document, navigator, URL */
import { chromium } from "@playwright/test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CALCITE = process.env.CALCITE_PATH;
if (!CALCITE) {
  console.error("Set CALCITE_PATH to the @esri/calcite-components package folder.");
  process.exit(2);
}

const ext = mkdtempSync(join(tmpdir(), "sdt-calcite-probe-"));
const profile = mkdtempSync(join(tmpdir(), "sdt-calcite-profile-"));
cpSync(join(CALCITE, "dist/cdn"), join(ext, "vendor/calcite"), { recursive: true });

writeFileSync(join(ext, "manifest.json"), JSON.stringify({
  manifest_version: 3,
  name: "SDT Calcite probe",
  version: "0.0.1",
  background: { service_worker: "sw.js" },
  content_scripts: [
    { matches: ["https://arcgis.test/*"], js: ["isolated.js"], css: ["vendor/calcite/main.css"], run_at: "document_end" },
    { matches: ["https://arcgis.test/*"], js: ["main.js"], run_at: "document_end", world: "MAIN" }
  ],
  web_accessible_resources: [{ resources: ["vendor/calcite/*"], matches: ["https://arcgis.test/*"] }]
}, null, 2));
writeFileSync(join(ext, "sw.js"), "// Present so the test can read the extension id.\n");

// The MAIN world has no chrome.runtime, so the isolated script leaves the loader's URL on <html>.
writeFileSync(join(ext, "main.js"), `
(async () => {
  const report = {};
  const url = document.documentElement.dataset.sdtCalciteUrl;
  report.mainCustomElements = typeof customElements;
  try {
    await import(url);
    report.mainImport = "ok";
  } catch (error) {
    report.mainImport = String(error);
  }
  document.documentElement.dataset.sdtMain = JSON.stringify(report);
})();
`);

writeFileSync(join(ext, "isolated.js"), `
document.documentElement.dataset.sdtCalciteUrl = chrome.runtime.getURL("vendor/calcite/index.js");
(async () => {
  const report = {};
  report.customElements = String(window.customElements);
  report.CustomElementRegistry = typeof CustomElementRegistry;
  try {
    const registry = new CustomElementRegistry();
    report.scopedRegistry = typeof registry.define;
  } catch (error) {
    report.scopedRegistry = String(error);
  }
  try {
    await import(chrome.runtime.getURL("vendor/calcite/index.js"));
    report.isolatedImport = "ok";
  } catch (error) {
    report.isolatedImport = String(error);
  }

  // Elements made here live in the shared DOM, so the MAIN world's registry upgrades them.
  const box = document.createElement("div");
  box.id = "probe";
  const sw = document.createElement("calcite-switch");
  sw.setAttribute("label", "Count features in each layer");
  const button = document.createElement("calcite-button");
  button.setAttribute("icon-start", "copy");
  button.append("Copy URL");
  const events = [];
  sw.addEventListener("calciteSwitchChange", (event) => events.push({ type: event.type, detail: String(event.detail) }));
  box.append(sw, button);
  document.body.append(box);

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (let i = 0; i < 50 && !sw.shadowRoot; i++) {
    await wait(100);
  }
  await wait(500);
  report.switchUpgraded = Boolean(sw.shadowRoot);
  report.switchDefinedSelector = sw.matches(":defined");
  report.switchCheckedProperty = String(sw.checked);
  const svg = button.shadowRoot && button.shadowRoot.querySelector("calcite-icon");
  const iconRoot = svg && svg.shadowRoot;
  report.buttonIconPaths = iconRoot ? iconRoot.querySelectorAll("path").length : null;
  sw.click();
  await wait(300);
  report.afterClickCheckedAttribute = sw.hasAttribute("checked");
  report.afterClickAriaChecked = sw.shadowRoot && sw.shadowRoot.querySelector("[role=switch]")
    ? sw.shadowRoot.querySelector("[role=switch]").getAttribute("aria-checked") : null;
  report.events = events;
  document.documentElement.dataset.sdtIsolated = JSON.stringify(report);
})();
`);

writeFileSync(join(ext, "popup.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Popup probe</title>
<link rel="stylesheet" href="vendor/calcite/main.css">
<script type="module" src="vendor/calcite/index.js"></script>
<script type="module" src="popup.js"></script>
</head><body class="calcite-mode-auto">
<calcite-switch label="Count features in each layer"></calcite-switch>
<calcite-button icon-start="copy">Copy URL</calcite-button>
</body></html>`);
writeFileSync(join(ext, "popup.js"), `
const sw = document.querySelector("calcite-switch");
const button = document.querySelector("calcite-button");
await customElements.whenDefined("calcite-button");
await new Promise((resolve) => setTimeout(resolve, 1000));
const icon = button.shadowRoot.querySelector("calcite-icon");
document.documentElement.dataset.sdtPopup = JSON.stringify({
  switchUpgraded: Boolean(sw.shadowRoot),
  buttonIconPaths: icon && icon.shadowRoot ? icon.shadowRoot.querySelectorAll("path").length : null
});
`);

const PAGE = `<!doctype html><html lang="en"><head><title>Folder: /</title></head>
<body><h2>Folder: /</h2><p>Services:</p><ul><li><a href="Parcels/MapServer">Parcels</a> (MapServer)</li></ul></body></html>`;
const POLICIES = {
  "no CSP": null,
  "strict CSP": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'"
};

const context = await chromium.launchPersistentContext(profile, {
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chromium" }),
  headless: !process.env.HEADED,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`]
});
const report = { chromium: context.browser() ? context.browser().version() : "persistent context", pages: {} };
const consoleLines = [];
// Any request that leaves the extension and the fake server, such as Calcite's default asset path
// on js.arcgis.com, is recorded here.
const offHost = [];
context.on("request", (request) => {
  const { protocol, host } = new URL(request.url());
  if (protocol !== "chrome-extension:" && host !== "arcgis.test" && protocol !== "data:") {
    offHost.push(request.url());
  }
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  report.chromium = await worker.evaluate(() => navigator.userAgent.match(/Chrome\/[\d.]+/)[0]);

  for (const [name, csp] of Object.entries(POLICIES)) {
    const page = await context.newPage();
    page.on("console", (message) => consoleLines.push(`${name} ${message.type()}: ${message.text()}`));
    await page.route("https://arcgis.test/**", (route) => route.fulfill({
      status: 200,
      contentType: "text/html",
      headers: csp ? { "Content-Security-Policy": csp } : {},
      body: PAGE
    }));
    await page.goto("https://arcgis.test/arcgis/rest/services");
    await page.waitForFunction(() => document.documentElement.dataset.sdtIsolated, null, { timeout: 15_000 });
    const result = await page.evaluate(() => ({
      main: JSON.parse(document.documentElement.dataset.sdtMain || "null"),
      isolated: JSON.parse(document.documentElement.dataset.sdtIsolated),
      pageSeesSwitchProperty: String(document.querySelector("calcite-switch").checked)
    }));
    // Playwright locators pierce open shadow roots, so role queries reach inside Calcite.
    result.playwrightRole = await page.getByRole("switch", { name: "Count features in each layer" }).count();
    report.pages[name] = result;
    await page.close();
  }

  const popup = await context.newPage();
  popup.on("console", (message) => consoleLines.push(`popup ${message.type()}: ${message.text()}`));
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.waitForFunction(() => document.documentElement.dataset.sdtPopup, null, { timeout: 15_000 });
  report.popup = await popup.evaluate(() => JSON.parse(document.documentElement.dataset.sdtPopup));
} finally {
  await context.close();
  rmSync(ext, { recursive: true, force: true });
  rmSync(profile, { recursive: true, force: true });
}
report.console = consoleLines;
report.offHostRequests = offHost;
console.log(JSON.stringify(report, null, 2));
