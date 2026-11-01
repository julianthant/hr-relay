
import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { attachShellA11y } from "./helpers/shell-proof.js";
import { ERROR_CATALOG } from "../../src/models/failures/error-catalog.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_STORAGE_DOCTOR } from "./helpers/fixture-storage.js";
import { StorageDoctorWireSchema } from "../../src/models/dashboard/storage.js";
import { ProtectedSettingsNameSchema } from "../../src/models/config/protected-settings.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  const evidence = `storage-presentation-${theme.name}-${width}.a11y.yml`;
  test(`Storage keeps its card layout without run history @ ${theme.attribute} ${width}`, { annotation: [{ type: "required-a11y-evidence", description: evidence }] }, async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const interrupted = StorageDoctorWireSchema.parse({ ...FIXTURE_STORAGE_DOCTOR,
      recovery: { state: "interrupted", findings: [{ marker: "authority-restore", state: "interrupted" }] },
      counts: { state: "available", values: { pendingCommands: 3, unresolvedWriteIntents: 2, leases: 4, providerReservations: 1, artifactOutbox: 5 } },
      protectedSettings: { state: "available", entries: ProtectedSettingsNameSchema.options.map((name, index) => ({ name, present: index === 0 })) },
      authorityUpgrades: { state: "available", phases: [{ phase: "settled", fromSchemaVersion: 26, toSchemaVersion: 27, recordedAt: FIXTURE_STORAGE_DOCTOR.checkedAt }] },
    });
    const healthy = FIXTURE_STORAGE_DOCTOR;
    let requests = 0;
    await page.route("**/api/v1/storage/doctor/latest", route => route.fulfill({ json: { state: "never-run" } }));
    await page.route("**/api/v1/storage/doctor", async route => {
      requests++;
      if (requests === 3) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ state: "error", code: "synthetic-check-failed", message: "Synthetic check failure", retryable: true }) });
      else await route.fulfill({ json: requests === 1 ? interrupted : healthy });
    });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 768 : 1000 });
      await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?settings=storage`);
      const surface = page.getByRole("region", { name: "Storage checks", exact: true });
      const primary = surface.getByRole("group", { name: "Storage health checks", exact: true });
      const run = surface.locator(".ds-page-heading-actions button");
      const recovery = primary.locator(".diagnostic-check-entry").filter({ hasText: "Recovery" });
      await expect(surface.getByRole("heading", { name: "Status", exact: true })).toBeVisible();
      await expect(surface.getByRole("heading", { name: "Data store and recovery", exact: true })).toBeVisible();
      await expect(run).toBeEnabled();
      await expect(primary.getByRole("listitem")).toHaveCount(3);
      await expect(surface.locator(".diagnostic-check-entry")).toHaveCount(13);
      await expect(surface.getByRole("group", { name: "Work in progress", exact: true })).toContainText("Pending actions");
      await expect(surface.getByRole("group", { name: "Connections", exact: true })).toContainText("Not checked");
      await expect(surface.getByRole("button", { name: "Technical details", exact: true })).toHaveCount(0);
      await expect(surface.getByRole("group", { name: "Data store summary", exact: true })).toContainText("Not checked");
      expect(requests).toBe(0);
      await run.click();
      await expect(recovery).toContainText("Interrupted");
      await expect(recovery).toContainText("An interrupted operation needs review before starting work.");
      const pending = surface.getByRole("group", { name: "Work in progress", exact: true }).getByRole("listitem").filter({ hasText: "Pending actions" });
      await expect(pending.locator(".ds-result-row-side")).toHaveText("3");
      await expect(surface.locator(".diagnostic-storage-table,.diagnostic-storage-row-disclosure")).toHaveCount(0);
      await expect(primary.locator(".ds-result-row button")).toHaveCount(0);
      expect(await surface.innerText()).not.toMatch(/Run history|Schema v27|record-digest|span_stream|00000000|authority-restore|Showing the last completed/u);
      const stamp = surface.getByRole("group", { name: "Data store summary", exact: true }).locator("time");
      await expect(stamp).toHaveAttribute("dateTime", interrupted.checkedAt);
      for (const row of await primary.getByRole("listitem").all()) {
        const copy = (await row.locator(".ds-result-row-copy").boundingBox())!;
        const status = (await row.locator(".ds-result-row-side").boundingBox())!;
        expect(status.x).toBeGreaterThan(copy.x + copy.width);
        expect(Math.abs(status.y + status.height / 2 - copy.y - copy.height / 2)).toBeLessThanOrEqual(2);
        expect((await row.boundingBox())!.height).toBeLessThan(280);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      const details = recovery.getByRole("button", { name: "Diagnostic details", exact: true });
      await expect(details).toHaveAttribute("aria-expanded", "false");
      await details.focus();
      await page.keyboard.press("Enter");
      await expect(details).toHaveAttribute("aria-expanded", "true");
      await expect(details).toBeFocused();
      await expect(surface.getByRole("region", { name: "Recovery diagnostics", exact: true })).toContainText("authority-restore: interrupted");
      await page.keyboard.press("Space");
      await expect(details).toHaveAttribute("aria-expanded", "false");
      expect(await surface.innerText()).not.toMatch(/authority-restore/u);
      await expect(pending).toContainText("Accepted actions that have not finished.");
      await expect(pending.locator(".ds-badge")).toHaveCount(0);
      await primary.getByRole("button", { name: "Update history", exact: true }).click();
      await expect(surface.locator(".diagnostic-storage-updates")).toContainText("Update completed");
      await expect(surface.locator(".diagnostic-storage-updates time")).toHaveAttribute("dateTime", interrupted.checkedAt);

      await run.click();
      await expect(recovery).toContainText("No unfinished storage operations.");
      await expect(primary).not.toContainText("Interrupted");
      await expect(primary).toContainText("No storage updates have been recorded.");
      await expect(surface.getByRole("group", { name: "Connections", exact: true })).toContainText("Unavailable");
      await run.click();
      await expect(surface.getByRole("alert")).toContainText("Storage checks could not finish");
      await expect(surface.getByRole("heading", { name: "Status", exact: true })).toBeVisible();
      await expect(surface.getByRole("heading", { name: "Data store and recovery", exact: true })).toBeVisible();
      await expect(recovery).toContainText("No unfinished storage operations.");
      await expect(stamp).toHaveAttribute("dateTime", healthy.checkedAt);
      await expect(run).toBeEnabled();
      await surface.getByRole("alert").getByRole("button", { name: "Diagnostic details", exact: true }).click();
      await expect(surface.getByRole("region", { name: "Check error diagnostics", exact: true })).toHaveText(ERROR_CATALOG.STORAGE_DOCTOR_FAILED.text);
      expect(await surface.innerText()).not.toMatch(/Run history|span_stream|record-digest/u);
      expect(requests).toBe(3);
      expect(errors).toEqual([]);
      await attachShellA11y(page, info, evidence);
    } finally { await server.close(); }
  });
}
