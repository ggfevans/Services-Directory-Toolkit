# Phase 4: Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define every setting once and make saving safe: one schema, `SDT.settings`, that every reader goes through and that validates what is stored; the saved web map in `storage.local`, empty by default; an options page that validates each field, shows errors inline, writes only what changed, checks Chrome's sync quotas first, and says "Saved" only after the write succeeds; and a lint rule that keeps defaults out of every other file.

**Architecture:**
- A new lib file, `src/src/lib/settings.js` (`SDT.settings`), holds the schema, a frozen array of `{ key, type, default, values, aliases, min, max, label, area }` entries, and the functions that read and check values: `validate`, `isValid`, `parse`, `defaults`, `readStored` and `read`. Every `content_scripts` group and both extension pages load it, after the other lib files.
- A second new lib file, `src/src/lib/writer.js` (`SDT.writer`), saves settings: it works out which keys to write, checks Chrome's sync quotas, writes `storage.local` then `storage.sync`, and undoes the local write if the sync write fails. Only the options page loads it (and, from Phase 9, the popup). No content-script group does, and a unit test keeps it that way, because content scripts never write to `chrome.storage` (spec section 4.4).
- `inject.js`, `queryTest.js`, `mapImages.js` and `printTask.js` read their settings with `await SDT.settings.read([...])`. Like `SDT.net.fetchJson`, `read` never settles in a script that an extension update has cut off. `inject.js` keeps field and coded-value counts on two constants until Phase 5 (#45, with #17).
- The options page stays static HTML. Each control's `name` is its schema key, and a unit test parses `options.html` and checks the controls against the schema. `options.js` reads with `SDT.settings.read`, validates with `SDT.settings.parse` and saves with `SDT.writer.save`.
- ESLint bans any `chrome.storage.*.get` in content scripts, and a defaults object passed to `chrome.storage.*.get` anywhere outside `src/src/lib/`.

**Tech stack:** Node 24 (`^22.13.0 || >=24`), `node --test` with `node:vm`, `@playwright/test` 1.64.0, `@axe-core/playwright` 4.14.0, ESLint 10. No new dependencies.

**Specs:**
- `docs/superpowers/specs/2026-10-09-store-readiness-design.md`: section 3 ("Stored defaults in pages"), section 4 (definition of done), section 5 (shared code), "Phase 4: Settings", and Appendix A.
- `docs/design/2026-10-ui-design-review.md`: sections 2.9, 6.2 and 6.10 (labels), decision 2, and 10.12 and 10.13 (#24 and #25 build on this phase's schema and writer).
- Issue #33 (this phase).

Read the specs, `CLAUDE.md`, and the comments at the top of `tests/e2e/fixtures.js` and `tests/unit/helpers/sdt.js` before starting.

**Branch:** a new branch from `main` once Phase 3 (#32, pull request #62) has merged. One pull request against `main`, and this plan file is its first commit. The plan was written on top of Phase 3's branch, which changes the same files (`options.html`, `manifest.json` and `page_action.html`), and its line numbers and test counts assume Phase 3's code.

**One part, not two.** The phase is M-size and its tasks depend on each other in a line: the writer needs the schema, the options page needs the writer, and the lint rule can only land once the options page no longer passes inline defaults. A split would leave half of the page's behaviour, or the lint rule, for a second pull request with nothing new to review on its own.

## Decisions

The owner made these on 2026-10-21.

1. **The schema** is a lib file, `src/src/lib/settings.js`, adding `SDT.settings`, a classic script with no top-level declarations. `SDT.settings.schema` is a frozen array of entries `{ key, type, default, values, min, max, label, area }`, with `type` one of `boolean`, `choice`, `integer`, `text` and `json`. Its helpers include `validate(key, raw)`, which returns the value if it is valid and the default if not; `read(keys)`, a promise of validated values that reads `sync` or `local` as each entry's `area` says; and `defaults()`. Content scripts and the options page load it before their own scripts (the popup loads it too, for Phase 9), after the existing lib files. Content scripts read settings only through `SDT.settings`. Lint bans an inline default object in `storage.sync.get` and `storage.local.get` outside `src/src/lib/`, with lint-rules test cases.
2. **Limits.** The web map is empty, or a JSON object (not an array or another value) of at most 100 KB: 102,400 bytes of UTF-8. Preview width and height are whole numbers from 50 to 2000 px. Their defaults stay 300 × 200, and their labels are "Preview image width (px)" and "Preview image height (px)" (IMG-4).
3. **Wording.**
   - A number: "Enter a whole number from 50 to 2000."
   - The web map: "Enter valid JSON for a web map object, or leave it empty." and "This web map is 140 KB. The limit is 100 KB." (its real size, rounded up to whole KB).
   - A failed save: "Not saved: <Chrome's error message>. Nothing was changed."
   - An invalid form: "Not saved. Fix the 2 fields marked below.", or "Not saved. Fix the field marked below." for one field.
   - Success: "Saved. Changes apply when you reload a page."
   - Each error sits under its field, linked by `aria-describedby`, and the field gets `aria-invalid="true"`. The save result goes in a `role="status"` live region. A static note on the page says changes apply when a page is reloaded (SET-11).
4. **Saving.** On Save, the page reads both storage areas again and writes only keys whose new value differs from what is stored. It checks each sync item against `chrome.storage.sync.QUOTA_BYTES_PER_ITEM` (the key plus the value as JSON, as Chrome counts it) and the area's total against `QUOTA_BYTES`; if either check fails, it shows the error and writes nothing. It awaits each write, reports Chrome's error, and says "Saved" only after success. The plan settles the exact rule and the order of the two writes (below).

5. **Plan points the owner confirmed (2026-10-21).** After reading this plan, the owner accepted three of the points below as written: which keys a save writes (changed on this page, or stored invalid, and different from what's stored), the write order (local, then sync, with an undo of local if sync fails), and the wording this plan adds (the two quota messages, "No changes to save." and "Choose one of the options.", with no length limit on the where clause beyond the per-item quota).

This plan also settles points the specs and the owner left open. The owner can overrule any of them in review (see "Open points"):

- **Which keys a save writes.** A key is written when both are true:
  1. its new value differs from the value stored now (a key missing from storage counts as holding its default), and
  2. the user changed it on this page (the new value differs from the one the page loaded) or the stored value is invalid.

  Diffing against storage alone would overwrite a setting that another window changed after this page loaded, though the user never touched it here. Diffing against what the page loaded alone would leave an invalid stored value, such as `"nothing"`, in place, and would write a value that another window had already saved. The two conditions together write what the user changed, repair what is invalid, and leave everything else as it is. When the user and another window both changed a key, the user's value wins, since they pressed Save last. A missing key counts as valid, so a fresh profile writes nothing until the user changes something. After a successful save the page reads storage again and shows it, so a change made in another window to a key left alone here appears too. `SDT.writer.changes` holds the rule, and `tests/unit/writer.test.js` has a case for each branch.
- **The order of the writes: local, then sync, and an undo.** Chrome writes each area with its own call, so two writes can't be one transaction. `storage.local` goes first. Its one key, the web map, is capped at 100 KB against local's 10 MB quota, so it fails only on a disk error. `storage.sync` goes second, because it is the call that hits quotas: per item, in total, and 120 writes a minute. If the sync write fails, the writer puts the local values back (setting the old values, removing keys that were missing), and the page can then honestly say "Nothing was changed." If putting them back fails too, the page says "Not saved: <error>. Only "Saved web map (JSON)" changed." The unit tests cover both paths, and a browser test makes Chrome refuse the sync write for real (below). The quota checks run before either write, so a quota problem writes nothing at all.
- **The quota checks give their own messages.** Chrome 141 reports quota failures with internal names, such as "Resource::kQuotaBytesPerItem quota exceeded" (verified, below), so the writer checks first and the page says what happened. An item over the per-item limit can only be the where clause, so it is a field error: "Too long to sync: this needs 9,020 bytes, and Chrome allows 8,192 per setting." with "Not saved. Fix the field marked below." Going over the total can only happen if something else has filled sync storage, so it is a page error: "Not saved: the synced settings would need 103,132 bytes, and Chrome allows 102,400. Nothing was changed." The where clause gets no length limit of its own: the per-item quota is its limit.
- **Testing a quota-exceeding save honestly.** The browser tests use Chrome's real quotas, not a stubbed `set`:
  - per item: a 9,000-character where clause, which Chrome itself would refuse (8,192 bytes per item);
  - in total: storage seeded with 12 items of 8,006 bytes (96,096 bytes), then a 7,000-character where clause;
  - a write Chrome refuses: the test uses up `MAX_WRITE_OPERATIONS_PER_MINUTE` (120) from the service worker, then saves. Chrome rejects the sync write with "This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota." (verified in Chromium 141 and Chrome for Testing 120). Local writes have no such limit, so this also checks the undo of the local write.
  One test does hold a write back, with `page.addInitScript` replacing `chrome.storage.sync.set` by a promise the test releases, to check that the status stays empty until the write finishes.
- **`aliases`.** The spec says a stored `nothing` reads as `donothing`, but the default for `queryHelperSelectAll` is `get`, so falling back to the default would turn `nothing` into `get`. The `choice` entry gets an `aliases` map, `{ nothing: "donothing" }`, read with `Object.hasOwn` so a key such as `__proto__` can't match. This is a reading rule, not a migration: nothing is rewritten until the user saves, which then repairs it under the rule above. Every entry has all nine fields, with `null` where one doesn't apply, so code can read `entry.min` without checking first.
- **`parse`** turns what the user typed into `{ value }` or `{ error }`, with the Decision 3 messages. It lives in the lib, so the popup's switches (Phase 9) use the same checks. A number must be digits only (`/^\d+$/` after trimming), so `12.5`, `1e3` and `-60` are refused. A web map that is only white space saves as empty.
- **The writer is its own lib file.** The spec puts the schema in `src/src/lib/`. Putting the writer there as a separate file, `writer.js`, keeps code that writes storage out of the content scripts' world: no content-script group lists it, and `tests/unit/manifest.test.js` checks that. Phase 9's switches call `SDT.writer.save` with one key; `changes` looks only at the keys it is given.
- **`read` in a cut-off script never settles**, like `SDT.net.fetchJson`. If Chrome throws or rejects with "Extension context invalidated", or the context goes while the read is out, it returns a promise that never settles, so no code after its `await` runs. Any other storage error rejects. Content scripts call it inside functions that `SDT.guard` already runs.
- **Content scripts read the stored where clause and web map as today**, and fill them into an empty field. Phase 7 (#47, with #20) replaces the where clause with an Insert default button and Phase 8 (#48, with #22) the web map with Insert saved web map (spec section 3). This phase changes where the web map comes from (`storage.local`) and what can come out (a JSON object of at most 100 KB, or nothing), so a fresh profile fills nothing (PRT-3 moot).
- **Map preview sizes** keep reaching the panel's style string and the export URL as today, but they are now whole numbers from 50 to 2000, so a stored value can't inject CSS or URL text (SEC-3, this phase's part). Phase 6 (#46) sets them through style properties and clamps them to the service's limits.
- **`inject.js` order.** Field and domain counts start before the metadata requests, as they did when the settings arrived in a storage callback, so the limiter sees requests in the same order.
- **Lint bans every storage read in content scripts**, not only inline defaults: they read through `SDT.settings.read`, which validates. Outside `src/src/lib/`, the options page, the popup and the service worker may call `chrome.storage.*.get` with a key list, but not with a defaults object.
- **The options page's labels** come from the design review's table in section 6.10, so the schema's labels are final for #24 and #25. One differs: "Show map previews on hover", not "on hover and focus", because previews don't open on focus until Phase 6, which updates the label. Other changes to the page, all small:
  - `lang="en"`, a `<meta charset>`, an `<h1>`, and the SET-11 note.
  - Every control has a `<label for>`.
  - The Select All radios get their own fieldset, whose legend is the schema label "Quick queries that fill and run the form".
  - The feature-count warning moves out of the checkbox label into a hint tied by `aria-describedby`.
  - The field and domain count checkboxes go.
  - The form has `novalidate`, so the browser's own validation bubbles don't take over from the inline errors. The number inputs keep `min`, `max` and `step`.
  - The Extensionizr comment in `options.js` ("Use default value color = "red"...") goes with the rewrite (SET-10, this phase's part).
- **Focus moves to the first invalid field** after a failed save. #25 asks for it, and the keyboard test needs it.
- **Nothing to save.** A save with no changes writes nothing and says "No changes to save.", not "Saved".
- **Dark mode.** The options page doesn't change in the dark scheme until Phase 5's shared style and #25, like the popup after Phase 3. The axe runs in both schemes still apply, and pass.

## Facts verified for this plan (2026-10-21)

In Chromium 141.0.7390.37 (the local Playwright build), from the options page of the unpacked extension in a signed-out profile, and where noted in Chrome for Testing 120.0.6099.109 (from `storage.googleapis.com/chrome-for-testing-public`):

- **Constants.** `chrome.storage.sync.QUOTA_BYTES` 102,400, `QUOTA_BYTES_PER_ITEM` 8,192, `MAX_ITEMS` 512, `MAX_WRITE_OPERATIONS_PER_MINUTE` 120, `MAX_WRITE_OPERATIONS_PER_HOUR` 1,800. `chrome.storage.local.QUOTA_BYTES` 10,485,760. A 200,000-character local item saves.
- **How the per-item quota counts.** The key's length plus the value's `JSON.stringify`, in UTF-8 bytes. For `defaultWhereClause` (18 characters):
  - 8,172 `a`s save and 8,173 fail;
  - 4,086 `é`s (two bytes each) save and 4,087 fail;
  - 4,086 `"`s (each escaped as `\"`) save and 4,087 fail.
  `getBytesInUse` agrees: `autoMetadata: true` is 16 bytes, `mapImageWidth: 300` is 16, and twelve 8,000-character items with six-character keys are 96,096.
- **A `set` with several items is all or nothing.** `set({ autoMetadata: false, defaultWhereClause: <9,000 a's> })` fails and stores neither.
- **Error messages.** Chromium 141 rejects with "Resource::kQuotaBytesPerItem quota exceeded" and "Resource::kQuotaBytes quota exceeded". The 121st write in a minute rejects with "This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota." (with a full stop, which the page drops before adding its own), in Chromium 141 and in Chrome for Testing 120. In Chromium 141 a callback-style `set` sees the same text in `chrome.runtime.lastError`, and local writes still succeed then.
- **Test hooks.** `page.addInitScript` can replace `chrome.storage.sync.set` and `local.set` on an extension page before the page's scripts run.
- **This plan's code**, applied to a scratch copy of Phase 3's branch:
  - lint is clean, and 295 unit tests pass;
  - the browser suite without `@cdp` passes, 122 tests with the known bugs as expected failures, against the unzipped build in Chromium 141 and against `src/` in Chrome for Testing 120;
  - `SHOW_KNOWN_BUGS=1` fails each of the six remaining known bugs on the same line as before;
  - each task's new tests fail before its change, except the ones each task lists as already passing, which pin behaviour the task keeps.
  - One run of `options.spec.js` timed out in the `serviceWorker` fixture, before the test body started; three more runs of the file passed 90 of 90.

## Global Constraints

- **Environment.** The local Playwright browser isn't the pinned one. Run browser tests with:

  ```bash
  CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test --grep-invert @cdp
  ```

  Chromium 141 has no `Extensions.triggerAction`, so the four `@cdp` tests run only in CI. Nothing in this plan changes what they use. Don't run `playwright install`. The other checks are `npm run lint`, `npm run test:unit` and `node scripts/build.js`.
- **No dependencies change.** `package.json` and `package-lock.json` stay as they are.
- **No HTML strings** under `src/`. Build DOM with `SDT.dom.loadElement` and text nodes; the options page sets `textContent`.
- **One isolated world.** Content and popup scripts stay one bare `{ }` block. A content script's top level only declares names and ends with one `SDT.guard.onLoad(...)` or `SDT.guard.run(...)` call. An `await` goes inside a function that `SDT.guard` runs.
- **Lib files** start with `globalThis.SDT ??= {};`, assign one namespace, and declare no top-level names. The build's load-order check reads `SDT.<name>` anywhere in a file, comments included, so a lib file's comments mustn't name a namespace that loads after it (`settings.js` mentions `writer.js` by file name for this reason).
- **Every new file under `src/` must be referenced** in the same commit, or `tests/unit/extension-files.test.js` and the build fail ("not referenced"). Task 2 adds `writer.js` to `options.html` for this reason.
- **Cross-realm values.** Compare values made in a `vm` context with `plain()` or as primitives.
- **ESLint `no-restricted-syntax`:** a later flat-config entry replaces the rule's whole option list for the files it matches, so every entry keeps the lists it has and adds the new one.
- **Content scripts never write to `chrome.storage`** (spec section 4.4), and from Task 5 never read it except through `SDT.settings`.
- **Storage in tests.** Each test gets a fresh profile, so `chrome.storage.sync`'s 120 writes a minute is per test. Seed through the `seedStorage` fixture, which takes an area from Task 3.
- **Test data is synthetic.** Never commit HTML or JSON captured from an Esri server.
- **Known bugs.** SET-1 and SET-3 become normal tests in Task 4. Task 6 re-runs the others with `SHOW_KNOWN_BUGS=1`.
- **Code style:** 2-space indent, double quotes, semicolons, `--max-warnings=0`. If lint flags only formatting in code copied from this plan, run `npx eslint --fix <file>`. Don't change the logic to satisfy it.
- **Commit messages:** imperative subject, plain-English body, ending with the attribution lines your session gives. The examples below leave them out.

## Review Focus

The failure modes most likely to let a broken change pass:

1. **A save that overwrites another window's change, or skips a repair.** Pinned by the ten-case table in `tests/unit/writer.test.js` and by the "another window" and "repairs" browser tests, which read real storage and record every `set` and `remove`.
2. **"Saved" before the write has finished.** Pinned by the held-write test and the refused-write test, which check the status text exactly.
3. **A quota check that counts differently from Chrome.** `SDT.writer.itemBytes` is pinned to numbers read from Chrome (Facts), and the browser quota tests run against Chrome's real limits. If the pre-check were off by a little, Chrome's own refusal would show its internal message, and the tests would fail on the text.
4. **A content script that reads storage directly, or brings back an inline default.** Lint (Task 5) rejects both, and `tests/unit/lint-rules.test.js` checks the rule.
5. **Code that runs after `read` in a cut-off script.** Pinned by the two never-settles unit tests and by `tests/unit/guard-entry-points.test.js`, which runs every group with the context gone.
6. **The options page and the schema drifting apart.** `tests/unit/options-page.test.js` checks names, types, values, ranges, labels and error lines for every key, and fails on any control the schema doesn't know.
7. **The writer reaching a content script.** `tests/unit/manifest.test.js` fails if any group lists `writer.js`.
8. **axe passing on too little.** The options page's axe runs cover the whole document, with and without errors showing.

## Public API

What this phase adds that later phases may use.

### `SDT.settings` (`src/src/lib/settings.js`, every content-script group and both extension pages)

| Member | Returns | Notes |
|---|---|---|
| `schema` | frozen array of frozen entries | `{ key, type, default, values, aliases, min, max, label, area }`. `type` is `boolean`, `choice`, `integer`, `text` or `json`. `values` and `aliases` are for `choice`; `min` and `max` are the range for `integer`, and `max` is the size limit in UTF-8 bytes for `json`. Unused fields are `null`. `area` is `"sync"` or `"local"`. |
| `keys()` | `string[]` | Schema order. |
| `entry(key)` | entry | Throws `Unknown setting: <key>`. |
| `defaults()` | `{ key: default }` | A new object each time. |
| `byteLength(text)` | number | UTF-8 bytes. |
| `jsonProblem(entry, text)` | `null \| { size } \| { syntax: true }` | Empty text is fine. |
| `validate(key, raw)` | value | `raw` if allowed, an alias's value, or the default. |
| `isValid(key, raw)` | boolean | `false` for `undefined`. |
| `parse(key, input)` | `{ value } \| { error }` | `input` is a checkbox's boolean or a control's string. Errors are the Decision 3 messages, plus "Choose one of the options." for a choice. |
| `readStored(keys = all)` | `Promise<{ sync, local }>` | The raw stored values, each area read once, only if a key needs it. |
| `read(keys = all)` | `Promise<{ key: value }>` | Validated. Never settles in a cut-off script; rejects on any other storage error. |

### `SDT.writer` (`src/src/lib/writer.js`, extension pages only)

| Member | Returns | Notes |
|---|---|---|
| `itemBytes(key, value)` | number | What Chrome's sync quota counts for one item. |
| `changes(values, loaded, stored)` | `{ sync, local }` | The keys to write, by the rule in Decisions. Looks only at the keys in `values`. |
| `quotaProblem(items, { inUse, replaced, perItem, total })` | `null \| { key, bytes, limit }` | `key` is `null` when the total is the problem. |
| `message(error)` | string | Chrome's message without its closing full stop. |
| `restore(area, keys, previous)` | `Promise<boolean>` | Puts back previous raw values; removes keys that had none. |
| `save(values, loaded)` | `Promise<{ written } \| { quota } \| { error, changed }>` | `written` lists the keys written, empty when nothing changed. `changed` lists keys left written after a failure, empty unless the undo failed too. |

### The options page (for #25)

Each control's `name` is its schema key and its `id` is the old one (`metadata`, `featurecounts`, `showmapimages`, `mapimagewidth`, `mapimageheight`, `defaultwhereclause`, `qhget`, `qhpost`, `qhnothing`, `defaultwebmapasjson`). A field that can be invalid has an error line with the id `<control id>-error`, named in its `aria-describedby`. The form is `#settings`, the button `#save` (`type="submit"`), and the status line `#status` (`role="status"`).

### Tests

| Where | What |
|---|---|
| `tests/unit/helpers/sdt.js` | `stubArea(items, constants)`, an in-memory storage area with `calls` and `fail.<method>`, and `stubChromeWithStorage({ sync, local })`. `loadLib`'s context gains `TextEncoder`. |
| `tests/e2e/fixtures.js` | `seedStorage(items, area = "sync")` and `readStorage(keys = null, area = "sync")` |
| `tests/e2e/options.spec.js` | `openOptions(page, extensionId)` and `recordWrites(page)`, local to the file |

---

## Task 1: `SDT.settings`: the schema, validation and reading

**Files:**
- Create: `src/src/lib/settings.js`, `tests/unit/settings.test.js`
- Modify: `tests/unit/helpers/sdt.js`, `tests/unit/manifest.test.js` (append), `src/manifest.json`, `src/src/page_action/page_action.html`

**Interfaces:**
- Produces: `SDT.settings` (see Public API), loaded by every content-script group and the popup; `stubArea` and `stubChromeWithStorage` for unit tests.

- [ ] **Step 1: Give the unit-test lib context `TextEncoder` and in-memory storage**

In `tests/unit/helpers/sdt.js`, in `loadLib`, add `TextEncoder,` after `clearTimeout,`. After `stubChrome`, add:

```js
/**
 * A chrome.storage area in memory, with Chrome's promise API and quota constants. items holds what
 * it stores, and calls records each call as [method, argument]. fail.<method>, if set, is called with
 * the call's argument and returns an Error for the call to reject with, or undefined to let it run.
 * getBytesInUse counts each item as Chrome does: the key plus the value as JSON, in UTF-8 bytes.
 */
export const stubArea = (items = {}, constants = {}) => {
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const names = (keys) => (keys === null || keys === undefined ? Object.keys(area.items) : [].concat(keys));
  const call = (method, argument) => {
    area.calls.push([method, copy(argument ?? null)]);
    const error = area.fail[method]?.(argument);
    if (error) {
      throw error;
    }
  };
  const area = {
    ...constants,
    items: copy(items),
    calls: [],
    fail: {},
    async get(keys) {
      call("get", keys);
      return Object.fromEntries(names(keys).filter((key) => Object.hasOwn(area.items, key)).map((key) => [key, copy(area.items[key])]));
    },
    async set(values) {
      call("set", values);
      Object.assign(area.items, copy(values));
    },
    async remove(keys) {
      call("remove", keys);
      [].concat(keys).forEach((key) => delete area.items[key]);
    },
    async getBytesInUse(keys) {
      call("getBytesInUse", keys);
      return names(keys)
        .filter((key) => Object.hasOwn(area.items, key))
        .reduce((sum, key) => sum + Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(area.items[key])), 0);
    }
  };
  return area;
};

/** A chrome object with a runtime id and in-memory sync and local storage areas, holding sync and local. */
export const stubChromeWithStorage = ({ sync = {}, local = {} } = {}) => ({
  ...stubChrome(),
  storage: {
    sync: stubArea(sync, { QUOTA_BYTES: 102400, QUOTA_BYTES_PER_ITEM: 8192 }),
    local: stubArea(local, { QUOTA_BYTES: 10485760 })
  }
});
```

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/settings.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLib, plain, stubChromeWithStorage } from "./helpers/sdt.js";

const { settings } = loadLib().SDT;

const DEFAULTS = {
  autoMetadata: true,
  autoFeatureCounts: true,
  showMapImages: true,
  mapImageWidth: 300,
  mapImageHeight: 200,
  queryHelperSelectAll: "get",
  defaultWhereClause: "",
  defaultWebMapAsJSON: ""
};

// A JSON object whose text is exactly bytes long in UTF-8.
const webMapOf = (bytes) => `{"a":"${"x".repeat(bytes - 8)}"}`;

const withStorage = (stored) => {
  const chrome = stubChromeWithStorage(stored);
  return { chrome, settings: loadLib({ chrome }).SDT.settings };
};

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

test("the schema holds every setting once, without autoFieldCounts and autoDomainCounts", () => {
  assert.deepEqual(plain(settings.keys()), Object.keys(DEFAULTS));
  assert.equal(new Set(settings.keys()).size, settings.schema.length);
  assert.equal(settings.keys().includes("autoFieldCounts"), false);
  assert.equal(settings.keys().includes("autoDomainCounts"), false);
});

test("every entry has the same fields, a known type and area, and a default its own validate keeps", () => {
  for (const entry of settings.schema) {
    assert.deepEqual(Object.keys(entry).sort(), ["aliases", "area", "default", "key", "label", "max", "min", "type", "values"], entry.key);
    assert.ok(["boolean", "choice", "integer", "text", "json"].includes(entry.type), entry.key);
    assert.ok(["sync", "local"].includes(entry.area), entry.key);
    assert.equal(typeof entry.label, "string", entry.key);
    assert.equal(settings.isValid(entry.key, entry.default), true, entry.key);
  }
});

test("the schema can't be changed at run time", () => {
  assert.equal(Object.isFrozen(settings.schema), true);
  for (const entry of settings.schema) {
    assert.equal(Object.isFrozen(entry), true, entry.key);
  }
  assert.equal(Object.isFrozen(settings.entry("queryHelperSelectAll").values), true);
  assert.equal(Object.isFrozen(settings.entry("queryHelperSelectAll").aliases), true);
});

test("the saved web map is the only setting in local storage", () => {
  assert.deepEqual(plain(settings.schema.filter((entry) => entry.area === "local").map((entry) => entry.key)), ["defaultWebMapAsJSON"]);
});

test("map preview sizes are whole numbers from 50 to 2000, with labels in pixels (IMG-4)", () => {
  for (const key of ["mapImageWidth", "mapImageHeight"]) {
    const entry = settings.entry(key);
    assert.deepEqual([entry.type, entry.min, entry.max], ["integer", 50, 2000]);
  }
  assert.equal(settings.entry("mapImageWidth").label, "Preview image width (px)");
  assert.equal(settings.entry("mapImageHeight").label, "Preview image height (px)");
});

test("defaults() returns a new object with every default", () => {
  assert.deepEqual(plain(settings.defaults()), DEFAULTS);
  const first = settings.defaults();
  first.mapImageWidth = 1;
  assert.equal(settings.defaults().mapImageWidth, 300);
});

test("an unknown key is an error", () => {
  assert.throws(() => settings.entry("autoFieldCounts"), /Unknown setting: autoFieldCounts/);
  assert.throws(() => settings.validate("nope", 1), /Unknown setting: nope/);
});

test("validate keeps allowed values and turns anything else into the default", () => {
  const cases = [
    ["autoMetadata", false, false],
    ["autoMetadata", true, true],
    ["autoMetadata", "false", true],
    ["autoMetadata", 0, true],
    ["autoMetadata", undefined, true],
    ["mapImageWidth", 50, 50],
    ["mapImageWidth", 2000, 2000],
    ["mapImageWidth", 640, 640],
    ["mapImageWidth", 49, 300],
    ["mapImageWidth", 2001, 300],
    ["mapImageWidth", 300.5, 300],
    ["mapImageWidth", "640", 300],
    ["mapImageWidth", NaN, 300],
    ["mapImageWidth", null, 300],
    ["mapImageHeight", 0, 200],
    ["queryHelperSelectAll", "get", "get"],
    ["queryHelperSelectAll", "post", "post"],
    ["queryHelperSelectAll", "donothing", "donothing"],
    // SET-1: the removed in-page form stored "nothing".
    ["queryHelperSelectAll", "nothing", "donothing"],
    ["queryHelperSelectAll", "GET", "get"],
    ["queryHelperSelectAll", "toString", "get"],
    ["queryHelperSelectAll", "__proto__", "get"],
    ["queryHelperSelectAll", 1, "get"],
    ["defaultWhereClause", "STATE = 'CA'", "STATE = 'CA'"],
    ["defaultWhereClause", 5, ""],
    ["defaultWebMapAsJSON", "", ""],
    ["defaultWebMapAsJSON", "{}", "{}"],
    ["defaultWebMapAsJSON", "{\"operationalLayers\":[]}", "{\"operationalLayers\":[]}"],
    ["defaultWebMapAsJSON", "[]", ""],
    ["defaultWebMapAsJSON", "null", ""],
    ["defaultWebMapAsJSON", "42", ""],
    ["defaultWebMapAsJSON", "{not json", ""],
    ["defaultWebMapAsJSON", "  ", ""],
    ["defaultWebMapAsJSON", { operationalLayers: [] }, ""],
    ["defaultWebMapAsJSON", webMapOf(102400), webMapOf(102400)],
    ["defaultWebMapAsJSON", webMapOf(102401), ""]
  ];
  for (const [key, raw, expected] of cases) {
    assert.deepEqual(settings.validate(key, raw), expected, `${key}: ${JSON.stringify(raw)}`);
  }
});

test("isValid is false for a missing value and for anything validate would change", () => {
  assert.equal(settings.isValid("autoMetadata", undefined), false);
  assert.equal(settings.isValid("queryHelperSelectAll", "nothing"), false);
  assert.equal(settings.isValid("queryHelperSelectAll", "donothing"), true);
  assert.equal(settings.isValid("mapImageWidth", 2001), false);
});

test("parse reads whole numbers from 50 to 2000 and explains anything else", () => {
  const error = { error: "Enter a whole number from 50 to 2000." };
  const cases = [
    ["300", { value: 300 }],
    [" 75 ", { value: 75 }],
    ["0300", { value: 300 }],
    ["50", { value: 50 }],
    ["2000", { value: 2000 }],
    ["", error],
    ["49", error],
    ["2001", error],
    ["12.5", error],
    ["1e3", error],
    ["-60", error],
    ["abc", error]
  ];
  for (const [input, expected] of cases) {
    assert.deepEqual(plain(settings.parse("mapImageWidth", input)), expected, JSON.stringify(input));
  }
});

test("parse accepts an empty web map or a JSON object of at most 100 KB", () => {
  const syntax = { error: "Enter valid JSON for a web map object, or leave it empty." };
  const cases = [
    ["", { value: "" }],
    ["  \n", { value: "" }],
    ["{\"operationalLayers\":[]}", { value: "{\"operationalLayers\":[]}" }],
    [webMapOf(102400), { value: webMapOf(102400) }],
    ["[]", syntax],
    ["\"text\"", syntax],
    ["null", syntax],
    ["{\"a\":", syntax],
    [webMapOf(102401), { error: "This web map is 101 KB. The limit is 100 KB." }],
    [webMapOf(140 * 1024), { error: "This web map is 140 KB. The limit is 100 KB." }],
    [webMapOf(140 * 1024 - 100), { error: "This web map is 140 KB. The limit is 100 KB." }]
  ];
  for (const [input, expected] of cases) {
    assert.deepEqual(plain(settings.parse("defaultWebMapAsJSON", input)), expected, input.slice(0, 40));
  }
});

test("parse counts a web map's size in UTF-8 bytes", () => {
  // 51,200 two-byte characters are 102,400 bytes, plus 8 for the braces, key and quotes.
  assert.deepEqual(plain(settings.parse("defaultWebMapAsJSON", `{"a":"${"é".repeat(51196)}"}`)), { value: `{"a":"${"é".repeat(51196)}"}` });
  assert.match(settings.parse("defaultWebMapAsJSON", `{"a":"${"é".repeat(51197)}"}`).error, /^This web map is 101 KB\./);
});

test("parse takes checkbox, radio and text values as they are", () => {
  assert.deepEqual(plain(settings.parse("autoMetadata", false)), { value: false });
  assert.deepEqual(plain(settings.parse("queryHelperSelectAll", "post")), { value: "post" });
  assert.deepEqual(plain(settings.parse("queryHelperSelectAll", "")), { error: "Choose one of the options." });
  assert.deepEqual(plain(settings.parse("defaultWhereClause", " 1=1 ")), { value: " 1=1 " });
});

test("read returns the defaults from empty storage", async () => {
  const { settings: lib } = withStorage({});
  assert.deepEqual(plain(await lib.read()), DEFAULTS);
});

test("read reads each key from its own area and validates it", async () => {
  const { chrome, settings: lib } = withStorage({
    sync: { autoMetadata: false, mapImageWidth: 5000, queryHelperSelectAll: "nothing", defaultWebMapAsJSON: "{\"in\":\"sync\"}" },
    local: { defaultWebMapAsJSON: "{\"in\":\"local\"}", autoMetadata: true }
  });
  assert.deepEqual(plain(await lib.read()), {
    ...DEFAULTS,
    autoMetadata: false,
    queryHelperSelectAll: "donothing",
    defaultWebMapAsJSON: "{\"in\":\"local\"}"
  });
  assert.deepEqual(chrome.storage.sync.calls, [["get", Object.keys(DEFAULTS).filter((key) => key !== "defaultWebMapAsJSON")]]);
  assert.deepEqual(chrome.storage.local.calls, [["get", ["defaultWebMapAsJSON"]]]);
});

test("read with keys reads only those keys, and only the areas they are in", async () => {
  const { chrome, settings: lib } = withStorage({ sync: { showMapImages: false } });
  assert.deepEqual(plain(await lib.read(["showMapImages", "mapImageHeight"])), { showMapImages: false, mapImageHeight: 200 });
  assert.deepEqual(chrome.storage.sync.calls, [["get", ["showMapImages", "mapImageHeight"]]]);
  assert.deepEqual(chrome.storage.local.calls, []);
});

test("readStored returns the raw values, by area", async () => {
  const { settings: lib } = withStorage({ sync: { queryHelperSelectAll: "nothing", other: 1 }, local: { defaultWebMapAsJSON: "[]" } });
  assert.deepEqual(plain(await lib.readStored(["queryHelperSelectAll", "defaultWebMapAsJSON", "autoMetadata"])), {
    sync: { queryHelperSelectAll: "nothing" },
    local: { defaultWebMapAsJSON: "[]" }
  });
});

test("read never settles when the extension context goes while it reads", async () => {
  const { chrome, settings: lib } = withStorage({});
  let answer;
  chrome.storage.sync.get = () => new Promise((resolve) => {
    answer = resolve;
  });
  let settled = false;
  lib.read(["autoMetadata"]).then(() => {
    settled = true;
  }, () => {
    settled = true;
  });
  await tick(0);
  chrome.runtime.id = undefined;
  answer({ autoMetadata: false });
  await tick();
  assert.equal(settled, false);
});

test("read never settles when storage throws Chrome's invalidation error", async () => {
  const { chrome, settings: lib } = withStorage({});
  chrome.storage.sync.fail.get = () => new Error("Extension context invalidated.");
  let settled = false;
  lib.read(["autoMetadata"]).then(() => {
    settled = true;
  }, () => {
    settled = true;
  });
  await tick();
  assert.equal(settled, false);
});

test("read rejects with any other storage error", async () => {
  const { chrome, settings: lib } = withStorage({});
  chrome.storage.local.fail.get = () => new Error("IO error");
  await assert.rejects(lib.read(["defaultWebMapAsJSON"]), /IO error/);
});
```

Append to `tests/unit/manifest.test.js`:

```js
test("every content-script group loads the settings schema, and none loads the writer (spec section 4.4)", () => {
  for (const [index, group] of manifest.content_scripts.entries()) {
    if (group.js) {
      assert.ok(group.js.includes("src/lib/settings.js"), `group ${index}`);
      assert.equal(group.js.includes("src/lib/writer.js"), false, `group ${index}`);
    }
  }
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `node --test tests/unit/settings.test.js tests/unit/manifest.test.js`
Expected: FAIL, the 20 settings cases ("Cannot read properties of undefined", because `loadLib().SDT.settings` doesn't exist) and the new manifest case. The other manifest cases pass.

- [ ] **Step 4: Write `SDT.settings`**

Create `src/src/lib/settings.js`:

```js
// SDT.settings: every setting the extension stores, defined once (store-readiness spec, Phase 4).
// Readers get validated values: a missing or invalid stored value reads as the default, so no
// caller ever sees a value the schema doesn't allow (spec section 4.4). Content scripts, the options
// page and the popup load this file. src/src/lib/writer.js does the writing, and no content script
// loads it.
globalThis.SDT ??= {};

SDT.settings = {
  /**
   * One entry per setting: key, type ("boolean", "choice", "integer", "text" or "json"), default,
   * values (choice), aliases (choice: old stored values and what they read as), min and max (integer:
   * the range; json: max is the size limit in UTF-8 bytes), label (the words the options page and the
   * popup show), and area (the chrome.storage area: "sync" or "local").
   */
  schema: Object.freeze([
    { key: "autoMetadata", type: "boolean", default: true, label: "Load service details and spatial references", area: "sync" },
    { key: "autoFeatureCounts", type: "boolean", default: true, label: "Count features in each layer", area: "sync" },
    { key: "showMapImages", type: "boolean", default: true, label: "Show map previews on hover", area: "sync" },
    { key: "mapImageWidth", type: "integer", default: 300, min: 50, max: 2000, label: "Preview image width (px)", area: "sync" },
    { key: "mapImageHeight", type: "integer", default: 200, min: 50, max: 2000, label: "Preview image height (px)", area: "sync" },
    {
      key: "queryHelperSelectAll",
      type: "choice",
      default: "get",
      values: ["get", "post", "donothing"],
      // The in-page form, removed in Phase 3, stored "nothing" (SET-1).
      aliases: { nothing: "donothing" },
      label: "Quick queries that fill and run the form",
      area: "sync"
    },
    { key: "defaultWhereClause", type: "text", default: "", label: "Default where clause", area: "sync" },
    // Print web maps often hold internal URLs or tokens, so this one stays on this computer (spec section 3).
    { key: "defaultWebMapAsJSON", type: "json", default: "", max: 102400, label: "Saved web map (JSON)", area: "local" }
  ].map((entry) => Object.freeze({
    values: null,
    aliases: null,
    min: null,
    max: null,
    ...entry,
    ...(entry.values && { values: Object.freeze(entry.values) }),
    ...(entry.aliases && { aliases: Object.freeze(entry.aliases) })
  }))),

  /** Every key, in schema order. */
  keys() {
    return SDT.settings.schema.map((entry) => entry.key);
  },

  /** The schema entry for key. Throws for a key the schema doesn't have. */
  entry(key) {
    const found = SDT.settings.schema.find((entry) => entry.key === key);
    if (!found) {
      throw new Error(`Unknown setting: ${key}`);
    }
    return found;
  },

  /** A new object with every key and its default. */
  defaults() {
    return Object.fromEntries(SDT.settings.schema.map((entry) => [entry.key, entry.default]));
  },

  /** The length of text in UTF-8 bytes, the way Chrome's storage quotas count it. */
  byteLength(text) {
    return new TextEncoder().encode(text).length;
  },

  /**
   * What is wrong with text as the value of a json entry: { size: bytes } when it is over entry.max,
   * { syntax: true } when it isn't a JSON object, or null. Empty text is fine.
   */
  jsonProblem(entry, text) {
    if (text === "") {
      return null;
    }
    const bytes = SDT.settings.byteLength(text);
    if (bytes > entry.max) {
      return { size: bytes };
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { syntax: true };
    }
    return data && typeof data === "object" && !Array.isArray(data) ? null : { syntax: true };
  },

  /** raw as a stored value of key: raw if the schema allows it, an alias's value, or the default. */
  validate(key, raw) {
    const entry = SDT.settings.entry(key);
    switch (entry.type) {
      case "boolean":
        return typeof raw === "boolean" ? raw : entry.default;
      case "integer":
        return Number.isInteger(raw) && raw >= entry.min && raw <= entry.max ? raw : entry.default;
      case "choice":
        if (entry.values.includes(raw)) {
          return raw;
        }
        return typeof raw === "string" && entry.aliases && Object.hasOwn(entry.aliases, raw) ? entry.aliases[raw] : entry.default;
      case "text":
        return typeof raw === "string" ? raw : entry.default;
      case "json":
        return typeof raw === "string" && SDT.settings.jsonProblem(entry, raw) === null ? raw : entry.default;
      default:
        return entry.default;
    }
  },

  /** Whether raw is a value the schema allows for key, as stored. A missing value isn't. */
  isValid(key, raw) {
    return raw !== undefined && SDT.settings.validate(key, raw) === raw;
  },

  /**
   * Reads what the user entered in key's control: a boolean for a checkbox, a string otherwise.
   * Returns { value } with the value to store, or { error } with the message to show under the field.
   */
  parse(key, input) {
    const entry = SDT.settings.entry(key);
    if (entry.type === "integer") {
      const text = String(input).trim();
      const value = /^\d+$/.test(text) ? Number(text) : NaN;
      return value >= entry.min && value <= entry.max
        ? { value }
        : { error: `Enter a whole number from ${entry.min} to ${entry.max}.` };
    }
    if (entry.type === "json") {
      const text = String(input).trim() === "" ? "" : String(input);
      const problem = SDT.settings.jsonProblem(entry, text);
      if (problem?.size) {
        return { error: `This web map is ${Math.ceil(problem.size / 1024)} KB. The limit is ${entry.max / 1024} KB.` };
      }
      return problem ? { error: "Enter valid JSON for a web map object, or leave it empty." } : { value: text };
    }
    return SDT.settings.isValid(key, input) ? { value: input } : { error: "Choose one of the options." };
  },

  /** The raw stored values of keys, as { sync: {...}, local: {...} }, each read from its own area. */
  async readStored(keys = SDT.settings.keys()) {
    const stored = { sync: {}, local: {} };
    const byArea = { sync: [], local: [] };
    keys.forEach((key) => byArea[SDT.settings.entry(key).area].push(key));
    await Promise.all(Object.entries(byArea)
      .filter(([, names]) => names.length)
      .map(async ([area, names]) => {
        stored[area] = await chrome.storage[area].get(names);
      }));
    return stored;
  },

  /**
   * Resolves to { key: value } for keys (every key by default), each validated. Like fetchJson in
   * net.js, it never settles once an extension update has cut the script off, so no code that
   * awaits it runs in a cut-off content script. Rejects only on another storage error.
   */
  async read(keys = SDT.settings.keys()) {
    let stored;
    try {
      stored = await SDT.settings.readStored(keys);
    } catch (error) {
      if (!SDT.guard.alive() || SDT.guard.isInvalidated(error)) {
        return new Promise(() => {});
      }
      throw error;
    }
    if (!SDT.guard.alive()) {
      return new Promise(() => {});
    }
    return Object.fromEntries(keys.map((key) => [key, SDT.settings.validate(key, stored[SDT.settings.entry(key).area][key])]));
  }
};
```

- [ ] **Step 5: Load it in every content-script group and in the popup**

In `src/manifest.json`, in each of the three `content_scripts` groups with `js`, add `"src/lib/settings.js",` after `"src/lib/page.js",`. In `src/src/page_action/page_action.html`, add `<script src="../lib/settings.js"></script>` after the `page.js` script tag, indented with a tab like its neighbours. The popup doesn't use it until Phase 9, but `tests/unit/manifest.test.js` requires the popup to load the content scripts' lib files in their order.

- [ ] **Step 6: Run the checks**

Run: `npm run lint && npm run test:unit && node scripts/build.js`
Expected: lint clean; 266 unit tests pass (245 before, plus 20 and 1), including `guard-entry-points.test.js`, which now runs `settings.js` in every group with the context gone; the build writes the zip with `src/lib/settings.js`.

- [ ] **Step 7: Commit**

```bash
git add src/src/lib/settings.js src/manifest.json src/src/page_action/page_action.html tests/unit/settings.test.js tests/unit/manifest.test.js tests/unit/helpers/sdt.js
git commit -F - <<'EOF'
Define every setting once, in SDT.settings

The schema holds each setting's key, type, default, allowed values or range, label and storage
area. validate turns anything the schema doesn't allow into the default, and reads the old
"nothing" as "donothing" (SET-1). read validates what it reads and, like fetchJson, never settles
in a script an update has cut off. The web map moves to storage.local and starts empty. Every
content-script group and the popup load the file.
EOF
```

---

## Task 2: `SDT.writer`: write only what changed, within Chrome's quotas

**Files:**
- Create: `src/src/lib/writer.js`, `tests/unit/writer.test.js`
- Modify: `src/src/options/options.html` (script tags only), `tests/unit/manifest.test.js` (append)

**Interfaces:**
- Consumes: `SDT.settings` (Task 1).
- Produces: `SDT.writer` (see Public API), loaded by the options page only.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/writer.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { LIB_FILES, loadLib, plain, stubChromeWithStorage } from "./helpers/sdt.js";

const FILES = [...LIB_FILES, "src/lib/writer.js"];

const setup = (stored = {}) => {
  const chrome = stubChromeWithStorage(stored);
  const { SDT } = loadLib({ chrome, files: FILES });
  return { chrome, settings: SDT.settings, writer: SDT.writer };
};

const { settings, writer } = setup();
const DEFAULTS = plain(settings.defaults());
const QUOTA = { inUse: 0, replaced: 0, perItem: 8192, total: 102400 };

// What the stub areas were asked to write or remove, in order.
const writes = (chrome) => ["local", "sync"].flatMap((area) => chrome.storage[area].calls
  .filter(([method]) => method === "set" || method === "remove")
  .map(([method, argument]) => `${area}.${method} ${JSON.stringify(argument)}`));

test("itemBytes counts the key plus the value as JSON, in UTF-8, as Chrome does", () => {
  // Each figure was read from Chrome 141's chrome.storage.sync.getBytesInUse.
  assert.equal(writer.itemBytes("autoMetadata", true), 16);
  assert.equal(writer.itemBytes("mapImageWidth", 300), 16);
  assert.equal(writer.itemBytes("defaultWhereClause", "a".repeat(8172)), 8192);
  assert.equal(writer.itemBytes("defaultWhereClause", "é".repeat(4086)), 8192);
  assert.equal(writer.itemBytes("defaultWhereClause", "\"".repeat(4086)), 8192);
});

test("changes: what to write, given the form, what the page loaded and what is stored now", () => {
  const cases = [
    // [what, values, loaded, stored sync, expected sync]
    ["nothing changed", {}, {}, {}, {}],
    ["the user changed a key", { mapImageWidth: 640 }, {}, {}, { mapImageWidth: 640 }],
    ["the user changed a stored key", { mapImageWidth: 640 }, { mapImageWidth: 500 }, { mapImageWidth: 500 }, { mapImageWidth: 640 }],
    ["the user changed a key back to what is stored", { mapImageWidth: 500 }, { mapImageWidth: 640 }, { mapImageWidth: 500 }, {}],
    ["another window changed a key the user left alone", {}, {}, { showMapImages: false }, {}],
    ["another window made the change the user made", { showMapImages: false }, {}, { showMapImages: false }, {}],
    ["another window changed a key, then the user changed it too", { mapImageWidth: 800 }, {}, { mapImageWidth: 640 }, { mapImageWidth: 800 }],
    ["an invalid stored value the user left alone is repaired", { queryHelperSelectAll: "donothing" }, { queryHelperSelectAll: "donothing" }, { queryHelperSelectAll: "nothing" }, { queryHelperSelectAll: "donothing" }],
    ["an out-of-range stored number is repaired", {}, {}, { mapImageWidth: 5000 }, { mapImageWidth: 300 }],
    ["a missing key the user left alone stays missing", {}, {}, {}, {}]
  ];
  for (const [what, changed, loadedChanges, storedSync, expected] of cases) {
    const values = { ...DEFAULTS, ...changed };
    const loaded = { ...DEFAULTS, ...loadedChanges };
    assert.deepEqual(plain(writer.changes(values, loaded, { sync: storedSync, local: {} })), { sync: expected, local: {} }, what);
  }
});

test("changes puts the saved web map in local storage", () => {
  const values = { ...DEFAULTS, defaultWebMapAsJSON: "{}" };
  assert.deepEqual(plain(writer.changes(values, DEFAULTS, { sync: {}, local: {} })), { sync: {}, local: { defaultWebMapAsJSON: "{}" } });
});

test("changes looks only at the keys it is given", () => {
  assert.deepEqual(plain(writer.changes({ showMapImages: false }, { showMapImages: true }, { sync: { queryHelperSelectAll: "nothing" }, local: {} })), {
    sync: { showMapImages: false },
    local: {}
  });
});

test("quotaProblem finds an item over the per-item quota", () => {
  assert.deepEqual(plain(writer.quotaProblem({ mapImageWidth: 640, defaultWhereClause: "a".repeat(9000) }, QUOTA)), {
    key: "defaultWhereClause",
    bytes: 9020,
    limit: 8192
  });
  assert.equal(writer.quotaProblem({ defaultWhereClause: "a".repeat(8172) }, QUOTA), null);
});

test("quotaProblem finds a write that would take the area over its total quota", () => {
  const nearlyFull = { ...QUOTA, inUse: 96096 + 16, replaced: 16 };
  assert.deepEqual(plain(writer.quotaProblem({ defaultWhereClause: "a".repeat(6285) }, nearlyFull)), { key: null, bytes: 102401, limit: 102400 });
  assert.equal(writer.quotaProblem({ defaultWhereClause: "a".repeat(6284) }, nearlyFull), null);
});

test("message drops the full stop at the end of Chrome's message", () => {
  assert.equal(writer.message(new Error("This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota.")), "This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota");
  assert.equal(writer.message(new Error("Resource::kQuotaBytes quota exceeded")), "Resource::kQuotaBytes quota exceeded");
});

test("save writes only the keys that changed, local first", async () => {
  const { chrome, writer: lib } = setup({ sync: { autoMetadata: false }, local: {} });
  const loaded = { ...DEFAULTS, autoMetadata: false };
  const result = await lib.save({ ...loaded, mapImageWidth: 640, defaultWebMapAsJSON: "{}" }, loaded);
  assert.deepEqual(plain(result), { written: ["defaultWebMapAsJSON", "mapImageWidth"] });
  assert.deepEqual(writes(chrome), ["local.set {\"defaultWebMapAsJSON\":\"{}\"}", "sync.set {\"mapImageWidth\":640}"]);
  assert.deepEqual(chrome.storage.sync.items, { autoMetadata: false, mapImageWidth: 640 });
});

test("save writes nothing when nothing changed", async () => {
  const { chrome, writer: lib } = setup();
  assert.deepEqual(plain(await lib.save(DEFAULTS, DEFAULTS)), { written: [] });
  assert.deepEqual(writes(chrome), []);
});

test("save writes nothing when an item is over the per-item quota", async () => {
  const { chrome, writer: lib } = setup();
  const result = await lib.save({ ...DEFAULTS, mapImageWidth: 640, defaultWhereClause: "a".repeat(9000), defaultWebMapAsJSON: "{}" }, DEFAULTS);
  assert.deepEqual(plain(result), { quota: { key: "defaultWhereClause", bytes: 9020, limit: 8192 } });
  assert.deepEqual(writes(chrome), []);
});

test("save writes nothing when sync storage would go over its total quota", async () => {
  const junk = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`junk${String(i).padStart(2, "0")}`, "x".repeat(8000)]));
  const { chrome, writer: lib } = setup({ sync: junk });
  const result = await lib.save({ ...DEFAULTS, defaultWhereClause: "a".repeat(7000) }, DEFAULTS);
  assert.deepEqual(plain(result), { quota: { key: null, bytes: 103116, limit: 102400 } });
  assert.deepEqual(writes(chrome), []);
});

test("save reports Chrome's error when the local write fails, and writes nothing to sync", async () => {
  const { chrome, writer: lib } = setup();
  chrome.storage.local.fail.set = () => new Error("IO error.");
  const result = await lib.save({ ...DEFAULTS, mapImageWidth: 640, defaultWebMapAsJSON: "{}" }, DEFAULTS);
  assert.deepEqual(plain(result), { error: "IO error", changed: [] });
  assert.deepEqual(writes(chrome), ["local.set {\"defaultWebMapAsJSON\":\"{}\"}"]);
  assert.deepEqual(chrome.storage.sync.items, {});
});

test("when the sync write fails, save undoes the local write", async () => {
  const quota = new Error("This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota.");
  for (const local of [{}, { defaultWebMapAsJSON: "{\"old\":1}" }]) {
    const { chrome, writer: lib } = setup({ local });
    chrome.storage.sync.fail.set = () => quota;
    const loaded = { ...DEFAULTS, ...local };
    const result = await lib.save({ ...loaded, mapImageWidth: 640, defaultWebMapAsJSON: "{}" }, loaded);
    assert.deepEqual(plain(result), { error: "This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota", changed: [] });
    assert.deepEqual(chrome.storage.local.items, local);
    assert.deepEqual(chrome.storage.sync.items, {});
  }
});

test("when the sync write fails and undoing the local write fails too, save says which keys changed", async () => {
  const { chrome, writer: lib } = setup();
  chrome.storage.sync.fail.set = () => new Error("Resource::kQuotaBytes quota exceeded");
  chrome.storage.local.fail.remove = () => new Error("IO error");
  const result = await lib.save({ ...DEFAULTS, mapImageWidth: 640, defaultWebMapAsJSON: "{}" }, DEFAULTS);
  assert.deepEqual(plain(result), { error: "Resource::kQuotaBytes quota exceeded", changed: ["defaultWebMapAsJSON"] });
  assert.deepEqual(chrome.storage.local.items, { defaultWebMapAsJSON: "{}" });
});
```

Append to `tests/unit/manifest.test.js`:

```js
test("the options page loads the guard, the settings schema and the writer before its own script", () => {
  const page = readFileSync(join(ROOT, "src/src/options/options.html"), "utf8");
  const scripts = [...page.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(([, src]) => src);
  assert.deepEqual(scripts, ["../lib/guard.js", "../lib/settings.js", "../lib/writer.js", "options.js"]);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/unit/writer.test.js tests/unit/manifest.test.js`
Expected: FAIL. `writer.test.js` fails as a file, because `loadLib` can't read `src/lib/writer.js` (ENOENT), and the new manifest case fails: `options.html` loads only `options.js`.

- [ ] **Step 3: Write `SDT.writer`**

Create `src/src/lib/writer.js`:

```js
// SDT.writer: saves settings, for the options page and, from Phase 9, the popup's switches. It writes
// only the keys that changed, checks Chrome's sync quotas before writing anything, and reports
// Chrome's error. No content-script group loads this file: content scripts never write to
// chrome.storage (store-readiness spec, section 4.4).
globalThis.SDT ??= {};

SDT.writer = {
  /** The bytes Chrome's sync quota counts for one item: the key plus the value as JSON, in UTF-8. */
  itemBytes(key, value) {
    return SDT.settings.byteLength(key) + SDT.settings.byteLength(JSON.stringify(value));
  },

  /**
   * The items to write, as { sync: {...}, local: {...} }. values holds the new, validated values,
   * loaded the values the page showed, and stored the raw values in storage now, from
   * SDT.settings.readStored. A key is written when its new value differs from the stored one (a
   * missing key holds its default) and the user changed it on this page or the stored value is
   * invalid. So a key that another window changed after this page loaded keeps that window's value,
   * unless the user changed it here too, and an invalid stored value is repaired.
   */
  changes(values, loaded, stored) {
    const out = { sync: {}, local: {} };
    for (const [key, value] of Object.entries(values)) {
      const entry = SDT.settings.entry(key);
      const present = Object.hasOwn(stored[entry.area], key);
      const raw = present ? stored[entry.area][key] : entry.default;
      const invalid = present && !SDT.settings.isValid(key, raw);
      if (value !== raw && (value !== loaded[key] || invalid)) {
        out[entry.area][key] = value;
      }
    }
    return out;
  },

  /**
   * Whether writing items to sync storage would break a quota. inUse is the area's bytes in use,
   * replaced the bytes the items' keys use now, and perItem and total Chrome's limits. Returns
   * { key, bytes, limit } for the first item over perItem, { key: null, bytes, limit } when the
   * area would end up over total, or null.
   */
  quotaProblem(items, { inUse, replaced, perItem, total }) {
    let added = 0;
    for (const [key, value] of Object.entries(items)) {
      const bytes = SDT.writer.itemBytes(key, value);
      if (bytes > perItem) {
        return { key, bytes, limit: perItem };
      }
      added += bytes;
    }
    const after = inUse - replaced + added;
    return after > total ? { key: null, bytes: after, limit: total } : null;
  },

  /** Chrome's error message, without a closing full stop. */
  message(error) {
    return String(error?.message ?? error).replace(/\.+$/, "");
  },

  /** Puts back the previous raw values of keys in an area, removing those that had none. */
  async restore(area, keys, previous) {
    const present = keys.filter((key) => Object.hasOwn(previous, key));
    const absent = keys.filter((key) => !Object.hasOwn(previous, key));
    try {
      if (present.length) {
        await chrome.storage[area].set(Object.fromEntries(present.map((key) => [key, previous[key]])));
      }
      if (absent.length) {
        await chrome.storage[area].remove(absent);
      }
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Saves values, validated { key: value } pairs, given the values the page loaded. Resolves to:
   * - { written: [keys] } after every write succeeded (empty when nothing changed)
   * - { quota: { key, bytes, limit } } when a sync quota would be broken; nothing was written
   * - { error, changed: [keys] } when Chrome refused a write; changed lists the keys that stayed
   *   written, which is empty unless undoing an earlier write failed too
   * Local storage is written first: its one key is far below its 10 MB quota, while sync has
   * per-item, total and per-minute quotas. If the sync write then fails, the local write is undone.
   */
  async save(values, loaded) {
    const stored = await SDT.settings.readStored(Object.keys(values));
    const { sync, local } = SDT.writer.changes(values, loaded, stored);
    const syncKeys = Object.keys(sync);
    const localKeys = Object.keys(local);
    if (syncKeys.length) {
      const area = chrome.storage.sync;
      const quota = SDT.writer.quotaProblem(sync, {
        inUse: await area.getBytesInUse(null),
        replaced: await area.getBytesInUse(syncKeys),
        perItem: area.QUOTA_BYTES_PER_ITEM,
        total: area.QUOTA_BYTES
      });
      if (quota) {
        return { quota };
      }
    }
    if (localKeys.length) {
      try {
        await chrome.storage.local.set(local);
      } catch (error) {
        return { error: SDT.writer.message(error), changed: [] };
      }
    }
    if (syncKeys.length) {
      try {
        await chrome.storage.sync.set(sync);
      } catch (error) {
        const undone = await SDT.writer.restore("local", localKeys, stored.local);
        return { error: SDT.writer.message(error), changed: undone ? [] : localKeys };
      }
    }
    return { written: [...localKeys, ...syncKeys] };
  }
};
```

- [ ] **Step 4: Load the lib on the options page**

In `src/src/options/options.html`, replace:

```html
<script src="options.js"></script>
```

with:

```html
<script src="../lib/guard.js"></script>
<script src="../lib/settings.js"></script>
<script src="../lib/writer.js"></script>
<script src="options.js"></script>
```

Today's `options.js` doesn't use them yet. They load here so the build counts `writer.js` as referenced, and checks the page's load order: `settings.js` uses `SDT.guard`, and `writer.js` uses `SDT.settings`.

- [ ] **Step 5: Run the checks**

Run: `npm run lint && npm run test:unit && node scripts/build.js`, then `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test tests/e2e/pages.spec.js -g "options page"`
Expected: lint clean; 281 unit tests pass (14 and 1 more); the zip includes `src/lib/writer.js`; today's options page still saves.

- [ ] **Step 6: Commit**

```bash
git add src/src/lib/writer.js src/src/options/options.html tests/unit/writer.test.js tests/unit/manifest.test.js
git commit -F - <<'EOF'
Add SDT.writer, which saves only what changed and checks sync quotas

A key is written when its new value differs from what is stored and the user changed it on the
page or the stored value is invalid, so a change made in another window survives and an invalid
value is repaired. Sync items are checked against Chrome's per-item and total quotas before
anything is written. Local storage is written first and put back if the sync write fails. Only
the options page loads the file; no content-script group may.
EOF
```

---

## Task 3: Content scripts read settings through `SDT.settings`

**Files:**
- Modify: `src/src/inject/inject.js`, `src/src/inject/queryTest.js`, `src/src/inject/mapImages.js`, `src/src/inject/printTask.js`, `tests/e2e/fixtures.js`, `tests/e2e/pages.spec.js`
- Create: `tests/e2e/settings.spec.js`

**Interfaces:**
- Consumes: `SDT.settings.read` (Task 1).
- Produces: `seedStorage(items, area)` and `readStorage(keys, area)`.

- [ ] **Step 1: Let the storage fixtures take an area**

In `tests/e2e/fixtures.js`, replace:

```js
  // Writes chrome.storage.sync items. Call it before opening the page that should read them.
  seedStorage: async ({ serviceWorker }, use) => {
    await use((items) => inWorker(serviceWorker, (values) => chrome.storage.sync.set(values), items));
  },

  readStorage: async ({ serviceWorker }, use) => {
    await use((keys = null) => inWorker(serviceWorker, (names) => chrome.storage.sync.get(names), keys));
  },
```

with:

```js
  // Writes items to chrome.storage.sync, or to chrome.storage.local when area is "local". Call it
  // before opening the page that should read them.
  seedStorage: async ({ serviceWorker }, use) => {
    await use((items, area = "sync") => inWorker(serviceWorker, ({ values, name }) => chrome.storage[name].set(values), { values: items, name: area }));
  },

  // Reads keys (null for everything) from chrome.storage.sync, or from chrome.storage.local.
  readStorage: async ({ serviceWorker }, use) => {
    await use((keys = null, area = "sync") => inWorker(serviceWorker, ({ names, name }) => chrome.storage[name].get(names), { names: keys, name: area }));
  },
```

- [ ] **Step 2: Write the failing tests**

Create `tests/e2e/settings.spec.js`:

```js
// Content scripts read settings through SDT.settings.read (Phase 4): validated values, with the
// schema's defaults for anything missing or invalid, from the storage area each setting lives in.
import { test, expect, json, REST_ROOT } from "./fixtures.js";

const QUERY = `${REST_ROOT}/Parcels/MapServer/0/query`;
const PRINT = `${REST_ROOT}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/execute`;
// A 1x1 transparent PNG, so a preview loads nothing from the network.
const IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=#preview";

test.describe("content scripts read validated settings", () => {
  test("a fresh profile leaves the where box and the web map empty", async ({ page }) => {
    await page.goto(QUERY);
    await expect(page.getByRole("button", { name: "Select All *", exact: true })).toBeVisible();
    await expect(page.locator("input[name=where]")).toHaveValue("");
    await page.goto(PRINT);
    await expect(page.locator("select:has(option[value='PNG32'])")).toHaveCount(1);
    await expect(page.locator("textarea[name='Web_Map_as_JSON']")).toHaveValue("");
  });

  test("the Query Helper fills in the stored where clause", async ({ page, seedStorage }) => {
    await seedStorage({ defaultWhereClause: "ACRES > 1" });
    await page.goto(QUERY);
    await expect(page.locator("input[name=where]")).toHaveValue("ACRES > 1");
  });

  for (const [stored, method] of [[undefined, "GET"], ["post", "POST"], ["nothing", null], ["donothing", null], ["sideways", "GET"]]) {
    test(`Select All with queryHelperSelectAll ${JSON.stringify(stored)} ${method ? `runs the query with ${method}` : "only fills the form"}`, async ({ page, fakeServer, seedStorage }) => {
      if (stored !== undefined) {
        await seedStorage({ queryHelperSelectAll: stored });
      }
      await page.goto(QUERY);
      await page.getByRole("button", { name: "Select All *", exact: true }).click();
      const submitted = () => fakeServer.calls
        .filter((call) => call.path.endsWith("/Parcels/MapServer/0/query") && (call.query.where ?? call.body.where) === "1=1")
        .map((call) => call.method);
      if (method) {
        await expect.poll(submitted).toEqual([method]);
      } else {
        await expect(page.locator("input[name=where]")).toHaveValue("1=1");
        await page.waitForTimeout(1000);
        expect(submitted()).toEqual([]);
      }
    });
  }

  test("with service details off, the root page asks for none", async ({ page, fakeServer, seedStorage }) => {
    await seedStorage({ autoMetadata: false });
    await page.goto(REST_ROOT);
    await page.waitForTimeout(1000);
    await expect(page.locator(".sdt-datablock")).toHaveCount(0);
    expect(fakeServer.calls.filter((call) => call.query.f === "json" || call.body.f === "json")).toEqual([]);
  });

  test("a stored autoMetadata that isn't true or false reads as the default, on", async ({ page, seedStorage }) => {
    await seedStorage({ autoMetadata: 0 });
    await page.goto(REST_ROOT);
    await expect(page.locator(".sdt-datablock")).toHaveCount(3);
  });

  test("with feature counts off, a MapServer page shows details but no counts", async ({ page, seedStorage }) => {
    await seedStorage({ autoFeatureCounts: false });
    await page.goto(`${REST_ROOT}/Parcels/MapServer`);
    await expect(page.locator(".sdt-datablock")).toHaveCount(2);
    await expect(page.getByRole("status")).toHaveText("SD Toolkit: finished loading");
    await expect(page.locator("b", { hasText: /^Number of features:/ })).toHaveCount(0);
  });

  for (const [stored, size] of [[{ mapImageWidth: 640, mapImageHeight: 480 }, "640,480"], [{ mapImageWidth: 5000, mapImageHeight: "200px" }, "300,200"]]) {
    test(`map previews with a stored size of ${JSON.stringify(stored)} ask for ${size} (SEC-3)`, async ({ page, fakeServer, seedStorage }) => {
      await seedStorage(stored);
      fakeServer.override(/^\/arcgis\/rest\/services\/Parcels\/MapServer\/\?f=json$/, () => json({ initialExtent: { xmin: 0, ymin: 0, xmax: 10, ymax: 10 } }));
      fakeServer.override(/^\/arcgis\/rest\/services\/Parcels\/MapServer\/export\?/, () => json({ href: IMAGE }));
      await page.goto(REST_ROOT);
      await expect(page.locator(".sdt-datablock")).toHaveCount(3);
      await page.getByRole("link", { name: "Parcels", exact: true }).first().hover();
      await expect(page.locator("#mapimage")).toHaveAttribute("src", IMAGE);
      expect(fakeServer.calls.find((call) => call.path.endsWith("/Parcels/MapServer/export")).query.size).toBe(size);
    });
  }

  test("the print page fills the web map from local storage, never from sync (PRT-3, SEC-2)", async ({ page, seedStorage }) => {
    await seedStorage({ defaultWebMapAsJSON: "{\"from\":\"sync\"}" });
    await seedStorage({ defaultWebMapAsJSON: "{\"from\":\"local\"}" }, "local");
    await page.goto(PRINT);
    await expect(page.locator("textarea[name='Web_Map_as_JSON']")).toHaveValue("{\"from\":\"local\"}");
  });

  test("the print page ignores a stored web map that isn't a JSON object", async ({ page, seedStorage }) => {
    await seedStorage({ defaultWebMapAsJSON: "[\"not\", \"a\", \"web map\"]" }, "local");
    await page.goto(PRINT);
    await expect(page.locator("select:has(option[value='PNG32'])")).toHaveCount(1);
    await expect(page.locator("textarea[name='Web_Map_as_JSON']")).toHaveValue("");
  });
});
```

In `tests/e2e/pages.spec.js`, in "a print task's execute page gets dropdowns and the saved web map", change `await seedStorage({ defaultWebMapAsJSON: webMap });` to `await seedStorage({ defaultWebMapAsJSON: webMap }, "local");`.

- [ ] **Step 3: Run the tests to see them fail**

Run: `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test tests/e2e/settings.spec.js tests/e2e/pages.spec.js`
Expected: FAIL, five tests:
- `queryHelperSelectAll "sideways"`: today's switch has no case for it, so Select All submits nothing;
- `autoMetadata` stored as `0`: today's code reads it as false and loads no details;
- previews with a stored size of 5000 × "200px": today's code asks for `5000,200px`;
- the print page "from local storage, never from sync": today's code fills the sync value;
- `pages.spec.js`'s print test: today's code reads sync, where nothing is stored now.

The other ten tests in `settings.spec.js` pass already. They pin behaviour this task keeps: the defaults on a fresh profile, a stored where clause, GET, POST and "fill only", details and counts turned off, a valid stored size, and a web map that isn't an object (which today's code never reads, because it reads sync).

- [ ] **Step 4: `inject.js`**

After the line `  };` that ends `findHelper` and before `  const LOADING_METADATA_CSS = "sdt-loading-metadata";`, add:

```js
  // Field and coded-value counts still run on every layer page. Phase 5 (#45) replaces them with a
  // Count values button, so the settings schema has no keys for them (design review decision 2).
  const COUNT_FIELD_VALUES = true;
  const COUNT_DOMAIN_VALUES = true;

```

In `countFields`, replace the storage call and the end of the `if` block around it:

```js
      chrome.storage.sync.get({
        autoFieldCounts: true,
        autoDomainCounts: true
      }, SDT.guard.wrap((items) => {
        const domainFields = [];
        let domainFieldHTML;
        if (items.autoFieldCounts) {
          notifyLoading(true, LOADING_NULLS_CSS);
          checkForNulls(url, results.fields.slice(0), fieldHTML.slice(0));
        }
        if (items.autoDomainCounts && results.fields.some(hasDomainTest)) {
          
          domainFieldHTML = fieldHTML.slice(0);

          results.fields.forEach((field, i) => {
            if (hasDomainTest(field)) {
              domainFields.push(field.domain.codedValues.map((item) => {
                // future reference: check if Object.assign supported by Chrome
                item.field = field.name;
                item.type = field.type;
                return item;
              }));
            } else {
              domainFieldHTML[i] = null;
            }
          });

          // filter out nulled out HTML nodes.
          domainFieldHTML = domainFieldHTML.filter((item) => !!item );
          notifyLoading(true, LOADING_DOMAINS_CSS);
          checkDomains(url, domainFields, domainFieldHTML, null);
        }
      }));

    }
```

with the call's body, outdented by two spaces and reading the constants:

```js
      const domainFields = [];
      let domainFieldHTML;
      if (COUNT_FIELD_VALUES) {
        notifyLoading(true, LOADING_NULLS_CSS);
        checkForNulls(url, results.fields.slice(0), fieldHTML.slice(0));
      }
      if (COUNT_DOMAIN_VALUES && results.fields.some(hasDomainTest)) {

        domainFieldHTML = fieldHTML.slice(0);

        results.fields.forEach((field, i) => {
          if (hasDomainTest(field)) {
            domainFields.push(field.domain.codedValues.map((item) => {
              // future reference: check if Object.assign supported by Chrome
              item.field = field.name;
              item.type = field.type;
              return item;
            }));
          } else {
            domainFieldHTML[i] = null;
          }
        });

        // filter out nulled out HTML nodes.
        domainFieldHTML = domainFieldHTML.filter((item) => !!item );
        notifyLoading(true, LOADING_DOMAINS_CSS);
        checkDomains(url, domainFields, domainFieldHTML, null);
      }
    }
```

In the `SDT.guard.onLoad` call at the end, make the callback `async`, and after its `jsonView`/`other` check add:

```js
    const settings = await SDT.settings.read(["autoMetadata", "autoFeatureCounts"]);
```

Then replace:

```js
    chrome.storage.sync.get({
      autoMetadata: true,
      autoFeatureCounts: true
    }, SDT.guard.wrap((items) => {
      if (urls.length && items.autoMetadata) {
        notifyLoading(true, LOADING_METADATA_CSS);
        collectMetaData(urls, items.autoFeatureCounts);
      }
    }));

    // Field and domain countson layer pages and ImageServer pages.
    if (type === "layer" || (type === "service" && SDT.page.serviceType(location) === "ImageServer")) {
      countFields(url);
    }
```

with:

```js
    // Field and domain counts on layer pages and ImageServer pages. These requests go to the limiter
    // before the metadata requests, as they did when the settings arrived in a storage callback.
    if (type === "layer" || (type === "service" && SDT.page.serviceType(location) === "ImageServer")) {
      countFields(url);
    }

    if (urls.length && settings.autoMetadata) {
      notifyLoading(true, LOADING_METADATA_CSS);
      collectMetaData(urls, settings.autoFeatureCounts);
    }
```

- [ ] **Step 5: `queryTest.js`**

Make `quickFormFillin` async: `async function quickFormFillin (formData, clickSubmit) {`. It runs from a click listener added with `SDT.guard.listen`, which handles the promise. Replace the end of the function:

```js
    chrome.storage.sync.get({
      queryHelperSelectAll: "get"
    }, SDT.guard.wrap((item) => {
      const submitButtons = document.querySelectorAll("input[type='submit']");
      let submitButton;
      switch(item.queryHelperSelectAll) {
        case "get":
          submitButton = submitButtons[0];
          break;
        case "post":
          submitButton = submitButtons[1];
          break;
      }

      if (submitButton) {
        submitButton.click();
      } 
    }));
  }
```

with:

```js
    const { queryHelperSelectAll } = await SDT.settings.read(["queryHelperSelectAll"]);
    const submitButtons = document.querySelectorAll("input[type='submit']");
    let submitButton;
    switch(queryHelperSelectAll) {
      case "get":
        submitButton = submitButtons[0];
        break;
      case "post":
        submitButton = submitButtons[1];
        break;
    }

    if (submitButton) {
      submitButton.click();
    }
  }
```

Replace `insertDefaultWhereClause` with:

```js
  const insertDefaultWhereClause = async () => {
    const { defaultWhereClause } = await SDT.settings.read(["defaultWhereClause"]);
    const whereInput = document.querySelector("input[name = where]");
    // if the where clause input is empty and the defaultWhereClause is not, add it in.
    if (whereInput && !whereInput.value && defaultWhereClause) {
      whereInput.value = defaultWhereClause;
    }
  };
```

- [ ] **Step 6: `mapImages.js`**

Replace `constructImageContainer` with:

```js
  // The sizes come from SDT.settings, so they are whole numbers from 50 to 2000 (SEC-3). Phase 6
  // sets them through style properties instead.
  const constructImageContainer = (settings) => {
    // update map image width and height
    WIDTH_HEIGHT["width"] = settings.mapImageWidth;
    WIDTH_HEIGHT["height"] = settings.mapImageHeight;
    // construct parent container.
    let parentDiv = loadElement("DIV", {
      "class": "sdt-map-image-panel",
      "style": "min-width:" + settings.mapImageWidth + "px;min-height:" + (settings.mapImageHeight + 30) + "px;"
    });
    let mapDiv = loadElement("IMG", {
      id: "mapimage",
      src: NO_IMAGE_SRC,
      alt: "Map image goes here",
      "class": "sdt-none"
    });
    parentDiv.appendChild(mapDiv);
    parentDiv.appendChild(loadElement("P", {"style": "margin:2px 0;padding:0;"}, "Hover over a link to view."));
    document.body.appendChild(parentDiv);
  };
```

Change `const setup = () => {` to `const setup = (settings) => {`, and its `constructImageContainer();` to `constructImageContainer(settings);`. Replace `onPageLoaded` with:

```js
  const onPageLoaded = async () => {
    const type = SDT.page.classify(location, document);
    if (type === "jsonView" || type === "other") {
      return;
    }
    const settings = await SDT.settings.read(["showMapImages", "mapImageWidth", "mapImageHeight"]);
    if (settings.showMapImages) {
      setup(settings);
    }
  };
```

- [ ] **Step 7: `printTask.js`**

Give `updateGPForm` a second parameter: add ` * @param {string} webMap - the saved web map, or ""` to its JSDoc after `@param {object} response`, and change its first line to `const updateGPForm = (response, webMap) => {`. Replace:

```js
      // look for Web_Map_as_JSON blank to fill in with default value.
      blanks.some((blank) => {
        if (blank.name === "Web_Map_as_JSON" && /^\s*$/.test(blank.value)) {
          chrome.storage.sync.get({
            defaultWebMapAsJSON: ""
          }, SDT.guard.wrap((items) => {
            blank.value = items.defaultWebMapAsJSON;
          }));
        }
        return blank.name === "Web_Map_as_JSON";
      });
```

with:

```js
      // Fill an empty Web_Map_as_JSON box with the saved web map, if there is one. Phase 8 (#22)
      // replaces this with an Insert saved web map button.
      blanks.some((blank) => {
        if (blank.name === "Web_Map_as_JSON" && /^\s*$/.test(blank.value) && webMap) {
          blank.value = webMap;
        }
        return blank.name === "Web_Map_as_JSON";
      });
```

In the `SDT.guard.run(async () => { ... })` at the end, replace:

```js
    if (response !== null) {
      // The extension may have been updated while the request was out.
      SDT.guard.run(updateGPForm, response);
    }
```

with:

```js
    if (response !== null) {
      // The saved web map lives in storage.local (spec section 3).
      const { defaultWebMapAsJSON } = await SDT.settings.read(["defaultWebMapAsJSON"]);
      // The extension may have been updated while the request was out.
      SDT.guard.run(updateGPForm, response, defaultWebMapAsJSON);
    }
```

- [ ] **Step 8: Check nothing reads storage directly any more**

Run: `grep -rn "chrome.storage" src/src/inject`
Expected: no output.

- [ ] **Step 9: Run the checks**

Run: `npm run lint && npm run test:unit`, then the browser tests (Global Constraints).
Expected: lint clean; 281 unit tests pass, including `guard-entry-points.test.js`; 106 browser tests pass (92 before, plus the 14 in `settings.spec.js`), with the known bugs as expected failures.

- [ ] **Step 10: Commit**

```bash
git add src/src/inject tests/e2e/fixtures.js tests/e2e/pages.spec.js tests/e2e/settings.spec.js
git commit -F - <<'EOF'
Read settings in content scripts through SDT.settings

Each script asks SDT.settings.read for the keys it needs and gets validated values, so an invalid
stored value reads as its default: map preview sizes are whole numbers from 50 to 2000 before
they reach a style or a URL (SEC-3), and the print page fills only a saved JSON object from
storage.local, which starts empty (PRT-3, SEC-2). Field and coded-value counts keep running on a
constant until Phase 5's Count values button.
EOF
```

---

## Task 4: The options page: validate, report errors inline, save safely

**Files:**
- Modify: `src/src/options/options.html`, `src/src/options/options.js` (both replaced), `tests/e2e/known-bugs.spec.js`, `tests/e2e/pages.spec.js`
- Create: `tests/unit/options-page.test.js`, `tests/e2e/options.spec.js`

**Interfaces:**
- Consumes: `SDT.settings` (Task 1), `SDT.writer.save` (Task 2), `seedStorage` and `readStorage` with an area (Task 3).
- Produces: the options page's controls and ids (see Public API).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/options-page.test.js`:

```js
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
  assert.match(HTML, /<html lang="en">/);
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
```

The regular expressions read a static file this repo controls, so no HTML parser is needed (the repo has none, and `node --test` has no DOM). A markup change they can't read fails the test rather than passing it: `legendOf` returns `undefined`, `LABELS` misses the id, and the control lists come up short.

Create `tests/e2e/options.spec.js`:

```js
// The options page (Phase 4): one control per SDT.settings key, validated with SDT.settings.parse and
// saved with SDT.writer.save, which writes only what changed and reports Chrome's errors.
import { test, expect } from "./fixtures.js";
import { axeViolations } from "./axe.js";

const SAVED = "Saved. Changes apply when you reload a page.";
const NO_VIOLATIONS = { light: [], dark: [] };
const DEFAULTS = {
  autoMetadata: true,
  autoFeatureCounts: true,
  showMapImages: true,
  mapImageWidth: 300,
  mapImageHeight: 200,
  queryHelperSelectAll: "get",
  defaultWhereClause: "",
  defaultWebMapAsJSON: ""
};
// A JSON object whose text is exactly bytes long.
const webMapOf = (bytes) => `{"a":"${"x".repeat(bytes - 8)}"}`;

/** Opens the options page and waits until it shows the stored values. */
const openOptions = async (page, extensionId) => {
  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  await expect(page.getByLabel("Preview image width (px)")).not.toHaveValue("");
};

/** Records each chrome.storage set and remove the options page makes, as "<area>.<method> <keys>". */
const recordWrites = (page) => page.addInitScript(() => {
  window.sdtWrites = [];
  for (const area of ["sync", "local"]) {
    for (const method of ["set", "remove"]) {
      const original = chrome.storage[area][method].bind(chrome.storage[area]);
      chrome.storage[area][method] = (items, ...rest) => {
        const keys = typeof items === "string" ? [items] : Array.isArray(items) ? items : Object.keys(items);
        window.sdtWrites.push(`${area}.${method} ${[...keys].sort().join(",")}`);
        return original(items, ...rest);
      };
    }
  }
});
const writes = (page) => page.evaluate(() => window.sdtWrites);

/** What each control shows, by setting key. */
const shown = (page) => page.evaluate(() => {
  const form = document.getElementById("settings");
  return Object.fromEntries(window.SDT.settings.schema.map(({ key, type }) => [key, type === "boolean" ? form.elements[key].checked : form.elements[key].value]));
});

test.describe("the options page", () => {
  test("a fresh profile shows every schema default", async ({ page, extensionId }) => {
    await openOptions(page, extensionId);
    expect(await page.evaluate(() => window.SDT.settings.defaults())).toEqual(DEFAULTS);
    expect(await shown(page)).toEqual({ ...DEFAULTS, mapImageWidth: "300", mapImageHeight: "200" });
  });

  test("says that changes apply when a page is reloaded (SET-11)", async ({ page, extensionId }) => {
    await openOptions(page, extensionId);
    await expect(page.getByText("Changes apply when you reload a page.", { exact: true })).toBeVisible();
  });

  test("writes only the settings that changed", async ({ page, extensionId, seedStorage, readStorage }) => {
    await seedStorage({ autoMetadata: false, mapImageHeight: 250 });
    await recordWrites(page);
    await openOptions(page, extensionId);
    await page.getByLabel("Preview image width (px)").fill("640");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText(SAVED);
    expect(await writes(page)).toEqual(["sync.set mapImageWidth"]);
    expect(await readStorage()).toEqual({ autoMetadata: false, mapImageHeight: 250, mapImageWidth: 640 });
    expect(await readStorage(null, "local")).toEqual({});
  });

  test("says so when nothing changed, and writes nothing", async ({ page, extensionId }) => {
    await recordWrites(page);
    await openOptions(page, extensionId);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("No changes to save.");
    expect(await writes(page)).toEqual([]);
  });

  test("keeps a setting another window changed, unless it was changed here too", async ({ page, extensionId, seedStorage, readStorage }) => {
    await recordWrites(page);
    await openOptions(page, extensionId);
    await seedStorage({ showMapImages: false, mapImageHeight: 400 });
    await page.getByLabel("Preview image width (px)").fill("640");
    await page.getByLabel("Preview image height (px)").fill("500");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText(SAVED);
    expect(await writes(page)).toEqual(["sync.set mapImageHeight,mapImageWidth"]);
    expect(await readStorage()).toEqual({ showMapImages: false, mapImageWidth: 640, mapImageHeight: 500 });
    // After saving, the page shows what is stored.
    await expect(page.getByLabel("Show map previews on hover")).not.toBeChecked();
  });

  test("repairs stored values that aren't valid (SET-1)", async ({ page, extensionId, seedStorage, readStorage }) => {
    await seedStorage({ queryHelperSelectAll: "nothing", mapImageWidth: "wide" });
    await recordWrites(page);
    await openOptions(page, extensionId);
    await expect(page.getByLabel("Fill the form only")).toBeChecked();
    await expect(page.getByLabel("Preview image width (px)")).toHaveValue("300");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText(SAVED);
    expect(await writes(page)).toEqual(["sync.set mapImageWidth,queryHelperSelectAll"]);
    expect(await readStorage()).toEqual({ queryHelperSelectAll: "donothing", mapImageWidth: 300 });
  });

  test("shows an error under each invalid field, and saves nothing (SET-3, SET-4)", async ({ page, extensionId, readStorage }) => {
    await recordWrites(page);
    await openOptions(page, extensionId);
    const width = page.getByLabel("Preview image width (px)");
    const height = page.getByLabel("Preview image height (px)");
    const webMap = page.getByLabel("Saved web map (JSON)");
    await width.fill("");
    await height.fill("2001");
    await webMap.fill("[1]");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("Not saved. Fix the 3 fields marked below.");
    for (const field of [width, height, webMap]) {
      await expect(field).toHaveAttribute("aria-invalid", "true");
    }
    await expect(width).toHaveAccessibleDescription("Enter a whole number from 50 to 2000.");
    await expect(height).toHaveAccessibleDescription("Enter a whole number from 50 to 2000.");
    await expect(webMap).toHaveAccessibleDescription(/Enter valid JSON for a web map object, or leave it empty\.$/);
    await expect(width).toBeFocused();
    expect(await writes(page)).toEqual([]);
    expect(await readStorage()).toEqual({});

    await width.fill("640");
    await height.fill("480");
    await webMap.fill("");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText(SAVED);
    for (const field of [width, height, webMap]) {
      await expect(field).not.toHaveAttribute("aria-invalid");
    }
    expect(await readStorage()).toEqual({ mapImageWidth: 640, mapImageHeight: 480 });
  });

  test("refuses a web map over 100 KB, giving its size", async ({ page, extensionId, readStorage }) => {
    await openOptions(page, extensionId);
    const webMap = page.getByLabel("Saved web map (JSON)");
    await webMap.fill(webMapOf(140 * 1024));
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("Not saved. Fix the field marked below.");
    await expect(webMap).toHaveAccessibleDescription(/This web map is 140 KB\. The limit is 100 KB\.$/);
    expect(await readStorage(null, "local")).toEqual({});
  });

  test("saves the web map to local storage, not sync", async ({ page, extensionId, readStorage }) => {
    await recordWrites(page);
    await openOptions(page, extensionId);
    await page.getByLabel("Saved web map (JSON)").fill("{\"operationalLayers\":[]}");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText(SAVED);
    expect(await writes(page)).toEqual(["local.set defaultWebMapAsJSON"]);
    expect(await readStorage(null, "local")).toEqual({ defaultWebMapAsJSON: "{\"operationalLayers\":[]}" });
    expect(await readStorage()).toEqual({});
  });

  test("refuses a where clause too long for Chrome sync, and writes nothing (SET-4)", async ({ page, extensionId, readStorage }) => {
    await recordWrites(page);
    await openOptions(page, extensionId);
    const where = page.getByLabel("Default where clause");
    await page.getByLabel("Preview image width (px)").fill("640");
    await where.fill("a".repeat(9000));
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("Not saved. Fix the field marked below.");
    await expect(where).toHaveAttribute("aria-invalid", "true");
    await expect(where).toHaveAccessibleDescription(/Too long to sync: this needs 9,020 bytes, and Chrome allows 8,192 per setting\.$/);
    await expect(where).toBeFocused();
    expect(await writes(page)).toEqual([]);
    expect(await readStorage()).toEqual({});
  });

  test("refuses a save that would take Chrome sync over its total quota, and writes nothing (SET-4)", async ({ page, extensionId, seedStorage, readStorage }) => {
    // 12 items of 8,006 bytes: 96,096 of sync's 102,400 bytes.
    const junk = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`junk${String(i).padStart(2, "0")}`, "x".repeat(8000)]));
    await seedStorage(junk);
    await recordWrites(page);
    await openOptions(page, extensionId);
    await page.getByLabel("Preview image width (px)").fill("640");
    await page.getByLabel("Default where clause").fill("a".repeat(7000));
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("Not saved: the synced settings would need 103,132 bytes, and Chrome allows 102,400. Nothing was changed.");
    expect(await writes(page)).toEqual([]);
    expect(await readStorage()).toEqual(junk);
  });

  test("when Chrome refuses the write, says why, and changes nothing (SET-4)", async ({ page, extensionId, serviceWorker, readStorage }) => {
    await recordWrites(page);
    await openOptions(page, extensionId);
    // Use up chrome.storage.sync's 120 writes a minute.
    await serviceWorker.evaluate(async () => {
      for (let i = 0; i < chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_MINUTE; i++) {
        await chrome.storage.sync.set({ filler: i });
      }
    });
    await page.getByLabel("Preview image width (px)").fill("640");
    await page.getByLabel("Saved web map (JSON)").fill("{\"operationalLayers\":[]}");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("Not saved: This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota. Nothing was changed.");
    // The web map went first, so it was put back.
    expect(await writes(page)).toEqual(["local.set defaultWebMapAsJSON", "sync.set mapImageWidth", "local.remove defaultWebMapAsJSON"]);
    expect(await readStorage(["mapImageWidth"])).toEqual({});
    expect(await readStorage(null, "local")).toEqual({});
  });

  test("shows \"Saved\" only once the write has finished", async ({ page, extensionId, readStorage }) => {
    // Hold every sync write until the test lets it go.
    await page.addInitScript(() => {
      const set = chrome.storage.sync.set.bind(chrome.storage.sync);
      chrome.storage.sync.set = (items) => new Promise((resolve) => {
        window.sdtFinishWrite = () => resolve(set(items));
      });
    });
    await openOptions(page, extensionId);
    await page.getByLabel("Preview image width (px)").fill("640");
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForFunction(() => typeof window.sdtFinishWrite === "function");
    await expect(page.getByRole("status")).toHaveText("");
    expect(await readStorage(["mapImageWidth"])).toEqual({});
    await page.evaluate(() => window.sdtFinishWrite());
    await expect(page.getByRole("status")).toHaveText(SAVED);
    expect(await readStorage(["mapImageWidth"])).toEqual({ mapImageWidth: 640 });
  });

  test("turns feature counts off while service details are off", async ({ page, extensionId }) => {
    await openOptions(page, extensionId);
    const counts = page.getByLabel("Count features in each layer");
    await expect(counts).toBeEnabled();
    await page.getByLabel("Load service details and spatial references").uncheck();
    await expect(counts).toBeDisabled();
    await expect(counts).toHaveAccessibleDescription("Needs \"Load service details and spatial references\".");
  });

  test("axe finds nothing wrong, in light and dark, with and without errors (SET-7)", async ({ page, extensionId }) => {
    await openOptions(page, extensionId);
    expect(await axeViolations(page)).toEqual(NO_VIOLATIONS);
    await page.getByLabel("Preview image width (px)").fill("");
    await page.getByLabel("Saved web map (JSON)").fill("[");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("Not saved. Fix the 2 fields marked below.");
    expect(await axeViolations(page)).toEqual(NO_VIOLATIONS);
  });

  test("works from the keyboard alone (SET-7)", async ({ page, extensionId, readStorage }) => {
    await openOptions(page, extensionId);
    const order = [];
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      order.push(await page.evaluate(() => {
        const element = document.activeElement;
        return element.labels?.[0]?.textContent.trim() ?? element.textContent.trim();
      }));
    }
    expect(order).toEqual([
      "Load service details and spatial references",
      "Count features in each layer",
      "Saved web map (JSON)",
      "Default where clause",
      "Run the query with GET",
      "Show map previews on hover",
      "Preview image width (px)",
      "Preview image height (px)",
      "Save",
      "Map Services Enhanced"
    ]);

    // Back to the radio group, then through the rest of the form.
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Shift+Tab");
    }
    await expect(page.getByLabel("Run the query with GET")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("640");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toHaveText(SAVED);
    expect(await readStorage()).toEqual({ queryHelperSelectAll: "post", showMapImages: false, mapImageWidth: 640 });

    // A failed save moves focus to the first field to fix.
    await page.keyboard.press("Tab");
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("5");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toHaveText("Not saved. Fix the field marked below.");
    await expect(page.getByLabel("Preview image height (px)")).toBeFocused();
  });
});
```

In `tests/e2e/known-bugs.spec.js`, change `knownBug("SET-1", "the options page loads normally when \"nothing\" is stored", ...` to `test("SET-1: the options page loads normally when \"nothing\" is stored", ...`, and `knownBug("SET-3", "a blank number is rejected, not saved", ...` to `test("SET-3: a blank number is rejected, not saved", ...`. Their bodies stay as they are.

In `tests/e2e/pages.spec.js`, in "the options page shows the defaults and saves changes", replace:

```js
  await expect.poll(() => readStorage(["mapImageWidth"])).toEqual({ mapImageWidth: 321 });
```

with:

```js
  await expect(page.getByRole("status")).toHaveText("Saved. Changes apply when you reload a page.");
  expect(await readStorage(["mapImageWidth"])).toEqual({ mapImageWidth: 321 });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/unit/options-page.test.js`, then `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test tests/e2e/options.spec.js tests/e2e/known-bugs.spec.js tests/e2e/pages.spec.js -g "options|SET-"`
Expected: FAIL. All 12 unit cases (no `lang`, controls without names, old labels, no status line). All 16 options-page tests: `openOptions` finds no "Preview image width (px)" label. SET-1 fails on its first assertion with the page's `querySelector(...).checked` error, SET-3 on `aria-invalid`, and the pages test on the status line.

- [ ] **Step 3: Replace `options.html`**

Replace `src/src/options/options.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Services Directory Toolkit settings</title>
  <style>
    textarea {
      display: block;
      width: 100%;
    }
    input[type=text], input[type=number], textarea {
      box-sizing: border-box;
    }
    input[type=text], input[type=number] {
      width: 100%;
      line-height: 1.5em;
    }
    fieldset {
      padding: 0 5px 5px;
      border-radius: 6px;
      margin-bottom: 0.5em;
    }
    .row {
      min-height: 24px;
      margin: 0.2em 0;
    }
    .hint {
      margin: 0.2em 0 0.4em;
    }
    .error {
      margin: 0.2em 0 0.4em;
      color: #b3261e;
      font-weight: bold;
    }
    [aria-invalid="true"] {
      border: 2px solid #b3261e;
    }
    button {
      font-size: 1.0em;
      min-height: 24px;
      border: 0;
      border-radius: 4px;
      padding: 0.4em 0.8em;
      margin: 0.2em 0.4em 0.2em 0;
      background-color: #336;
      color: White;
      font-weight: bold;
    }
  </style>
</head>
<body>

<h1>Services Directory Toolkit settings</h1>
<p>Changes apply when you reload a page.</p>

<form id="settings" novalidate>

<fieldset>
  <legend>Automatic requests</legend>
  <div class="row">
    <input type="checkbox" id="metadata" name="autoMetadata">
    <label for="metadata">Load service details and spatial references</label>
  </div>
  <div class="row">
    <input type="checkbox" id="featurecounts" name="autoFeatureCounts" aria-describedby="featurecounts-hint">
    <label for="featurecounts">Count features in each layer</label>
    <p class="hint" id="featurecounts-hint">Needs "Load service details and spatial references".</p>
  </div>
</fieldset>

<fieldset>
  <legend>Print tasks</legend>
  <label for="defaultwebmapasjson">Saved web map (JSON)</label>
  <p class="hint" id="defaultwebmapasjson-hint">Filled into an empty Web_Map_as_JSON box. It stays on this computer and isn't synced. Leave it empty for none.</p>
  <textarea rows="5" id="defaultwebmapasjson" name="defaultWebMapAsJSON" aria-describedby="defaultwebmapasjson-hint defaultwebmapasjson-error"></textarea>
  <p class="error" id="defaultwebmapasjson-error"></p>
</fieldset>

<fieldset>
  <legend>Query Helper</legend>
  <label for="defaultwhereclause">Default where clause</label>
  <p class="hint" id="defaultwhereclause-hint">Filled into an empty where box. Leave it empty for none.</p>
  <input type="text" id="defaultwhereclause" name="defaultWhereClause" aria-describedby="defaultwhereclause-hint defaultwhereclause-error">
  <p class="error" id="defaultwhereclause-error"></p>
  <fieldset>
    <legend>Quick queries that fill and run the form</legend>
    <div class="row">
      <input type="radio" id="qhget" name="queryHelperSelectAll" value="get">
      <label for="qhget">Run the query with GET</label>
    </div>
    <div class="row">
      <input type="radio" id="qhpost" name="queryHelperSelectAll" value="post">
      <label for="qhpost">Run the query with POST, for long where clauses</label>
    </div>
    <div class="row">
      <input type="radio" id="qhnothing" name="queryHelperSelectAll" value="donothing">
      <label for="qhnothing">Fill the form only</label>
    </div>
  </fieldset>
</fieldset>

<fieldset>
  <legend>Map previews</legend>
  <div class="row">
    <input type="checkbox" id="showmapimages" name="showMapImages">
    <label for="showmapimages">Show map previews on hover</label>
  </div>
  <label for="mapimagewidth">Preview image width (px)</label>
  <input type="number" id="mapimagewidth" name="mapImageWidth" min="50" max="2000" step="1" aria-describedby="mapimagewidth-error">
  <p class="error" id="mapimagewidth-error"></p>
  <label for="mapimageheight">Preview image height (px)</label>
  <input type="number" id="mapimageheight" name="mapImageHeight" min="50" max="2000" step="1" aria-describedby="mapimageheight-error">
  <p class="error" id="mapimageheight-error"></p>
</fieldset>

<button id="save" type="submit">Save</button>
<p id="status" role="status"></p>

</form>

<p><small>Based on <a href="https://github.com/raykendo/Map-Services-Enhanced" target="_blank" rel="noopener">Map Services Enhanced</a> by Ken Doman.</small></p>

<script src="../lib/guard.js"></script>
<script src="../lib/settings.js"></script>
<script src="../lib/writer.js"></script>
<script src="options.js"></script>
</body>
</html>
```

- [ ] **Step 4: Replace `options.js`**

Replace `src/src/options/options.js` with:

```js
// The options page. Each control's name is its setting's key in SDT.settings.schema, and a unit test
// (tests/unit/options-page.test.js) checks the page has one control per key, with the same values.
// Values are read and validated by SDT.settings and saved by SDT.writer.
{
  const SAVED = "Saved. Changes apply when you reload a page.";
  const form = document.getElementById("settings");
  const status = document.getElementById("status");
  const keys = SDT.settings.keys();
  // The values the form shows, as last read from storage. null until the first read.
  let loaded = null;
  let saving = false;

  // form.elements[key] is the control, or a RadioNodeList for a radio group. Setting a group's value
  // checks the radio with that value, so no selector is built from a stored value (SEC-9).
  const control = (key) => form.elements[key];
  const isBoolean = (key) => SDT.settings.entry(key).type === "boolean";
  // The error line under a field: the element whose id is the control's id plus "-error".
  const errorLine = (key) => document.getElementById(`${control(key).id}-error`);
  const errorKeys = keys.filter((key) => control(key).id && errorLine(key));

  const updateFeatureCountCheck = () => {
    control("autoFeatureCounts").disabled = !control("autoMetadata").checked;
  };

  const show = (values) => {
    for (const key of keys) {
      if (isBoolean(key)) {
        control(key).checked = values[key];
      } else {
        control(key).value = String(values[key]);
      }
    }
    updateFeatureCountCheck();
  };

  const markError = (key, message) => {
    errorLine(key).textContent = message;
    control(key).setAttribute("aria-invalid", "true");
  };

  const clearErrors = () => {
    for (const key of errorKeys) {
      errorLine(key).textContent = "";
      control(key).removeAttribute("aria-invalid");
    }
  };

  const notSaved = (count) => (count === 1 ? "Not saved. Fix the field marked below." : `Not saved. Fix the ${count} fields marked below.`);
  const bytes = (count) => count.toLocaleString("en-US");

  /** Validates every control. Returns { values, errors }, each keyed by setting. */
  const collect = () => {
    const values = {};
    const errors = {};
    for (const key of keys) {
      const result = SDT.settings.parse(key, isBoolean(key) ? control(key).checked : control(key).value);
      if ("error" in result) {
        errors[key] = result.error;
      } else {
        values[key] = result.value;
      }
    }
    return { values, errors };
  };

  const showInvalid = (errors) => {
    const invalid = keys.filter((key) => Object.hasOwn(errors, key));
    invalid.forEach((key) => markError(key, errors[key]));
    status.textContent = notSaved(invalid.length);
    control(invalid[0]).focus();
  };

  const save = async () => {
    clearErrors();
    status.textContent = "";
    const { values, errors } = collect();
    if (Object.keys(errors).length) {
      showInvalid(errors);
      return;
    }
    let result;
    try {
      result = await SDT.writer.save(values, loaded);
    } catch (error) {
      status.textContent = `Not saved: ${SDT.writer.message(error)}. Nothing was changed.`;
      return;
    }
    if (result.quota?.key) {
      showInvalid({ [result.quota.key]: `Too long to sync: this needs ${bytes(result.quota.bytes)} bytes, and Chrome allows ${bytes(result.quota.limit)} per setting.` });
    } else if (result.quota) {
      status.textContent = `Not saved: the synced settings would need ${bytes(result.quota.bytes)} bytes, and Chrome allows ${bytes(result.quota.limit)}. Nothing was changed.`;
    } else if (result.error) {
      const kept = result.changed.map((key) => `"${SDT.settings.entry(key).label}"`).join(", ");
      status.textContent = kept
        ? `Not saved: ${result.error}. Only ${kept} changed.`
        : `Not saved: ${result.error}. Nothing was changed.`;
    } else {
      // Show what storage now holds, including changes made in another window to keys left alone here.
      loaded = await SDT.settings.read();
      show(loaded);
      status.textContent = result.written.length ? SAVED : "No changes to save.";
    }
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving || loaded === null) {
      return;
    }
    saving = true;
    try {
      await save();
    } finally {
      saving = false;
    }
  });

  control("autoMetadata").addEventListener("change", updateFeatureCountCheck);

  const start = async () => {
    loaded = await SDT.settings.read();
    show(loaded);
  };
  start();
}
```

- [ ] **Step 5: Run the checks**

Run: `npm run lint && npm run test:unit && node scripts/build.js`, then the browser tests.
Expected: lint clean; 293 unit tests pass (12 more); 122 browser tests pass (16 more), with SET-1 and SET-3 now passing as normal tests and six known bugs left as expected failures.

- [ ] **Step 6: Commit**

```bash
git add src/src/options tests/unit/options-page.test.js tests/e2e/options.spec.js tests/e2e/known-bugs.spec.js tests/e2e/pages.spec.js
git commit -F - <<'EOF'
Validate and save the options page through the settings schema

Each control is named for its schema key, and a unit test checks the page against the schema.
Numbers must be whole and in range, and the web map a JSON object of at most 100 KB; errors show
under each field with aria-invalid, and focus moves to the first. Saving writes only the keys that
changed, refuses anything over Chrome's sync quotas, and says "Saved" only after the write
succeeds, or why it failed. The page has lang, labels for every control, a fieldset for the
Select All choice, and a note that changes apply on reload. The field and domain count
checkboxes go.
EOF
```

---

## Task 5: Lint: one place for defaults, and content scripts read through `SDT.settings`

**Files:**
- Modify: `eslint.config.js`, `tests/unit/lint-rules.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/unit/lint-rules.test.js`, two existing tests use `chrome.storage.sync.get({ a: 1 }, ...)` as an example of a call that is allowed, and the new rules ban it. In "content scripts wrap chrome callbacks in SDT.guard.wrap", replace its two assertions with:

```js
  assert.deepEqual(await ruleIds("{\n  chrome.runtime.sendMessage({ a: 1 }, (reply) => reply);\n}\n", INJECT), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("{\n  chrome.runtime.sendMessage({ a: 1 }, SDT.guard.wrap((reply) => reply));\n}\n", INJECT), []);
```

In "content scripts never write to chrome.storage (spec section 4.4)", replace the last assertion with:

```js
  assert.deepEqual(await ruleIds("{\n  SDT.guard.run(async () => {\n    await SDT.settings.read([\"autoMetadata\"]);\n  });\n}\n", INJECT), []);
```

Before "the options page may write to chrome.storage", add:

```js
test("content scripts read settings only through SDT.settings", async () => {
  for (const call of [
    "chrome.storage.sync.get([\"autoMetadata\"])",
    "chrome.storage.local.get(\"defaultWebMapAsJSON\", SDT.guard.wrap((items) => items))",
    "chrome.storage.sync[\"get\"](null)",
    "chrome.storage.sync.get({ autoMetadata: true }, SDT.guard.wrap((items) => items))"
  ]) {
    assert.deepEqual(await ruleIds(`{\n  ${call};\n}\n`, INJECT), ["no-restricted-syntax"], call);
  }
});

test("only lib files pass defaults to chrome.storage.*.get", async () => {
  for (const file of ["src/src/options/example.js", "src/src/bg/example.js"]) {
    assert.deepEqual(await ruleIds("chrome.storage.sync.get({ autoMetadata: true });\n", file), ["no-restricted-syntax"], file);
    assert.deepEqual(await ruleIds("chrome.storage.local[\"get\"]({ defaultWebMapAsJSON: \"\" });\n", file), ["no-restricted-syntax"], file);
    assert.deepEqual(await ruleIds("chrome.storage.sync.get([\"autoMetadata\"]);\n", file), [], file);
  }
  assert.deepEqual(await ruleIds("{\n  chrome.storage.sync.get({ autoMetadata: true });\n}\n", "src/src/page_action/example.js"), ["no-restricted-syntax"]);
  assert.deepEqual(await ruleIds("globalThis.SDT ??= {};\nSDT.example = { read: () => chrome.storage.sync.get({ a: 1 }) };\n", "src/src/lib/example.js"), []);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/unit/lint-rules.test.js`
Expected: FAIL, the two new tests: every call is allowed today.

- [ ] **Step 3: Add the rules**

In `eslint.config.js`, before the `// Lib files are classic scripts` comment, add:

```js
// Every setting's default lives once, in SDT.settings (store-readiness spec, Phase 4). An object
// passed to chrome.storage.*.get is a second copy of some defaults, so only src/src/lib/ may pass one.
const STORAGE_DEFAULTS = "Read settings with SDT.settings.read (src/src/lib/settings.js), which holds every default.";
const STORAGE_DEFAULTS_SELECTORS = [{
  selector: "CallExpression[callee.object.object.property.name='storage']:matches([callee.property.name='get'], [callee.property.value='get'])[arguments.0.type='ObjectExpression']",
  message: STORAGE_DEFAULTS
}];
// Content scripts read settings only through SDT.settings, which validates what is stored.
const STORAGE_READ = "Content scripts read settings with SDT.settings.read, which validates them.";
const STORAGE_READ_SELECTORS = [{
  selector: "CallExpression[callee.object.object.property.name='storage']:matches([callee.property.name='get'], [callee.property.value='get'])",
  message: STORAGE_READ
}];
```

Then:
- In the `src/**/*.js` entry, change `"no-restricted-syntax": ["error", ...BASE_SELECTORS]` to `"no-restricted-syntax": ["error", ...BASE_SELECTORS, ...STORAGE_DEFAULTS_SELECTORS]`. The service worker and the options page get the rule from here.
- Change the comment above the inject entry to:

  ```js
  // A later entry replaces the rule's whole option list for the files it matches, so each of these
  // repeats BASE_SELECTORS. Lib files may pass defaults to chrome.storage.*.get; content scripts may
  // not read storage at all, which covers the defaults rule.
  ```
- In the `src/src/inject/**/*.js` entry, add `...STORAGE_READ_SELECTORS` after `...STORAGE_SELECTORS`.
- In the `src/src/page_action/**/*.js` entry, add `...STORAGE_DEFAULTS_SELECTORS` after `...NETWORK_SELECTORS`.
- Leave the `src/src/lib/**/*.js` entry as it is.

- [ ] **Step 4: Run the checks**

Run: `npm run lint && npm run test:unit`
Expected: lint clean, because Tasks 3 and 4 removed every inline default; 295 unit tests pass (2 more).

- [ ] **Step 5: Commit**

```bash
git add eslint.config.js tests/unit/lint-rules.test.js
git commit -F - <<'EOF'
Lint against settings defaults outside the schema

Outside src/src/lib/, passing a defaults object to chrome.storage.*.get is an error, so defaults
live only in SDT.settings. Content scripts may not read chrome.storage at all: they use
SDT.settings.read, which validates.
EOF
```

---

## Task 6: Docs, the spec, the known bugs, and the PR

**Files:**
- Modify: `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `.coderabbit.yaml`, `docs/superpowers/specs/2026-10-09-store-readiness-design.md`

- [ ] **Step 1: Re-check the known bugs**

Run: `SHOW_KNOWN_BUGS=1 CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test tests/e2e/known-bugs.spec.js`
Expected: the six remaining `knownBug()` cases fail on these lines of `known-bugs.spec.js`, as before this phase: INJ-2 at 46, INJ-3 at 59, INJ-11 at 65, QRY-1 at 87, POP-2 at 122 (with a console error), POP-3 at 131. QRY-1 seeds `queryHelperSelectAll: "donothing"` and still gets that far, because `donothing` stays allowed. If a line differs, find out why before going on.

- [ ] **Step 2: Update `CLAUDE.md`**

- **Commands, `npm run lint`:** replace "content scripts must add listeners, timers and `chrome.*` callbacks through `SDT.guard` and may not call `chrome.storage.*.set`, `remove` or `clear`, and lib files may not declare top-level names" with "content scripts must add listeners, timers and `chrome.*` callbacks through `SDT.guard`, may not call `chrome.storage.*.set`, `remove` or `clear`, and read settings only through `SDT.settings`, code outside `src/src/lib/` may not pass a defaults object to `chrome.storage.*.get`, and lib files may not declare top-level names".
- **Browser tests:** after "The `signIn` fixture sets the server's sign-in cookie, and `openPopupTab` takes a Page to report its real tab id.", add: "`seedStorage(items, area)` and `readStorage(keys, area)` write and read `chrome.storage.sync`, or `chrome.storage.local` when `area` is `"local"`."
- **Architecture, the namespaces paragraph:** change "`SDT.net` (`fetchJson` and the request limiter) and `SDT.page` (`classify`)." to "`SDT.net` (`fetchJson` and the request limiter), `SDT.page` (`classify`) and `SDT.settings` (the settings schema, `validate`, `parse` and `read`)." After the `sender.js` sentence, add: "`src/src/lib/writer.js` (`SDT.writer`, which saves settings) is in no content-script group either: only the options page loads it, because content scripts never write to storage."
- **Architecture, the extension-update paragraph:** at the end, add: "`SDT.settings.read`, like `SDT.net.fetchJson`, never settles in a cut-off script."
- **Settings:** replace the whole section, from "**Settings** live in `chrome.storage.sync`" through "Phase 4 of the store-readiness spec replaces all of this with one schema.", with:

  ```markdown
  **Settings** are defined once, in `SDT.settings.schema` (`src/src/lib/settings.js`): each entry's key, type, default, allowed values or range, label and storage area. The keys are `autoMetadata`, `autoFeatureCounts`, `showMapImages`, `mapImageWidth` and `mapImageHeight` (whole numbers from 50 to 2000), `queryHelperSelectAll` (`get`, `post` or `donothing`), `defaultWhereClause`, and `defaultWebMapAsJSON` (empty, or a JSON object of at most 100 KB). The web map lives in `chrome.storage.local` and starts empty; the rest are in `chrome.storage.sync`.
  - **Reading.** `SDT.settings.read(keys)` resolves to validated values: a missing or invalid stored value reads as its default, and a stored `nothing`, from the in-page form that Phase 3 removed, reads as `donothing`. Content scripts read settings only this way and never write them (lint enforces both), and code outside `src/src/lib/` may not pass a defaults object to `chrome.storage.*.get`.
  - **The options page** (`src/src/options/`) is static HTML with one control per schema key, whose `name` is the key. `tests/unit/options-page.test.js` checks each control's type, values, range, label and error line against the schema. `options.js` checks each field with `SDT.settings.parse`, shows errors under the fields with `aria-invalid`, and saves with `SDT.writer.save`.
  - **Saving** (`src/src/lib/writer.js`). A key is written when its new value differs from what is stored and the user changed it on the page or the stored value is invalid, so a change made in another window survives. Sync items are checked against Chrome's per-item and total quotas first. `storage.local` is written before `storage.sync`, and put back if the sync write fails. The page says "Saved" only after both writes succeed.
  - Field and coded-value counts have no setting: `inject.js` runs them on every layer page, on two constants, until Phase 5's Count values button (#45). Changes apply when a page is reloaded (SET-11); open tabs don't update.
  ```

- [ ] **Step 3: Update `README.md`**

In "Changes made on top of Ken's last commit", add after the bullet that starts "Replaced the gear":

```markdown
- Defined every setting once, with its default and allowed values, and checked what is stored when it is read. The options page no longer breaks on a value saved by the old in-page form, and refuses a blank or out-of-range preview size instead of saving it.
- Made the options page save only the settings you changed, check Chrome sync's size limits before saving, and say "Saved" only once the save has worked, or why it didn't. Errors appear under the fields they belong to.
- Kept the print task's saved web map on this computer instead of syncing it, and started it empty.
- Labelled every control on the options page, grouped the Select All choices, and added a note that changes apply when you reload a page.
```

- [ ] **Step 4: Update `CONTRIBUTING.md`**

In the shared-code bullet, replace "Content scripts only read settings: lint rejects `chrome.storage.*.set`, `remove` and `clear` under `src/src/inject/`." with:

```markdown
Settings are defined once, in `SDT.settings.schema` (`src/src/lib/settings.js`). To add one, add a schema entry and one control on the options page whose `name` is its key; `tests/unit/options-page.test.js` checks that they match. Content scripts read settings with `await SDT.settings.read(keys)`, which validates them, and never write them: lint rejects `chrome.storage.*.set`, `remove`, `clear` and `get` under `src/src/inject/`, and a defaults object passed to `chrome.storage.*.get` anywhere outside `src/src/lib/`. The options page saves through `SDT.writer` (`src/src/lib/writer.js`), which no content-script group loads.
```

- [ ] **Step 5: Update `.coderabbit.yaml`**

- In the `src/src/lib/**` instructions, after "sender.js is the exception: only the service worker loads it, with importScripts.", add: "writer.js is loaded only by the options page (and the popup from Phase 9); flag a content_scripts group that lists it. settings.js holds every setting's default, allowed values and label; flag a default written anywhere else."
- In the `src/src/inject/**` instructions, after "Content scripts never write to chrome.storage (set, remove or clear); lint enforces it.", add: "They read settings only with await SDT.settings.read(keys), which validates; lint rejects chrome.storage.*.get here."
- In the `src/manifest.json` instructions, change "in the order dom, guard, auth, url, net, page." to "in the order dom, guard, auth, url, net, page, settings."
- Replace the `src/src/options/**` instructions with:

  ```yaml
      - path: "src/src/options/**"
        instructions: |
          Static HTML with one control per SDT.settings key, whose name is the key;
          tests/unit/options-page.test.js checks them against the schema. Flag a default, allowed
          value, range or label written here instead of in src/src/lib/settings.js, a selector
          built from a stored value, a direct chrome.storage write instead of SDT.writer.save,
          and a success message shown before the save resolves.
  ```

- [ ] **Step 6: Update the spec**

In `docs/superpowers/specs/2026-10-09-store-readiness-design.md`:
- Under "Facts verified during review", after the Phase 3 checks, add:

  ```markdown
  - **Phase 4 checks (2026-10-21), in Chromium 141, and in Chrome for Testing 120 where noted:**
    - `chrome.storage.sync` counts an item as its key plus the value's `JSON.stringify`, in UTF-8 bytes, against `QUOTA_BYTES_PER_ITEM` (8,192), and `getBytesInUse` reports the same figure.
    - A `set` with several items is all or nothing: one item over the limit stores none of them.
    - Chromium 141 reports quota failures with internal names ("Resource::kQuotaBytesPerItem quota exceeded"), so the options page checks the quotas itself first.
    - The 121st sync write in a minute fails with "This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota.", in both browsers, in a signed-out profile. Local writes are unaffected.
  ```
- In section 5's table, change the Phase 4 row's "Settings schema" to "Settings schema (`SDT.settings`), and the writer (`SDT.writer`), which only extension pages load".

- [ ] **Step 7: Final verification**

Run: `npm run lint && npm run test:unit && node scripts/build.js && rm -rf dist && unzip -q build/*.zip -d dist`, then the browser tests twice, with `EXT_PATH=dist` and without, then `git status --short`.
Expected: lint clean; 295 unit tests pass; the zip includes `src/lib/settings.js` and `src/lib/writer.js`; 122 browser tests pass in each run, with six known bugs as expected failures; only the docs are uncommitted. Delete `dist/` afterwards (git ignores it).

- [ ] **Step 8: Commit, push and open the PR**

```bash
git add README.md CONTRIBUTING.md CLAUDE.md .coderabbit.yaml docs/superpowers/specs
git commit -F - <<'EOF'
Describe the Phase 4 settings in the docs and the spec
EOF
git push -u origin HEAD
```

Open the PR against `main` with the title "Phase 4: settings (one schema, validated reads, safe saving)". The body says "Closes #33" and lists:

- **Findings closed**, one line each, with the resolution in the "Finding IDs" table below.
- **Departures from the spec and the issue:**
  - `SDT.writer` is a second lib file, kept out of content scripts.
  - The schema's `choice` entry has `aliases`, because falling back to the default would read `nothing` as `get`.
  - Lint bans every storage read in content scripts, not only inline defaults.
  - Focus moves to the first invalid field (from #25), and the labels are the design review's, except "on hover" without "and focus" until Phase 6.
  - The options page doesn't change in the dark scheme yet (Phase 5's shared style, #25).
- **Open risks:** the open points below that are still open.

End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)` and your session line. Then run `gh pr checks --watch`. The `chrome-120` job may fail without blocking; the suite passed locally on Chrome for Testing 120 while this plan was written.

---

## Acceptance criteria (issue #33)

| Criterion | Task | Test |
|---|---|---|
| The SET-1 and SET-3 `test.fail()` cases pass | 1, 4 | `known-bugs.spec.js`, now `test()`; `options.spec.js` "repairs stored values that aren't valid (SET-1)" and "shows an error under each invalid field" (SET-3) |
| A quota-exceeding save shows an error and writes nothing | 2, 4 | `options.spec.js`: per-item (where clause), total (seeded sync) and Chrome's own refusal (120 writes a minute), each recording no write or an undone one; `writer.test.js` |
| A fresh profile reads schema defaults everywhere | 1, 3, 4 | Options page: `options.spec.js` "a fresh profile shows every schema default". Content scripts: `settings.spec.js` "a fresh profile leaves the where box and the web map empty" and "Select All with queryHelperSelectAll undefined runs the query with GET"; `pages.spec.js`'s root, MapServer and layer tests (details, counts and field counts on); `requests.spec.js`'s preview test (300 × 200); `settings.test.js` "read returns the defaults from empty storage" |
| A unit test checks every schema key has exactly one matching control, with the same allowed values | 4 | `tests/unit/options-page.test.js` |
| "Saved" appears only after the write succeeds | 2, 4 | `options.spec.js`: "shows "Saved" only once the write has finished" (held write) and "when Chrome refuses the write" |
| WCAG 2.2 AA: `lang`, labels, fieldsets with legends for radio groups | 4 | `options-page.test.js` (`lang`, a label per control, the radio group's legend); axe in `options.spec.js` |
| Saving writes only the keys that changed | 2, 4 | `writer.test.js` "changes" table and "save writes only the keys that changed"; `options.spec.js` "writes only the settings that changed", "keeps a setting another window changed" and "says so when nothing changed" |
| Inline errors set `aria-invalid` | 4 | `options.spec.js` "shows an error under each invalid field"; SET-3 |
| A note says changes apply when a page is reloaded (SET-11) | 4 | `options.spec.js` and `options-page.test.js` |
| axe-core passes in light and dark, plus a keyboard-only test | 4 | `options.spec.js`: axe with and without errors showing, and "works from the keyboard alone" |
| The schema omits `autoFieldCounts` and `autoDomainCounts`; `inject.js` keeps field counts on a constant until #45 | 1, 3, 4 | `settings.test.js` (schema), `options-page.test.js` (no control for them), `pages.spec.js` "a layer page counts values for every field and every coded value" |
| `README.md`, `CONTRIBUTING.md`, `CLAUDE.md` and `.coderabbit.yaml` match the code | 6 | Review |

## Finding IDs

| ID | Task | Resolution |
|---|---|---|
| SET-1 | 1, 4 | Fix by validation: a stored `nothing` reads as `donothing` through the schema's alias, and saving repairs it. Migration won't fix (never published) |
| SEC-9 | 4 | Duplicate of SET-1: the page sets the radio group through `form.elements[key].value`, never a selector built from a stored value |
| SET-2 | 1, 3, 4, 5 | Fix: one schema; every reader goes through `SDT.settings`; lint bans defaults objects outside `src/src/lib/` and storage reads in content scripts |
| SET-3 | 1, 4 | Fix: whole numbers from 50 to 2000, inline errors, nothing saved |
| SET-4 | 2, 4 | Fix: per-item and total sync quota checks before writing; web map JSON and size validation, in `storage.local`; every write awaited and Chrome's error reported |
| PRT-3 | 1, 3 | Moot: the web map lives in `storage.local`, starts empty, and is inserted on click from Phase 8 |
| SET-11 | 4 | Won't fix: the page says changes apply when a page is reloaded, and so does "Saved" |
| QRY-15, Phase 4 part | 1, 3 | `nothing`/`donothing`: one allowed value, with the old one read as it. The rest stays with Phase 7 |
| SET-7, Phase 4 part | 4 | The options page: `lang`, labels, a fieldset and legend for the radio group, inline errors with `aria-invalid` and `aria-describedby`, a status line, axe in both schemes and a keyboard test |
| SET-10, Phase 4 part | 4 | The options page's Extensionizr leftovers (the template's "color = red" comment) go with the rewrite |
| IMG-4, Phase 4 part | 1, 4 | Labels "Preview image width (px)" and "Preview image height (px)". Clamping to the service stays with Phase 6 |
| SEC-2, Phase 4 part | 1, 3 | The web map moves to `storage.local`, empty by default, and only a JSON object of at most 100 KB is filled. Insert buttons stay with Phases 7 and 8 |
| SEC-3, Phase 4 part | 1, 3 | Stored sizes are validated whole numbers before they reach a style or a URL. Style properties stay with Phase 6 |
| ADV-1, Phase 4 part | 6 | README's change list, CONTRIBUTING, CLAUDE.md and `.coderabbit.yaml` |

## Commands

| What | Command |
|---|---|
| Lint | `npm run lint` |
| Unit tests | `npm run test:unit`, or one file: `node --test tests/unit/settings.test.js` |
| Build without lint | `node scripts/build.js` |
| Browser tests | `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test --grep-invert @cdp` |
| One browser spec | add the file and `-g "<title>"` to the command above |
| Against the zip | `rm -rf dist && unzip -q build/*.zip -d dist`, then the browser command with `EXT_PATH=dist` |
| Known bugs as normal tests | prefix the browser command with `SHOW_KNOWN_BUGS=1` and add `tests/e2e/known-bugs.spec.js` |

## Open points

1. **Local first, then sync, with an undo** (confirmed by the owner, Decision 5). The decision above makes "Nothing was changed" true whenever the sync write fails, at the cost of a second local write. Only the unit tests reach the path where the undo itself fails, since a browser test can't make `storage.local` fail without stubbing it. Writing sync first instead would put the more likely failure first, but then a local failure would need an undo of sync, which uses up the 120 writes a minute.
2. **Wording the owner didn't give.** The owner confirmed the two quota messages, "No changes to save." and "Choose one of the options." (Decision 5). Still open: "Not saved: <error>. Only "Saved web map (JSON)" changed.", the hints under the web map, the where clause and the feature-count checkbox, and the page's `<h1>` "Services Directory Toolkit settings" (from design review section 6.10).
3. **The `nothing` alias stays** until someone removes it. Phase 3 removed the only writer of `nothing`, and the extension is unpublished, so only development profiles hold it. Removing the alias later would make such a profile read `get`.
4. **Old keys stay in sync storage.** A profile that saved before this phase keeps `autoFieldCounts` and `autoDomainCounts` in `storage.sync`, and an old web map there too. Nothing reads them, and the options page never writes or removes them. They count toward the total quota, at a few dozen bytes for the flags; an old web map there can be up to 8 KB.
5. **Content scripts still fill the stored where clause and web map automatically.** That is today's behaviour; Phases 7 and 8 replace it with Insert buttons that ignore synthetic clicks (spec section 3).
6. **The options page doesn't follow the dark scheme yet.** The axe runs in both schemes pass because the page stays light. Phase 5's shared stylesheet and #25 add the dark palette.
7. **`read` rejects on a storage error other than invalidation.** In a content script that becomes an unhandled rejection, which the harness counts as an error. Falling back to the defaults would hide the failure and could send requests the user turned off. No such error has been seen.

## Changes made while implementing

None yet. If an instruction above has to change while implementing, record it here and update the step to say what was done.
