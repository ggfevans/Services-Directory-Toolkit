# Token Support Groundwork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the test harness what the token work needs (secured services, sign-in cookies, ArcGIS Online stand-ins, real tab ids in popup tests) and commit the token probe, without changing the extension.

**Architecture:**
- The fake ArcGIS Server learns who a request runs as: a token parameter first, then the `agstoken` cookie. It hides secured services from anonymous listings and answers `rest/info` and `rest/self`.
- Two more fake origins stand in for an ArcGIS Online hosted-services host and for `www.arcgis.com`. The harness routes all three and still fails a request to any other host.
- The page builders become a factory, so the ArcGIS Online stand-in can link with its own root and copy `?token=` into its links.
- The probe from the brainstorming session moves into `scripts/` as a manual tool.

**Tech stack:** Node 24 (`^22.13.0 || >=24`), `node --test`, `@playwright/test` 1.64.0 with `channel: "chromium"`, ESLint 10.

**Spec:** `docs/superpowers/specs/2026-10-13-token-support-design.md`, sections 4, 6 and 9. Read it, `CLAUDE.md`, and the comments at the top of `tests/e2e/fixtures.js` and `tests/fixtures/fake-arcgis.js` before starting.

**Branch:** `token-groundwork`, created from `token-support-spec`, which holds the spec and this plan. Open the pull request against `main` once #31 has merged; until then, against `token-support-spec`.

## Global Constraints

- **No extension change.** Nothing under `src/` changes. Every existing unit and browser test passes without edits to its assertions.
- **Test data is synthetic.** Never commit HTML or JSON captured from an Esri server. Error codes and field names follow the ArcGIS REST API; every value is invented.
- **Fake origins:**
  - `https://arcgis.test`: Enterprise-style ArcGIS Server, REST root `/arcgis/rest/services`
  - `https://services9.arcgis.com`: ArcGIS Online hosted services, org ID `Fk3Org9xQ`
  - `https://www.arcgis.com`: only `/sharing/rest/community/self`
  - Playwright routing answers all three. No request leaves the machine.
- **Tokens** in fixtures use only `[A-Za-z0-9._-]`.
- **Playwright:** `@playwright/test` stays pinned at `1.64.0`. Browser tests launch with `channel: "chromium"`.
- **Code style:**
  - 2-space indent, double quotes, semicolons
  - `npm run lint` runs with `--max-warnings=0`
  - If lint flags only formatting in code copied from this plan, run `npx eslint --fix <file>`. Don't change the logic to satisfy it.
- **The probe never prints, logs or saves a token value or a password.**
- **Commit messages:** imperative subject, plain-English body, ending with:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

## Review Focus

The five failure modes most likely to let a broken token test pass later:

1. **The cookie never reaches the fake server.** Playwright's `request.headers()` leaves cookies out, and only `allHeaders()` has them. If the harness passes the wrong one, every signed-in test runs anonymously, and passes wherever the anonymous answer happens to match. Pinned by the first test in Task 5, which fails before the harness change.
2. **A secured service leaks into an anonymous Enterprise listing.** Tests for "What's public here?" would then pass without checking anything. Pinned in Task 3: the anonymous `Utilities` listing stays exactly `["Utilities/PrintingTools"]`, in JSON and in HTML.
3. **The page-builder refactor changes a page the 2.0.0 tests read.** Pinned in Task 1 by a before-and-after dump of every fixture page, which must be byte-identical.
4. **A token in both the query string and the form body.** Tests for "the token goes only in the POST body" need the two kept apart. Pinned in Task 2: `calls` records `query` and `body` separately.
5. **A redirect the harness follows without failing.** A token could leave through a 307 and the test would still pass. Pinned in Task 5: a followed 307 to another host is recorded as off-host, and `redirect: "manual"` sends nothing there.

---

### Task 1: Page builders for more than one site

**Files:**
- Modify: `tests/fixtures/pages.js` (whole file)
- Test: `tests/unit/fake-arcgis.test.js` (append)

**Interfaces:**
- Produces:
  - `createPages({ restPath, crumbPath, loginHref, linkQuery })` returns `{ folderPage, servicePage, layerPage, queryPage, findPage, executePage }`. Defaults: `restPath = REST_PATH`, `crumbPath = restPath`, `loginHref = "/arcgis/rest/login"`, `linkQuery = ""`.
  - The named exports `folderPage`, `servicePage`, `layerPage`, `queryPage`, `findPage` and `executePage` are `createPages()`'s, with output unchanged.
  - New exports: `loginPage()`, `tokensPage()`, `messagePage(text)`. Each returns an HTML string.

- [ ] **Step 1: Dump today's pages**

Write a script outside the repo that prints every fixture page, and save its output:

```bash
cat > "${TMPDIR:-/tmp}/sdt-dump-pages.mjs" <<'EOF'
// Prints every fixture page as JSON, to compare pages.js before and after a refactor.
// Run from the repo root.
import { pathToFileURL } from "node:url";

const root = pathToFileURL(`${process.cwd()}/`);
const { catalog } = await import(new URL("tests/fixtures/catalog.js", root));
const pages = await import(new URL("tests/fixtures/pages.js", root));
const params = new URLSearchParams("where=1%3D1&outFields=*&searchText=Example");
const out = {};
const top = catalog.services.filter((s) => !s.name.includes("/"));
out.root = pages.folderPage({ folder: "", folders: catalog.folders, services: top, version: catalog.currentVersion });
for (const name of catalog.folders) {
  const services = catalog.services.filter((s) => s.name.startsWith(`${name}/`));
  out[`folder ${name}`] = pages.folderPage({ folder: name, folders: [], services, version: catalog.currentVersion });
}
for (const service of catalog.services) {
  const key = `${service.name}/${service.type}`;
  out[key] = pages.servicePage(service);
  out[`${key} find`] = pages.findPage(service, params);
  for (const layer of service.layers || []) {
    out[`${key}/${layer.id}`] = pages.layerPage(service, layer);
    out[`${key}/${layer.id}/query`] = pages.queryPage(service, layer, params);
  }
  for (const task of service.tasks || []) {
    out[`${key}/${task.name}/execute`] = pages.executePage(service, task, params);
  }
}
out.other = pages.otherPage();
process.stdout.write(JSON.stringify(out, null, 1));
EOF
node "${TMPDIR:-/tmp}/sdt-dump-pages.mjs" > "${TMPDIR:-/tmp}/sdt-pages-before.json"
```

Expected: the command prints nothing, and `sdt-pages-before.json` is about 40 KB.

- [ ] **Step 2: Write the failing tests**

In `tests/unit/fake-arcgis.test.js`, add this import below the existing ones:

```js
import { createPages, loginPage, messagePage, tokensPage } from "../fixtures/pages.js";
```

Append:

```js
test("createPages builds pages for another site, with its own roots and link query", () => {
  const pages = createPages({
    restPath: "/Org1/arcgis/rest/services",
    crumbPath: "/Org1/ArcGIS/rest/services",
    loginHref: null,
    linkQuery: "token=abc"
  });
  const root = pages.folderPage({ folder: "", folders: [], services: [{ name: "Parcels", type: "FeatureServer" }], version: 12.1 });
  assert.ok(root.includes("<a href=\"/Org1/arcgis/rest/services/Parcels/FeatureServer?token=abc\">Parcels</a>"));
  assert.ok(root.includes("<a href=\"/Org1/ArcGIS/rest/services?token=abc\">Home</a>"));
  assert.ok(root.includes("<a href=\"?f=pjson&amp;token=abc\" target=\"_blank\">JSON</a>"));
  assert.equal(root.includes(">Login<"), false);
});

test("the default site's pages link as before", () => {
  const root = createPages().folderPage({ folder: "", folders: ["Transport"], services: [{ name: "Parcels", type: "MapServer" }], version: 11.3 });
  assert.ok(root.includes("<a href=\"/arcgis/rest/login\">Login</a>"));
  assert.ok(root.includes("<a href=\"/arcgis/rest/services/Transport\">Transport</a>"));
  assert.ok(root.includes("<a href=\"/arcgis/rest/services/Parcels/MapServer\">Parcels</a>"));
  assert.ok(root.includes("<a href=\"?f=pjson\" target=\"_blank\">JSON</a>"));
});

test("the login, token and message pages", () => {
  assert.match(loginPage(), /<form name="loginForm" method="post" action="\/arcgis\/rest\/login">/);
  assert.match(tokensPage(), /<form name="tokenForm" method="post" action="\/arcgis\/tokens\/generateToken">/);
  assert.match(messagePage("Token Required"), /<p>Token Required<\/p>/);
  assert.match(messagePage("<b>"), /<p>&lt;b&gt;<\/p>/);
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `node --test tests/unit/fake-arcgis.test.js`
Expected: FAIL with `SyntaxError: The requested module '../fixtures/pages.js' does not provide an export named 'createPages'`.

- [ ] **Step 4: Rewrite `tests/fixtures/pages.js`**

Replace the whole file with this. Lines inside template literals stay at column 0, because they are part of the HTML.

```js
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
```

- [ ] **Step 5: Run the unit tests to see them pass**

Run: `npm run test:unit`
Expected: PASS, including the three new tests.

- [ ] **Step 6: Check that every existing page is unchanged**

```bash
node "${TMPDIR:-/tmp}/sdt-dump-pages.mjs" > "${TMPDIR:-/tmp}/sdt-pages-after.json"
cmp "${TMPDIR:-/tmp}/sdt-pages-before.json" "${TMPDIR:-/tmp}/sdt-pages-after.json" && echo identical
```

Expected: `identical`. If `cmp` reports a difference, run `diff` on the two files and fix `pages.js` until they match. The usual causes are an `href()` call where the old code had none, or a template line that gained indentation.

- [ ] **Step 7: Run lint and the browser tests**

Run: `npm run lint && npm run test:e2e`
Expected: both PASS with no change to any test.

- [ ] **Step 8: Commit**

```bash
git add tests/fixtures/pages.js tests/unit/fake-arcgis.test.js
git commit -F - <<'EOF'
Build fixture pages for more than one site

