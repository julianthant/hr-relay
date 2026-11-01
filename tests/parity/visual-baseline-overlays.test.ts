import { DashboardDayWireSchema } from "../../src/models/dashboard/projection.js";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY_WIRE } from "./helpers/fixture-queue.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { installFrozenMonotonic } from "./helpers/app-driver.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { wireError } from "../support/fixtures/dashboard/fixture-wire-error.js";
import { attachPresentationReference } from "./helpers/presentation-reference.js";

async function menu(page: Page, info: TestInfo, label: RegExp, state: string) {
  const trigger = page.getByRole("dialog", { name: "Start a run", exact: true }).getByRole("button", { name: label });
  await trigger.click();
  await expect(page.getByRole("menu").and(page.locator("[data-open]"))).toBeVisible();
  await attachPresentationReference(page, info, `${state}.png`);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

test("mounted launch pickers and queue overlays", async ({ page }, info) => {
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  try {
    await installFrozenMonotonic(page);
    await installTheme(page, PARITY_THEMES[0]);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
    const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
    await rail.getByRole("button", { name: "OCR", exact: true }).click();
    await page.getByRole("button", { name: "Start a run", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Start a run", exact: true });
    await expect(dialog).toBeVisible();
    await menu(page, info, /Form type$/u, "run-form-type-menu");
    await menu(page, info, /Roster$/u, "run-roster-menu");
    await dialog.locator('input[type="file"]').setInputFiles({ name: "fixture.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF") });
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog.getByRole("region", { name: "Options", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await rail.getByRole("button", { name: "OnBase", exact: true }).click();
    await page.getByRole("button", { name: "Start a run", exact: true }).click();
    await menu(page, info, /Document type$/u, "run-document-type-menu");
    await page.keyboard.press("Escape");
    await rail.getByRole("button", { name: "Work-Study", exact: true }).click();
    await page.getByRole("button", { name: "Start a run", exact: true }).click();
    const calendar = dialog.getByRole("button", { name: /Choose effective date/iu });
    await calendar.click();
    await expect(page.getByRole("grid")).toBeVisible();
    await attachPresentationReference(page, info, "run-date-calendar.png");
  } finally { await server.close(); }
});

test("mounted served Queue empty, failure and unselected states", async ({ page }, info) => {
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  try {
    await installFrozenMonotonic(page);
    await installTheme(page, PARITY_THEMES[0]);
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
    await expect(page.getByRole("region", { name: "Queue", exact: true })).toBeVisible();
    await expect(page.getByText("No run open", { exact: true })).toBeVisible();
    await attachPresentationReference(page, info, "queue-no-selection.png");
    const emptyWire = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, queueSurfaces: [], statusCounts: [], workflowCounts: [] });
    const empty = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, dayWire: emptyWire });
    try {
      await page.goto(`${empty.baseUrl}/?day=${FIXTURE_DAY}`);
      await expect(page.getByText("No Person Lookup runs", { exact: true })).toBeVisible();
      await attachPresentationReference(page, info, "queue-empty.png");
      await page.route("**/events/v1**", route => route.fulfill({ status: 503, json: wireError("FIXTURE_QUEUE_UNAVAILABLE", "Synthetic queue unavailable") }));
      await page.route("**/api/v1/dashboard?**", route => route.fulfill({ status: 503, json: wireError("FIXTURE_QUEUE_UNAVAILABLE", "Synthetic queue unavailable") }));
      await page.reload();
      await expect(page.getByText("Could not load queue", { exact: true })).toBeVisible();
      await attachPresentationReference(page, info, "queue-failure.png");
    } finally { await empty.close(); }
  } finally { await server.close(); }
});

test("mounted Separations Rerun and delete confirmation", async ({ page }, info) => {
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  try {
    await installFrozenMonotonic(page);
    await installTheme(page, PARITY_THEMES[0]);
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&start=1&view=${encodeURIComponent(JSON.stringify({ preview: "separations", mockRun: "mock:separations:sample", launchWorkflow: "separations", launchSource: "mock:separations:sample", launchStage: "Steps" }))}`);
    await expect(page.getByRole("dialog", { name: "Rerun", exact: true })).toBeVisible();
    await attachPresentationReference(page, info, "rerun-separations.png");
    await page.keyboard.press("Escape");
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&view=${encodeURIComponent(JSON.stringify({ preview: "onboarding", mockRun: "mock:onboarding:sample" }))}`);
    await page.getByRole("region", { name: "Queue", exact: true }).getByRole("button", { name: "Delete", exact: true }).first().click();
    await expect(page.getByRole("dialog", { name: /^Delete /u })).toBeVisible();
    await attachPresentationReference(page, info, "queue-delete-dialog.png");
  } finally { await server.close(); }
});
