import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLib, plain } from "./helpers/sdt.js";

const SCOPE = "https://gis.example.org/server";
const at = (i) => `${SCOPE}/rest/services/S${i}/MapServer`;
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** A lib with a fake page limiter, whose fetches answer with answer(url), and a job of the given size. */
const setup = ({ answer = () => ({ data: {} }), max } = {}) => {
  const context = loadLib();
  const { SDT } = context;
  SDT.state = { pageLimiter: SDT.net.createLimiter({ scope: SCOPE, max, fetchJson: async (url) => answer(url) }) };
  return SDT;
};

const withJob = (kind, total, counts = {}) => {
  const SDT = setup();
  const job = SDT.status.job(kind, total);
  const state = SDT.state.status;
  Object.assign(state, counts);
  return { SDT, job, snap: () => plain(SDT.status.snapshot()) };
};

const msg = (kind, total, counts) => {
  const { SDT } = withJob(kind, total, counts);
  return plain(SDT.status.message(SDT.status.snapshot()));
};

test("a job of 3 rows is busy until all 3 report", () => {
  const { job, snap } = withJob("services", 3);
  assert.equal(snap().busy, true);
  job.done();
  job.failed();
  assert.equal(snap().busy, true);
  job.skipped();
  assert.equal(snap().busy, false);
  assert.deepEqual([snap().done, snap().failed, snap().skipped, snap().total, snap().kind], [1, 1, 1, 3, "services"]);
});

test("a second job call returns the same job with total added", () => {
  const { SDT, job } = withJob("services", 3);
  assert.strictEqual(SDT.status.job("layers", 2), job);
  const snapshot = plain(SDT.status.snapshot());
  assert.deepEqual([snapshot.total, snapshot.kind], [5, "services"]);
});

test("a throwing subscriber breaks neither the report nor the other subscribers", () => {
  const timers = [];
  const context = loadLib({ globals: { setTimeout: (fn) => timers.push(fn) } });
  const { SDT } = context;
  SDT.state = { pageLimiter: SDT.net.createLimiter({ scope: SCOPE, fetchJson: async () => ({ data: {} }) }) };
  const job = SDT.status.job("services", 2);
  const seen = [];
  SDT.status.subscribe(() => {
    throw new Error("bad subscriber");
  });
  SDT.status.subscribe((snapshot) => seen.push(snapshot.done));
  assert.doesNotThrow(() => job.done());
  assert.deepEqual(seen, [1]);
  assert.equal(timers.length, 1);
  assert.throws(timers[0], /bad subscriber/);
});

test("message: busy \"Loading details: 2 of 8 services, 1 failed\"", () => {
  assert.deepEqual(msg("services", 8, { done: 1, failed: 1 }), { text: "Loading details: 2 of 8 services, 1 failed", action: null }, "tone is undefined, which plain() drops");
});

test("message: busy without failures leaves out the failed clause", () => {
  assert.equal(msg("layers", 8, { done: 2 }).text, "Loading details: 2 of 8 layers");
});

test("message: done \"Loaded details for 8 services in 9 requests\" with tone \"ok\"", () => {
  assert.deepEqual(msg("services", 8, { done: 8, requests: 9 }), { tone: "ok", text: "Loaded details for 8 services in 9 requests", action: null });
});

test("message: done with failures \"Loaded details for 7 services in 8 requests. 1 failed.\"", () => {
  assert.equal(msg("services", 8, { done: 7, failed: 1, requests: 8 }).text, "Loaded details for 7 services in 8 requests. 1 failed.");
});

test("message: budget \"Paused after 50 automatic requests. 8 layers not loaded yet.\" with tone \"warn\" and action \"Load 8 more layers\"", () => {
  assert.deepEqual(msg("layers", 10, { done: 2, skipped: 8, requests: 50 }), {
    tone: "warn",
    text: "Paused after 50 automatic requests. 8 layers not loaded yet.",
    action: "Load 8 more layers"
  });
});

test("message: budget with 60 skipped offers \"Load 50 more services\"", () => {
  assert.equal(msg("services", 110, { done: 50, skipped: 60, requests: 50 }).action, "Load 50 more services");
});

