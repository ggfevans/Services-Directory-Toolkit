import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLib, plain } from "./helpers/sdt.js";

const { net } = loadLib().SDT;
const SCOPE = "https://gis.example.org/server";
const at = (i) => `${SCOPE}/rest/services/S${i}/MapServer`;
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** A fetchJson stand-in whose requests stay open until the test finishes them, or their signal aborts. */
const fakeFetch = () => {
  const open = [];
  let active = 0;
  let peak = 0;
  let sent = 0;
  const fetchJson = (url, options) => new Promise((resolve) => {
    sent += 1;
    active += 1;
    peak = Math.max(peak, active);
    const job = {
      url,
      options,
      finish(result) {
        if (open.includes(job)) {
          open.splice(open.indexOf(job), 1);
          active -= 1;
          resolve(result);
        }
      }
    };
    options.signal.addEventListener("abort", () => job.finish({ error: { type: "aborted", message: "cancelled", url } }));
    open.push(job);
  });
  return { open, fetchJson, peak: () => peak, sent: () => sent };
};

const pageTarget = () => {
  const listeners = {};
  return {
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    fire(type) {
      (listeners[type] ?? []).forEach((fn) => fn());
    }
  };
};

const OK = { data: {} };

test("accepts 50 requests, and each one past that resolves with the note at once", async () => {
  const fake = fakeFetch();
  const limiter = net.createLimiter({ scope: SCOPE, fetchJson: fake.fetchJson });
  const results = Array.from({ length: 60 }, (_, i) => limiter.fetchJson(at(i)));
  for (let i = 50; i < 60; i++) {
    assert.deepEqual(plain(await results[i]).error, { type: "limit", message: "Not loaded: request limit reached (50)", url: at(i), max: 50 });
  }
  while (fake.open.length) {
    fake.open[0].finish(OK);
    await flush();
  }
  assert.equal(fake.sent(), 50);
  assert.equal(plain(limiter.stats()).accepted, 50);
});

test("never has more than 4 requests in flight", async () => {
  const fake = fakeFetch();
  const limiter = net.createLimiter({ scope: SCOPE, fetchJson: fake.fetchJson });
  const results = Array.from({ length: 20 }, (_, i) => limiter.fetchJson(at(i)));
  await flush();
  assert.equal(fake.open.length, 4);
  while (fake.open.length) {
    fake.open[0].finish(OK);
    await flush();
    assert.ok(fake.open.length <= 4);
  }
  await Promise.all(results);
  assert.equal(fake.peak(), 4);
  assert.equal(fake.sent(), 20);
});

test("pagehide cancels the requests in flight and the queue, and later calls send nothing", async () => {
  const fake = fakeFetch();
  const target = pageTarget();
  const limiter = net.createLimiter({ scope: SCOPE, target, fetchJson: fake.fetchJson });
  const results = Array.from({ length: 6 }, (_, i) => limiter.fetchJson(at(i)));
  await flush();
  const signals = fake.open.map((job) => job.options.signal);
  target.fire("pagehide");
  assert.ok(signals.every((signal) => signal.aborted));
  for (const result of results) {
    assert.equal(plain(await result).error.type, "aborted");
  }
  assert.equal(plain(await limiter.fetchJson(at(9))).error.type, "aborted");
  assert.equal(fake.sent(), 4);
});

for (const status of [429, 503]) {
  test(`an HTTP ${status} stops automatic work: the rest resolve as stopped`, async () => {
    const fake = fakeFetch();
    const limiter = net.createLimiter({ scope: SCOPE, fetchJson: fake.fetchJson });
    const results = Array.from({ length: 6 }, (_, i) => limiter.fetchJson(at(i)));
    await flush();
    fake.open[0].finish({ error: { type: "http", status, message: `HTTP ${status}`, url: at(0) } });
    const note = `Not loaded: the server answered HTTP ${status}, so automatic requests stopped`;
    for (const [i, result] of results.entries()) {
      assert.deepEqual(plain(await result).error, { type: "stopped", message: note, url: at(i), status });
    }
    assert.equal(plain(await limiter.fetchJson(at(9))).error.type, "stopped");
    assert.equal(fake.sent(), 4);
    assert.equal(plain(limiter.stats()).stopped, status);
  });
}

