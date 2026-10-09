# Security policy

## Supported versions

Security fixes go into the latest release and `main`. Older versions don't get fixes, so update to the latest release.

| Version | Supported |
|---|---|
| 2.x, latest release | Yes |
| Older 2.x releases | No |
| Map Services Enhanced 1.x, the original extension | No |

## Reporting a vulnerability

Please report vulnerabilities privately, not in a public issue. Use GitHub's private reporting: on this repository's **Security** tab, choose **Report a vulnerability**. Only the maintainer can see the report.

Include:

- the extension version, shown on `chrome://extensions`, and your Chrome version
- what an attacker could do and what they need, for example a page they control or a malicious ArcGIS server
- steps to reproduce, with a URL or a minimal page if you can share one
- any proof-of-concept code

This is a one-person project, so responses are best effort. You can expect an acknowledgement within 7 days and an assessment after that. If the report is confirmed, I'll agree a fix and a disclosure date with you. I'll publish a GitHub security advisory when the fix ships, and credit you in it unless you'd rather not be named.

## Scope

In scope:

- the extension in `src/`: its content scripts, popup, options page and service worker
- this repository's build and release workflows

Out of scope:

- ArcGIS Server and other Esri products and services. Report those to Esri.
- Map Services Enhanced, the original extension this one continues. It is no longer maintained.
- Attacks that need control of the user's browser, device or Chrome profile.

## How the extension handles data

This helps you judge what counts as a vulnerability.

- The extension runs only on pages whose path contains `/rest/services`. It treats the content of those pages, and every server response, as untrusted.
- It sends requests only to ArcGIS services linked from the page you are viewing.
- It has no analytics and sends nothing to the developer or anyone else.
- It keeps its settings in Chrome's extension storage.
