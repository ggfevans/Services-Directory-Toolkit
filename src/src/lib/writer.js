// SDT.writer: saves settings, for the options page and, from Phase 9, the popup's switches. It writes
// only the keys that changed, checks Chrome's sync quotas before writing anything, and reports
// Chrome's error. No content-script group loads this file: content scripts never write to
// chrome.storage (store-readiness spec, section 4.4).
globalThis.SDT ??= {};

SDT.writer = {
  /**
   * The bytes Chrome's sync quota counts for one item: the key plus the value as JSON, in UTF-8.
   * Chrome's JSON writer differs from JSON.stringify in three ways: it writes "<" as \u003C, and
   * U+2028 and U+2029 as \u2028 and \u2029, six bytes each, and it stores a lone surrogate as U+FFFD.
   */
  itemBytes(key, value) {
    const json = JSON.stringify(typeof value === "string" ? value.toWellFormed() : value)
      .replace(/[<\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
    return SDT.settings.byteLength(key) + SDT.settings.byteLength(json);
  },

  /**
   * The items to write, as { sync: {...}, local: {...} }. values holds the new, validated values,
   * loaded the values the page showed, and stored the raw values in storage now, from
   * SDT.settings.readStored. A key is written when its new value differs from the stored one (a
   * missing key holds its default) and the user changed it on this page or the stored value is
   * invalid. So a key that another window changed after this page loaded keeps that window's value,
   * unless the user changed it here too, and an invalid stored value is repaired.
   */
  changes(values, loaded, stored) {
    const out = { sync: {}, local: {} };
    for (const [key, value] of Object.entries(values)) {
      const entry = SDT.settings.entry(key);
      const present = Object.hasOwn(stored[entry.area], key);
      const raw = present ? stored[entry.area][key] : entry.default;
      const invalid = present && !SDT.settings.isValid(key, raw);
      if (value !== raw && (value !== loaded[key] || invalid)) {
        out[entry.area][key] = value;
      }
    }
    return out;
  },

  /**
   * Whether writing items to sync storage would break a quota. inUse is the area's bytes in use,
   * replaced the bytes the items' keys use now, and perItem and total Chrome's limits. Returns
   * { key, bytes, limit } for the first item over perItem, { key: null, bytes, limit } when the
   * area would end up over total, or null.
   */
  quotaProblem(items, { inUse, replaced, perItem, total }) {
    let added = 0;
    for (const [key, value] of Object.entries(items)) {
      const bytes = SDT.writer.itemBytes(key, value);
      if (bytes > perItem) {
        return { key, bytes, limit: perItem };
      }
      added += bytes;
    }
    const after = inUse - replaced + added;
    return after > total ? { key: null, bytes: after, limit: total } : null;
  },

  /** Chrome's error message, without a closing full stop. */
  message(error) {
    return String(error?.message ?? error).replace(/\.+$/, "");
  },

  /** Puts back the previous raw values of keys in an area, removing those that had none. */
  async restore(area, keys, previous) {
    const present = keys.filter((key) => Object.hasOwn(previous, key));
    const absent = keys.filter((key) => !Object.hasOwn(previous, key));
    try {
      if (present.length) {
        await chrome.storage[area].set(Object.fromEntries(present.map((key) => [key, previous[key]])));
      }
      if (absent.length) {
        await chrome.storage[area].remove(absent);
      }
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Saves values, validated { key: value } pairs, given the values the page loaded. Resolves to:
   * - { written: [keys] } after every write succeeded (empty when nothing changed)
   * - { quota: { key, bytes, limit } } when a sync quota would be broken; nothing was written
   * - { error, changed: [keys] } when Chrome refused a write; changed lists the keys that stayed
   *   written, which is empty unless undoing an earlier write failed too
   * Local storage is written first: its one key is far below its 10 MB quota, while sync has
   * per-item, total and per-minute quotas. If the sync write then fails, the local write is undone.
   */
  async save(values, loaded) {
    const stored = await SDT.settings.readStored(Object.keys(values));
    const { sync, local } = SDT.writer.changes(values, loaded, stored);
    const syncKeys = Object.keys(sync);
    const localKeys = Object.keys(local);
    if (syncKeys.length) {
      const area = chrome.storage.sync;
      const quota = SDT.writer.quotaProblem(sync, {
        inUse: await area.getBytesInUse(null),
        replaced: await area.getBytesInUse(syncKeys),
        perItem: area.QUOTA_BYTES_PER_ITEM,
        total: area.QUOTA_BYTES
      });
      if (quota) {
        return { quota };
      }
    }
    if (localKeys.length) {
      try {
        await chrome.storage.local.set(local);
      } catch (error) {
        return { error: SDT.writer.message(error), changed: [] };
      }
    }
    if (syncKeys.length) {
      try {
        await chrome.storage.sync.set(sync);
      } catch (error) {
        const undone = await SDT.writer.restore("local", localKeys, stored.local);
        return { error: SDT.writer.message(error), changed: undone ? [] : localKeys };
      }
    }
    return { written: [...localKeys, ...syncKeys] };
  }
};
