import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";

// Extension code builds DOM with loadElement and text nodes. HTML strings would let server data
// become markup.
const NO_HTML_STRINGS = "Build DOM nodes with loadElement and text nodes; don't write HTML strings.";

// The console reads %s, %c, %o and the like in its first argument as a format string. A URL or
// server text there would be read as one, so that argument must be a string literal.
const CONSOLE_FORMAT = "Start console calls with a string literal and pass values as later arguments.";
// Covers console.log(...) and window.console.log(...) (or self., globalThis.).
const CONSOLE_FORMAT_SELECTOR = "CallExpression:matches([callee.object.name='console'], [callee.object.property.name='console'])[arguments.length>0]:not([arguments.0.value=type(string)])";

// The rules for all code under src/. Each HTML selector appears twice: el.innerHTML has the name in
// property.name, and el["innerHTML"] has it in property.value.
const BASE_SELECTORS = [
  { selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]", message: NO_HTML_STRINGS },
  { selector: "AssignmentExpression[left.property.value=/^(innerHTML|outerHTML)$/]", message: NO_HTML_STRINGS },
  { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: NO_HTML_STRINGS },
  { selector: "CallExpression[callee.property.value='insertAdjacentHTML']", message: NO_HTML_STRINGS },
  { selector: "CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln)$/]", message: NO_HTML_STRINGS },
  { selector: "CallExpression[callee.object.name='document'][callee.property.value=/^(write|writeln)$/]", message: NO_HTML_STRINGS },
  { selector: CONSOLE_FORMAT_SELECTOR, message: CONSOLE_FORMAT }
];

// All of an extension's content scripts in a frame share one isolated world, and so do a page's
// scripts. One bare block per file keeps each file's const names private.
const ONE_BLOCK = "Wrap the whole file in one bare { } block: scripts that share a world would see each other's top-level names.";
const BLOCK_SELECTORS = [{ selector: "Program > :not(BlockStatement)", message: ONE_BLOCK }];

// A content script outlives its extension after an update (see src/src/lib/guard.js).
const GUARDED = "Content scripts can outlive their extension. Use SDT.guard.listen, SDT.guard.wrap or SDT.guard.onLoad.";
const GUARD_SELECTORS = [
  { selector: "CallExpression[callee.property.name='addEventListener']", message: GUARDED },
  {
    selector: "CallExpression:matches([callee.name=/^set(Timeout|Interval)$/], [callee.property.name=/^set(Timeout|Interval)$/]):not([arguments.0.callee.object.object.name='SDT'][arguments.0.callee.object.property.name='guard'][arguments.0.callee.property.name='wrap'])",
    message: GUARDED
  },
  {
    selector: "CallExpression:matches([callee.object.object.name='chrome'], [callee.object.object.object.name='chrome']) > :matches(ArrowFunctionExpression, FunctionExpression)",
    message: GUARDED
  }
];

// Lib files are classic scripts that may run twice in one world (store-readiness spec, section 5).
const LIB_FILE = "Lib files may run twice. Add to the SDT namespace instead of declaring top-level names.";
const LIB_SELECTORS = [{ selector: "Program > :matches(VariableDeclaration, FunctionDeclaration, ClassDeclaration)", message: LIB_FILE }];

export default [
  {
    ignores: ["build/", "dist/", "node_modules/", "test-results/", "playwright-report/", "blob-report/"]
  },
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        // The shared namespace from src/src/lib/ (store-readiness spec, section 5).
        SDT: "readonly"
      }
    },
    rules: {
      "no-restricted-syntax": ["error", ...BASE_SELECTORS]
    }
  },
  // A later entry replaces the rule's whole option list for the files it matches, so each of these
  // repeats BASE_SELECTORS.
  {
    files: ["src/src/inject/**/*.js"],
    rules: { "no-restricted-syntax": ["error", ...BASE_SELECTORS, ...BLOCK_SELECTORS, ...GUARD_SELECTORS] }
  },
  {
    files: ["src/src/page_action/**/*.js"],
    rules: { "no-restricted-syntax": ["error", ...BASE_SELECTORS, ...BLOCK_SELECTORS] }
  },
  {
    files: ["src/src/lib/**/*.js"],
    rules: { "no-restricted-syntax": ["error", ...BASE_SELECTORS, ...LIB_SELECTORS] }
  },
  {
    files: ["*.js", "scripts/**/*.js", "tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node
    }
  },
  {
    // Node scripts whose page.evaluate callbacks run in the browser or an extension page.
    files: ["tests/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions
      }
    },
    rules: {
      // Playwright fixtures that need no other fixture take an empty object pattern.
      "no-empty-pattern": ["error", { allowObjectPatternsAsParameters: true }]
    }
  },
  {
    plugins: {
      "@stylistic": stylistic
    },
    rules: {
      "@stylistic/indent": ["error", 2],
      "@stylistic/quotes": ["warn", "double"],
      "@stylistic/semi": ["error", "always"]
    }
  }
];
