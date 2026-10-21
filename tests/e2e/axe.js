// Runs axe-core on a page in the light and the dark colour scheme (store-readiness spec, section 4.2).
// On host pages, scope it to the extension's own elements: the page's markup isn't ours to fix. Issue
// #13 extends this helper with a dark host page.
import AxeBuilder from "@axe-core/playwright";

export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
export const COLOR_SCHEMES = ["light", "dark"];

/**
 * Returns { light: [...], dark: [...] }, each a list of "rule: target, target" strings, empty when
 * axe finds nothing. include is a CSS selector for the elements to check, or omitted for the whole
 * page. axe fails when include matches nothing, so a renamed element can't pass by being missed.
 */
export const axeViolations = async (page, { include } = {}) => {
  const results = {};
  for (const colorScheme of COLOR_SCHEMES) {
    await page.emulateMedia({ colorScheme });
    const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
    if (include) {
      builder.include(include);
    }
    const { violations } = await builder.analyze();
    results[colorScheme] = violations.map(({ id, nodes }) => `${id}: ${nodes.map((node) => node.target.join(" ")).join(", ")}`);
  }
  return results;
};