createPages() takes the REST root, the breadcrumb root, the Login link and
a query to add to every link, so an ArcGIS Online stand-in can reuse the
page builders. The default site's pages are byte-identical to before.
Adds the login, token and message pages the secured fixtures need.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Who a request runs as

**Files:**
- Modify: `tests/fixtures/catalog.js` (add users and tokens)
- Modify: `tests/fixtures/fake-arcgis.js` (whole file)
- Test: `tests/unit/fake-arcgis.test.js` (change the request helper, append tests)

**Interfaces:**
- Consumes: `createPages`, `loginPage`, `tokensPage`, `otherPage`, `REST_PATH` from Task 1.
- Produces:
  - `users` (`catalog.js`): `{ [username]: { username, roles: string[], privilege: string, onlineRole: string } }`, with `jsmith` and `viewer1`
  - `SERVER_TOKENS` (`catalog.js`, re-exported by `fake-arcgis.js`): `{ jsmith: "sdt-server.jsmith-0001", viewer1: "sdt-server.viewer1-0001" }`
  - `byToken(tokens)` (`catalog.js`, not exported): turns `{ username: token }` into `{ token: username }`
  - `catalog._tokens`: `byToken(SERVER_TOKENS)`
  - `arcgisError(message, format, code = 400)`
  - `fakeServer.respond(request, headers = request.headers())`. `headers` is every request header, cookies included.
  - `fakeServer.calls`: one `{ method, origin, path, query, body, cookies }` per request. `query`, `body` and `cookies` are plain objects.
  - New paths on `https://arcgis.test`: `/arcgis/rest/info`, `/arcgis/rest/self`, `/arcgis/rest/login`, `/arcgis/tokens/`
  - A bad token gets `{"error":{"code":498,"message":"Invalid Token"}}` on JSON requests, and a 302 to `/arcgis/rest/login?redirect=…` on HTML requests.
  - The instance segment matches in any case: `/ArcGIS/rest/services` works.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/fake-arcgis.test.js`, replace the `request` helper and its import line:

```js
import { arcgisError, createFakeArcGIS, FAKE_ORIGIN, html, json, SERVER_TOKENS, whereMatcher } from "../fixtures/fake-arcgis.js";

// A stand-in for a Playwright Request. headers() returns what allHeaders() would, cookies included.
const request = (path, { method = "GET", body, cookie, origin = FAKE_ORIGIN, headers = {} } = {}) => ({
  url: () => `${origin}${path}`,
  method: () => method,
  headers: () => ({
    ...(body === undefined ? {} : { "content-type": "application/x-www-form-urlencoded" }),
    ...(cookie === undefined ? {} : { cookie }),
    ...headers
  }),
  postData: () => body ?? null
});
```

Then append:

```js
const signedIn = (username) => `agstoken=${SERVER_TOKENS[username]}`;
const respondJson = (server, path, options) => JSON.parse(server.respond(request(path, options)).body);

test("rest/info reports token security and the token page, and ignores tokens", () => {
  const info = getJson(createFakeArcGIS(), "/arcgis/rest/info?f=json&token=bogus");
  assert.equal(info.currentVersion, 11.3);
  assert.deepEqual(info.authInfo, { isTokenBasedSecurity: true, tokenServicesUrl: "https://arcgis.test/arcgis/tokens/", shortLivedTokenValidity: 60 });
});

test("rest/self names the signed-in user, or no one", () => {
  const server = createFakeArcGIS();
  assert.deepEqual(respondJson(server, "/arcgis/rest/self?f=json"), { user: {} });
  assert.deepEqual(respondJson(server, "/arcgis/rest/self?f=json", { cookie: signedIn("jsmith") }), {
    user: { username: "jsmith", roles: ["Administrators"], privilege: "ADMINISTER" }
  });
});

test("a token parameter wins over the cookie, and an empty one makes the request anonymous", () => {
  const server = createFakeArcGIS();
  const cookie = signedIn("jsmith");
  assert.equal(respondJson(server, `/arcgis/rest/self?f=json&token=${SERVER_TOKENS.viewer1}`, { cookie }).user.username, "viewer1");
  assert.equal(respondJson(server, "/arcgis/rest/self", { method: "POST", body: `f=json&token=${SERVER_TOKENS.viewer1}`, cookie }).user.username, "viewer1");
  assert.deepEqual(respondJson(server, "/arcgis/rest/self?f=json&token=", { cookie }), { user: {} });
});

test("an unknown cookie counts as signed out", () => {
  assert.deepEqual(respondJson(createFakeArcGIS(), "/arcgis/rest/self?f=json", { cookie: "agstoken=stale" }), { user: {} });
});

test("a bad token gets 498 on JSON requests and the login page on HTML ones", () => {
  const server = createFakeArcGIS();
  assert.deepEqual(getJson(server, "/arcgis/rest/services?f=json&token=bogus"), { error: { code: 498, message: "Invalid Token", details: [] } });
  const page = get(server, "/arcgis/rest/services?token=bogus");
  assert.equal(page.status, 302);
  assert.equal(page.headers.location, "https://arcgis.test/arcgis/rest/login?redirect=%2Farcgis%2Frest%2Fservices%3Ftoken%3Dbogus");
  assert.match(get(server, "/arcgis/rest/login?redirect=x").body, /name="loginForm"/);
  assert.equal(get(server, "/arcgis/rest/services/NoSuchFolder?f=json&token=bogus"), null);
});

test("the instance name matches in any case", () => {
  const folder = getJson(createFakeArcGIS(), "/ArcGIS/rest/services/Transport?f=json");
  assert.deepEqual(folder.services, [{ name: "Transport/Roads", type: "MapServer" }]);
});

test("the token page is served at tokenServicesUrl", () => {
  assert.match(get(createFakeArcGIS(), "/arcgis/tokens/").body, /name="tokenForm"/);
});

test("calls keeps the query string, the form body and the cookies apart", () => {
  const server = createFakeArcGIS();
  server.respond(request("/arcgis/rest/self?f=json", { method: "POST", body: "token=t1", cookie: "agstoken=c1; other=x" }));
  assert.deepEqual(server.calls, [{
    method: "POST",
    origin: "https://arcgis.test",
    path: "/arcgis/rest/self",
    query: { f: "json" },
    body: { token: "t1" },
    cookies: { agstoken: "c1", other: "x" }
  }]);
});

