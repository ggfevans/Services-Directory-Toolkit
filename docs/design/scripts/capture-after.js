// Renders the mockups in docs/design/mockups/ to docs/design/images/after-*.png, in the light and
// dark colour schemes, headless.
//
//   node docs/design/scripts/capture-after.js
//   AXE_PATH=/path/to/axe.min.js node docs/design/scripts/capture-after.js
//
// With AXE_PATH set, it also runs axe-core with the WCAG 2.2 AA tags on each mockup in each
// scheme, scoped to the elements the extension would add (class "sdt"), and exits with status 1
// on any violation. axe-core is not a dependency of this repository; install it anywhere
// (npm install axe-core) and point AXE_PATH at its axe.min.js.
//
// The mockups are static files, so no server or extension is involved.
/* global process, console, window, document, URL */
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MOCKUPS = new URL("../mockups/", import.meta.url);
const IMAGES = fileURLToPath(new URL("../images/", import.meta.url));
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// name: output name; file: mockup; size: viewport; full: full-page; element: capture one element;
// schemes: colour schemes to render (both by default); autoDark: turn on Chrome's auto dark mode,
// which recolours the page at paint time without changing computed styles.
const SHOTS = [
  { name: "services-root", file: "services-root.html", size: [1280, 960] },
  { name: "services-root-auto-dark", file: "services-root.html", size: [1280, 600], schemes: ["light"], autoDark: true },
  { name: "service-layers", file: "service-layers.html", size: [1280, 820] },
  { name: "layer-fields", file: "layer-fields.html", size: [1280, 720] },
  { name: "query-helper", file: "query-helper.html", size: [1280, 800] },
  { name: "query-helper-narrow", file: "query-helper-narrow.html", size: [800, 600] },
  { name: "panel-states", file: "panel-states.html", size: [1140, 460] },
  { name: "find-helper", file: "find-helper.html", size: [1280, 700] },
  { name: "print-task", file: "print-task.html", size: [1280, 600] },
  { name: "popup-a", file: "popup.html", size: [1280, 1400], element: "#frame-a" },
  { name: "popup-b", file: "popup.html", size: [1280, 1400], element: "#frame-b" },
  { name: "popup-c", file: "popup.html", size: [1280, 1400], element: "#frame-c" },
  { name: "popup-d", file: "popup.html", size: [1280, 1400], element: "#frame-d" },
  { name: "popup-e", file: "popup.html", size: [1280, 1400], element: "#frame-e" },
  { name: "options", file: "options.html", size: [800, 900], full: true },
  { name: "options-320", file: "options.html", size: [320, 900], schemes: ["light"] },
  { name: "components", file: "components.html", size: [1280, 900], full: true }
];

const axeSource = process.env.AXE_PATH ? readFileSync(process.env.AXE_PATH, "utf8") : null;

/** Runs axe on the page, limited to the extension's own elements, and returns its violations. */
const runAxe = async (page) => {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async (tags) => {
    const result = await window.axe.run({ include: [[".sdt"]] }, { runOnly: { type: "tag", values: tags } });
    return result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.map((n) => n.target.join(" ")) }));
  }, AXE_TAGS);
};

const browser = await chromium.launch({ channel: "chromium", headless: true });
const checked = new Set();
let violations = 0;
try {
  for (const shot of SHOTS) {
    for (const scheme of shot.schemes || ["light", "dark"]) {
      const [width, height] = shot.size;
      const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: 1 });
      if (shot.autoDark) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setAutoDarkModeOverride", { enabled: true });
      }
      await page.goto(new URL(shot.file, MOCKUPS).href);
      await page.evaluate(() => document.fonts.ready);
      const path = `${IMAGES}after-${shot.name}${scheme === "dark" ? "-dark" : ""}.png`;
      if (shot.element) {
        await page.locator(shot.element).screenshot({ path });
      } else {
        await page.screenshot({ path, fullPage: Boolean(shot.full) });
      }
      console.log(`wrote ${path.slice(IMAGES.length)}`);

      const key = `${shot.file} ${scheme}`;
      if (axeSource && !shot.autoDark && !checked.has(key)) {
        checked.add(key);
        const found = await runAxe(page);
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

if (axeSource) {
  console.log(`axe: ${checked.size} page and scheme pairs checked, ${violations} violations`);
  process.exitCode = violations ? 1 : 0;
}
