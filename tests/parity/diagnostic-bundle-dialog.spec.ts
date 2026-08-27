/** E29: the diagnostic bundle is a real, accessible readback surface, not a text fragment. */
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { RunDetailSectionResponseSchema } from "../../src/domain/dashboard/run-detail.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR, ensureParityBundle } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-bff.js";
import {
  FIXTURE_DAY,
  FIXTURE_DIAGNOSTIC_BUNDLE,
  FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST,
  FIXTURE_IDS,
  FIXTURE_SECTIONS,
} from "./helpers/fixture-day.js";

const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;
let server: FixtureServer;

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

test("opens the strict bundle dialog, restores focus on Escape, and downloads the served manifest", async ({ page }) => {
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: FIXTURE_IDS.failedRun });
  await openDiagnosticRecord(page);
  const trigger = page.getByRole("button", { name: `Diagnostic bundle ${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}` });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: `Diagnostic bundle ${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Redacted at capture, never at render")).toBeVisible();
  await expect(dialog.getByText("Accessibility excerpt")).toBeVisible();
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

test("keeps the lg dialog inside the mobile viewport with touch-sized actions", async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
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
  const screenshotDetail = await page.getByText(/image\/png · 200 bytes/u).boundingBox();
  if (screenshotDetail === null) throw new Error("the screenshot content detail is not rendered");
  expect(screenshotDetail.width).toBeGreaterThanOrEqual(250);
});
