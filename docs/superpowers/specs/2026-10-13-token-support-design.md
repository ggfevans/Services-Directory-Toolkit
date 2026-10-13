# Token support for secured services

- **Date:** 2026-10-13
- **Status:** design approved by the owner on 2026-10-13; written spec awaiting review
- **Scope:** working with ArcGIS tokens on secured services after the 2.0.0 store release. The Phase 2 token fixes land earlier, in 2.0.0, through pull request #30.

This spec covers three releases. Section 5 designs v1 in full. Section 8 outlines v2 and v3, and section 9 lists the experiments that gate them. Each release gets its own implementation plan.

## 1. Context

Secured ArcGIS services need a token or a sign-in. Today the extension drops a `token` in the page URL (INJ-16), and its requests carry whatever cookie the browser sends. Phase 2 of the store-readiness spec forwards the page's token to the same origin and REST root (ADV-6), and pull request #30 tightens that rule (TOK-1 to TOK-6).

The target user is a GIS technician or web developer. They work across several servers in one browser session: development, test and production, a portal and its federated servers, one or two ArcGIS Online orgs. They move requests between the browser, Postman, curl and FME, and they know what 498 and 499 mean. Three things matter to them:

- which user a page and the toolkit's requests run as
- which services are public and which are secured
- getting a working token, URL or request out of the browser

The design came out of a brainstorming session with the owner, a research pass over Esri's documentation and Chromium's source, and three adversarial reviews (security and privacy, ArcGIS platform behaviour, developer UX and buildability). A probe then ran against Esri's sampleserver6 with its published shared account. Appendix A lists the review findings and how each is resolved.

## 2. Goals

1. The toolkit shows which user a Services Directory page and its own requests run as.
2. A token in the page URL can be copied as a token, a URL, a curl command or a header in two clicks.
3. The user can see which services in a folder are public without opening a private window.
4. Popup search finds secured services when the user is signed in.
5. No token reaches the page's DOM, anything the extension logs, or an origin outside its scope. The one exception is ArcGIS Online's `community/self`, which identifies the user of a hosted service's token (section 5.4).
6. v1 adds no permissions.

## 3. Decisions

