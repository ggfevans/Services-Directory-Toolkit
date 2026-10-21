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
