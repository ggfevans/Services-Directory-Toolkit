// SDT.net: every request the extension sends goes through fetchJson. It checks the HTTP status,
// treats an ArcGIS {"error"} body as an error, times out, keeps the browser's default credentials,
// and always resolves to { data } or { error }. A request that carries a token is a form POST with
// redirect: "manual", so the token never sits in a URL and never follows a redirect.
globalThis.SDT ??= {};

SDT.net = {
  TIMEOUT_MS: 20000,

  /** Replaces each bare NaN or -NaN outside a JSON string with null. */
  nanToNull(text) {
    let out = "";
    let inString = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        out += c;
        if (c === "\\") {
          out += text[i + 1] ?? "";
          i += 1;
        } else if (c === "\"") {
          inString = false;
        }
      } else if (c === "\"") {
        inString = true;
        out += c;
      } else if (c === "-" && text.startsWith("NaN", i + 1)) {
        out += "null";
        i += 3;
      } else if (text.startsWith("NaN", i)) {
        out += "null";
        i += 2;
      } else {
        out += c;
      }
    }
    return out;
  },

  /** JSON.parse, with one retry that maps bare NaN to null. Returns { data } or { error }. */
  parseJson(text) {
    try {
      return { data: JSON.parse(text) };
    } catch {
      // ArcGIS Server sometimes writes NaN where a number belongs. Try again without it.
    }
    try {
      return { data: JSON.parse(SDT.net.nanToNull(text)) };
    } catch {
      return { error: { type: "parse", message: "The server's answer isn't valid JSON." } };
    }
  },

  /**
   * Sends one request and resolves to { data } or { error }; it never rejects. See the Public API in
   * docs/superpowers/plans/2026-10-20-phase-2-shared-core.md for the error types. If an extension
   * update cuts the script off while the request is out, it never settles, so no code that awaits
   * it runs in the cut-off script.
   */
  async fetchJson(url, options) {
    const result = await SDT.net.send(url, options);
    return SDT.guard.alive() ? result : new Promise(() => {});
  },

  /** fetchJson without the guard. */
  async send(url, { params = {}, token = null, method = "GET", timeoutMs = SDT.net.TIMEOUT_MS, signal, credentials, referrerPolicy } = {}) {
    const request = SDT.url.build(url, params, token, { method });
    if (!request) {
      return { error: { type: "url", message: "Not an http(s) URL.", url: SDT.url.withoutToken(url) } };
    }
    const fail = (type, message, extra = {}) => ({ error: { type, message, url: request.url, ...extra } });
    const timeout = AbortSignal.timeout(timeoutMs);
    const init = { method: request.method, signal: signal ? AbortSignal.any([signal, timeout]) : timeout };
    if (request.body) {
      init.body = request.body;
    }
    if (request.carriesToken) {
      init.redirect = "manual";
    }
    if (credentials) {
      init.credentials = credentials;
    }
    if (referrerPolicy) {
      init.referrerPolicy = referrerPolicy;
    }
    const failure = () => {
      if (timeout.aborted) {
        return fail("timeout", `No answer within ${timeoutMs / 1000} s.`);
      }
      if (signal?.aborted) {
        return fail("aborted", "The request was cancelled.");
      }
      return fail("network", "The request failed before the server answered.");
    };
    let response;
    let text;
    try {
      response = await fetch(request.url, init);
      if (response.type === "opaqueredirect") {
        return fail("redirect", "The server answered with a redirect, which the toolkit doesn't follow for a request that carries a token.");
      }
      if (!response.ok) {
        return fail("http", `HTTP ${response.status}`, { status: response.status });
      }
      text = await response.text();
    } catch {
      return failure();
    }
    const parsed = SDT.net.parseJson(text);
    if (parsed.error) {
      return fail("parse", parsed.error.message);
    }
    const { data } = parsed;
    if (data && typeof data === "object" && !Array.isArray(data) && data.error && typeof data.error === "object") {
      return fail("arcgis", String(data.error.message ?? "The server reported an error."), { code: data.error.code, arcgis: data.error });
    }
    return { data };
  },

  /**
   * Transitional, for callers written for the old ajax helper: data, an ArcGIS error as { error },
   * or null for any other failure. Phases 5, 7 and 9 rewrite its callers to handle { error }.
   */
  legacyResponse(result) {
    if (!result.error) {
      return result.data;
    }
    return result.error.arcgis ? { error: result.error.arcgis } : null;
  },

  // Section 4.3 of the store-readiness spec: automatic requests per page view, and at once.
  BUDGET: { max: 50, concurrency: 4 },

  limitNote(max) {
    return `Not loaded: request limit reached (${max})`;
  },

  stoppedNote(status) {
    return `Not loaded: the server answered HTTP ${status}, so automatic requests stopped`;
  },

  /** True when a row was left out by the budget or after server pushback; show result.error.message. */
  isSkipped(result) {
    return result?.error?.type === "limit" || result?.error?.type === "stopped";
  },

  /**
   * A queue for automatic requests. It sends only to URLs in scope, accepts at most max, keeps at
   * most concurrency in flight, cancels everything on target's pagehide, and stops for good after an
   * HTTP 429 or 503. fetchJson(url, options) takes SDT.net.fetchJson's options and never rejects.
   */
  createLimiter({ max = SDT.net.BUDGET.max, concurrency = SDT.net.BUDGET.concurrency, scope = null, target = null, fetchJson = (url, options) => SDT.net.fetchJson(url, options) } = {}) {
    const controller = new AbortController();
    const queue = [];
    const state = { accepted: 0, active: 0, peak: 0, stopped: null, max };
    const refusal = (type, message, url, extra = {}) => ({ error: { type, message, url: SDT.url.withoutToken(url), ...extra } });
    const halted = (url) => (state.stopped
      ? refusal("stopped", SDT.net.stoppedNote(state.stopped), url, { status: state.stopped })
      : refusal("aborted", "Not loaded: the page was left.", url));
    // Like SDT.net.fetchJson: once an update has cut the script off, a job never settles.
    const settle = (job, result) => {
      if (SDT.guard.alive()) {
        job.resolve(result);
      }
    };
    const halt = () => {
      controller.abort();
      while (queue.length) {
        const job = queue.shift();
        settle(job, halted(job.url));
      }
    };
    const finish = (job, result) => {
      state.active -= 1;
      const status = result?.error?.status;
      if ((status === 429 || status === 503) && !state.stopped) {
        state.stopped = status;
        halt();
      }
      settle(job, state.stopped && result?.error ? halted(job.url) : result);
      pump();
    };
    const pump = () => {
      while (state.active < concurrency && queue.length) {
        const job = queue.shift();
        state.active += 1;
        state.peak = Math.max(state.peak, state.active);
        const signal = job.options.signal ? AbortSignal.any([job.options.signal, controller.signal]) : controller.signal;
        Promise.resolve(fetchJson(job.url, { ...job.options, signal })).then(
          (result) => finish(job, result),
          () => finish(job, refusal("network", "The request failed before the server answered.", job.url))
        );
      }
    };
    if (target) {
      target.addEventListener("pagehide", halt);
    }
    return {
      fetchJson(url, options = {}) {
        if (state.stopped || controller.signal.aborted) {
          return Promise.resolve(halted(url));
        }
        if (!scope || SDT.auth.scopeOf(url) !== scope) {
          return Promise.resolve(refusal("destination", "Not requested: the link is on another server.", url));
        }
        if (state.accepted >= state.max) {
          return Promise.resolve(refusal("limit", SDT.net.limitNote(state.max), url, { max: state.max }));
        }
        state.accepted += 1;
        return new Promise((resolve) => {
          queue.push({ url, options, resolve });
          pump();
        });
      },
      /** Raises the accepted cap by n. It does nothing once the limiter has stopped or been aborted. */
      extend(n) {
        if (state.stopped || controller.signal.aborted) {
          return;
        }
        state.max += n;
      },
      stats() {
        return { ...state };
      }
    };
  },

  /** The page's limiter, shared by every content script in the isolated world. */
  pageLimiter() {
    SDT.state ??= {};
    SDT.state.pageLimiter ??= SDT.net.createLimiter({ scope: SDT.auth.scopeOf(location.href), target: window });
    return SDT.state.pageLimiter;
  }
};
