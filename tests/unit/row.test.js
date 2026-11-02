import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLib, plain } from "./helpers/sdt.js";

const { SDT } = loadLib();
const { row } = SDT;
const stripTags = (html) => String(html).replace(/<[^>]*>/g, "");
const detailsOf = (data) => plain(row.details(data, stripTags));
const terms = (groups) => groups.flatMap((group) => (group.items ?? []).map((item) => item.term));
const find = (groups, term) => groups.flatMap((group) => group.items ?? []).find((item) => item.term === term);

test("paletteIndex pins: 3857 is 2, 4326 is 0, { wkid: 102100, latestWkid: 3857 } is 2, and a bare { wkid: 102100 } is 1", () => {
  assert.equal(row.paletteIndex({ wkid: 3857 }), 2);
  assert.equal(row.paletteIndex({ wkid: 4326 }), 0);
  assert.equal(row.paletteIndex({ wkid: 102100, latestWkid: 3857 }), 2);
  assert.equal(row.paletteIndex({ wkid: 102100 }), 1);
});

test("paletteIndex is null for a reference with no WKID", () => {
  assert.equal(row.paletteIndex({}), null);
  assert.equal(row.paletteIndex({ wkid: 0 }), null);
  assert.equal(row.paletteIndex(null), null);
});

test("spatialReference prefers data.spatialReference, then extent.spatialReference, then null", () => {
  const a = { wkid: 1 };
  const b = { wkid: 2 };
  assert.deepEqual(plain(row.spatialReference({ spatialReference: a, extent: { spatialReference: b } })), a);
  assert.deepEqual(plain(row.spatialReference({ extent: { spatialReference: b } })), b);
  assert.equal(row.spatialReference({}), null);
  assert.equal(row.spatialReference(null), null);
});

test("badge for a WKID has the https link with an encoded value", () => {
  assert.deepEqual(plain(row.badge({ wkid: 3857 })), { kind: "wkid", text: "3857", href: "https://spatialreference.org/ref/?search=3857", index: 2 });
  assert.equal(row.badge({ wkid: "a b" }).href, "https://spatialreference.org/ref/?search=a%20b");
  assert.equal(row.badge({ wkid: 102100, latestWkid: 3857 }).text, "3857");
});

test("badge for WKT only is \"WKT \" plus 24 characters plus \"…\", with the full text in title", () => {
  const wkt = "PROJCS[\"Example_Local_Grid\",GEOGCS[\"GCS_Example\"]]";
  const badge = plain(row.badge({ wkt }));
  assert.equal(badge.kind, "wkt");
  assert.equal(badge.text, "WKT " + wkt.slice(0, 24) + "…");
  assert.equal(badge.title, wkt);
  assert.equal(row.badge({ latestWkt: wkt, wkt: "x" }).title, wkt);
  assert.equal(row.badge({ wkt: "short" }).text, "WKT short");
});

test("badge is null for null, {} and { wkid: 0 }, and { wkid: \"__proto__\" } gets a badge", () => {
  assert.equal(row.badge(null), null);
  assert.equal(row.badge({}), null);
  assert.equal(row.badge({ wkid: 0 }), null);
  const badge = row.badge({ wkid: "__proto__" });
  assert.equal(badge.kind, "wkid");
  assert.equal(badge.text, "__proto__");
});

test("cacheLabel: true is Tiled, false is Dynamic, missing is null", () => {
  assert.equal(row.cacheLabel({ singleFusedMapCache: true }), "Tiled");
  assert.equal(row.cacheLabel({ singleFusedMapCache: false }), "Dynamic");
  assert.equal(row.cacheLabel({}), null);
  assert.equal(row.cacheLabel({ singleFusedMapCache: "yes" }), null);
});

test("summary: services, layers, tables and nothing", () => {
  assert.equal(row.summary({ layers: [{}, {}], maxRecordCount: 1000 }), "2 layers, max 1,000 records");
  assert.equal(row.summary({ layers: [{}], maxRecordCount: 1000 }), "1 layer, max 1,000 records");
  assert.equal(row.summary({ geometryType: "esriGeometryPolygon", fields: [1, 2, 3, 4, 5, 6] }), "Polygon, 6 fields");
  assert.equal(row.summary({ type: "Table", fields: new Array(9).fill({}) }), "Table, 9 fields");
  assert.equal(row.summary({}), "");
  assert.equal(row.summary(null), "");
});

