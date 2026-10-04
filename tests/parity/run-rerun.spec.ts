import { createHash } from "node:crypto";
import { test, expect } from "@playwright/test";
import { startRunRerunServer } from "./helpers/run-rerun-server.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_THEMES, installTheme, assertThemeApplied, captureParityPair } from "./helpers/capture.js";
import { REFERENCES, failOnPageErrors } from "./helpers/reference-harness.js";

for (const viewport of [{ name: "1280x720", width: 1280, height: 720 }, { name: "1440x900", width: 1440, height: 900 }]) {
  for (const theme of PARITY_THEMES) test(`Rerun warning, Values and review ${theme.name} @ ${viewport.name}`, { annotation: [{ type: "required-a11y-evidence", description: `run-rerun-${theme.name}-${viewport.name}.a11y.yml` }] }, async ({ page }) => {
    const server = await startRunRerunServer(); const errors = failOnPageErrors(page);
    try {
      await page.setViewportSize(viewport); await installTheme(page, theme);
      await gotoAppState(page, server.baseUrl, { day: server.day }); await assertThemeApplied(page, theme);
      const launcher = page.getByRole("button", { name: "Rerun", exact: true }); await launcher.click();
      const dialog = page.getByRole("dialog", { name: "Rerun", exact: true }); await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("checkbox", { name: "Read employee", exact: true })).toBeChecked();
      await expect(dialog.getByText("Completed in the source; this workflow requires it to run again.", { exact: false })).toBeVisible();
      const before = server.h.authoritySnapshot();
      await dialog.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(dialog.getByRole("region", { name: "Repeat transaction warning" })).toBeVisible();
      expect(server.h.authoritySnapshot()).toBe(before);
      const capture = async (stage: string) => captureParityPair(page, REFERENCES, { stateId: `run-rerun-${stage}`, viewport: viewport.name,
        theme: theme.name, adapter: "seeded", fixtureId: "run-rerun-authority", descriptorHash: server.descriptorHash,
        appVersion: "0.1.0", capturedAt: server.day, variant: "default" });
      await capture("warning");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog.getByRole("heading", { name: "Steps", exact: true })).toBeVisible();
      expect(server.h.authoritySnapshot()).toBe(before);
      await dialog.getByRole("button", { name: "Continue", exact: true }).click();
      const confirm = dialog.getByRole("button", { name: "Confirm", exact: true }); await confirm.focus(); await page.keyboard.press("Enter");
      await expect(dialog.getByRole("region", { name: "Values", exact: true })).toBeVisible();
      expect(server.h.authoritySnapshot()).toBe(before); expect(server.commands).toHaveLength(0);
      await expect(dialog.getByRole("textbox", { name: "Employee ID", exact: true })).toHaveValue("10812345");
      await dialog.getByRole("button", { name: "Copy Previous transaction", exact: true }).click();
      await dialog.getByLabel("New Previous transaction", { exact: true }).fill("Reviewed memo");
      await capture("values");
      await dialog.getByRole("button", { name: "Continue", exact: true }).click();
      await dialog.getByRole("checkbox", { name: "Dry run", exact: true }).check();
      await dialog.getByRole("button", { name: "Preview plan", exact: true }).click();
      await expect(dialog.getByRole("button", { name: "Start dry run", exact: true })).toBeVisible();
      expect(server.h.queueRoots).toHaveLength(1); await capture("review");
      const name = `run-rerun-${theme.name}-${viewport.name}.a11y.yml`; const tree = await page.locator("body").ariaSnapshot();
      test.info().annotations.push({ type: `a11y-attachment-sha256:${name}`, description: createHash("sha256").update(tree).digest("hex") });
      await test.info().attach(name, { body: tree, contentType: "text/yaml" });
      await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(launcher).toBeFocused();
      expect(server.h.queueRoots).toHaveLength(1); expect(errors).toEqual([]);
    } finally { await page.close(); await server.close(); }
  });
}
