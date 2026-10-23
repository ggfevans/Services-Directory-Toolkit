// Runs axe-core on a page in the light and the dark colour scheme (store-readiness spec, section 4.2).
// On host pages, scope it to the extension's own elements: the page's markup isn't ours to fix.
import AxeBuilder from "@axe-core/playwright";

export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
export const COLOR_SCHEMES = ["light", "dark"];

// The class that turns the fake server's light page dark (HOST_STYLES in tests/fixtures/fake-arcgis.js).
const DARK_BODY = "dark";

/**
 * Puts a host page in a colour scheme: the system's, and the page's own background, which is what
 * the extension's palette follows (SDT.theme). Waits until the theme check has caught up.
 */
const setHostScheme = async (page, colorScheme) => {
  await page.emulateMedia({ colorScheme });
  await page.evaluate(({ name, on }) => document.body.classList.toggle(name, on), { name: DARK_BODY, on: colorScheme === "dark" });
  await page.waitForFunction((theme) => document.documentElement.getAttribute("data-sdt-theme") === theme, colorScheme);
};

/**
 * Returns { light: [...], dark: [...] }, each a list of "rule: target, target" strings, empty when
 * axe finds nothing. include is a CSS selector for the elements to check, or omitted for the whole
 * page. axe fails when include matches nothing, so a renamed element can't pass by being missed.
 *
 * On an extension page the two runs differ only in prefers-color-scheme. On a host page, pass
 * hostPage: true. The dark run then also turns the page itself dark, as the fake server's dark style
 * does, and waits for the extension to switch to its dark palette; afterwards the page is light again.
 * hostPage needs the default light host style, not test.use({ hostStyle: "dark" }).
 */
export const axeViolations = async (page, { include, hostPage = false } = {}) => {
  const results = {};
  for (const colorScheme of COLOR_SCHEMES) {
    if (hostPage) {
      await setHostScheme(page, colorScheme);
    } else {
      await page.emulateMedia({ colorScheme });
    }
    const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
    if (include) {
      builder.include(include);
    }
    const { violations } = await builder.analyze();
    results[colorScheme] = violations.map(({ id, nodes }) => `${id}: ${nodes.map((node) => node.target.join(" ")).join(", ")}`);
  }
  if (hostPage) {
    await setHostScheme(page, "light");
  }
  return results;
};
