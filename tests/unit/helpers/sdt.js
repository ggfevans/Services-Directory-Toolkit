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
    ...globals
  });
  for (const file of files) {
    runFile(context, file);
  }
  return context;
};
