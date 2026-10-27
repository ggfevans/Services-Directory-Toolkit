import { test, expect, FAKE_ORIGIN, html, ONLINE_REST_ROOT, ONLINE_TOKENS, PORTAL_ORIGIN, REST_ROOT, toolkitStarted } from "./fixtures.js";

test("the extension loads with no manifest errors", async ({ page, extensionId }) => {
  await page.goto("chrome://extensions");
  // Chrome records manifest warnings, such as an unrecognised key, only in Developer mode, so turn it
  // on and reload the extension first. Unknown keys inside a known key, such as action, aren't reported.
  await page.evaluate(() => new Promise((resolve) => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, resolve)));
  await page.evaluate((id) => new Promise((resolve) => chrome.developerPrivate.reload(id, { failQuietly: true }, resolve)), extensionId);
  await expect.poll(() => page.evaluate((id) => new Promise((resolve) => chrome.developerPrivate.getExtensionInfo(id, resolve)), extensionId)
    .then((info) => info.state)).toBe("ENABLED");
  const info = await page.evaluate((id) => new Promise((resolve) => chrome.developerPrivate.getExtensionInfo(id, resolve)), extensionId);
  expect(info.manifestErrors.map((error) => error.message)).toEqual([]);
  expect(info.installWarnings).toEqual([]);
});

test("content scripts run on a Services Directory page served by the fake server", async ({ page }) => {
  await page.goto(REST_ROOT);
  await expect(page.locator(".sdt-statusbar")).toBeAttached();
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

  test("an error in the real toolbar popup", { tag: "@cdp" }, async ({ page, actionEnabled, popupView, clickAction, harness }) => {
    await page.goto(`${REST_ROOT}/Parcels/MapServer`);
    // The button starts disabled, so wait for status.js to enable it before clicking.
    await expect.poll(() => actionEnabled(page)).toBe(true);
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

test.describe("signing in", () => {
  test("signIn sets an HttpOnly agstoken cookie that reaches the fake server", async ({ page, signIn }) => {
    await signIn("jsmith");
    await page.goto(REST_ROOT);
    expect(await page.evaluate(() => document.cookie)).not.toContain("agstoken");
    const self = await page.evaluate(() => fetch("/arcgis/rest/self?f=json").then((response) => response.json()));
    expect(self.user.username).toBe("jsmith");
  });

  test("a request with credentials omitted runs anonymously", async ({ page, signIn }) => {
    await signIn("jsmith");
    await page.goto(REST_ROOT);
    const self = await page.evaluate(() => fetch("/arcgis/rest/self?f=json", { credentials: "omit" }).then((response) => response.json()));
    expect(self).toEqual({ user: {} });
  });

  test("the cookie goes only to paths in its own case", async ({ page, signIn, fakeServer }) => {
    await signIn("jsmith");
    await page.goto(REST_ROOT);
    await page.evaluate(() => fetch("/ArcGIS/rest/self?f=json").then((response) => response.json()));
    expect(fakeServer.calls.find((call) => call.path === "/ArcGIS/rest/self").cookies).toEqual({});
  });
});

test.describe("the ArcGIS Online stand-ins", () => {
  test("a hosted service page loads and runs the content scripts", async ({ page }) => {
    await page.goto(`${ONLINE_REST_ROOT}/Parcels/FeatureServer`);
    await expect(toolkitStarted(page)).toBeAttached();
  });

  test("community/self answers a page on another origin", async ({ page }) => {
    await page.goto(`${ONLINE_REST_ROOT}/Parcels/FeatureServer`);
    const self = await page.evaluate(([url, token]) => fetch(url, { method: "POST", body: new URLSearchParams({ f: "json", token }) })
      .then((response) => response.json()), [`${PORTAL_ORIGIN}/sharing/rest/community/self`, ONLINE_TOKENS.jsmith]);
    expect(self.username).toBe("jsmith");
  });
});

test.describe("a redirect to another host", () => {
  const redirectAway = () => ({ status: 307, headers: { location: "https://elsewhere.test/landing" }, body: "" });

  test("is recorded as an off-host request when followed", async ({ page, fakeServer, harness }) => {
    fakeServer.override(/^\/arcgis\/rest\/moved$/, redirectAway);
    await page.goto(`${FAKE_ORIGIN}/other/page`);
    await page.evaluate(() => fetch("/arcgis/rest/moved").catch(() => {}));
    expect(harness.offHost).toContainEqual("https://elsewhere.test/landing");
    harness.forgive();
  });

  test("can't reach a real host, because the harness resolves no host names", async ({ page, fakeServer, harness }) => {
    fakeServer.override(/^\/arcgis\/rest\/moved$/, () => ({ status: 307, headers: { location: "https://example.com/landing" }, body: "" }));
    await page.goto(`${FAKE_ORIGIN}/other/page`);
    await page.evaluate(() => fetch("/arcgis/rest/moved").catch(() => {}));
    expect(harness.offHost).toContainEqual("https://example.com/landing");
    // Behind a proxy, Chromium hands the request to the proxy instead. A proxy named by host doesn't
    // resolve either, and one named by IP address refuses the tunnel.
    await expect.poll(() => harness.errors).toContainEqual(
      expect.stringMatching(/ERR_(NAME_NOT_RESOLVED|PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED) \[https:\/\/example\.com\/landing\]/)
    );
    harness.forgive();
  });

  test("on a fake origin is recorded as not routed, because Playwright doesn't route redirect targets", async ({ page, fakeServer, harness }) => {
    fakeServer.override(/^\/arcgis\/rest\/moved$/, () => ({ status: 302, headers: { location: `${FAKE_ORIGIN}/other/page` }, body: "" }));
    await page.goto(`${FAKE_ORIGIN}/other/page`);
    await page.evaluate(() => fetch("/arcgis/rest/moved").catch(() => {}));
    expect(harness.unmatched).toContainEqual(`not routed (redirect target): GET ${FAKE_ORIGIN}/other/page`);
    harness.forgive();
  });

  test("sends nothing there when the request uses redirect: manual", async ({ page, fakeServer }) => {
    fakeServer.override(/^\/arcgis\/rest\/moved$/, redirectAway);
    await page.goto(`${FAKE_ORIGIN}/other/page`);
    const type = await page.evaluate(() => fetch("/arcgis/rest/moved", { redirect: "manual" }).then((response) => response.type));
    expect(type).toBe("opaqueredirect");
  });
});

test.describe("openPopupTab", () => {
  test("given a page, reports that page's real tab id", async ({ page, openPopupTab }) => {
    await page.goto(REST_ROOT);
    const popup = await openPopupTab(page);
    const result = await popup.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const real = await chrome.tabs.get(tab.id);
      const own = await chrome.tabs.getCurrent();
      return { exists: real.id === tab.id, isOwnTab: tab.id === own.id, url: tab.url };
    });
    expect(result).toEqual({ exists: true, isOwnTab: false, url: REST_ROOT });
  });

  test("given a URL, reports no tab", async ({ openPopupTab }) => {
    const popup = await openPopupTab(REST_ROOT);
    const id = await popup.evaluate(async () => (await chrome.tabs.query({}))[0].id);
    expect(id).toBe(-1);
  });
});
