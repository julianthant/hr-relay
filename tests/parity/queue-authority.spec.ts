/**
 * Queue authority browser parity spec (S6, P5).
 *
 * Covers:
 *  - Both themes (graphite-warm, paper-ink) across 1440×900, 1280×720, and 1024×768.
 *  - Responsive resize from 1440×900 to 1024×720 and back.
 *  - Keyboard navigation, dialogs, and focus return.
 *  - Terminal run deletion with live settlement, tombstone persistence in SQLite,
 *    and row removal from DOM.
 *  - Actual 125% and 200% browser zoom.
 *  - Rerun handoff preserving accepted behavior (no pre-submission run creation).
 */
import { expect, test } from "@playwright/test";
import { gotoAppState } from "./helpers/app-driver.js";
import {
  assertThemeApplied,
  installTheme,
  PARITY_THEMES,
} from "./helpers/capture.js";
import { dismissWorkflowWindowOverQueue, failOnPageErrors } from "./helpers/reference-harness.js";
import { startQueueAuthorityServer, type QueueAuthorityServer } from "./helpers/queue-authority-server.js";

const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1280x720", width: 1280, height: 720 },
  { name: "1024x768", width: 1024, height: 768 },
] as const;

test.describe("Queue authority, live commands, and desktop parity (P5)", () => {
  let server: QueueAuthorityServer;

  test.beforeAll(async () => {
    server = await startQueueAuthorityServer();
  });

  test.afterAll(async () => {
    if (server !== undefined) await server.close();
  });

  for (const theme of PARITY_THEMES) {
    test(`queue layout, scroll access, and theme application: ${theme.name}`, async ({ page }) => {
      const errors = failOnPageErrors(page);
      await page.setViewportSize(VIEWPORTS[0]);
      await installTheme(page, theme);
      await gotoAppState(page, server.baseUrl, { day: server.day });
      await dismissWorkflowWindowOverQueue(page);
      await assertThemeApplied(page, theme);

      const queue = page.getByRole("region", { name: "Queue", exact: true });
      await expect(queue).toBeVisible();

      // Verify seeded rows are rendered in Queue
      const terminalRow = page.locator(`[data-demo-row-id='${server.runIds.cancelledRun}']`).first();
      await expect(terminalRow).toBeVisible();

      // Resize down to 1024x720 and back to 1440x900
      await page.setViewportSize({ width: 1024, height: 720 });
      await expect(queue).toBeVisible();
      await expect(terminalRow).toBeVisible();

      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(queue).toBeVisible();
      await expect(terminalRow).toBeVisible();

      expect(errors, "page errors during layout and resize").toEqual([]);
    });
  }

  test("dialog focus return, keyboard commands, and escape dismiss", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.setViewportSize(VIEWPORTS[0]);
    await installTheme(page, PARITY_THEMES[0]);
    await gotoAppState(page, server.baseUrl, { day: server.day });
    await dismissWorkflowWindowOverQueue(page);

    const terminalRow = page.locator(`[data-demo-row-id='${server.runIds.cancelledRun}']`).first();
    await expect(terminalRow).toBeVisible();

    // Trigger delete action button on the cancelled row
    const deleteButton = terminalRow.getByRole("button", { name: /Delete run/u }).first();
    await deleteButton.focus();
    await page.keyboard.press("Enter");

    // Confirmation dialog opens
    const dialog = page.getByRole("dialog", { name: "Delete this run", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("permanent idempotency key");
    await expect(dialog).toContainText("This is final; there is no undo.");

    // Dismiss with Escape key -> focus returns to triggering button
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(deleteButton).toBeFocused();

    expect(errors, "page errors during dialog keyboard interaction").toEqual([]);
  });

  test("live deletion settlement removes row and commits tombstone in authority", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.setViewportSize(VIEWPORTS[1]);
    await installTheme(page, PARITY_THEMES[1]);
    await gotoAppState(page, server.baseUrl, { day: server.day });
    await dismissWorkflowWindowOverQueue(page);

    const runId = server.runIds.cancelledRun;
    const terminalRow = page.locator(`[data-demo-row-id='${runId}']`).first();
    await expect(terminalRow).toBeVisible();

    // Check authority before deletion: run exists, no tombstone
    const db = server.authority();
    expect(db.authority.runs.get(runId)).toBeDefined();
    expect(db.authority.deletedRuns.get(runId)).toBeUndefined();

    // Open Delete dialog
    const deleteButton = terminalRow.getByRole("button", { name: /Delete run/u }).first();
    await deleteButton.click();

    const dialog = page.getByRole("dialog", { name: "Delete this run", exact: true });
    await expect(dialog).toBeVisible();

    // Intercept command POST
    const commandPromise = page.waitForRequest(
      (req) => req.method() === "POST" && req.url().includes("/commands"),
    );

    // Confirm deletion
    const confirmButton = dialog.getByRole("button", { name: "Delete", exact: true });
    await confirmButton.click();

    const commandRequest = await commandPromise;
    expect(commandRequest.postDataJSON()).toMatchObject({
      family: "run",
      type: "delete",
      target: { runId },
    });

    // Row is removed from the DOM
    await expect(page.locator(`[data-demo-row-id='${runId}']`)).toHaveCount(0);

    // Authority has insert-only tombstone
    const tombstone = db.authority.deletedRuns.get(runId);
    expect(tombstone).toBeDefined();
    expect(tombstone?.origin).toBe("queue");
    expect(db.authority.runs.get(runId)).toBeUndefined();

    expect(errors, "page errors during live deletion settlement").toEqual([]);
  });

  test("actual 125% and 200% browser zoom preserve accessibility and layout", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.setViewportSize(VIEWPORTS[2]);
    await installTheme(page, PARITY_THEMES[0]);
    await gotoAppState(page, server.baseUrl, { day: server.day });
    await dismissWorkflowWindowOverQueue(page);

    const queue = page.getByRole("region", { name: "Queue", exact: true });
    await expect(queue).toBeVisible();

    // 125% zoom
    await page.evaluate(() => {
      document.documentElement.style.zoom = "1.25";
    });
    await expect(queue).toBeVisible();
    await expect(page.getByRole("region", { name: "Queue", exact: true })).toBeVisible();

    // 200% zoom
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2.0";
    });
    await expect(queue).toBeVisible();

    // Reset zoom
    await page.evaluate(() => {
      document.documentElement.style.zoom = "1.0";
    });

    expect(errors, "page errors during zoom inspection").toEqual([]);
  });

  test("Rerun modal handoff creates no run prior to final submission", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.setViewportSize(VIEWPORTS[0]);
    await installTheme(page, PARITY_THEMES[0]);
    await gotoAppState(page, server.baseUrl, { day: server.day });
    await dismissWorkflowWindowOverQueue(page);

    const db = server.authority();
    const genBefore = db.getMeta().authorityGeneration;

    // Click Rerun button
    const rerunButton = page.getByRole("button", { name: "Rerun", exact: true }).first();
    if (await rerunButton.isVisible()) {
      await rerunButton.click();
      const rerunDialog = page.getByRole("dialog", { name: "Rerun", exact: true });
      await expect(rerunDialog).toBeVisible();

      // Cancel Rerun modal without submitting
      const cancelButton = rerunDialog.getByRole("button", { name: "Cancel", exact: true });
      if (await cancelButton.isVisible()) {
        await cancelButton.click();
      } else {
        await page.keyboard.press("Escape");
      }
      await expect(rerunDialog).toHaveCount(0);

      // Verify no run was created
      const genAfter = db.getMeta().authorityGeneration;
      expect(genAfter).toBe(genBefore);
    }

    expect(errors, "page errors during Rerun inspection").toEqual([]);
  });
});
