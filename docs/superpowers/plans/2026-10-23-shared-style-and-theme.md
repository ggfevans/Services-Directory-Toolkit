# Shared Style, Theme Check and Accessibility Test Helpers (#13) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the extension the design review's shared style before any surface uses it: the stylesheet `src/src/lib/sdt.css`, loaded first everywhere and changing nothing that exists today; `SDT.theme`, which sets `data-sdt-theme` and `data-sdt-contrast` on a Services Directory page's `<html>` from the page's own background; `SDT.icon`, the mockups' icons and the placeholder glyph as inline SVG; the contrast check in CI; and test helpers for a dark host page. Phase 5's surfaces (#14 to #17) and the later UI issues build on all of it.

**Architecture:**
- `src/src/lib/sdt.css` is `docs/design/mockups/sdt.css` without the mockup's popup and options page layouts (#23 and #25 bring those with their pages). Its dark tokens sit under `:root[data-sdt-theme="dark"]` for host pages and, in a second identical block, under `prefers-color-scheme: dark` for `:root[data-sdt-theme="system"]`, which the popup and the options page declare on `<html>`. `data-sdt-contrast="more"` and `prefers-contrast: more` make muted text use the text colour. Every selector names an `sdt` class except the `:root` token blocks, which set only `--sdt-*` properties, so nothing looks different until an element carries an `sdt` class. A unit test parses the file and enforces that.
- The manifest's CSS group lists `sdt.css` before `inject.css`. `page_action.html` and `options.html` link it before their own styles. `inject.css` loses the two rules `sdt.css` now holds (`.sdt-visually-hidden` and `@keyframes sdt-spin`, unchanged), and its `.sdt-error` becomes `.sdt-metadata-error`, because `sdt.css` has its own `.sdt-error`.
- Two new lib files, `src/src/lib/theme.js` (`SDT.theme`) and `src/src/lib/icon.js` (`SDT.icon`), load after `settings.js` in every content-script group and in the popup. `SDT.theme.decide` is a pure function of computed colour strings; `SDT.theme.watch(document)` checks once, then rechecks through one `MutationObserver` (attributes of `<html>` and `<body>`, children of `<head>`) and the colour-scheme media query, at most once per 500 ms, ignoring records for its own attributes. `status.js`, which runs on every Services Directory page and no other, starts it.
- `check-contrast.js` moves from `docs/design/scripts/` to `scripts/`, reads `src/src/lib/sdt.css` (or a path it is given), and runs in `npm run lint`, so in CI.
- The fake server serves `main.css` in a `"light"` style (the default, with `body.dark` and `body.grey` rules a test can switch to) or a `"dark"` style, chosen with the Playwright option `test.use({ hostStyle: "dark" })`. `axeViolations(page, { include, hostPage: true })` runs its dark pass on a dark host page.

**Tech stack:** Node 24 (`^22.13.0 || >=24`), `node --test` with `node:vm`, `@playwright/test` 1.64.0, `@axe-core/playwright` 4.14.0, ESLint 10. No new dependencies.

