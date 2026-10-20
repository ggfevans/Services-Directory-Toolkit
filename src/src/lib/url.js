// SDT.url: builds request URLs, and cleans link hrefs for the link filters. The builder takes the
// token as an argument and never reads location, so a later feature can supply a token from
// elsewhere. It attaches the token only inside the token's scope, and only in a POST body.
globalThis.SDT ??= {};

SDT.url = {
  PROTOCOLS: ["http:", "https:", "chrome-extension:"],

  /** url.href without a trailing "?", which some URL implementations leave after deleting the last parameter. */
  tidy(url) {
    const href = url.href;
    return href.endsWith("?") ? href.slice(0, -1) : href;
  },

  /**
   * Deletes every query parameter of url named in names, whatever its case. ArcGIS reads parameter
   * names without regard to case, so Token= and TOKEN= are tokens too.
   */
  dropParams(url, names) {
    const lower = new Set([...names].map((name) => name.toLowerCase()));
    [...url.searchParams.keys()]
      .filter((key) => lower.has(key.toLowerCase()))
      .forEach((key) => url.searchParams.delete(key));
  },

  /**
   * Builds a request. token is { value, scope } or null. Returns { url, method, body, carriesToken },
   * or null when base isn't an http(s) or extension URL. A token in base itself, in any case, is always dropped.
   */
  build(base, params = {}, token = null, { method = "GET" } = {}) {
    let url;
    try {
      url = new URL(base);
    } catch {
      return null;
    }
    if (!SDT.url.PROTOCOLS.includes(url.protocol)) {
      return null;
    }
    url.hash = "";
    SDT.url.dropParams(url, ["token"]);
    const entries = Object.entries(params ?? {})
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)]);
    const carriesToken = Boolean(token && token.value && token.scope) && SDT.auth.scopeOf(url.href) === token.scope;
    // A param replaces any parameter of the same name in base, whatever its case.
    SDT.url.dropParams(url, entries.map(([key]) => key));
    if (carriesToken || method === "POST") {
      const body = new URLSearchParams(entries);
      if (carriesToken) {
        body.set("token", token.value);
      }
      return { url: SDT.url.tidy(url), method: "POST", body, carriesToken };
    }
    entries.forEach(([key, value]) => url.searchParams.append(key, value));
    return { url: SDT.url.tidy(url), method: "GET", body: null, carriesToken: false };
  },

  /**
   * href without its fragment or any token parameter, for error objects and messages. Returns ""
   * for a URL that doesn't parse, because its token can't be found.
   */
  withoutToken(href) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return "";
    }
    url.hash = "";
    SDT.url.dropParams(url, ["token"]);
    return SDT.url.tidy(url);
  },

  /** href without its fragment or any token and f parameters, for the link filters (TOK-3). */
  stripForFilter(href) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return String(href ?? "");
    }
    url.hash = "";
    SDT.url.dropParams(url, ["token", "f"]);
    return SDT.url.tidy(url);
  }
};
