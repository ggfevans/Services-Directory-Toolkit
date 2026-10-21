import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLib } from "./helpers/sdt.js";

const INVALIDATED = "Extension context invalidated.";

/** An event target that records listeners and can fire them with a given this. */
const eventTarget = () => {
  const listeners = [];
  return {
    listeners,
    addEventListener(type, listener, options) {
      listeners.push({ type, listener, options });
    },
    removeEventListener(type, listener) {
      const at = listeners.findIndex((entry) => entry.type === type && entry.listener === listener);
      if (at !== -1) {
        listeners.splice(at, 1);
      }
    },
    fire(type, thisArg, ...args) {
      [...listeners].filter((entry) => entry.type === type).forEach((entry) => entry.listener.apply(thisArg, args));
    }
  };
};

const setup = (globals = {}) => {
  const context = loadLib({ globals });
  return { context, guard: context.SDT.guard, cutOff: () => { context.chrome.runtime.id = undefined; } };
};

test("alive follows chrome.runtime.id, and is false when reading it throws", () => {
  const { guard, cutOff } = setup();
  assert.equal(guard.alive(), true);
  cutOff();
  assert.equal(guard.alive(), false);
  const throwing = loadLib({ chrome: { get runtime() { throw new Error(INVALIDATED); } } }).SDT.guard;
  assert.equal(throwing.alive(), false);
});

test("run calls the function only while alive", () => {
  const { guard, cutOff } = setup();
  let calls = 0;
  assert.equal(guard.run((n) => { calls += n; return "done"; }, 2), "done");
  cutOff();
  assert.equal(guard.run(() => { calls += 1; }), undefined);
  assert.equal(calls, 2);
});

test("run swallows invalidation errors and rethrows others", async () => {
  const { guard } = setup();
  assert.equal(guard.run(() => { throw new Error(INVALIDATED); }), undefined);
  assert.throws(() => guard.run(() => { throw new Error("boom"); }), /boom/);
  assert.equal(await guard.run(async () => { throw new Error(INVALIDATED); }), undefined);
  await assert.rejects(guard.run(async () => { throw new Error("boom"); }), /boom/);
});

test("wrap keeps this and the arguments", () => {
  const { guard } = setup();
  const owner = { name: "owner" };
  const wrapped = guard.wrap(function (a, b) { return `${this.name}:${a}${b}`; });
  assert.equal(wrapped.call(owner, 1, 2), "owner:12");
});

test("listen runs the handler with the target as this while alive, then removes itself", () => {
  const { guard, cutOff } = setup();
  const target = eventTarget();
  const seen = [];
  guard.listen(target, "click", function (event) { seen.push([this, event]); });
  target.fire("click", target, "first");
  assert.deepEqual(seen, [[target, "first"]]);
  cutOff();
  target.fire("click", target, "second");
  assert.equal(seen.length, 1);
  assert.equal(target.listeners.length, 0);
});

test("listen returns a function that removes the listener", () => {
  const { guard } = setup();
  const target = eventTarget();
  const unlisten = guard.listen(target, "click", () => {});
  unlisten();
  assert.equal(target.listeners.length, 0);
});

test("onLoad runs now on a loaded page, and on load otherwise", () => {
  const win = eventTarget();
  const loaded = setup({ document: { readyState: "complete" }, window: win });
  let calls = 0;
  loaded.guard.onLoad(() => { calls += 1; });
  assert.equal(calls, 1);

  const loading = setup({ document: { readyState: "interactive" }, window: win });
  loading.guard.onLoad(() => { calls += 1; });
  assert.equal(calls, 1);
  assert.deepEqual(win.listeners.map(({ type, options }) => [type, options.once]), [["load", true]]);
  win.fire("load", win);
  assert.equal(calls, 2);
});

test("onLoad reads nothing once the context is gone", () => {
  const trap = new Proxy({}, { get(_, key) { throw new Error(`read ${String(key)}`); } });
  const { guard, cutOff } = setup({ document: trap, window: trap });
  cutOff();
  assert.doesNotThrow(() => guard.onLoad(() => assert.fail("ran")));
});

test("whenActive runs now on a page that isn't prerendering", () => {
  const doc = Object.assign(eventTarget(), { prerendering: false });
  const { guard } = setup({ document: doc });
  let calls = 0;
  guard.whenActive(() => { calls += 1; });
  assert.equal(calls, 1);
  assert.equal(doc.listeners.length, 0);
});

test("whenActive waits until a prerendered page is shown (BG-2)", () => {
  const doc = Object.assign(eventTarget(), { prerendering: true });
  const { guard } = setup({ document: doc });
  let calls = 0;
  guard.whenActive(() => { calls += 1; });
  assert.equal(calls, 0);
  assert.deepEqual(doc.listeners.map(({ type, options }) => [type, options.once]), [["prerenderingchange", true]]);
  doc.prerendering = false;
  doc.fire("prerenderingchange", doc);
  assert.equal(calls, 1);
});

test("whenActive reads nothing once the context is gone", () => {
  const trap = new Proxy({}, { get(_, key) { throw new Error(`read ${String(key)}`); } });
  const { guard, cutOff } = setup({ document: trap });
  cutOff();
  assert.doesNotThrow(() => guard.whenActive(() => assert.fail("ran")));
});
