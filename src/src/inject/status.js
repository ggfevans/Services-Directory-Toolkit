{
  // The status indicator: a small ring in the bottom-right corner that spins while the extension's
  // scripts are busy, and a status line for screen readers. Busy means a class starting sdt-loading-
  // is on <body>, which inject.js, mapImages.js and queryTest.js set. The indicator takes no clicks
  // and has no click handler (SEC-1, ADV-3); settings live on the options page. Phase 5 moves it
  // into the page as the status bar (#14). It also starts the theme check (src/src/lib/theme.js),
  // because it runs on every Services Directory page and on no other.
  const SVG = "http://www.w3.org/2000/svg";
  const NAME = "Services Directory Toolkit";
  const LOADING = "SD Toolkit: loading";
  const DONE = "SD Toolkit: finished loading";
  // The status line changes at most once a second, so screen readers aren't flooded (WCAG 4.1.3).
  const THROTTLE_MS = 1000;
  const isBusy = (className) => /(?:^|\s)sdt-loading-/.test(className ?? "");

  // Enable the toolbar button for this tab (see src/src/bg/background.js). Re-send when the page is
  // restored from the back/forward cache, or shown after prerendering, because Chrome clears the
  // tab's action state on navigation, and the service worker ignores messages from documents that
  // aren't active.
  const enableAction = () => chrome.runtime.sendMessage({ type: "enableAction" });

  /** An SVG element with the given attributes. */
  const svgElement = (tag, attributes) => {
    const element = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, String(value));
    }
    return element;
  };

  /** The ring: an opaque disc, a grey track and a teal arc from twelve o'clock (see inject.css). */
  const ring = () => {
    const svg = svgElement("svg", { "class": "sdt-indicator__ring", role: "img", "aria-label": NAME, viewBox: "0 0 24 24", width: 24, height: 24 });
    svg.appendChild(svgElement("circle", { "class": "sdt-indicator__disc", cx: 12, cy: 12, r: 11.5 }));
    svg.appendChild(svgElement("circle", { "class": "sdt-indicator__track", cx: 12, cy: 12, r: 7, "stroke-width": 3 }));
    svg.appendChild(svgElement("circle", { "class": "sdt-indicator__arc", cx: 12, cy: 12, r: 7, "stroke-width": 3, transform: "rotate(-90 12 12)" }));
    return svg;
  };

  /**
   * Keeps the indicator in step with <body>'s busy classes. The spin follows at once; the status
   * line is empty until the first busy state, then says loading or finished, changing at most once a
   * second. A change inside the wait is applied when the wait ends, so the last state always lands.
   */
  const watch = (body, indicator, message) => {
    let seenBusy = false;
    // A live region announces changes, not what it holds when it appears, so the first message
    // also waits a second.
    let lastWrite = performance.now();
    let timer = null;

    const wanted = () => {
      if (isBusy(body.className)) {
        return LOADING;
      }
      return seenBusy ? DONE : "";
    };

    const write = () => {
      timer = null;
      const text = wanted();
      if (text !== message.textContent) {
        message.textContent = text;
        lastWrite = performance.now();
      }
    };

    const update = (records = []) => {
      const busy = isBusy(body.className);
      // A busy class added and removed between two callbacks still counts as busy.
      seenBusy ||= busy || records.some((record) => isBusy(record.oldValue));
      indicator.classList.toggle("sdt-indicator--busy", busy);
      if (timer !== null || wanted() === message.textContent) {
        return;
      }
      timer = setTimeout(SDT.guard.wrap(write), Math.max(0, lastWrite + THROTTLE_MS - performance.now()));
    };

    new MutationObserver(SDT.guard.wrap(update)).observe(body, { attributes: true, attributeFilter: ["class"], attributeOldValue: true });
    update();
  };

  const start = () => {
    // JSON views and pages that aren't Services Directory pages get nothing, not even the button.
    const type = SDT.page.classify(location, document);
    if (type === "jsonView" || type === "other") {
      return;
    }
    SDT.guard.whenActive(enableAction);
    SDT.guard.listen(window, "pageshow", (evt) => evt.persisted && enableAction());

    const indicator = SDT.dom.loadElement("div", { "class": "sdt-indicator" });
    const message = SDT.dom.loadElement("span", { "class": "sdt-visually-hidden", role: "status" });
    indicator.appendChild(ring());
    indicator.appendChild(message);
    document.body.appendChild(indicator);
    watch(document.body, indicator, message);
    // Match the extension's palette to this page's background, now and when the page's style changes.
    // Last, so the toolbar button and the indicator never depend on it.
    SDT.theme.watch(document);
  };

  SDT.guard.run(start);
}
