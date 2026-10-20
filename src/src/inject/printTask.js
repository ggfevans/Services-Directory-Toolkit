{
  const { loadElement } = SDT.dom;
 
  /**
   * Hides an input
   * @param {HTML} node 
   * @returns {string} original type of the node to show later on.
   */
  const hideInput = (node) => {
    let type = node.type || "";
    switch (node.tagName) {
      case "INPUT":
        node.setAttribute("type", "hidden");
        break;
      default:
        node.classList.add("sdt-hidden");
    }
    return type;
  };

  /**
   * Show the form elemeent
   * @param {HTML} node element to show.
   * @param {string} type - original type of the node 
   */
  const showInput = (node, type) => {
    switch (node.tagName) {
      case "INPUT":
        node.setAttribute("type", type);
        break;
      default:
        node.classList.remove("sdt-hidden");
    }
  };

  /**
   * Switches a text blank for a select element if choices are present.
   * @function swapInChoice
   * @param {object[]} nodes - list of HTML DOM nodes for text blanks and textareas in the form
   * @param {object} param - GP task parameters taken from REST Service.
   * @param {boolean} addOther - If true, add an "other" 
   */
  function swapInChoice (nodes, param, addOther) {
    const otherValue = "||||:OIJ:DOIJFOWIJVPWIO||||";
    if (!param.choiceList) {
      return;
    }
    // convert addOther to boolean
    addOther = !!addOther;

    const nodesByName = nodes.filter((node) => node.name === param.name);

    if (nodesByName && nodesByName.length > 0) {
      nodesByName.forEach((nodeToReplace) => {
        const select = loadElement("select", {});
        let nodeType;
        //"name": param.name
          
        // generate options
        param.choiceList.forEach((choice) => {
          const option = loadElement("option", {
            value: choice
          }, choice);
          select.appendChild(option);
        });

        if (addOther) {
          select.appendChild(loadElement("option", {
            value: otherValue
          }, "Other..."));
        }
        
        nodeType = hideInput(nodeToReplace);

        // when the select is triggered, update the value of the element
        SDT.guard.listen(select, "change", () => {
          if (select.value === otherValue) {
            showInput(nodeToReplace, nodeType);
            nodeToReplace.value = "";
          } else {
            hideInput(nodeToReplace);
            nodeToReplace.value = select.value;
          }
        });

        if (!nodeToReplace.value) {
          select.value = param.defaultValue;
          nodeToReplace.value = param.defaultValue;
        } else {
          select.value = nodeToReplace.value;
        }
        // replace existing node with select node.
        nodeToReplace.parentNode.insertBefore(select, nodeToReplace);
        // nodeToReplace.parentNode.replaceChild(select, nodeToReplace);
        
      });
    }
  }

  /**
   * Modifies the Geoprocessing form to make choices easier. 
   * @function updateGPForm
   * @param {object} response
   * @returns
   */
  const updateGPForm = (response) => {
    if (!response.parameters) {
      alert("Could not find GP parameters for this task.");
      return;
    }
    try {
      const myForm = document.getElementsByTagName("FORM")[0];
      // get TextAreas in form
      let blanks = Array.prototype.slice.call(myForm.getElementsByTagName("TEXTAREA"), 0);
      // concat in list of inputs in the form
      blanks = blanks.concat(Array.prototype.slice.call(myForm.getElementsByTagName("INPUT"), 0));
      // for each parameter in the geoprocessing JSON, swap in choices 
      response.parameters.forEach(swapInChoice.bind(this, blanks));
      // look for Web_Map_as_JSON blank to fill in with default value.
      blanks.some((blank) => {
        if (blank.name === "Web_Map_as_JSON" && /^\s*$/.test(blank.value)) {
          chrome.storage.sync.get({
            defaultWebMapAsJSON: ""
          }, SDT.guard.wrap((items) => {
            blank.value = items.defaultWebMapAsJSON;
          }));
        }
        return blank.name === "Web_Map_as_JSON";
      });
    } catch (err) {
      console.error("Services Directory Toolkit: could not fill in the form", err);
      alert("Invalid form.");
    }
  };

  SDT.guard.run(async () => {
    // Only a task's execute or submitJob form: not its JSON result (PRT-1).
    if (SDT.page.classify(location, document) !== "gpTask") {
      return;
    }
    const url = SDT.page.baseUrl(location).replace(/\/(execute|submitjob)\/?$/i, "");
    const result = await SDT.net.pageLimiter().fetchJson(url, { params: { f: "json" }, token: SDT.auth.pageToken(location) });
    const response = SDT.net.legacyResponse(result);
    if (response !== null) {
      // The extension may have been updated while the request was out.
      SDT.guard.run(updateGPForm, response);
    }
  });
}
