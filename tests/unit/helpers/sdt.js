// Loads the extension's lib files (src/src/lib/) into a Node vm context, the way a content script
// group loads them, so unit tests can call SDT without a browser.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/** The extension root. Paths in the manifest are relative to it. */
export const SRC = fileURLToPath(new URL("../../../src/", import.meta.url));

const manifest = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));

/** The lib files in the order the manifest's content-script groups load them. */
export const LIB_FILES = manifest.content_scripts
  .find((group) => group.js)
  .js.filter((file) => file.startsWith("src/lib/"));

/** A chrome object with just enough for the lib: a runtime id, which the guard reads. */
export const stubChrome = ({ id = "sdt-test-extension" } = {}) => ({ runtime: { id } });

/**
 * A chrome.storage area in memory, with Chrome's promise API and quota constants. items holds what
 * it stores, and calls records each call as [method, argument]. fail.<method>, if set, is called with
 * the call's argument and returns an Error for the call to reject with, or undefined to let it run.
 * getBytesInUse counts each item as the key plus JSON.stringify of the value, in UTF-8 bytes. Chrome
 * also escapes "<", U+2028 and U+2029 (see SDT.writer.itemBytes); no test stores them here.
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

/**
 * Values made inside a vm context have that context's prototypes, which assert.deepEqual from
 * node:assert/strict never matches. plain() copies a JSON-safe value into this realm.
 */
export const plain = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/** Runs one file, given as a path relative to src/, in context. */
export const runFile = (context, file) => vm.runInContext(readFileSync(join(SRC, file), "utf8"), context, { filename: file });

/**
 * Creates a context with Node's URL, fetch-related and timer globals, plus globals, and runs the lib
 * files in it. Returns the context: context.SDT is the lib. Like vm.runInNewContext, but the
 * context stays reusable for later files.
 */
export const loadLib = ({ chrome = stubChrome(), globals = {}, files = LIB_FILES } = {}) => {
  const context = vm.createContext({
    chrome,
    console,
    URL,
    URLSearchParams,
    AbortController,
    AbortSignal,
    DOMException,
    setTimeout,
    clearTimeout,
    TextEncoder,
    ...globals
  });
  for (const file of files) {
    runFile(context, file);
  }
  return context;
};
