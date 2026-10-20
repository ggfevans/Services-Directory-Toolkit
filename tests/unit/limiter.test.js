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
