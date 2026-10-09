// Synthetic ArcGIS Server content for the browser tests. Every name and value is invented; the
// shapes follow the ArcGIS REST API so the extension sees what a real server would send.
// Don't paste responses captured from a real server into this file: Esri's terms don't allow
// redistributing them.
//
// Keys that start with "_" are fixture data the fake server uses but never sends.

const WEB_MERCATOR = { wkid: 102100, latestWkid: 3857 };
const EXTENT = { xmin: -13660000, ymin: 5700000, xmax: -13620000, ymax: 5730000, spatialReference: WEB_MERCATOR };
const GEOGRAPHIC_EXTENT = { xmin: -122.7, ymin: 45.4, xmax: -122.3, ymax: 45.7, spatialReference: { wkid: 4326, latestWkid: 4326 } };

const layerDefaults = {
  description: "",
  copyrightText: "",
  defaultVisibility: true,
  parentLayerId: -1,
  subLayerIds: null,
  minScale: 0,
  maxScale: 0,
  type: "Feature Layer",
  extent: EXTENT,
  maxRecordCount: 1000,
  supportedQueryFormats: "JSON, geoJSON",
  supportsStatistics: true,
  supportsAdvancedQueries: true,
  advancedQueryCapabilities: { supportsStatistics: true, supportsOrderBy: true, supportsDistinct: true, supportsPagination: true }
};

