// SDT.theme: matches the extension's in-page additions to the host page (UI design review, section
// 5.2). It reads the page's computed background, picks the light or dark palette, and sets
// data-sdt-theme="light" or "dark" on <html>, where src/src/lib/sdt.css keys its dark tokens. On a
// mid-grey page, where muted text would fall under 4.5:1, it also sets data-sdt-contrast="more".
// The popup and the options page don't use it: they follow prefers-color-scheme.
globalThis.SDT ??= {};

SDT.theme = {
  // Below this relative luminance, white text contrasts more with the background than black does.
  THRESHOLD: 0.179,
  // WCAG 2.2 SC 1.4.3 for muted text, which annotations on the page use.
  TEXT_CONTRAST: 4.5,
  // --sdt-fg-muted in each palette. tests/unit/theme.test.js checks these against sdt.css.
  MUTED: { light: "#4f5a59", dark: "#a7b2b1" },
  // The colour Chrome paints behind a page with no background of its own.
  CANVAS: { light: { r: 255, g: 255, b: 255, a: 1 }, dark: { r: 18, g: 18, b: 18, a: 1 } },
  // Changes to the page within this time are checked together, once.
  DELAY_MS: 500,
  // The attributes the check writes, which its observer ignores.
  ATTRIBUTES: ["data-sdt-theme", "data-sdt-contrast"],

  /**
   * A colour from a computed style ("rgb(1, 2, 3)", "rgba(1, 2, 3, 0.5)", "rgb(1 2 3 / 50%)") or a
   * hex value, as { r, g, b, a }; null for anything else, such as oklch() or color(display-p3 ...).
   */
  parseColor(text) {
    const value = String(text ?? "").trim().toLowerCase();
    const hex = value.match(/^#([0-9a-f]{6})$/);
    if (hex) {
      const [r, g, b] = [0, 2, 4].map((at) => parseInt(hex[1].slice(at, at + 2), 16));
      return { r, g, b, a: 1 };
    }
    if (value === "transparent") {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const rgb = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/);
    if (!rgb) {
      return null;
    }
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] ? 100 : 1);
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: Math.min(1, Math.max(0, alpha)) };
  },

  /** top painted over an opaque bottom. */
  over(top, bottom) {
    const mix = (channel) => top[channel] * top.a + bottom[channel] * (1 - top.a);
    return { r: mix("r"), g: mix("g"), b: mix("b"), a: 1 };
  },

  /** WCAG relative luminance of an opaque colour. */
  luminance({ r, g, b }) {
    const linear = (channel) => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  },

  /** WCAG contrast ratio of two opaque colours, from 1 to 21. */
  contrast(a, b) {
    const [high, low] = [SDT.theme.luminance(a), SDT.theme.luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  },

  /**
   * The canvas behind the page: dark when <html>'s color-scheme allows only dark, or allows dark
   * and the system prefers it; white otherwise ("normal", "light", or "light dark" on a light system).
   */
  canvas(colorScheme, prefersDark) {
    const schemes = String(colorScheme ?? "").toLowerCase().split(/\s+/);
    const dark = schemes.includes("dark") && (!schemes.includes("light") || prefersDark);
    return SDT.theme.CANVAS[dark ? "dark" : "light"];
  },

  /**
   * The colour the page shows behind the extension's additions: <body>'s background over <html>'s
   * over the canvas. A colour that can't be read counts as transparent.
   */
  background({ body, html, colorScheme, prefersDark = false }) {
    const layers = [html, body].map((text) => SDT.theme.parseColor(text)).filter(Boolean);
    return layers.reduce((under, layer) => SDT.theme.over(layer, under), SDT.theme.canvas(colorScheme, prefersDark));
  },

  /**
   * The decision for a page: { theme: "light" | "dark", contrast: "more" | null }. Takes the
   * computed backgroundColor of <body> and <html>, <html>'s computed colorScheme, and whether the
   * system prefers dark.
   */
  decide(styles) {
    const background = SDT.theme.background(styles);
    const theme = SDT.theme.luminance(background) < SDT.theme.THRESHOLD ? "dark" : "light";
    const muted = SDT.theme.parseColor(SDT.theme.MUTED[theme]);
    const contrast = SDT.theme.contrast(muted, background) < SDT.theme.TEXT_CONTRAST ? "more" : null;
    return { theme, contrast };
  },

  /** The decision for a document, from its computed styles. */
  read(doc) {
    const view = doc.defaultView;
    const html = view.getComputedStyle(doc.documentElement);
    return SDT.theme.decide({
      body: doc.body ? view.getComputedStyle(doc.body).backgroundColor : null,
      html: html.backgroundColor,
      colorScheme: html.colorScheme,
      prefersDark: view.matchMedia("(prefers-color-scheme: dark)").matches
    });
  },

  /** Sets the decision's attributes on root, writing only those that change. Returns how many it wrote. */
  apply(root, { theme, contrast }) {
    let writes = 0;
    if (root.getAttribute("data-sdt-theme") !== theme) {
      root.setAttribute("data-sdt-theme", theme);
      writes += 1;
    }
    if (contrast === "more" && root.getAttribute("data-sdt-contrast") !== "more") {
      root.setAttribute("data-sdt-contrast", "more");
      writes += 1;
    } else if (contrast !== "more" && root.hasAttribute("data-sdt-contrast")) {
      root.removeAttribute("data-sdt-contrast");
      writes += 1;
    }
    return writes;
  },

  /**
   * Checks doc now, then again whenever its style may have changed: attributes of <html> or <body>,
   * elements added to or removed from <head>, or the system's colour scheme. Changes within DELAY_MS
   * of the first are checked together, once. Records for the check's own attributes are ignored, so
   * it never reacts to its own writes. Returns a function that stops watching.
   */
  watch(doc) {
    const view = doc.defaultView;
    const root = doc.documentElement;
    let timer = null;
    const check = () => {
      timer = null;
      SDT.theme.apply(root, SDT.theme.read(doc));
    };
    const schedule = () => {
      if (timer === null) {
        timer = view.setTimeout(SDT.guard.wrap(check), SDT.theme.DELAY_MS);
      }
    };
    const own = (record) => record.type === "attributes" && record.target === root && SDT.theme.ATTRIBUTES.includes(record.attributeName);
    const observer = new view.MutationObserver(SDT.guard.wrap((records) => {
      if (records.some((record) => !own(record))) {
        schedule();
      }
    }));
    observer.observe(root, { attributes: true });
    if (doc.body) {
      observer.observe(doc.body, { attributes: true });
    }
    if (doc.head) {
      observer.observe(doc.head, { childList: true });
    }
    const unlisten = SDT.guard.listen(view.matchMedia("(prefers-color-scheme: dark)"), "change", schedule);
    check();
    return () => {
      observer.disconnect();
      unlisten();
      if (timer !== null) {
        view.clearTimeout(timer);
        timer = null;
      }
    };
  }
};
