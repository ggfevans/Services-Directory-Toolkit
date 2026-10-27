{
  // The status bar (design review section 6.3, #14): one line in the page flow, right after the
  // page's first <h2>, or first in <body> when there is none. It shows the glyph, "SD Toolkit" and
  // the message from SDT.status.message(), in a role="status" live region. While only <body>'s busy
  // classes say the page is working (a class starting sdt-loading-, which mapImages.js and
  // queryTest.js set), it says "Loading". The bar appears with the first message or busy class, so
  // a page with nothing to report has none. Its only listener is the Load more button's (SEC-1,
  // ADV-3); settings live on the options page. It also starts the theme check
  // (src/src/lib/theme.js), because it runs on every Services Directory page and on no other.
  const NAME = "SD Toolkit";
  const LOADING = "Loading";
  const FINISHED = "Finished loading";
  // The message changes at most once a second, so screen readers aren't flooded (WCAG 4.1.3).
  const THROTTLE_MS = 1000;
  const ICONS = { ok: "check", warn: "warn", error: "error" };
  const isBusy = (className) => /(?:^|\s)sdt-loading-/.test(className ?? "");

  // Enable the toolbar button for this tab (see src/src/bg/background.js). Re-send when the page is
  // restored from the back/forward cache, or shown after prerendering, because Chrome clears the
  // tab's action state on navigation, and the service worker ignores messages from documents that
  // aren't active.
  const enableAction = () => chrome.runtime.sendMessage({ type: "enableAction" });

  /** The bar, built empty: the glyph and name, then the live region holding an icon and a text node. */
  const build = (body) => {
    const bar = SDT.dom.loadElement("div", { "class": "sdt sdt-statusbar" });
    const name = SDT.dom.loadElement("span", { "class": "sdt-statusbar__name" });
    name.appendChild(SDT.icon("glyph"));
    name.appendChild(SDT.dom.text(NAME));
    const status = SDT.dom.loadElement("p", { "class": "sdt-status", role: "status" });
    const text = SDT.dom.text("");
    status.appendChild(text);
    bar.appendChild(name);
    bar.appendChild(status);
    const heading = body.querySelector("h2");
    if (heading) {
      heading.after(bar);
    } else {
      body.prepend(bar);
    }
    return { bar, status, text, icon: null, iconName: null, actions: null, button: null };
  };

  /**
   * Keeps the bar in step with SDT.status and <body>'s busy classes. Each write shows the whole
   * state, at most once a second; a change inside the wait is applied when the wait ends, so the
   * last state always lands.
   */
  const watch = (body) => {
    let view = null;
    let seenBusy = false;
    // True from a Load more click until its batch settles: the button stays disabled meanwhile.
    let loading = false;
    let lastWrite = 0;
    let timer = null;
    let shown = null;

    /** What the bar should say, or null while there is nothing to report. */
    const wanted = () => {
      const message = SDT.status.message(SDT.status.snapshot());
      if (message) {
        return message;
      }
      if (isBusy(body.className)) {
        return { tone: undefined, text: LOADING, action: null };
      }
      return seenBusy ? { tone: "ok", text: FINISHED, action: null } : null;
    };
    const keyOf = (state) => JSON.stringify([state.tone ?? null, state.text, state.action, loading]);

    const loadMore = () => {
      if (loading) {
        return;
      }
      loading = true;
      view.button.disabled = true;
      SDT.status.loadMore().finally(SDT.guard.wrap(() => {
        loading = false;
        update();
      }));
    };

    /** Shows the icon for the tone (the spinner while busy), the text and the action button. */
    const render = (state) => {
      for (const element of [view.bar, view.status]) {
        if (state.tone) {
          element.setAttribute("data-tone", state.tone);
        } else {
          element.removeAttribute("data-tone");
        }
      }
      // Replace the icon only when it changes, so the spinner keeps turning smoothly.
      const iconName = ICONS[state.tone] ?? "spinner";
      if (iconName !== view.iconName) {
        const icon = iconName === "spinner"
          ? SDT.dom.loadElement("span", { "class": "sdt-spinner", "aria-hidden": "true" })
          : SDT.icon(iconName);
        if (view.icon) {
          view.icon.replaceWith(icon);
        } else {
          view.status.prepend(icon);
        }
        view.icon = icon;
        view.iconName = iconName;
      }
      if (view.text.nodeValue !== state.text) {
        view.text.nodeValue = state.text;
      }
      if (state.action && !view.actions) {
        view.actions = SDT.dom.loadElement("span", { "class": "sdt-statusbar__actions" });
        view.button = SDT.dom.loadElement("button", { "class": "sdt-button", type: "button" });
        view.actions.appendChild(view.button);
        view.bar.appendChild(view.actions);
        SDT.guard.listen(view.button, "click", loadMore);
      } else if (!state.action && view.actions) {
        view.actions.remove();
        view.actions = null;
        view.button = null;
      }
      if (view.button) {
        view.button.textContent = state.action;
        view.button.disabled = loading;
      }
    };

    const write = () => {
      timer = null;
      const state = wanted();
      if (state && keyOf(state) !== shown) {
        render(state);
        shown = keyOf(state);
        lastWrite = performance.now();
      }
    };

    const update = (records = []) => {
      // A busy class added and removed between two callbacks still counts as busy.
      seenBusy ||= isBusy(body.className) || records.some((record) => isBusy(record?.oldValue));
      const state = wanted();
      if (!state) {
        return;
      }
      if (!view) {
        view = build(body);
        // A live region announces changes, not what it holds when it appears, so the first message
        // also waits a second. The icon shows at once.
        render({ tone: state.tone, text: "", action: null });
        lastWrite = performance.now();
      }
      if (timer !== null || keyOf(state) === shown) {
        return;
      }
      timer = setTimeout(SDT.guard.wrap(write), Math.max(0, lastWrite + THROTTLE_MS - performance.now()));
    };

    new MutationObserver(SDT.guard.wrap(update)).observe(body, { attributes: true, attributeFilter: ["class"], attributeOldValue: true });
    SDT.status.subscribe(() => update());
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

    watch(document.body);
    // Match the extension's palette to this page's background, now and when the page's style changes.
    // Last, so the toolbar button and the status bar never depend on it.
    SDT.theme.watch(document);
  };

  SDT.guard.run(start);
}
