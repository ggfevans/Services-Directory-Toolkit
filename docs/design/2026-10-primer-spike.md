# Primer spike: should the extension use GitHub's Primer design system?

- **Date:** 2026-10-16
- **Versions tested:** `@primer/primitives` 11.10.0, `@primer/view-components` 0.53.5, `@primer/css` 22.3.2, `@primer/octicons` 19.40.0. All are MIT-licensed.
- **Browser tested:** Playwright's Chromium 141
- **Baseline:** the UI design review for issue #7 (`docs/design/2026-10-ui-design-review.md`), and the Calcite spike (`docs/design/2026-10-calcite-spike.md`), whose method this spike repeats

Each answer is marked **tested** (run in this spike) or **package** (read from the installed npm packages).

## 1. Summary and recommendation

**Recommendation: keep `sdt.css`, and don't adopt Primer's components.** Primer has no licence problem and no content-script problem, and its components pass our accessibility checks. It still adds little the accepted design lacks, and it makes the extension look like GitHub instead of ArcGIS. Two parts are worth taking, if the owner wants them:

- **Octicons** (MIT) for the extension's icons. The 16px set is drawn for dense developer UI. The mockups currently use hand-drawn symbols.
- **Primer Primitives' colour values**, copied into our tokens. This is the same tokens-only route the Calcite spike offered, and it needs the owner to reopen decision 7 (the teal accent).

How Primer compares with Calcite, point by point:

| | Calcite 5.1.2 | Primer |
|---|---|---|
| Licence | Esri MLA, proprietary | MIT |
| Works in a content script | Only through a MAIN-world loader | Yes: the components are CSS classes on our own light-DOM markup |
| Chrome 120 | Unsupported (last two Chrome versions) | `@primer/css` targets the last 10 Chrome versions. The spike didn't check the CSS against Chrome 120 |
| axe, WCAG 2.2 AA | Failed until every field had a second label | Passed after one change of ours (section 3.4) |
| Forced colours | Unchecked switch disappears | Every switch stays visible, with its knob showing the state |
| Contrast of base values on our tokens | 5 of 116 checks fail | 2 of 116 fail, both from how `sdt.css` uses one accent |
| Looks like | ArcGIS | GitHub |

## 2. What was built

Everything lives in `docs/design/primer-spike/`. Nothing in `src/` changed.

| File | What it is |
|---|---|
| `scripts/capture.js` | Renders the mockups to `images/` in light, dark and (for frame D) forced colours, and runs axe with the WCAG 2.2 AA tags. It is the Calcite spike's script with Primer's packages mounted in place of Calcite's. |
| `mockups/popup.html` | Popup frames A, C and D, built from Primer's CSS components and Octicons |
| `mockups/services-root.html` | The services root with the status bar, SR badges as Primer Labels, an error row and Details disclosures in a Primer Box |
| `mockups/primer-tokens.css` | The tokens-only variant: Primer Primitives' values on the `--sdt-*` tokens, loaded after `sdt.css` |

| Surface | Accepted design (`docs/design/images/`) | Primer components | Primer tokens on the accepted design |
|---|---|---|---|
| Popup, query page | `after-popup-a.png` | `components-popup-a.png` | `tokens-popup-a.png` |
| Popup, finished with failures | `after-popup-c.png` | `components-popup-c.png` | `tokens-popup-c.png` |
| Popup, problems | `after-popup-d.png` | `components-popup-d.png` | `tokens-popup-d.png` |
| Popup, problems, forced colours | (none) | `components-popup-d-forced.png` | `tokens-popup-d-forced.png` |
| Services root | `after-services-root.png` | `components-services-root.png` | `tokens-services-root.png` |
| Query Helper | `after-query-helper.png` | not built | `tokens-query-helper.png` |

Each has a `-dark` twin, except the forced-colours shots. The Primer images are in `docs/design/primer-spike/images/`.

## 3. Answers

### 3.1 What Primer is now

**Package.** Primer has split into three npm packages, and only one is still developed for plain HTML:

- **`@primer/css` is in maintenance mode.** Its README says the project is in "KTLO" (keep the lights on) mode and points to Primer React or Primer ViewComponents. Version 22.0 (May 2025) moved the component styles out to ViewComponents. What's left is buttons, form controls, utilities, layout and the base reset, without banners, labels, boxes or the toggle switch.
- **`@primer/view-components`** holds the current component CSS. It's a Ruby on Rails component library, and its npm package ships the compiled CSS, one file per component, and the JavaScript behaviours. It doesn't ship the markup, which lives in Rails templates. The spike's mockups rebuild that markup by hand from the class names, so some details differ from GitHub's own output. The banner's icon and text, for one, don't line up as they do on github.com. The package is still at 0.x, with 14 minor releases between April 2025 and July 2026, so any of them may break things.
- **`@primer/primitives`** holds the design tokens as CSS custom properties: colours for 14 themes (light, dark, dimmed, high-contrast and three colour-blind variants), sizes, radii and type. It's actively maintained and has had a major release about twice a year (8.0 to 11.0 between April 2024 and July 2025).

### 3.2 Content scripts

**Package.** Primer's components are CSS classes on ordinary elements, so a content script can build them with `loadElement` in the light DOM, as the design review already plans. Nothing needs the MAIN world. Some behaviours ship as custom elements (for example `toggle-switch` and `x-banner`), and those can't run in the isolated world. The extension would write its own small handlers, which it needs for the accepted design anyway.

Two things make the CSS less safe on a host page than `sdt.css` is:

