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
  // 51,196 two-byte characters are 102,392 bytes, and the braces, key and quotes add 8: 102,400 in all.
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