test("details shows Max Record Count without documentInfo, and when it is 0 (INJ-13)", () => {
  assert.equal(find(detailsOf({ maxRecordCount: 1000 }), "Max record count").value, "1000");
  assert.equal(find(detailsOf({ maxRecordCount: 0 }), "Max record count").value, "0");
  assert.equal(find(detailsOf({}), "Max record count"), undefined);
});

test("details prints an extent as \"1, 2, 3, 4\" with mono set", () => {
  const groups = detailsOf({ fullExtent: { xmin: 1, ymin: 2, xmax: 3, ymax: 4, spatialReference: { wkid: 3857 } } });
  assert.deepEqual(find(groups, "Full"), { term: "Full", value: "1, 2, 3, 4", mono: true });
});

test("details joins true flags into one sentence and leaves out defaultVisibility, isDataVersioned and singleFusedMapCache", () => {
  const groups = detailsOf({ supportsDynamicLayers: true, exportTilesAllowed: true, supportsStatistics: false, defaultVisibility: true, isDataVersioned: true, singleFusedMapCache: true });
  const also = groups.find((group) => group.group === "Also true");
  assert.deepEqual(also, { group: "Also true", sentence: "Supports Dynamic Layers, Export Tiles Allowed" });
});

test("details applies toText to descriptions and copyright", () => {
  const groups = detailsOf({ description: "<b>Hi</b>", serviceDescription: "<i>There</i>", copyrightText: "&copy; <a>X</a>" });
  assert.equal(find(groups, "Description").value, "Hi");
  assert.equal(find(groups, "Service description").value, "There");
  assert.equal(find(groups, "Copyright").value, "&copy; X");
});

test("details says \"No spatial reference\", and shows the full WKT when there's no WKID", () => {
  assert.equal(find(detailsOf({ initialExtent: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 } }), "Spatial reference").value, "No spatial reference");
  assert.equal(find(detailsOf({ spatialReference: { wkid: 3857 } }), "Spatial reference").value, "3857");
  const wkt = "PROJCS[" + "x".repeat(60) + "]";
  assert.deepEqual(find(detailsOf({ spatialReference: { wkt } }), "Spatial reference"), { term: "Spatial reference", value: wkt, mono: true });
});

test("details leaves out empty groups and names the groups", () => {
  assert.deepEqual(detailsOf({}), [{ group: "Extent", items: [{ term: "Spatial reference", value: "No spatial reference" }] }]);
  const service = detailsOf({ layers: [], spatialReference: { wkid: 1 }, supportsX: true });
  assert.deepEqual(service.map((g) => g.group), ["Service", "Extent", "Also true"]);
  const layer = detailsOf({ type: "Table", fields: [], displayField: "A" });
  assert.equal(layer[0].group, "Layer");
});

test("details covers every field showMetadata shows", () => {
  const extent = { xmin: 1, ymin: 2, xmax: 3, ymax: 4 };
  const data = {
    description: "d", serviceDescription: "sd", copyrightText: "c", layers: [{}], tables: [{}],
    minScale: 5, maxScale: 0, initialExtent: extent, fullExtent: extent, units: "esriMeters",
    documentInfo: { Title: "T", Keywords: "k" }, maxRecordCount: 10, definitionExpression: "A=1",
    defaultVisibility: true, displayField: "D", objectIdField: "O", globalIdField: "G",
    relationships: [{}], isDataVersioned: false,
    dateFieldsTimeReference: { timeZone: "UTC", respectsDaylightSaving: false },
    supportedQueryFormats: "JSON", advancedQueryCapabilities: { supportsStatistics: true }, geometryType: "esriGeometryPoint"
  };
  const groups = detailsOf(data);
  const expected = ["Description", "Service description", "Copyright", "Layers and tables", "Scale range", "Initial", "Full", "Units", "Document title", "Keywords",
    "Max record count", "Geometry", "Definition expression", "Visible by default", "Display field", "Object ID field", "Global ID field", "Relationships",
    "Versioned data", "Date fields time zone", "Query formats", "Advanced queries", "Spatial reference"];
  for (const term of expected) {
    assert.ok(terms(groups).includes(term), `missing ${term}`);
  }
  assert.equal(find(groups, "Units").value, "Meters");
  assert.equal(find(groups, "Layers and tables").value, "1 layer, 1 table");
  assert.equal(find(groups, "Visible by default").value, "Yes");
  assert.equal(find(groups, "Versioned data").value, "No");
  assert.equal(find(groups, "Advanced queries").value, "Supports Statistics");
  assert.equal(find(groups, "Scale range").value, "Min 5, max None");
  assert.equal(find(groups, "Date fields time zone").value, "UTC (daylight saving not supported)");
});

