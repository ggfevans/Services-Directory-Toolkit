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

// Each test below provokes one violation on purpose, asserts that the fixture recorded it in the right
// list, then forgives it. If a check stops firing, the assertion fails. Forgiving is what lets the
// test pass, because the fixture fails any test that ends with a violation still recorded.
test.describe("the fixture records", () => {
  test("a request the fake server has no fixture for", async ({ page, harness }) => {
    await page.goto(`${REST_ROOT}/NoSuchService/MapServer`);
    expect(harness.unmatched).toContainEqual(`GET ${REST_ROOT}/NoSuchService/MapServer`);
    harness.forgive();
  });

  test("a request to another host", async ({ page, harness }) => {
    await page.goto(`${FAKE_ORIGIN}/other/page`);
    await page.evaluate(() => fetch("https://elsewhere.test/").catch(() => {}));
    expect(harness.offHost).toContainEqual("https://elsewhere.test/");
    harness.forgive();
  });

  test("a dialog", async ({ page, harness }) => {
    await page.goto(`${FAKE_ORIGIN}/other/page`);
    await page.evaluate(() => alert("hello"));
    expect(harness.dialogs).toContainEqual("alert: hello");
    harness.forgive();
  });

  test("an uncaught page error", async ({ page, harness }) => {
    await page.goto(`${FAKE_ORIGIN}/other/page`);
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error("page boom");
      }, 0);
    });
    await expect.poll(() => harness.errors).toContainEqual(expect.stringContaining("Uncaught: page boom"));
    harness.forgive();
  });

  test("a console error in a page", async ({ page, harness }) => {
    await page.goto(`${FAKE_ORIGIN}/other/page`);
    await page.evaluate(() => console.error("page console"));
    await expect.poll(() => harness.errors).toContainEqual(expect.stringContaining("page console"));
    harness.forgive();
  });

  test("an error thrown in the service worker", async ({ serviceWorker, harness }) => {
    await serviceWorker.evaluate(() => {
      setTimeout(() => {
        throw new Error("boom");
      }, 0);
    });
    await expect.poll(() => harness.errors).toContainEqual(expect.stringMatching(/Service worker error.*boom/));
    harness.forgive();
  });

  test("an unhandled promise rejection in the service worker", async ({ serviceWorker, harness }) => {
    await serviceWorker.evaluate(() => {
      Promise.reject(new Error("rejected"));
    });
    await expect.poll(() => harness.errors).toContainEqual(expect.stringMatching(/Service worker unhandled rejection.*rejected/));
    harness.forgive();
  });

  test("a where clause the fake server can't interpret", async ({ page, fakeServer, harness }) => {
    await page.goto(`${FAKE_ORIGIN}/other/page`);
    await page.evaluate((url) => fetch(url).then((response) => response.text()), `${REST_ROOT}/Parcels/MapServer/0/query?where=ACRES%20%3E%201&f=json`);
    expect(fakeServer.problems).toContainEqual(expect.stringMatching(/ACRES > 1/));
    harness.forgive();
  });

  test("an error in the real toolbar popup", { tag: "@cdp" }, async ({ page, popupView, clickAction, harness }) => {
    await page.goto(`${REST_ROOT}/Parcels/MapServer`);
    await clickAction(page);
    await popupView.waitForOpen();
    await popupView.page.evaluate(() => {
      const popup = chrome.extension.getViews({ type: "popup" })[0];
      popup.console.error("popup console");
      popup.alert("popup alert");
    });
    await expect.poll(() => harness.errors).toContainEqual(expect.stringContaining("[popup] popup console"));
    await expect.poll(() => harness.errors).toContainEqual(expect.stringContaining("[popup] dialog: popup alert"));
    harness.forgive();
  });

  // No forgive() here: a console error that the test declares it expects must not fail it.
  test("a console error the test expects, which does not fail it", async ({ page, harness, expectedErrors }) => {
    expectedErrors.push(/expected one/);
    await page.goto(`${FAKE_ORIGIN}/other/page`);
    await page.evaluate(() => console.error("expected one"));
    await expect.poll(() => harness.errors).toContainEqual(expect.stringContaining("expected one"));
  });
});

// The one expected failure. It proves the fixture enforces its checks at the end of a test: a violation
// that nothing forgives fails the test. The test body has no assertion on that failure itself; the
// fixture's teardown is what is under test.
test.fail("a violation left at the end still fails the test", async ({ page, harness }) => {
  await page.goto(`${FAKE_ORIGIN}/other/page`);
  await page.evaluate(() => console.error("left over"));
  await expect.poll(() => harness.errors).toContainEqual(expect.stringContaining("left over"));
});
