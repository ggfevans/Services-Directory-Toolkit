{
  let active;
  const { loadElement, clear: cleanElement } = SDT.dom;
  
  


  const LOADING_CSS = "sdt-loading-querytest";
  const notifyLoading = (value) => {
    const bodyClasses = (document.body.className || "").split(" ");
    if (value) {
      // add loading css to page
      bodyClasses.push(LOADING_CSS);
    } else {
      let index = bodyClasses.indexOf(LOADING_CSS);
      if (index > -1) {
        // remove the loading CSS
        bodyClasses.splice(index, 1);
      }
    }
    document.body.className = bodyClasses.join(" ");
  };

  /**
   * Returns whether a field is queryable
   * @function isQueryableField
   * @param {object} field
   * @param {string} field.type - field type
   * @returns {boolean} - true if it is a queryable field
   */
  const isQueryableField = (field) => ["esriFieldTypeGeometry","esriFieldTypeBlob","esriFieldTypeXML","esriFieldTypeRaster"].indexOf(field.type) === -1;

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
    if (active === undefined) {
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
    [].forEach.call(node.querySelectorAll(selector), (el) => {
      SDT.guard.listen(el, evt, callback);
    });
  };

  /**
   * Inserts pre-defined data into a form on a page
   * @function quickFormFillin
   * @param {object} formData - JSON of name, value pairs to insert in the form
   * @param {boolean} clickSubmit - if true, click the submit button
   */
  function quickFormFillin (formData, clickSubmit) {
    let formFields = Array.prototype.slice.call(document.getElementsByTagName("INPUT"), 0);
  
    formFields = formFields.concat(Array.prototype.slice.call(document.getElementsByTagName("TEXTAREA"), 0));
    
    if (!formFields || formFields.length < 1) {
      return;
    }

    formFields.forEach((item) => {
      if (Object.hasOwn(formData, item.name)) {
        if (item.type && item.type === "radio" && formData[item.name] === item.value) {
          item.checked = true;
        } else {
          item.value = formData[item.name];
        }
      }
    });

    if (!clickSubmit) 
      return;

    chrome.storage.sync.get({
      queryHelperSelectAll: "get"
    }, SDT.guard.wrap((item) => {
      const submitButtons = document.querySelectorAll("input[type='submit']");
      let submitButton;
      switch(item.queryHelperSelectAll) {
        case "get":
          submitButton = submitButtons[0];
          break;
        case "post":
          submitButton = submitButtons[1];
          break;
      }

      if (submitButton) {
        submitButton.click();
      } 
    }));
  }
  
  /**
   * Inserts a button in a panel that will quickly fill in a form when clicked
   * @function insertQuickFillinButton
   * @param {object} parentElement - panel or element where the button will be added
   * @param {string} content - Text inside the button
   * @param {object} formData - JSON of name, value pairs to insert in the form
   * @param {boolean} clickSubmit - if true, click the submit button
   * 
   */
  const insertQuickFillinButton = (parentElement, content, formData, clickSubmit) => {
    let buttonConfig = {type: "button"};
    if (clickSubmit) {
      buttonConfig.title = "Clicking here will auto-submit your request (see options for details)";
    }
    let quickBtn = loadElement("BUTTON", buttonConfig, content);
    SDT.guard.listen(quickBtn, "click", quickFormFillin.bind(this, formData, !!clickSubmit));
    parentElement.appendChild(quickBtn);
    parentElement.appendChild(document.createElement("br"));
  };

  /**
   * Adds a statistic option to the outStatistics blank.
   * @function addStatistic
   * @param {string} statisticType - statistic type to collect from the service
   * @returns {string}
   */
  function addStatistic(statisticType) {
    if (!active || active.name !== "outStatistics") {
      return;
    }
    let activeText = active.value,
      statContent = [];
    if (activeText.length) {
      try {
        statContent = JSON.parse(activeText);
        if (!(statContent instanceof Array)) {
          throw "Not a valid array";
        }
      } catch {
        statContent = [];
      }
    }

    statContent.push({
      "statisticType": statisticType,
      "onStatisticField": "",
      "outStatisticFieldName": ""
    });

    active.value = JSON.stringify(statContent);
    return active.value;
  }
  
  /**
   * Adds statistics buttons to a side panel.
   * @function addStatisticsControl
   * @param {object} parentNode - HTML dom node of the sidepanel or whatever control you're adding
   */
  function addStatisticsControl (parentNode) {
    ["Count", "Sum", "Min", "Max", "Avg", "StdDev", "Var"].forEach(function (stat) {
      const btn = loadElement("BUTTON", {"type":"button", "class": "sdt-statistic", "style": "display:none;"}, stat);
      SDT.guard.listen(btn, "click", addStatistic.bind(this, stat.toLowerCase()));
      parentNode.appendChild(btn);
    });

    // show/hide buttons on textbox focus
    listenAll(document, "input[type=text], textarea", "focus", function () {
      const buttonNodes = document.querySelectorAll(".sdt-statistic"),
        il = buttonNodes.length;

      for (let i = 0; i < il; i++) {
        if (this && this.name && this.name === "outStatistics") {
          buttonNodes[i].style.display = "inline-block";
        } else {
          buttonNodes[i].style.display = "none";
        }
      }
    });

  }

  /**
   * Adds the SQL control buttons to the sidepanel.
   * @function addSqlControl
   * @param {object} parentNode - HTML dom node of the sidepanel or whatever control you're adding
   */
  function addSqlControl (parentNode) {
    const btns = loadElement("DIV", {"class": "sdt-buttonbox"});
    [" = ", " <> ", " LIKE ", " > ", " >= ", " AND ", " < ", " <= ", " OR ", "_", "%", "()", "NOT ", " IS ", "*", "''", " IN ", ", ", "NULL" ].forEach(function (txt) {
      btns.appendChild(loadElement("button", {
        "class": "sdt-sql",
        "type": "button",
        "name": txt
      }, txt.replace(/\s+/g, "")));
    });
    parentNode.appendChild(btns);
  }


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
      const result = await SDT.net.pageLimiter().fetchJson(jsonUrl, { params: { f: "json" }, token: SDT.auth.pageToken(location) });
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
      dataItems = dataItems.filter(function (item) {
        return !item.subLayers || item.subLayers.length === 0;
      });
  
      //construct the layer selector
      const layerSelectorHeight = Math.min(dataItems.length, 5);
      this.layerSelect = loadElement("SELECT", {"size": layerSelectorHeight.toString(), "title": "Double-click to add to form."}),
      this.fieldSelect = loadElement("SELECT", {"size": "5", "title": "Double-click to add to form."}),
      this.valueList = loadElement("SELECT", {"size": "5", "title": "Double-click to add to form."});
  
      // add layer options, even if there is just one
      dataItems.forEach(function (item) {
        this.layerSelect.appendChild(loadElement("OPTION", {"value": item.id}, item.name || item.title));  
      }, this);
  
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
        setActive(evt.currentTarget.value);
      });

      // call the callback with the data items collected from the previous ajax call.
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
      dataItems.filter(function (item) {
        return item.id === layerId;
      }).forEach((item) => {
        
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
          fields.forEach(function (field) {
            this.fieldSelect.appendChild(loadElement("OPTION", {"value": field.name}, field.alias));  
          }, this);
        }
      });
    }

    /**
     * Update the value items
     * @param {string} url
     */
    async updateValues(url) {
      const val = this.fieldSelect.value;
      const layerId = this.layerSelect.value;
      // loading of values
      notifyLoading(true);
      cleanElement(this.valueList);
      this.valueList.appendChild(loadElement("option", {"value": ""}, "Loading..."));
      this.valueList.setAttribute("disabled", "disabled");
      // stop additional clicks on fieldSelect from subsequent calls
      this.fieldSelect.setAttribute("disabled", "disabled");
      // request distinct values. A click starts this, so it doesn't count toward the request limit.
      const result = await SDT.net.fetchJson(`${url}/${layerId}/query`, {
        params: { where: "1=1", returnGeometry: "false", outFields: val, orderByFields: val, returnDistinctValues: "true", f: "json" },
        token: SDT.auth.pageToken(location)
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
          const featureValue = isNaN(feature.attributes[val] * 1) ? `'${feature.attributes[val]}'`: feature.attributes[val];
          df.appendChild(loadElement("option", {"value": featureValue}, feature.attributes[val]));
        });  
      }
      this.valueList.appendChild(df);
      notifyLoading(false);
    }
  }

  /** 
   * Inserts a default where clause
   */
  const insertDefaultWhereClause = () => {
    chrome.storage.sync.get({
      defaultWhereClause: ""
    }, SDT.guard.wrap((items) => {
      const whereInput = document.querySelector("input[name = where]");
      // if the where clause input is empty and the defaultWhereClause is not, add it in.
      if (whereInput && !whereInput.value && items.defaultWhereClause) {
        whereInput.value = items.defaultWhereClause;
      }
    }));
  };

  /**
   * Builds the Query Helper panel
   * @function queryHelper
   * @param {string} url - url of the query service.
   */
  const queryHelper = (url) => {
    const sidepanel = new SidePanel("Query Helper");
    
    new FieldSelector(url, sidepanel.node, () => {
      const df = document.createDocumentFragment();
      addSqlControl(df);
    
      addStatisticsControl(df);
  
      // add quick helpers
      insertQuickFillinButton(df, "Select All *", { where: "1=1", outFields: "*", returnCountOnly: "false", returnGeometry: "true" }, true);
      insertQuickFillinButton(df, "Select All but Geometry *", { where: "1=1", outFields: "*", returnCountOnly: "false", returnGeometry: "false" }, true);
      insertQuickFillinButton(df, "Get Count Only *", { where: "1=1", returnDistinctValues: "false", returnCountOnly: "true", returnGeometry: "false" }, true);
      insertQuickFillinButton(df, "Select Distinct", { where: "1=1", returnDistinctValues: "true", returnGeometry: "false"});
  
      sidepanel.node.appendChild(df);

      // listen for SQL buttons to be clicked.
      listenAll(sidepanel.node, "button.sdt-sql", "click", function (evt) {
        setActive(evt.currentTarget.name);
      });

      insertDefaultWhereClause();
    }); 
  };

  const onPageLoaded = () => {
    // Only real query forms: not other operations, and not JSON results (QRY-3).
    if (SDT.page.classify(location, document) !== "query") {
      return;
    }
    queryHelper(SDT.page.baseUrl(location).replace(/\/query\/?$/i, ""));
  };

  SDT.guard.onLoad(onPageLoaded);
}