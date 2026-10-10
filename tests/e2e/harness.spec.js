import { test, expect, FAKE_ORIGIN, html, REST_ROOT } from "./fixtures.js";

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
    // Each call reaches one relay hook. The error event and the rejection are created in the popup's own
    // realm, so they fire the popup's listeners. A helper-realm timer that throws would report to the
    // helper page instead and bypass the popup.
    await popupView.page.evaluate(() => {
      const popup = chrome.extension.getViews({ type: "popup" })[0];
      popup.console.error("popup console");
      popup.alert("popup alert");
      popup.confirm("popup confirm");
      popup.prompt("popup prompt");
      popup.dispatchEvent(new popup.ErrorEvent("error", { message: "popup error event" }));
      popup.Promise.reject(new popup.Error("popup rejection"));
    });
    for (const expected of [
      "[popup] popup console",
      "[popup] dialog: popup alert",
      "[popup] dialog: popup confirm",
      "[popup] dialog: popup prompt",
      "[popup] Uncaught: popup error event",
      "[popup] Unhandled rejection: Error: popup rejection"
    ]) {
      await expect.poll(() => harness.errors, { message: `popup relay: ${expected}` }).toContainEqual(expect.stringContaining(expected));
    }
    harness.forgive();
  });

  test("an override that returned no status", async ({ page, fakeServer, harness }) => {
    fakeServer.override(/^\/no-status$/, () => ({ body: "no status here" }));
    await page.goto(`${FAKE_ORIGIN}/no-status`);
    expect(fakeServer.problems).toEqual(["override for /no-status returned no status"]);
    expect(await page.locator("body").innerText()).toBe("The override returned no status");
    harness.forgive();
  });

  test("an override that never matched a request", async ({ page, fakeServer, harness }) => {
    fakeServer.override(/^\/never-requested$/, () => html("unused"));
    fakeServer.override(/^\/requested$/, () => html("used"));
    await page.goto(`${FAKE_ORIGIN}/requested`);
    expect(fakeServer.unusedOverrides()).toEqual(["/^\\/never-requested$/"]);
    harness.forgive();
    expect(fakeServer.unusedOverrides()).toEqual([]);
  });

  // No forgive() here: a console error that the test declares it expects must not fail it.
  test("a console error the test expects, which does not fail it", async ({ page, harness, expectedErrors }) => {
    expectedErrors.push(/expected one/);
    await page.goto(`${FAKE_ORIGIN}/other/page`);
    await page.evaluate(() => console.error("expected one"));
    await expect.poll(() => harness.errors).toContainEqual(expect.stringContaining("expected one"));
  });
});

// Slow and hanging answers. They are normal tests: the fixture has to wait for the delayed route, and to
// close cleanly with a route that never completes.
test.describe("an override may answer late", () => {
  test("a delayed response is served after the delay", async ({ page, fakeServer, expectedErrors }) => {
    expectedErrors.push(/status of 502/);
    fakeServer.override(/^\/slow$/, async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { ...html("<html><body>Bad Gateway</body></html>"), status: 502 };
    });
    await page.goto(`${FAKE_ORIGIN}/other/page`);
    const { status, elapsed } = await page.evaluate(async (url) => {
      const started = performance.now();
      const response = await fetch(url);
      return { status: response.status, elapsed: performance.now() - started };
    }, `${FAKE_ORIGIN}/slow`);
    expect(status).toBe(502);
    expect(elapsed).toBeGreaterThanOrEqual(250);
  });

  test("a hanging response can be aborted by the caller", async ({ page, fakeServer }) => {
    fakeServer.override(/^\/hang$/, () => new Promise(() => {}));
    await page.goto(`${FAKE_ORIGIN}/other/page`);
    const outcome = await page.evaluate(async (url) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 200);
      try {
        await fetch(url, { signal: controller.signal });
        return "resolved";
      } catch (error) {
        return error.name;
      }
    }, `${FAKE_ORIGIN}/hang`);
    expect(outcome).toBe("AbortError");
  });
});

// Each test below leaves one violation unforgiven and is expected to fail. It proves that the fixture
// enforces that list at the end of a test. The test bodies assert nothing about the failure itself: the
// fixture's teardown is what is under test. Each body first asserts that the violation was recorded, so
// a hook that stops recording fails the body, not just the teardown. It then clears every other list
// the violation also fills, such as the browser's console error for a blocked request, so that only
// the list under test can fail the test.
test.describe("a violation left at the end still fails the test", () => {
  test.fail("a leftover console error", async ({ page, harness }) => {
    await page.goto(`${FAKE_ORIGIN}/other/page`);
    await page.evaluate(() => console.error("left over"));
    await expect.poll(() => harness.errors).toContainEqual(expect.stringContaining("left over"));
  });

  test.fail("a leftover request to another host", async ({ page, harness }) => {
    await page.goto(`${FAKE_ORIGIN}/other/page`);
    await page.evaluate(() => fetch("https://elsewhere.test/").catch(() => {}));
    expect(harness.offHost).toContainEqual("https://elsewhere.test/");
    harness.errors.length = 0;
  });

  test.fail("a leftover request the fake server has no fixture for", async ({ page, harness }) => {
    await page.goto(`${REST_ROOT}/NoSuchService/MapServer`);
    expect(harness.unmatched).toContainEqual(`GET ${REST_ROOT}/NoSuchService/MapServer`);
    harness.errors.length = 0;
  });

  test.fail("a leftover problem the fake server recorded", async ({ page, fakeServer, harness }) => {
    await page.goto(`${FAKE_ORIGIN}/other/page`);
    await page.evaluate((url) => fetch(url).then((response) => response.text()), `${REST_ROOT}/Parcels/MapServer/0/query?where=ACRES%20%3E%201&f=json`);
    expect(fakeServer.problems).toContainEqual(expect.stringMatching(/ACRES > 1/));
    harness.errors.length = 0;
  });

  test.fail("a leftover dialog", async ({ page, harness }) => {
    await page.goto(`${FAKE_ORIGIN}/other/page`);
    await page.evaluate(() => alert("left over"));
    expect(harness.dialogs).toContainEqual("alert: left over");
    harness.errors.length = 0;
  });

  test.fail("a leftover override that never matched", async ({ fakeServer }) => {
    fakeServer.override(/^\/never-requested$/, () => html("unused"));
    expect(fakeServer.unusedOverrides()).toEqual(["/^\\/never-requested$/"]);
  });
});
