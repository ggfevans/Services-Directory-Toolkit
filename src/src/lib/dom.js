// SDT.dom: DOM helpers shared by the content scripts and the popup. Like every file in src/src/lib/,
// this is a classic script that adds one namespace to SDT and declares nothing at the top level, so
// running it twice is harmless (store-readiness spec, section 5).
globalThis.SDT ??= {};

SDT.dom = {
  /**
   * Creates an element. Each attribute is set as a string. The text, unless it is undefined or
   * null, becomes a text node, so 0 and false are kept.
   */
  loadElement(tag, attributes = {}, text) {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes ?? {})) {
      element.setAttribute(name, String(value));
    }
    if (text !== undefined && text !== null) {
      element.appendChild(document.createTextNode(String(text)));
    }
    return element;
  },

  /** A text node for value; empty for undefined and null. */
  text(value) {
    return document.createTextNode(value === undefined || value === null ? "" : String(value));
  },

  /** Removes every child of node, and returns node. */
  clear(node) {
    while (node.firstChild) {
      node.removeChild(node.lastChild);
    }
    return node;
  }
};
