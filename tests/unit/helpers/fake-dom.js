// The few document calls the lib's DOM helpers make, for unit tests in Node. It isn't a DOM.
class FakeNode {
  constructor(nodeType, nodeName) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.childNodes = [];
    this.attributes = {};
    this.parentNode = null;
    this.data = "";
  }

  get firstChild() {
    return this.childNodes[0] ?? null;
  }

  get lastChild() {
    return this.childNodes.at(-1) ?? null;
  }

  get textContent() {
    return this.nodeType === 3 ? this.data : this.childNodes.map((child) => child.textContent).join("");
  }

  appendChild(child) {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child) {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
}

export const fakeDocument = () => ({
  createElement: (tag) => new FakeNode(1, tag.toUpperCase()),
  // SVG elements keep their case, as in a browser.
  createElementNS: (namespaceURI, tag) => Object.assign(new FakeNode(1, tag), { namespaceURI }),
  createTextNode: (data) => Object.assign(new FakeNode(3, "#text"), { data: String(data) })
});
