// The status indicator that replaces the gear (store-readiness spec, Phase 3): a ring in the corner
// with an accessible name, a throttled status line, no click handler, and no spin under reduced motion.
import { test, expect, json, REST_ROOT } from "./fixtures.js";

const NAME = "Services Directory Toolkit";
const LOADING = "SD Toolkit: loading";
const DONE = "SD Toolkit: finished loading";
const PRINT_TASK = `${REST_ROOT}/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/execute`;

/** Holds the root page's request for the Parcels MapServer until release() is called. */
const holdParcels = (fakeServer) => {
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  fakeServer.override(/^\/arcgis\/rest\/services\/Parcels\/MapServer\?f=json$/, async () => {
    await held;
    return json({ currentVersion: 11.3, serviceDescription: "Held back by the test.", spatialReference: { wkid: 102100, latestWkid: 3857 }, layers: [] });
  });
  return () => release();
};

const animation = (ring) => ring.evaluate((element) => getComputedStyle(element).animationName);

test("the indicator is a named image that spins and says loading while the page is busy", async ({ page, fakeServer }) => {
  const release = holdParcels(fakeServer);
  await page.goto(REST_ROOT);
  const ring = page.getByRole("img", { name: NAME });
  await expect(ring).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(LOADING);
  expect(await animation(ring)).toBe("sdt-spin");
  release();
  await expect(page.getByRole("status")).toHaveText(DONE);
  expect(await animation(ring)).toBe("none");
});

test("the status line stays empty on a page with nothing to load", async ({ page }) => {
  await page.goto(PRINT_TASK);
  await expect(page.getByRole("img", { name: NAME })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.getByRole("status")).toHaveText("");
});

test("the status line changes at most once a second, and its last state always lands", async ({ page }) => {
  await page.goto(PRINT_TASK);
  await expect(page.getByRole("img", { name: NAME })).toBeVisible();
  // Toggle a busy class on <body> every 100 ms for 2.5 s, and record each change to the status line.
  const changes = await page.evaluate(async () => {
    const status = document.querySelector("[role=status]");
    const seen = [];
    new MutationObserver(() => seen.push({ at: performance.now(), text: status.textContent }))
      .observe(status, { childList: true, characterData: true, subtree: true });
    for (let i = 0; i < 25; i++) {
      document.body.classList.toggle("sdt-loading-test");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    document.body.classList.remove("sdt-loading-test");
    await new Promise((resolve) => setTimeout(resolve, 2100));
    return seen;
  });
  expect(changes.length).toBeGreaterThan(1);
  for (let i = 1; i < changes.length; i++) {
    expect(changes[i].at - changes[i - 1].at).toBeGreaterThanOrEqual(990);
  }
  expect(changes.at(-1).text).toBe(DONE);
});

test("under reduced motion the ring doesn't spin while busy", async ({ page, fakeServer }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const release = holdParcels(fakeServer);
  await page.goto(REST_ROOT);
  await expect(page.getByRole("status")).toHaveText(LOADING);
  expect(await animation(page.getByRole("img", { name: NAME }))).toBe("none");
  release();
  await expect(page.getByRole("status")).toHaveText(DONE);
});

test("the indicator has no event listeners and lets clicks through to the page (SEC-1, ADV-3)", async ({ page }) => {
  await page.goto(REST_ROOT);
  const ring = page.getByRole("img", { name: NAME });
  await expect(ring).toBeVisible();
  // CDP lists the listeners of every world, the extension's isolated world included.
  const cdp = await page.context().newCDPSession(page);
  const { result } = await cdp.send("Runtime.evaluate", { expression: "document.querySelector(\"[aria-label='Services Directory Toolkit']\").parentElement" });
  const { listeners } = await cdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId, depth: -1, pierce: true });
  expect(listeners).toEqual([]);
  // The point under the ring belongs to the page.
  const box = await ring.boundingBox();
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[role=img]") ?? null, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(hit).toBeNull();
});

test("clicks the page dispatches on the indicator reach no extension handler", async ({ page, context, seedStorage, readStorage }) => {
  await seedStorage({ autoMetadata: true, showMapImages: false });
  await page.goto(REST_ROOT);
  const ring = page.getByRole("img", { name: NAME });
  await expect(ring).toBeVisible();
  const before = { storage: await readStorage(), html: await ring.evaluate((element) => element.parentElement.outerHTML), pages: context.pages().length };
  // A page script can click any element, including through the extension's own nodes.
  await page.evaluate(() => {
    const target = document.querySelector("[aria-label='Services Directory Toolkit']");
    for (const element of [target, target.parentElement, ...target.querySelectorAll("*")]) {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    }
    target.parentElement.click();
  });
  const box = await ring.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(500);
  expect(await readStorage()).toEqual(before.storage);
  expect(await ring.evaluate((element) => element.parentElement.outerHTML)).toBe(before.html);
  expect(context.pages()).toHaveLength(before.pages);
});
