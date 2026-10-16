# Calcite spike: should the extension use Esri's Calcite Design System?

- **Date:** 2026-10-16
- **Calcite version tested:** `@esri/calcite-components` 5.1.2 (released 2026-07-03), the latest stable release on this date
- **Browser tested:** Playwright's Chromium 141. Chrome 120, the manifest's minimum, was not available.
- **Baseline:** the UI design review for issue #7 (`docs/design/2026-10-ui-design-review.md`), accepted on 2026-10-09, and its mockups in `docs/design/mockups/`

## Contents

1. [Summary and recommendation](#1-summary-and-recommendation)
2. [What was built](#2-what-was-built)
3. [Answers](#3-answers)
4. [Comparison of adoption levels](#4-comparison-of-adoption-levels)
5. [Effect on the design review's decisions](#5-effect-on-the-design-reviews-decisions)
6. [Follow-up issues](#6-follow-up-issues)
7. [How to reproduce](#7-how-to-reproduce)

Each answer is marked **tested** (run in this spike), **package** (read from the installed npm package) or **docs** (from Esri's documentation, changelog or GitHub). Esri's documentation site was blocked from this environment, so some docs facts come from search-result excerpts. Those are marked **docs, excerpt**.

## 1. Summary and recommendation

**Recommendation: don't adopt Calcite components or ship any Calcite package in 2.0.0.** If the owner wants the extension to look closer to ArcGIS, take Calcite's colour, shape and type values into our own `--sdt-*` tokens. That needs the owner to reopen decision 7 (the teal accent).

The reasons, most important first:

1. **Licence.** All three Calcite packages (components, design tokens, UI icons) are proprietary and licensed under Esri's Master License Agreement. They're "all rights reserved", redistributable "without modification" under the MLA's terms. Esri's licensing page ties use to an ArcGIS account (docs, excerpt). Shipping them inside a free, MIT-licensed extension on the Chrome Web Store is a legal question that only Esri can answer. Until Esri says yes, no adoption level that ships Calcite files is open to us.
2. **Content scripts can't host Calcite directly.** In an isolated-world content script `window.customElements` is `null`, so no web component can register (tested). Calcite works on Services Directory pages only when its loader runs in the page's MAIN world. That puts our UI code in the page's JavaScript world, makes it reachable by page scripts, and limits the content script to attributes and DOM events (tested).
3. **Chrome 120 is outside Calcite's support.** Calcite 5.1.2 supports the last two versions of Chrome, which it lists as 147 and 148 (package). The extension's floor is Chrome 120.
4. **Accessibility regressions against our bar.** The spike's Calcite popup failed axe until every field got a second, hidden label. In forced-colours mode an unchecked `calcite-switch` disappears (tested; Esri fixed it in 5.2.0-next, so not in a stable release yet). Twelve open accessibility issues affect the components we'd use (docs).
5. **The accepted design already gets most of the UX.** Calcite's components added little the `sdt.css` design lacks. Several of them removed things the design relies on: SR badges that are links in eight colours, and a Details summary that sits at the end of the row.

The tokens-only variant keeps every accepted component, passes axe in both schemes, and passes `check-contrast.js` after five Calcite values move one step darker or lighter (section 3.6). It ships no Calcite file, so the licence question doesn't arise, provided we transcribe colour values only.

## 2. What was built

Everything lives in `docs/design/calcite-spike/`. Nothing in `src/` changed.

| File | What it is |
|---|---|
| `scripts/probe-content-scripts.js` | Builds a throwaway extension with Calcite inside, loads it in Chromium, and opens a fake Services Directory page with no CSP and with a strict CSP. It reports what works in the isolated world, the MAIN world and an extension page. |
| `scripts/capture.js` | Renders the spike mockups to `images/` in light, dark and (for frame D) forced colours, and runs axe with the WCAG 2.2 AA tags on each. |
| `mockups/popup.html` | Popup frames A, C and D from `docs/design/mockups/popup.html`, rebuilt with Calcite components. Same content and states. |
| `mockups/services-root.html` | The services root with the status bar, SR badges, an error row and a Details disclosure built from Calcite components. |
| `mockups/calcite-tokens.css` | The tokens-only variant: Calcite's values on the `--sdt-*` tokens, loaded after `sdt.css`. |

`docs/design/scripts/check-contrast.js` gained a `--tokens <file>` option, which checks `sdt.css` with another file's tokens on top.

### Screenshots

The accepted design's screenshots are in `docs/design/images/after-*.png`. Compare like with like:

| Surface | Accepted design | Calcite components | Calcite tokens on the accepted design |
|---|---|---|---|
| Popup, query page | `after-popup-a.png` | `components-popup-a.png` | `tokens-popup-a.png` |
| Popup, finished with failures | `after-popup-c.png` | `components-popup-c.png` | `tokens-popup-c.png` |
| Popup, problems | `after-popup-d.png` | `components-popup-d.png` | `tokens-popup-d.png` |
| Popup, problems, forced colours | (none) | `components-popup-d-forced.png` | `tokens-popup-d-forced.png` |
| Services root | `after-services-root.png` | `components-services-root.png` | `tokens-services-root.png` |
| Query Helper | `after-query-helper.png` | not built | `tokens-query-helper.png` |

Each has a `-dark` twin, except the forced-colours shots. The images are in `docs/design/calcite-spike/images/`, apart from the `after-*` ones, which are in `docs/design/images/`. Avenir Next isn't installed in the container. The Calcite screenshots show the fallback sans-serif a Linux user would see.

## 3. Answers

### 3.1 Web components in content scripts

**Tested**, in Chromium 141, with `probe-content-scripts.js`. The results were the same with no CSP and with `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'`.

| Check | Result |
|---|---|
| `window.customElements` in the isolated world | `null` (crbug 390807, long-standing) |
| `new CustomElementRegistry()` in the isolated world | `TypeError: Illegal constructor` (no scoped registries to fall back on) |
| `import()` of Calcite's loader in the isolated world | Loads, but can't define anything |
| `import()` of Calcite's loader from a `"world": "MAIN"` content script | Works, even under the strict page CSP. Chrome lets pages load `chrome-extension://` resources listed in `web_accessible_resources` |
| Elements created by the isolated script, upgraded by the MAIN-world registry | Yes: shadow root attached, `:defined` matches, icons render |
| Icons fetched under the strict CSP's `connect-src 'self'` | Yes |
| Requests that left the extension and the fake server | None. The CDN build resolves its assets next to `index.js` and never calls `js.arcgis.com` |
| `switch.checked` read from the isolated world | `undefined`. The page sees `true` |
| `checked` attribute and inner `aria-checked` after a click | Both update. State can be read from attributes |
| `calciteSwitchChange` heard in the isolated world | Yes. `event.detail` was `null` |
| Playwright `getByRole("switch", { name })` | Finds it. Playwright locators pierce open shadow roots |

So the workable route is a MAIN-world loader. Each workaround has a cost:

- **MAIN-world loader.** Calcite registers its tags in the page's own registry, and its loader adds Calcite's global stylesheet to the page with `adoptedStyleSheets` (package). If a page ever defines `calcite-*` tags itself, Calcite's `customElements.get(name) || define(...)` guard means the page's version, not ours, upgrades our elements. The isolated script can't call component methods such as `setFocus()` or read properties (inferred from the `checked` result). Every component state has to travel through attributes and events. Page scripts can read and change all of it, which the design review's decision 10 (`event.isTrusted` on the insert buttons) was written to guard against. Calcite also logs "Using Calcite Components 5.1.2" to the page's console on every page.
- **Our own code in the MAIN world as well.** This would let us call methods and read properties. It also moves the extension's logic out of the isolated world, loses `chrome.*` APIs, and needs a message bridge. That is a bigger security change than the spec allows for.
- **Polyfills.** No current polyfill provides a registry in the isolated world (docs).
- **CSS only.** Tokens as plain CSS work anywhere, with no registration at all.

### 3.2 Adoption levels per surface

See [section 4](#4-comparison-of-adoption-levels). In short:

- Calcite components in the popup and options page are technically easy (tested).
- On host pages, components need the MAIN-world loader and inherit its costs.
- Icons alone still mean shipping an MLA-licensed package.
- Tokens alone are the only level that works everywhere and ships no Calcite file.

### 3.3 Visual fit on Services Directory pages

**Tested** on the stand-in page, plus **docs** for real servers. The 10.9 and 11.x Services Directory doesn't use Calcite. It is table markup with Esri's small `rest/static/main.css`, as our fixtures model. No source found shows 12.x moving the Services Directory to Calcite. The only 12.0 change found is that a Content-Security-Policy header can now apply to its HTML pages, and section 3.1 shows a strict CSP doesn't block the MAIN-world loader.

On these pages Calcite components look like a newer ArcGIS product inserted into an older one (`components-services-root.png`). They don't look native, because the page around them isn't Calcite. Specific effects:

- Calcite's chips are larger and rounder than the page's 13px text. A row with badges grows taller than a row without them.
- `calcite-block` puts its heading on a line of its own. In the accepted design the Details summary sits at the end of the service row and a closed list stays one line per service. `calcite-block` loses that.
- Calcite's brand blue (`#007ac2`) and link blue (`#00619b`) sit next to the page's own link blue. Decision 7 rejected a blue accent for exactly that reason.

The tokens variant (`tokens-services-root.png`) keeps the accepted layout. It changes only colours, corners and font, and fits the page better of the two.

### 3.4 Theme

**Package and tested.** Calcite 5.1.2 sets light values on `:root` and has `.calcite-mode-light`, `.calcite-mode-dark` and `.calcite-mode-auto` classes. Its tokens are CSS custom properties, so a mode class on our own container recolours our elements without touching the page (tested in the services-root mockup). That maps directly onto the review's decision 5: `SDT.theme` would add `calcite-mode-dark` to the extension's elements wherever it now sets `data-sdt-theme="dark"`. Two things change soon, though:

- Calcite reads the mode for some purposes from `document.body`'s classes and fires `calciteModeChange` (docs). On a host page, `body` belongs to the page.
- The 5.2 development branch moves modes onto the CSS `color-scheme` property and deprecates the classes (docs). Tokens 4.x also renames `--calcite-color-background` to `--calcite-color-surface-1`.

### 3.5 Packaging

**Package and tested.**

- **Loading.** The 5.x CDN build is one module, `dist/cdn/index.js`, which lazy-loads one of 182 hashed chunks per component through `import()`. Icons and translations are JSON files fetched at run time. The `calcite.esm.js` file older guides mention is gone since 5.0 (docs). An extension page loads it with `<script type="module">`, which MV3's default CSP allows (tested).
- **Size.** The extension's `src/` is 200 KiB today. Calcite's CDN JavaScript is 2.0 MiB (450 KiB gzipped), plus 18 MiB of icon JSON and t9n files in 6,773 asset files. The 10 components the popup prototype uses need 37 chunk files, 257 KiB, plus `main.css` (28 KiB), one small JSON per icon, and English t9n files. A minimal vendored copy would more than double the extension.
- **Build.** `scripts/lib/extension-files.js` ships only files the manifest, HTML pages or `getURL` literals reference, and fails on anything else. It can't see chunks reached through `import()` or icons reached through `fetch()`, so it would reject a vendored Calcite folder. The build would need a vendoring step that copies the chunk closure for a fixed list of tags, the icons in use and English t9n. It would also need a rule that trusts that folder.
- **Licence.** Covered in [section 1](#1-summary-and-recommendation). `THIRD-PARTY-NOTICES.md` (Lit and others, MIT) would also have to ship.
- **Font.** Calcite asks for `"Avenir Next", Avenir, "Helvetica Neue", sans-serif` (package). No package ships the font, which is a commercial Monotype face that ArcGIS portals serve from their own copy (docs). We can't ship it. macOS has Avenir Next built in. Windows and Linux fall through to Helvetica Neue if installed, otherwise to Arial or the default sans-serif. So Calcite's own stack renders three different ways across platforms, while the review's system UI stack renders each platform's native face. Esri's typography page allows replacing the font (docs, excerpt). Keeping `--sdt-font-sans` loses nothing, and `calcite-tokens.css` uses Calcite's stack only to show the difference.

### 3.6 Accessibility

**Tested** with axe (WCAG 2.2 AA tags) and Chromium's accessibility tree.

- **Labels.** Calcite 5.1.2's `label-text` on `calcite-input` and `calcite-checkbox` draws a visible label but doesn't give the inner control an accessible name. axe reported `label` (critical) on three search boxes and `aria-toggle-field-name` (serious) on two checkboxes, and Chromium's tree showed `searchbox ""` and `checkbox ""`. Adding `label` (which becomes `aria-label`) with the same text fixed it, and the mockup now does both. Every field would carry its label twice.
- **Descriptions.** A hint that sits outside a component can't be tied to its inner control with `aria-describedby`, because ids don't cross shadow roots. The "Needs service details turned on" hint for the disabled switch is now just a nearby paragraph. The accepted design ties it to the control.
- **Forced colours.** In `components-popup-d-forced.png` the unchecked "Load service details" switch has disappeared, and the checked ones are visible. This is Calcite issue #15252, fixed in 5.2.0-next.84 and not in a stable release (docs). The tokens variant's native switch stays visible (`tokens-popup-d-forced.png`).
- **Contrast of Calcite's values (tested with `check-contrast.js`).** Calcite's own colour values, put on our tokens unchanged, fail five of 116 checks:

  | Pair | Light | Dark | Needs |
  |---|---|---|---|
  | Brand `#007ac2` as quiet-button text on `#f7f7f7` | 4.30 | pass | 4.5 |
  | Brand as text on the selected background `#d6efff` / `#2b465f` | 3.87 | 3.22 | 4.5 |
  | Danger `#d83020` on our error tint | 4.21 | pass | 4.5 |
  | Input border `#949494` on `#f7f7f7` | 2.83 | pass | 3 |

  `calcite-tokens.css` passes all 116 after it takes Calcite's next step for each. The light accent becomes `#00619b` (Calcite's link colour) and the dark accent `#40b9ff`. Light error text becomes `#a82b1e` and the strong border `#757575`. Dark `bg-selected` is darkened to `#283f55`, which has no Calcite token. These failures concern our component pairs. Whether Calcite's own components use the failing pairs wasn't measured.
- **Open issues (docs).** Of the 84 open accessibility issues, 12 touch components we'd use. Examples are a switch that isn't keyboard-operable in Chrome with NVDA (#13952), a button with no `aria-expanded` (#14404), a block whose `title` hides its toggle's name (#13672), and a notice whose `open=false` only hides it visually (#13956). Esri states no WCAG conformance level. Its only published VPAT covers Calcite 1.3.0.
- **Keyboard.** In frame D, Tab moves through the textarea, Copy URL, the search box, Search, the checkbox, the All settings link and the enabled switches in order, and skips the disabled switch (tested). This matches the accepted design.

After the label workaround, the components variant passes axe on the popup and the services root in both schemes, and so does the tokens variant on the popup, the services root and the Query Helper.

### 3.7 Testing

**Tested.** Playwright's role and text locators reach inside Calcite's open shadow roots. The existing tests could find elements the same way. Three things would change:

- Tests run their `evaluate` calls in the page's world and can read component properties. The extension can't, so a test that checks what the extension saw has to assert on attributes (`checked`, or `aria-checked` inside the shadow root).
- Each test would wait for `calcite-hydrated` before acting.
- Calcite's "Using Calcite Components" line is logged at info level on every page. The harness fails a test on console errors only, and the line passes.

### 3.8 UX gains, ranked

None of these needs Calcite. The design review either has an equivalent or could add one with native elements.

1. **Filterable lists for the Query and Find Helpers** (not built). `calcite-list` with `filter-enabled`, or `calcite-combobox` for out fields, would give a type-to-filter field list on layers with hundreds of fields. This is the largest gain on offer. It would also carry three open list issues (#14553, #14519, #14855), and it would run in the MAIN world. A native `<input>` filter over the design's listbox gets the same benefit.
2. **Clear button and built-in validation message on inputs** (tested). `calcite-input` adds a clear button and shows the error with an icon under the field. The accepted design has the error text already. The clear button is a small gain.
3. **Actions inside a notice** (tested). Frame C puts Reload page inside the success notice, which groups cause and action. The accepted design places the button on the same row, which is close.
4. **Collapsible block for the failed locations** (tested). Equivalent to the design's native `<details>`, with a heavier look.

Losses found against the accepted design:

- `calcite-chip` can't be a link, and it has three kinds, not eight hues. SR badges would lose both the link to the spatial reference and decision 8's tested palette.
- `calcite-switch` with `label-text-start` puts the switch right after its label text. The design right-aligns every switch, which reads as a list of settings.
- Disabled-control hints can't be tied to the control.
- Three label and forced-colours regressions (section 3.6).

### 3.9 Maintenance

**Docs and package.**

- Majors: 2.0 (December 2023), 3.0 (February 2025), and 5.0 (February 2026, skipping 4 to line up with the ArcGIS Maps SDK). That is about one breaking release a year.
- Releases slowed from 26 stable releases in 2024 to 11 in 2025 and 6 so far in 2026. That's about one minor release a quarter, plus daily `next` builds.
- 3.0 replaced Stencil with Lit, removed two list components, made `label` required on block and list, and changed size tokens. 5.0 dropped the CDN namespace, removed deprecated slots across eight components, and changed several components' visuals. 5.2 will deprecate the mode classes.

Each major would cost us a vendoring update, a pass over every attribute we set, new screenshots, and an axe run on both schemes. The supported-browser window (the last two Chrome versions) would keep moving away from our Chrome 120 floor. Tokens copied by value cost nothing to keep, because nothing updates under us.

## 4. Comparison of adoption levels

| | Full components | Hybrid: components in popup and options, tokens in page | Icons only | Tokens only (our values) |
|---|---|---|---|---|
| **UX** | Small gains (section 3.8), several losses on host pages | Gains in the popup only; in-page unchanged | Icon set only | Same as accepted design |
| **ArcGIS feel** | Strongest in the popup; out of place on 10.9/11.x pages | ArcGIS-like popup, closer-fitting page additions | Slight | Palette, square corners; no Calcite controls |
| **Accessibility** | Fails axe without double labels; forced-colours switch bug; 12 open issues | Same issues, popup and options only | Neutral | Passes axe and contrast after five value changes |
| **Zip size** | +300 KiB minimum, more per component | +300 KiB | Small | 0 |
| **Build** | Vendoring step, build rule for vendored files, MAIN-world bridge | Vendoring step and build rule | Vendoring step | None |
| **Security** | Components and state in the page's world | Extension pages only | Neutral | Neutral |
| **Chrome 120** | Unsupported | Unsupported | Unsupported | Supported |
| **Licence** | Needs Esri's agreement | Needs Esri's agreement | Needs Esri's agreement | Ships no Calcite file |
| **Maintenance** | Yearly major, moving browser floor | Same, smaller surface | Low | None |

## 5. Effect on the design review's decisions

Only the "Look" decision would change, and only if the owner takes the tokens route.

| Decision (section 9) | With tokens only | With components |
|---|---|---|
| 1. Settings in the popup | Keep | Keep, as `calcite-switch` |
| 3. Status bar | Keep | Keep; the bar itself would be our own markup |
| 4. Side panels | Keep | Keep; `calcite-shell-panel` was not tried |
| 5. In-page theme | Keep; also set `calcite-mode-dark` only if components arrive later | Keep, by toggling mode classes on our elements |
| 6. Theme setting | Keep | Keep |
| 7. Look: teal accent, system type, monospace | **Reopen:** blue accent `#00619b`/`#40b9ff`, Calcite neutrals, square corners. Keep system type and monospace | Replaced by Calcite's look |
| 8. Spatial reference colours | Keep | **Lost:** chips have three kinds |
| 9. Map preview position | Keep | Keep; `calcite-popover` not tried |
| 10. `isTrusted` on insert buttons | Keep | Weaker guarantee: component state lives in the page's world |
| 2 and 11 | Unaffected | Unaffected |

Phases 5 to 9 of the store-readiness spec are unchanged under the recommendation. If the owner reopens decision 7, Phase 5 (issue #13) copies `sdt.css` with the new token values. `check-contrast.js` then runs in CI against them, as #13 already plans.

## 6. Follow-up issues

These follow only if the owner accepts the tokens route. No new findings-register IDs are proposed until then.

### 6.1 Decide the accent and neutrals for 2.0.0

- **Phase:** before Phase 5 (#13)

**Problem.** The accepted look is teal on cool greys. Calcite's look is blue on neutral greys with square corners, which is what ArcGIS users see elsewhere.

**Proposal.** The owner compares `tokens-*.png` with `after-*.png` and either keeps decision 7 or adopts the values in `docs/design/calcite-spike/mockups/calcite-tokens.css`, without its font line.

**Acceptance criteria.**
- The design review's decision 7 records the outcome.
- If adopted, `docs/design/mockups/sdt.css` carries the new values, `check-contrast.js` passes with no `--tokens` file, and the `after-*` screenshots are recaptured.

### 6.2 Ask Esri whether Calcite may ship in the extension

- **Phase:** none (only if components are wanted after 2.0.0)

**Problem.** Calcite's MLA licence allows redistribution without modification under the MLA's terms, and Esri's licensing page ties use to an ArcGIS account. Neither covers a free, independent browser extension.

**Proposal.** Write to contracts@esri.com. Name the packages (components, design tokens, UI icons), say that the extension is MIT-licensed and on the Chrome Web Store, and ask whether vendoring a subset of `dist/cdn/` is allowed. Also ask whether the extension may look like an Esri product.

**Acceptance criteria.** A written answer from Esri is filed with the project. If it's yes, a new spike checks the open accessibility issues and the Chrome version floor again before any phase uses components.

## 7. How to reproduce

```sh
npm install --prefix /some/folder --ignore-scripts @esri/calcite-components@5.1.2 axe-core
export CALCITE_PATH=/some/folder/node_modules/@esri/calcite-components
export AXE_PATH=/some/folder/node_modules/axe-core/axe.min.js
node docs/design/calcite-spike/scripts/probe-content-scripts.js
node docs/design/calcite-spike/scripts/capture.js
node docs/design/scripts/check-contrast.js --tokens docs/design/calcite-spike/mockups/calcite-tokens.css
```

Set `CHROME_PATH` to run either script in another Chromium build, such as Chrome for Testing 120. Calcite isn't committed, because its licence covers redistribution only under the MLA.
