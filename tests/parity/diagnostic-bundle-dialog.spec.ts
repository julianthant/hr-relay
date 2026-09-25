/** E29: the diagnostic bundle is a real, accessible readback surface, not a text fragment. */
import { expect,test,type Locator,type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { DiagnosticBundleWireSchema,type DiagnosticBundleWire } from "../../src/domain/dashboard/diagnostic-bundle.js";
import { RunDetailSectionResponseSchema } from "../../src/domain/dashboard/run-detail.js";
import { FingerprintSchema } from "../../src/domain/ids.js";
import { deriveDiagnosticContentDigest } from "../../src/domain/trust/diagnostic-capture.js";
import { BASELINE_JPEG_BASE64,TRUECOLOUR_PNG_BASE64 } from "../fixtures/diagnostic-image-fixtures.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR,ensureParityBundle } from "./helpers/bundle.js";
import { captureParityPair,installTheme } from "./helpers/capture.js";
import { diagnosticGalleryOrigin } from "./helpers/diagnostic-gallery-origin.js";
import { restrictedJpegDiagnosticFixture } from "./helpers/diagnostic-jpeg-fixture.js";
import { startFixtureServer,type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_SECTIONS } from "./helpers/fixture-detail.js";
import { FIXTURE_DIAGNOSTIC_BUNDLE,FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST,FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES } from "./helpers/fixture-diagnostic.js";
import { FIXTURE_APP_VERSION,FIXTURE_DAY,FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
import { FIXTURE_IDS } from "./helpers/fixture-queue.js";

const NARROW_DESKTOP_VIEWPORT = { width: 1024, height: 768 } as const;
const REFERENCES = resolve(import.meta.dirname, "references");
let server: FixtureServer;

function screenshotBundle(count: number, change: Partial<DiagnosticBundleWire["contents"][number]> = {}): DiagnosticBundleWire {
  const original = FIXTURE_DIAGNOSTIC_BUNDLE.contents.find((content) => content.kind === "screenshot");
  if (original === undefined) throw new Error("fixture screenshot is missing");
  const contents = Array.from({ length: count }, (_, index) => ({
    ...original,
    artifactId: `00000000-1000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    ...change,
  }));
  const attachments = contents.map(({ key: _key, detail: _detail, ...attachment }) => attachment);
  return DiagnosticBundleWireSchema.parse({
    ...FIXTURE_DIAGNOSTIC_BUNDLE,
    contents,
    byteSize: contents.reduce((sum, content) => sum + content.byteLength, 0),
    contentDigest: deriveDiagnosticContentDigest({
      ...FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST,
      capturedAt: FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST.createdAt,
      attachments,
    }),
  });
}

function screenshotUrl(artifactId: string, baseUrl = server.baseUrl): string {
  return `${baseUrl}/api/v1/diagnostic-bundles/${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}/attachments/${artifactId}`;
}

async function expectDecoded(image: Locator, width: number, height: number): Promise<void> {
  await expect(image).toHaveCount(1);
  await expect(image).toHaveAttribute("width", String(width));
  await expect(image).toHaveAttribute("height", String(height));
  await expect.poll(() => image.evaluate((element) => {
    if (!(element instanceof HTMLImageElement)) throw new Error("expected a screenshot image element");
    return [element.complete, element.naturalWidth, element.naturalHeight];
  })).toEqual([true, width, height]);
}

/** Keyboard reachability from the loaded page, never a click or programmatic focus. */
async function tabToDiagnosticDisclosure(page: Page): Promise<Locator> {
  const disclosure = page.getByRole("button", { name: "Show the diagnostic record", exact: true });
  await expect(disclosure).toHaveCount(1);
  const failedFilter = page.getByRole("button", { name: "Failed — 1", exact: true });
  const queue = page.getByRole("region", { name: "Queue", exact: true });
  const failedRow = queue.locator(`[data-demo-row-id='${FIXTURE_IDS.failedRun}']`);
  const runDetail = page.getByRole("region", { name: "Run detail", exact: true });
  // G26's recorded header identifies this fixture's selected failed run.
  const selectedTrace = runDetail.getByText("pl-090404-0004", { exact: true });
  const selectedUrl = page.url();
  expect(new URL(selectedUrl).searchParams.get("run")).toBe(FIXTURE_IDS.failedRun);
  expect(new URL(selectedUrl).searchParams.get("day")).toBe(FIXTURE_DAY);
  await expect(failedRow).toHaveAttribute("aria-pressed", "true");
  await expect(selectedTrace).toBeVisible();
  await expect(failedFilter).toHaveCount(1);
  let preconditionEstablished = false;
  // Bound traversal of this fixture's surrounding app; modal order below is
  // asserted destination-by-destination, not searched for until it happens.
  // G26 reached Failed at Tab 24, but remained in the all-filter Queue at 100.
  // Activate the public filter once within this SAME total traversal budget.
  for (let step = 0; step < 100; step += 1) {
    await page.keyboard.press("Tab");
    if (!preconditionEstablished && await failedFilter.evaluate((element) => element === document.activeElement)) {
      await expect(failedFilter).toBeFocused();
      await expect(failedFilter).toHaveAttribute("aria-pressed", "false");
      await page.keyboard.press("Enter");
      await expect(failedFilter).toHaveAttribute("aria-pressed", "true");
      // This fixture's Failed filter keeps seeds 4/43/80/81; its badge excludes members.
      await expect.poll(() => queue.locator("[data-demo-row-id]").evaluateAll(
        (rows) => rows.map((row) => row.getAttribute("data-demo-row-id")).sort(),
      )).toEqual([
        FIXTURE_IDS.failedRun,
        "00000000-0043-4000-8000-000000000043",
        "00000000-0080-4000-8000-000000000080",
        "00000000-0081-4000-8000-000000000081",
      ].sort());
      await expect(failedRow).toHaveCount(1);
      await expect(queue.locator("[data-demo-row-id][aria-pressed='true']")).toHaveCount(1);
      await expect(failedRow).toHaveAccessibleName("EID 10555001 — failed");
      await expect(failedRow).toHaveAttribute("aria-pressed", "true");
      await expect(page).toHaveURL(selectedUrl);
      await expect(selectedTrace).toBeVisible();
      await expect(runDetail.getByRole("img", { name: "Failed", exact: true })).toBeVisible();
      preconditionEstablished = true;
    }
    if (await disclosure.evaluate((element) => element === document.activeElement)) {
      expect(preconditionEstablished, "the Failed filter must be established by keyboard before the diagnostic disclosure").toBe(true);
      return disclosure;
    }
  }
  throw new Error("the diagnostic disclosure was not keyboard-reachable within the fixture's 100-tab bound");
}

async function expectKeyboardFocus(target: Locator, scope?: Locator): Promise<void> {
  await expect(target).toBeFocused();
  await expect(target).toBeVisible();
  if (scope !== undefined) expect(await scope.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  const ring = await target.evaluate((element) => {
    const style = getComputedStyle(element);
    const width = Number.parseFloat(style.outlineWidth);
    const offset = Number.parseFloat(style.outlineOffset);
    const rect = element.getBoundingClientRect();
    const outside = width + offset;
    let unclipped = rect.left - outside >= 0 && rect.right + outside <= innerWidth
      && rect.top - outside >= 0 && rect.bottom + outside <= innerHeight;
    for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
      const clipping = getComputedStyle(parent);
      const box = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/u.test(clipping.overflowX)) {
        unclipped &&= rect.left - outside >= box.left + parent.clientLeft
          && rect.right + outside <= box.left + parent.clientLeft + parent.clientWidth;
      }
      if (/(auto|scroll|hidden|clip)/u.test(clipping.overflowY)) {
        unclipped &&= rect.top - outside >= box.top + parent.clientTop
          && rect.bottom + outside <= box.top + parent.clientTop + parent.clientHeight;
      }
    }
    return { visible: element.matches(":focus-visible"), style: style.outlineStyle, color: style.outlineColor, width, offset, unclipped };
  });
  expect(ring.visible).toBe(true);
  expect(ring.style).toBe("solid");
  expect(ring.width).toBeGreaterThanOrEqual(2);
  expect(ring.offset).toBeGreaterThanOrEqual(1);
  expect(ring.color).not.toMatch(/^(?:transparent|rgba\(.+,\s*0\))$/u);
  expect(ring.unclipped).toBe(true);
}

/** The full bundle identity must fit the native trigger, not only its accessible name. */
async function expectBundleTriggerContainment(target: Locator, bundleId: string): Promise<void> {
  const label = `Diagnostic bundle ${bundleId}`;
  await expect(target).toHaveCount(1);
  await expect(target).toBeVisible();
  await expect(target).toHaveAccessibleName(label);
  await expect(target).toHaveText(label, { useInnerText: true });
  const geometry = await target.evaluate((element) => {
    if (!(element instanceof HTMLButtonElement)) throw new Error("the diagnostic bundle trigger must be a native button");
    const row = element.parentElement;
    if (row === null) throw new Error("the diagnostic bundle trigger has no containing row");
    const box = element.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const fragments: { left: number; right: number; top: number; bottom: number; width: number; height: number }[] = [];
    for (let node = text.nextNode(); node !== null; node = text.nextNode()) {
      if (node.textContent === null || node.textContent.trim() === "") continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        fragments.push({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height });
      }
    }
    return {
      left: box.left, right: box.right, height: box.height,
      rowLeft: rowBox.left, rowRight: rowBox.right,
      innerLeft: box.left + element.clientLeft, innerRight: box.left + element.clientLeft + element.clientWidth,
      innerTop: box.top + element.clientTop, innerBottom: box.top + element.clientTop + element.clientHeight,
      scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
      fragments,
    };
  });
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  expect(geometry.left).toBeGreaterThanOrEqual(geometry.rowLeft);
  expect(geometry.right).toBeLessThanOrEqual(geometry.rowRight);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  expect(geometry.fragments.length).toBeGreaterThan(0);
  for (const fragment of geometry.fragments) {
    expect(fragment.width).toBeGreaterThan(0);
    expect(fragment.height).toBeGreaterThan(0);
    expect(fragment.left).toBeGreaterThanOrEqual(geometry.innerLeft);
    expect(fragment.right).toBeLessThanOrEqual(geometry.innerRight);
    expect(fragment.top).toBeGreaterThanOrEqual(geometry.innerTop);
    expect(fragment.bottom).toBeLessThanOrEqual(geometry.innerBottom);
  }
}

/** Ordinary test-output evidence only: no golden name, reference write or URL normalization. */
function requiredA11yEvidence(...names: readonly string[]) {
  return {
    annotation: names.map((description) => ({
      type: "required-a11y-evidence",
      description,
    })),
  };
}

/** Ordinary test-output evidence only: no golden name, reference write or URL normalization. */
async function attachLightboxEvidence(page: Page, lightbox: Locator, name: string, width: number, height: number): Promise<void> {
  await expectDecoded(lightbox.getByRole("img"), width, height);
  const pngPath = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path: pngPath, fullPage: false, animations: "disabled" });
  await test.info().attach(`${name}.png`, { path: pngPath, contentType: "image/png" });
  const snapshot = await page.locator("body").ariaSnapshot();
  const a11yName = `${name}.a11y.yml`;
  const a11yDigest = createHash("sha256").update(snapshot).digest("hex");
  test.info().annotations.push({
    type: `a11y-attachment-sha256:${a11yName}`,
    description: a11yDigest,
  });
  await test.info().attach(a11yName, { body: snapshot, contentType: "text/yaml" });
}

async function expectKeyboardGalleryFlow(page: Page): Promise<void> {
  const disclosure = await tabToDiagnosticDisclosure(page);
  await expectKeyboardFocus(disclosure);
  await page.keyboard.press("Enter");
  const expanded = page.getByRole("button", { name: "Hide the diagnostic record", exact: true });
  await expect(expanded).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Tab");
  const bundleTrigger = page.getByRole("button", { name: `Diagnostic bundle ${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}`, exact: true });
  await expectKeyboardFocus(bundleTrigger);
  await expectBundleTriggerContainment(bundleTrigger, FIXTURE_DIAGNOSTIC_BUNDLE.bundleId);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: `Diagnostic bundle ${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}`, exact: true });
  const close = dialog.getByRole("button", { name: "Close", exact: true });
  // The loading dialog initially has only its Close control. Readback adds
  // the gallery and manifest without moving that existing keyboard focus.
  await expectKeyboardFocus(close, dialog);
  const thumbnail = dialog.getByRole("button", { name: "Open Diagnostic screenshot 1 of 1", exact: true });
  const manifest = dialog.getByRole("link", { name: "Download the manifest", exact: true });
  await expectDecoded(thumbnail.getByRole("img"), 1280, 720);
  for (const [key, target] of [
    ["Tab", manifest], ["Tab", thumbnail], ["Tab", close],
    ["Shift+Tab", thumbnail], ["Shift+Tab", manifest], ["Shift+Tab", close], ["Shift+Tab", thumbnail],
  ] as const) {
    await page.keyboard.press(key);
    await expectKeyboardFocus(target, dialog);
  }
  await page.keyboard.press("Enter");
  const lightbox = page.getByRole("dialog", { name: "Diagnostic screenshot 1 of 1", exact: true });
  const back = lightbox.getByRole("button", { name: "Back to screenshots", exact: true });
  const download = lightbox.getByRole("link", { name: "Download screenshot", exact: true });
  await expectDecoded(lightbox.getByRole("img"), 1280, 720);
  await expectKeyboardFocus(back, lightbox);
  for (const [key, target] of [["Tab", download], ["Tab", back], ["Shift+Tab", download], ["Shift+Tab", back]] as const) {
    await page.keyboard.press(key);
    await expectKeyboardFocus(target, lightbox);
  }
  await attachLightboxEvidence(page, lightbox, "diagnostic-lightbox-keyboard-focus", 1280, 720);
  await page.keyboard.press("Escape");
  await expect(lightbox).toHaveCount(0);
  await expectKeyboardFocus(thumbnail, dialog);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expectKeyboardFocus(bundleTrigger);
  await page.keyboard.press("Shift+Tab");
  await expectKeyboardFocus(expanded);
  await page.keyboard.press("Space");
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
}

async function expectThumbnailHover(dialog: Locator, thumbnail: Locator): Promise<void> {
  const heading = dialog.getByRole("heading", { name: `Diagnostic bundle ${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}`, exact: true });
  const paint = () => thumbnail.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderTopColor };
  });
  await heading.hover();
  const resting = await paint();
  await thumbnail.hover();
  await expect.poll(async () => (await paint()).background).not.toBe(resting.background);
  await expect.poll(async () => (await paint()).border).not.toBe(resting.border);
  await heading.hover();
  await expect.poll(paint).toEqual(resting);
  expect(await thumbnail.evaluate((element) => element.matches(":hover"))).toBe(false);
}

/** Same rectangle/elementFromPoint proof as the existing accessibility specs. */
async function expectClearTargets(scope: Locator, targets: readonly Locator[], names: readonly string[]): Promise<void> {
  for (const target of targets) {
    await target.scrollIntoViewIfNeeded();
    const proof = await target.evaluate((element) => {
      const dialog = element.closest('[role="dialog"]');
      if (dialog === null) throw new Error("diagnostic target has no owning dialog");
      // A native scrolling body clips offscreen thumbnail portions. Compare
      // visible hit regions, never hidden rectangles behind the fixed footer.
      const visibleBox = (node: Element) => {
        const rect = node.getBoundingClientRect();
        let left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
        let top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
        for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          const box = parent.getBoundingClientRect();
          if (/(auto|scroll|hidden|clip)/u.test(style.overflowX)) {
            left = Math.max(left, box.left + parent.clientLeft);
            right = Math.min(right, box.left + parent.clientLeft + parent.clientWidth);
          }
          if (/(auto|scroll|hidden|clip)/u.test(style.overflowY)) {
            top = Math.max(top, box.top + parent.clientTop);
            bottom = Math.min(bottom, box.top + parent.clientTop + parent.clientHeight);
          }
        }
        return { left, right, top, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
      };
      const controls = [...dialog.querySelectorAll('button, a[href]')].map((node) => {
        const name = node.getAttribute("aria-label") ?? node.textContent?.trim();
        if (!name) throw new Error("unnamed diagnostic hit target");
        return { node, name, ...visibleBox(node) };
      });
      const overlaps: string[] = [];
      for (let index = 0; index < controls.length; index += 1) {
        const left = controls[index];
        if (left === undefined) throw new Error("missing diagnostic control");
        for (const right of controls.slice(index + 1)) {
          if (left.width > 0 && left.height > 0 && right.width > 0 && right.height > 0
            && left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top) {
            overlaps.push(`${left.name} / ${right.name}`);
          }
        }
      }
      const box = visibleBox(element);
      const x = (box.left + box.right) / 2, y = (box.top + box.bottom) / 2;
      const owns = (px: number, py: number) => {
        const hit = document.elementFromPoint(px, py);
        return hit === element || (hit !== null && element.contains(hit));
      };
      return {
        names: controls.map(({ name }) => name), overlaps, width: box.width, height: box.height,
        edges: [owns(box.left + 1, y), owns(box.right - 1, y), owns(x, box.top + 1), owns(x, box.bottom - 1)],
      };
    });
    await expect(scope).toBeVisible();
    expect(proof.names).toEqual(names);
    expect(proof.width).toBeGreaterThanOrEqual(44);
    expect(proof.height).toBeGreaterThanOrEqual(44);
    expect(proof.overlaps).toEqual([]);
    expect(proof.edges).toEqual([true, true, true, true]);
  }
}

async function openFixtureBundle(page: Page, baseUrl = server.baseUrl): Promise<Locator> {
  await gotoAppState(page, baseUrl, { day: FIXTURE_DAY, run: FIXTURE_IDS.failedRun });
  await openDiagnosticRecord(page);
  await page.getByRole("button", { name: `Diagnostic bundle ${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}` }).click();
  const dialog = page.getByRole("dialog", { name: `Diagnostic bundle ${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}` });
  await expect(dialog.getByText("Captured diagnostic values", { exact: true })).toBeVisible();
  await expect(dialog).toContainText("synthetic-visible-password");
  await expect(dialog).toContainText("Synthetic Employee");
  return dialog;
}

/** Only capture cases use the alias; the server still verifies and serves the stamped bundle. */
async function openCaptureGallery(page: Page): Promise<void> {
  const binding = diagnosticGalleryOrigin(server.baseUrl);
  // URL-only continuation retains real responses and streaming SSE; no response/tree rewriting.
  await page.route(`${binding.baseUrl}/**`, (route) => route.continue({
    url: binding.forwardUrl(route.request().url()),
  }));
  const dialog = await openFixtureBundle(page, binding.baseUrl);
  expect(await page.evaluate(() => window.location.origin)).toBe(binding.baseUrl);
  const screenshot = FIXTURE_DIAGNOSTIC_BUNDLE.contents.find((content) => content.kind === "screenshot");
  if (screenshot === undefined) throw new Error("the fixture diagnostic bundle must carry a screenshot");
  const trigger = dialog.getByRole("button", { name: "Open Diagnostic screenshot 1 of 1" });
  await expect(trigger).toBeVisible();
  const image = trigger.getByRole("img");
  await expect(image).toHaveAttribute("src", screenshotUrl(screenshot.artifactId, binding.baseUrl));
  await expectDecoded(image, 1280, 720);
  const manifestUrl = `${binding.baseUrl}/api/v1/diagnostic-bundles/${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}/manifest`;
  await expect(dialog.getByRole("link", { name: "Download the manifest" })).toHaveAttribute("href", manifestUrl);
  expect(await dialog.ariaSnapshot()).toContain(`/url: ${manifestUrl}`);
}

/**
 * Open the failure record's diagnostic disclosure.
 *
 * D273 item 8 put the whole diagnostic record — the bundle trigger, the
 * classification block and the `absent` arm's explanation alike — behind a
 * `Show the diagnostic record` button, so every test below was addressing a
 * subtree that is not mounted until this is pressed. It is one control, so it
 * is one helper, and it ASSERTS both halves: the trigger's `aria-expanded`
 * flipping, and the trigger itself existing in the first place. Without that
 * second assertion a future rename would turn every test here into a 120-second
 * timeout on the NEXT locator, naming everything except the cause — which is
 * exactly the failure mode the intake spec's own lesson names.
 */
async function openDiagnosticRecord(page: import("@playwright/test").Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Show the diagnostic record" });
  await expect(
    toggle,
    "the failure record's diagnostic disclosure is missing; everything this spec addresses lives behind it",
  ).toHaveCount(1);
  await toggle.click();
  await expect(page.getByRole("button", { name: "Hide the diagnostic record" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
}

test.beforeAll(async () => {
  ensureParityBundle();
  server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
});

test.afterAll(async () => {
  await server.close();
});

test(
  "opens the strict bundle dialog, opens its exact gallery resource, restores focus, and downloads served bytes",
  requiredA11yEvidence("diagnostic-lightbox-keyboard-focus.a11y.yml"),
  async ({ page }) => {
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: FIXTURE_IDS.failedRun });
  await expectKeyboardGalleryFlow(page);
  await openDiagnosticRecord(page);
  const trigger = page.getByRole("button", { name: `Diagnostic bundle ${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}` });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: `Diagnostic bundle ${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Captured diagnostic values", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Accessibility excerpt")).toBeVisible();
  const screenshot = FIXTURE_DIAGNOSTIC_BUNDLE.contents.find((content) => content.kind === "screenshot");
  if (screenshot === undefined) throw new Error("the fixture diagnostic bundle must carry a screenshot");
  const galleryTrigger = dialog.getByRole("button", { name: "Open Diagnostic screenshot 1 of 1" });
  await expect(galleryTrigger).toBeVisible();
  await expect(galleryTrigger.getByRole("img", { name: "Diagnostic screenshot 1 of 1" })).toHaveAttribute(
    "src",
    screenshotUrl(screenshot.artifactId),
  );
  await expectDecoded(galleryTrigger.getByRole("img"), 1280, 720);
  await galleryTrigger.click();
  const lightbox = page.getByRole("dialog", { name: "Diagnostic screenshot 1 of 1" });
  await expect(lightbox).toBeVisible();
  await expect(lightbox.getByRole("img")).toHaveAttribute("src", screenshotUrl(screenshot.artifactId));
  await expectDecoded(lightbox.getByRole("img"), 1280, 720);
  await expect(lightbox.getByText(`${String(screenshot.width)} × ${String(screenshot.height)} px · ${screenshot.sensitivity} at capture`)).toBeVisible();
  const screenshotLink = lightbox.getByRole("link", { name: "Download screenshot" });
  await expect(screenshotLink).toHaveAttribute(
    "href",
    screenshotUrl(screenshot.artifactId),
  );
  const [screenshotDownload] = await Promise.all([
    page.waitForEvent("download"),
    screenshotLink.click(),
  ]);
  expect(screenshotDownload.suggestedFilename()).toBe("diagnostic-screenshot-1.png");
  const screenshotDownloadPath = await screenshotDownload.path();
  if (screenshotDownloadPath === null) throw new Error("the screenshot download did not produce a file");
  expect(await readFile(screenshotDownloadPath)).toEqual(Buffer.from(FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES));
  await page.keyboard.press("Escape");
  await expect(lightbox).toHaveCount(0);
  await expect(galleryTrigger).toBeFocused();
  const manifestLink = page.getByRole("link", { name: "Download the manifest" });
  await expect(manifestLink).toBeVisible();
  await expect(manifestLink).toHaveAttribute(
    "href",
    `${server.baseUrl}/api/v1/diagnostic-bundles/${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}/manifest`,
  );
  await expect(manifestLink).toHaveAttribute("download", `${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}.json`);
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[role='dialog']") !== null)).toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    manifestLink.click(),
  ]);
  expect(download.suggestedFilename()).toBe(`${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}.json`);
  const downloadedPath = await download.path();
  if (downloadedPath === null) throw new Error("the manifest download did not produce a file");
  const downloadedManifest = await readFile(downloadedPath, "utf8");
  expect(downloadedManifest).toBe(canonicalJsonStringify(FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST));
  expect(JSON.parse(downloadedManifest)).toEqual(FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST);
  },
);

test(
  "captures the exact-identity screenshot gallery with attributable fixture metadata",
  requiredA11yEvidence("diagnostic-lightbox--graphite-warm--1280x720.a11y.yml"),
  async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installTheme(page, { name: "graphite-warm", attribute: "dark" });
  await openCaptureGallery(page);
  // Chromium varies a few glyph-edge pixels here; the paired a11y tree pins "Close".
  await captureParityPair(page, REFERENCES, {
    stateId: "diagnostic-bundle-gallery",
    viewport: "1280x720",
    theme: "graphite-warm",
    adapter: "fixture",
    fixtureId: "diagnostic-bundle-gallery",
    descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION,
    capturedAt: FIXTURE_DAY,
    variant: "default",
  }, { screenshotStyle: '[data-slot="diagnostic-close-label"] { visibility: hidden !important; }' });
  const dialog = page.getByRole("dialog", { name: `Diagnostic bundle ${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}`, exact: true });
  const thumbnail = dialog.getByRole("button", { name: "Open Diagnostic screenshot 1 of 1", exact: true });
  await expectThumbnailHover(dialog, thumbnail);
  await thumbnail.click();
  await attachLightboxEvidence(page, page.getByRole("dialog", { name: "Diagnostic screenshot 1 of 1", exact: true }), "diagnostic-lightbox--graphite-warm--1280x720", 1280, 720);
  },
);

test(
  "captures the exact-identity screenshot gallery in paper ink",
  requiredA11yEvidence("diagnostic-lightbox--paper-ink--1280x720.a11y.yml"),
  async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installTheme(page, { name: "paper-ink", attribute: "light" });
  await openCaptureGallery(page);
  await captureParityPair(page, REFERENCES, {
    stateId: "diagnostic-bundle-gallery",
    viewport: "1280x720",
    theme: "paper-ink",
    adapter: "fixture",
    fixtureId: "diagnostic-bundle-gallery",
    descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION,
    capturedAt: FIXTURE_DAY,
    variant: "default",
  }, { screenshotStyle: '[data-slot="diagnostic-close-label"] { visibility: hidden !important; }' });
  const dialog = page.getByRole("dialog", { name: `Diagnostic bundle ${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}`, exact: true });
  const thumbnail = dialog.getByRole("button", { name: "Open Diagnostic screenshot 1 of 1", exact: true });
  await expectThumbnailHover(dialog, thumbnail);
  await thumbnail.click();
  await attachLightboxEvidence(page, page.getByRole("dialog", { name: "Diagnostic screenshot 1 of 1", exact: true }), "diagnostic-lightbox--paper-ink--1280x720", 1280, 720);
  },
);

test("re-reads the exact bundle after an image failure and names its typed authority outcome", async ({ page }) => {
  const screenshot = FIXTURE_DIAGNOSTIC_BUNDLE.contents.find((content) => content.kind === "screenshot");
  if (screenshot === undefined) throw new Error("the fixture diagnostic bundle must carry a screenshot");
  let bundleReads = 0;
  await page.route(`**/api/v1/diagnostic-bundles/${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}`, async (route) => {
    bundleReads += 1;
    if (bundleReads === 1) {
      await route.fulfill({ response: await route.fetch() });
      return;
    }
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        state: "error",
        code: "DIAGNOSTIC_BUNDLE_BYTES_MISSING",
        message: "diagnostic bundle attachment has no stored bytes",
        retryable: false,
      }),
    });
  });
  await page.route(
    `**/api/v1/diagnostic-bundles/${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}/attachments/${screenshot.artifactId}`,
    (route) => route.fulfill({ status: 500, contentType: "text/plain", body: "attachment unavailable" }),
  );
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: FIXTURE_IDS.failedRun });
  await openDiagnosticRecord(page);
  await page.getByRole("button", { name: `Diagnostic bundle ${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}` }).click();
  const galleryTrigger = page.getByRole("button", { name: "Open Diagnostic screenshot 1 of 1" });
  await expect(galleryTrigger.getByText("Screenshot bytes are missing")).toBeVisible();
  await galleryTrigger.click();
  const lightbox = page.getByRole("dialog", { name: "Diagnostic screenshot 1 of 1" });
  await expect(lightbox.getByText("diagnostic bundle attachment has no stored bytes")).toBeVisible();
  await expect(lightbox.getByRole("link", { name: "Download screenshot" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(galleryTrigger).toBeFocused();
});

test("does not reopen when a delayed bundle verification settles after Escape", async ({ page }) => {
  let releaseResponse: (() => void) | undefined;
  const responseReleased = new Promise<void>((resolve) => { releaseResponse = resolve; });
  let responseDelivered = false;
  await page.route(`**/api/v1/diagnostic-bundles/${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}`, async (route) => {
    const response = await route.fetch();
    await responseReleased;
    await route.fulfill({ response });
    responseDelivered = true;
  });
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: FIXTURE_IDS.failedRun });
  await openDiagnosticRecord(page);
  const trigger = page.getByRole("button", { name: `Diagnostic bundle ${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}` });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: `Diagnostic bundle ${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}` });
  await expect(dialog).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  releaseResponse?.();
  await expect.poll(() => responseDelivered).toBe(true);
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("isolates two failed screenshots and accepts their rechecks out of order", async ({ page }) => {
  const bundle = screenshotBundle(2);
  const [first, second] = bundle.contents;
  if (first === undefined || second === undefined) throw new Error("two screenshot fixtures are required");
  const failFirst = Promise.withResolvers<void>();
  const failSecond = Promise.withResolvers<void>();
  const finishFirstRead = Promise.withResolvers<void>();
  let reads = 0;
  await page.route(`**/api/v1/diagnostic-bundles/${bundle.bundleId}`, async (route) => {
    reads += 1;
    const read = reads;
    if (read === 1) { await route.fulfill({ json: bundle }); return; }
    if (read === 2) await finishFirstRead.promise;
    await route.fulfill({ status: 500, json: {
      state: "error", retryable: false,
      code: read === 2 ? "DIAGNOSTIC_BUNDLE_BYTES_MISSING" : "SECTION_UNAVAILABLE",
      message: read === 2 ? "First screenshot has no stored bytes" : "Second screenshot authority is unavailable",
    } });
  });
  await page.route(screenshotUrl(first.artifactId), async (route) => {
    await failFirst.promise;
    await route.fulfill({ status: 500, body: "no image" });
  });
  await page.route(screenshotUrl(second.artifactId), async (route) => {
    await failSecond.promise;
    await route.fulfill({ status: 500, body: "no image" });
  });
  const dialog = await openFixtureBundle(page);
  const firstTrigger = dialog.getByRole("button", { name: "Open Diagnostic screenshot 1 of 2" });
  const secondTrigger = dialog.getByRole("button", { name: "Open Diagnostic screenshot 2 of 2" });
  await firstTrigger.scrollIntoViewIfNeeded();
  failFirst.resolve();
  await expect.poll(() => reads).toBe(2);
  await secondTrigger.scrollIntoViewIfNeeded();
  failSecond.resolve();
  await expect(secondTrigger).toContainText("Second screenshot authority is unavailable");
  finishFirstRead.resolve();
  await expect(firstTrigger).toContainText("First screenshot has no stored bytes");
  await expect(secondTrigger).toContainText("Second screenshot authority is unavailable");
  await expect(firstTrigger).not.toHaveAttribute("aria-busy", "true");
  await expect(secondTrigger).not.toHaveAttribute("aria-busy", "true");
  await firstTrigger.click();
  const lightbox = page.getByRole("dialog", { name: "Diagnostic screenshot 1 of 2" });
  await expect(lightbox).toContainText("First screenshot has no stored bytes");
  await expect(lightbox.getByRole("link", { name: "Download screenshot" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(firstTrigger).toBeFocused();
  await secondTrigger.click();
  await expect(page.getByRole("dialog", { name: "Diagnostic screenshot 2 of 2" })).toContainText("Second screenshot authority is unavailable");
  expect(reads).toBe(3);
});

test("continues parent-owned verification after lightbox Escape without leaving a dead loading state", async ({ page }) => {
  const release = Promise.withResolvers<void>();
  let reads = 0;
  await page.route(`**/api/v1/diagnostic-bundles/${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}`, async (route) => {
    reads += 1;
    if (reads > 1) await release.promise;
    await route.fulfill({ json: FIXTURE_DIAGNOSTIC_BUNDLE });
  });
  await page.route("**/api/v1/diagnostic-bundles/*/attachments/*", (route) => route.fulfill({ status: 500, body: "image failed" }));
  const dialog = await openFixtureBundle(page);
  const trigger = dialog.getByRole("button", { name: "Open Diagnostic screenshot 1 of 1" });
  await trigger.scrollIntoViewIfNeeded();
  await expect.poll(() => reads).toBe(2);
  await trigger.click();
  const lightbox = page.getByRole("dialog", { name: "Diagnostic screenshot 1 of 1" });
  await expect(lightbox.getByRole("status")).toHaveText("Verifying the stored screenshot attachment…");
  await expect(lightbox.getByRole("link", { name: "Download screenshot" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  release.resolve();
  await expect(trigger).toContainText("Screenshot preview could not be loaded");
  await expect(trigger).not.toHaveAttribute("aria-busy", "true");
  await expect(lightbox).toHaveCount(0);
  await trigger.click();
  await expect(lightbox).toContainText("The stored attachment verified");
  const warning = lightbox.getByRole("status");
  await expect(warning).toHaveCount(1);
  await expect(warning.getByText("Screenshot preview could not be loaded", { exact: true })).toBeVisible();
  await expect(warning.getByText("The stored attachment verified, but this browser could not load or decode the image.", { exact: true })).toBeVisible();
  await expect(lightbox.getByText("Loading screenshot…", { exact: true })).toHaveCount(0);
  await expect(lightbox.getByText("Verifying the stored screenshot attachment…", { exact: true })).toHaveCount(0);
  await expect(lightbox.getByRole("link", { name: "Download screenshot" })).toBeVisible();
  expect(reads).toBe(2);
});

test("a parent footer close invalidates a delayed image reread before the same bundle reopens", async ({ page }) => {
  const release = Promise.withResolvers<void>();
  const delivered = Promise.withResolvers<void>();
  let reads = 0;
  let images = 0;
  await page.route(`**/api/v1/diagnostic-bundles/${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}`, async (route) => {
    reads += 1;
    if (reads !== 2) { await route.fulfill({ json: FIXTURE_DIAGNOSTIC_BUNDLE }); return; }
    await release.promise;
    await route.fulfill({ status: 500, json: {
      state: "error", code: "DIAGNOSTIC_BUNDLE_CORRUPT", message: "Old read was corrupt", retryable: false,
    } });
    delivered.resolve();
  });
  await page.route("**/api/v1/diagnostic-bundles/*/attachments/*", async (route) => {
    images += 1;
    if (images === 1) await route.fulfill({ status: 500, body: "image failed" });
    else await route.fulfill({ body: Buffer.from(FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES), contentType: "image/png" });
  });
  const dialog = await openFixtureBundle(page);
  const trigger = dialog.getByRole("button", { name: "Open Diagnostic screenshot 1 of 1" });
  await trigger.scrollIntoViewIfNeeded();
  await expect.poll(() => reads).toBe(2);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const bundleTrigger = page.getByRole("button", { name: `Diagnostic bundle ${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}` });
  await expect(bundleTrigger).toBeFocused();
  await expect(dialog).toHaveCount(0);
  await bundleTrigger.click();
  await expectDecoded(trigger.getByRole("img"), 1280, 720);
  release.resolve();
  await delivered.promise;
  await expect(dialog).not.toContainText("Old read was corrupt");
  await expectDecoded(trigger.getByRole("img"), 1280, 720);
  await expect(page.getByRole("dialog", { name: "Diagnostic screenshot 1 of 1" })).toHaveCount(0);
  expect(reads).toBe(3);
});

for (const mismatch of ["content-digest", "screenshot-metadata"] as const) {
  test(`refuses ${mismatch} drift on image reread instead of granting a browser-only download`, async ({ page }) => {
    let reads = 0;
    await page.route(`**/api/v1/diagnostic-bundles/${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}`, (route) => {
      reads += 1;
      const changed = mismatch === "content-digest"
        ? { ...FIXTURE_DIAGNOSTIC_BUNDLE, contentDigest: "e".repeat(64) }
        : { ...FIXTURE_DIAGNOSTIC_BUNDLE, contents: FIXTURE_DIAGNOSTIC_BUNDLE.contents.map((content) => (
            content.kind === "screenshot" ? { ...content, width: 640 } : content
          )) };
      return route.fulfill({ json: reads === 1 ? FIXTURE_DIAGNOSTIC_BUNDLE : changed });
    });
    await page.route("**/api/v1/diagnostic-bundles/*/attachments/*", (route) => route.fulfill({ status: 500, body: "image failed" }));
    const dialog = await openFixtureBundle(page);
    const trigger = dialog.getByRole("button", { name: "Open Diagnostic screenshot 1 of 1" });
    await trigger.scrollIntoViewIfNeeded();
    await expect(trigger).toContainText("Screenshot identity could not be verified");
    await trigger.click();
    const lightbox = page.getByRole("dialog", { name: "Diagnostic screenshot 1 of 1" });
    await expect(lightbox).toContainText("close and reopen the bundle to read current authority");
    await expect(lightbox.getByRole("link", { name: "Download screenshot" })).toHaveCount(0);
  });
}

test("does not fetch the offscreen gallery eagerly and admits only visible thumbnails", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const bundle = screenshotBundle(20);
  const requested = new Set<string>();
  await page.route(`**/api/v1/diagnostic-bundles/${bundle.bundleId}`, (route) => route.fulfill({ json: bundle }));
  await page.route("**/api/v1/diagnostic-bundles/*/attachments/*", (route) => {
    requested.add(route.request().url());
    return route.fulfill({ body: Buffer.from(FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES), contentType: "image/png" });
  });
  const dialog = await openFixtureBundle(page);
  const first = dialog.getByRole("button", { name: "Open Diagnostic screenshot 1 of 20" });
  const last = dialog.getByRole("button", { name: "Open Diagnostic screenshot 20 of 20" });
  await expect(first).not.toBeInViewport();
  await expect(last).not.toBeInViewport();
  await page.evaluate(() => new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame())));
  expect(requested.size).toBe(0);
  await first.scrollIntoViewIfNeeded();
  await expectDecoded(first.getByRole("img"), 1280, 720);
  expect(requested.size).toBeLessThanOrEqual(6);
  const lastAttachment = bundle.contents[19];
  if (lastAttachment === undefined) throw new Error("twentieth screenshot is missing");
  expect(requested.has(screenshotUrl(lastAttachment.artifactId))).toBe(false);
  await expect(last.getByRole("img")).toHaveCount(0);
  await last.scrollIntoViewIfNeeded();
  await expectDecoded(last.getByRole("img"), 1280, 720);
  expect(requested.has(screenshotUrl(lastAttachment.artifactId))).toBe(true);
});

test("keeps a genuine loading state and no download until the selected image decodes", async ({ page }) => {
  const release = Promise.withResolvers<void>();
  await page.route("**/api/v1/diagnostic-bundles/*/attachments/*", async (route) => {
    await release.promise;
    await route.fulfill({ body: Buffer.from(FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES), contentType: "image/png" });
  });
  const dialog = await openFixtureBundle(page);
  const trigger = dialog.getByRole("button", { name: "Open Diagnostic screenshot 1 of 1" });
  await trigger.scrollIntoViewIfNeeded();
  await expect(trigger.getByRole("status")).toHaveText("Loading screenshot…");
  await trigger.click();
  const lightbox = page.getByRole("dialog", { name: "Diagnostic screenshot 1 of 1" });
  await expect(lightbox.getByRole("status")).toHaveText("Loading screenshot…");
  await expect(lightbox.getByRole("link", { name: "Download screenshot" })).toHaveCount(0);
  release.resolve();
  await expectDecoded(lightbox.getByRole("img"), 1280, 720);
  await expect(lightbox.getByRole("status")).toHaveCount(0);
  await expect(lightbox.getByRole("link", { name: "Download screenshot" })).toBeVisible();
});

test("keeps restricted JPEG bytes, dimensions and warning honest on the lightbox download", async ({ page }) => {
  const bytes = Buffer.from(BASELINE_JPEG_BASE64, "base64");
  const fixture = restrictedJpegDiagnosticFixture();
  const jpegServer = await startFixtureServer({
    distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, diagnosticFixture: "restricted-jpeg",
  });
  try {
    // No page request interception: decode and native download must both use
    // the exact HTTP attachment served by this case-owned stamped fixture.
    const screenshot = fixture.bundle.contents[0];
    if (screenshot === undefined) throw new Error("JPEG fixture screenshot is missing");
    const url = screenshotUrl(screenshot.artifactId, jpegServer.baseUrl);
    const dialog = await openFixtureBundle(page, jpegServer.baseUrl);
    await expect(dialog).toContainText("Restricted screenshots may contain sensitive visible information");
    const manifestLink = dialog.getByRole("link", { name: "Download the manifest" });
    await expect(manifestLink).toHaveAttribute("href", `${jpegServer.baseUrl}/api/v1/diagnostic-bundles/${fixture.bundle.bundleId}/manifest`);
    const trigger = dialog.getByRole("button", { name: "Open Diagnostic screenshot 1 of 1" });
    await trigger.scrollIntoViewIfNeeded();
    await expect(trigger.getByRole("img")).toHaveAttribute("src", url);
    await expectDecoded(trigger.getByRole("img"), 16, 12);
    await trigger.click();
    const lightbox = page.getByRole("dialog", { name: "Diagnostic screenshot 1 of 1" });
    await expect(lightbox.getByRole("img")).toHaveAttribute("src", url);
    await expectDecoded(lightbox.getByRole("img"), 16, 12);
    await expect(lightbox.getByText("Restricted screenshots may contain sensitive visible information")).toBeVisible();
    await expect(lightbox).toContainText("Review it before sharing; the dashboard does not redact image pixels");
    const link = lightbox.getByRole("link", { name: "Download screenshot" });
    await expect(link).toHaveAttribute("href", url);
    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    expect(download.suggestedFilename()).toBe("diagnostic-screenshot-1.jpg");
    const path = await download.path();
    if (path === null) throw new Error("JPEG download did not produce a file");
    expect(await readFile(path)).toEqual(bytes);
    await page.keyboard.press("Escape");
    const [manifestDownload] = await Promise.all([page.waitForEvent("download"), manifestLink.click()]);
    expect(manifestDownload.suggestedFilename()).toBe(`${fixture.bundle.bundleId}.json`);
    const manifestPath = await manifestDownload.path();
    if (manifestPath === null) throw new Error("JPEG manifest download did not produce a file");
    expect(await readFile(manifestPath, "utf8")).toBe(canonicalJsonStringify(fixture.manifest));
  } finally {
    await jpegServer.close();
  }
});

test("keeps the requested dialog identity when a strict response carries a foreign bundle id", async ({ page }) => {
  const requestedBundleId = FIXTURE_DIAGNOSTIC_BUNDLE.bundleId;
  const foreignBundleId = "00000000-0999-4000-8000-000000000999";
  await page.route(`**/api/v1/diagnostic-bundles/${requestedBundleId}`, (route) => route.fulfill({
    json: { ...FIXTURE_DIAGNOSTIC_BUNDLE, bundleId: foreignBundleId },
  }));
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: FIXTURE_IDS.failedRun });
  await openDiagnosticRecord(page);
  await page.getByRole("button", { name: `Diagnostic bundle ${requestedBundleId}` }).click();

  const dialog = page.getByRole("dialog", { name: `Diagnostic bundle ${requestedBundleId}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Diagnostic bundle readback failed")).toBeVisible();
  await expect(dialog.getByText(/DIAGNOSTIC_BUNDLE_IDENTITY_MISMATCH/u)).toBeVisible();
  await expect(dialog).not.toContainText(foreignBundleId);
  await expect(dialog.getByRole("link", { name: "Download the manifest" })).toHaveCount(0);
});

test("an unknown reread error never grants a screenshot download", async ({ page }) => {
  let reads = 0;
  await page.route(`**/api/v1/diagnostic-bundles/${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}`, (route) => {
    reads += 1;
    return reads === 1 ? route.fulfill({ json: FIXTURE_DIAGNOSTIC_BUNDLE }) : route.abort("failed");
  });
  await page.route("**/api/v1/diagnostic-bundles/*/attachments/*", (route) => route.fulfill({ status: 500, body: "image failed" }));
  const dialog = await openFixtureBundle(page);
  const trigger = dialog.getByRole("button", { name: "Open Diagnostic screenshot 1 of 1" });
  await trigger.scrollIntoViewIfNeeded();
  await expect(trigger).toContainText("Screenshot availability could not be verified");
  await trigger.click();
  const lightbox = page.getByRole("dialog", { name: "Diagnostic screenshot 1 of 1" });
  await expect(lightbox).toContainText("the exact diagnostic bundle could not be re-read");
  await expect(lightbox.getByRole("link", { name: "Download screenshot" })).toHaveCount(0);
});

for (const [width, evidence] of [
  [1024, requiredA11yEvidence("diagnostic-lightbox--portrait--1024x768.a11y.yml")],
] as const) {
  test(`portrait screenshot gallery and lightbox stay within the ${String(width)}px desktop viewport`, evidence, async ({ page }) => {
    await page.setViewportSize({ width, height: 768 });
    const bytes = Buffer.from(TRUECOLOUR_PNG_BASE64, "base64");
    const bundle = screenshotBundle(2, {
      width: 10, height: 14, byteLength: bytes.byteLength,
      digest: FingerprintSchema.parse(createHash("sha256").update(bytes).digest("hex")),
      detail: "image/png · 10 × 14 px · redacted",
    });
    await page.route(`**/api/v1/diagnostic-bundles/${bundle.bundleId}`, (route) => route.fulfill({ json: bundle }));
    await page.route("**/api/v1/diagnostic-bundles/*/attachments/*", (route) => route.fulfill({ body: bytes, contentType: "image/png" }));
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: FIXTURE_IDS.failedRun });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Workflow Panel" })).toHaveCount(0);
    await openDiagnosticRecord(page);
    await expectBundleTriggerContainment(
      page.getByRole("button", { name: `Diagnostic bundle ${bundle.bundleId}`, exact: true }), bundle.bundleId,
    );
    await page.getByRole("button", { name: `Diagnostic bundle ${bundle.bundleId}` }).click();
    const dialog = page.getByRole("dialog", { name: `Diagnostic bundle ${bundle.bundleId}` });
    const trigger = dialog.getByRole("button", { name: "Open Diagnostic screenshot 1 of 2" });
    await trigger.scrollIntoViewIfNeeded();
    await expectDecoded(trigger.getByRole("img"), 10, 14);
    await expectNoOverflow(dialog, width);
    const triggerBox = await trigger.boundingBox();
    if (triggerBox === null) throw new Error("screenshot trigger not rendered");
    expect(triggerBox.height).toBeGreaterThanOrEqual(44);
    expect(triggerBox.width).toBeGreaterThanOrEqual(44);
    await expectClearTargets(dialog, [
      trigger,
      dialog.getByRole("button", { name: "Open Diagnostic screenshot 2 of 2", exact: true }),
      dialog.getByRole("button", { name: "Close", exact: true }),
      dialog.getByRole("link", { name: "Download the manifest", exact: true }),
    ], ["Open Diagnostic screenshot 1 of 2", "Open Diagnostic screenshot 2 of 2", "Close", "Download the manifest"]);
    await trigger.click();
    const lightbox = page.getByRole("dialog", { name: "Diagnostic screenshot 1 of 2" });
    await expectDecoded(lightbox.getByRole("img"), 10, 14);
    await expectNoOverflow(lightbox, width);
    const actions = lightbox.getByRole("button").or(lightbox.getByRole("link"));
    expect(await actions.count()).toBe(2);
    for (const action of await actions.all()) {
      const box = await action.boundingBox();
      if (box === null) throw new Error("lightbox action not rendered");
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await expectClearTargets(lightbox, [
      lightbox.getByRole("button", { name: "Back to screenshots", exact: true }),
      lightbox.getByRole("link", { name: "Download screenshot", exact: true }),
    ], ["Back to screenshots", "Download screenshot"]);
    await attachLightboxEvidence(page, lightbox, `diagnostic-lightbox--portrait--${String(width)}x768`, 10, 14);
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  });
}

async function expectNoOverflow(dialog: Locator, width: number): Promise<void> {
  const geometry = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left, right: rect.right,
      overflow: [element, ...element.querySelectorAll("section, footer")].some((node) => node.scrollWidth > node.clientWidth),
    };
  });
  expect(geometry.overflow).toBe(false);
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(width);
}

test("keeps the absent diagnostic-bundle arm explanatory and does not expose a dead action", async ({ page }) => {
  const failureSection = FIXTURE_SECTIONS[FIXTURE_IDS.failedRun]?.failure;
  if (failureSection?.section !== "failure" || failureSection.payload.state !== "available") {
    throw new Error("the fixture must include the failed run's failure section");
  }
  const absent = RunDetailSectionResponseSchema.parse({
    ...failureSection,
    payload: {
      ...failureSection.payload,
      value: {
        ...failureSection.payload.value,
        diagnosticBundle: { state: "absent", reason: "capture was not requested for this failure" },
      },
    },
  });
  await page.route(`**/api/v1/runs/${FIXTURE_IDS.failedRun}/failure*`, (route) => route.fulfill({ json: absent }));
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: FIXTURE_IDS.failedRun });
  await openDiagnosticRecord(page);
  await expect(page.getByText("no diagnostic bundle — capture was not requested for this failure")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Diagnostic bundle / })).toHaveCount(0);
});

