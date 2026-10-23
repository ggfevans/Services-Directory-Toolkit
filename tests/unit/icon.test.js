// SDT.icon: 16 px SVG icons built from shape data, matching the design review's mockups.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLib, plain } from "./helpers/sdt.js";
import { fakeDocument } from "./helpers/fake-dom.js";

const MOCKUPS = fileURLToPath(new URL("../../docs/design/mockups/", import.meta.url));
const SVG = "http://www.w3.org/2000/svg";

const icon = loadLib({ globals: { document: fakeDocument() } }).SDT.icon;

/** Every <symbol> in the mockups, as { name: { viewBox, shapes } }, with the "i-" prefix dropped. */
const mockupSymbols = () => {
  const symbols = {};
  for (const file of readdirSync(MOCKUPS).filter((name) => name.endsWith(".html"))) {
    const html = readFileSync(join(MOCKUPS, file), "utf8");
    for (const [, id, viewBox, body] of html.matchAll(/<symbol id="i-([\w-]+)" viewBox="([^"]+)">([\s\S]*?)<\/symbol>/g)) {
      const shapes = [...body.matchAll(/<(\w+)((?:\s+[\w-]+="[^"]*")*)\s*\/>/g)]
        .map(([, tag, attributes]) => [tag, Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]))]);
      const symbol = { viewBox, shapes };
      if (symbols[id]) {
        assert.deepEqual(symbol, symbols[id], `${file} draws i-${id} differently`);
      }
      symbols[id] = symbol;
    }
  }
  return symbols;
};

/** The element tree as plain data: [tag, attributes, children]. */
const tree = (node) => [node.nodeName, { ...node.attributes }, node.childNodes.map(tree)];

test("SDT.icon has every icon the mockups use, with the same shapes", () => {
  const symbols = mockupSymbols();
  assert.deepEqual(plain(icon.names()), Object.keys(symbols).sort());
  for (const [name, symbol] of Object.entries(symbols)) {
    assert.deepEqual(plain(icon.ICONS[name]), symbol, name);
  }
});

test("an icon is a 16 px SVG with class sdt-icon, hidden from assistive technology", () => {
  const svg = icon("warn");
  assert.equal(svg.namespaceURI, SVG);
  assert.deepEqual(tree(svg), ["svg", {
    "class": "sdt-icon", viewBox: "0 0 24 24", width: "16", height: "16", "aria-hidden": "true", focusable: "false"
  }, [
    ["path", { d: "M12 3 2.5 20h19z" }, []],
    ["path", { d: "M12 10v4" }, []],
    ["path", { d: "M12 17.2v.1" }, []]
  ]]);
  assert.ok(svg.childNodes.every((child) => child.namespaceURI === SVG));
});

test("the glyph is the placeholder mark, with class sdt-glyph and its parts' classes", () => {
  const svg = icon("glyph");
  assert.equal(svg.attributes.class, "sdt-glyph");
  assert.equal(svg.attributes.viewBox, "0 0 16 16");
  assert.equal(svg.attributes["aria-hidden"], "true");
  assert.deepEqual(svg.childNodes.map((child) => child.attributes.class), ["sdt-glyph__bg", "sdt-glyph__mark", "sdt-glyph__dot", "sdt-glyph__dot"]);
});

test("each call builds new elements", () => {
  assert.notEqual(icon("check"), icon("check"));
});

test("an unknown name throws, including names Object.prototype has", () => {
  for (const name of ["nope", "__proto__", "constructor", "toString", undefined]) {
    assert.throws(() => icon(name), /Unknown icon/, String(name));
  }
});
