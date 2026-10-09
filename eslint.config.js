import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";

// Extension code builds DOM with loadElement and text nodes. HTML strings would let server data
// become markup.
const NO_HTML_STRINGS = "Build DOM nodes with loadElement and text nodes; don't write HTML strings.";

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
      "no-restricted-syntax": ["error",
        { selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]", message: NO_HTML_STRINGS },
        { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: NO_HTML_STRINGS },
        { selector: "CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln)$/]", message: NO_HTML_STRINGS }
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
