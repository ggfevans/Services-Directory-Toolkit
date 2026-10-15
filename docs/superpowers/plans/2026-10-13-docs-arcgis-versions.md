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

- **Version data comes from Esri's page on the day you write it.** Check https://support.esri.com/en-us/products/arcgis-enterprise/life-cycle before Task 1. WebFetch gets a 403 from it, so fetch it with curl and a browser user agent into the scratch directory `/tmp/docs-arcgis-versions/`, and don't commit the response. On 13 October 2026, read by column, Esri's page differed from the issue's table on two rows: 11.4 and 11.2 are in Mature Support, not Extended Support.
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

1. **A wrong row in the version table.** A phase or retirement date that disagrees with Esri's page on the "as of" date misleads anyone choosing whether to report a bug. Task 1 Step 1 reads the fetched page by column, and Task 1 Step 4 checks every row's phase and retirement date against that reading.
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

Read the page's version table by column. Each `<td>` is one column (Version, Release Date, General Availability, Extended Support, Mature, Retirement), so an empty cell stays empty. Short-term releases have no Extended Support: they go from General Availability straight to Mature. Stripping the tags and dropping blank lines loses that empty cell and shifts their Mature range into the Extended Support column.

```bash
mkdir -p /tmp/docs-arcgis-versions/esri-lc
curl -sSL -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36" \
  -o /tmp/docs-arcgis-versions/esri-lc/page.html https://support.esri.com/en-us/products/arcgis-enterprise/life-cycle
python3 -I - /tmp/docs-arcgis-versions/esri-lc/page.html 2026-10-13 <<'EOF'
"""Reads the version table on Esri's ArcGIS Enterprise life cycle page by column.

Usage: python3 -I esri-lifecycle.py page.html YYYY-MM-DD

Each <td> is one column, so an empty cell (short-term releases have no Extended Support) stays
empty. Prints every column and the phase on the given date.
"""

import datetime
import re
import sys
from html.parser import HTMLParser

COLUMNS = [
    "Version",
    "Release Date",
    "General Availability",
    "Extended Support",
    "Mature",
    "Retirement",
]
PHASES = ["General Availability", "Extended Support", "Mature Support"]


class Rows(HTMLParser):
    """Collects every table row as a list of cells: {"text", "label"}."""

    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell, self.in_label = [], None, None, False

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = {"text": "", "label": ""}
        elif (
            tag == "label"
            and self.cell is not None
            and ("class", "version-trigger") in attrs
        ):
            self.in_label = True

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            self.row.append(self.cell)
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.rows.append(self.row)
            self.row = None
        elif tag == "label":
            self.in_label = False

    def handle_data(self, data):
        if self.cell is not None:
            self.cell["text"] += data
            if self.in_label:
                self.cell["label"] += data


def dates(text):
    """Parses every date in a cell, such as "Nov 07, 2024—Apr 30, 2026" or "June 01, 2031"."""
    found = re.findall(r"([A-Z][a-z]+) (\d{1,2}), (\d{4})", text)
    return [
        datetime.datetime.strptime(f"{m[:3]} {d} {y}", "%b %d %Y").date()
        for m, d, y in found
    ]


page, as_of = sys.argv[1], datetime.date.fromisoformat(sys.argv[2])
parser = Rows()
parser.feed(open(page, encoding="utf-8").read())
squash = lambda s: " ".join(s.split())
start = next(
    i for i, r in enumerate(parser.rows) if [squash(c["text"]) for c in r] == COLUMNS
)
print(" | ".join(COLUMNS + ["Term", f"Phase on {as_of}"]))
for row in parser.rows[start + 1 :]:
    if len(row) != len(COLUMNS):
        break
    cells = [squash(c["text"]) for c in row]
    version = squash(row[0]["label"]) or cells[0]
    term = re.search(r"(long|short)-term", cells[0])
    phase = (
        "Retired"
        if any(d <= as_of for d in dates(cells[5]))
        else "not in a dated phase"
    )
    for name, cell in zip(PHASES, cells[2:5]):
        span = dates(cell)
        if len(span) == 2 and span[0] <= as_of <= span[1]:
            phase = name
        elif len(span) == 1 and span[0] <= as_of and "Next LTS Release" in cell:
            phase = name + " (ends at the next LTS release)"
    shown = [version, cells[1]] + [c or "(empty)" for c in cells[2:]]
    print(" | ".join(shown + [term.group(0) if term else "-", phase]))
EOF
```

