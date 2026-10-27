// src/src/lib/sdt.css loads into every Services Directory page, the popup and the options page. Until
// the extension's elements carry its classes, it must change nothing on any of them (#13). These
// tests read the stylesheet and check that every rule is scoped, that no rule styles a class the
// extension's older code already uses, and that the two dark token blocks agree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles } from "../../scripts/lib/extension-files.js";
import { SRC } from "./helpers/sdt.js";

const CSS = readFileSync(join(SRC, "src/lib/sdt.css"), "utf8");

/**
 * The style rules of a stylesheet, as { selectors, declarations, at } with at the enclosing at-rules,
 * and the names of its @keyframes. Enough for this file: no strings or escapes with braces in them.
 */
const parse = (css) => {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  const keyframes = [];
  let at = 0;
  const block = (context) => {
    while (at < text.length) {
      const open = text.indexOf("{", at);
      const close = text.indexOf("}", at);
      if (close !== -1 && (open === -1 || close < open)) {
        at = close + 1;
        return;
      }
      if (open === -1) {
        at = text.length;
        return;
      }
      const prelude = text.slice(at, open).trim();
      at = open + 1;
      if (prelude.startsWith("@keyframes")) {
        keyframes.push(prelude.split(/\s+/)[1]);
        block([...context, "keyframes"]);
      } else if (prelude.startsWith("@")) {
        block([...context, prelude]);
      } else {
        const end = text.indexOf("}", at);
        if (!context.includes("keyframes")) {
          const declarations = text.slice(at, end).split(";").map((part) => part.trim()).filter(Boolean)
            .map((part) => [part.slice(0, part.indexOf(":")).trim(), part.slice(part.indexOf(":") + 1).trim()]);
          rules.push({ selectors: prelude.split(",").map((selector) => selector.trim()), declarations, at: context });
        }
        at = end + 1;
      }
    }
  };
  block([]);
  return { rules, keyframes };
};

const { rules, keyframes } = parse(CSS);

/** The sdt classes a selector names. */
const classesIn = (selector) => [...selector.matchAll(/\.(sdt[\w-]*)/g)].map(([, name]) => name);

const TOKEN_ROOT = /^:root(?:\[data-sdt-(?:theme|contrast)(?:="[a-z]+")?\])?$/;

test("the parser finds the stylesheet's rules", () => {
  assert.ok(rules.length > 100, `${rules.length} rules`);
  assert.deepEqual(keyframes, ["sdt-spin"]);
});

test("every selector names an sdt class, except :root token blocks", () => {
  for (const { selectors } of rules) {
    for (const selector of selectors) {
      assert.ok(TOKEN_ROOT.test(selector) || classesIn(selector).length > 0, `unscoped selector: ${selector}`);
    }
  }
});

test(":root blocks set only --sdt-* custom properties", () => {
  for (const { selectors, declarations } of rules.filter((rule) => rule.selectors.some((selector) => TOKEN_ROOT.test(selector)))) {
    assert.ok(selectors.every((selector) => TOKEN_ROOT.test(selector)), `mixed selector list: ${selectors.join(", ")}`);
    for (const [property] of declarations) {
      assert.match(property, /^--sdt-[a-z0-9-]+$/, `${selectors.join(", ")} sets ${property}`);
    }
  }
});

test("keyframes names start with sdt-", () => {
  for (const name of keyframes) {
    assert.match(name, /^sdt-/);
  }
});

// Files outside the lib that are written for sdt.css: the status bar (#14) uses its components.
const BUILT_FOR_SDT_CSS = new Set(["src/inject/status.js"]);

test("sdt.css styles no class that the extension's older code uses", () => {
  const styled = new Set(rules.flatMap(({ selectors }) => selectors.flatMap(classesIn)));
  // Everything under src/ except the lib and the files above, which are written for sdt.css.
  const older = listFiles(SRC)
    .filter((file) => /\.(js|css|html)$/.test(file) && !file.startsWith("src/lib/") && !BUILT_FOR_SDT_CSS.has(file))
    .flatMap((file) => [...readFileSync(join(SRC, file), "utf8").matchAll(/\bsdt-[\w-]+/g)].map(([name]) => name));
  const shared = [...new Set(older)].filter((name) => styled.has(name)).sort();
  assert.deepEqual(shared, []);
});

test("no class or keyframes is defined in both sdt.css and another stylesheet", () => {
  const own = new Set([...rules.flatMap(({ selectors }) => selectors.flatMap(classesIn)), ...keyframes]);
  for (const file of listFiles(SRC).filter((name) => name.endsWith(".css") && name !== "src/lib/sdt.css")) {
    const other = parse(readFileSync(join(SRC, file), "utf8"));
    const defined = [...other.rules.flatMap(({ selectors }) => selectors.flatMap(classesIn)), ...other.keyframes];
    assert.deepEqual([...new Set(defined)].filter((name) => own.has(name)), [], file);
  }
});

/** The declarations of the token block for a selector, inside the given at-rules. */
const tokenBlock = (selector, at = []) => {
  const found = rules.filter((rule) => rule.selectors.length === 1 && rule.selectors[0] === selector && rule.at.join("|") === at.join("|"));
  assert.equal(found.length, 1, `one ${selector} block in ${at.join(" ") || "the top level"}`);
  return Object.fromEntries(found[0].declarations);
};

test("the host page's dark tokens and the extension pages' dark tokens are the same", () => {
  assert.deepEqual(
    tokenBlock(":root[data-sdt-theme=\"system\"]", ["@media (prefers-color-scheme: dark)"]),
    tokenBlock(":root[data-sdt-theme=\"dark\"]")
  );
});

test("the dark palette sets every colour token the light palette sets", () => {
  const colours = (block) => Object.keys(block).filter((name) => /^#[0-9a-f]{6}$/i.test(block[name])).sort();
  assert.deepEqual(colours(tokenBlock(":root[data-sdt-theme=\"dark\"]")), colours(tokenBlock(":root")));
});

test("more contrast makes muted text use the text colour, after the dark blocks", () => {
  assert.deepEqual(tokenBlock(":root[data-sdt-contrast=\"more\"]"), { "--sdt-fg-muted": "var(--sdt-fg)" });
  const media = rules.find((rule) => rule.at.join("|") === "@media (prefers-contrast: more)");
  assert.deepEqual(media.selectors, [":root", ":root[data-sdt-theme]"]);
  assert.deepEqual(Object.fromEntries(media.declarations), { "--sdt-fg-muted": "var(--sdt-fg)" });
  const index = (rule) => rules.indexOf(rule);
  const dark = rules.filter((rule) => rule.selectors.some((selector) => /data-sdt-theme="(dark|system)"\]$/.test(selector)));
  assert.ok(dark.every((rule) => index(rule) < index(media)));
});

test("sdt.css avoids light-dark(), which needs Chrome 123, and CSS nesting", () => {
  const code = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /light-dark\(/);
  for (const { declarations } of rules) {
    assert.ok(declarations.every(([property]) => !property.includes("{")), "a nested rule");
  }
});
