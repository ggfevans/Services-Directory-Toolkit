// SDT.settings: every setting the extension stores, defined once (store-readiness spec, Phase 4).
// Readers get validated values: a missing or invalid stored value reads as the default, so no
// caller ever sees a value the schema doesn't allow (spec section 4.4). Content scripts, the options
// page and the popup load this file. src/src/lib/writer.js does the writing, and no content script
// loads it.
globalThis.SDT ??= {};

SDT.settings = {
  /**
   * One entry per setting: key, type ("boolean", "choice", "integer", "text" or "json"), default,
   * values (choice), aliases (choice: old stored values and what they read as), min and max (integer:
   * the range; json: max is the size limit in UTF-8 bytes), label (the words the options page and the
   * popup show), and area (the chrome.storage area: "sync" or "local").
   */
  schema: Object.freeze([
    { key: "autoMetadata", type: "boolean", default: true, label: "Load service details and spatial references", area: "sync" },
    { key: "autoFeatureCounts", type: "boolean", default: true, label: "Count features in each layer", area: "sync" },
    { key: "showMapImages", type: "boolean", default: true, label: "Show map previews on hover", area: "sync" },
    { key: "mapImageWidth", type: "integer", default: 300, min: 50, max: 2000, label: "Preview image width (px)", area: "sync" },
    { key: "mapImageHeight", type: "integer", default: 200, min: 50, max: 2000, label: "Preview image height (px)", area: "sync" },
    {
      key: "queryHelperSelectAll",
      type: "choice",
      default: "get",
      values: ["get", "post", "donothing"],
      // The in-page form, removed in Phase 3, stored "nothing" (SET-1).
      aliases: { nothing: "donothing" },
      label: "Quick queries that fill and run the form",
      area: "sync"
    },
    { key: "defaultWhereClause", type: "text", default: "", label: "Default where clause", area: "sync" },
    // Print web maps often hold internal URLs or tokens, so this one stays on this computer (spec section 3).
    { key: "defaultWebMapAsJSON", type: "json", default: "", max: 102400, label: "Saved web map (JSON)", area: "local" }
  ].map((entry) => Object.freeze({
    values: null,
    aliases: null,
    min: null,
    max: null,
    ...entry,
    ...(entry.values && { values: Object.freeze(entry.values) }),
    ...(entry.aliases && { aliases: Object.freeze(entry.aliases) })
  }))),

  /** Every key, in schema order. */
  keys() {
    return SDT.settings.schema.map((entry) => entry.key);
  },

  /** The schema entry for key. Throws for a key the schema doesn't have. */
  entry(key) {
    const found = SDT.settings.schema.find((entry) => entry.key === key);
    if (!found) {
      throw new Error(`Unknown setting: ${key}`);
    }
    return found;
  },

  /** A new object with every key and its default. */
  defaults() {
    return Object.fromEntries(SDT.settings.schema.map((entry) => [entry.key, entry.default]));
  },

  /** The length of text in UTF-8 bytes, the way Chrome's storage quotas count it. */
  byteLength(text) {
    return new TextEncoder().encode(text).length;
  },

  /**
   * What is wrong with text as the value of a json entry: { size: bytes } when it is over entry.max,
   * { syntax: true } when it isn't a JSON object, or null. Empty text is fine.
   */
  jsonProblem(entry, text) {
    if (text === "") {
      return null;
    }
    const bytes = SDT.settings.byteLength(text);
    if (bytes > entry.max) {
      return { size: bytes };
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { syntax: true };
    }
    return data && typeof data === "object" && !Array.isArray(data) ? null : { syntax: true };
  },

  /** raw as a stored value of key: raw if the schema allows it, an alias's value, or the default. */
  validate(key, raw) {
    const entry = SDT.settings.entry(key);
    switch (entry.type) {
      case "boolean":
        return typeof raw === "boolean" ? raw : entry.default;
      case "integer":
        return Number.isInteger(raw) && raw >= entry.min && raw <= entry.max ? raw : entry.default;
      case "choice":
        if (entry.values.includes(raw)) {
          return raw;
        }
        return typeof raw === "string" && entry.aliases && Object.hasOwn(entry.aliases, raw) ? entry.aliases[raw] : entry.default;
      case "text":
        return typeof raw === "string" ? raw : entry.default;
      case "json":
        return typeof raw === "string" && SDT.settings.jsonProblem(entry, raw) === null ? raw : entry.default;
      default:
        return entry.default;
    }
  },

  /** Whether raw is a value the schema allows for key, as stored. A missing value isn't. */
  isValid(key, raw) {
    return raw !== undefined && SDT.settings.validate(key, raw) === raw;
  },

  /**
   * Reads what the user entered in key's control: a boolean for a checkbox, a string otherwise.
   * Returns { value } with the value to store, or { error } with the message to show under the field.
   */
  parse(key, input) {
    const entry = SDT.settings.entry(key);
    if (entry.type === "integer") {
      const text = String(input).trim();
      const value = /^\d+$/.test(text) ? Number(text) : NaN;
      return value >= entry.min && value <= entry.max
        ? { value }
        : { error: `Enter a whole number from ${entry.min} to ${entry.max}.` };
    }
    if (entry.type === "json") {
      const text = String(input).trim() === "" ? "" : String(input);
      const problem = SDT.settings.jsonProblem(entry, text);
      if (problem?.size) {
        return { error: `This web map is ${Math.ceil(problem.size / 1024)} KB. The limit is ${entry.max / 1024} KB.` };
      }
      return problem ? { error: "Enter valid JSON for a web map object, or leave it empty." } : { value: text };
    }
    return SDT.settings.isValid(key, input) ? { value: input } : { error: "Choose one of the options." };
  },

  /** The raw stored values of keys, as { sync: {...}, local: {...} }, each read from its own area. */
  async readStored(keys = SDT.settings.keys()) {
    const stored = { sync: {}, local: {} };
    const byArea = { sync: [], local: [] };
    keys.forEach((key) => byArea[SDT.settings.entry(key).area].push(key));
    await Promise.all(Object.entries(byArea)
      .filter(([, names]) => names.length)
      .map(async ([area, names]) => {
        stored[area] = await chrome.storage[area].get(names);
      }));
    return stored;
  },

  /**
   * Resolves to { key: value } for keys (every key by default), each validated. Like fetchJson in
   * net.js, it never settles once an extension update has cut the script off, so no code that
   * awaits it runs in a cut-off content script. Rejects only on another storage error.
   */
  async read(keys = SDT.settings.keys()) {
    let stored;
    try {
      stored = await SDT.settings.readStored(keys);
    } catch (error) {
      if (!SDT.guard.alive() || SDT.guard.isInvalidated(error)) {
        return new Promise(() => {});
      }
      throw error;
    }
    if (!SDT.guard.alive()) {
      return new Promise(() => {});
    }
    return Object.fromEntries(keys.map((key) => [key, SDT.settings.validate(key, stored[SDT.settings.entry(key).area][key])]));
  }
};
