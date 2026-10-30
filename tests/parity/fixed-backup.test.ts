import { attachShellA11y } from "./helpers/shell-proof.js";
import { expect, test } from "@playwright/test";
import { captureParityPair } from "./helpers/capture.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
import { REFERENCES, registerReferenceServers } from "./helpers/reference-harness.js";
const servers = registerReferenceServers(["server"]);
test("Fixed app data cannot relocate and Restore requires confirmation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=fixed-backup`);
  await expect(page.getByRole("textbox", { name: "Runtime state folder", exact: true })).toHaveAttribute("readonly", "");
  await expect(page.getByRole("button", { name: /Change.*folder|relocat/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Backup", exact: true }).click();
  await expect(page.getByText("Backup in progress", { exact: true })).toBeVisible();
  await expect(page.getByText("Backup verified", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Show ready", exact: true }).click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByRole("button", { name: "Keep current data", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Restore verified backup", exact: true }).click();
  await expect(page.getByText("Restore in progress", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show blocked", exact: true }).click();
  await expect(page.getByRole("button", { name: "Restore", exact: true })).toBeDisabled();
});

for (const [state, actions] of [
  ["ready", []],
  ["backing-up", ["Backup"]],
  ["backup-complete", ["Show backup-complete"]],
  ["restore-confirmation", ["Restore"]],
  ["restoring", ["Restore", "Restore verified backup"]],
  ["blocked", ["Show blocked"]],
  ["unavailable", ["Show unavailable"]],
] as const) test(`fixed-backup ${state} presentation`, { annotation: [{ type: "required-a11y-evidence", description: `fixed-backup-${state}.a11y.yml` }] }, async ({ page }, info) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=fixed-backup`);
  await expect(page.getByRole("heading", { name: "Paths", exact: true, level: 1 })).toBeVisible();
  for (const name of actions) await page.getByRole("button", { name, exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: `fixed-backup-${state}`, viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "fixed-backup", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
  await attachShellA11y(page, info, `fixed-backup-${state}.a11y.yml`);
});
