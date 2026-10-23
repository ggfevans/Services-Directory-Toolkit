// The options page is static HTML, so this checks it against SDT.settings.schema: one control per
// key, named for the key, with the schema's type, values, range and label. The page is ours and
// simple, so regular expressions read it; a markup change they can't read fails the test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadLib, SRC } from "./helpers/sdt.js";

const HTML = readFileSync(join(SRC, "src/options/options.html"), "utf8");
const { settings } = loadLib().SDT;

const attributes = (text) => Object.fromEntries([...text.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, name, value]) => [name, value ?? ""]));
const text = (html) => html.replace(/\s+/g, " ").trim();

const CONTROLS = [...HTML.matchAll(/<(input|textarea|select)\b([^>]*)>/g)].map(([, tag, attrs]) => ({ tag, ...attributes(attrs) }));
const LABELS = Object.fromEntries([...HTML.matchAll(/<label for="([^"]+)">([^<]*)<\/label>/g)].map(([, id, label]) => [id, text(label)]));
const IDS = new Set([...HTML.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id));
// The legend of the innermost fieldset that holds name="key".
const legendOf = (key) => {
  const fieldset = HTML.split("<fieldset>").find((part) => part.includes(`name="${key}"`));
  return fieldset && text(fieldset.match(/<legend>([^<]*)<\/legend>/)?.[1] ?? "");
};

const EXPECTED_CONTROL = {
  boolean: { tag: "input", type: "checkbox" },
  integer: { tag: "input", type: "number" },
  text: { tag: "input", type: "text" },
  json: { tag: "textarea", type: undefined },
  choice: { tag: "input", type: "radio" }
};

test("the options page has lang=\"en\"", () => {
  assert.match(HTML, /<html lang="en"[\s>]/);
});

test("every control on the options page is named for a schema key", () => {
  const keys = new Set(settings.keys());
  assert.deepEqual(CONTROLS.filter((control) => !keys.has(control.name)), []);
});

for (const entry of settings.schema) {
  test(`the options page has one control for ${entry.key}, matching the schema`, () => {
    const controls = CONTROLS.filter((control) => control.name === entry.key);
    const expected = EXPECTED_CONTROL[entry.type];
    assert.ok(controls.length > 0, "no control");
    for (const control of controls) {
      assert.deepEqual({ tag: control.tag, type: control.type }, expected);
      assert.ok(control.id, "every control has an id, for its label");
    }
    if (entry.type === "choice") {
      assert.deepEqual(controls.map((control) => control.value), [...entry.values]);
      assert.equal(legendOf(entry.key), entry.label, "the radio group's legend");
      controls.forEach((control) => assert.ok(LABELS[control.id], `a label for ${control.id}`));
      return;
    }
    assert.equal(controls.length, 1);
    const [control] = controls;
    assert.equal(LABELS[control.id], entry.label);
    if (entry.type === "integer") {
      assert.deepEqual([control.min, control.max, control.step], [String(entry.min), String(entry.max), "1"]);
    }
    if (entry.type !== "boolean") {
      // Inline errors go in the element named control id + "-error", which describes the control.
      assert.ok(IDS.has(`${control.id}-error`), `no ${control.id}-error element`);
      assert.ok(control["aria-describedby"]?.split(" ").includes(`${control.id}-error`), "aria-describedby");
    }
  });
}

test("the options page says when changes apply (SET-11)", () => {
  assert.match(HTML, /<p>Changes apply when you reload a page\.<\/p>/);
});

test("the save result is announced: a status line after the Save button", () => {
  assert.match(HTML, /<button id="save" type="submit">Save<\/button>\s*<p id="status" role="status"><\/p>/);
});
