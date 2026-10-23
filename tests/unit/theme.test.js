// SDT.theme: the light-or-dark decision for a page (UI design review, section 5.2), and the watcher
// that re-runs it when the page's style changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadLib, plain, SRC } from "./helpers/sdt.js";

const { theme } = loadLib().SDT;

const TRANSPARENT = "rgba(0, 0, 0, 0)";
const WHITE = "rgb(255, 255, 255)";

// [what, computed styles, expected decision]
const BACKGROUNDS = [
  ["a white page", { body: WHITE, html: TRANSPARENT, colorScheme: "normal" }, { theme: "light", contrast: null }],
  ["the dark stand-in page, #16191d", { body: "rgb(22, 25, 29)", html: TRANSPARENT, colorScheme: "normal" }, { theme: "dark", contrast: null }],
  ["transparent body and html, no color-scheme", { body: TRANSPARENT, html: TRANSPARENT, colorScheme: "normal" }, { theme: "light", contrast: null }],
  ["transparent body and html, color-scheme: dark", { body: TRANSPARENT, html: TRANSPARENT, colorScheme: "dark" }, { theme: "dark", contrast: null }],
  ["transparent, color-scheme: light dark, light system", { body: TRANSPARENT, html: TRANSPARENT, colorScheme: "light dark", prefersDark: false }, { theme: "light", contrast: null }],
  ["transparent, color-scheme: light dark, dark system", { body: TRANSPARENT, html: TRANSPARENT, colorScheme: "light dark", prefersDark: true }, { theme: "dark", contrast: null }],
  ["transparent body on a dark html", { body: TRANSPARENT, html: "rgb(22, 25, 29)", colorScheme: "normal" }, { theme: "dark", contrast: null }],
  ["a light body on a dark html: the body wins", { body: WHITE, html: "rgb(22, 25, 29)", colorScheme: "dark" }, { theme: "light", contrast: null }],
  ["a mid-grey page, #808080", { body: "rgb(128, 128, 128)", html: TRANSPARENT, colorScheme: "normal" }, { theme: "light", contrast: "more" }],
  ["a darker grey page, #646464", { body: "rgb(100, 100, 100)", html: TRANSPARENT, colorScheme: "normal" }, { theme: "dark", contrast: "more" }],
  ["half-transparent black over white", { body: "rgba(0, 0, 0, 0.5)", html: WHITE, colorScheme: "normal" }, { theme: "light", contrast: "more" }],
  ["a colour that can't be read counts as transparent", { body: "oklch(0.2 0 0)", html: TRANSPARENT, colorScheme: "normal" }, { theme: "light", contrast: null }],
  ["no body", { body: null, html: "rgb(22, 25, 29)", colorScheme: "normal" }, { theme: "dark", contrast: null }]
];

for (const [what, styles, expected] of BACKGROUNDS) {
  test(`decide: ${what}`, () => {
    assert.deepEqual(plain(theme.decide(styles)), expected);
  });
}

test("parseColor reads computed rgb() and rgba(), the space syntax, hex and transparent", () => {
  assert.deepEqual(plain(theme.parseColor("rgb(22, 25, 29)")), { r: 22, g: 25, b: 29, a: 1 });
  assert.deepEqual(plain(theme.parseColor("rgba(0, 0, 0, 0.5)")), { r: 0, g: 0, b: 0, a: 0.5 });
  assert.deepEqual(plain(theme.parseColor("rgb(1 2 3 / 25%)")), { r: 1, g: 2, b: 3, a: 0.25 });
  assert.deepEqual(plain(theme.parseColor("#4F5A59")), { r: 79, g: 90, b: 89, a: 1 });
  assert.deepEqual(plain(theme.parseColor("transparent")), { r: 0, g: 0, b: 0, a: 0 });
  for (const unreadable of ["oklch(0.2 0 0)", "color(display-p3 1 1 1)", "", null, undefined, "red"]) {
    assert.equal(theme.parseColor(unreadable), null, String(unreadable));
  }
});

