import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";

// Extension code builds DOM with loadElement and text nodes. HTML strings would let server data
// become markup.
const NO_HTML_STRINGS = "Build DOM nodes with loadElement and text nodes; don't write HTML strings.";

// The console reads %s, %c, %o and the like in its first argument as a format string. A URL or
// server text there would be read as one, so that argument must be a string literal.
const CONSOLE_FORMAT = "Start console calls with a string literal and pass values as later arguments.";
const CONSOLE_FORMAT_SELECTOR = "CallExpression[callee.object.name='console'][arguments.length>0]:not([arguments.0.value=type(string)])";

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
        ...globals.webextensions
      }
    },
    rules: {
      // Each selector appears twice: el.innerHTML has the name in property.name, and el["innerHTML"]
      // has it in property.value.
      "no-restricted-syntax": ["error",
        { selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]", message: NO_HTML_STRINGS },
        { selector: "AssignmentExpression[left.property.value=/^(innerHTML|outerHTML)$/]", message: NO_HTML_STRINGS },
        { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: NO_HTML_STRINGS },
        { selector: "CallExpression[callee.property.value='insertAdjacentHTML']", message: NO_HTML_STRINGS },
        { selector: "CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln)$/]", message: NO_HTML_STRINGS },
        { selector: "CallExpression[callee.object.name='document'][callee.property.value=/^(write|writeln)$/]", message: NO_HTML_STRINGS },
        { selector: CONSOLE_FORMAT_SELECTOR, message: CONSOLE_FORMAT }
      ]
    }
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
