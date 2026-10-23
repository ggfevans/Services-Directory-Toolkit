// Playwright fixtures for testing the extension against a fake ArcGIS Server.
//
// Each test gets a fresh Chromium profile with the extension loaded. Playwright routing sees every
// request from tab pages, from extension pages opened as tabs, from content scripts and from the
// service worker. The origins in FAKE_ORIGINS are answered by tests/fixtures/fake-arcgis.js: an
// Enterprise-style server at https://arcgis.test, and two ArcGIS Online stand-ins. Every other
// http(s) host is blocked. The real toolbar popup's own requests are not routed, because it has no
// Playwright Page. They fail at DNS for a .test host and appear in no list. Test popup logic with
// openPopupTab, which opens the popup page as a tab.
//
// A test fails if any of these is left over when it ends:
// - a request to another host
// - a request the fake server has no fixture for
// - a redirect's target, which Playwright doesn't route: recorded as off-host, or as unmatched when
//   it is on a fake origin. Browser tests therefore can't follow the fake server's 302 from a secured
//   page to its login page; the unit tests cover that response.
// - a request the fake server can't interpret, or an override that returned no status
// - an override that never matched a request
// - a dialog
// - a console error or an uncaught exception
//
// A test allows a console error by adding a pattern to expectedErrors. A test that provokes any other
// violation on purpose asserts that the right list caught it, then calls harness.forgive().
//
// Two gaps remain. Errors the service worker raises while it starts, before the hooks go in, aren't
// caught. Neither are errors the real popup raises during its initial load, before popupView's
// waitForOpen() installs the relay.
import { test as base, chromium, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  arcgisError, createFakeArcGIS, FAKE_ORIGIN, FAKE_ORIGINS, html, json, ONLINE_ORIGIN, ONLINE_REST_ROOT, ONLINE_TOKENS,
  PORTAL_ORIGIN, REST_ROOT, SERVER_TOKENS
} from "../fixtures/fake-arcgis.js";

export { arcgisError, expect, FAKE_ORIGIN, html, json, ONLINE_ORIGIN, ONLINE_REST_ROOT, ONLINE_TOKENS, PORTAL_ORIGIN, REST_ROOT, SERVER_TOKENS };

const REPO = fileURLToPath(new URL("../..", import.meta.url));

// CI runs the suite against the unzipped build (EXT_PATH=dist), so it tests what ships.
export const EXTENSION_PATH = resolve(REPO, process.env.EXT_PATH || "src");

// MV3 may restart an idle service worker. The handle survives, but a call in flight fails once.
const inWorker = async (worker, fn, arg) => {
  try {
    return await worker.evaluate(fn, arg);
  } catch (error) {
    if (!/Service worker restarted/.test(error.message)) {
      throw error;
    }
    return worker.evaluate(fn, arg);
  }
};

