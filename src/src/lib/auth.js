// SDT.auth: the token scope (token support spec, section 5.1). A page's token goes only to URLs in
// the page's scope: the origin plus the path before the first whole-segment rest/services.
globalThis.SDT ??= {};

SDT.auth = {
  // Instance-path segments that never take a token: the Administrator Directory, the token
  // service and Manager.
  OUTSIDE: ["admin", "tokens", "manager"],

  /** True for ArcGIS Online's hosted services and tiles hosts, where an org ID is case-sensitive. */
  isHosted(hostname) {
    return /^(?:services|tiles)(?:qa|dev)?\d*\.arcgis\.com$/i.test(hostname);
  },

  /**
   * Splits a pathname at its first whole-segment rest/services, in any case. Returns the segments
   * before it and the non-empty ones after it, still percent-encoded, or null.
   */
  splitRest(pathname) {
    const segments = String(pathname).split("/").slice(1);
    for (let i = 0; i < segments.length - 1; i++) {
      if (segments[i].toLowerCase() === "rest" && segments[i + 1].toLowerCase() === "services") {
        return { instance: segments.slice(0, i), tail: segments.slice(i + 2).filter(Boolean) };
      }
    }
    return null;
  },

  /**
   * The scope of url as a string, such as "https://gis.example.org/server", or null. Reads only the
   * parsed pathname. Two URLs share a scope exactly when their strings are equal.
   */
  scopeOf(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    const split = SDT.auth.splitRest(parsed.pathname);
    if (!split) {
      return null;
    }
    // new URL has resolved dot segments, %2e ones included. An encoded slash, dot, percent sign or
    // backslash that survives could mean something else to a server that decodes again, so such a
    // path gets no scope (owner's decision on issue #44).
    if (split.instance.some((segment) => /%(?:2[ef5]|5c)/i.test(segment))) {
      return null;
    }
    if (split.instance.some((segment) => SDT.auth.OUTSIDE.includes(segment.toLowerCase()))) {
      return null;
    }
    // Instance paths match in any case, except an ArcGIS Online org ID.
    const hosted = SDT.auth.isHosted(parsed.hostname);
    const path = split.instance.map((segment) => (!hosted || /^(?:arcgis|tiles)$/i.test(segment) ? segment.toLowerCase() : segment));
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path.map((segment) => `/${segment}`).join("")}`;
  },

  /**
   * The page URL's token and the page's scope, or null. ArcGIS reads parameter names in any case, so
   * Token= counts too; the first non-empty one wins. An empty token is never used.
   */
  pageToken(location) {
    const entry = [...new URLSearchParams(location.search)].find(([key, token]) => /^token$/i.test(key) && token);
    const value = entry?.[1];
    const scope = value ? SDT.auth.scopeOf(location.href) : null;
    return value && scope ? { value, scope } : null;
  }
};