test("details never throws on odd values", () => {
  assert.doesNotThrow(() => row.details({ spatialReference: {}, layers: "x", fullExtent: null, documentInfo: "x" }, stripTags));
  assert.deepEqual(plain(row.details(null, stripTags)), []);
});

test("failureText prefers the ArcGIS message, then result.error.message", () => {
  assert.equal(row.failureText({ error: { message: "HTTP 502", arcgis: { message: "Service not started" } } }), "Service not started");
  assert.equal(row.failureText({ error: { message: "HTTP 502" } }), "HTTP 502");
  assert.equal(row.failureText({}), "");
});

test("text collapses whitespace and strips markup through DOMParser", () => {
  const withParser = loadLib({ globals: { DOMParser: class { parseFromString(html) { return { querySelectorAll: () => [], body: { textContent: html.replace(/<[^>]*>/g, "") } }; } } } });
  assert.equal(withParser.SDT.row.text("  <p>a \n\n b</p>  "), "a b");
});

test("numbers use en-CA grouping", () => {
  assert.equal((1000).toLocaleString("en-CA"), "1,000");
});

test("an ImageServer with fields is a service, and a Group Layer is a layer", () => {
  const image = { fields: [], capabilities: "Image", maxRecordCount: 1000 };
  assert.equal(detailsOf(image)[0].group, "Service");
  assert.equal(row.summary(image), "max 1,000 records");
  const group = { type: "Group Layer", geometryType: null, fields: null, description: "d" };
  assert.equal(detailsOf(group)[0].group, "Layer");
  assert.equal(row.summary(group), "Group Layer");
  assert.equal(row.summary({ type: "Feature Layer", geometryType: "esriGeometryPoint", fields: [1] }), "Point, 1 field");
});

test("details shows tables without layers, and \"0 tables\" beside layers", () => {
  assert.equal(find(detailsOf({ tables: [{}, {}] }), "Layers and tables").value, "0 layers, 2 tables");
  assert.equal(find(detailsOf({ layers: [{}, {}, {}], tables: [] }), "Layers and tables").value, "3 layers, 0 tables");
  assert.equal(find(detailsOf({ layers: [{}] }), "Layers and tables").value, "1 layer, 0 tables");
});

test("a partial extent leaves its row out", () => {
  const groups = detailsOf({ fullExtent: { xmin: 1, ymax: 4 }, initialExtent: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 } });
  assert.equal(find(groups, "Full"), undefined);
  assert.equal(find(groups, "Initial").value, "1, 2, 3, 4");
});

test("an empty dateFieldsTimeReference leaves its row out", () => {
  assert.equal(find(detailsOf({ dateFieldsTimeReference: {} }), "Date fields time zone"), undefined);
});

test("documentInfo strings go through toText, and other values stay as they are", () => {
  const groups = detailsOf({ documentInfo: { Comments: "<DIV><P>Parcel <B>data</B></P></DIV>", Keywords: "<i>a</i>,b", Count: 3 } });
  assert.equal(find(groups, "Document comments").value, "Parcel data");
  assert.equal(find(groups, "Keywords").value, "a,b");
  assert.equal(find(groups, "Document count").value, "3");
});

test("a description, copyright or documentInfo value that is empty after toText gets no row", () => {
  const groups = detailsOf({
    description: "<DIV></DIV>", serviceDescription: "<p> </p>", copyrightText: "<br>",
    documentInfo: { Title: "<span></span>", Comments: "<p>kept</p>" }
  });
  assert.deepEqual(terms(groups).filter((term) => ["Description", "Service description", "Copyright", "Document title"].includes(term)), []);
  assert.equal(find(groups, "Document comments").value, "kept");
});
