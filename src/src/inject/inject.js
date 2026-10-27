{
  const { loadElement, clear: cleanElement } = SDT.dom;
  const COLORHASH = {};
  let active = null;
  // Set in the load handler: the page's token, and the limiter every automatic request goes through.
  let token = null;
  let limiter = null;

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
    if (COLORHASH[item]) { return COLORHASH[item]; }
    COLORHASH[item] = "#" + (0x1000000 + (Math.random()) * 0xffffff).toString(16).substr(1, 6);
    return COLORHASH[item];
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
    const col = COLORHASH[item],
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

  /**
   * Queries for the feature count and the features with geometries
   * @function getLayerCount
   * @param {string} url - map service url
   * @param {object} data - the JSON data collected from the map service
   * @param {function} callback - callback function once the query is complete.
   */
  const getLayerCount = (url, data, callback) => {
    const ul = document.createElement("ul");
    let oid, shape;

    if (data && Object.hasOwn(data, "objectIdField") && data.objectIdField) {
      oid = data.objectIdField;
    }
    if (data && Object.hasOwn(data, "fields") && data.fields.length) {
      data.fields.some((field) => {
        switch(field.type) {
          case "esriFieldTypeOID":
          case "":
            oid = field.name;
            break;
          case "esriFieldTypeGeometry":
            shape = field.name;
            break;
        }
        return oid && shape;
      });
    }

    const count = async (field, label, fieldType) => {
      const result = await limiter.fetchJson(`${url}/query`, {
        params: { where: `not ${field} is null`, returnGeometry: "false", returnCountOnly: "true", f: "json" },
        token
      });
      if (SDT.net.isSkipped(result)) {
        ul.appendChild(skippedNote(result.error, "li"));
        return;
      }
      const response = SDT.net.legacyResponse(result);
      if (response === null) {
        return; // INJ-2: Phase 5 shows an error line here.
      }
      if (response.count !== undefined && response.count !== null) {
        ul.appendChild(li(label, response.count));
      }
      if (Object.hasOwn(response, "error") && response.error) {
        ul.appendChild(reportError(response.error, { "type": fieldType }));
      }
    };

    if (oid) {
      count(oid, "Number of features", "esriFieldTypeOID");
    } else {
      ul.appendChild(li("No way to query features."));
    }
    if (shape) {
      count(shape, "Features with shapes", "esriFieldTypeGeometry");
    } else if (!/\/featureserver\//i.test(url) && (data.type && data.type !== "Table")) {
      ul.appendChild(li("No visible shape field available."));
    }

    callback(ul);
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
   * Gets the time difference between the current time and the time presented
   * @function responseTime
   * @param {number} timeValue - milliseconds since January 1, 1970 UTC 
   * @returns {string} - text display of seconds or milliseconds between now and time submitted.
   */
  const responseTime = (timeValue) => {
    const timeDiff = Date.now() - timeValue;
    return "" + (timeDiff > 1000 ? timeDiff / 1000 : timeDiff + "m") + "s";
  };

  /**
   * gets a <b>old element previous to the current element
   * @function getPreviousLabel
   * @param {object} node - HTML DOM node
   * @returns {string} - content fo the <b> tag prior to the node
   */
  const getPreviousLabel = (node) => {
    let h = node; 
    while (h.previousSibling) { 
      h = h.previousSibling; 
      if (h.tagName === "B") {
        break; 
      } 
    } 
    return h.innerHTML;
  };

  /**
   * Finds where the fields are listed on the current web page.
   * @function getFieldList
   * returns {object[]} - list of list items containing field data.
   */
  const getFieldList = () => {
    const uls = document.getElementsByTagName("ul"),
      labels = [].map.call(uls, getPreviousLabel);
    for (let i = uls.length - 1; i > -1; i--) {
      if (/^Fields:/.test(labels[i])) {
        return [].slice.call(uls[i].children, 0);
      }
    }
    return null;
  };

  /**
   * Goes through each field in the list, requesting how many non-null values there are for that field.
   * @function checkForNulls
   * @param {string} url - map service url to query
   * @param {object[]} fields - list of JSON field data on that map service
   * @param {object[]} nodes - HTML DOM nodes corresponding to the fields in the other list.
   */
  const checkForNulls = async (url, fields, nodes) => {
    if (!fields.length) {
      notifyLoading(false, LOADING_NULLS_CSS);
      return;
    }
    const field = fields.shift(),
      node = nodes.shift(),
      resultList = document.createElement("ul");
    node.appendChild(resultList);
    const countRow = async (where, label) => {
      const timeCheck = Date.now();
      const result = await limiter.fetchJson(`${url}/query`, { params: { where, returnGeometry: "false", returnCountOnly: "true", f: "json" }, token });
      if (SDT.net.isSkipped(result)) {
        resultList.appendChild(skippedNote(result.error, "li"));
        return "skipped";
      }
      const response = SDT.net.legacyResponse(result);
      if (response === null) {
        return "failed"; // INJ-2: today's chain stops here; Phase 5 carries on with an error line.
      }
      const hasError = Object.hasOwn(response, "error") && !!response.error;
      let item = document.createElement("li");
      if (response.count !== undefined && response.count !== null) {
        item.appendChild(loadElement("b", {}, label));
        item.appendChild(document.createTextNode(` ${response.count} `));
        if (response.count === 0) {
          item.appendChild(loadElement("b", {"style": "color:#f00;"}, "!!! "));
        }
        item.appendChild(loadElement("i", {}, `Response time: ${responseTime(timeCheck)}`));
      } else if (hasError) {
        item = reportError(response.error, label === "Features with values:" ? field : undefined);
      }
      resultList.appendChild(item);
      return hasError ? "error" : "counted";
    };
    const first = await countRow(`not ${field.name} is null`, "Features with values:");
    if (first === "failed") {
      return;
    }
    if (first === "counted" && field.type === "esriFieldTypeString") {
      if (await countRow(`not ${field.name} is null and ${field.name} <> ''`, "Features without empty values:") === "failed") {
        return;
      }
    }
    checkForNulls(url, fields, nodes);
  };

  /**
   * Queries domain values for each 
   * @function checkDomains
   * @param {string} url - map service url to query
   * @param {object[]} fields - a list of field JSON provided by map service
   * @param {object[]} nodes - list of HTML DOM nodes corresponding to the fields list
   * @param {object} [tr] - possible list to attach domain search results to.
   */
  const checkDomains = async (url, fields, nodes, tr) => {
    if (!fields.length) {
      notifyLoading(false, LOADING_DOMAINS_CSS);
      return;
    }
    if (!tr) {
      const node = nodes.shift();
      tr = document.createElement("ul");
      node.appendChild(tr);
    }
    if (fields[0].length) {
      const item = fields[0].shift(),
        value = item.type === "esriFieldTypeString" ? "'" + item.code + "'" : item.code;
      const result = await limiter.fetchJson(`${url}/query`, {
        params: { where: `${item.field} = ${value}`, returnGeometry: "false", returnCountOnly: "true", f: "json" },
        token
      });
      if (SDT.net.isSkipped(result)) {
        tr.appendChild(skippedNote(result.error, "li"));
      } else {
        const response = SDT.net.legacyResponse(result);
        if (response === null) {
          return; // INJ-2: today's chain stops here; Phase 5 carries on with an error line.
        }
        let node = document.createElement("li");
        const hasError = Object.hasOwn(response, "error") && !!response.error;
        if (response.count !== undefined && response.count !== null) {
          node.appendChild(loadElement("b", {}, `${item.name}: `));
          node.appendChild(document.createTextNode(` ${response.count} `));
          if (response.count === 0) {
            node.appendChild(loadElement("b", {"style": "color:#f00;"}, "!!! "));
          }
        } else if (hasError) {
          node = reportError(response.error);
        }
        tr.appendChild(node);
      }
      if (fields[0].length) {
        checkDomains(url, fields, nodes, tr);
      } else {
        fields.shift();
        if (fields.length) {
          checkDomains(url, fields, nodes);
        } else {
          notifyLoading(false, LOADING_DOMAINS_CSS);
        }
      }
    } else {
      notifyLoading(false, LOADING_DOMAINS_CSS);
    }
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


  // Field and coded-value counts still run on every layer page. Phase 5 (#45) replaces them with a
  // Count values button, so the settings schema has no keys for them (design review decision 2).
  const COUNT_FIELD_VALUES = true;
  const COUNT_DOMAIN_VALUES = true;

  const LOADING_METADATA_CSS = "sdt-loading-metadata";
  const LOADING_NULLS_CSS = "sdt-loading-nulls";
  const LOADING_DOMAINS_CSS = "sdt-loading-domains";
  const LOADING_SOMETHING_CSS = "sdt-loading-something";
  const notifyLoading = (value, cssClass) => {
    const bodyClasses = (document.body.className || "").split(" ");
    if (value) {
      // add loading css to page
      bodyClasses.push(cssClass);
    } else {
      let index = bodyClasses.indexOf(cssClass);
      if (index > -1) {
        // remove the loading CSS
        bodyClasses.splice(index, 1);
      }
    }
    document.body.className = bodyClasses.join(" ");
  };

  /** Counts values for each field and coded value of the layer at url. */
  const countFields = async (url) => {
    const results = SDT.net.legacyResponse(await limiter.fetchJson(url, { params: { f: "json" }, token }));
    // The answer can arrive after an update has cut this script off.
    if (!SDT.guard.alive()) {
      return;
    }
    if (results && results.fields && results.fields.length > 0) {
      const fieldHTML = getFieldList();
      const hasDomainTest = (field) => !!field && field.domain && field.domain.codedValues;

      const domainFields = [];
      let domainFieldHTML;
      if (COUNT_FIELD_VALUES) {
        notifyLoading(true, LOADING_NULLS_CSS);
        checkForNulls(url, results.fields.slice(0), fieldHTML.slice(0));
      }
      if (COUNT_DOMAIN_VALUES && results.fields.some(hasDomainTest)) {

        domainFieldHTML = fieldHTML.slice(0);

        results.fields.forEach((field, i) => {
          if (hasDomainTest(field)) {
            domainFields.push(field.domain.codedValues.map((item) => {
              // future reference: check if Object.assign supported by Chrome
              item.field = field.name;
              item.type = field.type;
              return item;
            }));
          } else {
            domainFieldHTML[i] = null;
          }
        });

        // filter out nulled out HTML nodes.
        domainFieldHTML = domainFieldHTML.filter((item) => !!item );
        notifyLoading(true, LOADING_DOMAINS_CSS);
        checkDomains(url, domainFields, domainFieldHTML, null);
      }
    }
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

    /** Collects and shows each linked service's details, through the limiter. */
    const collectMetaData = async (items, canCountFeatures) => {
      await Promise.all(items.map(async (item) => {
        const parent = tags[item.i].parentNode;
        const result = await limiter.fetchJson(item.url, { params: { f: "json" }, token });
        if (SDT.net.isSkipped(result)) {
          parent.appendChild(skippedNote(result.error, "span"));
          return;
        }
        if (result.error?.type === "aborted") {
          return;
        }
        const response = SDT.net.legacyResponse(result) ?? { error: { message: result.error.message } };
        const spatialReferenceNode = showSpatialReferenceData(response),
          metadata = showMetadata(response);
        if (spatialReferenceNode !== null) {
          parent.appendChild(spatialReferenceNode);
        }
        if (metadata !== null) {
          parent.appendChild(metadata);
        }
        // if the service has fields, get the layer count
        if (response.fields && response.fields.length && canCountFeatures) {
          getLayerCount(item.url, response, (countList) => {
            parent.appendChild(countList);
          });
        }
      }));
      notifyLoading(false, LOADING_METADATA_CSS);
    };

    // Field and domain counts on layer pages and ImageServer pages. These requests go to the limiter
    // before the metadata requests, as they did when the settings arrived in a storage callback.
    if (type === "layer" || (type === "service" && SDT.page.serviceType(location) === "ImageServer")) {
      countFields(url);
    }

    if (urls.length && settings.autoMetadata) {
      notifyLoading(true, LOADING_METADATA_CSS);
      collectMetaData(urls, settings.autoFeatureCounts);
    }

    if (type === "find") {
      findHelper(url.replace(/\/find\/?$/i, ""));
    }
  });

}
