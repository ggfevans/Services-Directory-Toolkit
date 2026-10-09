// Playwright fixtures for testing the extension against a fake ArcGIS Server.
//
// Each test gets a fresh Chromium profile with the extension loaded. All http(s) traffic goes
// through Playwright routing. https://arcgis.test is answered by tests/fixtures/fake-arcgis.js,
// and every other host is blocked.
//
// A test fails if it does any of these, unless it declares that it expects to:
// - requests another host
// - makes a request the fake server can't answer
// - logs a console error
// - throws
// - opens a dialog
import { test as base, chromium, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFakeArcGIS, FAKE_ORIGIN, REST_ROOT } from "../fixtures/fake-arcgis.js";

export { expect, FAKE_ORIGIN, REST_ROOT };

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

  fakeServer: async ({}, use) => {
    await use(createFakeArcGIS());
  },

  // Console errors a test expects, such as the browser's own report of an HTTP 502 it injected.
  expectedErrors: async ({}, use) => {
    await use([]);
  },

  context: async ({ extraLaunchArgs, droppedDefaultArgs, fakeServer, expectedErrors }, use, testInfo) => {
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
        ...extraLaunchArgs
      ],
      ignoreDefaultArgs: droppedDefaultArgs
    });

    const errors = [];
    const dialogs = [];
    const offHost = [];
    const unmatched = [];
    context.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(`${message.text()} [${message.location().url}]`);
      }
    });
    context.on("weberror", (webError) => errors.push(`Uncaught: ${webError.error().message}`));
    context.on("dialog", async (dialog) => {
      dialogs.push(`${dialog.type()}: ${dialog.message()}`);
      await dialog.dismiss();
    });

    // http(s) only: the extension's own chrome-extension:// files must load untouched.
    await context.route(/^https?:\/\//, async (route) => {
      const request = route.request();
      if (new URL(request.url()).origin !== FAKE_ORIGIN) {
        offHost.push(request.url());
        await route.abort("blockedbyclient");
        return;
      }
      const response = fakeServer.respond(request);
      if (response) {
        await route.fulfill(response);
      } else {
        unmatched.push(`${request.method()} ${request.url()}`);
        await route.fulfill({ status: 404, contentType: "text/plain", body: "No fixture for this URL" });
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

    const unexpectedErrors = errors.filter((error) => !expectedErrors.some((pattern) => pattern.test(error)));
    expect(offHost, "requests to hosts other than the fake ArcGIS Server").toEqual([]);
    expect(unmatched, "requests the fake ArcGIS Server has no fixture for").toEqual([]);
    expect(fakeServer.problems, "requests the fake ArcGIS Server could not interpret").toEqual([]);
    expect(dialogs, "dialogs").toEqual([]);
    expect(unexpectedErrors, "console errors and uncaught exceptions").toEqual([]);
  },

  // The extension's service worker. It is automatic so that every test gets the error hooks.
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

  // Writes chrome.storage.sync items. Call it before opening the page that should read them.
  seedStorage: async ({ serviceWorker }, use) => {
    await use((items) => inWorker(serviceWorker, (values) => chrome.storage.sync.set(values), items));
  },

  readStorage: async ({ serviceWorker }, use) => {
    await use((keys = null) => inWorker(serviceWorker, (names) => chrome.storage.sync.get(names), keys));
  },

  // Opens the popup page in a normal tab, with chrome.tabs.query answering as if tabUrl were the
  // active tab. For popup logic; the real popup needs clickAction.
  openPopupTab: async ({ context, extensionId }, use) => {
    await use(async (tabUrl) => {
      const page = await context.newPage();
      await page.addInitScript((url) => {
        const tabs = [{ id: 1, index: 0, windowId: 1, active: true, url }];
        chrome.tabs.query = (queryInfo, callback) => {
          if (callback) {
            callback(tabs);
            return undefined;
          }
          return Promise.resolve(tabs);
        };
      }, tabUrl);
      await page.goto(`chrome-extension://${extensionId}/src/page_action/page_action.html`);
      return page;
    });
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
  popupView: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
    await use({
      page,
      // Poll on a timer: animation frames, the default, don't run in a background tab.
      waitForOpen: () => page.waitForFunction(() => chrome.extension.getViews({ type: "popup" }).length > 0, undefined, { polling: 100 }),
      isOpen: () => page.evaluate(() => chrome.extension.getViews({ type: "popup" }).length > 0)
    });
  }
});
