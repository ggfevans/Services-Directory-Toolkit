# Compatibility Docs and Bug Report Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, in one session (the executor can't start subagents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document which ArcGIS versions and browsers the extension supports, and add a bug report form that asks for those versions.

**Architecture:**
- README.md gets a "Compatibility" section between "Features" and "Install". The Install section stops repeating the browser requirement.
- `.github/ISSUE_TEMPLATE/bug_report.yml` is a GitHub issue form. GitHub reads it from the default branch, and the extension build never ships it.
- No code under `src/` or `tests/` changes.

**Tech stack:**
- GitHub-flavoured Markdown and GitHub issue forms (YAML)
- `check-jsonschema` 0.38.2, run with `uvx` and its built-in `vendor.github-issue-forms` schema (SchemaStore's issue-forms schema). Nothing is added to `package.json`.
- `gh api markdown` to render the README the way GitHub does

**Spec:** issue #9 (`gh issue view 9`), the approved design. Background in `docs/superpowers/specs/2026-10-09-store-readiness-design.md`, section 1 (supported ArcGIS versions) and the OWN-6 row of the findings table.

## Scope

This plan covers two of issue #9's deliverables: the README Compatibility section and the bug report form. These stay open and go in the PR description, which says "Part of #9":

- the compatibility sentence in the store listing (`docs/store/listing.md` doesn't exist yet; the store track creates it)
- the 12.x fixture variant (spec Phase 2)
- the release-checklist step that re-checks Esri's page (spec Phase 9)

The PR description also lists two possible follow-ups, a `.github/ISSUE_TEMPLATE/config.yml` and a CI job that runs the form check. It also notes that 12.0 and 11.2 retire on 1 December 2026, when the table needs its first update.

## Global Constraints

- **Version data comes from Esri's page on the day you write it.** Check https://support.esri.com/en-us/products/arcgis-enterprise/life-cycle before Task 1. WebFetch gets a 403 from it, so fetch it with curl and a browser user agent into the scratch directory `/tmp/docs-arcgis-versions/`, and don't commit the response. On 13 October 2026 every row of the issue's table matched Esri's page.
- **"As of" date:** the date you checked Esri's page, written as "13 October 2026" (day month year, no ordinal).
- **Scope of the version list:** Esri's life cycle for ArcGIS Enterprise on Windows and Linux. ArcGIS Enterprise on Kubernetes is out of scope (spec section 1 and the Phase 9 checklist).
- **Scratch files:** keep them in `/tmp/docs-arcgis-versions/`. Other jobs share `/tmp`.
- **Browser requirement:** Chrome 120 or later, or another Chromium browser such as Microsoft Edge. This matches `minimum_chrome_version` "120" in `src/manifest.json`.
- **Repository URL:** `https://github.com/ggfevans/Services-Directory-Toolkit`. Links in the issue form are absolute, because the form renders at `/issues/new`.
- **Label:** the form applies the existing `bug` label. Don't create labels.
- **Prose style:** follow anthropic-skills:my-writing-style, and run its grep self-check on every new line of prose before committing. No em or en dashes, straight quotes only.
- **Commits:** imperative subject in sentence case, no conventional-commit prefix, plain-English body. End each with:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
- **No other changes.** No code, tests, CI, `package.json`, `config.yml` or extra templates.

## Review Focus

The five problems most likely to reach a user despite the checks below:

1. **A wrong row in the version table.** A phase or retirement date that disagrees with Esri's page on the "as of" date misleads anyone choosing whether to report a bug. Task 1 Step 1 checks each row against the fetched page.
2. **A vulnerability reported in a public issue.** The form's first element points to SECURITY.md and to private reporting. Task 2 Step 3 checks that the link is absolute and that it comes first.
3. **A broken link in the form.** A relative link resolves against `/issues/new` and 404s. Task 2 Step 3 rejects any link that doesn't start with `https://`.
4. **ArcGIS Online users with no version to give.** The ArcGIS version field is free text and its description says to enter "ArcGIS Online". Task 2 Step 3 checks the description.
5. **The form or README leaking into the extension zip.** The build ships only referenced files plus `LICENSE`. Task 3 Step 2 lists the zip and checks neither file is in it.

---

### Task 1: README Compatibility section

**Files:**
- Modify: `README.md` (insert a section after "Features"; edit the first sentence of "Install")

**Interfaces:**
- Produces: the heading `## Compatibility`, whose GitHub anchor is `#compatibility`. Task 2's form links to `https://github.com/ggfevans/Services-Directory-Toolkit#compatibility`.

- [ ] **Step 1: Re-check Esri's life cycle page**

```bash
mkdir -p /tmp/docs-arcgis-versions/esri-lc && cd /tmp/docs-arcgis-versions/esri-lc
curl -sSL -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36" \
  -o page.html https://support.esri.com/en-us/products/arcgis-enterprise/life-cycle
python3 -I -c '
import re, html, sys
s = open(sys.argv[1], encoding="utf-8").read()
s = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", s, flags=re.S)
lines = [l.strip() for l in html.unescape(re.sub(r"<[^>]+>", "\n", s)).split("\n") if l.strip()]
print("\n".join(lines))
for m in re.finditer(r"(\d+\.\d+(?:\.\d+)?) on Windows and Linux is a(.{0,400}?)support release", s, re.S):
    print(m.group(1), re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m.group(2))).strip())
' page.html | sed -n '30,180p'
```

Expected: for each version, a release date, then date ranges for General Availability, Extended Support and (for long-term support releases) Mature Support, then a retirement date. The last lines map each version to "long-term" or "short-term". 12.1 has no label line; its dates ("Next LTS Release + 3 Years") follow the long-term pattern, and Esri's 12.1 announcement calls it long-term support.

Compare with the table in Step 2. For each version, the phase is the range that contains the "as of" date. If anything differs, use Esri's value and note the difference for the PR description.

- [ ] **Step 2: Insert the Compatibility section**

In `README.md`, insert this between the last "Features" bullet ("Preview map images when hovering over service links.") and `## Install`:

```markdown
## Compatibility

Services Directory Toolkit supports every ArcGIS Enterprise and ArcGIS Server version that Esri hasn't retired, and ArcGIS Online. Esri's [life cycle for ArcGIS Enterprise on Windows and Linux](https://support.esri.com/en-us/products/arcgis-enterprise/life-cycle) decides which versions count:

- Versions in General Availability, Extended Support or Mature Support are supported.
- Retired versions aren't.
- A version stops being supported on the date Esri retires it.

On 13 October 2026 the supported versions are:

| Version | Esri phase | Esri retires it |
|---|---|---|
| 12.1 (current release, long-term support) | General Availability | not yet set |
| 12.0 | Extended Support | 1 December 2026 |
| 11.5 (long-term support) | General Availability | 1 June 2031 |
| 11.4 | Extended Support | 1 December 2027 |
| 11.3 (long-term support) | Extended Support | 1 June 2030 |
| 11.2 | Extended Support | 1 December 2026 |
| 11.1 (long-term support) | Extended Support | 1 May 2029 |
| 10.9.1 (long-term support) | Mature Support | 1 December 2027 |

Esri has retired 11.0, 10.9, 10.8.1 and every earlier version. ArcGIS Online has no version to track, because Esri updates it for everyone at once. The list leaves out ArcGIS Enterprise on Kubernetes, which has its own life cycle.

Unsupported means the extension may still work on a retired version, but a bug that happens only there won't be fixed.

The extension needs Chrome 120 or later, or another Chromium browser such as Microsoft Edge.
```

Replace the first sentence of "Install":

```markdown
Services Directory Toolkit runs in Chrome 120 or later and other Chromium browsers. To run it from source:
```

with:

```markdown
To run Services Directory Toolkit from source:
```

The browser requirement then appears once, in Compatibility.

- [ ] **Step 3: Run the writing-style self-check on the new prose**

```bash
git diff -U0 README.md | grep '^+' | grep -n -E '[—–]|is not [^.,;]{3,40}, it is|\brather than\b|\binstead of\b|, so \b|\bThis is the [a-z]|\bworth [a-z]+ing\b|\b(simply|just) [a-z]|\b(honestly|genuinely|frankly)\b|\bdifferently\b|[“”‘’]'
```

Expected: no output. Judge any hit against anthropic-skills:my-writing-style, then run its five reading passes on the section.

- [ ] **Step 4: Render the README as GitHub does and check the table and link**

```bash
gh api markdown -f mode=gfm -f context=ggfevans/Services-Directory-Toolkit -F text=@README.md > /tmp/docs-arcgis-versions/readme.html
node -e '
const html = require("fs").readFileSync("/tmp/docs-arcgis-versions/readme.html", "utf8");
const section = html.slice(html.indexOf(">Compatibility<"), html.indexOf(">Install<"));
const rows = (section.match(/<tr>/g) || []).length;
const checks = {
  "heading present": html.includes(">Compatibility<"),
  "one table with a header and 8 rows": (section.match(/<table[ >]/g) || []).length === 1 && rows === 9,
  "life cycle link": section.includes("href=\"https://support.esri.com/en-us/products/arcgis-enterprise/life-cycle\""),
  "as-of date": section.includes("13 October 2026"),
  "ArcGIS Online": section.includes("ArcGIS Online"),
  "Windows and Linux, not Kubernetes": section.includes("on Windows and Linux") && section.includes("Kubernetes"),
  "Chrome 120": section.includes("Chrome 120 or later"),
  "browser requirement said once": (html.match(/Chrome 120 or later/g) || []).length === 1
};
for (const [name, ok] of Object.entries(checks)) console.log(ok ? "ok  " : "FAIL", name);
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
'
```

Expected: eight `ok` lines and exit code 0.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "Document the supported ArcGIS versions and browsers" -m "Add a Compatibility section that follows Esri's ArcGIS Enterprise life cycle, with the supported versions as of 13 October 2026, ArcGIS Online, and the Chrome requirement. Part of #9.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Bug report issue form

**Files:**
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`

**Interfaces:**
- Consumes: the README anchor `#compatibility` from Task 1.
- Produces: an issue form with the field ids `what-happened`, `steps`, `extension-version`, `chrome-version`, `arcgis-version`, `page-kind` and `page-url`.

- [ ] **Step 1: Check that validation catches a broken form**

```bash
mkdir -p /tmp/docs-arcgis-versions/ifcheck
printf 'name: x\nbody:\n  - type: dropdown\n    attributes:\n      label: A\n' > /tmp/docs-arcgis-versions/ifcheck/bad.yml
uvx check-jsonschema@0.38.2 --builtin-schema vendor.github-issue-forms /tmp/docs-arcgis-versions/ifcheck/bad.yml; echo "exit $?"
```

Expected: `'options' is a required property`, `'description' is a required property`, and `exit 1`. This proves the schema check fails on a bad form before you rely on it passing on a good one.

- [ ] **Step 2: Create the form**

Create `.github/ISSUE_TEMPLATE/bug_report.yml`:

```yaml
name: Bug report
description: Report something in the extension that doesn't work.
labels: ["bug"]
body:
  - type: markdown
    attributes:
      value: |
        **Security vulnerabilities:** don't report them here, because issues are public. Follow [SECURITY.md](https://github.com/ggfevans/Services-Directory-Toolkit/blob/main/SECURITY.md) to report one privately.

        Check that your ArcGIS version is in the [supported versions](https://github.com/ggfevans/Services-Directory-Toolkit#compatibility). A bug that happens only on a retired version won't be fixed.
  - type: textarea
    id: what-happened
    attributes:
      label: What happened
      description: What you did, what you expected, and what happened instead. Include any error the page showed, or that `chrome://extensions` lists under the extension's Errors button.
    validations:
      required: true
  - type: textarea
    id: steps
    attributes:
      label: Steps to reproduce
      placeholder: |
        1. Open a map service page, such as `.../rest/services/Example/MapServer`.
        2. Wait for the layer details to load.
        3. One layer shows no "Number of features".
  - type: input
    id: extension-version
    attributes:
      label: Extension version
      description: Shown on the extension's card at `chrome://extensions`.
      placeholder: 2.0.0
    validations:
      required: true
  - type: input
    id: chrome-version
    attributes:
      label: Chrome version
      description: Shown at `chrome://version`. If you use another Chromium browser, such as Edge, give its name and version.
      placeholder: "154.0.0.0"
    validations:
      required: true
  - type: input
    id: arcgis-version
    attributes:
      label: ArcGIS version
      description: Shown as "Current Version" on the Services Directory root page, the page at `.../rest/services`. For services hosted in ArcGIS Online, enter "ArcGIS Online".
      placeholder: "11.5"
    validations:
      required: true
  - type: dropdown
    id: page-kind
    attributes:
      label: Where it happens
      description: The kind of Services Directory page, or the part of the extension, where you see the bug.
      options:
        - Root
        - Folder
        - Service
        - Layer
        - Query
        - Find
        - Print or geoprocessing task
        - Toolbar popup
        - Options page
        - Other
    validations:
      required: true
  - type: input
    id: page-url
    attributes:
      label: Page URL
      description: Optional. Leave it out if the server isn't public.
```

The version placeholders are quoted so YAML keeps them as strings: an unquoted `11.5` is a number.

- [ ] **Step 3: Validate the form**

Schema check:

```bash
uvx check-jsonschema@0.38.2 --builtin-schema vendor.github-issue-forms .github/ISSUE_TEMPLATE/bug_report.yml; echo "exit $?"
```

Expected: `ok -- validation done` and `exit 0`.

Content check, which also catches what the schema allows but GitHub rejects or the issue forbids (duplicate ids, relative links, a wrong list of page kinds):

```bash
uvx --with pyyaml==6.0.2 python -I -c '
import re, sys, yaml
form = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
body = form["body"]
fields = {b["id"]: b for b in body if "id" in b}
intro = body[0]["attributes"]["value"]
links = re.findall(r"\]\(([^)]+)\)", intro)
checks = {
  "first element is the security notice": body[0]["type"] == "markdown" and "SECURITY.md" in intro and intro.index("SECURITY.md") < intro.index("supported versions"),
  "every link is absolute": links and all(l.startswith("https://") for l in links),
  "ids are unique": len(fields) == len([b for b in body if "id" in b]),
  "labels are unique": len({b["attributes"]["label"] for b in body if "label" in b["attributes"]}) == len([b for b in body if "label" in b["attributes"]]),
  "version fields are required": all(fields[i]["validations"]["required"] for i in ("extension-version", "chrome-version", "arcgis-version")),
  "ArcGIS version names Current Version and ArcGIS Online": all(s in fields["arcgis-version"]["attributes"]["description"] for s in ("Current Version", "ArcGIS Online")),
  "page kinds match the agreed list": fields["page-kind"]["attributes"]["options"] == ["Root", "Folder", "Service", "Layer", "Query", "Find", "Print or geoprocessing task", "Toolbar popup", "Options page", "Other"],
  "placeholders are strings": all(isinstance(b["attributes"].get("placeholder", ""), str) for b in body),
  "label is bug": form["labels"] == ["bug"],
}
for name, ok in checks.items(): print("ok  " if ok else "FAIL", name)
sys.exit(0 if all(checks.values()) else 1)
' .github/ISSUE_TEMPLATE/bug_report.yml
```

Expected: nine `ok` lines and exit code 0.

- [ ] **Step 4: Run the writing-style self-check on the form's prose**

```bash
grep -n -E '[—–]|is not [^.,;]{3,40}, it is|\brather than\b|\binstead of\b|, so \b|\bworth [a-z]+ing\b|\b(simply|just) [a-z]|\b(honestly|genuinely|frankly)\b|\bdifferently\b|[“”‘’]' .github/ISSUE_TEMPLATE/bug_report.yml
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add .github/ISSUE_TEMPLATE/bug_report.yml
git commit -m "Add a bug report form that asks for the versions" -m "The form asks for the extension, Chrome and ArcGIS versions and where the bug happens, and sends vulnerability reports to SECURITY.md. Part of #9.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Verify the branch and push

**Files:** none changed.

- [ ] **Step 1: Run the project checks**

```bash
npx playwright install --no-shell chromium
npm run lint
npm test
npm run build
```

Expected: each exits 0. The docs change touches none of the linted or tested files, so a failure here is pre-existing or environmental. Report it with its output; don't fix it on this branch.

- [ ] **Step 2: Check that neither file ships**

```bash
unzip -l build/services-directory-toolkit-2.0.0.zip | grep -E 'README|ISSUE_TEMPLATE|\.github'; echo "exit $?"
```

Expected: no matches and `exit 1` (grep found nothing).

- [ ] **Step 3: Re-run the Task 1 and Task 2 checks on the final tree**

Run Task 1 Step 4 and Task 2 Step 3 again. Expected: all `ok`.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin docs-arcgis-versions
```

Don't open a PR. A separate reviewer runs first.

- [ ] **Step 5: Check GitHub's own reading of the form**

GitHub validates issue forms only when it renders them. Fetch `https://github.com/ggfevans/Services-Directory-Toolkit/blob/docs-arcgis-versions/.github/ISSUE_TEMPLATE/bug_report.yml` and check that GitHub shows the form preview and no error banner. If you can't fetch the page, say so in the report and skip this step. GitHub offers the form at `/issues/new/choose` only after it reaches `main`, so the reviewer repeats this check there after the merge.