test("message: pushback names HTTP 503, tone \"error\", action null", () => {
  const { SDT } = withJob("services", 8, { done: 2, skipped: 6, requests: 4 });
  SDT.state.pageLimiter.stats = () => ({ accepted: 4, active: 0, peak: 1, stopped: 503, max: 50 });
  assert.deepEqual(plain(SDT.status.message(SDT.status.snapshot())), {
    tone: "error",
    text: "The server asked for fewer requests (HTTP 503). Automatic requests stopped on this page.",
    action: null
  });
});

test("message: one row says \"1 service\" and \"1 request\"", () => {
  assert.equal(msg("services", 1, { done: 1, requests: 1 }).text, "Loaded details for 1 service in 1 request");
  assert.equal(msg("layers", 1, {}).text, "Loading details: 0 of 1 layer");
});

test("message: no job and nothing reported returns null", () => {
  const SDT = setup();
  assert.equal(SDT.status.message(SDT.status.snapshot()), null);
  assert.equal(plain(SDT.status.message({ total: 0, done: 0, failed: 0, skipped: 0, requests: 0, kind: "services" })), null);
});

test("job.fetch counts accepted requests only: a refused \"limit\" result adds nothing", async () => {
  const SDT = setup({ max: 2 });
  const job = SDT.status.job("services", 3);
  assert.equal((await job.fetch(at(1))).data !== undefined, true);
  await job.fetch(at(2));
  const refused = await job.fetch(at(3));
  assert.equal(refused.error.type, "limit");
  assert.equal(plain(SDT.status.snapshot()).requests, 2);
  const elsewhere = await job.fetch("https://other.example.org/rest/services/X/MapServer");
  assert.equal(elsewhere.error.type, "destination");
  assert.equal(plain(SDT.status.snapshot()).requests, 2);
});

test("loadMore extends the limiter by 50, then calls the callback once, even when called twice before it settles", async () => {
  const SDT = setup({ max: 1 });
  const job = SDT.status.job("services", 3);
  await job.fetch(at(1));
  job.skipped();
  let calls = 0;
  let release;
  job.onLoadMore(() => new Promise((resolve) => {
    calls += 1;
    release = resolve;
  }));
  assert.equal(plain(SDT.status.snapshot()).canLoadMore, true);
  const first = SDT.status.loadMore();
  const second = SDT.status.loadMore();
  await flush();
  assert.equal(calls, 1);
  assert.equal(SDT.state.pageLimiter.stats().max, 51);
  release();
  await Promise.all([first, second]);
  assert.equal(SDT.state.pageLimiter.stats().max, 51);
});

test("loadMore does nothing after pushback", async () => {
  const SDT = setup({ answer: () => ({ error: { type: "http", status: 503, message: "busy" } }) });
  const job = SDT.status.job("services", 2);
  job.skipped();
  let calls = 0;
  job.onLoadMore(async () => {
    calls += 1;
  });
  await job.fetch(at(1));
  assert.equal(plain(SDT.status.snapshot()).stopped, 503);
  assert.equal(plain(SDT.status.snapshot()).canLoadMore, false);
  await SDT.status.loadMore();
  assert.equal(calls, 0);
  assert.equal(SDT.state.pageLimiter.stats().max, 50);
});

test("retrying moves rows from skipped back to pending", () => {
  const { job, snap } = withJob("layers", 3);
  job.done();
  job.skipped();
  job.skipped();
  job.retrying(2);
  assert.equal(snap().skipped, 0);
  assert.equal(snap().busy, true);
});

test("subscribe is called after each report, and unsubscribe stops it", () => {
  const { SDT, job } = withJob("services", 3);
  const seen = [];
  const off = SDT.status.subscribe((snapshot) => seen.push(snapshot.done + snapshot.failed));
  job.done();
  job.failed();
  assert.deepEqual(seen, [1, 2]);
  off();
  job.done();
  assert.deepEqual(seen, [1, 2]);
});

test("running the file twice keeps the same state", async () => {
  const { SDT, context } = (() => {
    const context = loadLib();
    context.SDT.state = { pageLimiter: context.SDT.net.createLimiter({ scope: SCOPE, fetchJson: async () => ({ data: {} }) }) };
    return { SDT: context.SDT, context };
  })();
  SDT.status.job("layers", 4).done();
  const { runFile } = await import("./helpers/sdt.js");
  runFile(context, "src/lib/status.js");
  const snapshot = plain(context.SDT.status.snapshot());
  assert.deepEqual([snapshot.total, snapshot.done, snapshot.kind], [4, 1, "layers"]);
});
