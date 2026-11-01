{
  const { loadElement, clear: cleanElement } = SDT.dom;
  let active = null;
  // Set in the load handler: the page's token, and the limiter every automatic request goes through.
  let token = null;
  let limiter = null;
  // The page's progress job (SDT.status): every request in a row's chain goes through it.
  let job = null;
  // Set in the load handler: runs a failed row again. render wires each Retry button to it.
  let retry = null;

  // The counts in the order a row shows them, and the word its notes and errors use for each.
  const COUNTS = [{ key: "total", label: "Feature count" }, { key: "shape", label: "Shape count" }];
  // ArcGIS's "bad request", and its code for a shapefile that can't test its shape field.
  const UNSUPPORTED_CODES = [400, -2147220985];

  /**
   * Returns whether a field is queryable
   */
  const isQueryableField = (field) => ["esriFieldTypeGeometry","esriFieldTypeBlob","esriFieldTypeXML","esriFieldTypeRaster"].indexOf(field.type) === -1;

  /** The spatial reference badge: a link for a WKID, a neutral span for WKT, or null for no badge. */
  const badgeNode = (sr) => {
    const badge = SDT.row.badge(sr);
    if (!badge) {
      return null;
    }
    const node = badge.kind === "wkid"
      ? loadElement("a", { "class": `sdt-badge sdt-badge--sr sdt-badge--sr${badge.index}`, "href": badge.href })
      : loadElement("span", { "class": "sdt-badge sdt-badge--sr", "title": badge.title });
    node.append(loadElement("span", { "class": "sdt-visually-hidden" }, "Spatial reference "), document.createTextNode(badge.text));
    return node;
  };

  /** One Details group: its label, then a definition list or a sentence. */
  const detailsGroup = (group) => {
    const nodes = [loadElement("p", { "class": "sdt-details__group" }, group.group)];
    if (group.sentence) {
      nodes.push(loadElement("p", { "style": "margin:0" }, group.sentence));
      return nodes;
    }
    const list = loadElement("dl", { "class": "sdt-dl" });
    for (const { term, value, mono } of group.items) {
      list.append(loadElement("dt", {}, term), loadElement("dd", mono ? { "class": "sdt-mono" } : {}, value));
    }
    nodes.push(list);
    return nodes;
  };

  /** The row's disclosure. Everything in it is a text node, because server HTML has become text. */
  const detailsNode = (data) => {
    const details = loadElement("details", { "class": "sdt sdt-details sdt-details--inline" });
    const summary = loadElement("summary", {}, "Details ");
    const meta = SDT.row.summary(data);
    if (meta) {
      summary.appendChild(loadElement("span", { "class": "sdt-details__meta" }, meta));
    }
    const body = loadElement("div", { "class": "sdt-details__body" });
    for (const group of SDT.row.details(data, SDT.row.text)) {
      body.append(...detailsGroup(group));
    }
    details.append(summary, body);
    return details;
  };

  /** A spinner and what the row is waiting for. */
  const statusNode = (text) => {
    const node = loadElement("span", { "class": "sdt-status" });
    node.append(loadElement("span", { "class": "sdt-spinner", "aria-hidden": "true" }), document.createTextNode(text));
    return node;
  };

  /** A failure on the row. Colour only repeats what the icon and the words say. */
  const errorNode = (text) => {
    const node = loadElement("span", { "class": "sdt-status", "data-tone": "error" });
    node.append(SDT.icon("error"), document.createTextNode(text));
    return node;
  };

  /** A count: its number in bold, or the warning badge for no features or rows at all. */
  const countNode = (key, value, data) => {
    const noun = `${data.type === "Table" ? "row" : "feature"}${value === 1 ? "" : "s"}`;
    if (key === "total" && value === 0) {
      const badge = loadElement("span", { "class": "sdt-badge sdt-badge--warn" });
      badge.append(SDT.icon("warn"), loadElement("span", { "class": "sdt-visually-hidden" }, "Warning: "), document.createTextNode(`0 ${noun}`));
      return badge;
    }
    const node = loadElement("span", { "class": "sdt-count" });
    node.append(loadElement("b", {}, value.toLocaleString("en-CA")), document.createTextNode(key === "shape" ? " with shapes" : ` ${noun}`));
    return node;
  };

  /** The row's Retry button, the only button in its annot, or null. */
  const retryButton = (row) => row.annot?.querySelector("button") ?? null;

  /** True when focus is on the row's Retry button. Not :focus, which can miss in an inactive window. */
  const retryHasFocus = (row) => {
    const button = retryButton(row);
    return button !== null && button === document.activeElement;
  };

  /** What Retry would run, for its hidden text: the row's error first, or the first failed count. */
  const retryText = (row) => {
    const count = COUNTS.find(({ key }) => row.counts[key]?.error !== undefined);
    return ` ${row.error === null && count ? count.label.toLowerCase() : "details"} for ${row.name}`;
  };

  /** A running Retry stays, focusable, with aria-disabled, as Load more does. */
  const retryNode = (row) => {
    const running = row.retrying !== null;
    const button = loadElement("button", { "class": "sdt-button sdt-button--quiet", "type": "button" }, "Retry");
    button.appendChild(loadElement("span", { "class": "sdt-visually-hidden" }, running ? row.retrying : retryText(row)));
    if (running) {
      button.setAttribute("aria-disabled", "true");
    }
    SDT.guard.listen(button, "click", () => retry(row));
    return button;
  };

  /**
   * Notes which of the annot's controls has focus, before it is rebuilt. The function it returns
   * puts focus on the rebuilt control, if there is one.
   */
  const holdFocus = (annot) => {
    const tag = annot.contains(document.activeElement) ? document.activeElement.localName : null;
    return () => {
      if (tag) {
        annot.querySelector(tag)?.focus({ preventScroll: true });
      }
    };
  };

  /**
   * Draws a row from its model. The annot's children are rebuilt each time, in the order badges,
   * spinner, counts, notes and errors, then Retry. The disclosure is made once and never replaced, so one
   * the user has open stays open. A row with nothing to show keeps no annot at all.
   * @function render
   * @param {object} row - the row model
   */
  const render = (row) => {
    row.annot ??= loadElement("span", { "class": "sdt sdt-annot" });
    const restoreFocus = holdFocus(row.annot);
    cleanElement(row.annot);
    if (row.loading) {
      row.annot.appendChild(statusNode("Loading details"));
    }
    if (row.data) {
      const badge = badgeNode(SDT.row.spatialReference(row.data));
      const cache = row.data.type === "Table" ? "Table" : SDT.row.cacheLabel(row.data);
      if (badge) {
        row.annot.appendChild(badge);
      }
      if (cache) {
        row.annot.appendChild(loadElement("span", { "class": "sdt-badge" }, cache));
      }
      if (row.counting) {
        row.annot.appendChild(statusNode("Counting features"));
      }
      for (const { key } of COUNTS) {
        if (row.counts[key]?.value !== undefined) {
          row.annot.appendChild(countNode(key, row.counts[key].value, row.data));
        }
      }
      for (const note of row.fieldNotes) {
        row.annot.appendChild(loadElement("span", { "class": "sdt-muted" }, note));
      }
      for (const { key, label } of COUNTS) {
        if (row.counts[key]?.unsupported) {
          row.annot.appendChild(loadElement("span", { "class": "sdt-muted" }, `${label} not supported by this data source`));
        } else if (row.counts[key]?.error !== undefined) {
          row.annot.appendChild(errorNode(`${label} failed: ${row.counts[key].error}`));
        }
      }
    }
    if (row.error !== null) {
      row.annot.appendChild(errorNode(`Details unavailable: ${row.error}`));
    }
    if (row.retrying !== null || (row.outcome === "failed" && SDT.status.canRetry())) {
      row.annot.appendChild(retryNode(row));
    }
    if (!row.annot.firstChild) {
      row.annot.remove();
    } else if (!row.annot.isConnected) {
      row.parent.insertBefore(row.annot, row.details);
    }
    if (row.data && !row.details) {
      row.details = detailsNode(row.data);
      row.parent.appendChild(row.details);
    }
    restoreFocus();
  };

  /** True when a row's request was left out: by the budget, after pushback, or because the page was left. */
  const isLeftOut = (result) => SDT.net.isSkipped(result) || result?.error?.type === "aborted";

  /** True for a JSON object: a service description, or the like. */
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

  /** True when the data source can't answer the count, which isn't the server failing. */
  const isUnsupported = ({ error }) => error.status === 400 || UNSUPPORTED_CODES.includes(error.code ?? error.arcgis?.Code);

  /** What a finished count request puts in row.counts. */
  const countResult = (result) => {
    if (result.error) {
      return isUnsupported(result) ? { unsupported: true } : { error: SDT.row.failureText(result) };
    }
    return typeof result.data?.count === "number" ? { value: result.data.count } : { error: "The server's answer was not a count." };
  };

  /**
   * Counts a layer's features, and those with shapes, through the page's job. Each answer goes into
   * row.counts, so Load more sends only the counts with no value and no unsupported note.
   * @function getLayerCount
   * @param {string} url - the layer's url
   * @param {object} data - the layer's JSON
   * @param {object} row - the row
   * @param {boolean} [userAction] - a click sent this, so the request budget doesn't apply
   * @returns {Promise<"done" | "failed" | "skipped">}
   */
  const getLayerCount = async (url, data, row, userAction) => {
    let oid, shape;
    if (data.objectIdField) {
      oid = data.objectIdField;
    }
    for (const field of data.fields) {
      if (field?.type === "esriFieldTypeOID" || field?.type === "") {
        oid = field?.name;
      } else if (field?.type === "esriFieldTypeGeometry") {
        shape ??= field?.name;
      }
    }
    shape ??= data.geometryField?.name;

    row.fieldNotes = [
      !oid && "No way to query features.",
      !shape && data.type && data.type !== "Table" && "No visible shape field available."
    ].filter(Boolean);

    const fields = { total: oid, shape };
    const missing = COUNTS.map(({ key }) => key)
      .filter((key) => fields[key] && row.counts[key]?.value === undefined && !row.counts[key]?.unsupported);
    for (const key of missing) {
      delete row.counts[key];
    }
    row.counting = missing.length > 0;
    render(row);

    const queryUrl = `${url.replace(/\/+$/, "")}/query`;
    const results = await Promise.all(missing.map((key) => job.fetch(queryUrl, {
      params: { where: `${fields[key]} IS NOT NULL`, returnGeometry: "false", returnCountOnly: "true", f: "json" },
      token,
      userAction
    })));

    row.counting = false;
    results.forEach((result, i) => {
      if (!isLeftOut(result)) {
        row.counts[missing[i]] = countResult(result);
      }
    });
    render(row);
    if (results.some(isLeftOut)) {
      return "skipped";
    }
    return Object.values(row.counts).some((count) => Object.hasOwn(count, "error")) ? "failed" : "done";
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
  // Starts and stops are counted per class, so work that finishes can't clear another's busy class.
  const loadingCounts = new Map();
  const notifyLoading = (value, cssClass) => {
    const count = (loadingCounts.get(cssClass) ?? 0) + (value ? 1 : -1);
    loadingCounts.set(cssClass, count);
    document.body.classList.toggle(cssClass, count > 0);
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
      name: tags[item.i].textContent.trim(),
      data: null,
      outcome: null,
      loading: false,
      counting: false,
      error: null,
      counts: {},
      fieldNotes: [],
      annot: null,
      details: null,
      // The running Retry's hidden text, kept because the error that named it is cleared; null when idle.
      retrying: null
    }));
    const canCountFeatures = settings.autoFeatureCounts;

    /** Sends the requests the row is missing, and reports exactly one outcome for it to the job. */
    const loadRow = async (row, { userAction } = {}) => {
      let outcome = "failed";
      try {
        row.error = null;
        if (!row.data) {
          row.loading = true;
          render(row);
          const result = await job.fetch(row.url, { params: { f: "json" }, token, userAction });
          row.loading = false;
          if (isLeftOut(result)) {
            outcome = "skipped";
            render(row);
            return;
          }
          if (result.error || !isObject(result.data)) {
            row.error = result.error ? SDT.row.failureText(result) : "The server's answer was not a service description.";
            render(row);
            return;
          }
          row.data = result.data;
          render(row);
        }
        // Only a layer's JSON has fields, so only layer rows get counts.
        outcome = canCountFeatures && row.data?.fields?.length
          ? await getLayerCount(row.url, row.data, row, userAction)
          : "done";
      } catch (error) {
        // A row that cannot be drawn fails alone, with an error line, and the others carry on.
        console.debug("SD Toolkit: could not show a row", error);
        row.loading = false;
        row.counting = false;
        row.error = "Could not show this row's details.";
        // With no disclosure drawn, the data is no use to the row: Retry has to fetch it again.
        if (!row.details) {
          row.data = null;
        }
        render(row);
        outcome = "failed";
      } finally {
        row.outcome = outcome;
        job[outcome]();
        // After the job hears, so pushback removes a focused Retry first. Retry follows the outcome.
        render(row);
      }
    };

    /** Loads the rows, with the busy class on <body> until every one has settled. */
    const collectMetaData = async (batch, options) => {
      notifyLoading(true, LOADING_METADATA_CSS);
      try {
        const results = await Promise.allSettled(batch.map((row) => loadRow(row, options)));
        const thrown = results.find((result) => result.status === "rejected");
        if (thrown) {
          throw thrown.reason;
        }
      } finally {
        notifyLoading(false, LOADING_METADATA_CSS);
      }
    };

    retry = (row) => {
      if (row.retrying !== null || !SDT.status.canRetry()) {
        return;
      }
      row.retrying = retryText(row);
      job.retryingFailed(1);
      render(row);
      collectMetaData([row], { userAction: true })
        .catch(SDT.guard.wrap((error) => console.debug("SD Toolkit: Retry stopped", error)))
        .finally(SDT.guard.wrap(() => {
          const hadFocus = retryHasFocus(row);
          row.retrying = null;
          render(row);
          // A Retry that failed again is back under focus; otherwise the button has gone.
          if (hadFocus && !retryButton(row)) {
            (row.details?.querySelector("summary") ?? row.anchor).focus({ preventScroll: true });
          }
        }));
    };

    /** After pushback no Retry can send, so every one goes, and focus on one moves to the bar's message. */
    const removeRetries = ({ stopped }) => {
      const offered = stopped ? rows.filter((row) => retryButton(row)) : [];
      if (!offered.length) {
        return;
      }
      const hadFocus = offered.some(retryHasFocus);
      for (const row of offered) {
        row.retrying = null;
        render(row);
      }
      if (hadFocus) {
        const status = document.querySelector(".sdt-statusbar [role=\"status\"]");
        status?.setAttribute("tabindex", "-1");
        status?.focus();
      }
    };

    if (rows.length && settings.autoMetadata) {
      SDT.status.subscribe(removeRetries);
      job = SDT.status.job(type === "service" || type === "layer" ? "layers" : "services", rows.length);
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
