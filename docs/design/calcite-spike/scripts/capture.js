// Calcite spike: renders the spike mockups to docs/design/calcite-spike/images/, in the light and
// dark colour schemes, and runs axe-core on each.
//
//   CALCITE_PATH=/path/to/node_modules/@esri/calcite-components AXE_PATH=/path/to/axe.min.js \
//     node docs/design/calcite-spike/scripts/capture.js
//
// Calcite and axe-core are not dependencies of this repository. Install them anywhere (npm install
// --ignore-scripts @esri/calcite-components axe-core) and point the variables at them. CHROME_PATH
// runs the capture in another Chromium build.
//
// The pages are served from https://mockups.test/, routed by Playwright: /calcite/ is Calcite's CDN
// build and every other path is a file under docs/design/. Two kinds of page are captured:
// - "components": the mockups in docs/design/calcite-spike/mockups/, built from Calcite components
// - "tokens": the accepted mockups in docs/design/mockups/ with calcite-tokens.css added after sdt.css
//
// axe runs with the WCAG 2.2 AA tags, scoped to the extension's own elements, and the script exits
// with status 1 on any violation. axe-core reads open shadow roots, so it checks inside Calcite.
/* global process, console, window, document, URL */
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DESIGN = fileURLToPath(new URL("../../", import.meta.url));
const IMAGES = fileURLToPath(new URL("../images/", import.meta.url));
const CALCITE = process.env.CALCITE_PATH;
const AXE = process.env.AXE_PATH;
if (!CALCITE || !AXE) {
  console.error("Set CALCITE_PATH to the @esri/calcite-components package folder and AXE_PATH to axe.min.js.");
  process.exit(2);
}
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
const TOKENS_LINK = "<link rel=\"stylesheet\" href=\"/calcite-spike/mockups/calcite-tokens.css\">";

// name: output name; path: page under docs/design/; tokens: add calcite-tokens.css; size: viewport;
// element: capture one element; scope: what axe checks; forced: render once more with
// forced-colors: active (Windows High Contrast), light scheme only, with no axe run.
const SHOTS = [
  { name: "components-popup-a", path: "calcite-spike/mockups/popup.html", size: [1280, 1000], element: "#frame-a", scope: ".popup" },
  { name: "components-popup-c", path: "calcite-spike/mockups/popup.html", size: [1280, 1000], element: "#frame-c", scope: ".popup" },
  { name: "components-popup-d", path: "calcite-spike/mockups/popup.html", size: [1280, 1000], element: "#frame-d", scope: ".popup", forced: true },
  { name: "components-services-root", path: "calcite-spike/mockups/services-root.html", size: [1280, 760], scope: ".sdt" },
  { name: "tokens-popup-a", path: "mockups/popup.html", tokens: true, size: [1280, 1400], element: "#frame-a", scope: ".sdt" },
  { name: "tokens-popup-c", path: "mockups/popup.html", tokens: true, size: [1280, 1400], element: "#frame-c", scope: ".sdt" },
  { name: "tokens-popup-d", path: "mockups/popup.html", tokens: true, size: [1280, 1400], element: "#frame-d", scope: ".sdt", forced: true },
  { name: "tokens-services-root", path: "mockups/services-root.html", tokens: true, size: [1280, 960], scope: ".sdt" },
  { name: "tokens-query-helper", path: "mockups/query-helper.html", tokens: true, size: [1280, 800], scope: ".sdt" }
];

/** Answers a request to https://mockups.test/ from Calcite's CDN build or from docs/design/. */
const serve = async (route) => {
  const url = new URL(route.request().url());
  const file = url.pathname.startsWith("/calcite/")
    ? join(CALCITE, "dist/cdn", url.pathname.slice("/calcite/".length))
    : join(DESIGN, decodeURIComponent(url.pathname));
  let body;
  try {
    body = readFileSync(file);
  } catch {
    return route.fulfill({ status: 404, body: "" });
  }
  if (url.searchParams.has("tokens")) {
    body = body.toString().replace(/(<link rel="stylesheet" href="sdt.css">)/, `$1\n${TOKENS_LINK}`);
  }
  return route.fulfill({ status: 200, contentType: TYPES[extname(file)] || "application/octet-stream", body });
};

const axeSource = readFileSync(AXE, "utf8");
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chromium" }),
  headless: true
});
let violations = 0;
const checked = new Set();
try {
  for (const shot of SHOTS) {
    for (const scheme of shot.forced ? ["light", "dark", "forced"] : ["light", "dark"]) {
      const [width, height] = shot.size;
      const forced = scheme === "forced";
      const page = await browser.newPage({
        viewport: { width, height }, colorScheme: forced ? "light" : scheme, forcedColors: forced ? "active" : "none", deviceScaleFactor: 1
      });
      await page.route("https://mockups.test/**", serve);
      await page.goto(`https://mockups.test/${shot.path}${shot.tokens ? "?tokens" : ""}`);
      // Calcite components render after their chunks load; wait for every one to hydrate.
      await page.waitForFunction(() => [...document.querySelectorAll("*")]
        .filter((el) => el.localName.startsWith("calcite-"))
        .every((el) => el.hasAttribute("calcite-hydrated")), null, { timeout: 15_000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      const path = `${IMAGES}${shot.name}${scheme === "light" ? "" : `-${scheme}`}.png`;
      if (shot.element) {
        await page.locator(shot.element).screenshot({ path });
      } else {
        await page.screenshot({ path });
      }
      console.log(`wrote ${path.slice(IMAGES.length)}`);

      const key = `${shot.path}${shot.tokens ? " tokens" : ""} ${scheme}`;
      if (!forced && !checked.has(key)) {
        checked.add(key);
        await page.addScriptTag({ content: axeSource });
        const found = await page.evaluate(async ({ scope, tags }) => {
          const result = await window.axe.run({ include: [[scope]] }, { runOnly: { type: "tag", values: tags } });
          return result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.map((n) => JSON.stringify(n.target)) }));
        }, { scope: shot.scope, tags: AXE_TAGS });
        violations += found.length;
        for (const v of found) {
          console.error(`axe ${key}: ${v.id} (${v.impact}) ${v.help}\n  ${v.targets.join("\n  ")}`);
        }
        if (!found.length) {
          console.log(`axe ${key}: no violations`);
        }
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`axe: ${checked.size} page and scheme pairs checked, ${violations} violations`);
process.exitCode = violations ? 1 : 0;