test("dark means a luminance under 0.179, where white text contrasts more than black", () => {
  // #767676 has a luminance of 0.181 and #757575 of 0.178.
  assert.equal(theme.decide({ body: "rgb(118, 118, 118)", html: TRANSPARENT }).theme, "light");
  assert.equal(theme.decide({ body: "rgb(117, 117, 117)", html: TRANSPARENT }).theme, "dark");
  for (const grey of [117, 118]) {
    const background = { r: grey, g: grey, b: grey };
    const darker = theme.contrast(background, { r: 255, g: 255, b: 255 }) > theme.contrast(background, { r: 0, g: 0, b: 0 });
    assert.equal(theme.decide({ body: `rgb(${grey}, ${grey}, ${grey})`, html: TRANSPARENT }).theme, darker ? "dark" : "light");
  }
});

test("contrast \"more\" is set exactly when muted text would fall under 4.5:1 on the page", () => {
  for (let grey = 0; grey <= 255; grey += 5) {
    const background = { r: grey, g: grey, b: grey, a: 1 };
    const { theme: palette, contrast } = theme.decide({ body: `rgb(${grey}, ${grey}, ${grey})`, html: TRANSPARENT });
    const ratio = theme.contrast(theme.parseColor(theme.MUTED[palette]), background);
    assert.equal(contrast, ratio < 4.5 ? "more" : null, `grey ${grey}: ${ratio.toFixed(2)}:1`);
  }
});

test("MUTED holds --sdt-fg-muted from each palette in sdt.css", () => {
  const css = readFileSync(join(SRC, "src/lib/sdt.css"), "utf8");
  const muted = (marker) => {
    const start = css.indexOf(marker);
    return css.slice(start, css.indexOf("}", start)).match(/--sdt-fg-muted:\s*(#[0-9a-f]{6});/i)[1].toLowerCase();
  };
  assert.deepEqual(plain(theme.MUTED), { light: muted("/* ---- Tokens: light ---- */"), dark: muted("/* ---- Tokens: dark ---- */") });
});

/** An element with attributes, recording each write. */
const fakeElement = (name) => {
  const attributes = new Map();
  return {
    name,
    writes: [],
    getAttribute: (key) => attributes.get(key) ?? null,
    hasAttribute: (key) => attributes.has(key),
    setAttribute(key, value) {
      this.writes.push(`set ${key}=${value}`);
      attributes.set(key, String(value));
    },
    removeAttribute(key) {
      this.writes.push(`remove ${key}`);
      attributes.delete(key);
    }
  };
};

test("apply writes only the attributes that change", () => {
  const root = fakeElement("html");
  assert.equal(theme.apply(root, { theme: "light", contrast: null }), 1);
  assert.equal(theme.apply(root, { theme: "light", contrast: null }), 0);
  assert.equal(theme.apply(root, { theme: "light", contrast: "more" }), 1);
  assert.equal(theme.apply(root, { theme: "light", contrast: "more" }), 0);
  assert.equal(theme.apply(root, { theme: "dark", contrast: null }), 2);
  assert.deepEqual(root.writes, ["set data-sdt-theme=light", "set data-sdt-contrast=more", "set data-sdt-theme=dark", "remove data-sdt-contrast"]);
});

/**
 * A document whose <body> background the test sets, with a window that has manual timers, a
 * MutationObserver the test triggers, and a colour-scheme media query. checks counts each time the
 * check reads the computed styles.
 */
const fakePage = () => {
  const page = { background: WHITE, checks: 0, timers: [], observers: [], mediaListeners: [] };
  const html = fakeElement("html");
  const body = fakeElement("body");
  const head = fakeElement("head");
  const media = {
    matches: false,
    addEventListener: (type, listener) => page.mediaListeners.push(listener),
    removeEventListener: (type, listener) => page.mediaListeners.splice(page.mediaListeners.indexOf(listener), 1)
  };
  const view = {
    getComputedStyle(element) {
      if (element === body) {
        page.checks += 1;
        return { backgroundColor: page.background };
      }
      return { backgroundColor: TRANSPARENT, colorScheme: "normal" };
    },
    matchMedia: () => media,
    setTimeout(fn, ms) {
      page.timers.push({ fn, ms });
      return page.timers.length;
    },
    clearTimeout(id) {
      page.timers[id - 1].fn = null;
    },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.targets = [];
        page.observers.push(this);
      }

      observe(target, options) {
        this.targets.push([target.name, plain(options)]);
      }

      disconnect() {
        this.targets = [];
      }
    }
  };
  page.doc = { defaultView: view, documentElement: html, body, head };
  page.html = html;
  page.body = body;
  /** Delivers records to the observer, as the browser does after a change. */
  page.mutate = (...records) => page.observers.forEach((observer) => observer.targets.length && observer.callback(records));
  /** Runs the timers that are due, as the browser does when they expire. */
  page.runTimers = () => {
    const due = page.timers.splice(0);
    due.forEach(({ fn }) => fn?.());
    return due.length;
  };
  return page;
};

