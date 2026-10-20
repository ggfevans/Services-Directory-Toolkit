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
   * docs/superpowers/plans/2026-10-20-phase-2-shared-core.md for the error types.
   */
  async fetchJson(url, { params = {}, token = null, method = "GET", timeoutMs = SDT.net.TIMEOUT_MS, signal, credentials, referrerPolicy } = {}) {
    const request = SDT.url.build(url, params, token, { method });
    if (!request) {
      return { error: { type: "url", message: "Not an http(s) URL.", url: String(url) } };
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
  }
};
