{
  const { loadElement } = SDT.dom;
  const IMAGE_LOOKUP = {};
  const NO_IMAGE_SRC = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const WIDTH_HEIGHT = {
    width: 300,
    height: 200
  };

  // 
  const reqStatus = (response) => {
    if (response.status >= 200 && response.status < 300) {
      return Promise.resolve(response);
    } else {
      return Promise.reject(new Error(response.statusText));
    }
  };

  const getJSON = (response) => response.json();

  const getMapBBOX = (url) => {
    return new Promise((resolve, reject) => {
      fetch(url + "?f=json")
        .then(reqStatus)
        .then(getJSON)
        .then((data) => {
          let extent = [];
          if ("initialExtent" in data) {
            extent = [data.initialExtent.xmin, data.initialExtent.ymin, data.initialExtent.xmax, data.initialExtent.ymax];
          } else if ("fullExtent" in data) {
            extent = [data.fullExtent.xmin, data.fullExtent.ymin, data.fullExtent.xmax, data.fullExtent.ymax];
          }
          if (extent.length === 4) {
            resolve(extent.join(","));
          }
          else {
            reject("Invalid extent length: " + extent.length);
          }
          
        })
        .catch((err) => {
          window.console && console.log("Fetch Error :-S", err);
          reject(err);
        });
    });
  };
  /**
   * @function getMapImageUrl
   * @param {string} url - link url
   * @returns {string} url string for the image link.
   */
  const getMapImageUrl = (url) => {
    return new Promise((resolve, reject) => {
      if (url in IMAGE_LOOKUP) {
        resolve(IMAGE_LOOKUP[url]);
      }
      
      if (/[^/]$/.test(url)) {
        url = url + "/";
      }
  
      getMapBBOX(url)
        .then((bbox) => {
          let exportUrl = url;
          if (/\/mapserver\/$/i.test(url)) {
            exportUrl += "export?size=" + WIDTH_HEIGHT["width"] + "," + WIDTH_HEIGHT["height"] + "&format=png32&f=json&bbox=" + bbox;
            return fetch(exportUrl);
          } else if (/\/featureserver\/$/i.test(url)) {
            // try replacing feature server with map server
            exportUrl = exportUrl.replace(/\/featureserver\/$/i, "/MapServer/");
            exportUrl += "export?size=" + WIDTH_HEIGHT["width"] + "," + WIDTH_HEIGHT["height"] + "&format=png32&f=json&bbox=" + bbox;
            return fetch(exportUrl);
          } else if (/\/imageserver\/$/i.test(url)) {
            exportUrl += "exportImage?bbox=" + bbox + "&size=" + WIDTH_HEIGHT["width"] + "," + WIDTH_HEIGHT["height"] + "&format=jpgpng&f=json";
            return fetch(exportUrl);
          } else {
            return Promise.reject("Invalid service type: " + url);
          }
        })
        .then(reqStatus)
        .then(getJSON)
        .then((data) => {
          if ("href" in data) {
            IMAGE_LOOKUP[url] = data["href"];
            resolve(IMAGE_LOOKUP[url]);
          } else {
            window.console && console.log("unexpected data error: ", url, data);
            reject("no data found");
          }
        })
        .catch(function (err) {
          reject(err);
        });
    });
  };

  /**
   * On hover, get map
   * @param {Event} evt 
   */
  const hoverGetMap = (evt) => {
    if (!evt || !evt.target) {
      return;
    }
    const url = evt.target.href;
    if (!url) {
      return;
    }
    
    notifyLoading(true);
    getMapImageUrl(url)
      .then((href) => {
        let mapImage = document.getElementById("mapimage");
        mapImage.setAttribute("src", href);
        mapImage.classList.remove("sdt-none");
        notifyLoading(false);
      }).catch(() => {
        window.console && console.log("Error getting image url from: %s", url);
        hoverHideMap();
        notifyLoading(false);
      });
  };

  const hoverHideMap = () => {
    let mapImage = document.getElementById("mapimage");
    mapImage.setAttribute("src",NO_IMAGE_SRC);
    mapImage.classList.add("sdt-none");
  };

  const LOADING_CSS = "sdt-loading-mapimage";
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

  const constructImageContainer = () => {    
    chrome.storage.sync.get({
      mapImageWidth: 300,
      mapImageHeight: 200
    }, SDT.guard.wrap((items) => {
      // update map image widht and height
      WIDTH_HEIGHT["width"] = items.mapImageWidth;
      WIDTH_HEIGHT["height"] = items.mapImageHeight;
      // construct parent container.
      let parentDiv = loadElement("DIV", {
        "class": "sdt-map-image-panel",
        "style": "min-width:" + items.mapImageWidth + "px;min-height:" + (items.mapImageHeight + 30) + "px;"
      });
      let mapDiv = loadElement("IMG", {
        id: "mapimage",
        src: NO_IMAGE_SRC,
        alt: "Map image goes here",
        "class": "sdt-none"
      });
      parentDiv.appendChild(mapDiv);
      parentDiv.appendChild(loadElement("P", {"style": "margin:2px 0;padding:0;"}, "Hover over a link to view."));
      document.body.appendChild(parentDiv);
    }));
  };

  const setup = () => {
    const tags = Array.prototype.slice.call(document.getElementsByTagName("a"), 0);
    const urls = tags.map((tag, index) =>  {
      return Object.create({}, {
        i: {
          value: index
        },
        url: {
          value: tag.href
        }
      });
    }).filter((item) => {
      // filter out links in the breadcrumbs section at the top of the page.
      if (tags[item.i].parentNode.className === "breadcrumbs") {
        return false;
      }
      return /(map|image)server\/?$/i.test(item.url);
    });

    if (urls.length > 0) {
      // construct 
      constructImageContainer();

      // map display on hover
      urls.forEach((item) => {
        const tag = tags[item.i];

        SDT.guard.listen(tag, "mouseover", hoverGetMap);
      });
    }
  };

  const onPageLoaded = () => {
    // collect the links on the web page to collect information about the content they link to.
    chrome.storage.sync.get({
      showMapImages: true
    }, SDT.guard.wrap((items) => {
      if (items.showMapImages) {
        setup();
      }
    }));
  };

  SDT.guard.onLoad(onPageLoaded);
}