import { AuthoritySourceClosureUnprovedError } from '../../src/backend/storage/source-closure.js';
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { storageRecoveryTarget } from "./helpers/storage-recovery-server.js";
import { PARITY_THEMES, installTheme, assertThemeApplied } from "./helpers/capture.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { dismissWorkflowWindow, failOnPageErrors } from "./helpers/reference-harness.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { ensureParityBundle } from "./helpers/bundle.js";
import { StorageDoctorWireSchema } from "../../src/models/dashboard/storage.js";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const retainedParityFixtureFailures = new Set<object>();


for (const theme of PARITY_THEMES) for (const viewport of [{width: 1024, height: 720}, {width: 1440, height: 900}]) {
  const a11yName = `recovered-${theme.name}-${String(viewport.width)}x${String(viewport.height)}.a11y.yml`;

test(`real storage recovery @ ${theme.name} @ ${String(viewport.width)}x${String(viewport.height)}`, {annotation: [{type: "required-a11y-evidence", description: a11yName}]}, async ({page}) => {
    ensureParityBundle();
    const target = await storageRecoveryTarget();
    const errors = failOnPageErrors(page);
    let parityBodyFailure: { error: unknown } | undefined;
  try {
      await target.start();
      await page.setViewportSize(viewport);
      await installTheme(page, theme);
      await gotoAppState(page, target.baseUrl, {day: FIXTURE_DAY, settings: "storage"});
      await dismissWorkflowWindow(page);
      await assertThemeApplied(page, theme);
      const response = page.waitForResponse(response => response.url().endsWith("/api/v1/storage/doctor"));
      const doctor = page.locator(".settings-heading-actions button");
      await expect(doctor).toBeEnabled();
      await doctor.focus(); await doctor.press("Enter");
      const wire = StorageDoctorWireSchema.parse(await (await response).json());
      expect(wire.authority.state).toBe("healthy");
      expect(wire.recovery.state).toBe("interrupted");
      expect(wire.protectedSettings.state).toBe("unavailable");
      expect(wire.restoreCandidates.some(row => row.state === "verified-compatible" && row.selection === "single-database" && row.restoreEligibility.state === "eligible")).toBe(true);
      const interruption = page.locator(".diagnostic-check-entry").filter({hasText: "Recovery"});
      await expect(interruption).toContainText("Interrupted");
      const ucpathPassword = page.locator(".diagnostic-check-entry").filter({hasText: "UCPath password"});
      await expect(ucpathPassword).toContainText("Unavailable");
      await expect(page.getByRole("button", {name: "Storage recovery instructions"})).toHaveCount(0);
      await test.info().attach("interrupted-doctor.json", {body: JSON.stringify(wire, null, 2), contentType: "application/json"});
      expect(errors).toEqual([]);
      await page.goto(`${target.baseUrl}/storage-proof-paused.html`);
      await target.stop();
      const restored = await target.restore();
      await target.start();
      await gotoAppState(page, target.baseUrl, {day: FIXTURE_DAY, settings: "storage"});
      await dismissWorkflowWindow(page);
      const refreshed = page.waitForResponse(response => response.url().endsWith("/api/v1/storage/doctor"));
      await doctor.click();
      const after = StorageDoctorWireSchema.parse(await (await refreshed).json());
      expect(after.recovery.state).toBe("clear");
      expect(after.authority.state).toBe("healthy");
      expect(after.protectedSettings.state).toBe("available");
      if (after.protectedSettings.state !== "available") throw new Error("restored credentials unread");
      expect(after.protectedSettings.entries.find(entry => entry.name === "ucpathPassword")?.present).toBe(true);
      await expect(interruption).toContainText("No unfinished storage operations.");
      await expect(interruption.getByRole("button", {name: "Diagnostic details", exact: true})).toHaveCount(0);
      await expect(interruption).toContainText("Clear");
      await page.getByRole("group", {name: "Connections"}).scrollIntoViewIfNeeded();
      await expect(ucpathPassword).toContainText("Present");
      await page.setViewportSize({width: 1100, height: 760});
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(target.requests.filter(row => row.method !== "GET")).toEqual([]);
      expect(errors).toEqual([]);
      const body = await page.locator("body").ariaSnapshot();
      expect(body).not.toContain("SYNTHETIC_STORAGE_PROOF_NEVER_REAL");
      test.info().annotations.push({type: `a11y-attachment-sha256:${a11yName}`, description: createHash("sha256").update(body).digest("hex")});
      await test.info().attach(a11yName, {body, contentType: "text/yaml"});
      await test.info().attach("real-route-proof.json", {body: JSON.stringify({provenance: target.provenance(), before: wire,
        restored: JSON.parse(restored.output) as unknown, after, requests: target.requests}, null, 2), contentType: "application/json"});
    } catch (error) { parityBodyFailure = { error }; }
  if (parityBodyFailure?.error instanceof AuthoritySourceClosureUnprovedError) {
    retainedParityFixtureFailures.add({ owner: target, primary: parityBodyFailure.error });
    throw parityBodyFailure.error;
  }
  let parityCleanupFailure: { error: unknown } | undefined;
  try { await target.dispose(); } catch (error) { parityCleanupFailure = { error }; }
  if (parityCleanupFailure !== undefined) {
    retainedParityFixtureFailures.add({ owner: target, primary: parityBodyFailure?.error, cleanup: parityCleanupFailure.error });
    if (parityBodyFailure !== undefined) throw new AggregateError([parityBodyFailure.error, parityCleanupFailure.error], 'parity-body-and-cleanup-failed', { cause: parityBodyFailure.error });
    throw parityCleanupFailure.error;
  }
  if (parityBodyFailure !== undefined) throw parityBodyFailure.error;
  });
}

