// SDT.row: the pure logic for a service or layer row. inject.js builds the DOM from what these
// return: the spatial reference badge and its palette slot, the Details summary, and the Details
// groups. Only text() touches the DOM, and it never inserts anything into the page.
globalThis.SDT ??= {};

SDT.row = {
  /** A reference's WKID, latest first, or undefined when it has none. */
  wkidOf(sr) {
    return sr && typeof sr === "object" ? sr.latestWkid || sr.wkid || undefined : undefined;
  },

  /** A reference's WKT, latest first, or undefined. */
  wktOf(sr) {
    return sr && typeof sr === "object" ? sr.latestWkt || sr.wkt || undefined : undefined;
  },

  /** The palette slot, 0 to 7, for a reference's WKID: FNV-1a (32-bit) mod 8. Null when it has no WKID. */
  paletteIndex(sr) {
    const wkid = SDT.row.wkidOf(sr);
    if (!wkid) {
      return null;
    }
    let hash = 0x811c9dc5;
    for (const char of String(wkid)) {
      hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
    }
    return hash % 8;
  },

  /** The data's own spatial reference, else its extent's, else null. */
  spatialReference(data) {
    if (!data || typeof data !== "object") {
      return null;
    }
    return data.spatialReference || data.extent?.spatialReference || null;
  },

  /** What the badge shows for a reference: a WKID link, truncated WKT, or null for no badge. */
  badge(sr) {
    const wkid = SDT.row.wkidOf(sr);
    if (wkid) {
      return {
        kind: "wkid",
        text: String(wkid),
        href: "https://spatialreference.org/ref/?search=" + encodeURIComponent(String(wkid)),
        index: SDT.row.paletteIndex(sr)
      };
    }
    const wkt = SDT.row.wktOf(sr);
    if (wkt) {
      const full = String(wkt);
      return { kind: "wkt", text: "WKT " + full.slice(0, 24) + (full.length > 24 ? "…" : ""), title: full };
    }
    return null;
  },

  /** "Tiled" or "Dynamic", only when singleFusedMapCache is a boolean. */
  cacheLabel(data) {
    if (typeof data?.singleFusedMapCache !== "boolean") {
      return null;
    }
    return data.singleFusedMapCache ? "Tiled" : "Dynamic";
  },

  /** True when the data describes a layer or table rather than a service. */
  isLayer(data) {
    return Boolean(data) && (data.type === "Table" || /\bLayer$/.test(String(data.type)) || Boolean(data.geometryType));
  },

  /** The summary after "Details": "2 layers, max 1,000 records", "Polygon, 6 fields" or "Table, 9 fields". */
  summary(data) {
    if (!data || typeof data !== "object") {
      return "";
    }
    const number = (n) => n.toLocaleString("en-CA");
    const count = (n, one, many) => number(n) + " " + (n === 1 ? one : many);
    const parts = [];
    if (SDT.row.isLayer(data)) {
      if (data.type === "Table") {
        parts.push("Table");
      } else if (data.geometryType) {
        parts.push(String(data.geometryType).replace("esriGeometry", ""));
      } else if (data.type === "Group Layer") {
        parts.push("Group Layer");
      }
      if (Array.isArray(data.fields)) {
        parts.push(count(data.fields.length, "field", "fields"));
      }
    } else {
      if (Array.isArray(data.layers)) {
        parts.push(count(data.layers.length, "layer", "layers"));
      }
      if (typeof data.maxRecordCount === "number") {
        parts.push("max " + count(data.maxRecordCount, "record", "records"));
      }
    }
    return parts.join(", ");
  },

  /** "supportsDynamicLayers" as "Supports Dynamic Layers", as the old list showed it. */
  unCamelCase(value) {
    const text = String(value);
    return text.slice(0, 1).toUpperCase() + text.slice(1).replace(/([a-z])([A-Z])/g, "$1 $2");
  },

  /** Four numbers in xmin, ymin, xmax, ymax order, or null when the extent has none of them. */
  extentText(extent) {
    if (!extent || typeof extent !== "object") {
      return null;
    }
    const values = ["xmin", "ymin", "xmax", "ymax"].map((key) => extent[key]);
    return values.every((value) => typeof value === "number") ? values.join(", ") : null;
  },

  /**
   * The Details groups: [{ group, items: [{ term, value, mono? }] }], and { group, sentence } for
   * "Also true". Empty groups are left out. toText turns server HTML into text.
   */
  details(data, toText) {
    if (!data || typeof data !== "object") {
      return [];
    }
    const has = (key) => data[key] !== undefined && data[key] !== null;
    const yesNo = (value) => (value ? "Yes" : "No");
    const main = [];
    const add = (list, term, value, mono) => {
      list.push(mono ? { term, value: String(value), mono: true } : { term, value: String(value) });
    };
    const layer = SDT.row.isLayer(data);

    if (data.description) {
      add(main, "Description", toText(data.description));
    }
    if (data.serviceDescription) {
      add(main, "Service description", toText(data.serviceDescription));
    }
    if (data.copyrightText) {
      add(main, "Copyright", toText(data.copyrightText));
    }
    if (Array.isArray(data.layers) || Array.isArray(data.tables)) {
      const tables = Array.isArray(data.tables) ? data.tables.length : 0;
      const layers = Array.isArray(data.layers) ? data.layers.length : 0;
      add(main, "Layers and tables", `${layers} ${layers === 1 ? "layer" : "layers"}, ${tables} ${tables === 1 ? "table" : "tables"}`);
    }
    if (data.capabilities) {
      add(main, "Capabilities", data.capabilities);
    }
    if (has("minScale") || has("maxScale")) {
      add(main, "Scale range", data.minScale || data.maxScale ? `Min ${data.minScale || "None"}, max ${data.maxScale || "None"}` : "None set");
    }
    if (data.units) {
      add(main, "Units", String(data.units).replace("esri", ""));
    }
    if (data.documentInfo && typeof data.documentInfo === "object") {
      for (const [key, value] of Object.entries(data.documentInfo)) {
        if (value !== "" && value !== null && value !== undefined) {
          add(main, key === "Keywords" ? "Keywords" : "Document " + SDT.row.unCamelCase(key).toLowerCase(), value);
        }
      }
    }
    if (data.geometryType) {
      add(main, "Geometry", String(data.geometryType).replace("esriGeometry", ""));
    }
    if (data.definitionExpression) {
      add(main, "Definition expression", data.definitionExpression, true);
    }
    if (typeof data.defaultVisibility === "boolean") {
      add(main, "Visible by default", yesNo(data.defaultVisibility));
    }
    if (data.displayField) {
      add(main, "Display field", data.displayField, true);
    }
    if (data.objectIdField) {
      add(main, "Object ID field", data.objectIdField, true);
    }
    if (data.globalIdField) {
      add(main, "Global ID field", data.globalIdField, true);
    }
    if (has("maxRecordCount")) {
      add(main, "Max record count", data.maxRecordCount, true);
    }
    if (data.supportedQueryFormats) {
      add(main, "Query formats", data.supportedQueryFormats);
    }
    if (Array.isArray(data.relationships) && data.relationships.length) {
      add(main, "Relationships", "Yes");
    }
    if (typeof data.isDataVersioned === "boolean") {
      add(main, "Versioned data", yesNo(data.isDataVersioned));
    }
    if (data.dateFieldsTimeReference?.timeZone) {
      add(main, "Date fields time zone", `${data.dateFieldsTimeReference.timeZone} (daylight saving ${data.dateFieldsTimeReference.respectsDaylightSaving ? "" : "not "}supported)`);
    }
    if (data.advancedQueryCapabilities && typeof data.advancedQueryCapabilities === "object") {
      const on = Object.keys(data.advancedQueryCapabilities).filter((key) => data.advancedQueryCapabilities[key] === true).map(SDT.row.unCamelCase);
      if (on.length) {
        add(main, "Advanced queries", on.join(", "));
      }
    }

    const extent = [];
    for (const [term, key] of [["Initial", "initialExtent"], ["Full", "fullExtent"], ["Extent", "extent"]]) {
      const text = SDT.row.extentText(data[key]);
      if (text) {
        add(extent, term, text, true);
      }
    }
    const sr = SDT.row.spatialReference(data);
    const wkid = SDT.row.wkidOf(sr);
    const wkt = SDT.row.wktOf(sr);
    if (wkid) {
      add(extent, "Spatial reference", wkid, true);
    } else if (wkt) {
      add(extent, "Spatial reference", wkt, true);
    } else {
      add(extent, "Spatial reference", "No spatial reference");
    }

    const skip = ["defaultVisibility", "isDataVersioned", "singleFusedMapCache"];
    const sentence = Object.keys(data).filter((key) => data[key] === true && !skip.includes(key)).map(SDT.row.unCamelCase).join(", ");

    const groups = [{ group: layer ? "Layer" : "Service", items: main }, { group: "Extent", items: extent }];
    const result = groups.filter((group) => group.items.length);
    if (sentence) {
      result.push({ group: "Also true", sentence });
    }
    return result;
  },

  /** Server HTML as plain text, with whitespace collapsed. Parsed in an inert document, never inserted. */
  text(html) {
    const parsed = new DOMParser().parseFromString(String(html), "text/html");
    return (parsed.body.textContent || "").replace(/\s+/g, " ").trim();
  },

  /** Why a request failed: the ArcGIS error's message, else the error's own. */
  failureText(result) {
    return String(result?.error?.arcgis?.message ?? result?.error?.message ?? "");
  }
};