test("a URL outside the scope is refused, sends nothing and isn't counted", async () => {
  const fake = fakeFetch();
  const limiter = net.createLimiter({ scope: SCOPE, fetchJson: fake.fetchJson });
  assert.equal(plain(await limiter.fetchJson("https://services9.arcgis.com/Org/arcgis/rest/services/A/FeatureServer")).error.type, "destination");
  assert.equal(plain(await net.createLimiter({ fetchJson: fake.fetchJson }).fetchJson(at(1))).error.type, "destination");
  assert.equal(fake.sent(), 0);
  assert.equal(plain(limiter.stats()).accepted, 0);
});

test("the caller's own signal still cancels its request", async () => {
  const fake = fakeFetch();
  const limiter = net.createLimiter({ scope: SCOPE, fetchJson: fake.fetchJson });
  const controller = new AbortController();
  const result = limiter.fetchJson(at(1), { signal: controller.signal });
  await flush();
  controller.abort();
  assert.equal(plain(await result).error.type, "aborted");
});

test("isSkipped is true for the limit and for stopped work only", () => {
  assert.equal(net.isSkipped({ error: { type: "limit" } }), true);
  assert.equal(net.isSkipped({ error: { type: "stopped" } }), true);
  assert.equal(net.isSkipped({ error: { type: "http", status: 502 } }), false);
  assert.equal(net.isSkipped({ data: {} }), false);
});

test("a refused request's error never repeats a token from its URL", async () => {
  const fake = fakeFetch();
  const limiter = net.createLimiter({ scope: SCOPE, max: 0, fetchJson: fake.fetchJson });
  for (const url of [`${at(1)}?token=abc`, "https://other.example.org/server/rest/services/A/MapServer?token=abc"]) {
    assert.doesNotMatch(JSON.stringify(plain(await limiter.fetchJson(url))), /abc/, url);
  }
  assert.equal(fake.sent(), 0);
});

test("once the extension context is gone, pagehide settles none of the queued or finished jobs", async () => {
  const chrome = { runtime: { id: "sdt-test-extension" } };
  const lib = loadLib({ chrome }).SDT.net;
  const fake = fakeFetch();
  const target = pageTarget();
  const limiter = lib.createLimiter({ scope: SCOPE, target, fetchJson: fake.fetchJson });
  let settled = 0;
  Array.from({ length: 6 }, (_, i) => limiter.fetchJson(at(i)).then(() => {
    settled += 1;
  }));
  await flush();
  chrome.runtime.id = undefined;
  target.fire("pagehide");
  await flush();
  await flush();
  assert.equal(settled, 0);
});

test("extend raises the cap: a third request is refused at max 2, then two more are accepted after extend(2)", async () => {
  const fake = fakeFetch();
  const limiter = net.createLimiter({ max: 2, scope: SCOPE, fetchJson: fake.fetchJson });
  limiter.fetchJson(at(0));
  limiter.fetchJson(at(1));
  assert.equal((await limiter.fetchJson(at(2))).error.type, "limit");
  limiter.extend(2);
  limiter.fetchJson(at(3));
  limiter.fetchJson(at(4));
  const refused = await limiter.fetchJson(at(5));
  assert.equal(refused.error.type, "limit");
  assert.equal(fake.sent(), 4);
});

test("extend after a 429 changes nothing: the next request settles as stopped", async () => {
  const fake = fakeFetch();
  const limiter = net.createLimiter({ max: 2, scope: SCOPE, fetchJson: fake.fetchJson });
  const first = limiter.fetchJson(at(0));
  fake.open[0].finish({ error: { type: "http", message: "Too many", url: at(0), status: 429 } });
  await first;
  limiter.extend(5);
  assert.equal(limiter.stats().max, 2);
  assert.equal((await limiter.fetchJson(at(1))).error.type, "stopped");
});

test("extend after pagehide changes nothing: the next request settles as aborted", async () => {
  const fake = fakeFetch();
  const target = pageTarget();
  const limiter = net.createLimiter({ max: 2, scope: SCOPE, target, fetchJson: fake.fetchJson });
  target.fire("pagehide");
  limiter.extend(5);
  assert.equal(limiter.stats().max, 2);
  assert.equal((await limiter.fetchJson(at(0))).error.type, "aborted");
});

test("grant(n) allows n more requests from now: after 1 accepted at max 3, grant(2) lets exactly 2 more through", async () => {
  const fake = fakeFetch();
  const limiter = net.createLimiter({ max: 3, scope: SCOPE, fetchJson: fake.fetchJson });
  limiter.fetchJson(at(0));
  limiter.grant(2);
  assert.equal(limiter.stats().max, 3);
  limiter.fetchJson(at(1));
  limiter.fetchJson(at(2));
  assert.equal((await limiter.fetchJson(at(3))).error.type, "limit");
  assert.equal(fake.sent(), 3);
});