test("keeps the lg dialog and its actions inside the narrow desktop viewport", async ({ page }) => {
  await page.setViewportSize(NARROW_DESKTOP_VIEWPORT);
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: FIXTURE_IDS.failedRun });
  // The product's own Escape binding minimizes the floating workflow panel;
  // otherwise that panel truthfully owns the tap at this narrow width — the
  // disclosure below included, which is why it is opened AFTER this and not
  // straight after navigation the way the desktop cases do it.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Workflow Panel" })).toHaveCount(0);
  await openDiagnosticRecord(page);
  await page.getByRole("button", { name: `Diagnostic bundle ${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}` }).click();
  const observed = await page.getByRole("dialog").evaluate((dialog) => {
    const actions = [...dialog.querySelectorAll("button, a")].map((action) => ({
      name: action.textContent,
      height: action.getBoundingClientRect().height,
    }));
    return {
      horizontalOverflow: dialog.scrollWidth > dialog.clientWidth,
      actions,
    };
  });
  expect(observed.horizontalOverflow).toBe(false);
  for (const action of observed.actions.filter((action) => action.name === "Close" || action.name === "Download the manifest")) {
    expect(action.height).toBeGreaterThanOrEqual(44);
  }
  const screenshotDetail = await page.getByText(/image\/png · \d+ bytes/u).boundingBox();
  if (screenshotDetail === null) throw new Error("the screenshot content detail is not rendered");
  expect(screenshotDetail.width).toBeGreaterThanOrEqual(250);
});