**Specs:**
- `docs/superpowers/specs/2026-10-09-store-readiness-design.md`: section 3 ("UI design", "Theme"), section 4 (definition of done), section 5 (shared code), "Phase 5: Service and layer pages" ("Shared style and theme", which this issue delivers early), and Appendix A (OWN-4).
- `docs/design/2026-10-ui-design-review.md`: section 4 (shared style: 4.1 to 4.4), section 5 (theme: 5.1 to 5.4), 6.3 and 6.10 (how #14 and #25 use the style), 7 (accessibility testing) and 10.1 (this issue).
- Issue #13 (this issue) and its comment about extending `tests/e2e/axe.js`.

Read the specs, `CLAUDE.md`, and the comments at the top of `tests/e2e/fixtures.js`, `tests/fixtures/fake-arcgis.js` and `tests/unit/helpers/sdt.js` before starting.

**Branch:** a new branch from `main` (2ec673e or later). One pull request against `main`, and this plan file is its first commit.

**One part, not two.** The issue is M-size, and its pieces lean on each other: the contrast check reads `sdt.css`, `SDT.theme` reads its muted tokens from it, the theme browser tests need both the dark fixture and the `status.js` call, and the axe helper's dark pass waits for the theme check. Split, the first part would ship a stylesheet nothing exercises.

## Decisions

The owner made these on 2026-10-23.

1. **The placeholder glyph ships.** The design review's placeholder mark (the `i-glyph` symbol in the mockups: a 16 px rounded square in the accent colour, a stylised tree, two dots) ships as `SDT.icon("glyph")` with the mockup's `.sdt-glyph` styles. The issue said #13 depended on #50's final artwork; it no longer does. #50 (Track S) and #55 (release) own the swap, which replaces only the glyph's shape data in `src/src/lib/icon.js`. `tests/unit/icon.test.js` compares `SDT.icon` with the mockups' `<symbol>`s, so the swap updates the mockups' `i-glyph` symbol in the same change.
2. **Background, not this issue's scope.** Phase 5 (#45) follows in two pull requests and closes #14 to #17; it builds on this issue's stylesheet, theme check, icons and test helpers.

This plan also settles points the issue and the design review left open. The owner can overrule any of them in review (see "Open points"):

- **"Nothing else in `src/` changes appearance yet."** An audit of `docs/design/mockups/sdt.css` against every `sdt-` class in `src/` found:
  - No element, universal, `html` or `body` selector. Every rule is scoped to an `sdt` class, except the `:root` token blocks, which set only `--sdt-*` custom properties. No page uses those names, so they change nothing.
  - **One real collision:** `.sdt-error`. `inject.js` puts it on the "Error" list item that `reportError` adds when a request fails, and `inject.css` styles it. Loaded first, `sdt.css`'s `.sdt-error` would add `display: flex`, `gap`, a 12 px font size and `margin: 0` to that item, because `inject.css` sets only colour, weight and background. The plan renames the old class to `sdt-metadata-error` in `inject.js` and `inject.css`. Phase 5 rewrites that list anyway.
  - **Two identical duplicates:** `.sdt-visually-hidden` (the indicator's status line) and `@keyframes sdt-spin` (its spin) are in both files with the same declarations. `inject.css` drops its copies, so each is defined once; the indicator looks and behaves the same, and `indicator.spec.js` still finds the animation name `sdt-spin`.
  - **Page layouts stay out.** The mockup's "Popup (extension page)" and "Options page (extension page)" sections (`.sdt-popup*`, `.sdt-results*`, `.sdt-row`, `.sdt mark`, `.sdt-page*`, `.sdt-card`, `.sdt-pair`, `.sdt-savebar`, `.sdt-about`) style only those two pages, yet `sdt.css` loads into every host page. #23 and #25 add them with the pages' new markup, where they can be reviewed against it. Everything else, tokens and in-page components, is copied unchanged.
  - **The proof** is a unit test, `tests/unit/sdt-css.test.js`, that parses `sdt.css` and fails on an unscoped selector, a `:root` block that sets anything but `--sdt-*`, a class that the extension's older code (anything under `src/` outside `src/src/lib/`) uses, other than `sdt-visually-hidden`, and a class or keyframes defined in both `sdt.css` and another stylesheet. It is cheap and runs on every change, where a screenshot test would need two builds of the extension in one run. Task 1 also compares screenshots of the five host page types, the popup and the options page, in light and dark, before and after, once, by hand: all 14 were byte-identical (Facts).
- **Dark tokens.** The mockup keys its dark palette to `prefers-color-scheme` only. Host pages need `:root[data-sdt-theme="dark"]` instead, and extension pages the media query. CSS has no way to share one block between an attribute selector and a media query without `light-dark()` (Chrome 123), so `sdt.css` has the dark block twice, and `sdt-css.test.js` fails if they differ. Extension pages opt in with `data-sdt-theme="system"` on `<html>`, rather than matching `:root:not([data-sdt-theme])`, which would also give a host page the system's dark palette in the moment before the theme check runs, and on JSON views, which never get one. `.sdt`'s `color-scheme` follows the same two selectors.
- **More contrast.** The mockup doesn't do design review 5.2 step 4 yet. `sdt.css` adds `:root[data-sdt-contrast="more"] { --sdt-fg-muted: var(--sdt-fg); }`, and the same under `@media (prefers-contrast: more)` for `:root` and `:root[data-sdt-theme]`, placed after the dark blocks so it wins over them at equal specificity.
- **`SDT.theme`** is a lib file with no dependencies but `SDT.guard`:
  - `decide({ body, html, colorScheme, prefersDark })` takes computed `backgroundColor` strings and returns `{ theme: "light" | "dark", contrast: "more" | null }`. It paints `<body>` over `<html>` over the canvas, so a half-transparent background counts too, and a colour it can't read (`oklch()`, `color()`) counts as transparent.
  - **The canvas** is dark when `<html>`'s computed `color-scheme` allows only dark, or allows dark and the system prefers it (`prefersDark`). The design review says "includes dark", but `color-scheme: light dark` on a light system paints a white canvas, so the plan reads the preference too, and `watch` rechecks when it changes.
  - Dark means a relative luminance under 0.179. `contrast` is `"more"` when `--sdt-fg-muted` for that palette is under 4.5:1 on the background. The muted values live in `SDT.theme.MUTED`, and `tests/unit/theme.test.js` reads `sdt.css` to check they match, so the stylesheet stays the one source.
  - `watch(document)` uses `document.defaultView` for `getComputedStyle`, `matchMedia`, timers and `MutationObserver`, so the unit tests can hand it a fake window. Its callbacks go through `SDT.guard.wrap` and `SDT.guard.listen`.
  - **"Debounced to 500 ms"** is a fixed window here: the first change schedules one check 500 ms later, and changes until then join it. A trailing debounce, reset by each change, would never check while `inject.js` keeps toggling `<body>`'s busy classes.
- **Where it runs.** `status.js` calls `SDT.theme.watch(document)` after its page-type check, so the theme check runs on every Services Directory page and on no JSON view or other page. The popup and the options page don't call it.
- **Load order.** `theme.js` then `icon.js`, after `settings.js`, in every content-script group and in `page_action.html`, which `tests/unit/manifest.test.js` requires to list the manifest's lib files in the same order. The options page keeps its own list (guard, settings, writer); #25 adds `icon.js` when it shows the glyph.
- **`SDT.icon`** is a function with properties, so callers write `SDT.icon("warn")` as the design review does: `SDT.icon(name)` returns a new `<svg class="sdt-icon">` (or `class="sdt-glyph"` for the glyph), 16 × 16, `aria-hidden="true"` and `focusable="false"`, built with `createElementNS`. `SDT.icon.ICONS` holds the 14 shapes the mockups use (`check`, `chev-l`, `chev-r`, `copy`, `error`, `external`, `glyph`, `info`, `insert`, `play`, `reload`, `search`, `user`, `warn`) as `[tag, attributes]` pairs, because several are circles and rectangles, not paths. An unknown name throws. `tests/unit/helpers/fake-dom.js` gains `createElementNS`, so no new dependency is needed.
- **Counting rechecks in the browser.** The content script's world is out of a test's reach, so the browser tests count what the page can see: writes to `data-sdt-theme` and `data-sdt-contrast`, recorded by a `MutationObserver` in the page. Three tests pin the behaviour:
  - one class change on `<body>` gives exactly one write, and none in the 1.5 s after it;
  - three class changes 50 ms apart, which checked one by one would write dark, light, dark, give one write;
  - on a page whose background turns white when `data-sdt-theme="dark"` is set, a check that reacted to its own write would flip every 500 ms, and the test sees one write in 2.5 s.

  The unit tests count the checks themselves, through a fake window that counts `getComputedStyle` calls.
- **The dark fixture.** `createFakeArcGIS` takes a third argument, `{ hostStyle }`, and serves `HOST_STYLES[hostStyle]` as `main.css` on both server origins. The Playwright option `hostStyle` passes it through, so a spec says `test.use({ hostStyle: "dark" })`. The default `"light"` style adds `body.dark` (`#16191d`, the design review's dark stand-in) and `body.grey` (`#808080`) rules, which no fixture page uses until a test adds the class.
- **The axe helper** gains `hostPage: true`. Its dark pass then also adds `body.dark` and waits for `data-sdt-theme="dark"`, and afterwards it puts the page back. On a host page, `prefers-color-scheme` alone changes nothing the extension draws, so a dark pass without a dark page would check the light palette twice. The status indicator's axe test uses it.
- **`check-contrast.js`** takes an optional path, reports a missing colour token as a failure instead of crashing, and fails clearly when a marker comment is missing. `npm run lint` runs it with `--quiet`, so CI runs it in the lint step, and `npm run contrast` prints the full table. The mockup copy can still be checked with `node scripts/check-contrast.js docs/design/mockups/sdt.css`.

## Facts verified for this plan (2026-10-23)

In Chromium 141.0.7390.37 (the local Playwright build) and Chrome for Testing 120.0.6099.109, with this plan's code applied to a scratch copy of `main` at 2ec673e:

- **Chrome 120 parses all of `sdt.css`.** Loaded into a page in each browser, it gives the same 133 style rules (plus one `@keyframes`), and every rule keeps every declaration in Chrome 120. The only difference is that `font: inherit` expands to two more longhands in Chromium 141 (`font-variant-emoji` and `font-size-adjust`).
- **The page can read the extension's tokens.** In both browsers, `getComputedStyle(document.documentElement).getPropertyValue("--sdt-bg")` in the page's own world returns the value from the content-script stylesheet (`#ffffff`, or `#1b2020` once `data-sdt-theme="dark"` is set), and a page-world `MutationObserver` sees the content script's attribute writes.
- **Nothing changes appearance.** Screenshots of the root, service, layer, query and print task pages, the popup and the options page, in the light and dark schemes, before and after the change: all 14 byte-identical, once the two things that differ between any two runs are fixed (the random badge colours, INJ-8, and response times). The comparison does see a change: with `.sdt-visually-hidden` made visible in a copy of `sdt.css`, the six host pages that show a status message differed and the rest didn't.
- **The tests bite.** With the check's own-record filter removed from `watch`, "the check never reacts to its own writes" fails. With `schedule` checking at once instead of after 500 ms, "several changes within 500 ms are checked together, once" fails. Without the `status.js` call, 8 of the 10 theme browser tests and the indicator's axe test fail. The `sdt-css.test.js` cases for collisions, the dark blocks and more contrast fail on the unmodified mockup.
- **Contrast:** `node scripts/check-contrast.js` reports 116 checks and 0 failures on `src/src/lib/sdt.css` and on the mockup.
- **Totals:** lint clean; 356 unit tests (305 before); 140 browser tests without `@cdp` (130 before), passing against `src/` and against the unzipped build in Chromium 141 and against `src/` in Chrome for Testing 120, with the six known bugs as expected failures. One run against the unzipped build failed `harness.spec.js` "a leftover request to another host" once, a test this plan doesn't touch, which passed in three reruns and in every other run.
- **Known bugs:** `SHOW_KNOWN_BUGS=1` fails each of the six remaining `knownBug()` cases on the same line as before: INJ-2 at 46, INJ-3 at 59, INJ-11 at 65, QRY-1 at 87, POP-2 at 122 and POP-3 at 131.

## Global Constraints

- **Environment.** The local Playwright browser isn't the pinned one. Run browser tests with:

  ```bash
  CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test --grep-invert @cdp
  ```

  Chromium 141 has no `Extensions.triggerAction`, so the four `@cdp` tests run only in CI. The popup now loads `theme.js` and `icon.js`, which only define their namespaces. Don't run `playwright install`. The other checks are `npm run lint`, `npm run test:unit` and `node scripts/build.js`.
- **No dependencies change.** `package.json` gains scripts only; `package-lock.json` stays as it is.
- **No HTML strings** under `src/`. `SDT.icon` builds SVG with `createElementNS` and `setAttribute`.
- **One isolated world.** Content and popup scripts stay one bare `{ }` block, and a content script's top level only declares names and ends with one `SDT.guard.onLoad(...)` or `SDT.guard.run(...)` call.
- **Lib files** start with `globalThis.SDT ??= {};`, assign one namespace, and declare no top-level names. The build's load-order check reads `SDT.<name>` anywhere in a file, comments included, so `theme.js` and `icon.js` must not name a namespace that loads after them.
- **Every new file under `src/` must be referenced** in the same commit, or `tests/unit/extension-files.test.js` and the build fail ("not referenced").
- **`sdt.css` rules** (enforced by `tests/unit/sdt-css.test.js`): every selector names an `sdt` class, `:root` blocks set only `--sdt-*`, keyframes start with `sdt-`, the two dark blocks match, each colour token is one line with a hex value, and no `light-dark()` or nesting.
- **Cross-realm values.** Compare values made in a `vm` context with `plain()` or as primitives.
- **Test data is synthetic.** The dark stylesheet is invented, like the rest of the fixtures.
- **Code style:** 2-space indent, double quotes, semicolons, `--max-warnings=0`. If lint flags only formatting in code copied from this plan, run `npx eslint --fix <file>`. Don't change the logic to satisfy it.
- **Commit messages:** imperative subject, plain-English body, ending with the attribution lines your session gives. The examples below leave them out.

## Review Focus

The failure modes most likely to let a broken change pass:

1. **`sdt.css` restyling something that exists.** Pinned by `sdt-css.test.js` (scoping, collisions, duplicates) and by Task 1's screenshot comparison. A new rule with a bare element selector, or a component class the old code already uses, fails the unit test.
2. **The two dark blocks drifting apart.** Pinned by `sdt-css.test.js`, which compares them declaration by declaration, and by `check-contrast.js`, which reads the first.
3. **A check that reacts to its own writes, or runs once per mutation.** Pinned in the browser by the self-restyling page and the three-change burst, and in Node by the fake-window tests, which count checks exactly.
4. **The theme check running where it shouldn't.** Pinned by "JSON views and pages that aren't Services Directory pages get no theme check".
5. **`SDT.theme.MUTED` drifting from the stylesheet.** Pinned by the unit test that reads both.
6. **Icons drifting from the mockups.** Pinned by `icon.test.js`, which parses every `<symbol>` in `docs/design/mockups/*.html`.
7. **The contrast check passing because it read nothing.** `check-contrast.test.js` checks the count (116), a failing light token, a failing dark token and a missing token.
8. **The axe dark pass checking the light palette.** `hostPage: true` waits for `data-sdt-theme="dark"`, so it fails, not passes, when the theme check doesn't run.

## Public API

What this issue adds that later issues use.

### `sdt.css` (`src/src/lib/sdt.css`, every host page, the popup and the options page)

Tokens and components as in design review section 4, without the popup and options page layouts. On host pages, dark tokens apply under `<html data-sdt-theme="dark">`; on extension pages, whose `<html>` has `data-sdt-theme="system"`, under `prefers-color-scheme: dark`. `<html data-sdt-contrast="more">` and `prefers-contrast: more` make `--sdt-fg-muted` equal `--sdt-fg`. Every element the extension adds from Phase 5 on carries `sdt` on its outermost node.

### `SDT.theme` (`src/src/lib/theme.js`, every content-script group and the popup)

| Member | Returns | Notes |
|---|---|---|
| `THRESHOLD`, `TEXT_CONTRAST`, `DELAY_MS` | number | 0.179, 4.5, 500 |
| `MUTED` | `{ light, dark }` | `--sdt-fg-muted` hex values, checked against `sdt.css` |
| `CANVAS` | `{ light, dark }` | `{ r, g, b, a }` |
| `ATTRIBUTES` | `string[]` | `data-sdt-theme`, `data-sdt-contrast` |
| `parseColor(text)` | `{ r, g, b, a } \| null` | Computed `rgb()`/`rgba()`, the space syntax, `#rrggbb`, `transparent` |
| `over(top, bottom)` | colour | `top` painted over an opaque `bottom` |
| `luminance(colour)`, `contrast(a, b)` | number | WCAG |
| `canvas(colorScheme, prefersDark)` | colour | |
| `background({ body, html, colorScheme, prefersDark })` | colour | Body over html over canvas |
| `decide(styles)` | `{ theme, contrast }` | Pure |
| `read(document)` | `{ theme, contrast }` | From computed styles |
| `apply(root, decision)` | number | Attributes written; writes only changes |
| `watch(document)` | `() => void` | Checks now, then on change; returns stop |

### `SDT.icon` (`src/src/lib/icon.js`, every content-script group and the popup)

| Member | Returns | Notes |
|---|---|---|
| `SDT.icon(name)` | `SVGSVGElement` | New each call; `class="sdt-icon"` (`"sdt-glyph"` for `glyph`), 16 × 16, `aria-hidden="true"`, `focusable="false"`. Throws `Unknown icon: <name>` |
| `SDT.icon.ICONS` | frozen object | `{ name: { viewBox, shapes: [[tag, attributes], ...] } }` |
| `SDT.icon.names()` | `string[]` | Sorted |
| `SDT.icon.SVG` | string | The SVG namespace |

### Tests

| Where | What |
|---|---|
| `tests/fixtures/fake-arcgis.js` | `HOST_STYLES` (`light`, `dark`), and `createFakeArcGIS(catalog, online, { hostStyle })` |
| `tests/e2e/fixtures.js` | The option `hostStyle` (`"light"` or `"dark"`): `test.use({ hostStyle: "dark" })` |
| `tests/e2e/axe.js` | `axeViolations(page, { include, hostPage })` |
| `tests/unit/helpers/fake-dom.js` | `fakeDocument().createElementNS(namespaceURI, tag)` |
| `scripts/check-contrast.js` | `node scripts/check-contrast.js [file.css] [--quiet]`; `npm run contrast` |

---

## Task 1: `sdt.css`, loaded first everywhere and changing nothing

**Files:**
- Create: `src/src/lib/sdt.css`, `tests/unit/sdt-css.test.js`
- Modify: `src/manifest.json`, `src/src/page_action/page_action.html`, `src/src/options/options.html`, `src/src/inject/inject.css`, `src/src/inject/inject.js`, `tests/unit/manifest.test.js` (append), `tests/unit/build.test.js`, `tests/unit/options-page.test.js`

**Interfaces:**
- Produces: `src/src/lib/sdt.css` (see Public API), linked from both extension pages, whose `<html>` gets `data-sdt-theme="system"`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/sdt-css.test.js`:

```js
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

test("sdt.css styles no class that the extension's older code uses, except sdt-visually-hidden", () => {
  const styled = new Set(rules.flatMap(({ selectors }) => selectors.flatMap(classesIn)));
  // Everything under src/ except the lib, whose new files are written for sdt.css.
  const older = listFiles(SRC)
    .filter((file) => /\.(js|css|html)$/.test(file) && !file.startsWith("src/lib/"))
    .flatMap((file) => [...readFileSync(join(SRC, file), "utf8").matchAll(/\bsdt-[\w-]+/g)].map(([name]) => name));
  const shared = [...new Set(older)].filter((name) => styled.has(name)).sort();
  // status.js's hidden status line: inject.css's rule for it moved to sdt.css unchanged.
  assert.deepEqual(shared, ["sdt-visually-hidden"]);
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
```

Append to `tests/unit/manifest.test.js`:

```js
test("the shared stylesheet loads first: in every content-script css list, and in both extension pages", () => {
  for (const [index, group] of manifest.content_scripts.entries()) {
    if (group.css) {
      assert.equal(group.css[0], "src/lib/sdt.css", `group ${index}`);
    }
  }
  assert.ok(manifest.content_scripts.some((group) => group.css), "no content-script css list");
  for (const page of ["src/src/page_action/page_action.html", "src/src/options/options.html"]) {
    const html = readFileSync(join(ROOT, page), "utf8");
    const sheets = [...html.matchAll(/<link\b[^>]*\bhref="([^"]+\.css)"/g)].map(([, href]) => href);
    assert.equal(sheets[0], "../lib/sdt.css", page);
    // The first stylesheet comes before any <style> element.
    assert.ok(!html.includes("<style") || html.indexOf("../lib/sdt.css") < html.indexOf("<style"), page);
  }
});

test("both extension pages follow the system's colour scheme: <html data-sdt-theme=\"system\">", () => {
  for (const page of ["src/src/page_action/page_action.html", "src/src/options/options.html"]) {
    assert.match(readFileSync(join(ROOT, page), "utf8"), /<html\b[^>]*\bdata-sdt-theme="system"/, page);
  }
});
```

In `tests/unit/build.test.js`, after the test "the zip holds exactly the files the extension references, plus LICENSE", add:

```js
test("the zip ships the shared stylesheet (#13)", () => {
  const entries = execFileSync("unzip", ["-Z1", ZIP], { encoding: "utf8" }).trim().split("\n");
  assert.ok(entries.includes("src/lib/sdt.css"));
});
```

In `tests/unit/options-page.test.js`, the `lang` test must allow the new attribute. Replace `assert.match(HTML, /<html lang="en">/);` with:

```js
  assert.match(HTML, /<html lang="en"[\s>]/);
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run test:unit`
Expected: `sdt-css.test.js` fails as a file (ENOENT for `src/src/lib/sdt.css`), and so do the two new manifest tests and the new build test. Everything else passes.

- [ ] **Step 3: Create `sdt.css` from the mockup**

Copy the mockup without its two page-layout sections:

```bash
node -e 'const fs = require("fs"); const css = fs.readFileSync("docs/design/mockups/sdt.css", "utf8"); fs.writeFileSync("src/src/lib/sdt.css", css.slice(0, css.indexOf("/* ---- Popup (extension page) ---- */")).trimEnd() + "\n");'
```

Then make three replacements in `src/src/lib/sdt.css`.

1. Replace the opening comment, from the first line `/*` through the first ` */` (the 13 lines before `/* ---- Tokens: light ---- */`), with:

```css
/*
 * Services Directory Toolkit shared style: tokens and components (UI design review, section 4).
 * Every content-script group loads it first, and the popup and the options page link it. It is
 * docs/design/mockups/sdt.css without the mockup's popup and options page layouts, which #23 and
 * #25 add with those pages.
 *
 * - Every selector names a class that starts with "sdt", except the :root token blocks, which set
 *   only --sdt-* custom properties. So a page looks the same with this file loaded until one of its
 *   elements carries an sdt class. tests/unit/sdt-css.test.js checks this, and that no class here
 *   is one the extension's older code already uses.
 * - Dark tokens: on a host page under :root[data-sdt-theme="dark"], which SDT.theme sets from the
 *   page's background (src/src/lib/theme.js); on an extension page, whose <html> has
 *   data-sdt-theme="system", under prefers-color-scheme: dark. The two dark blocks must match.
 * - data-sdt-contrast="more", which SDT.theme sets on a mid-grey page, and prefers-contrast: more
 *   make muted text use --sdt-fg.
 * - scripts/check-contrast.js reads the light and dark token blocks and checks every text and
 *   non-text pair against WCAG 2.2 AA; npm run lint runs it. Keep each colour token on one line
 *   as a hex value.
 * - Nothing here needs more than Chrome 120: no light-dark() (Chrome 123) and no CSS nesting.
 */
```

2. Replace the dark token block, from the line `/* ---- Tokens: dark ---- */` through the `}` that closes its `@media (prefers-color-scheme: dark)` block (the line before the blank line and `/* ---- Base: every element the extension adds carries .sdt on its root ---- */`), with:

```css
/* ---- Tokens: dark ---- */
/* A host page that SDT.theme found dark. */
:root[data-sdt-theme="dark"] {
  --sdt-bg: #1b2020;
  --sdt-bg-subtle: #232a2a;
  --sdt-bg-selected: #1f3a37;
  --sdt-fg: #e6ebea;
  --sdt-fg-muted: #a7b2b1;
  --sdt-border: #3a4443;
  --sdt-border-strong: #7f8c8b;
  --sdt-accent: #4fc3b8;
  --sdt-accent-hover: #74d3ca;
  --sdt-on-accent: #0b1f1d;
  --sdt-focus: #8ab4f8;
  --sdt-warn-bg: #3b2f0c;
  --sdt-warn-fg: #ffd36b;
  --sdt-warn-border: #b8952e;
  --sdt-error-bg: #3d1c18;
  --sdt-error-fg: #ffb3a6;
  --sdt-error-border: #d9705f;
  --sdt-ok-fg: #7fd69a;
  --sdt-sr0-bg: #1d2f44;
  --sdt-sr0-fg: #b8d4f5;
  --sdt-sr0-border: #6b96c7;
  --sdt-sr1-bg: #1d3d44;
  --sdt-sr1-fg: #b8ebf5;
  --sdt-sr1-border: #6bb8c7;
  --sdt-sr2-bg: #1d442d;
  --sdt-sr2-fg: #b8f5d1;
  --sdt-sr2-border: #6bc791;
  --sdt-sr3-bg: #3a441d;
  --sdt-sr3-fg: #e6f5b8;
  --sdt-sr3-border: #b0c76b;
  --sdt-sr4-bg: #44321d;
  --sdt-sr4-fg: #f5d8b8;
  --sdt-sr4-border: #c79c6b;
  --sdt-sr5-bg: #441d2a;
  --sdt-sr5-fg: #f5b8cc;
  --sdt-sr5-border: #c76b8a;
  --sdt-sr6-bg: #301d44;
  --sdt-sr6-fg: #d6b8f5;
  --sdt-sr6-border: #996bc7;
  --sdt-sr7-bg: #283238;
  --sdt-sr7-fg: #c8dbe4;
  --sdt-sr7-border: #959a9d;
  --sdt-shadow-pop: 0 6px 24px rgb(0 0 0 / 0.5), 0 1px 3px rgb(0 0 0 / 0.4);
}

/* An extension page (data-sdt-theme="system") in the system's dark mode: the same tokens. */
@media (prefers-color-scheme: dark) {
  :root[data-sdt-theme="system"] {
    --sdt-bg: #1b2020;
    --sdt-bg-subtle: #232a2a;
    --sdt-bg-selected: #1f3a37;
    --sdt-fg: #e6ebea;
    --sdt-fg-muted: #a7b2b1;
    --sdt-border: #3a4443;
    --sdt-border-strong: #7f8c8b;
    --sdt-accent: #4fc3b8;
    --sdt-accent-hover: #74d3ca;
    --sdt-on-accent: #0b1f1d;
    --sdt-focus: #8ab4f8;
    --sdt-warn-bg: #3b2f0c;
    --sdt-warn-fg: #ffd36b;
    --sdt-warn-border: #b8952e;
    --sdt-error-bg: #3d1c18;
    --sdt-error-fg: #ffb3a6;
    --sdt-error-border: #d9705f;
    --sdt-ok-fg: #7fd69a;
    --sdt-sr0-bg: #1d2f44;
    --sdt-sr0-fg: #b8d4f5;
    --sdt-sr0-border: #6b96c7;
    --sdt-sr1-bg: #1d3d44;
    --sdt-sr1-fg: #b8ebf5;
    --sdt-sr1-border: #6bb8c7;
    --sdt-sr2-bg: #1d442d;
    --sdt-sr2-fg: #b8f5d1;
    --sdt-sr2-border: #6bc791;
    --sdt-sr3-bg: #3a441d;
    --sdt-sr3-fg: #e6f5b8;
    --sdt-sr3-border: #b0c76b;
    --sdt-sr4-bg: #44321d;
    --sdt-sr4-fg: #f5d8b8;
    --sdt-sr4-border: #c79c6b;
    --sdt-sr5-bg: #441d2a;
    --sdt-sr5-fg: #f5b8cc;
    --sdt-sr5-border: #c76b8a;
    --sdt-sr6-bg: #301d44;
    --sdt-sr6-fg: #d6b8f5;
    --sdt-sr6-border: #996bc7;
    --sdt-sr7-bg: #283238;
    --sdt-sr7-fg: #c8dbe4;
    --sdt-sr7-border: #959a9d;
    --sdt-shadow-pop: 0 6px 24px rgb(0 0 0 / 0.5), 0 1px 3px rgb(0 0 0 / 0.4);
  }
}

/* ---- More contrast: muted text takes the text colour ---- */
/* SDT.theme sets data-sdt-contrast="more" when muted text would fall under 4.5:1 on the page. */
:root[data-sdt-contrast="more"] {
  --sdt-fg-muted: var(--sdt-fg);
}

/* After the dark blocks, so :root[data-sdt-theme] wins over them at the same specificity. */
@media (prefers-contrast: more) {
  :root,
  :root[data-sdt-theme] {
    --sdt-fg-muted: var(--sdt-fg);
  }
}
```

3. Replace `.sdt`'s dark `color-scheme` rule, just after the `.sdt { ... }` base rule:

```css
@media (prefers-color-scheme: dark) {
  .sdt {
    color-scheme: dark;
  }
}
```

with:

```css
:root[data-sdt-theme="dark"] .sdt {
  color-scheme: dark;
}

@media (prefers-color-scheme: dark) {
  :root[data-sdt-theme="system"] .sdt {
    color-scheme: dark;
  }
}
```

Check: `wc -l src/src/lib/sdt.css` gives 1036, `grep -c "data-sdt-theme" src/src/lib/sdt.css` gives 9, and the file ends with the `.sdt-glyph__dot` rule.

- [ ] **Step 4: Move the shared rules out of `inject.css`, and rename the colliding class**

In `src/src/inject/inject.css`:
- Rename the selector `.sdt-error {` (the rule with `color: #d00`) to `.sdt-metadata-error {`.
- Delete the `@keyframes sdt-spin { ... }` block after `.sdt-indicator--busy .sdt-indicator__ring`, and put this comment line above that rule:

  ```css
  /* The sdt-spin keyframes are in src/src/lib/sdt.css, which loads first. */
  ```
- Delete the `/* Read by screen readers, not shown. */` comment and the `.sdt-visually-hidden { ... }` rule under it, and the blank line after it.

In `src/src/inject/inject.js`, in `reportError`, change `return addSubList("Error", err0r, "sdt-error");` to:

```js
    return addSubList("Error", err0r, "sdt-metadata-error");
```

- [ ] **Step 5: Load `sdt.css` first**

In `src/manifest.json`, the first content-script group's `css` list becomes:

```json
      "css": [
        "src/lib/sdt.css",
        "src/inject/inject.css"
      ]
```

In `src/src/page_action/page_action.html`, change `<html lang="en">` to `<html lang="en" data-sdt-theme="system">`, and add before the `page_action.css` link:

```html
	<link rel="stylesheet" type="text/css" href="../lib/sdt.css" />
```

In `src/src/options/options.html`, change `<html lang="en">` to `<html lang="en" data-sdt-theme="system">`, and add after the `<title>` line, before `<style>`:

```html
  <link rel="stylesheet" href="../lib/sdt.css">
```

The build already counts content-script `css` entries and `<link href>` in extension pages as referenced (`scripts/lib/extension-files.js`), so it needs no change.

- [ ] **Step 6: Run the checks**

Run: `npm run lint && npm run test:unit && node scripts/build.js`
Expected: lint clean; 318 unit tests pass (305 before, 13 new); the zip holds `src/lib/sdt.css`.

Run: `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test --grep-invert @cdp`
Expected: 130 pass, with the six known bugs as expected failures. `indicator.spec.js` still sees the animation `sdt-spin`, now from `sdt.css`.

- [ ] **Step 7: Compare screenshots before and after (by hand, nothing committed)**

Save this as `$TMPDIR/shots.mjs` (outside the repository). It runs the local Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; change `executablePath` to run it elsewhere. It makes its browser profiles under `PROFILES`, or the system temp folder when that is unset. Don't point `TMPDIR` at a long path to move them: Chromium puts its own sockets there too, and with a long `TMPDIR` it exits with SIGTRAP at startup.

```js
// Screenshots of every surface the extension touches, for comparing two builds pixel by pixel.
// node shots.mjs <repo> <extension dir> <out dir>
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [repo, ext, out] = process.argv.slice(2);
const { chromium } = (await import(pathToFileURL(join(repo, "node_modules/playwright/index.mjs"))));
const { createFakeArcGIS, FAKE_ORIGINS, REST_ROOT } = await import(pathToFileURL(join(repo, "tests/fixtures/fake-arcgis.js")));
mkdirSync(out, { recursive: true });

const PAGES = {
  root: REST_ROOT,
  service: `${REST_ROOT}/Parcels/MapServer`,
  layer: `${REST_ROOT}/Parcels/MapServer/0`,
  query: `${REST_ROOT}/Parcels/MapServer/0/query`,
  print: `${REST_ROOT}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/execute`
};

for (const scheme of ["light", "dark"]) {
  const context = await chromium.launchPersistentContext(mkdtempSync(join(process.env.PROFILES ?? tmpdir(), "shots-")), {
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    headless: true,
    colorScheme: scheme,
    viewport: { width: 1000, height: 1400 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--host-resolver-rules=MAP * ~NOTFOUND"]
  });
  const fake = createFakeArcGIS();
  await context.route(/^https?:\/\//, async (route) => {
    if (!FAKE_ORIGINS.includes(new URL(route.request().url()).origin)) {
      return route.abort();
    }
    const response = await fake.respond(route.request(), await route.request().allHeaders());
    return response ? route.fulfill(response) : route.fulfill({ status: 404, body: "" });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  for (const [name, url] of Object.entries(PAGES)) {
    await page.goto(url);
    await page.waitForFunction(() => !/sdt-loading-/.test(document.body.className));
    await page.waitForTimeout(1500);
    // Two things differ between any two runs: badge colours, which are random today (INJ-8), and
    // response times. Fix both before the screenshot.
    await page.evaluate(() => {
      document.querySelectorAll("[style*='border-radius']").forEach((element) => {
        element.style.color = "#000";
        element.style.background = "#ddd";
      });
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        walker.currentNode.data = walker.currentNode.data.replace(/\d+ms/g, "0ms");
      }
    });
    await page.screenshot({ path: join(out, `${scheme}-${name}.png`), fullPage: true, animations: "disabled" });
  }
  for (const [name, path] of [["popup", "src/page_action/page_action.html"], ["options", "src/options/options.html"]]) {
    await page.goto(`chrome-extension://${id}/${path}`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(out, `${scheme}-${name}.png`), fullPage: true, animations: "disabled" });
  }
  await context.close();
}
console.log("done");
```

Then, from the repository root:

```bash
git worktree add "$TMPDIR/sdt-base" main
node "$TMPDIR/shots.mjs" "$PWD" "$TMPDIR/sdt-base/src" "$TMPDIR/shots-before"
node "$TMPDIR/shots.mjs" "$PWD" "$PWD/src" "$TMPDIR/shots-after"
for f in "$TMPDIR"/shots-before/*.png; do cmp -s "$f" "$TMPDIR/shots-after/$(basename "$f")" && echo "same $(basename "$f")" || echo "DIFF $(basename "$f")"; done
git worktree remove "$TMPDIR/sdt-base"
```

Expected: `same` for all 14 files. A `DIFF` means `sdt.css` restyles something: find the rule before going on.

- [ ] **Step 8: Commit**

```bash
git add src/src/lib/sdt.css src/manifest.json src/src/page_action/page_action.html src/src/options/options.html src/src/inject tests/unit
git commit -F - <<'EOF'
Add the shared stylesheet, loaded first and changing nothing yet

src/src/lib/sdt.css is the design review's tokens and components, without
the popup and options page layouts. Host pages get the dark palette from
data-sdt-theme="dark" on <html>; the popup and the options page declare
data-sdt-theme="system" and follow the system. Every rule is scoped to an
sdt class, which a new unit test checks, so nothing looks different until
an element carries one. inject.css's .sdt-error becomes .sdt-metadata-error,
because sdt.css has its own, and its copies of .sdt-visually-hidden and the
sdt-spin keyframes go, since sdt.css now holds them unchanged.
EOF
```

## Task 2: The contrast check moves to `scripts/` and runs in CI

**Files:**
- Move: `docs/design/scripts/check-contrast.js` to `scripts/check-contrast.js`
- Create: `tests/unit/check-contrast.test.js`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `src/src/lib/sdt.css` (Task 1).
- Produces: `node scripts/check-contrast.js [file.css] [--quiet]`, `npm run contrast`, and the check in `npm run lint`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/check-contrast.test.js`:

```js
// scripts/check-contrast.js passes on the shipped tokens and fails when one is changed to a failing value.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(ROOT, "scripts/check-contrast.js");
const CSS = readFileSync(join(ROOT, "src/src/lib/sdt.css"), "utf8");

const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

/** Runs the script on a copy of sdt.css with one replacement, which must occur exactly once. */
const runOnCopy = (t, from, to) => {
  assert.equal(CSS.split(from).length, 2, `"${from}" occurs once in sdt.css`);
  const dir = mkdtempSync(join(tmpdir(), "sdt-contrast-"));
  t.after(() => rmSync(dir, { recursive: true }));
  const file = join(dir, "sdt.css");
  writeFileSync(file, CSS.replace(from, to));
  return run(file, "--quiet");
};

test("the shipped tokens pass: 116 checks, none failing", () => {
  const result = run("--quiet");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^116 checks, 0 failures\.$/m);
});

test("a light token changed to a failing value fails the check", (t) => {
  const result = runOnCopy(t, "--sdt-fg-muted: #4f5a59;", "--sdt-fg-muted: #9aa5a4;");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^FAIL light: fg-muted on bg is \d\.\d\d:1, needs 4\.5:1/m);
  assert.doesNotMatch(result.stderr, /FAIL dark/);
});

test("a dark token changed to a failing value fails the check", (t) => {
  // The first dark block is the one the script reads: :root[data-sdt-theme="dark"].
  const result = runOnCopy(t, "--sdt-accent: #4fc3b8;\n  --sdt-accent-hover", "--sdt-accent: #2a6b66;\n  --sdt-accent-hover");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^FAIL dark: accent on bg is \d\.\d\d:1, needs 4\.5:1/m);
});

