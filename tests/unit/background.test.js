// Runs the service worker (src/src/bg/background.js) in a vm context with a stub chrome, so the
// message handler can be called with any sender, which a browser test can't forge.
import { test } from "node:test";
import assert from "node:assert/strict";
import { posix } from "node:path";
import vm from "node:vm";
import { runFile } from "./helpers/sdt.js";

const ID = "sdt-test-extension";
const WORKER = "src/bg/background.js";

/** Loads the worker. Returns the listeners it added and the chrome.action calls it made. */
const loadWorker = ({ enable = async () => {}, disable = async () => {} } = {}) => {
  const listeners = {};
  const calls = [];
  const debug = [];
  const event = (name) => ({ addListener: (listener) => { listeners[name] = listener; } });
  const chrome = {
    runtime: { id: ID, onInstalled: event("onInstalled"), onStartup: event("onStartup"), onMessage: event("onMessage") },
    action: {
      disable: (...args) => {
        calls.push(["disable", ...args]);
        return disable(...args);
      },
      enable: (...args) => {
        calls.push(["enable", ...args]);
        return enable(...args);
      }
    }
  };
  const context = vm.createContext({ chrome, console: { ...console, debug: (...args) => debug.push(args) } });
  // importScripts resolves each path against the worker's own location, as Chrome does.
  context.importScripts = (...paths) => paths.forEach((path) => runFile(context, posix.join(posix.dirname(WORKER), path)));
  runFile(context, WORKER);
  return { listeners, calls, debug, context };
};

const topFrame = { id: ID, frameId: 0, documentLifecycle: "active", tab: { id: 7 } };

test("the worker loads the sender check with importScripts", () => {
  assert.equal(typeof loadWorker().context.SDT.sender.accepts, "function");
});

test("install and browser start disable the toolbar button for every tab", () => {
  const { listeners, calls } = loadWorker();
  listeners.onInstalled();
  listeners.onStartup();
  assert.deepEqual(calls, [["disable"], ["disable"]]);
});

test("enableAction from the active top frame of a tab enables the button for that tab", () => {
  const { listeners, calls } = loadWorker();
  listeners.onMessage({ type: "enableAction" }, topFrame);
  assert.deepEqual(calls, [["enable", 7]]);
});

test("enableAction from a sender the check rejects changes nothing (BG-2, BG-3)", () => {
  const { listeners, calls } = loadWorker();
  for (const sender of [
    { ...topFrame, id: "another-extension" },
    { ...topFrame, frameId: 2 },
    { ...topFrame, documentLifecycle: "prerender" },
    { ...topFrame, documentLifecycle: "cached" },
    { ...topFrame, documentLifecycle: "pending_deletion" },
    { ...topFrame, documentLifecycle: undefined },
    { ...topFrame, tab: undefined }
  ]) {
    listeners.onMessage({ type: "enableAction" }, sender);
  }
  assert.deepEqual(calls, []);
});

test("other messages change nothing", () => {
  const { listeners, calls } = loadWorker();
  listeners.onMessage({ type: "disableAction" }, topFrame);
  listeners.onMessage(null, topFrame);
  assert.deepEqual(calls, []);
});

test("a failed enable() is caught and logged at debug level, not left unhandled (BG-3)", async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const { listeners, debug } = loadWorker({ enable: async (tabId) => { throw new Error(`No tab with id: ${tabId}.`); } });
    listeners.onMessage({ type: "enableAction" }, topFrame);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
    assert.equal(debug.length, 1);
    assert.match(String(debug[0][1]), /No tab with id: 7/);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("a failed disable() on install or start is caught and logged at debug level, not left unhandled", async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const { listeners, debug } = loadWorker({ disable: async () => { throw new Error("disable failed"); } });
    listeners.onInstalled();
    listeners.onStartup();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
    assert.equal(debug.length, 2);
    assert.match(String(debug[0][1]), /disable failed/);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});
