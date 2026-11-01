import { AuthoritySourceClosureUnprovedError } from '../../src/backend/storage/source-closure.js';

import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { startRunRerunServer } from "./helpers/run-rerun-server.js";

const retainedParityFixtureFailures = new Set<object>();

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`approved Rerun proportions and source-bound flow @ ${theme.attribute}-${width}`, async ({ page }, _info) => {
    const server = await startRunRerunServer();
    let parityBodyFailure: { error: unknown } | undefined;
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 900 });
      await installTheme(page, theme);
      const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      await gotoAppState(page, server.baseUrl, { day: server.day });
      const source = JSON.stringify(server.h.fresh(server.source));
      const launcher = page.getByRole("button", { name: "Rerun", exact: true }); await launcher.click();
      const dialog = page.getByRole("dialog", { name: "Rerun", exact: true });
      await expect(dialog.getByRole("heading", { name: "Choose what to run again", exact: true })).toBeVisible();
      expect((await dialog.boundingBox())!.width).toBe(880); expect((await dialog.boundingBox())!.height).toBe(628);
      expect((await dialog.locator(":scope > header").boundingBox())!.height).toBe(73);
      expect((await dialog.locator(":scope > footer").boundingBox())!.height).toBe(57);
      await expect(dialog.locator(".launch-workflow-rail")).toHaveCount(0);
      expect((await dialog.locator(".launch-stagebar").boundingBox())!.height).toBe(54);
      await expect(dialog.getByRole("list", { name: "Run configuration path" })).toHaveText(/1Steps2Values3Options4Confirm/u);
      const required = dialog.getByRole("checkbox", { name: "Read employee", exact: true });
      await expect(required).toBeChecked(); await expect(required).toBeDisabled();
      await expect(dialog.locator(".launch-step-status").first()).toHaveCSS("height", "18px");

      await dialog.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(dialog.getByRole("region", { name: "Repeat transaction warning" })).toBeVisible();
      await expect(dialog.locator('.launch-stagebar [aria-current="step"]')).toHaveText(/Steps/u);
      expect(server.commands).toHaveLength(0);
      await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
      const identity = dialog.getByRole("textbox", { name: "Employee ID", exact: true });
      await expect(identity).toHaveValue("10812345");
      expect((await identity.boundingBox())!.width).toBeLessThanOrEqual(280);
      await expect(dialog.getByRole("textbox", { name: "Previous transaction", exact: true })).toHaveValue("");

      await dialog.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(dialog.getByRole("region", { name: "Options", exact: true })).toBeVisible();
      expect((await dialog.getByRole("button", { name: "None Workbook · Optional", exact: true }).boundingBox())!.height).toBe(36);
      await expect(dialog.getByRole("button", { name: /Workers$/u })).toHaveCount(0);
      await dialog.getByRole("checkbox", { name: "Dry run", exact: true }).check();

      await dialog.getByRole("button", { name: "Preview plan", exact: true }).click();
      await expect(dialog.getByRole("button", { name: "Start dry run", exact: true })).toBeVisible();
      await expect(dialog.locator("dt").filter({ hasText: /^Steps$/u })).toHaveCount(1);
      expect(server.commands).toHaveLength(0); expect(server.h.queueRoots).toHaveLength(1);

      await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(launcher).toBeFocused();
      expect(JSON.stringify(server.h.fresh(server.source))).toBe(source); expect(errors).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    } catch (error) { parityBodyFailure = { error }; }
    if (parityBodyFailure?.error instanceof AuthoritySourceClosureUnprovedError) {
      retainedParityFixtureFailures.add({ owners: [page, server], primary: parityBodyFailure.error });
      throw parityBodyFailure.error;
    }
    let parityCleanupFailure: { error: unknown } | undefined;
    try { await page.close(); await server.close(); } catch (error) { parityCleanupFailure = { error }; }
    if (parityCleanupFailure !== undefined) {
      retainedParityFixtureFailures.add({ owners: [page, server], primary: parityBodyFailure?.error, cleanup: parityCleanupFailure.error });
      if (parityBodyFailure !== undefined) throw new AggregateError([parityBodyFailure.error, parityCleanupFailure.error], 'parity-body-and-cleanup-failed', { cause: parityBodyFailure.error });
      throw parityCleanupFailure.error;
    }
    if (parityBodyFailure !== undefined) throw parityBodyFailure.error;
  });
}

test("Rerun waits for the omitted step's required values before Options", async ({ page }) => {
  const server = await startRunRerunServer();
  let parityBodyFailure: { error: unknown } | undefined;
    try {
    await gotoAppState(page, server.baseUrl, { day: server.day });
    await page.getByRole("button", { name: "Rerun", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Rerun", exact: true });
    await dialog.getByRole("checkbox", { name: "Check employee", exact: true }).uncheck();
    await dialog.getByRole("checkbox", { name: "File transaction", exact: true }).uncheck();
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog.getByRole("region", { name: "Values", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Copy Check employee · Checked employee ID", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog.getByRole("region", { name: "Options", exact: true })).toBeVisible();
    expect(server.commands).toHaveLength(0); expect(server.h.queueRoots).toHaveLength(1);
  } catch (error) { parityBodyFailure = { error }; }
    if (parityBodyFailure?.error instanceof AuthoritySourceClosureUnprovedError) {
      retainedParityFixtureFailures.add({ owners: [page, server], primary: parityBodyFailure.error });
      throw parityBodyFailure.error;
    }
    let parityCleanupFailure: { error: unknown } | undefined;
    try { await page.close(); await server.close(); } catch (error) { parityCleanupFailure = { error }; }
    if (parityCleanupFailure !== undefined) {
      retainedParityFixtureFailures.add({ owners: [page, server], primary: parityBodyFailure?.error, cleanup: parityCleanupFailure.error });
      if (parityBodyFailure !== undefined) throw new AggregateError([parityBodyFailure.error, parityCleanupFailure.error], 'parity-body-and-cleanup-failed', { cause: parityBodyFailure.error });
      throw parityCleanupFailure.error;
    }
    if (parityBodyFailure !== undefined) throw parityBodyFailure.error;
});