test("real doctor serves corrupt authority and invalid recovery evidence together", async ({page}) => {
  ensureParityBundle();
  const target = await storageRecoveryTarget();
  let parityBodyFailure: { error: unknown } | undefined;
  try {
    const authorityPath = join(target.root, "state.db");
    const original = readFileSync(authorityPath);
    writeFileSync(authorityPath, "synthetic corrupt authority");
    writeFileSync(target.stagedPath, "invalid synthetic staging evidence");
    chmodSync(target.stagedPath, 0o666);
    await target.start();
    await gotoAppState(page, target.baseUrl, {day: FIXTURE_DAY, settings: "storage"});
    await dismissWorkflowWindow(page);
    const response = page.waitForResponse(response => response.url().endsWith("/api/v1/storage/doctor"));
    await page.locator(".settings-heading-actions button").click();
    const wire = StorageDoctorWireSchema.parse(await (await response).json());
    expect(wire.authority.state).toBe("degraded"); expect(wire.recovery.state).toBe("unavailable");
    expect(wire.counts.state).toBe("unavailable");
    await expect(page.locator(".diagnostic-check-entry").filter({hasText: "Recovery"})).toContainText("Unavailable");
    await expect(page.locator(".diagnostic-check-entry").filter({hasText: "Pending actions"})).toContainText("Unavailable");
    await expect(page.getByText("Data store unavailable", {exact: true})).toBeVisible();
    expect(readFileSync(authorityPath)).not.toEqual(original);
    expect(readFileSync(authorityPath, "utf8")).toBe("synthetic corrupt authority");
    expect(target.requests.filter(row => row.method !== "GET")).toEqual([]);
    await test.info().attach("combined-failure.json", {body: JSON.stringify(wire), contentType: "application/json"});
  } catch (error) { parityBodyFailure = { error }; }
  if (parityBodyFailure?.error instanceof AuthoritySourceClosureUnprovedError) {
    retainedParityFixtureFailures.add({ owner: target, primary: parityBodyFailure.error });
    throw parityBodyFailure.error;
  }
  let parityCleanupFailure: { error: unknown } | undefined;
  try { await target.dispose(); } catch (error) { parityCleanupFailure = { error }; }
  if (parityCleanupFailure !== undefined) {
    retainedParityFixtureFailures.add({ owner: target, primary: parityBodyFailure?.error, cleanup: parityCleanupFailure.error });
    if (parityBodyFailure !== undefined) throw new AggregateError([parityBodyFailure.error, parityCleanupFailure.error], 'parity-body-and-cleanup-failed', { cause: parityBodyFailure.error });
    throw parityCleanupFailure.error;
  }
  if (parityBodyFailure !== undefined) throw parityBodyFailure.error;
});