- **Unprefixed names.** The classes (`.Button`, `.Label`, `.Box`, `.Banner`, `.FormControl`, `.ToggleSwitch`) and the custom properties (`--fgColor-default`, `--base-size-8`) carry no prefix. Content-script CSS applies to the whole page, so a host page with its own `.Label` or `.Button` would pick up Primer's styles. The Services Directory pages modelled in our fixtures use none of these names. Prefixing them would need a build step, and the project has no bundler.
- **Page-wide rules in the full stylesheet.** `primer_view_components.css` includes rules for bare elements, such as `dialog::backdrop` and `body.has-modal`, which would restyle the host page. The per-component files the spike used (toggle switch, banner, text field, button, label, box, counter) contain none, apart from one harmless `summary.Button` rule. The size tokens in `@primer/css/dist/primitives.css` are set on `:root`, the page's root element.

Primer's theme selectors match any element (`[data-color-mode="auto"][data-light-theme="light"]`), so the colour themes can be scoped to the extension's own elements (tested in the services-root mockup). That fits decision 5. `SDT.theme` would set `data-color-mode` to `light` or `dark` on each root.

### 3.3 Visual fit

**Tested** on the stand-in page. Primer makes the additions look like GitHub: rounded pills, green primary buttons and GitHub's grey and blue. It fits the 10.9 and 11.x Services Directory a little better than Calcite did, because its 12px labels and 20 to 24px controls are closer to the page's small type. It still looks like a different product, and nothing about it says ArcGIS.

- **Labels are semantic.** Primer's Label colours are named `danger`, `attention`, `severe`, `success`, `done` and so on. Using red or orange for a spatial reference would break design principle 2, which keeps colour for warnings and errors. Only four Labels carry no warning meaning (accent, success, done, sponsors), which is fewer than decision 8's eight tested colours. The mockup uses those four.
- **Two accents.** Primer uses blue for links and selection and green for the primary button. The accepted design has one accent. Primer's blue (`#0969da`) sits close to the page's link colour, which is the reason decision 7 gave for rejecting a blue accent.

### 3.4 Accessibility

**Tested** with axe (WCAG 2.2 AA tags) in light and dark.

- **Popup:** no violations in either variant.
- **Services root:** the first run failed `target-size` (SC 2.5.8) in two places. Linked Labels at Primer's default size are 20px tall, and so was the Details summary at 12px type, which is our own CSS. Linked Labels now use `Label--large`, which is 24px, and the summary has a 24px minimum height. After that change, both variants pass.
- **Forced colours:** in `components-popup-d-forced.png` every switch keeps its track, and the knob position shows on or off. Calcite lost its unchecked switch in the same test.
- **Switch semantics:** Primer's toggle switch is a button with `aria-pressed`, which screen readers announce as a toggle button. The accepted design uses a checkbox with `role="switch"`. Both pass, but the announcements differ.
- **Contrast:** Primer's values on our tokens fail two of 116 checks, both in dark mode. `sdt.css` uses one accent as text colour and as button fill. Primer keeps them apart: `#4493f8` for text, and `#1f6feb` with white text for fills. White on Primer's dark text accent is 3.10:1. `primer-tokens.css` uses Primer's dark page colour (`#0d1117`) as the text on the accent and Primer's `#79c0ff` as its hover, and then passes all 116.
- **Extra themes:** Primer Primitives ship high-contrast, colour-blind and tritanopia palettes, in light and dark. If the extension ever adds a theme setting (decision 6), those palettes are tested starting points.

### 3.5 Packaging and maintenance

**Package.**

- **Size.** The seven component files the popup needs are 45 KiB. Primer's light and dark themes are 121 KiB each (about 19 KiB gzipped), because they define every token GitHub uses. A trimmed copy would hold only the tokens the components read. Octicons are about 1 KiB per icon as inline SVG. The extension's `src/` is 200 KiB today.
- **Build.** These are plain CSS and SVG files that the manifest or a page would reference directly, so `scripts/lib/extension-files.js` handles them without changes. Each file would need its MIT notice.
- **Upkeep.** ViewComponents is pre-1.0 and changes monthly, and its markup isn't published, so each upgrade means comparing class names by hand. Token values copied into `sdt.css` don't change underneath us.

### 3.6 UX gains

Primer's components bring no feature the accepted design lacks. Small differences seen in the mockups:

- The banner's actions area (frame C) groups "Saved" with Reload page, as Calcite's notice did. The accepted design places them on one row, which reads the same.
- Primer's text field has an inline validation style with an icon, which the accepted design already has.
- The `Box` around search results gives each result a bordered row. The accepted design separates results with spacing alone.

## 4. Effect on the design review's decisions

Under the recommendation nothing changes. If the owner takes the tokens route, decision 7 reopens with Primer's blue and greys. Decision 8 keeps the eight SR colours from `sdt.css`, because Primer has no neutral palette to replace them. If the owner takes Octicons, the icons in `sdt.css` (the `i-*` symbols in the mockups) are swapped for their Octicon equivalents in Phase 5 (#13).

## 5. How to reproduce

```sh
npm install --prefix /some/folder --ignore-scripts @primer/css @primer/primitives @primer/view-components @primer/octicons axe-core
PRIMER_PATH=/some/folder/node_modules/@primer AXE_PATH=/some/folder/node_modules/axe-core/axe.min.js \
  node docs/design/primer-spike/scripts/capture.js
node docs/design/scripts/check-contrast.js --tokens docs/design/primer-spike/mockups/primer-tokens.css
```

Set `CHROME_PATH` to run the capture in another Chromium build.
