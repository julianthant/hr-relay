import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { storageRecoveryTarget } from "./helpers/storage-recovery-server.js";
import { PARITY_THEMES, installTheme, assertThemeApplied } from "./helpers/capture.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { dismissWorkflowWindow, failOnPageErrors } from "./helpers/reference-harness.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { ensureParityBundle } from "./helpers/bundle.js";
import { StorageDoctorWireSchema } from "../../src/domain/dashboard/storage.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

for (const theme of PARITY_THEMES) for (const viewport of [{width: 1024, height: 720}, {width: 1440, height: 900}]) {
  const a11yName = `recovered-${theme.name}-${String(viewport.width)}x${String(viewport.height)}.a11y.yml`;
  test(`real storage recovery @ ${theme.name} @ ${String(viewport.width)}x${String(viewport.height)}`, {annotation: [{type: "required-a11y-evidence", description: a11yName}]}, async ({page}) => {
    ensureParityBundle();
    const target = await storageRecoveryTarget();
    const errors = failOnPageErrors(page);
    try {
      await target.start();
      await page.setViewportSize(viewport);
      await installTheme(page, theme);
      await gotoAppState(page, target.baseUrl, {day: FIXTURE_DAY, settings: "storage"});
      await dismissWorkflowWindow(page);
      await assertThemeApplied(page, theme);
      const response = page.waitForResponse(response => response.url().endsWith("/api/v1/storage/doctor"));
      const doctor = page.getByRole("button", {name: "Run the read-only storage doctor"});
      await doctor.focus(); await doctor.press("Enter");
      const wire = StorageDoctorWireSchema.parse(await (await response).json());
      expect(wire.authority.state).toBe("healthy");
      expect(wire.recovery.state).toBe("interrupted");
      expect(wire.protectedSettings.state).toBe("available");
      expect(wire.restoreCandidates.some(row => row.state === "verified-compatible" && row.selection === "lifecycle-pair" && row.restoreEligibility.state === "eligible")).toBe(true);
      await expect(page.getByText("Interrupted recovery", {exact: true})).toBeVisible();
      await expect(page.getByText("ucpathPassword: present", {exact: true})).toBeAttached();
      const instructions = page.getByRole("button", {name: "Storage recovery instructions"});
      await instructions.focus(); await instructions.press("Enter");
      const help = page.getByRole("dialog", {name: "Storage recovery instructions"});
      await expect(help).toBeVisible();
      await expect(help.locator("code")).toHaveCount(5);
      await help.getByText(/After recovery, rerun the doctor/u).scrollIntoViewIfNeeded();
      await expect(help.getByText(/After recovery, rerun the doctor/u)).toBeInViewport();
      await expect(help).toHaveCSS("opacity", "1");
      await test.info().attach("recovery-instructions.png", {body: await page.screenshot(), contentType: "image/png"});
      await page.keyboard.press("Escape");
      await expect(instructions).toBeFocused();
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
      expect(after.protectedSettings).toEqual(wire.protectedSettings);
      await expect(page.getByText("No interruption markers", {exact: true})).toBeVisible();
      await expect(page.getByText("Interrupted recovery", {exact: true})).toHaveCount(0);
      await page.getByRole("region", {name: "Independent credentials"}).scrollIntoViewIfNeeded();
      await expect(page.getByText("ucpathPassword: present", {exact: true})).toBeInViewport();
      await page.setViewportSize({width: 1100, height: 760});
      await instructions.focus(); await instructions.press("Enter");
      await expect(help).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(instructions).toBeFocused();
      expect(target.requests.filter(row => row.method !== "GET")).toEqual([]);
      expect(errors).toEqual([]);
      const body = await page.locator("body").ariaSnapshot();
      expect(body).not.toContain("SYNTHETIC_STORAGE_PROOF_NEVER_REAL");
      test.info().annotations.push({type: `a11y-attachment-sha256:${a11yName}`, description: createHash("sha256").update(body).digest("hex")});
      await test.info().attach(a11yName, {body, contentType: "text/yaml"});
      await test.info().attach("recovered.png", {body: await page.screenshot(), contentType: "image/png"});
      await test.info().attach("real-route-proof.json", {body: JSON.stringify({provenance: target.provenance(), before: wire,
        restored: JSON.parse(restored.output) as unknown, after, requests: target.requests}, null, 2), contentType: "application/json"});
    } finally { await target.dispose(); }
  });
}

test("real doctor serves corrupt authority and invalid recovery evidence together", async ({page}) => {
  ensureParityBundle();
  const target = await storageRecoveryTarget();
  try {
    const authorityPath = join(target.root, "state.db");
    const original = readFileSync(authorityPath);
    writeFileSync(authorityPath, "synthetic corrupt authority");
    writeFileSync(join(target.root, ".lifecycle-restore.json"), "{invalid synthetic marker");
    await target.start();
    await gotoAppState(page, target.baseUrl, {day: FIXTURE_DAY, settings: "storage"});
    await dismissWorkflowWindow(page);
    const response = page.waitForResponse(response => response.url().endsWith("/api/v1/storage/doctor"));
    await page.getByRole("button", {name: "Run the read-only storage doctor"}).click();
    const wire = StorageDoctorWireSchema.parse(await (await response).json());
    expect(wire.authority.state).toBe("degraded"); expect(wire.recovery.state).toBe("unavailable");
    expect(wire.counts.state).toBe("unavailable");
    await expect(page.getByText("Inspection unavailable", {exact: true})).toBeVisible();
    await expect(page.getByText(/Pending counts unavailable/u)).toBeVisible();
    expect(readFileSync(authorityPath)).not.toEqual(original);
    expect(readFileSync(authorityPath, "utf8")).toBe("synthetic corrupt authority");
    expect(target.requests.filter(row => row.method !== "GET")).toEqual([]);
    await test.info().attach("combined-failure.json", {body: JSON.stringify(wire), contentType: "application/json"});
  } finally { await target.dispose(); }
});
