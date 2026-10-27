{
  const { loadElement, clear: cleanElement } = SDT.dom;
  // A Map, so a key such as "__proto__" or "constructor" is an ordinary key (SEC-8).
  const COLOURS = new Map();
  let active = null;
  // Set in the load handler: the page's token, and the limiter every automatic request goes through.
  let token = null;
  let limiter = null;
  // The page's progress job (SDT.status): every request in a row's chain goes through it.
  let job = null;

  // A row that the request budget left out, or that automatic work skipped after server pushback.
  const skippedNote = (error, tag) => loadElement(tag, { "class": "sdt-note" }, tag === "span" ? ` ${error.message}` : error.message);
  

  /**
   * Changes a text value from camel-case to title case
   * @function unCamelCase
   * @param {string} value - value to transform from camel case
   * @returns {string} - a string in title case form.
   */
  const unCamelCase = (value) => value.substr(0, 1).toUpperCase() + value.substr(1).replace(/([a-z])([A-Z])/g, "$1 $2");

  /**
   * Adds a list item to a node if the property is there and maybe if a property is true.
   * @function li
   * @param {string} title - text to add in bold
   * @param {string | object} content - data to add after title in regular format
   * @param {string} [className] - if prsent, adds the class name to the list item
   * @returns {object} - list item node;
   */
  const li = (title, content, className) => {
    const node = loadElement("LI", {"class": className || ""});
    if (content === undefined) {
      node.appendChild(loadElement("b", {}, title));
    } else {
      node.appendChild(loadElement("b", {}, `${title}: `));
      node.appendChild(document.createTextNode(content instanceof Object ? JSON.stringify(content) : content));
    }
    return node;
  };

  /**
   * Adds a list item to a node with the title of the property, and then itemizes ovoer the content object get all its properties
   * @function addSubList
   * @param {string} title - title of the list
   * @param {object} content - name, value pairs used to describe a feature.
   * @param {string} [className] - if present, add this class name to the list item.
   * @returns {object} - list item node containing list of properties.
   */
  const addSubList = (title, content, className) => {
    const node = loadElement("LI", {"class": className || ""});
    const ul = document.createElement("ul");
    for (let i in content) {
      ul.appendChild(li(unCamelCase(i), content[i]));
    }
    node.appendChild(loadElement("b", {}, title));
    node.appendChild(ul);
    return node;
  };

  /**
   * Calculates a random color for a string value
   * @function getColor
   * @param {string} item - a string value
   * @returns {string} a CSS hex string for a color.
   */
  const getColor = (item) => {
    if (!COLOURS.has(item)) {
      COLOURS.set(item, "#" + (0x1000000 + (Math.random()) * 0xffffff).toString(16).substr(1, 6));
    }
    return COLOURS.get(item);
  };

  /**
   * Returns whether a field is queryable
   */
  const isQueryableField = (field) => ["esriFieldTypeGeometry","esriFieldTypeBlob","esriFieldTypeXML","esriFieldTypeRaster"].indexOf(field.type) === -1;

  /**
   * Calculates a complimentary shade or tint of a color to provide contrast
   * @function getCompColor
   * @param {string} item - a CSS hex string for a color
   * @returns {string} a CSS hext string for a color that is either lighter or darker than the current color.
   */
  const getCompColor = (item) => {
    const col = getColor(item),
      mid = [col.substr(1,1),col.substr(3,1),col.substr(5,1)].sort()[1],
      coltbl = "fedcba98".indexOf(mid) > -1 ? "0000000001234567" : "89abcdefffffffff";
    let newcol = "";
    for (let c = 0; c < col.length; c++) {
      newcol += c%2 === 1 ? coltbl[parseInt(col.substr(c,1), 16)] : col.substr(c, 1);
    }
    return newcol;
  };

  /**
   * Creates a node to display the spatial reference of a map service.
   * @function showSpatialReferenceData
   * @param {object} data - JSON response from the map service.
   * @returns {object} an HTML DOM node with the spatial reference data.
   */
  const showSpatialReferenceData = (data) => {
    let val="\u00a0No valid spatial reference available \u00a0",
      nodeCSS,
      container = null,
      spatialRefNode,
      cacheStatus,
      sr;
    if (data && Object.hasOwn(data, "spatialReference")) {
      sr = data.spatialReference;
      val = sr.latestWkid || sr.wkid || sr.latestWkt || sr.wkt || val;
      nodeCSS = `color: ${getColor(val)};background: ${getCompColor(val)};border-radius:4px;padding:2px;`;
      container = loadElement("span");
      if (sr.latestWkid || sr.wkid) {
        // link to well-known-id at spatialreference.org
        spatialRefNode = loadElement("a", {
          "href": `${window.location.protocol}//spatialreference.org/ref/?search=${val}`,
          "style": nodeCSS
        }, val);
      } else {
        spatialRefNode = loadElement("span", {
          "style": nodeCSS
        }, val);
      }
      container.appendChild(spatialRefNode);

      // handle tiled or dynamic service
      cacheStatus = data.singleFusedMapCache ? "tiled" : "dynamic";
      container.appendChild(loadElement("b", {}, " " + cacheStatus));
    }
    
    return container;
  };

  

  /**
   * Error reporting
   * @function reportError
   * @param {error} err0r - error object returned.
   * @param {object} [field] - the field being queried, used to explain some 400 errors.
   * @returns {object} an HTML node containing the error message.
   */
  const reportError = (err0r, field) => {
    let codeNumber = -99999;

    if (Object.hasOwn(err0r, "code")) {
      codeNumber = err0r.code;
    }
    if (Object.hasOwn(err0r, "Code")) {
      codeNumber = err0r.Code;
    }

    switch(codeNumber) {
      case -2147220985:
        return li("Cannot count features with valid shape fields in a shapefile");
      case 400:
        if (field) {
          if (Object.hasOwn(field, "type")) {
            switch(field.type) {
              case "esriFieldTypeOID":
                return li("Service does not support checking for null ObjectID");
              case "esriFieldTypeGeometry": 
                return li("Service data source does not support checking for null/empty geometry");
            }
          }
        }
    }

    return addSubList("Error", err0r, "sdt-metadata-error");
  };

  /**
   * Creates a nested list to show service and layer metadata
   * @function showMetadata
   * @param {object} data - JSON response from the map service
   * @returns {object} an HTML DOM node with the formatted metadata list
   */
  const showMetadata = (data) => {
    const dF = document.createDocumentFragment(),
      boolPreCheck = ["defaultVisibility", "isDataVersioned"];
    if (data) {
      const div = loadElement("DIV", {
        "class": "sdt-datablock sdt-collapsed"
      });
      div.appendChild(document.createElement("br"));
      const ul = document.createElement("ul");
      div.appendChild(ul);

      // handling errors
      if (Object.hasOwn(data, "error") && data.error) {
        dF.appendChild(reportError(data.error));
      }

      if (Object.hasOwn(data, "description") && data.description) {
        dF.appendChild(li("Description", data.description));
      }
      if (Object.hasOwn(data, "serviceDescription") && data.serviceDescription) {
        dF.appendChild(li("Service Description", data.serviceDescription));
      }
      if (Object.hasOwn(data, "copyrightText") && data.copyrightText) {
        dF.appendChild(li("\u00a9", data.copyrightText));
      }
      if (Object.hasOwn(data, "layers")) {
        dF.appendChild(li("# Layers", data.layers.length));
      }
      if (Object.hasOwn(data, "tables") && data.tables.length) {
        dF.appendChild(li("# Tables", data.tables.length));
      }
      if (Object.hasOwn(data, "minScale")) {
        dF.appendChild(li("Min Scale", data.minScale || "None"));
      }
      if (Object.hasOwn(data, "maxScale")) {
        dF.appendChild(li("Max Scale", data.maxScale || "None"));
      }
      if (Object.hasOwn(data, "initialExtent")) {
        dF.appendChild(addSubList("Initial Extent", data.initialExtent));
      }
      if (Object.hasOwn(data, "fullExtent")) {
        dF.appendChild(addSubList("Full Extent", data.fullExtent));
      }
      if (Object.hasOwn(data, "extent")) {
        dF.appendChild(addSubList("Extent", data.extent));
      }
      if (Object.hasOwn(data, "units") && data.units) {
        dF.appendChild(li("Units", data.units.replace("esri", "")));              
      }
      if (Object.hasOwn(data, "documentInfo")) {
        dF.appendChild(addSubList("Document Info", data.documentInfo));
      }
      if (Object.hasOwn(data, "documentInfo")) {
        dF.appendChild(li("Max Record Count", data.maxRecordCount));
      }
      if (Object.hasOwn(data, "geometryType") && data.geometryType) {
        dF.appendChild(li("Geometry", data.geometryType.replace("esriGeometry", "")));
      }
      if (data.definitionExpression) {
        dF.appendChild(li("Definition Expression", data.definitionExpression));
      }
      if (Object.hasOwn(data, "defaultVisibility")) {
        dF.appendChild(li("Visible by default", data.defaultVisibility.toString()));
      }
      if (Object.hasOwn(data, "displayField") && data.displayField) {
        dF.appendChild(li("Display Field", data.displayField));
      }
      if (Object.hasOwn(data, "objectIdField") && data.objectIdField) {
        dF.appendChild(li("Object ID Field", data.objectIdField));
      }
      if (Object.hasOwn(data, "globalIdField") && data.globalIdField) {
        dF.appendChild(li("Global ID Field", data.globalIdField));
      }
      
      if (data.relationships && data.relationships.length) {
        dF.appendChild(li("Has Relationships"));
      }
      if (Object.hasOwn(data, "isDataVersioned")) {
        dF.appendChild(li("Versioned Data", data.isDataVersioned ? "Yes" : "No"));
      }

      if (data.dateFieldsTimeReference) {
        dF.appendChild(li("Date fields Time Zone", data.dateFieldsTimeReference.timeZone + "(Daylight Savings Time " + (data.dateFieldsTimeReference.respectsDaylightSaving ? "" : "not ") + "supported)"));
      }

      if (Object.hasOwn(data, "supportedQueryFormats")) {
        dF.appendChild(li("Supported Query Formats", data.supportedQueryFormats ));
      }
      if (data.advancedQueryCapabilities) {
        dF.appendChild(addSubList("Advanced Query Capabilities", data.advancedQueryCapabilities));
      }

      // show all data items where true, unless formatted value already available.
      for (let item in data) {
        if (typeof data[item] === "boolean" && data[item] && boolPreCheck.indexOf(item) === -1) {
          dF.appendChild(li(unCamelCase(item)));
        }
      }
      
      ul.appendChild(dF);
      SDT.guard.listen(div, "click", () => { toggleCollapse(div); });

      return div;
    }
    return null;
  };

  /** True when a row's request was left out: by the budget, after pushback, or because the page was left. */
  const isLeftOut = (result) => SDT.net.isSkipped(result) || result?.error?.type === "aborted";

  /** The row's list of counts and errors, created once, after the row's other details. */
  const rowList = (row) => {
    if (!row.list) {
      row.list = document.createElement("ul");
      row.parent.appendChild(row.list);
    }
    return row.list;
  };

  /** Shows a failed request's error on its row: the server's ArcGIS error, or the request's message. */
  const failure = (result, field) => {
    const response = SDT.net.legacyResponse(result);
    return reportError(response?.error ?? { message: result.error.message }, field);
  };

  /**
   * Counts a layer's features, and those with shapes, through the page's job. Each count that
   * finishes goes into row.counted, so Load more sends only the ones still missing.
   * @function getLayerCount
   * @param {string} url - the layer's url
   * @param {object} data - the layer's JSON
   * @param {object} row - the row: its counts and errors go in row.list
   * @returns {Promise<"done" | "failed" | "skipped">}
   */
  const getLayerCount = async (url, data, row) => {
    let oid, shape;
    if (data.objectIdField) {
      oid = data.objectIdField;
    }
    for (const field of data.fields) {
      if (field.type === "esriFieldTypeOID" || field.type === "") {
        oid = field.name;
      } else if (field.type === "esriFieldTypeGeometry") {
        shape ??= field.name;
      }
    }
    shape ??= data.geometryField?.name;

    const firstRun = !row.list;
    const ul = rowList(row);
    if (firstRun && !oid) {
      ul.appendChild(li("No way to query features."));
    }
    if (firstRun && !shape && data.type && data.type !== "Table") {
      ul.appendChild(li("No visible shape field available."));
    }

    const counts = [
      oid && { key: "total", field: oid, label: "Number of features", type: "esriFieldTypeOID" },
      shape && { key: "shape", field: shape, label: "Features with shapes", type: "esriFieldTypeGeometry" }
    ].filter((count) => count && !row.counted.has(count.key));
    const queryUrl = `${url.replace(/\/+$/, "")}/query`;
    const results = await Promise.all(counts.map((count) => job.fetch(queryUrl, {
      params: { where: `${count.field} IS NOT NULL`, returnGeometry: "false", returnCountOnly: "true", f: "json" },
      token
    })));

    let outcome = "done";
    counts.forEach((count, i) => {
      const result = results[i];
      if (isLeftOut(result)) {
        row.notes.push(ul.appendChild(skippedNote(result.error, "li")));
        outcome = "skipped";
      } else if (result.error) {
        row.notes.push(ul.appendChild(failure(result, { type: count.type })));
        if (outcome !== "skipped") {
          outcome = "failed";
        }
      } else {
        row.counted.add(count.key);
        if (result.data?.count !== undefined && result.data?.count !== null) {
          ul.appendChild(li(count.label, result.data.count));
        }
      }
    });
    return outcome;
  };

  /**
   * toggles the collapeable state of an element.
   * @function toggleCollapse
   * @param {HTML} div
   */
  const toggleCollapse = (div) => {
    div.classList.toggle("sdt-collapsed");
  };

  /**
   * clears the input stored within the "active" variable.
   * @function clearActive
   */
  const clearActive = () => {
    if (active !== undefined && active !== null) {
      active.value = "";
    }
  };
  
  /**
   * sets the value of the input stored in the "active" variable
   * @function setActive
   * @param {string} value - input to insert in the "active" input
   */
  const setActive = (value) => {
    if (active === undefined || active === null) {
      return;
    }
    const oldVal = active.value;
    active.focus();
    let iCaretPos = "selectionStart" in active ? active.selectionStart : oldVal.length;
    // insert clicked text
    active.value = oldVal.substring(0, iCaretPos) + value + oldVal.substring(iCaretPos);
    // reset cursor position
    iCaretPos += value.length - (["()", "''"].indexOf(value) > -1);
    if ("selectionStart" in active) {
      active.setSelectionRange(iCaretPos, iCaretPos);
    }
  };

  /**
   * Adds eventlisteners function to all nodes that match a querySelectorAll
   * @function listenAll
   * @param {object} node - HTML DOM parent node to use with querySelectorAll
   * @param {string} selector - CSS selector 
   * @param {string} evt - event name
   * @param {function} callback - callback function when event occurs.
   */
  const listenAll = (node, selector, evt, callback) => {
    [].forEach.call(node.querySelectorAll(selector), (el) => SDT.guard.listen(el, evt, callback));
  };

  /**
   * Represents the SidePanel
   * @class SidePanel
   * @param {string} title title to add to the sidepanel
   * @property {object} node - HTML DOM node of the side panel.
   */
  class SidePanel { 
    constructor(title) {
      this.node = loadElement("DIV", {"class": "sdt-sidepanel"});
      // insert title
      const titlePanel = loadElement("DIV", {"class": "sdt-titlepanel"});
      titlePanel.appendChild(loadElement("b", {}, title));

      // insert clear button
      const clearBtn = loadElement("BUTTON", {"type": "button"}, "Clear");
      SDT.guard.listen(clearBtn, "click", clearActive);
      titlePanel.appendChild(clearBtn);

      this.node.appendChild(titlePanel);

      // add events
      listenAll(document, "input[type=text], textarea", "blur", function () { 
        // no fat arrow b/c Active would become this sidepanel instead of an element
        active = this;
      });

      document.body.appendChild(this.node);
    }
    /**
     * @method addElement
     * @param {HTML} node 
     */
    addElement(node) {
      this.node.appendChild(node);
    }
    /**
     * @method note
     * @param {string} text 
     */
    note(text) {
      this.addElement(loadElement("P", {}, text));
    }
    /**
     * @method label
     * @param {string} text 
     */
    label(text) {
      this.addElement(loadElement("SPAN", {}, text));
      this.addElement(loadElement("BR", {}));
    }
  }

  /**
   * Field Selector
   */
  class FieldSelector {
    /**
     * @constructor
     * @param {string} url 
     * @param {HTML} parentNode
     * @param {function} callback
     */
    constructor(url, parentNode, callback) {
      const singleLayer = /server\/\d+\/?$/i.test(url),
        jsonUrl = url + (singleLayer ? "" : "/layers");
      let helpMessage = "Click field name to get up to 1000 examples. Double-click selections to add to form.";

      this.url = url;
      this.parentNode = parentNode;

      // update help message
      if (!singleLayer) {
        helpMessage = "Select layer to populate fields. " + helpMessage;
      }
      const helpMessageNode = loadElement("P", {}, helpMessage);
      parentNode.appendChild(helpMessageNode);
      
      // get JSON data from service and build data afterward.
      this.load(jsonUrl, callback);
    }

    /** Loads the layer JSON, an automatic request, and builds the lists from it. */
    async load(jsonUrl, callback) {
      const result = await limiter.fetchJson(jsonUrl, { params: { f: "json" }, token });
      // The answer can arrive after an update has cut this script off.
      SDT.guard.run(() => {
        const data = SDT.net.legacyResponse(result);
        if (data === null) {
          this.parentNode.appendChild(loadElement("P", {}, `Could not load the fields: ${result.error.message}`));
          return;
        }
        this.buildRenderer(callback, data);
      });
    }
    /**
     * Renderer for the Field Selector
     * @param {function} callback - call this once the renderer has completed
     * @param {object|object[]} data 
     */
    buildRenderer(callback, data) {
      const df = document.createDocumentFragment();
      if (!data) {
        return;
      }
      // collect layer data into a list
      let dataItems = (data.layers || []).concat(data.tables || []);
      if (dataItems.length === 0) {
        dataItems = [data];
      }
      // filter out potential parent layers with no data.
      dataItems = dataItems.filter((item) => {
        return !item.subLayers || item.subLayers.length === 0;
      });
  
      //construct the layer selector
      const layerSelectorHeight = Math.min(dataItems.length, 5);
      this.layerSelect = loadElement("SELECT", {"size": layerSelectorHeight.toString(), "title": "Double-click to add to form."}),
      this.fieldSelect = loadElement("SELECT", {"size": "5", "title": "Double-click to add to form."}),
      this.valueList = loadElement("SELECT", {"size": "5", "title": "Double-click to add to form."});
  
      // add layer options, even if there is just one
      dataItems.forEach((item) => {
        this.layerSelect.appendChild(loadElement("OPTION", {"value": item.id}, item.name || item.title));  
      });
  
      // if layer 
      if (dataItems.length === 1) {
        this.layerSelect.className = "sdt-hidden";
        this.updateFields(dataItems);
      } else {
        df.appendChild(loadElement("SPAN", {}, "Layers:"));
        // on layerSelect change, update the fieldSelect list.
        SDT.guard.listen(this.layerSelect, "change", this.updateFields.bind(this, dataItems));
      }
      df.appendChild(this.layerSelect);
      df.appendChild(loadElement("SPAN", {}, "Fields:"));
      df.appendChild(this.fieldSelect);
      df.appendChild(loadElement("SPAN", {}, "Values:"));
      df.appendChild(this.valueList);
  
      this.parentNode.appendChild(df);

      SDT.guard.listen(this.fieldSelect, "change", this.updateValues.bind(this, this.url.replace(/\/\d*\/?$/, "")));
    
      // apply double-click event listeners to fill in items.
      listenAll(this.parentNode, "select", "dblclick", function (evt) {
        // no fat arrow b/c Active would become this sidepanel instead of an element
        setActive(evt.currentTarget.value);
      });

      // call the callback with the data items collected from the layer JSON.
      if (callback && typeof callback === "function") {
        callback(dataItems);
      }
    }

    /**
     * Update the field items.
     * @param {object[]} dataItems 
     */
    updateFields(dataItems) {
      const layerId = parseInt(this.layerSelect.value, 10);
      cleanElement(this.fieldSelect);
      dataItems.filter((item) => item.id === layerId).forEach((item) => {
        
        if (!item || !item.fields || !item.fields.length) {
          this.fieldSelect.appendChild(loadElement("option", {"value": ""}, "No values found for this field"));
          this.fieldSelect.setAttribute("disabled", "disabled");
          return;
        } 
        
        const fields = item.fields.filter(isQueryableField);
        if (fields.length === 0) {
          this.fieldSelect.appendChild(loadElement("option", {"value": ""}, "No values found for this field"));
          this.fieldSelect.setAttribute("disabled", "disabled");
        } else {  
          this.fieldSelect.removeAttribute("disabled");
          const df = document.createDocumentFragment();

          fields.forEach((field) =>df.appendChild(loadElement("OPTION", {"value": field.name}, field.alias)));
          this.fieldSelect.appendChild(df);
        }
      }, this);
    }

    /**
     * Update the value items
     * @param {string} url
     */
    async updateValues(url) {
      const val = this.fieldSelect.value;
      const layerId = this.layerSelect.value;
      // loading of values
      cleanElement(this.valueList);
      this.valueList.appendChild(loadElement("option", {"value": ""}, "Loading"));
      notifyLoading(true, LOADING_SOMETHING_CSS);
      this.valueList.setAttribute("disabled", "disabled");
      // stop additional clicks on fieldSelect from subsequent calls
      this.fieldSelect.setAttribute("disabled", "disabled");
      // request distinct values. A click starts this, so it doesn't count toward the request limit.
      const result = await SDT.net.fetchJson(`${url}/${layerId}/query`, {
        params: { where: "1=1", returnGeometry: "false", outFields: val, orderByFields: val, returnDistinctValues: "true", f: "json" },
        token
      });
      this._updateValuesCallback(SDT.net.legacyResponse(result));
    }
    /**
     * Updates values after query
     * @param {*} res
     * @private
     */
    _updateValuesCallback(res) {
      const val = this.fieldSelect.value;
      const df = document.createDocumentFragment();
      // re-enable fieldlist
      this.fieldSelect.removeAttribute("disabled");
      // test if features were returned.
      cleanElement(this.valueList);
      if (!res || !res.features || res.features.length === 0) {
        this.valueList.setAttribute("disabled", "disabled");
        df.appendChild(loadElement("option", {value: ""}, "No values found for this field"));
      } else {
        this.valueList.removeAttribute("disabled");   
        res.features.forEach((feature) => {
          const featureValue = isNaN(feature.attributes[val] * 1) ? "'{0}'".replace("{0}", feature.attributes[val]) : feature.attributes[val];
          df.appendChild(loadElement("option", {"value": featureValue}, feature.attributes[val]));
        });  
      }
      this.valueList.appendChild(df);
      notifyLoading(false, LOADING_SOMETHING_CSS);
    }
  }

  /**
   * Builds the Find Helper Panel
   * @function findHelper
   * @param {string} url
   */
  const findHelper = (url) => {
    const sidepanel = new SidePanel("Find Helper");
    
    new FieldSelector(url, sidepanel.node, (dataItems) => {
      // insert valid layers into layers input.
      const layersBlank = document.querySelector("input[name = layers]");
      if (layersBlank && !layersBlank.value) {
        layersBlank.value = dataItems.filter((item) => {
          return !item.subLayers || item.subLayers.length === 0;
        }).map((item) => item.id).join(",");
      }
    });
  };


  const LOADING_METADATA_CSS = "sdt-loading-metadata";
  const LOADING_SOMETHING_CSS = "sdt-loading-something";
  const notifyLoading = (value, cssClass) => {
    document.body.classList.toggle(cssClass, value);
  };

  SDT.guard.onLoad(async () => {
    const type = SDT.page.classify(location, document);
    if (type === "jsonView" || type === "other") {
      return;
    }
    const settings = await SDT.settings.read(["autoMetadata", "autoFeatureCounts"]);
    token = SDT.auth.pageToken(location);
    limiter = SDT.net.pageLimiter();
    const pageScope = SDT.auth.scopeOf(location.href);
    const url = SDT.page.baseUrl(location);

    // Links to services on this server, outside the breadcrumbs. Each href loses its token, f and
    // fragment before the test (TOK-3), and links to other servers get no requests (SEC-5). The
    // page's own JSON link (?f=pjson) then points at the page itself, so links to the page are left out.
    const self = url.replace(/\/+$/, "");
    const tags = Array.prototype.slice.call(document.getElementsByTagName("a"), 0);
    const urls = tags
      .map((tag, i) => ({ i, url: SDT.url.stripForFilter(tag.href) }))
      .filter((item) => pageScope !== null
        && tags[item.i].parentNode.className !== "breadcrumbs"
        && item.url.replace(/\/+$/, "") !== self
        && SDT.auth.scopeOf(item.url) === pageScope
        && /(map|feature|image|mobile)server(\/\d*\/?)?$/i.test(item.url));

    // One row per link. A row keeps what it has loaded, so Load more sends only what is missing.
    const rows = urls.map((item) => ({
      anchor: tags[item.i],
      parent: tags[item.i].parentNode,
      url: item.url,
      data: null,
      counted: new Set(),
      list: null,
      notes: [],
      outcome: null
    }));
    const canCountFeatures = settings.autoFeatureCounts;

    /** Sends the requests the row is missing, and reports exactly one outcome for it to the job. */
    const loadRow = async (row) => {
      let outcome = "failed";
      try {
        // A Load more run replaces the notes and errors from the last one.
        for (const note of row.notes.splice(0)) {
          note.remove();
        }
        if (!row.data) {
          const result = await job.fetch(row.url, { params: { f: "json" }, token });
          if (isLeftOut(result)) {
            row.notes.push(row.parent.appendChild(skippedNote(result.error, "span")));
            outcome = "skipped";
            return;
          }
          if (result.error) {
            row.notes.push(rowList(row).appendChild(failure(result)));
            return;
          }
          if (result.data === null || typeof result.data !== "object") {
            row.notes.push(rowList(row).appendChild(failure({ error: { message: "The server's answer was not a service description." } })));
            return;
          }
          row.data = result.data;
          const spatialReferenceNode = showSpatialReferenceData(row.data),
            metadata = showMetadata(row.data);
          if (spatialReferenceNode !== null) {
            row.parent.insertBefore(spatialReferenceNode, row.list);
          }
          if (metadata !== null) {
            row.parent.insertBefore(metadata, row.list);
          }
        }
        // Only a layer's JSON has fields, so only layer rows get counts.
        outcome = canCountFeatures && row.data?.fields?.length
          ? await getLayerCount(row.url, row.data, row)
          : "done";
      } catch (error) {
        // A row that cannot be drawn fails alone, with an error line, and the others carry on.
        console.debug("SD Toolkit: could not show a row", error);
        row.notes.push(rowList(row).appendChild(failure({ error: { message: "Could not show this row's details." } })));
        outcome = "failed";
      } finally {
        row.outcome = outcome;
        job[outcome]();
      }
    };

    /** Loads the rows, with the busy class on <body> until every one has settled. */
    const collectMetaData = async (batch) => {
      notifyLoading(true, LOADING_METADATA_CSS);
      try {
        const results = await Promise.allSettled(batch.map(loadRow));
        const thrown = results.find((result) => result.status === "rejected");
        if (thrown) {
          throw thrown.reason;
        }
      } finally {
        notifyLoading(false, LOADING_METADATA_CSS);
      }
    };

    if (rows.length && settings.autoMetadata) {
      job = SDT.status.job(type === "service" ? "layers" : "services", rows.length);
      // Load more re-runs each row the budget or pushback left out.
      job.onLoadMore(() => {
        const skipped = rows.filter((row) => row.outcome === "skipped");
        job.retrying(skipped.length);
        return collectMetaData(skipped);
      });
      collectMetaData(rows).catch(SDT.guard.wrap((error) => console.debug("SD Toolkit: loading details stopped", error)));
    }

    if (type === "find") {
      findHelper(url.replace(/\/find\/?$/i, ""));
    }
  });

}
