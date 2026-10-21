import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLib } from "./helpers/sdt.js";

const ID = "sdt-test-extension";
const { sender } = loadLib({ files: ["src/lib/sender.js"] }).SDT;

// What Chrome 120 and later pass to onMessage for a message from this extension's content script in
// the top frame of an open tab.
const fromTopFrame = (overrides = {}) => ({
  id: ID,
  url: "https://arcgis.test/arcgis/rest/services",
  origin: "https://arcgis.test",
  frameId: 0,
  documentId: "8C1B0F1F3A5E4D2C9B7A6E5D4C3B2A10",
  documentLifecycle: "active",
  tab: { id: 42, url: "https://arcgis.test/arcgis/rest/services", active: true },
  ...overrides
});

test("accepts a message from the active top frame of a tab", () => {
  assert.equal(sender.problem(fromTopFrame(), ID), null);
  assert.equal(sender.accepts(fromTopFrame(), ID), true);
});

test("rejects a message from another extension, or with no sender id", () => {
  assert.equal(sender.problem(fromTopFrame({ id: "another-extension" }), ID), "another extension");
  assert.equal(sender.problem(fromTopFrame({ id: undefined }), ID), "another extension");
  assert.equal(sender.problem(undefined, ID), "another extension");
  // A missing extension id must not match a sender with no id either.
  assert.equal(sender.problem(fromTopFrame({ id: undefined }), undefined), "another extension");
});

test("rejects a message with no tab, such as one from an extension page", () => {
  assert.equal(sender.problem(fromTopFrame({ tab: undefined }), ID), "no tab");
  assert.equal(sender.problem(fromTopFrame({ tab: { id: -1 } }), ID), "no tab");
  assert.equal(sender.problem(fromTopFrame({ tab: {} }), ID), "no tab");
});

test("rejects a message from a frame other than the top one", () => {
  assert.equal(sender.problem(fromTopFrame({ frameId: 3 }), ID), "not the top frame");
  assert.equal(sender.problem(fromTopFrame({ frameId: undefined }), ID), "not the top frame");
});

test("rejects a message from a document that is prerendering, cached or being deleted (BG-2)", () => {
  for (const documentLifecycle of ["prerender", "cached", "pending_deletion"]) {
    assert.equal(sender.problem(fromTopFrame({ documentLifecycle }), ID), "document not active", documentLifecycle);
  }
});

test("rejects a message with no documentLifecycle, which every supported Chrome sends", () => {
  assert.equal(sender.problem(fromTopFrame({ documentLifecycle: undefined }), ID), "document not active");
});