export const test = base.extend({
  // Extra Chromium arguments, and Playwright default arguments to drop. Set with test.use().
  extraLaunchArgs: [[], { option: true }],
  droppedDefaultArgs: [[], { option: true }],

  // The fake pages' own stylesheet: "light", or "dark" for a page that is dark from the start
  // (HOST_STYLES in tests/fixtures/fake-arcgis.js). Set with test.use().
  hostStyle: ["light", { option: true }],

  fakeServer: async ({ hostStyle }, use) => {
    await use(createFakeArcGIS(undefined, undefined, { hostStyle }));
  },

  // Console errors a test expects, such as the browser's own report of an HTTP 502 it injected.
  expectedErrors: async ({}, use) => {
    await use([]);
  },

  // The violations the context fixture records, checked when the test ends. forgive() clears them,
  // the fake server's problems and its unused overrides, in place, for a test that provokes one on purpose.
  harness: async ({ fakeServer }, use) => {
    const harness = {
      offHost: [],
      unmatched: [],
      dialogs: [],
      errors: [],
      forgive() {
        for (const list of [harness.offHost, harness.unmatched, harness.dialogs, harness.errors, fakeServer.problems]) {
          list.length = 0;
        }
        fakeServer.markOverridesUsed();
      }
    };
    await use(harness);
  },

  context: async ({ extraLaunchArgs, droppedDefaultArgs, fakeServer, expectedErrors, harness }, use, testInfo) => {
    const profile = mkdtempSync(join(tmpdir(), "sdt-profile-"));
    const context = await chromium.launchPersistentContext(profile, {
      // Playwright's default headless shell can't load extensions; the full Chromium build can.
      // CHROME_PATH runs the suite in another build, such as Chrome for Testing 120.
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chromium" }),
      headless: !process.env.HEADED,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        // Lets clickAction use the CDP Extensions domain.
        "--enable-unsafe-extension-debugging",
        // Resolves no host names. Routed requests never need DNS, and a request Playwright doesn't
        // route, such as a redirect's target, then fails here and can't reach a real server.
        "--host-resolver-rules=MAP * ~NOTFOUND",
        // Playwright passes a bare --headless, which Chrome before 132 reads as the old headless
        // mode, and that mode doesn't run extensions. The last value of a switch wins.
        ...(process.env.CHROME_PATH && !process.env.HEADED ? ["--headless=new"] : []),
        ...extraLaunchArgs
      ],
      ignoreDefaultArgs: droppedDefaultArgs
    });

    context.on("console", (message) => {
      if (message.type() === "error") {
        harness.errors.push(`${message.text()} [${message.location().url}]`);
      }
    });
    context.on("weberror", (webError) => harness.errors.push(`Uncaught: ${webError.error().message}`));
    // Playwright doesn't route the target of a redirect: the browser requests it itself. Record it, so
    // a test that follows a redirect fails, even when the target is one of the fake origins.
    context.on("request", (request) => {
      if (!request.redirectedFrom()) {
        return;
      }
      if (FAKE_ORIGINS.includes(new URL(request.url()).origin)) {
        harness.unmatched.push(`not routed (redirect target): ${request.method()} ${request.url()}`);
      } else {
        harness.offHost.push(request.url());
      }
    });
    context.on("dialog", async (dialog) => {
      harness.dialogs.push(`${dialog.type()}: ${dialog.message()}`);
      await dialog.dismiss();
    });

    // http(s) only: the extension's own chrome-extension:// files must load untouched.
    await context.route(/^https?:\/\//, async (route) => {
      const request = route.request();
      if (!FAKE_ORIGINS.includes(new URL(request.url()).origin)) {
        harness.offHost.push(request.url());
        await route.abort("blockedbyclient");
        return;
      }
      // An override may answer slowly, or never. A hanging handler is harmless: closing the context
      // ends it, and the harness spec's hanging-response test keeps that true.
      // allHeaders(), not headers(): Playwright documents only allHeaders() as including the Cookie header.
      const response = await fakeServer.respond(request, await request.allHeaders());
      if (response === null) {
        harness.unmatched.push(`${request.method()} ${request.url()}`);
        await route.fulfill({ status: 404, contentType: "text/plain", body: "No fixture for this URL" });
      } else if (typeof response?.status !== "number") {
        const { pathname, search } = new URL(request.url());
        fakeServer.problems.push(`override for ${pathname}${search} returned no status`);
        await route.fulfill({ status: 500, contentType: "text/plain", body: "The override returned no status" });
      } else {
        await route.fulfill(response);
      }
    });

    await context.tracing.start({ screenshots: true, snapshots: true });

    await use(context);

    if (testInfo.status === testInfo.expectedStatus) {
      await context.tracing.stop();
    } else {
      const trace = testInfo.outputPath("trace.zip");
      await context.tracing.stop({ path: trace });
      await testInfo.attach("trace", { path: trace, contentType: "application/zip" });
    }
    await context.close();
    rmSync(profile, { recursive: true, force: true });

    const unexpectedErrors = harness.errors.filter((error) => !expectedErrors.some((pattern) => pattern.test(error)));
    expect(harness.offHost, "requests to hosts other than the fake ArcGIS Server").toEqual([]);
    expect(harness.unmatched, "requests the fake ArcGIS Server has no fixture for").toEqual([]);
    expect(fakeServer.problems, "requests the fake ArcGIS Server could not interpret").toEqual([]);
    expect(fakeServer.unusedOverrides(), "overrides that never matched a request").toEqual([]);
    expect(harness.dialogs, "dialogs").toEqual([]);
    expect(unexpectedErrors, "console errors and uncaught exceptions").toEqual([]);
  },

  // The extension's service worker. It is automatic so that every test gets the error hooks. The hooks
  // go in after the worker has started, so errors and rejections during worker startup aren't caught.
  serviceWorker: [async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    // Uncaught service-worker errors reach no Playwright event on their own. Re-log them as console
    // errors so the context fixture sees them.
    await inWorker(worker, () => {
      self.addEventListener("error", (event) => console.error(`Service worker error: ${event.message}`));
      self.addEventListener("unhandledrejection", (event) => console.error(`Service worker unhandled rejection: ${event.reason}`));
    });
    await use(worker);
  }, { auto: true }],

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },

  // Writes items to chrome.storage.sync, or to chrome.storage.local when area is "local". Call it
  // before opening the page that should read them.
  seedStorage: async ({ serviceWorker }, use) => {
    await use((items, area = "sync") => inWorker(serviceWorker, ({ values, name }) => chrome.storage[name].set(values), { values: items, name: area }));
  },

  // Reads keys (null for everything) from chrome.storage.sync, or from chrome.storage.local.
  readStorage: async ({ serviceWorker }, use) => {
    await use((keys = null, area = "sync") => inWorker(serviceWorker, ({ names, name }) => chrome.storage[name].get(names), { names: keys, name: area }));
  },

  // Opens the popup page in a normal tab, with chrome.tabs.query answering as if target were the
  // active tab. target is a Page, whose real tab id and URL the stub reports, or a URL, for which it
  // reports chrome.tabs.TAB_ID_NONE (-1). For popup logic; the real popup needs clickAction.
  openPopupTab: async ({ context, extensionId, serviceWorker }, use) => {
    await use(async (target) => {
      let tab = { id: -1, url: target };
      if (typeof target !== "string") {
        await target.bringToFront();
        const id = await inWorker(serviceWorker, async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
        tab = { id, url: target.url() };
      }
      const page = await context.newPage();
      await page.addInitScript(({ id, url }) => {
        const tabs = [{ id, index: 0, windowId: 1, active: true, url }];
        chrome.tabs.query = (queryInfo, callback) => {
          if (callback) {
            callback(tabs);
            return undefined;
          }
          return Promise.resolve(tabs);
        };
      }, tab);
      await page.goto(`chrome-extension://${extensionId}/src/page_action/page_action.html`);
      return page;
    });
  },

  // Signs the browser in to https://arcgis.test the way its login page does: an HttpOnly agstoken
  // cookie on /arcgis/rest, which page scripts can't read. Call it before opening the page.
  signIn: async ({ context }, use) => {
    await use((username = "jsmith") => context.addCookies([{
      name: "agstoken",
      value: SERVER_TOKENS[username],
      domain: "arcgis.test",
      path: "/arcgis/rest",
      httpOnly: true,
      secure: true,
      sameSite: "Lax"
    }]));
  },

  // Whether the toolbar button is enabled for the page's tab. Brings the page to the front first,
  // because the service worker finds the tab as the active tab of the last focused window.
  actionEnabled: async ({ serviceWorker }, use) => {
    await use(async (page) => {
      await page.bringToFront();
      return inWorker(serviceWorker, async () => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        return chrome.action.isEnabled(tab.id);
      });
    });
  },

  // Clicks the toolbar button on the page's tab the way a user does, which also grants activeTab.
  // chrome.action.openPopup() grants nothing, so it can't stand in for a click.
  clickAction: async ({ context, extensionId }, use) => {
    const cdp = await context.browser().newBrowserCDPSession();
    await use(async (page) => {
      await page.bringToFront();
      const { targetInfos } = await cdp.send("Target.getTargets", { filter: [{ type: "tab" }] });
      const target = targetInfos.find((info) => info.url === page.url());
      if (!target) {
        throw new Error(`No tab target for ${page.url()}`);
      }
      await cdp.send("Extensions.triggerAction", { id: extensionId, targetId: target.targetId });
    });
    await cdp.detach();
  },

  // A background extension tab that can reach the real popup through chrome.extension.getViews.
  // It opens before the toolbar click, because bringing any tab to the front closes the popup.
  //
  // Playwright exposes no Page for the real popup, so waitForOpen() relays the popup's errors, console
  // errors and dialogs to this helper page, which the context fixture watches. Errors raised during the
  // popup's initial load, before the relay is installed, aren't caught. Test popup logic with
  // openPopupTab, which is a normal page, and use this only for what needs the real toolbar popup.
  popupView: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
    const isOpen = () => page.evaluate(() => chrome.extension.getViews({ type: "popup" }).length > 0);
    await use({
      page,
      // Poll on a timer: animation frames, the default, don't run in a background tab.
      waitForOpen: async () => {
        await page.waitForFunction(() => chrome.extension.getViews({ type: "popup" }).length > 0, undefined, { polling: 100 });
        await page.evaluate(() => {
          const popup = chrome.extension.getViews({ type: "popup" })[0];
          const relay = (message) => console.error(`[popup] ${message}`);
          popup.addEventListener("error", (event) => relay(`Uncaught: ${event.message}`));
          popup.addEventListener("unhandledrejection", (event) => relay(`Unhandled rejection: ${event.reason}`));
          const popupConsoleError = popup.console.error.bind(popup.console);
          popup.console.error = (...args) => {
            popupConsoleError(...args);
            relay(args.join(" "));
          };
          // The dialogs never open: the relay reports them and returns what a dismissed dialog returns.
          popup.alert = (message) => relay(`dialog: ${message}`);
          popup.confirm = (message) => {
            relay(`dialog: ${message}`);
            return false;
          };
          popup.prompt = (message) => {
            relay(`dialog: ${message}`);
            return null;
          };
        });
      },
      isOpen
    });
  }
});
