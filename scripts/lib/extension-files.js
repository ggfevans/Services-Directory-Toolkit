// Works out which files under an extension directory the extension actually uses, so the build
// ships exactly those and fails on anything missing or unexplained.
import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";

/** Lists every file under dir as a sorted POSIX path relative to dir, skipping .DS_Store. */
export const listFiles = (dir, prefix = "") => readdirSync(join(dir, prefix), { withFileTypes: true })
  .flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      return listFiles(dir, path);
    }
    return entry.name === ".DS_Store" ? [] : [path];
  })
  .sort();

// <script src>, <link href> and <img src> in extension pages.
const HTML_REFERENCE = /<(?:script|link|img)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
const GET_URL_CALL = /chrome\.runtime\.getURL\(([^)]*)\)/g;
const STRING_LITERAL = /^\s*(["'`])([^"'`$]+)\1\s*$/;

// SDT namespaces: a lib file defines one with "SDT.dom = {" (or ??=) at the start of a line, and a
// script uses one wherever "SDT.dom" appears.
const SDT_DEFINES = /^\s*SDT\.(\w+)\s*\?{0,2}=(?!=)/gm;
const SDT_USES = /\bSDT\.(\w+)/g;
const PAGE_SCRIPT = /<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;

// importScripts(...) in a classic service worker. Each argument must be a string literal.
const IMPORT_SCRIPTS_CALL = /\bimportScripts\(([^)]*)\)/g;

/** Splits an argument list at the commas outside quotes, so a comma inside a path stays in it. */
const splitArguments = (argumentList) => {
  const parts = [""];
  let quote = null;
  for (const char of argumentList) {
    if (quote) {
      quote = char === quote ? null : quote;
    } else if (char === "\"" || char === "'" || char === "`") {
      quote = char;
    } else if (char === ",") {
      parts.push("");
      continue;
    }
    parts[parts.length - 1] += char;
  }
  return parts;
};

/**
 * The files a classic service worker loads with importScripts, in call order, as paths relative to
 * the extension root. A path resolves against the worker's own location, and a leading / against the
 * root. Adds a problem for an argument that isn't a string literal.
 */
export const importedScripts = (worker, code, problems) => {
  const files = [];
  for (const [, argumentList] of code.matchAll(IMPORT_SCRIPTS_CALL)) {
    for (const argument of splitArguments(argumentList).filter((part) => part.trim())) {
      const literal = argument.match(STRING_LITERAL);
      if (!literal) {
        problems.push(`${worker}: importScripts needs string literals, got "${argument.trim()}"`);
        continue;
      }
      const reference = literal[2];
      files.push(reference.startsWith("/")
        ? posix.normalize(reference.slice(1))
        : posix.normalize(posix.join(posix.dirname(worker), reference)));
    }
  }
  return files;
};

/**
 * Checks one load order: a content-script group's js list, or an extension page's scripts. Every SDT
 * namespace a script uses must be defined by that script or an earlier one. Returns problem strings.
 */
export const sdtLoadOrderProblems = (extDir, scripts, source) => {
  const defined = new Set();
  const problems = [];
  for (const script of scripts) {
    let code;
    try {
      code = readFileSync(join(extDir, script), "utf8");
    } catch {
      continue; // A missing file is reported elsewhere.
    }
    const own = new Set([...code.matchAll(SDT_DEFINES)].map(([, name]) => name));
    const used = new Set([...code.matchAll(SDT_USES)].map(([, name]) => name));
    for (const name of used) {
      if (!own.has(name) && !defined.has(name)) {
        problems.push(`${source}: ${script} uses SDT.${name} before a script that defines it`);
      }
    }
    own.forEach((name) => defined.add(name));
  }
  return problems;
};

/**
 * Finds the files an extension uses:
 * - everything the manifest names
 * - everything its HTML pages load
 * - every file the service worker loads with importScripts
 * - every path passed to chrome.runtime.getURL as a string literal
 * - the _locales folder, if default_locale is set
 *
 * Returns { files, problems }. Both use paths relative to extDir. problems lists missing files,
 * files nothing references, getURL and importScripts calls that can't be checked, scripts that
 * use an SDT namespace before a file that defines it, and any web_accessible_resources key.
 */
export const referencedFiles = (extDir) => {
  const manifest = JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf8"));
  const existing = listFiles(extDir);
  const files = new Set(["manifest.json"]);
  const problems = [];

  const add = (path, source) => {
    const file = posix.normalize(path.replace(/^\//, ""));
    if (!existing.includes(file)) {
      problems.push(`${source} references missing file ${file}`);
    }
    files.add(file);
  };

  Object.values(manifest.icons || {}).forEach((path) => add(path, "manifest icons"));
  const defaultIcon = manifest.action?.default_icon;
  if (typeof defaultIcon === "string") {
    add(defaultIcon, "action.default_icon");
  } else {
    Object.values(defaultIcon || {}).forEach((path) => add(path, "action.default_icon"));
  }
  const worker = manifest.background?.service_worker && posix.normalize(manifest.background.service_worker.replace(/^\//, ""));
  if (worker) {
    add(worker, "background.service_worker");
    if (existing.includes(worker)) {
      const imports = importedScripts(worker, readFileSync(join(extDir, worker), "utf8"), problems);
      imports.forEach((path) => add(path, worker));
      problems.push(...sdtLoadOrderProblems(extDir, [...imports, worker], "background.service_worker"));
    }
  }
  for (const [index, script] of (manifest.content_scripts || []).entries()) {
    [...(script.js || []), ...(script.css || [])].forEach((path) => add(path, "content_scripts"));
    problems.push(...sdtLoadOrderProblems(extDir, script.js || [], `content_scripts[${index}]`));
  }

  const pages = [manifest.options_page, manifest.options_ui?.page, manifest.action?.default_popup].filter(Boolean);
  for (const page of pages) {
    add(page, "manifest");
    if (!existing.includes(page)) {
      continue;
    }
    const html = readFileSync(join(extDir, page), "utf8");
    for (const [, reference] of html.matchAll(HTML_REFERENCE)) {
      if (!/^[a-z][a-z0-9+.-]*:/i.test(reference)) {
        add(posix.join(posix.dirname(page), reference), page);
      }
    }
    const scripts = [...html.matchAll(PAGE_SCRIPT)]
      .map(([, reference]) => reference)
      .filter((reference) => !/^[a-z][a-z0-9+.-]*:/i.test(reference))
      .map((reference) => posix.normalize(posix.join(posix.dirname(page), reference)));
    problems.push(...sdtLoadOrderProblems(extDir, scripts, page));
  }

  if (Object.hasOwn(manifest, "web_accessible_resources")) {
    problems.push("web_accessible_resources: not allowed, because any page could load these files and detect the extension (MAN-1)");
  }

  if (manifest.default_locale) {
    existing.filter((file) => file.startsWith("_locales/")).forEach((file) => files.add(file));
  }

  for (const script of [...files].filter((file) => file.endsWith(".js") && existing.includes(file))) {
    const code = readFileSync(join(extDir, script), "utf8");
    for (const [, argument] of code.matchAll(GET_URL_CALL)) {
      const literal = argument.match(STRING_LITERAL);
      if (literal) {
        add(literal[2], script);
      } else {
        problems.push(`${script}: chrome.runtime.getURL needs a string literal, got "${argument.trim()}"`);
      }
    }
  }

  for (const file of existing) {
    if (!files.has(file)) {
      problems.push(`${file}: not referenced by the manifest, an extension page or a chrome.runtime.getURL call`);
    }
  }

  return { files: [...files].sort(), problems };
};
