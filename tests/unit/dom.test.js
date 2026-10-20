import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLib } from "./helpers/sdt.js";
import { fakeDocument } from "./helpers/fake-dom.js";

const dom = () => loadLib({ globals: { document: fakeDocument() } }).SDT.dom;

test("loadElement keeps 0 and false as text (QRY-11)", () => {
  assert.equal(dom().loadElement("option", { value: 0 }, 0).textContent, "0");
  assert.equal(dom().loadElement("b", {}, false).textContent, "false");
});

test("loadElement adds no text node for undefined or null", () => {
  assert.equal(dom().loadElement("b", {}).childNodes.length, 0);
  assert.equal(dom().loadElement("b", {}, null).childNodes.length, 0);
});

test("loadElement sets every attribute as a string, and takes no attributes", () => {
  assert.deepEqual(dom().loadElement("option", { value: 0, "class": "x" }, "a").attributes, { value: "0", "class": "x" });
  assert.deepEqual(dom().loadElement("div").attributes, {});
  assert.equal(dom().loadElement("div").nodeName, "DIV");
});

test("text makes a text node, empty for undefined and null", () => {
  assert.equal(dom().text(0).textContent, "0");
  assert.equal(dom().text(undefined).textContent, "");
  assert.equal(dom().text(null).textContent, "");
});

test("clear removes every child and returns the node", () => {
  const helpers = dom();
  const list = helpers.loadElement("ul");
  list.appendChild(helpers.loadElement("li", {}, "a"));
  list.appendChild(helpers.loadElement("li", {}, "b"));
  assert.equal(helpers.clear(list), list);
  assert.equal(list.childNodes.length, 0);
});
