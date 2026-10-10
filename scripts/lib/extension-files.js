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

const globToRegExp = (glob) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);

/**
 * Finds the files an extension uses:
 * - everything the manifest names
 * - everything its HTML pages load
 * - every path passed to chrome.runtime.getURL as a string literal
 * - the _locales folder, if default_locale is set
 *
 * Returns { files, problems }. Both use paths relative to extDir. problems lists missing files,
 * files nothing references, and getURL calls that can't be checked.
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
  if (manifest.background?.service_worker) {
    add(manifest.background.service_worker, "background.service_worker");
  }
  for (const script of manifest.content_scripts || []) {
    [...(script.js || []), ...(script.css || [])].forEach((path) => add(path, "content_scripts"));
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
  }

  for (const entry of manifest.web_accessible_resources || []) {
    for (const glob of entry.resources) {
      const matches = existing.filter((file) => globToRegExp(glob).test(file));
      if (!matches.length) {
        problems.push(`web_accessible_resources pattern ${glob} matches no files`);
      }
      matches.forEach((file) => files.add(file));
    }
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
