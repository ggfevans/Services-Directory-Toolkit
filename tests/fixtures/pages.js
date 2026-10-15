// HTML pages shaped like the ArcGIS Server 10.9 and 11.x Services Directory. The structure is what
// the extension's content scripts read; the content is invented. That structure covers the table
// classes, the td.breadcrumbs links, the "<b>Label:</b>" lists, and the form names and controls.
//
// createPages() builds the pages for one site. Its defaults describe the Enterprise-style server at
// https://arcgis.test, and the named page exports below are those defaults. fake-arcgis.js also
// builds an ArcGIS Online-style site, which has no Login link and copies a page's token into its links.

export const REST_PATH = "/arcgis/rest/services";

const esc = (value) => String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]);

const servicePath = (service) => `/${service.name}/${service.type}`;
const serviceCrumb = (service) => [`${service.name.split("/").pop()} (${service.type})`, servicePath(service)];

const textRow = (name, label, params) => `<tr valign="top">
<td><label for="${name}">${label}:</label></td>
<td><input type="text" id="${name}" name="${name}" value="${esc(params.get(name))}" size="75"/></td>
</tr>`;

const textareaRow = (name, label, params) => `<tr valign="top">
<td><label for="${name}">${esc(label)}:</label></td>
<td><textarea id="${name}" name="${name}" rows="5" cols="55">${esc(params.get(name))}</textarea></td>
</tr>`;

const radioRow = (name, label, params, fallback) => {
  const value = params.get(name) ?? fallback;
  const checked = (option) => (value === option ? " checked=\"true\"" : "");
  return `<tr>
<td>${label}:</td>
<td>
  <label><input type="radio" name="${name}" value="true"${checked("true")} /> True &nbsp;</label>
  <label><input type="radio" name="${name}" value="false"${checked("false")} /> False</label>
</td>
</tr>`;
};

const formatRow = `<tr>
<td><label for="f">Format:</label></td>
<td><select id="f" name="f"><option value="html">HTML</option><option value="pjson">JSON</option></select></td>
</tr>`;

const submitRow = (verb) => `<tr>
<td colspan="2" align="left">
<input type="submit" value="${verb} (GET)" />
<input type="submit" onclick="this.form.method = 'post';" value="${verb} (POST)" />
</td>
</tr>`;

/**
 * Builds the page functions for one site.
 * - restPath: the REST root the pages link to
 * - crumbPath: the REST root the breadcrumbs link to. ArcGIS Online writes /<org>/ArcGIS/rest/services
 *   there, in a different case from its other links.
 * - loginHref: the Login link, or null for a site without one
 * - linkQuery: a query string such as "token=abc" added to every link. ArcGIS Online copies the token
 *   of a page opened with ?token= into its links this way.
 */