Pass the "as of" date as the second argument. Expected on 13 October 2026:

```
Version | Release Date | General Availability | Extended Support | Mature | Retirement | Term | Phase on 2026-10-13
12.1 | May 21, 2026 | May 21, 2026—Next LTS Release | Next LTS Release—3 Years | (empty) | Next LTS Release + 3 Years | - | General Availability (ends at the next LTS release)
12.0 | November 18, 2025 | Nov 18, 2025—May 20, 2026 | May 21, 2026—Nov 30, 2026 | (empty) | December 1, 2026 | short-term | Extended Support
11.5 | May 22, 2025 | May 22, 2025—May 31, 2027 | Jun 01, 2027—May 31, 2029 | Jun 01, 2029—May 31, 2031 | June 01, 2031 | long-term | General Availability
11.4 | November 07, 2024 | Nov 07, 2024—Apr 30, 2026 | (empty) | May 01, 2026—Nov 30, 2027 | December 01, 2027 | short-term | Mature Support
11.3 | May 23, 2024 | May 23, 2024—May 31, 2026 | Jun 01, 2026—May 31, 2028 | Jun 01, 2028—May 31, 2030 | June 01, 2030 | long-term | Extended Support
11.2 | November 09, 2023 | Nov 09, 2023—May 31, 2025 | (empty) | Jun 01, 2025—Nov 30, 2026 | December 01, 2026 | short-term | Mature Support
11.1 | April 20, 2023 | Apr 20, 2023—Apr 30, 2025 | May 01, 2025—Apr 30, 2027 | May 01, 2027—Apr 30, 2029 | May 01, 2029 | long-term | Extended Support
11.0 | July 22, 2022 | Jul 22, 2022—Jan 31, 2024 | (empty) | Feb 01, 2024—Jul 31, 2025 | August 01, 2025 | short-term | Retired
10.9.1 | November 18, 2021 | Nov 18, 2021—Nov 30, 2023 | Dec 01, 2023—Nov 30, 2025 | Dec 01, 2025—Nov 30, 2027 | December 01, 2027 | long-term | Mature Support
10.9 | May 06, 2021 | May 06, 2021—Oct 31, 2022 | (empty) | Nov 01, 2022—May 31, 2024 | June 01, 2024 | short-term | Retired
10.8.1 | July 28, 2020 | Jul 28, 2020—Jul 31, 2022 | Aug 01, 2022—Jul 31, 2024 | Aug 01, 2024—Jul 31, 2026 | August 01, 2026 | short-term | Retired
10.8 | February 20, 2020 | Feb 20, 2020—Aug 31, 2021 | (empty) | Sep 01, 2021—Feb 28, 2023 | March 01, 2023 | short-term | Retired
```

12.1 has no term on the page. Its dates ("Next LTS Release + 3 Years") follow the long-term pattern, and Esri's 12.1 announcement calls it long-term support.

Compare the last column with the table in Step 2, row by row. If anything differs, use Esri's value and note the difference for the PR description.

- [ ] **Step 2: Insert the Compatibility section**

In `README.md`, insert this between the last "Features" bullet ("Preview map images when hovering over service links.") and `## Install`:

