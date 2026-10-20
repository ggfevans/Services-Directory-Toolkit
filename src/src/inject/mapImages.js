{
  const { loadElement } = SDT.dom;
  const IMAGE_LOOKUP = {};
  const NO_IMAGE_SRC = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const WIDTH_HEIGHT = {
    width: 300,
    height: 200
  };

  // Hover previews send no token (Phase 6 keeps that rule) and don't use the request limiter,
  // because a hover is a user action.
  const getMapBBOX = async (url) => {
    const result = await SDT.net.fetchJson(url, { params: { f: "json" } });
    if (result.error) {
      throw new Error(result.error.message);
    }
    const data = result.data;
    let extent = [];
    if ("initialExtent" in data) {
      extent = [data.initialExtent.xmin, data.initialExtent.ymin, data.initialExtent.xmax, data.initialExtent.ymax];
    } else if ("fullExtent" in data) {
      extent = [data.fullExtent.xmin, data.fullExtent.ymin, data.fullExtent.xmax, data.fullExtent.ymax];
    }
    if (extent.length !== 4) {
      throw new Error(`Invalid extent length: ${extent.length}`);
    }
    return extent.join(",");
  };

  /**
   * @function getMapImageUrl
   * @param {string} url - link url
   * @returns {Promise<string>} url string for the image link.
   */
  const getMapImageUrl = async (url) => {
    if (url in IMAGE_LOOKUP) {
      return IMAGE_LOOKUP[url];
    }
    if (/[^/]$/.test(url)) {
      url = url + "/";
    }
    const bbox = await getMapBBOX(url);
    const size = `${WIDTH_HEIGHT.width},${WIDTH_HEIGHT.height}`;
    let request;
    if (/\/mapserver\/$/i.test(url)) {
      request = [`${url}export`, { size, format: "png32", f: "json", bbox }];
    } else if (/\/featureserver\/$/i.test(url)) {
      // try replacing feature server with map server
      request = [`${url.replace(/\/featureserver\/$/i, "/MapServer/")}export`, { size, format: "png32", f: "json", bbox }];
    } else if (/\/imageserver\/$/i.test(url)) {
      request = [`${url}exportImage`, { bbox, size, format: "jpgpng", f: "json" }];
    } else {
      throw new Error("Not a map or image service");
    }
    const result = await SDT.net.fetchJson(request[0], { params: request[1] });
    if (result.error || !result.data || typeof result.data !== "object" || !("href" in result.data)) {
      throw new Error("No image in the answer");
    }
    IMAGE_LOOKUP[url] = result.data.href;
    return IMAGE_LOOKUP[url];
  };

  /**
   * On hover, get map
   * @param {string} url - the link's URL, without its token, f and fragment
   */
  const hoverGetMap = async (url) => {
    notifyLoading(true);
    try {
      const href = await getMapImageUrl(url);
      const mapImage = document.getElementById("mapimage");
      mapImage.setAttribute("src", href);
      mapImage.classList.remove("sdt-none");
    } catch {
      console.log("Services Directory Toolkit: no map image for %s", url);
      hoverHideMap();
    }
    notifyLoading(false);
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
    // Links to map and image services on this server, outside the breadcrumbs. Each href loses its
    // token, f and fragment before the test (TOK-3). The page's own JSON link then points at the
    // page itself, so links to the page are left out.
    const pageScope = SDT.auth.scopeOf(location.href);
    const self = SDT.page.baseUrl(location).replace(/\/+$/, "");
    const tags = Array.prototype.slice.call(document.getElementsByTagName("a"), 0);
    const urls = tags
      .map((tag, i) => ({ i, url: SDT.url.stripForFilter(tag.href) }))
      .filter((item) => pageScope !== null
        && tags[item.i].parentNode.className !== "breadcrumbs"
        && item.url.replace(/\/+$/, "") !== self
        && SDT.auth.scopeOf(item.url) === pageScope
        && /(map|image)server\/?$/i.test(item.url));

    if (urls.length > 0) {
      // construct 
      constructImageContainer();

      // map display on hover
      urls.forEach((item) => {
        const tag = tags[item.i];

        SDT.guard.listen(tag, "mouseover", () => hoverGetMap(item.url));
      });
    }
  };

  const onPageLoaded = () => {
    const type = SDT.page.classify(location, document);
    if (type === "jsonView" || type === "other") {
      return;
    }
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