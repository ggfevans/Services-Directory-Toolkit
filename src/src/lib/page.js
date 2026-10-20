// SDT.page: what kind of Services Directory page this is. The type comes from location.pathname and
// document.contentType, never from the query string, which content-script patterns also match
// (TOK-6). The markup only confirms the page: any one marker is enough, because 12.1's element
// classes haven't been checked (store-readiness spec, Phase 2).
globalThis.SDT ??= {};

SDT.page = {
  SERVICE_TYPES: ["MapServer", "FeatureServer", "ImageServer", "GPServer", "GeocodeServer", "GeometryServer",
    "GeoDataServer", "GlobeServer", "NAServer", "SceneServer", "StreamServer", "VectorTileServer", "MobileServer",
    "SchematicsServer", "KnowledgeGraphServer", "UtilityNetworkServer", "VersionManagementServer",
    "NetworkDiagramServer", "ParcelFabricServer", "ValidationServer", "WorkflowManagerServer"],

  JSON_TYPES: ["application/json", "text/plain"],

  // Headings and titles of Services Directory pages, in 10.9 to 12.1 and ArcGIS Online.
  HEADING: /^(?:Folder|Layer|Table|Query|Find|Task|Execute Task|Submit Job)\b|\([A-Za-z]+Server\)$/,

  /** The service type a path segment names, in Esri's casing, or null. */
  typeOf(segment) {
    const lower = String(segment).toLowerCase();
    return SDT.page.SERVICE_TYPES.find((type) => type.toLowerCase() === lower) ?? null;
  },

  /** Whether the document looks like a Services Directory page. */
  isServicesDirectory(document) {
    if (document.querySelector(".breadcrumbs")) {
      return true;
    }
    const titleCell = document.querySelector(".titlecell");
    if (titleCell && /ArcGIS REST Services Directory/i.test(titleCell.textContent)) {
      return true;
    }
    const heading = document.querySelector("h2");
    return [document.title, heading?.textContent].some((text) => SDT.page.HEADING.test(String(text ?? "").trim()));
  },

  /** root, folder, service, layer, query, find, gpTask, jsonView or other. */
  classify(location, document) {
    const split = SDT.auth.splitRest(location.pathname);
    if (!split) {
      return "other";
    }
    if (SDT.page.JSON_TYPES.includes(document.contentType)) {
      return "jsonView";
    }
    if (!SDT.page.isServicesDirectory(document)) {
      return "other";
    }
    const { tail } = split;
    const at = tail.findIndex((segment) => SDT.page.typeOf(segment));
    if (at === -1) {
      return tail.length === 0 ? "root" : "folder";
    }
    const after = tail.slice(at + 1).map((segment) => segment.toLowerCase());
    const last = after[after.length - 1];
    if (after.length === 0) {
      return "service";
    }
    if (last === "query") {
      return "query";
    }
    if (after.length === 1 && last === "find") {
      return "find";
    }
    if (SDT.page.typeOf(tail[at]) === "GPServer" && after.length === 2 && (last === "execute" || last === "submitjob")) {
      return "gpTask";
    }
    if (after.length === 1 && /^\d+$/.test(last)) {
      return "layer";
    }
    return "service";
  },

  /** The first service type in the path, in Esri's casing, or null. */
  serviceType(location) {
    const split = SDT.auth.splitRest(location.pathname);
    return split?.tail.map((segment) => SDT.page.typeOf(segment)).find(Boolean) ?? null;
  },

  /** The page URL without its query string and fragment. */
  baseUrl(location) {
    return `${location.origin}${location.pathname}`;
  }
};