test("a missing colour token fails the check", (t) => {
  const result = runOnCopy(t, "  --sdt-focus: #1a5fb4;\n", "");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^FAIL light: no --sdt-focus colour token/m);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/unit/check-contrast.test.js`
Expected: all four fail: the script isn't at `scripts/check-contrast.js`, so Node exits with status 1 and "Cannot find module".

- [ ] **Step 3: Move and update the script**

```bash
git mv docs/design/scripts/check-contrast.js scripts/check-contrast.js
```

Replace the whole of `scripts/check-contrast.js` with:

```js
// Checks the colour tokens in src/src/lib/sdt.css against WCAG 2.2 AA, in both palettes.
//
//   node scripts/check-contrast.js                  prints a Markdown table (npm run contrast)
//   node scripts/check-contrast.js --quiet          prints failures only (npm run lint runs this)
//   node scripts/check-contrast.js <file.css>       checks another copy, such as the design mockup's
//
// Text pairs need 4.5:1 (SC 1.4.3). Non-text pairs (control borders, focus rings, icons, badge
// borders, switch parts) need 3:1 (SC 1.4.11). "page" is the background of the host page the
// in-page additions sit on: white for a light Services Directory page, and the dark stand-in
// page colour from docs/design/mockups/host-standin.css for a dark one.
// Exits with status 1 if any pair fails or a token is missing.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = process.argv.slice(2).find((arg) => !arg.startsWith("--"))
  ?? fileURLToPath(new URL("../src/src/lib/sdt.css", import.meta.url));
const CSS = readFileSync(file, "utf8");
const PAGE = { light: "#ffffff", dark: "#16191d" };

/** Reads the --sdt-* hex colours from the first block that follows marker. */
const tokens = (marker) => {
  const start = CSS.indexOf(marker);
  if (start === -1) {
    throw new Error(`${file}: no "${marker}" comment`);
  }
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
    const missing = [fg, bg].filter((name) => !colour(name));
    if (missing.length) {
      failures += 1;
      console.error(`FAIL ${scheme}: no --sdt-${missing.join(" or --sdt-")} colour token (${what})`);
      return "missing";
    }
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
console.log(`${quiet ? "" : "\n"}${pairs.length * 2} checks, ${failures} failures.`);
process.exitCode = failures ? 1 : 0;
```

Against the old script: it reads `src/src/lib/sdt.css` unless given a path, fails clearly when a marker comment is missing, counts a missing colour token as a failure instead of crashing, and drops the `/* global */` comment, which the repository's ESLint config makes unnecessary for `scripts/`.

- [ ] **Step 4: Run it from `npm run lint`**

In `package.json`, replace the `lint` script and add `contrast` after `build`:

```json
    "lint": "eslint . --max-warnings=0 && node scripts/check-contrast.js --quiet",
    "build": "npm run lint && node scripts/build.js",
    "contrast": "node scripts/check-contrast.js",
```

CI runs `npm run lint` in its first job, so the check now runs on every pull request, and `npm run build` runs it too. `.github/workflows/ci.yml` needs no change.

- [ ] **Step 5: Run the checks**

Run: `npm run lint && node --test tests/unit/check-contrast.test.js && node scripts/check-contrast.js docs/design/mockups/sdt.css --quiet`
Expected: lint ends with "116 checks, 0 failures."; 4 tests pass; the mockup also gives 116 checks and 0 failures.

Run: `npm run test:unit`
Expected: 322 pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/check-contrast.js tests/unit/check-contrast.test.js package.json
git commit -F - <<'EOF'
Check the shipped colour tokens' contrast in CI

check-contrast.js moves from docs/design/scripts/ to scripts/, reads
src/src/lib/sdt.css, and runs in npm run lint. A unit test runs it on
copies of the stylesheet with a failing light token, a failing dark token
and a missing token, and checks it fails on each.
EOF
```

## Task 3: `SDT.theme`, the light-or-dark decision and the watcher

**Files:**
- Create: `src/src/lib/theme.js`, `tests/unit/theme.test.js`
- Modify: `src/manifest.json`, `src/src/page_action/page_action.html`, `tests/unit/manifest.test.js` (append)

**Interfaces:**
- Consumes: `SDT.guard` (`wrap`, `listen`); `--sdt-fg-muted` in `sdt.css` (checked, not read at run time).
- Produces: `SDT.theme` (see Public API), loaded by every content-script group and the popup.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/theme.test.js`:

```js
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
```

Append to `tests/unit/manifest.test.js`:

```js
test("every content-script group loads the theme check", () => {
  for (const [index, group] of manifest.content_scripts.entries()) {
    if (group.js) {
      assert.ok(group.js.includes("src/lib/theme.js"), `group ${index}`);
    }
  }
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/unit/theme.test.js tests/unit/manifest.test.js`
Expected: all 25 theme tests fail (`theme` is undefined: `Cannot read properties of undefined`), and so does the new manifest test.

- [ ] **Step 3: Write `theme.js`**

Create `src/src/lib/theme.js`:

```js
// SDT.theme: matches the extension's in-page additions to the host page (UI design review, section
// 5.2). It reads the page's computed background, picks the light or dark palette, and sets
// data-sdt-theme="light" or "dark" on <html>, where src/src/lib/sdt.css keys its dark tokens. On a
// mid-grey page, where muted text would fall under 4.5:1, it also sets data-sdt-contrast="more".
// The popup and the options page don't use it: they follow prefers-color-scheme.
globalThis.SDT ??= {};

SDT.theme = {
  // Below this relative luminance, white text contrasts more with the background than black does.
  THRESHOLD: 0.179,
  // WCAG 2.2 SC 1.4.3 for muted text, which annotations on the page use.
  TEXT_CONTRAST: 4.5,
  // --sdt-fg-muted in each palette. tests/unit/theme.test.js checks these against sdt.css.
  MUTED: { light: "#4f5a59", dark: "#a7b2b1" },
  // The colour Chrome paints behind a page with no background of its own.
  CANVAS: { light: { r: 255, g: 255, b: 255, a: 1 }, dark: { r: 18, g: 18, b: 18, a: 1 } },
  // Changes to the page within this time are checked together, once.
  DELAY_MS: 500,
  // The attributes the check writes, which its observer ignores.
  ATTRIBUTES: ["data-sdt-theme", "data-sdt-contrast"],

  /**
   * A colour from a computed style ("rgb(1, 2, 3)", "rgba(1, 2, 3, 0.5)", "rgb(1 2 3 / 50%)") or a
   * hex value, as { r, g, b, a }; null for anything else, such as oklch() or color(display-p3 ...).
   */
  parseColor(text) {
    const value = String(text ?? "").trim().toLowerCase();
    const hex = value.match(/^#([0-9a-f]{6})$/);
    if (hex) {
      const [r, g, b] = [0, 2, 4].map((at) => parseInt(hex[1].slice(at, at + 2), 16));
      return { r, g, b, a: 1 };
    }
    if (value === "transparent") {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const rgb = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/);
    if (!rgb) {
      return null;
    }
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] ? 100 : 1);
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: Math.min(1, Math.max(0, alpha)) };
  },

  /** top painted over an opaque bottom. */
  over(top, bottom) {
    const mix = (channel) => top[channel] * top.a + bottom[channel] * (1 - top.a);
    return { r: mix("r"), g: mix("g"), b: mix("b"), a: 1 };
  },

  /** WCAG relative luminance of an opaque colour. */
  luminance({ r, g, b }) {
    const linear = (channel) => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  },

  /** WCAG contrast ratio of two opaque colours, from 1 to 21. */
  contrast(a, b) {
    const [high, low] = [SDT.theme.luminance(a), SDT.theme.luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  },

  /**
   * The canvas behind the page: dark when <html>'s color-scheme allows only dark, or allows dark
   * and the system prefers it; white otherwise ("normal", "light", or "light dark" on a light system).
   */
  canvas(colorScheme, prefersDark) {
    const schemes = String(colorScheme ?? "").toLowerCase().split(/\s+/);
    const dark = schemes.includes("dark") && (!schemes.includes("light") || prefersDark);
    return SDT.theme.CANVAS[dark ? "dark" : "light"];
  },

  /**
   * The colour the page shows behind the extension's additions: <body>'s background over <html>'s
   * over the canvas. A colour that can't be read counts as transparent.
   */
  background({ body, html, colorScheme, prefersDark = false }) {
    const layers = [html, body].map((text) => SDT.theme.parseColor(text)).filter(Boolean);
    return layers.reduce((under, layer) => SDT.theme.over(layer, under), SDT.theme.canvas(colorScheme, prefersDark));
  },

  /**
   * The decision for a page: { theme: "light" | "dark", contrast: "more" | null }. Takes the
   * computed backgroundColor of <body> and <html>, <html>'s computed colorScheme, and whether the
   * system prefers dark.
   */
  decide(styles) {
    const background = SDT.theme.background(styles);
    const theme = SDT.theme.luminance(background) < SDT.theme.THRESHOLD ? "dark" : "light";
    const muted = SDT.theme.parseColor(SDT.theme.MUTED[theme]);
    const contrast = SDT.theme.contrast(muted, background) < SDT.theme.TEXT_CONTRAST ? "more" : null;
    return { theme, contrast };
  },

  /** The decision for a document, from its computed styles. */
  read(doc) {
    const view = doc.defaultView;
    const html = view.getComputedStyle(doc.documentElement);
    return SDT.theme.decide({
      body: doc.body ? view.getComputedStyle(doc.body).backgroundColor : null,
      html: html.backgroundColor,
      colorScheme: html.colorScheme,
      prefersDark: view.matchMedia("(prefers-color-scheme: dark)").matches
    });
  },

  /** Sets the decision's attributes on root, writing only those that change. Returns how many it wrote. */
  apply(root, { theme, contrast }) {
    let writes = 0;
    if (root.getAttribute("data-sdt-theme") !== theme) {
      root.setAttribute("data-sdt-theme", theme);
      writes += 1;
    }
    if (contrast === "more" && root.getAttribute("data-sdt-contrast") !== "more") {
      root.setAttribute("data-sdt-contrast", "more");
      writes += 1;
    } else if (contrast !== "more" && root.hasAttribute("data-sdt-contrast")) {
      root.removeAttribute("data-sdt-contrast");
      writes += 1;
    }
    return writes;
  },

  /**
   * Checks doc now, then again whenever its style may have changed: attributes of <html> or <body>,
   * elements added to or removed from <head>, or the system's colour scheme. Changes within DELAY_MS
   * of the first are checked together, once. Records for the check's own attributes are ignored, so
   * it never reacts to its own writes. Returns a function that stops watching.
   */
  watch(doc) {
    const view = doc.defaultView;
    const root = doc.documentElement;
    let timer = null;
    const check = () => {
      timer = null;
      SDT.theme.apply(root, SDT.theme.read(doc));
    };
    const schedule = () => {
      if (timer === null) {
        timer = view.setTimeout(SDT.guard.wrap(check), SDT.theme.DELAY_MS);
      }
    };
    const pageClasses = (value) => (value ?? "").split(/\s+/).filter((name) => name && !name.startsWith("sdt-")).sort().join(" ");
    // The check's own attributes on <html>, and a change to <body>'s class that adds or removes only
    // the extension's own sdt- classes, such as the busy classes the content scripts toggle.
    const own = (record) => record.type === "attributes" && (
      (record.target === root && SDT.theme.ATTRIBUTES.includes(record.attributeName)) ||
      (record.target === doc.body && record.attributeName === "class" && typeof record.oldValue === "string" &&
        pageClasses(record.oldValue) === pageClasses(record.target.getAttribute("class"))));
    const observer = new view.MutationObserver(SDT.guard.wrap((records) => {
      if (records.some((record) => !own(record))) {
        schedule();
      }
    }));
    observer.observe(root, { attributes: true });
    if (doc.body) {
      observer.observe(doc.body, { attributes: true, attributeOldValue: true });
    }
    if (doc.head) {
      observer.observe(doc.head, { childList: true });
    }
    const unlisten = SDT.guard.listen(view.matchMedia("(prefers-color-scheme: dark)"), "change", schedule);
    check();
    return () => {
      observer.disconnect();
      unlisten();
      if (timer !== null) {
        view.clearTimeout(timer);
        timer = null;
      }
    };
  }
};
```

- [ ] **Step 4: Load it after `settings.js`**

In `src/manifest.json`, in each of the three groups with a `js` list, add after `"src/lib/settings.js",`:

```json
        "src/lib/theme.js",
```

In `src/src/page_action/page_action.html`, add after `<script src="../lib/settings.js"></script>`:

```html
	<script src="../lib/theme.js"></script>
```

- [ ] **Step 5: Run the checks**

Run: `npm run lint && npm run test:unit && node scripts/build.js`
Expected: lint clean; 348 unit tests pass. `guard-entry-points.test.js` still passes: `theme.js` touches nothing at load.

- [ ] **Step 6: Commit**

```bash
git add src/src/lib/theme.js src/manifest.json src/src/page_action/page_action.html tests/unit/theme.test.js tests/unit/manifest.test.js
git commit -F - <<'EOF'
Add SDT.theme, which picks the palette from the page's background

decide() paints the computed body and html backgrounds over the canvas
and picks dark under a luminance of 0.179, and asks for more contrast
when muted text would fall under 4.5:1. watch() checks at once, then once
per 500 ms window after a change to <html>'s or <body>'s attributes,
<head>'s children or the system's colour scheme, ignoring its own
attribute writes. Nothing calls watch() yet.
EOF
```

## Task 4: `SDT.icon`, the mockups' icons and the placeholder glyph

**Files:**
- Create: `src/src/lib/icon.js`, `tests/unit/icon.test.js`
- Modify: `tests/unit/helpers/fake-dom.js`, `src/manifest.json`, `src/src/page_action/page_action.html`, `tests/unit/manifest.test.js` (append)

**Interfaces:**
- Produces: `SDT.icon` (see Public API), loaded by every content-script group and the popup; `fakeDocument().createElementNS`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/helpers/fake-dom.js`, in `fakeDocument`, add after the `createElement` line:

```js
  // SVG elements keep their case, as in a browser.
  createElementNS: (namespaceURI, tag) => Object.assign(new FakeNode(1, tag), { namespaceURI }),
```

Create `tests/unit/icon.test.js`:

```js
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
```

Append to `tests/unit/manifest.test.js`:

```js
test("every content-script group loads the icons", () => {
  for (const [index, group] of manifest.content_scripts.entries()) {
    if (group.js) {
      assert.ok(group.js.includes("src/lib/icon.js"), `group ${index}`);
    }
  }
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/unit/icon.test.js tests/unit/manifest.test.js`
Expected: the five icon tests fail (`icon` is undefined), and so does the new manifest test.

- [ ] **Step 3: Write `icon.js`**

Create `src/src/lib/icon.js`:

```js
// SDT.icon: the extension's icons as inline SVG, built with createElementNS from shape data, never
// from markup (UI design review, section 4.4). SDT.icon("warn") returns a 16 px stroked icon with
// class sdt-icon, and SDT.icon("glyph") the toolkit's mark with class sdt-glyph; sdt.css styles
// both. Every icon sits next to words, so it is hidden from assistive technology.
//
// The shapes are the <symbol>s in docs/design/mockups/*.html, which tests/unit/icon.test.js checks.
// The glyph is the design review's placeholder mark; the Track S artwork (#50, #55) replaces only
// its shape data.
globalThis.SDT ??= {};

SDT.icon = Object.assign((name) => {
  if (!Object.hasOwn(SDT.icon.ICONS, name)) {
    throw new Error(`Unknown icon: ${name}`);
  }
  const icon = SDT.icon.ICONS[name];
  const create = (tag, attributes) => {
    const element = document.createElementNS(SDT.icon.SVG, tag);
    for (const [key, value] of Object.entries(attributes)) {
      element.setAttribute(key, String(value));
    }
    return element;
  };
  const svg = create("svg", {
    "class": name === "glyph" ? "sdt-glyph" : "sdt-icon",
    viewBox: icon.viewBox,
    width: 16,
    height: 16,
    "aria-hidden": "true",
    focusable: "false"
  });
  for (const [tag, attributes] of icon.shapes) {
    svg.appendChild(create(tag, attributes));
  }
  return svg;
}, {
  SVG: "http://www.w3.org/2000/svg",

  /** Each icon's viewBox and its shapes, as [tag, attributes] pairs. */
  ICONS: Object.freeze({
    check: { viewBox: "0 0 24 24", shapes: [["path", { d: "M5 12.5l4.5 4.5L19 7" }]] },
    "chev-l": { viewBox: "0 0 24 24", shapes: [["path", { d: "M15 5l-7 7 7 7" }]] },
    "chev-r": { viewBox: "0 0 24 24", shapes: [["path", { d: "M9 5l7 7-7 7" }]] },
    copy: {
      viewBox: "0 0 24 24",
      shapes: [
        ["rect", { x: "8", y: "8", width: "12", height: "12", rx: "2" }],
        ["path", { d: "M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" }]
      ]
    },
    error: {
      viewBox: "0 0 24 24",
      shapes: [["circle", { cx: "12", cy: "12", r: "9" }], ["path", { d: "M12 7.5v5.5" }], ["path", { d: "M12 16.3v.1" }]]
    },
    external: {
      viewBox: "0 0 24 24",
      shapes: [["path", { d: "M14 4h6v6" }], ["path", { d: "M20 4l-9 9" }], ["path", { d: "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" }]]
    },
    glyph: {
      viewBox: "0 0 16 16",
      shapes: [
        ["rect", { "class": "sdt-glyph__bg", width: "16", height: "16", rx: "4" }],
        ["path", { "class": "sdt-glyph__mark", d: "M5 3.5v9M5 6h4.5M5 10.5h4.5" }],
        ["circle", { "class": "sdt-glyph__dot", cx: "11.2", cy: "6", r: "1.4" }],
        ["circle", { "class": "sdt-glyph__dot", cx: "11.2", cy: "10.5", r: "1.4" }]
      ]
    },
    info: {
      viewBox: "0 0 24 24",
      shapes: [["circle", { cx: "12", cy: "12", r: "9" }], ["path", { d: "M12 11v5.5" }], ["path", { d: "M12 7.7v.1" }]]
    },
    insert: { viewBox: "0 0 24 24", shapes: [["path", { d: "M19 5v7a3 3 0 0 1-3 3H6" }], ["path", { d: "M10 11l-4 4 4 4" }]] },
    play: { viewBox: "0 0 24 24", shapes: [["path", { d: "M8 5v14l11-7z" }]] },
    reload: { viewBox: "0 0 24 24", shapes: [["path", { d: "M20 12a8 8 0 1 1-2.3-5.6" }], ["path", { d: "M20 4v5h-5" }]] },
    search: { viewBox: "0 0 24 24", shapes: [["circle", { cx: "11", cy: "11", r: "6.5" }], ["path", { d: "M16 16l4.5 4.5" }]] },
    user: {
      viewBox: "0 0 24 24",
      shapes: [["circle", { cx: "12", cy: "8.5", r: "3.8" }], ["path", { d: "M4.5 20c1.2-4 4-5.8 7.5-5.8s6.3 1.8 7.5 5.8" }]]
    },
    warn: { viewBox: "0 0 24 24", shapes: [["path", { d: "M12 3 2.5 20h19z" }], ["path", { d: "M12 10v4" }], ["path", { d: "M12 17.2v.1" }]] }
  }),

  /** The icon names, in alphabetical order. */
  names() {
    return Object.keys(SDT.icon.ICONS).sort();
  }
});
```

- [ ] **Step 4: Load it after `theme.js`**

In `src/manifest.json`, in each of the three groups with a `js` list, add after `"src/lib/theme.js",`:

```json
        "src/lib/icon.js",
```

In `src/src/page_action/page_action.html`, add after `<script src="../lib/theme.js"></script>`:

```html
	<script src="../lib/icon.js"></script>
```

- [ ] **Step 5: Run the checks**

Run: `npm run lint && npm run test:unit && node scripts/build.js`
Expected: lint clean; 354 unit tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/src/lib/icon.js src/manifest.json src/src/page_action/page_action.html tests/unit/icon.test.js tests/unit/helpers/fake-dom.js tests/unit/manifest.test.js
git commit -F - <<'EOF'
Add SDT.icon: the mockups' icons and the placeholder glyph as inline SVG

SDT.icon(name) builds a 16 px SVG with createElementNS, hidden from
assistive technology, from the shapes of the 14 symbols the design
mockups use. The glyph is the design review's placeholder mark; the
store artwork (#50) will replace only its shape data. A unit test parses
the mockups' symbols and checks every icon against them.
EOF
```

## Task 5: The dark fixture page, and the theme check on Services Directory pages

**Files:**
- Create: `tests/e2e/theme.spec.js`
- Modify: `tests/fixtures/fake-arcgis.js`, `tests/e2e/fixtures.js`, `tests/unit/fake-arcgis.test.js`, `src/src/inject/status.js`

**Interfaces:**
- Consumes: `SDT.theme.watch` (Task 3); `sdt.css`'s theme-keyed tokens (Task 1).
- Produces: `HOST_STYLES`, `createFakeArcGIS(catalog, online, { hostStyle })`, the Playwright option `hostStyle`, and the theme check on every Services Directory page.

- [ ] **Step 1: Write the failing fixture tests**

In `tests/unit/fake-arcgis.test.js`, add `HOST_STYLES` to the import from `../fixtures/fake-arcgis.js` (after `FAKE_ORIGIN,`), and add after the test "static assets, the non-REST page and unknown paths":

```js
test("the pages' stylesheet is light by default, and dark when the server is created with hostStyle dark", () => {
  const light = get(createFakeArcGIS(), "/arcgis/rest/static/main.css");
  assert.equal(light.contentType, "text/css; charset=utf-8");
  assert.equal(light.body, HOST_STYLES.light);
  assert.match(light.body, /^body\.dark \{ background: #16191d;/m);
  assert.match(light.body, /^body\.grey \{ background: #808080;/m);
  const dark = createFakeArcGIS(undefined, undefined, { hostStyle: "dark" });
  assert.equal(get(dark, "/arcgis/rest/static/main.css").body, HOST_STYLES.dark);
  assert.equal(dark.respond(request("/arcgis/rest/static/main.css", { origin: ONLINE_ORIGIN })).body, HOST_STYLES.dark);
  assert.match(HOST_STYLES.dark, /^body \{[^}]*background: #16191d;/m);
});

test("an unknown host style is refused when the server is created", () => {
  assert.throws(() => createFakeArcGIS(undefined, undefined, { hostStyle: "sepia" }), /unknown host style sepia/);
});
```

Run: `node --test tests/unit/fake-arcgis.test.js`
Expected: the file fails to load ("does not provide an export named 'HOST_STYLES'").

- [ ] **Step 2: Serve a light or dark `main.css`**

In `tests/fixtures/fake-arcgis.js`, replace the line `const STYLESHEET = { status: 200, contentType: "text/css; charset=utf-8", body: "body { font-family: sans-serif; }\n" };` with the following, with a blank line before and after it:

```js
// The pages' own stylesheet, /arcgis/rest/static/main.css, in each style createFakeArcGIS takes.
// "light" is the default. Its body.dark and body.grey rules let a test restyle the page by changing
// <body>'s class, as a page's own script or a tool like Dark Reader might. "dark" serves a page that
// is dark from the start. All of it is invented, like the rest of the fixtures.
export const HOST_STYLES = {
  light: `body { font-family: sans-serif; }
body.dark { background: #16191d; color: #d8dde3; }
body.grey { background: #808080; color: #000000; }
`,
  dark: `:root { color-scheme: dark; }
body { font-family: sans-serif; background: #16191d; color: #d8dde3; }
a { color: #8ab4f8; }
`
};

const stylesheet = (style) => {
  if (!Object.hasOwn(HOST_STYLES, style)) {
    throw new TypeError(`unknown host style ${style}`);
  }
  return { status: 200, contentType: "text/css; charset=utf-8", body: HOST_STYLES[style] };
};
```

Then:
- `const route = (catalog, url, params, cookies, problems) => {` becomes `const route = (catalog, url, params, cookies, problems, style) => {`, and its `return STYLESHEET;` becomes `return stylesheet(style);`.
- `const onlineRoute = (online, url, params, problems) => {` becomes `const onlineRoute = (online, url, params, problems, style) => {`, and its `return STYLESHEET;` becomes `return stylesheet(style);`.
- Replace the comment and first line of `createFakeArcGIS` with:

  ```js
  /**
   * Creates a fake server. respond(request, headers) takes a Playwright Request and returns options
   * for route.fulfill(), or null when nothing matches. An override's handler may be async, and then
   * respond() returns its Promise. hostStyle picks the pages' stylesheet from HOST_STYLES.
   */
  export const createFakeArcGIS = (catalog = defaultCatalog, online = defaultOnlineCatalog, { hostStyle = "light" } = {}) => {
    // Fails here, not on the first stylesheet request, for a style that doesn't exist.
    stylesheet(hostStyle);
  ```
- In `respond`, `return route(catalog, url, params, cookies, problems);` becomes `return route(catalog, url, params, cookies, problems, hostStyle);`, and `return onlineRoute(online, url, params, problems);` becomes `return onlineRoute(online, url, params, problems, hostStyle);`.

In `tests/e2e/fixtures.js`, replace the `fakeServer` fixture, and add the option above it, after `droppedDefaultArgs`:

```js
  // The fake pages' own stylesheet: "light", or "dark" for a page that is dark from the start
  // (HOST_STYLES in tests/fixtures/fake-arcgis.js). Set with test.use().
  hostStyle: ["light", { option: true }],

  fakeServer: async ({ hostStyle }, use) => {
    await use(createFakeArcGIS(undefined, undefined, { hostStyle }));
  },
```

Run: `node --test tests/unit/fake-arcgis.test.js`
Expected: pass, the two new tests included.

- [ ] **Step 3: Write the failing browser tests**

Create `tests/e2e/theme.spec.js`:

```js
// The theme check (SDT.theme, #13): in-page additions follow the host page's background, and the
// popup and the options page follow the system. The content script runs in an isolated world, so
// these tests watch what it does to the DOM: the attributes on <html>, and the token values that
// sdt.css then gives <html>, which the page can read.
import { test, expect, REST_ROOT } from "./fixtures.js";

const PRINT_TASK = `${REST_ROOT}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/execute`;
const LIGHT_BG = "#ffffff";
const DARK_BG = "#1b2020";

/** The value sdt.css gives a token on <html>. */
const token = (page, name) => page.evaluate((property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(), name);

const theme = (page) => page.evaluate(() => document.documentElement.getAttribute("data-sdt-theme"));

/**
 * Opens a page that loads nothing automatically, waits for the theme check's first write, then lets
 * any rechecks from the page's own loading settle.
 */
const openQuietPage = async (page, url = PRINT_TASK) => {
  await page.goto(url);
  await expect(page.locator("html")).toHaveAttribute("data-sdt-theme", /^(light|dark)$/);
  await page.waitForTimeout(700);
};

/** Starts recording every write to <html>'s data-sdt-theme and data-sdt-contrast, as the page sees them. */
const recordWrites = (page) => page.evaluate(() => {
  window.themeWrites = [];
  new MutationObserver((records) => {
    for (const record of records) {
      window.themeWrites.push(`${record.attributeName}=${document.documentElement.getAttribute(record.attributeName)}`);
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-sdt-theme", "data-sdt-contrast"] });
});

const writes = (page) => page.evaluate(() => window.themeWrites);

test("a light page gets the light palette", async ({ page }) => {
  await openQuietPage(page);
  expect(await theme(page)).toBe("light");
  await expect(page.locator("html")).not.toHaveAttribute("data-sdt-contrast", /.*/);
  expect(await token(page, "--sdt-bg")).toBe(LIGHT_BG);
});

test("a light page keeps the light palette when the system is dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openQuietPage(page);
  expect(await theme(page)).toBe("light");
  expect(await token(page, "--sdt-bg")).toBe(LIGHT_BG);
});

test.describe("on the dark fixture page", () => {
  test.use({ hostStyle: "dark" });

  test("<html> gets data-sdt-theme=\"dark\" and the dark palette", async ({ page }) => {
    await openQuietPage(page, REST_ROOT);
    expect(await theme(page)).toBe("dark");
    expect(await token(page, "--sdt-bg")).toBe(DARK_BG);
    expect(await token(page, "--sdt-fg-muted")).toBe("#a7b2b1");
  });
});

test("a dark class on <body> switches the palette, with exactly one recheck", async ({ page }) => {
  await openQuietPage(page);
  await recordWrites(page);
  await page.evaluate(() => document.body.classList.add("dark"));
  await expect.poll(() => theme(page)).toBe("dark");
  expect(await token(page, "--sdt-bg")).toBe(DARK_BG);
  // Long enough for two more checks, if the first had triggered another.
  await page.waitForTimeout(1500);
  expect(await writes(page)).toEqual(["data-sdt-theme=dark"]);
});

test("several changes within 500 ms are checked together, once", async ({ page }) => {
  await openQuietPage(page);
  await recordWrites(page);
  // Each of these alone would flip the palette. Checked one by one, they would write dark, light, dark.
  await page.evaluate(async () => {
    const pause = () => new Promise((resolve) => setTimeout(resolve, 50));
    document.body.classList.add("dark");
    await pause();
    document.body.classList.remove("dark");
    await pause();
    document.body.classList.add("dark");
  });
  await page.waitForTimeout(1500);
  expect(await writes(page)).toEqual(["data-sdt-theme=dark"]);
});

test("the check never reacts to its own writes, even when the page restyles itself on them", async ({ page }) => {
  await openQuietPage(page);
  // A page whose background depends on the check's own attribute. A check that reacted to its own
  // write would flip between light and dark every 500 ms here.
  await page.addStyleTag({ content: "html[data-sdt-theme=\"dark\"] body.dark { background: #ffffff; }" });
  await page.waitForTimeout(700);
  await recordWrites(page);
  await page.evaluate(() => document.body.classList.add("dark"));
  await page.waitForTimeout(2500);
  expect(await writes(page)).toEqual(["data-sdt-theme=dark"]);
});

test("a stylesheet added to <head> triggers a recheck, as Dark Reader's would", async ({ page }) => {
  await openQuietPage(page);
  await page.addStyleTag({ content: "body { background: #16191d; }" });
  await expect.poll(() => theme(page)).toBe("dark");
});

test("a mid-grey page gets data-sdt-contrast=\"more\", and muted text takes the text colour", async ({ page }) => {
  await openQuietPage(page);
  expect(await token(page, "--sdt-fg-muted")).toBe("#4f5a59");
  await page.evaluate(() => document.body.classList.add("grey"));
  await expect(page.locator("html")).toHaveAttribute("data-sdt-contrast", "more");
  expect(await theme(page)).toBe("light");
  expect(await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return [style.getPropertyValue("--sdt-fg-muted").trim(), style.getPropertyValue("--sdt-fg").trim()];
  })).toEqual(["#1c2121", "#1c2121"]);
  await page.evaluate(() => document.body.classList.remove("grey"));
  await expect(page.locator("html")).not.toHaveAttribute("data-sdt-contrast", /.*/);
});

test("JSON views and pages that aren't Services Directory pages get no theme check", async ({ page }) => {
  for (const url of [`${REST_ROOT}?f=pjson`, "https://arcgis.test/docs/rest/services/overview"]) {
    await page.goto(url);
    await page.waitForTimeout(700);
    expect(await theme(page), url).toBeNull();
  }
});

test("the options page and the popup follow the system's colour scheme", async ({ page, extensionId, openPopupTab }) => {
  const popup = await openPopupTab(`${REST_ROOT}/Parcels/MapServer`);
  for (const view of [page, popup]) {
    if (view === page) {
      await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
    }
    await view.emulateMedia({ colorScheme: "light" });
    expect(await token(view, "--sdt-bg")).toBe(LIGHT_BG);
    await view.emulateMedia({ colorScheme: "dark" });
    expect(await token(view, "--sdt-bg")).toBe(DARK_BG);
    expect(await theme(view)).toBe("system");
  }
});
```

Run: `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test tests/e2e/theme.spec.js`
Expected: 8 fail, at the `data-sdt-theme` wait in `openQuietPage` or the first `data-sdt-theme` assertion, because nothing calls `SDT.theme.watch` yet. Two pass already: "JSON views and pages that aren't Services Directory pages get no theme check", and "the options page and the popup follow the system's colour scheme", which Task 1 made true. Both pin behaviour this task must keep.

- [ ] **Step 4: Start the theme check from `status.js`**

In `src/src/inject/status.js`, at the end of `start`, after `watch(document.body, indicator, message);`, add:

```js
    // Match the extension's palette to this page's background, now and when the page's style changes.
    // Last, so the toolbar button and the indicator never depend on it.
    SDT.theme.watch(document);
```

In the comment at the top of the file, replace its last two lines (from "and has no click handler") with:

```js
  // and has no click handler (SEC-1, ADV-3); settings live on the options page. Phase 5 moves it
  // into the page as the status bar (#14). It also starts the theme check (src/src/lib/theme.js),
  // because it runs on every Services Directory page and on no other.
```

- [ ] **Step 5: Run the checks**

Run: `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test tests/e2e/theme.spec.js tests/e2e/indicator.spec.js`
Expected: all pass.

Run: `npm run lint && npm run test:unit`, then the whole browser suite.
Expected: lint clean; 356 unit tests pass; 140 browser tests pass, with the six known bugs as expected failures.

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/fake-arcgis.js tests/e2e/fixtures.js tests/e2e/theme.spec.js tests/unit/fake-arcgis.test.js src/src/inject/status.js
git commit -F - <<'EOF'
Match the extension's palette to the host page on Services Directory pages

status.js starts SDT.theme.watch after its page-type check, so the theme
check runs on every Services Directory page and on no JSON view or other
page. The fake server can serve a dark main.css (test.use({ hostStyle:
"dark" })), and its light one has body.dark and body.grey rules a test
can switch to. Browser tests check the dark fixture page, one write for
one change and for a burst of changes, no reaction to the check's own
writes, more contrast on a mid-grey page, and the extension pages
following the system.
EOF
```

## Task 6: axe on a dark host page

**Files:**
- Modify: `tests/e2e/axe.js`, `tests/e2e/accessibility.spec.js`

**Interfaces:**
- Consumes: the light fixture's `body.dark` rule and the theme check (Task 5).
- Produces: `axeViolations(page, { include, hostPage })`.

This changes test tooling, not the extension, so it has no failing-first step (spec section 4.1 covers behaviour). Step 3 shows instead that the new dark pass depends on the theme check.

- [ ] **Step 1: Give the helper a host-page mode**

Replace the whole of `tests/e2e/axe.js` with:

```js
// Runs axe-core on a page in the light and the dark colour scheme (store-readiness spec, section 4.2).
// On host pages, scope it to the extension's own elements: the page's markup isn't ours to fix.
import AxeBuilder from "@axe-core/playwright";

export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
export const COLOR_SCHEMES = ["light", "dark"];

// The class that turns the fake server's light page dark (HOST_STYLES in tests/fixtures/fake-arcgis.js).
const DARK_BODY = "dark";

/**
 * Puts a host page in a colour scheme: the system's, and the page's own background, which is what
 * the extension's palette follows (SDT.theme). Waits until the theme check has caught up.
 */
const setHostScheme = async (page, colorScheme) => {
  await page.emulateMedia({ colorScheme });
  await page.evaluate(({ name, on }) => document.body.classList.toggle(name, on), { name: DARK_BODY, on: colorScheme === "dark" });
  await page.waitForFunction((theme) => document.documentElement.getAttribute("data-sdt-theme") === theme, colorScheme);
};

/**
 * Returns { light: [...], dark: [...] }, each a list of "rule: target, target" strings, empty when
 * axe finds nothing. include is a CSS selector for the elements to check, or omitted for the whole
 * page. axe fails when include matches nothing, so a renamed element can't pass by being missed.
 *
 * On an extension page the two runs differ only in prefers-color-scheme. On a host page, pass
 * hostPage: true. The dark run then also turns the page itself dark, as the fake server's dark style
 * does, and waits for the extension to switch to its dark palette; afterwards the page is light again.
 * hostPage needs the default light host style, not test.use({ hostStyle: "dark" }).
 */
export const axeViolations = async (page, { include, hostPage = false } = {}) => {
  const results = {};
  for (const colorScheme of COLOR_SCHEMES) {
    if (hostPage) {
      await setHostScheme(page, colorScheme);
    } else {
      await page.emulateMedia({ colorScheme });
    }
    const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
    if (include) {
      builder.include(include);
    }
    const { violations } = await builder.analyze();
    results[colorScheme] = violations.map(({ id, nodes }) => `${id}: ${nodes.map((node) => node.target.join(" ")).join(", ")}`);
  }
  if (hostPage) {
    await setHostScheme(page, "light");
  }
  return results;
};
```

- [ ] **Step 2: Run the indicator's axe check on a light and a dark page**

In `tests/e2e/accessibility.spec.js`, replace the first test's title and its last line:

```js
test("axe finds nothing wrong with the status indicator, on a light and a dark page", async ({ page }) => {
```

```js
  expect(await axeViolations(page, { include: ".sdt-indicator", hostPage: true })).toEqual(NO_VIOLATIONS);
```

Run: `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test tests/e2e/accessibility.spec.js tests/e2e/options.spec.js`
Expected: all pass. The options page's callers don't pass `hostPage` and behave as before.

- [ ] **Step 3: Check that the dark pass needs the theme check**

Comment out the `SDT.theme.watch(document);` line in `src/src/inject/status.js` and run the indicator's axe test again (`-g "status indicator, on a light"`).
Expected: it fails, timing out in `setHostScheme`'s wait for `data-sdt-theme="light"`. Restore the line, and check `git diff src/src/inject/status.js` is empty.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/axe.js tests/e2e/accessibility.spec.js
git commit -F - <<'EOF'
Run axe's dark pass on a dark host page

On a host page, prefers-color-scheme alone changes nothing the extension
draws. axeViolations(page, { hostPage: true }) also turns the fake page
dark for its dark pass and waits for the theme check to switch palettes,
then puts the page back. The status indicator's axe test uses it.
EOF
```

## Task 7: Docs, the spec, the known bugs, and the PR

**Files:**
- Modify: `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `.coderabbit.yaml`, `docs/superpowers/specs/2026-10-09-store-readiness-design.md`, `docs/design/2026-10-ui-design-review.md`, `docs/design/mockups/sdt.css` (its header comment)

- [ ] **Step 1: Re-check the known bugs**

Run: `SHOW_KNOWN_BUGS=1 CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test tests/e2e/known-bugs.spec.js`
Expected: the six remaining `knownBug()` cases fail on these lines of `known-bugs.spec.js`, as before this change: INJ-2 at 46, INJ-3 at 59, INJ-11 at 65, QRY-1 at 87, POP-2 at 122 (with a console error), POP-3 at 131. INJ-2 checks text, so the renamed `sdt-metadata-error` class doesn't reach it. If a line differs, find out why before going on.

- [ ] **Step 2: Update `CLAUDE.md`**

- **Commands, `npm run lint`:** after "with warnings treated as errors.", add: "It then runs `scripts/check-contrast.js --quiet`, which checks every colour pair in `src/src/lib/sdt.css` against WCAG 2.2 AA in both palettes; `npm run contrast` prints the full table."
- **Browser tests:** after the sentence that starts "`seedStorage(items, area)` and `readStorage(keys, area)`", add: "`test.use({ hostStyle: "dark" })` makes the fake server's `main.css` dark from the start; the default light style has `body.dark` and `body.grey` rules a test can switch to by changing `<body>`'s class (`HOST_STYLES` in `fake-arcgis.js`)." In the sentence about `tests/e2e/axe.js`, after "on host pages, pass `include` to scope it to the extension's elements", add ", and `hostPage: true` to run the dark pass on a dark host page, which is what the extension's palette follows".
- **Architecture, the `status.js` bullet:** after "It also enables the toolbar button.", add: "And it starts the theme check, `SDT.theme.watch(document)`."
- **Architecture, the namespaces paragraph:** change "`SDT.page` (`classify`) and `SDT.settings` (the settings schema, `validate`, `parse` and `read`)." to "`SDT.page` (`classify`), `SDT.settings` (the settings schema, `validate`, `parse` and `read`), `SDT.theme` (`decide` and `watch`, the in-page theme check) and `SDT.icon` (`SDT.icon(name)`, the 16 px SVG icons and the placeholder glyph)." After the `writer.js` sentence, add:

  ```markdown
  `src/src/lib/sdt.css` is the shared stylesheet (design review section 4): the first entry in the content scripts' `css` list, and linked first by the popup and the options page. Every selector in it names an `sdt` class, except the `:root` token blocks, which set only `--sdt-*` properties, and no rule styles a class the older code uses; `tests/unit/sdt-css.test.js` checks both, so nothing changes appearance until an element carries an `sdt` class. Host pages get its dark tokens from `data-sdt-theme="dark"` on `<html>`, which `SDT.theme` sets from the page's computed background, checking again (at most once per 500 ms, never on its own writes) when `<html>`'s or `<body>`'s attributes, `<head>`'s children or the system's colour scheme change; on a mid-grey page it also sets `data-sdt-contrast="more"`, which makes muted text use the text colour. The popup and the options page declare `data-sdt-theme="system"` and follow `prefers-color-scheme`. The two dark token blocks must stay the same.
  ```
- **Architecture, "Every class the extension injects starts with `sdt-`."** becomes "Every class the extension injects starts with `sdt`: the root class `sdt` of the shared components, or `sdt-`."

- [ ] **Step 3: Update `README.md`**

In "Changes made on top of Ken's last commit", add after the bullet that starts "Prefixed the extension's CSS classes":

```markdown
- Added a shared stylesheet with light and dark palettes that meet WCAG 2.2 AA contrast, checked on every change, and a check that matches the extension's colours to the page's own background, ready for the redesigned interface.
```

- [ ] **Step 4: Update `CONTRIBUTING.md`**

- In the `npm run lint` bullet, replace "checks the code with ESLint. Warnings fail." with "checks the code with ESLint, then checks the colour tokens in `src/src/lib/sdt.css` against WCAG 2.2 AA contrast (`npm run contrast` prints the full table). Warnings fail."
- In the axe bullet, after "scoped to the extension's own elements on host pages", add ", where `hostPage: true` runs the dark pass on a dark host page".
- In the shared-code bullet, after "Add a new lib file to every `content_scripts` group and to `page_action.html`, after the files it uses.", add: "Shared styles go in `src/src/lib/sdt.css`: use its `--sdt-*` tokens, and scope every selector to an `sdt` class (`tests/unit/sdt-css.test.js` checks). Build icons with `SDT.icon(name)`."

- [ ] **Step 5: Update `.coderabbit.yaml`**

- In the `src/src/lib/**` instructions, after "settings.js holds every setting's default, allowed values and label; flag a default written anywhere else.", add: "theme.js decides the in-page palette from computed colours and must ignore its own attribute writes; icon.js builds SVG with createElementNS only."
- In the `src/manifest.json` instructions, change "in the order dom, guard, auth, url, net, page, settings." to "in the order dom, guard, auth, url, net, page, settings, theme, icon, and the css list starts with src/lib/sdt.css."
- Add a path instruction after the `src/src/lib/**` one:

  ```yaml
      - path: "src/src/lib/sdt.css"
        instructions: |
          The shared stylesheet loads into every Services Directory page, the popup and the options
          page. Flag any selector that doesn't name an sdt class (except the :root token blocks,
          which may set only --sdt-* custom properties), colours written as literals instead of
          --sdt-* tokens, a change to one dark token block that isn't made to the other, a colour
          token that isn't a one-line hex value (scripts/check-contrast.js reads them), and
          anything newer than Chrome 120, such as light-dark() or CSS nesting.
  ```

- [ ] **Step 6: Update the spec and the design review**

In `docs/superpowers/specs/2026-10-09-store-readiness-design.md`:
- Under "Phase 5", after the line "**Shared style and theme:**", add the line "Delivered early by #13, before the other Phase 5 work.", followed by a blank line.
- In section 5's table, add a row after Phase 4's:

  ```markdown
  | 5 (#13, first) | Shared stylesheet (`sdt.css`), theme check (`SDT.theme`), icons (`SDT.icon`) |
  ```
- Under "Facts verified during review", after the Phase 4 checks, add:

  ```markdown
  - **#13 checks (2026-10-23), in Chromium 141 and Chrome for Testing 120:**
    - Chrome 120 parses all of `sdt.css` and keeps every declaration.
    - A page's own `getComputedStyle(document.documentElement)` reads the `--sdt-*` values from the content-script stylesheet, and a page's `MutationObserver` sees the content script's attribute writes, so browser tests can watch the theme check from the page.
  ```

In `docs/design/2026-10-ui-design-review.md`:
- Section 4, first paragraph: replace "It is written to be copied into the extension in Phase 5 with few changes." with "#13 copied it into the extension as `src/src/lib/sdt.css`, without the popup and options page layouts, which #23 and #25 add with those pages."
- 4.1, **Files.**: replace "Phase 5 adds `src/src/lib/sdt.css`, listed first" with "`src/src/lib/sdt.css`, added in #13, is listed first", and "and `sdt.css` would be its first stylesheet" with "and `sdt.css` is its first stylesheet".
- 4.3, first sentence: replace "`docs/design/scripts/check-contrast.js` reads the token blocks from `sdt.css`" with "`scripts/check-contrast.js` (`npm run contrast`; `npm run lint` runs it) reads the token blocks from `src/src/lib/sdt.css`".
- 7, **Contrast:**: replace "`check-contrast.js` moves to `scripts/` and runs in CI, so a token change can't drop below AA." with "`scripts/check-contrast.js` runs in CI (#13), so a token change can't drop below AA."
- 11, **Contrast:**: replace "`node docs/design/scripts/check-contrast.js` prints the full table from section 4.3." with "`npm run contrast` prints the full table from section 4.3, for `src/src/lib/sdt.css`; `node scripts/check-contrast.js docs/design/mockups/sdt.css` checks the mockup copy."

In `docs/design/mockups/sdt.css`, replace the header comment's last paragraph (" * docs/design/scripts/check-contrast.js reads the two token blocks below and checks every" through "...one line as a hex value.") with:

```css
 * This mockup copy keeps the dark tokens under the media query. The extension's copy,
 * src/src/lib/sdt.css (#13), keys them to data-sdt-theme; scripts/check-contrast.js checks it,
 * and checks this file when given its path. Keep each colour token on one line as a hex value.
```

- [ ] **Step 7: Final verification**

Run: `npm run lint && npm run test:unit && node scripts/build.js && rm -rf dist && unzip -q build/*.zip -d dist`, then the browser tests twice, with `EXT_PATH=dist` and without, then `git status --short`.
Expected: lint clean, ending "116 checks, 0 failures."; 356 unit tests pass; the zip holds `src/lib/sdt.css`, `src/lib/theme.js` and `src/lib/icon.js`; 140 browser tests pass in each run, with the six known bugs as expected failures; only the docs are uncommitted. Delete `dist/` afterwards (git ignores it).

If Chrome for Testing 120 is installed (`npx @puppeteer/browsers install chrome@120 --path ~/chrome-for-testing`), run the suite once more against `src/` with `CHROME_PATH` pointing at it and `--grep-invert @cdp`, as the CI job does.

- [ ] **Step 8: Commit, push and open the PR**

```bash
git add README.md CONTRIBUTING.md CLAUDE.md .coderabbit.yaml docs
git commit -F - <<'EOF'
Describe the shared style and the theme check in the docs and the spec
EOF
git push -u origin HEAD
```

Open the PR against `main` with the title "Shared style, theme check and accessibility test helpers". The body says "Closes #13" and lists:

- **Findings:** the "Finding IDs" table below. No Appendix A finding closes in full.
- **Departures from the issue and the design review:**
  - The placeholder glyph ships; #50 replaces its shape data (owner's decision, 2026-10-23).
  - `sdt.css` leaves out the mockup's popup and options page layouts (#23, #25).
  - The dark tokens appear twice, once per selector, and a test keeps them equal; extension pages opt in with `data-sdt-theme="system"`.
  - The canvas counts as dark under `color-scheme: light dark` only when the system prefers dark, and the check also reruns when the system's scheme changes.
  - "Debounced to 500 ms" is a fixed window from the first change.
  - `inject.css`'s `.sdt-error` is renamed `.sdt-metadata-error`.
- **Open risks:** the open points below.

End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)` and your session line. Then run `gh pr checks --watch`. The `chrome-120` job may fail without blocking; the suite passed locally on Chrome for Testing 120 while this plan was written.

---

## Acceptance criteria (issue #13)

| Criterion | Task | Test |
|---|---|---|
| `node --test` covers the theme decision for a table of backgrounds: white, `#16191d`, transparent with and without `color-scheme: dark`, and a mid-grey that triggers `data-sdt-contrast="more"` | 3 | `tests/unit/theme.test.js`: the 13 `decide:` cases (those five and eight more), the 0.179 boundary, and a sweep of greys against the 4.5:1 rule |
| A browser test on the dark fixture page finds `data-sdt-theme="dark"` on `<html>` | 5 | `theme.spec.js` "on the dark fixture page › `<html>` gets `data-sdt-theme="dark"` and the dark palette" |
| Changing the class of the host page's `<body>` to a dark style switches the palette, with exactly one recheck | 3, 5 | `theme.spec.js` "a dark class on `<body>` switches the palette, with exactly one recheck" and "several changes within 500 ms are checked together, once"; `theme.test.js` "watch checks once for several changes in a row" |
| The check never reacts to its own attribute writes | 3, 5 | `theme.spec.js` "the check never reacts to its own writes, even when the page restyles itself on them"; `theme.test.js` "watch ignores its own attribute writes" |
| `check-contrast.js` passes in CI and fails when a token is changed to a failing value | 2 | `npm run lint` in CI; `tests/unit/check-contrast.test.js` |
| The build includes `sdt.css` | 1 | `build.test.js` "the zip ships the shared stylesheet (#13)" |
| Nothing else in `src/` changes appearance yet | 1 | `tests/unit/sdt-css.test.js`; Task 1 Step 7's screenshot comparison; the existing browser suite unchanged |
| (Proposal) an axe helper running the five WCAG 2.2 AA tags in both schemes | 6 | `tests/e2e/axe.js` `hostPage`; `accessibility.spec.js` on a light and a dark page |
| `README.md`, `CONTRIBUTING.md`, `CLAUDE.md` and `.coderabbit.yaml` match the code | 7 | Review |

## Finding IDs

No finding in Appendix A closes in full. This issue delivers part of one, and the shared pieces later fixes use:

| ID | Task | Resolution |
|---|---|---|
| OWN-4, part | 1 to 6 | The shared style from the UI design review: tokens, components, the in-page theme check, icons and contrast in CI. The surfaces that use them come in Phases 5 to 9 |
| INJ-19, groundwork | 1 | `inject.css`'s generic-looking `.sdt-error` becomes `.sdt-metadata-error`, so it can't collide with the shared style. The CSS clean-up stays with Phase 5 |
| ADV-1, part | 7 | README's change list, CONTRIBUTING, CLAUDE.md and `.coderabbit.yaml` |

## Commands

| What | Command |
|---|---|
| Lint, with the contrast check | `npm run lint` |
| Contrast table | `npm run contrast`, or `node scripts/check-contrast.js <file.css>` |
| Unit tests | `npm run test:unit`, or one file: `node --test tests/unit/theme.test.js` |
| Build without lint | `node scripts/build.js` |
| Browser tests | `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test --grep-invert @cdp` |
| One browser spec | add the file and `-g "<title>"` to the command above |
| Against the zip | `rm -rf dist && unzip -q build/*.zip -d dist`, then the browser command with `EXT_PATH=dist` |
| Known bugs as normal tests | prefix the browser command with `SHOW_KNOWN_BUGS=1` and add `tests/e2e/known-bugs.spec.js` |

## Open points

1. **Colours the check can't read.** A page whose computed background is `oklch()`, `lab()` or `color(...)` (Chrome keeps those spaces in computed values) counts as transparent, so the check falls through to `<html>` and the canvas. Services Directory pages use hex colours, and Dark Reader writes `rgb()`. Converting the other spaces would add code nobody has needed yet.
2. **Rechecks during loading.** `inject.js`, `mapImages.js` and `queryTest.js` toggle `sdt-loading-*` classes on `<body>`, so a busy page gets a recheck at most every 500 ms while loading. Each is two `getComputedStyle` calls and writes nothing when nothing changed. Filtering out the extension's own busy classes would save little and make the filter harder to trust.
3. **The theme check runs on query and print task pages too.** It runs wherever `status.js` does, which is every Services Directory page. Phase 5 and later add panels there, so it should; it costs one observer.
4. **The dark token block is duplicated.** Two copies of 43 declarations, kept equal by a test. `light-dark()` would remove the duplicate once the minimum Chrome version reaches 123.
5. **Page layouts left out.** #23 and #25 decide where the popup and options page layouts live: back in `sdt.css`, or in each page's own stylesheet. Either way, `sdt-css.test.js`'s scoping rule still applies to `sdt.css`.
6. **The glyph's artwork.** The placeholder ships (Decision 1). When #50's artwork lands, the glyph's shapes in `icon.js` and the mockups' `i-glyph` symbol change together, and `icon.test.js` keeps them in step.
7. **Dark Reader** wasn't run (it can't be installed headless). The theme browser test that adds a stylesheet to `<head>` stands in for it, following design review section 5.2.
8. **No theme setting**, as the design review recommends (section 5.3). If the check proves wrong on real servers, an `inPageTheme` key can be added to the schema later.

## Changes made while implementing

- **Task 1, Step 7 (screenshot script).** `shots.mjs` makes its browser profiles under `PROFILES` when set, instead of always under `os.tmpdir()`, so the profiles can live in a scratch folder. Setting `TMPDIR` to that long scratch path instead made Chromium exit with SIGTRAP at startup, because it puts its own sockets under `TMPDIR` too. The base for the "before" screenshots was a worktree of the plan commit (02acb24), whose `src/` is the same as `main`'s at 2ec673e. All 14 screenshots were byte-identical before and after Task 1, and again after Task 6. With `.sdt-visually-hidden` made visible in a copy of `sdt.css`, the six host pages that show a status message (root, service and layer, light and dark) differed and the other eight didn't, so the comparison sees a change.
- **Task 7, `.coderabbit.yaml`.** The `src/**/*.js` instructions also changed: "Classes the extension injects start with sdt-." now says they start with `sdt`, the shared components' root class `sdt` or `sdt-`, to match the same change in `CLAUDE.md`. Without it, CodeRabbit would flag Phase 5's `sdt` root class.

### After the independent review

- **The watcher ignores the extension's own `sdt-` classes on `<body>`.** `inject.js`, `mapImages.js` and `queryTest.js` toggle `sdt-loading-*` on `<body>`, and each toggle scheduled a recheck: two style reads every 500 ms while a page loaded. `<body>` is now observed with `attributeOldValue`, and a class change whose non-`sdt-` classes are the same before and after counts as the extension's own. Unit test: "watch ignores the extension's own sdt- classes on <body>, such as the busy classes", which failed first.
- **`status.js` starts the theme check last,** after enabling the toolbar button and building the indicator, so neither depends on it.
