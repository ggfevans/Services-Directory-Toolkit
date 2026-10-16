// Primer spike: renders the spike mockups to docs/design/primer-spike/images/, in the light and
// dark colour schemes, and runs axe-core on each.
//
//   PRIMER_PATH=/path/to/node_modules/@primer AXE_PATH=/path/to/axe.min.js \
//     node docs/design/primer-spike/scripts/capture.js
//
// Primer and axe-core are not dependencies of this repository. Install them anywhere (npm install
// --ignore-scripts @primer/css @primer/primitives @primer/view-components axe-core) and point
// PRIMER_PATH at the @primer folder. CHROME_PATH runs the capture in another Chromium build.
//
// The pages are served from https://mockups.test/, routed by Playwright. /primer/css/,
// /primer/primitives/ and /primer/pvc/ are the built CSS of @primer/css, @primer/primitives and
// @primer/view-components, and every other path is a file under docs/design/. Two kinds of page
// are captured:
// - "components": the mockups in docs/design/primer-spike/mockups/, built from Primer's CSS components
// - "tokens": the accepted mockups in docs/design/mockups/ with primer-tokens.css added after sdt.css
//
// axe runs with the WCAG 2.2 AA tags, scoped to the extension's own elements, and the script exits
// with status 1 on any violation.
/* global process, console, window, document, URL */
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DESIGN = fileURLToPath(new URL("../../", import.meta.url));
const IMAGES = fileURLToPath(new URL("../images/", import.meta.url));
const PRIMER = process.env.PRIMER_PATH;
const AXE = process.env.AXE_PATH;
if (!PRIMER || !AXE) {
  console.error("Set PRIMER_PATH to the node_modules/@primer folder and AXE_PATH to axe.min.js.");
  process.exit(2);
}
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
const TOKENS_LINK = "<link rel=\"stylesheet\" href=\"/primer-spike/mockups/primer-tokens.css\">";
const MOUNTS = {
  "/primer/css/": "css/dist",
  "/primer/primitives/": "primitives/dist/css",
  "/primer/pvc/": "view-components/app/assets/styles"
};

// name: output name; path: page under docs/design/; tokens: add primer-tokens.css; size: viewport;
// element: capture one element; scope: what axe checks; forced: render once more with
// forced-colors: active (Windows High Contrast), light scheme only, with no axe run.
const SHOTS = [
  { name: "components-popup-a", path: "primer-spike/mockups/popup.html", size: [1280, 1000], element: "#frame-a", scope: ".popup" },
  { name: "components-popup-c", path: "primer-spike/mockups/popup.html", size: [1280, 1000], element: "#frame-c", scope: ".popup" },
  { name: "components-popup-d", path: "primer-spike/mockups/popup.html", size: [1280, 1000], element: "#frame-d", scope: ".popup", forced: true },
  { name: "components-services-root", path: "primer-spike/mockups/services-root.html", size: [1280, 760], scope: ".sdt" },
  { name: "tokens-popup-a", path: "mockups/popup.html", tokens: true, size: [1280, 1400], element: "#frame-a", scope: ".sdt" },
  { name: "tokens-popup-c", path: "mockups/popup.html", tokens: true, size: [1280, 1400], element: "#frame-c", scope: ".sdt" },
  { name: "tokens-popup-d", path: "mockups/popup.html", tokens: true, size: [1280, 1400], element: "#frame-d", scope: ".sdt", forced: true },
  { name: "tokens-services-root", path: "mockups/services-root.html", tokens: true, size: [1280, 960], scope: ".sdt" },
  { name: "tokens-query-helper", path: "mockups/query-helper.html", tokens: true, size: [1280, 800], scope: ".sdt" }
];

/** Answers a request to https://mockups.test/ from the Primer packages or from docs/design/. */
const serve = async (route) => {
  const url = new URL(route.request().url());
  const mount = Object.keys(MOUNTS).find((prefix) => url.pathname.startsWith(prefix));
  const file = mount
    ? join(PRIMER, MOUNTS[mount], url.pathname.slice(mount.length))
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
