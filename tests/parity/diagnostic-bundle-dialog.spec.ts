/** E29: the diagnostic bundle is a real, accessible readback surface, not a text fragment. */
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { RunDetailSectionResponseSchema } from "../../src/domain/dashboard/run-detail.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR, ensureParityBundle } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY, FIXTURE_DIAGNOSTIC_BUNDLE, FIXTURE_IDS, FIXTURE_SECTIONS } from "./helpers/fixture-day.js";

const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;
let server: FixtureServer;

test.beforeAll(async () => {
  ensureParityBundle();
  server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
});

test.afterAll(async () => {
  await server.close();
});

test("opens the strict bundle dialog, restores focus on Escape, and downloads the served manifest", async ({ page }) => {
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: FIXTURE_IDS.failedRun });
  const trigger = page.getByRole("button", { name: `Diagnostic bundle ${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}` });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: `Diagnostic bundle ${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Redacted at capture, never at render")).toBeVisible();
  await expect(dialog.getByText("Accessibility excerpt")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download the manifest" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[role='dialog']") !== null)).toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download the manifest" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}.json`);
  const downloadedPath = await download.path();
  if (downloadedPath === null) throw new Error("the manifest download did not produce a file");
  expect(JSON.parse(await readFile(downloadedPath, "utf8"))).toEqual(FIXTURE_DIAGNOSTIC_BUNDLE);
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
  await expect(page.getByText("no diagnostic bundle — capture was not requested for this failure")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Diagnostic bundle / })).toHaveCount(0);
});

test("keeps the lg dialog inside the mobile viewport with touch-sized actions", async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: FIXTURE_IDS.failedRun });
  // The product's own Escape binding minimizes the floating workflow panel;
  // otherwise that panel truthfully owns the tap at this narrow width.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Workflow Panel" })).toHaveCount(0);
  await page.getByRole("button", { name: `Diagnostic bundle ${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}` }).click();
  const observed = await page.getByRole("dialog").evaluate((dialog) => {
    const actions = [...dialog.querySelectorAll("button")].map((button) => ({
      name: button.textContent,
      height: button.getBoundingClientRect().height,
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
});
