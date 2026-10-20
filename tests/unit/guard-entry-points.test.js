// A content script that Chrome has cut off (after an extension update) must stop without throwing
// and without touching the page or chrome. Each group's files run here with chrome.runtime.id
// undefined, and with every page global replaced by a trap that records any use and throws.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { runFile, SRC } from "./helpers/sdt.js";

const manifest = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));

const PAGE_GLOBALS = ["document", "window", "location", "history", "navigator", "fetch", "XMLHttpRequest",
  "setTimeout", "setInterval", "requestAnimationFrame", "alert"];

const trap = (name, touched) => new Proxy(function () {}, {
  get(_, key) {
    touched.push(`${name}.${String(key)}`);
    throw new Error(`${name}.${String(key)} was used`);
  },
  set(_, key) {
    touched.push(`${name}.${String(key)} =`);
    throw new Error(`${name}.${String(key)} was set`);
  },
  apply() {
    touched.push(`${name}()`);
    throw new Error(`${name}() was called`);
  },
  construct() {
    touched.push(`new ${name}()`);
    throw new Error(`new ${name}() was called`);
  }
});

// chrome as a cut-off script sees it: chrome.runtime.id is undefined, and anything else is a trap.
const cutOffChrome = (touched) => new Proxy({}, {
  get(_, key) {
    if (key === "runtime") {
      return new Proxy({}, {
        get(__, name) {
          if (name === "id") {
            return undefined;
          }
          touched.push(`chrome.runtime.${String(name)}`);
          throw new Error(`chrome.runtime.${String(name)} was used`);
        }
      });
    }
    touched.push(`chrome.${String(key)}`);
    throw new Error(`chrome.${String(key)} was used`);
  }
});

for (const [index, group] of manifest.content_scripts.entries()) {
  if (!group.js) {
    continue;
  }
  test(`content_scripts[${index}] does nothing once its extension context is gone`, () => {
    const touched = [];
    const context = vm.createContext({
      console,
      chrome: cutOffChrome(touched),
      ...Object.fromEntries(PAGE_GLOBALS.map((name) => [name, trap(name, touched)]))
    });
    for (const file of group.js) {
      assert.doesNotThrow(() => runFile(context, file), file);
    }
    assert.deepEqual(touched, []);
  });
}