test("arcgisError takes a code", () => {
  assert.deepEqual(JSON.parse(arcgisError("Token Required", "json", 499).body), { error: { code: 499, message: "Token Required", details: [] } });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/unit/fake-arcgis.test.js`
Expected: FAIL with `SyntaxError: The requested module '../fixtures/fake-arcgis.js' does not provide an export named 'SERVER_TOKENS'`.

- [ ] **Step 3: Add the users and tokens to `tests/fixtures/catalog.js`**

Insert after `const documentInfo = …;` and before `export const catalog = {`:

```js
// The invented server's users. onlineRole is the role ArcGIS Online's community/self reports.
export const users = {
  jsmith: { username: "jsmith", roles: ["Administrators"], privilege: "ADMINISTER", onlineRole: "org_admin" },
  viewer1: { username: "viewer1", roles: ["Viewers"], privilege: "ACCESS", onlineRole: "org_user" }
};

// The tokens the Enterprise-style server at https://arcgis.test accepts, by username. Real ArcGIS
// tokens use only [A-Za-z0-9._-], and so do these.
export const SERVER_TOKENS = { jsmith: "sdt-server.jsmith-0001", viewer1: "sdt-server.viewer1-0001" };

const byToken = (tokens) => Object.fromEntries(Object.entries(tokens).map(([username, token]) => [token, username]));
```

In `export const catalog = {`, add this line after `folders: ["Transport", "Utilities"],`:

```js
  _tokens: byToken(SERVER_TOKENS),
```

- [ ] **Step 4: Rewrite `tests/fixtures/fake-arcgis.js`**

Replace the whole file with:

```js
// A fake ArcGIS Server for the browser tests. The Playwright fixture (tests/e2e/fixtures.js) routes
// every request for https://arcgis.test through respond(), which answers from catalog.js and
// pages.js, or returns null when no fixture matches. A test can also add overrides, whose handlers
// may be async, so a test can serve a slow response or one that never arrives.
//
// The server signs users in as ArcGIS Server does. A token parameter, in the query string or a form
// body, wins over the agstoken cookie the login page sets, and an empty token parameter makes a
// request anonymous. Both follow a probe of ArcGIS Server 10.9.1 (token support spec, section 4).
import { catalog as defaultCatalog, SERVER_TOKENS, users } from "./catalog.js";
import { createPages, loginPage, otherPage, REST_PATH, tokensPage } from "./pages.js";

export { SERVER_TOKENS };

export const FAKE_ORIGIN = "https://arcgis.test";
export const REST_ROOT = `${FAKE_ORIGIN}${REST_PATH}`;

const SERVICE_TYPES = ["MapServer", "FeatureServer", "ImageServer", "GPServer"];
const ENTERPRISE_PAGES = createPages();
const FAVICON = { status: 204, contentType: "image/x-icon", body: "" };
const STYLESHEET = { status: 200, contentType: "text/css; charset=utf-8", body: "body { font-family: sans-serif; }\n" };
const INVALID_TOKEN = { code: 498, message: "Invalid Token" };

export const html = (body) => ({ status: 200, contentType: "text/html; charset=utf-8", body });

// ArcGIS Server sends f=json as application/json and f=pjson as indented plain text.
export const json = (data, format) => ({
  status: 200,
  contentType: format === "pjson" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
  // Keys starting with "_" hold fixture data that a real server would not send.
  body: JSON.stringify(data, (key, value) => (key.startsWith("_") ? undefined : value), format === "pjson" ? 2 : undefined)
});

// ArcGIS Server reports most request errors as HTTP 200 with an error object.
export const arcgisError = (message, format, code = 400) => json({ error: { code, message, details: [] } }, format);

/** Evaluates the where clauses the extension sends. Returns null for anything else. */
export const whereMatcher = (where) => {
  const clause = where.trim();
  let match;
  if (/^1\s*=\s*1$/.test(clause)) {
    return () => true;
  }
  if ((match = clause.match(/^not\s+(\w+)\s+is\s+null$/i))) {
    const [, field] = match;
    return (row) => row[field] != null;
  }
  if ((match = clause.match(/^not\s+(\w+)\s+is\s+null\s+and\s+(\w+)\s*<>\s*''$/i))) {
    const [, field, sameField] = match;
    return (row) => row[field] != null && row[sameField] !== "";
  }
  if ((match = clause.match(/^(\w+)\s*=\s*'([^']*)'$/))) {
    const [, field, value] = match;
    return (row) => row[field] === value;
  }
  if ((match = clause.match(/^(\w+)\s*=\s*(-?\d+(?:\.\d+)?)$/))) {
    const [, field, value] = match;
    return (row) => row[field] === Number(value);
  }
  return null;
};

const queryLayer = (layer, params, format, problems) => {
  const where = params.get("where");
  const matches = where ? whereMatcher(where) : null;
  if (!matches) {
    problems.push(`unsupported where clause "${where}" on layer ${layer.name}`);
    return arcgisError("Unable to complete operation.", format);
  }
  const rows = layer._rows.filter(matches);
  if (params.get("returnCountOnly") === "true") {
    return json({ count: rows.length }, format);
  }
  const requested = params.get("outFields") || "*";
  const names = requested === "*"
    ? layer.fields.filter((field) => field.type !== "esriFieldTypeGeometry").map((field) => field.name)
    : requested.split(",").map((name) => name.trim());
  let attributes = rows.map((row) => Object.fromEntries(names.map((name) => [name, row[name] ?? null])));
  if (params.get("returnDistinctValues") === "true") {
    const unique = new Map(attributes.map((item) => [JSON.stringify(item), item]));
    attributes = [...unique.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => item);
  }
  return json({
    displayFieldName: layer.displayField,
    fields: layer.fields.filter((field) => names.includes(field.name)),
    features: attributes.map((item) => ({ attributes: item }))
  }, format);
};

const layerSummary = ({ id, name, parentLayerId, defaultVisibility, subLayerIds, minScale, maxScale, type, geometryType }) =>
  ({ id, name, parentLayerId, defaultVisibility, subLayerIds, minScale, maxScale, type, geometryType });

const serviceJson = (catalog, service) => ({
  currentVersion: catalog.currentVersion,
  ...service.info,
  ...(service.layers ? { layers: service.layers.map(layerSummary), tables: [] } : {}),
  ...(service.tasks ? { tasks: service.tasks.map((task) => task.name) } : {})
});

const folder = (catalog, parts, format, pages) => {
  const name = parts[0] || "";
  if (parts.length > 1 || (name && !catalog.folders.includes(name))) {
    return null;
  }
  const services = catalog.services.filter((s) => (name ? s.name.startsWith(`${name}/`) : !s.name.includes("/")));
  const folders = name ? [] : catalog.folders;
  if (format === "html") {
    return html(pages.folderPage({ folder: name, folders, services, version: catalog.currentVersion }));
  }
  return json({ currentVersion: catalog.currentVersion, folders, services: services.map((s) => ({ name: s.name, type: s.type })) }, format);
};

const serviceResource = (catalog, service, rest, params, format, problems, pages) => {
  const [first, second, ...extra] = rest;
  if (extra.length) {
    return null;
  }
  if (first === undefined) {
    return format === "html" ? html(pages.servicePage(service)) : json(serviceJson(catalog, service), format);
  }
  if (first === "layers" && second === undefined && service.layers) {
    return json({ layers: service.layers, tables: [] }, format);
  }
  if (first === "find" && second === undefined && service.type === "MapServer") {
    return format === "html" ? html(pages.findPage(service, params)) : json({ results: [] }, format);
  }
  const task = (service.tasks || []).find((t) => t.name === first);
  if (task) {
    if (second === undefined) {
      return format === "html" ? null : json(task.json, format);
    }
    if (second === "execute") {
      return format === "html" ? html(pages.executePage(service, task, params)) : json({ results: [], messages: [] }, format);
    }
    return null;
  }
  const layer = /^\d+$/.test(first) ? (service.layers || []).find((l) => l.id === Number(first)) : undefined;
  if (!layer) {
    return null;
  }
  if (second === undefined) {
    return format === "html" ? html(pages.layerPage(service, layer)) : json(layer, format);
  }
  if (second === "query") {
    return format === "html" ? html(pages.queryPage(service, layer, params)) : queryLayer(layer, params, format, problems);
  }
  return null;
};

/** Parses a Cookie request header into an object. */
const parseCookies = (header = "") => Object.fromEntries(header
  .split(";")
  .map((pair) => pair.trim())
  .filter(Boolean)
  .map((pair) => {
    const at = pair.indexOf("=");
    return at === -1 ? [pair, ""] : [pair.slice(0, at), pair.slice(at + 1)];
  }));

/**
 * Who a request runs as: { user } with a username, or with null when anonymous, or { invalid: true }
 * for a token the site doesn't know. tokens maps each token the site accepts to a username.
 */
const identify = (tokens, params, cookies) => {
  if (params.has("token")) {
    const token = params.get("token");
    if (token === "") {
      return { user: null };
    }
    return Object.hasOwn(tokens, token) ? { user: tokens[token] } : { invalid: true };
  }
  const cookie = cookies.agstoken;
  return { user: cookie && Object.hasOwn(tokens, cookie) ? tokens[cookie] : null };
};

const loginRedirect = (url) => ({
  status: 302,
  headers: { location: `${url.origin}/arcgis/rest/login?redirect=${encodeURIComponent(`${url.pathname}${url.search}`)}` },
  contentType: "text/html; charset=utf-8",
  body: ""
});

const serverInfo = (catalog) => ({
  currentVersion: catalog.currentVersion,
  authInfo: { isTokenBasedSecurity: true, tokenServicesUrl: `${FAKE_ORIGIN}/arcgis/tokens/`, shortLivedTokenValidity: 60 }
});

const serverSelf = (username) => {
  const { roles, privilege } = users[username];
  return { username, roles, privilege };
};

const route = (catalog, url, params, cookies, problems) => {
  // ArcGIS Server matches the instance name in any case, so /ArcGIS/rest/services works too.
  const pathname = url.pathname.replace(/^\/arcgis(?=\/|$)/i, "/arcgis");
  const format = params.get("f") || "html";
  if (pathname === "/favicon.ico") {
    return FAVICON;
  }
  if (pathname === "/arcgis/rest/static/main.css") {
    return STYLESHEET;
  }
  if (pathname === "/other/page") {
    return html(otherPage());
  }
  if (pathname === "/arcgis/rest/login") {
    return html(loginPage());
  }
  if (pathname === "/arcgis/tokens" || pathname === "/arcgis/tokens/") {
    return html(tokensPage());
  }
  // rest/info ignores tokens, so it answers even when the token is bad.
  if (pathname === "/arcgis/rest/info") {
    return json(serverInfo(catalog), format);
  }
  const who = identify(catalog._tokens, params, cookies);
  // A bad token gets its error only on a path with a fixture, so the harness still sees the others as unmatched.
  const invalid = format === "html" ? loginRedirect(url) : arcgisError(INVALID_TOKEN.message, format, INVALID_TOKEN.code);
  if (pathname === "/arcgis/rest/self") {
    if (who.invalid) {
      return invalid;
    }
    return json({ user: who.user ? serverSelf(who.user) : {} }, format);
  }
  if (pathname !== REST_PATH && !pathname.startsWith(`${REST_PATH}/`)) {
    return null;
  }
  const parts = pathname.slice(REST_PATH.length).split("/").filter(Boolean).map(decodeURIComponent);
  const typeIndex = parts.findIndex((part) => SERVICE_TYPES.includes(part));
  if (typeIndex === -1) {
    const listing = folder(catalog, parts, format, ENTERPRISE_PAGES);
    return listing && who.invalid ? invalid : listing;
  }
  const service = catalog.services.find((s) => s.name === parts.slice(0, typeIndex).join("/") && s.type === parts[typeIndex]);
  if (!service) {
    return null;
  }
  if (who.invalid) {
    // A throwaway problems list: this call only checks that the path has a fixture.
    return serviceResource(catalog, service, parts.slice(typeIndex + 1), params, format, [], ENTERPRISE_PAGES) ? invalid : null;
  }
  return serviceResource(catalog, service, parts.slice(typeIndex + 1), params, format, problems, ENTERPRISE_PAGES);
};

/**
 * Creates a fake server. respond(request, headers) takes a Playwright Request and returns options
 * for route.fulfill(), or null when nothing matches. An override's handler may be async, and then
 * respond() returns its Promise.
 */
export const createFakeArcGIS = (catalog = defaultCatalog) => {
  const overrides = [];
  const requests = [];
  const calls = [];
  const problems = [];
  return {
    requests,
    calls,
    problems,
    /**
     * Answers requests whose path and query (as sent, still encoded) match pattern with
     * handler(url, params). The handler returns route.fulfill() options, or a Promise of them.
     */
    override(pattern, handler) {
      // test() on a g or y pattern starts at lastIndex, so it would miss every other request.
      if (pattern.global || pattern.sticky) {
        throw new TypeError(`override pattern ${pattern} must not use the g or y flag`);
      }
      overrides.push({ pattern, handler, used: false });
    },
    /** The patterns, as strings, of the overrides that have not matched a request yet. */
    unusedOverrides() {
      return overrides.filter(({ used }) => !used).map(({ pattern }) => String(pattern));
    },
    /** Counts every override added so far as used, for a test that adds one it doesn't mean to request. */
    markOverridesUsed() {
      overrides.forEach((override) => {
        override.used = true;
      });
    },
    /**
     * headers is every request header, cookies included. Playwright's request.headers() leaves
     * cookies out, so the harness passes await request.allHeaders().
     */
    respond(request, headers = request.headers()) {
      const url = new URL(request.url());
      const query = new URLSearchParams(url.search);
      const body = request.method() === "POST" && /x-www-form-urlencoded/.test(headers["content-type"] || "")
        ? new URLSearchParams(request.postData() || "")
        : new URLSearchParams();
      const params = new URLSearchParams(query);
      body.forEach((value, key) => params.set(key, value));
      const cookies = parseCookies(headers.cookie);
      requests.push(`${request.method()} ${url.pathname}${url.search}`);
      calls.push({
        method: request.method(),
        origin: url.origin,
        path: url.pathname,
        query: Object.fromEntries(query),
        body: Object.fromEntries(body),
        cookies
      });
      const override = overrides.find(({ pattern }) => pattern.test(`${url.pathname}${url.search}`));
      if (override) {
        override.used = true;
        return override.handler(url, params);
      }
      return route(catalog, url, params, cookies, problems);
    }
  };
};
```

- [ ] **Step 5: Run the unit tests to see them pass**

Run: `npm run test:unit`
Expected: PASS, the new tests and every existing one.

- [ ] **Step 6: Run lint and the browser tests**

Run: `npm run lint && npm run test:e2e`
Expected: both PASS. The harness still passes no headers, so `respond()` falls back to `request.headers()` and every test runs anonymously, as before.

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/catalog.js tests/fixtures/fake-arcgis.js tests/unit/fake-arcgis.test.js
git commit -F - <<'EOF'
Let the fake server know who a request runs as

A token parameter wins over the agstoken cookie, an empty one makes the
request anonymous, and a bad one gets 498, or the login page for HTML.
Adds rest/info with authInfo, rest/self, the login and token pages, and
a calls log that keeps the query string, form body and cookies apart.
The instance segment now matches in any case, as ArcGIS Server does.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Secured services on the Enterprise-style server

**Files:**
- Modify: `tests/fixtures/catalog.js` (two layers, two services)
- Modify: `tests/fixtures/fake-arcgis.js` (`folder`, `route`, imports, constants)
- Test: `tests/unit/fake-arcgis.test.js` (append)

**Interfaces:**
- Consumes: `identify`, `loginRedirect`, `arcgisError(message, format, code)`, `SERVER_TOKENS` and the `request`, `signedIn`, `respondJson` test helpers from Task 2; `messagePage` from Task 1.
- Produces:
  - Services `Utilities/Valves` (MapServer, `_secured: true`) and `Utilities/Mains` (FeatureServer, `_secured: true`, `_allowed: ["jsmith"]`)
  - `refusal(service, user)` (`fake-arcgis.js`, not exported): returns `TOKEN_REQUIRED` (499), `FORBIDDEN` (403) or `null`
  - `folder(catalog, parts, format, user, pages)`: lists only the services the user may use
  - Secured responses: 499 or 403 JSON with HTTP 200. HTML gets a 302 to the login page when anonymous, or a 403 page.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/fake-arcgis.test.js`:

```js
test("anonymous listings leave secured services out, as ArcGIS Server does", () => {
  const server = createFakeArcGIS();
  assert.deepEqual(getJson(server, "/arcgis/rest/services/Utilities?f=json").services, [{ name: "Utilities/PrintingTools", type: "GPServer" }]);
  const page = get(server, "/arcgis/rest/services/Utilities").body;
  assert.equal(page.includes("Valves") || page.includes("Mains"), false);
});

test("a signed-in user sees the secured services they may use", () => {
  const server = createFakeArcGIS();
  const names = (username) => respondJson(server, "/arcgis/rest/services/Utilities?f=json", { cookie: signedIn(username) }).services.map((s) => s.name);
  assert.deepEqual(names("jsmith"), ["Utilities/PrintingTools", "Utilities/Valves", "Utilities/Mains"]);
  assert.deepEqual(names("viewer1"), ["Utilities/PrintingTools", "Utilities/Valves"]);
});

test("a secured service needs a token: 499 for JSON, the login page for HTML", () => {
  const server = createFakeArcGIS();
  assert.deepEqual(getJson(server, "/arcgis/rest/services/Utilities/Valves/MapServer?f=json"), { error: { code: 499, message: "Token Required", details: [] } });
  assert.equal(getJson(server, "/arcgis/rest/services/Utilities/Valves/MapServer/0?f=json").error.code, 499);
  const page = get(server, "/arcgis/rest/services/Utilities/Valves/MapServer");
  assert.equal(page.status, 302);
  assert.equal(page.headers.location, "https://arcgis.test/arcgis/rest/login?redirect=%2Farcgis%2Frest%2Fservices%2FUtilities%2FValves%2FMapServer");
});

test("a user without access to a secured service gets 403", () => {
  const server = createFakeArcGIS();
  const mains = (username, f) => server.respond(request(`/arcgis/rest/services/Utilities/Mains/FeatureServer${f ? `?f=${f}` : ""}`, { cookie: signedIn(username) }));
  assert.equal(JSON.parse(mains("viewer1", "json").body).error.code, 403);
  assert.equal(mains("viewer1").status, 403);
  assert.equal(JSON.parse(mains("jsmith", "json").body).serviceDescription, "Water mains for an invented utility. Administrators only.");
});

test("a token in a form body opens a secured layer's queries", () => {
  const body = `where=1%3D1&returnCountOnly=true&f=json&token=${SERVER_TOKENS.jsmith}`;
  const count = respondJson(createFakeArcGIS(), "/arcgis/rest/services/Utilities/Valves/MapServer/0/query", { method: "POST", body });
  assert.deepEqual(count, { count: 2 });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/unit/fake-arcgis.test.js`
Expected: FAIL. The signed-in listing test gets `["Utilities/PrintingTools"]` where it expects three names. The Valves and Mains tests fail with `TypeError: Cannot read properties of null (reading 'body')`, because those services don't exist yet.

- [ ] **Step 3: Add the secured services to `tests/fixtures/catalog.js`**

Insert after the `roads` layer:

```js
const valves = {
  ...layerDefaults,
  id: 0,
  name: "Valves",
  geometryType: "esriGeometryPoint",
  displayField: "VALVE_ID",
  fields: [
    { name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID", domain: null },
    { name: "SHAPE", type: "esriFieldTypeGeometry", alias: "Shape", domain: null },
    { name: "VALVE_ID", type: "esriFieldTypeString", alias: "Valve ID", length: 12, domain: null }
  ],
  _rows: [
    { OBJECTID: 1, SHAPE: true, VALVE_ID: "V-001" },
    { OBJECTID: 2, SHAPE: true, VALVE_ID: "V-002" }
  ]
};

const mains = {
  ...layerDefaults,
  id: 0,
  name: "Mains",
  geometryType: "esriGeometryPolyline",
  displayField: "MAIN_ID",
  fields: [
    { name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID", domain: null },
    { name: "SHAPE", type: "esriFieldTypeGeometry", alias: "Shape", domain: null },
    { name: "MAIN_ID", type: "esriFieldTypeString", alias: "Main ID", length: 12, domain: null }
  ],
  _rows: [
    { OBJECTID: 1, SHAPE: true, MAIN_ID: "M-001" }
  ]
};
```

In `catalog.services`, add these two entries after `Utilities/PrintingTools`:

```js
    {
      // Secured: anonymous listings leave it out, and anonymous requests get 499.
      name: "Utilities/Valves",
      type: "MapServer",
      _secured: true,
      layers: [valves],
      info: {
        serviceDescription: "Water valves for an invented utility. Signed-in users only.",
        mapName: "Valves",
        description: "",
        copyrightText: "",
        spatialReference: WEB_MERCATOR,
        singleFusedMapCache: false,
        initialExtent: EXTENT,
        fullExtent: EXTENT,
        units: "esriMeters",
        documentInfo: documentInfo("Valves", "valves"),
        capabilities: "Map,Query",
        supportedQueryFormats: "JSON",
        maxRecordCount: 1000
      }
    },
    {
      // Secured, and only jsmith may use it: other signed-in users get 403.
      name: "Utilities/Mains",
      type: "FeatureServer",
      _secured: true,
      _allowed: ["jsmith"],
      layers: [mains],
      info: {
        serviceDescription: "Water mains for an invented utility. Administrators only.",
        description: "",
        copyrightText: "",
        hasVersionedData: false,
        maxRecordCount: 1000,
        supportedQueryFormats: "JSON",
        capabilities: "Query",
        spatialReference: WEB_MERCATOR,
        initialExtent: EXTENT,
        fullExtent: EXTENT,
        units: "esriMeters"
      }
    }
```

- [ ] **Step 4: Refuse secured services in `tests/fixtures/fake-arcgis.js`**

Change the pages import to:

```js
import { createPages, loginPage, messagePage, otherPage, REST_PATH, tokensPage } from "./pages.js";
```

Below `const INVALID_TOKEN = …;` add:

```js
const TOKEN_REQUIRED = { code: 499, message: "Token Required" };
const FORBIDDEN = { code: 403, message: "You do not have permissions to access this resource or perform this operation." };

/** Why user (a username, or null) can't use service: TOKEN_REQUIRED, FORBIDDEN, or null when they can. */
const refusal = (service, user) => {
  if (!service._secured) {
    return null;
  }
  if (!user) {
    return TOKEN_REQUIRED;
  }
  return service._allowed && !service._allowed.includes(user) ? FORBIDDEN : null;
};
```

Replace `folder` with:

```js
// Lists the services the user may use. ArcGIS Server leaves the others out.
const folder = (catalog, parts, format, user, pages) => {
  const name = parts[0] || "";
  if (parts.length > 1 || (name && !catalog.folders.includes(name))) {
    return null;
  }
  const services = catalog.services
    .filter((s) => (name ? s.name.startsWith(`${name}/`) : !s.name.includes("/")))
    .filter((s) => refusal(s, user) === null);
  const folders = name ? [] : catalog.folders;
  if (format === "html") {
    return html(pages.folderPage({ folder: name, folders, services, version: catalog.currentVersion }));
  }
  return json({ currentVersion: catalog.currentVersion, folders, services: services.map((s) => ({ name: s.name, type: s.type })) }, format);
};
```

In `route`, replace everything from `if (typeIndex === -1) {` to the end of the function with:

```js
  if (typeIndex === -1) {
    const listing = folder(catalog, parts, format, who.user, ENTERPRISE_PAGES);
    return listing && who.invalid ? invalid : listing;
  }
  const service = catalog.services.find((s) => s.name === parts.slice(0, typeIndex).join("/") && s.type === parts[typeIndex]);
  if (!service) {
    return null;
  }
  if (who.invalid) {
    // A throwaway problems list: this call only checks that the path has a fixture.
    return serviceResource(catalog, service, parts.slice(typeIndex + 1), params, format, [], ENTERPRISE_PAGES) ? invalid : null;
  }
  const refused = refusal(service, who.user);
  if (refused) {
    if (format !== "html") {
      return arcgisError(refused.message, format, refused.code);
    }
    return refused === TOKEN_REQUIRED ? loginRedirect(url) : { status: 403, contentType: "text/html; charset=utf-8", body: messagePage(refused.message) };
  }
  return serviceResource(catalog, service, parts.slice(typeIndex + 1), params, format, problems, ENTERPRISE_PAGES);
```

- [ ] **Step 5: Run the unit tests to see them pass**

Run: `npm run test:unit`
Expected: PASS. "the root lists its folders and top-level services" still passes, because the secured services sit inside `Utilities`.

- [ ] **Step 6: Run lint and the browser tests**

Run: `npm run lint && npm run test:e2e`
Expected: both PASS. Browser tests are still anonymous, so they never see the new services.

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/catalog.js tests/fixtures/fake-arcgis.js tests/unit/fake-arcgis.test.js
git commit -F - <<'EOF'
Add secured services to the fake server

Utilities/Valves needs a signed-in user, and Utilities/Mains only lets
jsmith in. Anonymous listings leave them out, as ArcGIS Server does.
Anonymous requests get 499, or the login page for HTML, and a user
without access gets 403.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: ArcGIS Online stand-ins

**Files:**
- Modify: `tests/fixtures/catalog.js` (Parcels FeatureServer as a constant, the online catalog)
- Modify: `tests/fixtures/fake-arcgis.js` (constants, `folder`, two routes, `respond`, the header comment)
- Test: `tests/unit/fake-arcgis.test.js` (append)

**Interfaces:**
- Consumes: `identify`, `refusal`, `folder`, `serviceResource`, `arcgisError`, `json`, `html`, `users` and `byToken` from Tasks 2 and 3; `createPages` and `messagePage` from Task 1; the `request` test helper, which takes `origin` and `headers`.
- Produces:
  - `catalog.js`: `ONLINE_ORG = "Fk3Org9xQ"`, `ONLINE_TOKENS = { jsmith: "sdt-online.jsmith-0001" }`, and `onlineCatalog` (`Parcels` FeatureServer, public; `Hydrants` FeatureServer, secured)
  - `fake-arcgis.js`:
    - re-exports `ONLINE_ORG` and `ONLINE_TOKENS`
    - `ONLINE_ORIGIN = "https://services9.arcgis.com"`
    - `ONLINE_REST_PATH = "/Fk3Org9xQ/arcgis/rest/services"`
    - `ONLINE_REST_ROOT`
    - `PORTAL_ORIGIN = "https://www.arcgis.com"`
    - `FAKE_ORIGINS = [FAKE_ORIGIN, ONLINE_ORIGIN, PORTAL_ORIGIN]`
  - `createFakeArcGIS(catalog = defaultCatalog, online = defaultOnlineCatalog)`
  - `requests` entries for the two new origins include the origin, such as `GET https://services9.arcgis.com/Fk3Org9xQ/arcgis/rest/services?f=json`. Entries for `https://arcgis.test` are unchanged.
  - `folder(catalog, parts, format, user, pages, listSecured = false)`

- [ ] **Step 1: Write the failing tests**

Change the fake-arcgis import in `tests/unit/fake-arcgis.test.js` to:

```js
import {
  arcgisError, createFakeArcGIS, FAKE_ORIGIN, html, json, ONLINE_ORG, ONLINE_ORIGIN, ONLINE_REST_PATH, ONLINE_TOKENS,
  PORTAL_ORIGIN, SERVER_TOKENS, whereMatcher
} from "../fixtures/fake-arcgis.js";
```

Append:

```js
const online = (server, path, options = {}) => server.respond(request(path, { ...options, origin: ONLINE_ORIGIN }));
const onlineJson = (server, path, options) => JSON.parse(online(server, path, options).body);

test("the ArcGIS Online stand-in lists secured services and refuses them without a token", () => {
  const server = createFakeArcGIS();
  assert.deepEqual(onlineJson(server, `${ONLINE_REST_PATH}?f=json`).services, [{ name: "Parcels", type: "FeatureServer" }, { name: "Hydrants", type: "FeatureServer" }]);
  assert.deepEqual(onlineJson(server, `${ONLINE_REST_PATH}/Hydrants/FeatureServer?f=json`), { error: { code: 499, message: "Token Required", details: [] } });
  assert.equal(onlineJson(server, `${ONLINE_REST_PATH}/Hydrants/FeatureServer?f=json&token=${ONLINE_TOKENS.jsmith}`).layers[0].name, "Hydrants");
});

test("ArcGIS Online answers a bad token with 400, and takes no server token or cookie", () => {
  const server = createFakeArcGIS();
  const invalid = { error: { code: 400, message: "Invalid token", details: [] } };
  assert.deepEqual(onlineJson(server, `${ONLINE_REST_PATH}?f=json&token=bogus`), invalid);
  assert.deepEqual(onlineJson(server, `${ONLINE_REST_PATH}?f=json&token=${SERVER_TOKENS.jsmith}`), invalid);
  const withCookie = onlineJson(server, `${ONLINE_REST_PATH}/Hydrants/FeatureServer?f=json`, { cookie: `agstoken=${ONLINE_TOKENS.jsmith}` });
  assert.equal(withCookie.error.code, 499);
});

test("ArcGIS Online's rest/info names its portal, and rest/self can't say who you are", () => {
  const server = createFakeArcGIS();
  const info = onlineJson(server, `/${ONLINE_ORG}/arcgis/rest/info?f=json`);
  assert.equal(info.owningSystemUrl, PORTAL_ORIGIN);
  assert.equal(info.owningTenant, ONLINE_ORG);
  assert.equal(info.authInfo.tokenServicesUrl, `${PORTAL_ORIGIN}/sharing/rest/generateToken`);
  assert.deepEqual(onlineJson(server, `/${ONLINE_ORG}/arcgis/rest/self?f=json`), { error: { code: 400, message: "Unable to get user info.", details: [] } });
});

test("an ArcGIS Online page opened with ?token= copies the token into its links", () => {
  const token = ONLINE_TOKENS.jsmith;
  const page = online(createFakeArcGIS(), `${ONLINE_REST_PATH}?token=${token}`).body;
  assert.ok(page.includes(`<a href="${ONLINE_REST_PATH}/Hydrants/FeatureServer?token=${token}">Hydrants</a>`));
  assert.ok(page.includes(`<a href="/${ONLINE_ORG}/ArcGIS/rest/services?token=${token}">Home</a>`));
  assert.ok(page.includes(`<a href="?f=pjson&amp;token=${token}" target="_blank">JSON</a>`));
  assert.equal(page.includes(">Login<"), false);
});

test("the org ID is case-sensitive and the instance name isn't", () => {
  const server = createFakeArcGIS();
  assert.deepEqual(onlineJson(server, `/${ONLINE_ORG.toLowerCase()}/arcgis/rest/services?f=json`), { error: { code: 400, message: "Invalid URL", details: [] } });
  assert.equal(onlineJson(server, `/${ONLINE_ORG}/ArcGIS/rest/services?f=json`).services.length, 2);
});

test("community/self names the user of an ArcGIS Online token, with CORS", () => {
  const server = createFakeArcGIS();
  const self = (body) => server.respond(request("/sharing/rest/community/self", { method: "POST", body, origin: PORTAL_ORIGIN, headers: { origin: ONLINE_ORIGIN } }));
  const known = self(`f=json&token=${ONLINE_TOKENS.jsmith}`);
  assert.deepEqual(JSON.parse(known.body), { username: "jsmith", role: "org_admin", orgId: ONLINE_ORG });
  assert.equal(known.headers["access-control-allow-origin"], ONLINE_ORIGIN);
  assert.equal(JSON.parse(self("f=json&token=bogus").body).error.code, 498);
  assert.equal(JSON.parse(self("f=json").body).error.messageCode, "COM_0019");
});

test("requests to the stand-ins are logged with their origin", () => {
  const server = createFakeArcGIS();
  online(server, `${ONLINE_REST_PATH}?f=json`);
  get(server, "/arcgis/rest/services?f=json");
  assert.deepEqual(server.requests, [`GET ${ONLINE_ORIGIN}${ONLINE_REST_PATH}?f=json`, "GET /arcgis/rest/services?f=json"]);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/unit/fake-arcgis.test.js`
Expected: FAIL with `SyntaxError: The requested module '../fixtures/fake-arcgis.js' does not provide an export named 'ONLINE_ORG'`.

- [ ] **Step 3: Add the online catalog to `tests/fixtures/catalog.js`**

Move the `Parcels` FeatureServer entry out of `catalog.services` into a constant above `export const catalog = {`:

```js
const parcelsFeatureServer = {
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
};
```

In `catalog.services`, replace that entry with `parcelsFeatureServer,`, which keeps its place second in the list.

At the end of the file, add:

```js
// The ArcGIS Online stand-in: one org's hosted services. Unlike ArcGIS Server, its listing includes
// secured services, and the host has no sign-in of its own.
export const ONLINE_ORG = "Fk3Org9xQ";

// The tokens ArcGIS Online accepts, by username. They don't work on https://arcgis.test.
export const ONLINE_TOKENS = { jsmith: "sdt-online.jsmith-0001" };

const hydrants = {
  ...layerDefaults,
  id: 0,
  name: "Hydrants",
  geometryType: "esriGeometryPoint",
  displayField: "HYDRANT_ID",
  fields: [
    { name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID", domain: null },
    { name: "SHAPE", type: "esriFieldTypeGeometry", alias: "Shape", domain: null },
    { name: "HYDRANT_ID", type: "esriFieldTypeString", alias: "Hydrant ID", length: 12, domain: null }
  ],
  _rows: [
    { OBJECTID: 1, SHAPE: true, HYDRANT_ID: "H-001" },
    { OBJECTID: 2, SHAPE: true, HYDRANT_ID: "H-002" },
    { OBJECTID: 3, SHAPE: null, HYDRANT_ID: "H-003" }
  ]
};

export const onlineCatalog = {
  currentVersion: 12.1,
  folders: [],
  _tokens: byToken(ONLINE_TOKENS),
  services: [
    parcelsFeatureServer,
    {
      name: "Hydrants",
      type: "FeatureServer",
      _secured: true,
      layers: [hydrants],
      info: {
        serviceDescription: "Fire hydrants for an invented city. Org members only.",
        description: "",
        copyrightText: "",
        hasVersionedData: false,
        maxRecordCount: 2000,
        supportedQueryFormats: "JSON",
        capabilities: "Query",
        spatialReference: WEB_MERCATOR,
        initialExtent: EXTENT,
        fullExtent: EXTENT,
        units: "esriMeters"
      }
    }
  ]
};
```

- [ ] **Step 4: Add the stand-ins to `tests/fixtures/fake-arcgis.js`**

Replace everything from the top of the file down to and including `export { SERVER_TOKENS };` (the header comment, both imports and the re-export) with:

```js
// A fake ArcGIS Server for the browser tests, with stand-ins for ArcGIS Online. The Playwright
// fixture (tests/e2e/fixtures.js) routes every request for the origins in FAKE_ORIGINS through
// respond(), which answers from catalog.js and pages.js, or returns null when no fixture matches.
// A test can also add overrides, whose handlers may be async, so a test can serve a slow response
// or one that never arrives.
//
// - FAKE_ORIGIN (https://arcgis.test) is an Enterprise-style ArcGIS Server. A token parameter, in
//   the query string or a form body, wins over the agstoken cookie its login page sets, and an empty
//   token parameter makes a request anonymous. Both follow a probe of ArcGIS Server 10.9.1 (token
//   support spec, section 4). Anonymous listings leave secured services out.
// - ONLINE_ORIGIN is an ArcGIS Online hosted-services host. Its listings include secured services,
//   it has no sign-in of its own, and a page opened with ?token= copies the token into its links.
// - PORTAL_ORIGIN answers ArcGIS Online's community/self, the one request the toolkit sends outside
//   a token's scope.
import { catalog as defaultCatalog, ONLINE_ORG, ONLINE_TOKENS, onlineCatalog as defaultOnlineCatalog, SERVER_TOKENS, users } from "./catalog.js";
import { createPages, loginPage, messagePage, otherPage, REST_PATH, tokensPage } from "./pages.js";

export { ONLINE_ORG, ONLINE_TOKENS, SERVER_TOKENS };
```

Below `export const REST_ROOT = …;` add:

```js
export const ONLINE_ORIGIN = "https://services9.arcgis.com";
export const ONLINE_REST_PATH = `/${ONLINE_ORG}/arcgis/rest/services`;
export const ONLINE_REST_ROOT = `${ONLINE_ORIGIN}${ONLINE_REST_PATH}`;
export const PORTAL_ORIGIN = "https://www.arcgis.com";

// The origins the harness routes to this fake server. A request to any other host fails the test.
export const FAKE_ORIGINS = [FAKE_ORIGIN, ONLINE_ORIGIN, PORTAL_ORIGIN];

// ArcGIS Online writes its breadcrumbs with /ArcGIS/ and its other links with /arcgis/.
const ONLINE_SITE = { restPath: ONLINE_REST_PATH, crumbPath: `/${ONLINE_ORG}/ArcGIS/rest/services`, loginHref: null };
```

Replace `folder`'s first two lines with:

```js
// Lists the services the user may use. ArcGIS Server leaves the others out; ArcGIS Online, with
// listSecured, lists them all.
const folder = (catalog, parts, format, user, pages, listSecured = false) => {
```

and its second filter with:

```js
    .filter((s) => listSecured || refusal(s, user) === null);
```

Add these functions after `route`:

```js
const onlineInfo = (online) => ({
  currentVersion: online.currentVersion,
  owningSystemUrl: PORTAL_ORIGIN,
  owningTenant: ONLINE_ORG,
  authInfo: { isTokenBasedSecurity: true, tokenServicesUrl: `${PORTAL_ORIGIN}/sharing/rest/generateToken` }
});

const onlineRoute = (online, url, params, problems) => {
  if (url.pathname === "/favicon.ico") {
    return FAVICON;
  }
  if (url.pathname === "/arcgis/rest/static/main.css") {
    return STYLESHEET;
  }
  const [org, instance, rest, ...tail] = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const format = params.get("f") || "html";
  if (org !== ONLINE_ORG) {
    // The org ID is case-sensitive: in another case it is an invalid URL.
    return org?.toLowerCase() === ONLINE_ORG.toLowerCase() ? arcgisError("Invalid URL", format) : null;
  }
  if (instance?.toLowerCase() !== "arcgis" || rest !== "rest") {
    return null;
  }
  if (tail.length === 1 && tail[0] === "info") {
    return json(onlineInfo(online), format);
  }
  // Hosted services have no sign-in of their own, so a cookie counts for nothing here.
  const who = identify(online._tokens, params, {});
  // As in route, a bad token gets its error only on a path with a fixture.
  const invalid = format === "html" ? html(messagePage("Invalid token")) : arcgisError("Invalid token", format);
  if (tail.length === 1 && tail[0] === "self") {
    return who.invalid ? invalid : arcgisError("Unable to get user info.", format);
  }
  if (tail[0] !== "services") {
    return null;
  }
  const token = params.get("token");
  const pages = createPages(token ? { ...ONLINE_SITE, linkQuery: `token=${encodeURIComponent(token)}` } : ONLINE_SITE);
  const parts = tail.slice(1);
  const typeIndex = parts.findIndex((part) => SERVICE_TYPES.includes(part));
  if (typeIndex === -1) {
    const listing = folder(online, parts, format, who.user, pages, true);
    return listing && who.invalid ? invalid : listing;
  }
  const service = online.services.find((s) => s.name === parts.slice(0, typeIndex).join("/") && s.type === parts[typeIndex]);
  if (!service) {
    return null;
  }
  if (who.invalid) {
    return serviceResource(online, service, parts.slice(typeIndex + 1), params, format, [], pages) ? invalid : null;
  }
  const refused = refusal(service, who.user);
  if (refused) {
    return format === "html" ? html(messagePage(refused.message)) : arcgisError(refused.message, format, refused.code);
  }
  return serviceResource(online, service, parts.slice(typeIndex + 1), params, format, problems, pages);
};

const portalRoute = (online, url, params, headers) => {
  if (url.pathname !== "/sharing/rest/community/self") {
    return null;
  }
  const token = params.get("token");
  let response;
  if (!token) {
    response = json({ error: { code: 400, messageCode: "COM_0019", message: "You must be signed in to see this resource.", details: [] } });
  } else if (!Object.hasOwn(online._tokens, token)) {
    response = arcgisError("Invalid token.", "json", 498);
  } else {
    const username = online._tokens[token];
    response = json({ username, role: users[username].onlineRole, orgId: ONLINE_ORG });
  }
  // The toolkit's content scripts call this from another origin, so it answers with CORS.
  return { ...response, headers: { "access-control-allow-origin": headers.origin || "*" } };
};
```

Change `createFakeArcGIS`'s first line to:

```js
export const createFakeArcGIS = (catalog = defaultCatalog, online = defaultOnlineCatalog) => {
```

In `respond`, replace the `requests.push(…)` line with:

```js
      const where = url.origin === FAKE_ORIGIN ? "" : url.origin;
      requests.push(`${request.method()} ${where}${url.pathname}${url.search}`);
```

and the final `return route(catalog, url, params, cookies, problems);` with:

```js
      if (url.origin === FAKE_ORIGIN) {
        return route(catalog, url, params, cookies, problems);
      }
      if (url.origin === ONLINE_ORIGIN) {
        return onlineRoute(online, url, params, problems);
      }
      if (url.origin === PORTAL_ORIGIN) {
        return portalRoute(online, url, params, headers);
      }
      return null;
```

- [ ] **Step 5: Run the unit tests to see them pass**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 6: Run lint and the browser tests**

Run: `npm run lint && npm run test:e2e`
Expected: both PASS. The harness doesn't route the new origins yet.

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/catalog.js tests/fixtures/fake-arcgis.js tests/unit/fake-arcgis.test.js
git commit -F - <<'EOF'
Add ArcGIS Online stand-ins to the fake server

services9.arcgis.com serves one org's hosted services. It lists secured
services and refuses them with 499, answers a bad token with 400, and
copies a page's token into its links. www.arcgis.com answers
community/self with CORS. Org IDs are case-sensitive; instance names are
not.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Harness: three origins, sign-in cookies and real tab ids

**Files:**
- Modify: `tests/e2e/fixtures.js` (the header comment, the import and export, the route handler, `openPopupTab`, a new `signIn` fixture)
- Test: `tests/e2e/harness.spec.js` (change the import, append tests)
- Modify: `CLAUDE.md` (the `npm run test:e2e` bullet)

**Interfaces:**
- Consumes: `FAKE_ORIGINS`, `ONLINE_ORIGIN`, `ONLINE_REST_ROOT`, `ONLINE_TOKENS`, `PORTAL_ORIGIN`, `SERVER_TOKENS` and `respond(request, headers)` from Tasks 2 to 4.
- Produces:
  - `fixtures.js` exports `ONLINE_ORIGIN`, `ONLINE_REST_ROOT`, `ONLINE_TOKENS`, `PORTAL_ORIGIN` and `SERVER_TOKENS`, as well as the existing exports.
  - `signIn(username = "jsmith")`: sets the HttpOnly `agstoken` cookie for `https://arcgis.test`, path `/arcgis/rest`. Call it before opening the page.
  - `openPopupTab(target)`: `target` is a Page or a URL string. For a Page, the `tabs.query` stub reports that page's real tab id and URL. For a string, it reports tab id `-1` (`chrome.tabs.TAB_ID_NONE`).
  - The route handler passes `await request.allHeaders()` to `respond`, and serves every origin in `FAKE_ORIGINS`.

- [ ] **Step 1: Write the failing tests**

In `tests/e2e/harness.spec.js`, change the first line to:

```js
import { test, expect, FAKE_ORIGIN, html, ONLINE_REST_ROOT, ONLINE_TOKENS, PORTAL_ORIGIN, REST_ROOT } from "./fixtures.js";
```

Append:

```js
test.describe("signing in", () => {
  test("signIn sets an HttpOnly agstoken cookie that reaches the fake server", async ({ page, signIn }) => {
    await signIn("jsmith");
    await page.goto(REST_ROOT);
    expect(await page.evaluate(() => document.cookie)).not.toContain("agstoken");
    const self = await page.evaluate(() => fetch("/arcgis/rest/self?f=json").then((response) => response.json()));
    expect(self.user.username).toBe("jsmith");
  });

  test("a request with credentials omitted runs anonymously", async ({ page, signIn }) => {
    await signIn("jsmith");
    await page.goto(REST_ROOT);
    const self = await page.evaluate(() => fetch("/arcgis/rest/self?f=json", { credentials: "omit" }).then((response) => response.json()));
    expect(self).toEqual({ user: {} });
  });

  test("the cookie goes only to paths in its own case", async ({ page, signIn, fakeServer }) => {
    await signIn("jsmith");
    await page.goto(REST_ROOT);
    await page.evaluate(() => fetch("/ArcGIS/rest/self?f=json").then((response) => response.json()));
    expect(fakeServer.calls.find((call) => call.path === "/ArcGIS/rest/self").cookies).toEqual({});
  });
});

test.describe("the ArcGIS Online stand-ins", () => {
  test("a hosted service page loads and runs the content scripts", async ({ page }) => {
    await page.goto(`${ONLINE_REST_ROOT}/Parcels/FeatureServer`);
    await expect(page.locator("img.status-icon")).toBeAttached();
  });

  test("community/self answers a page on another origin", async ({ page }) => {
    await page.goto(`${ONLINE_REST_ROOT}/Parcels/FeatureServer`);
    const self = await page.evaluate(([url, token]) => fetch(url, { method: "POST", body: new URLSearchParams({ f: "json", token }) })
      .then((response) => response.json()), [`${PORTAL_ORIGIN}/sharing/rest/community/self`, ONLINE_TOKENS.jsmith]);
    expect(self.username).toBe("jsmith");
  });
});

test.describe("a redirect to another host", () => {
  const redirectAway = () => ({ status: 307, headers: { location: "https://elsewhere.test/landing" }, body: "" });

  test("is recorded as an off-host request when followed", async ({ page, fakeServer, harness }) => {
    fakeServer.override(/^\/arcgis\/rest\/moved$/, redirectAway);
    await page.goto(`${FAKE_ORIGIN}/other/page`);
    await page.evaluate(() => fetch("/arcgis/rest/moved").catch(() => {}));
    expect(harness.offHost).toContainEqual("https://elsewhere.test/landing");
    harness.forgive();
  });

  test("sends nothing there when the request uses redirect: manual", async ({ page, fakeServer }) => {
    fakeServer.override(/^\/arcgis\/rest\/moved$/, redirectAway);
    await page.goto(`${FAKE_ORIGIN}/other/page`);
    const type = await page.evaluate(() => fetch("/arcgis/rest/moved", { redirect: "manual" }).then((response) => response.type));
    expect(type).toBe("opaqueredirect");
  });
});

test.describe("openPopupTab", () => {
  test("given a page, reports that page's real tab id", async ({ page, openPopupTab }) => {
    await page.goto(REST_ROOT);
    const popup = await openPopupTab(page);
    const result = await popup.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const real = await chrome.tabs.get(tab.id);
      const own = await chrome.tabs.getCurrent();
      return { exists: real.id === tab.id, isOwnTab: tab.id === own.id, url: tab.url };
    });
    expect(result).toEqual({ exists: true, isOwnTab: false, url: REST_ROOT });
  });

  test("given a URL, reports no tab", async ({ openPopupTab }) => {
    const popup = await openPopupTab(REST_ROOT);
    const id = await popup.evaluate(async () => (await chrome.tabs.query({}))[0].id);
    expect(id).toBe(-1);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx playwright test tests/e2e/harness.spec.js`
Expected: FAIL with `does not provide an export named 'ONLINE_REST_ROOT'`.

- [ ] **Step 3: Add the exports and fixtures to `tests/e2e/fixtures.js`, but not the route change yet**

Replace the header comment's second paragraph (from "Each test gets a fresh Chromium profile" to "which opens the popup page as a tab.") with:

```js
// Each test gets a fresh Chromium profile with the extension loaded. Playwright routing sees every
// request from tab pages, from extension pages opened as tabs, from content scripts and from the
// service worker. The origins in FAKE_ORIGINS are answered by tests/fixtures/fake-arcgis.js: an
// Enterprise-style server at https://arcgis.test, and two ArcGIS Online stand-ins. Every other
// http(s) host is blocked. The real toolbar popup's own requests are not routed, because it has no
// Playwright Page. They fail at DNS for a .test host and appear in no list. Test popup logic with
// openPopupTab, which opens the popup page as a tab.
```

Replace the import and export lines with:

```js
import {
  arcgisError, createFakeArcGIS, FAKE_ORIGIN, FAKE_ORIGINS, html, json, ONLINE_ORIGIN, ONLINE_REST_ROOT, ONLINE_TOKENS,
  PORTAL_ORIGIN, REST_ROOT, SERVER_TOKENS
} from "../fixtures/fake-arcgis.js";

export { arcgisError, expect, FAKE_ORIGIN, html, json, ONLINE_ORIGIN, ONLINE_REST_ROOT, ONLINE_TOKENS, PORTAL_ORIGIN, REST_ROOT, SERVER_TOKENS };
```

Replace the `openPopupTab` fixture with:

```js
  // Opens the popup page in a normal tab, with chrome.tabs.query answering as if target were the
  // active tab. target is a Page, whose real tab id and URL the stub reports, or a URL, for which it
  // reports chrome.tabs.TAB_ID_NONE (-1). For popup logic; the real popup needs clickAction.
  openPopupTab: async ({ context, extensionId, serviceWorker }, use) => {
    await use(async (target) => {
      let tab = { id: -1, url: target };
      if (typeof target !== "string") {
        await target.bringToFront();
        const id = await inWorker(serviceWorker, async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
        tab = { id, url: target.url() };
      }
      const page = await context.newPage();
      await page.addInitScript(({ id, url }) => {
        const tabs = [{ id, index: 0, windowId: 1, active: true, url }];
        chrome.tabs.query = (queryInfo, callback) => {
          if (callback) {
            callback(tabs);
            return undefined;
          }
          return Promise.resolve(tabs);
        };
      }, tab);
      await page.goto(`chrome-extension://${extensionId}/src/page_action/page_action.html`);
      return page;
    });
  },

  // Signs the browser in to https://arcgis.test the way its login page does: an HttpOnly agstoken
  // cookie on /arcgis/rest, which page scripts can't read. Call it before opening the page.
  signIn: async ({ context }, use) => {
    await use((username = "jsmith") => context.addCookies([{
      name: "agstoken",
      value: SERVER_TOKENS[username],
      domain: "arcgis.test",
      path: "/arcgis/rest",
      httpOnly: true,
      secure: true,
      sameSite: "Lax"
    }]));
  },
```

- [ ] **Step 4: Watch the cookie test fail without `allHeaders()`**

Run: `npx playwright test tests/e2e/harness.spec.js -g "reaches the fake server"`
Expected: FAIL, because `self.user.username` is `undefined`. The cookie is set, but the harness still hands the fake server `request.headers()`, which leaves cookies out. This is Review Focus item 1, and this failure is what the test exists to catch.

- [ ] **Step 5: Route all three origins and pass every header**

In the `context` fixture's route handler, replace:

```js
      if (new URL(request.url()).origin !== FAKE_ORIGIN) {
```

with:

```js
      if (!FAKE_ORIGINS.includes(new URL(request.url()).origin)) {
```

and replace:

```js
      const response = await fakeServer.respond(request);
```

with:

```js
      // allHeaders(), not headers(): only allHeaders() includes the Cookie header.
      const response = await fakeServer.respond(request, await request.allHeaders());
```

- [ ] **Step 6: Run the harness tests to see them pass**

Run: `npx playwright test tests/e2e/harness.spec.js`
Expected: PASS. If "signIn sets an HttpOnly agstoken cookie" still fails after the `allHeaders()` change, stop and report it. The signed-in fixtures depend on the routed request carrying its Cookie header, and the design has to change if Playwright doesn't provide it.

- [ ] **Step 7: Run the whole suite and lint**

Run: `npm run lint && npm test`
Expected: PASS. `tests/e2e/action-popup.spec.js` still calls `openPopupTab(SERVICE_PAGE)` with a URL and gets tab id `-1`, which the popup ignores today.

- [ ] **Step 8: Update `CLAUDE.md`**

In the `npm run test:e2e` bullet, replace:

```
`tests/fixtures/fake-arcgis.js` answers the requests to `https://arcgis.test` that it has fixtures for, and any other request to that host gets a 404 and fails the test. A test also fails on a request to another host,
```

with:

```
`tests/fixtures/fake-arcgis.js` answers requests to three origins: `https://arcgis.test`, an Enterprise-style server that signs users in with an `agstoken` cookie or a token and hides secured services from anonymous listings, and two ArcGIS Online stand-ins, `https://services9.arcgis.com` and `https://www.arcgis.com`. A request to one of them that has no fixture gets a 404 and fails the test. The `signIn` fixture sets the server's sign-in cookie, and `openPopupTab` takes a Page to report its real tab id. A test also fails on a request to any other host,
```

- [ ] **Step 9: Commit**

```bash
git add tests/e2e/fixtures.js tests/e2e/harness.spec.js CLAUDE.md
git commit -F - <<'EOF'
Route the ArcGIS Online stand-ins and sign-in cookies in the harness

The harness serves all three fake origins and passes every request
header, cookies included, to the fake server. signIn sets the HttpOnly
agstoken cookie, and openPopupTab reports a page's real tab id. Harness
self-tests pin the cookie, credentials: "omit", case-sensitive cookie
paths, CORS on community/self and redirects to another host.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: The token probe as a repo script

**Files:**
- Create: `scripts/probe-tokens.js`, from the probe the owner ran in the brainstorming session
- Create: `tests/unit/probe-tokens.test.js`
- Modify: `.gitignore` (append)
- Modify: `CLAUDE.md` (Commands)
- Modify: `docs/superpowers/specs/2026-10-13-token-support-design.md` (the script's name)

**Interfaces:**
- Produces: `node scripts/probe-tokens.js`, configured by `PROBE_BASE`, `PROBE_SECURED`, `PROBE_USER`, `PROBE_PASS`, `PROBE_MANUAL_LOGIN`, `PROBE_OUT` and `HEADED`. It exits with status 2 and a usage message when settings are missing, and writes `probe-output/<host>-<time>.json` and `.md` by default.

This task is done. It was carried out on the `token-groundwork` branch (pull request #35), which commits the adapted script; the source was a file on the owner's machine, outside the repo. This branch doesn't hold the script, and `main` gets it when #35 merges. Review the probe in #35, or on `main` after it merges, and don't rerun this task from a checkout of this branch. The steps below record how it was done.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/probe-tokens.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../scripts/probe-tokens.js", import.meta.url));

// Runs the probe with the given settings. Every case here exits before the probe sends a request.
const probe = (settings) => spawnSync(process.execPath, [SCRIPT], {
  env: { PATH: process.env.PATH, ...settings },
  encoding: "utf8"
});

test("the token probe refuses to run without a server and a secured service", () => {
  const result = probe({});
  assert.equal(result.status, 2);
  assert.match(result.stderr, /PROBE_BASE and PROBE_SECURED are required/);
});

test("the token probe asks for a password or a manual sign-in", () => {
  const result = probe({ PROBE_BASE: "https://gis.example.org/server", PROBE_SECURED: "Folder/Service/MapServer" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /PROBE_MANUAL_LOGIN=1/);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/unit/probe-tokens.test.js`
Expected: FAIL. Node can't find `scripts/probe-tokens.js`, so the status is 1, not 2.

- [ ] **Step 3: Copy the probe in**

The owner's local `token-probe.mjs`, from the brainstorming session, was copied to `scripts/probe-tokens.js`.

- [ ] **Step 4: Adapt it to the repo**

Make these edits in `scripts/probe-tokens.js`:

1. Replace the comment block at the top, everything before the first `import`, with:

   ```js
   // Probes how an ArcGIS Server, Portal or ArcGIS Online handles tokens, for the token support design
   // (docs/superpowers/specs/2026-10-13-token-support-design.md, section 9). Run it by hand before each
   // release, on servers you can sign in to. It isn't part of CI.
   //
   // It only reads: a few spaced-out requests to rest/services, rest/info, rest/self, the login form
   // and the token endpoint, under 100 in all, and nothing under /admin. It never prints, logs or saves
   // a token or a password. A token is recorded as its length, and a username only as whether it
   // matches PROBE_USER.
   //
   // Settings, from the environment:
   // - PROBE_BASE (required): the server root before /rest, such as https://gis.example.org/server
   // - PROBE_SECURED (required): a secured service under rest/services, such as Folder/Service/MapServer
   // - PROBE_USER and PROBE_PASS: sign in through a standalone server's login form
   // - PROBE_MANUAL_LOGIN=1: open a browser at the server's Login link and wait while you sign in by
   //   hand, for federated or SSO servers. The script never sees the password, and skips the checks
   //   that need one.
   // - PROBE_OUT: output path prefix (default probe-output/<host>-<time>, which git ignores)
   // - HEADED=1: show the browser
   //
   // It writes <PROBE_OUT>.json and <PROBE_OUT>.md. Neither contains a token or a password.
   ```

2. Replace these lines:

   ```js
   import { createRequire } from "node:module";
   import { writeFileSync } from "node:fs";
   import { createInterface } from "node:readline";

   const require = createRequire(
     "/Users/gareth.evans/github/misc/Map-Services-Enhanced/package.json",
   );
   const { chromium } = require("playwright");
   ```

   with:

   ```js
   import { chromium } from "@playwright/test";
   import { mkdirSync, writeFileSync } from "node:fs";
   import { dirname } from "node:path";
   import { createInterface } from "node:readline";
   ```

3. In both usage messages, replace `See README.md.` with `See the comment at the top of scripts/probe-tokens.js.`
4. Replace the line ``const OUT = process.env.PROBE_OUT || `./probe-${host}-${stamp}`;`` with:

   ```js
   const OUT = process.env.PROBE_OUT || `probe-output/${host}-${stamp}`;
   mkdirSync(dirname(OUT), { recursive: true });
   ```

5. Search the file for `README` and `token-probe.mjs`, and point any remaining mention at `scripts/probe-tokens.js`.

- [ ] **Step 5: Lint the probe**

Run: `npx eslint --fix scripts/probe-tokens.js && npm run lint`
Expected: PASS. If lint reports more than formatting, such as an unused variable, remove the unused code without changing what the probe checks or prints. List each such change in the commit body.

- [ ] **Step 6: Run the tests to see them pass**

Run: `node --test tests/unit/probe-tokens.test.js`
Expected: PASS, with no network access needed.

- [ ] **Step 7: Ignore its output, and document it**

Append to `.gitignore`:

```
# Token probe output (scripts/probe-tokens.js)
probe-output/
```

In `CLAUDE.md`, under Commands, add this bullet after the `npm run test:live` bullet:

```
- `node scripts/probe-tokens.js`: probes how a server handles tokens, for the token work (settings in the comment at the top of the file). Run it by hand on servers you can sign in to, signing in by hand with `PROBE_MANUAL_LOGIN=1` on federated or SSO servers. It isn't part of CI, and git ignores its output in `probe-output/`.
```

In `docs/superpowers/specs/2026-10-13-token-support-design.md`, replace each `scripts/probe-tokens.mjs` with `scripts/probe-tokens.js`.

- [ ] **Step 8: Check the probe against sampleserver6 (optional, needs the network)**

The owner approved Esri's published shared sample account for read-only probes. Skip this step if there's no network.

```bash
PROBE_BASE="https://sampleserver6.arcgisonline.com/arcgis" PROBE_SECURED="USA_secure_user1/MapServer" \
PROBE_USER="user1" PROBE_PASS="user1" node scripts/probe-tokens.js
```

Expected: it finishes with `Wrote probe-output/sampleserver6.arcgisonline.com-<time>.json and .md`. The `.md` file reports `agstoken` as HttpOnly, and `git status` doesn't list `probe-output/`.

- [ ] **Step 9: Run everything and commit**

Run: `npm run lint && npm test && npm run build`
Expected: PASS. The build zips only `src/` files, so the probe doesn't ship.

```bash
git add scripts/probe-tokens.js tests/unit/probe-tokens.test.js .gitignore CLAUDE.md docs/superpowers/specs/2026-10-13-token-support-design.md
git commit -F - <<'EOF'
Add the token probe as a manual script

scripts/probe-tokens.js checks how a server handles tokens: the
agstoken cookie's attributes, whether a token beats the cookie,
rest/self, referer binding, and the token header on page requests. It
only reads, never records a token or password, and writes to
probe-output/, which git ignores. It came out of the token design work
(spec section 9).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Finishing

- [ ] Push `token-groundwork`, and open a pull request against `main` if #31 has merged, or against `token-support-spec` if it hasn't. The description lists the six tasks, says that nothing under `src/` changed, and names the Review Focus tests.