| Topic | Decision | Reason |
|---|---|---|
| Releases | Phase 2 fixes in 2.0.0 (#30). v1 after 2.0.0, then v2 and v3. | The store-readiness spec excludes new features from 2.0.0. The Phase 2 fixes harden the URL token that 2.0.0 already forwards. |
| Sources in v1 | The server's sign-in cookie and `?token=` in the page URL | On Enterprise a pasted token can't make the listing show secured services (section 4). |
| Pasted tokens | v2, attached by a `declarativeNetRequest` session rule bound to the tab | On 10.9.1 the header makes the page itself list and render secured services, and the token stays out of every web renderer. |
| Read my sign-in | v2: `chrome.cookies`, with host access to one server granted for the read and removed after it | `agstoken` is HttpOnly, so only `chrome.cookies` can read it. That brings a permission prompt, and tests can't pre-grant it. |
| Portal and ArcGIS Online cookies | Never read | They are HttpOnly, and `esri_aopc` is encrypted. The only way in is Esri's internal `oauth2/platformSelf`, which Esri says custom apps can't use. |
| ArcGIS Online sign-in | v3, through OAuth with `chrome.identity.launchWebAuthFlow` | The supported route. It needs an app registration, and orgs that allow only approved apps would block it. |
| UI | A Token section in the popup, and token state in the page's status bar | The owner chose it from three mockups. The status bar shows who you are on the page without a click. |
| Identity | `<scope>/rest/self` on Enterprise. ArcGIS Online's `community/self` for hosted services. | `rest/self` exists on 10.9.1 to 12.1 and keeps the request inside the scope. |
| Public check | A one-shot "What's public here?" in the popup | A per-tab anonymous switch left the page, its map previews and the Query Helper signed in. |
| Transport | Form POST body, default credentials, `redirect: "manual"` | Query strings reach Chrome's console and server logs. Omitting credentials breaks SSO proxies, IWA and PKI. Redirects re-send tokens. |
| Storage | None in v1. `chrome.storage.session` in v2. | v1's tokens live in the page URL or the browser's cookie jar. |
| Expiry | Not shown | Servers report expiry only when they issue a token. |

## 4. Facts the design depends on

Each fact names its source: the research pass, a reviewer, or the sampleserver6 probe (10.9.1, standalone, Esri's shared `user1` account, read-only).

- **The sign-in cookie** (probe). The Services Directory login sets `agstoken` with `HttpOnly`, `SameSite=Lax`, `Path=/arcgis/rest`, no `Domain`, and about an hour's expiry. `document.cookie` doesn't show it. Logout headers on 10.7.1 to 12.1 clear the same cookie; 11.5 adds `Domain=<host>`, and 12.1 also clears `Path=/<instance>/services` (research).
- **Federated sign-in** (research, 11.5 and 12.1). The server's Login link goes through the portal's OAuth and leaves the server's own `agstoken`. The portal's and ArcGIS Online's cookies (`esri_auth`, `esri_aopc`) are `Secure; HttpOnly`.
- **A token parameter beats the cookie** (probe). With the cookie present, `token=bogus` returns 498, and an empty `token=` makes the request anonymous.
- **Identity** (platform review and probe).
  - `<scope>/rest/self?f=json` exists on 10.9.1, 11.3, 11.5 and 12.1, standalone and federated.
  - With a valid token or cookie it returns `user.username`, `user.roles` and `user.privilege`.
  - Anonymous requests get `{"user":{}}`, and a bad token gets 498.
  - ArcGIS Online's hosted services host answers 400 "Unable to get user info.", and its tiles hosts answer with a 404 page.
- **Anonymous listings** (probe and platform review). Enterprise listings leave secured services out, and the secured pages redirect to the login page. ArcGIS Online hosted listings include them, and requests for them return 499.
- **Error bodies** (research and probe). 498 and 499 arrive as HTTP 200 with the code in the JSON body. ArcGIS Online's hosted root answers 400 "Invalid token". The message's case and final full stop vary.
- **Referer binding** (probe). A token made with `client=referer` returns 498 with no Referer or the wrong one, and works with the right one. `client=referer` is the default on the server's token page. Content scripts send the page URL as the Referer, and extension pages send none.
- **Portability** (probe). An IP-bound token works from Node with no cookie and no Referer, in the body or the query string.
- **A header on page requests** (probe, 10.9.1 only). A valid `X-Esri-Authorization: Bearer` header on HTML requests lists hidden services and renders secured pages. An invalid one returns 498.
- **Tokens in links** (probe and platform review). An Enterprise page opened with `?token=` lists and renders secured content, but none of its 96 links carry the token. ArcGIS Online copies the token into its links.
- **Case** (platform review). `/ArcGIS/rest/services` works on 10.9.1, 11.5 and 12.1, and ArcGIS Online emits both cases in one page. Cookie paths match case-sensitively (RFC 6265 section 5.1.4). An ArcGIS Online org ID is case-sensitive.
- **Chrome** (security and UX reviews, tested with throwaway extensions and Chromium's source).
  - Content-script `matches` test the path and the query string (`extensions/common/url_pattern.cc`). A page can call `history.replaceState` before the scripts load, and Chrome then reports the rewritten URL as the sender's.
  - A 307 to another origin re-sends a POST-body token and an `X-Esri-Authorization` header. Chrome strips only `Authorization`.
  - Chrome writes a failed content-script request's full URL to the console.
  - Requests from extension pages and the service worker carried `agstoken` only when it was `SameSite=None`.
  - `credentials: "omit"` drops cookies, HTTP authentication and TLS client certificates (Fetch standard).
  - Content-script requests don't show in the page's Resource Timing, and they bypass the page's service worker.
  - `chrome.cookies` needs explicit host permissions. Content-script `matches` don't count.

Section 9 lists what is still unverified.

## 5. Design (v1)

Mockup: `docs/design/mockups/token-popup.html`, popup states A to D and the status bar's token states.

### 5.1 Scope

`SDT.auth.scopeOf(url)`, which Phase 2 builds (#30):

- parses with `new URL` and reads `pathname` only
- splits at the first whole-segment `/rest/services`. The scope is the origin plus the path before it, such as `https://gis.example.org/server` or `https://services3.arcgis.com/Ab12Cd/arcgis`.
- lower-cases the host and the instance path, but not an ArcGIS Online org ID
- returns null for anything else, including `/restricted/...`, `/admin`, `/tokens` and paths with encoded dot segments

A hosted ArcGIS Online scope is one on a `services*.arcgis.com` or `tiles*.arcgis.com` host. Other `*.arcgis.com` hosts, such as elevation and route, run their own servers with a Login link and an `agstoken` session, and count as Enterprise scopes here.

### 5.2 Sources and precedence

- If the page URL has a `token`, the toolkit sends it. The server then ignores any cookie.
- Otherwise it sends no token, and the browser's cookie session applies.
- It never sends an empty `token`, which would make the request anonymous.
- v1 stores nothing, and the service worker has no part in token handling.

### 5.3 Sending a token

- Only to URLs the URL builder makes from a scope and a known read operation: resource JSON, count and distinct `query`, `export`, and `rest/self`.
- In a form POST body, with default credentials and `redirect: "manual"`. A redirect is reported and never followed.
- Before a link filter tests an href, the href loses its `token`, `f` and fragment.

Phase 2 builds 5.1 and most of 5.3 (#30). v1 adds the read-operation allow-list and everything else in section 5.

### 5.4 Page flow

On a Services Directory page the content script:

1. classifies the page and computes the scope, and stops if there is none
2. sends one `rest/self` request, which counts toward the 50-request budget. On a hosted ArcGIS Online scope with a URL token it asks `https://www.arcgis.com/sharing/rest/community/self` instead. That host is the one documented exception to the scope rule.
3. shows the username as a badge in the status bar when there is one
4. classifies failures by code and quotes the server's own message:

| Case | Status bar |
|---|---|
| 498, or ArcGIS Online's 400 "Invalid token" (matched without case) | Error: the token in the page URL was rejected. It may have expired, or be tied to another referrer or IP. |
| 499 or 403 | Warning: N services refused this token or this user, with the server's message |
| A redirect on a request that carries a token | Error: the toolkit stopped, and names the address to open |
| `rest/self` fails | No badge |

The badge shows a username and never a token. A script on the same server can already call `rest/self` with the same cookie, so the badge tells the page nothing new.

### 5.5 Popup

When the popup opens, it connects to the tab's main frame and asks the content script for:

- the user, and where the credential came from (cookie, page URL or none)
- whether the server uses tokens (`authInfo.isTokenBasedSecurity` from `rest/info`)
- `tokenServicesUrl`
- the page's own Login link

The token value crosses to the popup only when the user presses Copy. Until then the popup shows the last four characters and the length.

The Token section has these parts:

- **User line.** "Signed in as jsmith (Administrator)", "Using the token in the page URL, as jsmith_myorg" or "Not signed in". For a URL token, the content script makes the identity request from section 5.4 with only that token and `credentials: "omit"`. The user line then names the user the copied token belongs to.
- **Copy as** (URL tokens only in v1).
  - Formats: Token; URL with token; curl (macOS, Linux); curl.exe (Windows); Header (`X-Esri-Authorization: Bearer …`).
  - Both curl formats POST the token in the body (`-d f=json --data-urlencode token=…`) and drop any existing `f` and `token`. They add `-e` with the page URL minus its query, for tokens bound to a referrer.
  - "URL with token" is the only format that puts the token in a URL.
  - Copy writes with `navigator.clipboard.writeText`.
- **Cookie sessions** (state A). v1 can't read `agstoken`. The popup says so, offers **Get a token**, which opens the server's `tokenServicesUrl`, and names the manual route: DevTools, Application, Cookies, `agstoken`.
- **Sign in** opens the page's own Login link. **Sign out** opens `<scope>/rest/logout`. On a federated server, a note says the portal may sign the user straight back in.
- **What's public here?** appears when someone is signed in (states A and B). State D shows a result.
  - The content script requests the current folder or service with `credentials: "omit"`, `referrerPolicy: "no-referrer"` and no token. It compares the result with the signed-in one and lists the public and the secured services.
  - ArcGIS Online hosted listings include secured services, so there it checks each service, up to 50, through the request limiter.
  - A 401, a redirect or an HTML page in the answer gives "Can't check here: something in front of the server needs its own sign-in".
  - Subfolders aren't checked.
- **Not signed in** (state C). "This server uses tokens, and anonymous users don't see its secured services", with Sign in and Get a token. The second clause is confirmed on 10.9.1 only, and experiment E4 checks it on 11.x and 12.x before v1 ships.
- **Servers without token security.** The section shows the user line only, because web-tier authentication (IWA, PKI) has no token to copy.

**Search this server** moves into the content script. The popup opens a `chrome.tabs.connect` port to frame 0. The content script runs the crawl with the page's cookie and URL token and streams results back. Closing the popup closes the port, which stops the crawl. Result links never carry the token. This changes Phase 9's search, which runs from the popup.

### 5.6 Security rules

v1 adds these to section 4.4 of the store-readiness spec:

1. A token is sent only as section 5.3 says.
2. The extension never writes a token into the page. Error text and failed-location lists are redacted by the token's value, raw and URL-encoded. A pattern on `token=` misses encoded forms such as `returnUrl=…%3Ftoken%3D…`.
3. The content script talks only to the extension's popup, over a `chrome.runtime.onConnect` port opened to frame 0, after checking `sender.id`. It never listens to `window.postMessage`.
4. Copy refuses a token with characters outside `[A-Za-z0-9._-]`. A copied URL keeps only the scope and resource path, and every character outside `[A-Za-z0-9._~/%-]` is percent-encoded. That keeps the quoting safe in bash, zsh, cmd and PowerShell.
5. On an `http:` page the URL token still goes to the same origin, which received it in clear text already. Copy warns that the token travels unencrypted.
6. Links the extension creates use `rel="noreferrer noopener"`.
7. Incognito tabs use only their own cookies, because v1 stores nothing and the popup always asks the tab's own content script.

### 5.7 Popup errors

| Case | Popup |
|---|---|
| The popup can't reach the content script | "Reload the page to use the toolkit here" |
| The clipboard write fails | The existing copy-by-hand message |
| The URL token check fails | "Signed-in user unknown", the server's message, and Copy still offered |
| The public check meets a sign-in layer | "Can't check here: something in front of the server needs its own sign-in" |

### 5.8 Privacy and store

- The privacy policy (store track S) gains a paragraph. The extension reads a token from the page URL or relies on the server's sign-in cookie. It sends the token only to that server's REST services, and to ArcGIS Online's `community/self` for hosted services. It stores no token, and it copies one only when the user presses Copy. Clipboard history tools may keep a copy.
- The Chrome Web Store privacy practices declare "Authentication information".
- v1 adds no permissions.

## 6. Testing

**Unit tests** (`node --test`, with the lib loaded through `vm`):

- `scopeOf`: case folding, org IDs that differ only in case, `%2e%2e`, `/restricted`, a Services Directory path that appears only in the query string, and the null cases
- the URL builder: read operations only, `token`, `f` and fragment stripped from hrefs, and no empty `token`
- redaction by value, raw and URL-encoded
- the copy formats: POSIX quoting, cmd and PowerShell quoting, the character check and percent-encoding
- the error classifier: 498, 499, 403, the 400 message variants, and a manual redirect

**Fake server additions** (synthetic, `tests/fixtures/fake-arcgis.js`):

- secured services that return 499 anonymously and 498 for a wrong token, and accept a known token in the body or a known `agstoken` cookie
- an Enterprise-style listing that hides secured services, and an ArcGIS Online-style listing that shows them
- `rest/self`, and `rest/info` with `authInfo`
- a 307 to another origin
- a second fake origin standing in for `www.arcgis.com`. The harness accepts one origin today (`tests/e2e/fixtures.js`, around line 114), and needs an allow-list.

HttpOnly cookies are seeded with `context.addCookies`, so no login fixture is needed.

**Browser tests:**

- the badge for a cookie session and for a URL token
- the token goes only in the POST body, and only inside the scope
- a redirect target receives nothing
- "What's public here?" on an Enterprise-style listing, an ArcGIS Online-style listing and a server behind a sign-in layer
- every copy format, through `openPopupTab`. Its `tabs.query` stub returns tab id 1 today (`tests/e2e/fixtures.js`, around line 191), and has to return the real tab's id.
- search with a cookie session
- each status bar token state
- no console message contains the token value

**Live and manual checks.** `npm run test:live` stays anonymous. The probe moves into the repo as `scripts/probe-tokens.mjs`, with its output ignored by git, as section 8 of the store-readiness spec allows for a capture script. The owner runs it on their own servers before each release. Esri has changed the cookie's attributes twice (11.5 and 12.1), and the probe is how a change gets noticed.

## 7. Phasing

| Release | Contents | Starts when |
|---|---|---|
| 2.0.0, Phase 2 | TOK-1 to TOK-6 (#30) | The store-readiness plan reaches Phase 2 |
| Tokens v1 | Sections 5.4 to 5.8, search through the content script, the tests in section 6, the probe script | 2.0.0 has shipped and E4 has run |
| Tokens v2 | Pasted tokens and Read my sign-in (section 8) | E1, E2, E3, E6, E9 and E10 have run |
| Tokens v3 | ArcGIS Online sign-in through OAuth | Its own design |

v1 builds on the popup from Phase 9 and the status bar from Phase 5.

## 8. Outlines for v2 and v3

**v2: pasted tokens.**

- **Pasting.** A password-type field in the popup. The content script validates the token, so the page's Referer goes with it.
- **The record.** It goes in `chrome.storage.session`, keyed by scope, tab id and incognito. The store keeps its default access level, and a lint rule bans `setAccessLevel`.
- **The header rule.** One `declarativeNetRequest` session rule per tab adds `X-Esri-Authorization: Bearer <token>`.
  - It matches `tabIds: [id]`, URLs under the scope's `/rest/services/` and `/rest/self`, and the main_frame, sub_frame, xmlhttprequest and image resource types.
  - The page itself then lists and renders secured services, and the token never enters a web renderer.
  - Scripts on the same origin in that tab can use the token's access through their own requests, but can't read the token.
  - Forget, closing the tab, and navigating out of the scope all remove the rule.
- **The service worker** owns the records and rules. It answers a content script only when `sender.frameId` is 0, `documentLifecycle` is `active` and `sender.origin` matches the scope.
- **Plain http.** Pasted tokens on `http:` are refused, except on loopback.
- **Rejection.** A 498 never deletes a token. The popup marks it "rejected here".

**v2: Read my sign-in.**

- The extension gains the `cookies` permission and `optional_host_permissions: ["*://*/*"]`.
- It requests the one origin and reads with `cookies.getAll` from the tab's cookie store, comparing paths without case.
- It then calls `permissions.remove`.
- Tests use a variant manifest generated in a temporary folder, never in `src/`.

**v3: ArcGIS Online sign-in.**

- "Sign in to ArcGIS Online" uses OAuth with PKCE through `chrome.identity.launchWebAuthFlow`, which needs the `identity` permission and one registered client.
- Orgs restricted to approved apps can't use it.
- Each Enterprise portal would need its own client.

## 9. Open experiments

The probe covers most of these. The owner runs it on their Enterprise servers, signing in by hand on federated or SSO servers so the script never sees a password.

| ID | Question | Decides |
|---|---|---|
| E1 | `agstoken` attributes on 11.x and 12.x | Whether Read my sign-in is the only route to copy a session token on every version |
| E2 | An invalid `X-Esri-Authorization` header on 11.x and 12.x: 498, or a silent 499? | v2 error handling |
| E3 | Does a valid header on page requests list hidden services and render secured pages on 11.x and 12.x, standalone and federated? | Whether v2 works as outlined |
| E4 | Do anonymous listings hide secured services on 11.x and 12.x? | The wording of state C in v1 |
| E5 | Do web adaptor and load balancer redirects keep the query string? | How often TOK-1 triggers |
| E6 | Federated `rest/self` fields, and the portal's `community/self` with a server token | v2 identity for pasted portal tokens |
| E7 | On a web-tier server (IWA, PKI), what does `rest/info` report, and do default-credential requests work? | The Token section on web-tier servers |
| E8 | With a server's AllowedOrigins restricted, do content-script requests still pass? | Error wording |
| E9 | Does `permissions.request` from the popup survive the prompt taking focus, on macOS, Windows and Linux? | The v2 Read my sign-in flow |
| E10 | Does `declarativeNetRequestWithHostAccess` work with host access from content-script `matches`, or does it need `host_permissions`? | v2 permissions and install warning |

## 10. Non-goals

- Capturing tokens from a web app's network traffic.
- Storing passwords, or signing in for the user outside v3's OAuth.
- Showing token expiry.
- Reading Portal or ArcGIS Online cookies, or calling `oauth2/platformSelf`.
- Opening a page with a `?token=` the extension adds.
- An options-page list of tokens.

## 11. Alternatives considered

- **Omitting cookies whenever a token is sent.** Rejected. It breaks SSO proxies, IWA and PKI, and the probe showed that a token parameter already wins over the cookie.
- **Sending every token-bearing request from the service worker.** Rejected for v1. Those requests carry no Referer and no `SameSite=Lax` cookie, which breaks referer-bound tokens and sign-in sessions. v2's header rule keeps the token out of renderers without that cost.
- **A per-tab anonymous switch.** Replaced by the one-shot public check.
- **Popup only, or an options-page list.** The owner chose popup and status bar from the mockups.
- **Pasted tokens in v1, sent by content scripts.** Rejected. On Enterprise the listing would still hide secured services, and the paste would change almost nothing.
- **`platformSelf` for ArcGIS Online sessions.** Rejected as an internal endpoint that impersonates Esri's client ID.

## Appendix A: Review findings

**Sources:** S = security and privacy review, P = ArcGIS platform review, U = developer UX and buildability review, Pr = sampleserver6 probe.

| ID | Source | Finding | Resolution |
|---|---|---|---|
| TR-1 | P, U, Pr | A pasted token can't make an Enterprise listing show secured services | Paste moves to v2, with the header rule |
| TR-2 | P, U | Omitting credentials breaks SSO proxies, IWA and PKI | Default credentials (TOK-5) |
| TR-3 | U | Extension-page requests don't carry `SameSite=Lax` cookies | Search and checks run in the content script |
| TR-4 | S, P, U, Pr | Popup validation rejects referer-bound tokens, and deleting on 498 loses good ones | Validation in the content script; v2 never deletes on 498 |
| TR-5 | S | A page can forge its URL, and the scripts run on query-string matches | Scope from `pathname` (TOK-6); v2 sender checks and tab binding |
| TR-6 | S | Redirects re-send the token to another origin | `redirect: "manual"` (TOK-1) |
| TR-7 | S, P | The scope takes in `/admin` and `/tokens`, encoded dot segments, fragments, and splits on case | TOK-2, TOK-3 |
| TR-8 | S | A query-string token reaches Chrome's console and server logs | POST body (TOK-4) |
| TR-9 | S, U | Read my sign-in leaves a lasting grant, reads the wrong store in incognito, and can't be pre-granted in tests | Moves to v2, with removal after the read and the tab's cookie store |
| TR-10 | S, P, U | The anonymous switch mixes identities | One-shot public check |
| TR-11 | S, P, U | Copy as curl allows shell injection, and single quotes fail on Windows | Rule 4 in section 5.6, and a curl.exe format |
| TR-12 | S, P | `owningSystemUrl` is chosen by the server | Never used to send a token or widen a scope |
| TR-13 | P | `rest/self` exists on every supported Enterprise version | Identity design (section 5.4) |
| TR-14 | P | ArcGIS Online copies `?token=` into its links, and the `$`-anchored link filters skip them | TOK-3 |
| TR-15 | P | Message variants for invalid tokens, and 403 for subscriber content | Section 5.4 table |
| TR-16 | P | Federated sign-out leaves the portal session, which signs the user back in | Note beside Sign out |
| TR-17 | S | In incognito, the popup and `storage.session` belong to the regular profile | v1 stores nothing; v2 keys records by incognito |
| TR-18 | S, P | Map previews load through `<img src>`, which always sends cookies | v2's header rule covers image requests |
| TR-19 | U | The harness's tab-id stub, single origin, and no CDP permission grant | Section 6 |
| TR-20 | U | Esri changes cookie attributes between releases | The probe runs before each release |
| TR-21 | S | Store policy on authentication information and encryption | Section 5.8; v2 refuses `http:` |
| TR-22 | S | A root page with `?token=` matches neither manifest pattern | Already MAN-2 |
| TR-23 | Pr | `agstoken` is HttpOnly on 10.9.1 | Session copy moves to v2; v1 offers Get a token |
| TR-24 | Pr | An empty `token=` makes a request anonymous | Never sent (section 5.2) |