export const createPages = ({ restPath = REST_PATH, crumbPath = restPath, loginHref = "/arcgis/rest/login", linkQuery = "" } = {}) => {
  const href = (target) => esc(linkQuery ? `${target}${target.includes("?") ? "&" : "?"}${linkQuery}` : target);

  // Breadcrumb links: Home > services > each [text, path below the REST root] pair.
  const crumbs = (...items) => [["Home", ""], ["services", ""], ...items]
    .map(([text, path]) => `<a href="${href(`${crumbPath}${path}`)}">${esc(text)}</a>`)
    .join("\n  &gt; ");

  const shell = ({ title, breadcrumbs, body }) => `<html lang="en">
<head>
<title>${esc(title)}</title>
<link href="/arcgis/rest/static/main.css" rel="stylesheet" type="text/css"/>
</head>
<body>
<table width="100%" class="userTable">
<tr>
<td class="titlecell">ArcGIS REST Services Directory</td>
<td align="right">${loginHref ? `<a href="${esc(loginHref)}">Login</a>` : ""}</td>
</tr>
</table>
<table width="100%" class="navTable">
<tr valign="top">
<td class="breadcrumbs">
${breadcrumbs}
</td>
<td align="right"><a href="${href(`${restPath}?f=help`)}" target="_blank">API Reference</a></td>
</tr>
</table>
<table>
<tr><td class="apiref"><a href="${href("?f=pjson")}" target="_blank">JSON</a></td></tr>
</table>
<h2>${esc(title)}</h2>
<div class="rbody">
${body}
</div>
</body>
</html>
`;

  const folderPage = ({ folder, folders, services, version }) => shell({
    title: `Folder: /${folder}`,
    breadcrumbs: folder ? crumbs([folder, `/${folder}`]) : crumbs(),
    body: `<b>Current Version: </b>${version}<br/><br/>
${folders.length ? `<b>Folders: </b>
<ul>
${folders.map((name) => `<li><a href="${href(`${restPath}/${name}`)}">${esc(name)}</a></li>`).join("\n")}
</ul>` : ""}
<b>Services: </b>
<ul>
${services.map((s) => `<li><a href="${href(`${restPath}${servicePath(s)}`)}">${esc(s.name.split("/").pop())}</a> (${s.type})</li>`).join("\n")}
</ul>`
  });

  const servicePage = (service) => {
    const base = `${restPath}${servicePath(service)}`;
    const layers = service.layers || [];
    return shell({
      title: `${service.name} (${service.type})`,
      breadcrumbs: crumbs(serviceCrumb(service)),
      body: `<b>Service Description: </b> ${esc(service.info.serviceDescription)}<br/><br/>
${layers.length ? `<a href="${href(`${base}/layers`)}">All Layers and Tables</a><br/><br/>
<b>Layers: </b>
<ul>
${layers.map((layer) => `<li><a href="${href(`${base}/${layer.id}`)}">${esc(layer.name)}</a> (${layer.id})</li>`).join("\n")}
</ul>` : ""}
${service.tasks ? `<b>Tasks: </b>
<ul>
${service.tasks.map((task) => `<li><a href="${href(`${base}/${encodeURIComponent(task.name)}`)}">${esc(task.name)}</a></li>`).join("\n")}
</ul>` : ""}
<b>Copyright Text: </b> ${esc(service.info.copyrightText)}<br/><br/>`
    });
  };

  const layerPage = (service, layer) => {
    const base = `${restPath}${servicePath(service)}/${layer.id}`;
    return shell({
      title: `Layer: ${layer.name} (ID: ${layer.id})`,
      breadcrumbs: crumbs(serviceCrumb(service), [layer.name, `${servicePath(service)}/${layer.id}`]),
      body: `<b>Name:</b> ${esc(layer.name)}<br/><br/>
<b>Display Field:</b> ${esc(layer.displayField)}<br/><br/>
<b>Type: </b> ${esc(layer.type)}<br/><br/>
<b>Geometry Type:</b> ${esc(layer.geometryType)}<br/><br/>
<b>Fields: </b>
<ul>
${layer.fields.map((field) => `<li>
    ${esc(field.name)}<i>
(
type: ${field.type}, alias: ${esc(field.alias)}${field.length ? `, length: ${field.length}` : ""}
)
</i></li>`).join("\n")}
</ul>
<b>Supported Operations: </b> <a href="${href(`${base}/query`)}">Query</a>`
    });
  };

  const queryPage = (service, layer, params) => shell({
    title: `Query: ${layer.name} (ID: ${layer.id})`,
    breadcrumbs: crumbs(serviceCrumb(service), [layer.name, `${servicePath(service)}/${layer.id}`], ["query", `${servicePath(service)}/${layer.id}/query`]),
    body: `<form name="sdform" action="${restPath}${servicePath(service)}/${layer.id}/query">
<table class="formTable">
${textRow("where", "Where", params)}
${textRow("text", "Text", params)}
${textRow("objectIds", "Object IDs", params)}
${textRow("outFields", "Out Fields", params)}
${radioRow("returnGeometry", "Return Geometry", params, "true")}
${radioRow("returnIdsOnly", "Return IDs Only", params, "false")}
${radioRow("returnCountOnly", "Return Count Only", params, "false")}
${textRow("orderByFields", "Order By Fields", params)}
${textRow("groupByFieldsForStatistics", "Group By Fields (For Statistics)", params)}
${textareaRow("outStatistics", "Output Statistics", params)}
${radioRow("returnDistinctValues", "Return Distinct Values", params, "false")}
${formatRow}
${submitRow("Query")}
</table>
</form>`
  });

  const findPage = (service, params) => shell({
    title: `Find: ${service.name} (${service.type})`,
    breadcrumbs: crumbs(serviceCrumb(service), ["find", `${servicePath(service)}/find`]),
    body: `<form name="sdform" action="${restPath}${servicePath(service)}/find">
<table class="formTable">
${textRow("searchText", "Search Text", params)}
${radioRow("contains", "Contains", params, "true")}
${textRow("searchFields", "Search Fields", params)}
${textRow("sr", "Spatial Reference", params)}
${textRow("layers", "Layers", params)}
${textRow("layerDefs", "Layer Definitions", params)}
${radioRow("returnGeometry", "Return Geometry", params, "true")}
${formatRow}
${submitRow("Find")}
</table>
</form>`
  });

  const executePage = (service, task, params) => shell({
    title: `Execute Task: ${task.name}`,
    breadcrumbs: crumbs(serviceCrumb(service), [task.name, `${servicePath(service)}/${encodeURIComponent(task.name)}`], ["execute", `${servicePath(service)}/${encodeURIComponent(task.name)}/execute`]),
    body: `<form name="sdform" action="${restPath}${servicePath(service)}/${encodeURIComponent(task.name)}/execute">
<table class="formTable">
${task.json.parameters
  .filter((parameter) => parameter.direction === "esriGPParameterDirectionInput")
  .map((parameter) => textareaRow(parameter.name, parameter.displayName, params))
  .join("\n")}
<tr><td colspan="2"><b>Options:</b></td></tr>
${textRow("env:outSR", "Output Spatial Reference", params)}
${radioRow("returnZ", "ReturnZ", params, "false")}
${formatRow}
${submitRow("Execute Task")}
</table>
</form>`
  });

  return { folderPage, servicePage, layerPage, queryPage, findPage, executePage };
};

export const { folderPage, servicePage, layerPage, queryPage, findPage, executePage } = createPages();

export const otherPage = () => `<html lang="en">
<head><title>Not a Services Directory page</title></head>
<body><p>An ordinary page on the same host. It is not a Services Directory page.</p></body>
</html>
`;

// The login form ArcGIS Server redirects anonymous requests for a secured page to.
export const loginPage = () => `<html lang="en">
<head><title>ArcGIS Server Login</title></head>
<body>
<h2>Login</h2>
<form name="loginForm" method="post" action="/arcgis/rest/login">
<input type="text" name="username"/>
<input type="password" name="password"/>
<input type="submit" value="Login"/>
</form>
</body>
</html>
`;

// The token page that rest/info names as tokenServicesUrl.
export const tokensPage = () => `<html lang="en">
<head><title>Generate Token</title></head>
<body>
<h2>Generate Token</h2>
<form name="tokenForm" method="post" action="/arcgis/tokens/generateToken">
<input type="text" name="username"/>
<input type="password" name="password"/>
<input type="submit" value="Generate Token"/>
</form>
</body>
</html>
`;

// A page that says one thing, such as the error a server shows in place of a secured page.
export const messagePage = (text) => `<html lang="en">
<head><title>${esc(text)}</title></head>
<body><p>${esc(text)}</p></body>
</html>
`;