const classChange = (page) => ({ type: "attributes", target: page.body, attributeName: "class" });
const ownWrite = (page, attributeName = "data-sdt-theme") => ({ type: "attributes", target: page.html, attributeName });

test("watch checks at once and observes <html>, <body> and <head>", () => {
  const page = fakePage();
  theme.watch(page.doc);
  assert.equal(page.checks, 1);
  assert.equal(page.html.getAttribute("data-sdt-theme"), "light");
  assert.deepEqual(page.observers[0].targets, [["html", { attributes: true }], ["body", { attributes: true, attributeOldValue: true }], ["head", { childList: true }]]);
});

test("watch checks once for several changes in a row, 500 ms after the first", () => {
  const page = fakePage();
  theme.watch(page.doc);
  page.background = "rgb(22, 25, 29)";
  page.mutate(classChange(page));
  page.mutate(classChange(page), { type: "childList", target: page.doc.head });
  page.mutate(classChange(page));
  assert.deepEqual(page.timers.map(({ ms }) => ms), [500]);
  assert.equal(page.runTimers(), 1);
  assert.equal(page.checks, 2);
  assert.equal(page.html.getAttribute("data-sdt-theme"), "dark");
});

test("watch ignores its own attribute writes, so it never reacts to itself", () => {
  const page = fakePage();
  theme.watch(page.doc);
  page.mutate(ownWrite(page), ownWrite(page, "data-sdt-contrast"));
  assert.equal(page.timers.length, 0);
  // The same attribute names on <body> are not its own writes.
  page.mutate({ type: "attributes", target: page.body, attributeName: "data-sdt-theme" });
  assert.equal(page.timers.length, 1);
});

test("watch ignores the extension's own sdt- classes on <body>, such as the busy classes", () => {
  const page = fakePage();
  theme.watch(page.doc);
  page.body.setAttribute("class", "claro sdt-loading-metadata");
  page.mutate({ type: "attributes", target: page.body, attributeName: "class", oldValue: "claro" });
  page.body.setAttribute("class", "claro");
  page.mutate({ type: "attributes", target: page.body, attributeName: "class", oldValue: "claro sdt-loading-metadata" });
  assert.equal(page.timers.length, 0);
  // A change to the page's own classes still counts, even alongside a busy class.
  page.body.setAttribute("class", "dark sdt-loading-metadata");
  page.mutate({ type: "attributes", target: page.body, attributeName: "class", oldValue: "claro" });
  assert.equal(page.timers.length, 1);
});

test("a batch with its own write and a page change still checks once", () => {
  const page = fakePage();
  theme.watch(page.doc);
  page.mutate(ownWrite(page), classChange(page));
  assert.equal(page.runTimers(), 1);
  assert.equal(page.checks, 2);
});

test("watch checks again when the system's colour scheme changes", () => {
  const page = fakePage();
  theme.watch(page.doc);
  page.mediaListeners.forEach((listener) => listener({ matches: true }));
  assert.equal(page.runTimers(), 1);
  assert.equal(page.checks, 2);
});

test("the function watch returns stops it", () => {
  const page = fakePage();
  const stop = theme.watch(page.doc);
  page.mutate(classChange(page));
  stop();
  page.mutate(classChange(page));
  page.runTimers();
  assert.equal(page.checks, 1);
  assert.equal(page.mediaListeners.length, 0);
});

test("a check that comes due after an extension update does nothing", () => {
  const context = loadLib();
  const page = fakePage();
  context.SDT.theme.watch(page.doc);
  page.mutate(classChange(page));
  delete context.chrome.runtime.id;
  page.runTimers();
  assert.equal(page.checks, 1);
});
