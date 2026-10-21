// SDT.guard: keeps content scripts from failing after an extension update. Chrome then cuts off the
// old scripts: chrome.runtime.id reads undefined, and any chrome.* call throws "Extension context
// invalidated". Every entry point of a content script (its start, event listeners, timers and chrome
// callbacks) goes through run, wrap, listen or onLoad, so a cut-off script stops quietly.
globalThis.SDT ??= {};

SDT.guard = {
  /** True while this script's extension context is valid. */
  alive() {
    try {
      return Boolean(globalThis.chrome?.runtime?.id);
    } catch {
      return false;
    }
  },

  /** Whether error is Chrome's error for a call from a cut-off script. */
  isInvalidated(error) {
    return /Extension context invalidated/i.test(String(error?.message ?? error));
  },

  /** Calls fn(...args) while alive. Swallows invalidation errors, thrown or rejected; rethrows others. */
  run(fn, ...args) {
    if (!SDT.guard.alive()) {
      return undefined;
    }
    const swallow = (error) => {
      if (!SDT.guard.isInvalidated(error)) {
        throw error;
      }
      return undefined;
    };
    try {
      const result = fn(...args);
      return result && typeof result.then === "function" ? result.then(undefined, swallow) : result;
    } catch (error) {
      return swallow(error);
    }
  },

  /** A function that calls fn through run, with the same this and arguments. */
  wrap(fn) {
    return function (...args) {
      return SDT.guard.run(() => fn.apply(this, args));
    };
  },

  /**
   * Adds an event listener that calls handler through run. Once the context is gone, the next event
   * removes the listener. Returns a function that removes it.
   */
  listen(target, type, handler, options) {
    const listener = function (...args) {
      if (!SDT.guard.alive()) {
        target.removeEventListener(type, listener, options);
        return undefined;
      }
      return SDT.guard.run(() => handler.apply(this, args));
    };
    target.addEventListener(type, listener, options);
    return () => target.removeEventListener(type, listener, options);
  },

  /** Runs fn once the page has loaded: now, if it already has. */
  onLoad(fn) {
    if (!SDT.guard.alive()) {
      return;
    }
    if (document.readyState === "complete") {
      SDT.guard.run(fn);
    } else {
      SDT.guard.listen(window, "load", fn, { once: true });
    }
  },

  /**
   * Runs fn now, or, on a page that Chrome is prerendering, once the user is shown it. Chrome clears
   * a tab's action state when the prerendered page takes over the tab, and the service worker
   * ignores messages from a document that isn't active (BG-2).
   */
  whenActive(fn) {
    if (!SDT.guard.alive()) {
      return;
    }
    if (document.prerendering) {
      SDT.guard.listen(document, "prerenderingchange", fn, { once: true });
    } else {
      SDT.guard.run(fn);
    }
  }
};