const parcels = {
  ...layerDefaults,
  id: 0,
  name: "Parcels",
  geometryType: "esriGeometryPolygon",
  displayField: "OWNER_NAME",
  fields: [
    { name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID", domain: null },
    { name: "SHAPE", type: "esriFieldTypeGeometry", alias: "Shape", domain: null },
    { name: "PARCEL_ID", type: "esriFieldTypeString", alias: "Parcel ID", length: 20, domain: null },
    { name: "OWNER_NAME", type: "esriFieldTypeString", alias: "Owner", length: 50, domain: null },
    {
      name: "LAND_USE",
      type: "esriFieldTypeString",
      alias: "Land use",
      length: 2,
      domain: { type: "codedValue", name: "LandUse", codedValues: [{ name: "Residential", code: "R" }, { name: "Commercial", code: "C" }] }
    },
    { name: "ACRES", type: "esriFieldTypeDouble", alias: "Acres", domain: null }
  ],
  // SHAPE is true when the feature has a geometry and null when it doesn't.
  _rows: [
    { OBJECTID: 1, SHAPE: true, PARCEL_ID: "P-001", OWNER_NAME: "A. Example", LAND_USE: "R", ACRES: 0.25 },
    { OBJECTID: 2, SHAPE: true, PARCEL_ID: "P-002", OWNER_NAME: "", LAND_USE: "C", ACRES: 1.5 },
    { OBJECTID: 3, SHAPE: null, PARCEL_ID: "P-003", OWNER_NAME: null, LAND_USE: "R", ACRES: null }
  ]
};

const addresses = {
  ...layerDefaults,
  id: 1,
  name: "Addresses",
  geometryType: "esriGeometryPoint",
  displayField: "ADDRESS",
  fields: [
    { name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID", domain: null },
    { name: "SHAPE", type: "esriFieldTypeGeometry", alias: "Shape", domain: null },
    { name: "ADDRESS", type: "esriFieldTypeString", alias: "Address", length: 60, domain: null },
    { name: "PARCEL_ID", type: "esriFieldTypeString", alias: "Parcel ID", length: 20, domain: null }
  ],
  _rows: [
    { OBJECTID: 1, SHAPE: true, ADDRESS: "1 Example Street", PARCEL_ID: "P-001" },
    { OBJECTID: 2, SHAPE: true, ADDRESS: "2 Example Street", PARCEL_ID: "P-002" }
  ]
};

const roads = {
  ...layerDefaults,
  id: 0,
  name: "Roads 2019",
  geometryType: "esriGeometryPolyline",
  displayField: "ROAD_NAME",
  fields: [
    { name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID", domain: null },
    { name: "SHAPE", type: "esriFieldTypeGeometry", alias: "Shape", domain: null },
    { name: "ROAD_NAME", type: "esriFieldTypeString", alias: "Road name", length: 50, domain: null }
  ],
  _rows: [
    { OBJECTID: 1, SHAPE: true, ROAD_NAME: "Example Avenue" },
    { OBJECTID: 2, SHAPE: true, ROAD_NAME: "Sample Road" }
  ]
};

const exportWebMapTask = {
  name: "Export Web Map Task",
  json: {
    name: "ExportWebMapTask",
    displayName: "Export Web Map Task",
    description: "Prints a web map.",
    category: "",
    executionType: "esriExecutionTypeSynchronous",
    parameters: [
      { name: "Web_Map_as_JSON", dataType: "GPString", displayName: "Web Map as JSON", direction: "esriGPParameterDirectionInput", defaultValue: "", parameterType: "esriGPParameterTypeRequired" },
      { name: "Format", dataType: "GPString", displayName: "Format", direction: "esriGPParameterDirectionInput", defaultValue: "PDF", parameterType: "esriGPParameterTypeOptional", choiceList: ["PDF", "PNG32", "JPG"] },
      { name: "Layout_Template", dataType: "GPString", displayName: "Layout Template", direction: "esriGPParameterDirectionInput", defaultValue: "MAP_ONLY", parameterType: "esriGPParameterTypeOptional", choiceList: ["A4 Landscape", "A4 Portrait", "MAP_ONLY"] },
      { name: "Output_File", dataType: "GPDataFile", displayName: "Output File", direction: "esriGPParameterDirectionOutput", defaultValue: null, parameterType: "esriGPParameterTypeRequired" }
    ]
  }
};

const documentInfo = (title, keywords) => ({ Title: title, Author: "", Comments: "", Subject: "", Category: "", Keywords: keywords });

export const catalog = {
  currentVersion: 11.3,
  folders: ["Transport", "Utilities"],
  services: [
    {
      name: "Parcels",
      type: "MapServer",
      layers: [parcels, addresses],
      info: {
        serviceDescription: "Parcel boundaries and site addresses for an invented county.",
        mapName: "Parcels map",
        description: "",
        copyrightText: "Example County GIS",
        spatialReference: WEB_MERCATOR,
        singleFusedMapCache: false,
        initialExtent: EXTENT,
        fullExtent: EXTENT,
        units: "esriMeters",
        documentInfo: documentInfo("Parcels", "parcels,addresses"),
        capabilities: "Map,Query,Data",
        supportedQueryFormats: "JSON, geoJSON, PBF",
        maxRecordCount: 1000,
        maxImageHeight: 4096,
        maxImageWidth: 4096
      }
    },
    {
      name: "Parcels",
      type: "FeatureServer",
      layers: [parcels, addresses],
      info: {
        serviceDescription: "Editable parcel boundaries for an invented county.",
        description: "",
        copyrightText: "Example County GIS",
        hasVersionedData: false,
        supportsDisconnectedEditing: false,
        maxRecordCount: 1000,
        supportedQueryFormats: "JSON",
        capabilities: "Query",
        spatialReference: WEB_MERCATOR,
        initialExtent: EXTENT,
        fullExtent: EXTENT,
        allowGeometryUpdates: true,
        units: "esriMeters"
      }
    },
    {
      name: "Elevation",
      type: "ImageServer",
      info: {
        serviceDescription: "An invented elevation surface.",
        name: "Elevation",
        description: "",
        copyrightText: "",
        extent: GEOGRAPHIC_EXTENT,
        initialExtent: GEOGRAPHIC_EXTENT,
        fullExtent: GEOGRAPHIC_EXTENT,
        pixelSizeX: 0.0001,
        pixelSizeY: 0.0001,
        bandCount: 1,
        pixelType: "F32",
        spatialReference: { wkid: 4326, latestWkid: 4326 },
        fields: [],
        maxImageHeight: 4100,
        maxImageWidth: 15000,
        capabilities: "Image,Metadata"
      }
    },
    {
      name: "Transport/Roads",
      type: "MapServer",
      layers: [roads],
      info: {
        serviceDescription: "Road centrelines for an invented county.",
        mapName: "Roads",
        description: "",
        copyrightText: "",
        spatialReference: WEB_MERCATOR,
        singleFusedMapCache: true,
        initialExtent: EXTENT,
        fullExtent: EXTENT,
        units: "esriMeters",
        documentInfo: documentInfo("Roads", "roads"),
        capabilities: "Map,Query",
        supportedQueryFormats: "JSON",
        maxRecordCount: 2000
      }
    },
    {
      name: "Utilities/PrintingTools",
      type: "GPServer",
      tasks: [exportWebMapTask],
      info: {
        serviceDescription: "Prints web maps.",
        executionType: "esriExecutionTypeSynchronous",
        resultMapServerName: "",
        maximumRecords: 1000
      }
    }
  ]
};
