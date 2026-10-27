// SDT.status: the page's progress model. inject.js opens a job and reports each row through it, and
// the status bar (status.js) renders snapshot() and message(). State lives in SDT.state.status, so
// running this file twice, or from two content-script groups, keeps one job.
globalThis.SDT ??= {};

SDT.status = {
  /** The shared state, created on first use. */
  state() {
    SDT.state ??= {};
    SDT.state.status ??= {
      kind: null,
      total: 0,
      done: 0,
      failed: 0,
      skipped: 0,
      requests: 0,
      callback: null,
      job: null,
      running: false,
      listeners: []
    };
    return SDT.state.status;
  },

  notify() {
    const snapshot = SDT.status.snapshot();
    for (const listener of [...SDT.status.state().listeners]) {
      try {
        listener(snapshot);
      } catch (error) {
        // One bad subscriber must not break row reporting or the other listeners; surface it later.
        setTimeout(() => {
          throw error;
        }, 0);
      }
    }
  },

  /** Opens the page's job, or adds total to the one already open. */
  job(kind, total) {
    const state = SDT.status.state();
    state.kind ??= kind; // a later kind is ignored: a page has one job
    state.total += total;
    if (state.job) {
      SDT.status.notify();
      return state.job;
    }
    const report = (field) => () => {
      state[field] += 1;
      SDT.status.notify();
    };
    state.job = {
      async fetch(url, options) {
        const limiter = SDT.net.pageLimiter();
        const before = limiter.stats().accepted;
        const promise = limiter.fetchJson(url, options);
        if (limiter.stats().accepted > before) {
          state.requests += 1;
          SDT.status.notify();
        }
        return promise;
      },
      done: report("done"),
      failed: report("failed"),
      skipped: report("skipped"),
      /** Moves n rows from skipped back to pending, before Load more runs them again. */
      retrying(n) {
        state.skipped = Math.max(0, state.skipped - n);
        SDT.status.notify();
      },
      onLoadMore(fn) {
        state.callback = fn;
        SDT.status.notify();
      }
    };
    SDT.status.notify();
    return state.job;
  },

  snapshot() {
    const state = SDT.status.state();
    const stats = SDT.net.pageLimiter().stats();
    return {
      busy: state.done + state.failed + state.skipped < state.total,
      kind: state.kind,
      total: state.total,
      done: state.done,
      failed: state.failed,
      skipped: state.skipped,
      requests: state.requests,
      stopped: stats.stopped ?? null,
      max: stats.max,
      canLoadMore: state.skipped > 0 && !stats.stopped && typeof state.callback === "function"
    };
  },

  /** Calls fn(snapshot) after every change. Returns a function that stops it. */
  subscribe(fn) {
    const listener = SDT.guard.wrap(fn);
    const { listeners } = SDT.status.state();
    listeners.push(listener);
    return () => {
      const at = listeners.indexOf(listener);
      if (at >= 0) {
        listeners.splice(at, 1);
      }
    };
  },

  /** Raises the budget by one batch and re-runs the skipped rows. A second press while it runs does nothing. */
  async loadMore() {
    const state = SDT.status.state();
    if (state.running || !SDT.status.snapshot().canLoadMore) {
      return;
    }
    state.running = true;
    try {
      SDT.net.pageLimiter().extend(SDT.net.BUDGET.max);
      await state.callback();
    } finally {
      state.running = false;
      SDT.status.notify();
    }
  },

  /** The status bar's copy for a snapshot, or null while there is nothing to say. */
  message(snapshot) {
    const { kind, total, done, failed, skipped, requests, stopped } = snapshot;
    if (!kind || (total === 0 && done + failed + skipped === 0)) {
      return null;
    }
    const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;
    const noun = kind === "layers" ? "layer" : "service";
    if (stopped) {
      return {
        tone: "error",
        text: `The server asked for fewer requests (HTTP ${stopped}). Automatic requests stopped on this page.`,
        action: null
      };
    }
    if (done + failed + skipped < total) {
      return {
        tone: undefined,
        text: `Loading details: ${done + failed} of ${plural(total, noun)}${failed > 0 ? `, ${failed} failed` : ""}`,
        action: null
      };
    }
    if (skipped > 0) {
      return {
        tone: "warn",
        text: `Paused after ${plural(requests, "automatic request")}. ${plural(skipped, noun)} not loaded yet.`,
        action: `Load ${plural(Math.min(skipped, SDT.net.BUDGET.max), noun).replace(/^(\d+) /, "$1 more ")}`
      };
    }
    return {
      tone: "ok",
      text: `Loaded details for ${plural(done, noun)} in ${plural(requests, "request")}${failed > 0 ? `. ${failed} failed.` : ""}`,
      action: null
    };
  }
};