test("grant after a 429 or pagehide changes nothing", async () => {
  const fake = fakeFetch();
  const limiter = net.createLimiter({ max: 2, scope: SCOPE, fetchJson: fake.fetchJson });
  const first = limiter.fetchJson(at(0));
  fake.open[0].finish({ error: { type: "http", message: "Too many", url: at(0), status: 429 } });
  await first;
  limiter.grant(5);
  assert.equal(limiter.stats().max, 2);
  const target = pageTarget();
  const aborted = net.createLimiter({ max: 2, scope: SCOPE, target, fetchJson: fake.fetchJson });
  target.fire("pagehide");
  aborted.grant(5);
  assert.equal(aborted.stats().max, 2);
});

test("stats().max reports the cap: 50 by default, 100 after extend(50)", () => {
  const limiter = net.createLimiter({ scope: SCOPE, fetchJson: fakeFetch().fetchJson });
  assert.equal(limiter.stats().max, 50);
  limiter.extend(50);
  assert.equal(limiter.stats().max, 100);
});

test("stats().aborted is false until pagehide, then true", () => {
  const target = pageTarget();
  const limiter = net.createLimiter({ scope: SCOPE, target, fetchJson: fakeFetch().fetchJson });
  assert.equal(limiter.stats().aborted, false);
  target.fire("pagehide");
  assert.equal(limiter.stats().aborted, true);
});

/** A lib whose page limiter is built by SDT.net.pageLimiter() for a page in SCOPE, on a stand-in window. */
const pageLib = () => {
  const window = pageTarget();
  const { SDT } = loadLib({ globals: { window, location: { href: `${SCOPE}/rest/services` } } });
  return { SDT, window };
};

test("resetPageLimiter after pagehide starts a new page view: a fresh limiter with its own 50", async () => {
  const { SDT, window } = pageLib();
  const first = SDT.net.pageLimiter();
  window.fire("pagehide");
  assert.equal(first.stats().aborted, true);
  const second = SDT.net.resetPageLimiter();
  assert.notStrictEqual(second, first);
  assert.strictEqual(SDT.net.pageLimiter(), second);
  assert.deepEqual(plain(second.stats()), { accepted: 0, active: 0, peak: 0, stopped: null, max: 50, aborted: false });
  // The new limiter cancels on the next pagehide, as the first did.
  window.fire("pagehide");
  assert.equal(second.stats().aborted, true);
});

test("resetPageLimiter keeps a limiter stopped by pushback: a 429 holds for the page", async () => {
  const { SDT } = pageLib();
  SDT.state = { pageLimiter: SDT.net.createLimiter({ scope: SCOPE, fetchJson: async () => ({ error: { type: "http", message: "HTTP 429", status: 429 } }) }) };
  const stopped = SDT.net.pageLimiter();
  await stopped.fetchJson(at(0));
  assert.equal(stopped.stats().stopped, 429);
  assert.strictEqual(SDT.net.resetPageLimiter(), stopped);
  assert.strictEqual(SDT.net.pageLimiter(), stopped);
});

test("onSend runs once for each request sent, just before it goes, and never for a queued one pagehide drains", async () => {
  const fake = fakeFetch();
  const target = pageTarget();
  const limiter = net.createLimiter({ scope: SCOPE, target, fetchJson: fake.fetchJson });
  const sent = [];
  const results = Array.from({ length: 6 }, (_, i) => limiter.fetchJson(at(i), { params: { f: "json" }, onSend: () => sent.push(i) }));
  await flush();
  assert.deepEqual(sent, [0, 1, 2, 3]);
  // The callback is the limiter's: SDT.net.fetchJson never sees it.
  assert.ok(fake.open.every((job) => !("onSend" in job.options) && job.options.params.f === "json"));
  target.fire("pagehide");
  await Promise.all(results);
  assert.deepEqual(sent, [0, 1, 2, 3]);
});

test("onSend never runs for a queued request that a 429 drains", async () => {
  const fake = fakeFetch();
  const limiter = net.createLimiter({ scope: SCOPE, fetchJson: fake.fetchJson });
  let sent = 0;
  const results = Array.from({ length: 6 }, (_, i) => limiter.fetchJson(at(i), { onSend: () => (sent += 1) }));
  await flush();
  fake.open[0].finish({ error: { type: "http", status: 429, message: "HTTP 429", url: at(0) } });
  await Promise.all(results);
  assert.equal(sent, 4);
});
