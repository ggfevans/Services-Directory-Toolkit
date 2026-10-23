// SDT.icon: the extension's icons as inline SVG, built with createElementNS from shape data, never
// from markup (UI design review, section 4.4). SDT.icon("warn") returns a 16 px stroked icon with
// class sdt-icon, and SDT.icon("glyph") the toolkit's mark with class sdt-glyph; sdt.css styles
// both. Every icon sits next to words, so it is hidden from assistive technology.
//
// The shapes are the <symbol>s in docs/design/mockups/*.html, which tests/unit/icon.test.js checks.
// The glyph is the design review's placeholder mark; the Track S artwork (#50, #55) replaces only
// its shape data.
globalThis.SDT ??= {};

SDT.icon = Object.assign((name) => {
  if (!Object.hasOwn(SDT.icon.ICONS, name)) {
    throw new Error(`Unknown icon: ${name}`);
  }
  const icon = SDT.icon.ICONS[name];
  const create = (tag, attributes) => {
    const element = document.createElementNS(SDT.icon.SVG, tag);
    for (const [key, value] of Object.entries(attributes)) {
      element.setAttribute(key, String(value));
    }
    return element;
  };
  const svg = create("svg", {
    "class": name === "glyph" ? "sdt-glyph" : "sdt-icon",
    viewBox: icon.viewBox,
    width: 16,
    height: 16,
    "aria-hidden": "true",
    focusable: "false"
  });
  for (const [tag, attributes] of icon.shapes) {
    svg.appendChild(create(tag, attributes));
  }
  return svg;
}, {
  SVG: "http://www.w3.org/2000/svg",

  /** Each icon's viewBox and its shapes, as [tag, attributes] pairs. */
  ICONS: Object.freeze({
    check: { viewBox: "0 0 24 24", shapes: [["path", { d: "M5 12.5l4.5 4.5L19 7" }]] },
    "chev-l": { viewBox: "0 0 24 24", shapes: [["path", { d: "M15 5l-7 7 7 7" }]] },
    "chev-r": { viewBox: "0 0 24 24", shapes: [["path", { d: "M9 5l7 7-7 7" }]] },
    copy: {
      viewBox: "0 0 24 24",
      shapes: [
        ["rect", { x: "8", y: "8", width: "12", height: "12", rx: "2" }],
        ["path", { d: "M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" }]
      ]
    },
    error: {
      viewBox: "0 0 24 24",
      shapes: [["circle", { cx: "12", cy: "12", r: "9" }], ["path", { d: "M12 7.5v5.5" }], ["path", { d: "M12 16.3v.1" }]]
    },
    external: {
      viewBox: "0 0 24 24",
      shapes: [["path", { d: "M14 4h6v6" }], ["path", { d: "M20 4l-9 9" }], ["path", { d: "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" }]]
    },
    glyph: {
      viewBox: "0 0 16 16",
      shapes: [
        ["rect", { "class": "sdt-glyph__bg", width: "16", height: "16", rx: "4" }],
        ["path", { "class": "sdt-glyph__mark", d: "M5 3.5v9M5 6h4.5M5 10.5h4.5" }],
        ["circle", { "class": "sdt-glyph__dot", cx: "11.2", cy: "6", r: "1.4" }],
        ["circle", { "class": "sdt-glyph__dot", cx: "11.2", cy: "10.5", r: "1.4" }]
      ]
    },
    info: {
      viewBox: "0 0 24 24",
      shapes: [["circle", { cx: "12", cy: "12", r: "9" }], ["path", { d: "M12 11v5.5" }], ["path", { d: "M12 7.7v.1" }]]
    },
    insert: { viewBox: "0 0 24 24", shapes: [["path", { d: "M19 5v7a3 3 0 0 1-3 3H6" }], ["path", { d: "M10 11l-4 4 4 4" }]] },
    play: { viewBox: "0 0 24 24", shapes: [["path", { d: "M8 5v14l11-7z" }]] },
    reload: { viewBox: "0 0 24 24", shapes: [["path", { d: "M20 12a8 8 0 1 1-2.3-5.6" }], ["path", { d: "M20 4v5h-5" }]] },
    search: { viewBox: "0 0 24 24", shapes: [["circle", { cx: "11", cy: "11", r: "6.5" }], ["path", { d: "M16 16l4.5 4.5" }]] },
    user: {
      viewBox: "0 0 24 24",
      shapes: [["circle", { cx: "12", cy: "8.5", r: "3.8" }], ["path", { d: "M4.5 20c1.2-4 4-5.8 7.5-5.8s6.3 1.8 7.5 5.8" }]]
    },
    warn: { viewBox: "0 0 24 24", shapes: [["path", { d: "M12 3 2.5 20h19z" }], ["path", { d: "M12 10v4" }], ["path", { d: "M12 17.2v.1" }]] }
  }),

  /** The icon names, in alphabetical order. */
  names() {
    return Object.keys(SDT.icon.ICONS).sort();
  }
});
