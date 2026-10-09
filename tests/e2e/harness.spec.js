import { test, expect, FAKE_ORIGIN, REST_ROOT } from "./fixtures.js";

test("the extension loads with no manifest errors", async ({ page, extensionId }) => {
  await page.goto("chrome://extensions");
  const info = await page.evaluate((id) => new Promise((resolve) => chrome.developerPrivate.getExtensionInfo(id, resolve)), extensionId);
  expect(info.state).toBe("ENABLED");
  expect(info.manifestErrors).toEqual([]);
});

test("content scripts run on a Services Directory page served by the fake server", async ({ page }) => {
  await page.goto(REST_ROOT);
  await expect(page.locator("img.status-icon")).toBeAttached();
});

// Each test below breaks one of the fixture's rules on purpose, so each is expected to fail. If one
// of them starts passing, the fixture has stopped catching that kind of problem.
test.describe("the fixture fails a test that", () => {
  test.fail("requests a URL the fake server has no fixture for", async ({ page }) => {
    await page.goto(`${REST_ROOT}/NoSuchService/MapServer`);
  });

  test.fail("requests another host", async ({ page }) => {
    await page.goto(`${FAKE_ORIGIN}/other/page`);
    await page.evaluate(() => fetch("https://elsewhere.test/").catch(() => {}));
  });

  test.fail("opens a dialog", async ({ page }) => {
    await page.goto(`${FAKE_ORIGIN}/other/page`);
    await page.evaluate(() => alert("hello"));
  });

  test.fail("throws in the service worker", async ({ serviceWorker }) => {
    await serviceWorker.evaluate(() => {
      setTimeout(() => {
        throw new Error("boom");
      }, 0);
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  test.fail("has an unhandled promise rejection in the service worker", async ({ serviceWorker }) => {
    await serviceWorker.evaluate(() => {
      Promise.reject(new Error("rejected"));
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
  });
});
