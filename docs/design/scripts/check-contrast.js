// Checks the colour tokens in docs/design/mockups/sdt.css against WCAG 2.2 AA, in both palettes.
//
//   node docs/design/scripts/check-contrast.js            prints a Markdown table
//   node docs/design/scripts/check-contrast.js --quiet    prints failures only
//
// Text pairs need 4.5:1 (SC 1.4.3). Non-text pairs (control borders, focus rings, icons, badge
// borders, switch parts) need 3:1 (SC 1.4.11). "page" is the background of the host page the
// in-page additions sit on: white for a light Services Directory page, and the dark stand-in
// page colour from docs/design/mockups/host-standin.css for a dark one.
// Exits with status 1 if any pair fails.
/* global process, console, URL */
import { readFileSync } from "node:fs";

const CSS = readFileSync(new URL("../mockups/sdt.css", import.meta.url), "utf8");
const PAGE = { light: "#ffffff", dark: "#16191d" };

/** Reads the --sdt-* hex colours from the first block that follows marker. */
const tokens = (marker) => {
  const start = CSS.indexOf(marker);
  const block = CSS.slice(start, CSS.indexOf("}", start));
  return Object.fromEntries([...block.matchAll(/--sdt-([a-z0-9-]+):\s*(#[0-9a-f]{6});/gi)].map(([, name, value]) => [name, value.toLowerCase()]));
};

const light = tokens("/* ---- Tokens: light ---- */");
// Dark tokens override light ones; anything not overridden keeps its light value.
const dark = { ...light, ...tokens("/* ---- Tokens: dark ---- */") };

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [foreground, background, minimum, what it is]
const TEXT = 4.5;
const UI = 3;
const pairs = [
  ["fg", "bg", TEXT, "Body text on panels and popup"],
  ["fg", "bg-subtle", TEXT, "Text in details, status bar"],
  ["fg", "bg-selected", TEXT, "Selected option, insertion target"],
  ["fg", "page", TEXT, "Count numbers on the host page"],
  ["fg-muted", "bg", TEXT, "Hints and secondary text"],
  ["fg-muted", "bg-subtle", TEXT, "Labels in details"],
  ["fg-muted", "bg-selected", TEXT, "Hint on the target bar"],
  ["fg-muted", "page", TEXT, "Annotation text on the host page"],
  ["accent", "bg", TEXT, "Quiet buttons, links, result text"],
  ["accent", "bg-subtle", TEXT, "Quiet buttons on subtle surfaces"],
  ["accent", "bg-selected", TEXT, "Clear button on the target bar"],
  ["accent", "page", TEXT, "Details summary on the host page"],
  ["on-accent", "accent", TEXT, "Primary button text"],
  ["on-accent", "accent-hover", TEXT, "Primary button text, hover"],
  ["warn-fg", "warn-bg", TEXT, "Warning badge and status bar"],
  ["warn-fg", "bg", TEXT, "Warning status text"],
  ["warn-fg", "page", TEXT, "Warning status text on the host page"],
  ["error-fg", "error-bg", TEXT, "Error badge and status bar"],
  ["error-fg", "bg", TEXT, "Error status and field error text"],
  ["error-fg", "page", TEXT, "Error status text on the host page"],
  ["fg", "warn-bg", TEXT, "Search match highlight"],
  ["border-strong", "bg", UI, "Control borders, switch off"],
  ["border-strong", "bg-subtle", UI, "Control borders on subtle surfaces"],
  ["border-strong", "page", UI, "Neutral badge border on the host page"],
  ["accent", "page", UI, "Switch on, primary button edge"],
  ["on-accent", "accent", UI, "Switch thumb when on"],
  ["focus", "bg", UI, "Focus ring on panels and popup"],
  ["focus", "bg-subtle", UI, "Focus ring on subtle surfaces"],
  ["focus", "page", UI, "Focus ring on the host page"],
  ["warn-border", "page", UI, "Warning badge border"],
  ["error-border", "bg", UI, "Invalid field border"],
  ["error-border", "page", UI, "Error badge border"],
  ["ok-fg", "bg", UI, "Done icon"],
  ["ok-fg", "page", UI, "Done icon on the host page"]
];
for (let i = 0; i < 8; i += 1) {
  pairs.push([`sr${i}-fg`, `sr${i}-bg`, TEXT, `Spatial reference badge ${i} text`]);
  pairs.push([`sr${i}-border`, "page", UI, `Spatial reference badge ${i} border on the page`]);
  pairs.push([`sr${i}-border`, "bg-subtle", UI, `Spatial reference badge ${i} border in details`]);
}

const quiet = process.argv.includes("--quiet");
let failures = 0;
const rows = [];
for (const [fg, bg, min, what] of pairs) {
  const cells = ["light", "dark"].map((scheme) => {
    const set = scheme === "light" ? light : dark;
    const colour = (name) => (name === "page" ? PAGE[scheme] : set[name]);
    const value = ratio(colour(fg), colour(bg));
    if (value < min) {
      failures += 1;
      console.error(`FAIL ${scheme}: ${fg} on ${bg} is ${value.toFixed(2)}:1, needs ${min}:1 (${what})`);
    }
    return `${value.toFixed(2)}${value < min ? " FAIL" : ""}`;
  });
  rows.push(`| ${what} | \`${fg}\` on \`${bg}\` | ${min}:1 | ${cells[0]} | ${cells[1]} |`);
}

if (!quiet) {
  console.log("| Use | Pair | Needs | Light | Dark |");
  console.log("|---|---|---|---|---|");
  rows.forEach((row) => console.log(row));
}
console.log(`\n${pairs.length * 2} checks, ${failures} failures.`);
process.exitCode = failures ? 1 : 0;