```markdown
## Compatibility

Services Directory Toolkit supports ArcGIS Online, and every version of ArcGIS Enterprise and ArcGIS Server on Windows and Linux that Esri hasn't retired. Esri's [ArcGIS Enterprise life cycle](https://support.esri.com/en-us/products/arcgis-enterprise/life-cycle) sets the dates: a version counts while it's in General Availability, Extended Support or Mature Support, and stops counting on the date Esri retires it. ArcGIS Enterprise on Kubernetes has a separate life cycle and isn't covered.

On 13 October 2026 the supported versions are:

| Version | Esri phase | Esri retires it |
|---|---|---|
| 12.1 (current release, long-term support) | General Availability | not yet set |
| 12.0 | Extended Support | 1 December 2026 |
| 11.5 (long-term support) | General Availability | 1 June 2031 |
| 11.4 | Mature Support | 1 December 2027 |
| 11.3 (long-term support) | Extended Support | 1 June 2030 |
| 11.2 | Mature Support | 1 December 2026 |
| 11.1 (long-term support) | Extended Support | 1 May 2029 |
| 10.9.1 (long-term support), shown as 10.91 in the Services Directory | Mature Support | 1 December 2027 |

Esri has retired 11.0, 10.9, 10.8.1 and every earlier version. ArcGIS Online needs no row in the table, because Esri updates it for everyone at once.

Unsupported means the extension may still work on a retired version, but a bug that happens only there won't be fixed.

The extension needs Chrome 120 or later, or another browser based on Chromium 120 or later, such as Microsoft Edge.
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
// Version, phase and retirement date in each body row, read by column from the rendered table.
const table = [...section.matchAll(/<tr>(.*?)<\/tr>/gs)].slice(1)
  .map((row) => [...row[1].matchAll(/<td>(.*?)<\/td>/gs)].map((cell) => cell[1].trim()));
// The life cycle page on 13 October 2026, read by column with the script in Task 1 Step 1.
const ESRI = [
  ["12.1", "General Availability", "not yet set"],
  ["12.0", "Extended Support", "1 December 2026"],
  ["11.5", "General Availability", "1 June 2031"],
  ["11.4", "Mature Support", "1 December 2027"],
  ["11.3", "Extended Support", "1 June 2030"],
  ["11.2", "Mature Support", "1 December 2026"],
  ["11.1", "Extended Support", "1 May 2029"],
  ["10.9.1", "Mature Support", "1 December 2027"]
];
const checks = {
  "phase and retirement date of every row match Esri": table.length === ESRI.length
    && ESRI.every(([version, phase, retires], i) => table[i][0].startsWith(version + " ") || table[i][0] === version
      ? table[i][1] === phase && table[i][2] === retires
      : false),
  "heading present": html.includes(">Compatibility<"),
  "one table with a header and 8 rows": (section.match(/<table[ >]/g) || []).length === 1 && rows === 9,
  "life cycle link": section.includes("href=\"https://support.esri.com/en-us/products/arcgis-enterprise/life-cycle\""),
  "as-of date": section.includes("13 October 2026"),
  "ArcGIS Online": section.includes("ArcGIS Online"),
  "Windows and Linux, not Kubernetes": section.includes("on Windows and Linux") && section.includes("Kubernetes"),
  "Chrome 120": section.includes("Chrome 120 or later"),
  "other browsers need Chromium 120": section.includes("Chromium 120 or later"),
  "10.9.1 shown as 10.91": section.includes("10.91"),
  "Kubernetes is not covered": section.includes("Kubernetes") && section.includes("isn\x27t covered"),
  "no retired-version bullets": !section.includes("Retired versions aren"),
  "browser requirement said once": (html.match(/Chrome 120 or later/g) || []).length === 1
};
for (const [name, ok] of Object.entries(checks)) console.log(ok ? "ok  " : "FAIL", name);
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
'
```

Expected: thirteen `ok` lines and exit code 0.

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

        Remove any `token=` parameter from URLs before you paste them into this form.

        Check that your ArcGIS version is in the [supported versions](https://github.com/ggfevans/Services-Directory-Toolkit#compatibility). A bug that happens only on a retired version won't be fixed.
  - type: textarea
    id: what-happened
    attributes:
      label: What happened
      description: What you did, what you expected, and what happened instead. Include any error the page showed. To see the extension's own errors, turn on Developer mode at `chrome://extensions`, repeat the steps, then click Errors on the extension's card.
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
      description: Open `chrome://extensions`, click Details on Services Directory Toolkit, and copy the Version.
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
      description: If the services are on `services.arcgis.com` or another host ending in `.arcgis.com`, enter "ArcGIS Online". Otherwise copy "Current Version" from the Services Directory root page, the page at `.../rest/services`. That page shows 10.9.1 as 10.91.
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
      description: Optional. Leave it out if the server isn't public, and remove any `token=` parameter.
```

The Chrome and ArcGIS version placeholders are quoted so YAML keeps them as strings, because an unquoted `11.5` is a number. `2.0.0` has two dots, so YAML reads it as a string without quotes.

- [ ] **Step 3: Validate the form**

Schema check:

```bash
uvx check-jsonschema@0.38.2 --builtin-schema vendor.github-issue-forms .github/ISSUE_TEMPLATE/bug_report.yml; echo "exit $?"
```

Expected: `ok -- validation done` and `exit 0`.

Content check, which also catches what the schema allows but GitHub rejects or the issue forbids (duplicate ids, relative links, a wrong list of page kinds):

```bash
uvx --with pyyaml==6.0.2 python -I -c '
import re
import sys

import yaml

form = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
body = form["body"]
fields = {b["id"]: b for b in body if "id" in b}
intro = body[0]["attributes"]["value"]
links = re.findall(r"\]\(([^)]+)\)", intro)
checks = {
    "first element is the security notice": body[0]["type"] == "markdown"
    and "SECURITY.md" in intro
    and intro.index("SECURITY.md") < intro.index("supported versions"),
    "every link is absolute": links and all(l.startswith("https://") for l in links),
    "ids are unique": len(fields) == len([b for b in body if "id" in b]),
    "labels are unique": len(
        {b["attributes"]["label"] for b in body if "label" in b["attributes"]}
    )
    == len([b for b in body if "label" in b["attributes"]]),
    "version fields are required": all(
        fields[i]["validations"]["required"]
        for i in ("extension-version", "chrome-version", "arcgis-version")
    ),
    "ArcGIS version names Current Version and ArcGIS Online": all(
        s in fields["arcgis-version"]["attributes"]["description"]
        for s in ("Current Version", "ArcGIS Online")
    ),
    "page kinds match the agreed list": fields["page-kind"]["attributes"]["options"]
    == [
        "Root",
        "Folder",
        "Service",
        "Layer",
        "Query",
        "Find",
        "Print or geoprocessing task",
        "Toolbar popup",
        "Options page",
        "Other",
    ],
    "placeholders are strings": all(
        isinstance(b["attributes"].get("placeholder", ""), str) for b in body
    ),
    "label is bug": form["labels"] == ["bug"],
    "extension version says to use Details": "Details"
    in fields["extension-version"]["attributes"]["description"],
    "error hint says to turn on Developer mode first": "Developer mode"
    in fields["what-happened"]["attributes"]["description"],
    "ArcGIS version explains 10.91 and .arcgis.com": all(
        s in fields["arcgis-version"]["attributes"]["description"]
        for s in ("10.91", ".arcgis.com")
    ),
    "intro and Page URL warn about token=": "token=" in intro
    and "token=" in fields["page-url"]["attributes"]["description"],
}
for name, ok in checks.items():
    print("ok  " if ok else "FAIL", name)
sys.exit(0 if all(checks.values()) else 1)
' .github/ISSUE_TEMPLATE/bug_report.yml
```

Expected: thirteen `ok` lines and exit code 0.

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
